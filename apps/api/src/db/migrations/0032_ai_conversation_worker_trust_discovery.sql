-- Migration 0032 — AI Conversation detached-worker TRUST BOUNDARY + recovery discovery.
--
-- Mission:  EP-AI-CONVERSATION-CONTINUITY-V1-01
-- Movement: P0-A2-DETACHED-WORKER-TRUST-RECOVERY-DISCOVERY
-- Spec:     docs/architecture/ai-conversation-continuity-v1.md
--           (§7.7 stranded-turn recovery, §8 durable send / branch queue,
--            §9 "Detached recovery discovery under FORCE RLS", §19 lifecycle,
--            §24 LAW 1 / LAW 7 / LAW 10 / LAW 11 / LAW 16).
--
-- This migration ships the TRUST + DISCOVERY FOUNDATION ONLY. It creates NO
-- runner loop, NO claim/mutation path, NO provider dispatch, NO cleanup
-- lifecycle, NO HTTP route. P0-A1's 0031 is historical source and is NOT
-- touched.
--
-- WORKER_IDENTITY_SEPARATION (LAW 11). The ordinary request identity
-- (`govai_app`) and the detached conversation worker
-- (`govai_conversation_worker`, created NOLOGIN-until-provisioned in
-- infra/postgres/bootstrap.sql — roles are cluster-level and are never created
-- in migrations, the 0028 rule) are DISTINCT TRUST DOMAINS. A discovery result
-- carries `(org_id, owner_user_id)`, and those two values ARE the credentials
-- every `ai_*` policy consumes — so a role that can invoke discovery can
-- assume any owner's RLS context. `govai_app` therefore receives NO EXECUTE on
-- the discovery function, and the worker role is never granted to it.
--
-- OWNER_DISCOVERY_NON_IMPERSONATION. Discovery is content-free claim-plane
-- metadata only; the worker enters the discovered candidate's owner context
-- TRANSACTION-LOCALLY and then does ordinary least-privilege SQL under the
-- SAME dual-predicate FORCE RLS every request session obeys. No BYPASSRLS, no
-- table ownership, no superuser, no broad owner impersonation.
--
-- WHY THE DEFINER NEEDS POLICIES OF ITS OWN (the 0029 §H / 0025 precedent):
-- the `ai_*` tables are FORCE ROW LEVEL SECURITY, so RLS applies to the table
-- OWNER too. A SECURITY DEFINER function owned by `govai_audit_writer` is
-- therefore NOT a blanket bypass — it sees exactly the rows a
-- `TO govai_audit_writer` policy admits. The three policies below are the
-- narrow bypass surface, and each USING clause is (a projection of) the
-- recovery-candidate row class itself: terminal attempts, and every table row
-- belonging to a conversation with no active work, stay invisible even to the
-- definer. 0031's `govai_app` policies are untouched.
--
-- LEAST PRIVILEGE = CURRENT privilege. The worker is deliberately NOT
-- pre-granted the conceptual full worker matrix of spec §9 (claim UPDATE,
-- item/content INSERT, provider_state mutation, provider_credentials SELECT,
-- audit capture EXECUTE, branch causal UPDATE, disposal/purge DELETE). Those
-- land with the movements that actually implement those flows.

SET ROLE govai_audit_writer;

-- Precondition: the role is created by bootstrap.sql. Fail loudly with a fix
-- hint if it is absent (the 0028 shape).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'govai_conversation_worker') THEN
    RAISE EXCEPTION 'role govai_conversation_worker is absent; run the updated infra/postgres/bootstrap.sql first (roles are created in bootstrap, not in migrations).';
  END IF;
END
$$;

-- ===========================================================================
-- A. Definer-visibility policies — the narrow claim-plane bypass surface
--
-- Read by govai.ai_turn_recovery_candidates() ONLY (govai_audit_writer is
-- NOLOGIN, so these policies are unreachable except through a SECURITY
-- DEFINER function this migration owns). Each is a SELECT policy; the writer
-- receives no INSERT/UPDATE/DELETE policy on the ai_* domain.
--
-- ★ ai_conversation_branches is deliberately absent: the discovery query never
-- reads it (`branch_id` is denormalized onto the attempt row by 0031), so it
-- gets neither a policy nor a grant.
-- ===========================================================================

-- Attempts: ONLY non-terminal attempts are visible cross-owner. This mirrors
-- 0029's `status IN ('queued','running')` narrowing exactly. A terminal
-- attempt (completed/stopped/failed/rejected/outcome_unknown) can never be
-- read through the definer, by anyone, for any reason.
DO $$
BEGIN
  CREATE POLICY ai_conversation_attempts_recovery_select_writer
    ON govai.ai_conversation_attempts
    FOR SELECT TO govai_audit_writer
    USING (state IN ('accepted', 'dispatching', 'streaming'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON POLICY ai_conversation_attempts_recovery_select_writer
  ON govai.ai_conversation_attempts IS
  'P0-A2 claim-plane discovery surface: the SECURITY DEFINER recovery-candidate function (owned by govai_audit_writer, which is NOLOGIN) sees ONLY non-terminal attempts. Terminal attempts are structurally invisible cross-owner. Never widen this to USING (true).';

-- Turns: visible only on a branch that HAS a non-terminal attempt.
-- ★ The scope is the BRANCH, not the turn, and that is load-bearing: the
-- head-of-branch predicate must be able to see EVERY earlier sibling turn of a
-- candidate, including turns whose own attempts are all terminal. A turn-scoped
-- narrowing would hide a drained sibling and silently corrupt head-ness.
DO $$
BEGIN
  CREATE POLICY ai_conversation_turns_recovery_select_writer
    ON govai.ai_conversation_turns
    FOR SELECT TO govai_audit_writer
    USING (EXISTS (
      SELECT 1 FROM govai.ai_conversation_attempts a
       WHERE a.org_id          = govai.ai_conversation_turns.org_id
         AND a.owner_user_id   = govai.ai_conversation_turns.owner_user_id
         AND a.conversation_id = govai.ai_conversation_turns.conversation_id
         AND a.branch_id       = govai.ai_conversation_turns.branch_id
         AND a.state IN ('accepted', 'dispatching', 'streaming')
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON POLICY ai_conversation_turns_recovery_select_writer
  ON govai.ai_conversation_turns IS
  'P0-A2 claim-plane discovery surface: turns on a branch with at least one non-terminal attempt. BRANCH-scoped on purpose — the head-of-queue predicate must see every earlier sibling turn, including fully drained ones.';

-- Conversations: visible only when the conversation HAS a non-terminal
-- attempt. Read for exactly one column — `status`, the §7.7 execution-eligible
-- root predicate.
DO $$
BEGIN
  CREATE POLICY ai_conversations_recovery_select_writer
    ON govai.ai_conversations
    FOR SELECT TO govai_audit_writer
    USING (EXISTS (
      SELECT 1 FROM govai.ai_conversation_attempts a
       WHERE a.org_id          = govai.ai_conversations.org_id
         AND a.owner_user_id   = govai.ai_conversations.owner_user_id
         AND a.conversation_id = govai.ai_conversations.id
         AND a.state IN ('accepted', 'dispatching', 'streaming')
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON POLICY ai_conversations_recovery_select_writer
  ON govai.ai_conversations IS
  'P0-A2 claim-plane discovery surface: conversation roots that still hold active work, read for the §7.7 execution-eligible lifecycle predicate only. The function returns no conversation column (no title ciphertext, no wrapped DEK, no digest).';

-- ===========================================================================
-- B. govai.ai_turn_recovery_candidates — the ONE P0-A2 cross-owner read
--
-- Content-free, side-effect-free, bounded, keyset-cursor based, deterministic
-- on a static dataset. It NEVER rotates a claim token, updates a deadline or a
-- heartbeat, transitions a state, claims a turn, bumps causal_version, reads
-- or decrypts content, resolves a credential, or writes evidence. Those are
-- OWNER-BOUND PROCESSING and arrive with the movement that implements them —
-- keeping this privileged definer surface minimal (spec §9: "SECURITY DEFINER
-- surface stays MINIMAL — discovery only").
--
-- RETURN SHAPE (spec §9's approved claim-plane class; nothing broader):
--   org_id, owner_user_id      the owner security context to enter next
--   conversation_id, turn_id   claim-plane location
--   attempt_id                 REQUIRED: every §7.7 fencing predicate
--                              (state / claim_token / provenance) is an
--                              ATTEMPT column (0031 §F), the returned claim
--                              token and deadline are attempt columns, and a
--                              turn may own several attempts across retries —
--                              turn identity alone cannot name the execution
--                              instance the CAS must fence.
--   state, reason              which recovery arm qualified the row
--   claim_token, claim_deadline_at
--                              the fencing operand a later rotation CAS
--                              compares against, and its lease
--   is_branch_head             §8 queue eligibility (advisory — re-validated
--                              under the branch authority by the processor)
--   attempt_created_at         the keyset cursor part
--
-- DELIBERATELY ABSENT: title/ciphertext/DEK/digest, native request config,
-- provider object id, continuation anchor, audit payload, tool or attachment
-- data, error payload, KMS material, credential material — AND
-- `provider_credential_id` (or any boolean derived from it): §7.7 requires
-- provenance-absence to sit IN the recovery CAS as a durable predicate, so a
-- discovery-time read would be advisory surface with zero safety value.
-- `branch_id` is absent for the same reason — no P0-A2 code path needs it, and
-- the worker reads it from the attempt row under owner context.
--
-- CANDIDATE ARMS (source-adjudicated; §7.7 + §8, nothing invented):
--   queued_head               accepted + UNCLAIMED + head of its branch queue.
--                             NOT deadline-gated (§8: head-of-queue pickup is
--                             not deadline-gated; deadlines govern only the
--                             RE-claiming of already-claimed turns).
--   accepted_lease_expired    accepted + claimed + lease elapsed. No recovery
--                             grace: the dispatch-boundary CAS itself carries
--                             `deadline > now()`, so a stalled owner is
--                             already fenced and cannot POST.
--   dispatching_lease_expired dispatching + lease elapsed past `deadline + δ`
--                             (§7.7 rule (2): the sweep may not act before the
--                             grace, so a runner that validates in time POSTs
--                             before recovery moves).
--   streaming_lease_expired   streaming + lease elapsed past `deadline + δ`
--                             (§7.7: resolved exactly like a lapsed
--                             `dispatching` turn).
--
-- NOT DISCOVERABLE AT THIS MOVEMENT (deferred, not forgotten):
--   * `outcome_unknown` — its ONE lawful resolution is the §7.7/§8 provider
--     recovery PROBE, which needs the attempt's RECORDED dispatch credential
--     and continuation anchor (both forbidden in this result) and a provider
--     call (outside P0-A2). Deferred to the provider-probe movement.
--   * roots in `deleted_pending`/`deleted` — §19.1 deletion fencing excludes
--     the conversation from every new claim, and the only lawful sweep arm
--     there is §19.2's DELETION-SPECIFIC stop-ratchet, which is lifecycle work
--     this movement does not implement. Over-returning them would hand a
--     processor rows whose only lawful action does not exist yet.
--   * a non-head unclaimed `accepted` turn — it is QUEUED, not stranded; the
--     §8 branch-order predicate means no actor may drive it.
--   * `govai.ai_cleanup_candidates(...)` — the spec's SECOND sanctioned
--     bypass. The cleanup/disposal-ledger storage it would read DOES NOT EXIST
--     at this anchor (0031 explicitly defers it), so it is
--     AI_CLEANUP_CANDIDATE_DISCOVERY=DEFERRED_UNTIL_CLEANUP_SCHEMA_EXISTS. No
--     placeholder is created: an always-empty function would falsely read as
--     implemented. The invariant it preserves is unchanged — the sanctioned
--     claim-plane bypasses are narrow, content-free and enumerable.
-- ===========================================================================

CREATE OR REPLACE FUNCTION govai.ai_turn_recovery_candidates(
  p_recovery_grace_ms integer,
  p_limit             integer,
  p_after_created_at  timestamptz DEFAULT NULL,
  p_after_attempt_id  uuid        DEFAULT NULL
) RETURNS TABLE(
  org_id             uuid,
  owner_user_id      uuid,
  conversation_id    uuid,
  turn_id            uuid,
  attempt_id         uuid,
  state              text,
  reason             text,
  claim_token        uuid,
  claim_deadline_at  timestamptz,
  is_branch_head     boolean,
  attempt_created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- Bounds are validated, never silently clamped: a caller that asks for an
  -- out-of-range page has a bug, and failing closed is the 0029 contract.
  IF p_recovery_grace_ms IS NULL OR p_recovery_grace_ms < 0 OR p_recovery_grace_ms > 3600000 THEN
    RAISE EXCEPTION 'ai_turn_recovery_candidates: p_recovery_grace_ms out of bounds'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'ai_turn_recovery_candidates: p_limit out of bounds'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_attempt_id IS NULL) THEN
    RAISE EXCEPTION 'ai_turn_recovery_candidates: cursor parts must be both set or both NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Staleness is decided on DATABASE time (now()), never an application clock
  -- (the 0029 rule).
  RETURN QUERY
  WITH candidate AS (
    SELECT
      a.org_id,
      a.owner_user_id,
      a.conversation_id,
      a.branch_id,
      a.turn_id,
      a.id                AS attempt_id,
      a.state,
      a.claim_token,
      a.claim_deadline_at,
      a.created_at        AS attempt_created_at,
      t.turn_seq,
      CASE
        WHEN a.state = 'accepted' AND a.claim_token IS NULL THEN 'queued_head'
        WHEN a.state = 'accepted'                           THEN 'accepted_lease_expired'
        WHEN a.state = 'dispatching'                        THEN 'dispatching_lease_expired'
        ELSE                                                     'streaming_lease_expired'
      END AS reason
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
     WHERE
       -- §7.7 EXECUTION-ELIGIBLE ROOT (LAW 10). Written in the POSITIVE form so
       -- that a status added by a future migration is excluded (fails CLOSED)
       -- rather than silently admitted.
       c.status IN ('active', 'archived')
       AND (
         -- accepted + UNCLAIMED: head-of-queue pickup, not deadline-gated (§8).
         (a.state = 'accepted' AND a.claim_token IS NULL)
         -- accepted + claimed past its lease: §7.7/§8 re-claim (no grace — the
         -- boundary CAS's own `deadline > now()` predicate already fences the
         -- stalled owner, so it can never POST).
         OR (a.state = 'accepted' AND a.claim_token IS NOT NULL
             AND a.claim_deadline_at < now())
         -- post-boundary lease lapsed past the recovery grace δ (§7.7 rule 2).
         OR (a.state IN ('dispatching', 'streaming')
             AND a.claim_deadline_at
                 + make_interval(secs => p_recovery_grace_ms / 1000.0) < now())
       )
  ),
  scoped AS (
    SELECT
      k.*,
      -- §8 branch-order predicate: no EARLIER turn on the branch is still
      -- non-terminal. ★ Expressed as "the earlier sibling has no VISIBLE
      -- current attempt", because the definer's attempts policy admits ONLY
      -- non-terminal attempts — so an earlier turn whose current attempt is
      -- terminal correctly does not block, while a turn whose current attempt
      -- is still live does. A turn with a NULL `current_attempt_id` (a torn
      -- reservation) blocks: unproven is treated as non-terminal (fail-closed).
      NOT EXISTS (
        SELECT 1
          FROM govai.ai_conversation_turns t2
         WHERE t2.org_id          = k.org_id
           AND t2.owner_user_id   = k.owner_user_id
           AND t2.conversation_id = k.conversation_id
           AND t2.branch_id       = k.branch_id
           AND t2.turn_seq        < k.turn_seq
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
             )
           )
      ) AS is_branch_head
      FROM candidate k
  )
  SELECT
    s.org_id, s.owner_user_id, s.conversation_id, s.turn_id, s.attempt_id,
    s.state, s.reason, s.claim_token, s.claim_deadline_at, s.is_branch_head,
    s.attempt_created_at
    FROM scoped s
   WHERE
     -- The unclaimed arm is actionable ONLY at the head of its branch queue
     -- (§8). The lease-expired arms are stranded work wherever they sit, and
     -- carry `is_branch_head` for the processor's own re-validation.
     (s.reason <> 'queued_head' OR s.is_branch_head)
     AND (p_after_created_at IS NULL
          OR (s.attempt_created_at, s.attempt_id) > (p_after_created_at, p_after_attempt_id))
   ORDER BY s.attempt_created_at, s.attempt_id
   LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION govai.ai_turn_recovery_candidates(integer, integer, timestamptz, uuid) IS
  'EP-AI-CONVERSATION-CONTINUITY-V1 P0-A2: the ONLY cross-owner read in the ai_* domain. Content-free claim-plane metadata, side-effect-free, keyset-bounded. EXECUTE is confined to govai_conversation_worker — govai_app must NEVER receive it, because the (org_id, owner_user_id) pair it returns IS the credential every ai_* policy consumes.';

REVOKE ALL ON FUNCTION govai.ai_turn_recovery_candidates(integer, integer, timestamptz, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION govai.ai_turn_recovery_candidates(integer, integer, timestamptz, uuid)
  TO govai_conversation_worker;

-- ===========================================================================
-- C. Worker ordinary access — least privilege for THIS movement
--
-- After discovery the worker enters the candidate's owner context
-- transaction-locally and re-validates it with ORDINARY SQL under ORDINARY
-- FORCE RLS. Table privilege and RLS are CUMULATIVE, so every grant here has a
-- matching worker policy below, and every policy here has a matching grant —
-- a grant without a policy silently yields zero rows; a policy without a grant
-- is dead text.
--
-- READ-ONLY, three tables, exactly what the shipped re-validation path reads:
--   attempts       the candidate itself (state, claim triple, stop flag)
--   turns          reservation identity + turn_seq (the §8 queue predicate)
--   conversations  the §7.7 execution-eligible root predicate + immutable mode
-- No UPDATE. No INSERT. No DELETE. No provider_credentials. No content, items,
-- provider_state, evidence links or branches: nothing in P0-A2 reads them, and
-- anticipating a later movement's needs is not least privilege.
--
-- The worker policies reuse 0031's EXACT dual owner predicate. They are not
-- OR-widened, they do not see any-owner rows, and they add no bypass: a worker
-- session with no owner context reads ZERO rows from these tables.
-- ===========================================================================

DO $$
BEGIN
  CREATE POLICY ai_conversations_select_conversation_worker ON govai.ai_conversations
    FOR SELECT TO govai_conversation_worker
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY ai_conversation_turns_select_conversation_worker ON govai.ai_conversation_turns
    FOR SELECT TO govai_conversation_worker
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY ai_conversation_attempts_select_conversation_worker
    ON govai.ai_conversation_attempts
    FOR SELECT TO govai_conversation_worker
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- COLUMN-SCOPED grants (the 0028 `GRANT SELECT (id) ON govai.orgs` precedent, and spec
-- §9's "column-level narrowing preferred where the house conventions support it and it
-- meaningfully reduces authority"). The worker is NOT the table owner, so column privileges
-- bind to it. What the narrowing BUYS, literally:
--   * ai_conversations       — the five encrypted-title columns (ciphertext, wrapped DEK, key
--                              id/version, keyed digest) are unreachable. The worker cannot
--                              read a conversation title in any form.
--   * ai_conversation_turns  — `native_request_config_content_id` is unreachable: the worker
--                              cannot even learn WHICH content row holds the native request.
--   * ai_conversation_attempts — the four `continuation_parent_*` columns (the encrypted
--                              provider continuation anchor, §21-sensitive), the credential
--                              provenance pointer, the evidence identity pair and the
--                              causal-build version are all unreachable. What remains is the
--                              claim plane: lineage, state, the lease, the durable stop flag
--                              and the boundary marker.
-- ★ A consequence worth stating: `SELECT *` on these tables now FAILS for the worker. That is
-- the point — every worker read must name its columns, and a future column added by a later
-- migration is NOT silently granted.
-- ★ Column REVOKE first, as an idempotent belt for environments where a prior table-level
-- grant already ran (0028's rebuilt-test-container lesson).
REVOKE ALL ON govai.ai_conversations         FROM govai_conversation_worker;
REVOKE ALL ON govai.ai_conversation_turns    FROM govai_conversation_worker;
REVOKE ALL ON govai.ai_conversation_attempts FROM govai_conversation_worker;

-- Root lifecycle predicate (§7.7 execution-eligible) + owner identity. NO title columns.
GRANT SELECT (id, org_id, owner_user_id, status)
  ON govai.ai_conversations TO govai_conversation_worker;

-- Reservation identity + the §8 branch queue order + the current-attempt pointer.
-- NO native_request_config_content_id.
GRANT SELECT (id, org_id, owner_user_id, conversation_id, branch_id, client_turn_id,
              turn_seq, current_attempt_id, created_at)
  ON govai.ai_conversation_turns TO govai_conversation_worker;

-- The claim plane and nothing else: lineage, §7 state, the LAW 7 lease triple + heartbeat,
-- the durable stop flag (§7.7 — the boundary CAS refuses a stop-requested attempt, so a
-- re-validating processor must be able to see it) and the boundary marker (the `B` predicate).
-- NO continuation anchor, NO provider_credential_id, NO govai_request_id/capture_id,
-- NO causal_version_at_build.
GRANT SELECT (id, org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq,
              state, claim_token, claimant, claim_deadline_at, heartbeat_at, stop_requested,
              dispatch_boundary_committed_at, created_at, updated_at)
  ON govai.ai_conversation_attempts TO govai_conversation_worker;

RESET ROLE;
