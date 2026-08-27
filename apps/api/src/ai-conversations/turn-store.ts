// Owner-scoped durable-send + hydrate store (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C).
//
// Every function here runs on a client that is ALREADY inside the service's owner context — the
// transaction-local `app.org_id` + `app.user_id` pair the `ai_*` policies consume, plus the ISO
// `DateStyle` pin. Nothing in this module opens a transaction, sets a GUC, or resolves an
// identity; that is the service's job, so the authorization boundary is entered in exactly one
// place (the `store.ts` contract, unchanged).
//
// ★ RLS IS THE AUTHORIZATION AUTHORITY (spec §3). Where a query also names `org_id` /
// `owner_user_id` explicitly, those predicates are an INDEX-SELECTIVITY AID and a LAW 1
// full-lineage read — never the security boundary.
//
// ★ NO CONTENT LEAVES THIS MODULE IN THE CLEAR. Content rows are returned as the raw envelope
// group for the caller to decrypt through `crypto.ts`. This module never decrypts.

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { OwnerScope } from './store.js';

/** The envelope group as it must be written to `ai_conversation_content`. */
export type ContentInsert = {
  ciphertext: Buffer;
  dekWrapped: Buffer;
  kmsKeyId: string;
  kmsKeyVersion: number;
  contentHmac: Buffer;
};

/**
 * Insert one encrypted content row and return its id.
 *
 * Shared by the request plane (the turn's immutable native request config) and the worker plane
 * (attempt output). Both roles hold INSERT + a matching dual-predicate policy; the row is
 * written in the `active` shape, which 0031's status CHECK requires to carry a wrapped DEK.
 */
export async function insertContent(
  client: PoolClient,
  scope: OwnerScope,
  conversationId: string,
  content: ContentInsert,
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO govai.ai_conversation_content
       (org_id, owner_user_id, conversation_id, ciphertext, dek_wrapped,
        kms_key_id, kms_key_version, content_hmac)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::bytea, $6::text, $7::integer, $8::bytea)
     RETURNING id`,
    [
      scope.orgId,
      scope.ownerUserId,
      conversationId,
      content.ciphertext,
      content.dekWrapped,
      content.kmsKeyId,
      content.kmsKeyVersion,
      content.contentHmac,
    ],
  );
  return r.rows[0]!.id;
}

/**
 * The next `turn_seq` for a branch.
 *
 * ★ MUST be called while the caller HOLDS the branch execution authority (LAW 16 level (2)).
 * `MAX(turn_seq) + 1` is a read-then-write on its own; what makes it correct is that every
 * writer of this branch serializes on the same advisory lock, so no second reservation can
 * observe the same maximum. 0031's `ai_conversation_turns_turn_seq_uniq` is the independent
 * backstop: if the lock discipline were ever broken, the second insert raises 23505 rather than
 * silently duplicating a queue position — a loud failure, not a corrupted order.
 *
 * Returned as a decimal STRING: `turn_seq` is `bigint`, and node-postgres hands bigints back as
 * strings precisely so precision is not lost through a JS number.
 */
export async function nextTurnSeq(
  client: PoolClient,
  scope: OwnerScope,
  conversationId: string,
  branchId: string,
): Promise<string> {
  const r = await client.query<{ next_seq: string }>(
    `SELECT (COALESCE(MAX(turn_seq), 0) + 1)::text AS next_seq
       FROM govai.ai_conversation_turns
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid
        AND conversation_id = $3::uuid AND branch_id = $4::uuid`,
    [scope.orgId, scope.ownerUserId, conversationId, branchId],
  );
  return r.rows[0]!.next_seq;
}

/**
 * Mint the reserved turn AND its initial attempt atomically, with `current_attempt_id` already
 * set at INSERT time — the §9 step-1 reservation.
 *
 * ★ THIS IS WHY P0-C NEEDS NO UPDATE AUTHORITY ON `ai_conversation_turns` EITHER. 0031 §I made
 * the reverse pointer a NULLABLE, DEFERRABLE composite FK precisely so "a transaction may
 * SET CONSTRAINTS DEFERRED to mint turn+attempt+pointer atomically", and 0033's fork already
 * proved the technique in production code. A turn therefore never exists — not even for one
 * statement — without its attempt (§7.1b), and the request plane never acquires the authority
 * to REPOINT a live turn.
 *
 * ★ THE UNIQUE CONSTRAINT IS THE ARBITER, AND IT IS THE ONE 0031 DECLARED. `ON CONFLICT
 * (org_id, conversation_id, client_turn_id) DO NOTHING` names exactly
 * `ai_conversation_turns_client_turn_uniq`, which 0031 built as "the §8 idempotency arbiter".
 * No second arbiter is introduced: a parallel arbiter table could disagree with this constraint,
 * and then "which one is authoritative" would be a question with no answer.
 *   The conflict target is DELIBERATELY narrow. A `turn_seq` collision — 0031's OTHER unique
 * constraint on this table — is NOT swallowed: it means the branch-authority lock discipline
 * failed, and that must surface as 23505 rather than be silently absorbed into a replay.
 *
 * Returns `null` when this transaction LOST the reservation race; the caller rolls back and
 * answers from the committed turn.
 *
 * The attempt is written in the §7.1b BORN shape and nothing else: `accepted`, UNCLAIMED,
 * pre-boundary, no request identity, no credential provenance, no continuation anchor. It is
 * NOT claimed and NOT dispatched — 0031's birth guard enforces that shape independently.
 */
export async function insertReservedTurnWithInitialAttempt(
  client: PoolClient,
  scope: OwnerScope,
  input: {
    conversationId: string;
    branchId: string;
    clientTurnId: string;
    turnSeq: string;
    nativeRequestConfigContentId: string;
  },
): Promise<{ turnId: string; attemptId: string } | null> {
  const turnId = randomUUID();
  const attemptId = randomUUID();

  await client.query('SET CONSTRAINTS govai.ai_conversation_turns_current_attempt_fk DEFERRED');
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO govai.ai_conversation_turns
       (id, org_id, owner_user_id, conversation_id, branch_id, client_turn_id, turn_seq,
        current_attempt_id, native_request_config_content_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::bigint,
             $8::uuid, $9::uuid)
     ON CONFLICT (org_id, conversation_id, client_turn_id) DO NOTHING
     RETURNING id`,
    [
      turnId,
      scope.orgId,
      scope.ownerUserId,
      input.conversationId,
      input.branchId,
      input.clientTurnId,
      input.turnSeq,
      attemptId,
      input.nativeRequestConfigContentId,
    ],
  );
  if (inserted.rows.length === 0) return null;

  await client.query(
    `INSERT INTO govai.ai_conversation_attempts
       (id, org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 1)`,
    [
      attemptId,
      scope.orgId,
      scope.ownerUserId,
      input.conversationId,
      input.branchId,
      turnId,
    ],
  );
  return { turnId, attemptId };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Hydrate reads
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type TurnRow = {
  id: string;
  branch_id: string;
  client_turn_id: string;
  turn_seq: string;
  current_attempt_id: string | null;
  native_request_config_content_id: string;
  created_at: Date;
};

const TURN_COLUMNS = `id, branch_id, client_turn_id, turn_seq::text AS turn_seq,
       current_attempt_id, native_request_config_content_id, created_at`;

/** One keyset page of a branch's turns, in `turn_seq` order. */
export async function listBranchTurns(
  client: PoolClient,
  scope: OwnerScope,
  input: {
    conversationId: string;
    branchId: string;
    limit: number;
    afterTurnSeq: string | null;
  },
): Promise<TurnRow[]> {
  const r = await client.query<TurnRow>(
    `SELECT ${TURN_COLUMNS}
       FROM govai.ai_conversation_turns
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid
        AND conversation_id = $3::uuid AND branch_id = $4::uuid
        AND ($5::bigint IS NULL OR turn_seq > $5::bigint)
      ORDER BY turn_seq ASC
      LIMIT $6::integer`,
    [
      scope.orgId,
      scope.ownerUserId,
      input.conversationId,
      input.branchId,
      input.afterTurnSeq,
      input.limit,
    ],
  );
  return r.rows;
}

/** One turn by id, through its full conversation lineage (LAW 1 on the read path). */
export async function getTurnById(
  client: PoolClient,
  scope: OwnerScope,
  conversationId: string,
  turnId: string,
): Promise<TurnRow | null> {
  const r = await client.query<TurnRow>(
    `SELECT ${TURN_COLUMNS}
       FROM govai.ai_conversation_turns
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid
        AND conversation_id = $3::uuid AND id = $4::uuid`,
    [scope.orgId, scope.ownerUserId, conversationId, turnId],
  );
  return r.rows[0] ?? null;
}

/** Look up a turn by its reservation identity — the replay read (§8: a duplicate is a READ). */
export async function findTurnByClientTurnId(
  client: PoolClient,
  scope: OwnerScope,
  conversationId: string,
  clientTurnId: string,
): Promise<TurnRow | null> {
  const r = await client.query<TurnRow>(
    `SELECT ${TURN_COLUMNS}
       FROM govai.ai_conversation_turns
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid
        AND conversation_id = $3::uuid AND client_turn_id = $4::uuid`,
    [scope.orgId, scope.ownerUserId, conversationId, clientTurnId],
  );
  return r.rows[0] ?? null;
}

export type AttemptRow = {
  id: string;
  turn_id: string;
  attempt_seq: number;
  state: string;
  error_class: string | null;
  context_excluded: boolean;
  govai_request_id: string | null;
  created_at: Date;
  terminal_at: Date | null;
};

/**
 * Every attempt of the given turns, ordered.
 *
 * ★ The projection names its columns and deliberately EXCLUDES the claim triple, the heartbeat,
 * `provider_credential_id`, `capture_id`, `dispatch_boundary_committed_at`,
 * `causal_version_at_build` and the continuation anchor. A hydrate response must not carry
 * execution authority or credential provenance (§25); leaving those columns out of the SQL —
 * not merely out of the projection function — means a future edit to the mapper cannot leak
 * them by accident.
 */
export async function listAttemptsForTurns(
  client: PoolClient,
  scope: OwnerScope,
  conversationId: string,
  turnIds: readonly string[],
): Promise<AttemptRow[]> {
  if (turnIds.length === 0) return [];
  const r = await client.query<AttemptRow>(
    `SELECT id, turn_id, attempt_seq, state, error_class, context_excluded,
            govai_request_id, created_at, terminal_at
       FROM govai.ai_conversation_attempts
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid
        AND conversation_id = $3::uuid AND turn_id = ANY($4::uuid[])
      ORDER BY turn_id, attempt_seq ASC`,
    [scope.orgId, scope.ownerUserId, conversationId, turnIds as string[]],
  );
  return r.rows;
}

export type ItemWithContentRow = {
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

/**
 * Every item of the given turns — TURN-owned (`attempt_id IS NULL`) and ATTEMPT-owned alike —
 * joined to its content envelope in ONE query.
 *
 * The join avoids an N+1 over content rows on a page that may hold 50 turns; the caller
 * partitions by `attempt_id` and decrypts. `content_status` travels so a crypto-shredded row is
 * reported honestly rather than surfacing as a decrypt failure.
 */
export async function listItemsForTurns(
  client: PoolClient,
  scope: OwnerScope,
  conversationId: string,
  turnIds: readonly string[],
): Promise<ItemWithContentRow[]> {
  if (turnIds.length === 0) return [];
  const r = await client.query<ItemWithContentRow>(
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
        AND i.conversation_id = $3::uuid AND i.turn_id = ANY($4::uuid[])
      ORDER BY i.turn_id, i.attempt_id NULLS FIRST, i.item_seq ASC`,
    [scope.orgId, scope.ownerUserId, conversationId, turnIds as string[]],
  );
  return r.rows;
}

/** One content row by id, for the replay intent re-derivation. */
export async function getContentById(
  client: PoolClient,
  scope: OwnerScope,
  conversationId: string,
  contentId: string,
): Promise<{
  ciphertext: Buffer;
  dek_wrapped: Buffer | null;
  kms_key_id: string;
  kms_key_version: number;
  status: string;
} | null> {
  const r = await client.query<{
    ciphertext: Buffer;
    dek_wrapped: Buffer | null;
    kms_key_id: string;
    kms_key_version: number;
    status: string;
  }>(
    `SELECT ciphertext, dek_wrapped, kms_key_id, kms_key_version, status
       FROM govai.ai_conversation_content
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid
        AND conversation_id = $3::uuid AND id = $4::uuid`,
    [scope.orgId, scope.ownerUserId, conversationId, contentId],
  );
  return r.rows[0] ?? null;
}
