-- Migration 0013 — Workroom Phase 2: messages, tasks, evidence index (issue #51).
--
-- Adds the append-only transcript and evidence layer on top of the Phase 1
-- domain skeleton (migration 0012). Architecture:
-- docs/architecture/workroom-governance-room.md (umbrella #33).
--
-- Scope:
--   - ALTER govai.workroom_turns — widen `kind` for Phase 2 turn types and
--     add `payload_ref` (polymorphic pointer to the concrete artifact row;
--     no FK because it is polymorphic, disambiguated by `kind`).
--   - govai.workroom_messages — append-only transcript; message content is
--     NEVER stored as plaintext. `content_ref` points at the encrypted
--     audit_event_payloads row written via auditAppend.
--   - govai.workroom_tasks — task units of work; title/description are plain
--     work-metadata columns in Phase 2.
--   - govai.workroom_evidence_artifacts — queryable evidence index; every row
--     anchors to a real audit event + encrypted payload.
--
-- Workroom does NOT create a new audit chain: message/task/evidence events
-- reuse govai.audit_events / audit_event_payloads and the existing `run`
-- ChainCategory. govai.runs is intentionally untouched in Phase 2.
--
-- Conventions follow 0012: gen_random_uuid() PK defaults, RLS ENABLE + FORCE,
-- idempotent per-command/per-role policies, append-only triggers. org_id
-- columns carry no FK to govai.orgs — consistent with govai.runs / 0012.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. ALTER govai.workroom_turns — Phase 2 turn kinds + payload_ref
-- ===========================================================================

ALTER TABLE govai.workroom_turns
  ADD COLUMN IF NOT EXISTS payload_ref uuid NULL;

-- Widen the `kind` CHECK to admit Phase 2 turn types. Idempotent: drop the
-- existing constraint (Phase 1 inline name `workroom_turns_kind_check`) and
-- re-add the widened form on every migration-runner pass.
ALTER TABLE govai.workroom_turns
  DROP CONSTRAINT IF EXISTS workroom_turns_kind_check;
ALTER TABLE govai.workroom_turns
  ADD CONSTRAINT workroom_turns_kind_check
  CHECK (kind IN ('state_transition', 'participant_change', 'message', 'task', 'evidence'));

-- ===========================================================================
-- B. govai.workroom_messages — append-only transcript (encrypted content)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.workroom_messages (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid        NOT NULL,
  workroom_id           uuid        NOT NULL REFERENCES govai.workrooms(id),
  workroom_turn_id      uuid        NOT NULL REFERENCES govai.workroom_turns(id),
  participant_id        uuid        NOT NULL REFERENCES govai.workroom_participants(id),
  role                  text        NOT NULL CHECK (role IN ('user', 'assistant', 'auditor_note')),
  -- Encrypted-at-rest: content_ref points at the audit_event_payloads row
  -- (envelope-encrypted via KMS on the write path). No plaintext column.
  content_ref           uuid        NOT NULL REFERENCES govai.audit_event_payloads(id),
  payload_hash          bytea       NOT NULL,
  tokens_in             integer     NULL,
  tokens_out            integer     NULL,
  provider_invocation_id uuid       NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workroom_turn_id)
);

CREATE INDEX IF NOT EXISTS workroom_messages_org_idx
  ON govai.workroom_messages (org_id);
CREATE INDEX IF NOT EXISTS workroom_messages_workroom_turn_idx
  ON govai.workroom_messages (workroom_id, workroom_turn_id);
CREATE INDEX IF NOT EXISTS workroom_messages_participant_idx
  ON govai.workroom_messages (participant_id);

ALTER TABLE govai.workroom_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.workroom_messages FORCE  ROW LEVEL SECURITY;

-- Append-only: messages never mutate. Reject UPDATE/DELETE/TRUNCATE on any path.
CREATE OR REPLACE FUNCTION govai.workroom_messages_no_modify() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'workroom_messages append-only: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS workroom_messages_no_modify_trg ON govai.workroom_messages;
CREATE TRIGGER workroom_messages_no_modify_trg
  BEFORE UPDATE OR DELETE ON govai.workroom_messages
  FOR EACH ROW EXECUTE FUNCTION govai.workroom_messages_no_modify();

DROP TRIGGER IF EXISTS workroom_messages_no_truncate_trg ON govai.workroom_messages;
CREATE TRIGGER workroom_messages_no_truncate_trg
  BEFORE TRUNCATE ON govai.workroom_messages
  FOR EACH STATEMENT EXECUTE FUNCTION govai.workroom_messages_no_modify();

-- ===========================================================================
-- C. govai.workroom_tasks — units of work (plain work metadata)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.workroom_tasks (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid        NOT NULL,
  workroom_id              uuid        NOT NULL REFERENCES govai.workrooms(id),
  workroom_turn_id         uuid        NOT NULL REFERENCES govai.workroom_turns(id),
  title                    text        NOT NULL,
  description              text        NOT NULL DEFAULT '',
  status                   text        NOT NULL DEFAULT 'queued'
                             CHECK (status IN
                               ('draft', 'queued', 'assigned', 'running',
                                'blocked_on_approval', 'failed', 'completed', 'cancelled')),
  assigned_participant_id  uuid        NULL REFERENCES govai.workroom_participants(id),
  risk_class               text        NOT NULL CHECK (risk_class IN ('A', 'B', 'C', 'D', 'E')),
  requires_approval        boolean     NOT NULL,
  created_by_participant_id uuid       NOT NULL REFERENCES govai.workroom_participants(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workroom_turn_id)
);

CREATE INDEX IF NOT EXISTS workroom_tasks_org_idx
  ON govai.workroom_tasks (org_id);
CREATE INDEX IF NOT EXISTS workroom_tasks_workroom_status_idx
  ON govai.workroom_tasks (workroom_id, status);
CREATE INDEX IF NOT EXISTS workroom_tasks_created_by_idx
  ON govai.workroom_tasks (created_by_participant_id);

ALTER TABLE govai.workroom_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.workroom_tasks FORCE  ROW LEVEL SECURITY;

-- Phase 2 ships no task-mutation endpoint. Block DELETE/TRUNCATE defense-in-depth;
-- UPDATE is left unblocked so a later phase can transition status/assignment
-- without a migration to drop a trigger (govai_app has no UPDATE grant here).
CREATE OR REPLACE FUNCTION govai.workroom_tasks_no_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'workroom_tasks: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS workroom_tasks_no_delete_trg ON govai.workroom_tasks;
CREATE TRIGGER workroom_tasks_no_delete_trg
  BEFORE DELETE ON govai.workroom_tasks
  FOR EACH ROW EXECUTE FUNCTION govai.workroom_tasks_no_delete();

DROP TRIGGER IF EXISTS workroom_tasks_no_truncate_trg ON govai.workroom_tasks;
CREATE TRIGGER workroom_tasks_no_truncate_trg
  BEFORE TRUNCATE ON govai.workroom_tasks
  FOR EACH STATEMENT EXECUTE FUNCTION govai.workroom_tasks_no_delete();

-- ===========================================================================
-- D. govai.workroom_evidence_artifacts — queryable evidence index
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.workroom_evidence_artifacts (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL,
  workroom_id        uuid        NOT NULL REFERENCES govai.workrooms(id),
  workroom_turn_id   uuid        NOT NULL REFERENCES govai.workroom_turns(id),
  audit_event_id     uuid        NOT NULL REFERENCES govai.audit_events(id),
  artifact_kind      text        NOT NULL CHECK (artifact_kind IN (
                       'prompt', 'agent_response', 'auditor_finding', 'external_artifact',
                       'human_approval', 'merge_decision', 'file_diff', 'commit',
                       'pr', 'ci_run', 'tool_invocation_result')),
  payload_ref        uuid        NOT NULL REFERENCES govai.audit_event_payloads(id),
  payload_hash       bytea       NOT NULL,
  redaction_metadata jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status             text        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'tombstoned', 'crypto_shredded')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workroom_evidence_artifacts_org_idx
  ON govai.workroom_evidence_artifacts (org_id);
CREATE INDEX IF NOT EXISTS workroom_evidence_artifacts_workroom_kind_idx
  ON govai.workroom_evidence_artifacts (workroom_id, artifact_kind);
CREATE INDEX IF NOT EXISTS workroom_evidence_artifacts_payload_ref_idx
  ON govai.workroom_evidence_artifacts (payload_ref);
CREATE INDEX IF NOT EXISTS workroom_evidence_artifacts_audit_event_idx
  ON govai.workroom_evidence_artifacts (audit_event_id);
CREATE INDEX IF NOT EXISTS workroom_evidence_artifacts_workroom_turn_idx
  ON govai.workroom_evidence_artifacts (workroom_turn_id);

ALTER TABLE govai.workroom_evidence_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.workroom_evidence_artifacts FORCE  ROW LEVEL SECURITY;

-- Append-only except `status` (future tombstone/crypto-shred). Block
-- DELETE/TRUNCATE; UPDATE left unblocked for the future erasure path
-- (govai_app has no UPDATE grant in Phase 2).
CREATE OR REPLACE FUNCTION govai.workroom_evidence_artifacts_no_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'workroom_evidence_artifacts: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS workroom_evidence_artifacts_no_delete_trg ON govai.workroom_evidence_artifacts;
CREATE TRIGGER workroom_evidence_artifacts_no_delete_trg
  BEFORE DELETE ON govai.workroom_evidence_artifacts
  FOR EACH ROW EXECUTE FUNCTION govai.workroom_evidence_artifacts_no_delete();

DROP TRIGGER IF EXISTS workroom_evidence_artifacts_no_truncate_trg ON govai.workroom_evidence_artifacts;
CREATE TRIGGER workroom_evidence_artifacts_no_truncate_trg
  BEFORE TRUNCATE ON govai.workroom_evidence_artifacts
  FOR EACH STATEMENT EXECUTE FUNCTION govai.workroom_evidence_artifacts_no_delete();

-- ===========================================================================
-- RLS policies — per command × role. org_id == app.org_id (existing pattern).
-- ===========================================================================

-- workroom_messages --------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY workroom_messages_select_app ON govai.workroom_messages
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_messages_insert_app ON govai.workroom_messages
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_messages_select_writer ON govai.workroom_messages
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- workroom_tasks -----------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY workroom_tasks_select_app ON govai.workroom_tasks
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_tasks_insert_app ON govai.workroom_tasks
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_tasks_select_writer ON govai.workroom_tasks
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- workroom_evidence_artifacts ----------------------------------------------
DO $$ BEGIN
  CREATE POLICY workroom_evidence_artifacts_select_app ON govai.workroom_evidence_artifacts
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_evidence_artifacts_insert_app ON govai.workroom_evidence_artifacts
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workroom_evidence_artifacts_select_writer ON govai.workroom_evidence_artifacts
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Grants — govai_app gets SELECT + INSERT only (append-only in Phase 2).
-- ===========================================================================

GRANT SELECT, INSERT ON govai.workroom_messages           TO govai_app;
GRANT SELECT, INSERT ON govai.workroom_tasks              TO govai_app;
GRANT SELECT, INSERT ON govai.workroom_evidence_artifacts TO govai_app;

RESET ROLE;
