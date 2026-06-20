// EP-004 (PR-B) — the LOAD-BEARING same-key replay proofs, end-to-end against
// real Postgres. These are the contract proofs the unit U9 only guards:
//
//   I3  faithful replay: SAME X-GovAI-Idempotency-Key + SAME occurred_at +
//       identical request, varied nothing immutable → govai.audit_capture_insert_locked
//       REUSES the capture (one row, stable capture_seq, NO conflict).
//   I4  divergent occurred_at: SAME key, DIFFERENT occurred_at (the rev4 trigger —
//       NOT a divergent native_request_hash) → 23505 → evidence_idempotency_conflict
//       error log → request still succeeds (best_effort) → NO second row.
//
// occurred_at is controlled by injecting `now` into buildServer (→ app.govai.now →
// the passthrough producer clock). The endpoint is /passthrough/openai/v1/embeddings
// because the hermetic mock returns a DETERMINISTIC body for it, so native_request_hash
// and native_response_hash are stable across attempts and occurred_at is the ONLY
// column that can differ — exactly isolating the I4 trigger.
//
// CRITICAL (Opus + GPT-5.5 flagged): I3 MUST hold occurred_at EQUAL across both
// attempts. A replay that lets occurred_at drift "silently tests nothing".

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../apps/api/src/server.js';
import { startStack, stopStack, seedOrg, type Stack } from './helpers/server-fixture.js';
import { setLocalAppOrgId } from '@govai/core-tenant';

let stack: Stack;
let app: FastifyInstance;
// A mutable clock the test controls: `now` returns clock.current, so holding it
// fixed reproduces a faithful replay (I3) and flipping it forges a new event (I4).
const clock: { current: Date } = { current: new Date('2026-06-15T00:00:00.000Z') };

type LogLine = { level: 'info' | 'warn' | 'error'; obj: Record<string, unknown>; msg?: string };
const logs: LogLine[] = [];
function resetLogs(): void {
  logs.length = 0;
}

beforeAll(async () => {
  stack = await startStack();
  // A second app sharing the stack's DB pool + provider mock, but with the
  // injectable clock wired through app.govai.now → the passthrough producer.
  app = await buildServer({ env: stack.env, pool: stack.db.appPool, now: () => clock.current });
  for (const level of ['info', 'warn', 'error'] as const) {
    const orig = app.log[level].bind(app.log);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app.log as any)[level] = (obj: any, msg?: string) => {
      if (obj && typeof obj === 'object') logs.push({ level, obj, msg });
      return orig(obj, msg);
    };
  }
}, 240_000);

afterAll(async () => {
  if (app) await app.close().catch(() => undefined);
  if (stack) await stopStack(stack);
});

async function withAppTx<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
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

async function captureRows(orgId: string): Promise<Array<{ capture_id: string; capture_seq: string; occurred_at: string }>> {
  return withAppTx(orgId, async (c) => {
    const r = await c.query<{ capture_id: string; capture_seq: string; occurred_at: string }>(
      `SELECT capture_id::text, capture_seq::text, occurred_at::text
         FROM govai.audit_capture_outbox
        WHERE org_id = $1::uuid
        ORDER BY capture_seq`,
      [orgId],
    );
    return r.rows;
  });
}

function embeddingsReq(apiKey: string, idempotencyKey: string) {
  return {
    method: 'POST' as const,
    url: '/passthrough/openai/v1/embeddings',
    headers: {
      'x-govai-api-key': apiKey,
      'x-govai-idempotency-key': idempotencyKey,
      'content-type': 'application/json',
    },
    payload: { model: 'text-embedding-3-small', input: 'idempotent-replay-input' },
  };
}

describe('EP-004 — I3: faithful same-key replay → SQL REUSE', () => {
  it('same key + same occurred_at + identical request → one row, stable capture_seq, no conflict', async () => {
    const org = await seedOrg(stack);
    const KEY = `i3-${randomUUID()}`;
    // Hold occurred_at FIXED for BOTH attempts (a faithful replay).
    clock.current = new Date('2026-06-15T00:00:00.000Z');
    resetLogs();

    const r1 = await app.inject(embeddingsReq(org.api_key, KEY));
    expect(r1.statusCode).toBe(200);
    const after1 = await captureRows(org.org_id);
    expect(after1).toHaveLength(1);
    const seq1 = after1[0]!.capture_seq;
    const id1 = after1[0]!.capture_id;

    // Attempt 2 — identical key, identical request, SAME occurred_at (clock unchanged).
    const r2 = await app.inject(embeddingsReq(org.api_key, KEY));
    expect(r2.statusCode).toBe(200);
    const after2 = await captureRows(org.org_id);

    // REUSE: still exactly one row, same capture_seq, same capture_id.
    expect(after2).toHaveLength(1);
    expect(after2[0]!.capture_seq).toBe(seq1);
    expect(after2[0]!.capture_id).toBe(id1);
    // Both attempts succeeded as captures (reuse path commits + logs), and NEITHER
    // raised an idempotency conflict.
    const conflicts = logs.filter((l) => l.obj['reason'] === 'evidence_idempotency_conflict');
    expect(conflicts).toHaveLength(0);
    const captures = logs.filter((l) => l.msg === 'audit_bridge.capture');
    expect(captures.length).toBeGreaterThanOrEqual(2);
  });
});

describe('EP-004 — I4: divergent occurred_at under the same key → CONFLICT', () => {
  it('same key, different occurred_at → 23505 conflict, request still 2xx, no second row', async () => {
    const org = await seedOrg(stack);
    const KEY = `i4-${randomUUID()}`;

    // Attempt 1 at T0.
    clock.current = new Date('2026-06-15T00:00:00.000Z');
    const r1 = await app.inject(embeddingsReq(org.api_key, KEY));
    expect(r1.statusCode).toBe(200);
    const after1 = await captureRows(org.org_id);
    expect(after1).toHaveLength(1);
    const seq1 = after1[0]!.capture_seq;

    // Attempt 2 at a DIFFERENT T1 — same key, identical request otherwise. By
    // ADR-028 (d) a different event-time is a different event: same captureId
    // (key+coords, occurred_at not in it) but a divergent column #8 → 23505.
    resetLogs();
    clock.current = new Date('2026-06-15T09:09:09.999Z');
    const r2 = await app.inject(embeddingsReq(org.api_key, KEY));
    expect(r2.statusCode).toBe(200); // best_effort: the request still succeeds

    const after2 = await captureRows(org.org_id);
    expect(after2).toHaveLength(1); // NO second row
    expect(after2[0]!.capture_seq).toBe(seq1); // the original row, untouched
    // Attempt 2 classified the 23505 as an idempotency conflict and logged it at error.
    const conflicts = logs.filter(
      (l) => l.level === 'error' && l.obj['reason'] === 'evidence_idempotency_conflict',
    );
    expect(conflicts).toHaveLength(1);
  });
});

// EP-008-PRE-EQ — the forward migration (0026) removes the `redaction_metadata`
// clause from audit_capture_insert_locked's Step-3 divergence check. These tests
// exercise the function DIRECTLY (the route always emits one shape, so it cannot
// reproduce the cross-deploy scenario): a row written by the pre-enrichment code
// (old-shape redaction_metadata) re-presented by the post-enrichment code (new
// shape), same capture_id/payload_hash/occurred_at/every-other column.
const EQ_OLD_SHAPE = { audit_bridge: { identity_scope: 'govai_request_id' } };
const EQ_NEW_SHAPE = {
  audit_bridge: {
    identity_scope: 'govai_request_id',
    provider: 'anthropic',
    capability_id: 'anthropic.messages.create',
  },
};

type EqInsertArgs = {
  captureId: string;
  orgId: string;
  chainId: string;
  subjectId: string;
  occurredAt: string;
  payloadHash: Buffer;
  keyId: string;
  redactionMetadata: Record<string, unknown>;
};

function eqDefaults(orgId: string): EqInsertArgs {
  return {
    captureId: randomUUID(),
    orgId,
    chainId: `cdr-${randomUUID()}`,
    subjectId: randomUUID(),
    occurredAt: '2026-06-15T00:00:00.000Z',
    payloadHash: Buffer.alloc(32, 0xab),
    keyId: 'audit-1',
    redactionMetadata: EQ_OLD_SHAPE,
  };
}

// Direct call of the SECURITY DEFINER function, as the bridge does: govai_app
// connection, app.org_id set (withAppTx), all 20 positional params.
async function eqCallInsertLocked(a: EqInsertArgs): Promise<{ capture_id: string; capture_seq: string }> {
  return withAppTx(a.orgId, async (c) => {
    const r = await c.query<{ capture_id: string; capture_seq: string }>(
      `SELECT capture_id::text, capture_seq::text
         FROM govai.audit_capture_insert_locked(
           $1::uuid, $2::uuid, $3::text, $4::text, $5::bigint, $6::text, $7::text, $8::text,
           $9::uuid, $10::timestamptz, $11::bytea, $12::bytea, $13::bytea, $14::text, $15::integer,
           $16::jsonb, $17::text, $18::bytea, $19::text, $20::text)`,
      [
        a.captureId, a.orgId, a.chainId, 'run', 1234567,
        'passthrough.invoked', '4', 'runtime_event',
        a.subjectId, a.occurredAt, a.payloadHash, null, null, a.keyId, 1,
        JSON.stringify(a.redactionMetadata), 'hmac_internal', null, null, 'best_effort',
      ],
    );
    return r.rows[0]!;
  });
}

async function eqReadRedaction(orgId: string, captureId: string): Promise<unknown> {
  return withAppTx(orgId, async (c) => {
    const r = await c.query<{ redaction_metadata: unknown }>(
      `SELECT redaction_metadata FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
      [captureId],
    );
    return r.rows[0]?.redaction_metadata;
  });
}

describe('EP-008-PRE-EQ — idempotency content anchor (redaction_metadata excluded from divergence)', () => {
  it('cross-deploy REUSE: only redaction_metadata differs (old→new shape) → reuse, no 23505, stored row unchanged (first-writer-wins)', async () => {
    const org = await seedOrg(stack);
    const base = eqDefaults(org.org_id);

    // Deploy A (pre-enrichment): write with OLD-shape redaction_metadata.
    const first = await eqCallInsertLocked({ ...base, redactionMetadata: EQ_OLD_SHAPE });
    expect(first.capture_id).toBe(base.captureId);

    // Deploy B (post-enrichment): SAME capture_id/payload_hash/occurred_at/every other
    // column; ONLY redaction_metadata differs (NEW enriched shape) → must REUSE.
    const second = await eqCallInsertLocked({ ...base, redactionMetadata: EQ_NEW_SHAPE });
    expect(second.capture_id).toBe(first.capture_id);
    expect(second.capture_seq).toBe(first.capture_seq); // REUSE — same capture_seq, no 23505

    // Exactly one row; its redaction_metadata is the ORIGINAL (old) shape (first-writer-wins).
    expect(await captureRows(org.org_id)).toHaveLength(1);
    expect(await eqReadRedaction(org.org_id, base.captureId)).toEqual(EQ_OLD_SHAPE);
  });

  it('divergence teeth: same capture_id but DIFFERENT payload_hash still raises 23505 (payload_hash is the content anchor)', async () => {
    const org = await seedOrg(stack);
    const base = eqDefaults(org.org_id);
    await eqCallInsertLocked(base);
    await expect(
      eqCallInsertLocked({ ...base, payloadHash: Buffer.alloc(32, 0xcd) }),
    ).rejects.toMatchObject({ code: '23505' });
    expect(await captureRows(org.org_id)).toHaveLength(1); // no second row
  });

  it('divergence teeth: same capture_id but DIFFERENT key_id still raises 23505', async () => {
    const org = await seedOrg(stack);
    const base = eqDefaults(org.org_id);
    await eqCallInsertLocked(base);
    await expect(
      eqCallInsertLocked({ ...base, keyId: 'audit-2' }),
    ).rejects.toMatchObject({ code: '23505' });
    expect(await captureRows(org.org_id)).toHaveLength(1);
  });
});
