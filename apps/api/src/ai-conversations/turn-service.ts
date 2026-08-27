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

import type { Pool, PoolClient } from 'pg';
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

/**
 * Run ONE owner-scoped transaction on a client checked out for exactly that long.
 *
 * ★ THE RELEASE IS THE POINT, NOT JUST THE COMMIT. An earlier revision committed the reservation
 * and then decrypted for the response — outside the transaction, but still on the SAME checked-out
 * client. Releasing row locks while holding a pool connection across remote KMS latency still
 * blocks every other request needing that connection, and on an outage it exhausts the pool.
 * Binding the checkout to the transaction makes "no KMS while holding a DB client" structural
 * rather than a rule each call site has to remember.
 */
async function withPooledOwnerContext<T>(
  pool: Pool,
  scope: OwnerScope,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await withConversationOwnerContext(client, scope, fn);
  } finally {
    client.release();
  }
}

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

  let createdTurnId: string;
  try {
    createdTurnId = await withPooledOwnerContext(deps.pool, scope, async (c) => {
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
  } catch (err) {
    if (err instanceof SendIdempotencyLoserSignal) {
      return await resolveCommittedSend(deps, scope, conversationId, input);
    }
    throw err;
  }
  // COMMITTED, and the reservation's client is RELEASED. The response is built by the two-phase
  // read below, which never holds a client across KMS.
  return { turn: await readAndProjectTurn(deps, scope, conversationId, createdTurnId), replay: false };
}

/**
 * The TWO-PHASE turn read, used by every surface that returns a turn.
 *
 *   PHASE A — one short owner transaction: structural rows + encrypted envelopes. COMMIT, RELEASE.
 *   PHASE B — no client, no transaction: KMS decrypt and projection.
 *
 * ★ WHY IT IS ONE FUNCTION RATHER THAN A CONVENTION. Send, replay, list and get all need this
 * shape; four hand-written copies is four chances for the next edit to slide a decrypt back
 * inside a transaction. Here the phases cannot be interleaved, because Phase B does not receive
 * a client at all.
 */
async function readAndProjectTurn(
  deps: ConversationServiceDeps,
  scope: OwnerScope,
  conversationId: string,
  turnId: string,
): Promise<ConversationTurnProjection> {
  const bundle = await withPooledOwnerContext(deps.pool, scope, (c) =>
    readTurnBundleById(c, scope, conversationId, turnId),
  );
  const projected = await projectTurnBundle(deps.kms, scope.orgId, bundle);
  return projected[0]!;
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
  deps: ConversationServiceDeps,
  scope: OwnerScope,
  conversationId: string,
  input: SendTurnInput,
): Promise<SendTurnResult> {
  // ── PHASE 1 (transaction, client released on exit): resolve the turn, READ its envelope ───
  // No decryption here. This transaction holds no row locks, but keeping every KMS call outside
  // a DB checkout is the invariant, not a case-by-case judgement.
  const committed = await withPooledOwnerContext(deps.pool, scope, async (c) => {
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

  // ── PHASE 2 (NO transaction, NO client): decrypt and compare the canonical intents ────────
  let committedNativeRequest: unknown;
  try {
    const plaintext = await decryptConversationContent(deps.kms, scope.orgId, committed.stored);
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

  // ── PHASE 3 (two-phase read): project the turn's CURRENT durable state ────────────────────
  // Not a cached copy of the original response — the live truth, so a duplicate arriving while
  // the turn is streaming reports `streaming`, and one arriving after completion reports the
  // answer.
  return {
    turn: await readAndProjectTurn(deps, scope, conversationId, committed.turnId),
    replay: true,
  };
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
  // PHASE A — DB only; the client is released when this returns.
  const page = await withPooledOwnerContext(deps.pool, scope, async (c) => {
    const root = await store.getConversation(c, conversationId);
    if (!root) throw new ConversationNotFoundError();

    const branchId = await resolveBranchForRead(c, scope, conversationId, query.branch_id);
    const turnRows = await turnStore.listBranchTurns(c, scope, {
      conversationId,
      branchId,
      limit: query.limit,
      afterTurnSeq: query.after_turn_seq ?? null,
    });
    return {
      bundle: await readTurnBundle(c, scope, conversationId, turnRows),
      // The keyset advances only on a FULL page: a short page means the branch is exhausted,
      // and handing back a cursor there would invite an endless empty-page poll.
      nextAfterTurnSeq:
        turnRows.length === query.limit ? (turnRows[turnRows.length - 1]!.turn_seq ?? null) : null,
    };
  });
  // PHASE B — KMS decrypt + projection, holding no client. A whole page of decrypts is exactly
  // the work the §13 page cap exists to bound, and none of it blocks the request pool.
  return {
    turns: await projectTurnBundle(deps.kms, scope.orgId, page.bundle),
    next_after_turn_seq: page.nextAfterTurnSeq,
  };
}

export async function getTurn(
  deps: ConversationServiceDeps,
  scope: OwnerScope,
  conversationId: string,
  turnId: string,
): Promise<ConversationTurnProjection> {
  // PHASE A — DB only; the client is released when this returns.
  const bundle = await withPooledOwnerContext(deps.pool, scope, async (c) => {
    const root = await store.getConversation(c, conversationId);
    if (!root) throw new ConversationNotFoundError();
    return readTurnBundleById(c, scope, conversationId, turnId);
  });
  // PHASE B — KMS decrypt + projection, holding no client.
  const projected = await projectTurnBundle(deps.kms, scope.orgId, bundle);
  return projected[0]!;
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

/**
 * Everything a projection needs, read from the database and NOTHING decrypted.
 *
 * ★ THIS TYPE IS THE PHASE BOUNDARY. Phase A produces it; Phase B consumes it. Because it carries
 * only rows — never a client — Phase B structurally cannot issue a query, and a future edit
 * cannot quietly reintroduce a decrypt inside a transaction.
 */
type TurnBundle = {
  turns: readonly turnStore.TurnRow[];
  attempts: readonly turnStore.AttemptRow[];
  items: readonly turnStore.ItemWithContentRow[];
};

/** PHASE A for one turn, resolved through its full conversation lineage (LAW 1). */
async function readTurnBundleById(
  c: PoolClient,
  scope: OwnerScope,
  conversationId: string,
  turnId: string,
): Promise<TurnBundle> {
  const turn = await turnStore.getTurnById(c, scope, conversationId, turnId);
  if (!turn) throw new TurnNotFoundError();
  return readTurnBundle(c, scope, conversationId, [turn]);
}

/**
 * PHASE A for a page of turns.
 *
 * Two queries for the whole page (attempts, items+content) rather than per-turn reads.
 */
async function readTurnBundle(
  c: PoolClient,
  scope: OwnerScope,
  conversationId: string,
  turnRows: readonly turnStore.TurnRow[],
): Promise<TurnBundle> {
  if (turnRows.length === 0) return { turns: [], attempts: [], items: [] };
  const turnIds = turnRows.map((t) => t.id);
  const [attempts, items] = await Promise.all([
    turnStore.listAttemptsForTurns(c, scope, conversationId, turnIds),
    turnStore.listItemsForTurns(c, scope, conversationId, turnIds),
  ]);
  return { turns: turnRows, attempts, items };
}

/**
 * PHASE B — decrypt and project. NO database client, NO transaction, by signature.
 *
 * Decryption is the bounded cost the §13 page cap exists to bound; none of it holds a connection.
 */
async function projectTurnBundle(
  kms: Kms,
  orgId: string,
  bundle: TurnBundle,
): Promise<ConversationTurnProjection[]> {
  const { turns: turnRows, attempts: attemptRows, items: itemRows } = bundle;
  if (turnRows.length === 0) return [];

  const items = await Promise.all(
    itemRows.map(async (row) => ({
      turnId: row.turn_id,
      attemptId: row.attempt_id,
      item: await projectItem(kms, orgId, row),
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
    return { ...base, native: null, text: null, bytes_base64: null, content_unreadable: true };
  }
  const plaintext = await decryptConversationContent(kms, orgId, {
    ciphertext: row.ciphertext,
    dek_wrapped: row.dek_wrapped,
    kms_key_id: row.kms_key_id,
    kms_key_version: row.kms_key_version,
  });

  // ★ FATAL DECODE, NOT `Buffer.toString('utf8')`. The executor stores a provider response
  // VERBATIM whatever its bytes, and `toString('utf8')` SILENTLY substitutes U+FFFD for every
  // invalid sequence — so an ISO-8859-1 error page from a proxy, or any binary body, came back
  // CORRUPTED while the contract claimed the text was exact. `TextDecoder(fatal)` refuses rather
  // than guessing, which is what lets the fallback below be honestly byte-safe.
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch {
    // NOT valid UTF-8 ⇒ there is no truthful string form. Return the bytes themselves, base64
    // encoded, so a client can reconstruct the upstream body EXACTLY.
    return {
      ...base,
      native: null,
      text: null,
      bytes_base64: plaintext.toString('base64'),
      content_unreadable: false,
    };
  }

  // A stream chunk is provider SSE framing — text, not a JSON document. Parsing is attempted only
  // where a document is expected, so a chunk is never silently reshaped into `native`.
  if (row.item_type === 'native_stream_chunk') {
    return { ...base, native: null, text, bytes_base64: null, content_unreadable: false };
  }
  // Valid UTF-8 that is not a JSON document — an HTML error page, a truncated body — comes back
  // as text. Parsing unconditionally used to make every later hydrate of that turn, and of any
  // PAGE containing it, a permanent 500 for an attempt that was durably finalized.
  try {
    return {
      ...base,
      native: JSON.parse(text),
      text: null,
      bytes_base64: null,
      content_unreadable: false,
    };
  } catch {
    return { ...base, native: null, text, bytes_base64: null, content_unreadable: false };
  }
}
