-- Migration 0023 — Regulatory Core PR-R8: High-risk Review Workflow (issue #59, umbrella #33).
--
-- Production-focused high-risk governance review workflow built on top of the
-- deterministic Risk Classification Engine (PR-R7 / migration 0022). This slice
-- ships review cases, evidence, reviewer assignments, append-only decisions,
-- separation-of-duties backstops, lifecycle transitions, and tenant RLS.
--
--   - govai.regulatory_high_risk_reviews              — review case records.
--   - govai.regulatory_high_risk_review_evidence      — evidence references.
--   - govai.regulatory_high_risk_review_assignments   — reviewer assignment evidence.
--   - govai.regulatory_high_risk_review_decisions     — append-only decisions.
--
-- GOVERNANCE EVIDENCE ONLY. A review_status of APPROVED means the high-risk
-- governance review case was completed with an approval decision recorded as
-- governance evidence only. It does NOT mean legal approval; it does NOT mean
-- compliance certification; it does NOT mean safety certification; and it does
-- NOT authorize runtime execution. PR-R8 does NOT implement prohibited-use
-- workflow, hard-deny enforcement, runtime enforcement, gateway-level blocking,
-- mitigation-weighted downgrading, legal advice, compliance certification, or
-- CNJ/Sinapses submission. High-risk review approval does not mutate the
-- underlying risk classification, does not authorize runtime execution, does
-- not bypass hard-deny controls, and does not make the AI system legally
-- compliant.
--
-- Scope model: all four tables are tenant-owned only (org_id NOT NULL); there
-- is no system scope. FK checks bypass RLS, so every cross-table reference is
-- visibility-checked with an explicit EXISTS in INSERT/UPDATE WITH CHECK
-- policies, and new-row columns inside EXISTS subqueries are table-qualified
-- to avoid resolving to a same-named column on the referenced table. The
-- review row holds a snapshot copy of the classification's
-- residual_risk_tier / inherent_risk_tier / risk_score / residual_risk_score /
-- requires_high_risk_review / requires_prohibited_use_review so PR-R7 doctrine
-- (residual_risk_tier = inherent_risk_tier; residual_risk_score = risk_score;
-- mitigation_strength is evidence-only and never downgrades) is preserved.
--
-- Conventions follow 0001 / 0012-0022: gen_random_uuid() PK defaults (pgcrypto),
-- text columns with CHECK-pinned enums, RLS ENABLE + FORCE, idempotent
-- per-command/per-role policies, guarded-update / append-only triggers,
-- org_id columns without an FK to govai.orgs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. govai.regulatory_high_risk_reviews — high-risk governance review case
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_high_risk_reviews (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                          uuid        NOT NULL,
  review_key                      text        NOT NULL,
  review_status                   text        NOT NULL CHECK (review_status IN (
                                    'OPEN', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED',
                                    'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  risk_classification_id          uuid        NOT NULL REFERENCES govai.regulatory_risk_classifications(id),
  risk_method_id                  uuid        NOT NULL REFERENCES govai.regulatory_risk_methods(id),
  use_case_id                     uuid        NOT NULL REFERENCES govai.regulatory_use_cases(id),
  ai_system_id                    uuid        NOT NULL REFERENCES govai.regulatory_ai_systems(id),
  use_case_asset_link_id          uuid        NULL REFERENCES govai.regulatory_use_case_asset_links(id),
  model_id                        uuid        NULL REFERENCES govai.regulatory_models(id),
  model_version_id                uuid        NULL REFERENCES govai.regulatory_model_versions(id),
  agent_id                        uuid        NULL REFERENCES govai.regulatory_agents(id),
  agent_version_id                uuid        NULL REFERENCES govai.regulatory_agent_versions(id),
  -- Snapshot of the classification's risk evidence. PR-R7 doctrine pinned here:
  --   residual_risk_tier = inherent_risk_tier;
  --   residual_risk_score = risk_score.
  inherent_risk_tier              text        NOT NULL CHECK (inherent_risk_tier IN ('HIGH')),
  residual_risk_tier              text        NOT NULL CHECK (residual_risk_tier IN ('HIGH')),
  risk_score                      integer     NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  residual_risk_score             integer     NOT NULL CHECK (residual_risk_score >= 0 AND residual_risk_score <= 100),
  requires_high_risk_review       boolean     NOT NULL,
  requires_prohibited_use_review  boolean     NOT NULL,
  review_basis                    text        NOT NULL CHECK (review_basis IN (
                                    'RISK_CLASSIFICATION_REQUIRED_REVIEW', 'MATERIAL_CHANGE_REVIEW',
                                    'PERIODIC_REVIEW', 'MANUAL_ESCALATION', 'IMPORTED_EVIDENCE')),
  required_approver_count         integer     NOT NULL DEFAULT 1
                                    CHECK (required_approver_count >= 1 AND required_approver_count <= 10),
  requester_user_id               uuid        NULL,
  requested_by_participant_id     uuid        NULL,
  workroom_id                     uuid        NULL REFERENCES govai.workrooms(id),
  workroom_approval_request_id    uuid        NULL REFERENCES govai.workroom_approval_requests(id),
  rationale_summary               text        NOT NULL DEFAULT '',
  evidence_summary                text        NOT NULL DEFAULT '',
  reviewer_guidance               text        NOT NULL DEFAULT '',
  decision_summary                text        NOT NULL DEFAULT '',
  cancellation_reason             text        NULL,
  supersedes_review_id            uuid        NULL REFERENCES govai.regulatory_high_risk_reviews(id),
  superseded_by_review_id         uuid        NULL REFERENCES govai.regulatory_high_risk_reviews(id),
  due_at                          timestamptz NULL,
  submitted_at                    timestamptz NULL,
  decided_at                      timestamptz NULL,
  cancelled_at                    timestamptz NULL,
  metadata                        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id              uuid        NULL,
  updated_by_user_id              uuid        NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  -- Risk-evidence doctrine (PR-R7 invariants pinned at the review row).
  CONSTRAINT regulatory_high_risk_reviews_residual_equals_inherent_tier
    CHECK (residual_risk_tier = inherent_risk_tier),
  CONSTRAINT regulatory_high_risk_reviews_residual_equals_risk_score
    CHECK (residual_risk_score = risk_score),
  CONSTRAINT regulatory_high_risk_reviews_requires_high_review_true
    CHECK (requires_high_risk_review = true),
  CONSTRAINT regulatory_high_risk_reviews_no_prohibited_review
    CHECK (requires_prohibited_use_review = false),
  -- Version-requires-parent invariants.
  CONSTRAINT regulatory_high_risk_reviews_model_version_requires_model
    CHECK (model_version_id IS NULL OR model_id IS NOT NULL),
  CONSTRAINT regulatory_high_risk_reviews_agent_version_requires_agent
    CHECK (agent_version_id IS NULL OR agent_id IS NOT NULL),
  -- Lifecycle invariants.
  CONSTRAINT regulatory_high_risk_reviews_decided_at_only_terminal
    CHECK (decided_at IS NULL OR review_status IN ('APPROVED', 'REJECTED')),
  CONSTRAINT regulatory_high_risk_reviews_cancelled_at_only_cancelled
    CHECK ((cancelled_at IS NULL) = (review_status <> 'CANCELLED')),
  CONSTRAINT regulatory_high_risk_reviews_cancellation_reason_required
    CHECK (review_status <> 'CANCELLED' OR (cancellation_reason IS NOT NULL AND length(cancellation_reason) > 0)),
  CONSTRAINT regulatory_high_risk_reviews_submitted_before_decided
    CHECK (submitted_at IS NULL OR decided_at IS NULL OR submitted_at <= decided_at),
  CONSTRAINT regulatory_high_risk_reviews_tenant_key_uq UNIQUE (org_id, review_key)
);

-- One non-terminal review per (org_id, risk_classification_id). Terminal
-- statuses (APPROVED, REJECTED, CANCELLED, SUPERSEDED) are excluded so the
-- next workflow cycle can open a fresh review.
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_high_risk_reviews_one_active_per_classification_idx
  ON govai.regulatory_high_risk_reviews (org_id, risk_classification_id)
  WHERE review_status IN ('OPEN', 'IN_REVIEW', 'CHANGES_REQUESTED');

CREATE INDEX IF NOT EXISTS regulatory_high_risk_reviews_org_key_idx
  ON govai.regulatory_high_risk_reviews (org_id, review_key);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_reviews_org_classification_idx
  ON govai.regulatory_high_risk_reviews (org_id, risk_classification_id);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_reviews_org_method_idx
  ON govai.regulatory_high_risk_reviews (org_id, risk_method_id);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_reviews_org_use_case_idx
  ON govai.regulatory_high_risk_reviews (org_id, use_case_id);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_reviews_org_ai_system_idx
  ON govai.regulatory_high_risk_reviews (org_id, ai_system_id);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_reviews_org_status_idx
  ON govai.regulatory_high_risk_reviews (org_id, review_status);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_reviews_org_residual_tier_idx
  ON govai.regulatory_high_risk_reviews (org_id, residual_risk_tier);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_reviews_org_high_review_idx
  ON govai.regulatory_high_risk_reviews (org_id, requires_high_risk_review);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_reviews_org_due_idx
  ON govai.regulatory_high_risk_reviews (org_id, due_at);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_reviews_org_workroom_idx
  ON govai.regulatory_high_risk_reviews (org_id, workroom_id);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_reviews_org_approval_request_idx
  ON govai.regulatory_high_risk_reviews (org_id, workroom_approval_request_id);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_reviews_org_created_idx
  ON govai.regulatory_high_risk_reviews (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_high_risk_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_high_risk_reviews FORCE  ROW LEVEL SECURITY;

COMMENT ON TABLE govai.regulatory_high_risk_reviews IS
'High-risk governance review cases. A review_status of APPROVED means the governance review case was completed with an approval decision as evidence only; it does not mean the AI system is legally approved, compliant, certified, safe, or authorized for runtime execution.';

COMMENT ON COLUMN govai.regulatory_high_risk_reviews.review_status IS
'Workflow status for the high-risk governance review case. APPROVED is governance evidence only and does not authorize runtime execution, mutate risk classification tier/score, certify compliance, or provide legal approval.';

-- ===========================================================================
-- B. govai.regulatory_high_risk_review_evidence — evidence references
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_high_risk_review_evidence (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL,
  high_risk_review_id  uuid        NOT NULL REFERENCES govai.regulatory_high_risk_reviews(id),
  evidence_key         text        NOT NULL,
  evidence_type        text        NOT NULL CHECK (evidence_type IN (
                         'CLASSIFICATION_RATIONALE', 'DATA_SCOPE', 'HUMAN_OVERSIGHT_PLAN',
                         'MODEL_DOCUMENTATION', 'PROVIDER_DOCUMENTATION', 'SECURITY_REVIEW',
                         'IMPACT_ASSESSMENT', 'LEGAL_REVIEW_REFERENCE', 'DPO_REVIEW_REFERENCE',
                         'BUSINESS_OWNER_ATTESTATION', 'TECHNICAL_CONTROL_EVIDENCE', 'OTHER')),
  evidence_status      text        NOT NULL CHECK (evidence_status IN (
                         'DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
  title                text        NOT NULL,
  summary              text        NOT NULL DEFAULT '',
  evidence_reference   text        NULL,
  source_uri           text        NULL,
  source_hash          text        NULL,
  regulatory_source_id uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id           uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id   uuid        NULL,
  updated_by_user_id   uuid        NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_high_risk_review_evidence_uq UNIQUE (org_id, high_risk_review_id, evidence_key)
);

CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_evidence_org_review_idx
  ON govai.regulatory_high_risk_review_evidence (org_id, high_risk_review_id);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_evidence_org_type_idx
  ON govai.regulatory_high_risk_review_evidence (org_id, evidence_type);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_evidence_org_status_idx
  ON govai.regulatory_high_risk_review_evidence (org_id, evidence_status);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_evidence_org_created_idx
  ON govai.regulatory_high_risk_review_evidence (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_high_risk_review_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_high_risk_review_evidence FORCE  ROW LEVEL SECURITY;

COMMENT ON TABLE govai.regulatory_high_risk_review_evidence IS
'Evidence references attached to a high-risk governance review case. Stores governance evidence references and summaries only — no provider prompts, tool manifest bodies, raw sensitive data, legal opinions generated by GovAI, medical records, or financial advice outputs. LEGAL_REVIEW_REFERENCE and DPO_REVIEW_REFERENCE point at evidence supplied by users and are not legal advice generated by GovAI.';

-- ===========================================================================
-- C. govai.regulatory_high_risk_review_assignments — reviewer assignments
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_high_risk_review_assignments (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid        NOT NULL,
  high_risk_review_id         uuid        NOT NULL REFERENCES govai.regulatory_high_risk_reviews(id),
  assignee_user_id            uuid        NULL,
  assignee_participant_id     uuid        NULL REFERENCES govai.workroom_participants(id),
  reviewer_role               text        NOT NULL CHECK (reviewer_role IN (
                                'BUSINESS_OWNER', 'DPO', 'LEGAL', 'SECURITY', 'COMPLIANCE',
                                'TECHNICAL_OWNER', 'RISK_OWNER', 'OTHER')),
  assignment_status           text        NOT NULL CHECK (assignment_status IN (
                                'ASSIGNED', 'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED')),
  assigned_by_user_id         uuid        NULL,
  assigned_at                 timestamptz NOT NULL DEFAULT now(),
  acknowledged_at             timestamptz NULL,
  completed_at                timestamptz NULL,
  metadata                    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_high_risk_review_assignments_assignee_present
    CHECK (assignee_user_id IS NOT NULL OR assignee_participant_id IS NOT NULL),
  CONSTRAINT regulatory_high_risk_review_assignments_completed_after_ack
    CHECK (completed_at IS NULL OR acknowledged_at IS NULL OR completed_at >= acknowledged_at)
);

-- Partial uniqueness: no duplicate active assignment for the same review +
-- role + assignee identity. Cancelled/Completed entries do not block re-issue.
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_high_risk_review_assignments_active_user_uq
  ON govai.regulatory_high_risk_review_assignments
     (org_id, high_risk_review_id, reviewer_role, assignee_user_id)
  WHERE assignment_status IN ('ASSIGNED', 'ACKNOWLEDGED') AND assignee_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_high_risk_review_assignments_active_participant_uq
  ON govai.regulatory_high_risk_review_assignments
     (org_id, high_risk_review_id, reviewer_role, assignee_participant_id)
  WHERE assignment_status IN ('ASSIGNED', 'ACKNOWLEDGED') AND assignee_participant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_assignments_org_review_idx
  ON govai.regulatory_high_risk_review_assignments (org_id, high_risk_review_id);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_assignments_org_role_idx
  ON govai.regulatory_high_risk_review_assignments (org_id, reviewer_role);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_assignments_org_status_idx
  ON govai.regulatory_high_risk_review_assignments (org_id, assignment_status);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_assignments_org_user_idx
  ON govai.regulatory_high_risk_review_assignments (org_id, assignee_user_id);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_assignments_org_participant_idx
  ON govai.regulatory_high_risk_review_assignments (org_id, assignee_participant_id);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_assignments_org_created_idx
  ON govai.regulatory_high_risk_review_assignments (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_high_risk_review_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_high_risk_review_assignments FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- D. govai.regulatory_high_risk_review_decisions — append-only decisions
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_high_risk_review_decisions (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid        NOT NULL,
  high_risk_review_id         uuid        NOT NULL REFERENCES govai.regulatory_high_risk_reviews(id),
  decision                    text        NOT NULL CHECK (decision IN (
                                'APPROVE', 'REJECT', 'REQUEST_CHANGES')),
  decision_rationale          text        NOT NULL DEFAULT '',
  decided_by_user_id          uuid        NULL,
  decided_by_participant_id   uuid        NULL REFERENCES govai.workroom_participants(id),
  reviewer_role               text        NOT NULL CHECK (reviewer_role IN (
                                'BUSINESS_OWNER', 'DPO', 'LEGAL', 'SECURITY', 'COMPLIANCE',
                                'TECHNICAL_OWNER', 'RISK_OWNER', 'OTHER')),
  evidence_snapshot_summary   text        NOT NULL DEFAULT '',
  conditions_summary          text        NOT NULL DEFAULT '',
  expiry_at                   timestamptz NULL,
  decision_audit_event_id     uuid        NULL REFERENCES govai.audit_events(id),
  metadata                    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_high_risk_review_decisions_decider_present
    CHECK (decided_by_user_id IS NOT NULL OR decided_by_participant_id IS NOT NULL),
  CONSTRAINT regulatory_high_risk_review_decisions_reject_requires_rationale
    CHECK (decision <> 'REJECT' OR (decision_rationale IS NOT NULL AND length(decision_rationale) > 0)),
  CONSTRAINT regulatory_high_risk_review_decisions_changes_requires_rationale
    CHECK (decision <> 'REQUEST_CHANGES' OR (decision_rationale IS NOT NULL AND length(decision_rationale) > 0))
);

-- Partial uniqueness: at most one final APPROVE or REJECT decision per review.
-- REQUEST_CHANGES does not consume the slot since it can cycle.
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_high_risk_review_decisions_one_final_uq
  ON govai.regulatory_high_risk_review_decisions (org_id, high_risk_review_id)
  WHERE decision IN ('APPROVE', 'REJECT');

CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_decisions_org_review_idx
  ON govai.regulatory_high_risk_review_decisions (org_id, high_risk_review_id);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_decisions_org_decision_idx
  ON govai.regulatory_high_risk_review_decisions (org_id, decision);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_decisions_org_role_idx
  ON govai.regulatory_high_risk_review_decisions (org_id, reviewer_role);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_decisions_org_user_idx
  ON govai.regulatory_high_risk_review_decisions (org_id, decided_by_user_id);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_decisions_org_participant_idx
  ON govai.regulatory_high_risk_review_decisions (org_id, decided_by_participant_id);
CREATE INDEX IF NOT EXISTS regulatory_high_risk_review_decisions_org_created_idx
  ON govai.regulatory_high_risk_review_decisions (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_high_risk_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_high_risk_review_decisions FORCE  ROW LEVEL SECURITY;

COMMENT ON TABLE govai.regulatory_high_risk_review_decisions IS
'Append-only high-risk review decisions. APPROVE records a governance decision on the review case only; it does not certify legal compliance, authorize runtime execution, or implement enforcement.';

COMMENT ON COLUMN govai.regulatory_high_risk_review_decisions.decision IS
'Decision on the high-risk review case. APPROVE is not legal approval, compliance certification, runtime authorization, or hard-deny bypass.';

-- ===========================================================================
-- Triggers — guarded updates / append-only / SoD / terminal-state backstop
-- ===========================================================================

-- regulatory_high_risk_reviews: identity + risk snapshot + requester fields are
-- immutable. Only lifecycle, summaries, timing, supersession-target, and
-- metadata may change via UPDATE.
CREATE OR REPLACE FUNCTION govai.regulatory_high_risk_reviews_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
    AND NEW.review_key IS NOT DISTINCT FROM OLD.review_key
    AND NEW.risk_classification_id IS NOT DISTINCT FROM OLD.risk_classification_id
    AND NEW.risk_method_id IS NOT DISTINCT FROM OLD.risk_method_id
    AND NEW.use_case_id IS NOT DISTINCT FROM OLD.use_case_id
    AND NEW.ai_system_id IS NOT DISTINCT FROM OLD.ai_system_id
    AND NEW.use_case_asset_link_id IS NOT DISTINCT FROM OLD.use_case_asset_link_id
    AND NEW.model_id IS NOT DISTINCT FROM OLD.model_id
    AND NEW.model_version_id IS NOT DISTINCT FROM OLD.model_version_id
    AND NEW.agent_id IS NOT DISTINCT FROM OLD.agent_id
    AND NEW.agent_version_id IS NOT DISTINCT FROM OLD.agent_version_id
    AND NEW.inherent_risk_tier IS NOT DISTINCT FROM OLD.inherent_risk_tier
    AND NEW.residual_risk_tier IS NOT DISTINCT FROM OLD.residual_risk_tier
    AND NEW.risk_score IS NOT DISTINCT FROM OLD.risk_score
    AND NEW.residual_risk_score IS NOT DISTINCT FROM OLD.residual_risk_score
    AND NEW.requires_high_risk_review IS NOT DISTINCT FROM OLD.requires_high_risk_review
    AND NEW.requires_prohibited_use_review IS NOT DISTINCT FROM OLD.requires_prohibited_use_review
    AND NEW.review_basis IS NOT DISTINCT FROM OLD.review_basis
    AND NEW.required_approver_count IS NOT DISTINCT FROM OLD.required_approver_count
    AND NEW.requester_user_id IS NOT DISTINCT FROM OLD.requester_user_id
    AND NEW.requested_by_participant_id IS NOT DISTINCT FROM OLD.requested_by_participant_id
    AND NEW.workroom_id IS NOT DISTINCT FROM OLD.workroom_id
    AND NEW.workroom_approval_request_id IS NOT DISTINCT FROM OLD.workroom_approval_request_id
    AND NEW.supersedes_review_id IS NOT DISTINCT FROM OLD.supersedes_review_id
    AND NEW.created_by_user_id IS NOT DISTINCT FROM OLD.created_by_user_id
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'regulatory_high_risk_reviews update is restricted to lifecycle/summary/timing/supersession-target/metadata columns'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_high_risk_reviews_guarded_update_trg
  ON govai.regulatory_high_risk_reviews;
CREATE TRIGGER regulatory_high_risk_reviews_guarded_update_trg
  BEFORE UPDATE ON govai.regulatory_high_risk_reviews
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_high_risk_reviews_guarded_update();

CREATE OR REPLACE FUNCTION govai.regulatory_high_risk_reviews_no_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'regulatory_high_risk_reviews: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_high_risk_reviews_no_delete_trg
  ON govai.regulatory_high_risk_reviews;
CREATE TRIGGER regulatory_high_risk_reviews_no_delete_trg
  BEFORE DELETE ON govai.regulatory_high_risk_reviews
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_high_risk_reviews_no_delete();

DROP TRIGGER IF EXISTS regulatory_high_risk_reviews_no_truncate_trg
  ON govai.regulatory_high_risk_reviews;
CREATE TRIGGER regulatory_high_risk_reviews_no_truncate_trg
  BEFORE TRUNCATE ON govai.regulatory_high_risk_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION govai.regulatory_high_risk_reviews_no_delete();

-- regulatory_high_risk_review_evidence: identity immutable.
CREATE OR REPLACE FUNCTION govai.regulatory_high_risk_review_evidence_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
    AND NEW.high_risk_review_id IS NOT DISTINCT FROM OLD.high_risk_review_id
    AND NEW.evidence_key IS NOT DISTINCT FROM OLD.evidence_key
    AND NEW.created_by_user_id IS NOT DISTINCT FROM OLD.created_by_user_id
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'regulatory_high_risk_review_evidence update is restricted to mutable evidence columns'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_high_risk_review_evidence_guarded_update_trg
  ON govai.regulatory_high_risk_review_evidence;
CREATE TRIGGER regulatory_high_risk_review_evidence_guarded_update_trg
  BEFORE UPDATE ON govai.regulatory_high_risk_review_evidence
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_high_risk_review_evidence_guarded_update();

CREATE OR REPLACE FUNCTION govai.regulatory_high_risk_review_evidence_no_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'regulatory_high_risk_review_evidence: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_high_risk_review_evidence_no_delete_trg
  ON govai.regulatory_high_risk_review_evidence;
CREATE TRIGGER regulatory_high_risk_review_evidence_no_delete_trg
  BEFORE DELETE ON govai.regulatory_high_risk_review_evidence
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_high_risk_review_evidence_no_delete();

DROP TRIGGER IF EXISTS regulatory_high_risk_review_evidence_no_truncate_trg
  ON govai.regulatory_high_risk_review_evidence;
CREATE TRIGGER regulatory_high_risk_review_evidence_no_truncate_trg
  BEFORE TRUNCATE ON govai.regulatory_high_risk_review_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION govai.regulatory_high_risk_review_evidence_no_delete();

-- regulatory_high_risk_review_assignments: identity immutable.
CREATE OR REPLACE FUNCTION govai.regulatory_high_risk_review_assignments_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
    AND NEW.high_risk_review_id IS NOT DISTINCT FROM OLD.high_risk_review_id
    AND NEW.assignee_user_id IS NOT DISTINCT FROM OLD.assignee_user_id
    AND NEW.assignee_participant_id IS NOT DISTINCT FROM OLD.assignee_participant_id
    AND NEW.reviewer_role IS NOT DISTINCT FROM OLD.reviewer_role
    AND NEW.assigned_by_user_id IS NOT DISTINCT FROM OLD.assigned_by_user_id
    AND NEW.assigned_at IS NOT DISTINCT FROM OLD.assigned_at
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'regulatory_high_risk_review_assignments update is restricted to status/acknowledged_at/completed_at/metadata columns'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_high_risk_review_assignments_guarded_update_trg
  ON govai.regulatory_high_risk_review_assignments;
CREATE TRIGGER regulatory_high_risk_review_assignments_guarded_update_trg
  BEFORE UPDATE ON govai.regulatory_high_risk_review_assignments
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_high_risk_review_assignments_guarded_update();

CREATE OR REPLACE FUNCTION govai.regulatory_high_risk_review_assignments_no_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'regulatory_high_risk_review_assignments: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_high_risk_review_assignments_no_delete_trg
  ON govai.regulatory_high_risk_review_assignments;
CREATE TRIGGER regulatory_high_risk_review_assignments_no_delete_trg
  BEFORE DELETE ON govai.regulatory_high_risk_review_assignments
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_high_risk_review_assignments_no_delete();

DROP TRIGGER IF EXISTS regulatory_high_risk_review_assignments_no_truncate_trg
  ON govai.regulatory_high_risk_review_assignments;
CREATE TRIGGER regulatory_high_risk_review_assignments_no_truncate_trg
  BEFORE TRUNCATE ON govai.regulatory_high_risk_review_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION govai.regulatory_high_risk_review_assignments_no_delete();

-- regulatory_high_risk_review_decisions: append-only.
CREATE OR REPLACE FUNCTION govai.regulatory_high_risk_review_decisions_no_modify() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'regulatory_high_risk_review_decisions append-only: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_high_risk_review_decisions_no_modify_trg
  ON govai.regulatory_high_risk_review_decisions;
CREATE TRIGGER regulatory_high_risk_review_decisions_no_modify_trg
  BEFORE UPDATE OR DELETE ON govai.regulatory_high_risk_review_decisions
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_high_risk_review_decisions_no_modify();

DROP TRIGGER IF EXISTS regulatory_high_risk_review_decisions_no_truncate_trg
  ON govai.regulatory_high_risk_review_decisions;
CREATE TRIGGER regulatory_high_risk_review_decisions_no_truncate_trg
  BEFORE TRUNCATE ON govai.regulatory_high_risk_review_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION govai.regulatory_high_risk_review_decisions_no_modify();

-- Separation of duties backstop: the requester cannot decide their own review.
-- Compared NULL-safely (IS NOT DISTINCT FROM) and table-qualified against the
-- parent review row. The route enforces this too with a clean 403; this
-- trigger is the row-level defense-in-depth.
CREATE OR REPLACE FUNCTION govai.regulatory_high_risk_review_decisions_sod() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM govai.regulatory_high_risk_reviews r
     WHERE r.id = NEW.high_risk_review_id
       AND (
         (r.requester_user_id IS NOT NULL
            AND NEW.decided_by_user_id IS NOT NULL
            AND r.requester_user_id = NEW.decided_by_user_id)
         OR
         (r.requested_by_participant_id IS NOT NULL
            AND NEW.decided_by_participant_id IS NOT NULL
            AND r.requested_by_participant_id = NEW.decided_by_participant_id)
       )
  ) THEN
    RAISE EXCEPTION 'regulatory_high_risk_review_decisions: separation of duties violated (requester cannot decide own review)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS regulatory_high_risk_review_decisions_sod_trg
  ON govai.regulatory_high_risk_review_decisions;
CREATE TRIGGER regulatory_high_risk_review_decisions_sod_trg
  BEFORE INSERT ON govai.regulatory_high_risk_review_decisions
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_high_risk_review_decisions_sod();

-- Terminal-review backstop: block evidence/assignment/decision inserts after
-- the parent review reaches a terminal state (APPROVED, REJECTED, CANCELLED,
-- SUPERSEDED). The route enforces this too; this trigger is the row-level
-- defense-in-depth.
CREATE OR REPLACE FUNCTION govai.regulatory_high_risk_review_block_after_terminal() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM govai.regulatory_high_risk_reviews r
     WHERE r.id = NEW.high_risk_review_id
       AND r.review_status IN ('APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'regulatory_high_risk_reviews: parent review is terminal; cannot insert into %', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS regulatory_high_risk_review_evidence_terminal_trg
  ON govai.regulatory_high_risk_review_evidence;
CREATE TRIGGER regulatory_high_risk_review_evidence_terminal_trg
  BEFORE INSERT ON govai.regulatory_high_risk_review_evidence
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_high_risk_review_block_after_terminal();

DROP TRIGGER IF EXISTS regulatory_high_risk_review_assignments_terminal_trg
  ON govai.regulatory_high_risk_review_assignments;
CREATE TRIGGER regulatory_high_risk_review_assignments_terminal_trg
  BEFORE INSERT ON govai.regulatory_high_risk_review_assignments
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_high_risk_review_block_after_terminal();

DROP TRIGGER IF EXISTS regulatory_high_risk_review_decisions_terminal_trg
  ON govai.regulatory_high_risk_review_decisions;
CREATE TRIGGER regulatory_high_risk_review_decisions_terminal_trg
  BEFORE INSERT ON govai.regulatory_high_risk_review_decisions
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_high_risk_review_block_after_terminal();

-- ===========================================================================
-- RLS policies — per command × role. FK checks bypass RLS, so cross-table
-- references are visibility-checked with explicit EXISTS guards in WITH CHECK.
-- New-row columns inside EXISTS are table-qualified.
-- ===========================================================================

-- regulatory_high_risk_reviews ---------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_reviews_select_app ON govai.regulatory_high_risk_reviews
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Classification parent must be own-tenant AND have residual=inherent=HIGH,
-- requires_high_risk_review=true, requires_prohibited_use_review=false. The
-- copied risk_method_id / use_case_id / ai_system_id and optional asset/
-- model/version/agent/version pointers must match the classification's own
-- pointers exactly. Workroom + approval-request links and supersession
-- pointers are validated for own-tenant visibility.
DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_reviews_insert_app ON govai.regulatory_high_risk_reviews
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (
        SELECT 1 FROM govai.regulatory_risk_classifications c
         WHERE c.id = regulatory_high_risk_reviews.risk_classification_id
           AND c.org_id::text = current_setting('app.org_id', true)
           AND c.residual_risk_tier = 'HIGH'
           AND c.inherent_risk_tier = 'HIGH'
           AND c.requires_high_risk_review = true
           AND c.requires_prohibited_use_review = false
           AND c.risk_method_id = regulatory_high_risk_reviews.risk_method_id
           AND c.use_case_id = regulatory_high_risk_reviews.use_case_id
           AND c.ai_system_id = regulatory_high_risk_reviews.ai_system_id
           AND c.use_case_asset_link_id IS NOT DISTINCT FROM regulatory_high_risk_reviews.use_case_asset_link_id
           AND c.model_id IS NOT DISTINCT FROM regulatory_high_risk_reviews.model_id
           AND c.model_version_id IS NOT DISTINCT FROM regulatory_high_risk_reviews.model_version_id
           AND c.agent_id IS NOT DISTINCT FROM regulatory_high_risk_reviews.agent_id
           AND c.agent_version_id IS NOT DISTINCT FROM regulatory_high_risk_reviews.agent_version_id
           AND c.risk_score = regulatory_high_risk_reviews.risk_score
           AND c.residual_risk_score = regulatory_high_risk_reviews.residual_risk_score
      )
      AND (
        workroom_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.workrooms w
          WHERE w.id = regulatory_high_risk_reviews.workroom_id
            AND w.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        workroom_approval_request_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.workroom_approval_requests ar
          WHERE ar.id = regulatory_high_risk_reviews.workroom_approval_request_id
            AND ar.org_id::text = current_setting('app.org_id', true)
            AND (regulatory_high_risk_reviews.workroom_id IS NULL
                 OR ar.workroom_id = regulatory_high_risk_reviews.workroom_id))
      )
      AND (
        supersedes_review_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_high_risk_reviews prior
          WHERE prior.id = regulatory_high_risk_reviews.supersedes_review_id
            AND prior.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        superseded_by_review_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_high_risk_reviews next
          WHERE next.id = regulatory_high_risk_reviews.superseded_by_review_id
            AND next.org_id::text = current_setting('app.org_id', true))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_reviews_update_app ON govai.regulatory_high_risk_reviews
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND (
        superseded_by_review_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_high_risk_reviews next
          WHERE next.id = regulatory_high_risk_reviews.superseded_by_review_id
            AND next.org_id::text = current_setting('app.org_id', true))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_reviews_select_writer ON govai.regulatory_high_risk_reviews
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_high_risk_review_evidence -------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_review_evidence_select_app ON govai.regulatory_high_risk_review_evidence
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_review_evidence_insert_app ON govai.regulatory_high_risk_review_evidence
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_high_risk_reviews r
        WHERE r.id = regulatory_high_risk_review_evidence.high_risk_review_id
          AND r.org_id::text = current_setting('app.org_id', true))
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_high_risk_review_evidence.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_high_risk_review_evidence.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_review_evidence_update_app ON govai.regulatory_high_risk_review_evidence
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_high_risk_reviews r
        WHERE r.id = regulatory_high_risk_review_evidence.high_risk_review_id
          AND r.org_id::text = current_setting('app.org_id', true))
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_high_risk_review_evidence.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_high_risk_review_evidence.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_review_evidence_select_writer ON govai.regulatory_high_risk_review_evidence
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_high_risk_review_assignments ----------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_review_assignments_select_app ON govai.regulatory_high_risk_review_assignments
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_review_assignments_insert_app ON govai.regulatory_high_risk_review_assignments
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_high_risk_reviews r
        WHERE r.id = regulatory_high_risk_review_assignments.high_risk_review_id
          AND r.org_id::text = current_setting('app.org_id', true))
      AND (
        assignee_participant_id IS NULL
        OR EXISTS (
          SELECT 1
            FROM govai.workroom_participants p
            JOIN govai.regulatory_high_risk_reviews r
              ON r.id = regulatory_high_risk_review_assignments.high_risk_review_id
           WHERE p.id = regulatory_high_risk_review_assignments.assignee_participant_id
             AND p.org_id::text = current_setting('app.org_id', true)
             AND (r.workroom_id IS NULL OR p.workroom_id = r.workroom_id)
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_review_assignments_update_app ON govai.regulatory_high_risk_review_assignments
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_high_risk_reviews r
        WHERE r.id = regulatory_high_risk_review_assignments.high_risk_review_id
          AND r.org_id::text = current_setting('app.org_id', true))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_review_assignments_select_writer ON govai.regulatory_high_risk_review_assignments
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_high_risk_review_decisions ------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_review_decisions_select_app ON govai.regulatory_high_risk_review_decisions
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_review_decisions_insert_app ON govai.regulatory_high_risk_review_decisions
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_high_risk_reviews r
        WHERE r.id = regulatory_high_risk_review_decisions.high_risk_review_id
          AND r.org_id::text = current_setting('app.org_id', true))
      AND (
        decided_by_participant_id IS NULL
        OR EXISTS (
          SELECT 1
            FROM govai.workroom_participants p
            JOIN govai.regulatory_high_risk_reviews r
              ON r.id = regulatory_high_risk_review_decisions.high_risk_review_id
           WHERE p.id = regulatory_high_risk_review_decisions.decided_by_participant_id
             AND p.org_id::text = current_setting('app.org_id', true)
             AND (r.workroom_id IS NULL OR p.workroom_id = r.workroom_id)
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_high_risk_review_decisions_select_writer ON govai.regulatory_high_risk_review_decisions
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Grants — reviews/evidence/assignments get SELECT/INSERT/UPDATE;
-- decisions are SELECT/INSERT only (append-only, no UPDATE grant).
-- ===========================================================================

GRANT SELECT, INSERT, UPDATE ON govai.regulatory_high_risk_reviews              TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.regulatory_high_risk_review_evidence      TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.regulatory_high_risk_review_assignments   TO govai_app;
-- Decisions are append-only and read-only via API. No UPDATE grant is intentional.
GRANT SELECT, INSERT         ON govai.regulatory_high_risk_review_decisions     TO govai_app;

RESET ROLE;
