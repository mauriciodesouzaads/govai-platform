// Owner-scoped conversation control-plane store (EP-AI-CONVERSATION-CONTINUITY-V1 P0-B).
//
// Every function here runs on a client that is ALREADY inside `withOwnerContext` — the
// transaction-local `app.org_id` + `app.user_id` pair the `ai_*` policies consume. Nothing in
// this module opens a transaction, sets a GUC, or resolves an identity; that is the service's
// job, so the authorization boundary is entered in exactly one place.
//
// ★ RLS IS THE AUTHORIZATION AUTHORITY (spec §3). Where a query also names `org_id` /
// `owner_user_id` explicitly, those predicates are an INDEX-SELECTIVITY AID and a LAW 1
// full-lineage read — never the security boundary. The dual-predicate FORCE RLS policies
// decide visibility, and the integration suite proves that the SAME sql with the SAME bound
// parameters returns ZERO rows when the owner context is absent or wrong.
//
// ★ NO CONTENT LEAVES THIS MODULE IN THE CLEAR. Title columns are returned as the raw
// ciphertext group for the caller to decrypt through `crypto.ts`; the content copy path moves
// CIPHERTEXT BYTES and never decrypts at all.

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ConversationMode, ConversationProvider, ForkBoundaryMode } from './contracts.js';

/** The conversation columns every P0-B projection is built from. */
export type ConversationRow = {
  id: string;
  mode: ConversationMode;
  provider: ConversationProvider;
  surface: string;
  model: string;
  status: string;
  title_ciphertext: Buffer | null;
  title_dek_wrapped: Buffer | null;
  title_kms_key_id: string | null;
  title_kms_key_version: number | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
};

/** `ConversationRow` plus the microsecond-faithful keyset ordering key (see cursor.ts). */
export type ConversationListRow = ConversationRow & { updated_at_key: string };

export type BranchRow = {
  id: string;
  provider: ConversationProvider;
  surface: string;
  model: string;
  parent_branch_id: string | null;
};

export type ForkBranchRow = BranchRow & {
  conversation_id: string;
  forked_from_turn_id: string;
  forked_from_attempt_id: string;
  boundary_mode: ForkBoundaryMode;
  created_at: Date;
};

/** Owner identity, always taken from the authenticated `AuthIdentity` — never from a request
 *  body, query string or header (P0-A2's load-bearing rule), and never from worker discovery. */
export type OwnerScope = { orgId: string; ownerUserId: string };

const CONVERSATION_COLUMNS = `id, mode, provider, surface, model, status,
       title_ciphertext, title_dek_wrapped, title_kms_key_id, title_kms_key_version,
       created_at, updated_at, archived_at`;

const BRANCH_COLUMNS = `id, provider, surface, model, parent_branch_id`;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Insert the conversation root. The caller inserts the root branch in the SAME transaction —
 * a conversation that survives without its root branch is forbidden (§3: "Every conversation
 * has one root branch"), and 0031's partial-unique `ai_conversation_branches_root_uniq` makes a
 * SECOND root impossible.
 */
export async function insertConversation(
  client: PoolClient,
  scope: OwnerScope,
  input: {
    mode: ConversationMode;
    provider: ConversationProvider;
    surface: string;
    model: string;
  },
): Promise<ConversationRow> {
  const r = await client.query<ConversationRow>(
    `INSERT INTO govai.ai_conversations
       (org_id, owner_user_id, mode, provider, surface, model)
     VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text)
     RETURNING ${CONVERSATION_COLUMNS}`,
    [scope.orgId, scope.ownerUserId, input.mode, input.provider, input.surface, input.model],
  );
  return r.rows[0]!;
}

/**
 * Insert the ROOT branch (fork columns all NULL — 0031's shape CHECK).
 *
 * §3: the branch is the DURABLE OWNER OF EXECUTION IDENTITY, and the root branch receives the
 * conversation's creation defaults. Adapter selection reads the BRANCH, never the conversation
 * root, so this copy is not redundancy — it is the value a post-reload detached dispatch will
 * actually read.
 */
export async function insertRootBranch(
  client: PoolClient,
  scope: OwnerScope,
  input: {
    conversationId: string;
    provider: ConversationProvider;
    surface: string;
    model: string;
  },
): Promise<BranchRow> {
  const r = await client.query<BranchRow>(
    `INSERT INTO govai.ai_conversation_branches
       (org_id, owner_user_id, conversation_id, provider, surface, model)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text)
     RETURNING ${BRANCH_COLUMNS}`,
    [
      scope.orgId,
      scope.ownerUserId,
      input.conversationId,
      input.provider,
      input.surface,
      input.model,
    ],
  );
  return r.rows[0]!;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** One keyset page, plus the answer to the only question the page itself cannot answer. */
export type ConversationPageRows = {
  /** AT MOST `input.limit` rows. The sentinel is trimmed here and never leaves this module. */
  rows: ConversationListRow[];
  /** Proven, not guessed: a further matching row exists after `rows`. */
  hasMore: boolean;
};

/**
 * §13 keyset page, ordered `(updated_at DESC, id DESC)` to match 0031's
 * `ai_conversations_owner_list_idx` with the tie-breaker appended. NO `OFFSET` — an offset page
 * silently repeats or skips rows whenever a concurrent rename bumps `updated_at`.
 *
 * `deleted_pending` / `deleted` are unreachable: the caller only ever passes `active` or
 * `archived` (§19's archive semantics; the deleted states are not a P0-B projection).
 *
 * ★ ONE SENTINEL ROW. The query asks for `limit + 1` and returns at most `limit`. A FULL page
 * says nothing about what follows it — when the total is an exact multiple of the page size the
 * LAST page is full too — so "is there another page" can only be answered by looking one row
 * further. That extra row is a boundary PROBE, never a result: it is dropped here, so it is
 * never projected, never returned, and never has its title decrypted (§6's decryption budget
 * stays bounded by the PUBLIC page cap of 50, not by 51). The cursor the service emits is built
 * from the last RETURNED row, never from the sentinel — a cursor pointing past the page would
 * skip the sentinel row on the next request.
 *
 * ★ THE ORDERING KEY IS RENDERED UNDER A PINNED `DateStyle` (P0B-P2-CURSOR-DATESTYLE-PIN-01).
 * `updated_at::text` is rendered by POSTGRESQL, and `timestamptz`'s textual form follows the
 * SESSION's `DateStyle` — which nothing in this system pinned: not the bootstrap, not the role,
 * not the pool, not the connection string. Under `German, DMY` the same instant prints
 * `25.08.2026 19:49:46.123456 UTC`, under `SQL, DMY` `25/08/2026 …`, under `Postgres, MDY`
 * `Tue Aug 25 …` — none of which `cursor.ts`'s grammar accepts. The server would then hand a
 * client a `next_cursor` it answered `400 invalid_cursor` on, and the cursor is the server's OWN,
 * so no client could route around it. `SET LOCAL` makes the rendering the decoder's contract,
 * independent of whatever the session was handed.
 *
 * Why THIS mechanism, and not the alternatives:
 *   · TRANSACTION-LOCAL, so it dies with the owner transaction `withOwnerContext` opened around
 *     this call — proven on a real pool: after COMMIT and after ROLLBACK the session is exactly as
 *     it was, and the NEXT borrower of that pooled connection sees the ambient value untouched.
 *     `DateStyle` is a `USERSET` GUC (`pg_settings.context = 'user'`), so no grant changes.
 *   · POSTGRESQL still does the rendering. The microsecond tail, and historical offsets that carry
 *     SECONDS (`-03:06:28` for pre-1914 America/Sao_Paulo), stay native.
 *   · NOT `to_char`: measured against PostgreSQL 16, it is not byte-faithful to `::text` —
 *     it pads a shorter fraction (`.1` -> `.100000`, none -> `.000000`) and TRUNCATES the offset
 *     seconds (`-03:06:28` -> `-03:06`). A key rendered that way would not be the value the
 *     `$n::timestamptz` comparison below is made against.
 *   · NOT a JavaScript `Date`: millisecond precision, so the microsecond tail this key exists to
 *     preserve would be destroyed (see the cursor.ts header).
 *   · NOT a database, role or pool default: this fixes the ONE statement whose text rendering is a
 *     durable contract, and widening it would change how every other query in the system renders
 *     timestamps — a far larger claim than the defect supports.
 * The `SET LOCAL` is valid because every function in this module runs inside the caller's
 * transaction (see the module header); this one has a single call site, `service.listConversations`,
 * whose whole transaction body is the query below.
 */
export async function listConversations(
  client: PoolClient,
  scope: OwnerScope,
  input: {
    status: 'active' | 'archived';
    limit: number;
    cursor: { updatedAt: string; id: string } | null;
  },
): Promise<ConversationPageRows> {
  await client.query(`SET LOCAL DateStyle = 'ISO, MDY'`);
  const params: unknown[] = [scope.orgId, scope.ownerUserId, input.status];
  let keyset = '';
  if (input.cursor) {
    params.push(input.cursor.updatedAt, input.cursor.id);
    keyset = ` AND (updated_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(input.limit + 1);
  const r = await client.query<ConversationListRow>(
    `SELECT ${CONVERSATION_COLUMNS}, updated_at::text AS updated_at_key
       FROM govai.ai_conversations
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid AND status = $3::text${keyset}
      ORDER BY updated_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  const hasMore = r.rows.length > input.limit;
  return { rows: hasMore ? r.rows.slice(0, input.limit) : r.rows, hasMore };
}

/** One conversation by id. Null covers absent, other-owner and other-org identically: the
 *  policy filters, the route answers 404, and no branch of that decision is observable. */
export async function getConversation(
  client: PoolClient,
  conversationId: string,
): Promise<ConversationRow | null> {
  const r = await client.query<ConversationRow>(
    `SELECT ${CONVERSATION_COLUMNS} FROM govai.ai_conversations WHERE id = $1::uuid`,
    [conversationId],
  );
  return r.rows[0] ?? null;
}

/** The conversation's root branch (`parent_branch_id IS NULL`, unique by 0031's partial index). */
export async function getRootBranch(
  client: PoolClient,
  conversationId: string,
): Promise<BranchRow | null> {
  const r = await client.query<BranchRow>(
    `SELECT ${BRANCH_COLUMNS}
       FROM govai.ai_conversation_branches
      WHERE conversation_id = $1::uuid AND parent_branch_id IS NULL`,
    [conversationId],
  );
  return r.rows[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Mutate (§13's two guarded fields only)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type ConversationPatch = {
  /** Encrypted title group, or undefined to leave the title untouched. */
  title?: {
    ciphertext: Buffer;
    dekWrapped: Buffer;
    kmsKeyId: string;
    kmsKeyVersion: number;
    hmac: Buffer;
  };
  /** true => archive, false => restore to active, undefined => leave the lifecycle untouched. */
  archived?: boolean;
};

/**
 * The guarded UPDATE. The SET list is assembled from a CLOSED set of column literals and only
 * ever carries bound parameters — and it is defence in depth three times over: 0033 grants
 * `govai_app` column-level UPDATE on exactly these columns, 0031's guard trigger rejects any
 * identity/mode/default change and any unlawful lifecycle edge, and the dual-predicate policy
 * decides the row. A bug here fails closed at the database, not silently in the application.
 *
 * `updated_at` is bumped on every mutation because it is the list's primary ordering key: a
 * rename that did not bump it would leave the sidebar claiming stale activity.
 */
export async function updateConversation(
  client: PoolClient,
  conversationId: string,
  patch: ConversationPatch,
): Promise<ConversationRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [conversationId];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (patch.title !== undefined) {
    sets.push(`title_ciphertext = ${bind(patch.title.ciphertext)}::bytea`);
    sets.push(`title_dek_wrapped = ${bind(patch.title.dekWrapped)}::bytea`);
    sets.push(`title_kms_key_id = ${bind(patch.title.kmsKeyId)}::text`);
    sets.push(`title_kms_key_version = ${bind(patch.title.kmsKeyVersion)}::integer`);
    sets.push(`title_hmac = ${bind(patch.title.hmac)}::bytea`);
  }
  if (patch.archived !== undefined) {
    // §19: archive sets `archived_at`; restoring clears it — the column names the CURRENT
    // state, so a restored conversation carrying an `archived_at` would be a false record.
    sets.push(`status = ${bind(patch.archived ? 'archived' : 'active')}::text`);
    sets.push(`archived_at = ${patch.archived ? 'now()' : 'NULL'}`);
  }
  sets.push('updated_at = now()');

  const r = await client.query<ConversationRow>(
    `UPDATE govai.ai_conversations
        SET ${sets.join(', ')}
      WHERE id = $1::uuid
      RETURNING ${CONVERSATION_COLUMNS}`,
    params,
  );
  return r.rows[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Fork
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A branch of THIS conversation, by id. Conversation-scoped on purpose: a branch id from
 *  another conversation must be indistinguishable from one that does not exist. */
export async function getBranchInConversation(
  client: PoolClient,
  conversationId: string,
  branchId: string,
): Promise<BranchRow | null> {
  const r = await client.query<BranchRow>(
    `SELECT ${BRANCH_COLUMNS}
       FROM govai.ai_conversation_branches
      WHERE id = $1::uuid AND conversation_id = $2::uuid`,
    [branchId, conversationId],
  );
  return r.rows[0] ?? null;
}

/**
 * Resolve the pinned fork source through its FULL composite lineage — the exact tuple 0031's
 * `ai_conversation_branches_fork_fk` binds (org, owner, conversation, branch, turn, attempt).
 * LAW 1: no security or causal pointer by id alone, on the READ path as much as on the write.
 */
export async function getForkSourceAttempt(
  client: PoolClient,
  scope: OwnerScope,
  lineage: {
    conversationId: string;
    parentBranchId: string;
    forkedFromTurnId: string;
    forkedFromAttemptId: string;
  },
): Promise<{ id: string; state: string; attempt_seq: number } | null> {
  const r = await client.query<{ id: string; state: string; attempt_seq: number }>(
    `SELECT id, state, attempt_seq
       FROM govai.ai_conversation_attempts
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid AND conversation_id = $3::uuid
        AND branch_id = $4::uuid AND turn_id = $5::uuid AND id = $6::uuid`,
    [
      scope.orgId,
      scope.ownerUserId,
      lineage.conversationId,
      lineage.parentBranchId,
      lineage.forkedFromTurnId,
      lineage.forkedFromAttemptId,
    ],
  );
  return r.rows[0] ?? null;
}

/** Insert the fork branch (all four fork columns set — 0031's shape CHECK, its composite fork
 *  FK, and 0033's C4 state guard all fire here). */
export async function insertForkBranch(
  client: PoolClient,
  scope: OwnerScope,
  input: {
    conversationId: string;
    parentBranchId: string;
    forkedFromTurnId: string;
    forkedFromAttemptId: string;
    boundaryMode: ForkBoundaryMode;
    provider: ConversationProvider;
    surface: string;
    model: string;
  },
): Promise<ForkBranchRow> {
  const r = await client.query<ForkBranchRow>(
    `INSERT INTO govai.ai_conversation_branches
       (org_id, owner_user_id, conversation_id, provider, surface, model,
        parent_branch_id, forked_from_turn_id, forked_from_attempt_id, boundary_mode)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
             $7::uuid, $8::uuid, $9::uuid, $10::text)
     RETURNING ${BRANCH_COLUMNS}, conversation_id, forked_from_turn_id, forked_from_attempt_id,
               boundary_mode, created_at`,
    [
      scope.orgId,
      scope.ownerUserId,
      input.conversationId,
      input.provider,
      input.surface,
      input.model,
      input.parentBranchId,
      input.forkedFromTurnId,
      input.forkedFromAttemptId,
      input.boundaryMode,
    ],
  );
  return r.rows[0]!;
}

/**
 * The fork reservation — THE single PostgreSQL concurrency arbiter (0033 §B), the 0030
 * `reserveRunIdempotency` shape. Non-poisoning: `ON CONFLICT DO NOTHING` never aborts the
 * transaction, and a blocked contender waits for the owning transaction, then proceeds as the
 * legitimate winner if that owner rolled back. Returns true when THIS transaction won.
 */
export async function reserveForkIdempotency(
  client: PoolClient,
  scope: OwnerScope,
  input: {
    conversationId: string;
    clientForkId: string;
    intentHash: Buffer;
    intentHashVersion: number;
    branchId: string;
  },
): Promise<boolean> {
  const r = await client.query(
    `INSERT INTO govai.ai_conversation_fork_idempotency
       (org_id, owner_user_id, conversation_id, client_fork_id,
        fork_intent_hash, fork_intent_hash_version, branch_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bytea, $6::smallint, $7::uuid)
     ON CONFLICT (org_id, conversation_id, client_fork_id) DO NOTHING
     RETURNING branch_id`,
    [
      scope.orgId,
      scope.ownerUserId,
      input.conversationId,
      input.clientForkId,
      input.intentHash,
      input.intentHashVersion,
      input.branchId,
    ],
  );
  return r.rows.length === 1;
}

/** Read a COMMITTED fork binding. */
export async function findForkBinding(
  client: PoolClient,
  conversationId: string,
  clientForkId: string,
): Promise<{ branch_id: string; fork_intent_hash: Buffer } | null> {
  const r = await client.query<{ branch_id: string; fork_intent_hash: Buffer }>(
    `SELECT branch_id, fork_intent_hash
       FROM govai.ai_conversation_fork_idempotency
      WHERE conversation_id = $1::uuid AND client_fork_id = $2::uuid`,
    [conversationId, clientForkId],
  );
  return r.rows[0] ?? null;
}

/** Read a fork branch back for a replay projection. */
export async function getForkBranch(
  client: PoolClient,
  conversationId: string,
  branchId: string,
): Promise<ForkBranchRow | null> {
  const r = await client.query<ForkBranchRow>(
    `SELECT ${BRANCH_COLUMNS}, conversation_id, forked_from_turn_id, forked_from_attempt_id,
            boundary_mode, created_at
       FROM govai.ai_conversation_branches
      WHERE id = $1::uuid AND conversation_id = $2::uuid AND parent_branch_id IS NOT NULL`,
    [branchId, conversationId],
  );
  return r.rows[0] ?? null;
}

/** The regeneration child turn of a `before_attempt_output` branch, for a replay projection.
 *  `after_attempt` branches mint no child rows, so this is legitimately empty for them. */
export async function getBranchChildTurn(
  client: PoolClient,
  branchId: string,
): Promise<{ id: string; current_attempt_id: string | null } | null> {
  const r = await client.query<{ id: string; current_attempt_id: string | null }>(
    `SELECT id, current_attempt_id
       FROM govai.ai_conversation_turns
      WHERE branch_id = $1::uuid
      ORDER BY turn_seq ASC
      LIMIT 1`,
    [branchId],
  );
  return r.rows[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// `before_attempt_output`: the regeneration child (§3, §16 of the movement dispatch)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Copy an encrypted content row to a NEW row of the same conversation, moving CIPHERTEXT BYTES
 * ONLY. No decryption happens — and none is needed: the envelope is wrapped under
 * `(orgId, keyId, version, purpose)`, all four unchanged, so the copy is decryptable by exactly
 * the same authority as the original and the keyed digest still describes the same plaintext.
 *
 * ★ WHY A COPY AND NOT A SHARED REFERENCE (adjudicated). The child turn's content FK is
 * conversation-scoped, so the child COULD have pointed at the source row. It does not, for two
 * reasons: §3 says the fork "COPIES the source turn's immutable user items AND its immutable
 * native request config", and — the load-bearing one — the stated purpose of the copy is that
 * "every detached dispatch reads its config from its OWN turn". A shared row would couple two
 * turns' shred/purge lifetimes in a way §19 does not model.
 *
 * Only an `active` source is copyable: a crypto-shredded row has no wrapped DEK, and copying it
 * would either fabricate an undecryptable "active" row or violate 0031's status CHECK. Returns
 * null so the caller fails loudly rather than minting an unreadable child.
 */
export async function copyContentRow(
  client: PoolClient,
  conversationId: string,
  sourceContentId: string,
): Promise<string | null> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO govai.ai_conversation_content
       (org_id, owner_user_id, conversation_id, ciphertext, dek_wrapped,
        kms_key_id, kms_key_version, content_hmac)
     SELECT org_id, owner_user_id, conversation_id, ciphertext, dek_wrapped,
            kms_key_id, kms_key_version, content_hmac
       FROM govai.ai_conversation_content
      WHERE id = $1::uuid AND conversation_id = $2::uuid AND status = 'active'
     RETURNING id`,
    [sourceContentId, conversationId],
  );
  return r.rows[0]?.id ?? null;
}

/** The source turn's own durable identity, read through its full lineage. */
export async function getTurnInLineage(
  client: PoolClient,
  scope: OwnerScope,
  lineage: { conversationId: string; branchId: string; turnId: string },
): Promise<{ id: string; native_request_config_content_id: string } | null> {
  const r = await client.query<{ id: string; native_request_config_content_id: string }>(
    `SELECT id, native_request_config_content_id
       FROM govai.ai_conversation_turns
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid
        AND conversation_id = $3::uuid AND branch_id = $4::uuid AND id = $5::uuid`,
    [scope.orgId, scope.ownerUserId, lineage.conversationId, lineage.branchId, lineage.turnId],
  );
  return r.rows[0] ?? null;
}

/** The source turn's TURN-OWNED (user/input) items — `attempt_id IS NULL`, LAW 2. Attempt-owned
 *  OUTPUT items are deliberately never copied: `before_attempt_output` EXCLUDES the pinned
 *  attempt's output by definition. */
export async function listTurnOwnedItems(
  client: PoolClient,
  scope: OwnerScope,
  lineage: { conversationId: string; branchId: string; turnId: string },
): Promise<Array<{ item_seq: number; item_type: string; content_id: string }>> {
  const r = await client.query<{ item_seq: number; item_type: string; content_id: string }>(
    `SELECT item_seq, item_type, content_id
       FROM govai.ai_conversation_items
      WHERE org_id = $1::uuid AND owner_user_id = $2::uuid
        AND conversation_id = $3::uuid AND branch_id = $4::uuid AND turn_id = $5::uuid
        AND attempt_id IS NULL
      ORDER BY item_seq ASC`,
    [scope.orgId, scope.ownerUserId, lineage.conversationId, lineage.branchId, lineage.turnId],
  );
  return r.rows;
}

export async function insertTurnOwnedItem(
  client: PoolClient,
  scope: OwnerScope,
  input: {
    conversationId: string;
    branchId: string;
    turnId: string;
    itemSeq: number;
    itemType: string;
    contentId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO govai.ai_conversation_items
       (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id,
        item_seq, item_type, content_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, NULL,
             $6::integer, $7::text, $8::uuid)`,
    [
      scope.orgId,
      scope.ownerUserId,
      input.conversationId,
      input.branchId,
      input.turnId,
      input.itemSeq,
      input.itemType,
      input.contentId,
    ],
  );
}

/**
 * Mint the regeneration child turn AND its fresh initial attempt atomically, with
 * `current_attempt_id` already set at INSERT time.
 *
 * ★ THIS IS WHY P0-B NEEDS NO UPDATE AUTHORITY ON `ai_conversation_turns`. 0031 §I made the
 * reverse pointer a NULLABLE, DEFERRABLE composite FK precisely so "a transaction may
 * SET CONSTRAINTS DEFERRED to mint turn+attempt+pointer atomically". Deferring it for the
 * remainder of this transaction lets the turn be written with the pointer already correct; the
 * attempt lands immediately after, and PostgreSQL validates the whole lineage at COMMIT. A turn
 * therefore never exists — not even for one statement — without its attempt (§7.1b), and the
 * control plane never acquires the authority to REPOINT a live turn.
 *
 * The attempt is written in the §7.1b BORN shape and nothing else: `accepted`, UNCLAIMED,
 * pre-boundary, no request identity, no credential provenance, no continuation anchor. It is
 * NOT claimed, NOT dispatched, NOT queued and NOT woken — 0031's birth guard enforces that
 * shape independently of this code.
 */
export async function insertChildTurnWithInitialAttempt(
  client: PoolClient,
  scope: OwnerScope,
  input: {
    conversationId: string;
    branchId: string;
    nativeRequestConfigContentId: string;
  },
): Promise<{ turnId: string; attemptId: string }> {
  const turnId = randomUUID();
  const attemptId = randomUUID();
  // The client MINTS `client_turn_id`, so a fork-minted child turn has no client-supplied one.
  // A server mint is safe here — and is not a second send path — because duplicate suppression
  // for this operation is `client_fork_id` (§13), which has already been arbitrated by the time
  // this runs. The column exists to deduplicate SENDS, an operation P0-B does not implement.
  const clientTurnId = randomUUID();

  await client.query(
    'SET CONSTRAINTS govai.ai_conversation_turns_current_attempt_fk DEFERRED',
  );
  await client.query(
    `INSERT INTO govai.ai_conversation_turns
       (id, org_id, owner_user_id, conversation_id, branch_id, client_turn_id, turn_seq,
        current_attempt_id, native_request_config_content_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 1, $7::uuid, $8::uuid)`,
    [
      turnId,
      scope.orgId,
      scope.ownerUserId,
      input.conversationId,
      input.branchId,
      clientTurnId,
      attemptId,
      input.nativeRequestConfigContentId,
    ],
  );
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
