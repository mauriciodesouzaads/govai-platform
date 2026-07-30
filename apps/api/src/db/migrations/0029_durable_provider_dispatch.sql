-- Migration 0029 — Durable provider dispatch outside run database transactions
-- (EP-P03A-A / F3).
--
-- `govai.runs.status` stays the single canonical lifecycle source. This
-- migration adds dispatch-ownership fields to `govai.runs` (no separate
-- dispatch_state column, no attempts table — owner-adjudicated), admits the new
-- `outcome_unknown` status, binds `provider_invocations` rows to the dispatch
-- token, enforces at-most-one `run_event` Workroom turn per run, and installs
-- the recovery-discovery primitive (narrow writer policy + SECURITY DEFINER
-- candidates function, following the 0005/0008/0025 pattern: FORCE RLS subjects
-- the owner, so cross-org reads need an explicit writer policy).
--
-- Historical data: rows created before this migration keep
-- dispatch_protocol_version = NULL and are exempt from every v1 constraint.
-- No semantic backfill is performed.
--
-- DEPLOY_ORDER:
--   APPLY_MIGRATION
--   → DRAIN_OLD_API_INSTANCES
--   → DEPLOY_NEW_API
--   → START_RECOVERY_WORKER
--   → RESUME_RUN_TRAFFIC
-- The old application does not recognize `outcome_unknown`; concurrent writes
-- from old and new versions after the new flow is active are NOT claimed safe.
-- Rollback after v1 runs exist is an operational procedure, not a DROP COLUMN.

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. govai.runs — dispatch ownership fields (protocol v1)
-- ===========================================================================

ALTER TABLE govai.runs ADD COLUMN IF NOT EXISTS dispatch_protocol_version smallint     NULL;
ALTER TABLE govai.runs ADD COLUMN IF NOT EXISTS dispatch_token            uuid         NULL;
ALTER TABLE govai.runs ADD COLUMN IF NOT EXISTS dispatch_prepared_at      timestamptz  NULL;
ALTER TABLE govai.runs ADD COLUMN IF NOT EXISTS dispatch_claimed_at       timestamptz  NULL;
ALTER TABLE govai.runs ADD COLUMN IF NOT EXISTS dispatch_deadline_at      timestamptz  NULL;
ALTER TABLE govai.runs ADD COLUMN IF NOT EXISTS dispatch_timeout_ms       integer      NULL;
ALTER TABLE govai.runs ADD COLUMN IF NOT EXISTS dispatch_error_class      text         NULL;
ALTER TABLE govai.runs ADD COLUMN IF NOT EXISTS outcome_unknown_at        timestamptz  NULL;

-- ===========================================================================
-- B. Replace the runs.status CHECK to admit 'outcome_unknown'
--
-- The original constraint was declared inline in 0002 (auto-named by
-- PostgreSQL); its name is NOT presumed. It is located deterministically by
-- its definition signature — 'awaiting_approval' appears in no other CHECK on
-- govai.runs — and exactly one match is required (the replacement below also
-- matches on re-run, keeping this block idempotent). Unrelated constraints
-- (mode, risk_level, the dispatch constraints added below) are never touched.
-- ===========================================================================

DO $$
DECLARE
  v_names text[];
BEGIN
  SELECT COALESCE(array_agg(conname), '{}'::text[])
    INTO v_names
    FROM pg_constraint
   WHERE conrelid = 'govai.runs'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) LIKE '%awaiting_approval%';
  IF array_length(v_names, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'migration 0029: expected exactly 1 status CHECK on govai.runs matching awaiting_approval, found % (%)',
      COALESCE(array_length(v_names, 1), 0), v_names;
  END IF;
  EXECUTE format('ALTER TABLE govai.runs DROP CONSTRAINT %I', v_names[1]);
END $$;

ALTER TABLE govai.runs
  ADD CONSTRAINT runs_status_check
  CHECK (status IN (
    'queued', 'running', 'completed', 'failed', 'denied',
    'outcome_unknown', 'awaiting_approval'
  ));

-- ===========================================================================
-- C. Basic dispatch constraints
-- ===========================================================================

ALTER TABLE govai.runs DROP CONSTRAINT IF EXISTS runs_dispatch_protocol_version_check;
ALTER TABLE govai.runs
  ADD CONSTRAINT runs_dispatch_protocol_version_check
  CHECK (dispatch_protocol_version IS NULL OR dispatch_protocol_version = 1);

ALTER TABLE govai.runs DROP CONSTRAINT IF EXISTS runs_dispatch_timeout_ms_check;
ALTER TABLE govai.runs
  ADD CONSTRAINT runs_dispatch_timeout_ms_check
  CHECK (dispatch_timeout_ms IS NULL OR dispatch_timeout_ms BETWEEN 1000 AND 900000);

-- ===========================================================================
-- D. Protocol v1 state-consistency matrix
--
-- Legacy rows (dispatch_protocol_version IS NULL) short-circuit to valid.
-- Every v1 row has a durable dispatch_prepared_at. Arms:
--   queued           — prepared, never claimed (no token, no execution marks)
--   running          — claimed exactly once (token + claim + deadline + timeout)
--   completed        — known success (outcome_unknown_at MAY be set: late
--                      reconciliation preserves the unknown-period record)
--   outcome_unknown  — claimed, honest unknown (error class mandatory)
--   failed pre-claim — dispatch_never_claimed / dispatch_preclaim_failed
--   failed post-claim— known failure after a claim (reconciled rows keep
--                      outcome_unknown_at)
--   denied post-claim— the governed handler blocked before the forward, after
--                      the claim (policy denials in TX-A commit WITHOUT protocol
--                      v1, so a v1 denied row always carries the claim triplet)
-- ===========================================================================

ALTER TABLE govai.runs DROP CONSTRAINT IF EXISTS runs_dispatch_v1_state_check;
ALTER TABLE govai.runs
  ADD CONSTRAINT runs_dispatch_v1_state_check
  CHECK (
    -- Legacy rows (protocol NULL) are exempt from the v1 matrix, but ONLY the
    -- v1 machinery may ever produce `outcome_unknown` — a non-v1 unknown row
    -- would be unrecoverable and unexplainable.
    (dispatch_protocol_version IS NULL AND status <> 'outcome_unknown')
    OR (
      dispatch_prepared_at IS NOT NULL
      AND (
        (status = 'queued'
          AND dispatch_token IS NULL AND dispatch_claimed_at IS NULL
          AND dispatch_deadline_at IS NULL AND started_at IS NULL
          AND completed_at IS NULL AND outcome_unknown_at IS NULL)
        OR (status = 'running'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND dispatch_timeout_ms IS NOT NULL
          AND started_at IS NOT NULL AND completed_at IS NULL
          AND outcome_unknown_at IS NULL)
        OR (status = 'completed'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND completed_at IS NOT NULL)
        OR (status = 'outcome_unknown'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND outcome_unknown_at IS NOT NULL
          AND completed_at IS NULL AND dispatch_error_class IS NOT NULL)
        OR (status = 'failed'
          AND dispatch_token IS NULL AND dispatch_claimed_at IS NULL
          AND dispatch_deadline_at IS NULL AND completed_at IS NOT NULL
          AND dispatch_error_class IS NOT NULL)
        OR (status = 'failed'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND completed_at IS NOT NULL)
        OR (status = 'denied'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND completed_at IS NOT NULL)
      )
    )
  );

-- ===========================================================================
-- E. Dispatch indexes — token uniqueness + recovery scans
-- ===========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS runs_dispatch_token_uniq
  ON govai.runs (dispatch_token)
  WHERE dispatch_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS runs_dispatch_recovery_queued_idx
  ON govai.runs (status, dispatch_prepared_at)
  WHERE dispatch_protocol_version = 1 AND status = 'queued';

CREATE INDEX IF NOT EXISTS runs_dispatch_recovery_running_idx
  ON govai.runs (status, dispatch_deadline_at)
  WHERE dispatch_protocol_version = 1 AND status = 'running';

-- ===========================================================================
-- F. govai.provider_invocations — dispatch token binding
--
-- At most one invocation row per (run, token): the claim token proves which
-- dispatch attempt produced the row, and reconciliation reuses the row via
-- this uniqueness instead of inserting a second one.
-- ===========================================================================

ALTER TABLE govai.provider_invocations ADD COLUMN IF NOT EXISTS dispatch_token uuid NULL;

CREATE UNIQUE INDEX IF NOT EXISTS provider_invocations_run_dispatch_token_uniq
  ON govai.provider_invocations (run_id, dispatch_token)
  WHERE dispatch_token IS NOT NULL;

-- ===========================================================================
-- G. govai.workroom_turns — at most one run_event turn per run
--
-- `payload_ref` carries the run_id on turns of kind 'run_event' (0013/0014).
-- Pre-existing duplicates make the invariant unenforceable: fail LOUD with a
-- count only (no row content, no automatic merge/delete — operator decides).
--
-- The duplicate COUNT runs under the MIGRATION RUNNER (RESET ROLE): the table
-- is FORCE RLS and the writer role has only org-scoped visibility, so a check
-- under SET ROLE would silently see zero rows. The guarded index build below
-- is the role-independent backstop — an index-build unique violation re-raises
-- the same safe message (index builds are never subject to RLS).
-- ===========================================================================

RESET ROLE;

DO $$
DECLARE
  v_dupes bigint;
BEGIN
  SELECT count(*) INTO v_dupes
    FROM (
      SELECT payload_ref
        FROM govai.workroom_turns
       WHERE kind = 'run_event' AND payload_ref IS NOT NULL
       GROUP BY payload_ref
      HAVING count(*) > 1
    ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'migration 0029: % run_id value(s) have duplicate run_event workroom_turns rows; resolve manually before enforcing uniqueness (no rows were merged or deleted)',
      v_dupes;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS workroom_turns_run_event_payload_ref_uniq
             ON govai.workroom_turns (payload_ref)
             WHERE kind = ''run_event'' AND payload_ref IS NOT NULL';
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION
    'migration 0029: duplicate run_event workroom_turns rows exist; resolve manually before enforcing uniqueness (no rows were merged or deleted)';
END $$;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- H. Recovery discovery — narrow writer policy + SECURITY DEFINER candidates
--
-- govai.runs is FORCE RLS, so even the owner needs a policy (0025 precedent).
-- The additional writer policy is deliberately NARROW: only protocol-v1 rows
-- still in an active dispatch state ('queued'/'running') become visible
-- cross-org, and only to govai_audit_writer (NOLOGIN; reachable via SECURITY
-- DEFINER only). The function exposes ids + a reason label — nothing else.
-- All mutation stays on govai_app under per-org RLS with FOR UPDATE SKIP
-- LOCKED re-validation (the multi-replica disjointness primitive), so this
-- discovery is advisory-only.
-- ===========================================================================

DO $$
BEGIN
  CREATE POLICY runs_dispatch_recovery_select_writer ON govai.runs
    FOR SELECT TO govai_audit_writer
    USING (dispatch_protocol_version = 1 AND status IN ('queued', 'running'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION govai.run_dispatch_recovery_candidates(
  p_prepared_grace_ms integer,
  p_recovery_grace_ms integer,
  p_limit             integer
) RETURNS TABLE(org_id uuid, run_id uuid, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_prepared_grace_ms IS NULL OR p_prepared_grace_ms < 1000 OR p_prepared_grace_ms > 3600000 THEN
    RAISE EXCEPTION 'run_dispatch_recovery_candidates: p_prepared_grace_ms out of bounds'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_recovery_grace_ms IS NULL OR p_recovery_grace_ms < 0 OR p_recovery_grace_ms > 3600000 THEN
    RAISE EXCEPTION 'run_dispatch_recovery_candidates: p_recovery_grace_ms out of bounds'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'run_dispatch_recovery_candidates: p_limit out of bounds'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Staleness is decided on DATABASE time (now()), never application clocks.
  RETURN QUERY
    SELECT r.org_id, r.id,
           CASE WHEN r.status = 'queued' THEN 'queued_stale' ELSE 'running_stale' END
      FROM govai.runs r
     WHERE r.dispatch_protocol_version = 1
       AND (
         (r.status = 'queued'
           AND r.dispatch_token IS NULL
           AND r.dispatch_prepared_at < now() - make_interval(secs => p_prepared_grace_ms / 1000.0))
         OR
         (r.status = 'running'
           AND r.dispatch_deadline_at + make_interval(secs => p_recovery_grace_ms / 1000.0) < now())
       )
     ORDER BY r.created_at
     LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION govai.run_dispatch_recovery_candidates(integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION govai.run_dispatch_recovery_candidates(integer, integer, integer) TO govai_app;

RESET ROLE;
