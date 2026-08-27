// Detached conversation worker — RECOVERY DISCOVERY (EP-AI-CONVERSATION-CONTINUITY-V1-01,
// movements P0-A2 + P0-C). Spec: §7.7 (stranded-turn recovery), §8 (durable send / branch
// queue), §9 (detached discovery under FORCE RLS).
//
// Discovery is ADVISORY, exactly as the 0029 run-dispatch precedent is advisory
// (`run-dispatch-recovery.ts`): it LOCATES candidates across owners without impersonating any of
// them. Every authoritative decision — the claim CAS, the lease rotation, the state transition —
// belongs to owner-bound processing under FORCE RLS, and every one of those re-validates on
// DATABASE time under its own durable predicates. P0-A2 implemented the locating half; P0-C
// adds the lawful mutation arms in `ai-conversations/execution/`.
//
// ★ P0-C (P0A2-P3-A4): these functions take the OPAQUE `ConversationWorkerDb` capability, never
// a `pg.Pool`. The definer call's SQL lives inside that capability so it cannot be reached on an
// un-attested connection; what remains here is the DOMAIN projection and the owner-scoped
// re-validation read, which runs on the client the capability hands to `withOwnerContext`.

import type { PoolClient } from 'pg';
import type {
  ConversationWorkerDb,
  DiscoverRecoveryCandidatesInput,
} from './ai-conversation-worker.js';

/**
 * Which §7.7/§8 recovery arm qualified a candidate. Mirrors the `reason` discriminator the 0029
 * discovery function returns, and is advisory: the processor re-validates under its own CAS.
 */
export type RecoveryCandidateReason =
  /** §8 head-of-queue pickup: `accepted`, UNCLAIMED, at the head of its branch queue. NOT
   *  deadline-gated — deadlines govern only the RE-claiming of already-claimed turns. */
  | 'queued_head'
  /** §7.7/§8 re-claim: `accepted` with a claim whose lease has elapsed. */
  | 'accepted_lease_expired'
  /** §7.7: post-boundary `dispatching` whose lease elapsed past the recovery grace δ. */
  | 'dispatching_lease_expired'
  /** §7.7: `streaming` whose lease elapsed past δ — resolved like a lapsed `dispatching` turn. */
  | 'streaming_lease_expired';

/**
 * One content-free claim-plane candidate. Every field here is metadata needed to LOCATE and
 * safely ENTER the candidate's owner context; nothing describes what the conversation contains.
 *
 * ★ `orgId` + `ownerUserId` together ARE the security context every `ai_*` policy consumes. That
 * is precisely why `govai_app` holds no EXECUTE on the underlying function, and why a value of
 * this type must never be constructed from end-user input.
 */
export type RecoveryCandidate = {
  orgId: string;
  ownerUserId: string;
  conversationId: string;
  turnId: string;
  /** The execution instance. Required: every §7.7 fencing predicate (state, claim_token,
   *  provenance) is an ATTEMPT column, and a turn owns several attempts across retries. */
  attemptId: string;
  state: 'accepted' | 'dispatching' | 'streaming';
  reason: RecoveryCandidateReason;
  /** The fencing operand a later rotation CAS compares against; NULL on the unclaimed arm. */
  claimToken: string | null;
  /** Lease expiry as TEXT; NULL on the unclaimed arm. */
  claimDeadlineAt: string | null;
  /** §8 queue eligibility at discovery time — advisory, re-validated under the branch authority. */
  isBranchHead: boolean;
  /** Keyset cursor part, kept as TEXT end-to-end: node-postgres parses a timestamptz into a
   *  millisecond JS Date, and a microsecond-truncated cursor re-qualifies the very row it points
   *  at — the row would be re-selected forever (the 0029 lesson). */
  attemptCreatedAtText: string;
};

/** Keyset resume point, TEXT-precision (see `attemptCreatedAtText`). */
export type RecoveryDiscoveryCursor = { createdAtText: string; attemptId: string };

export type { DiscoverRecoveryCandidatesInput };

/** The function's hard page ceiling, mirrored from migration 0032 for caller-side validation. */
export const DISCOVERY_MAX_LIMIT = 500;

/**
 * Call the ONE sanctioned cross-owner read in the `ai_*` domain, through the worker capability.
 *
 * The capability ATTESTS the connection's database identity before the definer call runs. A pool
 * wired to an admin or superuser credential would otherwise execute discovery happily and hand
 * back cross-owner rows while bypassing FORCE RLS; the attestation makes that fail closed BEFORE
 * the function is invoked.
 *
 * Bounds are validated by the database and are NOT clamped here: an out-of-range page is a
 * caller bug and fails closed (SQLSTATE 22023, the 0029 contract).
 */
export async function discoverRecoveryCandidates(
  db: ConversationWorkerDb,
  input: DiscoverRecoveryCandidatesInput,
): Promise<RecoveryCandidate[]> {
  const rows = await db.discoverRecoveryCandidates(input);
  return rows.map((r) => ({
    orgId: r.org_id,
    ownerUserId: r.owner_user_id,
    conversationId: r.conversation_id,
    turnId: r.turn_id,
    attemptId: r.attempt_id,
    state: r.state,
    reason: r.reason as RecoveryCandidateReason,
    claimToken: r.claim_token,
    claimDeadlineAt: r.claim_deadline_at_text,
    isBranchHead: r.is_branch_head,
    attemptCreatedAtText: r.attempt_created_at_text,
  }));
}

/** The resume point for the page AFTER `candidates`, or null when the page was not full. */
export function nextDiscoveryCursor(
  candidates: readonly RecoveryCandidate[],
  limit: number,
): RecoveryDiscoveryCursor | null {
  if (candidates.length < limit) return null; // page not full ⇒ the candidate set is exhausted
  const last = candidates[candidates.length - 1]!;
  return { createdAtText: last.attemptCreatedAtText, attemptId: last.attemptId };
}

/**
 * The owner-bound re-validation of a discovered candidate: exactly the state a recovery processor
 * must confirm under the OWNER's own RLS before it may act. Every column here is inside the
 * worker's column-scoped grant (0032 + 0034) — the worker cannot read a title even if it tried.
 */
export type OwnedRecoveryCandidate = {
  attemptId: string;
  turnId: string;
  conversationId: string;
  branchId: string;
  attemptSeq: number;
  state: string;
  claimToken: string | null;
  claimant: string | null;
  claimDeadlineAt: string | null;
  heartbeatAt: string | null;
  stopRequested: boolean;
  /** The §7 `B` predicate: the dispatch boundary was crossed, so a provider POST is possible. */
  dispatchBoundaryCommitted: boolean;
  turnSeq: string;
  clientTurnId: string;
  isCurrentAttempt: boolean;
  conversationStatus: string;
};

const OWNED_CANDIDATE_SQL = `SELECT a.id            AS attempt_id,
                a.turn_id       AS turn_id,
                a.conversation_id,
                a.branch_id,
                a.attempt_seq,
                a.state,
                a.claim_token,
                a.claimant,
                a.claim_deadline_at::text AS claim_deadline_at_text,
                a.heartbeat_at::text      AS heartbeat_at_text,
                a.stop_requested,
                (a.dispatch_boundary_committed_at IS NOT NULL) AS boundary_committed,
                t.turn_seq::text          AS turn_seq,
                t.client_turn_id,
                (t.current_attempt_id = a.id)                  AS is_current_attempt,
                c.status                                       AS conversation_status
           FROM govai.ai_conversation_attempts a
           JOIN govai.ai_conversation_turns t
             ON  t.org_id          = a.org_id
             AND t.owner_user_id   = a.owner_user_id
             AND t.conversation_id = a.conversation_id
             AND t.branch_id       = a.branch_id
             AND t.id              = a.turn_id
           JOIN govai.ai_conversations c
             ON  c.org_id        = a.org_id
             AND c.owner_user_id = a.owner_user_id
             AND c.id            = a.conversation_id
          WHERE a.id = $1::uuid AND a.conversation_id = $2::uuid`;

type OwnedCandidateRow = {
  attempt_id: string;
  turn_id: string;
  conversation_id: string;
  branch_id: string;
  attempt_seq: number;
  state: string;
  claim_token: string | null;
  claimant: string | null;
  claim_deadline_at_text: string | null;
  heartbeat_at_text: string | null;
  stop_requested: boolean;
  boundary_committed: boolean;
  turn_seq: string;
  client_turn_id: string;
  is_current_attempt: boolean;
  conversation_status: string;
};

function projectOwnedCandidate(row: OwnedCandidateRow): OwnedRecoveryCandidate {
  return {
    attemptId: row.attempt_id,
    turnId: row.turn_id,
    conversationId: row.conversation_id,
    branchId: row.branch_id,
    attemptSeq: row.attempt_seq,
    state: row.state,
    claimToken: row.claim_token,
    claimant: row.claimant,
    claimDeadlineAt: row.claim_deadline_at_text,
    heartbeatAt: row.heartbeat_at_text,
    stopRequested: row.stop_requested,
    dispatchBoundaryCommitted: row.boundary_committed,
    turnSeq: row.turn_seq,
    clientTurnId: row.client_turn_id,
    isCurrentAttempt: row.is_current_attempt,
    conversationStatus: row.conversation_status,
  };
}

/**
 * Read the owner-scoped candidate on a client ALREADY inside the owner context. Exposed
 * separately so a caller that is already in a worker transaction (the P0-C execution kernel)
 * re-uses that transaction instead of opening a second one.
 *
 * Explicit column lists throughout: the worker's grants are COLUMN-scoped, so `SELECT *` is
 * denied. That is deliberate — a column added by a later migration is not silently readable.
 */
export async function readOwnedRecoveryCandidate(
  tx: PoolClient,
  candidate: { conversationId: string; attemptId: string },
): Promise<OwnedRecoveryCandidate | null> {
  const r = await tx.query<OwnedCandidateRow>(OWNED_CANDIDATE_SQL, [
    candidate.attemptId,
    candidate.conversationId,
  ]);
  const row = r.rows[0];
  return row ? projectOwnedCandidate(row) : null;
}

/**
 * Resolve a discovered candidate INSIDE its owner's transaction-local context.
 *
 * This is the second half of the §9 detached workflow:
 *   worker identity → SECURITY DEFINER discovery → transaction-local owner context
 *   → ordinary least-privilege SQL → FORCE RLS row-scoping → candidate processing.
 *
 * Returns null when the candidate is no longer visible/valid under its owner context — the
 * correct, non-exceptional outcome for a row that changed between discovery and processing.
 */
export async function loadOwnedRecoveryCandidate(
  db: ConversationWorkerDb,
  candidate: Pick<RecoveryCandidate, 'orgId' | 'ownerUserId' | 'conversationId' | 'attemptId'>,
): Promise<OwnedRecoveryCandidate | null> {
  return db.withOwnerContext(
    { orgId: candidate.orgId, ownerUserId: candidate.ownerUserId },
    async (tx: PoolClient) =>
      readOwnedRecoveryCandidate(tx, {
        conversationId: candidate.conversationId,
        attemptId: candidate.attemptId,
      }),
  );
}
