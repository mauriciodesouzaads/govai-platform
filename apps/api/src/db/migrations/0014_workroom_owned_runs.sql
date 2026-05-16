-- Migration 0014 — Workroom Phase 3: Workroom-owned runs (issue #53).
--
-- Adds the parent edge from Workrooms to the existing run primitive
-- (architecture: docs/architecture/workroom-governance-room.md, umbrella #33).
--
-- Scope:
--   - ALTER govai.runs — five nullable Workroom-linkage columns. Standalone
--     runs keep NULL in all of them; existing rows are untouched.
--   - Widen govai.workroom_turns.kind to admit 'run_event' so a Workroom-owned
--     run can anchor a turn to its real run.completed / run.failed audit event.
--
-- /v1/runs remains the canonical execution primitive. No new audit chain, no
-- provider/governed/passthrough changes, no Workroom-owned run orchestration
-- beyond the parent edge. govai.runs RLS is unchanged.

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. govai.runs — nullable Workroom-owned run linkage
-- ===========================================================================

ALTER TABLE govai.runs
  ADD COLUMN IF NOT EXISTS workroom_id uuid NULL REFERENCES govai.workrooms(id),
  ADD COLUMN IF NOT EXISTS workroom_task_id uuid NULL REFERENCES govai.workroom_tasks(id),
  ADD COLUMN IF NOT EXISTS created_by_participant_id uuid NULL
    REFERENCES govai.workroom_participants(id),
  ADD COLUMN IF NOT EXISTS approval_policy_id uuid NULL,
  ADD COLUMN IF NOT EXISTS workroom_governance_mode text NULL;

-- workroom_governance_mode is a snapshot of the parent Workroom's mode; NULL
-- for standalone runs. Idempotent drop/recreate of the named CHECK.
ALTER TABLE govai.runs
  DROP CONSTRAINT IF EXISTS runs_workroom_governance_mode_check;
ALTER TABLE govai.runs
  ADD CONSTRAINT runs_workroom_governance_mode_check
  CHECK (
    workroom_governance_mode IS NULL
    OR workroom_governance_mode IN ('governance_active', 'audit_only')
  );

CREATE INDEX IF NOT EXISTS runs_workroom_idx
  ON govai.runs (workroom_id);
CREATE INDEX IF NOT EXISTS runs_workroom_task_idx
  ON govai.runs (workroom_task_id);
CREATE INDEX IF NOT EXISTS runs_created_by_participant_idx
  ON govai.runs (created_by_participant_id);
CREATE INDEX IF NOT EXISTS runs_org_workroom_idx
  ON govai.runs (org_id, workroom_id);

-- ===========================================================================
-- B. govai.workroom_turns — admit the 'run_event' turn kind
-- ===========================================================================

-- Idempotent: drop the existing constraint (Phase 1/2 name
-- `workroom_turns_kind_check`) and re-add the widened form on every pass.
ALTER TABLE govai.workroom_turns
  DROP CONSTRAINT IF EXISTS workroom_turns_kind_check;
ALTER TABLE govai.workroom_turns
  ADD CONSTRAINT workroom_turns_kind_check
  CHECK (kind IN
    ('state_transition', 'participant_change', 'message', 'task', 'evidence', 'run_event'));

RESET ROLE;
