// EP-AI-CONVERSATION-CONTINUITY-V1 P0-D1 — SERVER-ASSEMBLED DURABLE CONTEXT
// (spec §3 fork boundaries, §7.5 eligibility, §7.6/LAW 4 retry boundary, §7.8 causal freshness,
// §11 ProviderConversationAdapter + credential-anchor reconciliation, §24 LAW 1/2/3/4/5/17).
//
// This suite drives the REAL executor — the same `processCandidate` the worker process runs —
// through the REAL worker database identity against the hermetic provider server, and asserts
// on the BODIES the worker actually POSTs: the server-assembled context is judged at the wire,
// not at an internal seam.
//
// THE CENTRAL CLAIM (R1_DURABLE_CONTEXT_P1, closed here for anthropic_messages +
// openai_responses): the request a client submitted at Send time NO LONGER determines what
// history the provider sees. At dispatch, the server rebuilds the context-bearing portion of
// the request from the durable causal projection — so a PIPELINED turn N+1, reserved before
// turn N completed, still dispatches WITH N's answer (D-A3 / D-O3).
//
// WHAT THIS SUITE DOES NOT CLAIM: provider exactly-once (never claimed anywhere); Codex or
// Claude Code continuation (P0-D2); OpenAI conversation objects (deferred within P0-D — and
// D-N1 proves NO provider-held continuation state row is ever created by these flows).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DevKms, type Kms } from '@govai/core-identity';
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
import {
  createConversationWorkerDb,
  type ConversationWorkerDb,
  type ConversationWorkerOwner,
} from '../../apps/api/src/pipeline/ai-conversation-worker.js';
import {
  processCandidate,
  type ConversationExecutorDeps,
  type ExecutionOutcome,
} from '../../apps/api/src/ai-conversations/execution/execute-turn.js';
import { discoverRecoveryCandidates } from '../../apps/api/src/pipeline/ai-conversation-recovery-discovery.js';
import { loadDurableContextPlan } from '../../apps/api/src/ai-conversations/execution/durable-context.js';
import {
  seedTurn,
  seedAttempt,
  advanceSeededAttempt,
} from './helpers/ai-conversation-seed.js';

let stack: Stack;
let org: SeededOrg;
let db: ConversationWorkerDb;
let deps: ConversationExecutorDeps;
let openaiCredentialId: string;

const LEASE_MS = 60_000;
const GRACE_MS = 1_000;

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as ConversationExecutorDeps['log'];

const anthropicRequest = (text: string, extra: Record<string, unknown> = {}) => ({
  model: 'claude-test',
  max_tokens: 64,
  messages: [{ role: 'user', content: text }],
  ...extra,
});

const openaiRequest = (text: string, extra: Record<string, unknown> = {}) => ({
  model: 'gpt-test',
  input: text,
  ...extra,
});

async function createConversation(opts: {
  mode?: 'governed' | 'passthrough';
  provider?: 'anthropic' | 'openai';
  model?: string;
  apiKey?: string;
}): Promise<{ id: string; branchId: string }> {
  const provider = opts.provider ?? 'anthropic';
  const res = await inject(stack, 'POST', '/v1/ai/conversations', opts.apiKey ?? org.api_key, {
    mode: opts.mode ?? 'passthrough',
    provider,
    surface: provider === 'anthropic' ? 'anthropic_messages' : 'openai_responses',
    model: opts.model ?? (provider === 'anthropic' ? 'claude-test' : 'gpt-test'),
  });
  expect(res.statusCode).toBe(201);
  const body = res.body as { id: string; root_branch: { id: string } };
  return { id: body.id, branchId: body.root_branch.id };
}

async function send(
  conversationId: string,
  branchId: string,
  request: unknown,
  apiKey?: string,
): Promise<{ turnId: string; attemptId: string }> {
  const res = await inject(
    stack,
    'POST',
    `/v1/ai/conversations/${conversationId}/turns`,
    apiKey ?? org.api_key,
    { client_turn_id: randomUUID(), branch_id: branchId, native_request: request },
  );
  expect(res.statusCode).toBe(201);
  const body = res.body as { id: string; current_attempt_id: string };
  return { turnId: body.id, attemptId: body.current_attempt_id };
}

async function driveOne(
  attemptId: string,
  overrideDeps?: ConversationExecutorDeps,
): Promise<ExecutionOutcome | 'not_discovered'> {
  const d = overrideDeps ?? deps;
  const candidates = await discoverRecoveryCandidates(d.db, {
    recoveryGraceMs: GRACE_MS,
    limit: 500,
  });
  const c = candidates.find((x) => x.attemptId === attemptId);
  if (!c) return 'not_discovered';
  return processCandidate(d, {
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

async function attemptRow(attemptId: string): Promise<{
  state: string;
  error_class: string | null;
  continuation_parent_ciphertext: Buffer | null;
  continuation_parent_dek_wrapped: Buffer | null;
  continuation_parent_kms_key_id: string | null;
  continuation_parent_kms_key_version: number | null;
}> {
  const r = await stack.db.adminPool.query(
    `SELECT state, error_class, continuation_parent_ciphertext, continuation_parent_dek_wrapped,
            continuation_parent_kms_key_id, continuation_parent_kms_key_version
       FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
    [attemptId],
  );
  return r.rows[0]!;
}

/** Decrypt an attempt's persisted continuation anchor — the O12 proof reads the DURABLE truth,
 *  never an in-memory echo. */
async function decryptAnchor(attemptId: string): Promise<string | null> {
  const row = await attemptRow(attemptId);
  if (row.continuation_parent_ciphertext === null) return null;
  const kms = new DevKms(stack.seed);
  const plaintext = await kms.envelopeDecrypt({
    orgId: org.org_id,
    keyId: row.continuation_parent_kms_key_id!,
    version: row.continuation_parent_kms_key_version!,
    ciphertext: new Uint8Array(row.continuation_parent_ciphertext),
    dekWrapped: new Uint8Array(row.continuation_parent_dek_wrapped!),
    purpose: 'conversation_content',
  });
  return Buffer.from(plaintext).toString('utf8');
}

/** Mint attempt N+1 on a turn and hand eligibility to it (the §7.6 handoff), through the SAME
 *  legal shapes the schema enforces: born `accepted`, forward-only repoint. The public retry
 *  endpoint is NOT P0-D1's — this seeds the durable state the context builder must honor. */
async function mintNextAttempt(input: {
  conversationId: string;
  branchId: string;
  turnId: string;
  attemptSeq: number;
}): Promise<string> {
  const id = randomUUID();
  await stack.db.adminPool.query(
    `INSERT INTO govai.ai_conversation_attempts
       (id, org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq)
     SELECT $1::uuid, t.org_id, t.owner_user_id, t.conversation_id, t.branch_id, t.id, $3::integer
       FROM govai.ai_conversation_turns t WHERE t.id = $2::uuid`,
    [id, input.turnId, input.attemptSeq],
  );
  await stack.db.adminPool.query(
    `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
    [id, input.turnId],
  );
  // The eligibility handoff is an eligibility-CHANGING commit: bump the branch causal version
  // exactly as the runtime handoff will (§7.8) so concurrent builds observe it.
  await stack.db.adminPool.query(
    `UPDATE govai.ai_conversation_branches SET causal_version = causal_version + 1
      WHERE id = $1::uuid`,
    [input.branchId],
  );
  return id;
}

/** Fork through the REAL control plane. */
async function fork(
  conversationId: string,
  input: {
    parentBranchId: string;
    turnId: string;
    attemptId: string;
    mode: 'after_attempt' | 'before_attempt_output';
    model?: string;
  },
): Promise<{ branchId: string; childTurn: { id: string; attempt_id: string } | null }> {
  const res = await inject(stack, 'POST', `/v1/ai/conversations/${conversationId}/branches`, org.api_key, {
    client_fork_id: randomUUID(),
    parent_branch_id: input.parentBranchId,
    forked_from_turn_id: input.turnId,
    forked_from_attempt_id: input.attemptId,
    boundary_mode: input.mode,
    ...(input.model ? { model: input.model } : {}),
  });
  expect(res.statusCode).toBe(201);
  const body = res.body as { id: string; child_turn: { id: string; attempt_id: string } | null };
  return { branchId: body.id, childTurn: body.child_turn };
}

/** Bodies the hermetic provider actually received, in order. */
function postedBodies(): Array<Record<string, unknown>> {
  return stack.provider.recordedRequests.map((r) => r.body as Record<string, unknown>);
}

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

/** A provider that answers a fixed Anthropic-shaped JSON body and records what it received. */
function fixedAnthropicResponder(content: unknown[]): {
  handler: (req: IncomingMessage, res: ServerResponse) => void;
  received: Array<Record<string, unknown>>;
} {
  const received: Array<Record<string, unknown>> = [];
  return {
    received,
    handler: (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
        res.writeHead(200, { 'content-type': 'application/json', 'request-id': randomUUID() });
        res.end(
          JSON.stringify({
            id: `msg_${randomUUID()}`,
            type: 'message',
            role: 'assistant',
            model: 'claude-test',
            content,
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        );
      });
    },
  };
}

beforeAll(async () => {
  stack = await startStack();
  await migrate(
    stack.db.adminUrl,
    stack.db.appPassword,
    undefined,
    undefined,
    stack.db.conversationWorkerPassword,
  );
  org = await seedOrg(stack);
  await seedProviderCredential(stack, {
    orgId: org.org_id,
    provider: 'anthropic',
    plaintextKey: 'sk-ant-p0d1',
    setByUserId: org.user_id,
  });
  const oai = await seedProviderCredential(stack, {
    orgId: org.org_id,
    provider: 'openai',
    plaintextKey: 'sk-openai-p0d1',
    setByUserId: org.user_id,
  });
  openaiCredentialId = oai.id;

  db = createConversationWorkerDb({
    config: { connectionString: stack.db.conversationWorkerUrl, workerId: 'p0d1-test' },
    log: silentLog as unknown as Parameters<typeof createConversationWorkerDb>[0]['log'],
  });
  deps = {
    db,
    kms: new DevKms(stack.seed),
    upstreamBaseUrlFor: () => stack.provider.baseUrl,
    log: silentLog,
    claimant: 'p0d1-test-worker',
    leaseMs: LEASE_MS,
    recoveryGraceMs: GRACE_MS,
    heartbeatIntervalMs: 15_000,
    dispatchTimeoutMs: 10_000,
    streamFlushBytes: 64,
  };
}, 300_000);

afterAll(async () => {
  await db?.close().catch(() => undefined);
  if (stack) await stopStack(stack);
});

beforeEach(() => {
  stack.provider.clearRecordedRequests();
  stack.provider.clearRecordedRequestHeaders();
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D-A — ANTHROPIC MESSAGES: durable full-history replay
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('D-A — Anthropic durable replay', () => {
  it('D-A1/D-A2 — the SECOND turn is server-assembled: [u1, durable answer 1, u2]', async () => {
    const conv = await createConversation({ mode: 'governed' });
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('A2-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');
    // The first turn posted its stored config VERBATIM (P0-C fidelity preserved).
    expect(postedBodies()[0]).toEqual(anthropicRequest('A2-u1'));

    const t2 = await send(conv.id, conv.branchId, anthropicRequest('A2-u2', { max_tokens: 77 }));
    expect(await driveOne(t2.attemptId)).toBe('completed');

    const body2 = postedBodies()[1]!;
    expect(body2['messages']).toEqual([
      { role: 'user', content: 'A2-u1' },
      { role: 'assistant', content: [{ type: 'text', text: 'echo: A2-u1' }] },
      { role: 'user', content: 'A2-u2' },
    ]);
    // The turn's OWN provider controls pass through verbatim (§30).
    expect(body2['max_tokens']).toBe(77);
    expect(body2['model']).toBe('claude-test');
  });

  it('D-A3 — ★ THE R1 PIPELINING GATE: turn N+1, reserved BEFORE N completed, dispatches WITH N’s answer', async () => {
    const conv = await createConversation({});
    // Both reservations exist before ANY execution: the client that composed turn 2 could not
    // know turn 1's answer, and its stored request provably does not contain it.
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('P-u1'));
    const t2 = await send(conv.id, conv.branchId, anthropicRequest('P-u2'));

    expect(await driveOne(t1.attemptId)).toBe('completed');
    expect(await driveOne(t2.attemptId)).toBe('completed');

    const body2 = postedBodies()[1]!;
    // The request the BROWSER submitted for turn 2 had exactly one message. What the provider
    // RECEIVED was built from durable branch truth and includes turn 1's completed answer.
    expect(body2['messages']).toEqual([
      { role: 'user', content: 'P-u1' },
      { role: 'assistant', content: [{ type: 'text', text: 'echo: P-u1' }] },
      { role: 'user', content: 'P-u2' },
    ]);
  });

  it('D-A2s — a STREAMED prior answer replays via reassembly of the durable SSE bytes', async () => {
    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('S-u1', { stream: true }));
    expect(await driveOne(t1.attemptId)).toBe('completed');

    const t2 = await send(conv.id, conv.branchId, anthropicRequest('S-u2'));
    expect(await driveOne(t2.attemptId)).toBe('completed');
    const body2 = postedBodies()[1]!;
    expect(body2['messages']).toEqual([
      { role: 'user', content: 'S-u1' },
      { role: 'assistant', content: [{ type: 'text', text: 'echo: S-u1' }] },
      { role: 'user', content: 'S-u2' },
    ]);
  });

  it('D-A4 — a SUPERSEDED attempt’s answer never re-enters context; the retry itself excludes it (LAW 4)', async () => {
    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('A4-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed'); // answer: "echo: A4-u1"

    // Mint attempt 2 on turn 1 (§7.6 eligibility handoff) and drive it against a provider that
    // answers something DISTINGUISHABLE.
    const attempt2 = await mintNextAttempt({
      conversationId: conv.id,
      branchId: conv.branchId,
      turnId: t1.turnId,
      attemptSeq: 2,
    });
    const regen = fixedAnthropicResponder([{ type: 'text', text: 'SECOND-ANSWER' }]);
    await withProviderBehaviour(regen.handler, async () => {
      expect(await driveOne(attempt2)).toBe('completed');
    });
    // LAW 4: the regenerating dispatch was built from context BEFORE attempt 1's output — the
    // superseded answer is NOT in the request that replaces it.
    expect(regen.received).toHaveLength(1);
    expect(regen.received[0]!['messages']).toEqual([{ role: 'user', content: 'A4-u1' }]);

    // And the NEXT turn's context contains the CURRENT attempt's answer, never the superseded one.
    const t2 = await send(conv.id, conv.branchId, anthropicRequest('A4-u2'));
    expect(await driveOne(t2.attemptId)).toBe('completed');
    const body = postedBodies().at(-1)!;
    expect(body['messages']).toEqual([
      { role: 'user', content: 'A4-u1' },
      { role: 'assistant', content: [{ type: 'text', text: 'SECOND-ANSWER' }] },
      { role: 'user', content: 'A4-u2' },
    ]);
    expect(JSON.stringify(body)).not.toContain('echo: A4-u1');
  });

  it('D-A5 — an outcome_unknown attempt contributes its USER INPUT and never an answer', async () => {
    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('A5-u1'));
    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.socket?.destroy(); // transmission attempted, no provider terminal evidence
        });
      },
      async () => {
        expect(await driveOne(t1.attemptId)).toBe('outcome_unknown');
      },
    );

    const t2 = await send(conv.id, conv.branchId, anthropicRequest('A5-u2'));
    expect(await driveOne(t2.attemptId)).toBe('completed');
    const body = postedBodies().at(-1)!;
    expect(body['messages']).toEqual([
      { role: 'user', content: 'A5-u1' }, // the question stays part of the conversation
      { role: 'user', content: 'A5-u2' }, // consecutive user turns are legal Messages history
    ]);
  });

  it('D-A6 — an after_attempt fork replays [prefix…, pinned turn input, PINNED answer] into the child', async () => {
    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('F6-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');

    const child = await fork(conv.id, {
      parentBranchId: conv.branchId,
      turnId: t1.turnId,
      attemptId: t1.attemptId,
      mode: 'after_attempt',
    });
    const c1 = await send(conv.id, child.branchId, anthropicRequest('F6-c1'));
    expect(await driveOne(c1.attemptId)).toBe('completed');
    expect(postedBodies().at(-1)!['messages']).toEqual([
      { role: 'user', content: 'F6-u1' },
      { role: 'assistant', content: [{ type: 'text', text: 'echo: F6-u1' }] },
      { role: 'user', content: 'F6-c1' },
    ]);
  });

  it('D-A7 — a before_attempt_output fork EXCLUDES the pinned answer: the regeneration boundary', async () => {
    const conv = await createConversation({});
    const t0 = await send(conv.id, conv.branchId, anthropicRequest('F7-u0'));
    expect(await driveOne(t0.attemptId)).toBe('completed');
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('F7-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed'); // the answer being regenerated

    const child = await fork(conv.id, {
      parentBranchId: conv.branchId,
      turnId: t1.turnId,
      attemptId: t1.attemptId,
      mode: 'before_attempt_output',
    });
    expect(child.childTurn).not.toBeNull();
    expect(await driveOne(child.childTurn!.attempt_id)).toBe('completed');

    const body = postedBodies().at(-1)!;
    expect(body['messages']).toEqual([
      { role: 'user', content: 'F7-u0' },
      { role: 'assistant', content: [{ type: 'text', text: 'echo: F7-u0' }] },
      { role: 'user', content: 'F7-u1' }, // the copied immutable input of the source turn
    ]);
    expect(JSON.stringify(body['messages'])).not.toContain('echo: F7-u1'); // the excluded answer
  });

  it('D-A8/D-A9 — tool_use and thinking/signature blocks replay with provider shape and bytes intact', async () => {
    const thinking = { type: 'thinking', thinking: 'internal reasoning', signature: 'SIGA9BYTES==' };
    const toolUse = { type: 'tool_use', id: 'toolu_a8', name: 'lookup', input: { q: 'x' } };
    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('A8-u1'));
    const first = fixedAnthropicResponder([thinking, { type: 'text', text: 'calling' }, toolUse]);
    await withProviderBehaviour(first.handler, async () => {
      expect(await driveOne(t1.attemptId)).toBe('completed');
    });

    const t2 = await send(
      conv.id,
      conv.branchId,
      anthropicRequest('ignored', {
        messages: [
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a8', content: 'result' }] },
        ],
      }),
    );
    expect(await driveOne(t2.attemptId)).toBe('completed');
    const body = postedBodies().at(-1)!;
    expect(body['messages']).toEqual([
      { role: 'user', content: 'A8-u1' },
      { role: 'assistant', content: [thinking, { type: 'text', text: 'calling' }, toolUse] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a8', content: 'result' }] },
    ]);
    // The signature survives byte-identically (§18: never synthesized, never modified).
    const replayed = (body['messages'] as Array<{ content: unknown }>)[1]!.content as Array<
      Record<string, unknown>
    >;
    expect(replayed[0]!['signature']).toBe('SIGA9BYTES==');
  });

  it('D-A9m — an after_attempt MODEL-SWITCH fork strips foreign thinking blocks (first-party rule)', async () => {
    const thinking = { type: 'thinking', thinking: 'model-bound', signature: 'SIGOLDMODEL==' };
    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('MS-u1'));
    const first = fixedAnthropicResponder([thinking, { type: 'text', text: 'answer-1' }]);
    await withProviderBehaviour(first.handler, async () => {
      expect(await driveOne(t1.attemptId)).toBe('completed');
    });

    const child = await fork(conv.id, {
      parentBranchId: conv.branchId,
      turnId: t1.turnId,
      attemptId: t1.attemptId,
      mode: 'after_attempt',
      model: 'claude-switched',
    });
    const c1 = await send(conv.id, child.branchId, anthropicRequest('MS-c1', { model: 'claude-switched' }));
    expect(await driveOne(c1.attemptId)).toBe('completed');
    const body = postedBodies().at(-1)!;
    expect(body['messages']).toEqual([
      { role: 'user', content: 'MS-u1' },
      { role: 'assistant', content: [{ type: 'text', text: 'answer-1' }] }, // thinking stripped
      { role: 'user', content: 'MS-c1' },
    ]);
    expect(JSON.stringify(body)).not.toContain('SIGOLDMODEL');
  });

  it('D-A10 — context NEVER crosses owners: two owners’ conversations assemble disjoint histories', async () => {
    const org2 = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: org2.org_id,
      provider: 'anthropic',
      plaintextKey: 'sk-ant-p0d1-org2',
      setByUserId: org2.user_id,
    });
    const conv1 = await createConversation({});
    const conv2 = await createConversation({ apiKey: org2.api_key });

    const a1 = await send(conv1.id, conv1.branchId, anthropicRequest('OWNER-ONE-SECRET'));
    expect(await driveOne(a1.attemptId)).toBe('completed');
    const b1 = await send(conv2.id, conv2.branchId, anthropicRequest('OWNER-TWO-SECRET'), org2.api_key);
    expect(await driveOne(b1.attemptId)).toBe('completed');

    const a2 = await send(conv1.id, conv1.branchId, anthropicRequest('one-follow-up'));
    expect(await driveOne(a2.attemptId)).toBe('completed');
    const b2 = await send(conv2.id, conv2.branchId, anthropicRequest('two-follow-up'), org2.api_key);
    expect(await driveOne(b2.attemptId)).toBe('completed');

    const bodies = postedBodies().map((b) => JSON.stringify(b));
    expect(bodies[2]).toContain('OWNER-ONE-SECRET');
    expect(bodies[2]).not.toContain('OWNER-TWO-SECRET');
    expect(bodies[3]).toContain('OWNER-TWO-SECRET');
    expect(bodies[3]).not.toContain('OWNER-ONE-SECRET');
  });

  it('D-A11 — a build whose context went stale LOSES the boundary CAS: no POST, ordinary rebuild (§7.8)', async () => {
    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('STALE-u1'));

    // Bump the branch causal version AFTER the load transaction (call 2: arm/claim is call 1)
    // and BEFORE the boundary transaction — precisely the window §7.8 exists for.
    let calls = 0;
    const wrappedDb = Object.assign(Object.create(Object.getPrototypeOf(db)) as object, db, {
      withOwnerContext: async <T>(
        owner: ConversationWorkerOwner,
        fn: (tx: import('pg').PoolClient) => Promise<T>,
      ): Promise<T> => {
        const result = await db.withOwnerContext(owner, fn);
        calls += 1;
        if (calls === 2) {
          await stack.db.adminPool.query(
            `UPDATE govai.ai_conversation_branches SET causal_version = causal_version + 1
              WHERE id = $1::uuid`,
            [conv.branchId],
          );
        }
        return result;
      },
    }) as ConversationWorkerDb;

    expect(await driveOne(t1.attemptId, { ...deps, db: wrappedDb })).toBe('boundary_lost');
    expect(stack.provider.recordedRequests).toEqual([]); // NO POST happened

    // The attempt is untouched, still `accepted`, and re-drivable through ORDINARY lease
    // recovery: expire the claim the fenced-out drive still holds (deterministically, instead
    // of waiting out the lease) and the rotation arm re-drives it with FRESH context.
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET claim_deadline_at = now() - interval '1 second'
        WHERE id = $1::uuid`,
      [t1.attemptId],
    );
    expect(await driveOne(t1.attemptId)).toBe('completed');
    expect(stack.provider.recordedRequests).toHaveLength(1);
  });

  it('D-A12 — an UNREADABLE history item fails CLOSED: rejected, and the provider is never contacted', async () => {
    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('SHRED-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');

    // Crypto-shred turn 1's input content (the lawful LAW 12 lifecycle — the one mutation the
    // content guard admits), making the history unreadable.
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_content c
          SET status = 'crypto_shredded', dek_wrapped = NULL, shredded_at = now()
        WHERE c.id = (SELECT native_request_config_content_id FROM govai.ai_conversation_turns
                       WHERE id = $1::uuid)`,
      [t1.turnId],
    );
    stack.provider.clearRecordedRequests();

    const t2 = await send(conv.id, conv.branchId, anthropicRequest('SHRED-u2'));
    expect(await driveOne(t2.attemptId)).toBe('context_unbuildable');
    const row = await attemptRow(t2.attemptId);
    expect(row.state).toBe('rejected');
    expect(row.error_class).toBeNull();
    expect(stack.provider.recordedRequests).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D-O — OPENAI RESPONSES: durable chaining + stateless replay
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('D-O — OpenAI Responses durable continuation', () => {
  it('D-O1/D-O3/D-O11 — pipelined turn 2 CHAINS from turn 1’s durable response id', async () => {
    const conv = await createConversation({ provider: 'openai' });
    const t1 = await send(conv.id, conv.branchId, openaiRequest('O-u1'));
    const t2 = await send(conv.id, conv.branchId, openaiRequest('O-u2')); // pipelined

    expect(await driveOne(t1.attemptId)).toBe('completed');
    expect(postedBodies()[0]).toEqual(openaiRequest('O-u1')); // first turn verbatim

    expect(await driveOne(t2.attemptId)).toBe('completed');
    const r1 = stack.provider.recordedRequests[0]!.provider_request_id!;
    const body2 = postedBodies()[1]!;
    // The durable anchor ADVANCED to turn 1's response; turn 2 carries only its own input.
    expect(body2['previous_response_id']).toBe(r1);
    expect(body2['input']).toBe('O-u2');
    expect(body2['model']).toBe('gpt-test');
  });

  it('D-O12 — the attempt durably records the EXACT anchor it chained FROM, encrypted', async () => {
    const conv = await createConversation({ provider: 'openai' });
    const t1 = await send(conv.id, conv.branchId, openaiRequest('O12-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');
    const r1 = stack.provider.recordedRequests[0]!.provider_request_id!;

    const t2 = await send(conv.id, conv.branchId, openaiRequest('O12-u2'));
    expect(await driveOne(t2.attemptId)).toBe('completed');

    expect(await decryptAnchor(t1.attemptId)).toBeNull(); // stateless first turn: no anchor
    expect(await decryptAnchor(t2.attemptId)).toBe(r1); // the parent it chained from
  });

  it('D-O13 — a RETRY chains from the PARENT anchor, never from the answer being regenerated', async () => {
    const conv = await createConversation({ provider: 'openai' });
    const t1 = await send(conv.id, conv.branchId, openaiRequest('O13-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');
    const r1 = stack.provider.recordedRequests[0]!.provider_request_id!;

    const t2 = await send(conv.id, conv.branchId, openaiRequest('O13-u2'));
    expect(await driveOne(t2.attemptId)).toBe('completed');
    const r2 = stack.provider.recordedRequests[1]!.provider_request_id!;
    expect(postedBodies()[1]!['previous_response_id']).toBe(r1);

    // Attempt 2 of turn 2 regenerates turn 2's answer: it must chain from R1 — never R2.
    const attempt2 = await mintNextAttempt({
      conversationId: conv.id,
      branchId: conv.branchId,
      turnId: t2.turnId,
      attemptSeq: 2,
    });
    expect(await driveOne(attempt2)).toBe('completed');
    const retryBody = postedBodies()[2]!;
    expect(retryBody['previous_response_id']).toBe(r1);
    expect(retryBody['previous_response_id']).not.toBe(r2);
    expect(await decryptAnchor(attempt2)).toBe(r1);
  });

  it('D-O5 — an outcome_unknown turn’s INPUT rides along; its unknown answer is never referenced', async () => {
    const conv = await createConversation({ provider: 'openai' });
    const t1 = await send(conv.id, conv.branchId, openaiRequest('O5-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');
    const r1 = stack.provider.recordedRequests[0]!.provider_request_id!;

    const t2 = await send(conv.id, conv.branchId, openaiRequest('O5-u2-lost'));
    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => res.socket?.destroy());
      },
      async () => {
        expect(await driveOne(t2.attemptId)).toBe('outcome_unknown');
      },
    );

    const t3 = await send(conv.id, conv.branchId, openaiRequest('O5-u3'));
    expect(await driveOne(t3.attemptId)).toBe('completed');
    const body3 = postedBodies().at(-1)!;
    // Chained from the last KNOWN completed response; the lost turn's question rides along.
    expect(body3['previous_response_id']).toBe(r1);
    expect(body3['input']).toEqual([
      { role: 'user', content: 'O5-u2-lost' },
      { role: 'user', content: 'O5-u3' },
    ]);
  });

  it('D-O6 — an after_attempt fork chains the CHILD from the PINNED response even after the parent advanced', async () => {
    const conv = await createConversation({ provider: 'openai' });
    const t1 = await send(conv.id, conv.branchId, openaiRequest('O6-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');
    const r1 = stack.provider.recordedRequests[0]!.provider_request_id!;
    const t2 = await send(conv.id, conv.branchId, openaiRequest('O6-u2'));
    expect(await driveOne(t2.attemptId)).toBe('completed'); // the parent branch moves on

    const child = await fork(conv.id, {
      parentBranchId: conv.branchId,
      turnId: t1.turnId,
      attemptId: t1.attemptId,
      mode: 'after_attempt',
    });
    const c1 = await send(conv.id, child.branchId, openaiRequest('O6-c1'));
    expect(await driveOne(c1.attemptId)).toBe('completed');
    const body = postedBodies().at(-1)!;
    // The provider-side chain is a TREE: the child forks from R1, never seeing turn 2.
    expect(body['previous_response_id']).toBe(r1);
    expect(body['input']).toBe('O6-c1');
  });

  it('D-O7 — a before_attempt_output fork chains from the answer BEFORE the regenerated turn', async () => {
    const conv = await createConversation({ provider: 'openai' });
    const t0 = await send(conv.id, conv.branchId, openaiRequest('O7-u0'));
    expect(await driveOne(t0.attemptId)).toBe('completed');
    const r0 = stack.provider.recordedRequests[0]!.provider_request_id!;
    const t1 = await send(conv.id, conv.branchId, openaiRequest('O7-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');
    const r1 = stack.provider.recordedRequests[1]!.provider_request_id!;

    const child = await fork(conv.id, {
      parentBranchId: conv.branchId,
      turnId: t1.turnId,
      attemptId: t1.attemptId,
      mode: 'before_attempt_output',
    });
    expect(await driveOne(child.childTurn!.attempt_id)).toBe('completed');
    const body = postedBodies().at(-1)!;
    expect(body['previous_response_id']).toBe(r0); // NOT r1 — that answer is being regenerated
    expect(body['previous_response_id']).not.toBe(r1);
    expect(body['input']).toBe('O7-u1'); // the copied immutable input
  });

  it('D-O2/D-O8 — store:false forces STATELESS replay with native items — reasoning included, store never flipped', async () => {
    const reasoning = { type: 'reasoning', id: 'rs_o8', summary: [], encrypted_content: 'ENCO8==' };
    const fnCall = { type: 'function_call', id: 'fc_o8', call_id: 'call_o8', name: 'f', arguments: '{}' };
    const conv = await createConversation({ provider: 'openai' });

    const t1 = await send(conv.id, conv.branchId, openaiRequest('O8-u1', { store: false }));
    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': randomUUID() });
          res.end(JSON.stringify({ id: 'resp_o8', object: 'response', output: [reasoning, fnCall] }));
        });
      },
      async () => {
        expect(await driveOne(t1.attemptId)).toBe('completed');
      },
    );

    const t2 = await send(
      conv.id,
      conv.branchId,
      openaiRequest('ignored', {
        store: false,
        input: [{ type: 'function_call_output', call_id: 'call_o8', output: '42' }],
      }),
    );
    expect(await driveOne(t2.attemptId)).toBe('completed');
    const body = postedBodies().at(-1)!;
    expect('previous_response_id' in body).toBe(false); // O14: store:false is honored
    expect(body['store']).toBe(false);
    expect(body['input']).toEqual([
      { role: 'user', content: 'O8-u1' },
      reasoning, // replayed VERBATIM — encrypted reasoning state preserved
      fnCall,
      { type: 'function_call_output', call_id: 'call_o8', output: '42' },
    ]);
    expect(await decryptAnchor(t2.attemptId)).toBeNull();
  });

  it('D-O10 — after a credential ROTATION the old anchor is NEVER chained: stateless replay instead', async () => {
    const conv = await createConversation({ provider: 'openai' });
    const t1 = await send(conv.id, conv.branchId, openaiRequest('O10-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');
    const r1 = stack.provider.recordedRequests[0]!.provider_request_id!;

    // Rotate: revoke the credential that owns R1, activate a fresh one (a different provider
    // account, as far as anyone can prove).
    await stack.db.adminPool.query(
      `UPDATE govai.provider_credentials
          SET status = 'revoked', revoked_at = now(), revoked_by_user_id = $2::uuid
        WHERE id = $1::uuid`,
      [openaiCredentialId, org.user_id],
    );
    const fresh = await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'openai',
      plaintextKey: 'sk-openai-p0d1-rotated',
      setByUserId: org.user_id,
    });
    openaiCredentialId = fresh.id;

    const t2 = await send(conv.id, conv.branchId, openaiRequest('O10-u2'));
    expect(await driveOne(t2.attemptId)).toBe('completed');
    const body = postedBodies().at(-1)!;
    expect('previous_response_id' in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain(r1);
    expect(body['input']).toEqual([
      { role: 'user', content: 'O10-u1' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'echo: O10-u1' }] },
      { role: 'user', content: 'O10-u2' },
    ]);
    expect(await decryptAnchor(t2.attemptId)).toBeNull();
  });

  it('D-O15/D-O14g — a config carrying client-owned continuation is REJECTED with no POST', async () => {
    const conv = await createConversation({ provider: 'openai' });
    const t1 = await send(
      conv.id,
      conv.branchId,
      openaiRequest('C-u1', { previous_response_id: 'resp_client_owned' }),
    );
    expect(await driveOne(t1.attemptId)).toBe('continuation_conflict');
    const row = await attemptRow(t1.attemptId);
    expect(row.state).toBe('rejected');
    expect(row.error_class).toBeNull();
    expect(stack.provider.recordedRequests).toEqual([]);

    // And the poisoned turn's input POISONS later context too: a clean next turn refuses
    // rather than replaying input that was bound to external provider state with its
    // continuation fields silently discarded. Recovery is an explicit fork from before it.
    const t2 = await send(conv.id, conv.branchId, openaiRequest('C-u2'));
    expect(await driveOne(t2.attemptId)).toBe('continuation_conflict');
    expect((await attemptRow(t2.attemptId)).state).toBe('rejected');
    expect(stack.provider.recordedRequests).toEqual([]);
  });

  it('D-O16 — a DIFFERENT worker process chains from the same durable anchor (§36 detachment)', async () => {
    const conv = await createConversation({ provider: 'openai' });
    const t1 = await send(conv.id, conv.branchId, openaiRequest('O16-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');
    const r1 = stack.provider.recordedRequests[0]!.provider_request_id!;

    // A FRESH worker capability — new pool, new process-equivalent, zero shared memory with
    // the worker that executed turn 1.
    const freshDb = createConversationWorkerDb({
      config: { connectionString: stack.db.conversationWorkerUrl, workerId: 'p0d1-second-worker' },
      log: silentLog as unknown as Parameters<typeof createConversationWorkerDb>[0]['log'],
    });
    try {
      const t2 = await send(conv.id, conv.branchId, openaiRequest('O16-u2'));
      expect(await driveOne(t2.attemptId, { ...deps, db: freshDb })).toBe('completed');
      expect(postedBodies().at(-1)!['previous_response_id']).toBe(r1);
    } finally {
      await freshDb.close();
    }
  });

  it('D-N1 — NO provider-held continuation state exists: provider_state has ZERO rows after every flow', async () => {
    // The structural O17 equivalent for this tree: every strategy derives its anchor from the
    // durable projection, so nothing writes ai_conversation_provider_state — and nothing may.
    const n = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_provider_state`,
    );
    expect(n.rows[0]!.n).toBe('0');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D-X — cross-cutting invariants
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('D-X — transaction boundaries, agnosticism, detachment', () => {
  it('D-X1 — NO KMS operation runs while a worker DB client is checked out; NO provider I/O inside a transaction (§40)', async () => {
    let dbInFlight = 0;
    let kmsWhileDbHeld = 0;
    let kmsCalls = 0;
    let providerSawDbHeld = 0;
    let providerCalls = 0;

    const guardedDb = Object.assign(Object.create(Object.getPrototypeOf(db)) as object, db, {
      withOwnerContext: async <T>(
        owner: ConversationWorkerOwner,
        fn: (tx: import('pg').PoolClient) => Promise<T>,
      ): Promise<T> => {
        dbInFlight += 1;
        try {
          return await db.withOwnerContext(owner, fn);
        } finally {
          dbInFlight -= 1;
        }
      },
    }) as ConversationWorkerDb;

    const baseKms = new DevKms(stack.seed);
    const guardedKms = new Proxy(baseKms as object, {
      get(target, prop, receiver): unknown {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          kmsCalls += 1;
          if (dbInFlight > 0) kmsWhileDbHeld += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    }) as unknown as Kms;

    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('TX-u1'));
    const t2 = await send(conv.id, conv.branchId, anthropicRequest('TX-u2'));

    await withProviderBehaviour(
      (req, res) => {
        providerCalls += 1;
        if (dbInFlight > 0) providerSawDbHeld += 1;
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json', 'request-id': randomUUID() });
          res.end(
            JSON.stringify({
              id: 'msg_tx',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'ok' }],
              stop_reason: 'end_turn',
            }),
          );
        });
      },
      async () => {
        // Heartbeat pushed far out: a concurrent tick's checkout must not blur the counter the
        // assertion below reads (the tick is proven non-overlapping by the kernel suite).
        const guardedDeps = { ...deps, db: guardedDb, kms: guardedKms, heartbeatIntervalMs: 30_000 };
        expect(await driveOne(t1.attemptId, guardedDeps)).toBe('completed');
        expect(await driveOne(t2.attemptId, guardedDeps)).toBe('completed');
      },
    );

    expect(kmsCalls).toBeGreaterThan(0); // the guard actually observed real KMS work
    expect(providerCalls).toBe(2);
    expect(kmsWhileDbHeld).toBe(0); // §16: no KMS while a client is checked out
    expect(providerSawDbHeld).toBe(0); // P0-C's invariant, preserved: no provider I/O in a tx
  });

  it('D-X2 — MODEL-ID AGNOSTICISM: a model that never existed flows through the whole D1 path', async () => {
    const model = 'p0d1-made-up-model-20990101';
    const conv = await createConversation({ model });
    const t1 = await send(conv.id, conv.branchId, { model, max_tokens: 8, messages: [{ role: 'user', content: 'M-u1' }] });
    expect(await driveOne(t1.attemptId)).toBe('completed');
    const t2 = await send(conv.id, conv.branchId, { model, max_tokens: 8, messages: [{ role: 'user', content: 'M-u2' }] });
    expect(await driveOne(t2.attemptId)).toBe('completed');
    const body = postedBodies().at(-1)!;
    expect(body['model']).toBe(model); // passed through, never gated, never rewritten
    expect(body['messages']).toEqual([
      { role: 'user', content: 'M-u1' },
      { role: 'assistant', content: [{ type: 'text', text: 'echo: M-u1' }] },
      { role: 'user', content: 'M-u2' },
    ]);
  });

  it('D-X3 — detached Anthropic replay: a FRESH worker assembles the full history from durable state alone (§36)', async () => {
    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('DET-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');

    const freshDb = createConversationWorkerDb({
      config: { connectionString: stack.db.conversationWorkerUrl, workerId: 'p0d1-detached' },
      log: silentLog as unknown as Parameters<typeof createConversationWorkerDb>[0]['log'],
    });
    try {
      const t2 = await send(conv.id, conv.branchId, anthropicRequest('DET-u2'));
      expect(await driveOne(t2.attemptId, { ...deps, db: freshDb })).toBe('completed');
      expect(postedBodies().at(-1)!['messages']).toEqual([
        { role: 'user', content: 'DET-u1' },
        { role: 'assistant', content: [{ type: 'text', text: 'echo: DET-u1' }] },
        { role: 'user', content: 'DET-u2' },
      ]);
    } finally {
      await freshDb.close();
    }
  });

  it('D-X5 — a §17 CROSS-PROVIDER fork stays a valid durable branch but dispatches a PRECISE refusal', async () => {
    // The portable projection (normalized text + declared tool outcomes, DLP re-scanned,
    // quality loss labeled — spec §17 / LAW NX-16) is a later P0-D arc. Until it exists, the
    // honest dispatch for a cross-provider child is an explicit refusal — never a silent
    // flatten, and never an incidental shape error. The fork itself remains a perfectly valid
    // durable branch (the P0-C unsupported-surface posture, one stage further along).
    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('XP-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');

    const res = await inject(stack, 'POST', `/v1/ai/conversations/${conv.id}/branches`, org.api_key, {
      client_fork_id: randomUUID(),
      parent_branch_id: conv.branchId,
      forked_from_turn_id: t1.turnId,
      forked_from_attempt_id: t1.attemptId,
      boundary_mode: 'after_attempt',
      provider: 'openai',
      surface: 'openai_responses',
      model: 'gpt-test',
    });
    expect(res.statusCode).toBe(201);
    const childBranchId = (res.body as { id: string }).id;

    stack.provider.clearRecordedRequests();
    const c1 = await send(conv.id, childBranchId, openaiRequest('XP-c1'));
    expect(await driveOne(c1.attemptId)).toBe('context_unbuildable');
    const row = await attemptRow(c1.attemptId);
    expect(row.state).toBe('rejected');
    expect(row.error_class).toBeNull();
    expect(stack.provider.recordedRequests).toEqual([]); // the provider was never contacted
  });

  it('D-X6 — the aggregate context budget REFUSES an over-budget build, and never truncates', async () => {
    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('B-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');
    const t2 = await send(conv.id, conv.branchId, anthropicRequest('B-u2'));
    expect(await driveOne(t2.attemptId)).toBe('completed');
    const t3 = await send(conv.id, conv.branchId, anthropicRequest('B-u3'));

    // Phase A invoked directly on the REAL worker capability with punitive budgets: each bound
    // (turns, items, cumulative ciphertext bytes) refuses with the precise reason — an
    // over-budget branch is an explicit refusal, never a silently shortened history.
    const owner = { orgId: org.org_id, ownerUserId: org.user_id };
    const ctx = { conversationId: conv.id, branchId: conv.branchId, turnSeq: '3' };
    for (const budget of [
      { maxTurns: 1, maxItems: 4096, maxCiphertextBytes: 32 * 1024 * 1024 },
      { maxTurns: 512, maxItems: 1, maxCiphertextBytes: 32 * 1024 * 1024 },
      { maxTurns: 512, maxItems: 4096, maxCiphertextBytes: 8 },
    ]) {
      await expect(
        db.withOwnerContext(owner, (tx) => loadDurableContextPlan(tx, owner, ctx, budget)),
      ).rejects.toMatchObject({
        code: 'durable_context_unbuildable',
        reason: 'context_budget_exceeded',
      });
    }

    // The DEFAULT budget admits any realistic conversation: the same turn drives to completion.
    expect(await driveOne(t3.attemptId)).toBe('completed');
  });

  it('D-X7 — a 2xx stream ending in a provider FAILURE verdict never blocks the branch: input-only context', async () => {
    // The executor durably completes any 2xx stream from HTTP status alone (the P0-C
    // classification); the CONTEXT layer projects the provider's own failure verdict as an
    // input-only turn, so the branch continues honestly. Both providers, at the wire.
    const oconv = await createConversation({ provider: 'openai' });
    const ot1 = await send(oconv.id, oconv.branchId, openaiRequest('PF-u1', { stream: true }));
    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': randomUUID() });
          res.end(
            `data: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_pf' } })}\n\n` +
              `data: ${JSON.stringify({ type: 'response.failed', response: { id: 'resp_pf', status: 'failed' } })}\n\n`,
          );
        });
      },
      async () => {
        expect(await driveOne(ot1.attemptId)).toBe('completed'); // the P0-C 2xx classification
      },
    );
    const ot2 = await send(oconv.id, oconv.branchId, openaiRequest('PF-u2'));
    expect(await driveOne(ot2.attemptId)).toBe('completed');
    const obody = postedBodies().at(-1)!;
    expect('previous_response_id' in obody).toBe(false);
    expect(obody['input']).toEqual([
      { role: 'user', content: 'PF-u1' },
      { role: 'user', content: 'PF-u2' },
    ]);

    const aconv = await createConversation({});
    const at1 = await send(aconv.id, aconv.branchId, anthropicRequest('PA-u1', { stream: true }));
    await withProviderBehaviour(
      (req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': randomUUID() });
          res.end(
            `data: ${JSON.stringify({ type: 'message_start', message: { role: 'assistant' } })}\n\n` +
              `data: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })}\n\n`,
          );
        });
      },
      async () => {
        expect(await driveOne(at1.attemptId)).toBe('completed');
      },
    );
    const at2 = await send(aconv.id, aconv.branchId, anthropicRequest('PA-u2'));
    expect(await driveOne(at2.attemptId)).toBe('completed');
    expect(postedBodies().at(-1)!['messages']).toEqual([
      { role: 'user', content: 'PA-u1' },
      { role: 'user', content: 'PA-u2' },
    ]);
  });

  it('D-X8 — a context build LONGER than the lease still dispatches: the heartbeat covers the claimed window', async () => {
    // Falsification of the round-9 finding: with a short lease and per-decrypt KMS latency
    // exceeding it in aggregate, a build with boundary-started renewal would lose the boundary
    // CAS, be rotated, and repeat the same over-lease build forever. With claim-time renewal
    // it completes on the first drive.
    const conv = await createConversation({});
    const t1 = await send(conv.id, conv.branchId, anthropicRequest('HB-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');
    const t2 = await send(conv.id, conv.branchId, anthropicRequest('HB-u2'));

    const baseKms = new DevKms(stack.seed);
    const slowKms = new Proxy(baseKms as object, {
      get(target, prop, receiver): unknown {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return async (...args: unknown[]) => {
          if (prop === 'envelopeDecrypt') await new Promise((r) => setTimeout(r, 400));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    }) as unknown as Kms;

    // Lease 1.5s; the build performs 4+ decrypts at ~400ms each (config, credential, history
    // input, history output) ≈ 1.6s+ — provably past the un-renewed lease. Heartbeat 300ms.
    const outcome = await driveOne(t2.attemptId, {
      ...deps,
      kms: slowKms,
      leaseMs: 1_500,
      heartbeatIntervalMs: 300,
      recoveryGraceMs: 100,
    });
    expect(outcome).toBe('completed');
    expect(postedBodies().at(-1)!['messages']).toEqual([
      { role: 'user', content: 'HB-u1' },
      { role: 'assistant', content: [{ type: 'text', text: 'echo: HB-u1' }] },
      { role: 'user', content: 'HB-u2' },
    ]);
  });

  it('D-X9 — an ancestry PAST the depth cap refuses; one AT the cap resolves with its root intact', async () => {
    // Falsification of the round-10 finding: with the old exit condition, a 65-frame walk
    // pushed 64 frames, moved to the unrecorded root, saw it had no parent, and PASSED —
    // silently omitting the root's turns from context. The only lawful exit is pushing a
    // root frame. Phase A never decrypts, so the chain is seeded structurally (legal
    // transitions only; random envelope bytes are fine for the plan reads).
    const ids = { orgId: org.org_id, ownerUserId: org.user_id };
    const admin = stack.db.adminPool;
    const conv = await admin.query<{ id: string }>(
      `INSERT INTO govai.ai_conversations (org_id, owner_user_id, mode, provider, surface, model)
       VALUES ($1::uuid, $2::uuid, 'passthrough', 'anthropic', 'anthropic_messages', 'claude-test')
       RETURNING id`,
      [ids.orgId, ids.ownerUserId],
    );
    const conversationId = conv.rows[0]!.id;
    const root = await admin.query<{ id: string }>(
      `INSERT INTO govai.ai_conversation_branches
         (org_id, owner_user_id, conversation_id, provider, surface, model)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_messages', 'claude-test')
       RETURNING id`,
      [ids.orgId, ids.ownerUserId, conversationId],
    );
    const branches: string[] = [root.rows[0]!.id];

    // Build a 65-branch chain: root + 64 after_attempt forks, each pinned to a COMPLETED
    // attempt (reached through the legal transition path) with one output item.
    for (let level = 0; level < 64; level += 1) {
      const parent = branches[branches.length - 1]!;
      const { turnId, configContentId } = await seedTurn(admin, ids, conversationId, parent, 1);
      await admin.query(
        `INSERT INTO govai.ai_conversation_items
           (org_id, owner_user_id, conversation_id, branch_id, turn_id, item_seq, item_type, content_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1, 'native_request', $6::uuid)`,
        [ids.orgId, ids.ownerUserId, conversationId, parent, turnId, configContentId],
      );
      const attemptId = await seedAttempt(admin, ids, conversationId, parent, turnId);
      await admin.query(
        `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
        [attemptId, turnId],
      );
      await advanceSeededAttempt(admin, ids, attemptId, { state: 'completed' });
      await admin.query(
        `INSERT INTO govai.ai_conversation_items
           (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id, item_seq, item_type, content_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 1, 'native_response', $7::uuid)`,
        [ids.orgId, ids.ownerUserId, conversationId, parent, turnId, attemptId, configContentId],
      );
      const child = await admin.query<{ id: string }>(
        `INSERT INTO govai.ai_conversation_branches
           (org_id, owner_user_id, conversation_id, provider, surface, model,
            parent_branch_id, forked_from_turn_id, forked_from_attempt_id, boundary_mode)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_messages', 'claude-test',
                 $4::uuid, $5::uuid, $6::uuid, 'after_attempt')
         RETURNING id`,
        [ids.orgId, ids.ownerUserId, conversationId, parent, turnId, attemptId],
      );
      branches.push(child.rows[0]!.id);
    }

    const owner = { orgId: ids.orgId, ownerUserId: ids.ownerUserId };
    // AT the cap (64 frames: branches[63] → root): resolves, and the ROOT's pin is present —
    // nothing silently omitted.
    const atCap = await db.withOwnerContext(owner, (tx) =>
      loadDurableContextPlan(tx, owner, {
        conversationId,
        branchId: branches[63]!,
        turnSeq: '1',
      }),
    );
    expect(atCap.entries).toHaveLength(63); // one pin per ancestor edge, root's included
    // PAST the cap (65 frames needed): refuses with the precise reason.
    await expect(
      db.withOwnerContext(owner, (tx) =>
        loadDurableContextPlan(tx, owner, {
          conversationId,
          branchId: branches[64]!,
          turnSeq: '1',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'durable_context_unbuildable',
      reason: 'branch_depth_exceeded',
    });
  });

  it('D-X4 — the hydrate surface still never leaks execution/continuation material', async () => {
    const conv = await createConversation({ provider: 'openai' });
    const t1 = await send(conv.id, conv.branchId, openaiRequest('H-u1'));
    expect(await driveOne(t1.attemptId)).toBe('completed');
    const t2 = await send(conv.id, conv.branchId, openaiRequest('H-u2'));
    expect(await driveOne(t2.attemptId)).toBe('completed');

    const res = await inject(stack, 'GET', `/v1/ai/conversations/${conv.id}/turns`, org.api_key);
    expect(res.statusCode).toBe(200);
    const text = JSON.stringify(res.body);
    for (const banned of ['continuation_parent', 'claim_token', 'provider_credential_id', 'ciphertext', 'dek_wrapped']) {
      expect({ banned, present: text.includes(banned) }).toEqual({ banned, present: false });
    }
  });
});
