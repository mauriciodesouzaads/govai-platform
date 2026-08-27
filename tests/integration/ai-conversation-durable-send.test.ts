// EP-AI-CONVERSATION-CONTINUITY-V1 P0-C — DURABLE SEND + HYDRATE (spec §8/§9 step 1/§10/§13).
//
// The claim under test, stated once: a user Send becomes DURABLE — and is READABLE by a
// completely different request, from a client that never saw the original response — BEFORE any
// provider work is possible, and a duplicate Send can never create a second logical turn.
//
// ★ ZERO PROVIDER REQUESTS IN THIS ENTIRE FILE. Reservation and hydration are request-plane
// operations; execution belongs to the detached worker, which this suite never starts. The
// provider-silence assertion is not decoration — it is what proves the reservation is not
// secretly a synchronous provider call wearing a durable coat.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startStack,
  stopStack,
  seedOrg,
  seedProviderCredential,
  inject,
  type SeededOrg,
  type Stack,
} from './helpers/server-fixture.js';

let stack: Stack;
let org: SeededOrg;
let other: SeededOrg; // different org entirely
let sameOrgOther: { api_key: string }; // same org, DIFFERENT owner

/** A conversation whose durable (provider, surface) IS dispatchable by P0-C. */
async function createConversation(
  apiKey: string,
  overrides: { mode?: 'governed' | 'passthrough'; provider?: string; surface?: string } = {},
): Promise<{ id: string; branchId: string }> {
  const res = await inject(stack, 'POST', '/v1/ai/conversations', apiKey, {
    mode: overrides.mode ?? 'governed',
    provider: overrides.provider ?? 'anthropic',
    surface: overrides.surface ?? 'anthropic_messages',
    model: 'claude-test',
  });
  expect(res.statusCode).toBe(201);
  const body = res.body as { id: string; root_branch: { id: string } };
  return { id: body.id, branchId: body.root_branch.id };
}

const nativeRequest = (text = 'hello') => ({
  model: 'claude-test',
  max_tokens: 64,
  messages: [{ role: 'user', content: text }],
});

async function send(
  apiKey: string,
  conversationId: string,
  body: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown; headers?: unknown }> {
  return inject(stack, 'POST', `/v1/ai/conversations/${conversationId}/turns`, apiKey, body);
}

beforeAll(async () => {
  stack = await startStack();
  org = await seedOrg(stack);
  other = await seedOrg(stack);
  // A same-org, different-owner principal: a second API key on the SAME org with a NEW user id.
  const secondUser = randomUUID();
  const c = await stack.db.adminPool.connect();
  try {
    const { generateApiKey } = await import('@govai/core-identity');
    const key = await generateApiKey();
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE govai_audit_writer');
    await c.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);
    await c.query(
      `INSERT INTO govai.api_keys (prefix, hash, org_id, user_id, status)
       VALUES ($1, $2, $3::uuid, $4::uuid, 'active')`,
      [key.prefix, key.hash, org.org_id, secondUser],
    );
    await c.query('COMMIT');
    sameOrgOther = { api_key: key.plaintext };
  } finally {
    c.release();
  }
  await seedProviderCredential(stack, {
    orgId: org.org_id,
    provider: 'anthropic',
    plaintextKey: 'sk-ant-p0c-durable-send',
    setByUserId: org.user_id,
  });
}, 300_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

describe('SEND — the durable reservation', () => {
  it('SEND-01 — a valid send returns an accepted durable turn, with attempt 1 already current', async () => {
    stack.provider.clearRecordedRequests();
    const conv = await createConversation(org.api_key);
    const clientTurnId = randomUUID();

    const res = await send(org.api_key, conv.id, {
      client_turn_id: clientTurnId,
      branch_id: conv.branchId,
      native_request: nativeRequest('SEND-01'),
    });

    expect(res.statusCode).toBe(201);
    const turn = res.body as {
      id: string;
      branch_id: string;
      client_turn_id: string;
      turn_seq: string;
      current_attempt_id: string;
      input_items: Array<{ item_seq: number; item_type: string; native: unknown }>;
      attempts: Array<{ id: string; state: string; is_current: boolean; govai_request_id: string | null }>;
    };
    expect(turn.branch_id).toBe(conv.branchId);
    expect(turn.client_turn_id).toBe(clientTurnId);
    expect(turn.turn_seq).toBe('1');
    // §7.1b: a reserved turn is NEVER attempt-less, and attempt 1 is born accepted + current.
    expect(turn.attempts).toHaveLength(1);
    expect(turn.attempts[0]!.state).toBe('accepted');
    expect(turn.attempts[0]!.is_current).toBe(true);
    expect(turn.current_attempt_id).toBe(turn.attempts[0]!.id);
    // §14.1: the request identity is minted at the DISPATCH BOUNDARY, never at reservation.
    expect(turn.attempts[0]!.govai_request_id).toBeNull();
    // The user's input is durable and provider-native — not reduced to role+text.
    expect(turn.input_items).toHaveLength(1);
    expect(turn.input_items[0]!.item_type).toBe('native_request');
    expect(turn.input_items[0]!.native).toEqual(nativeRequest('SEND-01'));

    // ★ NOT ONE PROVIDER REQUEST.
    expect(stack.provider.recordedRequests).toEqual([]);

    // The durable row carries NO execution authority at all (§7.1b birth shape).
    const row = await stack.db.adminPool.query<{
      state: string;
      claim_token: string | null;
      claim_deadline_at: Date | null;
      heartbeat_at: Date | null;
      dispatch_boundary_committed_at: Date | null;
      provider_credential_id: string | null;
      govai_request_id: string | null;
      stop_requested: boolean;
    }>(
      `SELECT state, claim_token, claim_deadline_at, heartbeat_at, dispatch_boundary_committed_at,
              provider_credential_id, govai_request_id, stop_requested
         FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
      [turn.current_attempt_id],
    );
    expect(row.rows[0]).toEqual({
      state: 'accepted',
      claim_token: null,
      claim_deadline_at: null,
      heartbeat_at: null,
      dispatch_boundary_committed_at: null,
      provider_credential_id: null,
      govai_request_id: null,
      stop_requested: false,
    });
  });

  it('SEND-02 — a LOST-RESPONSE retry replays the SAME turn: no second turn, no second attempt', async () => {
    const conv = await createConversation(org.api_key);
    const clientTurnId = randomUUID();
    const body = {
      client_turn_id: clientTurnId,
      branch_id: conv.branchId,
      native_request: nativeRequest('SEND-02'),
    };

    const first = await send(org.api_key, conv.id, body);
    expect(first.statusCode).toBe(201);
    const firstTurn = first.body as { id: string; current_attempt_id: string };

    // The client never saw the 201 and retries with the SAME key and the SAME intent — but with
    // its JSON keys in a different order, which a real re-serialization can produce.
    const replay = await send(org.api_key, conv.id, {
      native_request: { messages: [{ content: 'SEND-02', role: 'user' }], max_tokens: 64, model: 'claude-test' },
      branch_id: conv.branchId,
      client_turn_id: clientTurnId,
    });
    expect(replay.statusCode).toBe(200); // 200, not 201: a duplicate is a READ
    const replayTurn = replay.body as { id: string; current_attempt_id: string };
    expect(replayTurn.id).toBe(firstTurn.id);
    expect(replayTurn.current_attempt_id).toBe(firstTurn.current_attempt_id);

    const counts = await stack.db.adminPool.query<{ turns: string; attempts: string; items: string }>(
      `SELECT (SELECT count(*)::text FROM govai.ai_conversation_turns WHERE conversation_id = $1::uuid) AS turns,
              (SELECT count(*)::text FROM govai.ai_conversation_attempts WHERE conversation_id = $1::uuid) AS attempts,
              (SELECT count(*)::text FROM govai.ai_conversation_items WHERE conversation_id = $1::uuid) AS items`,
      [conv.id],
    );
    expect(counts.rows[0]).toEqual({ turns: '1', attempts: '1', items: '1' });
  });

  it('SEND-03 — the SAME key with a DIVERGENT intent is a 409 that mints and dispatches nothing', async () => {
    stack.provider.clearRecordedRequests();
    const conv = await createConversation(org.api_key);
    const clientTurnId = randomUUID();
    await send(org.api_key, conv.id, {
      client_turn_id: clientTurnId,
      branch_id: conv.branchId,
      native_request: nativeRequest('original'),
    });

    const conflict = await send(org.api_key, conv.id, {
      client_turn_id: clientTurnId,
      branch_id: conv.branchId,
      native_request: nativeRequest('DIFFERENT'),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.body).toEqual({ error: 'send_idempotency_key_conflict' });
    // Static body: never the key, never a hash, never the stored intent.
    expect(JSON.stringify(conflict.body)).not.toContain(clientTurnId);
    expect(JSON.stringify(conflict.body)).not.toContain('DIFFERENT');
    expect(JSON.stringify(conflict.body)).not.toContain('original');

    const counts = await stack.db.adminPool.query<{ turns: string; attempts: string }>(
      `SELECT (SELECT count(*)::text FROM govai.ai_conversation_turns WHERE conversation_id = $1::uuid) AS turns,
              (SELECT count(*)::text FROM govai.ai_conversation_attempts WHERE conversation_id = $1::uuid) AS attempts`,
      [conv.id],
    );
    expect(counts.rows[0]).toEqual({ turns: '1', attempts: '1' });
    expect(stack.provider.recordedRequests).toEqual([]);
  });

  it('SEND-03b — a divergent BRANCH under the same key is also a 409', async () => {
    // The branch is part of the semantic intent: the same key must not silently retarget.
    const conv = await createConversation(org.api_key);
    const clientTurnId = randomUUID();
    await send(org.api_key, conv.id, {
      client_turn_id: clientTurnId,
      branch_id: conv.branchId,
      native_request: nativeRequest('x'),
    });
    const otherBranch = randomUUID();
    const res = await send(org.api_key, conv.id, {
      client_turn_id: clientTurnId,
      branch_id: otherBranch,
      native_request: nativeRequest('x'),
    });
    // The branch does not exist in this conversation, so it fails BEFORE the idempotency
    // comparison — 404, and still nothing minted.
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'branch_not_found' });
  });

  it('SEND-04 — a foreign conversation is a 404 (the IDOR contract, unchanged)', async () => {
    const foreign = await createConversation(other.api_key);
    const res = await send(org.api_key, foreign.id, {
      client_turn_id: randomUUID(),
      branch_id: foreign.branchId,
      native_request: nativeRequest(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'conversation_not_found' });
  });

  it('SEND-05 — a SAME-ORG, different-owner principal is also a 404 — indistinguishable', async () => {
    const conv = await createConversation(org.api_key);
    const res = await send(sameOrgOther.api_key, conv.id, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: nativeRequest(),
    });
    // Byte-identical to SEND-04's answer: a 404 can never be read as an existence oracle.
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'conversation_not_found' });
    const n = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_turns WHERE conversation_id = $1::uuid`,
      [conv.id],
    );
    expect(n.rows[0]!.n).toBe('0');
  });

  it('SEND-06 — a malformed body is a 400, and unknown fields are REJECTED not dropped', async () => {
    const conv = await createConversation(org.api_key);
    const cases: Array<[string, Record<string, unknown>]> = [
      ['missing client_turn_id', { branch_id: conv.branchId, native_request: nativeRequest() }],
      ['missing branch_id', { client_turn_id: randomUUID(), native_request: nativeRequest() }],
      ['missing native_request', { client_turn_id: randomUUID(), branch_id: conv.branchId }],
      ['non-uuid client_turn_id', { client_turn_id: 'nope', branch_id: conv.branchId, native_request: nativeRequest() }],
      ['native_request as array', { client_turn_id: randomUUID(), branch_id: conv.branchId, native_request: [1, 2] }],
      ['native_request as string', { client_turn_id: randomUUID(), branch_id: conv.branchId, native_request: 'hi' }],
      // ★ .strict(): silently ignoring an unknown field is how two DIFFERENT client intents come
      // to hash identically on an idempotent surface.
      ['unknown field', { client_turn_id: randomUUID(), branch_id: conv.branchId, native_request: nativeRequest(), model: 'x' }],
    ];
    for (const [label, body] of cases) {
      const res = await send(org.api_key, conv.id, body);
      expect({ label, code: res.statusCode }).toEqual({ label, code: 400 });
    }
  });

  it('SEND-07 — an UNSUPPORTED provider/surface fails CLOSED before anything durable is written', async () => {
    stack.provider.clearRecordedRequests();
    for (const [provider, surface] of [
      ['anthropic', 'anthropic_api'], // a real token in this repo — but not a P0-C dispatch surface
      ['openai', 'openai_chat_completions'],
      ['codex', 'codex_thread'],
      ['claude_code', 'claude_code_session'],
    ] as const) {
      const conv = await createConversation(org.api_key, { provider, surface });
      const res = await send(org.api_key, conv.id, {
        client_turn_id: randomUUID(),
        branch_id: conv.branchId,
        native_request: nativeRequest(),
      });
      expect({ provider, surface, code: res.statusCode }).toEqual({
        provider,
        surface,
        code: 409,
      });
      const body = res.body as { error: string; provider: string; surface: string; reason: string };
      expect(body.error).toBe('conversation_surface_unsupported');
      expect(body.provider).toBe(provider);
      expect(body.surface).toBe(surface);
      expect(['provider_requires_p0d_continuation', 'surface_not_supported_in_p0c']).toContain(body.reason);
      // ★ NOTHING DURABLE: a reservation on an undrivable surface would block its branch queue
      // forever, because the queue blocks on non-terminal turns.
      const n = await stack.db.adminPool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM govai.ai_conversation_turns WHERE conversation_id = $1::uuid`,
        [conv.id],
      );
      expect({ provider, surface, turns: n.rows[0]!.n }).toEqual({ provider, surface, turns: '0' });
    }
    expect(stack.provider.recordedRequests).toEqual([]);
  });

  it('SEND-08 — every send/hydrate response carries Cache-Control: no-store', async () => {
    const conv = await createConversation(org.api_key);
    const sendRes = await stack.app.inject({
      method: 'POST',
      url: `/v1/ai/conversations/${conv.id}/turns`,
      headers: { 'content-type': 'application/json', 'x-govai-api-key': org.api_key },
      payload: { client_turn_id: randomUUID(), branch_id: conv.branchId, native_request: nativeRequest() },
    });
    expect(sendRes.statusCode).toBe(201);
    expect(sendRes.headers['cache-control']).toBe('no-store');
    const turnId = (JSON.parse(sendRes.body) as { id: string }).id;

    for (const url of [
      `/v1/ai/conversations/${conv.id}/turns`,
      `/v1/ai/conversations/${conv.id}/turns/${turnId}`,
      `/v1/ai/conversations/${conv.id}/turns/${randomUUID()}`, // the 404 too
    ]) {
      const res = await stack.app.inject({ method: 'GET', url, headers: { 'x-govai-api-key': org.api_key } });
      expect({ url, cache: res.headers['cache-control'] }).toEqual({ url, cache: 'no-store' });
    }
    // And an UNAUTHENTICATED 401 on the same surface (AUTH-READ-CACHE-01 covers the class).
    const unauth = await stack.app.inject({ method: 'GET', url: `/v1/ai/conversations/${conv.id}/turns` });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.headers['cache-control']).toBe('no-store');
  });

  it('SEND-09 — an oversized native request is a 413, and is bounded BEFORE encryption', async () => {
    const conv = await createConversation(org.api_key);
    // Over the DOMAIN bound (512 KiB) but comfortably inside Fastify's 1 MiB envelope limit, so
    // the answer is the SPECIFIC domain error and not a generic transport rejection. If the two
    // bounds were equal this assertion would catch it — an earlier revision set them equal and
    // this test is what proved the domain bound unreachable.
    const huge = 'x'.repeat(600_000);
    const res = await send(org.api_key, conv.id, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: { model: 'm', messages: [{ role: 'user', content: huge }] },
    });
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: 'native_request_too_large' });
    const n = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_content WHERE conversation_id = $1::uuid`,
      [conv.id],
    );
    expect(n.rows[0]!.n).toBe('0'); // no ciphertext was even produced
  });

  it('SEND-13 — an out-of-range after_turn_seq is a 400, not a 500', async () => {
    // ★ A 19-DIGIT VALUE CAN STILL EXCEED `bigint`. The regex alone accepted
    // `9999999999999999999`, which reached `$5::bigint`, raised numeric_value_out_of_range, and
    // surfaced as a SERVER error for what is plainly an invalid query.
    const conv = await createConversation(org.api_key);
    for (const bad of ['9999999999999999999', '9223372036854775808']) {
      const res = await inject(
        stack,
        'GET',
        `/v1/ai/conversations/${conv.id}/turns?after_turn_seq=${bad}`,
        org.api_key,
      );
      expect({ bad, code: res.statusCode }).toEqual({ bad, code: 400 });
      expect((res.body as { error: string }).error).toBe('invalid_query');
    }
    // The exact maximum is still ACCEPTED — the bound is inclusive, not off by one.
    const ok = await inject(
      stack,
      'GET',
      `/v1/ai/conversations/${conv.id}/turns?after_turn_seq=9223372036854775807`,
      org.api_key,
    );
    expect(ok.statusCode).toBe(200);
  });

  it('SEND-14 — the reservation holds NO lock across a KMS call', async () => {
    // ★ THE INVARIANT, MEASURED. `prepareSend` encrypts before the transaction opens, and the
    // response projection (which DECRYPTS) is built after it commits. If either ran inside, the
    // conversation root `FOR UPDATE` and the branch advisory lock would be held across remote
    // KMS I/O, and every other operation on the conversation would block on KMS latency.
    //
    // Proven by contention rather than by inspection: a second transaction takes the root
    // EXCLUSIVELY and holds it, and a Send on a DIFFERENT conversation must still complete —
    // which it can only do if it is not queued behind a shared KMS-bound critical section.
    const a = await createConversation(org.api_key);
    const b = await createConversation(org.api_key);
    const holder = await stack.db.adminPool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid FOR UPDATE`, [a.id]);
      // A Send on conversation B is unaffected by a lock held on conversation A.
      const res = await send(org.api_key, b.id, {
        client_turn_id: randomUUID(),
        branch_id: b.branchId,
        native_request: nativeRequest('SEND-14'),
      });
      expect(res.statusCode).toBe(201);
      await holder.query('ROLLBACK');
    } finally {
      holder.release();
    }
    // And once the lock is released, A accepts too.
    const after = await send(org.api_key, a.id, {
      client_turn_id: randomUUID(),
      branch_id: a.branchId,
      native_request: nativeRequest('SEND-14b'),
    });
    expect(after.statusCode).toBe(201);
  });

  it('SEND-10 — CONCURRENT duplicate sends produce ONE turn (the reservation race)', async () => {
    stack.provider.clearRecordedRequests();
    const conv = await createConversation(org.api_key);
    const clientTurnId = randomUUID();
    const body = {
      client_turn_id: clientTurnId,
      branch_id: conv.branchId,
      native_request: nativeRequest('concurrent'),
    };
    // The StrictMode double-invoke / double-click shape, fired simultaneously.
    const results = await Promise.all([
      send(org.api_key, conv.id, body),
      send(org.api_key, conv.id, body),
      send(org.api_key, conv.id, body),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    // Exactly one MINTED (201); the others replayed (200) or lost the race to a contender that
    // had not yet committed (409 send_reservation_contended — retryable with the same key).
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    for (const r of results) expect([200, 201, 409]).toContain(r.statusCode);

    const rows = await stack.db.adminPool.query<{ turns: string; attempts: string }>(
      `SELECT (SELECT count(*)::text FROM govai.ai_conversation_turns WHERE conversation_id = $1::uuid) AS turns,
              (SELECT count(*)::text FROM govai.ai_conversation_attempts WHERE conversation_id = $1::uuid) AS attempts`,
      [conv.id],
    );
    expect(rows.rows[0]).toEqual({ turns: '1', attempts: '1' });
    expect(stack.provider.recordedRequests).toEqual([]);
  });

  it('SEND-11 — two DISTINCT sends on one branch both reserve, in strict turn_seq order', async () => {
    // §8: reservations form a durable per-branch QUEUE. Both succeed; single-flight is enforced
    // at DISPATCH, not at reservation (that is the execution suite's subject).
    const conv = await createConversation(org.api_key);
    const a = await send(org.api_key, conv.id, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: nativeRequest('first'),
    });
    const b = await send(org.api_key, conv.id, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: nativeRequest('second'),
    });
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect((a.body as { turn_seq: string }).turn_seq).toBe('1');
    expect((b.body as { turn_seq: string }).turn_seq).toBe('2');
  });

  it('SEND-12 — a send to an ARCHIVED conversation is accepted; to a deleted one it is 404', async () => {
    // §7.7's EXECUTION-ELIGIBLE root is {active, archived}: archiving hides a conversation from
    // the default list, it does not fence execution.
    const conv = await createConversation(org.api_key);
    await inject(stack, 'PATCH', `/v1/ai/conversations/${conv.id}`, org.api_key, { archived: true });
    const ok = await send(org.api_key, conv.id, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: nativeRequest(),
    });
    expect(ok.statusCode).toBe(201);

    // Deletion fencing (LAW 10): P0-C implements no DELETE endpoint, so drive the durable state
    // directly — the reservation must refuse a non-execution-eligible root.
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversations SET status = 'deleted_pending' WHERE id = $1::uuid`,
      [conv.id],
    );
    const denied = await send(org.api_key, conv.id, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: nativeRequest(),
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.body).toEqual({ error: 'conversation_not_found' });
  });
});

describe('HYDRATE — §10 reload from durable state alone', () => {
  it('HYD-01 — an accepted turn with NO output hydrates immediately after the send', async () => {
    // ★ LOAD-BEARING: this is what makes "reload after accepted always shows the user turn" true.
    const conv = await createConversation(org.api_key);
    const sent = await send(org.api_key, conv.id, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: nativeRequest('HYD-01'),
    });
    const turnId = (sent.body as { id: string }).id;

    const one = await inject(stack, 'GET', `/v1/ai/conversations/${conv.id}/turns/${turnId}`, org.api_key);
    expect(one.statusCode).toBe(200);
    const turn = one.body as {
      id: string;
      input_items: Array<{ native: unknown }>;
      attempts: Array<{ state: string; output_items: unknown[]; terminal_at: string | null }>;
    };
    expect(turn.id).toBe(turnId);
    expect(turn.input_items[0]!.native).toEqual(nativeRequest('HYD-01'));
    expect(turn.attempts[0]!.state).toBe('accepted');
    expect(turn.attempts[0]!.output_items).toEqual([]); // honest: nothing has been produced
    expect(turn.attempts[0]!.terminal_at).toBeNull();
  });

  it('HYD-02 — a COMPLETED attempt hydrates its output on a brand-new request', async () => {
    const conv = await createConversation(org.api_key);
    const sent = await send(org.api_key, conv.id, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: nativeRequest('HYD-02'),
    });
    const turn = sent.body as { id: string; current_attempt_id: string };
    // Drive the attempt to `completed` through its LAWFUL edges and attach real output, without
    // running the worker (that is the execution suite's job). Every write here goes through the
    // same guard triggers production does.
    await completeAttemptWithOutput(conv.id, turn.current_attempt_id, '{"content":[{"text":"answered"}]}');

    const res = await inject(stack, 'GET', `/v1/ai/conversations/${conv.id}/turns/${turn.id}`, org.api_key);
    const hydrated = res.body as {
      attempts: Array<{ state: string; output_items: Array<{ item_type: string; native: unknown }>; terminal_at: string | null }>;
    };
    expect(hydrated.attempts[0]!.state).toBe('completed');
    expect(hydrated.attempts[0]!.terminal_at).not.toBeNull();
    expect(hydrated.attempts[0]!.output_items).toHaveLength(1);
    expect(hydrated.attempts[0]!.output_items[0]!.item_type).toBe('native_response');
    expect(hydrated.attempts[0]!.output_items[0]!.native).toEqual({ content: [{ text: 'answered' }] });
  });

  it('HYD-03 — an IN-PROGRESS attempt reports its state and its PARTIAL prefix honestly', async () => {
    const conv = await createConversation(org.api_key);
    const sent = await send(org.api_key, conv.id, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: nativeRequest('HYD-03'),
    });
    const turn = sent.body as { id: string; current_attempt_id: string };
    const credId = await activeCredentialId(org.org_id);
    await advanceToStreaming(conv.id, turn.current_attempt_id, credId);
    await appendStreamChunk(conv.id, turn.current_attempt_id, 'event: delta\ndata: {"t":"par"}\n\n');

    const res = await inject(stack, 'GET', `/v1/ai/conversations/${conv.id}/turns/${turn.id}`, org.api_key);
    const attempt = (res.body as { attempts: Array<{ state: string; terminal_at: string | null; output_items: Array<{ item_type: string; text: string | null; native: unknown }> }> }).attempts[0]!;
    expect(attempt.state).toBe('streaming'); // not "completed", not "failed"
    expect(attempt.terminal_at).toBeNull();
    expect(attempt.output_items).toHaveLength(1);
    // A stream chunk is provider SSE framing — TEXT, never re-parsed into a JSON document.
    expect(attempt.output_items[0]!.item_type).toBe('native_stream_chunk');
    expect(attempt.output_items[0]!.text).toBe('event: delta\ndata: {"t":"par"}\n\n');
    expect(attempt.output_items[0]!.native).toBeNull();
  });

  it('HYD-04 — the collection is ordered by turn_seq and keyset-paged deterministically', async () => {
    const conv = await createConversation(org.api_key);
    for (let i = 0; i < 5; i += 1) {
      await send(org.api_key, conv.id, {
        client_turn_id: randomUUID(),
        branch_id: conv.branchId,
        native_request: nativeRequest(`turn-${i}`),
      });
    }
    const page1 = await inject(stack, 'GET', `/v1/ai/conversations/${conv.id}/turns?limit=2`, org.api_key);
    const p1 = page1.body as { turns: Array<{ turn_seq: string }>; next_after_turn_seq: string | null };
    expect(p1.turns.map((t) => t.turn_seq)).toEqual(['1', '2']);
    expect(p1.next_after_turn_seq).toBe('2');

    const page2 = await inject(
      stack,
      'GET',
      `/v1/ai/conversations/${conv.id}/turns?limit=2&after_turn_seq=${p1.next_after_turn_seq}`,
      org.api_key,
    );
    const p2 = page2.body as { turns: Array<{ turn_seq: string }>; next_after_turn_seq: string | null };
    expect(p2.turns.map((t) => t.turn_seq)).toEqual(['3', '4']);

    const page3 = await inject(
      stack,
      'GET',
      `/v1/ai/conversations/${conv.id}/turns?limit=2&after_turn_seq=3`,
      org.api_key,
    );
    const p3 = page3.body as { turns: Array<{ turn_seq: string }>; next_after_turn_seq: string | null };
    // A FULL page still hands back a cursor even when it happens to be the last one — the page
    // itself cannot know the set is exhausted without over-reading.
    expect(p3.turns.map((t) => t.turn_seq)).toEqual(['4', '5']);
    expect(p3.next_after_turn_seq).toBe('5');

    // A SHORT page ends the walk and hands back NO cursor — otherwise a client polls empty pages
    // forever (the 0029 keyset lesson). Here the walk terminates in EXACTLY one extra request.
    const page4 = await inject(
      stack,
      'GET',
      `/v1/ai/conversations/${conv.id}/turns?limit=2&after_turn_seq=5`,
      org.api_key,
    );
    const p4 = page4.body as { turns: unknown[]; next_after_turn_seq: string | null };
    expect(p4.turns).toEqual([]);
    expect(p4.next_after_turn_seq).toBe(null);
    // Repeating the SAME query is byte-stable.
    const again = await inject(stack, 'GET', `/v1/ai/conversations/${conv.id}/turns?limit=2`, org.api_key);
    expect(again.rawBody).toBe(page1.rawBody);
  });

  it('HYD-05 — NO ciphertext, DEK, key identity, credential id, claim token or lease ever leaves', async () => {
    const conv = await createConversation(org.api_key);
    const sent = await send(org.api_key, conv.id, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: nativeRequest('HYD-05'),
    });
    const turn = sent.body as { id: string; current_attempt_id: string };
    const credId = await activeCredentialId(org.org_id);
    // Give the row EVERY sensitive value, so absence in the projection is a real assertion.
    await advanceToStreaming(conv.id, turn.current_attempt_id, credId);

    const secrets = await stack.db.adminPool.query<{
      claim_token: string;
      claimant: string;
      provider_credential_id: string;
      cipher_hex: string;
      dek_hex: string;
      hmac_hex: string;
    }>(
      `SELECT a.claim_token::text, a.claimant, a.provider_credential_id::text,
              encode(c.ciphertext, 'hex') AS cipher_hex,
              encode(c.dek_wrapped, 'hex') AS dek_hex,
              encode(c.content_hmac, 'hex') AS hmac_hex
         FROM govai.ai_conversation_attempts a
         JOIN govai.ai_conversation_turns t ON t.id = a.turn_id
         JOIN govai.ai_conversation_content c ON c.id = t.native_request_config_content_id
        WHERE a.id = $1::uuid`,
      [turn.current_attempt_id],
    );
    const s = secrets.rows[0]!;

    for (const url of [
      `/v1/ai/conversations/${conv.id}/turns`,
      `/v1/ai/conversations/${conv.id}/turns/${turn.id}`,
    ]) {
      const res = await inject(stack, 'GET', url, org.api_key);
      const raw = res.rawBody;
      for (const [label, value] of [
        ['claim_token', s.claim_token],
        ['claimant', s.claimant],
        ['provider_credential_id', s.provider_credential_id],
        ['ciphertext', s.cipher_hex],
        ['dek_wrapped', s.dek_hex],
        ['content_hmac', s.hmac_hex],
      ] as const) {
        expect({ url, label, leaked: raw.includes(value) }).toEqual({ url, label, leaked: false });
      }
      for (const key of [
        'claim_token',
        'claimant',
        'claim_deadline_at',
        'heartbeat_at',
        'provider_credential_id',
        'capture_id',
        'dispatch_boundary_committed_at',
        'causal_version_at_build',
        'continuation_parent',
        'ciphertext',
        'dek_wrapped',
        'kms_key_id',
        'content_hmac',
      ]) {
        expect({ url, key, present: raw.includes(key) }).toEqual({ url, key, present: false });
      }
      // The DECRYPTED body IS returned — that is the point of hydrate.
      expect(raw).toContain('HYD-05');
    }
  });

  it('HYD-06 — a foreign / same-org-other-owner / unknown turn is uniformly a 404', async () => {
    const conv = await createConversation(org.api_key);
    const sent = await send(org.api_key, conv.id, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: nativeRequest(),
    });
    const turnId = (sent.body as { id: string }).id;
    for (const [label, key] of [
      ['other org', other.api_key],
      ['same org, other owner', sameOrgOther.api_key],
    ] as const) {
      const list = await inject(stack, 'GET', `/v1/ai/conversations/${conv.id}/turns`, key);
      expect({ label, code: list.statusCode, body: list.body }).toEqual({
        label,
        code: 404,
        body: { error: 'conversation_not_found' },
      });
      const one = await inject(stack, 'GET', `/v1/ai/conversations/${conv.id}/turns/${turnId}`, key);
      expect({ label, code: one.statusCode }).toEqual({ label, code: 404 });
    }
    // A turn id that belongs to another conversation of the SAME owner is also a 404: the read
    // resolves through the FULL lineage, never by id alone (LAW 1 on the read path).
    const otherConv = await createConversation(org.api_key);
    const cross = await inject(stack, 'GET', `/v1/ai/conversations/${otherConv.id}/turns/${turnId}`, org.api_key);
    expect(cross.statusCode).toBe(404);
    expect(cross.body).toEqual({ error: 'turn_not_found' });
  });

  it('HYD-07 — a malformed id is a 400 (syntax), which is not an existence oracle', async () => {
    const conv = await createConversation(org.api_key);
    expect((await inject(stack, 'GET', `/v1/ai/conversations/not-a-uuid/turns`, org.api_key)).statusCode).toBe(400);
    const bad = await inject(stack, 'GET', `/v1/ai/conversations/${conv.id}/turns/not-a-uuid`, org.api_key);
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toEqual({ error: 'invalid_turn_id' });
  });
});

describe('RECONNECTION — execution never belonged to the sending connection', () => {
  it('RECON-01 — a client that disappears does NOT transition the attempt to failed', async () => {
    const conv = await createConversation(org.api_key);
    const sent = await send(org.api_key, conv.id, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: nativeRequest('RECON-01'),
    });
    const turn = sent.body as { id: string; current_attempt_id: string };
    // The reservation's HTTP request is over. Nothing about the durable turn depends on it.
    const row = await stack.db.adminPool.query<{ state: string }>(
      `SELECT state FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
      [turn.current_attempt_id],
    );
    expect(row.rows[0]!.state).toBe('accepted'); // still queued, NOT failed
  });

  it('RECON-02 — a FRESH authenticated client hydrates the same turn with no shared memory', async () => {
    const conv = await createConversation(org.api_key);
    const sent = await send(org.api_key, conv.id, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: nativeRequest('RECON-02'),
    });
    const turn = sent.body as { id: string; current_attempt_id: string };
    await completeAttemptWithOutput(conv.id, turn.current_attempt_id, '{"answer":"from the server"}');

    // ★ A DIFFERENT app instance, on a DIFFERENT pool, sharing nothing in memory with the one
    // that served the send. This is the strongest available in-suite proof that hydration reads
    // DURABLE STATE and not a per-process cache.
    const { buildServer } = await import('../../apps/api/src/server.js');
    const fresh = await buildServer({ env: stack.env });
    try {
      const res = await fresh.inject({
        method: 'GET',
        url: `/v1/ai/conversations/${conv.id}/turns/${turn.id}`,
        headers: { 'x-govai-api-key': org.api_key },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        input_items: Array<{ native: unknown }>;
        attempts: Array<{ state: string; output_items: Array<{ native: unknown }> }>;
      };
      expect(body.input_items[0]!.native).toEqual(nativeRequest('RECON-02'));
      expect(body.attempts[0]!.state).toBe('completed');
      expect(body.attempts[0]!.output_items[0]!.native).toEqual({ answer: 'from the server' });
    } finally {
      await fresh.close().catch(() => undefined);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Durable-state helpers.
//
// These drive attempts through their LAWFUL 0031 edges using the admin pool — so every CHECK and
// every guard trigger still fires. They exist so the hydrate contract can be tested WITHOUT
// running the worker; the worker's own path is proven in the execution-kernel suite.
// ─────────────────────────────────────────────────────────────────────────────────────────────

async function activeCredentialId(orgId: string): Promise<string> {
  const r = await stack.db.adminPool.query<{ id: string }>(
    `SELECT id FROM govai.provider_credentials WHERE org_id = $1::uuid AND status = 'active' LIMIT 1`,
    [orgId],
  );
  return r.rows[0]!.id;
}

/** accepted -> dispatching (+ boundary, request identity) -> provenance -> streaming. */
async function advanceToStreaming(
  conversationId: string,
  attemptId: string,
  credentialId: string,
): Promise<void> {
  void conversationId;
  const c = await stack.db.adminPool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `UPDATE govai.ai_conversation_attempts
          SET claim_token = gen_random_uuid(), claimant = 'test-harness',
              claim_deadline_at = now() + interval '5 minutes', heartbeat_at = now()
        WHERE id = $1::uuid`,
      [attemptId],
    );
    await c.query(
      `UPDATE govai.ai_conversation_attempts
          SET state = 'dispatching', dispatch_boundary_committed_at = now(),
              govai_request_id = gen_random_uuid(), causal_version_at_build = 0
        WHERE id = $1::uuid`,
      [attemptId],
    );
    await c.query(
      `UPDATE govai.ai_conversation_attempts SET provider_credential_id = $2::uuid WHERE id = $1::uuid`,
      [attemptId, credentialId],
    );
    await c.query(`UPDATE govai.ai_conversation_attempts SET state = 'streaming' WHERE id = $1::uuid`, [
      attemptId,
    ]);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

async function insertOutputItem(
  conversationId: string,
  attemptId: string,
  itemType: string,
  plaintext: string,
): Promise<void> {
  // Content is stored encrypted, so the harness encrypts through the SAME KMS the server uses.
  const { DevKms } = await import('@govai/core-identity');
  const { encryptConversationContent } = await import(
    '../../apps/api/src/ai-conversations/crypto.js'
  );
  const lineage = await stack.db.adminPool.query<{
    org_id: string;
    owner_user_id: string;
    branch_id: string;
    turn_id: string;
    next_seq: string;
  }>(
    `SELECT a.org_id, a.owner_user_id, a.branch_id, a.turn_id,
            (COALESCE((SELECT MAX(item_seq) FROM govai.ai_conversation_items WHERE attempt_id = a.id), 0) + 1)::text AS next_seq
       FROM govai.ai_conversation_attempts a WHERE a.id = $1::uuid`,
    [attemptId],
  );
  const l = lineage.rows[0]!;
  const enc = await encryptConversationContent(
    new DevKms(stack.seed),
    l.org_id,
    Buffer.from(plaintext, 'utf8'),
  );
  const content = await stack.db.adminPool.query<{ id: string }>(
    `INSERT INTO govai.ai_conversation_content
       (org_id, owner_user_id, conversation_id, ciphertext, dek_wrapped, kms_key_id, kms_key_version, content_hmac)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::bytea, $6::text, $7::integer, $8::bytea)
     RETURNING id`,
    [
      l.org_id,
      l.owner_user_id,
      conversationId,
      enc.ciphertext,
      enc.dekWrapped,
      enc.kmsKeyId,
      enc.kmsKeyVersion,
      enc.contentHmac,
    ],
  );
  await stack.db.adminPool.query(
    `INSERT INTO govai.ai_conversation_items
       (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id, item_seq, item_type, content_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::integer, $8::text, $9::uuid)`,
    [
      l.org_id,
      l.owner_user_id,
      conversationId,
      l.branch_id,
      l.turn_id,
      attemptId,
      Number(l.next_seq),
      itemType,
      content.rows[0]!.id,
    ],
  );
}

async function appendStreamChunk(
  conversationId: string,
  attemptId: string,
  text: string,
): Promise<void> {
  await insertOutputItem(conversationId, attemptId, 'native_stream_chunk', text);
}

async function completeAttemptWithOutput(
  conversationId: string,
  attemptId: string,
  responseJson: string,
): Promise<void> {
  const orgRow = await stack.db.adminPool.query<{ org_id: string }>(
    `SELECT org_id FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
    [attemptId],
  );
  await advanceToStreaming(conversationId, attemptId, await activeCredentialId(orgRow.rows[0]!.org_id));
  await insertOutputItem(conversationId, attemptId, 'native_response', responseJson);
  await stack.db.adminPool.query(
    `UPDATE govai.ai_conversation_attempts SET state = 'completed', terminal_at = now() WHERE id = $1::uuid`,
    [attemptId],
  );
}
