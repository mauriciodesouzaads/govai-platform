// P0-PRE-F4 — AuditBridge request-identity context isolation, end-to-end against
// the REAL server stack (buildServer + real Postgres via Testcontainers).
//
// Purpose (dual): (1) falsification harness against the ingress hook's ALS
// lifecycle — run FIRST against the unchanged `enterWith()` implementation to
// determine whether any observable cross-request contamination or context loss
// exists; (2) permanent regression proof that the request-owned
// `AsyncLocalStorage.run()` boundary preserves per-request identity ownership.
//
// Determinism: interleaving is driven by REAL barriers, not scheduling luck. A
// latch-controlled upstream (this file owns it; GOVAI_PROVIDER_BASE_URL points
// at it) parks each forwarded request mid-lifecycle until the test releases it,
// and an explicit timeline records which request advanced and when. Promise.all
// and sleeps are never used as the synchronization mechanism. The bounded polls
// below only await post-response persistence of an already-ordered write (the
// stream terminal emit is awaited BEFORE the socket closes — see
// pumpStreamWithTerminalEmit — so rows exist by response-completion; the poll is
// a hard-deadline safety net, not an ordering device).
//
// Ownership proofs are derivational, not presence checks: expected captureIds
// are computed with the PRODUCTION helpers (buildRequestIdentity +
// auditBridgeCaptureId — never re-implemented), keyed rows must carry exactly
// their own key hash, request-scoped rows must derive from exactly the
// govaiRequestId echoed to THAT response, and each `audit_bridge.capture` log
// line must pair that capture_id with that response's X-GovAI-Request-Id.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { PoolClient } from 'pg';
import type { FastifyInstance } from 'fastify';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { startStack, stopStack, seedOrg, type Stack } from './helpers/server-fixture.js';
import {
  buildRequestIdentity,
  requestIdentityAls,
  type AuditBridgeRequestIdentity,
} from '../../apps/api/src/pipeline/request-identity.js';
import { auditBridgeCaptureId } from '../../apps/api/src/pipeline/audit-bridge.js';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------
// Latch-controlled upstream. Each request carrying `x-test-latch: <id>` parks
// inside the upstream handler (i.e. the API request parks inside its forward
// fetch, identity already established, terminal emit still pending) until the
// test calls release(<id>). Arrival/resume events land on a shared timeline so
// the interleaving each test claims is the interleaving that actually happened.
// ---------------------------------------------------------------------------

type Gate = {
  arrived: Promise<void>;
  released: Promise<void>;
  signalArrived: () => void;
  release: () => void;
};

const gates = new Map<string, Gate>();
const timeline: string[] = [];
const upstreamHits: Array<{ url: string; headers: Record<string, unknown> }> = [];

function gate(id: string): { arrived: Promise<void>; release: () => void } {
  let signalArrived!: () => void;
  let release!: () => void;
  const arrived = new Promise<void>((r) => {
    signalArrived = r;
  });
  const released = new Promise<void>((r) => {
    release = r;
  });
  const g: Gate = { arrived, released, signalArrived, release };
  gates.set(id, g);
  return {
    arrived,
    release: () => {
      timeline.push(`release:${id}`);
      release();
    },
  };
}

function startLatchUpstream(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        upstreamHits.push({ url: req.url ?? '', headers: { ...req.headers } });
        const latchId = req.headers['x-test-latch'];
        const g = typeof latchId === 'string' ? gates.get(latchId) : undefined;
        const mode = req.headers['x-test-upstream-mode'];
        let body: { stream?: unknown } | null = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: unknown };
        } catch {
          body = null;
        }

        if (body?.stream !== true) {
          if (g && typeof latchId === 'string') {
            timeline.push(`arrive:${latchId}`);
            g.signalArrived();
            await g.released;
            timeline.push(`resume:${latchId}`);
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: `up-${randomUUID()}`, object: 'latch-fixture' }));
          return;
        }

        // Streaming: headers + first chunk go out BEFORE parking, so the API-side
        // pump is genuinely mid-drain (delayed terminal emission) while parked.
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"type":"chunk","n":1}\n\n');
        if (g && typeof latchId === 'string') {
          timeline.push(`arrive:${latchId}`);
          g.signalArrived();
          await g.released;
          timeline.push(`resume:${latchId}`);
        }
        if (mode === 'destroy') {
          // Abnormal terminal path: kill the upstream socket mid-stream.
          res.destroy();
          return;
        }
        res.write('data: {"type":"chunk","n":2}\n\ndata: [DONE]\n\n');
        res.end();
      })();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

// ---------------------------------------------------------------------------
// Stack + log capture (same hijack pattern as audit-bridge-wiring.test.ts).
// ---------------------------------------------------------------------------

let stack: Stack;
let app: FastifyInstance;
let upstream: { server: Server; baseUrl: string };
let listenBaseUrl: string;

// Unrelated continuation, created BEFORE any request enters the system. When
// triggered (after all requests in the final test), it reads the store from a
// context that never belonged to any request — it must see undefined.
let unrelatedProbe: {
  result: Promise<AuditBridgeRequestIdentity | undefined>;
  trigger: () => void;
};

type LogLine = { level: 'info' | 'warn' | 'error'; obj: Record<string, unknown>; msg?: string };
const logs: LogLine[] = [];
function resetLogs(): void {
  logs.length = 0;
}

beforeAll(async () => {
  let trigger!: () => void;
  const armed = new Promise<void>((r) => {
    trigger = r;
  });
  unrelatedProbe = { result: armed.then(() => requestIdentityAls.getStore()), trigger };

  upstream = await startLatchUpstream();
  stack = await startStack({ GOVAI_PROVIDER_BASE_URL: upstream.baseUrl });
  app = stack.app;
  for (const level of ['info', 'warn', 'error'] as const) {
    const orig = app.log[level].bind(app.log);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app.log as any)[level] = (obj: any, msg?: string) => {
      if (obj && typeof obj === 'object') logs.push({ level, obj, msg });
      return orig(obj, msg);
    };
  }
  // Real socket surface for the keep-alive sequential probe.
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address() as AddressInfo;
  listenBaseUrl = `http://127.0.0.1:${addr.port}`;
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
  if (upstream) await new Promise<void>((r) => upstream.server.close(() => r()));
});

// ---------------------------------------------------------------------------
// Helpers — production derivation helpers only, never re-implemented.
// ---------------------------------------------------------------------------

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
  redaction_metadata: {
    audit_bridge?: {
      identity_scope?: string;
      idempotency_key_hash?: string;
      provider?: string;
      capability_id?: string;
    };
  };
};

async function outboxRows(orgId: string): Promise<OutboxRow[]> {
  return withAppTx(orgId, async (c) => {
    const r = await c.query<OutboxRow>(
      `SELECT capture_id::text, redaction_metadata
         FROM govai.audit_capture_outbox
        WHERE org_id = $1::uuid
        ORDER BY capture_seq`,
      [orgId],
    );
    return r.rows;
  });
}

/** sha256 hash the PRODUCTION builder derives for a client idempotency key. */
function keyHash(key: string): string {
  const h = buildRequestIdentity(key).idempotencyKeyHash;
  if (!h) throw new Error('keyed identity produced no hash');
  return h;
}

type CaptureCoords = {
  orgId: string;
  provider: string;
  capabilityId: string;
  nativeEndpoint: string;
};

/** Expected captureId for a keyed request (identity = the key hash, not the request id). */
function keyedCaptureId(coords: CaptureCoords, key: string): string {
  return auditBridgeCaptureId(
    {
      govaiRequestId: '00000000-0000-4000-8000-000000000000', // unused in keyed scope
      identityScope: 'client_idempotency_key',
      idempotencyKeyHash: keyHash(key),
    },
    { ...coords, nativeMethod: 'POST' },
  );
}

/** Expected captureId for a keyless request (identity = that response's own request id). */
function requestScopedCaptureId(coords: CaptureCoords, govaiRequestId: string): string {
  return auditBridgeCaptureId(
    { govaiRequestId, identityScope: 'govai_request_id' },
    { ...coords, nativeMethod: 'POST' },
  );
}

function captureLogs(): Array<{ capture_id: string; govai_request_id: string }> {
  return logs
    .filter((l) => l.msg === 'audit_bridge.capture')
    .map((l) => ({
      capture_id: String(l.obj['capture_id']),
      govai_request_id: String(l.obj['govai_request_id']),
    }));
}

function missingIdentityLogs(): LogLine[] {
  return logs.filter((l) => l.obj['reason'] === 'missing_request_identity');
}

function invokedEvents(orgId: string): Array<Record<string, unknown>> {
  return logs
    .filter((l) => l.msg === 'passthrough audit event' || l.msg === 'governed-native audit event')
    .map((l) => l.obj['audit_event'] as Record<string, unknown>)
    .filter(
      (ev) =>
        ev &&
        (ev['tenant_context'] as Record<string, unknown> | undefined)?.['org_id'] === orgId,
    );
}

async function pollUntil<T>(fn: () => Promise<T | undefined>, what: string, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`pollUntil timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function anthropicMessagesReq(
  apiKey: string,
  content: string,
  extra: Record<string, string> = {},
  stream = false,
) {
  return {
    method: 'POST' as const,
    url: '/passthrough/anthropic/v1/messages',
    headers: { 'x-govai-api-key': apiKey, 'content-type': 'application/json', ...extra },
    payload: JSON.stringify({
      model: 'claude-fixture-1',
      max_tokens: 100,
      ...(stream ? { stream: true } : {}),
      messages: [{ role: 'user', content }],
    }),
  };
}

const ANTHROPIC_MSG_COORDS = (orgId: string): CaptureCoords => ({
  orgId,
  provider: 'anthropic',
  capabilityId: 'anthropic.messages.create',
  nativeEndpoint: '/v1/messages',
});
const ANTHROPIC_STREAM_COORDS = (orgId: string): CaptureCoords => ({
  orgId,
  provider: 'anthropic',
  capabilityId: 'anthropic.messages.stream',
  nativeEndpoint: '/v1/messages',
});
const OPENAI_EMB_COORDS = (orgId: string): CaptureCoords => ({
  orgId,
  provider: 'openai',
  capabilityId: 'openai.embeddings',
  nativeEndpoint: '/v1/embeddings',
});

// ---------------------------------------------------------------------------
// §16.1/§16.2 — deterministic interleaved isolation on one direct route.
// ---------------------------------------------------------------------------

describe('P0-PRE-F4 — deterministic request-identity isolation (interleaved, real barriers)', () => {
  it('A keeps identity A after B establishes identity B; both captures carry exactly their own key', async () => {
    resetLogs();
    timeline.length = 0;
    const org = await seedOrg(stack);
    const KEY_A = `f4-a-${randomUUID()}`;
    const KEY_B = `f4-b-${randomUUID()}`;
    const latchA = `A-${randomUUID()}`;
    const latchB = `B-${randomUUID()}`;
    const gA = gate(latchA);
    const gB = gate(latchB);

    // Request A establishes identity A, then parks inside its upstream forward.
    const pA = app.inject(
      anthropicMessagesReq(org.api_key, 'request A', {
        'x-govai-idempotency-key': KEY_A,
        'x-test-latch': latchA,
      }),
    );
    await gA.arrived; // BARRIER: A advanced past the identity hook into its forward.

    // Request B establishes identity B while A is parked.
    const pB = app.inject(
      anthropicMessagesReq(org.api_key, 'request B', {
        'x-govai-idempotency-key': KEY_B,
        'x-test-latch': latchB,
      }),
    );
    await gB.arrived; // BARRIER: B advanced past the identity hook too; both in flight.

    // A resumes and reads the store AFTER B entered its context; B is still parked
    // for A's entire read-and-capture (response A completes before B is released).
    gA.release();
    const resA = await pA;
    gB.release();
    const resB = await pB;

    // The interleaving that actually happened is the one claimed.
    expect(timeline).toEqual([
      `arrive:${latchA}`,
      `arrive:${latchB}`,
      `release:${latchA}`,
      `resume:${latchA}`,
      `release:${latchB}`,
      `resume:${latchB}`,
    ]);

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    const reqIdA = String(resA.headers['x-govai-request-id']);
    const reqIdB = String(resB.headers['x-govai-request-id']);
    expect(reqIdA).toMatch(UUID_V4_RE);
    expect(reqIdB).toMatch(UUID_V4_RE);
    expect(reqIdA).not.toBe(reqIdB);

    // Ownership by derivation: each row's capture_id is the one the PRODUCTION
    // helpers derive from that request's OWN key — no swaps possible.
    const coords = ANTHROPIC_MSG_COORDS(org.org_id);
    const rows = await outboxRows(org.org_id);
    expect(rows).toHaveLength(2);
    const rowA = rows.find((r) => r.capture_id === keyedCaptureId(coords, KEY_A));
    const rowB = rows.find((r) => r.capture_id === keyedCaptureId(coords, KEY_B));
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    expect(rowA!.redaction_metadata.audit_bridge?.idempotency_key_hash).toBe(keyHash(KEY_A));
    expect(rowB!.redaction_metadata.audit_bridge?.idempotency_key_hash).toBe(keyHash(KEY_B));
    expect(rowA!.redaction_metadata.audit_bridge?.identity_scope).toBe('client_idempotency_key');
    expect(rowB!.redaction_metadata.audit_bridge?.identity_scope).toBe('client_idempotency_key');

    // Capture-log pairing: A's capture was performed under A's govaiRequestId
    // (the one echoed to A), and B's under B's.
    const caps = captureLogs();
    expect(caps.find((c) => c.capture_id === rowA!.capture_id)?.govai_request_id).toBe(reqIdA);
    expect(caps.find((c) => c.capture_id === rowB!.capture_id)?.govai_request_id).toBe(reqIdB);

    // No valid request lost its identity.
    expect(missingIdentityLogs()).toHaveLength(0);

    // No store bleeds into the test's own (non-request) context after both
    // requests finished — the ALS lifecycle is request-owned.
    expect(requestIdentityAls.getStore()).toBeUndefined();
  });

  it('non-direct route stays outside the identity scope even while a direct request is parked', async () => {
    resetLogs();
    const org = await seedOrg(stack);
    const latch = `N-${randomUUID()}`;
    const g = gate(latch);

    const pDirect = app.inject(
      anthropicMessagesReq(org.api_key, 'parked while health runs', {
        'x-govai-idempotency-key': `f4-n-${randomUUID()}`,
        'x-test-latch': latch,
      }),
    );
    await g.arrived;

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['x-govai-request-id']).toBeUndefined();

    g.release();
    const resDirect = await pDirect;
    expect(resDirect.statusCode).toBe(200);
    expect(await outboxRows(org.org_id)).toHaveLength(1); // only the direct request captured
    expect(missingIdentityLogs()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §16.3 — cross-route (cross-provider) isolation under overlap.
// ---------------------------------------------------------------------------

describe('P0-PRE-F4 — cross-route isolation (Anthropic ∥ OpenAI, inverted release order)', () => {
  it('overlapping Anthropic and OpenAI direct requests keep independent identities', async () => {
    resetLogs();
    timeline.length = 0;
    const org = await seedOrg(stack);
    const KEY_ANT = `f4-ant-${randomUUID()}`;
    const KEY_OAI = `f4-oai-${randomUUID()}`;
    const latchAnt = `ANT-${randomUUID()}`;
    const latchOai = `OAI-${randomUUID()}`;
    const gAnt = gate(latchAnt);
    const gOai = gate(latchOai);

    const pAnt = app.inject(
      anthropicMessagesReq(org.api_key, 'cross-route anthropic', {
        'x-govai-idempotency-key': KEY_ANT,
        'x-test-latch': latchAnt,
      }),
    );
    await gAnt.arrived;

    const pOai = app.inject({
      method: 'POST',
      url: '/passthrough/openai/v1/embeddings',
      headers: {
        'x-govai-api-key': org.api_key,
        'content-type': 'application/json',
        'x-govai-idempotency-key': KEY_OAI,
        'x-test-latch': latchOai,
      },
      payload: JSON.stringify({ model: 'text-embedding-3-small', input: 'cross-route openai' }),
    });
    await gOai.arrived;

    // Inverted release: the LATER-established identity resolves first.
    gOai.release();
    const resOai = await pOai;
    gAnt.release();
    const resAnt = await pAnt;

    expect(timeline).toEqual([
      `arrive:${latchAnt}`,
      `arrive:${latchOai}`,
      `release:${latchOai}`,
      `resume:${latchOai}`,
      `release:${latchAnt}`,
      `resume:${latchAnt}`,
    ]);

    expect(resAnt.statusCode).toBe(200);
    expect(resOai.statusCode).toBe(200);
    const reqIdAnt = String(resAnt.headers['x-govai-request-id']);
    const reqIdOai = String(resOai.headers['x-govai-request-id']);
    expect(reqIdAnt).not.toBe(reqIdOai);

    const rows = await outboxRows(org.org_id);
    expect(rows).toHaveLength(2);
    const rowAnt = rows.find(
      (r) => r.capture_id === keyedCaptureId(ANTHROPIC_MSG_COORDS(org.org_id), KEY_ANT),
    );
    const rowOai = rows.find(
      (r) => r.capture_id === keyedCaptureId(OPENAI_EMB_COORDS(org.org_id), KEY_OAI),
    );
    expect(rowAnt).toBeDefined();
    expect(rowOai).toBeDefined();
    expect(rowAnt!.redaction_metadata.audit_bridge?.provider).toBe('anthropic');
    expect(rowOai!.redaction_metadata.audit_bridge?.provider).toBe('openai');
    expect(rowAnt!.redaction_metadata.audit_bridge?.idempotency_key_hash).toBe(keyHash(KEY_ANT));
    expect(rowOai!.redaction_metadata.audit_bridge?.idempotency_key_hash).toBe(keyHash(KEY_OAI));

    const caps = captureLogs();
    expect(caps.find((c) => c.capture_id === rowAnt!.capture_id)?.govai_request_id).toBe(reqIdAnt);
    expect(caps.find((c) => c.capture_id === rowOai!.capture_id)?.govai_request_id).toBe(reqIdOai);
    expect(missingIdentityLogs()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §16.4 — keyed vs keyless overlap.
// ---------------------------------------------------------------------------

describe('P0-PRE-F4 — keyed ∥ keyless overlap', () => {
  it('keyless never inherits the keyed hash; each capture derives from its own identity', async () => {
    resetLogs();
    const org = await seedOrg(stack);
    const KEY = `f4-keyed-${randomUUID()}`;
    const latchK = `K-${randomUUID()}`;
    const gK = gate(latchK);

    // Keyed request parks first (its hash is live in ITS context).
    const pKeyed = app.inject(
      anthropicMessagesReq(org.api_key, 'keyed parked', {
        'x-govai-idempotency-key': KEY,
        'x-test-latch': latchK,
      }),
    );
    await gK.arrived;

    // Keyless request runs to completion WHILE the keyed one is parked.
    const resKeyless = await app.inject(
      anthropicMessagesReq(org.api_key, 'keyless while keyed parked'),
    );
    expect(resKeyless.statusCode).toBe(200);
    const reqIdKeyless = String(resKeyless.headers['x-govai-request-id']);
    expect(reqIdKeyless).toMatch(UUID_V4_RE);

    gK.release();
    const resKeyed = await pKeyed;
    expect(resKeyed.statusCode).toBe(200);
    const reqIdKeyed = String(resKeyed.headers['x-govai-request-id']);
    expect(reqIdKeyed).not.toBe(reqIdKeyless);

    const coords = ANTHROPIC_MSG_COORDS(org.org_id);
    const rows = await outboxRows(org.org_id);
    expect(rows).toHaveLength(2);

    // Keyless: identity is that response's own govaiRequestId — provably, since
    // its captureId derives from the id echoed to THAT response — and NO hash.
    const rowKeyless = rows.find(
      (r) => r.capture_id === requestScopedCaptureId(coords, reqIdKeyless),
    );
    expect(rowKeyless).toBeDefined();
    expect(rowKeyless!.redaction_metadata.audit_bridge?.identity_scope).toBe('govai_request_id');
    expect(rowKeyless!.redaction_metadata.audit_bridge?.idempotency_key_hash).toBeUndefined();

    // Keyed: scope client_idempotency_key with exactly its own hash.
    const rowKeyed = rows.find((r) => r.capture_id === keyedCaptureId(coords, KEY));
    expect(rowKeyed).toBeDefined();
    expect(rowKeyed!.redaction_metadata.audit_bridge?.identity_scope).toBe('client_idempotency_key');
    expect(rowKeyed!.redaction_metadata.audit_bridge?.idempotency_key_hash).toBe(keyHash(KEY));

    const caps = captureLogs();
    expect(caps.find((c) => c.capture_id === rowKeyless!.capture_id)?.govai_request_id).toBe(
      reqIdKeyless,
    );
    expect(caps.find((c) => c.capture_id === rowKeyed!.capture_id)?.govai_request_id).toBe(
      reqIdKeyed,
    );
    expect(missingIdentityLogs()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §16.5 — governed blocked path (no provider forwarding) under overlap.
// ---------------------------------------------------------------------------

describe('P0-PRE-F4 — governed blocked path keeps the originating identity', () => {
  it('deterministic 403 block emits terminal evidence under the blocked request identity', async () => {
    resetLogs();
    const org = await seedOrg(stack);
    const KEY_BLOCKED = `f4-blocked-${randomUUID()}`;
    const latch = `P-${randomUUID()}`;
    const g = gate(latch);

    // Park an unrelated passthrough request so the blocked request runs under
    // real concurrency, not in isolation.
    const pParked = app.inject(
      anthropicMessagesReq(org.api_key, 'parked bystander', {
        'x-govai-idempotency-key': `f4-bystander-${randomUUID()}`,
        'x-test-latch': latch,
      }),
    );
    await g.arrived;
    const hitsBefore = upstreamHits.length;

    // Deterministic block: computer-use tool on governed anthropic (403, no forward).
    const resBlocked = await app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: {
        'x-govai-api-key': org.api_key,
        'content-type': 'application/json',
        'x-govai-idempotency-key': KEY_BLOCKED,
      },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'x' }],
        tools: [{ type: 'computer_20251124', name: 'puter' }],
      }),
    });
    expect(resBlocked.statusCode).toBe(403);
    const reqIdBlocked = String(resBlocked.headers['x-govai-request-id']);
    expect(reqIdBlocked).toMatch(UUID_V4_RE);
    // No provider forwarding happened for the blocked request.
    expect(upstreamHits.length).toBe(hitsBefore);

    g.release();
    expect((await pParked).statusCode).toBe(200);

    // The blocked terminal evidence carries the blocked request's OWN identity.
    const rows = await outboxRows(org.org_id);
    const rowBlocked = rows.find(
      (r) =>
        r.capture_id ===
        keyedCaptureId(
          {
            orgId: org.org_id,
            provider: 'anthropic',
            capabilityId: 'anthropic.messages.create',
            nativeEndpoint: '/v1/messages',
          },
          KEY_BLOCKED,
        ),
    );
    expect(rowBlocked).toBeDefined();
    expect(rowBlocked!.redaction_metadata.audit_bridge?.idempotency_key_hash).toBe(
      keyHash(KEY_BLOCKED),
    );
    const caps = captureLogs();
    expect(caps.find((c) => c.capture_id === rowBlocked!.capture_id)?.govai_request_id).toBe(
      reqIdBlocked,
    );
    const blockedEv = invokedEvents(org.org_id).find(
      (ev) => ev['enforcement_decision'] === 'blocked',
    );
    expect(blockedEv).toBeDefined();
    expect(blockedEv!['body_forward_mode']).toBe('blocked');
    expect(missingIdentityLogs()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §10/§16.6 — streaming terminal paths at API-wiring level (the route-closure
// emitAuditEvent that reads requestIdentityAls.getStore()).
// ---------------------------------------------------------------------------

describe('P0-PRE-F4 — streaming terminal identity (delayed emission, overlapped)', () => {
  it('two parked streams + interleaved traffic: each delayed terminal keeps its own identity', async () => {
    resetLogs();
    timeline.length = 0;
    const org = await seedOrg(stack);
    const KEY_SA = `f4-sa-${randomUUID()}`;
    const KEY_SB = `f4-sb-${randomUUID()}`;
    const latchSA = `SA-${randomUUID()}`;
    const latchSB = `SB-${randomUUID()}`;
    const gSA = gate(latchSA);
    const gSB = gate(latchSB);

    const pSA = app.inject(
      anthropicMessagesReq(
        org.api_key,
        'stream A',
        { 'x-govai-idempotency-key': KEY_SA, 'x-test-latch': latchSA },
        true,
      ),
    );
    await gSA.arrived; // stream A parked mid-drain, terminal pending

    const pSB = app.inject(
      anthropicMessagesReq(
        org.api_key,
        'stream B',
        { 'x-govai-idempotency-key': KEY_SB, 'x-test-latch': latchSB },
        true,
      ),
    );
    await gSB.arrived; // stream B parked mid-drain too

    // Unrelated keyless non-stream traffic completes in between, churning
    // contexts while both streams hold delayed terminals.
    const resChurn = await app.inject(
      anthropicMessagesReq(org.api_key, 'churn between parked streams'),
    );
    expect(resChurn.statusCode).toBe(200);

    const streamCoords = ANTHROPIC_STREAM_COORDS(org.org_id);
    const expectedA = keyedCaptureId(streamCoords, KEY_SA);
    const expectedB = keyedCaptureId(streamCoords, KEY_SB);

    // Inverted completion: B's ENTIRE lifecycle (incl. terminal emit) finishes
    // while A is still parked; then A's delayed terminal must still be A's.
    // NOTE (observed at the F4 base, unchanged here): hijacked streaming replies
    // flush upstream headers via reply.raw.writeHead, so X-GovAI-Request-Id is
    // NOT echoed on stream responses — pairing below therefore uses the terminal
    // emit ORDER (B's capture exists while A is provably still parked) plus the
    // key-derived captureIds, which is a strictly stronger ownership proof.
    gSB.release();
    const resSB = await pSB;
    // The pump awaits the terminal emit BEFORE ending the reply, so B's capture
    // log line exists now — and A's must NOT (A is still parked at its gate).
    const capsAfterB = captureLogs();
    expect(capsAfterB.some((c) => c.capture_id === expectedB)).toBe(true);
    expect(capsAfterB.some((c) => c.capture_id === expectedA)).toBe(false);
    gSA.release();
    const resSA = await pSA;

    expect(timeline).toEqual([
      `arrive:${latchSA}`,
      `arrive:${latchSB}`,
      `release:${latchSB}`,
      `resume:${latchSB}`,
      `release:${latchSA}`,
      `resume:${latchSA}`,
    ]);

    expect(resSA.statusCode).toBe(200);
    expect(resSB.statusCode).toBe(200);
    expect(String(resSA.headers['content-type'])).toContain('text/event-stream');
    expect(resSA.body).toContain('"n":2'); // full stream delivered after resume
    const rows = await pollUntil(
      async () => {
        const r = await outboxRows(org.org_id);
        return r.length >= 3 ? r : undefined;
      },
      'both stream captures + churn capture',
    );
    expect(rows).toHaveLength(3); // stream A + stream B + churn — exactly one each
    const rowSA = rows.find((r) => r.capture_id === expectedA);
    const rowSB = rows.find((r) => r.capture_id === expectedB);
    expect(rowSA).toBeDefined();
    expect(rowSB).toBeDefined();
    expect(rowSA!.redaction_metadata.audit_bridge?.idempotency_key_hash).toBe(keyHash(KEY_SA));
    expect(rowSB!.redaction_metadata.audit_bridge?.idempotency_key_hash).toBe(keyHash(KEY_SB));

    const caps = captureLogs();
    expect(caps.filter((c) => c.capture_id === expectedA)).toHaveLength(1); // exactly once
    expect(caps.filter((c) => c.capture_id === expectedB)).toHaveLength(1);
    // Each terminal ran under its OWN per-request identity: two distinct v4 ids.
    const streamReqIdA = caps.find((c) => c.capture_id === expectedA)!.govai_request_id;
    const streamReqIdB = caps.find((c) => c.capture_id === expectedB)!.govai_request_id;
    expect(streamReqIdA).toMatch(UUID_V4_RE);
    expect(streamReqIdB).toMatch(UUID_V4_RE);
    expect(streamReqIdA).not.toBe(streamReqIdB);

    const streamEvents = invokedEvents(org.org_id).filter((ev) => ev['is_stream'] === true);
    expect(streamEvents).toHaveLength(2);
    for (const ev of streamEvents) expect(ev['stream_outcome']).toBe('complete');
    expect(missingIdentityLogs()).toHaveLength(0);
  });

  it('abnormal terminal (upstream error mid-stream) still captures under the originating identity, exactly once', async () => {
    resetLogs();
    const org = await seedOrg(stack);
    const KEY_ERR = `f4-err-${randomUUID()}`;
    const latch = `ERR-${randomUUID()}`;
    const g = gate(latch);

    const pErr = app.inject(
      anthropicMessagesReq(
        org.api_key,
        'stream that dies upstream',
        {
          'x-govai-idempotency-key': KEY_ERR,
          'x-test-latch': latch,
          'x-test-upstream-mode': 'destroy',
        },
        true,
      ),
    );
    await g.arrived; // headers + first chunk delivered; stream is live
    g.release(); // upstream destroys its socket mid-stream

    // The client-side stream is truncated (the route destroys the reply so the
    // failure is observable); settle either way — the EVIDENCE is the assertion.
    await pErr.then(
      (r) => r,
      (e) => e,
    );

    const expectedErrId = keyedCaptureId(ANTHROPIC_STREAM_COORDS(org.org_id), KEY_ERR);
    const rowErr = await pollUntil(async () => {
      const rows = await outboxRows(org.org_id);
      return rows.find((r) => r.capture_id === expectedErrId);
    }, 'upstream_error terminal capture row');
    expect(rowErr.redaction_metadata.audit_bridge?.idempotency_key_hash).toBe(keyHash(KEY_ERR));

    const caps = captureLogs().filter((c) => c.capture_id === expectedErrId);
    expect(caps).toHaveLength(1); // exactly one terminal capture
    expect(caps[0]!.govai_request_id).toMatch(UUID_V4_RE);

    const errEvents = invokedEvents(org.org_id).filter((ev) => ev['is_stream'] === true);
    expect(errEvents).toHaveLength(1);
    expect(errEvents[0]!['stream_outcome']).toBe('upstream_error');
    expect(missingIdentityLogs()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Real-socket sequential probe: the classic unbounded-context vector is a
// keep-alive connection carrying request N's store into request N+1. Behavioral
// proof over a REAL socket (not inject): a keyless request following a keyed
// request on the same origin/agent must not inherit anything.
// ---------------------------------------------------------------------------

describe('P0-PRE-F4 — real-socket keep-alive sequence (keyed → keyless → non-direct)', () => {
  it('keyless request after a keyed request on a real connection inherits nothing', async () => {
    resetLogs();
    const org = await seedOrg(stack);
    const KEY = `f4-socket-${randomUUID()}`;

    const r1 = await fetch(`${listenBaseUrl}/passthrough/anthropic/v1/messages`, {
      method: 'POST',
      headers: {
        'x-govai-api-key': org.api_key,
        'content-type': 'application/json',
        'x-govai-idempotency-key': KEY,
      },
      body: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'keyed on real socket' }],
      }),
    });
    expect(r1.status).toBe(200);
    await r1.arrayBuffer();
    const reqId1 = String(r1.headers.get('x-govai-request-id'));

    const r2 = await fetch(`${listenBaseUrl}/passthrough/anthropic/v1/messages`, {
      method: 'POST',
      headers: {
        'x-govai-api-key': org.api_key,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'keyless follows keyed' }],
      }),
    });
    expect(r2.status).toBe(200);
    await r2.arrayBuffer();
    const reqId2 = String(r2.headers.get('x-govai-request-id'));
    expect(reqId2).toMatch(UUID_V4_RE);
    expect(reqId2).not.toBe(reqId1);

    const r3 = await fetch(`${listenBaseUrl}/health`);
    expect(r3.status).toBe(200);
    await r3.arrayBuffer();
    expect(r3.headers.get('x-govai-request-id')).toBeNull();

    const coords = ANTHROPIC_MSG_COORDS(org.org_id);
    const rows = await pollUntil(
      async () => {
        const r = await outboxRows(org.org_id);
        return r.length >= 2 ? r : undefined;
      },
      'both real-socket captures',
    );
    expect(rows).toHaveLength(2);
    const rowKeyed = rows.find((r) => r.capture_id === keyedCaptureId(coords, KEY));
    const rowKeyless = rows.find((r) => r.capture_id === requestScopedCaptureId(coords, reqId2));
    expect(rowKeyed).toBeDefined();
    expect(rowKeyless).toBeDefined();
    expect(rowKeyless!.redaction_metadata.audit_bridge?.identity_scope).toBe('govai_request_id');
    expect(rowKeyless!.redaction_metadata.audit_bridge?.idempotency_key_hash).toBeUndefined();
    expect(missingIdentityLogs()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle boundary: after ALL prior request activity, no store is visible
// from any non-request context (declared last on purpose).
// ---------------------------------------------------------------------------

describe('P0-PRE-F4 — no store survives outside the request-owned lifecycle', () => {
  it('test context and a pre-request-created continuation both see undefined', async () => {
    // Direct probe: the current (non-request) execution context.
    expect(requestIdentityAls.getStore()).toBeUndefined();

    // Unrelated continuation created in beforeAll, BEFORE any request existed.
    unrelatedProbe.trigger();
    await expect(unrelatedProbe.result).resolves.toBeUndefined();

    // And a fresh macrotask context is clean too.
    const fromFreshTask = await new Promise<AuditBridgeRequestIdentity | undefined>((resolve) => {
      setTimeout(() => resolve(requestIdentityAls.getStore()), 0);
    });
    expect(fromFreshTask).toBeUndefined();
  });
});
