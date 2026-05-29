// B2 integration tests for the AuditSealer core library.
//
// These tests run against real Postgres (Testcontainers) with the B0
// migration applied. They exercise the core library through the same
// role-switching pattern a future runner will use (admin pool with
// SET LOCAL ROLE govai_audit_sealer for claim/mark and govai_app for
// auditAppend), and prove:
//
//   - happy path: claim -> auditAppend -> mark_sealed, with audit event
//     persisted in the HMAC chain, outbox status sealed, and
//     audit_event_capture_refs populated;
//   - idle path: empty queue returns { status: 'idle' };
//   - strict ordering across two captures on the same chain;
//   - tenant guard error propagates from SQL (library does not bypass);
//   - markAuditCaptureFailed sanitizes a sentinel payload-like message
//     and stores nothing leaky in audit_capture_outbox.last_error;
//   - the library never issues BEGIN / COMMIT / ROLLBACK / SAVEPOINT or
//     any role/session-mutating SQL;
//   - transactional composability: when the caller ROLLBACKs after a
//     successful sealNextAuditCapture, nothing persists.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { startStack, stopStack, seedOrg, type Stack } from './helpers/server-fixture.js';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { captureAuditEvent } from '../../packages/core-audit/src/capture.js';
import {
  claimAuditCaptureForSeal,
  markAuditCaptureSealed,
  markAuditCaptureFailed,
  sealNextAuditCapture,
  buildAuditCaptureSealingEvent,
  type ClaimedAuditCapture,
  type AuditSealerPhase,
} from '../../packages/core-audit/src/sealer.js';

// Also use the package barrel to assert export wiring.
import * as coreAuditBarrel from '@govai/core-audit';

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Acquire an admin (superuser) pool client and execute fn inside a fresh
 * BEGIN ... COMMIT. The admin role can SET LOCAL ROLE to whichever B0/B1
 * role we need for each phase. This mirrors the asRole helper used by
 * audit-capture-outbox-foundation tests, but the test body itself owns the
 * SET LOCAL ROLE statements so we can switch between roles within ONE
 * transaction.
 */
async function withAdminTx<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await stack.db.adminPool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

async function setRole(c: PoolClient, role: string): Promise<void> {
  await c.query(`SET LOCAL ROLE ${role}`);
}

/**
 * Seed one capture via the B1 adapter (govai_app role) and return its
 * captureId for downstream sealing.
 */
async function seedCapture(
  orgId: string,
  chainId: string,
  overrides?: Partial<Parameters<typeof captureAuditEvent>[1]>,
): Promise<{ captureId: string; captureSeq: string }> {
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await setLocalAppOrgId(c, orgId);
    const r = await captureAuditEvent(c, {
      captureId: randomUUID(),
      orgId,
      chainId,
      chainCategory: 'run',
      eventType: 'passthrough.invoked',
      eventVersion: '3',
      subjectType: 'run',
      subjectId: randomUUID(),
      occurredAt: new Date(),
      payloadHash: Buffer.from('00'.repeat(32), 'hex'),
      keyId: 'audit-1',
      keyVersion: 1,
      redactionMetadata: { surface: 'provider-native' },
      ...overrides,
    });
    await c.query('COMMIT');
    return { captureId: r.captureId, captureSeq: r.captureSeq };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

/**
 * Helper to seal exactly one capture on a chain using the role-switching
 * pattern. Returns the SealNextAuditCaptureResult.
 */
async function sealOne(
  orgId: string,
  chainId: string,
  workerId?: string,
): Promise<ReturnType<typeof sealNextAuditCapture> extends Promise<infer T> ? T : never> {
  return withAdminTx(async (c) => {
    await setLocalAppOrgId(c, orgId);
    return sealNextAuditCapture(c, {
      orgId,
      chainId,
      kms: stack.app.govai.kms,
      workerId,
      withSealerPhaseRole: async (phase: AuditSealerPhase) => {
        if (phase === 'append') {
          await setRole(c, 'govai_app');
        } else {
          await setRole(c, 'govai_audit_sealer');
        }
        // Re-apply app.org_id after SET LOCAL ROLE. (`SET LOCAL` settings
        // do survive across role changes in the same transaction in
        // Postgres, but doing this defensively documents the invariant.)
        await setLocalAppOrgId(c, orgId);
      },
    });
  });
}

// =============================================================================
// 1. Happy path
// =============================================================================

describe('B2 / sealNextAuditCapture happy path', () => {
  it('claims, appends to HMAC chain, marks sealed, and populates refs', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const cap = await seedCapture(org.org_id, chainId);

    const result = await sealOne(org.org_id, chainId, 'sealer-test-1');

    expect(result.status).toBe('sealed');
    if (result.status !== 'sealed') return; // type narrow
    expect(result.claimed).toBe(true);
    expect(result.captureId).toBe(cap.captureId);
    expect(result.captureSeq).toBe('1');
    expect(typeof result.auditEventId).toBe('string');
    expect(result.auditChainId).toBe(`${org.org_id}:run`);

    // Outbox row now has status='sealed' and audit_event_id set.
    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, org.org_id);
      const row = await c.query<{
        status: string;
        audit_event_id: string | null;
        sealed_at: string | null;
      }>(
        `SELECT status, audit_event_id::text, sealed_at::text
           FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
        [cap.captureId],
      );
      expect(row.rows[0]!.status).toBe('sealed');
      expect(row.rows[0]!.audit_event_id).toBe(result.auditEventId);
      expect(row.rows[0]!.sealed_at).not.toBeNull();

      // capture_refs has the new pair.
      const refs = await c.query<{ cnt: string }>(
        `SELECT count(*)::text AS cnt FROM govai.audit_event_capture_refs
          WHERE capture_id = $1::uuid AND audit_event_id = $2::uuid`,
        [cap.captureId, result.auditEventId],
      );
      expect(refs.rows[0]!.cnt).toBe('1');

      // Audit event exists in the HMAC chain.
      const ev = await c.query<{ chain_id: string; event_type: string }>(
        `SELECT chain_id, event_type FROM govai.audit_events WHERE id = $1::uuid`,
        [result.auditEventId],
      );
      expect(ev.rows[0]!.chain_id).toBe(`${org.org_id}:run`);
      // The HMAC chain records the ORIGINAL captured event type, not
      // some "audit.capture.sealed" wrapper.
      expect(ev.rows[0]!.event_type).toBe('passthrough.invoked');

      // chain_state.last_sealed_capture_seq advanced to 1.
      const cs = await c.query<{ last_sealed: string }>(
        `SELECT last_sealed_capture_seq::text AS last_sealed
           FROM govai.audit_capture_chain_state WHERE chain_id = $1::text`,
        [chainId],
      );
      expect(cs.rows[0]!.last_sealed).toBe('1');

      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('is exported from the @govai/core-audit package barrel', () => {
    expect(typeof coreAuditBarrel.sealNextAuditCapture).toBe('function');
    expect(coreAuditBarrel.sealNextAuditCapture).toBe(sealNextAuditCapture);
    expect(coreAuditBarrel.claimAuditCaptureForSeal).toBe(claimAuditCaptureForSeal);
    expect(coreAuditBarrel.markAuditCaptureSealed).toBe(markAuditCaptureSealed);
    expect(coreAuditBarrel.markAuditCaptureFailed).toBe(markAuditCaptureFailed);
    expect(coreAuditBarrel.buildAuditCaptureSealingEvent).toBe(buildAuditCaptureSealingEvent);
  });
});

// =============================================================================
// 2. Idle path
// =============================================================================

describe('B2 / sealNextAuditCapture idle', () => {
  it('returns { status: "idle" } on an empty chain', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const result = await sealOne(org.org_id, chainId);
    expect(result.status).toBe('idle');
    expect(result.claimed).toBe(false);
    expect(result.orgId).toBe(org.org_id);
    expect(result.chainId).toBe(chainId);
  });
});

// =============================================================================
// 3. Strict ordering across two captures
// =============================================================================

describe('B2 / strict per-chain ordering', () => {
  it('seals capture_seq=1 then capture_seq=2 in order', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;

    const cap1 = await seedCapture(org.org_id, chainId);
    const cap2 = await seedCapture(org.org_id, chainId);

    const r1 = await sealOne(org.org_id, chainId);
    const r2 = await sealOne(org.org_id, chainId);

    expect(r1.status).toBe('sealed');
    expect(r2.status).toBe('sealed');
    if (r1.status !== 'sealed' || r2.status !== 'sealed') return;
    expect(r1.captureSeq).toBe('1');
    expect(r2.captureSeq).toBe('2');
    expect(r1.captureId).toBe(cap1.captureId);
    expect(r2.captureId).toBe(cap2.captureId);

    // A third call must be idle.
    const r3 = await sealOne(org.org_id, chainId);
    expect(r3.status).toBe('idle');
  });
});

// =============================================================================
// 4. Tenant guard (library does not bypass)
// =============================================================================

describe('B2 / tenant guard', () => {
  it('SQL claim rejects when app.org_id is missing in the session', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    await seedCapture(org.org_id, chainId);

    await expect(
      withAdminTx(async (c) => {
        await setRole(c, 'govai_audit_sealer');
        // Intentionally DO NOT set app.org_id.
        await claimAuditCaptureForSeal(c, { orgId: org.org_id, chainId });
      }),
    ).rejects.toThrow(/tenant mismatch/i);
  });

  it('SQL claim rejects cross-tenant session', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    const chainId = `org:${orgA.org_id}:run:${randomUUID()}`;
    await seedCapture(orgA.org_id, chainId);

    await expect(
      withAdminTx(async (c) => {
        await setRole(c, 'govai_audit_sealer');
        await setLocalAppOrgId(c, orgB.org_id);
        await claimAuditCaptureForSeal(c, { orgId: orgA.org_id, chainId });
      }),
    ).rejects.toThrow(/tenant mismatch/i);
  });
});

// =============================================================================
// 5. mark_failed sanitization
// =============================================================================

describe('B2 / markAuditCaptureFailed', () => {
  it('writes a sanitized last_error and never echoes the raw payload-like sentinel', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const cap = await seedCapture(org.org_id, chainId);

    const sentinel = 'TOP_SECRET_PROMPT_SHOULD_NOT_LEAK_' + randomUUID();
    // Build a multi-line Error with a large message that includes the sentinel
    // somewhere past the 200-char cap so we can prove truncation AND
    // line-stripping. The sanitizer keeps the visible portion as-is
    // (payload-key filtering is upstream), but the cap should slice the
    // sentinel away because the prefix is longer than 200 chars.
    const prefix = 'kms derive failed: ' + 'x'.repeat(220);
    const big = new Error(`${prefix}\nstack-line-1\n  at /etc/secret.ts:1:1\n${sentinel}`);

    await withAdminTx(async (c) => {
      await setRole(c, 'govai_audit_sealer');
      await setLocalAppOrgId(c, org.org_id);
      await markAuditCaptureFailed(c, {
        orgId: org.org_id,
        captureId: cap.captureId,
        error: big,
      });
    });

    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, org.org_id);
      const row = await c.query<{ status: string; last_error: string | null }>(
        `SELECT status, last_error FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
        [cap.captureId],
      );
      expect(row.rows[0]!.status).toBe('failed');
      const stored = row.rows[0]!.last_error ?? '';
      // The DB CHECK enforces <= 200 chars on last_error.
      expect(stored.length).toBeLessThanOrEqual(200);
      // The sentinel sits past the 200-char cap, so it must be sliced off.
      expect(stored).not.toContain(sentinel);
      // And: no newlines / no stack lines.
      expect(stored).not.toMatch(/[\r\n\t\v\f]/);
      expect(stored).not.toContain('/etc/secret.ts');
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });
});

// =============================================================================
// 6. Transactional composability + no SQL side effects from the library
// =============================================================================

describe('B2 / transactional composability and no role/session side effects', () => {
  it('rollback of the outer transaction undoes the seal entirely', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const cap = await seedCapture(org.org_id, chainId);

    // Run the whole seal in a transaction, then ROLLBACK before it commits.
    let sealedAuditEventId: string | undefined;
    const c = await stack.db.adminPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, org.org_id);
      const r = await sealNextAuditCapture(c, {
        orgId: org.org_id,
        chainId,
        kms: stack.app.govai.kms,
        withSealerPhaseRole: async (phase) => {
          if (phase === 'append') await setRole(c, 'govai_app');
          else await setRole(c, 'govai_audit_sealer');
          await setLocalAppOrgId(c, org.org_id);
        },
      });
      expect(r.status).toBe('sealed');
      if (r.status === 'sealed') sealedAuditEventId = r.auditEventId;
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }

    // New session: confirm nothing persisted.
    const fresh = await stack.db.appPool.connect();
    try {
      await fresh.query('BEGIN');
      await setLocalAppOrgId(fresh, org.org_id);
      const outbox = await fresh.query<{ status: string }>(
        `SELECT status FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
        [cap.captureId],
      );
      expect(outbox.rows[0]!.status).toBe('captured'); // not sealed
      const refs = await fresh.query<{ cnt: string }>(
        `SELECT count(*)::text AS cnt FROM govai.audit_event_capture_refs WHERE capture_id = $1::uuid`,
        [cap.captureId],
      );
      expect(refs.rows[0]!.cnt).toBe('0');
      if (sealedAuditEventId !== undefined) {
        const ev = await fresh.query<{ cnt: string }>(
          `SELECT count(*)::text AS cnt FROM govai.audit_events WHERE id = $1::uuid`,
          [sealedAuditEventId],
        );
        expect(ev.rows[0]!.cnt).toBe('0');
      }
      await fresh.query('COMMIT');
    } finally {
      fresh.release();
    }
  });

  it('the library never executes BEGIN / COMMIT / ROLLBACK / SAVEPOINT / SET ROLE / set_config', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    await seedCapture(org.org_id, chainId);

    const c = await stack.db.adminPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, org.org_id);

      // Wrap c.query for the duration of sealNextAuditCapture so we can
      // see exactly which statements the LIBRARY emits. The wrapping
      // function records the SQL and forwards to the real client.
      const seenSql: string[] = [];
      const origQuery = c.query.bind(c) as PoolClient['query'];

      (c as { query: PoolClient['query'] }).query = ((...args: unknown[]) => {
        const sql = typeof args[0] === 'string' ? (args[0] as string) : '';
        seenSql.push(sql);
        return (origQuery as (...a: unknown[]) => unknown)(...args);
      }) as PoolClient['query'];

      try {
        // The withSealerPhaseRole callback runs in the TEST's caller space
        // and uses the ORIGINAL client method explicitly, so its SET LOCAL
        // ROLE / set_config statements do NOT count against the library.
        await sealNextAuditCapture(c, {
          orgId: org.org_id,
          chainId,
          kms: stack.app.govai.kms,
          withSealerPhaseRole: async (phase) => {
            // bypass the spy: use origQuery directly
            if (phase === 'append') {
              await origQuery('SET LOCAL ROLE govai_app');
            } else {
              await origQuery('SET LOCAL ROLE govai_audit_sealer');
            }
            await origQuery("SELECT set_config('app.org_id', $1, true)", [org.org_id]);
          },
        });
      } finally {
        (c as { query: PoolClient['query'] }).query = origQuery;
      }

      const forbiddenRe =
        /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT\b|RELEASE\s+SAVEPOINT|SET\s+(?:LOCAL\s+)?ROLE|RESET\s+ROLE|set_config\s*\()/i;
      const forbidden = seenSql.filter((s) => forbiddenRe.test(s));
      expect(forbidden).toEqual([]);

      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});

// =============================================================================
// 7. Claimed shape doctrine — no raw payload bytes returned to TypeScript
// =============================================================================

describe('B2 / claimAuditCaptureForSeal shape doctrine', () => {
  it('returns presence flags instead of raw payload_encrypted / dek_wrapped bytes', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    // Seed with explicit encrypted payload + dek_wrapped (small synthetic bytes).
    await seedCapture(org.org_id, chainId, {
      payloadEncrypted: Buffer.from('AA'.repeat(8), 'hex'),
      dekWrapped: Buffer.from('BB'.repeat(8), 'hex'),
    });

    let claimed: ClaimedAuditCapture | null = null;
    await withAdminTx(async (c) => {
      await setRole(c, 'govai_audit_sealer');
      await setLocalAppOrgId(c, org.org_id);
      claimed = await claimAuditCaptureForSeal(c, { orgId: org.org_id, chainId });
    });
    expect(claimed).not.toBeNull();
    const c = claimed as unknown as ClaimedAuditCapture;
    expect(c.hasPayloadEncrypted).toBe(true);
    expect(c.hasDekWrapped).toBe(true);
    // Payload-hash IS hex-safe (it's the digest, not the payload).
    expect(c.payloadHashHex).toMatch(/^[0-9a-f]{64}$/);
    // No raw payload bytes are reachable through the returned object.
    const dump = JSON.stringify(c);
    expect(dump).not.toContain('AAAAAAAAAAAAAAAA'); // hex prefix of the encrypted bytes, just in case
    expect(dump).not.toContain('payload_encrypted');
    expect(dump).not.toContain('dek_wrapped');

    // Rolls back the sealing-state transition so the next test starts fresh.
    // (claim sets status='sealing'; the implicit transaction COMMIT in
    // withAdminTx persisted that. We do NOT need to undo it for the rest
    // of the suite because each test seeds its own chain.)
  });
});
