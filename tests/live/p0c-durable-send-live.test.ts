// P0-C DURABLE SEND — LIVE PROVIDER ACCEPTANCE (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C §38).
//
// The hermetic suites prove the protocol. This proves the protocol against the REAL providers:
// a durable Send that commits before any dispatch, a DETACHED worker that executes it, and a
// terminal answer that a later request hydrates from durable state alone.
//
// Safety, identical to the existing live suites:
//   - gated by GOVAI_LIVE_TESTS=1; `tests/live/**` is excluded from the default vitest config,
//     so normal CI never makes a provider call;
//   - both calls are capped at 16 output tokens;
//   - exactly TWO provider requests total (one Anthropic, one OpenAI);
//   - NO provider key value is ever printed, logged, asserted or echoed. A leak canary checks
//     the last 20 characters of each real key — a high-entropy substring — against the durable
//     conversation store and the hydrate response.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DevKms } from '@govai/core-identity';
import {
  startStack,
  stopStack,
  seedOrg,
  seedProviderCredential,
  inject,
  type SeededOrg,
  type Stack,
} from '../integration/helpers/server-fixture.js';
import { migrate } from '../integration/setup.js';
import {
  createConversationWorkerDb,
  type ConversationWorkerDb,
} from '../../apps/api/src/pipeline/ai-conversation-worker.js';
import {
  processCandidate,
  type ConversationExecutorDeps,
} from '../../apps/api/src/ai-conversations/execution/execute-turn.js';
import { discoverRecoveryCandidates } from '../../apps/api/src/pipeline/ai-conversation-recovery-discovery.js';

const LIVE_ENABLED = process.env.GOVAI_LIVE_TESTS === '1';
const describeLive = LIVE_ENABLED ? describe : describe.skip;

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? '';
// ★ MODELS AGE OUT, AND A RETIRED ONE IS AN ENVIRONMENT PROBLEM, NOT A KERNEL DEFECT. The first
// run of this suite hit exactly that: `.env.local` still named `claude-3-5-sonnet-latest`, the
// provider answered `not_found_error`, and the kernel classified it correctly as a DEFINITE
// `provider_error` (never `outcome_unknown`) with the provider's own document persisted
// verbatim. The defaults below are current cheap models; `ANTHROPIC_LIVE_MODEL` /
// `OPENAI_LIVE_MODEL` override them, and `GET /v1/models` on either provider lists what an
// account actually has.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_LIVE_MODEL ?? 'claude-haiku-4-5-20251001';
const OPENAI_MODEL = process.env.OPENAI_LIVE_MODEL ?? 'gpt-4o-mini';
const MAX_TOKENS = 16;

/** High-entropy tail of a real key — never the key itself. */
const canary = (k: string): string => k.slice(-20);

let stack: Stack;
let org: SeededOrg;
let db: ConversationWorkerDb;
let deps: ConversationExecutorDeps;

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

beforeAll(async () => {
  if (!LIVE_ENABLED) return;
  // The worker must reach the REAL providers, so the hermetic base-URL override is cleared and
  // each provider is resolved to its own host by the executor's per-provider resolver.
  stack = await startStack({ GOVAI_PROVIDER_BASE_URL: undefined });
  await migrate(
    stack.db.adminUrl,
    stack.db.appPassword,
    undefined,
    undefined,
    stack.db.conversationWorkerPassword,
  );
  org = await seedOrg(stack);
  if (ANTHROPIC_KEY) {
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      plaintextKey: ANTHROPIC_KEY,
      setByUserId: org.user_id,
    });
  }
  if (OPENAI_KEY) {
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'openai',
      plaintextKey: OPENAI_KEY,
      setByUserId: org.user_id,
    });
  }
  db = createConversationWorkerDb({
    config: { connectionString: stack.db.conversationWorkerUrl, workerId: 'p0c-live' },
    log: silentLog as never,
  });
  deps = {
    db,
    kms: new DevKms(stack.seed),
    // The production resolver's own defaults: each provider to its own real host.
    upstreamBaseUrlFor: (p) =>
      p === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com',
    log: silentLog as never,
    claimant: 'p0c-live-worker',
    leaseMs: 120_000,
    recoveryGraceMs: 1_000,
    heartbeatIntervalMs: 30_000,
    dispatchTimeoutMs: 60_000,
    streamFlushBytes: 4_096,
  };
}, 300_000);

afterAll(async () => {
  await db?.close().catch(() => undefined);
  if (stack) await stopStack(stack);
});

async function driveOne(attemptId: string): Promise<string> {
  const candidates = await discoverRecoveryCandidates(db, { recoveryGraceMs: 1_000, limit: 50 });
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
 * One end-to-end live acceptance: reserve → prove nothing dispatched → detached worker executes
 * → a NEW request hydrates the real answer → no key material anywhere in durable state.
 */
async function acceptance(input: {
  provider: 'anthropic' | 'openai';
  surface: string;
  model: string;
  nativeRequest: Record<string, unknown>;
  key: string;
}): Promise<void> {
  const created = await inject(stack, 'POST', '/v1/ai/conversations', org.api_key, {
    mode: 'governed',
    provider: input.provider,
    surface: input.surface,
    model: input.model,
  });
  expect(created.statusCode).toBe(201);
  const conv = created.body as { id: string; root_branch: { id: string } };

  // ── 1. RESERVATION COMMITS BEFORE ANY DISPATCH IS POSSIBLE ────────────────────────────────
  const sent = await inject(stack, 'POST', `/v1/ai/conversations/${conv.id}/turns`, org.api_key, {
    client_turn_id: randomUUID(),
    branch_id: conv.root_branch.id,
    native_request: input.nativeRequest,
  });
  expect(sent.statusCode).toBe(201);
  const turn = sent.body as { id: string; current_attempt_id: string };

  const pre = await stack.db.adminPool.query<{
    state: string;
    boundary: Date | null;
    cred: string | null;
  }>(
    `SELECT state, dispatch_boundary_committed_at AS boundary, provider_credential_id::text AS cred
       FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
    [turn.current_attempt_id],
  );
  // Durable, but pre-boundary and provenance-free: no provider call could have happened.
  expect(pre.rows[0]).toEqual({ state: 'accepted', boundary: null, cred: null });

  // ── 2. THE DETACHED WORKER EXECUTES IT ────────────────────────────────────────────────────
  const outcome = await driveOne(turn.current_attempt_id);
  // ★ THE TAXONOMY IS PART OF THE ASSERTION. A bare "expected completed, got failed" says
  // nothing an operator can act on; the §7.4 error class distinguishes a bad key
  // (`auth_rejected`) from a bad model (`provider_error`) from a budget stop (`rate_limited`).
  const cls = await stack.db.adminPool.query<{ error_class: string | null }>(
    `SELECT error_class FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
    [turn.current_attempt_id],
  );
  // The provider's OWN error document is durably persisted on the failure path too, so a live
  // failure can name the provider's reason instead of leaving an operator to guess. It is the
  // owner's own content and carries no credential material.
  let providerReason: unknown = null;
  if (outcome !== 'completed') {
    const hyd = await inject(
      stack,
      'GET',
      `/v1/ai/conversations/${conv.id}/turns/${turn.id}`,
      org.api_key,
    );
    const b = hyd.body as { attempts: Array<{ output_items: Array<{ native: unknown }> }> };
    providerReason = b.attempts?.[0]?.output_items?.[0]?.native ?? '<no durable output>';
  }
  expect({
    provider: input.provider,
    outcome,
    error_class: cls.rows[0]!.error_class,
    providerReason,
  }).toEqual({
    provider: input.provider,
    outcome: 'completed',
    error_class: null,
    providerReason: null,
  });

  const post = await stack.db.adminPool.query<{
    state: string;
    boundary: Date | null;
    cred: string | null;
    req: string | null;
  }>(
    `SELECT state, dispatch_boundary_committed_at AS boundary, provider_credential_id::text AS cred,
            govai_request_id::text AS req
       FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
    [turn.current_attempt_id],
  );
  expect(post.rows[0]!.state).toBe('completed');
  expect(post.rows[0]!.boundary).not.toBeNull();
  expect(post.rows[0]!.cred).not.toBeNull(); // provenance was durable BEFORE the POST
  expect(post.rows[0]!.req).not.toBeNull(); // §14 identity minted at the boundary

  // ── 3. A NEW REQUEST HYDRATES THE REAL ANSWER FROM DURABLE STATE ──────────────────────────
  const hydrated = await inject(
    stack,
    'GET',
    `/v1/ai/conversations/${conv.id}/turns/${turn.id}`,
    org.api_key,
  );
  expect(hydrated.statusCode).toBe(200);
  const body = hydrated.body as {
    attempts: Array<{ state: string; output_items: Array<{ item_type: string; native: unknown }> }>;
  };
  expect(body.attempts[0]!.state).toBe('completed');
  expect(body.attempts[0]!.output_items.length).toBeGreaterThan(0);
  // A real provider document came back and round-tripped through the envelope intact.
  expect(body.attempts[0]!.output_items[0]!.native).toBeTruthy();

  // ── 4. LEAK CANARY: no key material in the durable conversation store or the response ─────
  const tail = canary(input.key);
  expect(hydrated.rawBody).not.toContain(tail);
  const blobs = await stack.db.adminPool.query<{ blob: string }>(
    `SELECT encode(ciphertext, 'escape') AS blob FROM govai.ai_conversation_content
      WHERE conversation_id = $1::uuid`,
    [conv.id],
  );
  for (const r of blobs.rows) expect(r.blob).not.toContain(tail);
  const items = await stack.db.adminPool.query<{ t: string }>(
    `SELECT item_type AS t FROM govai.ai_conversation_items WHERE conversation_id = $1::uuid`,
    [conv.id],
  );
  expect(items.rowCount).toBeGreaterThan(0);
}

describeLive('P0-C live acceptance — durable send, detached execution, durable hydrate', () => {
  it.skipIf(!ANTHROPIC_KEY)(
    'LIVE-1 — Anthropic /v1/messages: reserve → detached execute → hydrate',
    async () => {
      await acceptance({
        provider: 'anthropic',
        surface: 'anthropic_messages',
        model: ANTHROPIC_MODEL,
        nativeRequest: {
          model: ANTHROPIC_MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: 'Reply with the single word: durable' }],
        },
        key: ANTHROPIC_KEY,
      });
    },
    180_000,
  );

  it.skipIf(!OPENAI_KEY)(
    'LIVE-2 — OpenAI /v1/responses: reserve → detached execute → hydrate',
    async () => {
      await acceptance({
        provider: 'openai',
        surface: 'openai_responses',
        model: OPENAI_MODEL,
        nativeRequest: {
          model: OPENAI_MODEL,
          max_output_tokens: MAX_TOKENS,
          input: 'Reply with the single word: durable',
        },
        key: OPENAI_KEY,
      });
    },
    180_000,
  );
});
