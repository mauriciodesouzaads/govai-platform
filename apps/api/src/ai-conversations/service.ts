// Conversation control-plane service (EP-AI-CONVERSATION-CONTINUITY-V1 P0-B).
//
// Owns the transaction boundaries, the LAW 16 lock choreography and the LAW 10 lifecycle
// serialization. The route above it does HTTP; the store below it does SQL. Safety-critical
// transactions stay in ONE inspectable function each rather than behind a generic repository
// abstraction that would hide where a lock is taken and where a commit happens.
//
// ★ OWNER AUTHORIZATION. Every entry point takes an `OwnerScope` the ROUTE built from the
// authenticated `AuthIdentity` and nothing else. `owner_user_id` is never read from a body,
// query or header, and `withConversationWorkerOwnerContext` (P0-A2's discovery-side entry) is
// never called from here: worker owner identity may originate ONLY from worker discovery, never
// from HTTP input. FORCE RLS remains the authority; these functions only enter the context.
//
// ★ NO PROVIDER I/O, ANYWHERE. This movement performs no provider call, resolves no provider
// credential, mints no claim, starts no worker and wakes no queue. Nothing below opens a
// socket — and nothing below holds a transaction across an await that could.

import type { Pool, PoolClient } from 'pg';
import { withOwnerContext } from '@govai/core-tenant';
import type { Kms } from '@govai/core-identity';
import {
  type ConversationDetail,
  type ConversationListItem,
  type ConversationProvider,
  type CreateConversationInput,
  type CreateForkInput,
  type ForkBoundaryMode,
  type ForkBranchProjection,
  type ListConversationsInput,
  type PatchConversationInput,
} from './contracts.js';
import { decodeConversationCursor, encodeConversationCursor } from './cursor.js';
import { decryptConversationTitle, encryptConversationTitle } from './crypto.js';
import {
  ConversationNotFoundError,
  ForkIdempotencyConflictError,
  ForkIdempotencyLoserSignal,
  ForkPinStateError,
  ForkReplacementConfigRequiredError,
  ForkSourceNotFoundError,
} from './errors.js';
import { FORK_INTENT_HASH_VERSION, buildForkIntent, forkIntentHash } from './fork-intent.js';
import { acquireBranchExecutionAuthority, lockConversationRoot } from './locks.js';
import * as store from './store.js';

export type ConversationServiceDeps = { pool: Pool; kms: Kms };
export type OwnerScope = store.OwnerScope;

/** Raised for a syntactically valid but semantically unusable cursor. */
export class InvalidCursorError extends Error {
  readonly code = 'invalid_cursor';
  constructor() {
    super('cursor is malformed');
    this.name = 'InvalidCursorError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The conversation transaction boundary
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * EVERY ai-conversation transaction enters HERE. Owner RLS context AND an ISO `DateStyle` are one
 * indivisible service-layer boundary (P0B-P2-UNPINNED-TIMESTAMP-PROJECTION-01).
 *
 * ★ WHY THE PIN IS PART OF THE TRANSACTION CONTRACT. A `timestamptz` reaches this process as TEXT
 * rendered by PostgreSQL under the SESSION's `DateStyle`, and nothing in this system pins that:
 * not the bootstrap, not the role, not the pool, not the connection string. Under `German`, `SQL`
 * or `Postgres` the driver's timestamptz parser does not recognise its own input and hands the
 * application a bare `null` — measured, not inferred: `German, DMY` renders
 * `25.08.2026 19:49:46.123456 UTC`, node-postgres returns `null` for it, and
 * `row.created_at.toISOString()` then throws a TypeError. Every projection in this file is built
 * from such a column, so the whole control plane was unusable on such a session.
 *
 * ★ AND IT WAS WORSE THAN A 500 ON TWO OF THE FIVE ROUTES, because the projection sits on
 * DIFFERENT SIDES of the transaction boundary depending on the route. `createConversation` and
 * `patchConversation` project AFTER their transaction has COMMITTED, so the client was told the
 * operation had failed when it had durably succeeded — and create carries no idempotency key
 * (§13 gives one to the fork and none to create), so the natural client retry minted a SECOND
 * conversation. `createFork` and `resolveCommittedFork` project INSIDE their transaction, so
 * those rolled the whole candidate back and failed cleanly. The three integration arms that keep
 * that distinction visible are `ai-conversation-control-plane.test.ts` G1/G3/G5 and
 * `ai-conversation-fork-control-plane.test.ts` L1/L2.
 *
 * ★ THE PARSE HAPPENS INSIDE THE TRANSACTION, WHICH IS WHY A TRANSACTION-LOCAL PIN IS ENOUGH.
 * node-postgres converts a `timestamptz` when the ROW ARRIVES, not when a projection later reads
 * it, so a `created_at` that reaches `projectConversation` after COMMIT was already parsed under
 * this pin. That is what lets create and patch keep projecting outside their transaction: the
 * value they carry out is a real `Date`, never a deferred rendering.
 *
 * ★ WHY HERE, AND NOT AT THE POOL, THE ROLE OR THE DATABASE. The parser behaviour is app-wide, and
 * a global default would close it once for everything — which is precisely why it is not this
 * movement's change to make: it would alter how EVERY query in the system renders timestamps, a
 * far larger claim than this defect supports, and an owner-level architectural decision rather
 * than a side effect of a narrow remediation. What this movement owns is the conversation domain,
 * and the honest fix at that scope is to put the pin on the ONE boundary every conversation
 * transaction already passes through — not to scatter `SET LOCAL` across the store's call sites,
 * where the next store function added would silently not have it.
 *
 * ★ WHY NOT INSIDE `withOwnerContext` ITSELF. That primitive is `@govai/core-tenant`'s and serves
 * every owner-scoped domain in the system; changing its semantics would make this narrow fix a
 * platform-wide behaviour change by the back door. It keeps owning `BEGIN`, both GUCs and
 * COMMIT/ROLLBACK; this wrapper adds the conversation domain's own requirement on top of it.
 *
 * ★ TRANSACTION-LOCAL, and proven so on a `max: 1` pool. `SET LOCAL` dies with the transaction —
 * after COMMIT and after ROLLBACK alike — so the next borrower of that pooled connection finds the
 * session exactly as it was. `DateStyle` is a `USERSET` GUC (`pg_settings.context = 'user'`), so
 * no grant, role or bootstrap change is involved. The pin lands AFTER `BEGIN` and BEFORE any
 * domain statement, which is what makes it cover every read this file performs.
 */
export async function withConversationOwnerContext<T>(
  client: PoolClient,
  scope: OwnerScope,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  return withOwnerContext(client, scope.orgId, scope.ownerUserId, async (c) => {
    await c.query(`SET LOCAL DateStyle = 'ISO, MDY'`);
    return fn(c);
  });
}

/**
 * P0-B ADDRESSABILITY (bounded, and deliberately narrower than the schema).
 *
 * `deleted_pending` and `deleted` are NOT addressable on any P0-B surface. §19 makes deletion an
 * ORDERED protocol — fence, stop-and-wait, provider cleanup, durable handoff, purge — and this
 * movement implements none of it and exposes no DELETE. A conversation can therefore never
 * ENTER those states through P0-B; treating a row that is already in one as "not found" is the
 * only projection this movement can make honestly, because it cannot report progress through a
 * protocol it does not run. The lifecycle ratchet in 0031 is the independent backstop: there is
 * no edge back out of `deleted_pending`, whatever any route does.
 */
export function isAddressable(status: string): boolean {
  return status === 'active' || status === 'archived';
}

/**
 * §7.7's EXECUTION-ELIGIBLE ROOT predicate, verbatim: not `deleted_pending`, not `deleted`.
 *
 * ★ `archived` IS execution-eligible, and that is source, not convenience: §19.1 admits BOTH
 * `active` and `archived` as origins of the `deleted_pending` transition, and only that
 * transition "closes the conversation to new work". Archiving hides a conversation from the
 * default list (§19's truth table); it does not fence it.
 *
 * ★ It coincides with `isAddressable` in P0-B because BOTH exclude exactly the two deleted
 * states — and it is still named separately, because the two concepts diverge the moment a
 * delete protocol exists: §19's `deleted_pending` is a real fencing PHASE during which a
 * conversation is execution-INELIGIBLE while its owner may legitimately still need to READ it.
 * Collapsing them into one predicate now would silently decide that future question here.
 */
export function isExecutionEligible(status: string): boolean {
  return status !== 'deleted_pending' && status !== 'deleted';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Projections
// ─────────────────────────────────────────────────────────────────────────────────────────────

async function projectConversation(
  kms: Kms,
  orgId: string,
  row: store.ConversationRow,
): Promise<ConversationListItem> {
  return {
    id: row.id,
    mode: row.mode,
    provider: row.provider,
    surface: row.surface,
    model: row.model,
    // Narrowed at the boundary: only addressable rows are ever projected (see isAddressable).
    status: row.status as 'active' | 'archived',
    title: await decryptConversationTitle(kms, orgId, row),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    archived_at: row.archived_at ? row.archived_at.toISOString() : null,
  };
}

function projectFork(
  branch: store.ForkBranchRow,
  child: { id: string; attempt_id: string } | null,
): ForkBranchProjection {
  return {
    id: branch.id,
    conversation_id: branch.conversation_id,
    parent_branch_id: branch.parent_branch_id!,
    forked_from_turn_id: branch.forked_from_turn_id,
    forked_from_attempt_id: branch.forked_from_attempt_id,
    boundary_mode: branch.boundary_mode,
    provider: branch.provider,
    surface: branch.surface,
    model: branch.model,
    created_at: branch.created_at.toISOString(),
    child_turn: child,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * §13 create: ONE conversation root AND exactly ONE root branch, atomically. A partial create
 * where the conversation survives without its root branch is forbidden — the branch is the
 * durable owner of execution identity (§3), so a rootless conversation could never dispatch,
 * never fork and never be repaired without inventing a branch after the fact.
 *
 * No lock is taken: the root does not exist yet, so there is nothing to serialize against.
 * LAW 10 governs operations that create a descendant OF AN EXISTING root.
 */
export async function createConversation(
  deps: ConversationServiceDeps,
  scope: OwnerScope,
  input: CreateConversationInput,
): Promise<ConversationDetail> {
  const client = await deps.pool.connect();
  try {
    const { conversation, branch } = await withConversationOwnerContext(
      client,
      scope,
      async (c) => {
        const conversationRow = await store.insertConversation(c, scope, input);
        const branchRow = await store.insertRootBranch(c, scope, {
          conversationId: conversationRow.id,
          // The root branch receives the conversation's creation defaults (§3).
          provider: input.provider,
          surface: input.surface,
          model: input.model,
        });
        return { conversation: conversationRow, branch: branchRow };
      },
    );
    return {
      ...(await projectConversation(deps.kms, scope.orgId, conversation)),
      root_branch: {
        id: branch.id,
        provider: branch.provider,
        surface: branch.surface,
        model: branch.model,
      },
    };
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type ConversationPage = {
  conversations: ConversationListItem[];
  /** Opaque keyset position, or null when this page is the last one. */
  next_cursor: string | null;
};

export async function listConversations(
  deps: ConversationServiceDeps,
  scope: OwnerScope,
  input: ListConversationsInput,
): Promise<ConversationPage> {
  const cursor = input.cursor === undefined ? null : decodeConversationCursor(input.cursor);
  if (input.cursor !== undefined && cursor === null) throw new InvalidCursorError();

  const client = await deps.pool.connect();
  try {
    const page = await withConversationOwnerContext(client, scope, (c) =>
      store.listConversations(c, scope, {
        status: input.status,
        limit: input.limit,
        cursor,
      }),
    );
    // Title decryption happens OUTSIDE the transaction and is bounded by the page size (<= 50,
    // §13/§6): it decrypts exactly the rows the caller's own policies returned, never a scan.
    // `page.rows` is already trimmed to the PUBLIC limit, so the store's boundary sentinel is
    // not among them and is never decrypted.
    const conversations = await Promise.all(
      page.rows.map((row) => projectConversation(deps.kms, scope.orgId, row)),
    );
    const last = page.rows[page.rows.length - 1];
    // A cursor is emitted only when the store PROVED a further row exists. Emitting one for
    // every FULL page instead would be wrong precisely when the total is an exact multiple of
    // the page size: the last page is full too, and the client would follow the cursor into an
    // always-empty page — the opposite of the null-on-last-page contract above.
    const next_cursor =
      page.hasMore && last !== undefined
        ? encodeConversationCursor({ updatedAt: last.updated_at_key, id: last.id })
        : null;
    return { conversations, next_cursor };
  } finally {
    client.release();
  }
}

export async function getConversation(
  deps: ConversationServiceDeps,
  scope: OwnerScope,
  conversationId: string,
): Promise<ConversationDetail> {
  const client = await deps.pool.connect();
  try {
    const found = await withConversationOwnerContext(client, scope, async (c) => {
      const row = await store.getConversation(c, conversationId);
      if (!row || !isAddressable(row.status)) return null;
      const branch = await store.getRootBranch(c, conversationId);
      // 0031 guarantees exactly one root branch per conversation; its absence is an
      // infrastructure invariant break, never a client-visible condition.
      if (!branch) {
        throw new Error(`conversation ${conversationId} has no root branch`);
      }
      return { row, branch };
    });
    if (!found) throw new ConversationNotFoundError();
    return {
      ...(await projectConversation(deps.kms, scope.orgId, found.row)),
      root_branch: {
        id: found.branch.id,
        provider: found.branch.provider,
        surface: found.branch.surface,
        model: found.branch.model,
      },
    };
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Patch — §13's two guarded fields
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Rename and/or archive-restore. Nothing else is reachable: the request schema admits only
 * these two fields, the store's SET list names only their columns, 0033 grants UPDATE on only
 * those columns, and 0031's guard trigger rejects every identity/mode/default change and every
 * unlawful lifecycle edge.
 *
 * The title is encrypted BEFORE the transaction opens. Envelope encryption can be a network
 * call under a real KMS, and holding a row lock across it would serialize every owner behind
 * the KMS's latency — the same "never hold the transaction open across an external call"
 * discipline §9 applies to credential resolution.
 */
export async function patchConversation(
  deps: ConversationServiceDeps,
  scope: OwnerScope,
  conversationId: string,
  input: PatchConversationInput,
): Promise<ConversationDetail> {
  const title =
    input.title === undefined
      ? undefined
      : await encryptConversationTitle(deps.kms, scope.orgId, input.title);

  const client = await deps.pool.connect();
  try {
    const found = await withConversationOwnerContext(client, scope, async (c) => {
      // LAW 10 level (1): take the root authority and REVALIDATE under it. A rename racing the
      // §19.1 `deleted_pending` transition must serialize, not interleave.
      const locked = await lockConversationRoot(c, conversationId);
      if (!locked || !isAddressable(locked.status)) return null;
      const row = await store.updateConversation(c, conversationId, {
        title,
        archived: input.archived,
      });
      if (!row) return null;
      const branch = await store.getRootBranch(c, conversationId);
      if (!branch) throw new Error(`conversation ${conversationId} has no root branch`);
      return { row, branch };
    });
    if (!found) throw new ConversationNotFoundError();
    return {
      ...(await projectConversation(deps.kms, scope.orgId, found.row)),
      root_branch: {
        id: found.branch.id,
        provider: found.branch.provider,
        surface: found.branch.surface,
        model: found.branch.model,
      },
    };
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Fork
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** P0A1-C4, in the request layer so the client gets a useful 409 instead of a bare 500. The
 *  0033 trigger enforces the identical rule structurally; neither is the other's substitute. */
const FORK_PIN_VALID_STATES: Record<ForkBoundaryMode, ReadonlySet<string>> = {
  // The child REPLAYS the pinned attempt's output, so a partial or ineligible prefix is not
  // forkable in this mode (§3).
  after_attempt: new Set(['completed']),
  // The child EXCLUDES that output and copies only the turn-owned immutable user items, so any
  // IMMUTABLE TERMINAL attempt is a lawful source — this is exactly what lets a user regenerate
  // a failed or stopped earlier turn after the branch moved on (§7.6).
  // `outcome_unknown` is absent from BOTH sets: it may still resolve (§7.6's closed probe
  // resolution), so it is not immutable and is never a valid pin.
  before_attempt_output: new Set(['completed', 'stopped', 'failed', 'rejected']),
};

export type ForkResult = {
  branch: ForkBranchProjection;
  /** True when this response REPLAYS an already-committed fork (§13: a lost-response retry
   *  returns the same branch, minting nothing). */
  replay: boolean;
};

export async function createFork(
  deps: ConversationServiceDeps,
  scope: OwnerScope,
  conversationId: string,
  input: CreateForkInput,
): Promise<ForkResult> {
  const client = await deps.pool.connect();
  // Captured from inside the candidate transaction so the loser path can compare the intent it
  // RESOLVED against the committed binding. Resolution is stable across the retry because
  // 0031 freezes a branch's provider/surface/model for its lifetime. A holder object rather
  // than a bare `let`: a value assigned only inside a closure carries no useful narrowing.
  const resolved: { intentHash: Buffer | null } = { intentHash: null };
  try {
    try {
      const created = await withConversationOwnerContext(
        client,
        scope,
        async (c) => {
          // ── LAW 16 (1): conversation root lifecycle authority ─────────────────────────────
          // Taken FIRST and held for the whole transaction. LAW 10: the check and the write
          // live inside one lock, so "validate active -> deletion commits -> child insert
          // succeeds" cannot happen. Either this fork commits and §19's enumeration sees the
          // descendant, or the lifecycle transition commits first and the revalidation below
          // rejects — the only two orderings, both safe.
          const root = await lockConversationRoot(c, conversationId);
          // Unreachable-then-addressable, in that order: a root this caller cannot address is
          // a 404, and a root that is not EXECUTION-ELIGIBLE (§7.7) may create no descendant.
          if (!root || !isAddressable(root.status)) throw new ConversationNotFoundError();
          if (!isExecutionEligible(root.status)) throw new ConversationNotFoundError();

          // The parent branch is resolved BEFORE its authority is taken: the advisory key is
          // derived from a CLIENT-SUPPLIED uuid, and locking an unvalidated id would let a
          // caller take the execution authority of a branch it cannot even read. Resolving
          // first is not a check-then-write race — a branch's identity columns are frozen by
          // 0031's guard and no DELETE authority exists in this domain.
          const parent = await store.getBranchInConversation(c, conversationId, input.parent_branch_id);
          if (!parent) throw new ForkSourceNotFoundError();

          // ── LAW 16 (2): branch execution authority ────────────────────────────────────────
          // The PARENT branch's: it owns the causal boundary this fork pins, and it is the same
          // per-branch primitive every dispatch-boundary commit will hold in P0-C.
          await acquireBranchExecutionAuthority(c, parent.id);

          // Full composite lineage, never an id alone (LAW 1).
          const source = await store.getForkSourceAttempt(c, scope, {
            conversationId,
            parentBranchId: parent.id,
            forkedFromTurnId: input.forked_from_turn_id,
            forkedFromAttemptId: input.forked_from_attempt_id,
          });
          if (!source) throw new ForkSourceNotFoundError();
          if (!FORK_PIN_VALID_STATES[input.boundary_mode].has(source.state)) {
            throw new ForkPinStateError(input.boundary_mode, source.state);
          }

          // §13: an omitted field inherits the parent branch's value. Per-field, so a §17 model
          // switch need not restate the provider it is not changing.
          const provider: ConversationProvider = input.provider ?? parent.provider;
          const surface = input.surface ?? parent.surface;
          const model = input.model ?? parent.model;

          // §3: a `before_attempt_output` fork MINTS a child turn carrying a COPY of the source
          // turn's provider-shaped native request config. That config does not carry over
          // across a provider/surface/model switch, and it is never silently translated — the
          // architecture's own outcome for that shape is REJECTED unless a replacement config
          // is supplied, and P0-B accepts none (see ForkReplacementConfigRequiredError).
          if (
            input.boundary_mode === 'before_attempt_output' &&
            (provider !== parent.provider || surface !== parent.surface || model !== parent.model)
          ) {
            throw new ForkReplacementConfigRequiredError();
          }

          resolved.intentHash = forkIntentHash(
            buildForkIntent({
              conversationId,
              parentBranchId: parent.id,
              forkedFromTurnId: input.forked_from_turn_id,
              forkedFromAttemptId: input.forked_from_attempt_id,
              boundaryMode: input.boundary_mode,
              provider,
              surface,
              model,
            }),
          );

          const branch = await store.insertForkBranch(c, scope, {
            conversationId,
            parentBranchId: parent.id,
            forkedFromTurnId: input.forked_from_turn_id,
            forkedFromAttemptId: input.forked_from_attempt_id,
            boundaryMode: input.boundary_mode,
            provider,
            surface,
            model,
          });

          // The reservation sits AFTER the candidate branch exists and BEFORE every
          // duplicate-sensitive write below — the 0030 TX-A placement. A loser rolls the whole
          // candidate back, so no orphan branch and (critically) no duplicate child turn or
          // attempt can survive a concurrent or retried fork.
          const won = await store.reserveForkIdempotency(c, scope, {
            conversationId,
            clientForkId: input.client_fork_id,
            intentHash: resolved.intentHash,
            intentHashVersion: FORK_INTENT_HASH_VERSION,
            branchId: branch.id,
          });
          if (!won) throw new ForkIdempotencyLoserSignal();

          let child: { id: string; attempt_id: string } | null = null;
          if (input.boundary_mode === 'before_attempt_output') {
            child = await mintRegenerationChild(c, scope, {
              conversationId,
              parentBranchId: parent.id,
              childBranchId: branch.id,
              sourceTurnId: input.forked_from_turn_id,
            });
          }
          return projectFork(branch, child);
        },
      );
      return { branch: created, replay: false };
    } catch (err) {
      if (err instanceof ForkIdempotencyLoserSignal) {
        // The candidate transaction has already been rolled back by the owner context it
        // entered. Answer
        // from the COMMITTED binding in a fresh transaction — a duplicate is a READ, never a
        // second mint and never a verdict about work this request did not do.
        if (resolved.intentHash === null) {
          // The signal is raised only AFTER the intent is resolved and hashed; reaching here
          // would mean the reservation moved ahead of the resolution.
          throw new Error('fork reservation was lost before its intent was resolved');
        }
        return await resolveCommittedFork(
          client,
          scope,
          conversationId,
          input.client_fork_id,
          resolved.intentHash,
        );
      }
      throw err;
    }
  } finally {
    client.release();
  }
}

/**
 * §3's regeneration child, minted INSIDE the fork transaction: the child branch's first turn,
 * copying the source turn's IMMUTABLE user items and its IMMUTABLE native request config, plus
 * that turn's fresh initial attempt with `current_attempt_id` set — all atomic with the fork.
 *
 * ★ WHAT IT DELIBERATELY DOES NOT DO (§16 of the movement dispatch): it does not CLAIM the
 * attempt, does not cross a dispatch boundary, does not resolve a credential, does not POST,
 * does not start a worker and does not wake a queue. The attempt is born `accepted` and
 * UNCLAIMED — 0031's birth guard enforces exactly that, independently of this code.
 */
async function mintRegenerationChild(
  c: PoolClient,
  scope: OwnerScope,
  input: {
    conversationId: string;
    parentBranchId: string;
    childBranchId: string;
    sourceTurnId: string;
  },
): Promise<{ id: string; attempt_id: string }> {
  const sourceLineage = {
    conversationId: input.conversationId,
    branchId: input.parentBranchId,
    turnId: input.sourceTurnId,
  };
  const sourceTurn = await store.getTurnInLineage(c, scope, sourceLineage);
  // Unreachable while the pinned attempt resolved above: the attempt's composite FK proves its
  // turn exists in this exact lineage. Fail loudly rather than mint a turn with no input.
  if (!sourceTurn) throw new ForkSourceNotFoundError();

  const configContentId = await store.copyContentRow(
    c,
    input.conversationId,
    sourceTurn.native_request_config_content_id,
  );
  if (!configContentId) {
    // The only way an active source turn's config is uncopyable is a crypto-shredded blob
    // (§19). Minting a child whose durable config can never be decrypted would create exactly
    // the turn a detached dispatch cannot reconstruct — LAW 5's failure mode.
    throw new Error('fork source native request config is not copyable');
  }

  const { turnId, attemptId } = await store.insertChildTurnWithInitialAttempt(c, scope, {
    conversationId: input.conversationId,
    branchId: input.childBranchId,
    nativeRequestConfigContentId: configContentId,
  });

  // LAW 2: user/input items are TURN-OWNED and immutable from the reservation commit, so the
  // child copies them; attempt-owned OUTPUT is excluded by the boundary mode itself.
  const items = await store.listTurnOwnedItems(c, scope, sourceLineage);
  for (const item of items) {
    const copiedContentId = await store.copyContentRow(c, input.conversationId, item.content_id);
    if (!copiedContentId) throw new Error('fork source input item content is not copyable');
    await store.insertTurnOwnedItem(c, scope, {
      conversationId: input.conversationId,
      branchId: input.childBranchId,
      turnId,
      itemSeq: item.item_seq,
      itemType: item.item_type,
      contentId: copiedContentId,
    });
  }

  return { id: turnId, attempt_id: attemptId };
}

async function resolveCommittedFork(
  client: PoolClient,
  scope: OwnerScope,
  conversationId: string,
  clientForkId: string,
  intentHash: Buffer,
): Promise<ForkResult> {
  return withConversationOwnerContext(client, scope, async (c) => {
    const binding = await store.findForkBinding(c, conversationId, clientForkId);
    if (!binding) {
      // `ON CONFLICT DO NOTHING` waits for the conflicting transaction, so losing the
      // reservation means a binding COMMITTED. Its absence here is an invariant break.
      throw new Error('fork reservation was lost but no committed binding is readable');
    }
    if (!binding.fork_intent_hash.equals(intentHash)) {
      throw new ForkIdempotencyConflictError();
    }
    const branch = await store.getForkBranch(c, conversationId, binding.branch_id);
    if (!branch) throw new Error('fork binding references an unreadable branch');
    // ★ THE REPLAY REPRODUCES THE FORK-TIME RESULT (P0B-P2-FORK-REPLAY-RECONSTRUCTION-01).
    // `boundary_mode` is the first authority, because it decides what the fork MINTED — not what
    // the branch happens to hold now. An `after_attempt` fork mints no child rows at all (§3), so
    // its `child_turn` is `null` FOREVER: the first ordinary Send P0-C adds to that branch is a
    // turn the fork did not create, and returning it would silently change a committed answer.
    // A `before_attempt_output` fork minted exactly one child turn and its fresh initial attempt,
    // and those are recovered by their IMMUTABLE sequence identities rather than by the turn's
    // `current_attempt_id`, which a retry is entitled to advance.
    const child =
      branch.boundary_mode === 'before_attempt_output'
        ? await store.getForkMintedChildTurn(c, scope, {
            conversationId,
            branchId: branch.id,
          })
        : null;
    if (branch.boundary_mode === 'before_attempt_output' && child === null) {
      // The child is minted ATOMICALLY with the branch and the binding inside one transaction, so
      // a committed `before_attempt_output` binding without it is an invariant break, never a
      // client-visible condition.
      throw new Error('fork binding references a before_attempt_output branch with no child turn');
    }
    return { branch: projectFork(branch, child), replay: true };
  });
}
