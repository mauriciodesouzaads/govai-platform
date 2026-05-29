// B0 — Audit Capture Outbox Foundation (migration 0025).
//
// Adversarial proofs for the SQL substrate of the Evidence Plane:
//   - outbox content is immutable after capture;
//   - sealing order is strict per chain;
//   - status state machine is enforced;
//   - capture_id INSERT is idempotent under per-chain advisory lock;
//   - mark_sealed is idempotent on the same audit_event_id and rejects a
//     different audit_event_id for an already-sealed capture;
//   - RLS isolates outbox/chain_state/refs per org;
//   - govai_app cannot seal/claim/mark-failed nor mutate state directly;
//   - PUBLIC cannot execute any B0 function;
//   - govai_audit_sealer has the minimum surface to claim/seal/fail;
//   - mark_failed truncates last_error to <= 200 chars and never carries
//     raw secrets;
//   - redaction_metadata top-level guard blocks prompt/response/raw_input/
//     raw_output (B0 documents that nested-JSON inspection is deferred to
//     AuditBridge in B1/B2).
//
// This test file relies ONLY on the SQL substrate. It does NOT exercise the
// HMAC chain (govai.audit_events) — the audit_event_id placeholders used in
// mark_sealed are synthetic UUIDs because B0 keeps audit_event_capture_refs
// FK-less by design (see migration 0025 §C / COMMENT ON COLUMN).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { startStack, stopStack, seedOrg, type Stack } from './helpers/server-fixture.js';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { chainLockKey } from '@govai/core-audit';

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

type CaptureRow = {
  capture_id: string;
  capture_seq: string;
};

type InsertOverrides = {
  capture_id?: string;
  chain_id?: string;
  chain_category?: string;
  // Override the per-chain advisory lock key sent to the function. The default
  // is chainLockKey(chainId).toString(). The wrong-lock-key adversarial suite
  // passes an unrelated value here on purpose to prove that correctness does
  // NOT depend on the caller's hint.
  chain_lock_key?: string;
  event_type?: string;
  event_version?: string;
  subject_type?: string;
  subject_id?: string;
  occurred_at?: string;
  payload_hash?: Buffer;
  payload_encrypted?: Buffer | null;
  dek_wrapped?: Buffer | null;
  key_id?: string;
  key_version?: number;
  redaction_metadata?: Record<string, unknown>;
  evidence_strength?: string;
  capture_integrity_tag?: Buffer | null;
  capture_integrity_alg?: string | null;
  posture?: string;
};

// Wrap one (orgId, chain_id) capture under the app role with tenant context.
async function callInsertLockedAsApp(
  orgId: string,
  chainId: string,
  overrides: InsertOverrides = {},
): Promise<CaptureRow> {
  const c = await stack.db.adminPool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE govai_app');
    await setLocalAppOrgId(c, orgId);
    const captureId = overrides.capture_id ?? randomUUID();
    const r = await c.query<CaptureRow>(
      `SELECT capture_id::text, capture_seq::text
         FROM govai.audit_capture_insert_locked(
           $1::uuid, $2::uuid, $3::text, $4::text, $5::bigint,
           $6::text, $7::text, $8::text, $9::uuid, $10::timestamptz,
           $11::bytea, $12::bytea, $13::bytea, $14::text, $15::integer,
           $16::jsonb, $17::text, $18::bytea, $19::text, $20::text
         )`,
      [
        captureId,
        orgId,
        chainId,
        overrides.chain_category ?? 'run',
        overrides.chain_lock_key ?? chainLockKey(chainId).toString(),
        overrides.event_type ?? 'passthrough.invoked',
        overrides.event_version ?? '3',
        overrides.subject_type ?? 'run',
        overrides.subject_id ?? randomUUID(),
        overrides.occurred_at ?? new Date().toISOString(),
        overrides.payload_hash ?? Buffer.from('00'.repeat(32), 'hex'),
        overrides.payload_encrypted === undefined ? null : overrides.payload_encrypted,
        overrides.dek_wrapped === undefined ? null : overrides.dek_wrapped,
        overrides.key_id ?? 'audit-1',
        overrides.key_version ?? 1,
        JSON.stringify(overrides.redaction_metadata ?? {}),
        overrides.evidence_strength ?? 'hmac_internal',
        overrides.capture_integrity_tag === undefined
          ? null
          : overrides.capture_integrity_tag,
        overrides.capture_integrity_alg === undefined
          ? null
          : overrides.capture_integrity_alg,
        overrides.posture ?? 'best_effort',
      ],
    );
    await c.query('COMMIT');
    return r.rows[0]!;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

async function asRole<T>(
  role: 'govai_app' | 'govai_audit_sealer' | 'govai_audit_writer',
  orgId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await stack.db.adminPool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${role}`);
    await setLocalAppOrgId(c, orgId);
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

// =============================================================================
// 1. Outbox immutability + happy capture
// =============================================================================

describe('B0 / outbox basic capture + immutability', () => {
  it('inserts a capture and assigns capture_seq=1 on a fresh chain', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);
    expect(Number(row.capture_seq)).toBe(1);
  });

  it('blocks direct UPDATE of event_type / payload_hash / capture_seq via writer', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);

    await expect(
      asRole('govai_audit_writer', org.org_id, async (c) => {
        await c.query(
          `UPDATE govai.audit_capture_outbox SET event_type = 'tampered' WHERE capture_id = $1::uuid`,
          [row.capture_id],
        );
      }),
    ).rejects.toThrow(/immutable field changed/i);

    await expect(
      asRole('govai_audit_writer', org.org_id, async (c) => {
        await c.query(
          `UPDATE govai.audit_capture_outbox SET payload_hash = $2::bytea WHERE capture_id = $1::uuid`,
          [row.capture_id, Buffer.from('ff'.repeat(32), 'hex')],
        );
      }),
    ).rejects.toThrow(/immutable field changed/i);

    await expect(
      asRole('govai_audit_writer', org.org_id, async (c) => {
        await c.query(
          `UPDATE govai.audit_capture_outbox SET capture_seq = capture_seq + 100 WHERE capture_id = $1::uuid`,
          [row.capture_id],
        );
      }),
    ).rejects.toThrow(/immutable field changed/i);
  });

  it('DELETE on audit_capture_outbox is blocked by absence of any DELETE policy (row survives)', async () => {
    // Defense in depth: there is no DELETE policy in 0025 for any role, so
    // FORCE RLS filters every row out of a DELETE statement before the
    // BEFORE-DELETE trigger can fire. The row therefore survives. The
    // BEFORE-DELETE trigger is the SECOND layer if any future migration
    // ever introduces a DELETE policy — covered separately by the TRUNCATE
    // test below, which bypasses RLS at the statement level.
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);

    await asRole('govai_audit_writer', org.org_id, async (c) => {
      const r = await c.query(
        `DELETE FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
        [row.capture_id],
      );
      // No DELETE policy → RLS filters the row → 0 affected; no error.
      expect(r.rowCount).toBe(0);
    });

    const after = await asRole('govai_app', org.org_id, async (c) => {
      const r = await c.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
        [row.capture_id],
      );
      return r.rows[0]!.c;
    });
    expect(after).toBe('1');
  });

  it('TRUNCATE on audit_capture_outbox is blocked by trigger', async () => {
    // TRUNCATE is a table-level statement that bypasses RLS, so the
    // BEFORE-TRUNCATE trigger fires unconditionally and the statement
    // raises insufficient_privilege.
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    await callInsertLockedAsApp(org.org_id, chainId);

    await expect(
      asRole('govai_audit_writer', org.org_id, async (c) => {
        await c.query(`TRUNCATE govai.audit_capture_outbox`);
      }),
    ).rejects.toThrow(/TRUNCATE blocked/i);
  });
});

// =============================================================================
// 2. Status state machine
// =============================================================================

describe('B0 / status state machine', () => {
  async function fetchStatus(orgId: string, captureId: string): Promise<string> {
    return asRole('govai_app', orgId, async (c) => {
      const r = await c.query<{ status: string }>(
        `SELECT status FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
        [captureId],
      );
      return r.rows[0]!.status;
    });
  }

  it('captured -> sealing -> sealed via claim+mark_sealed', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);
    expect(await fetchStatus(org.org_id, row.capture_id)).toBe('captured');

    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      const claim = await c.query(
        `SELECT capture_id::text FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
        [org.org_id, chainId, chainLockKey(chainId).toString()],
      );
      expect(claim.rows[0]?.capture_id).toBe(row.capture_id);
    });
    expect(await fetchStatus(org.org_id, row.capture_id)).toBe('sealing');

    const auditEventId = randomUUID();
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
        [org.org_id, row.capture_id, auditEventId, chainLockKey(chainId).toString()],
      );
    });
    expect(await fetchStatus(org.org_id, row.capture_id)).toBe('sealed');
  });

  it('captured -> failed via mark_failed', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT govai.audit_capture_mark_failed($1::uuid, $2::uuid, $3::text, $4::text)`,
        [org.org_id, row.capture_id, 'network_error', 'upstream timeout'],
      );
    });
    expect(await fetchStatus(org.org_id, row.capture_id)).toBe('failed');
  });

  it('sealing -> failed via mark_failed', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
        [org.org_id, chainId, chainLockKey(chainId).toString()],
      );
      await c.query(
        `SELECT govai.audit_capture_mark_failed($1::uuid, $2::uuid, $3::text, $4::text)`,
        [org.org_id, row.capture_id, 'kms_error', 'derive failed'],
      );
    });
    expect(await fetchStatus(org.org_id, row.capture_id)).toBe('failed');
  });

  it('rejects sealed -> captured / sealed -> failed / failed -> captured', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
        [org.org_id, chainId, chainLockKey(chainId).toString()],
      );
      await c.query(
        `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
        [org.org_id, row.capture_id, randomUUID(), chainLockKey(chainId).toString()],
      );
    });

    // sealed -> captured
    await expect(
      asRole('govai_audit_writer', org.org_id, async (c) => {
        await c.query(
          `UPDATE govai.audit_capture_outbox SET status = 'captured' WHERE capture_id = $1::uuid`,
          [row.capture_id],
        );
      }),
    ).rejects.toThrow(/invalid status transition/i);

    // sealed -> failed
    await expect(
      asRole('govai_audit_writer', org.org_id, async (c) => {
        await c.query(
          `UPDATE govai.audit_capture_outbox SET status = 'failed', failed_at = now() WHERE capture_id = $1::uuid`,
          [row.capture_id],
        );
      }),
    ).rejects.toThrow(/invalid status transition/i);

    // separately produce a failed capture
    const chainIdB = `org:${org.org_id}:run:${randomUUID()}`;
    const rowB = await callInsertLockedAsApp(org.org_id, chainIdB);
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT govai.audit_capture_mark_failed($1::uuid, $2::uuid, $3::text, $4::text)`,
        [org.org_id, rowB.capture_id, 'x', 'y'],
      );
    });

    // failed -> captured (terminal in B0)
    await expect(
      asRole('govai_audit_writer', org.org_id, async (c) => {
        await c.query(
          `UPDATE govai.audit_capture_outbox SET status = 'captured', failed_at = NULL WHERE capture_id = $1::uuid`,
          [rowB.capture_id],
        );
      }),
    ).rejects.toThrow(/invalid status transition|immutable/i);
  });
});

// =============================================================================
// 3. Strict per-chain order
// =============================================================================

describe('B0 / strict per-chain order', () => {
  it('last_sealed_capture_seq advances exactly +1 across two seals', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const r1 = await callInsertLockedAsApp(org.org_id, chainId);
    const r2 = await callInsertLockedAsApp(org.org_id, chainId);
    expect(Number(r1.capture_seq)).toBe(1);
    expect(Number(r2.capture_seq)).toBe(2);

    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
        [org.org_id, chainId, chainLockKey(chainId).toString()],
      );
      await c.query(
        `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
        [org.org_id, r1.capture_id, randomUUID(), chainLockKey(chainId).toString()],
      );
      await c.query(
        `SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
        [org.org_id, chainId, chainLockKey(chainId).toString()],
      );
      await c.query(
        `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
        [org.org_id, r2.capture_id, randomUUID(), chainLockKey(chainId).toString()],
      );
    });

    const state = await asRole('govai_app', org.org_id, async (c) => {
      const r = await c.query<{ last_sealed_capture_seq: string }>(
        `SELECT last_sealed_capture_seq::text FROM govai.audit_capture_chain_state WHERE chain_id = $1::text`,
        [chainId],
      );
      return r.rows[0]!;
    });
    expect(Number(state.last_sealed_capture_seq)).toBe(2);
  });

  it('rejects mark_sealed when capture_seq is NOT last_sealed + 1', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const r1 = await callInsertLockedAsApp(org.org_id, chainId);
    const r2 = await callInsertLockedAsApp(org.org_id, chainId);

    // Claim seq=2 manually (bypassing claim_for_seal) by writer to test the
    // mark_sealed guard. Use writer-direct UPDATE through allowed transition
    // captured -> sealing for r2 ONLY.
    await asRole('govai_audit_writer', org.org_id, async (c) => {
      await c.query(
        `UPDATE govai.audit_capture_outbox
            SET status = 'sealing', sealing_started_at = now()
          WHERE capture_id = $1::uuid AND status = 'captured'`,
        [r2.capture_id],
      );
    });

    // Try to seal r2 before r1 — should fail with sequence mismatch.
    await expect(
      asRole('govai_audit_sealer', org.org_id, async (c) => {
        await c.query(
          `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
          [org.org_id, r2.capture_id, randomUUID(), chainLockKey(chainId).toString()],
        );
      }),
    ).rejects.toThrow(/sequence mismatch/i);

    // Suppress unused warning for r1
    expect(r1.capture_id).toBeTruthy();
  });

  it('chain_state cannot advance last_sealed_capture_seq by +2 directly', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    await callInsertLockedAsApp(org.org_id, chainId);
    await callInsertLockedAsApp(org.org_id, chainId);

    await expect(
      asRole('govai_audit_writer', org.org_id, async (c) => {
        await c.query(
          `UPDATE govai.audit_capture_chain_state
              SET last_sealed_capture_seq = last_sealed_capture_seq + 2
            WHERE chain_id = $1::text`,
          [chainId],
        );
      }),
    ).rejects.toThrow(/must advance exactly \+1/i);
  });

  it('chain_state cannot decrease last_captured_seq', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    await callInsertLockedAsApp(org.org_id, chainId);
    await callInsertLockedAsApp(org.org_id, chainId);

    await expect(
      asRole('govai_audit_writer', org.org_id, async (c) => {
        await c.query(
          `UPDATE govai.audit_capture_chain_state
              SET last_captured_seq = last_captured_seq - 1
            WHERE chain_id = $1::text`,
          [chainId],
        );
      }),
    ).rejects.toThrow(/cannot decrease/i);
  });
});

// =============================================================================
// 4. capture_id idempotency
// =============================================================================

describe('B0 / capture_id idempotency', () => {
  it('same capture_id + same immutable content returns same capture_seq', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const captureId = randomUUID();
    const subjectId = randomUUID();
    const occurredAt = new Date().toISOString();
    const payloadHash = Buffer.from('11'.repeat(32), 'hex');

    const r1 = await callInsertLockedAsApp(org.org_id, chainId, {
      capture_id: captureId,
      subject_id: subjectId,
      occurred_at: occurredAt,
      payload_hash: payloadHash,
    });
    const r2 = await callInsertLockedAsApp(org.org_id, chainId, {
      capture_id: captureId,
      subject_id: subjectId,
      occurred_at: occurredAt,
      payload_hash: payloadHash,
    });

    expect(r2.capture_id).toBe(r1.capture_id);
    expect(r2.capture_seq).toBe(r1.capture_seq);

    // No orphan: chain_state.last_captured_seq stays at 1.
    const state = await asRole('govai_app', org.org_id, async (c) => {
      const r = await c.query<{ last_captured_seq: string }>(
        `SELECT last_captured_seq::text FROM govai.audit_capture_chain_state WHERE chain_id = $1::text`,
        [chainId],
      );
      return r.rows[0]!;
    });
    expect(Number(state.last_captured_seq)).toBe(1);
  });

  it('same capture_id + divergent immutable content fails', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const captureId = randomUUID();
    await callInsertLockedAsApp(org.org_id, chainId, {
      capture_id: captureId,
      event_type: 'first',
    });
    await expect(
      callInsertLockedAsApp(org.org_id, chainId, {
        capture_id: captureId,
        event_type: 'second-divergent',
      }),
    ).rejects.toThrow(/divergent immutable content/i);
  });

  it('idempotent return ignores mutable fields (status / attempts / timestamps)', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const captureId = randomUUID();
    const subjectId = randomUUID();
    const occurredAt = new Date().toISOString();
    const r1 = await callInsertLockedAsApp(org.org_id, chainId, {
      capture_id: captureId,
      subject_id: subjectId,
      occurred_at: occurredAt,
    });

    // Move to sealing via writer (simulating partial progress).
    await asRole('govai_audit_writer', org.org_id, async (c) => {
      await c.query(
        `UPDATE govai.audit_capture_outbox
            SET status = 'sealing', sealing_started_at = now()
          WHERE capture_id = $1::uuid`,
        [captureId],
      );
    });

    // Re-call insert_locked with same immutables — must succeed idempotently
    // regardless of the current status / attempts / sealing_started_at.
    const r2 = await callInsertLockedAsApp(org.org_id, chainId, {
      capture_id: captureId,
      subject_id: subjectId,
      occurred_at: occurredAt,
    });
    expect(r2.capture_seq).toBe(r1.capture_seq);
  });

  it('concurrent calls with same capture_id produce exactly one row + no orphan', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const captureId = randomUUID();
    const subjectId = randomUUID();
    const occurredAt = new Date().toISOString();

    const overrides: InsertOverrides = {
      capture_id: captureId,
      subject_id: subjectId,
      occurred_at: occurredAt,
    };

    const [a, b, c] = await Promise.all([
      callInsertLockedAsApp(org.org_id, chainId, overrides),
      callInsertLockedAsApp(org.org_id, chainId, overrides),
      callInsertLockedAsApp(org.org_id, chainId, overrides),
    ]);
    expect(a.capture_id).toBe(b.capture_id);
    expect(b.capture_id).toBe(c.capture_id);
    expect(a.capture_seq).toBe(b.capture_seq);
    expect(b.capture_seq).toBe(c.capture_seq);

    const state = await asRole('govai_app', org.org_id, async (cl) => {
      const r = await cl.query<{ last_captured_seq: string; count: string }>(
        `SELECT cs.last_captured_seq::text,
                (SELECT count(*)::text FROM govai.audit_capture_outbox o WHERE o.chain_id = $1::text) AS count
           FROM govai.audit_capture_chain_state cs
          WHERE cs.chain_id = $1::text`,
        [chainId],
      );
      return r.rows[0]!;
    });
    expect(Number(state.last_captured_seq)).toBe(1);
    expect(Number(state.count)).toBe(1);
  });
});

// =============================================================================
// 5. mark_sealed idempotency
// =============================================================================

describe('B0 / mark_sealed idempotency', () => {
  it('repeated mark_sealed with same audit_event_id is a no-op', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);
    const auditEventId = randomUUID();
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
        [org.org_id, chainId, chainLockKey(chainId).toString()],
      );
      await c.query(
        `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
        [org.org_id, row.capture_id, auditEventId, chainLockKey(chainId).toString()],
      );
      // Second call with the same audit_event_id — no-op success.
      await c.query(
        `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
        [org.org_id, row.capture_id, auditEventId, chainLockKey(chainId).toString()],
      );
    });
  });

  it('repeated mark_sealed with a DIFFERENT audit_event_id fails', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
        [org.org_id, chainId, chainLockKey(chainId).toString()],
      );
      await c.query(
        `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
        [org.org_id, row.capture_id, randomUUID(), chainLockKey(chainId).toString()],
      );
    });

    await expect(
      asRole('govai_audit_sealer', org.org_id, async (c) => {
        await c.query(
          `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
          [org.org_id, row.capture_id, randomUUID(), chainLockKey(chainId).toString()],
        );
      }),
    ).rejects.toThrow(/already sealed with different audit_event_id/i);
  });
});

// =============================================================================
// 6. RLS tenant isolation
// =============================================================================

describe('B0 / RLS tenant isolation', () => {
  it('orgA cannot see orgB outbox / chain_state / refs', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    const chainA = `org:${orgA.org_id}:run:${randomUUID()}`;
    await callInsertLockedAsApp(orgA.org_id, chainA);

    const seenAsB = await asRole('govai_app', orgB.org_id, async (c) => {
      const o = await c.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM govai.audit_capture_outbox WHERE chain_id = $1::text`,
        [chainA],
      );
      const cs = await c.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM govai.audit_capture_chain_state WHERE chain_id = $1::text`,
        [chainA],
      );
      return { outbox: o.rows[0]!.c, chain_state: cs.rows[0]!.c };
    });
    expect(seenAsB.outbox).toBe('0');
    expect(seenAsB.chain_state).toBe('0');
  });

  it('cross-tenant insert_locked is rejected', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    const chainId = `org:${orgB.org_id}:run:${randomUUID()}`;
    // Use orgB context but pass orgA as p_org_id — should fail tenant check.
    const c = await stack.db.adminPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE govai_app');
      await setLocalAppOrgId(c, orgB.org_id);
      await expect(
        c.query(
          `SELECT * FROM govai.audit_capture_insert_locked(
             $1::uuid, $2::uuid, $3::text, 'run', $4::bigint,
             'x', '1', 'run', $5::uuid, now(),
             $6::bytea, NULL::bytea, NULL::bytea, 'audit-1', 1,
             '{}'::jsonb, 'hmac_internal', NULL::bytea, NULL::text, 'best_effort'
           )`,
          [
            randomUUID(),
            orgA.org_id,
            chainId,
            chainLockKey(chainId).toString(),
            randomUUID(),
            Buffer.from('00'.repeat(32), 'hex'),
          ],
        ),
      ).rejects.toThrow(/tenant mismatch/i);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('cross-tenant mark_sealed is rejected', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    const chainA = `org:${orgA.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(orgA.org_id, chainA);

    // Move to sealing via writer.
    await asRole('govai_audit_writer', orgA.org_id, async (c) => {
      await c.query(
        `UPDATE govai.audit_capture_outbox
            SET status = 'sealing', sealing_started_at = now()
          WHERE capture_id = $1::uuid`,
        [row.capture_id],
      );
    });

    // orgB tries to mark the orgA capture as sealed — must be rejected.
    await expect(
      asRole('govai_audit_sealer', orgB.org_id, async (c) => {
        await c.query(
          `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
          [orgB.org_id, row.capture_id, randomUUID(), chainLockKey(chainA).toString()],
        );
      }),
    ).rejects.toThrow(/tenant mismatch|not found/i);
  });
});

// =============================================================================
// 7. govai_app cannot seal
// =============================================================================

describe('B0 / govai_app cannot seal', () => {
  it('govai_app cannot execute claim_for_seal', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    await callInsertLockedAsApp(org.org_id, chainId);

    await expect(
      asRole('govai_app', org.org_id, async (c) => {
        await c.query(
          `SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
          [org.org_id, chainId, chainLockKey(chainId).toString()],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('govai_app cannot execute mark_sealed', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);
    await expect(
      asRole('govai_app', org.org_id, async (c) => {
        await c.query(
          `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
          [org.org_id, row.capture_id, randomUUID(), chainLockKey(chainId).toString()],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('govai_app cannot execute mark_failed', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);
    await expect(
      asRole('govai_app', org.org_id, async (c) => {
        await c.query(
          `SELECT govai.audit_capture_mark_failed($1::uuid, $2::uuid, $3::text, $4::text)`,
          [org.org_id, row.capture_id, 'x', 'y'],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('govai_app cannot UPDATE outbox / chain_state / refs directly', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);

    await expect(
      asRole('govai_app', org.org_id, async (c) => {
        await c.query(
          `UPDATE govai.audit_capture_outbox SET status = 'sealed', sealed_at = now(), audit_event_id = $2::uuid WHERE capture_id = $1::uuid`,
          [row.capture_id, randomUUID()],
        );
      }),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asRole('govai_app', org.org_id, async (c) => {
        await c.query(
          `UPDATE govai.audit_capture_chain_state SET last_sealed_capture_seq = last_sealed_capture_seq + 1 WHERE chain_id = $1::text`,
          [chainId],
        );
      }),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asRole('govai_app', org.org_id, async (c) => {
        await c.query(
          `INSERT INTO govai.audit_event_capture_refs (org_id, capture_id, audit_event_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`,
          [org.org_id, row.capture_id, randomUUID()],
        );
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

// =============================================================================
// 8. PUBLIC cannot execute B0 functions
// =============================================================================

describe('B0 / PUBLIC cannot execute B0 functions', () => {
  const TEMP_ROLE = 'govai_test_b0_public_probe';

  beforeAll(async () => {
    const c = await stack.db.adminPool.connect();
    try {
      await c.query(`DO $$ BEGIN CREATE ROLE ${TEMP_ROLE} NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    const c = await stack.db.adminPool.connect();
    try {
      await c.query(`DROP ROLE IF EXISTS ${TEMP_ROLE}`);
    } finally {
      c.release();
    }
  });

  async function expectNoExecute(sql: string, params: unknown[]): Promise<void> {
    const c = await stack.db.adminPool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${TEMP_ROLE}`);
      await expect(c.query(sql, params)).rejects.toThrow(/permission denied/i);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  }

  it('PUBLIC (a role with no grants) cannot execute insert_locked', async () => {
    await expectNoExecute(
      `SELECT * FROM govai.audit_capture_insert_locked(
         $1::uuid, $2::uuid, $3::text, 'run', $4::bigint,
         'x', '1', 'run', $5::uuid, now(),
         $6::bytea, NULL::bytea, NULL::bytea, 'audit-1', 1,
         '{}'::jsonb, 'hmac_internal', NULL::bytea, NULL::text, 'best_effort'
       )`,
      [
        randomUUID(),
        randomUUID(),
        'chain:public-probe',
        chainLockKey('chain:public-probe').toString(),
        randomUUID(),
        Buffer.from('00'.repeat(32), 'hex'),
      ],
    );
  });

  it('PUBLIC cannot execute claim_for_seal', async () => {
    await expectNoExecute(
      `SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
      [randomUUID(), 'chain:x', chainLockKey('chain:x').toString()],
    );
  });

  it('PUBLIC cannot execute mark_sealed', async () => {
    await expectNoExecute(
      `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
      [randomUUID(), randomUUID(), randomUUID(), chainLockKey('chain:x').toString()],
    );
  });

  it('PUBLIC cannot execute mark_failed', async () => {
    await expectNoExecute(
      `SELECT govai.audit_capture_mark_failed($1::uuid, $2::uuid, $3::text, $4::text)`,
      [randomUUID(), randomUUID(), 'x', 'y'],
    );
  });
});

// =============================================================================
// 9. govai_audit_sealer least privilege
// =============================================================================

describe('B0 / govai_audit_sealer least privilege', () => {
  it('sealer can claim+mark via functions, but cannot UPDATE outbox directly', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);

    // Direct UPDATE attempt — should fail (sealer has SELECT only).
    await expect(
      asRole('govai_audit_sealer', org.org_id, async (c) => {
        await c.query(
          `UPDATE govai.audit_capture_outbox SET event_type = 'tamper' WHERE capture_id = $1::uuid`,
          [row.capture_id],
        );
      }),
    ).rejects.toThrow(/permission denied/i);

    // Direct INSERT into capture_refs — should fail.
    await expect(
      asRole('govai_audit_sealer', org.org_id, async (c) => {
        await c.query(
          `INSERT INTO govai.audit_event_capture_refs (org_id, capture_id, audit_event_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`,
          [org.org_id, row.capture_id, randomUUID()],
        );
      }),
    ).rejects.toThrow(/permission denied/i);

    // But via the SECURITY DEFINER functions it can seal:
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
        [org.org_id, chainId, chainLockKey(chainId).toString()],
      );
      await c.query(
        `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
        [org.org_id, row.capture_id, randomUUID(), chainLockKey(chainId).toString()],
      );
    });
  });
});

// =============================================================================
// 10. Error sanitization
// =============================================================================

describe('B0 / error sanitization', () => {
  it('mark_failed truncates last_error to <= 200 chars and never echoes raw payload', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);

    const longSecret = 'sk-secret-' + 'A'.repeat(500);
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT govai.audit_capture_mark_failed($1::uuid, $2::uuid, $3::text, $4::text)`,
        [org.org_id, row.capture_id, 'network_error', longSecret],
      );
    });

    const stored = await asRole('govai_app', org.org_id, async (c) => {
      const r = await c.query<{ last_error: string }>(
        `SELECT last_error FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
        [row.capture_id],
      );
      return r.rows[0]!;
    });
    expect(stored.last_error.length).toBeLessThanOrEqual(200);
    // The full 500-char secret cannot fit in 200 chars; verify the tail is gone.
    expect(stored.last_error).not.toContain('A'.repeat(450));
  });
});

// =============================================================================
// 11. redaction_metadata guard
// =============================================================================

describe('B0 / redaction_metadata top-level guard', () => {
  it.each(['prompt', 'response', 'raw_input', 'raw_output'])(
    'rejects redaction_metadata containing top-level "%s"',
    async (bannedKey) => {
      const org = await seedOrg(stack);
      const chainId = `org:${org.org_id}:run:${randomUUID()}`;
      await expect(
        callInsertLockedAsApp(org.org_id, chainId, {
          redaction_metadata: { [bannedKey]: 'should-not-store' },
        }),
      ).rejects.toThrow(/raw payload keys at top level/i);
    },
  );

  it('accepts redaction_metadata with nested "prompt" key (B0 guard is top-level only)', async () => {
    // B0 explicitly documents that deeper JSON inspection is deferred to
    // AuditBridge (B1/B2). This test pins that documented behaviour so a
    // future regression does not silently start enforcing nested rules
    // without updating the docs first.
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId, {
      redaction_metadata: { nested: { prompt: 'sneaky-but-documented' } },
    });
    expect(row.capture_id).toBeTruthy();
  });
});

// =============================================================================
// 12. capture_refs append-only
// =============================================================================

describe('B0 / capture_refs append-only', () => {
  it('UPDATE / DELETE on audit_event_capture_refs are filtered by RLS (no policy); TRUNCATE is blocked by trigger', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
        [org.org_id, chainId, chainLockKey(chainId).toString()],
      );
      await c.query(
        `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
        [org.org_id, row.capture_id, randomUUID(), chainLockKey(chainId).toString()],
      );
    });

    // Refs have NO UPDATE / NO DELETE policy at all in 0025. RLS filters
    // every row out before the BEFORE-UPDATE / BEFORE-DELETE trigger can
    // fire, so the statements complete with 0 affected rows and the
    // capture_refs row survives.
    await asRole('govai_audit_writer', org.org_id, async (c) => {
      const u = await c.query(
        `UPDATE govai.audit_event_capture_refs SET sealed_at = now() WHERE capture_id = $1::uuid`,
        [row.capture_id],
      );
      expect(u.rowCount).toBe(0);
      const d = await c.query(
        `DELETE FROM govai.audit_event_capture_refs WHERE capture_id = $1::uuid`,
        [row.capture_id],
      );
      expect(d.rowCount).toBe(0);
    });

    const count = await asRole('govai_app', org.org_id, async (c) => {
      const r = await c.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM govai.audit_event_capture_refs WHERE capture_id = $1::uuid`,
        [row.capture_id],
      );
      return r.rows[0]!.c;
    });
    expect(count).toBe('1');

    // TRUNCATE bypasses RLS, so the BEFORE-TRUNCATE trigger fires.
    await expect(
      asRole('govai_audit_writer', org.org_id, async (c) => {
        await c.query(`TRUNCATE govai.audit_event_capture_refs`);
      }),
    ).rejects.toThrow(/append-only/i);
  });
});

// =============================================================================
// 13. wrong p_chain_lock_key concurrency safety (final hardening review)
//
// Prove that the function preserves capture_id idempotency, +1 monotonicity,
// and absence of orphans even when concurrent callers supply DIFFERENT
// (wrong) p_chain_lock_key values for the same p_chain_id. Correctness must
// come from the chain_state row-level lock, NOT from the caller's advisory
// hint.
// =============================================================================

describe('B0 / wrong p_chain_lock_key concurrency safety', () => {
  it('concurrent calls with DIFFERENT wrong lock keys + same capture_id all return the same capture_seq', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const captureId = randomUUID();
    const subjectId = randomUUID();
    const occurredAt = new Date().toISOString();
    const baseOverrides: InsertOverrides = {
      capture_id: captureId,
      subject_id: subjectId,
      occurred_at: occurredAt,
    };

    // Each caller supplies a completely unrelated advisory lock key. None of
    // them matches chainLockKey(chainId). They also differ from each other,
    // so the advisory lock provides ZERO serialization for this call set.
    const wrongLockKeys = [
      chainLockKey(`unrelated:${randomUUID()}`).toString(),
      chainLockKey(`unrelated:${randomUUID()}`).toString(),
      chainLockKey(`unrelated:${randomUUID()}`).toString(),
      chainLockKey(`unrelated:${randomUUID()}`).toString(),
      chainLockKey(`unrelated:${randomUUID()}`).toString(),
    ];

    const results = await Promise.all(
      wrongLockKeys.map((lk) =>
        callInsertLockedAsApp(org.org_id, chainId, {
          ...baseOverrides,
          chain_lock_key: lk,
        }),
      ),
    );

    // All return identical capture_id + capture_seq (idempotent).
    for (const r of results) {
      expect(r.capture_id).toBe(captureId);
      expect(r.capture_seq).toBe(results[0]!.capture_seq);
    }
    expect(Number(results[0]!.capture_seq)).toBe(1);

    // Exactly one outbox row, chain_state.last_captured_seq = 1.
    const state = await asRole('govai_app', org.org_id, async (c) => {
      const r = await c.query<{ last_captured_seq: string; outbox_count: string }>(
        `SELECT cs.last_captured_seq::text,
                (SELECT count(*)::text FROM govai.audit_capture_outbox o WHERE o.chain_id = $1::text) AS outbox_count
           FROM govai.audit_capture_chain_state cs
          WHERE cs.chain_id = $1::text`,
        [chainId],
      );
      return r.rows[0]!;
    });
    expect(Number(state.last_captured_seq)).toBe(1);
    expect(Number(state.outbox_count)).toBe(1);
  });

  it('concurrent calls with DIFFERENT wrong lock keys + DIFFERENT capture_ids produce a contiguous gap-free sequence', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;

    const N = 5;
    const callers = Array.from({ length: N }, (_, i) => ({
      captureId: randomUUID(),
      // Each caller's lock key is unrelated to chainId AND distinct from the
      // other callers' lock keys, so the advisory lock cannot serialize them.
      lockKey: chainLockKey(`unrelated:${i}:${randomUUID()}`).toString(),
    }));

    const results = await Promise.all(
      callers.map((cl) =>
        callInsertLockedAsApp(org.org_id, chainId, {
          capture_id: cl.captureId,
          chain_lock_key: cl.lockKey,
        }),
      ),
    );

    const seqs = results.map((r) => Number(r.capture_seq)).sort((a, b) => a - b);
    // Expect [1, 2, 3, 4, 5] — gap-free, no duplicates.
    expect(seqs).toEqual([1, 2, 3, 4, 5]);

    // All capture_ids distinct.
    expect(new Set(results.map((r) => r.capture_id)).size).toBe(N);

    // chain_state matches.
    const state = await asRole('govai_app', org.org_id, async (c) => {
      const r = await c.query<{ last_captured_seq: string; outbox_count: string }>(
        `SELECT cs.last_captured_seq::text,
                (SELECT count(*)::text FROM govai.audit_capture_outbox o WHERE o.chain_id = $1::text) AS outbox_count
           FROM govai.audit_capture_chain_state cs
          WHERE cs.chain_id = $1::text`,
        [chainId],
      );
      return r.rows[0]!;
    });
    expect(Number(state.last_captured_seq)).toBe(N);
    expect(Number(state.outbox_count)).toBe(N);
  });

  it('serial call with a wrong lock key still returns capture_seq=1 (no advisory-only failure mode)', async () => {
    // Trivial-but-load-bearing: a single caller passing a wrong lock key
    // succeeds. This pins that the advisory lock is purely a hint and the
    // function is not allowed to reject calls just because the hint is wrong.
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId, {
      chain_lock_key: chainLockKey(`unrelated:${randomUUID()}`).toString(),
    });
    expect(Number(row.capture_seq)).toBe(1);
  });
});

// =============================================================================
// 14. mark_failed source-status guard (final hardening review)
//
// Pin the explicit guard:
//   - captured -> failed: allowed
//   - sealing  -> failed: allowed
//   - sealed   -> failed: rejected with explicit function error
//   - failed   -> failed: rejected (no idempotent re-failure in B0)
//   - errors must not contain payload-sensitive content.
// =============================================================================

describe('B0 / mark_failed source-status guard', () => {
  it('mark_failed on a sealed capture is rejected with explicit error and no payload leak', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);

    // Seal it first.
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
        [org.org_id, chainId, chainLockKey(chainId).toString()],
      );
      await c.query(
        `SELECT govai.audit_capture_mark_sealed($1::uuid, $2::uuid, $3::uuid, $4::bigint)`,
        [org.org_id, row.capture_id, randomUUID(), chainLockKey(chainId).toString()],
      );
    });

    // Now try to fail it — must be rejected.
    const sentinelSecret = 'TOP_SECRET_PROMPT_PAYLOAD_DO_NOT_LEAK_' + randomUUID();
    let captured: unknown;
    await expect(
      asRole('govai_audit_sealer', org.org_id, async (c) => {
        try {
          await c.query(
            `SELECT govai.audit_capture_mark_failed($1::uuid, $2::uuid, $3::text, $4::text)`,
            [org.org_id, row.capture_id, 'kms_error', sentinelSecret],
          );
        } catch (err) {
          captured = err;
          throw err;
        }
      }),
    ).rejects.toThrow(/cannot fail capture in status sealed/i);

    // The error string itself must not contain the caller-supplied payload.
    // The function never writes through to the outbox when rejected, so the
    // raised exception only references the offending status name.
    const msg = String((captured as Error | undefined)?.message ?? '');
    expect(msg).not.toContain(sentinelSecret);
    expect(msg).toMatch(/sealed/);

    // Row state survived intact.
    const after = await asRole('govai_app', org.org_id, async (c) => {
      const r = await c.query<{ status: string; last_error: string | null }>(
        `SELECT status, last_error FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
        [row.capture_id],
      );
      return r.rows[0]!;
    });
    expect(after.status).toBe('sealed');
    expect(after.last_error).toBeNull();
  });

  it('mark_failed on an already-failed capture is rejected (no idempotent re-failure in B0)', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;
    const row = await callInsertLockedAsApp(org.org_id, chainId);

    // First failure: allowed (captured -> failed).
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT govai.audit_capture_mark_failed($1::uuid, $2::uuid, $3::text, $4::text)`,
        [org.org_id, row.capture_id, 'network_error', 'upstream timeout'],
      );
    });

    // Second failure: must be rejected with explicit error.
    await expect(
      asRole('govai_audit_sealer', org.org_id, async (c) => {
        await c.query(
          `SELECT govai.audit_capture_mark_failed($1::uuid, $2::uuid, $3::text, $4::text)`,
          [org.org_id, row.capture_id, 'network_error', 'second attempt'],
        );
      }),
    ).rejects.toThrow(/cannot fail capture in status failed/i);

    // last_error must still reflect the FIRST failure (no overwrite).
    const after = await asRole('govai_app', org.org_id, async (c) => {
      const r = await c.query<{ status: string; last_error: string; attempts: string }>(
        `SELECT status, last_error, attempts::text FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
        [row.capture_id],
      );
      return r.rows[0]!;
    });
    expect(after.status).toBe('failed');
    expect(after.last_error).toContain('upstream timeout');
    expect(after.last_error).not.toContain('second attempt');
    expect(Number(after.attempts)).toBe(1);
  });

  it('mark_failed on a captured/sealing capture remains allowed (pin existing happy path)', async () => {
    const org = await seedOrg(stack);
    const chainId = `org:${org.org_id}:run:${randomUUID()}`;

    // captured -> failed
    const a = await callInsertLockedAsApp(org.org_id, chainId);
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT govai.audit_capture_mark_failed($1::uuid, $2::uuid, $3::text, $4::text)`,
        [org.org_id, a.capture_id, 'x', 'y'],
      );
    });
    const afterA = await asRole('govai_app', org.org_id, async (c) => {
      const r = await c.query<{ status: string }>(
        `SELECT status FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
        [a.capture_id],
      );
      return r.rows[0]!.status;
    });
    expect(afterA).toBe('failed');

    // sealing -> failed
    const b = await callInsertLockedAsApp(org.org_id, chainId);
    await asRole('govai_audit_sealer', org.org_id, async (c) => {
      await c.query(
        `SELECT * FROM govai.audit_capture_claim_for_seal($1::uuid, $2::text, $3::bigint)`,
        [org.org_id, chainId, chainLockKey(chainId).toString()],
      );
      await c.query(
        `SELECT govai.audit_capture_mark_failed($1::uuid, $2::uuid, $3::text, $4::text)`,
        [org.org_id, b.capture_id, 'kms_error', 'derive failed'],
      );
    });
    const afterB = await asRole('govai_app', org.org_id, async (c) => {
      const r = await c.query<{ status: string }>(
        `SELECT status FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
        [b.capture_id],
      );
      return r.rows[0]!.status;
    });
    expect(afterB).toBe('failed');
  });
});
