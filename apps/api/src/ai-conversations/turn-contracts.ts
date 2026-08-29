// Durable-send + hydrate request contracts and owner-visible projections
// (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C; spec §8/§9/§10/§13).
//
// PURE. Parsing and shaping only — no database, no KMS, no identity, no I/O.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// SOURCE BASIS OF EVERY EXTERNALLY VISIBLE FIELD (the narrowest source-supported contract).
//
//  SEND — `POST /v1/ai/conversations/:id/turns`
//   client_turn_id  REQUIRED. §8's reservation arbiter; the uniqueness constraint
//                   `ai_conversation_turns_client_turn_uniq (org_id, conversation_id,
//                   client_turn_id)` ALREADY EXISTS in 0031, so this contract is naming a
//                   column the schema was designed around, not inventing a key.
//   branch_id       REQUIRED. §3: the BRANCH owns the executing triple and the queue order, and
//                   a conversation may have many branches after a fork. Defaulting to the root
//                   would silently send to the wrong branch for any forked conversation, so the
//                   target is explicit. (The root branch id is returned by create and get-one,
//                   so a client always has one to name.)
//   native_request  REQUIRED. §13: "the turn-send body embeds the provider-native request
//                   fragment"; §12 forbids inventing a generic schema. GovAI validates only
//                   that it is a JSON OBJECT (the provider owns every field's validity) and
//                   bounds its size.
//   ★ NOT accepted: any GovAI-shaped `messages`/`prompt`/`text` field (that IS the
//     lowest-common-denominator schema §12 forbids); `model`/`provider`/`surface` (durable on
//     the branch — accepting them here would let one send silently execute against a different
//     model than the branch records, and the branch triple is frozen by 0031's guard);
//     `stream` as a separate flag (it lives inside `native_request` where the provider defines
//     it, and is read from there — see `isStreamingNativeRequest`).
//
//  HYDRATE — `GET /v1/ai/conversations/:id/turns` and `.../turns/:turnId`
//   branch_id       OPTIONAL filter; omitted lists the conversation's ROOT branch, which is the
//                   only branch a client that has never forked can have.
//   limit / after_turn_seq
//                   §13's page cap restated (<= 50), with a keyset on the branch's own dense
//                   `turn_seq`. No OFFSET anywhere, matching the conversation list.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

/** Turn-owned (input) and attempt-owned (output) item types P0-C writes. Free-form `item_type`
 *  in 0031; this is the P0-C vocabulary, kept deliberately small and provider-native. */
export const CONVERSATION_ITEM_TYPES = [
  /** TURN-owned: the immutable provider-native request the user sent (LAW 2 — survives retry). */
  'native_request',
  /** ATTEMPT-owned: a non-streaming provider response body, verbatim. */
  'native_response',
  /** ATTEMPT-owned: one ordered slice of a streaming provider response's raw bytes. Concatenating
   *  every chunk of an attempt in `item_seq` order reproduces the provider's byte stream exactly
   *  — the durable prefix always reflects what the server actually received. */
  'native_stream_chunk',
] as const;
export type ConversationItemType = (typeof CONVERSATION_ITEM_TYPES)[number];

/** 0031's attempt `state` CHECK, mirrored so a projection is typed rather than `string`. */
export const ATTEMPT_STATES = [
  'accepted',
  'dispatching',
  'streaming',
  'completed',
  'stopped',
  'failed',
  'rejected',
  'outcome_unknown',
] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

export const TURN_LIST_MAX_LIMIT = 50;
export const TURN_LIST_DEFAULT_LIMIT = 25;

/**
 * Upper bound on the serialized native request, in bytes.
 *
 * ★ IT MUST SIT BELOW FASTIFY'S `bodyLimit`, OR IT CAN NEVER FIRE. This server runs Fastify's
 * default 1 MiB body limit, which rejects the WHOLE envelope with a generic
 * `FST_ERR_CTP_BODY_TOO_LARGE` before any route handler runs. A domain bound set AT that limit
 * is dead code: measured, not assumed — an earlier revision of this constant was 1 MiB and the
 * contract test proved the domain error was unreachable. 512 KiB leaves clear headroom inside
 * the envelope, so an oversized `native_request` gets the SPECIFIC, actionable
 * `native_request_too_large` answer instead of a transport-level one.
 *
 * The two bounds are complementary, not redundant: Fastify bounds the REQUEST, this bounds the
 * FIELD that gets envelope-encrypted, stored in a single `bytea`, decrypted whole on every
 * hydrate, and canonicalized twice per send. 512 KiB is far above any real `/v1/messages` or
 * `/v1/responses` body that is not an attachment upload — and attachments are out of P0-C scope.
 */
export const NATIVE_REQUEST_MAX_BYTES = 524_288;

const JsonObject = z
  .record(z.string(), z.unknown())
  .refine((v) => !Array.isArray(v), 'native_request must be a JSON object');

export const SendTurnBody = z
  .object({
    client_turn_id: z.string().uuid(),
    branch_id: z.string().uuid(),
    native_request: JsonObject,
  })
  .strict();
export type SendTurnInput = z.infer<typeof SendTurnBody>;

export const ListTurnsQuery = z
  .object({
    branch_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(TURN_LIST_MAX_LIMIT).default(TURN_LIST_DEFAULT_LIMIT),
    /**
     * Exclusive keyset lower bound on the branch's dense `turn_seq`. `bigint` in the database;
     * accepted as a decimal string so a client never has to round-trip it through a JS number.
     *
     * ★ BOUNDED TO THE POSTGRESQL SIGNED-BIGINT MAXIMUM, not merely to 19 digits. A 19-digit
     * value such as `9999999999999999999` is syntactically fine but exceeds `bigint`, so the
     * `$5::bigint` cast raises `numeric_value_out_of_range` and the route answers 500 — a server
     * error for what is plainly an invalid query. Comparing as a `bigint` keeps the check exact
     * at the boundary, where a Number comparison would lose precision.
     */
    after_turn_seq: z
      .string()
      .regex(/^[0-9]{1,19}$/, 'after_turn_seq must be a non-negative integer')
      .refine(
        (v) => BigInt(v) <= 9223372036854775807n,
        'after_turn_seq exceeds the maximum turn sequence',
      )
      .optional(),
  })
  .strict();
export type ListTurnsInput = z.infer<typeof ListTurnsQuery>;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Owner-visible projections.
//
// ★ WHAT THESE MUST NEVER CARRY (spec §21/§25/§26): ciphertext, wrapped DEK, KMS key
// id/version, the keyed content digest, `provider_credential_id`, `claim_token`, `claimant`,
// `claim_deadline_at`, `heartbeat_at`, `capture_id`, the continuation anchor, or any other
// principal's identifiers. The DECRYPTED content is returned — it is the owner's own message,
// and returning it is the entire point of hydrate — but nothing that would let a reader forge a
// claim, identify a credential, or attack the envelope leaves this boundary.
//
// ★ `govai_request_id` IS returned, deliberately. It is §14's correlation handle between a turn
// attempt and its evidence, it belongs to the owner's own request, and it is the only way a
// client can later ask an evidence question about its own turn. It is not authority: possessing
// it grants nothing, unlike a claim token.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type ConversationItemProjection = {
  item_seq: number;
  item_type: ConversationItemType;
  /** Provider-native JSON, decrypted, for items whose content IS a JSON document
   *  (`native_request`, and a `native_response` that really is one). Null otherwise. */
  native: unknown;
  /**
   * VALID UTF-8 text for items whose content is not a JSON document.
   *
   * Set for `native_stream_chunk` (provider SSE framing is text, not JSON), and for a stored
   * `native_response` that decodes cleanly but does not parse as JSON — an upstream proxy's HTML
   * page, a truncated error body.
   */
  text: string | null;
  /**
   * The stored bytes, base64 encoded, when they are NOT valid UTF-8.
   *
   * ★ WHY THIS FIELD EXISTS RATHER THAN A LOSSY STRING. The executor persists a provider response
   * VERBATIM whatever its bytes, and `Buffer.toString('utf8')` silently replaces every invalid
   * sequence with U+FFFD — so an ISO-8859-1 error page or a binary body was returned CORRUPTED
   * while the contract claimed exactness. Decoding is now FATAL, and anything that fails it comes
   * back here byte-for-byte.
   *
   * ★ THE INVARIANT: at most one of `native` / `text` / `bytes_base64` is non-null, and stored
   * bytes are never discarded or silently normalized. All three are null only when
   * `content_unreadable` is true.
   */
  bytes_base64: string | null;
  /** True when the row exists but its content is no longer readable (crypto-shredded, LAW 12).
   *  Honest rather than absent: the item DID exist and its position matters to ordering. */
  content_unreadable: boolean;
};

export type ConversationAttemptProjection = {
  id: string;
  attempt_seq: number;
  state: AttemptState;
  /** Whether this attempt is the turn's `current_attempt_id` — §7.5's context-eligibility
   *  pointer. Only the current attempt's completed output is context. */
  is_current: boolean;
  /** §7.4 taxonomy; non-null only on `failed`, enforced by 0031's CHECK pair. */
  error_class: string | null;
  /** §7.8 post-advance marker. */
  context_excluded: boolean;
  /** §14.1 durable request identity, minted at the dispatch boundary. Null before it. */
  govai_request_id: string | null;
  created_at: string;
  /** Ratchet stamp; null while non-terminal. */
  terminal_at: string | null;
  /**
   * The attempt's durable output so far, in `item_seq` order.
   *
   * ★ HONEST PARTIAL TRUTH. While an attempt is `streaming` this is the PREFIX the server has
   * actually persisted — not a promise about what will arrive. A client reading a `streaming`
   * attempt is reading a real, incomplete answer, and the `state` field says so.
   */
  output_items: ConversationItemProjection[];
};

export type ConversationTurnProjection = {
  id: string;
  branch_id: string;
  client_turn_id: string;
  /** `bigint` in the database; a decimal string here so no precision is lost. */
  turn_seq: string;
  created_at: string;
  /** §7.1b: a reserved turn is NEVER attempt-less, so this is never null. */
  current_attempt_id: string;
  /** TURN-owned input (LAW 2) — committed at reservation, survives every retry. */
  input_items: ConversationItemProjection[];
  /** Every attempt of this turn, ordered by `attempt_seq`. In P0-C a turn has exactly one
   *  (retry is P0-D); the array is the durable shape, not a forward-looking guess. */
  attempts: ConversationAttemptProjection[];
};

export type ConversationTurnPage = {
  turns: ConversationTurnProjection[];
  /** The `after_turn_seq` value that would fetch the next page, or null when exhausted. */
  next_after_turn_seq: string | null;
};

/** The Send response. A reservation is durable BEFORE any provider work, so this returns the
 *  turn itself — the same shape hydrate returns — plus whether this request minted it. */
export type SendTurnResult = { turn: ConversationTurnProjection; replay: boolean };
