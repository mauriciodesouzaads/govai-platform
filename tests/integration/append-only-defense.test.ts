// Defesa append-only em 5 caminhos:
// 1) govai_app INSERT direto → permission denied (sem privilege INSERT).
// 2) govai_app chama audit_append_locked com p_org_id ≠ session → tenant mismatch.
// 3) Tentativa de UPDATE/DELETE em audit_events → trigger raise.
// 4) TRUNCATE em audit_events → trigger raise.
// 5) DELETE em audit_event_payloads → trigger raise.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPostgres, stopPostgres, freshSeedHex, type TestDb } from './setup.js';
import { auditAppend, sha256 } from '@govai/core-audit';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { DevKms } from '@govai/core-identity';
import { chainIdFor } from '@govai/core-events';

let db: TestDb;
const kms = new DevKms(freshSeedHex());

beforeAll(async () => {
  db = await startPostgres();
}, 240_000);

afterAll(async () => {
  if (db) await stopPostgres(db);
});

describe('append-only defense-in-depth', () => {
  it('govai_app cannot INSERT directly into audit_events', async () => {
    const orgId = randomUUID();
    const c = await db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, orgId);
      await expect(
        c.query(
          `INSERT INTO govai.audit_events (
              id, org_id, chain_id, sequence_number, event_type, event_version,
              subject_type, subject_id, occurred_at, payload_hash, hmac, canonical_hash, canonical_bytes, key_id, key_version
            ) VALUES (
              $1::uuid, $2::uuid, 'x', 1, 't', '1', 's', $3::uuid, now(),
              $4::bytea, $4::bytea, $4::bytea, $4::bytea, 'k', 1
            )`,
          [randomUUID(), orgId, randomUUID(), Buffer.from([0])],
        ),
      ).rejects.toThrow(/permission denied|insufficient_privilege/i);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('audit_append_locked rejects p_org_id != session', async () => {
    const orgSession = randomUUID();
    const orgInput = randomUUID();
    const c = await db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, orgSession);
      await expect(
        auditAppend(c, kms, {
          orgId: orgInput, // mismatch
          chainId: chainIdFor(orgInput, 'run'),
          eventType: 't',
          eventVersion: '1',
          subjectType: 's',
          subjectId: randomUUID(),
          occurredAt: new Date(),
          payloadHash: sha256(Buffer.from('x')),
          keyId: 'k',
          keyVersion: 1,
          redactionMetadata: {},
        }),
      ).rejects.toThrow(/tenant context mismatch|insufficient_privilege/);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('UPDATE/DELETE on audit_events affects 0 rows under writer (RLS denies silently)', async () => {
    // Defense layer: govai_audit_writer has SELECT and INSERT policies but NO
    // UPDATE/DELETE policies. Under FORCE ROW LEVEL SECURITY this means UPDATE/DELETE
    // sees zero matching rows. The trigger is a defense for any future scenario where
    // an UPDATE policy is added.
    const orgId = randomUUID();
    const id = randomUUID();

    // Step 1: insert as writer in its own transaction.
    {
      const c = await db.adminPool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE govai_audit_writer');
        await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
        await c.query(
          `INSERT INTO govai.audit_events (
              id, org_id, chain_id, sequence_number, event_type, event_version,
              subject_type, subject_id, occurred_at, payload_hash, hmac, canonical_hash, canonical_bytes, key_id, key_version
            ) VALUES (
              $1::uuid, $2::uuid, 'x', 1, 't', '1', 's', $3::uuid, now(),
              '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'k', 1
            )`,
          [id, orgId, randomUUID()],
        );
        await c.query('COMMIT');
      } finally {
        c.release();
      }
    }

    // Step 2: try UPDATE — should affect 0 rows (RLS blocks).
    {
      const c = await db.adminPool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE govai_audit_writer');
        await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
        const r = await c.query(
          `UPDATE govai.audit_events SET event_type = 'mut' WHERE id = $1`,
          [id],
        );
        // Either RLS silently filters (rowCount 0) or trigger raises — both are acceptable defense.
        expect(r.rowCount).toBe(0);
        await c.query('ROLLBACK');
      } finally {
        c.release();
      }
    }

    // Step 3: try DELETE — same expectation.
    {
      const c = await db.adminPool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE govai_audit_writer');
        await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
        const r = await c.query(`DELETE FROM govai.audit_events WHERE id = $1`, [id]);
        expect(r.rowCount).toBe(0);
        await c.query('ROLLBACK');
      } finally {
        c.release();
      }
    }
  });

  it('TRUNCATE on audit_events is blocked (trigger or FK)', async () => {
    const c = await db.adminPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE govai_audit_writer');
      await expect(c.query(`TRUNCATE govai.audit_events`)).rejects.toThrow(
        /append-only|cannot truncate/i,
      );
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('DELETE on audit_event_payloads is denied (no DELETE policy → RLS blocks)', async () => {
    const orgId = randomUUID();
    const payloadId = randomUUID();
    {
      const c = await db.adminPool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE govai_audit_writer');
        await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
        await c.query(
          `INSERT INTO govai.audit_event_payloads (id, org_id, encrypted_payload, dek_wrapped, key_id, key_version)
             VALUES ($1::uuid, $2::uuid, '\\xaa'::bytea, '\\xbb'::bytea, 'k', 1)`,
          [payloadId, orgId],
        );
        await c.query('COMMIT');
      } finally {
        c.release();
      }
    }

    const c = await db.adminPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE govai_audit_writer');
      await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
      const r = await c.query(`DELETE FROM govai.audit_event_payloads WHERE id = $1`, [payloadId]);
      // No DELETE policy under FORCE RLS → silent zero rows. Trigger is the third
      // line of defense for any future scenario where a DELETE policy is added.
      expect(r.rowCount).toBe(0);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('Trigger raises if DELETE policy ever exists (verified by superuser bypass)', async () => {
    // Insert via writer.
    const orgId = randomUUID();
    const payloadId = randomUUID();
    const c = await db.adminPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE govai_audit_writer');
      await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
      await c.query(
        `INSERT INTO govai.audit_event_payloads (id, org_id, encrypted_payload, dek_wrapped, key_id, key_version)
             VALUES ($1::uuid, $2::uuid, '\\xaa'::bytea, '\\xbb'::bytea, 'k', 1)`,
        [payloadId, orgId],
      );
      // RESET ROLE to fall back to superuser (postgres bootstrap user) which is the table owner's grantor.
      // Postgres superuser bypasses RLS by default for tables they own (audit tables are owned by
      // govai_audit_writer though, so superuser still has BYPASSRLS).
      await c.query('RESET ROLE');
      await expect(
        c.query(`DELETE FROM govai.audit_event_payloads WHERE id = $1`, [payloadId]),
      ).rejects.toThrow(/append-only/i);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
