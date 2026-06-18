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
