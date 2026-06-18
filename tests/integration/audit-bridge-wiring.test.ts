// EP-004 (PR-B) integration matrix — the AuditBridge wired into the four direct
// provider routes, end-to-end against real Postgres (Testcontainers).
//
// I1/I2  happy path: each route writes EXACTLY one capture row with the rev4
//        redaction shape (no per-attempt fields).
// I5     no idempotency header → two requests → two distinct rows.
// I6     capture failure during dispatch → request still succeeds (best_effort),
//        a `capture_failed` warn is logged, no row written.
// I7     RLS: a capture row is invisible under another org's app.org_id.
// I8     no banned redaction key / raw content reaches a captured row.
// I9     byte-fidelity: the client receives exactly the upstream bytes
//        (sha256(response) == the audit event's native_response_hash) post-wiring.
// ingress malformed X-GovAI-Idempotency-Key → 400; X-GovAI-Request-Id echoed.
//
// I3/I4 (the load-bearing same-key replay REUSE / divergent-occurred_at CONFLICT
// proofs) live in audit-bridge-idempotency.test.ts — they need an injected clock.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FastifyInstance } from 'fastify';
import { startStack, stopStack, seedOrg, type Stack } from './helpers/server-fixture.js';
import { setLocalAppOrgId } from '@govai/core-tenant';

let stack: Stack;
let app: FastifyInstance;

type LogLine = { level: 'info' | 'warn' | 'error'; obj: Record<string, unknown>; msg?: string };
const logs: LogLine[] = [];
function resetLogs(): void {
  logs.length = 0;
}

function hijackLogs(a: FastifyInstance): void {
  for (const level of ['info', 'warn', 'error'] as const) {
    const orig = a.log[level].bind(a.log);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a.log as any)[level] = (obj: any, msg?: string) => {
      if (obj && typeof obj === 'object') logs.push({ level, obj, msg });
      return orig(obj, msg);
    };
  }
}

beforeAll(async () => {
  stack = await startStack();
  app = stack.app;
  hijackLogs(app);
}, 240_000);

afterAll(async () => {
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

type OutboxRow = {
  capture_id: string;
  capture_seq: string;
  chain_id: string;
  payload_hash_hex: string;
  redaction_metadata: Record<string, unknown>;
  event_version: string;
};

async function outboxRows(orgId: string): Promise<OutboxRow[]> {
  return withAppTx(orgId, async (c) => {
    const r = await c.query<OutboxRow>(
      `SELECT capture_id::text, capture_seq::text, chain_id,
              encode(payload_hash, 'hex') AS payload_hash_hex,
              redaction_metadata, event_version
         FROM govai.audit_capture_outbox
        WHERE org_id = $1::uuid
        ORDER BY capture_seq`,
      [orgId],
    );
    return r.rows;
  });
}

const ANTHROPIC_MSG = {
  method: 'POST' as const,
  path: '/passthrough/anthropic/v1/messages',
  body: { model: 'claude-fixture-1', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] },
};
const OPENAI_EMB = {
  method: 'POST' as const,
  path: '/passthrough/openai/v1/embeddings',
  body: { model: 'text-embedding-3-small', input: 'hello-embeddings' },
};

function reqHeaders(apiKey: string, extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-govai-api-key': apiKey, 'content-type': 'application/json', ...extra };
}

describe('EP-004 — AuditBridge wiring (I1/I2 happy path → exactly one capture row)', () => {
  it('I1: passthrough-anthropic writes one capture row with the rev4 redaction shape', async () => {
    const org = await seedOrg(stack);
    const res = await app.inject({
      method: ANTHROPIC_MSG.method,
      url: ANTHROPIC_MSG.path,
      headers: reqHeaders(org.api_key),
      payload: ANTHROPIC_MSG.body,
    });
    expect(res.statusCode).toBe(200);
    const rows = await outboxRows(org.org_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chain_id).toBeTruthy();
    expect(rows[0]!.payload_hash_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.event_version).toBe('4');
    // rev4 shape: identity_scope only (no idempotency key sent), NO per-attempt fields.
    expect(rows[0]!.redaction_metadata).toEqual({
      audit_bridge: { identity_scope: 'govai_request_id' },
    });
  });

  it('I1: passthrough-openai writes one capture row', async () => {
    const org = await seedOrg(stack);
    const res = await app.inject({
      method: OPENAI_EMB.method,
      url: OPENAI_EMB.path,
      headers: reqHeaders(org.api_key),
      payload: OPENAI_EMB.body,
    });
    expect(res.statusCode).toBe(200);
    const rows = await outboxRows(org.org_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.redaction_metadata).toEqual({
      audit_bridge: { identity_scope: 'govai_request_id' },
    });
  });

  it('I2: governed-anthropic writes exactly one capture row', async () => {
    const org = await seedOrg(stack);
    const res = await app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: reqHeaders(org.api_key),
      payload: { model: 'claude-fixture-1', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] },
    });
    // governed may allow (2xx) or enforce (403) depending on tier/risk; either way
    // it emits exactly one PassthroughInvoked → exactly one capture row.
    expect([200, 403]).toContain(res.statusCode);
    const rows = await outboxRows(org.org_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_version).toBe('4');
  });

  it('I2: governed-openai writes exactly one capture row', async () => {
    const org = await seedOrg(stack);
    const res = await app.inject({
      method: 'POST',
      url: '/governed/openai/v1/responses',
      headers: reqHeaders(org.api_key),
      payload: { model: 'gpt-fixture-1', input: 'hello' },
    });
    expect([200, 403]).toContain(res.statusCode);
    const rows = await outboxRows(org.org_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_version).toBe('4');
  });
});

describe('EP-004 — ingress identity hook', () => {
  it('malformed X-GovAI-Idempotency-Key → 400 invalid_idempotency_key', async () => {
    const org = await seedOrg(stack);
    const res = await app.inject({
      method: ANTHROPIC_MSG.method,
      url: ANTHROPIC_MSG.path,
      headers: reqHeaders(org.api_key, { 'x-govai-idempotency-key': '   ' }), // empty after trim
      payload: ANTHROPIC_MSG.body,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'invalid_idempotency_key' });
    // a 400 at ingress means no capture happened
    expect(await outboxRows(org.org_id)).toHaveLength(0);
  });

  it('echoes X-GovAI-Request-Id on a direct route', async () => {
    const org = await seedOrg(stack);
    const res = await app.inject({
      method: ANTHROPIC_MSG.method,
      url: ANTHROPIC_MSG.path,
      headers: reqHeaders(org.api_key),
      payload: ANTHROPIC_MSG.body,
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['x-govai-request-id'])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('does NOT echo X-GovAI-Request-Id on a non-direct route', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-govai-request-id']).toBeUndefined();
  });
});

describe('EP-004 — I5/I7/I8 capture-row invariants', () => {
  it('I5: two requests without an idempotency key → two distinct capture rows', async () => {
    const org = await seedOrg(stack);
    for (let i = 0; i < 2; i += 1) {
      const res = await app.inject({
        method: ANTHROPIC_MSG.method,
        url: ANTHROPIC_MSG.path,
        headers: reqHeaders(org.api_key),
        payload: ANTHROPIC_MSG.body,
      });
      expect(res.statusCode).toBe(200);
    }
    const rows = await outboxRows(org.org_id);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.capture_id)).size).toBe(2); // distinct captureIds
  });

  it('I7: a capture row is invisible under another org RLS context', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    const res = await app.inject({
      method: ANTHROPIC_MSG.method,
      url: ANTHROPIC_MSG.path,
      headers: reqHeaders(orgA.api_key),
      payload: ANTHROPIC_MSG.body,
    });
    expect(res.statusCode).toBe(200);
    expect(await outboxRows(orgA.org_id)).toHaveLength(1);
    // Under org B's app.org_id, org A's rows are invisible.
    const visibleUnderB = await withAppTx(orgB.org_id, async (c) => {
      const r = await c.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM govai.audit_capture_outbox WHERE org_id = $1::uuid`,
        [orgA.org_id],
      );
      return r.rows[0]!.c;
    });
    expect(visibleUnderB).toBe('0');
  });

  it('I8: no banned redaction key or raw request content reaches the captured row', async () => {
    const org = await seedOrg(stack);
    const SECRET = 'SENSITIVE_PROMPT_DO_NOT_LEAK';
    const res = await app.inject({
      method: ANTHROPIC_MSG.method,
      url: ANTHROPIC_MSG.path,
      headers: reqHeaders(org.api_key),
      payload: { model: 'claude-fixture-1', max_tokens: 100, messages: [{ role: 'user', content: SECRET }] },
    });
    expect(res.statusCode).toBe(200);
    const rows = await outboxRows(org.org_id);
    expect(rows).toHaveLength(1);
    const rowJson = JSON.stringify(rows[0]);
    expect(rowJson).not.toContain(SECRET); // payload is hashed, never stored
    for (const banned of ['prompt', 'response', 'raw_input', 'raw_output', 'messages', 'completion', 'requestBody', 'responseBody']) {
      expect(JSON.stringify(rows[0]!.redaction_metadata)).not.toContain(`"${banned}"`);
    }
  });
});

describe('EP-004 — I9 byte-fidelity non-regression', () => {
  it('client receives exactly the upstream bytes (sha256 == audit native_response_hash)', async () => {
    resetLogs();
    const org = await seedOrg(stack);
    const res = await app.inject({
      method: OPENAI_EMB.method,
      url: OPENAI_EMB.path,
      headers: reqHeaders(org.api_key),
      payload: OPENAI_EMB.body,
    });
    expect(res.statusCode).toBe(200);
    const ev = logs.find((l) => l.msg === 'passthrough audit event')?.obj['audit_event'] as
      | Record<string, unknown>
      | undefined;
    expect(ev).toBeDefined();
    const expectedHash = ev!['native_response_hash'] as string;
    const actualHash = createHash('sha256').update(res.rawPayload).digest('hex');
    expect(actualHash).toBe(expectedHash);
  });
});

describe('EP-004 — I6 best_effort (capture failure does not fail the request)', () => {
  it('dispatch capture failure → request still 2xx, capture_failed warn, no row', async () => {
    const org = await seedOrg(stack);
    // Resolve the function signature and revoke EXECUTE so the dispatcher's
    // captureAuditEvent fails (42501) — auth (orgs/api_keys) is unaffected, so the
    // request path still succeeds. Restore in finally.
    const sig = (
      await stack.db.adminPool.query<{ sig: string }>(
        `SELECT p.oid::regprocedure::text AS sig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'govai' AND p.proname = 'audit_capture_insert_locked'`,
      )
    ).rows[0]!.sig;
    await stack.db.adminPool.query(`REVOKE EXECUTE ON FUNCTION ${sig} FROM PUBLIC`);
    await stack.db.adminPool.query(`REVOKE EXECUTE ON FUNCTION ${sig} FROM govai_app`);
    try {
      resetLogs();
      const res = await app.inject({
        method: OPENAI_EMB.method,
        url: OPENAI_EMB.path,
        headers: reqHeaders(org.api_key),
        payload: OPENAI_EMB.body,
      });
      expect(res.statusCode).toBe(200); // best_effort: request still succeeds
      const warns = logs.filter((l) => l.level === 'warn' && l.obj['reason'] === 'capture_failed');
      expect(warns.length).toBeGreaterThanOrEqual(1);
      expect(await outboxRows(org.org_id)).toHaveLength(0); // nothing captured
    } finally {
      await stack.db.adminPool.query(`GRANT EXECUTE ON FUNCTION ${sig} TO govai_app`);
    }
  });
});

describe('EP-005 — the consumed X-GovAI-Idempotency-Key is NOT forwarded upstream', () => {
  it('passthrough-openai: key consumed (not forwarded), identity still client scope', async () => {
    const org = await seedOrg(stack);
    stack.provider.clearRecordedRequestHeaders();
    const KEY = `ep005-${randomUUID()}`;
    const res = await app.inject({
      method: OPENAI_EMB.method,
      url: OPENAI_EMB.path,
      headers: reqHeaders(org.api_key, { 'x-govai-idempotency-key': KEY }),
      payload: OPENAI_EMB.body,
    });
    expect(res.statusCode).toBe(200);
    const seen = stack.provider.recordedRequestHeaders;
    expect(seen.length).toBeGreaterThanOrEqual(1);
    // the upstream mock NEVER received the consumed idempotency key...
    for (const h of seen) expect(h['x-govai-idempotency-key']).toBeUndefined();
    // ...and its raw value leaks into no forwarded header at all.
    expect(seen.some((h) => JSON.stringify(h).includes(KEY))).toBe(false);
    // positive control: the provider auth header WAS forwarded (openai → Bearer).
    expect(
      seen.some(
        (h) => typeof h['authorization'] === 'string' && (h['authorization'] as string).startsWith('Bearer '),
      ),
    ).toBe(true);
    // and the key STILL worked end-to-end: the capture row is client_idempotency_key scope.
    const rows = await outboxRows(org.org_id);
    expect(rows).toHaveLength(1);
    const ab = (rows[0]!.redaction_metadata as { audit_bridge?: { identity_scope?: string } }).audit_bridge;
    expect(ab?.identity_scope).toBe('client_idempotency_key');
  });

  it('governed-anthropic: key is not forwarded on the governed path', async () => {
    const org = await seedOrg(stack);
    stack.provider.clearRecordedRequestHeaders();
    const KEY = `ep005-${randomUUID()}`;
    const res = await app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: reqHeaders(org.api_key, { 'x-govai-idempotency-key': KEY }),
      payload: { model: 'claude-fixture-1', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] },
    });
    expect([200, 403]).toContain(res.statusCode);
    const seen = stack.provider.recordedRequestHeaders;
    for (const h of seen) expect(h['x-govai-idempotency-key']).toBeUndefined();
    expect(seen.some((h) => JSON.stringify(h).includes(KEY))).toBe(false);
    if (res.statusCode === 200) {
      // when it forwarded, the provider auth header (anthropic → x-api-key) was present.
      expect(seen.some((h) => typeof h['x-api-key'] === 'string')).toBe(true);
    }
  });
});
