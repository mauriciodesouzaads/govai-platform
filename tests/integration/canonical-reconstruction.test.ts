// CR.1 — append event, read row, reconstruct canonical, verify hashes.
// Per ADP §14.5, this test is INFORMATIVE: it validates that native canonical
// reconstruction works. Failure does NOT fail the build — it documents that
// canonical_bytes (already preserved preventively) is the load-bearing path.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { auditAppend, canonicalize, sha256, hmacVerify } from '@govai/core-audit';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { DevKms } from '@govai/core-identity';
import { chainIdFor } from '@govai/core-events';
import { startPostgres, stopPostgres, freshSeedHex, type TestDb } from './setup.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Runtime CR.1 telemetry is written to a tmp file. The committed runbook
// (`docs/runbooks/canonical-reconstruction-fallback.md`) is the authored
// document and MUST stay byte-stable across test runs — appending PASS/FAIL
// footers to it dirties the working tree on every test run (Issue #5).
const TELEMETRY_FILE = join(tmpdir(), 'govai-cr1-telemetry.md');
const COMMITTED_RUNBOOK = join(__dirname, '..', '..', 'docs', 'runbooks', 'canonical-reconstruction-fallback.md');

let db: TestDb;
const seed = freshSeedHex();
const kms = new DevKms(seed);

beforeAll(async () => {
  db = await startPostgres();
}, 240_000);

afterAll(async () => {
  if (db) await stopPostgres(db);
});

describe('canonical reconstruction (informative)', () => {
  it('CR.1 — reconstruct canonical from row fields and verify HMAC', async () => {
    const orgId = randomUUID();
    const chainId = chainIdFor(orgId, 'run');
    const occurredAt = new Date('2026-05-04T12:34:56.789Z');
    const payloadHash = sha256(Buffer.from('payload-x'));

    const c = await db.appPool.connect();
    let appendedHmac: Buffer = Buffer.alloc(0);
    let appendedSeq = 0n;
    let eventId = '';
    let storedCanonicalBytes: Buffer = Buffer.alloc(0);
    let storedCanonicalHash: Buffer = Buffer.alloc(0);
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, orgId);
      const out = await auditAppend(c, kms, {
        orgId,
        chainId,
        eventType: 'run.completed',
        eventVersion: '1',
        subjectType: 'run',
        subjectId: randomUUID(),
        occurredAt,
        payloadHash,
        keyId: 'audit-1',
        keyVersion: 1,
        redactionMetadata: { actor: 'test', n: 42 },
      });
      eventId = out.eventId;
      appendedSeq = out.sequenceNumber;
      appendedHmac = Buffer.from(out.hmac);
      await c.query('COMMIT');
    } finally {
      c.release();
    }

    const c2 = await db.appPool.connect();
    try {
      await c2.query('BEGIN');
      await setLocalAppOrgId(c2, orgId);
      const r = await c2.query<{
        id: string;
        sequence_number: string;
        previous_hmac: Buffer | null;
        hmac: Buffer;
        canonical_hash: Buffer;
        canonical_bytes: Buffer;
        event_type: string;
        event_version: string;
        subject_type: string;
        subject_id: string;
        occurred_at: Date;
        payload_hash: Buffer;
        payload_ref: string | null;
        key_id: string;
        key_version: number;
        evidence_strength: string;
        redaction_metadata: Record<string, unknown>;
      }>(
        `SELECT * FROM govai.audit_events WHERE id = $1::uuid`,
        [eventId],
      );
      await c2.query('COMMIT');
      const row = r.rows[0]!;
      storedCanonicalBytes = row.canonical_bytes;
      storedCanonicalHash = row.canonical_hash;

      const reconstructed = canonicalize({
        event_id: row.id,
        org_id: orgId,
        chain_id: chainId,
        sequence_number: row.sequence_number,
        previous_hmac: row.previous_hmac ? row.previous_hmac.toString('hex') : null,
        event_type: row.event_type,
        event_version: row.event_version,
        subject_type: row.subject_type,
        subject_id: row.subject_id,
        occurred_at: row.occurred_at.toISOString(),
        payload_hash: row.payload_hash.toString('hex'),
        payload_ref: row.payload_ref,
        key_id: row.key_id,
        key_version: row.key_version,
        evidence_strength: row.evidence_strength,
        redaction_metadata: row.redaction_metadata,
      });
      const reconstructedBytes = Buffer.from(reconstructed, 'utf8');
      const reconstructedHash = Buffer.from(sha256(reconstructedBytes));

      const hashMatch = reconstructedHash.equals(storedCanonicalHash);
      const hmacMatch = await hmacVerify(
        { kms, orgId, keyId: row.key_id, keyVersion: row.key_version },
        new Uint8Array(reconstructedBytes),
        new Uint8Array(row.hmac),
      );

      // Informative telemetry: write outcome to a tmp file (NOT the committed
      // runbook). Best-effort write — failure is not load-bearing.
      const runbookBefore = readFileSync(COMMITTED_RUNBOOK);
      let outcome: string;
      if (hashMatch && hmacMatch) {
        outcome = `## CR.1 outcome (run on ${new Date().toISOString()})\n\n**Native reconstruction PASSED.** \`canonical_bytes\` is redundant but kept as defense.\n`;
      } else {
        outcome = `## CR.1 outcome (run on ${new Date().toISOString()})\n\n**Native reconstruction FAILED** (hashMatch=${hashMatch}, hmacMatch=${hmacMatch}). \`canonical_bytes\` is load-bearing.\n`;
      }
      try {
        writeFileSync(TELEMETRY_FILE, `${outcome}\n`, { flag: 'a' });
      } catch {
        /* tmp write is best-effort */
      }
      const runbookAfter = readFileSync(COMMITTED_RUNBOOK);
      // Lock-in: CR.1 must NEVER mutate the committed runbook (Issue #5).
      expect(runbookAfter.equals(runbookBefore)).toBe(true);

      // Always assert the stored canonical_bytes path works (this IS load-bearing).
      const storedHash = Buffer.from(sha256(new Uint8Array(storedCanonicalBytes)));
      expect(storedHash.equals(storedCanonicalHash)).toBe(true);
      const storedHmacOk = await hmacVerify(
        { kms, orgId, keyId: row.key_id, keyVersion: row.key_version },
        new Uint8Array(storedCanonicalBytes),
        new Uint8Array(row.hmac),
      );
      expect(storedHmacOk).toBe(true);

      // sequence consistency
      expect(BigInt(row.sequence_number)).toBe(appendedSeq);
      expect(Buffer.from(row.hmac).equals(appendedHmac)).toBe(true);
    } finally {
      c2.release();
    }
  });
});
