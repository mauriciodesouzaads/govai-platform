-- Migration 0012 — Workroom Phase 1 domain skeleton (issue #49).
--
-- Persists the runtime foundation for the GovAI Workroom control plane
-- (architecture: docs/architecture/workroom-governance-room.md, umbrella #33).
--
-- Scope: domain skeleton + control plane contracts only.
--   - orgs.workroom_audit_only_disallowed — minimal org-level admission gate.
--   - govai.workroom_policy_profiles — persisted policy snapshot per workroom.
--   - govai.workrooms — the collaboration container above /v1/runs.
--   - govai.agent_profiles — reusable agent definitions (no public CRUD here).
--   - govai.workroom_participants — humans/agents bound to a workroom.
--   - govai.workroom_turns — append-only timeline anchoring audit events.
--
-- Workroom does NOT create a new audit chain: lifecycle/participant events
-- reuse govai.audit_events and the existing ChainCategory routing. The
-- govai.runs table is intentionally untouched in Phase 1.
--
-- Conventions follow prior migrations: gen_random_uuid() PK defaults
-- (pgcrypto), RLS ENABLE + FORCE, per-command/per-role policies created
-- idempotently, append-only protection via triggers. org_id columns carry no
-- FK to govai.orgs — consistent with govai.runs, which also keeps org_id
-- unconstrained. No users table exists, so created_by_user_id / user_id stay
-- as bare uuid columns without an FK target.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. orgs — minimal audit-only admission gate
-- ===========================================================================

ALTER TABLE govai.orgs
  ADD COLUMN IF NOT EXISTS workroom_audit_only_disallowed boolean NOT NULL DEFAULT false;

-- ===========================================================================
-- B. govai.workroom_policy_profiles — persisted policy snapshot
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.workroom_policy_profiles (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid        NOT NULL,
  name                      text        NOT NULL,
  governance_mode           text        NOT NULL
                              CHECK (governance_mode IN ('governance_active', 'audit_only')),
  default_provider_surface  text        NOT NULL
                              CHECK (default_provider_surface IN ('governed', 'passthrough')),
  max_risk_without_approval text        NOT NULL
                              CHECK (max_risk_without_approval IN ('A', 'B', 'C', 'D', 'E')),
  approval_policy_id        uuid        NULL,
  is_disabled               boolean     NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS workroom_policy_profiles_org_idx
  ON govai.workroom_policy_profiles (org_id);

ALTER TABLE govai.workroom_policy_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.workroom_policy_profiles FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- C. govai.workrooms — collaboration container above /v1/runs
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.workrooms (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL,
  workspace_id       uuid        NOT NULL,
  name               text        NOT NULL,
  purpose            text        NOT NULL DEFAULT '',
  status             text        NOT NULL DEFAULT 'open'
                       CHECK (status IN
                         ('draft', 'open', 'blocked_on_approval',
                          'completed', 'cancelled', 'archived')),
  governance_mode    text        NOT NULL
                       CHECK (governance_mode IN ('governance_active', 'audit_only')),
  policy_profile_id  uuid        NOT NULL REFERENCES govai.workroom_policy_profiles(id),
  created_by_user_id uuid        NOT NULL,
  retention_class    text        NOT NULL DEFAULT 'standard',
  metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz NULL,
  archived_at        timestamptz NULL
);

CREATE INDEX IF NOT EXISTS workrooms_org_created_idx
  ON govai.workrooms (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workrooms_org_status_idx
  ON govai.workrooms (org_id, status);
CREATE INDEX IF NOT EXISTS workrooms_workspace_idx
  ON govai.workrooms (workspace_id);
CREATE INDEX IF NOT EXISTS workrooms_policy_profile_idx
  ON govai.workrooms (policy_profile_id);

ALTER TABLE govai.workrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.workrooms FORCE  ROW LEVEL SECURITY;

-- governance_mode is selected at creation and is immutable in Phase 1: no
-- mode-transition endpoint ships here. Any UPDATE that changes governance_mode
-- is rejected at the row level, defense-in-depth, regardless of role.
CREATE OR REPLACE FUNCTION govai.workrooms_governance_mode_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.governance_mode IS DISTINCT FROM OLD.governance_mode THEN
    RAISE EXCEPTION 'workrooms: governance_mode is immutable (no mode-transition endpoint in Phase 1)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workrooms_governance_mode_immutable_trg ON govai.workrooms;
CREATE TRIGGER workrooms_governance_mode_immutable_trg
  BEFORE UPDATE ON govai.workrooms
  FOR EACH ROW EXECUTE FUNCTION govai.workrooms_governance_mode_immutable();

-- ===========================================================================
-- D. govai.agent_profiles — reusable agent definitions (no public CRUD here)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.agent_profiles (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL,
  name             text        NOT NULL,
  provider         text        NOT NULL CHECK (provider IN ('anthropic', 'openai', 'external')),
  model            text        NULL,
  default_role     text        NOT NULL CHECK (default_role IN (
                     'human_owner', 'human_approver', 'human_reviewer', 'dpo_reviewer',
                     'architect_agent', 'auditor_agent', 'executor_agent',
                     'observer_agent', 'tool_agent', 'external_agent')),
  tool_grants      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  cost_attribution jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_disabled      boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS agent_profiles_org_idx
  ON govai.agent_profiles (org_id);

ALTER TABLE govai.agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.agent_profiles FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- E. govai.workroom_participants — humans/agents bound to a workroom
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.workroom_participants (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid        NOT NULL,
  workroom_id           uuid        NOT NULL REFERENCES govai.workrooms(id),
  kind                  text        NOT NULL CHECK (kind IN ('human', 'agent')),
  role                  text        NOT NULL CHECK (role IN (
                          'human_owner', 'human_approver', 'human_reviewer', 'dpo_reviewer',
                          'architect_agent', 'auditor_agent', 'executor_agent',
                          'observer_agent', 'tool_agent', 'external_agent')),
  user_id               uuid        NULL,
  agent_profile_id      uuid        NULL REFERENCES govai.agent_profiles(id),
  permission_scope      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  added_by_participant_id uuid      NULL,
  added_at              timestamptz NOT NULL DEFAULT now(),
  removed_at            timestamptz NULL,
  status                text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('invited', 'active', 'removed')),
  CHECK (
    (kind = 'human' AND user_id IS NOT NULL     AND agent_profile_id IS NULL)
    OR
    (kind = 'agent' AND agent_profile_id IS NOT NULL AND user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS workroom_participants_workroom_idx
  ON govai.workroom_participants (workroom_id);
CREATE INDEX IF NOT EXISTS workroom_participants_org_idx
  ON govai.workroom_participants (org_id);

-- One active human (by user) and one active agent (by profile) per workroom.
CREATE UNIQUE INDEX IF NOT EXISTS workroom_participants_active_human_unique
  ON govai.workroom_participants (workroom_id, user_id)
  WHERE kind = 'human' AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS workroom_participants_active_agent_unique
  ON govai.workroom_participants (workroom_id, agent_profile_id)
  WHERE kind = 'agent' AND status = 'active';

ALTER TABLE govai.workroom_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.workroom_participants FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- F. govai.workroom_turns — append-only timeline anchoring audit events
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.workroom_turns (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL,
  workroom_id          uuid        NOT NULL REFERENCES govai.workrooms(id),
  turn_number          bigint      NOT NULL,
  actor_participant_id uuid        NULL REFERENCES govai.workroom_participants(id),
  kind                 text        NOT NULL CHECK (kind IN ('state_transition', 'participant_change')),
  occurred_at          timestamptz NOT NULL DEFAULT now(),
  audit_event_id       uuid        NOT NULL REFERENCES govai.audit_events(id),
  UNIQUE (workroom_id, turn_number)
);

CREATE INDEX IF NOT EXISTS workroom_turns_org_idx
  ON govai.workroom_turns (org_id);
CREATE INDEX IF NOT EXISTS workroom_turns_workroom_idx
  ON govai.workroom_turns (workroom_id);
CREATE INDEX IF NOT EXISTS workroom_turns_audit_event_idx
  ON govai.workroom_turns (audit_event_id);

ALTER TABLE govai.workroom_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.workroom_turns FORCE  ROW LEVEL SECURITY;

-- workroom_turns is append-only: no UPDATE or DELETE on any path.
CREATE OR REPLACE FUNCTION govai.workroom_turns_no_modify() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'workroom_turns append-only: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS workroom_turns_no_modify_trg ON govai.workroom_turns;
CREATE TRIGGER workroom_turns_no_modify_trg
  BEFORE UPDATE OR DELETE ON govai.workroom_turns
  FOR EACH ROW EXECUTE FUNCTION govai.workroom_turns_no_modify();

CREATE OR REPLACE FUNCTION govai.workroom_turns_no_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'workroom_turns append-only: TRUNCATE blocked'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS workroom_turns_no_truncate_trg ON govai.workroom_turns;
CREATE TRIGGER workroom_turns_no_truncate_trg
  BEFORE TRUNCATE ON govai.workroom_turns
  FOR EACH STATEMENT EXECUTE FUNCTION govai.workroom_turns_no_truncate();

-- ===========================================================================
-- RLS policies — per command × role. org_id == app.org_id (existing pattern).
-- ===========================================================================

-- workroom_policy_profiles -------------------------------------------------
DO $$ BEGIN
  CREATE POLICY workroom_policy_profiles_select_app ON govai.workroom_policy_profiles
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_policy_profiles_insert_app ON govai.workroom_policy_profiles
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_policy_profiles_select_writer ON govai.workroom_policy_profiles
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- workrooms ----------------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY workrooms_select_app ON govai.workrooms
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workrooms_insert_app ON govai.workrooms
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workrooms_select_writer ON govai.workrooms
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- agent_profiles -----------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY agent_profiles_select_app ON govai.agent_profiles
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY agent_profiles_insert_app ON govai.agent_profiles
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY agent_profiles_select_writer ON govai.agent_profiles
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- workroom_participants ----------------------------------------------------
DO $$ BEGIN
  CREATE POLICY workroom_participants_select_app ON govai.workroom_participants
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_participants_insert_app ON govai.workroom_participants
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UPDATE is permitted for the soft-remove path only (status, removed_at).
DO $$ BEGIN
  CREATE POLICY workroom_participants_update_app ON govai.workroom_participants
    FOR UPDATE TO govai_app
    USING       (org_id::text = current_setting('app.org_id', true))
    WITH CHECK  (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_participants_select_writer ON govai.workroom_participants
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- workroom_turns -----------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY workroom_turns_select_app ON govai.workroom_turns
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_turns_insert_app ON govai.workroom_turns
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_turns_select_writer ON govai.workroom_turns
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Grants
-- ===========================================================================

GRANT SELECT, INSERT         ON govai.workroom_policy_profiles TO govai_app;
GRANT SELECT, INSERT         ON govai.workrooms                TO govai_app;
GRANT SELECT, INSERT         ON govai.agent_profiles           TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.workroom_participants    TO govai_app;
GRANT SELECT, INSERT         ON govai.workroom_turns           TO govai_app;

RESET ROLE;
