// Durable send + hydrate service (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C; spec §8/§9/§10/§13).
//
// Owns the reservation transaction boundary, its LAW 16 lock choreography and its LAW 10
// lifecycle serialization. The route above does HTTP; `turn-store.ts` below does SQL.
//
// ★ THE ONE THING THIS FILE GUARANTEES. A Send becomes DURABLE — turn row, immutable user
// input, immutable native request config, attempt 1, `current_attempt_id` — and COMMITS, before
// any provider work is possible. Nothing here opens a socket, resolves a provider credential,
// mints a claim, or dispatches. The reservation hands the turn to the detached executor by
// COMMITTING it, and by nothing else.
//
// ★ NO PROVIDER I/O AND NO NETWORK INSIDE THE TRANSACTION. The only awaits inside the
// reservation transaction are database round trips and KMS envelope operations on the LOCAL
// adapter path — the same placement `service.ts` already uses for title encryption, and the same
// reason: the encryption happens BEFORE the transaction opens (see `prepareSend`), so the
// transaction body performs no KMS call at all. Provider dispatch is the worker's, and it holds
// no database client while it runs.

import type { PoolClient } from 'pg';
import type { Kms } from '@govai/core-identity';
import {
  ConversationNotFoundError,
  BranchNotFoundError,
  TurnNotFoundError,
  SendIdempotencyConflictError,
  SendIdempotencyLoserSignal,
  ConversationSurfaceUnsupportedError,
} from './errors.js';
import {
  decryptConversationContent,
  encryptConversationContent,
  ConversationContentUnreadableError,
} from './crypto.js';
import { resolveDispatchPlan } from './dispatch-registry.js';
import { buildSendIntent, nativeRequestBytes, sendIntentHash } from './send-intent.js';
import { acquireBranchExecutionAuthority, lockConversationRoot } from './locks.js';
import {
  isAddressable,
  isExecutionEligible,
  withConversationOwnerContext,
  type ConversationServiceDeps,
  type OwnerScope,
} from './service.js';
import * as store from './store.js';
import * as turnStore from './turn-store.js';
import {
  type ConversationAttemptProjection,
  type ConversationItemProjection,
  type ConversationItemType,
  type ConversationTurnPage,
  type ConversationTurnProjection,
  type AttemptState,
  type ListTurnsInput,
  type SendTurnInput,
  type SendTurnResult,
  NATIVE_REQUEST_MAX_BYTES,
} from './turn-contracts.js';

/** The single turn-owned input item every reservation writes (§3: TURN OWNS INPUT). */
const INPUT_ITEM_SEQ = 1;
const INPUT_ITEM_TYPE: ConversationItemType = 'native_request';

/** Raised when the client's native request exceeds the bounded size. */
export class NativeRequestTooLargeError extends Error {
  readonly code = 'native_request_too_large';
  constructor() {
    super('native_request exceeds the maximum accepted size');
    this.name = 'NativeRequestTooLargeError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Send
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Durable send reservation — §9 step 1, the FIRST of the §8 five commits.
 *
 * Transaction shape (LAW 16 order, top to bottom, never re-entered upward):
 *   (1) conversation ROOT lifecycle authority   `lockConversationRoot` (FOR UPDATE)
 *       → revalidate `status` UNDER the lock (LAW 10: check and write in one lock)
 *   (2) BRANCH execution authority              `acquireBranchExecutionAuthority` (advisory)
 *       → resolve the branch FIRST: the advisory key derives from a CLIENT-SUPPLIED uuid, and
 *         locking an unvalidated id would let a caller take the authority of a branch it cannot
 *         even read
 *   (3) turn/attempt row mutation               allocate `turn_seq`, insert content, insert
 *                                               turn+attempt+pointer, insert the input item
 *
 * ★ WHY THE SURFACE CHECK IS HERE AND NOT ONLY IN THE EXECUTOR. A reservation is a PROMISE that
 * the server will execute this turn. Reserving a turn on a surface no executor can drive would
 * durably enqueue work that can never terminate — and because the branch queue blocks on
 * non-terminal turns (§8), it would block every later turn on that branch forever. Failing
 * before the reservation writes nothing and tells the client the truth immediately.
 *
 * ★ WHY NO PROVIDER CALL CAN PRECEDE THE COMMIT. There is no provider client in this module's
 * import graph at all. The executor discovers this turn only by reading COMMITTED rows.
 */
export async function sendTurn(
  deps: ConversationServiceDeps,
  scope: OwnerScope,
  conversationId: string,
  input: SendTurnInput,
): Promise<SendTurnResult> {
  // ★ OUTSIDE THE TRANSACTION, ON PURPOSE (see `prepareSend`): envelope encryption may be a
  // remote KMS round trip, and holding the conversation root lock across it would serialize the
  // whole conversation behind KMS latency.
  const prepared = await prepareSend(deps.kms, scope.orgId, input);

  const client = await deps.pool.connect();
  try {
    try {
      const created = await withConversationOwnerContext(client, scope, async (c) => {
        // ── LAW 16 (1): conversation root lifecycle authority ────────────────────────────
        const root = await lockConversationRoot(c, conversationId);
        // Unreachable-then-ineligible, in that order: a root this caller cannot address is a
        // 404 (the IDOR contract), and a root that is not EXECUTION-ELIGIBLE (§7.7) may create
        // no descendant.
        if (!root || !isAddressable(root.status)) throw new ConversationNotFoundError();
        if (!isExecutionEligible(root.status)) throw new ConversationNotFoundError();

        // Resolve the branch BEFORE taking its authority (see the doc comment above).
        const branch = await store.getBranchInConversation(c, conversationId, input.branch_id);
        if (!branch) throw new BranchNotFoundError();

        // The conversation root owns the immutable execution MODE (§3); the BRANCH owns the
        // executing provider/surface/model. Both are read from durable state, which is exactly
        // what a post-reload detached dispatch will read.
        const mode = await readConversationMode(c, conversationId);
        const resolution = resolveDispatchPlan({
          provider: branch.provider,
          surface: branch.surface,
          mode,
        });
        if (!resolution.supported) {
          throw new ConversationSurfaceUnsupportedError(
            branch.provider,
            branch.surface,
            resolution.reason,
          );
        }

        // ── LAW 16 (2): branch execution authority ───────────────────────────────────────
        // Held for the remainder of the transaction. It is what makes `MAX(turn_seq) + 1`
        // correct, and it is the SAME primitive the executor's dispatch boundary takes.
        await acquireBranchExecutionAuthority(c, branch.id);

        // ── LAW 16 (3): turn/attempt mutation ────────────────────────────────────────────
        const turnSeq = await turnStore.nextTurnSeq(c, scope, conversationId, branch.id);

        const contentId = await turnStore.insertContent(
          c,
          scope,
          conversationId,
          prepared.encryptedConfig,
        );
        const minted = await turnStore.insertReservedTurnWithInitialAttempt(c, scope, {
          conversationId,
          branchId: branch.id,
          clientTurnId: input.client_turn_id,
          turnSeq,
          nativeRequestConfigContentId: contentId,
        });
        // Lost the reservation race: roll the WHOLE candidate back (including the content row
        // just written) and answer from the COMMITTED turn. The 0030/0033 loser shape.
        if (!minted) throw new SendIdempotencyLoserSignal();

        // TURN-owned input item (LAW 2): `attempt_id IS NULL`, so it survives every future
        // retry. It shares the config's content row — the user's input IS the provider-native
        // request in this contract, and storing a second copy would create two sources of truth
        // for the same bytes.
        await store.insertTurnOwnedItem(c, scope, {
          conversationId,
          branchId: branch.id,
          turnId: minted.turnId,
          itemSeq: INPUT_ITEM_SEQ,
          itemType: INPUT_ITEM_TYPE,
          contentId,
        });

        // ★ RETURN IDS, NOT A PROJECTION. Building the response here would decrypt INSIDE this
        // transaction — while it holds the conversation root `FOR UPDATE` and the branch
        // advisory lock — and `decryptConversationContent` is a KMS call that is REMOTE on the
        // AWS adapter. Every successful Send would then hold both locks across a network round
        // trip, so KMS latency (or an outage) would block every other operation on that
        // conversation. It is the same invariant `prepareSend` exists to honour on the write
        // side, and it has to hold on the read side too.
        return minted.turnId;
      });
      // COMMITTED. The projection now runs in its own short read transaction, holding nothing.
      const turn = await readTurnAfterCommit(client, deps.kms, scope, conversationId, created);
      return { turn, replay: false };
    } catch (err) {
      if (err instanceof SendIdempotencyLoserSignal) {
        return await resolveCommittedSend(client, deps.kms, scope, conversationId, input);
      }
      throw err;
    }
  } finally {
    client.release();
  }
}

/**
 * Everything the reservation needs that is NOT a database operation — done BEFORE the
 * transaction opens.
 *
 * ★ THIS PLACEMENT IS THE "no network I/O inside a transaction" INVARIANT, applied to KMS.
 * Envelope encryption is an adapter call that MAY be remote (the AWS KMS adapter is real in
 * this repository). Performing it inside the reservation transaction would hold the conversation
 * ROOT LOCK across a network round trip, serializing every other operation on that conversation
 * behind KMS latency. Preparing first means the transaction body issues database statements
 * only.
 */
async function prepareSend(
  kms: Kms,
  orgId: string,
  input: SendTurnInput,
): Promise<{ encryptedConfig: turnStore.ContentInsert }> {
  const bytes = nativeRequestBytes(input.native_request);
  // Bounded BEFORE encryption: an oversized body must not be handed to the KMS at all.
  if (bytes.byteLength > NATIVE_REQUEST_MAX_BYTES) throw new NativeRequestTooLargeError();
  const enc = await encryptConversationContent(kms, orgId, bytes);
  return {
    encryptedConfig: {
      ciphertext: enc.ciphertext,
      dekWrapped: enc.dekWrapped,
      kmsKeyId: enc.kmsKeyId,
      kmsKeyVersion: enc.kmsKeyVersion,
      contentHmac: enc.contentHmac,
    },
  };
}

/**
 * Answer a DUPLICATE send from the COMMITTED turn — §8: "a duplicate is a read, never a verdict".
 *
 * ★ HOW DIVERGENT INTENT IS DETECTED WITHOUT A SECOND ARBITER. The committed turn already holds
 * everything the intent is made of: its `branch_id`, and its immutable native request config.
 * Re-deriving the canonical intent from THOSE durable bytes and comparing against the incoming
 * request's is strictly stronger than comparing against a stored hash — a stored hash can drift
 * from the bytes it claims to describe, whereas this comparison is against the bytes that will
 * actually be POSTed.
 *
 * ★ AN UNREADABLE STORED CONFIG FAILS CLOSED (409), NOT OPEN. If the config row can no longer be
 * decrypted (LAW 12 crypto-shred, or a key fault), divergence can be neither proven nor
 * disproven. Replaying would risk telling a client "this is your send" about a request that is
 * not theirs; conflicting mints nothing and dispatches nothing, which is the safe direction and
 * exactly what §12 prescribes for the conflict case. Nothing in P0-C shreds a live turn's
 * config, so this is a guard, not a routine path.
 */
async function resolveCommittedSend(
  client: PoolClient,
  kms: Kms,
  scope: OwnerScope,
  conversationId: string,
  input: SendTurnInput,
): Promise<SendTurnResult> {
  // ── PHASE 1 (transaction): resolve the committed turn and READ its config envelope ────────
  // No decryption here — see the KMS note in `sendTurn`. This transaction holds no locks, but
  // keeping every KMS call outside a transaction is the invariant, not a case-by-case judgement.
  const committed = await withConversationOwnerContext(client, scope, async (c) => {
    const row = await turnStore.findTurnByClientTurnId(
      c,
      scope,
      conversationId,
      input.client_turn_id,
    );
    if (!row) {
      // The reservation was lost to a contender that then rolled back. Nothing is committed
      // under this key, so this is not a replay and not a conflict — it is a transient loss the
      // client may simply retry.
      throw new SendIdempotencyLoserSignal();
    }
    const stored = await turnStore.getContentById(
      c,
      scope,
      conversationId,
      row.native_request_config_content_id,
    );
    return { turnId: row.id, branchId: row.branch_id, stored };
  });
  if (!committed.stored) throw new SendIdempotencyConflictError();

  // ── PHASE 2 (no transaction): decrypt and compare the canonical intents ───────────────────
  let committedNativeRequest: unknown;
  try {
    const plaintext = await decryptConversationContent(kms, scope.orgId, committed.stored);
    committedNativeRequest = JSON.parse(plaintext.toString('utf8'));
  } catch (err) {
    // Unreadable (crypto-shred or a key fault) or unparseable ⇒ divergence can be neither proven
    // nor disproven ⇒ fail CLOSED.
    if (err instanceof ConversationContentUnreadableError || err instanceof SyntaxError) {
      throw new SendIdempotencyConflictError();
    }
    throw err;
  }
  const committedHash = sendIntentHash(
    buildSendIntent({
      conversationId,
      branchId: committed.branchId,
      nativeRequest: committedNativeRequest,
    }),
  );
  const incomingHash = sendIntentHash(
    buildSendIntent({
      conversationId,
      branchId: input.branch_id,
      nativeRequest: input.native_request,
    }),
  );
  if (!committedHash.equals(incomingHash)) throw new SendIdempotencyConflictError();

  // ── PHASE 3 (transaction): project the turn's CURRENT durable state ───────────────────────
  // Not a cached copy of the original response — the live truth, so a duplicate arriving while
  // the turn is streaming reports `streaming`, and one arriving after completion reports the
  // answer.
  return {
    turn: await readTurnAfterCommit(client, kms, scope, conversationId, committed.turnId),
    replay: true,
  };
}

/**
 * Build a turn projection in its OWN short read transaction, holding no lock.
 *
 * ★ WHY THIS IS A SEPARATE PHASE EVERYWHERE IT IS USED. `projectItem` decrypts, and on the AWS
 * KMS adapter that is remote network I/O. Building the response inside the reservation
 * transaction would hold the conversation root `FOR UPDATE` and the branch advisory lock across
 * that round trip, so KMS latency — or a KMS outage — would block every other operation on the
 * conversation. The write side already honours this (`prepareSend` encrypts before the
 * transaction opens); this is the same invariant on the read side.
 */
async function readTurnAfterCommit(
  client: PoolClient,
  kms: Kms,
  scope: OwnerScope,
  conversationId: string,
  turnId: string,
): Promise<ConversationTurnProjection> {
  return withConversationOwnerContext(client, scope, (c) =>
    projectOneTurn(c, kms, scope, conversationId, turnId),
  );
}


async function readConversationMode(
  c: PoolClient,
  conversationId: string,
): Promise<'governed' | 'passthrough'> {
  const r = await c.query<{ mode: 'governed' | 'passthrough' }>(
    `SELECT mode FROM govai.ai_conversations WHERE id = $1::uuid`,
    [conversationId],
  );
  const row = r.rows[0];
  // Unreachable in practice: the caller already locked and validated this row in the same
  // transaction. Failing loudly beats returning a guessed lane.
  if (!row) throw new ConversationNotFoundError();
  return row.mode;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Hydrate
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * §10's reload contract: the durable user turn, the current attempt state, and whatever output
 * has been persisted — readable by ANY later authenticated request of the owner, from ANY
 * process, with no dependence on the connection that created the send.
 */
export async function listTurns(
  deps: ConversationServiceDeps,
  scope: OwnerScope,
  conversationId: string,
  query: ListTurnsInput,
): Promise<ConversationTurnPage> {
  const client = await deps.pool.connect();
  try {
    return await withConversationOwnerContext(client, scope, async (c) => {
      const root = await store.getConversation(c, conversationId);
      if (!root) throw new ConversationNotFoundError();

      const branchId = await resolveBranchForRead(c, scope, conversationId, query.branch_id);
      const turnRows = await turnStore.listBranchTurns(c, scope, {
        conversationId,
        branchId,
        limit: query.limit,
        afterTurnSeq: query.after_turn_seq ?? null,
      });
      const turns = await projectTurns(c, deps.kms, scope, conversationId, turnRows);
      return {
        turns,
        // The keyset advances only on a FULL page: a short page means the branch is exhausted,
        // and handing back a cursor there would invite an endless empty-page poll.
        next_after_turn_seq:
          turnRows.length === query.limit ? (turnRows[turnRows.length - 1]!.turn_seq ?? null) : null,
      };
    });
  } finally {
    client.release();
  }
}

export async function getTurn(
  deps: ConversationServiceDeps,
  scope: OwnerScope,
  conversationId: string,
  turnId: string,
): Promise<ConversationTurnProjection> {
  const client = await deps.pool.connect();
  try {
    return await withConversationOwnerContext(client, scope, async (c) => {
      const root = await store.getConversation(c, conversationId);
      if (!root) throw new ConversationNotFoundError();
      const turn = await turnStore.getTurnById(c, scope, conversationId, turnId);
      if (!turn) throw new TurnNotFoundError();
      return projectOneTurn(c, deps.kms, scope, conversationId, turn.id);
    });
  } finally {
    client.release();
  }
}

/** Default the read to the conversation's ROOT branch — the only branch a client that has never
 *  forked can have. A named branch is validated against THIS conversation, so a branch id from
 *  another conversation is a 404, never a cross-conversation read. */
async function resolveBranchForRead(
  c: PoolClient,
  scope: OwnerScope,
  conversationId: string,
  requested: string | undefined,
): Promise<string> {
  if (requested === undefined) {
    const rootBranch = await store.getRootBranch(c, conversationId);
    if (!rootBranch) throw new ConversationNotFoundError();
    return rootBranch.id;
  }
  const branch = await store.getBranchInConversation(c, conversationId, requested);
  if (!branch) throw new BranchNotFoundError();
  return branch.id;
}

async function projectOneTurn(
  c: PoolClient,
  kms: Kms,
  scope: OwnerScope,
  conversationId: string,
  turnId: string,
): Promise<ConversationTurnProjection> {
  const turn = await turnStore.getTurnById(c, scope, conversationId, turnId);
  if (!turn) throw new TurnNotFoundError();
  const projected = await projectTurns(c, kms, scope, conversationId, [turn]);
  return projected[0]!;
}

/**
 * Build the owner-visible projection for a page of turns.
 *
 * Two queries for the whole page (attempts, items+content) rather than per-turn reads, then a
 * decrypt per item. Decryption is the bounded cost the page cap exists to bound.
 */
async function projectTurns(
  c: PoolClient,
  kms: Kms,
  scope: OwnerScope,
  conversationId: string,
  turnRows: readonly turnStore.TurnRow[],
): Promise<ConversationTurnProjection[]> {
  if (turnRows.length === 0) return [];
  const turnIds = turnRows.map((t) => t.id);
  const [attemptRows, itemRows] = await Promise.all([
    turnStore.listAttemptsForTurns(c, scope, conversationId, turnIds),
    turnStore.listItemsForTurns(c, scope, conversationId, turnIds),
  ]);

  const items = await Promise.all(
    itemRows.map(async (row) => ({
      turnId: row.turn_id,
      attemptId: row.attempt_id,
      item: await projectItem(kms, scope.orgId, row),
    })),
  );

  return turnRows.map((turn) => {
    const attempts: ConversationAttemptProjection[] = attemptRows
      .filter((a) => a.turn_id === turn.id)
      .map((a) => ({
        id: a.id,
        attempt_seq: a.attempt_seq,
        state: a.state as AttemptState,
        is_current: turn.current_attempt_id === a.id,
        error_class: a.error_class,
        context_excluded: a.context_excluded,
        govai_request_id: a.govai_request_id,
        created_at: a.created_at.toISOString(),
        terminal_at: a.terminal_at === null ? null : a.terminal_at.toISOString(),
        output_items: items
          .filter((i) => i.turnId === turn.id && i.attemptId === a.id)
          .map((i) => i.item),
      }));
    return {
      id: turn.id,
      branch_id: turn.branch_id,
      client_turn_id: turn.client_turn_id,
      turn_seq: turn.turn_seq,
      created_at: turn.created_at.toISOString(),
      // §7.1b makes this non-null for every reserved turn; the schema keeps the column nullable
      // only to permit the deferred-FK mint. A null here would be a torn reservation, which the
      // deferred constraint makes unrepresentable at COMMIT.
      current_attempt_id: turn.current_attempt_id!,
      input_items: items
        .filter((i) => i.turnId === turn.id && i.attemptId === null)
        .map((i) => i.item),
      attempts,
    };
  });
}

async function projectItem(
  kms: Kms,
  orgId: string,
  row: turnStore.ItemWithContentRow,
): Promise<ConversationItemProjection> {
  const base = {
    item_seq: row.item_seq,
    item_type: row.item_type as ConversationItemType,
  };
  if (row.content_status !== 'active' || row.dek_wrapped === null) {
    // Honest rather than absent: the item DID exist and its position matters to ordering.
    return { ...base, native: null, text: null, content_unreadable: true };
  }
  const plaintext = await decryptConversationContent(kms, orgId, {
    ciphertext: row.ciphertext,
    dek_wrapped: row.dek_wrapped,
    kms_key_id: row.kms_key_id,
    kms_key_version: row.kms_key_version,
  });
  const text = plaintext.toString('utf8');
  // A stream chunk is provider SSE framing — text, not a JSON document. Parsing is attempted only
  // where a document is expected, so a chunk is never silently reshaped into `native`.
  if (row.item_type === 'native_stream_chunk') {
    return { ...base, native: null, text, content_unreadable: false };
  }
  // ★ A NON-JSON RESPONSE MUST STILL HYDRATE. The executor persists a provider response VERBATIM
  // whatever its status, so the stored bytes are not guaranteed to be a JSON document: an
  // upstream proxy can return HTML, and an error path can return an empty or truncated body.
  // Parsing unconditionally made every later hydrate of that turn — and of any PAGE containing
  // it — throw a 500, permanently, for an attempt that was durably finalized. The fallback is
  // LOSSLESS: the exact bytes are returned as `text` rather than discarded or replaced.
  try {
    return { ...base, native: JSON.parse(text), text: null, content_unreadable: false };
  } catch {
    return { ...base, native: null, text, content_unreadable: false };
  }
}
