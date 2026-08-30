// SERVER-ASSEMBLED DURABLE BRANCH CONTEXT — the context plane of P0-D1
// (EP-AI-CONVERSATION-CONTINUITY-V1 P0-D1; spec §3 fork pins, §7.5 eligibility, §7.6 retry
// boundary, §7.8 causal monotonicity, §11 continuation roots, §24 LAW 1/2/3/4).
//
// This module answers ONE question, from durable state alone: "which prior content is the
// provider allowed to see when THIS attempt dispatches?" — and it answers it in two strictly
// separated phases:
//
//   PHASE A  loadDurableContextPlan(tx, …)   DATABASE ONLY. Runs on the worker's owner-context
//            client, reads rows and ENCRYPTED envelopes, and returns a plan. It never decrypts.
//            The transaction that contains it commits before any KMS call happens.
//   PHASE B  assembleDurableContext(kms, …)  KMS ONLY. Takes the committed plan, holds NO
//            database client, and produces decrypted provider-native entries.
//
// The phase boundary is the §16 rule of the movement dispatch made structural: Phase B's
// signature does not accept a client, so a KMS round trip while a checkout is held cannot be
// reintroduced by a later edit (the P0C-SWEEP-01 lesson, applied at birth instead of remediated
// after).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE ELIGIBILITY ALGORITHM (deterministic; the §34 required proof)
//
// Context is assembled OLDEST → NEWEST by walking the executing branch's FORK ANCESTRY up to
// the root and then emitting per-branch turn ranges downward:
//
//   for each ancestor branch, bounded by the fork edge that leaves it:
//     turns with turn_seq < forked_from_turn.turn_seq        (standard per-turn rule below)
//     + for an `after_attempt` fork edge:
//         the fork turn's TURN-OWNED user items
//         + the PINNED attempt's completed output             (§7.5 FORK-PIN EXEMPTION: the pin
//           is itself the explicit selection, so currency and `context_excluded` — judgments
//           about the attempt's standing on ITS OWN branch — do not apply at the boundary)
//     + for a `before_attempt_output` fork edge: NOTHING MORE — the child branch's minted
//         first turn carries the COPIED user items (0033's fork transaction), so emitting the
//         source turn's input here would replay it twice
//   on the executing branch itself:
//     turns with turn_seq < the dispatching turn's turn_seq  (standard per-turn rule below)
//
// STANDARD PER-TURN RULE (§7.5, LAW 2):
//   * the turn's TURN-OWNED user items are ALWAYS context — user input is context whatever
//     became of the answer (a failed turn's question is still part of the conversation);
//   * output is contributed ONLY by the turn's `current_attempt_id` attempt, ONLY when that
//     attempt is `completed`, and ONLY when it does not carry `context_excluded`. A superseded
//     retry attempt, a failed/stopped/rejected attempt, and an `outcome_unknown` attempt
//     contribute NO output — `outcome_unknown` is not a completed context contribution, and a
//     post-advance recovered answer is transcript-only (§7.8).
//
// RETRY BOUNDARY (LAW 4) FALLS OUT OF THE RULE RATHER THAN BEING A SPECIAL CASE: the turn being
// dispatched contributes only turns STRICTLY BEFORE it, so attempt N+1 of a turn is built from
// context-before-N's-output plus the turn's own immutable input — never any prior attempt's
// answer — and the OpenAI chaining anchor (derived from the LAST eligible completed output,
// adapter-side) automatically rewinds to N's parent anchor.
//
// CROSS-CONTAMINATION IS STRUCTURALLY EXCLUDED TWICE: every query below carries the full LAW 1
// lineage predicates (org, owner, conversation, branch) AS WELL AS running under the worker's
// dual-predicate FORCE RLS — the explicit predicates are index selectivity and lineage
// documentation, the policies are the authority.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import type { PoolClient } from 'pg';
import type { Kms } from '@govai/core-identity';
import type { ConversationWorkerOwner } from '../../pipeline/ai-conversation-worker.js';
import { decryptConversationContent } from '../crypto.js';

/**
 * Hard bound on the fork-ancestry walk. 0031's composite FKs make a cycle unrepresentable, so
 * this is a defensive bound on pathological depth, not a correctness device. Exceeding it fails
 * CLOSED as unbuildable rather than assembling a silently truncated history.
 */
const MAX_BRANCH_DEPTH = 64;

/**
 * AGGREGATE CONTEXT BUDGET (review finding, exact head 4918180): a branch has no total-turn
 * limit and every turn may carry up to `NATIVE_REQUEST_MAX_BYTES` of input, so an unbounded
 * load would let one tenant's long branch make a shared worker fetch and KMS-decrypt hundreds
 * of megabytes per dispatch. The budget is enforced IN PHASE A, and the byte bound is computed
 * by a SQL AGGREGATE over `octet_length(ciphertext)` BEFORE any ciphertext row is fetched — an
 * over-budget build refuses without ever pulling the payload bytes.
 *
 * ★ REFUSAL, NEVER TRUNCATION. Silently dropping oldest history to fit a budget would change
 * what the model sees behind the user's back (§31's silent-degradation ban, and the standing
 * no-silent-caps doctrine). An over-budget branch gets an explicit `rejected` attempt with the
 * `context_budget_exceeded` reason; continuing such a conversation is a product decision
 * (compaction is a §11 adapter capability of a later movement), not a loader guess.
 *
 * Sizing, stated so review can falsify it: every current provider context window is well under
 * 8 MiB of text, so 32 MiB of cumulative ciphertext (envelope ≈ plaintext + small constant) is
 * far above any request a provider could accept while bounding worst-case worker memory at
 * roughly budget × decrypt-concurrency. 512 turns bounds the per-dispatch row walk; 4096 items
 * bounds the per-dispatch KMS-decrypt count (streams persist many chunk rows per answer).
 */
export type DurableContextBudget = {
  maxTurns: number;
  maxItems: number;
  maxCiphertextBytes: number;
};
export const DEFAULT_CONTEXT_BUDGET: DurableContextBudget = {
  maxTurns: 512,
  maxItems: 4096,
  maxCiphertextBytes: 32 * 1024 * 1024,
};

/** The encrypted-content envelope exactly as it comes off the row. Never decrypted in Phase A. */
export type EncryptedContentRef = {
  ciphertext: Buffer;
  dek_wrapped: Buffer | null;
  kms_key_id: string;
  kms_key_version: number;
  status: string;
};

/** One context-eligible turn, still encrypted (Phase A output / Phase B input). */
export type ContextPlanEntry = {
  turnId: string;
  /** The provider recorded on the branch this turn EXECUTED under. A §17 cross-provider fork
   *  makes ancestor entries carry a DIFFERENT provider than the executing branch; the adapters
   *  refuse those with a precise reason (the portable projection is a later P0-D arc), never
   *  by tripping over the foreign request shape. */
  sourceProvider: string;
  /** The model recorded on the branch this turn EXECUTED under — the Anthropic model-switch
   *  rule needs the SOURCE model of every replayed assistant message. */
  sourceModel: string;
  /** The turn's single TURN-OWNED input item (LAW 2). */
  userContent: EncryptedContentRef;
  /** The eligible completed output, or null when this turn contributes no output. */
  output: {
    attemptId: string;
    /** §8 commit-4 provenance of the POST that produced this output — the credential-anchor
     *  reconciliation input (§11): provider continuation objects are account-scoped. */
    providerCredentialId: string | null;
    /** The attempt's durable `terminal_at`, epoch ms — the anchor-age input: a provider-stored
     *  response is retained for a bounded window, so a chaining strategy must know how old its
     *  candidate anchor is (review finding, exact head 20e7b67). */
    completedAtMs: number;
    kind: 'response' | 'stream';
    /** One `native_response` envelope, or the ordered `native_stream_chunk` envelopes. */
    contents: EncryptedContentRef[];
  } | null;
};

export type DurableContextPlan = { entries: ContextPlanEntry[] };

/** Raised when the durable context cannot be faithfully assembled. Payload-free by design:
 *  the reason class is enough to classify, and context plaintext must never enter an error. */
export class DurableContextUnbuildableError extends Error {
  readonly code = 'durable_context_unbuildable';
  constructor(readonly reason: string) {
    super(`durable context is unbuildable (${reason})`);
    this.name = 'DurableContextUnbuildableError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PHASE A — database reads (worker owner context; column-explicit for the 0032/0034/0036 grants)
// ─────────────────────────────────────────────────────────────────────────────────────────────

type BranchRow = {
  id: string;
  provider: string;
  model: string;
  parent_branch_id: string | null;
  forked_from_turn_id: string | null;
  forked_from_attempt_id: string | null;
  boundary_mode: string | null;
};

type TurnRow = {
  id: string;
  turn_seq: string;
  current_attempt_id: string | null;
};

type AttemptRow = {
  id: string;
  turn_id: string;
  state: string;
  context_excluded: boolean;
  provider_credential_id: string | null;
  terminal_at: Date | null;
};

type ItemRow = {
  turn_id: string;
  attempt_id: string | null;
  item_seq: number;
  item_type: string;
  ciphertext: Buffer;
  dek_wrapped: Buffer | null;
  kms_key_id: string;
  kms_key_version: number;
  content_status: string;
};

async function readBranch(
  tx: PoolClient,
  owner: ConversationWorkerOwner,
  conversationId: string,
  branchId: string,
): Promise<BranchRow | null> {
  const r = await tx.query<BranchRow>(
    `SELECT id, provider, model, parent_branch_id, forked_from_turn_id, forked_from_attempt_id,
            boundary_mode
       FROM govai.ai_conversation_branches
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid
        AND conversation_id = $3::uuid AND id = $4::uuid`,
    [owner.orgId, owner.ownerUserId, conversationId, branchId],
  );
  return r.rows[0] ?? null;
}

async function readTurnsBefore(
  tx: PoolClient,
  owner: ConversationWorkerOwner,
  conversationId: string,
  branchId: string,
  beforeTurnSeq: string,
  /** Fetch bound (review finding, exact head 20e7b67): the turn budget is enforced WHILE
   *  reading — the query can never return more than the caller's remaining budget + 1 rows,
   *  so an over-budget branch is detected from a BOUNDED fetch, never by materializing the
   *  whole history first. */
  limit: number,
): Promise<TurnRow[]> {
  const r = await tx.query<TurnRow>(
    `SELECT id, turn_seq::text AS turn_seq, current_attempt_id
       FROM govai.ai_conversation_turns
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid
        AND conversation_id = $3::uuid AND branch_id = $4::uuid
        AND turn_seq < $5::bigint
      ORDER BY turn_seq ASC
      LIMIT $6::integer`,
    [owner.orgId, owner.ownerUserId, conversationId, branchId, beforeTurnSeq, limit],
  );
  return r.rows;
}

async function readTurnById(
  tx: PoolClient,
  owner: ConversationWorkerOwner,
  conversationId: string,
  branchId: string,
  turnId: string,
): Promise<TurnRow | null> {
  const r = await tx.query<TurnRow>(
    `SELECT id, turn_seq::text AS turn_seq, current_attempt_id
       FROM govai.ai_conversation_turns
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid
        AND conversation_id = $3::uuid AND branch_id = $4::uuid AND id = $5::uuid`,
    [owner.orgId, owner.ownerUserId, conversationId, branchId, turnId],
  );
  return r.rows[0] ?? null;
}

async function readAttemptsByIds(
  tx: PoolClient,
  owner: ConversationWorkerOwner,
  conversationId: string,
  attemptIds: readonly string[],
): Promise<Map<string, AttemptRow>> {
  if (attemptIds.length === 0) return new Map();
  const r = await tx.query<AttemptRow>(
    `SELECT id, turn_id, state, context_excluded, provider_credential_id::text AS provider_credential_id,
            terminal_at
       FROM govai.ai_conversation_attempts
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid
        AND conversation_id = $3::uuid AND id = ANY($4::uuid[])`,
    [owner.orgId, owner.ownerUserId, conversationId, attemptIds as string[]],
  );
  return new Map(r.rows.map((row) => [row.id, row]));
}

/** The BUDGET pre-check: item count + cumulative ciphertext bytes for the exact row set the
 *  load below would fetch, computed server-side so no payload byte crosses the wire first. */
async function readContextAggregate(
  tx: PoolClient,
  owner: ConversationWorkerOwner,
  conversationId: string,
  turnIds: readonly string[],
  selectedAttemptIds: readonly string[],
): Promise<{ itemCount: number; ciphertextBytes: number }> {
  if (turnIds.length === 0) return { itemCount: 0, ciphertextBytes: 0 };
  const r = await tx.query<{ item_count: string; ciphertext_bytes: string }>(
    `SELECT count(*)::text AS item_count,
            COALESCE(sum(octet_length(c.ciphertext)), 0)::text AS ciphertext_bytes
       FROM govai.ai_conversation_items i
       JOIN govai.ai_conversation_content c
         ON  c.org_id          = i.org_id
         AND c.owner_user_id   = i.owner_user_id
         AND c.conversation_id = i.conversation_id
         AND c.id              = i.content_id
      WHERE i.org_id = $1::uuid AND i.owner_user_id = $2::uuid
        AND i.conversation_id = $3::uuid
        AND i.turn_id = ANY($4::uuid[])
        AND (i.attempt_id IS NULL OR i.attempt_id = ANY($5::uuid[]))`,
    [
      owner.orgId,
      owner.ownerUserId,
      conversationId,
      turnIds as string[],
      selectedAttemptIds as string[],
    ],
  );
  const row = r.rows[0]!;
  return { itemCount: Number(row.item_count), ciphertextBytes: Number(row.ciphertext_bytes) };
}

/** Items for the given turns, joined to their content envelopes: TURN-owned input for every
 *  turn, plus ATTEMPT-owned output for exactly the SELECTED attempt ids. */
async function readItemsWithContent(
  tx: PoolClient,
  owner: ConversationWorkerOwner,
  conversationId: string,
  turnIds: readonly string[],
  selectedAttemptIds: readonly string[],
): Promise<ItemRow[]> {
  if (turnIds.length === 0) return [];
  const r = await tx.query<ItemRow>(
    `SELECT i.turn_id, i.attempt_id, i.item_seq, i.item_type,
            c.ciphertext, c.dek_wrapped, c.kms_key_id, c.kms_key_version,
            c.status AS content_status
       FROM govai.ai_conversation_items i
       JOIN govai.ai_conversation_content c
         ON  c.org_id          = i.org_id
         AND c.owner_user_id   = i.owner_user_id
         AND c.conversation_id = i.conversation_id
         AND c.id              = i.content_id
      WHERE i.org_id = $1::uuid AND i.owner_user_id = $2::uuid
        AND i.conversation_id = $3::uuid
        AND i.turn_id = ANY($4::uuid[])
        AND (i.attempt_id IS NULL OR i.attempt_id = ANY($5::uuid[]))
      ORDER BY i.turn_id, i.attempt_id NULLS FIRST, i.item_seq ASC`,
    [
      owner.orgId,
      owner.ownerUserId,
      conversationId,
      turnIds as string[],
      selectedAttemptIds as string[],
    ],
  );
  return r.rows;
}

/** One context turn as selected by the walk, before item resolution. */
type SelectedTurn = {
  turn: TurnRow;
  branchProvider: string;
  branchModel: string;
  /** The attempt whose output MAY contribute (the turn's current attempt, or the fork pin). */
  selectedAttemptId: string | null;
  /** True on a fork-pin turn of an `after_attempt` edge: §7.5's exemption — the pinned
   *  attempt's completed output is eligible even if superseded/excluded on its own branch. */
  pinExempt: boolean;
};

/**
 * PHASE A — load everything the assembly needs, encrypted, in the CALLER's transaction.
 *
 * The caller (the executor's step-3 load transaction) samples the branch `causal_version`
 * BEFORE invoking this (version-first, §7.8): any eligibility-changing commit that lands after
 * the sample makes the eventual boundary CAS fail and the whole build re-run. Statement-level
 * READ COMMITTED reads inside this function can therefore only ever see NEWER eligibility than
 * the sampled version — which fails the CAS — never older.
 */
export async function loadDurableContextPlan(
  tx: PoolClient,
  owner: ConversationWorkerOwner,
  input: { conversationId: string; branchId: string; turnSeq: string },
  budget: DurableContextBudget = DEFAULT_CONTEXT_BUDGET,
): Promise<DurableContextPlan> {
  // ── Walk the fork ancestry root-ward, recording each branch's bound ─────────────────────
  type WalkFrame = {
    branch: BranchRow;
    /** Exclusive upper bound on this branch's ordinary turn range. */
    beforeTurnSeq: string;
    /** The `after_attempt` fork-pin contribution taken FROM this branch, if any. */
    pin: { turn: TurnRow; attemptId: string } | null;
  };
  const frames: WalkFrame[] = [];

  let branch = await readBranch(tx, owner, input.conversationId, input.branchId);
  if (!branch) throw new DurableContextUnbuildableError('branch_unreadable');
  let bound = input.turnSeq;
  let pin: WalkFrame['pin'] = null;

  // ★ THE ONLY LAWFUL EXIT IS PUSHING A ROOT FRAME (review finding, exact head 7daa362): an
  // exhausted loop whose last pushed frame still has a parent MUST refuse — the earlier
  // post-loop test (`frames.length === MAX && branch.parent_branch_id !== null`) passed when
  // the walk had just MOVED to an unrecorded root, silently omitting the root's turns from
  // context: exactly the truncated-history dispatch this cap exists to prevent.
  let rooted = false;
  for (let depth = 0; depth < MAX_BRANCH_DEPTH; depth += 1) {
    frames.push({ branch, beforeTurnSeq: bound, pin });
    if (branch.parent_branch_id === null) {
      rooted = true;
      break;
    }
    // A fork edge: resolve the source turn on the PARENT branch to bound the parent's range.
    if (branch.forked_from_turn_id === null || branch.forked_from_attempt_id === null) {
      // 0031's fork-shape CHECK makes this unrepresentable; fail closed rather than guess.
      throw new DurableContextUnbuildableError('fork_shape_invalid');
    }
    const parent = await readBranch(tx, owner, input.conversationId, branch.parent_branch_id);
    if (!parent) throw new DurableContextUnbuildableError('branch_unreadable');
    const forkTurn = await readTurnById(
      tx,
      owner,
      input.conversationId,
      parent.id,
      branch.forked_from_turn_id,
    );
    if (!forkTurn) throw new DurableContextUnbuildableError('fork_source_unreadable');
    pin =
      branch.boundary_mode === 'after_attempt'
        ? { turn: forkTurn, attemptId: branch.forked_from_attempt_id }
        : null; // `before_attempt_output`: the child's minted first turn carries the input copy.
    bound = forkTurn.turn_seq;
    branch = parent;
  }
  if (!rooted) throw new DurableContextUnbuildableError('branch_depth_exceeded');

  // ── Emit selected turns OLDEST → NEWEST: root branch first, executing branch last ───────
  const selected: SelectedTurn[] = [];
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i]!;
    // Remaining turn budget + 1: one extra row is enough to PROVE the branch is over budget
    // without fetching it all; the throw below fires before any attempt row is read.
    const remaining = budget.maxTurns + 1 - selected.length;
    const turns = await readTurnsBefore(
      tx,
      owner,
      input.conversationId,
      frame.branch.id,
      frame.beforeTurnSeq,
      remaining,
    );
    if (selected.length + turns.length > budget.maxTurns) {
      throw new DurableContextUnbuildableError('context_budget_exceeded');
    }
    for (const turn of turns) {
      selected.push({
        turn,
        branchProvider: frame.branch.provider,
        branchModel: frame.branch.model,
        selectedAttemptId: turn.current_attempt_id,
        pinExempt: false,
      });
    }
    if (frame.pin) {
      selected.push({
        turn: frame.pin.turn,
        branchProvider: frame.branch.provider,
        branchModel: frame.branch.model,
        selectedAttemptId: frame.pin.attemptId,
        pinExempt: true,
      });
    }
    // Pins count against the same budget: the invariant leaving every frame is
    // selected.length <= maxTurns, which also keeps the next frame's fetch bound >= 1.
    if (selected.length > budget.maxTurns) {
      throw new DurableContextUnbuildableError('context_budget_exceeded');
    }
  }
  if (selected.length === 0) return { entries: [] };

  // ── Resolve eligibility of every selected attempt, then load items + envelopes ──────────
  const attemptIds = selected
    .map((s) => s.selectedAttemptId)
    .filter((id): id is string => id !== null);
  const attempts = await readAttemptsByIds(tx, owner, input.conversationId, attemptIds);

  const eligibleAttemptIds: string[] = [];
  const eligibility = new Map<string, AttemptRow>();
  for (const s of selected) {
    if (s.selectedAttemptId === null) {
      // A reserved turn is never attempt-less (§7.1b, deferred-FK enforced). Unproven is
      // treated as unbuildable, never silently skipped.
      throw new DurableContextUnbuildableError('turn_without_current_attempt');
    }
    const attempt = attempts.get(s.selectedAttemptId);
    if (!attempt || attempt.turn_id !== s.turn.id) {
      throw new DurableContextUnbuildableError('selected_attempt_unreadable');
    }
    const excluded = s.pinExempt ? false : attempt.context_excluded;
    if (attempt.state === 'completed' && !excluded) {
      eligibleAttemptIds.push(attempt.id);
      eligibility.set(attempt.id, attempt);
    }
  }

  const aggregate = await readContextAggregate(
    tx,
    owner,
    input.conversationId,
    selected.map((s) => s.turn.id),
    eligibleAttemptIds,
  );
  if (
    aggregate.itemCount > budget.maxItems ||
    aggregate.ciphertextBytes > budget.maxCiphertextBytes
  ) {
    throw new DurableContextUnbuildableError('context_budget_exceeded');
  }

  const items = await readItemsWithContent(
    tx,
    owner,
    input.conversationId,
    selected.map((s) => s.turn.id),
    eligibleAttemptIds,
  );

  // ── Assemble the plan entries in walk order ─────────────────────────────────────────────
  const entries: ContextPlanEntry[] = [];
  for (const s of selected) {
    const turnOwned = items.filter((i) => i.turn_id === s.turn.id && i.attempt_id === null);
    // P0-C's reservation writes EXACTLY one turn-owned input item (the provider-native request);
    // the 0033 fork copy preserves that shape. Anything else is a storage state this movement
    // cannot faithfully replay — fail closed rather than guess which item is "the" input.
    if (turnOwned.length !== 1) {
      throw new DurableContextUnbuildableError('turn_input_shape_unsupported');
    }
    const userContent = toRef(turnOwned[0]!);

    let output: ContextPlanEntry['output'] = null;
    const attempt =
      s.selectedAttemptId !== null ? eligibility.get(s.selectedAttemptId) : undefined;
    if (attempt) {
      const outputItems = items.filter(
        (i) => i.turn_id === s.turn.id && i.attempt_id === attempt.id,
      );
      if (outputItems.length === 0) {
        // A completed attempt persists its output before the fenced finalize; zero rows means
        // durable state this replay cannot trust.
        throw new DurableContextUnbuildableError('completed_output_missing');
      }
      const types = new Set(outputItems.map((i) => i.item_type));
      if (attempt.terminal_at === null) {
        // A completed attempt always carries its ratchet stamp (0031 CHECK); its absence is
        // durable state this replay cannot trust.
        throw new DurableContextUnbuildableError('completed_terminal_stamp_missing');
      }
      const completedAtMs = attempt.terminal_at.getTime();
      if (types.size === 1 && types.has('native_response') && outputItems.length === 1) {
        output = {
          attemptId: attempt.id,
          providerCredentialId: attempt.provider_credential_id,
          completedAtMs,
          kind: 'response',
          contents: [toRef(outputItems[0]!)],
        };
      } else if (types.size === 1 && types.has('native_stream_chunk')) {
        output = {
          attemptId: attempt.id,
          providerCredentialId: attempt.provider_credential_id,
          completedAtMs,
          kind: 'stream',
          contents: outputItems.map(toRef),
        };
      } else {
        throw new DurableContextUnbuildableError('output_item_shape_unsupported');
      }
    }
    entries.push({
      turnId: s.turn.id,
      sourceProvider: s.branchProvider,
      sourceModel: s.branchModel,
      userContent,
      output,
    });
  }
  return { entries };
}

function toRef(item: ItemRow): EncryptedContentRef {
  return {
    ciphertext: item.ciphertext,
    dek_wrapped: item.dek_wrapped,
    kms_key_id: item.kms_key_id,
    kms_key_version: item.kms_key_version,
    status: item.content_status,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PHASE B — KMS decryption + provider-native parsing. NO database client, by signature.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** One decrypted, provider-native context entry (Phase B output / adapter input). */
export type AssembledContextEntry = {
  turnId: string;
  sourceProvider: string;
  sourceModel: string;
  /** The turn's immutable provider-native request, parsed. */
  userNative: unknown;
  assistant: {
    attemptId: string;
    providerCredentialId: string | null;
    /** Epoch ms of the attempt's durable terminal stamp — the anchor-age input. */
    completedAtMs: number;
    output:
      | { kind: 'response'; body: unknown }
      | { kind: 'stream'; sseText: string };
  } | null;
};

/**
 * Bounded concurrent map preserving input order — the turn-service pattern, restated here
 * because the two phases must not share a module (request plane vs worker plane).
 */
const CONTEXT_KMS_DECRYPT_CONCURRENCY = 8;

async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  let firstFailure: unknown = null;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (failed) return;
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        out[index] = await fn(items[index]!);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstFailure = err;
        }
        return;
      }
    }
  });
  await Promise.all(workers);
  if (failed) throw firstFailure;
  return out;
}

async function decryptRef(
  kms: Kms,
  orgId: string,
  ref: EncryptedContentRef,
): Promise<Buffer> {
  if (ref.status !== 'active' || ref.dek_wrapped === null) {
    throw new DurableContextUnbuildableError('context_content_unreadable');
  }
  try {
    return await decryptConversationContent(kms, orgId, {
      ciphertext: ref.ciphertext,
      dek_wrapped: ref.dek_wrapped,
      kms_key_id: ref.kms_key_id,
      kms_key_version: ref.kms_key_version,
    });
  } catch {
    // Never chain: a KMS error can carry key identifiers.
    throw new DurableContextUnbuildableError('context_content_unreadable');
  }
}

function decodeUtf8Strict(bytes: Buffer, reason: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new DurableContextUnbuildableError(reason);
  }
}

function parseJson(text: string, reason: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new DurableContextUnbuildableError(reason);
  }
}

/**
 * PHASE B — decrypt the plan into provider-native entries. Stream chunks are concatenated in
 * `item_seq` order, reproducing the provider's byte stream (the P0-C fidelity invariant this
 * module consumes rather than re-proves).
 *
 * ★ ONE SHARED LIMITER (review finding, exact head 20e7b67): a nested per-entry limiter
 * MULTIPLIES — 8 concurrent entries each running an 8-way chunk decrypt would admit 64
 * concurrent KMS calls, bursting a remote KMS far beyond the declared bound. Every decrypt
 * this assembly performs — user content and output chunks alike — is therefore flattened into
 * ONE task list bounded by a single limiter: the per-dispatch KMS concurrency is
 * `CONTEXT_KMS_DECRYPT_CONCURRENCY`, full stop. Parsing/decoding happens after the decrypts
 * settle and is CPU-only.
 */
export async function assembleDurableContext(
  kms: Kms,
  orgId: string,
  plan: DurableContextPlan,
): Promise<AssembledContextEntry[]> {
  const refs: EncryptedContentRef[] = [];
  const userTaskIndex: number[] = [];
  const outputTaskIndexes: number[][] = [];
  for (const entry of plan.entries) {
    userTaskIndex.push(refs.length);
    refs.push(entry.userContent);
    const parts: number[] = [];
    if (entry.output) {
      for (const ref of entry.output.contents) {
        parts.push(refs.length);
        refs.push(ref);
      }
    }
    outputTaskIndexes.push(parts);
  }

  const decrypted = await mapBounded(refs, CONTEXT_KMS_DECRYPT_CONCURRENCY, (ref) =>
    decryptRef(kms, orgId, ref),
  );

  return plan.entries.map((entry, i) => {
    const userNative = parseJson(
      decodeUtf8Strict(decrypted[userTaskIndex[i]!]!, 'context_input_not_utf8'),
      'context_input_not_json',
    );

    let assistant: AssembledContextEntry['assistant'] = null;
    if (entry.output) {
      const parts = outputTaskIndexes[i]!.map((t) => decrypted[t]!);
      if (entry.output.kind === 'response') {
        assistant = {
          attemptId: entry.output.attemptId,
          providerCredentialId: entry.output.providerCredentialId,
          completedAtMs: entry.output.completedAtMs,
          output: {
            kind: 'response',
            body: parseJson(
              decodeUtf8Strict(parts[0]!, 'context_output_not_utf8'),
              'context_output_not_json',
            ),
          },
        };
      } else {
        assistant = {
          attemptId: entry.output.attemptId,
          providerCredentialId: entry.output.providerCredentialId,
          completedAtMs: entry.output.completedAtMs,
          output: {
            kind: 'stream',
            sseText: decodeUtf8Strict(Buffer.concat(parts), 'context_output_not_utf8'),
          },
        };
      }
    }
    return {
      turnId: entry.turnId,
      sourceProvider: entry.sourceProvider,
      sourceModel: entry.sourceModel,
      userNative,
      assistant,
    };
  });
}
