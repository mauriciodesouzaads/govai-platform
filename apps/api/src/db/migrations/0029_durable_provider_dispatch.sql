-- Migration 0029 — Durable provider dispatch outside run database transactions
-- (EP-P03A-A / F3, boundary-aware revision).
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
-- BOUNDARY REVISION: adds `dispatch_boundary_committed_at` — the durable local
-- dispatch boundary. Exact meaning: the protocol durably crossed the final
-- mandatory local gate after which a provider invocation could begin. It does
-- NOT prove fetch was invoked, that bytes crossed the network, or that the
-- provider received/executed/answered anything.
--
-- Historical data: rows created before this migration keep
-- dispatch_protocol_version = NULL and are exempt from every v1 constraint.
-- No semantic backfill is performed — ever. A pre-boundary protocol-v1 row
-- contains no evidence of whether the boundary was crossed, so this file
-- FAILS LOUD (count only, no row content) when such rows exist, instead of
-- inventing timestamps, reclassifying statuses or deleting runs. The operator
-- decides: recreate only an explicitly disposable database; otherwise preserve
-- it for manual owner adjudication.
--
-- DEPLOY_ORDER:
--   APPLY_MIGRATION      (fails loud on pre-boundary protocol-v1 rows)
--   → DRAIN_OLD_API_INSTANCES
--   → DEPLOY_NEW_API
--   → START_RECOVERY_WORKER
--   → RESUME_RUN_TRAFFIC
-- The old application does not recognize `outcome_unknown`; concurrent writes
-- from old and new versions after the new flow is active are NOT claimed safe.
-- The pre-boundary unmerged form of this file must be fully drained (zero
-- protocol-v1 rows) before the boundary-aware form applies. Rollback after v1
-- runs exist is an operational procedure, not a DROP COLUMN.

-- ===========================================================================
-- 0. Boundary-upgrade compatibility preflight (§8). Cases:
--      M-A fresh / pre-boundary with zero v1 rows → proceed
--      M-B pre-boundary schema WITH v1 rows       → FAIL LOUD (count only)
--      M-C boundary-aware schema already present  → proceed (idempotent rerun)
--    No backfill, no deletion, no status mutation on any path.
--
--    The M-B decision count must be truthful across ALL organizations under
--    EVERY supported migrator identity: a true superuser, or a non-superuser
--    login that can SET ROLE govai_audit_writer (bootstrap.sql's documented
--    migrator contract). govai.runs is FORCE RLS with org-scoped policies, so
--    a plain count under a non-superuser identity is silently filtered to a
--    subset — a pre-boundary v1 row invisible to the runner would be ADOPTED
--    without this guard firing. Mechanism, all inside this ONE atomic DO
--    statement: become the table owner (govai_audit_writer), verify the RLS
--    posture, suspend FORCE (owner-only visibility exemption — ENABLE stays
--    on, no policy is touched, other roles are unaffected), count with
--    row_security=off armed as a fail-closed ASSERTION (if any policy would
--    still filter the owner, the count ERRORS instead of undercounting; it is
--    NOT the visibility mechanism — suspending FORCE for the owner is), then
--    restore FORCE and re-verify BEFORE any decision is taken. A RAISE on any
--    path aborts the whole file's transaction, so no committed state ever has
--    FORCE disabled, and the ACCESS EXCLUSIVE lock taken by the ALTER means
--    no other session can observe the window.
--
--    Schema-shape detection reads pg_catalog directly, NOT information_schema:
--    information_schema is privilege-filtered, so a low-privilege runner would
--    see no govai.runs columns, misdetect M-B as M-A "fresh", and skip this
--    guard entirely.
-- ===========================================================================

DO $$
DECLARE
  v_boundary_exists boolean;
  v_dispatch_cols_exist boolean;
  v_v1_rows bigint;
  v_rls boolean;
  v_force boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'govai' AND c.relname = 'runs'
       AND a.attname = 'dispatch_boundary_committed_at'
       AND NOT a.attisdropped
  ) INTO v_boundary_exists;
  IF v_boundary_exists THEN
    RETURN; -- M-C: boundary-aware schema; idempotent rerun proceeds.
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'govai' AND c.relname = 'runs'
       AND a.attname = 'dispatch_protocol_version'
       AND NOT a.attisdropped
  ) INTO v_dispatch_cols_exist;
  IF NOT v_dispatch_cols_exist THEN
    RETURN; -- M-A: fresh database (0029 never ran); nothing to audit.
  END IF;
  -- M-B candidate: pre-boundary schema with dispatch columns present.
  EXECUTE 'SET ROLE govai_audit_writer';
  SELECT relrowsecurity, relforcerowsecurity INTO v_rls, v_force
    FROM pg_class WHERE oid = 'govai.runs'::regclass;
  IF v_rls IS DISTINCT FROM true OR v_force IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'migration 0029: unexpected RLS posture on govai.runs before the preflight count (rls=%, force=%); refusing to continue',
      v_rls, v_force;
  END IF;
  EXECUTE 'ALTER TABLE govai.runs NO FORCE ROW LEVEL SECURITY';
  PERFORM set_config('row_security', 'off', true);
  EXECUTE 'SELECT count(*) FROM govai.runs WHERE dispatch_protocol_version = 1'
    INTO v_v1_rows;
  PERFORM set_config('row_security', 'on', true);
  EXECUTE 'ALTER TABLE govai.runs FORCE ROW LEVEL SECURITY';
  SELECT relrowsecurity, relforcerowsecurity INTO v_rls, v_force
    FROM pg_class WHERE oid = 'govai.runs'::regclass;
  IF v_rls IS DISTINCT FROM true OR v_force IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'migration 0029: RLS posture on govai.runs not restored after the preflight count (rls=%, force=%)',
      v_rls, v_force;
  END IF;
  EXECUTE 'RESET ROLE';
  IF v_v1_rows > 0 THEN
    -- M-B. Safe message: migration identity + total count + operator
    -- instructions ONLY — no run ids, org ids, hashes or row content.
    RAISE EXCEPTION
      'migration 0029 boundary upgrade blocked: % protocol-v1 run(s) created by the pre-boundary schema exist. No backfill, deletion or status mutation was performed. Recreate the database only if it is explicitly disposable; otherwise preserve it for manual owner adjudication.',
      v_v1_rows;
  END IF;
  -- M-A: pre-boundary schema, zero v1 rows → safe to upgrade in place.
END $$;

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
-- The durable local dispatch boundary (see header): committed by a short CAS
-- transaction IMMEDIATELY before the local forward invocation; NULL means the
-- protocol never crossed the final mandatory local gate. Never a receipt claim.
ALTER TABLE govai.runs ADD COLUMN IF NOT EXISTS dispatch_boundary_committed_at timestamptz NULL;

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
-- D0. Boundary-matrix compatibility audit (§9.2) — a best-effort EARLY
--     DIAGNOSTIC under the MIGRATION RUNNER (RESET ROLE), BEFORE the
--     constraint below is replaced, so incompatible rows the runner can see
--     produce ONE safe count-only failure instead of a generic
--     check-constraint violation mid-DDL. Under a non-superuser runner the
--     count may be RLS-filtered to a subset, or raise insufficient_privilege
--     (caught below → diagnostic skipped): the ADD CONSTRAINT validation
--     right after is the role-independent, cross-org backstop that scans
--     every row and rolls back the whole file on the first incompatible one.
--     FORCE RLS is deliberately NOT suspended here — this guard's only value
--     over the backstop is a nicer message, and a security posture is not
--     spent on message quality. The predicate here is the EXACT negation of
--     the section-D matrix — keep the two in sync. No semantic data
--     modification on any path: rows are counted, never mutated.
-- ===========================================================================

RESET ROLE;

DO $$
DECLARE
  v_bad bigint;
BEGIN
  BEGIN
  SELECT count(*) INTO v_bad
    FROM govai.runs
   WHERE NOT (
    (dispatch_protocol_version IS NULL AND status <> 'outcome_unknown'
      AND dispatch_boundary_committed_at IS NULL)
    OR (
      dispatch_protocol_version IS NOT DISTINCT FROM 1
      AND dispatch_prepared_at IS NOT NULL
      AND (dispatch_boundary_committed_at IS NULL
           OR (dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
               AND dispatch_deadline_at IS NOT NULL AND dispatch_timeout_ms IS NOT NULL))
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
          AND dispatch_deadline_at IS NOT NULL AND completed_at IS NOT NULL
          AND dispatch_boundary_committed_at IS NOT NULL)
        OR (status = 'outcome_unknown'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND outcome_unknown_at IS NOT NULL
          AND completed_at IS NULL AND dispatch_error_class IS NOT NULL
          AND dispatch_boundary_committed_at IS NOT NULL)
        OR (status = 'failed'
          AND dispatch_token IS NULL AND dispatch_claimed_at IS NULL
          AND dispatch_deadline_at IS NULL AND completed_at IS NOT NULL
          AND dispatch_error_class IS NOT NULL
          AND dispatch_boundary_committed_at IS NULL)
        OR (status = 'failed'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND completed_at IS NOT NULL)
        OR (status = 'denied'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND completed_at IS NOT NULL)
      )
    )
   );
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE
      'migration 0029: D0 diagnostic count skipped (runner identity cannot read govai.runs); the ADD CONSTRAINT validation below remains the role-independent backstop';
    RETURN;
  END;
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'migration 0029: % run row(s) are incompatible with the boundary-aware v1 state matrix; no rows were modified — resolve manually before re-running (count only, no row content)',
      v_bad;
  END IF;
END $$;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- D. Protocol v1 state-consistency matrix (boundary-aware)
--
-- Legacy rows (dispatch_protocol_version IS NULL) short-circuit to valid and
-- never carry a boundary. Every v1 row has a durable dispatch_prepared_at,
-- and a committed boundary implies the full claim quadruple (token + claim +
-- deadline + timeout). Arms:
--   queued           — prepared, never claimed (no token, no execution marks;
--                      boundary NULL via the claim implication)
--   running          — claimed exactly once; boundary MAY be NULL (claimed,
--                      gate not yet crossed) or NOT NULL (gate crossed,
--                      outcome pending)
--   completed        — known success; boundary REQUIRED (a 2xx implies the
--                      gate was crossed; outcome_unknown_at MAY be set: late
--                      reconciliation preserves the unknown-period record)
--   outcome_unknown  — claimed, honest unknown (error class mandatory);
--                      boundary REQUIRED — a boundary-null stale claim is the
--                      KNOWN failure dispatch_never_started instead
--   failed pre-claim — dispatch_never_claimed / dispatch_preclaim_failed;
--                      boundary NULL
--   failed post-claim— known failure after a claim; boundary NULL (e.g.
--                      dispatch_never_started, dispatch_boundary_persist_failed,
--                      pre-boundary local errors) or NOT NULL (provider-known
--                      error, post-boundary local failure, late reconciliation
--                      to failed; reconciled rows keep outcome_unknown_at)
--   denied post-claim— the governed handler blocked before the forward, after
--                      the claim (policy denials in TX-A commit WITHOUT protocol
--                      v1, so a v1 denied row always carries the claim triplet)
--
-- The replacement below is FULLY VALIDATED at ADD CONSTRAINT time (no NOT
-- VALID left behind); the D0 audit above already reported any incompatible
-- rows with a safe count-only message.
-- ===========================================================================

ALTER TABLE govai.runs DROP CONSTRAINT IF EXISTS runs_dispatch_v1_state_check;
ALTER TABLE govai.runs
  ADD CONSTRAINT runs_dispatch_v1_state_check
  CHECK (
    -- Legacy rows (protocol NULL) are exempt from the v1 matrix, but ONLY the
    -- v1 machinery may ever produce `outcome_unknown` or commit a boundary —
    -- a non-v1 unknown/boundary row would be unrecoverable and unexplainable.
    -- The second arm REQUIRES protocol v1: a dispatch-shaped row with a NULL
    -- protocol must fall through to (and be constrained by) the legacy arm,
    -- never satisfy the v1 arm while invisible to v1 recovery discovery.
    (dispatch_protocol_version IS NULL AND status <> 'outcome_unknown'
      AND dispatch_boundary_committed_at IS NULL)
    OR (
      dispatch_protocol_version IS NOT DISTINCT FROM 1
      AND dispatch_prepared_at IS NOT NULL
      -- A committed boundary implies exclusive claim ownership: the boundary
      -- CAS requires the exact token under status='running'.
      AND (dispatch_boundary_committed_at IS NULL
           OR (dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
               AND dispatch_deadline_at IS NOT NULL AND dispatch_timeout_ms IS NOT NULL))
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
          AND dispatch_deadline_at IS NOT NULL AND completed_at IS NOT NULL
          AND dispatch_boundary_committed_at IS NOT NULL)
        OR (status = 'outcome_unknown'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND outcome_unknown_at IS NOT NULL
          AND completed_at IS NULL AND dispatch_error_class IS NOT NULL
          AND dispatch_boundary_committed_at IS NOT NULL)
        OR (status = 'failed'
          AND dispatch_token IS NULL AND dispatch_claimed_at IS NULL
          AND dispatch_deadline_at IS NULL AND completed_at IS NOT NULL
          AND dispatch_error_class IS NOT NULL
          AND dispatch_boundary_committed_at IS NULL)
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
-- The duplicate COUNT is a best-effort diagnostic under the MIGRATION RUNNER
-- (RESET ROLE): the table is FORCE RLS, so under a non-superuser runner the
-- count may see an RLS-filtered subset (a check under SET ROLE would see only
-- org-scoped rows), or raise insufficient_privilege (caught below →
-- diagnostic skipped). The guarded index build below is the role-independent
-- backstop — an index-build unique violation re-raises the same safe message
-- (index builds are never subject to RLS). The build itself runs under the
-- table owner so a minimal SET-ROLE-capable migrator can execute it.
-- ===========================================================================

RESET ROLE;

DO $$
DECLARE
  v_dupes bigint;
BEGIN
  BEGIN
  SELECT count(*) INTO v_dupes
    FROM (
      SELECT payload_ref
        FROM govai.workroom_turns
       WHERE kind = 'run_event' AND payload_ref IS NOT NULL
       GROUP BY payload_ref
      HAVING count(*) > 1
    ) d;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE
      'migration 0029: duplicate-turn diagnostic count skipped (runner identity cannot read govai.workroom_turns); the guarded unique index build below remains the role-independent backstop';
    RETURN;
  END;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'migration 0029: % run_id value(s) have duplicate run_event workroom_turns rows; resolve manually before enforcing uniqueness (no rows were merged or deleted)',
      v_dupes;
  END IF;
END $$;

SET ROLE govai_audit_writer;

DO $$
BEGIN
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS workroom_turns_run_event_payload_ref_uniq
             ON govai.workroom_turns (payload_ref)
             WHERE kind = ''run_event'' AND payload_ref IS NOT NULL';
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION
    'migration 0029: duplicate run_event workroom_turns rows exist; resolve manually before enforcing uniqueness (no rows were merged or deleted)';
END $$;

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

-- Keyset cursor (p_after_created_at, p_after_run_id): a fixed oldest-first
-- LIMIT batch would re-select the same rows on every sweep whenever the oldest
-- candidates repeatedly fail (or stay locked) — permanently starving every
-- younger stale run behind them. The worker pages FORWARD through the stale
-- set within one sweep; each new sweep restarts from the oldest (retry
-- semantics) but still advances past non-progressing rows.
-- Drop the pre-cursor 3-parameter overload so partially-migrated databases
-- never keep an ambiguous pair (idempotent: absent on re-run).
DROP FUNCTION IF EXISTS govai.run_dispatch_recovery_candidates(integer, integer, integer);

CREATE OR REPLACE FUNCTION govai.run_dispatch_recovery_candidates(
  p_prepared_grace_ms integer,
  p_recovery_grace_ms integer,
  p_limit             integer,
  p_after_created_at  timestamptz DEFAULT NULL,
  p_after_run_id      uuid        DEFAULT NULL
) RETURNS TABLE(org_id uuid, run_id uuid, reason text, run_created_at timestamptz)
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
  IF (p_after_created_at IS NULL) <> (p_after_run_id IS NULL) THEN
    RAISE EXCEPTION 'run_dispatch_recovery_candidates: cursor parts must be both set or both NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Staleness is decided on DATABASE time (now()), never application clocks.
  RETURN QUERY
    SELECT r.org_id, r.id,
           CASE WHEN r.status = 'queued' THEN 'queued_stale' ELSE 'running_stale' END,
           r.created_at
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
       AND (p_after_created_at IS NULL
            OR (r.created_at, r.id) > (p_after_created_at, p_after_run_id))
     ORDER BY r.created_at, r.id
     LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION govai.run_dispatch_recovery_candidates(integer, integer, integer, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION govai.run_dispatch_recovery_candidates(integer, integer, integer, timestamptz, uuid) TO govai_app;

-- ===========================================================================
-- I. EC-3a view refresh — honest unknowns are valid lifecycle evidence
--
-- 0027 predates the durable-dispatch protocol: its detector recognizes only
-- run.completed/run.failed/run.denied, so the §22 honest-unknown invocation
-- TRACE (run.outcome_unknown is the run's only lifecycle event until — and
-- unless — a late result reconciles) would be falsely reported by /v1/evidence
-- and the operator gauges as a missing-terminal integrity gap. This migration
-- introduces the event type, so it also teaches the dependent view about it.
-- An invocation whose run has NO lifecycle event at all remains a gap.
-- ===========================================================================

CREATE OR REPLACE VIEW govai.evidence_provider_without_audit
  WITH (security_invoker = true) AS
SELECT
  pi.org_id, pi.run_id, pi.id AS provider_invocation_id,
  pi.provider, pi.native_endpoint, pi.status_code, pi.error_class, pi.created_at
FROM govai.provider_invocations pi
WHERE NOT EXISTS (
  SELECT 1 FROM govai.audit_events ae
   WHERE ae.subject_type = 'run'
     AND ae.subject_id   = pi.run_id
     AND ae.event_type IN ('run.completed','run.failed','run.denied','run.outcome_unknown')
);

REVOKE ALL    ON govai.evidence_provider_without_audit FROM PUBLIC;
GRANT  SELECT ON govai.evidence_provider_without_audit TO   govai_app;

RESET ROLE;
