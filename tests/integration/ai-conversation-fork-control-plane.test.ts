// EP-AI-CONVERSATION-CONTINUITY-V1 P0-B — the fork control plane.
//
// A P0-B fork is a DURABLE CAUSAL OBJECT: it pins a specific immutable attempt, records the
// child's own execution triple, and — for `before_attempt_output` — mints the regeneration
// child turn with its fresh, UNCLAIMED initial attempt. It performs no provider work at all.
//
// Coverage map (movement dispatch §27):
//   F  P0A1-C4 — fork-pin MODE-SPECIFIC state validity, at BOTH the service and DB layers
//   H  fork lineage — the composite pin, and what it refuses
//   I  fork idempotency — replay, concurrency, and every conflict axis
//   J  LAW 10 — lifecycle serialization, both orderings
//   K  LAW 16 — the lock ACQUISITION ORDER, proven by observation

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  type SeededOrg,
  type Stack,
} from './helpers/server-fixture.js';
import {
  seedAttempt,
  seedConversation,
  seedContent,
  seedTurn,
  type AttemptTargetState,
  type OwnerIds,
} from './helpers/ai-conversation-seed.js';
import { branchExecutionAuthorityKey } from '../../apps/api/src/ai-conversations/locks.js';

let stack: Stack;
let org: SeededOrg;
let owner: OwnerIds;
/** A second owner inside the SAME org. */
let neighbourKey: string;
let neighbour: OwnerIds;
/** A different org entirely. */
let foreignOrg: SeededOrg;

beforeAll(async () => {
  stack = await startStack();
  org = await seedOrg(stack);
  owner = { orgId: org.org_id, ownerUserId: org.user_id };
  const nUser = randomUUID();
  neighbourKey = (await addApiKey(stack, org.org_id, nUser)).api_key;
  neighbour = { orgId: org.org_id, ownerUserId: nUser };
  foreignOrg = await seedOrg(stack);
}, 300_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

type ForkBody = {
  id: string;
  conversation_id: string;
  parent_branch_id: string;
  forked_from_turn_id: string;
  forked_from_attempt_id: string;
  boundary_mode: string;
  provider: string;
  surface: string;
  model: string;
  created_at: string;
  child_turn: { id: string; attempt_id: string } | null;
};

type Lineage = {
  conversationId: string;
  branchId: string;
  turnId: string;
  attemptId: string;
};

const admin = () => stack.db.adminPool;

/** A conversation + root branch + turn 1 + attempt 1 advanced to `state`, owned by `ids`. */
async function seedForkSource(
  ids: OwnerIds,
  state: AttemptTargetState = 'completed',
): Promise<Lineage> {
  const { conversationId, branchId } = await seedConversation(admin(), ids);
  const { turnId } = await seedTurn(admin(), ids, conversationId, branchId, 1);
  const attemptId = await seedAttempt(admin(), ids, conversationId, branchId, turnId, { state });
  await admin().query(
    `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
    [attemptId, turnId],
  );
  return { conversationId, branchId, turnId, attemptId };
}

function forkBody(src: Lineage, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    client_fork_id: randomUUID(),
    parent_branch_id: src.branchId,
    forked_from_turn_id: src.turnId,
    forked_from_attempt_id: src.attemptId,
    ...over,
  };
}

async function fork(
  apiKey: string,
  conversationId: string,
  body: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown; rawBody: string; headers: Record<string, unknown> }> {
  const res = await stack.app.inject({
    method: 'POST',
    url: `/v1/ai/conversations/${conversationId}/branches`,
    headers: { 'content-type': 'application/json', 'x-govai-api-key': apiKey },
    payload: body,
  });
  let parsed: unknown;
  try {
    parsed = res.body.length > 0 ? JSON.parse(res.body) : null;
  } catch {
    parsed = res.body;
  }
  return { statusCode: res.statusCode, body: parsed, rawBody: res.body, headers: res.headers };
}

async function branchCount(conversationId: string): Promise<number> {
  const r = await admin().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM govai.ai_conversation_branches
      WHERE conversation_id = $1::uuid AND parent_branch_id IS NOT NULL`,
    [conversationId],
  );
  return Number(r.rows[0]!.n);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// F — P0A1-C4: fork-pin MODE-SPECIFIC state validity
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Every durable attempt state, with the §3 verdict for each boundary mode. */
const C4_MATRIX: Array<{ state: AttemptTargetState; after: boolean; before: boolean }> = [
  { state: 'completed', after: true, before: true },
  { state: 'stopped', after: false, before: true },
  { state: 'failed', after: false, before: true },
  { state: 'rejected', after: false, before: true },
  { state: 'outcome_unknown', after: false, before: false },
  { state: 'accepted', after: false, before: false },
  { state: 'dispatching', after: false, before: false },
  { state: 'streaming', after: false, before: false },
];

describe('P0-B F — P0A1-C4: fork-pin mode-specific state validity', () => {
  it('F1 — the SERVICE enforces the exact §3 matrix, and says which state it refused', async () => {
    for (const row of C4_MATRIX) {
      for (const mode of ['after_attempt', 'before_attempt_output'] as const) {
        const expected = mode === 'after_attempt' ? row.after : row.before;
        const src = await seedForkSource(owner, row.state);
        const res = await fork(
          org.api_key,
          src.conversationId,
          forkBody(src, { boundary_mode: mode }),
        );
        const label = `${mode}/${row.state}`;
        if (expected) {
          expect({ label, code: res.statusCode }).toEqual({ label, code: 201 });
        } else {
          expect({ label, code: res.statusCode }).toEqual({ label, code: 409 });
          expect({ label, body: res.body }).toEqual({
            label,
            body: {
              error: 'fork_source_not_forkable',
              boundary_mode: mode,
              // The caller's OWN attempt state, so a client can tell "wait" from "never".
              attempt_state: row.state,
            },
          });
          expect({ label, branches: await branchCount(src.conversationId) }).toEqual({
            label,
            branches: 0,
          });
        }
      }
    }
  });

  it('F2 — the DATABASE is the backstop: the unlawful pin is unrepresentable even for a superuser', async () => {
    // If the service check were deleted tomorrow, the schema would still refuse. Proven at the
    // ADMIN pool, so RLS and grants are bypassed and only structure answers.
    for (const row of C4_MATRIX) {
      for (const mode of ['after_attempt', 'before_attempt_output'] as const) {
        const expected = mode === 'after_attempt' ? row.after : row.before;
        const src = await seedForkSource(owner, row.state);
        const label = `${mode}/${row.state}`;
        const insert = () =>
          admin().query(
            `INSERT INTO govai.ai_conversation_branches
               (org_id, owner_user_id, conversation_id, provider, surface, model,
                parent_branch_id, forked_from_turn_id, forked_from_attempt_id, boundary_mode)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_api', 'm',
                     $4::uuid, $5::uuid, $6::uuid, $7::text)`,
            [
              owner.orgId,
              owner.ownerUserId,
              src.conversationId,
              src.branchId,
              src.turnId,
              src.attemptId,
              mode,
            ],
          );
        if (expected) {
          await insert();
          expect({ label, branches: await branchCount(src.conversationId) }).toEqual({
            label,
            branches: 1,
          });
        } else {
          let code: string | undefined;
          try {
            await insert();
          } catch (err) {
            code = (err as { code?: string }).code;
          }
          expect({ label, code }).toEqual({ label, code: '42501' });
        }
      }
    }
  });

  it('F3 — outcome_unknown is refused in BOTH modes: it is not immutable-terminal', async () => {
    // Called out separately because it is the single most tempting state to admit under a
    // "terminal-ish" reading: §7.6 lets a recovery probe resolve it ONCE to completed/failed,
    // so its output can still change after a fork would have pinned it.
    const src = await seedForkSource(owner, 'outcome_unknown');
    for (const mode of ['after_attempt', 'before_attempt_output'] as const) {
      const res = await fork(org.api_key, src.conversationId, forkBody(src, { boundary_mode: mode }));
      expect({ mode, code: res.statusCode }).toEqual({ mode, code: 409 });
      expect((res.body as { attempt_state: string }).attempt_state).toBe('outcome_unknown');
    }
    expect(await branchCount(src.conversationId)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// H — fork lineage
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('P0-B H — fork lineage is composite, never an id alone', () => {
  it('H1/H2/H3 — the attempt must belong to the declared turn, branch AND conversation', async () => {
    const a = await seedForkSource(owner);
    const b = await seedForkSource(owner);
    // A second turn on A's branch, with its own completed attempt.
    const t2 = await seedTurn(admin(), owner, a.conversationId, a.branchId, 2);
    const a2 = await seedAttempt(admin(), owner, a.conversationId, a.branchId, t2.turnId, {
      state: 'completed',
    });

    const cases: Array<[string, Record<string, unknown>]> = [
      // The attempt belongs to a DIFFERENT turn of the same branch.
      ['attempt of another turn', forkBody(a, { forked_from_attempt_id: a2 })],
      // The turn belongs to a different CONVERSATION.
      ['turn of another conversation', forkBody(a, { forked_from_turn_id: b.turnId })],
      // The parent branch belongs to a different conversation.
      ['branch of another conversation', forkBody(a, { parent_branch_id: b.branchId })],
      // Wholly foreign lineage.
      [
        'foreign lineage',
        forkBody(a, {
          parent_branch_id: b.branchId,
          forked_from_turn_id: b.turnId,
          forked_from_attempt_id: b.attemptId,
        }),
      ],
      // Ids that simply do not exist.
      ['absent attempt', forkBody(a, { forked_from_attempt_id: randomUUID() })],
      ['absent branch', forkBody(a, { parent_branch_id: randomUUID() })],
    ];
    for (const [label, body] of cases) {
      const res = await fork(org.api_key, a.conversationId, body);
      expect({ label, code: res.statusCode, body: res.body }).toEqual({
        label,
        code: 404,
        // One code for every broken link: the response never says WHICH one was wrong.
        body: { error: 'fork_source_not_found' },
      });
    }
    expect(await branchCount(a.conversationId)).toBe(0);
  });

  it('H4 — the owner must own the WHOLE lineage: neighbours and other orgs get 404', async () => {
    const mine = await seedForkSource(owner);
    for (const [label, key] of [
      ['same org, other owner', neighbourKey],
      ['other org', foreignOrg.api_key],
    ] as const) {
      const res = await fork(key, mine.conversationId, forkBody(mine));
      expect({ label, code: res.statusCode, body: res.body }).toEqual({
        label,
        code: 404,
        // Not `fork_source_not_found`: the CONVERSATION itself is unreachable, and that answer
        // must be identical to "no such conversation" so it is not an existence oracle.
        body: { error: 'conversation_not_found' },
      });
    }
    // A neighbour cannot graft their own conversation onto my lineage either.
    const theirs = await seedForkSource(neighbour);
    const res = await fork(
      neighbourKey,
      theirs.conversationId,
      forkBody(theirs, {
        forked_from_turn_id: mine.turnId,
        forked_from_attempt_id: mine.attemptId,
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(await branchCount(mine.conversationId)).toBe(0);
    expect(await branchCount(theirs.conversationId)).toBe(0);
  });

  it('H5/H7 — the fork pins the EXACT attempt and stores its own durable triple', async () => {
    const src = await seedForkSource(owner);
    const res = await fork(
      org.api_key,
      src.conversationId,
      forkBody(src, { provider: 'openai', surface: 'openai_responses', model: 'gpt-test' }),
    );
    expect(res.statusCode).toBe(201);
    const body = res.body as ForkBody;
    expect(body.forked_from_attempt_id).toBe(src.attemptId);
    expect(body.forked_from_turn_id).toBe(src.turnId);
    expect(body.parent_branch_id).toBe(src.branchId);
    expect(body.boundary_mode).toBe('after_attempt'); // §13's default
    expect(body.child_turn).toBeNull(); // after_attempt mints no child rows at fork time

    // §17: a cross-provider fork is a durable BRANCH-metadata object. The triple survives
    // reload because it lives on the branch row, not in any request memory.
    const row = (
      await admin().query<{
        provider: string;
        surface: string;
        model: string;
        forked_from_attempt_id: string;
        boundary_mode: string;
      }>(
        `SELECT provider, surface, model, forked_from_attempt_id, boundary_mode
           FROM govai.ai_conversation_branches WHERE id = $1::uuid`,
        [body.id],
      )
    ).rows[0]!;
    expect(row).toEqual({
      provider: 'openai',
      surface: 'openai_responses',
      model: 'gpt-test',
      forked_from_attempt_id: src.attemptId,
      boundary_mode: 'after_attempt',
    });
    // The conversation ROOT's own defaults are untouched — the branch is the execution truth.
    const conv = (
      await admin().query<{ provider: string; model: string }>(
        `SELECT provider, model FROM govai.ai_conversations WHERE id = $1::uuid`,
        [src.conversationId],
      )
    ).rows[0]!;
    expect(conv).toEqual({ provider: 'anthropic', model: 'test-model' });
  });

  it('H5b — an omitted triple inherits the PARENT branch, per field', async () => {
    const src = await seedForkSource(owner);
    const inherited = await fork(org.api_key, src.conversationId, forkBody(src));
    expect((inherited.body as ForkBody).provider).toBe('anthropic');
    expect((inherited.body as ForkBody).surface).toBe('anthropic_api');
    expect((inherited.body as ForkBody).model).toBe('test-model');
    // A per-field override changes only that field (§17's same-provider model switch).
    const modelOnly = await fork(
      org.api_key,
      src.conversationId,
      forkBody(src, { model: 'claude-newer' }),
    );
    const body = modelOnly.body as ForkBody;
    expect({ p: body.provider, s: body.surface, m: body.model }).toEqual({
      p: 'anthropic',
      s: 'anthropic_api',
      m: 'claude-newer',
    });
  });

  it('H6 — a later attempt on the source turn cannot retarget an existing fork', async () => {
    const src = await seedForkSource(owner);
    const created = await fork(org.api_key, src.conversationId, forkBody(src));
    const forkId = (created.body as ForkBody).id;

    // The source turn moves on: attempt 2 is minted and becomes current (the §7.6 handoff).
    const a2 = await seedAttempt(admin(), owner, src.conversationId, src.branchId, src.turnId, {
      attemptSeq: 2,
      state: 'completed',
    });
    await admin().query(
      `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
      [a2, src.turnId],
    );
    // The fork still points at the attempt it PINNED — ancestry cannot drift behind it.
    const after = (
      await admin().query<{ forked_from_attempt_id: string }>(
        `SELECT forked_from_attempt_id FROM govai.ai_conversation_branches WHERE id = $1::uuid`,
        [forkId],
      )
    ).rows[0]!;
    expect(after.forked_from_attempt_id).toBe(src.attemptId);
    expect(after.forked_from_attempt_id).not.toBe(a2);
    // And the pin cannot be retargeted by anyone, for any reason.
    let blocked = false;
    try {
      await admin().query(
        `UPDATE govai.ai_conversation_branches SET forked_from_attempt_id = $1::uuid
          WHERE id = $2::uuid`,
        [a2, forkId],
      );
    } catch (err) {
      blocked = (err as { code?: string }).code === '42501';
    }
    expect(blocked).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// before_attempt_output — the regeneration child
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('P0-B — before_attempt_output mints the regeneration child, and nothing else', () => {
  it('mints child turn + fresh UNCLAIMED attempt, copying the immutable input, atomically', async () => {
    const src = await seedForkSource(owner);
    // Give the source turn two TURN-OWNED (user/input) items and one ATTEMPT-OWNED output item.
    const inputContent1 = await seedContent(admin(), owner, src.conversationId);
    const inputContent2 = await seedContent(admin(), owner, src.conversationId);
    const outputContent = await seedContent(admin(), owner, src.conversationId);
    for (const [seq, type, contentId, attemptId] of [
      [1, 'input_text', inputContent1, null],
      [2, 'input_image', inputContent2, null],
      [1, 'output_text', outputContent, src.attemptId],
    ] as const) {
      await admin().query(
        `INSERT INTO govai.ai_conversation_items
           (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id,
            item_seq, item_type, content_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::int, $8::text, $9::uuid)`,
        [
          owner.orgId,
          owner.ownerUserId,
          src.conversationId,
          src.branchId,
          src.turnId,
          attemptId,
          seq,
          type,
          contentId,
        ],
      );
    }

    const res = await fork(
      org.api_key,
      src.conversationId,
      forkBody(src, { boundary_mode: 'before_attempt_output' }),
    );
    expect(res.statusCode).toBe(201);
    const body = res.body as ForkBody;
    expect(body.boundary_mode).toBe('before_attempt_output');
    expect(body.child_turn).not.toBeNull();

    // The child turn is turn 1 of the CHILD branch, and its pointer is already set (§7.1b).
    const turn = (
      await admin().query<{
        id: string;
        branch_id: string;
        turn_seq: string;
        current_attempt_id: string;
        native_request_config_content_id: string;
      }>(
        `SELECT id, branch_id, turn_seq::text, current_attempt_id, native_request_config_content_id
           FROM govai.ai_conversation_turns WHERE branch_id = $1::uuid`,
        [body.id],
      )
    ).rows;
    expect(turn).toHaveLength(1);
    expect(turn[0]!.id).toBe(body.child_turn!.id);
    expect(turn[0]!.turn_seq).toBe('1');
    expect(turn[0]!.current_attempt_id).toBe(body.child_turn!.attempt_id);

    // The native request config is a COPY: a different row, byte-identical ciphertext, and the
    // child turn reads its own config — never the parent's row.
    expect(turn[0]!.native_request_config_content_id).not.toBe(src.turnId);
    const configs = await admin().query<{ same_bytes: boolean; new_id: string; old_id: string }>(
      `SELECT c1.ciphertext = c2.ciphertext AND c1.content_hmac = c2.content_hmac
                AND c1.kms_key_id = c2.kms_key_id AND c1.kms_key_version = c2.kms_key_version
                AND c1.dek_wrapped = c2.dek_wrapped AS same_bytes,
              c1.id AS new_id, c2.id AS old_id
         FROM govai.ai_conversation_content c1,
              (SELECT ct.* FROM govai.ai_conversation_content ct
                JOIN govai.ai_conversation_turns t
                  ON t.native_request_config_content_id = ct.id
               WHERE t.id = $2::uuid) c2
        WHERE c1.id = $1::uuid`,
      [turn[0]!.native_request_config_content_id, src.turnId],
    );
    expect(configs.rows[0]!.same_bytes).toBe(true);
    expect(configs.rows[0]!.new_id).not.toBe(configs.rows[0]!.old_id);

    // The fresh attempt is born in the §7.1b shape: accepted, UNCLAIMED, PRE-BOUNDARY, with no
    // request identity, no credential provenance and no continuation anchor. It is not
    // claimed, not dispatched, not queued and not woken.
    const attempt = (
      await admin().query<Record<string, unknown>>(
        `SELECT state, attempt_seq, claim_token, claimant, claim_deadline_at, heartbeat_at,
                stop_requested, causal_version_at_build, govai_request_id, capture_id,
                provider_credential_id, dispatch_boundary_committed_at,
                continuation_parent_ciphertext, context_excluded, error_class, terminal_at
           FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
        [body.child_turn!.attempt_id],
      )
    ).rows[0]!;
    expect(attempt).toEqual({
      state: 'accepted',
      attempt_seq: 1,
      claim_token: null,
      claimant: null,
      claim_deadline_at: null,
      heartbeat_at: null,
      stop_requested: false,
      causal_version_at_build: null,
      govai_request_id: null,
      capture_id: null,
      provider_credential_id: null,
      dispatch_boundary_committed_at: null,
      continuation_parent_ciphertext: null,
      context_excluded: false,
      error_class: null,
      terminal_at: null,
    });

    // LAW 2: only the TURN-OWNED items were copied; the attempt-owned OUTPUT is excluded by
    // the boundary mode itself, which is the entire point of `before_attempt_output`.
    const items = await admin().query<{ item_seq: number; item_type: string; attempt_id: string | null }>(
      `SELECT item_seq, item_type, attempt_id FROM govai.ai_conversation_items
        WHERE branch_id = $1::uuid ORDER BY item_seq`,
      [body.id],
    );
    expect(items.rows).toEqual([
      { item_seq: 1, item_type: 'input_text', attempt_id: null },
      { item_seq: 2, item_type: 'input_image', attempt_id: null },
    ]);
    // Each copied item has its OWN content row, byte-identical to its source.
    const copied = await admin().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_items i
         JOIN govai.ai_conversation_content c ON c.id = i.content_id
        WHERE i.branch_id = $1::uuid AND i.content_id IN ($2::uuid, $3::uuid)`,
      [body.id, inputContent1, inputContent2],
    );
    expect(copied.rows[0]!.n).toBe('0'); // never a shared reference
  });

  it('a before_attempt_output fork that CHANGES the triple is REJECTED, never silently translated', async () => {
    // §3: the child turn carries a COPY of the source's provider-shaped native request config,
    // and that config does not carry over across a switch. The accepted architecture's own
    // outcome for this shape is REJECTED unless a replacement config is supplied — and P0-B
    // accepts none, because the native request body is the durable-send surface (P0-C) and no
    // provider-native request validator exists in the tree to prove one "valid for the target".
    const src = await seedForkSource(owner);
    for (const over of [
      { provider: 'openai' },
      { surface: 'openai_responses' },
      { model: 'gpt-test' },
      { provider: 'openai', surface: 'openai_responses', model: 'gpt-test' },
    ]) {
      const res = await fork(
        org.api_key,
        src.conversationId,
        forkBody(src, { boundary_mode: 'before_attempt_output', ...over }),
      );
      expect({ over, code: res.statusCode }).toEqual({ over, code: 409 });
      expect((res.body as { error: string }).error).toBe('fork_replacement_config_required');
    }
    expect(await branchCount(src.conversationId)).toBe(0);
    // Restating the parent's OWN triple explicitly is the same fork, and is accepted.
    const same = await fork(
      org.api_key,
      src.conversationId,
      forkBody(src, {
        boundary_mode: 'before_attempt_output',
        provider: 'anthropic',
        surface: 'anthropic_api',
        model: 'test-model',
      }),
    );
    expect(same.statusCode).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// I — fork idempotency
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('P0-B I — fork idempotency under client_fork_id', () => {
  it('I1/I3 — the same key + the same intent REPLAYS the one branch, minting nothing', async () => {
    const src = await seedForkSource(owner);
    const body = forkBody(src);
    const first = await fork(org.api_key, src.conversationId, body);
    expect(first.statusCode).toBe(201);
    expect(first.headers['x-govai-ai-fork-idempotent-replay']).toBeUndefined();

    // A lost-response retry: byte-identical request, same key.
    const replay = await fork(org.api_key, src.conversationId, body);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['x-govai-ai-fork-idempotent-replay']).toBe('true');
    expect((replay.body as ForkBody).id).toBe((first.body as ForkBody).id);
    expect(replay.body).toEqual(first.body);
    expect(await branchCount(src.conversationId)).toBe(1);

    // The same intent under a DIFFERENT key is a legitimately different fork: several forks
    // from one pinned attempt are lawful, which is exactly why the ancestry tuple alone cannot
    // deduplicate (§13).
    const second = await fork(org.api_key, src.conversationId, forkBody(src));
    expect(second.statusCode).toBe(201);
    expect((second.body as ForkBody).id).not.toBe((first.body as ForkBody).id);
    expect(await branchCount(src.conversationId)).toBe(2);
  });

  it('I2 — CONCURRENT identical requests produce exactly ONE branch', async () => {
    const src = await seedForkSource(owner);
    const body = forkBody(src);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => fork(org.api_key, src.conversationId, body)),
    );
    const codes = results.map((r) => r.statusCode).sort();
    // Exactly one winner (201); every other request replays the committed branch (200).
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 200)).toHaveLength(5);
    const ids = new Set(results.map((r) => (r.body as ForkBody).id));
    expect(ids.size).toBe(1);
    expect(await branchCount(src.conversationId)).toBe(1);
    // The rolled-back candidates left nothing behind: exactly one binding, one branch.
    const bindings = await admin().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_fork_idempotency
        WHERE conversation_id = $1::uuid`,
      [src.conversationId],
    );
    expect(bindings.rows[0]!.n).toBe('1');
  });

  it('I4/I5/I6 — the same key with ANY divergent intent axis is a 409, and mints nothing', async () => {
    const src = await seedForkSource(owner);
    // A second completed attempt on the same turn, and a second turn — both lawful alternative
    // pins, so a key reused against them is a genuine intent divergence.
    const a2 = await seedAttempt(admin(), owner, src.conversationId, src.branchId, src.turnId, {
      attemptSeq: 2,
      state: 'completed',
    });
    await admin().query(
      `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
      [a2, src.turnId],
    );

    const key = randomUUID();
    const base = forkBody(src, { client_fork_id: key });
    const first = await fork(org.api_key, src.conversationId, base);
    expect(first.statusCode).toBe(201);
    const winnerId = (first.body as ForkBody).id;

    const divergent: Array<[string, Record<string, unknown>]> = [
      ['different pinned attempt', { ...base, forked_from_attempt_id: a2 }],
      ['different boundary mode', { ...base, boundary_mode: 'before_attempt_output' }],
      ['different provider', { ...base, provider: 'openai' }],
      ['different surface', { ...base, surface: 'anthropic_messages' }],
      ['different model', { ...base, model: 'claude-other' }],
    ];
    for (const [label, body] of divergent) {
      const res = await fork(org.api_key, src.conversationId, body);
      expect({ label, code: res.statusCode, body: res.body }).toEqual({
        label,
        code: 409,
        // Static body: never the key, never either hash, never the stored intent.
        body: { error: 'fork_idempotency_key_conflict' },
      });
    }
    // Exactly one branch and one binding survived every conflicting attempt.
    expect(await branchCount(src.conversationId)).toBe(1);
    const binding = await admin().query<{ branch_id: string; n: string }>(
      `SELECT branch_id, count(*) OVER ()::text AS n FROM govai.ai_conversation_fork_idempotency
        WHERE conversation_id = $1::uuid AND client_fork_id = $2::uuid`,
      [src.conversationId, key],
    );
    expect(binding.rows).toHaveLength(1);
    expect(binding.rows[0]!.branch_id).toBe(winnerId);
  });

  it('I6b — restating the INHERITED triple explicitly is the SAME intent, not a conflict', async () => {
    // The hash is over the RESOLVED triple, so a client that becomes more explicit on a retry
    // replays instead of colliding with itself.
    const src = await seedForkSource(owner);
    const key = randomUUID();
    const first = await fork(org.api_key, src.conversationId, forkBody(src, { client_fork_id: key }));
    expect(first.statusCode).toBe(201);
    const explicit = await fork(
      org.api_key,
      src.conversationId,
      forkBody(src, {
        client_fork_id: key,
        provider: 'anthropic',
        surface: 'anthropic_api',
        model: 'test-model',
      }),
    );
    expect(explicit.statusCode).toBe(200);
    expect((explicit.body as ForkBody).id).toBe((first.body as ForkBody).id);
    // ...and uuid casing is likewise the same intent.
    const recased = await fork(
      org.api_key,
      src.conversationId,
      forkBody(src, {
        client_fork_id: key.toUpperCase(),
        forked_from_attempt_id: src.attemptId.toUpperCase(),
      }),
    );
    expect(recased.statusCode).toBe(200);
    expect((recased.body as ForkBody).id).toBe((first.body as ForkBody).id);
  });

  it('I8 — a duplicate before_attempt_output fork mints NO duplicate child turn or attempt', async () => {
    const src = await seedForkSource(owner);
    const body = forkBody(src, { boundary_mode: 'before_attempt_output' });
    const first = await fork(org.api_key, src.conversationId, body);
    expect(first.statusCode).toBe(201);
    const child = (first.body as ForkBody).child_turn!;

    // Sequential retry AND a concurrent burst, both under the same key.
    const replay = await fork(org.api_key, src.conversationId, body);
    const burst = await Promise.all(
      Array.from({ length: 4 }, () => fork(org.api_key, src.conversationId, body)),
    );
    for (const res of [replay, ...burst]) {
      expect(res.statusCode).toBe(200);
      expect((res.body as ForkBody).child_turn).toEqual(child);
    }
    const turns = await admin().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_turns
        WHERE conversation_id = $1::uuid AND branch_id <> $2::uuid`,
      [src.conversationId, src.branchId],
    );
    expect(turns.rows[0]!.n).toBe('1');
    const attempts = await admin().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_attempts
        WHERE conversation_id = $1::uuid AND branch_id <> $2::uuid`,
      [src.conversationId, src.branchId],
    );
    expect(attempts.rows[0]!.n).toBe('1');
    expect(await branchCount(src.conversationId)).toBe(1);
  });

  it('I9 — a fork key is scoped to its conversation, and cannot be replayed across owners', async () => {
    const mine = await seedForkSource(owner);
    const alsoMine = await seedForkSource(owner);
    const key = randomUUID();
    const a = await fork(org.api_key, mine.conversationId, forkBody(mine, { client_fork_id: key }));
    expect(a.statusCode).toBe(201);
    // The SAME key in a DIFFERENT conversation is a different binding — 0033's PK is
    // (org_id, conversation_id, client_fork_id).
    const b = await fork(
      org.api_key,
      alsoMine.conversationId,
      forkBody(alsoMine, { client_fork_id: key }),
    );
    expect(b.statusCode).toBe(201);
    expect((b.body as ForkBody).id).not.toBe((a.body as ForkBody).id);
    // A neighbour replaying the key against MY conversation gets the ordinary 404.
    const stolen = await fork(neighbourKey, mine.conversationId, forkBody(mine, { client_fork_id: key }));
    expect(stolen.statusCode).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// J / K — LAW 10 lifecycle serialization and LAW 16 lock order
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Hold a transaction open on a dedicated connection so an interleaving can be forced. */
async function openHolder(): Promise<{ c: PoolClient; done: () => Promise<void> }> {
  const c = await stack.db.adminPool.connect();
  await c.query('BEGIN');
  return {
    c,
    done: async () => {
      await c.query('COMMIT').catch(() => undefined);
      c.release();
    },
  };
}

describe('P0-B J — LAW 10: fork and lifecycle serialize on the conversation root', () => {
  it('J1 — LIFECYCLE WINS: the waiting fork revalidates under the root lock and inserts NOTHING', async () => {
    const src = await seedForkSource(owner);
    const holder = await openHolder();
    // §19.1 step 1: the deletion transition takes the SAME root row lock the fork takes.
    await holder.c.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid FOR UPDATE`, [
      src.conversationId,
    ]);

    let settled = false;
    const pending = fork(org.api_key, src.conversationId, forkBody(src)).then((r) => {
      settled = true;
      return r;
    });
    // The fork must BLOCK on the root, not race past it. If it had already committed here, the
    // check-then-write race would be live.
    await sleep(400);
    expect(settled).toBe(false);
    expect(await branchCount(src.conversationId)).toBe(0);

    await holder.c.query(
      `UPDATE govai.ai_conversations SET status = 'deleted_pending' WHERE id = $1::uuid`,
      [src.conversationId],
    );
    await holder.done();

    const res = await pending;
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'conversation_not_found' });
    // No late execution-capable descendant exists for the deletion to have missed.
    expect(await branchCount(src.conversationId)).toBe(0);
    const bindings = await admin().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_fork_idempotency
        WHERE conversation_id = $1::uuid`,
      [src.conversationId],
    );
    expect(bindings.rows[0]!.n).toBe('0');
  });

  it('J2 — FORK WINS: the lifecycle transition acquiring the lock afterwards SEES the descendant', async () => {
    const src = await seedForkSource(owner);
    const created = await fork(org.api_key, src.conversationId, forkBody(src));
    expect(created.statusCode).toBe(201);
    const forkId = (created.body as ForkBody).id;

    // The deletion enumerates under the root lock, exactly as §19.1 prescribes.
    const holder = await openHolder();
    try {
      await holder.c.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid FOR UPDATE`, [
        src.conversationId,
      ]);
      const enumerated = await holder.c.query<{ id: string }>(
        `SELECT id FROM govai.ai_conversation_branches
          WHERE conversation_id = $1::uuid AND parent_branch_id IS NOT NULL`,
        [src.conversationId],
      );
      expect(enumerated.rows.map((r) => r.id)).toEqual([forkId]);
      await holder.c.query(
        `UPDATE govai.ai_conversations SET status = 'deleted_pending' WHERE id = $1::uuid`,
        [src.conversationId],
      );
    } finally {
      await holder.done();
    }
    // And once fenced, no further fork can be created on that root.
    const late = await fork(org.api_key, src.conversationId, forkBody(src));
    expect(late.statusCode).toBe(404);
    expect(await branchCount(src.conversationId)).toBe(1);
  });

  it('J3 — an ARCHIVED root is still execution-eligible (§19.1 admits both deletion origins)', async () => {
    // Archiving hides a conversation from the default list; only `deleted_pending` closes it to
    // new work. Getting this wrong in either direction would be a silent doctrine change.
    const src = await seedForkSource(owner);
    await admin().query(
      `UPDATE govai.ai_conversations SET status = 'archived', archived_at = now() WHERE id = $1::uuid`,
      [src.conversationId],
    );
    const res = await fork(org.api_key, src.conversationId, forkBody(src));
    expect(res.statusCode).toBe(201);
  });
});

describe('P0-B K — LAW 16: the lock order is (1) root then (2) branch authority', () => {
  it('K1 — while blocked on the ROOT, the fork has NOT taken the branch execution authority', async () => {
    const src = await seedForkSource(owner);
    const holder = await openHolder();
    await holder.c.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid FOR UPDATE`, [
      src.conversationId,
    ]);

    const pending = fork(org.api_key, src.conversationId, forkBody(src));
    await sleep(400);

    // A third session can still take the branch authority: level (2) is demonstrably NOT held
    // while the fork waits at level (1). An implementation that took the branch lock first
    // would fail here — and would be able to deadlock against a flow that takes them in order.
    const probe = await stack.db.adminPool.connect();
    try {
      await probe.query('BEGIN');
      const free = await probe.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS ok',
        [branchExecutionAuthorityKey(src.branchId)],
      );
      expect(free.rows[0]!.ok).toBe(true);
      await probe.query('ROLLBACK');
    } finally {
      probe.release();
    }

    await holder.done();
    expect((await pending).statusCode).toBe(201);
  });

  it('K2 — while blocked on the BRANCH authority, the fork already HOLDS the root', async () => {
    const src = await seedForkSource(owner);
    // Hold level (2) from another session.
    const holder = await openHolder();
    await holder.c.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
      branchExecutionAuthorityKey(src.branchId),
    ]);

    const pending = fork(org.api_key, src.conversationId, forkBody(src));
    await sleep(400);

    // The root row is already locked by the fork — so it acquired (1) BEFORE waiting on (2).
    const probe = await stack.db.adminPool.connect();
    let lockUnavailable = false;
    try {
      await probe.query('BEGIN');
      await probe.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid FOR UPDATE NOWAIT`, [
        src.conversationId,
      ]);
    } catch (err) {
      lockUnavailable = (err as { code?: string }).code === '55P03';
    } finally {
      await probe.query('ROLLBACK').catch(() => undefined);
      probe.release();
    }
    expect(lockUnavailable).toBe(true);

    await holder.done();
    expect((await pending).statusCode).toBe(201);
  });

  it('K3 — the branch authority key is derived from the SHIPPED namespace, not a test literal', async () => {
    // A second locking domain for the same object would serialize nothing. Pinning the exact
    // key here is what makes the two proofs above meaningful for P0-C's runner as well.
    expect(branchExecutionAuthorityKey('abc')).toBe('ai_conversation_branch:abc');
  });
});
