-- Migration 0015 — Workroom Phase 4: approval requests + decisions (issue #57).
--
-- Adds the human-in-the-loop approval layer for the one admission decision that
-- exists today: a passthrough-mode run requested inside a `governance_active`
-- Workroom. Architecture: docs/architecture/workroom-governance-room.md
-- (umbrella #33).
--
-- Scope:
--   - govai.workroom_approval_requests — a forward-looking approval request.
--     A `passthrough_run` request is raised BEFORE the run exists, so
--     subject_ref_id is NULL; the request is bound to the exact intended run
--     parameters via intended_action_hash, and the encrypted intended run
--     payload lives in govai.audit_event_payloads (intended_action_payload_id).
--   - govai.workroom_approval_decisions — append-only grant/deny decisions.
--   - Widen govai.workroom_turns.kind to admit 'approval_request' /
--     'approval_decision' so approval events anchor a Workroom turn and surface
--     in the existing audit subview.
--
-- Workroom does NOT create a new audit chain: approval events route onto the
-- existing `policy` ChainCategory via govai.audit_events / audit_event_payloads.
--
-- Conventions follow 0012-0014: gen_random_uuid() PK defaults, RLS ENABLE +
-- FORCE, idempotent per-command/per-role policies, guarded-update / append-only
-- triggers. org_id columns carry no FK to govai.orgs — consistent with prior
-- Workroom migrations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. govai.workroom_approval_requests — forward-looking approval request
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.workroom_approval_requests (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid        NOT NULL,
  workroom_id                 uuid        NOT NULL REFERENCES govai.workrooms(id),
  requested_by_participant_id uuid        NOT NULL REFERENCES govai.workroom_participants(id),
  -- First slice ships only 'passthrough_run'. Widening the CHECK is a trivial
  -- later migration; no placeholder subject kinds are admitted now.
  subject_kind                text        NOT NULL CHECK (subject_kind IN ('passthrough_run')),
  -- A passthrough_run is approved before the run exists → no subject row.
  subject_ref_id              uuid        NULL,
  risk_class                  text        NULL
                                CHECK (risk_class IS NULL OR risk_class IN ('A', 'B', 'C', 'D', 'E')),
  status                      text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'granted', 'denied', 'expired', 'revoked')),
  -- Encrypted-at-rest: points at the audit_event_payloads row holding the
  -- envelope-encrypted intended run request. No plaintext run input is stored.
  intended_action_payload_id  uuid        NULL REFERENCES govai.audit_event_payloads(id),
  -- sha256 of the canonical intended run action; binds a grant to exact params.
  intended_action_hash        bytea       NOT NULL,
  workroom_governance_mode    text        NOT NULL
                                CHECK (workroom_governance_mode IN ('governance_active', 'audit_only')),
  -- First slice is single-approver; CHECK-pinned to 1 (widened in a later phase).
  required_approver_count     integer     NOT NULL DEFAULT 1 CHECK (required_approver_count = 1),
  expires_at                  timestamptz NULL,
  decided_at                  timestamptz NULL,
  -- One-time-use binding: a granted approval is consumed by exactly one run.
  consumed_run_id             uuid        NULL REFERENCES govai.runs(id),
  consumed_at                 timestamptz NULL,
  requested_audit_event_id    uuid        NOT NULL REFERENCES govai.audit_events(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workroom_approval_requests_passthrough_subject_null
    CHECK (subject_kind <> 'passthrough_run' OR subject_ref_id IS NULL),
  CONSTRAINT workroom_approval_requests_consumed_consistency
    CHECK ((consumed_run_id IS NULL) = (consumed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS workroom_approval_requests_org_workroom_status_idx
  ON govai.workroom_approval_requests (org_id, workroom_id, status);
CREATE INDEX IF NOT EXISTS workroom_approval_requests_workroom_status_idx
  ON govai.workroom_approval_requests (workroom_id, status);
CREATE INDEX IF NOT EXISTS workroom_approval_requests_workroom_created_idx
  ON govai.workroom_approval_requests (workroom_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS workroom_approval_requests_consumed_run_idx
  ON govai.workroom_approval_requests (consumed_run_id);
CREATE INDEX IF NOT EXISTS workroom_approval_requests_intended_hash_idx
  ON govai.workroom_approval_requests (intended_action_hash);

ALTER TABLE govai.workroom_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.workroom_approval_requests FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- B. govai.workroom_approval_decisions — append-only grant/deny decisions
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.workroom_approval_decisions (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid        NOT NULL,
  approval_request_id       uuid        NOT NULL REFERENCES govai.workroom_approval_requests(id),
  decided_by_participant_id uuid        NOT NULL REFERENCES govai.workroom_participants(id),
  decision                  text        NOT NULL CHECK (decision IN ('granted', 'denied')),
  -- A denial must carry a reason; a grant may omit it. Plain governance prose,
  -- not provider content (mirrors workroom_tasks.description).
  reason                    text        NULL CHECK (decision <> 'denied' OR reason IS NOT NULL),
  decision_audit_event_id   uuid        NOT NULL REFERENCES govai.audit_events(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  -- First slice is single-approver: exactly one decision per request.
  UNIQUE (approval_request_id)
);

CREATE INDEX IF NOT EXISTS workroom_approval_decisions_org_request_idx
  ON govai.workroom_approval_decisions (org_id, approval_request_id);

ALTER TABLE govai.workroom_approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.workroom_approval_decisions FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- C. govai.workroom_turns — admit the approval turn kinds
-- ===========================================================================

-- Idempotent: drop the existing constraint (Phase 1-3 name
-- `workroom_turns_kind_check`) and re-add the widened form on every pass.
ALTER TABLE govai.workroom_turns
  DROP CONSTRAINT IF EXISTS workroom_turns_kind_check;
ALTER TABLE govai.workroom_turns
  ADD CONSTRAINT workroom_turns_kind_check
  CHECK (kind IN
    ('state_transition', 'participant_change', 'message', 'task', 'evidence',
     'run_event', 'approval_request', 'approval_decision'));

-- ===========================================================================
-- D. Triggers
-- ===========================================================================

-- workroom_approval_requests: append-only except the controlled state-transition
-- columns (status, decided_at, consumed_run_id, consumed_at). Any UPDATE that
-- touches identity / payload / hash columns is rejected, defense-in-depth,
-- regardless of role. Mirrors the Phase 1 immutability-trigger pattern.
CREATE OR REPLACE FUNCTION govai.workroom_approval_requests_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
    AND NEW.workroom_id IS NOT DISTINCT FROM OLD.workroom_id
    AND NEW.requested_by_participant_id IS NOT DISTINCT FROM OLD.requested_by_participant_id
    AND NEW.subject_kind IS NOT DISTINCT FROM OLD.subject_kind
    AND NEW.subject_ref_id IS NOT DISTINCT FROM OLD.subject_ref_id
    AND NEW.risk_class IS NOT DISTINCT FROM OLD.risk_class
    AND NEW.intended_action_payload_id IS NOT DISTINCT FROM OLD.intended_action_payload_id
    AND NEW.intended_action_hash IS NOT DISTINCT FROM OLD.intended_action_hash
    AND NEW.workroom_governance_mode IS NOT DISTINCT FROM OLD.workroom_governance_mode
    AND NEW.required_approver_count IS NOT DISTINCT FROM OLD.required_approver_count
    AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at
    AND NEW.requested_audit_event_id IS NOT DISTINCT FROM OLD.requested_audit_event_id
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'workroom_approval_requests update is restricted to status/decision/consumption columns'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS workroom_approval_requests_guarded_update_trg
  ON govai.workroom_approval_requests;
CREATE TRIGGER workroom_approval_requests_guarded_update_trg
  BEFORE UPDATE ON govai.workroom_approval_requests
  FOR EACH ROW EXECUTE FUNCTION govai.workroom_approval_requests_guarded_update();

CREATE OR REPLACE FUNCTION govai.workroom_approval_requests_no_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'workroom_approval_requests: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS workroom_approval_requests_no_delete_trg
  ON govai.workroom_approval_requests;
CREATE TRIGGER workroom_approval_requests_no_delete_trg
  BEFORE DELETE ON govai.workroom_approval_requests
  FOR EACH ROW EXECUTE FUNCTION govai.workroom_approval_requests_no_delete();

DROP TRIGGER IF EXISTS workroom_approval_requests_no_truncate_trg
  ON govai.workroom_approval_requests;
CREATE TRIGGER workroom_approval_requests_no_truncate_trg
  BEFORE TRUNCATE ON govai.workroom_approval_requests
  FOR EACH STATEMENT EXECUTE FUNCTION govai.workroom_approval_requests_no_delete();

-- workroom_approval_decisions: strictly append-only — reject UPDATE/DELETE/
-- TRUNCATE on any path.
CREATE OR REPLACE FUNCTION govai.workroom_approval_decisions_no_modify() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'workroom_approval_decisions append-only: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS workroom_approval_decisions_no_modify_trg
  ON govai.workroom_approval_decisions;
CREATE TRIGGER workroom_approval_decisions_no_modify_trg
  BEFORE UPDATE OR DELETE ON govai.workroom_approval_decisions
  FOR EACH ROW EXECUTE FUNCTION govai.workroom_approval_decisions_no_modify();

DROP TRIGGER IF EXISTS workroom_approval_decisions_no_truncate_trg
  ON govai.workroom_approval_decisions;
CREATE TRIGGER workroom_approval_decisions_no_truncate_trg
  BEFORE TRUNCATE ON govai.workroom_approval_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION govai.workroom_approval_decisions_no_modify();

-- Separation of duties, defense-in-depth: the participant who raised an
-- approval request can never be the participant who decides it. The route
-- enforces this too (clean 403); this trigger is the row-level backstop.
CREATE OR REPLACE FUNCTION govai.workroom_approval_decisions_sod() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM govai.workroom_approval_requests r
     WHERE r.id = NEW.approval_request_id
       AND r.requested_by_participant_id = NEW.decided_by_participant_id
  ) THEN
    RAISE EXCEPTION 'workroom_approval_decisions: separation of duties violated (requester cannot decide own request)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workroom_approval_decisions_sod_trg
  ON govai.workroom_approval_decisions;
CREATE TRIGGER workroom_approval_decisions_sod_trg
  BEFORE INSERT ON govai.workroom_approval_decisions
  FOR EACH ROW EXECUTE FUNCTION govai.workroom_approval_decisions_sod();

-- ===========================================================================
-- RLS policies — per command × role. org_id == app.org_id (existing pattern).
-- ===========================================================================

-- workroom_approval_requests -----------------------------------------------
DO $$ BEGIN
  CREATE POLICY workroom_approval_requests_select_app ON govai.workroom_approval_requests
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_approval_requests_insert_app ON govai.workroom_approval_requests
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UPDATE is permitted for the controlled state-transition path only (the
-- guarded-update trigger restricts WHICH columns may change).
DO $$ BEGIN
  CREATE POLICY workroom_approval_requests_update_app ON govai.workroom_approval_requests
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_approval_requests_select_writer ON govai.workroom_approval_requests
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- workroom_approval_decisions ----------------------------------------------
DO $$ BEGIN
  CREATE POLICY workroom_approval_decisions_select_app ON govai.workroom_approval_decisions
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_approval_decisions_insert_app ON govai.workroom_approval_decisions
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_approval_decisions_select_writer ON govai.workroom_approval_decisions
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Grants — requests get SELECT/INSERT/UPDATE (controlled transitions);
-- decisions get SELECT/INSERT only (append-only).
-- ===========================================================================

GRANT SELECT, INSERT, UPDATE ON govai.workroom_approval_requests  TO govai_app;
GRANT SELECT, INSERT         ON govai.workroom_approval_decisions TO govai_app;

RESET ROLE;
