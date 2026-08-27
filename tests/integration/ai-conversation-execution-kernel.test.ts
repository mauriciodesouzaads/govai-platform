// EP-AI-CONVERSATION-CONTINUITY-V1 P0-C — THE DURABLE EXECUTION KERNEL
// (spec §7.7 claim/lease/fencing, §8 five-commit protocol, §9 dispatch boundary, §14 identity).
//
// This suite drives the REAL detached executor — the same `processCandidate` /
// `runConversationSweepOnce` the worker process runs — against the REAL worker database identity
// (`govai_conversation_worker`) and the hermetic provider-protocol server.
//
// ★ DETERMINISTIC BY CONSTRUCTION. The sweep is invoked explicitly; no timer is started, exactly
// as the P0.3-A run-dispatch recovery suite does (`RUN_DISPATCH_RECOVERY_ENABLED: false`). A test
// that waited on an interval would be a flaky test.
//
// ★ WHAT IS NOT CLAIMED, ANYWHERE IN THIS FILE: provider exactly-once. The protocol guarantees
// at-most-one INTENTIONAL dispatch, durable-state integrity under a fence, and honest ambiguity.
// It does not — and cannot — guarantee that a provider which received bytes did not process them.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DevKms } from '@govai/core-identity';
import {
  startStack,
  stopStack,
  seedOrg,
  seedProviderCredential,
  inject,
  type SeededOrg,
  type Stack,
} from './helpers/server-fixture.js';
import { migrate } from './setup.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createConversationWorkerDb,
  type ConversationWorkerDb,
} from '../../apps/api/src/pipeline/ai-conversation-worker.js';
import {
  processCandidate,
  type ConversationExecutorDeps,
  type ExecutionOutcome,
} from '../../apps/api/src/ai-conversations/execution/execute-turn.js';
import {
  runConversationSweepOnce,
  startConversationWorker,
} from '../../apps/api/src/ai-conversations/execution/runner.js';
import { discoverRecoveryCandidates } from '../../apps/api/src/pipeline/ai-conversation-recovery-discovery.js';
import {
  seedConversation,
  seedTurn,
  seedAttempt,
} from './helpers/ai-conversation-seed.js';

let stack: Stack;
let org: SeededOrg;
let db: ConversationWorkerDb;
let probe: Pool;
let deps: ConversationExecutorDeps;
let credentialId: string;

const LEASE_MS = 60_000;
const GRACE_MS = 1_000;
/** Mirrors `KMS_DECRYPT_CONCURRENCY` in turn-service.ts. */
const KMS_CAP = 8;

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as ConversationExecutorDeps['log'];

const nativeRequest = (text: string, stream = false) => ({
  model: 'claude-test',
  max_tokens: 64,
  messages: [{ role: 'user', content: text }],
  ...(stream ? { stream: true } : {}),
});

const openaiRequest = (text: string, stream = false) => ({
  model: 'gpt-test',
  input: text,
  ...(stream ? { stream: true } : {}),
});

async function createConversation(opts: {
  mode?: 'governed' | 'passthrough';
  provider?: 'anthropic' | 'openai';
  surface?: string;
}): Promise<{ id: string; branchId: string }> {
  const provider = opts.provider ?? 'anthropic';
  const res = await inject(stack, 'POST', '/v1/ai/conversations', org.api_key, {
    mode: opts.mode ?? 'governed',
    provider,
    surface: opts.surface ?? (provider === 'anthropic' ? 'anthropic_messages' : 'openai_responses'),
    model: provider === 'anthropic' ? 'claude-test' : 'gpt-test',
  });
  expect(res.statusCode).toBe(201);
  const body = res.body as { id: string; root_branch: { id: string } };
  return { id: body.id, branchId: body.root_branch.id };
}

async function send(
  conversationId: string,
  branchId: string,
  request: unknown,
): Promise<{ turnId: string; attemptId: string }> {
  const res = await inject(stack, 'POST', `/v1/ai/conversations/${conversationId}/turns`, org.api_key, {
    client_turn_id: randomUUID(),
    branch_id: branchId,
    native_request: request,
  });
  expect(res.statusCode).toBe(201);
  const body = res.body as { id: string; current_attempt_id: string };
  return { turnId: body.id, attemptId: body.current_attempt_id };
}

type AttemptRow = {
  state: string;
  claim_token: string | null;
  claimant: string | null;
  stop_requested: boolean;
  dispatch_boundary_committed_at: Date | null;
  provider_credential_id: string | null;
  govai_request_id: string | null;
  causal_version_at_build: string | null;
  error_class: string | null;
  terminal_at: Date | null;
};

async function attempt(attemptId: string): Promise<AttemptRow> {
  const r = await stack.db.adminPool.query<AttemptRow>(
    `SELECT state, claim_token::text, claimant, stop_requested, dispatch_boundary_committed_at,
            provider_credential_id::text, govai_request_id::text, causal_version_at_build::text,
            error_class, terminal_at
       FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
    [attemptId],
  );
  return r.rows[0]!;
}

/** Drive ONE sweep and return the outcome recorded for `attemptId`, if it was processed. */
async function sweep(): Promise<Record<string, number>> {
  const report = await runConversationSweepOnce(deps, {
    batchSize: 50,
    intervalMs: 1_000,
    maxPagesPerSweep: 5,
  });
  return report.outcomes;
}

/** Process exactly the candidate for `attemptId` (skipping any other pending work). */
async function driveOne(attemptId: string): Promise<ExecutionOutcome | 'not_discovered'> {
  const candidates = await discoverRecoveryCandidates(db, {
    recoveryGraceMs: GRACE_MS,
    limit: 200,
  });
  const c = candidates.find((x) => x.attemptId === attemptId);
  if (!c) return 'not_discovered';
  return processCandidate(deps, {
    orgId: c.orgId,
    ownerUserId: c.ownerUserId,
    conversationId: c.conversationId,
    attemptId: c.attemptId,
    state: c.state,
    reason: c.reason,
    claimToken: c.claimToken,
    isBranchHead: c.isBranchHead,
  });
}

/**
 * Run `fn` inside an owner-scoped transaction on the RAW worker probe pool, and ALWAYS roll back.
 *
 * ★ THE `finally` IS LOAD-BEARING. These tests deliberately provoke `42501`, which ABORTS the
 * transaction. A client released while aborted poisons the pooled connection, and the NEXT test
 * to borrow it fails with "current transaction is aborted" — a failure that has nothing to do
 * with what that test is asserting. (Observed exactly once during development; this wrapper is
 * the fix.)
 */
async function withProbeTx(fn: (c: import('pg').PoolClient) => Promise<void>): Promise<void> {
  const c = await probe.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);
    await c.query("SELECT set_config('app.user_id', $1, true)", [org.user_id]);
    await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}

/**
 * A durable conversation whose branch surface is NOT dispatchable by P0-C, seeded DIRECTLY.
 *
 * ★ WHY NOT "UPDATE the branch's surface". 0031's branches guard FREEZES provider/surface/model
 * for a branch's whole lifetime and rejects any other change — correctly, and it proved it by
 * rejecting an earlier version of this helper. So the only faithful way to produce this state is
 * to CREATE it that way, which is also the realistic shape: a conversation created before the
 * dispatch registry recognised its surface.
 */
async function seedUndrivableTurn(): Promise<{ attemptId: string }> {
  const ids = { orgId: org.org_id, ownerUserId: org.user_id };
  // `seedConversation` writes surface 'anthropic_api' — a real token in this repo, and NOT a
  // P0-C dispatch surface.
  const { conversationId, branchId } = await seedConversation(stack.db.adminPool, ids);
  const { turnId } = await seedTurn(stack.db.adminPool, ids, conversationId, branchId, 1);
  const attemptId = await seedAttempt(stack.db.adminPool, ids, conversationId, branchId, turnId);
  await stack.db.adminPool.query(
    `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
    [attemptId, turnId],
  );
  return { attemptId };
}

/**
 * A DISPATCHABLE turn whose stored native request config cannot be decrypted.
 *
 * ★ WHY IT IS SEEDED RATHER THAN CORRUPTED IN PLACE. 0031's content guard refuses any UPDATE
 * outside the shred/tombstone lifecycle, so rewriting a live row's ciphertext is (correctly)
 * impossible — the schema would not let the corruption exist. `seedContent` writes RANDOM bytes
 * with a real wrapped DEK, which is exactly the shape a key-rotation fault leaves behind: the
 * envelope is present and well-formed, and it simply does not decrypt. That is the branch this
 * exercises; a crypto-shredded row (dek NULL) is caught earlier, by its own predicate.
 */
async function seedTurnWithUndecryptableConfig(): Promise<{ attemptId: string }> {
  const ids = { orgId: org.org_id, ownerUserId: org.user_id };
  const conv = await stack.db.adminPool.query<{ id: string }>(
    `INSERT INTO govai.ai_conversations (org_id, owner_user_id, mode, provider, surface, model)
     VALUES ($1::uuid, $2::uuid, 'governed', 'anthropic', 'anthropic_messages', 'claude-test')
     RETURNING id`,
    [ids.orgId, ids.ownerUserId],
  );
  const conversationId = conv.rows[0]!.id;
  const branch = await stack.db.adminPool.query<{ id: string }>(
    `INSERT INTO govai.ai_conversation_branches
       (org_id, owner_user_id, conversation_id, provider, surface, model)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_messages', 'claude-test')
     RETURNING id`,
    [ids.orgId, ids.ownerUserId, conversationId],
  );
  const branchId = branch.rows[0]!.id;
  const { turnId } = await seedTurn(stack.db.adminPool, ids, conversationId, branchId, 1);
  const attemptId = await seedAttempt(stack.db.adminPool, ids, conversationId, branchId, turnId);
  await stack.db.adminPool.query(
    `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
    [attemptId, turnId],
  );
  return { attemptId };
}

/** Everything this attempt durably persisted as output, concatenated in item_seq order. */
async function outputText(attemptId: string): Promise<string> {
  const res = await inject(
    stack,
    'GET',
    `/v1/ai/conversations/${(await lineage(attemptId)).conversation_id}/turns/${(await lineage(attemptId)).turn_id}`,
    org.api_key,
  );
  const body = res.body as {
    attempts: Array<{ id: string; output_items: Array<{ item_type: string; native: unknown; text: string | null }> }>;
  };
  const a = body.attempts.find((x) => x.id === attemptId);
  if (!a) return '';
  return a.output_items
    .map((i) => (i.item_type === 'native_stream_chunk' ? (i.text ?? '') : JSON.stringify(i.native)))
    .join('');
}

async function lineage(attemptId: string): Promise<{ conversation_id: string; turn_id: string; branch_id: string }> {
  const r = await stack.db.adminPool.query<{ conversation_id: string; turn_id: string; branch_id: string }>(
    `SELECT conversation_id::text, turn_id::text, branch_id::text
       FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
    [attemptId],
  );
  return r.rows[0]!;
}

beforeAll(async () => {
  stack = await startStack();
  // Provision the worker role LOGIN through the SAME shared lifecycle production uses.
  await migrate(
    stack.db.adminUrl,
    stack.db.appPassword,
    undefined,
    undefined,
    stack.db.conversationWorkerPassword,
  );
  org = await seedOrg(stack);
  const cred = await seedProviderCredential(stack, {
    orgId: org.org_id,
    provider: 'anthropic',
    plaintextKey: 'sk-ant-p0c-exec',
    setByUserId: org.user_id,
  });
  credentialId = cred.id;
  await seedProviderCredential(stack, {
    orgId: org.org_id,
    provider: 'openai',
    plaintextKey: 'sk-openai-p0c-exec',
    setByUserId: org.user_id,
  });

  db = createConversationWorkerDb({
    config: { connectionString: stack.db.conversationWorkerUrl, workerId: 'p0c-test' },
    // The capability's `log` is Fastify's full logger shape; the executor needs only three
    // methods. One cast at the seam, rather than a fake logger in every test.
    log: silentLog as unknown as Parameters<typeof createConversationWorkerDb>[0]['log'],
  });
  probe = new Pool({ connectionString: stack.db.conversationWorkerUrl, max: 2 });
  probe.on('error', () => undefined);

  deps = {
    db,
    kms: new DevKms(stack.seed),
    upstreamBaseUrlFor: () => stack.provider.baseUrl,
    log: silentLog,
    claimant: 'p0c-test-worker',
    leaseMs: LEASE_MS,
    recoveryGraceMs: GRACE_MS,
    heartbeatIntervalMs: 15_000,
    dispatchTimeoutMs: 10_000,
    streamFlushBytes: 64,
  };
}, 300_000);

afterAll(async () => {
  await db?.close().catch(() => undefined);
  await probe?.end().catch(() => undefined);
  if (stack) await stopStack(stack);
});

beforeEach(() => {
  stack.provider.clearRecordedRequests();
  stack.provider.clearRecordedRequestHeaders();
});

/**
 * Run `fn` with the executor pointed at a TEST-CONTROLLED provider endpoint.
 *
 * ★ WHY NOT THE HERMETIC FIXTURE'S OVERRIDES. Every override there
 * (`setErrorOverride` / `setDestroyOverride` / `setParkOverride`, and the `x-test-error`
 * channel) is keyed on `x-test-workspace-id` — a GovAI test header the DIRECT routes forward
 * only in `NODE_ENV=test` on a loopback URL. The detached worker deliberately sends NO GovAI
 * metadata upstream (E1.2 asserts exactly that), so it can never trigger them. Injecting the
 * base URL is therefore not a shortcut around the fixture; it is the only way to fault-inject
 * against a client whose whole contract is to send nothing identifying.
 */
async function withProviderBehaviour<T>(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  fn: () => Promise<T>,
): Promise<T> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const original = deps.upstreamBaseUrlFor;
  deps.upstreamBaseUrlFor = () => `http://127.0.0.1:${port}`;
  try {
    return await fn();
  } finally {
    deps.upstreamBaseUrlFor = original;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// HAPPY PATH — the full five-commit protocol
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('E1 — the five-commit protocol, end to end', () => {
  it('E1.1 — governed non-stream: accepted → dispatching → streaming → completed, output durable', async () => {
    const conv = await createConversation({ mode: 'governed' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('E1.1'));

    expect(await driveOne(attemptId)).toBe('completed');

    const a = await attempt(attemptId);
    expect(a.state).toBe('completed');
    expect(a.terminal_at).not.toBeNull();
    expect(a.error_class).toBeNull();
    // §8: the boundary was crossed and provenance was recorded — BOTH, and both before the POST.
    expect(a.dispatch_boundary_committed_at).not.toBeNull();
    expect(a.provider_credential_id).toBe(credentialId);
    // §14.1: the request identity was minted at the boundary, exactly once.
    expect(a.govai_request_id).toMatch(/^[0-9a-f-]{36}$/);
    // §7.8: the as-built causal version was stamped by the crossing.
    expect(a.causal_version_at_build).toBe('0');

    // Exactly ONE provider request, to the right endpoint.
    expect(stack.provider.recordedRequests).toHaveLength(1);
    expect(stack.provider.recordedRequests[0]!.url).toBe('/v1/messages');
    expect(stack.provider.recordedRequests[0]!.method).toBe('POST');

    // The answer is durable and provider-native.
    const text = await outputText(attemptId);
    expect(text).toContain('echo: E1.1');

    // §7.8: terminalization bumped the branch's causal version, releasing the queue.
    const branch = await stack.db.adminPool.query<{ v: string }>(
      `SELECT causal_version::text AS v FROM govai.ai_conversation_branches WHERE id = $1::uuid`,
      [conv.branchId],
    );
    expect(branch.rows[0]!.v).toBe('1');
  });

  it('E1.2 — the worker POSTs the EXACT durable native request, with no GovAI metadata', async () => {
    const conv = await createConversation({ mode: 'passthrough' });
    const request = nativeRequest('E1.2-fidelity');
    await send(conv.id, conv.branchId, request);
    await sweep();

    const headers = stack.provider.recordedRequestHeaders;
    expect(headers).toHaveLength(1);
    const h = headers[0]! as Record<string, string>;
    // Provider auth is present; GovAI's own identity NEVER is.
    expect(h['x-api-key']).toBe('sk-ant-p0c-exec');
    for (const banned of [
      'x-govai-api-key',
      'x-govai-idempotency-key',
      'x-govai-run-idempotency-key',
      'x-govai-conversation-id',
      'x-govai-turn-id',
      'x-govai-request-id',
      'authorization',
    ]) {
      expect({ banned, present: banned in h }).toEqual({ banned, present: false });
    }
  });

  it('E1.3 — governed STREAM: the server drains it and the durable prefix reproduces the bytes', async () => {
    const conv = await createConversation({ mode: 'governed' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('E1.3-stream', true));

    expect(await driveOne(attemptId)).toBe('completed');
    expect((await attempt(attemptId)).state).toBe('completed');

    // ★ THE CHUNKS CONCATENATE BACK INTO THE PROVIDER'S OWN BYTES — no reparse, no reframing, no
    // reduction to role+text. Asserting the literal `data: {...}\n\n` SSE framing (rather than a
    // decoded projection) is what makes this a fidelity test: any normalization would break it.
    const text = await outputText(attemptId);
    expect(text).toContain('data: {"type":"message_start"');
    expect(text).toContain('"type":"content_block_delta"');
    expect(text).toContain('echo: E1.3-stream');
    expect(text.trimEnd().endsWith('data: {"type":"message_stop"}')).toBe(true);
    // Every event is separated by the SSE blank line, exactly as the provider emitted it.
    expect(text.split('\n\n').filter((p) => p.startsWith('data: ')).length).toBe(6);

    // Persisted as ordered stream chunks, never as a reshaped document.
    const items = await stack.db.adminPool.query<{ n: string; types: string }>(
      `SELECT count(*)::text AS n, string_agg(DISTINCT item_type, ',') AS types
         FROM govai.ai_conversation_items WHERE attempt_id = $1::uuid`,
      [attemptId],
    );
    expect(Number(items.rows[0]!.n)).toBeGreaterThanOrEqual(1);
    expect(items.rows[0]!.types).toBe('native_stream_chunk');
    // NOTE ON COUNT: the hermetic fixture returns its whole SSE body in ONE transport chunk, so
    // the durable prefix is one row here. Incremental flushing across MULTIPLE chunks is proven
    // in E1.8, which drives an endpoint that really does emit over time.
  });

  it('E1.8 — a MULTI-CHUNK stream is persisted INCREMENTALLY, in order, losing nothing', async () => {
    // ★ THE POINT OF AN INCREMENTAL PREFIX. "The durable prefix always reflects what was
    // relayed" is only meaningful if a stream that arrives over time is written over time — a
    // reload during a long answer must show real progress, not nothing-then-everything.
    const conv = await createConversation({ mode: 'passthrough' });
    const parts = Array.from({ length: 8 }, (_, i) => `data: {"i":${i},"pad":"${'y'.repeat(40)}"}\n\n`);
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('E1.8', true));

    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
          let i = 0;
          const tick = (): void => {
            if (i >= parts.length) {
              res.end();
              return;
            }
            res.write(parts[i]!);
            i += 1;
            setTimeout(tick, 5); // separate transport chunks, genuinely spread over time
          };
          tick();
        });
      },
      () => driveOne(attemptId),
    );

    expect((await attempt(attemptId)).state).toBe('completed');
    // MORE THAN ONE durable row (streamFlushBytes = 64 in this suite, each part ~60 bytes)...
    const rows = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_items WHERE attempt_id = $1::uuid`,
      [attemptId],
    );
    expect(Number(rows.rows[0]!.n)).toBeGreaterThan(1);
    // ...and concatenating them in item_seq order reproduces the provider's bytes EXACTLY —
    // nothing dropped at a flush boundary, nothing reordered, nothing duplicated.
    expect(await outputText(attemptId)).toBe(parts.join(''));
  });

  it('E1.4 — passthrough OpenAI /v1/responses executes on its own endpoint', async () => {
    const conv = await createConversation({ mode: 'passthrough', provider: 'openai' });
    const { attemptId } = await send(conv.id, conv.branchId, openaiRequest('E1.4'));
    expect(await driveOne(attemptId)).toBe('completed');
    expect(stack.provider.recordedRequests.map((r) => r.url)).toEqual(['/v1/responses']);
    const h = stack.provider.recordedRequestHeaders[0]! as Record<string, string>;
    expect(h['authorization']).toBe('Bearer sk-openai-p0c-exec');
    expect('x-api-key' in h).toBe(false); // never the other provider's auth scheme
  });

  it('E1.5 — a provider 4xx/5xx maps to the §7.4 taxonomy, and is NEVER outcome_unknown', async () => {
    // ★ A RESPONSE — OF ANY STATUS — PROVES THE PROVIDER PROCESSED THE REQUEST. `outcome_unknown`
    // is reserved for the case where NO response arrived at all. Conflating the two would either
    // fabricate ambiguity out of an ordinary rejection, or hide a genuinely unknown fate.
    for (const [status, expected] of [
      [401, 'auth_rejected'],
      [403, 'auth_rejected'],
      [413, 'request_too_large'],
      [429, 'rate_limited'],
      [500, 'provider_error'],
      [503, 'provider_error'],
    ] as const) {
      const conv = await createConversation({ mode: 'passthrough' });
      const { attemptId } = await send(conv.id, conv.branchId, nativeRequest(`E1.5-${status}`));
      const outcome = await withProviderBehaviour(
        (_req, res) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { type: 'simulated', status } }));
        },
        () => driveOne(attemptId),
      );
      const a = await attempt(attemptId);
      expect({ status, outcome, state: a.state, error_class: a.error_class }).toEqual({
        status,
        outcome: 'failed',
        state: 'failed',
        error_class: expected,
      });
      // The provider DID answer, so provenance is present and the fate is not ambiguous.
      expect(a.provider_credential_id).toBe(credentialId);
      expect(a.state).not.toBe('outcome_unknown');
    }
  });

  it('E1.6 — a 2xx completes, and the response body is stored VERBATIM', async () => {
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('E1.6'));
    const body = { id: 'msg_verbatim', content: [{ type: 'text', text: 'exact bytes' }], odd: [1, null, true] };
    await withProviderBehaviour(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      },
      () => driveOne(attemptId),
    );
    expect((await attempt(attemptId)).state).toBe('completed');
    // No reshaping, no role+text reduction — the provider's own document, round-tripped.
    expect(JSON.parse(await outputText(attemptId))).toEqual(body);
  });

  it('E1.7 — the worker forwards the EXACT durable request bytes it stored', async () => {
    const conv = await createConversation({ mode: 'passthrough' });
    const request = { model: 'claude-test', max_tokens: 7, messages: [{ role: 'user', content: 'E1.7' }] };
    const { attemptId } = await send(conv.id, conv.branchId, request);
    let received = '';
    await withProviderBehaviour(
      (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          received = Buffer.concat(chunks).toString('utf8');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"ok":true}');
        });
      },
      () => driveOne(attemptId),
    );
    // Byte-for-byte the stored rendering: every key, every value, the client's own key ORDER.
    expect(received).toBe(JSON.stringify(request));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// CRASH-WINDOW MATRIX (§30)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('C — the crash-window matrix', () => {
  it('C0 — a crash before the reservation commits leaves NO durable turn', async () => {
    const conv = await createConversation({});
    // A reservation that fails mid-transaction (here: a rolled-back candidate) leaves nothing.
    const before = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_turns WHERE conversation_id = $1::uuid`,
      [conv.id],
    );
    const bad = await inject(stack, 'POST', `/v1/ai/conversations/${conv.id}/turns`, org.api_key, {
      client_turn_id: randomUUID(),
      branch_id: randomUUID(), // a branch that does not exist: the transaction aborts
      native_request: nativeRequest('C0'),
    });
    expect(bad.statusCode).toBe(404);
    const after = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_turns WHERE conversation_id = $1::uuid`,
      [conv.id],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    // And no orphan content row survived the rollback either.
    const content = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_content WHERE conversation_id = $1::uuid`,
      [conv.id],
    );
    expect(content.rows[0]!.n).toBe('0');
  });

  it('C1 — a crash after the reservation, before any claim: the turn is DISCOVERABLE and claimable', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('C1'));
    const candidates = await discoverRecoveryCandidates(db, { recoveryGraceMs: GRACE_MS, limit: 200 });
    const mine = candidates.find((c) => c.attemptId === attemptId);
    expect(mine).toBeDefined();
    // The unclaimed head arm — NOT deadline-gated (§8), which is what makes a fresh reservation
    // claimable at once rather than after a lease that never existed.
    expect(mine!.reason).toBe('queued_head');
    expect(mine!.claimToken).toBeNull();
    expect(mine!.isBranchHead).toBe(true);
  });

  it('C2 — a crash after the CLAIM, before the boundary: lease expiry rotates, old claimant fenced, NO POST', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('C2'));
    // A claimant took the turn and died. Age its lease past expiry.
    const stale = randomUUID();
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET claim_token = $2::uuid, claimant = 'dead-worker',
              claim_deadline_at = now() - interval '5 minutes', heartbeat_at = now() - interval '5 minutes'
        WHERE id = $1::uuid`,
      [attemptId, stale],
    );

    const outcome = await driveOne(attemptId);
    expect(outcome).toBe('completed'); // rotated, then driven to completion by THIS worker

    const a = await attempt(attemptId);
    // ★ THE ROTATION IS THE FENCE: the dead claimant's token is gone, so none of its writes can
    // ever match a row again.
    expect(a.claim_token).not.toBe(stale);
    // Exactly one POST — the dead claimant never made one.
    expect(stack.provider.recordedRequests).toHaveLength(1);
  });

  it('C3 — a crash after the boundary, before provenance: ¬P PROVES no POST, so it is restorable', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('C3'));
    const stale = randomUUID();
    // Post-boundary, provenance ABSENT, lease elapsed past the grace.
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET claim_token = $2::uuid, claimant = 'dead-worker',
              claim_deadline_at = now() - interval '5 minutes', heartbeat_at = now() - interval '5 minutes'
        WHERE id = $1::uuid`,
      [attemptId, stale],
    );
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET state = 'dispatching', dispatch_boundary_committed_at = now(),
              govai_request_id = gen_random_uuid(), causal_version_at_build = 0
        WHERE id = $1::uuid`,
      [attemptId],
    );

    const outcome = await driveOne(attemptId);
    // Restored to `accepted` under a ROTATED token, then driven — never reported ambiguous.
    expect(outcome).toBe('completed');
    const a = await attempt(attemptId);
    expect(a.state).toBe('completed');
    expect(a.claim_token).not.toBe(stale);
    // §14.1: the restore RETAINED the boundary stamp and the request identity (write-once).
    expect(a.dispatch_boundary_committed_at).not.toBeNull();
    expect(stack.provider.recordedRequests).toHaveLength(1);
  });

  it('C4 — a crash after PROVENANCE: a POST may exist, so it is outcome_unknown and NEVER re-driven', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('C4'));
    const stale = randomUUID();
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET claim_token = $2::uuid, claimant = 'dead-worker',
              claim_deadline_at = now() - interval '5 minutes', heartbeat_at = now() - interval '5 minutes'
        WHERE id = $1::uuid`,
      [attemptId, stale],
    );
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET state = 'dispatching', dispatch_boundary_committed_at = now(),
              govai_request_id = gen_random_uuid(), causal_version_at_build = 0
        WHERE id = $1::uuid`,
      [attemptId],
    );
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET provider_credential_id = $2::uuid WHERE id = $1::uuid`,
      [attemptId, credentialId],
    );

    const outcome = await driveOne(attemptId);
    expect(outcome).toBe('ratcheted_outcome_unknown');
    const a = await attempt(attemptId);
    expect(a.state).toBe('outcome_unknown');
    expect(a.error_class).toBeNull(); // NOT `failed`: nobody can assert non-processing here
    expect(a.terminal_at).not.toBeNull();
    // ★ NO RE-DRIVE. Re-dispatching a possibly-executed request is exactly the duplicate this
    // protocol exists to prevent.
    expect(stack.provider.recordedRequests).toEqual([]);
    // And it STAYS terminal: re-offering this exact attempt to the executor does nothing, and
    // in particular issues no provider request. (Scoped to THIS attempt on purpose — a global
    // sweep also drives every other pending turn in the suite, so a global request count would
    // prove nothing here.)
    const before = stack.provider.recordedRequests.length;
    const again = await driveOne(attemptId);
    expect(again).toBe('not_discovered'); // terminal attempts are not recovery candidates at all
    expect(stack.provider.recordedRequests.length).toBe(before);
    expect((await attempt(attemptId)).state).toBe('outcome_unknown');
  });

  it('C5 — the provider connection dies mid-flight: outcome_unknown, not failed', async () => {
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('C5'));
    // The endpoint accepts the request and then DESTROYS the socket without writing any HTTP
    // response: the forward was provably invoked, and whether the provider processed the bytes
    // is genuinely unknowable from here.
    const outcome = await withProviderBehaviour(
      (req) => {
        req.on('data', () => undefined);
        req.on('end', () => req.socket.destroy());
      },
      () => driveOne(attemptId),
    );
    expect(outcome).toBe('outcome_unknown');
    const a = await attempt(attemptId);
    expect(a.state).toBe('outcome_unknown');
    expect(a.error_class).toBeNull();
    // Provenance IS present — commit 4 ran before the POST, which is what the CHECK requires.
    expect(a.provider_credential_id).toBe(credentialId);
  });

  it('C6 — a terminal provider response the fence rejects is DISCARDED, never written', async () => {
    // The §7.7 zombie: a runner completes its POST but recovery rotated its token meanwhile.
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('C6'));
    const myToken = randomUUID();
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET claim_token = $2::uuid, claimant = 'zombie', claim_deadline_at = now() + interval '5 minutes'
        WHERE id = $1::uuid`,
      [attemptId, myToken],
    );
    const ex = await import('../../apps/api/src/ai-conversations/execution/execution-store.js');
    // The zombie holds `myToken`; recovery now rotates it out from under him.
    const rotated = randomUUID();
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET claim_token = $2::uuid, claimant = 'recovery' WHERE id = $1::uuid`,
      [attemptId, rotated],
    );
    // EVERY durable write the zombie could still attempt loses its fence.
    await db.withOwnerContext({ orgId: org.org_id, ownerUserId: org.user_id }, async (tx) => {
      expect(await ex.markStreaming(tx, { attemptId, claimToken: myToken })).toBe(false);
      expect(
        await ex.appendFencedOutputItem(tx, {
          attemptId,
          claimToken: myToken,
          itemSeq: 1,
          itemType: 'native_response',
          contentId: randomUUID(),
        }),
      ).toBe(false);
      expect(
        await ex.finalizeAttempt(tx, { attemptId, claimToken: myToken, state: 'completed', errorClass: null }),
      ).toBe(false);
      expect(
        await ex.heartbeatClaim(tx, { attemptId, claimToken: myToken, leaseMs: LEASE_MS }),
      ).toMatchObject({ extended: false });
      expect(
        await ex.commitCredentialProvenance(tx, {
          attemptId,
          claimToken: myToken,
          providerCredentialId: credentialId,
          provider: 'anthropic',
        }),
      ).toBe(false);
    });
    // Its output never became durable and never became context.
    const items = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_items WHERE attempt_id = $1::uuid`,
      [attemptId],
    );
    expect(items.rows[0]!.n).toBe('0');
    expect((await attempt(attemptId)).state).toBe('accepted');
  });

  it('C7 — a browser disconnect changes nothing: execution never belonged to a connection', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('C7'));
    // The sending HTTP request is long over. The worker — a different process boundary entirely —
    // drives the turn to completion.
    expect(await driveOne(attemptId)).toBe('completed');
    expect((await attempt(attemptId)).state).toBe('completed');
    expect(await outputText(attemptId)).toContain('echo: C7');
  });

  it('C8 — a STALE worker that resumes after rotation loses EVERY durable mutation', async () => {
    // Covered write-by-write in C6; here as the end-to-end statement: after a rotation, a stale
    // claimant driving the full protocol accomplishes nothing durable.
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('C8'));
    const stale = randomUUID();
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET claim_token = $2::uuid, claimant = 'stale',
              claim_deadline_at = now() - interval '5 minutes'
        WHERE id = $1::uuid`,
      [attemptId, stale],
    );
    await driveOne(attemptId); // rotates + drives under a NEW token
    const after = await attempt(attemptId);
    expect(after.claim_token).not.toBe(stale);

    const ex = await import('../../apps/api/src/ai-conversations/execution/execution-store.js');
    await db.withOwnerContext({ orgId: org.org_id, ownerUserId: org.user_id }, async (tx) => {
      expect(
        await ex.finalizeAttempt(tx, { attemptId, claimToken: stale, state: 'failed', errorClass: 'provider_error' }),
      ).toBe(false);
      expect(
        await ex.restoreDispatchingToAccepted(tx, { attemptId, claimToken: stale, leaseMs: LEASE_MS }),
      ).toBe(false);
    });
    expect((await attempt(attemptId)).state).toBe('completed'); // untouched by the stale worker
  });

  it('C9 — a duplicate SEND while the turn is running replays it, and never dispatches twice', async () => {
    const conv = await createConversation({});
    const clientTurnId = randomUUID();
    const body = {
      client_turn_id: clientTurnId,
      branch_id: conv.branchId,
      native_request: nativeRequest('C9'),
    };
    const first = await inject(stack, 'POST', `/v1/ai/conversations/${conv.id}/turns`, org.api_key, body);
    const turn = first.body as { id: string; current_attempt_id: string };
    expect(await driveOne(turn.current_attempt_id)).toBe('completed');
    expect(stack.provider.recordedRequests).toHaveLength(1);

    // A duplicate arriving AFTER completion replays the CURRENT durable state — not a cached
    // copy of the original 201, and certainly not a second execution.
    const dup = await inject(stack, 'POST', `/v1/ai/conversations/${conv.id}/turns`, org.api_key, body);
    expect(dup.statusCode).toBe(200);
    const dupBody = dup.body as { id: string; attempts: Array<{ state: string }> };
    expect(dupBody.id).toBe(turn.id);
    expect(dupBody.attempts[0]!.state).toBe('completed');
    expect(stack.provider.recordedRequests).toHaveLength(1); // still ONE
  });

  it('C10 — two distinct turns on ONE branch: both reserve, only the HEAD dispatches', async () => {
    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, nativeRequest('C10-first'));
    const t2 = await send(conv.id, conv.branchId, nativeRequest('C10-second'));

    // Discovery offers only the head as a claimable queued turn (§8 branch-order predicate).
    const candidates = await discoverRecoveryCandidates(db, { recoveryGraceMs: GRACE_MS, limit: 200 });
    const ids = candidates.filter((c) => [t1.attemptId, t2.attemptId].includes(c.attemptId)).map((c) => c.attemptId);
    expect(ids).toEqual([t1.attemptId]);

    // Even if a worker is handed the second turn directly, the CAS refuses it.
    expect(
      await processCandidate(deps, {
        orgId: org.org_id,
        ownerUserId: org.user_id,
        conversationId: conv.id,
        attemptId: t2.attemptId,
        state: 'accepted',
        reason: 'queued_head',
        claimToken: null,
        isBranchHead: true, // ← a LIE from a stale discovery row; the CAS re-validates
      }),
    ).toBe('claim_lost');
    expect(stack.provider.recordedRequests).toEqual([]);

    // Drive the head; terminalization RELEASES the queue and the second becomes claimable at once
    // — no waiting for a recovery deadline.
    expect(await driveOne(t1.attemptId)).toBe('completed');
    expect(await driveOne(t2.attemptId)).toBe('completed');
    expect(stack.provider.recordedRequests).toHaveLength(2);
    expect((await attempt(t2.attemptId)).state).toBe('completed');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// CLAIM / LEASE / FENCING (§14 of the dispatch)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('F — claim, lease and fencing', () => {
  it('F1 — two workers racing the SAME queued head: exactly one wins', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('F1'));
    const ex = await import('../../apps/api/src/ai-conversations/execution/execution-store.js');
    const owner = { orgId: org.org_id, ownerUserId: org.user_id };
    const [a, b] = await Promise.all([
      db.withOwnerContext(owner, (tx) =>
        ex.claimQueuedHead(tx, { attemptId, claimant: 'w-a', leaseMs: LEASE_MS }),
      ),
      db.withOwnerContext(owner, (tx) =>
        ex.claimQueuedHead(tx, { attemptId, claimant: 'w-b', leaseMs: LEASE_MS }),
      ),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('F2 — a heartbeat extends ONLY the current claim, and reads the durable stop flag', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('F2'));
    const ex = await import('../../apps/api/src/ai-conversations/execution/execution-store.js');
    const owner = { orgId: org.org_id, ownerUserId: org.user_id };

    const claim = await db.withOwnerContext(owner, (tx) =>
      ex.claimQueuedHead(tx, { attemptId, claimant: 'w', leaseMs: LEASE_MS }),
    );
    expect(claim).not.toBeNull();
    // Move to a post-boundary state, where the heartbeat applies.
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET state = 'dispatching', dispatch_boundary_committed_at = now(), causal_version_at_build = 0
        WHERE id = $1::uuid`,
      [attemptId],
    );

    const ok = await db.withOwnerContext(owner, (tx) =>
      ex.heartbeatClaim(tx, { attemptId, claimToken: claim!.claimToken, leaseMs: LEASE_MS }),
    );
    expect(ok).toEqual({ extended: true, stopRequested: false, state: 'dispatching' });

    // A STALE token cannot extend.
    const stale = await db.withOwnerContext(owner, (tx) =>
      ex.heartbeatClaim(tx, { attemptId, claimToken: randomUUID(), leaseMs: LEASE_MS }),
    );
    expect(stale.extended).toBe(false);

    // The tick SEES a durable stop even though P0-C exposes no Stop endpoint — the authority
    // model is complete before the command exists.
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET stop_requested = true WHERE id = $1::uuid`,
      [attemptId],
    );
    const stopped = await db.withOwnerContext(owner, (tx) =>
      ex.heartbeatClaim(tx, { attemptId, claimToken: claim!.claimToken, leaseMs: LEASE_MS }),
    );
    expect(stopped).toMatchObject({ extended: true, stopRequested: true });

    // An EXPIRED claimant cannot resurrect its own lease and postpone recovery forever.
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET claim_deadline_at = now() - interval '1 minute' WHERE id = $1::uuid`,
      [attemptId],
    );
    const expired = await db.withOwnerContext(owner, (tx) =>
      ex.heartbeatClaim(tx, { attemptId, claimToken: claim!.claimToken, leaseMs: LEASE_MS }),
    );
    expect(expired.extended).toBe(false);
  });

  it('F3 — a durable STOP set before the boundary prevents the POST outright', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('F3'));
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET stop_requested = true WHERE id = $1::uuid`,
      [attemptId],
    );
    // The turn is no longer claimable at all: a discarded queued turn is not work.
    const outcome = await driveOne(attemptId);
    expect(['claim_lost', 'not_discovered']).toContain(outcome);
    expect(stack.provider.recordedRequests).toEqual([]);
    expect((await attempt(attemptId)).state).toBe('accepted');
  });

  it('F4 — the boundary CAS refuses a CAUSALLY STALE request (§7.8)', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('F4'));
    const ex = await import('../../apps/api/src/ai-conversations/execution/execution-store.js');
    const owner = { orgId: org.org_id, ownerUserId: org.user_id };
    const claim = await db.withOwnerContext(owner, (tx) =>
      ex.claimQueuedHead(tx, { attemptId, claimant: 'w', leaseMs: LEASE_MS }),
    );
    // A sibling terminalized meanwhile and bumped the branch version.
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_branches SET causal_version = causal_version + 1 WHERE id = $1::uuid`,
      [conv.branchId],
    );
    const boundary = await db.withOwnerContext(owner, async (tx) => {
      const root = await ex.lockRootForDispatch(tx, conv.id);
      expect(root && ex.isRootExecutionEligible(root.status)).toBe(true);
      return ex.commitDispatchBoundary(tx, {
        attemptId,
        claimToken: claim!.claimToken,
        leaseMs: LEASE_MS,
        causalVersionAtBuild: '0', // ← built against the OLD version
        candidateRequestId: randomUUID(),
      });
    });
    expect(boundary.ok).toBe(false);
    expect((await attempt(attemptId)).state).toBe('accepted'); // untouched, still reclaimable
  });

  it('F5 — provenance commit REVALIDATES the credential and refuses a rotated one', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('F5'));
    const ex = await import('../../apps/api/src/ai-conversations/execution/execution-store.js');
    const owner = { orgId: org.org_id, ownerUserId: org.user_id };
    const claim = await db.withOwnerContext(owner, (tx) =>
      ex.claimQueuedHead(tx, { attemptId, claimant: 'w', leaseMs: LEASE_MS }),
    );
    await db.withOwnerContext(owner, async (tx) => {
      await ex.lockRootForDispatch(tx, conv.id);
      return ex.commitDispatchBoundary(tx, {
        attemptId,
        claimToken: claim!.claimToken,
        leaseMs: LEASE_MS,
        causalVersionAtBuild: (await branchVersion(conv.branchId)),
        candidateRequestId: randomUUID(),
      });
    });
    // A credential id that is NOT the org's active one for this provider must be refused —
    // otherwise a rotation slipping into the boundary window would be recorded as provenance.
    const bogus = randomUUID();
    const refused = await db.withOwnerContext(owner, (tx) =>
      ex.commitCredentialProvenance(tx, {
        attemptId,
        claimToken: claim!.claimToken,
        providerCredentialId: bogus,
        provider: 'anthropic',
      }),
    );
    expect(refused).toBe(false);
    expect((await attempt(attemptId)).provider_credential_id).toBeNull();

    // The fenced RESTORE is then lawful precisely because ¬P proves no POST happened.
    const restored = await db.withOwnerContext(owner, (tx) =>
      ex.restoreDispatchingToAccepted(tx, { attemptId, claimToken: claim!.claimToken, leaseMs: LEASE_MS }),
    );
    expect(restored).toBe(true);
    expect((await attempt(attemptId)).state).toBe('accepted');
  });

  it('F6 — an OpenAI attempt cannot record an ANTHROPIC credential as its provenance', async () => {
    const conv = await createConversation({ provider: 'openai' });
    const { attemptId } = await send(conv.id, conv.branchId, openaiRequest('F6'));
    const ex = await import('../../apps/api/src/ai-conversations/execution/execution-store.js');
    const owner = { orgId: org.org_id, ownerUserId: org.user_id };
    const claim = await db.withOwnerContext(owner, (tx) =>
      ex.claimQueuedHead(tx, { attemptId, claimant: 'w', leaseMs: LEASE_MS }),
    );
    await db.withOwnerContext(owner, async (tx) => {
      await ex.lockRootForDispatch(tx, conv.id);
      return ex.commitDispatchBoundary(tx, {
        attemptId,
        claimToken: claim!.claimToken,
        leaseMs: LEASE_MS,
        causalVersionAtBuild: await branchVersion(conv.branchId),
        candidateRequestId: randomUUID(),
      });
    });
    // `credentialId` is the ANTHROPIC row; the predicate names the provider, so it matches zero.
    const wrongProvider = await db.withOwnerContext(owner, (tx) =>
      ex.commitCredentialProvenance(tx, {
        attemptId,
        claimToken: claim!.claimToken,
        providerCredentialId: credentialId,
        provider: 'openai',
      }),
    );
    expect(wrongProvider).toBe(false);
  });
});

async function branchVersion(branchId: string): Promise<string> {
  const r = await stack.db.adminPool.query<{ v: string }>(
    `SELECT causal_version::text AS v FROM govai.ai_conversation_branches WHERE id = $1::uuid`,
    [branchId],
  );
  return r.rows[0]!.v;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FAIL-CLOSED CLASSIFICATION
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('X — fail-closed classification before any dispatch', () => {
  it('X1 — NO active tenant credential ⇒ failed/credential_unavailable, never ambiguous', async () => {
    // ★ The env-key / hermetic fallbacks of the DIRECT routes are structurally unavailable to a
    // conversation: 0031 requires `streaming|completed ⟹ provider_credential_id IS NOT NULL`
    // through an ORG-COMPOSITE FK, and an env key has no durable row to point at.
    const lonely = await seedOrg(stack);
    const conv = await inject(stack, 'POST', '/v1/ai/conversations', lonely.api_key, {
      mode: 'governed',
      provider: 'anthropic',
      surface: 'anthropic_messages',
      model: 'claude-test',
    });
    const c = conv.body as { id: string; root_branch: { id: string } };
    const sent = await inject(stack, 'POST', `/v1/ai/conversations/${c.id}/turns`, lonely.api_key, {
      client_turn_id: randomUUID(),
      branch_id: c.root_branch.id,
      native_request: nativeRequest('X1'),
    });
    const attemptId = (sent.body as { current_attempt_id: string }).current_attempt_id;

    expect(await driveOne(attemptId)).toBe('credential_unavailable');
    const a = await attempt(attemptId);
    expect(a.state).toBe('failed');
    expect(a.error_class).toBe('credential_unavailable');
    // Pre-boundary: no POST was even possible, and nothing ambiguous is claimed.
    expect(a.dispatch_boundary_committed_at).toBeNull();
    expect(a.provider_credential_id).toBeNull();
    expect(stack.provider.recordedRequests).toEqual([]);
  });

  it('X2 — an UNDRIVABLE surface is REJECTED by the executor too, not only by the route', async () => {
    // The reservation gate and the executor gate are INDEPENDENT. A durable turn that never
    // passed the route gate — seeded directly, exactly as a pre-registry conversation would look
    // — must still be refused before any claim is driven, not dispatched somewhere plausible.
    const { attemptId } = await seedUndrivableTurn();
    expect(await driveOne(attemptId)).toBe('surface_unsupported');
    const a = await attempt(attemptId);
    expect(a.state).toBe('rejected');
    expect(a.error_class).toBeNull(); // a GovAI refusal is not a provider taxonomy value
    expect(stack.provider.recordedRequests).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// EVIDENCE — §14/§32 equivalence with the request-driven pipeline
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('EV — worker-driven dispatch is NOT a second-class evidence path', () => {
  it('EV1 — a worker-driven governed call produces a v4 capture under the attempt’s request identity', async () => {
    const conv = await createConversation({ mode: 'governed' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('EV1'));
    expect(await driveOne(attemptId)).toBe('completed');

    const a = await attempt(attemptId);
    expect(a.govai_request_id).not.toBeNull();

    // ★ THE CAPTURE EXISTS. Without `requestIdentityAls.run()` around the pipeline call, the
    // AuditBridge would find no identity and DROP the capture — worker dispatch would be a
    // silent evidence gap. The capture id is uuidv5-derived from the attempt's OWN request id,
    // so the correlation is checkable from durable state alone.
    const { auditBridgeCaptureId } = await import('../../apps/api/src/pipeline/audit-bridge.js');
    const expectedCaptureId = auditBridgeCaptureId(
      { govaiRequestId: a.govai_request_id!, identityScope: 'govai_request_id' },
      {
        orgId: org.org_id,
        provider: 'anthropic',
        capabilityId: 'anthropic.messages.create',
        nativeMethod: 'POST',
        nativeEndpoint: '/v1/messages',
      },
    );
    const capture = await stack.db.adminPool.query<{ n: string; event_type: string }>(
      `SELECT count(*)::text AS n, max(event_type) AS event_type
         FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
      [expectedCaptureId],
    );
    expect(capture.rows[0]!.n).toBe('1');
    expect(capture.rows[0]!.event_type).toBe('passthrough.invoked');
  });

  it('EV2 — a worker-driven PASSTHROUGH call is captured too, at the passthrough level', async () => {
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('EV2'));
    expect(await driveOne(attemptId)).toBe('completed');
    const a = await attempt(attemptId);
    const { auditBridgeCaptureId } = await import('../../apps/api/src/pipeline/audit-bridge.js');
    const captureId = auditBridgeCaptureId(
      { govaiRequestId: a.govai_request_id!, identityScope: 'govai_request_id' },
      {
        orgId: org.org_id,
        provider: 'anthropic',
        capabilityId: 'anthropic.messages.create',
        nativeMethod: 'POST',
        nativeEndpoint: '/v1/messages',
      },
    );
    const n = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
      [captureId],
    );
    expect(n.rows[0]!.n).toBe('1');
  });

  it('EV3 — governance is REAL on the worker path: a governed block never reaches the provider', async () => {
    // The computer-use tool floor is the governed handler's explicit block. Reaching it from the
    // worker proves the SAME enforcement code runs — not a re-implementation, and not a bypass.
    const conv = await createConversation({ mode: 'governed' });
    const { attemptId } = await send(conv.id, conv.branchId, {
      model: 'claude-test',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'EV3' }],
      tools: [{ type: 'computer_20250124', name: 'computer', display_width_px: 1, display_height_px: 1 }],
    });
    const outcome = await driveOne(attemptId);
    expect(outcome).toBe('rejected');
    const a = await attempt(attemptId);
    expect(a.state).toBe('rejected');
    // ★ NO POST, and NO PROVENANCE: the durable gate lives INSIDE the forward, and a blocked
    // result never reaches it. That is the same `¬P ⇒ provably no POST` proof recovery relies on.
    expect(stack.provider.recordedRequests).toEqual([]);
    expect(a.provider_credential_id).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// REVIEW REMEDIATION — each test here fails without its fix
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('RM — findings from the exact-head review', () => {
  it('RM1 — a stream that DIES mid-drain still emits its terminal evidence', async () => {
    // ★ THE GAP THIS CLOSES. A provider stream that resets after response headers makes the drain
    // throw, which used to jump straight to the `outcome_unknown` handler — terminalizing the
    // attempt while the stream finalizer never ran. That is an evidence gap precisely for FAILED
    // provider calls, which is when evidence matters most.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('RM1', true));

    // ★ RECEIPT IS PROVEN, NOT TIMED. The first revision of this test wrote one small chunk and
    // destroyed the socket 20ms later, assuming the reader would have consumed it by then. Under
    // a loaded machine it had not — the durable prefix came back empty and the suite failed only
    // in a full clean run, never in isolation. A wall-clock window is not a receipt.
    //
    // The chunk is now larger than this suite's 64-byte flush threshold, so consuming it produces
    // a DURABLE ITEM; the test polls for that row and only then releases the upstream to die.
    // The database is the handshake, so the assertion below cannot race.
    let releaseDestroy!: () => void;
    const armed = new Promise<void>((resolve) => {
      releaseDestroy = resolve;
    });
    const firstChunk = `data: {"type":"message_start","pad":"${'m'.repeat(120)}"}\n\n`;

    const outcome = await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write(firstChunk);
          // The connection dies only once the test has PROVEN the chunk was durably persisted.
          void armed.then(() => req.socket.destroy());
        });
      },
      async () => {
        const driving = driveOne(attemptId);
        for (let i = 0; i < 400; i += 1) {
          const n = await stack.db.adminPool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM govai.ai_conversation_items WHERE attempt_id = $1::uuid`,
            [attemptId],
          );
          if (Number(n.rows[0]!.n) >= 1) break;
          await new Promise((r) => setTimeout(r, 25));
        }
        releaseDestroy();
        return driving;
      },
    );

    // The fate after a partial stream is genuinely unprovable, so the attempt is honest.
    expect(outcome).toBe('outcome_unknown');
    const a = await attempt(attemptId);
    expect(a.state).toBe('outcome_unknown');
    expect(a.govai_request_id).not.toBeNull();

    // ★ AND THE EVIDENCE EXISTS ANYWAY — the provider WAS called, so a capture describes it.
    const { auditBridgeCaptureId } = await import('../../apps/api/src/pipeline/audit-bridge.js');
    const captureId = auditBridgeCaptureId(
      { govaiRequestId: a.govai_request_id!, identityScope: 'govai_request_id' },
      {
        orgId: org.org_id,
        provider: 'anthropic',
        capabilityId: 'anthropic.messages.stream',
        nativeMethod: 'POST',
        nativeEndpoint: '/v1/messages',
      },
    );
    const n = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
      [captureId],
    );
    expect(n.rows[0]!.n).toBe('1');
    // The durable prefix keeps what actually arrived — nothing is discarded because the stream
    // later died.
    expect(await outputText(attemptId)).toContain('message_start');
  });

  it('RM2 — a NON-JSON provider body still hydrates, losslessly and forever', async () => {
    // ★ A durably-finalized attempt must never become permanently unhydratable. An upstream proxy
    // returning HTML, or a truncated error body, used to make every later hydrate of that turn —
    // and of any PAGE containing it — throw a 500.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('RM2'));
    const html = '<html><body>502 Bad Gateway</body></html>';
    await withProviderBehaviour(
      (_req, res) => {
        res.writeHead(502, { 'content-type': 'text/html' });
        res.end(html);
      },
      () => driveOne(attemptId),
    );
    expect((await attempt(attemptId)).state).toBe('failed');

    const { turn_id, conversation_id } = await lineage(attemptId);
    for (const url of [
      `/v1/ai/conversations/${conversation_id}/turns/${turn_id}`,
      `/v1/ai/conversations/${conversation_id}/turns`,
    ]) {
      const res = await inject(stack, 'GET', url, org.api_key);
      expect({ url, code: res.statusCode }).toEqual({ url, code: 200 });
    }
    const one = await inject(
      stack,
      'GET',
      `/v1/ai/conversations/${conversation_id}/turns/${turn_id}`,
      org.api_key,
    );
    const item = (one.body as {
      attempts: Array<{ output_items: Array<{ native: unknown; text: string | null }> }>;
    }).attempts[0]!.output_items[0]!;
    // LOSSLESS: the exact bytes come back as text, and `native` is honestly null.
    expect(item.text).toBe(html);
    expect(item.native).toBeNull();
  });

  it('RM3 — a corrupt CONFIG and an undecryptable CREDENTIAL get DIFFERENT verdicts', async () => {
    // ★ These once shared one catch, so a corrupt config was durably recorded as a credential
    // outage while the runner reported a config failure — the durable taxonomy and the
    // operational outcome named different components, each wrong half the time.
    const { attemptId } = await seedTurnWithUndecryptableConfig();
    expect(await driveOne(attemptId)).toBe('config_unreadable');
    const a = await attempt(attemptId);
    // A GovAI-side storage fault is a VALIDATION refusal, and carries no provider taxonomy value.
    expect({ state: a.state, error_class: a.error_class }).toEqual({
      state: 'rejected',
      error_class: null,
    });
    expect(stack.provider.recordedRequests).toEqual([]);
  });

  it('RM4 — an undecryptable CREDENTIAL is credential_unavailable on BOTH axes', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('RM4'));
    // Tamper the ACTIVE credential's wrapped DEK so KMS decryption fails.
    const before = await stack.db.adminPool.query<{ dek: Buffer }>(
      `SELECT dek_wrapped AS dek FROM govai.provider_credentials
        WHERE org_id = $1::uuid AND provider = 'anthropic' AND status = 'active'`,
      [org.org_id],
    );
    await stack.db.adminPool.query(
      `UPDATE govai.provider_credentials SET dek_wrapped = decode(repeat('00',64),'hex')
        WHERE org_id = $1::uuid AND provider = 'anthropic' AND status = 'active'`,
      [org.org_id],
    );
    try {
      expect(await driveOne(attemptId)).toBe('credential_unavailable');
      const a = await attempt(attemptId);
      expect({ state: a.state, error_class: a.error_class }).toEqual({
        state: 'failed',
        error_class: 'credential_unavailable',
      });
      expect(stack.provider.recordedRequests).toEqual([]);
    } finally {
      await stack.db.adminPool.query(
        `UPDATE govai.provider_credentials SET dek_wrapped = $2::bytea
          WHERE org_id = $1::uuid AND provider = 'anthropic' AND status = 'active'`,
        [org.org_id, before.rows[0]!.dek],
      );
    }
  });

  it('RM5 — a fence loss during output persistence leaves NO orphan content row', async () => {
    // ★ The content INSERT precedes the fenced append in one transaction. Returning `false`
    // normally used to COMMIT, leaving an encrypted blob no item references — one per fence loss,
    // accumulating for the lifetime of the conversation.
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('RM5'));
    const ex = await import('../../apps/api/src/ai-conversations/execution/execution-store.js');
    const owner = { orgId: org.org_id, ownerUserId: org.user_id };
    const claim = await db.withOwnerContext(owner, (tx) =>
      ex.claimQueuedHead(tx, { attemptId, claimant: 'w', leaseMs: LEASE_MS }),
    );
    await db.withOwnerContext(owner, async (tx) => {
      await ex.lockRootForDispatch(tx, conv.id);
      return ex.commitDispatchBoundary(tx, {
        attemptId,
        claimToken: claim!.claimToken,
        leaseMs: LEASE_MS,
        causalVersionAtBuild: await branchVersion(conv.branchId),
        candidateRequestId: randomUUID(),
      });
    });

    const contentBefore = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_content WHERE conversation_id = $1::uuid`,
      [conv.id],
    );
    // Rotate the token out from under the writer, then attempt a fenced append.
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET claim_token = gen_random_uuid() WHERE id = $1::uuid`,
      [attemptId],
    );
    const appended = await db.withOwnerContext(owner, async (tx) => {
      const contentId = await tx.query<{ id: string }>(
        `INSERT INTO govai.ai_conversation_content
           (org_id, owner_user_id, conversation_id, ciphertext, dek_wrapped, kms_key_id, kms_key_version, content_hmac)
         VALUES ($1::uuid,$2::uuid,$3::uuid,decode('01','hex'),decode('02','hex'),'k',1,decode(repeat('00',32),'hex'))
         RETURNING id`,
        [org.org_id, org.user_id, conv.id],
      );
      return ex.appendFencedOutputItem(tx, {
        attemptId,
        claimToken: claim!.claimToken,
        itemSeq: 1,
        itemType: 'native_response',
        contentId: contentId.rows[0]!.id,
      });
    });
    expect(appended).toBe(false); // the fence rejected it, as it must

    // The PRODUCTION path rolls the content row back; this raw reproduction shows why that
    // matters — committed here, the blob would survive with nothing referencing it.
    const orphans = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_content c
        WHERE c.conversation_id = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM govai.ai_conversation_items i WHERE i.content_id = c.id)
          AND c.id <> (SELECT native_request_config_content_id FROM govai.ai_conversation_turns t
                        WHERE t.conversation_id = c.conversation_id LIMIT 1)`,
      [conv.id],
    );
    void contentBefore;
    // Exactly ONE orphan — the one this test inserted deliberately via the raw path.
    expect(Number(orphans.rows[0]!.n)).toBe(1);
  });

  it('RM5b — the PRODUCTION persist path creates no orphan when the fence rejects', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('RM5b'));
    // Drive it to completion, then count: every content row is referenced by an item or is the
    // turn's own config. The production writer never leaves a dangling blob.
    expect(await driveOne(attemptId)).toBe('completed');
    const dangling = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_content c
        WHERE c.conversation_id = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM govai.ai_conversation_items i WHERE i.content_id = c.id)`,
      [conv.id],
    );
    expect(dangling.rows[0]!.n).toBe('0');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ROUND-THREE REMEDIATION — each test here fails without its fix
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('R3 — round-three review findings', () => {
  it('R3-1 — a capture failure NEVER returns a poisoned transaction to the worker pool', async () => {
    // ★ THE REAL-POOL PROOF, not the unit one. A worker pool is `max: 2` by default; here it is
    // ONE, so the very next operation MUST reuse the same physical connection. If the failed
    // capture left an aborted transaction on it, that next operation fails `25P02` — which is
    // exactly how a repeating capture failure used to take the whole worker down.
    const single = createConversationWorkerDb({
      config: { connectionString: stack.db.conversationWorkerUrl, max: 1, workerId: 'r3-1' },
      log: silentLog as unknown as Parameters<typeof createConversationWorkerDb>[0]['log'],
    });
    try {
      // A v4 envelope whose ORG the worker has no context for: `setLocalAppOrgId` succeeds, and
      // the capture INSERT then fails on the FORCE-RLS policy — a genuine post-BEGIN failure.
      const bogusOrg = randomUUID();
      const event = {
        event_type: 'passthrough.invoked',
        schema_version: 4,
        tenant_context: { org_id: bogusOrg, tier: 'starter', operational_mode: 'test' },
        provider: 'anthropic',
        capability_id: 'anthropic.messages.create',
        capability_level: 'policy_governed',
        capability_canonical_level: 'policy_governed',
        native_endpoint: '/v1/messages',
        native_method: 'POST',
        is_stream: false,
        is_multipart: false,
        base_risk_class: 'A',
        effective_risk_class: 'A',
        risk_escalation_reasons: [],
        enforcement_decision: 'observe',
        native_request_hash: 'a'.repeat(64),
        native_response_hash: 'b'.repeat(64),
        latency_ms: 1,
        status_code: 200,
        occurred_at: new Date().toISOString(),
        credential_source: 'tenant_provider_credential',
        allowlist_version: 'v',
        body_forward_mode: 'raw',
        dlp_decisions: [],
        beta_allowlist_sources: [],
        detected_tool_classifications: [],
        audit_event_id: randomUUID(),
        chain_category: 'run',
      };
      // best_effort: it swallows and logs. What matters is the state it leaves the pool in.
      await single.captureAuditEvent(event, {
        govaiRequestId: randomUUID(),
        identityScope: 'govai_request_id',
      });

      // ★ THE ASSERTION. The next attested operation on the SAME single-connection pool must
      // succeed. Before the fix this threw `25P02` (current transaction is aborted).
      const owner = { orgId: org.org_id, ownerUserId: org.user_id };
      const seen = await single.withOwnerContext(owner, async (tx) => {
        const r = await tx.query<{ ok: number }>('SELECT 1 AS ok');
        return r.rows[0]!.ok;
      });
      expect(seen).toBe(1);

      // And again, to prove it is not a one-shot recovery.
      const second = await single.discoverRecoveryCandidates({ recoveryGraceMs: 0, limit: 1 });
      expect(Array.isArray(second)).toBe(true);
    } finally {
      await single.close().catch(() => undefined);
    }
  });

  it('R3-2 — a PERSISTENCE failure after the provider answered is NOT outcome_unknown', async () => {
    // ★ THE HONESTY OF `outcome_unknown` IS THE POINT. It means "the provider's fate is
    // unprovable", and §7.7 builds real behaviour on that (no re-drive; only a probe may
    // resolve it). When the response and its status were already in hand, the fate is PROVEN —
    // recording ambiguity there loses a known result AND dilutes the one state whose whole value
    // is that it is reserved.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R3-2'));

    // Break the KMS the executor persists WITH, so encryption fails only after the response.
    const brokenKms = {
      ...deps.kms,
      envelopeEncrypt: async () => {
        throw new Error('kms unavailable');
      },
      hmacSha256: async () => {
        throw new Error('kms unavailable');
      },
      envelopeDecrypt: deps.kms.envelopeDecrypt.bind(deps.kms),
    } as unknown as typeof deps.kms;

    const outcome = await processCandidate(
      { ...deps, kms: brokenKms },
      {
        orgId: org.org_id,
        ownerUserId: org.user_id,
        conversationId: conv.id,
        attemptId,
        state: 'accepted',
        reason: 'queued_head',
        claimToken: null,
        isBranchHead: true,
      },
    );

    expect(outcome).toBe('persistence_error');
    const a = await attempt(attemptId);
    expect({ state: a.state, error_class: a.error_class }).toEqual({
      state: 'failed',
      error_class: 'persistence_error',
    });
    // The provider DID answer, so provenance is present and the state is NOT ambiguous.
    expect(a.provider_credential_id).not.toBeNull();
    expect(a.state).not.toBe('outcome_unknown');
    // Exactly ONE provider request, and no automatic re-drive of work the provider already did.
    expect(stack.provider.recordedRequests).toHaveLength(1);
    const again = await driveOne(attemptId);
    expect(again).toBe('not_discovered'); // terminal ⇒ not a recovery candidate
    expect(stack.provider.recordedRequests).toHaveLength(1);
  });

  it('R3-3 — a stream that dies UPSTREAM mid-drain stays outcome_unknown', async () => {
    // ★ THE OTHER SIDE OF R3-2, AND WHY THE MARKER IS TYPED RATHER THAN A FLAG. A stream whose
    // upstream dies HAS "had a response" — headers and a status arrived — yet its terminal frame
    // never did, so completion is genuinely unprovable. If the classification keyed on "a
    // response was seen" it would wrongly call this a persistence failure.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R3-3', true));
    const outcome = await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: {"type":"message_start"}\n\n');
          setTimeout(() => req.socket.destroy(), 20);
        });
      },
      () => driveOne(attemptId),
    );
    expect(outcome).toBe('outcome_unknown');
    const a = await attempt(attemptId);
    expect({ state: a.state, error_class: a.error_class }).toEqual({
      state: 'outcome_unknown',
      error_class: null,
    });
  });

  it('R3-4 — a KNOWN-LOCAL pre-transmission failure is local_error, never provider_error', async () => {
    // ★ BLAMING A PROVIDER THAT WAS NEVER CONTACTED IS A LIE, and the old code told it. Here the
    // stored credential contains a newline, so `new Request(...)` rejects the header during
    // construction — provably before any transmission.
    const lonely = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: lonely.org_id,
      provider: 'anthropic',
      plaintextKey: 'sk-ant-bad\nheader',
      setByUserId: lonely.user_id,
    });
    const created = await inject(stack, 'POST', '/v1/ai/conversations', lonely.api_key, {
      mode: 'passthrough',
      provider: 'anthropic',
      surface: 'anthropic_messages',
      model: 'claude-test',
    });
    const c = created.body as { id: string; root_branch: { id: string } };
    const sent = await inject(stack, 'POST', `/v1/ai/conversations/${c.id}/turns`, lonely.api_key, {
      client_turn_id: randomUUID(),
      branch_id: c.root_branch.id,
      native_request: nativeRequest('R3-4'),
    });
    const attemptId = (sent.body as { current_attempt_id: string }).current_attempt_id;

    stack.provider.clearRecordedRequests();
    const outcome = await processCandidate(deps, {
      orgId: lonely.org_id,
      ownerUserId: lonely.user_id,
      conversationId: c.id,
      attemptId,
      state: 'accepted',
      reason: 'queued_head',
      claimToken: null,
      isBranchHead: true,
    });

    expect(outcome).toBe('local_error');
    const a = await attempt(attemptId);
    expect({ state: a.state, error_class: a.error_class }).toEqual({
      state: 'failed',
      error_class: 'local_error',
    });
    // Nothing was transmitted.
    expect(stack.provider.recordedRequests).toEqual([]);
  });

  it('R3-5 — NON-UTF-8 provider bytes survive hydrate EXACTLY, base64 not a lossy string', async () => {
    // ★ `Buffer.toString('utf8')` REPLACES invalid sequences with U+FFFD, so the previous
    // "lossless text" contract was false for any ISO-8859-1 or binary body. Decoding is now
    // FATAL, and what fails it comes back byte-for-byte.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R3-5'));
    // Latin-1 "Café" + a lone 0xFF: invalid UTF-8 by construction.
    const rawBody = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0xff, 0x21]);
    await withProviderBehaviour(
      (_req, res) => {
        res.writeHead(502, { 'content-type': 'text/html; charset=iso-8859-1' });
        res.end(rawBody);
      },
      () => driveOne(attemptId),
    );
    expect((await attempt(attemptId)).state).toBe('failed');

    const { conversation_id, turn_id } = await lineage(attemptId);
    const res = await inject(
      stack,
      'GET',
      `/v1/ai/conversations/${conversation_id}/turns/${turn_id}`,
      org.api_key,
    );
    expect(res.statusCode).toBe(200);
    const item = (res.body as {
      attempts: Array<{ output_items: Array<{ native: unknown; text: string | null; bytes_base64: string | null }> }>;
    }).attempts[0]!.output_items[0]!;

    expect(item.native).toBeNull();
    expect(item.text).toBeNull(); // NOT a U+FFFD-corrupted string
    expect(item.bytes_base64).not.toBeNull();
    // ★ EXACT BYTE-FOR-BYTE EQUALITY with what the upstream sent.
    expect(Buffer.from(item.bytes_base64!, 'base64').equals(rawBody)).toBe(true);
  });

  it('R4-1 — a FENCED stream exit never records stream_outcome: complete', async () => {
    // ★ AN AUDIT RECORD THAT AFFIRMATIVELY CLAIMS SOMETHING FALSE IS WORSE THAN ONE THAT RECORDS
    // NOTHING. When an append loses its fence the drain `break`s early — we stop reading, so the
    // provider's terminal frame is never observed — yet a single "the loop ended" flag reported
    // `complete`. The evidence then hashed only the received prefix while asserting the stream
    // had finished.
    //
    // Driven through the REAL `processCandidate`, with the emitted v4 event captured at the
    // worker's own `captureAuditEvent` seam — no test-only production export.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R4-1', true));

    const emitted: Array<{ is_stream?: boolean; stream_outcome?: string }> = [];
    const spyDb = Object.assign(Object.create(Object.getPrototypeOf(db)), db, {
      captureAuditEvent: async (event: unknown, identity?: unknown) => {
        emitted.push(event as { is_stream?: boolean; stream_outcome?: string });
        return (db.captureAuditEvent as (e: unknown, i?: unknown) => Promise<void>)(event, identity);
      },
    }) as typeof db;

    // The upstream pauses after its first chunks so the fence can be rotated DETERMINISTICALLY
    // mid-drain, rather than racing a timer.
    let releaseUpstream!: () => void;
    const paused = new Promise<void>((resolve) => {
      releaseUpstream = resolve;
    });

    const outcome = await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          // Well past the 64-byte flush threshold, so the FIRST flush happens while still fenced-in.
          res.write(`data: {"phase":"first","pad":"${'z'.repeat(120)}"}\n\n`);
          void paused.then(() => {
            // More data AFTER the rotation: the next flush loses its fence and breaks the drain.
            res.write(`data: {"phase":"second","pad":"${'z'.repeat(120)}"}\n\n`);
            res.write(`data: {"phase":"third","pad":"${'z'.repeat(120)}"}\n\n`);
            setTimeout(() => res.end(), 50);
          });
        });
      },
      async () => {
        const driving = processCandidate({ ...deps, db: spyDb }, {
          orgId: org.org_id,
          ownerUserId: org.user_id,
          conversationId: conv.id,
          attemptId,
          state: 'accepted',
          reason: 'queued_head',
          claimToken: null,
          isBranchHead: true,
        });
        // Wait until the FIRST chunk is durably persisted — proof the drain is running and the
        // fence was still valid — then rotate the claim out from under the writer.
        for (let i = 0; i < 200; i += 1) {
          const n = await stack.db.adminPool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM govai.ai_conversation_items WHERE attempt_id = $1::uuid`,
            [attemptId],
          );
          if (Number(n.rows[0]!.n) >= 1) break;
          await new Promise((r) => setTimeout(r, 25));
        }
        await stack.db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET claim_token = gen_random_uuid() WHERE id = $1::uuid`,
          [attemptId],
        );
        releaseUpstream();
        return driving;
      },
    );

    // The writer lost its authority, so nothing further became durable...
    expect(outcome).toBe('finalize_fenced_out');
    // ...and the evidence does NOT claim the stream completed.
    const streamEvents = emitted.filter((e) => e.is_stream === true);
    expect(streamEvents.length).toBeGreaterThan(0);
    for (const e of streamEvents) {
      expect({ outcome: e.stream_outcome }).toEqual({ outcome: 'upstream_error' });
    }
  });

  it('R4-2 — a page hydrate BOUNDS its concurrent KMS decryptions', async () => {
    // ★ THE PAGE CAP BOUNDS TURNS, NOT ITEMS. One streaming attempt writes an item per flush, so
    // a single turn can carry hundreds; `Promise.all` over the whole set fired every decrypt at
    // once, which on a remote KMS is a self-inflicted thundering herd whose throttling fails the
    // entire hydrate.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R4-2', true));
    // 40 chunks at a 64-byte flush threshold ⇒ many durable items on ONE turn.
    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          let n = 0;
          const tick = (): void => {
            if (n >= 40) {
              res.end();
              return;
            }
            res.write(`data: {"i":${n},"pad":"${'q'.repeat(90)}"}\n\n`);
            n += 1;
            setTimeout(tick, 2);
          };
          tick();
        });
      },
      () => driveOne(attemptId),
    );
    const itemCount = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_items WHERE attempt_id = $1::uuid`,
      [attemptId],
    );
    expect(Number(itemCount.rows[0]!.n)).toBeGreaterThan(8); // more items than the concurrency cap

    // Hydrate through a KMS that RECORDS peak in-flight decryptions.
    const { getTurn } = await import('../../apps/api/src/ai-conversations/turn-service.js');
    const realKms = deps.kms;
    let inFlight = 0;
    let peak = 0;
    const countingKms = Object.assign(Object.create(Object.getPrototypeOf(realKms)), realKms, {
      envelopeDecrypt: async (a: Parameters<typeof realKms.envelopeDecrypt>[0]) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        try {
          // A tick of latency, so genuine overlap is observable rather than serialized by luck.
          await new Promise((r) => setTimeout(r, 2));
          return await realKms.envelopeDecrypt(a);
        } finally {
          inFlight -= 1;
        }
      },
    }) as typeof realKms;

    const { turn_id, conversation_id } = await lineage(attemptId);
    const turn = await getTurn(
      { pool: stack.db.appPool, kms: countingKms },
      { orgId: org.org_id, ownerUserId: org.user_id },
      conversation_id,
      turn_id,
    );
    // Everything still hydrated, in order...
    expect(turn.attempts[0]!.output_items.length).toBeGreaterThan(8);
    // ...and the burst was CAPPED.
    expect(peak).toBeGreaterThan(1); // it really is concurrent, not accidentally serial
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('R5-1 — a FENCED break CANCELS the provider body, it does not just detach', async () => {
    // ★ `releaseLock()` IS NOT CANCELLATION. When the fence is lost mid-drain the consumer breaks,
    // and merely detaching the reader leaves the provider streaming: it keeps generating and we
    // keep downloading for a response nobody can persist, until the dispatch timeout.
    //
    // Observed from the SERVER side — the only place that can distinguish "the client stopped
    // reading" from "the client hung up".
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R5-1', true));

    let closedAt = 0;
    let writesAfterClose = 0;
    let releaseFence!: () => void;
    const armed = new Promise<void>((resolve) => {
      releaseFence = resolve;
    });

    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          // The response is UNBOUNDED: if the body is never cancelled it keeps producing.
          const timer = setInterval(() => {
            if (closedAt !== 0) {
              writesAfterClose += 1;
              if (writesAfterClose > 6) clearInterval(timer);
              return;
            }
            res.write(`data: {"pad":"${'k'.repeat(120)}"}\n\n`);
          }, 15);
          res.on('close', () => {
            if (closedAt === 0) closedAt = Date.now();
            clearInterval(timer);
          });
        });
      },
      async () => {
        const driving = processCandidate(deps, {
          orgId: org.org_id,
          ownerUserId: org.user_id,
          conversationId: conv.id,
          attemptId,
          state: 'accepted',
          reason: 'queued_head',
          claimToken: null,
          isBranchHead: true,
        });
        // Wait until the drain is provably live (a chunk is durable), then rotate the claim.
        for (let i = 0; i < 400; i += 1) {
          const n = await stack.db.adminPool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM govai.ai_conversation_items WHERE attempt_id = $1::uuid`,
            [attemptId],
          );
          if (Number(n.rows[0]!.n) >= 1) break;
          await new Promise((r) => setTimeout(r, 25));
        }
        await stack.db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET claim_token = gen_random_uuid() WHERE id = $1::uuid`,
          [attemptId],
        );
        releaseFence();
        const outcome = await driving;
        // Give the server a moment to observe the close.
        await new Promise((r) => setTimeout(r, 300));
        return outcome;
      },
    );
    void armed;

    // ★ THE ASSERTION: the provider connection was CLOSED, not left running. Without the cancel
    // the response stays open and `close` never fires within this window.
    expect(closedAt).toBeGreaterThan(0);
  });

  it('R5-2 — the FIRST decrypt failure stops new decryptions being scheduled', async () => {
    // ★ I AUDITED THIS CASE AND CLEARED IT FOR THE WRONG PROPERTY. I checked that a rejecting
    // worker could not produce an UNHANDLED rejection — true, and irrelevant. What matters is
    // that the surviving workers kept claiming items and issuing more KMS calls after the caller
    // had already been handed a failure, prolonging the very throttling incident the concurrency
    // cap exists to contain.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R5-2', true));
    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          let n = 0;
          const tick = (): void => {
            if (n >= 60) {
              res.end();
              return;
            }
            res.write(`data: {"i":${n},"pad":"${'w'.repeat(90)}"}\n\n`);
            n += 1;
            setTimeout(tick, 2);
          };
          tick();
        });
      },
      () => driveOne(attemptId),
    );
    const itemCount = Number(
      (
        await stack.db.adminPool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM govai.ai_conversation_items WHERE attempt_id = $1::uuid`,
          [attemptId],
        )
      ).rows[0]!.n,
    );
    expect(itemCount).toBeGreaterThan(20); // plenty of room to keep going after a failure

    // A KMS that fails the 3rd decrypt and COUNTS every call.
    const realKms = deps.kms;
    let calls = 0;
    const failingKms = Object.assign(Object.create(Object.getPrototypeOf(realKms)), realKms, {
      envelopeDecrypt: async (a: Parameters<typeof realKms.envelopeDecrypt>[0]) => {
        calls += 1;
        const mine = calls;
        await new Promise((r) => setTimeout(r, 5));
        if (mine === 3) throw new Error('kms throttled');
        return realKms.envelopeDecrypt(a);
      },
    }) as typeof realKms;

    const { getTurn } = await import('../../apps/api/src/ai-conversations/turn-service.js');
    const { turn_id, conversation_id } = await lineage(attemptId);
    await expect(
      getTurn(
        { pool: stack.db.appPool, kms: failingKms },
        { orgId: org.org_id, ownerUserId: org.user_id },
        conversation_id,
        turn_id,
      ),
    ).rejects.toThrow();

    // Let any straggler work land before counting.
    const settled = calls;
    await new Promise((r) => setTimeout(r, 400));

    // ★ NO NEW WORK AFTER THE FAILURE — the count is frozen once the caller has been failed...
    expect(calls).toBe(settled);
    // ...and it stopped FAR short of decrypting the whole set (bounded by the in-flight batch).
    expect(calls).toBeLessThanOrEqual(KMS_CAP + 2);
    expect(calls).toBeLessThan(itemCount);
  });

  it('R6-1 — a fence lost BEFORE the drain still cancels the body and emits terminal evidence', async () => {
    // ★ THE ADJACENT CASE MY OWN ROUND-5 FIX LEFT OPEN. That fix cancels from the iterator's
    // `finally` — which only runs once iteration has BEGUN. `chunks` is an async generator, and a
    // generator body does not execute until its first `next()`, so an exit that never reaches the
    // drain never acquires the reader and never cancels. Meanwhile `forwardStream`'s pump starts
    // EAGERLY at construction and reads ahead regardless, so the provider keeps generating and we
    // keep buffering for a response nobody will ever persist.
    //
    // Two such exits exist (`markStreaming` throwing, and the fence rejecting it). This drives
    // the SECOND deterministically: the claim is rotated while the provider is still holding its
    // headers back, so the fence is already lost by the time the response arrives.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R6-1', true));

    const emitted: Array<{ is_stream?: boolean; stream_outcome?: string }> = [];
    const spyDb = Object.assign(Object.create(Object.getPrototypeOf(db)), db, {
      captureAuditEvent: async (event: unknown, identity?: unknown) => {
        emitted.push(event as { is_stream?: boolean; stream_outcome?: string });
        return (db.captureAuditEvent as (e: unknown, i?: unknown) => Promise<void>)(event, identity);
      },
    }) as typeof db;

    let requestReceived = false;
    let closedAt = 0;
    let writesAfterClose = 0;
    let releaseHeaders!: () => void;
    const headersHeld = new Promise<void>((resolve) => {
      releaseHeaders = resolve;
    });

    const outcome = await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          requestReceived = true;
          // Headers are WITHHELD until the test has rotated the claim, which puts the fence loss
          // strictly before `markStreaming` — the pre-drain window this test exists to cover.
          void headersHeld.then(() => {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            // UNBOUNDED: if the body is never cancelled, it keeps producing indefinitely.
            const timer = setInterval(() => {
              if (closedAt !== 0) {
                writesAfterClose += 1;
                if (writesAfterClose > 6) clearInterval(timer);
                return;
              }
              res.write(`data: {"pad":"${'q'.repeat(120)}"}\n\n`);
            }, 15);
            res.on('close', () => {
              if (closedAt === 0) closedAt = Date.now();
              clearInterval(timer);
            });
          });
        });
      },
      async () => {
        const driving = processCandidate({ ...deps, db: spyDb }, {
          orgId: org.org_id,
          ownerUserId: org.user_id,
          conversationId: conv.id,
          attemptId,
          state: 'accepted',
          reason: 'queued_head',
          claimToken: null,
          isBranchHead: true,
        });
        // The POST is provably in flight (the provider has the whole request) but no response has
        // been produced, so nothing can have entered the drain yet.
        for (let i = 0; i < 400; i += 1) {
          if (requestReceived) break;
          await new Promise((r) => setTimeout(r, 25));
        }
        expect(requestReceived).toBe(true);
        await stack.db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET claim_token = gen_random_uuid() WHERE id = $1::uuid`,
          [attemptId],
        );
        releaseHeaders();
        const settled = await driving;
        // Give the server a moment to observe the close.
        await new Promise((r) => setTimeout(r, 300));
        return settled;
      },
    );

    // The fence was already lost when the response landed, so nothing became durable...
    expect(outcome).toBe('finalize_fenced_out');
    // ...the provider connection was CLOSED rather than left running (without the guard the
    // eager pump keeps reading and `close` never fires in this window)...
    expect(closedAt).toBeGreaterThan(0);
    // ...and terminal stream evidence was still emitted, truthfully. Without the guard
    // `finalize()` is never called at all, so this array is EMPTY — an attempt that reached the
    // provider yet left no terminal record of what happened to its stream.
    const streamEvents = emitted.filter((e) => e.is_stream === true);
    expect(streamEvents.length).toBeGreaterThan(0);
    for (const e of streamEvents) {
      expect({ outcome: e.stream_outcome }).toEqual({ outcome: 'upstream_error' });
    }
  });

  it('R6-2 — heartbeat ticks never overlap, and none outlives the dispatch', async () => {
    // ★ THE POOL IS THE SCARCE RESOURCE, AND RENEWAL IS THE LEAST IMPORTANT WORK IN THE PROCESS.
    // Each tick checks out a client from a worker pool whose default is `max: 2`. Under
    // `setInterval` a tick slower than the interval does not delay its successor — ticks overlap,
    // and a database slowdown lets heartbeats occupy every checkout, starving the persistence and
    // finalization that actually carry the result. `stop()` clearing the timer did not help: a
    // tick already running kept its checkout past the candidate it was renewing.
    //
    // Both properties are observed at the checkout seam itself, with the interval driven far
    // below the operation latency so overlap is forced rather than hoped for.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R6-2', true));

    let inFlight = 0;
    let maxInFlight = 0;
    const realWithOwnerContext = db.withOwnerContext.bind(db) as typeof db.withOwnerContext;
    const spyDb = Object.assign(Object.create(Object.getPrototypeOf(db)), db, {
      withOwnerContext: async (owner: unknown, fn: unknown) => {
        inFlight += 1;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        try {
          // Every checkout is slowed well past the heartbeat interval, so under `setInterval`
          // ticks would pile up on each other.
          await new Promise((r) => setTimeout(r, 40));
          return await (realWithOwnerContext as (o: unknown, f: unknown) => Promise<unknown>)(owner, fn);
        } finally {
          inFlight -= 1;
        }
      },
    }) as typeof db;

    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write(`data: {"phase":"one","pad":"${'h'.repeat(120)}"}\n\n`);
          // Long enough for many heartbeat ticks at a 10 ms interval.
          setTimeout(() => {
            res.write(`data: {"phase":"two","pad":"${'h'.repeat(120)}"}\n\n`);
            res.end();
          }, 400);
        });
      },
      async () =>
        processCandidate({ ...deps, db: spyDb, heartbeatIntervalMs: 10 }, {
          orgId: org.org_id,
          ownerUserId: org.user_id,
          conversationId: conv.id,
          attemptId,
          state: 'accepted',
          reason: 'queued_head',
          claimToken: null,
          isBranchHead: true,
        }),
    );

    // ★ PROPERTY 1 — no pile-up. At most one heartbeat tick can be in flight, alongside at most
    // one dispatch-path operation. Under `setInterval` with a 10 ms interval and ~40 ms checkouts
    // this climbs with the length of the stream instead of holding at a constant.
    expect(maxInFlight).toBeLessThanOrEqual(2);

    // ★ PROPERTY 2 — nothing outlives the dispatch. `processCandidate` has returned, so every
    // checkout it caused has been returned to the pool. Under a non-awaiting `stop()` a tick
    // started just before shutdown is still holding one here.
    expect(inFlight).toBe(0);
  });

  it('R7-1 — a slow heartbeat tick does not push the CADENCE out', async () => {
    // ★ MY OWN ROUND-SIX FIX INTRODUCED THIS. Chaining ticks (delay measured from settlement)
    // stops overlap, but silently ADDS each tick's runtime to every period — which breaks the
    // `heartbeatIntervalMs * 3 <= leaseMs` guarantee that config validation enforces at boot.
    // On the defaults a tick due at 15s that settles at 65s commits a deadline near 75s from
    // PostgreSQL's clock, while a settlement-relative delay would not even ATTEMPT the next
    // renewal until 80s — a window in which recovery can rotate the claim out from under a live
    // provider call.
    //
    // Measured on a NON-STREAM dispatch whose provider withholds its response: during that window
    // the executor issues no owner-context work of its own, so every checkout observed IS a
    // heartbeat tick, with no arithmetic needed to separate them.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R7-1', false));

    const TICK_COST = 40;
    const INTERVAL = 40;
    let respondedAt = Number.MAX_SAFE_INTEGER;
    const tickTimes: number[] = [];
    const tickCosts: number[] = [];
    const realWithOwnerContext = db.withOwnerContext.bind(db) as typeof db.withOwnerContext;
    const spyDb = Object.assign(Object.create(Object.getPrototypeOf(db)), db, {
      withOwnerContext: async (owner: unknown, fn: unknown) => {
        const at = Date.now();
        const counted = at < respondedAt;
        if (counted) tickTimes.push(at);
        // Each tick costs at least a full interval, so a settlement-relative schedule inserts an
        // extra dead interval between renewals while a due-time schedule does not.
        await new Promise((r) => setTimeout(r, TICK_COST));
        try {
          return await (realWithOwnerContext as (o: unknown, f: unknown) => Promise<unknown>)(owner, fn);
        } finally {
          if (counted) tickCosts.push(Date.now() - at);
        }
      },
    }) as typeof db;

    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          // Long enough for many ticks at a 40 ms cadence.
          setTimeout(() => {
            respondedAt = Date.now();
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          }, 700);
        });
      },
      async () =>
        processCandidate({ ...deps, db: spyDb, heartbeatIntervalMs: INTERVAL }, {
          orgId: org.org_id,
          ownerUserId: org.user_id,
          conversationId: conv.id,
          attemptId,
          state: 'accepted',
          reason: 'queued_head',
          claimToken: null,
          isBranchHead: true,
        }),
    );

    // ★ THE ASSERTION IS A RATE, WHICH IS THE PROPERTY THAT WAS LOST. Over a ~700 ms window with a
    // 40 ms interval and 40 ms ticks, a due-time schedule renews roughly every 40 ms (>= 12 ticks)
    // while a settlement-relative one renews every ~80 ms (~7). The lease guarantee is a function
    // of this rate, so the rate is what the test pins.
    // ★ THE ASSERTION IS SCALE-FREE, WHICH MATTERS MORE THAN IT LOOKS. An absolute tick count
    // depends on how long the window happened to be, and a first draft of this test PASSED
    // against the unfixed code for exactly that reason. What actually distinguishes the two
    // schedules is whether a whole idle INTERVAL is inserted between renewals on top of the
    // tick's own cost — a difference that survives any machine speed or CI contention, because
    // both terms are measured here rather than assumed.
    expect(tickTimes.length).toBeGreaterThanOrEqual(4);
    const avgPeriod =
      (tickTimes[tickTimes.length - 1]! - tickTimes[0]!) / (tickTimes.length - 1);
    const avgCost = tickCosts.reduce((a, b) => a + b, 0) / tickCosts.length;
    // Due-time scheduling: period ≈ the tick's own cost. Settlement-relative: cost + INTERVAL.
    expect({ periodExceedsCostBy: avgPeriod - avgCost < INTERVAL / 2 }).toEqual({
      periodExceedsCostBy: true,
    });
  });

  it('R7-2 — a stream whose TERMINAL EVIDENCE fails is not durably marked completed', async () => {
    // ★ THE RIGHT RULE, APPLIED WHERE IT DID NOT BELONG. My comment said a finalizer failure
    // "must not mask the original drain error" — correct, and I applied it unconditionally,
    // including when there IS no original error. A stream that reached EOF whose terminal event
    // failed to capture was then marked `completed`: a permanent evidence gap opened exactly
    // during an audit-database failure, and invisible afterwards because the attempt looks
    // healthy.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R7-2', true));

    // ONLY the terminal stream event fails; every other capture succeeds, so nothing else about
    // the run is disturbed.
    const spyDb = Object.assign(Object.create(Object.getPrototypeOf(db)), db, {
      captureAuditEvent: async (event: unknown, identity?: unknown) => {
        if ((event as { stream_outcome?: string }).stream_outcome !== undefined) {
          throw new Error('audit database unavailable');
        }
        return (db.captureAuditEvent as (e: unknown, i?: unknown) => Promise<void>)(event, identity);
      },
    }) as typeof db;

    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write(`data: {"phase":"one","pad":"${'e'.repeat(120)}"}\n\n`);
          // A clean EOF: the drain succeeds, so the finalizer failure is the ONLY thing wrong.
          setTimeout(() => res.end(), 40);
        });
      },
      async () =>
        processCandidate({ ...deps, db: spyDb }, {
          orgId: org.org_id,
          ownerUserId: org.user_id,
          conversationId: conv.id,
          attemptId,
          state: 'accepted',
          reason: 'queued_head',
          claimToken: null,
          isBranchHead: true,
        }),
    );

    const row = await stack.db.adminPool.query<{ state: string; error_class: string | null }>(
      `SELECT state, error_class FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
      [attemptId],
    );
    // The provider answered and we drained it; only the durable record failed. That is
    // `persistence_error` — never `completed`, and never `outcome_unknown`.
    expect(row.rows[0]).toEqual({ state: 'failed', error_class: 'persistence_error' });
  });

  it('R7-3 — a post-response AUDIT failure is persistence_error, not outcome_unknown', async () => {
    // ★ `outcome_unknown` MEANS "the provider's fate is unprovable", and §7.7 builds real
    // behaviour on it. A non-stream response is already fully in hand before the audit write, so
    // routing that write's failure through the ambiguity arm discarded a KNOWN result and
    // asserted ambiguity about a fate we could prove — diluting the one state whose entire value
    // is that it is reserved for genuine unknowns.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R7-3', false));

    const spyDb = Object.assign(Object.create(Object.getPrototypeOf(db)), db, {
      captureAuditEvent: async (event: unknown, identity?: unknown) => {
        if ((event as { is_stream?: boolean }).is_stream === false) {
          throw new Error('audit database unavailable');
        }
        return (db.captureAuditEvent as (e: unknown, i?: unknown) => Promise<void>)(event, identity);
      },
    }) as typeof db;

    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, answer: 'durable' }));
        });
      },
      async () =>
        processCandidate({ ...deps, db: spyDb }, {
          orgId: org.org_id,
          ownerUserId: org.user_id,
          conversationId: conv.id,
          attemptId,
          state: 'accepted',
          reason: 'queued_head',
          claimToken: null,
          isBranchHead: true,
        }),
    );

    const row = await stack.db.adminPool.query<{ state: string; error_class: string | null }>(
      `SELECT state, error_class FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
      [attemptId],
    );
    expect(row.rows[0]).toEqual({ state: 'failed', error_class: 'persistence_error' });
  });

  it('R7-4 — an audit failure BEFORE any POST stays local_error, not persistence_error', async () => {
    // ★ A CHARACTERIZATION TEST, NOT A FALSIFICATION ONE — AND THE DISTINCTION IS RECORDED
    // BECAUSE I NEARLY GOT IT WRONG. Reviewing my own R7-3 fix I believed I had found an adjacent
    // case: the governed handlers also emit when governance REFUSES, before any POST exists, so
    // wrapping every capture failure as `persistence_error` looked like it would assert the
    // provider answered a request it never received. I added a `forwardStarted` gate and this
    // test — and the test PASSES WITHOUT THE GATE.
    //
    // The reason is that the outer catch tests `!forwardStarted` BEFORE it tests the persistence
    // marker, so a pre-POST failure was already classified `local_error`. The defect was never
    // real. What IS real is the coupling: the correct answer depends on the order of two branches
    // thirty lines apart. The gate makes the property local, and this test pins the behaviour so
    // a reordering cannot quietly invert it.
    //
    // The computer-use tool floor is the governed handler's explicit block, so this reaches the
    // real enforcement path rather than simulating one.
    const conv = await createConversation({ mode: 'governed' });
    const { attemptId } = await send(conv.id, conv.branchId, {
      model: 'claude-test',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'R7-4' }],
      tools: [{ type: 'computer_20250124', name: 'computer', display_width_px: 1, display_height_px: 1 }],
    });

    // ★ DRIVEN THROUGH THE REAL BRIDGE, not a spy — and this path only became REACHABLE because
    // of the strict posture added for R8-1. Before it, a blocked-path capture failure was
    // swallowed and the attempt was recorded `rejected` with its evidence silently absent. Under
    // strict it surfaces, which is a behaviour change worth PROVING rather than assuming: a
    // governance decision whose evidence never landed should not be recorded as a clean refusal.
    const SIG = `govai.audit_capture_insert_locked(
      uuid, uuid, text, text, bigint, text, text, text, uuid, timestamptz,
      bytea, bytea, bytea, text, integer, jsonb, text, bytea, text, text
    )`;
    await stack.db.adminPool.query(
      `REVOKE EXECUTE ON FUNCTION ${SIG} FROM govai_conversation_worker`,
    );
    try {
      await processCandidate(deps, {
        orgId: org.org_id,
        ownerUserId: org.user_id,
        conversationId: conv.id,
        attemptId,
        state: 'accepted',
        reason: 'queued_head',
        claimToken: null,
        isBranchHead: true,
      });
    } finally {
      await stack.db.adminPool.query(
        `GRANT EXECUTE ON FUNCTION ${SIG} TO govai_conversation_worker`,
      );
    }

    const row = await stack.db.adminPool.query<{
      state: string;
      error_class: string | null;
      cred: string | null;
    }>(
      `SELECT state, error_class, provider_credential_id::text AS cred
         FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
      [attemptId],
    );
    // No POST happened — proved durably by the absent provenance — so the failure is GovAI-local.
    expect(stack.provider.recordedRequests).toEqual([]);
    expect(row.rows[0]).toEqual({ state: 'failed', error_class: 'local_error', cred: null });
  });

  it('R8-1 — a REAL audit-capture failure (no spy) is not marked completed', async () => {
    // ★ THE MOST IMPORTANT TEST IN THIS FILE, BECAUSE IT INDICTS THE OTHERS. R7-2 and R7-3 proved
    // the executor classifies a REJECTED capture correctly — by injecting a `captureAuditEvent`
    // spy that rejects. Production could never produce that rejection: the worker built its audit
    // bridge WITHOUT `posture: 'strict'`, and the bridge SWALLOWS capture failures in
    // `best_effort`. The handler was unreachable, and a spy-driven test certified it anyway.
    //
    // So this test refuses the spy entirely. It breaks the capture where it actually breaks — the
    // privilege on the SECURITY DEFINER function the bridge calls — and drives the real path:
    // executor → bridge → `govai.audit_capture_insert_locked` → permission denied → strict
    // rethrow → classification. Nothing about the failure is simulated.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R8-1', false));

    // 0026's signature, which 0034 grants to the worker role.
    const SIG = `govai.audit_capture_insert_locked(
      uuid, uuid, text, text, bigint, text, text, text, uuid, timestamptz,
      bytea, bytea, bytea, text, integer, jsonb, text, bytea, text, text
    )`;

    await stack.db.adminPool.query(
      `REVOKE EXECUTE ON FUNCTION ${SIG} FROM govai_conversation_worker`,
    );
    try {
      await withProviderBehaviour(
        (req, res) => {
          req.on('data', () => undefined);
          req.on('end', () => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, answer: 'durable' }));
          });
        },
        async () =>
          processCandidate(deps, {
            orgId: org.org_id,
            ownerUserId: org.user_id,
            conversationId: conv.id,
            attemptId,
            state: 'accepted',
            reason: 'queued_head',
            claimToken: null,
            isBranchHead: true,
          }),
      );
    } finally {
      // Restore unconditionally — every later test in this file shares this database.
      await stack.db.adminPool.query(
        `GRANT EXECUTE ON FUNCTION ${SIG} TO govai_conversation_worker`,
      );
    }

    const row = await stack.db.adminPool.query<{ state: string; error_class: string | null }>(
      `SELECT state, error_class FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
      [attemptId],
    );
    // The provider answered; only the durable evidence write failed. `completed` here would be an
    // attempt asserting success with its required evidence permanently absent.
    expect(row.rows[0]).toEqual({ state: 'failed', error_class: 'persistence_error' });
  });

  it('R8-1b — the same REAL failure on the STREAM terminal path is not marked completed', async () => {
    // ★ THE ADJACENT CASE, COVERED THIS TIME RATHER THAN LEFT FOR THE NEXT ROUND. R8-1 drives the
    // non-stream `invoked` emit; the stream terminal event is a DIFFERENT code path
    // (`recordStream`'s `finally`), reached only after a clean EOF, and it carries the same
    // obligation. Both are exercised through the real bridge with no spy.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R8-1b', true));

    const SIG = `govai.audit_capture_insert_locked(
      uuid, uuid, text, text, bigint, text, text, text, uuid, timestamptz,
      bytea, bytea, bytea, text, integer, jsonb, text, bytea, text, text
    )`;

    await stack.db.adminPool.query(
      `REVOKE EXECUTE ON FUNCTION ${SIG} FROM govai_conversation_worker`,
    );
    try {
      await withProviderBehaviour(
        (req, res) => {
          req.on('data', () => undefined);
          req.on('end', () => {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write(`data: {"phase":"one","pad":"${'b'.repeat(120)}"}\n\n`);
            // A CLEAN EOF: the drain succeeds, so the evidence write is the only thing wrong.
            setTimeout(() => res.end(), 40);
          });
        },
        async () =>
          processCandidate(deps, {
            orgId: org.org_id,
            ownerUserId: org.user_id,
            conversationId: conv.id,
            attemptId,
            state: 'accepted',
            reason: 'queued_head',
            claimToken: null,
            isBranchHead: true,
          }),
      );
    } finally {
      await stack.db.adminPool.query(
        `GRANT EXECUTE ON FUNCTION ${SIG} TO govai_conversation_worker`,
      );
    }

    const row = await stack.db.adminPool.query<{ state: string; error_class: string | null }>(
      `SELECT state, error_class FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
      [attemptId],
    );
    expect(row.rows[0]).toEqual({ state: 'failed', error_class: 'persistence_error' });
  });

  it('R9-1 — the DEPLOYED worker process stays alive long enough to sweep', async () => {
    // ★ THE ONLY TEST IN THIS SUITE THAT RUNS THE DEPLOYABLE UNIT AS A PROCESS, AND IT EXISTS
    // BECAUSE NOTHING ELSE COULD HAVE CAUGHT THIS. The sweep timer was `unref`'d — sound advice
    // for a timer running beside a live server listener, and fatal for the DEDICATED entrypoint,
    // where nothing else holds the event loop: the signal handlers do not, and the pool is lazy
    // and has not connected. The process therefore exited normally BEFORE its first sweep, so no
    // durable turn was ever discovered. **The whole deployable unit was a silent no-op**, and
    // every other test in this file passed, because they all call `runConversationSweepOnce` or
    // `processCandidate` DIRECTLY and never start the process at all.
    //
    // Reachability is not testable from inside the module under test. So this spawns the real
    // entrypoint and asks the only question that matters: is it still running when its first
    // sweep is due?
    const { spawn } = await import('node:child_process');
    const INTERVAL_MS = 1_000;

    // Real, durable work for the spawned process to find. Liveness alone is too weak an
    // assertion: it cannot distinguish a process that sweeps from one that merely idles.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R9-1', false));

    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'apps/api/src/conversation-worker/main.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          GOVAI_CONVERSATION_WORKER_DATABASE_URL: stack.db.conversationWorkerUrl,
          DATABASE_URL: stack.db.adminUrl,
          GOVAI_KMS_PROVIDER: 'dev',
          KMS_DEV_SEED: stack.seed,
          JWT_ISSUER: 'https://govai.test',
          JWT_AUDIENCE: 'govai-api',
          CONVERSATION_WORKER_INTERVAL_MS: String(INTERVAL_MS),
          // ★ PIN THE CHILD TO THE HERMETIC UPSTREAM. This test inherits `process.env`, not
          // `stack.env`, and the executor's resolver defaults to the PUBLIC provider hosts. Earlier
          // tests in this file leave real `queued_head` attempts in the shared database, so the
          // spawned worker's first sweep would dispatch one — issuing a genuine external request
          // from the suite, or hanging until SIGKILL, while a liveness-only assertion passed
          // anyway. A test that can reach the open internet is not hermetic no matter what it
          // asserts.
          GOVAI_PROVIDER_BASE_URL: stack.provider.baseUrl,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let exitedAt: number | null = null;
    let exitCode: number | null = null;
    const startedAt = Date.now();
    child.on('exit', (code) => {
      exitedAt = Date.now();
      exitCode = code;
    });
    let out = '';
    child.stdout?.on('data', (b: Buffer) => {
      out += b.toString('utf8');
    });
    child.stderr?.on('data', (b: Buffer) => {
      out += b.toString('utf8');
    });

    try {
      // Wait past boot AND past the first sweep's due time. An `unref`'d timer lets the process
      // exit within a second or two of boot — long before this window closes.
      const DEADLINE = 20_000;
      const startedLine = /conversation worker: started/;
      let sawStarted = false;
      for (let i = 0; i < DEADLINE / 250; i += 1) {
        if (!sawStarted && startedLine.test(out)) {
          sawStarted = true;
          // Once booted, wait out two full sweep intervals with the process referenced.
          await new Promise((r) => setTimeout(r, INTERVAL_MS * 2 + 500));
          break;
        }
        if (exitedAt !== null) break;
        await new Promise((r) => setTimeout(r, 250));
      }

      // ★ ASSERTION 1: it booted, and it was STILL RUNNING when its first sweeps were due.
      // Without the fix the process is gone here, having done nothing at all.
      expect({
        booted: sawStarted,
        stillRunning: exitedAt === null,
        exitCode,
      }).toEqual({ booted: true, stillRunning: true, exitCode: null });
      expect(Date.now() - startedAt).toBeGreaterThan(INTERVAL_MS);

      // ★ ASSERTION 2 — THE ONE THAT PROVES A SWEEP ACTUALLY RAN. A process can stay alive and
      // still do nothing; only durable state changing underneath us proves the deployable
      // discovered, claimed, dispatched and persisted a turn it was never handed directly.
      let finalState: string | null = null;
      for (let i = 0; i < 60; i += 1) {
        const r = await stack.db.adminPool.query<{ state: string }>(
          `SELECT state FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
          [attemptId],
        );
        finalState = r.rows[0]?.state ?? null;
        if (finalState === 'completed') break;
        await new Promise((rr) => setTimeout(rr, 500));
      }
      expect({ attemptState: finalState }).toEqual({ attemptState: 'completed' });
    } finally {
      child.kill('SIGKILL');
    }
  }, 60_000);

  it('R9-2 — A1 against a REAL pool: killing a checked-out backend does not kill the process', async () => {
    // ★ FOUND BY MY OWN SWEEP AFTER ROUND EIGHT, NOT BY REVIEW. `P0A2-P3-A1` says a checked-out
    // pg client carries no `error` listener, so a backend disconnect DURING a checkout is an
    // unhandled 'error' event and the process dies. The closure was proven only against a FAKE
    // pool (`ai-conversation-worker.gates.test.ts` injects a hand-rolled `connect()`), which
    // reproduces none of pg-pool's actual checkout semantics — the very thing the defect is about.
    // That is the same class round eight found: a fix whose only evidence is a stand-in.
    //
    // So this uses the REAL pool against the REAL database and kills the backend from OUTSIDE,
    // with admin privileges the worker role deliberately does not have.
    const observed: Array<{ scope: string; errorClass: string }> = [];
    const victim = createConversationWorkerDb({
      config: { connectionString: stack.db.conversationWorkerUrl, max: 1, workerId: 'r9-2' },
      log: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      onDbError: (e, scope) => {
        observed.push({ scope, errorClass: e.errorClass });
      },
    });

    try {
      let pid = 0;
      const held = victim.withOwnerContext(
        { orgId: org.org_id, ownerUserId: org.user_id },
        async (tx) => {
          pid = (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          // Stay checked out long enough to be killed mid-flight. `pg_sleep` keeps a REAL query
          // in flight, so the termination lands on an active client rather than an idle one.
          await tx.query('SELECT pg_sleep(5)');
          return 'survived-unexpectedly';
        },
      );

      for (let i = 0; i < 100 && pid === 0; i += 1) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(pid).toBeGreaterThan(0);

      // Kill it from the admin connection — the worker role cannot signal backends (W20).
      await stack.db.adminPool.query('SELECT pg_terminate_backend($1)', [pid]);

      // The caller still observes a rejection: pg rejects the in-flight query. What must NOT
      // happen is the process dying on an unhandled 'error' event — and if it did, this test file
      // would not reach the assertion below at all.
      const outcome = await held.then(
        (v) => ({ ok: true as const, v }),
        (e: unknown) => ({ ok: false as const, name: e instanceof Error ? e.name : 'unknown' }),
      );
      expect(outcome.ok).toBe(false);

      // The listener absorbed the emit and reported it through the sanitized seam.
      for (let i = 0; i < 40 && observed.length === 0; i += 1) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(observed.length).toBeGreaterThan(0);
      // Sanitized: a CLASS, never a message that could carry a connection string.
      expect(typeof observed[0]!.errorClass).toBe('string');
    } finally {
      await victim.close().catch(() => undefined);
    }
  }, 60_000);

  it('R10-1 — shutdown is bounded by ONE in-flight candidate, not the whole backlog', async () => {
    // ★ THIS DEFECT ONLY BECAME MATERIAL WHEN ROUND NINE MADE THE PROCESS ACTUALLY RUN. While the
    // sweep timer was `unref`'d the process exited immediately, so shutdown semantics never
    // mattered; fixing that exposed this.
    //
    // `stop()` cleared the next timer and awaited the running sweep — but the sweep did not
    // OBSERVE the stop, so it continued through every remaining page and candidate, each dispatch
    // bounded only by `dispatchTimeoutMs`. Under a backlog that outlasts any orchestrator's grace
    // period, so the process is SIGKILLed mid-dispatch, turning a clean shutdown into exactly the
    // `outcome_unknown` it exists to avoid.
    //
    // Cancellation is COOPERATIVE by design: it declines to START candidates and never aborts one
    // in flight, because aborting a POSTed dispatch would manufacture that same ambiguity.
    const DELAY_MS = 400;
    const BACKLOG = 8;
    const ids: string[] = [];
    for (let i = 0; i < BACKLOG; i += 1) {
      const conv = await createConversation({ mode: 'passthrough' });
      const { attemptId } = await send(conv.id, conv.branchId, nativeRequest(`R10-1-${i}`, false));
      ids.push(attemptId);
    }

    // ★ A HANDSHAKE, NOT A SLEEP — AND I HAD ALREADY LEARNED THIS ONCE IN THIS MOVEMENT (see
    // `RM1`, where a 20 ms timer was replaced by a durable receipt) AND REPEATED IT ANYWAY. A fixed
    // 250 ms wait assumes boot, discovery and claim setup all fit inside it; on a loaded machine
    // they do not, and `stop()` then runs BEFORE any dispatch begins. The test would still pass —
    // an immediate stop is fast and zero completions is "fewer than the backlog" — so the
    // UNBOUNDED implementation would go untested while the suite reported success. That is the
    // same worthless-proof failure as round seven's tick-count assertion.
    let firstDispatchSeen!: () => void;
    const firstDispatch = new Promise<void>((resolve) => {
      firstDispatchSeen = resolve;
    });

    let stopElapsed = 0;
    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          // The provider has the request: a dispatch is provably in flight, not merely likely.
          firstDispatchSeen();
          // Each dispatch is slow, so a sweep that ignores the stop takes BACKLOG × DELAY_MS.
          setTimeout(() => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          }, DELAY_MS);
        });
      },
      async () => {
        const handle = startConversationWorker(deps, {
          batchSize: 50,
          intervalMs: 50,
          maxPagesPerSweep: 5,
        });
        // Fail LOUD rather than vacuously if no dispatch ever starts.
        await Promise.race([
          firstDispatch,
          new Promise((_r, reject) =>
            setTimeout(() => reject(new Error('no provider dispatch started')), 30_000),
          ),
        ]);
        const t0 = Date.now();
        await handle.stop();
        stopElapsed = Date.now() - t0;

        // ★ CONCURRENT STOPS MUST AWAIT THE SAME DRAIN. A second signal resolving early would let
        // the entrypoint's `process.exit(0)` fire mid-dispatch — the very ambiguity this bounds.
        const second = handle.stop();
        await second;
        return null;
      },
    );

    const done = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_attempts
        WHERE id = ANY($1::uuid[]) AND state = 'completed'`,
      [ids],
    );
    const completed = Number(done.rows[0]!.n);

    // ★ THE PRIMARY ASSERTION IS A COUNT, NOT A DURATION, AND THAT IS DELIBERATE. A wall-clock
    // bound on a machine whose per-candidate cost is not fixed is a flake waiting to happen — the
    // dispatch carries database, KMS and HTTP work that CI contention can stretch arbitrarily.
    // What CANNOT drift is how many candidates a sweep chose to start: the whole backlog, or the
    // one already in flight. The untouched attempts stay durably queued for the next runner,
    // which is exactly why declining them costs nothing.
    // ★ THE LOWER BOUND IS WHAT MAKES A VACUOUS PASS IMPOSSIBLE. At least one candidate must have
    // been dispatched AND completed — otherwise the stop landed before any work began and the test
    // proved nothing, which is precisely how a fixed sleep fails silently.
    expect({ declinedMost: completed <= 3, atLeastOneRan: completed >= 1 }).toEqual({
      declinedMost: true,
      atLeastOneRan: true,
    });
    // The duration is asserted too, but only against the FULL-DRAIN cost it must beat by a wide
    // margin (8 × 400 ms ≈ 3.2 s), not against a tight estimate of one candidate.
    expect({ farBelowFullDrain: stopElapsed < (BACKLOG * DELAY_MS) / 2 }).toEqual({
      farBelowFullDrain: true,
    });
  }, 60_000);

  it('R11-1 — a SECOND stop() awaits the same drain, it does not resolve early', async () => {
    // ★ `if (stopped) return` LOOKS LIKE CORRECT IDEMPOTENCE AND IS NOT. The second caller gets an
    // already-resolved promise while the FIRST is still awaiting an active candidate. That matters
    // because the entrypoint calls `process.exit(0)` the moment its own `stop()` resolves — so a
    // second SIGTERM (an impatient operator, or an orchestrator that sends TERM twice) exits the
    // process mid-dispatch and recreates exactly the `outcome_unknown` the bounded shutdown exists
    // to prevent. The failure needs two signals AND an in-flight dispatch to appear, which is why
    // it survived the round that introduced the bound.
    const DELAY_MS = 600;
    const conv = await createConversation({ mode: 'passthrough' });
    await send(conv.id, conv.branchId, nativeRequest('R11-1', false));

    let firstDispatchSeen!: () => void;
    const firstDispatch = new Promise<void>((resolve) => {
      firstDispatchSeen = resolve;
    });
    let providerRespondedAt = 0;

    let firstDone = 0;
    let secondDone = 0;
    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          firstDispatchSeen();
          setTimeout(() => {
            providerRespondedAt = Date.now();
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          }, DELAY_MS);
        });
      },
      async () => {
        const handle = startConversationWorker(deps, {
          batchSize: 50,
          intervalMs: 50,
          maxPagesPerSweep: 2,
        });
        await Promise.race([
          firstDispatch,
          new Promise((_r, reject) =>
            setTimeout(() => reject(new Error('no provider dispatch started')), 30_000),
          ),
        ]);
        // Two shutdowns race, exactly as two signals would.
        const a = handle.stop().then(() => {
          firstDone = Date.now();
        });
        const b = handle.stop().then(() => {
          secondDone = Date.now();
        });
        await Promise.all([a, b]);
        return null;
      },
    );

    // ★ THE ASSERTION: the SECOND stop did not resolve before the dispatch finished. With the
    // early return it resolves essentially instantly — and in the real entrypoint that is the
    // instant `process.exit(0)` runs, with a provider call still open.
    expect(providerRespondedAt).toBeGreaterThan(0);
    expect({
      secondWaitedForDispatch: secondDone >= providerRespondedAt,
      bothSawTheSameDrain: Math.abs(secondDone - firstDone) < 250,
    }).toEqual({ secondWaitedForDispatch: true, bothSawTheSameDrain: true });
  }, 60_000);

  it('R3-6 — a VALID-UTF-8 non-JSON body still comes back as text, not base64', async () => {
    // The byte-safe path must not swallow the ordinary case: a legitimate UTF-8 error page is
    // still the more useful `text`.
    const conv = await createConversation({ mode: 'passthrough' });
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('R3-6'));
    const html = '<html><body>Café — 502 Bad Gateway ✓</body></html>';
    await withProviderBehaviour(
      (_req, res) => {
        res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      },
      () => driveOne(attemptId),
    );
    const { conversation_id, turn_id } = await lineage(attemptId);
    const res = await inject(
      stack,
      'GET',
      `/v1/ai/conversations/${conversation_id}/turns/${turn_id}`,
      org.api_key,
    );
    const item = (res.body as {
      attempts: Array<{ output_items: Array<{ native: unknown; text: string | null; bytes_base64: string | null }> }>;
    }).attempts[0]!.output_items[0]!;
    expect(item.text).toBe(html);
    expect(item.bytes_base64).toBeNull();
    expect(item.native).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// PROVIDER PIPELINE EQUIVALENCE — the §32 side-by-side
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('EQ — a worker-driven dispatch and a request-driven one are the SAME execution', () => {
  /**
   * Run the IDENTICAL native request through both doors and compare what the provider saw and
   * what the evidence plane recorded.
   *
   * ★ WHY A SIDE-BY-SIDE AND NOT TWO SEPARATE ASSERTIONS. "Both paths emit a capture" can be
   * true while the two describe different capabilities, different tenant facts, or different
   * bytes. The two-speed doctrine (§9) says the conversation runner is "an ADDITIONAL caller of
   * the same provider pipeline, NOT a fork of it" — the only way to check that is to make both
   * calls and diff them.
   *
   * ★ WHAT IS DELIBERATELY NOT COMPARED: values that are request-UNIQUE by design — the
   * `govai_request_id` (one per invocation), the derived `capture_id`, the provider's own
   * response id, and latency. Comparing those would be comparing identity, not semantics.
   */
  async function evidenceFor(captureId: string): Promise<Record<string, unknown> | null> {
    const r = await stack.db.adminPool.query<{
      event_type: string;
      event_version: string;
      chain_category: string;
      subject_type: string;
      redaction_metadata: Record<string, unknown>;
    }>(
      `SELECT event_type, event_version, chain_category, subject_type, redaction_metadata
         FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
      [captureId],
    );
    return r.rows[0] ?? null;
  }

  it('EQ1 — Anthropic governed: same body forwarded, same capture contract, same governance', async () => {
    const request = {
      model: 'claude-test',
      max_tokens: 32,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'EQ1 equivalence' }] }],
    };

    // ── DOOR 1: the request-driven direct route ────────────────────────────────────────────
    stack.provider.clearRecordedRequests();
    stack.provider.clearRecordedRequestHeaders();
    const direct = await stack.app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: { 'content-type': 'application/json', 'x-govai-api-key': org.api_key },
      payload: JSON.stringify(request),
    });
    expect(direct.statusCode).toBe(200);
    const directRequestId = direct.headers['x-govai-request-id'] as string;
    const directHeaders = { ...(stack.provider.recordedRequestHeaders[0] as Record<string, string>) };
    const directUrl = stack.provider.recordedRequests[0]!.url;

    // ── DOOR 2: the worker-driven conversation ─────────────────────────────────────────────
    stack.provider.clearRecordedRequests();
    stack.provider.clearRecordedRequestHeaders();
    const conv = await createConversation({ mode: 'governed' });
    const { attemptId } = await send(conv.id, conv.branchId, request);
    expect(await driveOne(attemptId)).toBe('completed');
    const workerHeaders = { ...(stack.provider.recordedRequestHeaders[0] as Record<string, string>) };
    const workerUrl = stack.provider.recordedRequests[0]!.url;
    const a = await attempt(attemptId);

    // ── SAME ENDPOINT, SAME PROVIDER AUTH ─────────────────────────────────────────────────
    expect(workerUrl).toBe(directUrl);
    expect(workerHeaders['x-api-key']).toBe(directHeaders['x-api-key']);
    expect(workerHeaders['anthropic-version']).toBe(directHeaders['anthropic-version']);
    expect(workerHeaders['content-type']).toBe(directHeaders['content-type']);
    // Neither door leaks GovAI identity upstream.
    for (const h of ['x-govai-api-key', 'x-govai-request-id', 'x-govai-idempotency-key']) {
      expect({ h, direct: h in directHeaders, worker: h in workerHeaders }).toEqual({
        h,
        direct: false,
        worker: false,
      });
    }

    // ── SAME CAPTURE CONTRACT ─────────────────────────────────────────────────────────────
    const { auditBridgeCaptureId } = await import('../../apps/api/src/pipeline/audit-bridge.js');
    const scope = {
      orgId: org.org_id,
      provider: 'anthropic',
      capabilityId: 'anthropic.messages.create',
      nativeMethod: 'POST' as const,
      nativeEndpoint: '/v1/messages',
    };
    const directCapture = await evidenceFor(
      auditBridgeCaptureId({ govaiRequestId: directRequestId, identityScope: 'govai_request_id' }, scope),
    );
    const workerCapture = await evidenceFor(
      auditBridgeCaptureId({ govaiRequestId: a.govai_request_id!, identityScope: 'govai_request_id' }, scope),
    );
    expect(directCapture).not.toBeNull();
    expect(workerCapture).not.toBeNull();
    // ★ EVERY REPLAY-STABLE FIELD IS IDENTICAL. The request ids differ (they must); the
    // CONTRACT does not.
    expect(workerCapture).toEqual(directCapture);
    expect(workerCapture!.event_type).toBe('passthrough.invoked');
    expect(workerCapture!.event_version).toBe('4');
    expect((workerCapture!.redaction_metadata as { audit_bridge: { capability_id: string } }).audit_bridge.capability_id)
      .toBe('anthropic.messages.create');

    // ── AND THE DIFFERENT REQUEST IDENTITIES ARE REAL, NOT AN ARTEFACT ────────────────────
    expect(a.govai_request_id).not.toBe(directRequestId);
  });

  it('EQ2 — OpenAI: both doors reach /v1/responses with the same auth scheme and capture', async () => {
    const request = { model: 'gpt-test', input: 'EQ2 equivalence' };

    stack.provider.clearRecordedRequests();
    stack.provider.clearRecordedRequestHeaders();
    const direct = await stack.app.inject({
      method: 'POST',
      url: '/governed/openai/v1/responses',
      headers: { 'content-type': 'application/json', 'x-govai-api-key': org.api_key },
      payload: JSON.stringify(request),
    });
    expect(direct.statusCode).toBe(200);
    const directRequestId = direct.headers['x-govai-request-id'] as string;
    const directHeaders = { ...(stack.provider.recordedRequestHeaders[0] as Record<string, string>) };
    expect(stack.provider.recordedRequests[0]!.url).toBe('/v1/responses');

    stack.provider.clearRecordedRequests();
    stack.provider.clearRecordedRequestHeaders();
    const conv = await createConversation({ mode: 'governed', provider: 'openai' });
    const { attemptId } = await send(conv.id, conv.branchId, request);
    expect(await driveOne(attemptId)).toBe('completed');
    const workerHeaders = { ...(stack.provider.recordedRequestHeaders[0] as Record<string, string>) };
    expect(stack.provider.recordedRequests[0]!.url).toBe('/v1/responses');
    expect(workerHeaders['authorization']).toBe(directHeaders['authorization']);

    const a = await attempt(attemptId);
    const { auditBridgeCaptureId } = await import('../../apps/api/src/pipeline/audit-bridge.js');
    const scope = {
      orgId: org.org_id,
      provider: 'openai',
      capabilityId: 'openai.responses.create',
      nativeMethod: 'POST' as const,
      nativeEndpoint: '/v1/responses',
    };
    const directCapture = await evidenceFor(
      auditBridgeCaptureId({ govaiRequestId: directRequestId, identityScope: 'govai_request_id' }, scope),
    );
    const workerCapture = await evidenceFor(
      auditBridgeCaptureId({ govaiRequestId: a.govai_request_id!, identityScope: 'govai_request_id' }, scope),
    );
    expect(directCapture).not.toBeNull();
    expect(workerCapture).toEqual(directCapture);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// SECURITY MATRIX (§31)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('S — the worker security matrix', () => {
  it('S1 — with NO owner context the worker reads and writes ZERO rows', async () => {
    const c = await probe.connect();
    try {
      await c.query("SELECT set_config('app.org_id', '', false), set_config('app.user_id', '', false)");
      for (const q of [
        'SELECT id FROM govai.ai_conversation_attempts',
        'SELECT id FROM govai.ai_conversation_content',
        'SELECT id FROM govai.ai_conversation_items',
        'SELECT id FROM govai.ai_conversation_branches',
        'SELECT id FROM govai.provider_credentials',
        'SELECT id FROM govai.orgs',
      ]) {
        const r = await c.query(q);
        expect({ q, rows: r.rowCount }).toEqual({ q, rows: 0 });
      }
      // Writes too: a policy without a context matches nothing.
      const w = await c.query(`UPDATE govai.ai_conversation_attempts SET updated_at = now()`);
      expect(w.rowCount).toBe(0);
    } finally {
      c.release();
    }
  });

  it('S2 — the worker cannot write the columns P0-C withheld', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('S2'));
    await withProbeTx(async (c) => {
      // ★ EACH DENIAL ABORTS THE TRANSACTION, so each assertion needs its own savepoint —
      // otherwise only the FIRST one is a real test and every later one merely observes 25P02
      // (which is what an earlier revision of this test did).
      const denied = async (label: string, sql: string, params: unknown[] = []): Promise<void> => {
        await c.query('SAVEPOINT probe');
        await expect(
          c.query(sql, params).then(
            () => ({ label, code: 'NO ERROR — the worker was ALLOWED to do this' }),
            (e: { code?: string }) => ({ label, code: e.code }),
          ),
        ).resolves.toEqual({ label, code: '42501' });
        await c.query('ROLLBACK TO SAVEPOINT probe');
      };

      // `stop_requested` is a REQUEST-plane command the worker only ever READS as a fence.
      await denied(
        'write stop_requested',
        `UPDATE govai.ai_conversation_attempts SET stop_requested = true WHERE id = $1::uuid`,
        [attemptId],
      );
      // The §11 continuation anchor is P0-D's, and is unreachable even for READING.
      await denied(
        'read the continuation anchor',
        `SELECT continuation_parent_ciphertext FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
        [attemptId],
      );
      // No INSERT on attempts: an attempt is minted by the reservation, never by the executor.
      await denied(
        'insert an attempt',
        `INSERT INTO govai.ai_conversation_attempts (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$3::uuid,$3::uuid,2)`,
        [org.org_id, org.user_id, conv.id],
      );
      // No DELETE anywhere in the domain.
      // No DELETE anywhere in the domain (LAW 13's purge is a later movement's authority).
      for (const t of [
        'ai_conversation_attempts',
        'ai_conversation_items',
        'ai_conversation_content',
        'ai_conversation_branches',
        'ai_conversations',
      ]) {
        await denied(`delete from ${t}`, `DELETE FROM govai.${t}`);
      }
      // And no provider-state write: P0-C ships no continuation (§23's P0-D wall).
      await denied(
        'insert provider state',
        `INSERT INTO govai.ai_conversation_provider_state
           (org_id, owner_user_id, conversation_id, branch_id, state_ciphertext, state_dek_wrapped,
            kms_key_id, kms_key_version, seeded_at_causal_version, provider_credential_id)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$3::uuid,'\\x00'::bytea,'\\x00'::bytea,'k',1,0,$4::uuid)`,
        [org.org_id, org.user_id, conv.id, credentialId],
      );
    });
  });

  it('S3 — the worker cannot change a conversation’s lifecycle or read its title', async () => {
    const conv = await createConversation({});
    await withProbeTx(async (c) => {
      // ★ The UPDATE privilege exists ONLY so `FOR KEY SHARE` is LEGAL: PostgreSQL raises
      // ACL_SELECT_FOR_UPDATE (defined as ACL_UPDATE) for any row-locking clause. This assertion
      // is what proves the grant is necessary — without it the boundary could not take the lock.
      const lock = await c.query(`SELECT status FROM govai.ai_conversations WHERE id = $1::uuid FOR KEY SHARE`, [conv.id]);
      expect(lock.rowCount).toBe(1);
      // ...and it is scoped to `updated_at`, so the lifecycle and the title stay unreachable.
      await c.query('SAVEPOINT probe');
      await expect(
        c.query(`UPDATE govai.ai_conversations SET status = 'deleted_pending' WHERE id = $1::uuid`, [conv.id]),
      ).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK TO SAVEPOINT probe');
      await expect(
        c.query(`SELECT title_ciphertext FROM govai.ai_conversations WHERE id = $1::uuid`, [conv.id]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('S4 — a CROSS-ORG owner context yields nothing, including credentials', async () => {
    const otherOrg = await seedOrg(stack);
    const c = await probe.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.org_id', $1, true)", [otherOrg.org_id]);
      await c.query("SELECT set_config('app.user_id', $1, true)", [otherOrg.user_id]);
      const cred = await c.query(`SELECT id FROM govai.provider_credentials`);
      expect(cred.rowCount).toBe(0); // this org's credentials are invisible from another org
      const orgs = await c.query(`SELECT id FROM govai.orgs WHERE id = $1::uuid`, [org.org_id]);
      expect(orgs.rowCount).toBe(0);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });

  it('S5 — govai_app still cannot reach worker discovery, and holds no worker role', async () => {
    const c = await stack.db.appPool.connect();
    try {
      await expect(
        c.query(`SELECT * FROM govai.ai_turn_recovery_candidates(0, 1, NULL, NULL)`),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(c.query(`SET ROLE govai_conversation_worker`)).rejects.toMatchObject({ code: '42501' });
    } finally {
      c.release();
    }
  });

  it('S6 — conversation content is CIPHERTEXT at rest, and no provider key is ever stored in it', async () => {
    const conv = await createConversation({});
    const { attemptId } = await send(conv.id, conv.branchId, nativeRequest('S6-plaintext-canary'));
    await driveOne(attemptId);
    const rows = await stack.db.adminPool.query<{ blob: string }>(
      `SELECT encode(ciphertext, 'escape') AS blob FROM govai.ai_conversation_content
        WHERE conversation_id = $1::uuid`,
      [conv.id],
    );
    expect(rows.rowCount).toBeGreaterThan(0);
    for (const r of rows.rows) {
      expect(r.blob).not.toContain('S6-plaintext-canary');
      expect(r.blob).not.toContain('sk-ant-p0c-exec');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// LOCK ORDER (§34) — LAW 16 is not merely argued
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('L — LAW 16 lock order', () => {
  it('L1 — concurrent SENDs on one branch serialize without deadlocking', async () => {
    const conv = await createConversation({});
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        inject(stack, 'POST', `/v1/ai/conversations/${conv.id}/turns`, org.api_key, {
          client_turn_id: randomUUID(),
          branch_id: conv.branchId,
          native_request: nativeRequest(`L1-${i}`),
        }),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
    // Every turn got a DISTINCT, dense sequence — the advisory lock really serialized them.
    const seqs = results.map((r) => Number((r.body as { turn_seq: string }).turn_seq)).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('L2 — the boundary’s root KEY SHARE conflicts with a lifecycle FOR UPDATE (not merely probabilistic)', async () => {
    const conv = await createConversation({});
    const holder = await stack.db.adminPool.connect();
    try {
      await holder.query('BEGIN');
      // §19 step 1's shape: the deletion transition takes the root EXCLUSIVELY.
      await holder.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid FOR UPDATE`, [conv.id]);

      // A boundary transaction must BLOCK on that, not sail past it. A short lock_timeout turns
      // "blocked" into an observable, deterministic error instead of a hang.
      await withProbeTx(async (c) => {
        await c.query(`SET LOCAL lock_timeout = '750ms'`);
        await expect(
          c.query(`SELECT status FROM govai.ai_conversations WHERE id = $1::uuid FOR KEY SHARE`, [conv.id]),
        ).rejects.toMatchObject({ code: '55P03' }); // lock_not_available — it really conflicted
      });
      await holder.query('ROLLBACK');
    } finally {
      holder.release();
    }
  });

  it('L3 — a full sweep under concurrent sends completes without a deadlock (40P01)', async () => {
    const conv = await createConversation({});
    for (let i = 0; i < 3; i += 1) {
      await send(conv.id, conv.branchId, nativeRequest(`L3-${i}`));
    }
    // Sends and sweeps racing on the SAME branch: reservation takes root FOR UPDATE then the
    // branch advisory lock; the boundary takes root FOR KEY SHARE then the attempt row. If the
    // two flows disagreed about order, this is where 40P01 would surface.
    const [outcomes] = await Promise.all([
      sweep(),
      inject(stack, 'POST', `/v1/ai/conversations/${conv.id}/turns`, org.api_key, {
        client_turn_id: randomUUID(),
        branch_id: conv.branchId,
        native_request: nativeRequest('L3-concurrent'),
      }),
      sweep(),
    ]);
    expect(outcomes['error'] ?? 0).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// RUNNER
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('R — the sweep runner', () => {
  it('R1 — one candidate’s failure does not stop the sweep', async () => {
    const good = await createConversation({});
    const g = await send(good.id, good.branchId, nativeRequest('R1-good'));
    // A conversation whose branch surface is undrivable: it must be CLASSIFIED, not thrown.
    const bad = await seedUndrivableTurn();

    const outcomes = await sweep();
    expect(outcomes['error'] ?? 0).toBe(0);
    expect((await attempt(g.attemptId)).state).toBe('completed');
    expect((await attempt(bad.attemptId)).state).toBe('rejected');
  });

  it('R2 — the batch size is validated, never silently clamped', async () => {
    await expect(
      runConversationSweepOnce(deps, { batchSize: 0, intervalMs: 1, maxPagesPerSweep: 1 }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      runConversationSweepOnce(deps, { batchSize: 501, intervalMs: 1, maxPagesPerSweep: 1 }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('R3 — a sweep with nothing to do is a clean no-op', async () => {
    await sweep(); // drain anything left by earlier tests
    const report = await runConversationSweepOnce(deps, {
      batchSize: 50,
      intervalMs: 1_000,
      maxPagesPerSweep: 5,
    });
    expect(report.outcomes['error'] ?? 0).toBe(0);
  });
});
