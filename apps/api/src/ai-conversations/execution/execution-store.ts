// The FENCED execution plane (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C; spec §7.7/§8/§9).
//
// Every function here runs on a client the worker capability has ALREADY attested and placed
// inside the candidate's owner context (`ConversationWorkerDb.withOwnerContext`). Nothing here
// opens a transaction, sets a GUC, resolves an identity, or performs network I/O.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE ONE RULE THIS MODULE EXISTS TO ENFORCE
//
//   EVERY durable mutation after the claim proves CURRENT token authority in its own WHERE
//   clause. Not in a preceding read, not in an application-level `if`, not in a comment: in the
//   predicate of the statement that writes. A stale claimant is not "unlikely to win a race" —
//   it CANNOT match a row, because the token it holds is no longer the row's token.
//
// That is what makes at-most-one-POST safe under re-drive (§8): boundary-before-POST alone does
// NOT serialize two claimants, because a stalled owner can resume at any time. The fencing token
// is the serializer, and the DB row is its single arbiter.
//
// Two further disciplines, both load-bearing:
//   * DATABASE TIME, ALWAYS. Every lease comparison is `now()` inside the statement, never an
//     application clock differenced against a fetched timestamp. Two workers with skewed clocks
//     must not disagree about whether a lease has expired (the 0029 rule).
//   * NO LOCK IS HELD ACROSS PROVIDER I/O. Each function below is ONE short statement (or a lock
//     plus one statement). The transaction that contains it commits and releases before any
//     `fetch` is reached — the §8 five-commit protocol exists precisely so that no database
//     client is open while the provider is being called.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

/** The §7 non-terminal states that block a branch's queue (§8 branch-order predicate). */
const NON_TERMINAL_STATES = "('accepted', 'dispatching', 'streaming')";

/**
 * The §8 branch-order predicate, as a correlated NOT EXISTS over the attempt row `a`.
 *
 * ★ FAIL-CLOSED ON AN UNPROVABLE SIBLING. A turn whose `current_attempt_id` is NULL blocks: a
 * torn reservation is UNPROVEN, and unproven is treated as non-terminal. (0031's deferred FK
 * makes such a row unrepresentable at COMMIT, so this is a guard, not a routine path — the same
 * expression 0032's discovery function already uses, kept textually parallel on purpose.)
 */
const BRANCH_HEAD_PREDICATE = `NOT EXISTS (
      SELECT 1
        FROM govai.ai_conversation_turns t2
       WHERE t2.org_id          = a.org_id
         AND t2.owner_user_id   = a.owner_user_id
         AND t2.conversation_id = a.conversation_id
         AND t2.branch_id       = a.branch_id
         AND t2.turn_seq        < (SELECT t.turn_seq
                                     FROM govai.ai_conversation_turns t
                                    WHERE t.org_id          = a.org_id
                                      AND t.owner_user_id   = a.owner_user_id
                                      AND t.conversation_id = a.conversation_id
                                      AND t.branch_id       = a.branch_id
                                      AND t.id              = a.turn_id)
         AND (
           t2.current_attempt_id IS NULL
           OR EXISTS (
             SELECT 1
               FROM govai.ai_conversation_attempts a2
              WHERE a2.org_id          = t2.org_id
                AND a2.owner_user_id   = t2.owner_user_id
                AND a2.conversation_id = t2.conversation_id
                AND a2.branch_id       = t2.branch_id
                AND a2.turn_id         = t2.id
                AND a2.id              = t2.current_attempt_id
                AND a2.state IN ${NON_TERMINAL_STATES}
           )
         )
    )`;

export type ClaimGrant = {
  claimToken: string;
  claimant: string;
  /** Lease expiry as rendered by the database, TEXT-precision. */
  claimDeadlineAt: string;
};

/**
 * §8 commit 2 — the HEAD-OF-QUEUE CLAIM CAS on an UNCLAIMED `accepted` attempt.
 *
 * Predicates, each one load-bearing:
 *   state = 'accepted'          only a pre-boundary attempt is claimable from scratch
 *   claim_token IS NULL         UNCLAIMED — this arm never steals a live claim; re-claiming an
 *                               expired one is `rotateExpiredAcceptedClaim`, a different CAS
 *                               with a different proof
 *   stop_requested = false      a discarded queued turn is not work
 *   branch-order                §8: only the branch head may execute
 *
 * ★ NOT DEADLINE-GATED, and that is deliberate (§8): head-of-queue pickup has no deadline to
 * gate on, because an unclaimed reservation has no lease. Deadlines govern only the RE-claiming
 * of already-claimed turns. Gating here would leave freshly reserved turns unclaimable.
 *
 * Returns null when this worker did NOT win — the ordinary outcome of a race, never an error.
 */
export async function claimQueuedHead(
  tx: PoolClient,
  input: { attemptId: string; claimant: string; leaseMs: number },
): Promise<ClaimGrant | null> {
  const claimToken = randomUUID();
  const r = await tx.query<{ claim_deadline_at: string }>(
    `UPDATE govai.ai_conversation_attempts a
        SET claim_token       = $2::uuid,
            claimant          = $3::text,
            claim_deadline_at = now() + make_interval(secs => $4::double precision),
            heartbeat_at      = now(),
            updated_at        = now()
      WHERE a.id = $1::uuid
        AND a.state = 'accepted'
        AND a.claim_token IS NULL
        AND a.stop_requested = false
        AND ${BRANCH_HEAD_PREDICATE}
      RETURNING a.claim_deadline_at::text AS claim_deadline_at`,
    [input.attemptId, claimToken, input.claimant, input.leaseMs / 1000],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { claimToken, claimant: input.claimant, claimDeadlineAt: row.claim_deadline_at };
}

/**
 * §7.7 — RE-CLAIM a past-deadline `accepted` attempt by ROTATING its claim token.
 *
 * From this commit on, the expired owner — merely stalled, not dead — can no longer pass its
 * boundary CAS, so it can never POST. The rotation IS the fence.
 *
 * `claim_deadline_at < now()` is evaluated on DATABASE time, and the expected token is a
 * predicate: a worker that read a stale candidate row cannot rotate a claim that has meanwhile
 * moved to a third party.
 */
export async function rotateExpiredAcceptedClaim(
  tx: PoolClient,
  input: { attemptId: string; expectedToken: string; claimant: string; leaseMs: number },
): Promise<ClaimGrant | null> {
  const claimToken = randomUUID();
  const r = await tx.query<{ claim_deadline_at: string }>(
    `UPDATE govai.ai_conversation_attempts a
        SET claim_token       = $3::uuid,
            claimant          = $4::text,
            claim_deadline_at = now() + make_interval(secs => $5::double precision),
            heartbeat_at      = now(),
            updated_at        = now()
      WHERE a.id = $1::uuid
        AND a.state = 'accepted'
        AND a.claim_token = $2::uuid
        AND a.claim_deadline_at < now()
        AND a.stop_requested = false
        AND ${BRANCH_HEAD_PREDICATE}
      RETURNING a.claim_deadline_at::text AS claim_deadline_at`,
    [input.attemptId, input.expectedToken, claimToken, input.claimant, input.leaseMs / 1000],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { claimToken, claimant: input.claimant, claimDeadlineAt: row.claim_deadline_at };
}

/**
 * §7.7 PROVENANCE-ABSENT RECLAIM — restore a stranded `dispatching` attempt to `accepted`.
 *
 * ★ THE SAFETY PROOF IS A DURABLE PREDICATE, NOT A NARRATIVE PRECONDITION.
 * `provider_credential_id IS NULL` sits IN the CAS because §8 commits credential provenance
 * BEFORE every POST: provenance absent ⇒ commit 4 never happened ⇒ no provider request can
 * exist. Reading that fact first and then writing would be a check-then-write race — a commit-4
 * landing concurrently would either commit first (this CAS then matches ZERO rows, and the
 * provenance-PRESENT rule governs) or lose its own `claim_token` predicate to this rotation.
 * The two serialize on the attempt row, so a restored attempt can NEVER coexist with an owner
 * still able to complete commit 4 and POST.
 *
 * `deadline + δ` (not merely `deadline`) is §7.7 rule (2)'s recovery grace: a runner that
 * validates its lease in time POSTs before recovery moves.
 *
 * The restore RETAINS `dispatch_boundary_committed_at` (0031 makes it write-once) and
 * `govai_request_id` (§14.1: one mint site, and a restore is not a new invocation). It does NOT
 * clear `causal_version_at_build` — 0031's post-boundary causal freeze is keyed on the STATE
 * EDGE, so returning to `accepted` re-opens those columns for the NEXT boundary crossing to
 * re-stamp.
 *
 * ★ ONLY on an EXECUTION-ELIGIBLE root. On a `deleted_pending` root §19.2 prescribes a terminal
 * `stopped` ratchet instead — deletion fencing would make a restored `accepted` attempt
 * unclaimable and hang the purge. P0-C implements no delete protocol, so it declines to act on
 * such a root at all rather than guessing (see `isRootExecutionEligible`).
 */
export async function restoreProvenanceAbsentDispatching(
  tx: PoolClient,
  input: { attemptId: string; expectedToken: string; claimant: string; leaseMs: number; graceMs: number },
): Promise<ClaimGrant | null> {
  const claimToken = randomUUID();
  const r = await tx.query<{ claim_deadline_at: string }>(
    `UPDATE govai.ai_conversation_attempts a
        SET state             = 'accepted',
            claim_token       = $3::uuid,
            claimant          = $4::text,
            claim_deadline_at = now() + make_interval(secs => $5::double precision),
            heartbeat_at      = now(),
            updated_at        = now()
      WHERE a.id = $1::uuid
        AND a.state = 'dispatching'
        AND a.claim_token = $2::uuid
        AND a.provider_credential_id IS NULL
        AND a.claim_deadline_at + make_interval(secs => $6::double precision) < now()
      RETURNING a.claim_deadline_at::text AS claim_deadline_at`,
    [
      input.attemptId,
      input.expectedToken,
      claimToken,
      input.claimant,
      input.leaseMs / 1000,
      input.graceMs / 1000,
    ],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { claimToken, claimant: input.claimant, claimDeadlineAt: row.claim_deadline_at };
}

/**
 * §7.7 — ratchet a stranded POST-BOUNDARY attempt WITH provenance to `outcome_unknown`.
 *
 * Provenance present means a provider POST MAY already exist, so re-drive is forbidden and the
 * only honest durable answer is "the dispatch fate is unprovable". This is NOT a failure verdict
 * and must never be reported as one: `failed` would assert the provider did not process the
 * request, which nobody can know here.
 *
 * The 0031 CHECKs `outcome_unknown ⟹ B` and `outcome_unknown ⟹ P` make the unlawful shapes
 * unrepresentable independently of this predicate.
 */
export async function ratchetStrandedToOutcomeUnknown(
  tx: PoolClient,
  input: { attemptId: string; expectedToken: string; graceMs: number },
): Promise<boolean> {
  const r = await tx.query(
    `UPDATE govai.ai_conversation_attempts a
        SET state       = 'outcome_unknown',
            terminal_at = now(),
            updated_at  = now()
      WHERE a.id = $1::uuid
        AND a.state IN ('dispatching', 'streaming')
        AND a.claim_token = $2::uuid
        AND a.provider_credential_id IS NOT NULL
        AND a.claim_deadline_at + make_interval(secs => $3::double precision) < now()`,
    [input.attemptId, input.expectedToken, input.graceMs / 1000],
  );
  return (r.rowCount ?? 0) === 1;
}

/**
 * LAW 16 level (1) at the dispatch boundary: take the conversation root in `FOR KEY SHARE` and
 * report whether it is still EXECUTION-ELIGIBLE.
 *
 * ★ WHY A SHARE LOCK AND NOT A READ. `FOR KEY SHARE` CONFLICTS with the `FOR UPDATE` that §19
 * step 1's `deleted_pending` transition will take. That makes the ordering RIGOROUS rather than
 * probabilistic: either this boundary commits first (its attempt is then non-terminal, and §19
 * step 2's stop-and-wait fencing covers it), or the deletion commits first and the predicate
 * below sees it and aborts. A plain read admits a third ordering — deletion committing between
 * the read and the boundary write — in which a mid-context-build attempt POSTs after deletion
 * fencing began.
 *
 * ★ IT MUST BE TAKEN BEFORE THE ATTEMPT UPDATE. LAW 16 forbids acquiring a higher lock level
 * after a lower one; the attempt write is level (3).
 *
 * ★ Taking ANY row lock requires `ACL_UPDATE` on the table (`ACL_SELECT_FOR_UPDATE` is defined
 * as `ACL_UPDATE`), which is exactly why migration 0034 grants the worker `UPDATE (updated_at)`
 * on `ai_conversations` and nothing more. The worker issues no UPDATE against this table.
 */
export async function lockRootForDispatch(
  tx: PoolClient,
  conversationId: string,
): Promise<{ status: string } | null> {
  const r = await tx.query<{ status: string }>(
    `SELECT status FROM govai.ai_conversations WHERE id = $1::uuid FOR KEY SHARE`,
    [conversationId],
  );
  return r.rows[0] ?? null;
}

/** §7.7's EXECUTION-ELIGIBLE ROOT predicate (LAW 10), in the POSITIVE form so a status added by
 *  a future migration is excluded — fails CLOSED — rather than silently admitted. */
export function isRootExecutionEligible(status: string): boolean {
  return status === 'active' || status === 'archived';
}

export type BoundaryCommitResult =
  | { ok: true; govaiRequestId: string; claimDeadlineAt: string }
  | { ok: false };

/**
 * §8 commit 3 — THE DISPATCH BOUNDARY. Written BEFORE any provider POST.
 *
 * The CAS proves, in one statement, every fact the POST depends on:
 *   state = 'accepted'              the attempt has not already crossed, terminalized or moved
 *   claim_token = <mine>            THIS worker still owns it (the fence)
 *   claim_deadline_at > now()       the lease has not lapsed DURING context construction.
 *                                   Without this predicate the CAS would commit `dispatching`,
 *                                   the pre-POST lease check would then abort with no POST ever
 *                                   sent, and recovery would ratchet a PROVABLY-UNDISPATCHED
 *                                   attempt to `outcome_unknown` — inventing ambiguity out of an
 *                                   ordinary lease lapse. Failing the CAS instead leaves the
 *                                   attempt `accepted` and ordinarily reclaimable.
 *   stop_requested = false          a Stop that linearizes before the boundary prevents the POST
 *                                   outright. The flag is its ONLY authority in this window: the
 *                                   wake notification can be lost, and the flag-reading
 *                                   heartbeat timer does not start until the boundary commits.
 *   branch-order                    §8 single-flight: the earlier turn is still running
 *   causal_version = <as sampled>   §7.8: the branch has not advanced since this dispatch cycle
 *                                   sampled it. ★ STATED PRECISELY, BECAUSE THE OBVIOUS READING
 *                                   OVERCLAIMS: in P0-C the request body is the CLIENT's stored
 *                                   provider-native request, so this predicate does NOT certify
 *                                   that GovAI-assembled context is fresh — GovAI assembles none
 *                                   (see `execute-turn.ts`, "THE CONTEXT CONTRACT"). What it
 *                                   does certify is that no sibling turn on this branch
 *                                   terminalized between the sample and the boundary, which is
 *                                   what keeps the single-flight queue and the §7.8 monotonic
 *                                   ordering coherent.
 *
 * The winning commit also:
 *   * stamps a FRESH deadline — the lease's first renewal, consistent with the heartbeat timer
 *     starting at the boundary;
 *   * MINTS `govai_request_id` IF NULL — §14.1's ONE authoritative mint site. `COALESCE` rather
 *     than assignment, because a §9-step-4 restore RETAINS the identity and a re-crossing must
 *     not mint a second one (0031 makes the column write-once, so an assignment would also be
 *     rejected outright);
 *   * stamps `dispatch_boundary_committed_at` IF NULL — write-once, RETAINED across a restore;
 *   * stamps the as-built `causal_version_at_build` (0031's causal freeze re-opens on the
 *     `accepted` edge precisely so a rebuild may re-stamp it).
 *
 * `ok: false` means fenced out, lease-expired, stop-requested, not at head, or causally stale.
 * The caller reads the row under its still-held claim to learn WHICH — and, critically, does NOT
 * POST.
 */
export async function commitDispatchBoundary(
  tx: PoolClient,
  input: {
    attemptId: string;
    claimToken: string;
    leaseMs: number;
    causalVersionAtBuild: string;
    /** Minted by the caller; persisted ONLY if the column is still NULL. */
    candidateRequestId: string;
  },
): Promise<BoundaryCommitResult> {
  const r = await tx.query<{ govai_request_id: string; claim_deadline_at: string }>(
    `UPDATE govai.ai_conversation_attempts a
        SET state                          = 'dispatching',
            dispatch_boundary_committed_at = COALESCE(a.dispatch_boundary_committed_at, now()),
            govai_request_id               = COALESCE(a.govai_request_id, $5::uuid),
            causal_version_at_build        = $4::bigint,
            claim_deadline_at              = now() + make_interval(secs => $3::double precision),
            heartbeat_at                   = now(),
            updated_at                     = now()
      WHERE a.id = $1::uuid
        AND a.state = 'accepted'
        AND a.claim_token = $2::uuid
        AND a.claim_deadline_at > now()
        AND a.stop_requested = false
        AND EXISTS (
          SELECT 1 FROM govai.ai_conversation_branches b
           WHERE b.org_id          = a.org_id
             AND b.owner_user_id   = a.owner_user_id
             AND b.conversation_id = a.conversation_id
             AND b.id              = a.branch_id
             AND b.causal_version  = $4::bigint
        )
        AND ${BRANCH_HEAD_PREDICATE}
      RETURNING a.govai_request_id, a.claim_deadline_at::text AS claim_deadline_at`,
    [
      input.attemptId,
      input.claimToken,
      input.leaseMs / 1000,
      input.causalVersionAtBuild,
      input.candidateRequestId,
    ],
  );
  const row = r.rows[0];
  if (!row) return { ok: false };
  return {
    ok: true,
    govaiRequestId: row.govai_request_id,
    claimDeadlineAt: row.claim_deadline_at,
  };
}

/**
 * §8 commit 4 — CREDENTIAL PROVENANCE, in its OWN short transaction inside the `dispatching`
 * window, and BEFORE any provider POST.
 *
 * Why this commit is load-bearing, in three independent ways:
 *   1. RECOVERY CORRECTNESS. Its presence/absence IS the durable discriminator between
 *      "provably undispatched" (restore) and "fate unprovable" (`outcome_unknown`). Without it,
 *      every post-boundary crash would have to be treated as ambiguous.
 *   2. ACCOUNT PROVENANCE ACROSS ROTATION. Provider objects are account-scoped. A later probe
 *      or cleanup must resolve the credential the POST ACTUALLY used, not whichever one is
 *      active later.
 *   3. TENANT SAFETY. 0031's ORG-COMPOSITE FK `(org_id, provider_credential_id)` makes an
 *      attempt of org A referencing org B's credential structurally unrepresentable.
 *
 * The SAME transaction REVALIDATES that the resolved row is STILL the org's ACTIVE credential
 * for this provider: a rotation that slipped into the boundary→commit-4 window fails this
 * commit, and the caller then performs the fenced restore rather than POSTing under superseded
 * material.
 *
 * `provider_credential_id IS NULL` is a predicate as well as a guard-trigger rule: this commit
 * happens exactly once per dispatch cycle.
 */
export async function commitCredentialProvenance(
  tx: PoolClient,
  input: {
    attemptId: string;
    claimToken: string;
    providerCredentialId: string;
    provider: 'anthropic' | 'openai';
  },
): Promise<boolean> {
  const r = await tx.query(
    `UPDATE govai.ai_conversation_attempts a
        SET provider_credential_id = $3::uuid,
            updated_at             = now()
      WHERE a.id = $1::uuid
        AND a.state = 'dispatching'
        AND a.claim_token = $2::uuid
        AND a.claim_deadline_at > now()
        AND a.provider_credential_id IS NULL
        AND EXISTS (
          SELECT 1 FROM govai.provider_credentials pc
           WHERE pc.id       = $3::uuid
             AND pc.org_id   = a.org_id
             AND pc.provider = $4::text
             AND pc.status   = 'active'
        )`,
    [input.attemptId, input.claimToken, input.providerCredentialId, input.provider],
  );
  return (r.rowCount ?? 0) === 1;
}

/**
 * §9 step-4 FENCED RESTORE — `dispatching → accepted`, claim RETAINED with a fresh deadline.
 *
 * Used when commit 4 fails on a credential rotation that slipped into the boundary window. Safe
 * by exactly the provably-no-POST proof: commit 4 precedes any POST, so no provider request can
 * exist. The built request is discarded and the whole context step re-runs from a fresh sample.
 *
 * ★ `claim_deadline_at > now()` IS REQUIRED HERE. The restore stamps a fresh deadline, which
 * makes it an authority EXTENSION. Without the predicate an EXPIRED claimant that stalled inside
 * this window could regain authority and postpone recovery indefinitely. An expired-lease
 * restore therefore FAILS, and ordinary lease recovery takes over — landing in the
 * provenance-absent reclaim arm, which reaches the same durable place through the sweep.
 */
export async function restoreDispatchingToAccepted(
  tx: PoolClient,
  input: { attemptId: string; claimToken: string; leaseMs: number },
): Promise<boolean> {
  const r = await tx.query(
    `UPDATE govai.ai_conversation_attempts a
        SET state             = 'accepted',
            claim_deadline_at = now() + make_interval(secs => $3::double precision),
            heartbeat_at      = now(),
            updated_at        = now()
      WHERE a.id = $1::uuid
        AND a.state = 'dispatching'
        AND a.claim_token = $2::uuid
        AND a.claim_deadline_at > now()
        AND a.provider_credential_id IS NULL`,
    [input.attemptId, input.claimToken, input.leaseMs / 1000],
  );
  return (r.rowCount ?? 0) === 1;
}

export type PrePostAuthority = {
  state: string;
  leaseValid: boolean;
  stopRequested: boolean;
};

/**
 * §7.7 rule (1) — the PRE-POST re-validation, issued immediately before the provider call.
 *
 * ★ NEVER REASON "the boundary committed earlier, so I must still be authoritative." The lease
 * is CURRENT authority, and context construction plus credential resolution can outlast it. A
 * runner that stalls between its boundary commit and its POST must discover that recovery has
 * moved on — and must not send the request that would race the next turn.
 *
 * The lease comparison is done by the DATABASE (`claim_deadline_at > now()` projected as a
 * boolean), not by differencing a fetched timestamp against a local clock.
 */
export async function readPrePostAuthority(
  tx: PoolClient,
  input: { attemptId: string; claimToken: string },
): Promise<PrePostAuthority | null> {
  const r = await tx.query<{ state: string; lease_valid: boolean; stop_requested: boolean }>(
    `SELECT a.state,
            (a.claim_deadline_at > now()) AS lease_valid,
            a.stop_requested
       FROM govai.ai_conversation_attempts a
      WHERE a.id = $1::uuid AND a.claim_token = $2::uuid`,
    [input.attemptId, input.claimToken],
  );
  const row = r.rows[0];
  if (!row) return null; // token rotated: authority is gone, full stop.
  return { state: row.state, leaseValid: row.lease_valid, stopRequested: row.stop_requested };
}

export type HeartbeatResult = { extended: boolean; stopRequested: boolean; state: string | null };

/**
 * §7.7 — TIMER-DRIVEN lease renewal, fenced.
 *
 * ★ Extends ONLY a CURRENT claim: the token predicate means a rotated-out worker's heartbeat
 * matches zero rows and it learns it has lost authority. `claim_deadline_at > now()` is
 * required for the same reason as on the restore — a heartbeat is an authority EXTENSION, and an
 * already-expired claimant must not be able to resurrect its own lease and postpone recovery
 * forever.
 *
 * ★ THE SAME TICK READS `stop_requested`. Both lease renewal and stop observation are therefore
 * bounded by the heartbeat interval EVEN WHEN THE PROVIDER PRODUCES NO EVENTS AT ALL — a stalled
 * stream yields no pump iterations, so "check between events" alone would let a Stop pend
 * indefinitely while the lease stayed alive. P0-C ships no public Stop endpoint, but the read is
 * here because the authority model must be complete before the command exists: a Stop written
 * directly to the row (as the tests do) is honored today.
 */
export async function heartbeatClaim(
  tx: PoolClient,
  input: { attemptId: string; claimToken: string; leaseMs: number },
): Promise<HeartbeatResult> {
  const r = await tx.query<{ stop_requested: boolean; state: string }>(
    `UPDATE govai.ai_conversation_attempts a
        SET claim_deadline_at = now() + make_interval(secs => $3::double precision),
            heartbeat_at      = now(),
            updated_at        = now()
      WHERE a.id = $1::uuid
        AND a.claim_token = $2::uuid
        AND a.claim_deadline_at > now()
        AND a.state IN ('dispatching', 'streaming')
      RETURNING a.stop_requested, a.state`,
    [input.attemptId, input.claimToken, input.leaseMs / 1000],
  );
  const row = r.rows[0];
  if (!row) return { extended: false, stopRequested: false, state: null };
  return { extended: true, stopRequested: row.stop_requested, state: row.state };
}

/**
 * `dispatching → streaming`, fenced.
 *
 * ★ WHY EVERY SUCCESSFUL DISPATCH PASSES THROUGH `streaming`, INCLUDING A NON-STREAM ONE.
 * 0031's forward graph — and §7's own diagram — admit `completed` ONLY from `streaming`; there
 * is no `dispatching → completed` edge in either. `streaming` is therefore the schema's
 * POST-POST RECEIVING state, not an SSE-only state. A non-stream dispatch passes through it in
 * one commit. Inventing an edge to skip it would mean editing 0031's guard trigger, which is
 * frozen historical source.
 *
 * This is also the first state for which 0031 requires provenance
 * (`streaming|completed ⟹ provider_credential_id IS NOT NULL`), so reaching it without commit 4
 * is structurally impossible.
 */
export async function markStreaming(
  tx: PoolClient,
  input: { attemptId: string; claimToken: string },
): Promise<boolean> {
  const r = await tx.query(
    `UPDATE govai.ai_conversation_attempts a
        SET state = 'streaming', updated_at = now()
      WHERE a.id = $1::uuid
        AND a.state = 'dispatching'
        AND a.claim_token = $2::uuid`,
    [input.attemptId, input.claimToken],
  );
  return (r.rowCount ?? 0) === 1;
}

/**
 * Append ONE attempt-owned output item, FENCED.
 *
 * ★ EVERY INCREMENTAL WRITE IS FENCED, NOT JUST THE FINALIZE (§7.7). An `INSERT` has no row to
 * carry a `WHERE`, so the fence is expressed as `INSERT ... SELECT ... WHERE` over the attempt
 * row: the insert produces a row only if the attempt still carries THIS claim token and is still
 * in a post-boundary receiving state. A zombie that resumes after rotation therefore cannot
 * append output — its output never becomes part of the durable answer, and never becomes context.
 *
 * Returns false when the fence rejected the append; the caller stops driving.
 */
export async function appendFencedOutputItem(
  tx: PoolClient,
  input: {
    attemptId: string;
    claimToken: string;
    itemSeq: number;
    itemType: string;
    contentId: string;
  },
): Promise<boolean> {
  const r = await tx.query(
    `INSERT INTO govai.ai_conversation_items
       (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id,
        item_seq, item_type, content_id)
     SELECT a.org_id, a.owner_user_id, a.conversation_id, a.branch_id, a.turn_id, a.id,
            $3::integer, $4::text, $5::uuid
       FROM govai.ai_conversation_attempts a
      WHERE a.id = $1::uuid
        AND a.claim_token = $2::uuid
        AND a.state IN ('dispatching', 'streaming')`,
    [input.attemptId, input.claimToken, input.itemSeq, input.itemType, input.contentId],
  );
  return (r.rowCount ?? 0) === 1;
}

/**
 * The §7.4 failure taxonomy, exactly as the database CHECK admits it (0031 + 0035).
 *
 * ★ THE LAST TWO ARE GOVAI-LOCAL AND OPERATIONALLY OPPOSITE. `local_error` means GovAI failed
 * BEFORE any transmission, so the provider provably did not process the request. That is exactly
 * the situation `outcome_unknown` must NOT be used for. `persistence_error` means the provider
 * ANSWERED — status observed — and GovAI then failed to record it; that is also not ambiguous,
 * and it is not safe to retry, because the provider already did the work.
 */
export type AttemptErrorClass =
  | 'blocked'
  | 'auth_rejected'
  | 'request_too_large'
  | 'rate_limited'
  | 'credential_unavailable'
  | 'provider_error'
  | 'local_error'
  | 'persistence_error';

/**
 * §8 commit 5 — the FENCED FINALIZE.
 *
 * ★ A ZOMBIE THAT SLIPS THROUGH EVERY EARLIER GUARD STILL CANNOT WRITE. Suppose a runner pauses
 * for an unbounded time between its pre-POST lease check and its POST, recovery ratchets the
 * attempt to `outcome_unknown` and releases the branch queue, and the zombie then wakes with a
 * real provider response in hand. Its finalize carries the OLD token, matches zero rows, and is
 * discarded with a diagnostic. Its answer never becomes durable, never becomes
 * `eligible_for_context`, and never displaces the recovered state.
 *
 * `error_class` is set ONLY for `failed` — 0031 enforces both directions (`failed ⟹ class` and
 * `class ⟹ failed`), so a taxonomy value on a `completed` attempt is unrepresentable.
 *
 * The lease is NOT re-checked here, deliberately: a lapsed lease does not invalidate a result
 * the provider actually returned, and refusing to record it would DESTROY truth the server
 * holds. The token check is the authority that matters — if recovery rotated it, this runner is
 * no longer the writer; if it did not, this runner is still the one true writer even if its
 * heartbeat fell behind.
 */
export async function finalizeAttempt(
  tx: PoolClient,
  input: {
    attemptId: string;
    claimToken: string;
    state: 'completed' | 'failed' | 'stopped' | 'rejected' | 'outcome_unknown';
    errorClass: AttemptErrorClass | null;
  },
): Promise<boolean> {
  const r = await tx.query(
    `UPDATE govai.ai_conversation_attempts a
        SET state       = $3::text,
            error_class = $4::text,
            terminal_at = now(),
            updated_at  = now()
      WHERE a.id = $1::uuid
        AND a.claim_token = $2::uuid
        AND a.state IN ('accepted', 'dispatching', 'streaming')`,
    [input.attemptId, input.claimToken, input.state, input.errorClass],
  );
  return (r.rowCount ?? 0) === 1;
}

/**
 * §7.8 — bump the branch's monotonic `causal_version` after a terminal transition.
 *
 * This is what makes the boundary CAS's staleness check meaningful: a sibling turn that built
 * its request BEFORE this outcome landed now holds a stale version, fails its boundary, and
 * rebuilds with the new result included. Without the bump, a concurrently-building turn would
 * dispatch a request whose context is missing the answer that just completed.
 *
 * Monotonic by 0031's branches guard, which rejects `NEW.causal_version < OLD.causal_version`
 * independently of this statement.
 *
 * ★ THIS IS THE ONE DURABLE WRITE IN THIS MODULE THAT CARRIES NO CLAIM-TOKEN PREDICATE, and the
 * reason is that a fence would protect nothing here. Every caller reaches it only after a FENCED
 * terminal transition returned true, so a stale worker cannot get this far in the first place.
 * More importantly, the value is a MONOTONIC COUNTER whose only consumer is the boundary CAS's
 * staleness check: the worst an extra bump can do is make a concurrently-building sibling
 * discard its request and rebuild from fresh context — a wasted rebuild, never a wrong dispatch,
 * never lost or reordered durable state. Fencing it would add a predicate that can only turn a
 * safe no-op into a missed queue wake.
 */
export async function bumpBranchCausalVersion(
  tx: PoolClient,
  input: { conversationId: string; branchId: string },
): Promise<void> {
  await tx.query(
    `UPDATE govai.ai_conversation_branches
        SET causal_version = causal_version + 1, updated_at = now()
      WHERE conversation_id = $1::uuid AND id = $2::uuid`,
    [input.conversationId, input.branchId],
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Reads the executor needs (all inside the owner context, all column-explicit)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type ExecutionContext = {
  conversationId: string;
  branchId: string;
  turnId: string;
  turnSeq: string;
  mode: 'governed' | 'passthrough';
  provider: string;
  surface: string;
  model: string;
  causalVersion: string;
  conversationStatus: string;
  nativeRequestConfigContentId: string;
};

/**
 * Everything a dispatch needs, read from DURABLE state in one query.
 *
 * ★ NO IN-MEMORY ROUTING HINT SURVIVES A RELOAD, SO NONE IS USED. `mode` comes from the
 * conversation root's immutable column and `provider`/`surface`/`model` from the BRANCH (§3:
 * adapter selection reads the branch). A dispatch performed minutes later, in a different
 * process, on a different host, resolves identically.
 */
export async function readExecutionContext(
  tx: PoolClient,
  attemptId: string,
): Promise<ExecutionContext | null> {
  const r = await tx.query<{
    conversation_id: string;
    branch_id: string;
    turn_id: string;
    turn_seq: string;
    mode: 'governed' | 'passthrough';
    provider: string;
    surface: string;
    model: string;
    causal_version: string;
    conversation_status: string;
    native_request_config_content_id: string;
  }>(
    `SELECT a.conversation_id,
            a.branch_id,
            a.turn_id,
            t.turn_seq::text                     AS turn_seq,
            c.mode,
            b.provider,
            b.surface,
            b.model,
            b.causal_version::text               AS causal_version,
            c.status                             AS conversation_status,
            t.native_request_config_content_id
       FROM govai.ai_conversation_attempts a
       JOIN govai.ai_conversation_turns t
         ON  t.org_id          = a.org_id
         AND t.owner_user_id   = a.owner_user_id
         AND t.conversation_id = a.conversation_id
         AND t.branch_id       = a.branch_id
         AND t.id              = a.turn_id
       JOIN govai.ai_conversation_branches b
         ON  b.org_id          = a.org_id
         AND b.owner_user_id   = a.owner_user_id
         AND b.conversation_id = a.conversation_id
         AND b.id              = a.branch_id
       JOIN govai.ai_conversations c
         ON  c.org_id        = a.org_id
         AND c.owner_user_id = a.owner_user_id
         AND c.id            = a.conversation_id
      WHERE a.id = $1::uuid`,
    [attemptId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    conversationId: row.conversation_id,
    branchId: row.branch_id,
    turnId: row.turn_id,
    turnSeq: row.turn_seq,
    mode: row.mode,
    provider: row.provider,
    surface: row.surface,
    model: row.model,
    causalVersion: row.causal_version,
    conversationStatus: row.conversation_status,
    nativeRequestConfigContentId: row.native_request_config_content_id,
  };
}

/** The org's ACTIVE credential for a provider, WITH its row id — the piece the direct-route
 *  resolver does not return and §8 commit 4 cannot do without. */
export async function readActiveProviderCredential(
  tx: PoolClient,
  provider: 'anthropic' | 'openai',
): Promise<{
  id: string;
  ciphertext: Buffer;
  dek_wrapped: Buffer;
  kms_key_id: string;
  kms_key_version: number;
} | null> {
  const r = await tx.query<{
    id: string;
    ciphertext: Buffer;
    dek_wrapped: Buffer;
    kms_key_id: string;
    kms_key_version: number;
  }>(
    `SELECT id, ciphertext, dek_wrapped, kms_key_id, kms_key_version
       FROM govai.provider_credentials
      WHERE provider = $1::text AND status = 'active'
      LIMIT 1`,
    [provider],
  );
  return r.rows[0] ?? null;
}

/** The turn's immutable native request config envelope, for reconstruction of the POST. */
export async function readNativeRequestConfig(
  tx: PoolClient,
  contentId: string,
): Promise<{
  ciphertext: Buffer;
  dek_wrapped: Buffer | null;
  kms_key_id: string;
  kms_key_version: number;
  status: string;
} | null> {
  const r = await tx.query<{
    ciphertext: Buffer;
    dek_wrapped: Buffer | null;
    kms_key_id: string;
    kms_key_version: number;
    status: string;
  }>(
    `SELECT ciphertext, dek_wrapped, kms_key_id, kms_key_version, status
       FROM govai.ai_conversation_content
      WHERE id = $1::uuid`,
    [contentId],
  );
  return r.rows[0] ?? null;
}

/** The next dense `item_seq` for an attempt's own output sequence. */
export async function nextAttemptItemSeq(tx: PoolClient, attemptId: string): Promise<number> {
  const r = await tx.query<{ next_seq: string }>(
    `SELECT (COALESCE(MAX(item_seq), 0) + 1)::text AS next_seq
       FROM govai.ai_conversation_items
      WHERE attempt_id = $1::uuid`,
    [attemptId],
  );
  return Number(r.rows[0]!.next_seq);
}
