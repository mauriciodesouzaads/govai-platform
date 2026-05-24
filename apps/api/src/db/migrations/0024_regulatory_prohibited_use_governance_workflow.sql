-- Migration 0024 — Regulatory Core PR-R9: Prohibited-use Governance Workflow (issue #59, umbrella #33).
--
-- Production-focused prohibited-use governance workflow built on top of the
-- deterministic Risk Classification Engine (PR-R7), the High-risk Review
-- Workflow (PR-R8), and the Agent Capability Bindings (PR-R5). This slice
-- ships prohibited-use policies, prohibited-use cases, evidence, append-only
-- determinations, denial-posture evidence, mandatory separation-of-duties for
-- final determinations (service + DB trigger), lifecycle transitions,
-- terminal-state backstops, and tenant RLS.
--
--   - govai.regulatory_prohibited_use_policies       — governance rule records.
--   - govai.regulatory_prohibited_use_cases          — case records.
--   - govai.regulatory_prohibited_use_evidence       — evidence references.
--   - govai.regulatory_prohibited_use_determinations — append-only decisions.
--
-- GOVERNANCE EVIDENCE ONLY. A case_status of DENIED records a governance
-- denial determination as evidence only. It does NOT mean runtime execution
-- was blocked; it does NOT implement gateway enforcement; it does NOT
-- intercept provider calls or tool execution; it does NOT provide legal
-- advice; it does NOT certify compliance; and it does NOT make any legal
-- conclusion. HARD_DENY_EXPECTED records an expected governance denial
-- posture for future or adjacent enforcement systems; this migration does
-- NOT perform runtime hard-deny enforcement, gateway blocking, live tool
-- enforcement, connector enforcement, or provider-side blocking.
--
-- Doctrine preserved: PR-R7 residual_risk_tier = inherent_risk_tier and
-- residual_risk_score = risk_score, with mitigation as evidence only; PR-R8
-- APPROVED is governance evidence only and never mutates classification; this
-- migration does NOT mutate risk classification tier/score and does NOT
-- mutate agent capability binding rows. PR-R8 high-risk reviews handle HIGH
-- only; PR-R9 prohibited-use cases handle PROHIBITED only — the two are not
-- interchangeable.
--
-- Scope model: all four tables are tenant-owned only (org_id NOT NULL); there
-- is no system scope. FK checks bypass RLS, so every cross-table reference is
-- visibility-checked with an explicit EXISTS in INSERT/UPDATE WITH CHECK
-- policies, and new-row columns inside EXISTS subqueries are table-qualified
-- to avoid resolving to a same-named column on the referenced table.
--
-- Conventions follow 0001 / 0012-0023: gen_random_uuid() PK defaults
-- (pgcrypto), text columns with CHECK-pinned enums, RLS ENABLE + FORCE,
-- idempotent per-command/per-role policies, guarded-update / append-only
-- triggers, mandatory SoD trigger on the determinations table, org_id columns
-- without an FK to govai.orgs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. govai.regulatory_prohibited_use_policies — governance rule records
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_prohibited_use_policies (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                        uuid        NOT NULL,
  policy_key                    text        NOT NULL,
  policy_version                text        NOT NULL,
  name                          text        NOT NULL,
  policy_status                 text        NOT NULL CHECK (policy_status IN (
                                  'DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED')),
  policy_category               text        NOT NULL CHECK (policy_category IN (
                                  'SOCIAL_SCORING',
                                  'BIOMETRIC_EMOTION_RECOGNITION',
                                  'RIGHTS_DETERMINATION_WITHOUT_HUMAN_REVIEW',
                                  'JUDICIAL_MERIT_OR_RIGHT_PLAUSIBILITY_RANKING',
                                  'TESTIMONY_OR_CREDIBILITY_RANKING',
                                  'SENSITIVE_DATA_UNLAWFUL_PROCESSING',
                                  'CHILDREN_OR_ADOLESCENTS_UNSAFE_USE',
                                  'JUDICIAL_SECRET_UNAUTHORIZED_PROCESSING',
                                  'ATTORNEY_CLIENT_PRIVILEGE_UNAUTHORIZED_PROCESSING',
                                  'UNAUTHORIZED_EXTERNAL_SIDE_EFFECT',
                                  'UNSUPERVISED_HIGH_IMPACT_AUTOMATION',
                                  'OTHER')),
  policy_basis                  text        NOT NULL CHECK (policy_basis IN (
                                  'GOVAI_BASELINE', 'RISK_CLASSIFICATION', 'REGULATORY_MAPPING',
                                  'CUSTOMER_POLICY', 'IMPORTED_EVIDENCE')),
  prohibited_use_summary        text        NOT NULL DEFAULT '',
  rationale_summary             text        NOT NULL DEFAULT '',
  detection_guidance            text        NOT NULL DEFAULT '',
  required_evidence_summary     text        NOT NULL DEFAULT '',
  denial_guidance               text        NOT NULL DEFAULT '',
  framework_profile             text        NOT NULL CHECK (framework_profile IN (
                                  'GOVAI_BASELINE', 'BR_AI_GOVERNANCE', 'CNJ_615_READINESS',
                                  'LGPD_ANPD', 'ISO_42001', 'NIST_AI_RMF', 'EU_AI_ACT_REFERENCE', 'CUSTOM')),
  regulatory_source_id          uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id                    uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id            uuid        NULL,
  updated_by_user_id            uuid        NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_prohibited_use_policies_tenant_key_uq
    UNIQUE (org_id, policy_key, policy_version)
);

CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_policies_org_key_idx
  ON govai.regulatory_prohibited_use_policies (org_id, policy_key);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_policies_org_status_idx
  ON govai.regulatory_prohibited_use_policies (org_id, policy_status);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_policies_org_category_idx
  ON govai.regulatory_prohibited_use_policies (org_id, policy_category);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_policies_org_profile_idx
  ON govai.regulatory_prohibited_use_policies (org_id, framework_profile);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_policies_org_created_idx
  ON govai.regulatory_prohibited_use_policies (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_prohibited_use_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_prohibited_use_policies FORCE  ROW LEVEL SECURITY;

COMMENT ON TABLE govai.regulatory_prohibited_use_policies IS
'Prohibited-use governance policy records. These records define governance rules and evidence expectations only; they do not implement runtime gateway blocking, legal advice, compliance certification, or provider/tool enforcement.';

-- ===========================================================================
-- B. govai.regulatory_prohibited_use_cases — prohibited-use governance cases
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_prohibited_use_cases (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                          uuid        NOT NULL,
  case_key                        text        NOT NULL,
  case_status                     text        NOT NULL CHECK (case_status IN (
                                    'OPEN', 'UNDER_REVIEW', 'DENIED', 'FALSE_POSITIVE',
                                    'CANCELLED', 'SUPERSEDED')),
  case_basis                      text        NOT NULL CHECK (case_basis IN (
                                    'RISK_CLASSIFICATION_PROHIBITED', 'AGENT_CAPABILITY_PROHIBITED',
                                    'MANUAL_ESCALATION', 'IMPORTED_EVIDENCE', 'POLICY_REVIEW')),
  prohibited_use_policy_id        uuid        NULL REFERENCES govai.regulatory_prohibited_use_policies(id),
  risk_classification_id          uuid        NULL REFERENCES govai.regulatory_risk_classifications(id),
  risk_method_id                  uuid        NULL REFERENCES govai.regulatory_risk_methods(id),
  use_case_id                     uuid        NULL REFERENCES govai.regulatory_use_cases(id),
  ai_system_id                    uuid        NULL REFERENCES govai.regulatory_ai_systems(id),
  use_case_asset_link_id          uuid        NULL REFERENCES govai.regulatory_use_case_asset_links(id),
  model_id                        uuid        NULL REFERENCES govai.regulatory_models(id),
  model_version_id                uuid        NULL REFERENCES govai.regulatory_model_versions(id),
  agent_id                        uuid        NULL REFERENCES govai.regulatory_agents(id),
  agent_version_id                uuid        NULL REFERENCES govai.regulatory_agent_versions(id),
  agent_capability_binding_id     uuid        NULL REFERENCES govai.regulatory_agent_capability_bindings(id),
  inherent_risk_tier              text        NULL CHECK (inherent_risk_tier IS NULL OR inherent_risk_tier IN (
                                    'MINIMAL', 'LOW', 'MODERATE', 'HIGH', 'PROHIBITED', 'UNKNOWN')),
  residual_risk_tier              text        NULL CHECK (residual_risk_tier IS NULL OR residual_risk_tier IN (
                                    'MINIMAL', 'LOW', 'MODERATE', 'HIGH', 'PROHIBITED', 'UNKNOWN')),
  risk_score                      integer     NULL CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100)),
  residual_risk_score             integer     NULL CHECK (residual_risk_score IS NULL OR (residual_risk_score >= 0 AND residual_risk_score <= 100)),
  requires_high_risk_review       boolean     NULL,
  requires_prohibited_use_review  boolean     NULL,
  capability_key                  text        NULL,
  capability_risk_posture         text        NULL CHECK (capability_risk_posture IS NULL OR capability_risk_posture IN (
                                    'LOW', 'MODERATE', 'HIGH', 'PROHIBITED', 'UNKNOWN')),
  hard_deny_floor_expected        boolean     NULL,
  denial_posture                  text        NOT NULL CHECK (denial_posture IN (
                                    'HARD_DENY_EXPECTED', 'GOVERNANCE_DENY_RECORDED',
                                    'MONITORING_ONLY', 'NOT_APPLICABLE')),
  requester_user_id               uuid        NULL,
  requested_by_participant_id     uuid        NULL,
  rationale_summary               text        NOT NULL DEFAULT '',
  evidence_summary                text        NOT NULL DEFAULT '',
  denial_summary                  text        NOT NULL DEFAULT '',
  review_notes                    text        NOT NULL DEFAULT '',
  cancellation_reason             text        NULL,
  supersedes_case_id              uuid        NULL REFERENCES govai.regulatory_prohibited_use_cases(id),
  superseded_by_case_id           uuid        NULL REFERENCES govai.regulatory_prohibited_use_cases(id),
  due_at                          timestamptz NULL,
  submitted_at                    timestamptz NULL,
  determined_at                   timestamptz NULL,
  cancelled_at                    timestamptz NULL,
  metadata                        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id              uuid        NULL,
  updated_by_user_id              uuid        NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  -- At least one anchor must be present (policy, classification, or capability binding).
  CONSTRAINT regulatory_prohibited_use_cases_anchor_present
    CHECK (
      risk_classification_id IS NOT NULL
      OR agent_capability_binding_id IS NOT NULL
      OR prohibited_use_policy_id IS NOT NULL
    ),
  -- Classification-anchored cases pin the PR-R7 doctrine for PROHIBITED.
  CONSTRAINT regulatory_prohibited_use_cases_classification_pinned
    CHECK (
      risk_classification_id IS NULL
      OR (
        residual_risk_tier = 'PROHIBITED'
        AND inherent_risk_tier = 'PROHIBITED'
        AND requires_prohibited_use_review = true
        AND residual_risk_score = risk_score
      )
    ),
  -- Capability-anchored cases require minimum binding snapshot fields.
  CONSTRAINT regulatory_prohibited_use_cases_capability_snapshot_present
    CHECK (
      agent_capability_binding_id IS NULL
      OR (
        agent_id IS NOT NULL
        AND capability_key IS NOT NULL
        AND capability_risk_posture IS NOT NULL
      )
    ),
  -- PROHIBITED capability posture must record HARD_DENY_EXPECTED or GOVERNANCE_DENY_RECORDED.
  CONSTRAINT regulatory_prohibited_use_cases_prohibited_capability_denial_posture
    CHECK (
      capability_risk_posture IS DISTINCT FROM 'PROHIBITED'
      OR denial_posture IN ('HARD_DENY_EXPECTED', 'GOVERNANCE_DENY_RECORDED')
    ),
  CONSTRAINT regulatory_prohibited_use_cases_model_version_requires_model
    CHECK (model_version_id IS NULL OR model_id IS NOT NULL),
  CONSTRAINT regulatory_prohibited_use_cases_agent_version_requires_agent
    CHECK (agent_version_id IS NULL OR agent_id IS NOT NULL),
  CONSTRAINT regulatory_prohibited_use_cases_determined_at_only_terminal
    CHECK (determined_at IS NULL OR case_status IN ('DENIED', 'FALSE_POSITIVE')),
  CONSTRAINT regulatory_prohibited_use_cases_cancelled_at_only_cancelled
    CHECK ((cancelled_at IS NULL) = (case_status <> 'CANCELLED')),
  CONSTRAINT regulatory_prohibited_use_cases_cancellation_reason_required
    CHECK (case_status <> 'CANCELLED' OR (cancellation_reason IS NOT NULL AND length(cancellation_reason) > 0)),
  CONSTRAINT regulatory_prohibited_use_cases_submitted_before_determined
    CHECK (submitted_at IS NULL OR determined_at IS NULL OR submitted_at <= determined_at),
  CONSTRAINT regulatory_prohibited_use_cases_tenant_key_uq UNIQUE (org_id, case_key)
);

-- Partial uniqueness: one non-terminal case per (org_id, risk_classification_id)
-- when classification is set; one non-terminal case per (org_id,
-- agent_capability_binding_id) when binding is set. Terminal statuses excluded
-- so the next workflow cycle can open a fresh case.
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_one_active_per_classification_idx
  ON govai.regulatory_prohibited_use_cases (org_id, risk_classification_id)
  WHERE case_status IN ('OPEN', 'UNDER_REVIEW') AND risk_classification_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_one_active_per_binding_idx
  ON govai.regulatory_prohibited_use_cases (org_id, agent_capability_binding_id)
  WHERE case_status IN ('OPEN', 'UNDER_REVIEW') AND agent_capability_binding_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_key_idx
  ON govai.regulatory_prohibited_use_cases (org_id, case_key);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_status_idx
  ON govai.regulatory_prohibited_use_cases (org_id, case_status);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_basis_idx
  ON govai.regulatory_prohibited_use_cases (org_id, case_basis);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_policy_idx
  ON govai.regulatory_prohibited_use_cases (org_id, prohibited_use_policy_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_classification_idx
  ON govai.regulatory_prohibited_use_cases (org_id, risk_classification_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_method_idx
  ON govai.regulatory_prohibited_use_cases (org_id, risk_method_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_use_case_idx
  ON govai.regulatory_prohibited_use_cases (org_id, use_case_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_ai_system_idx
  ON govai.regulatory_prohibited_use_cases (org_id, ai_system_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_model_idx
  ON govai.regulatory_prohibited_use_cases (org_id, model_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_model_version_idx
  ON govai.regulatory_prohibited_use_cases (org_id, model_version_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_agent_idx
  ON govai.regulatory_prohibited_use_cases (org_id, agent_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_agent_version_idx
  ON govai.regulatory_prohibited_use_cases (org_id, agent_version_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_binding_idx
  ON govai.regulatory_prohibited_use_cases (org_id, agent_capability_binding_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_denial_idx
  ON govai.regulatory_prohibited_use_cases (org_id, denial_posture);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_due_idx
  ON govai.regulatory_prohibited_use_cases (org_id, due_at);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_cases_org_created_idx
  ON govai.regulatory_prohibited_use_cases (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_prohibited_use_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_prohibited_use_cases FORCE  ROW LEVEL SECURITY;

COMMENT ON TABLE govai.regulatory_prohibited_use_cases IS
'Prohibited-use governance cases. A case_status of DENIED records a governance denial determination as evidence only; it does not mean runtime blocking occurred, does not implement gateway enforcement, and does not provide legal advice or compliance certification.';

COMMENT ON COLUMN govai.regulatory_prohibited_use_cases.case_status IS
'Lifecycle status for the prohibited-use governance case. DENIED is governance evidence only and does not authorize, block, or intercept runtime execution by itself.';

COMMENT ON COLUMN govai.regulatory_prohibited_use_cases.denial_posture IS
'Governance denial posture. HARD_DENY_EXPECTED records that runtime controls should deny this use when such controls exist; PR-R9 does not implement runtime enforcement or gateway blocking.';

-- ===========================================================================
-- C. govai.regulatory_prohibited_use_evidence — evidence references
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_prohibited_use_evidence (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid        NOT NULL,
  prohibited_use_case_id   uuid        NOT NULL REFERENCES govai.regulatory_prohibited_use_cases(id),
  evidence_key             text        NOT NULL,
  evidence_type            text        NOT NULL CHECK (evidence_type IN (
                             'RISK_CLASSIFICATION', 'CLASSIFICATION_FACTOR', 'USE_CASE_PURPOSE',
                             'DATA_SCOPE', 'HUMAN_OVERSIGHT_GAP', 'AGENT_CAPABILITY', 'POLICY_RULE',
                             'LEGAL_REVIEW_REFERENCE', 'DPO_REVIEW_REFERENCE',
                             'SECURITY_REVIEW_REFERENCE', 'BUSINESS_OWNER_ATTESTATION', 'OTHER')),
  evidence_status          text        NOT NULL CHECK (evidence_status IN (
                             'DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
  title                    text        NOT NULL,
  summary                  text        NOT NULL DEFAULT '',
  evidence_reference       text        NULL,
  source_uri               text        NULL,
  source_hash              text        NULL,
  regulatory_source_id     uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id               uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id       uuid        NULL,
  updated_by_user_id       uuid        NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_prohibited_use_evidence_uq UNIQUE (org_id, prohibited_use_case_id, evidence_key)
);

CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_evidence_org_case_idx
  ON govai.regulatory_prohibited_use_evidence (org_id, prohibited_use_case_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_evidence_org_type_idx
  ON govai.regulatory_prohibited_use_evidence (org_id, evidence_type);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_evidence_org_status_idx
  ON govai.regulatory_prohibited_use_evidence (org_id, evidence_status);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_evidence_org_created_idx
  ON govai.regulatory_prohibited_use_evidence (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_prohibited_use_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_prohibited_use_evidence FORCE  ROW LEVEL SECURITY;

COMMENT ON TABLE govai.regulatory_prohibited_use_evidence IS
'Evidence references attached to a prohibited-use governance case. Stores governance evidence references and summaries only — no provider prompts, tool manifest bodies, raw sensitive data, legal opinions generated by GovAI, medical records, or financial advice outputs. LEGAL_REVIEW_REFERENCE / DPO_REVIEW_REFERENCE / SECURITY_REVIEW_REFERENCE point at evidence supplied by users and are not legal/medical/security advice generated by GovAI.';

-- ===========================================================================
-- D. govai.regulatory_prohibited_use_determinations — append-only decisions
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_prohibited_use_determinations (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                          uuid        NOT NULL,
  prohibited_use_case_id          uuid        NOT NULL REFERENCES govai.regulatory_prohibited_use_cases(id),
  determination                   text        NOT NULL CHECK (determination IN (
                                    'PROHIBITED_CONFIRMED', 'FALSE_POSITIVE', 'NEEDS_MORE_INFORMATION')),
  denial_posture                  text        NOT NULL CHECK (denial_posture IN (
                                    'HARD_DENY_EXPECTED', 'GOVERNANCE_DENY_RECORDED',
                                    'MONITORING_ONLY', 'NOT_APPLICABLE')),
  determination_rationale         text        NOT NULL DEFAULT '',
  determined_by_user_id           uuid        NULL,
  determined_by_participant_id    uuid        NULL REFERENCES govai.workroom_participants(id),
  reviewer_role                   text        NOT NULL CHECK (reviewer_role IN (
                                    'BUSINESS_OWNER', 'DPO', 'LEGAL', 'SECURITY', 'COMPLIANCE',
                                    'TECHNICAL_OWNER', 'RISK_OWNER', 'OTHER')),
  evidence_snapshot_summary       text        NOT NULL DEFAULT '',
  required_controls_summary       text        NOT NULL DEFAULT '',
  future_enforcement_reference    text        NULL,
  determination_audit_event_id    uuid        NULL REFERENCES govai.audit_events(id),
  metadata                        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_prohibited_use_determinations_decider_present
    CHECK (determined_by_user_id IS NOT NULL OR determined_by_participant_id IS NOT NULL),
  CONSTRAINT regulatory_prohibited_use_determinations_confirmed_requires_rationale
    CHECK (determination <> 'PROHIBITED_CONFIRMED' OR (determination_rationale IS NOT NULL AND length(determination_rationale) > 0)),
  CONSTRAINT regulatory_prohibited_use_determinations_false_positive_requires_rationale
    CHECK (determination <> 'FALSE_POSITIVE' OR (determination_rationale IS NOT NULL AND length(determination_rationale) > 0)),
  CONSTRAINT regulatory_prohibited_use_determinations_confirmed_denial_posture
    CHECK (determination <> 'PROHIBITED_CONFIRMED' OR denial_posture IN ('HARD_DENY_EXPECTED', 'GOVERNANCE_DENY_RECORDED')),
  CONSTRAINT regulatory_prohibited_use_determinations_false_positive_denial_posture
    CHECK (determination <> 'FALSE_POSITIVE' OR denial_posture = 'NOT_APPLICABLE'),
  CONSTRAINT regulatory_prohibited_use_determinations_needs_more_denial_posture
    CHECK (determination <> 'NEEDS_MORE_INFORMATION' OR denial_posture IN ('MONITORING_ONLY', 'NOT_APPLICABLE'))
);

-- Partial uniqueness: at most one final PROHIBITED_CONFIRMED or FALSE_POSITIVE
-- per case. NEEDS_MORE_INFORMATION cycles freely.
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_prohibited_use_determinations_one_final_uq
  ON govai.regulatory_prohibited_use_determinations (org_id, prohibited_use_case_id)
  WHERE determination IN ('PROHIBITED_CONFIRMED', 'FALSE_POSITIVE');

CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_determinations_org_case_idx
  ON govai.regulatory_prohibited_use_determinations (org_id, prohibited_use_case_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_determinations_org_determination_idx
  ON govai.regulatory_prohibited_use_determinations (org_id, determination);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_determinations_org_denial_idx
  ON govai.regulatory_prohibited_use_determinations (org_id, denial_posture);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_determinations_org_role_idx
  ON govai.regulatory_prohibited_use_determinations (org_id, reviewer_role);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_determinations_org_user_idx
  ON govai.regulatory_prohibited_use_determinations (org_id, determined_by_user_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_determinations_org_participant_idx
  ON govai.regulatory_prohibited_use_determinations (org_id, determined_by_participant_id);
CREATE INDEX IF NOT EXISTS regulatory_prohibited_use_determinations_org_created_idx
  ON govai.regulatory_prohibited_use_determinations (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_prohibited_use_determinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_prohibited_use_determinations FORCE  ROW LEVEL SECURITY;

COMMENT ON TABLE govai.regulatory_prohibited_use_determinations IS
'Append-only prohibited-use governance determinations. PROHIBITED_CONFIRMED and denial posture values record governance evidence only; they do not implement runtime gateway blocking, provider/tool enforcement, legal advice, or compliance certification.';

COMMENT ON COLUMN govai.regulatory_prohibited_use_determinations.determination IS
'Determination on the prohibited-use governance case. PROHIBITED_CONFIRMED is governance evidence only and does not constitute a legal conclusion, does not constitute a runtime block, and does not constitute compliance certification.';

COMMENT ON COLUMN govai.regulatory_prohibited_use_determinations.denial_posture IS
'Governance denial posture for the determination. HARD_DENY_EXPECTED records expected control posture for future/adjacent enforcement systems; this table does not perform runtime enforcement.';

-- ===========================================================================
-- Triggers — guarded updates / append-only / SoD / terminal-state backstop
-- ===========================================================================

-- regulatory_prohibited_use_policies: identity immutable.
CREATE OR REPLACE FUNCTION govai.regulatory_prohibited_use_policies_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
    AND NEW.policy_key IS NOT DISTINCT FROM OLD.policy_key
    AND NEW.policy_version IS NOT DISTINCT FROM OLD.policy_version
    AND NEW.created_by_user_id IS NOT DISTINCT FROM OLD.created_by_user_id
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'regulatory_prohibited_use_policies update is restricted to mutable policy columns'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_prohibited_use_policies_guarded_update_trg
  ON govai.regulatory_prohibited_use_policies;
CREATE TRIGGER regulatory_prohibited_use_policies_guarded_update_trg
  BEFORE UPDATE ON govai.regulatory_prohibited_use_policies
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_prohibited_use_policies_guarded_update();

CREATE OR REPLACE FUNCTION govai.regulatory_prohibited_use_policies_no_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'regulatory_prohibited_use_policies: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_prohibited_use_policies_no_delete_trg
  ON govai.regulatory_prohibited_use_policies;
CREATE TRIGGER regulatory_prohibited_use_policies_no_delete_trg
  BEFORE DELETE ON govai.regulatory_prohibited_use_policies
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_prohibited_use_policies_no_delete();

DROP TRIGGER IF EXISTS regulatory_prohibited_use_policies_no_truncate_trg
  ON govai.regulatory_prohibited_use_policies;
CREATE TRIGGER regulatory_prohibited_use_policies_no_truncate_trg
  BEFORE TRUNCATE ON govai.regulatory_prohibited_use_policies
  FOR EACH STATEMENT EXECUTE FUNCTION govai.regulatory_prohibited_use_policies_no_delete();

-- regulatory_prohibited_use_cases: identity + snapshot + requester are immutable.
CREATE OR REPLACE FUNCTION govai.regulatory_prohibited_use_cases_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
    AND NEW.case_key IS NOT DISTINCT FROM OLD.case_key
    AND NEW.case_basis IS NOT DISTINCT FROM OLD.case_basis
    AND NEW.prohibited_use_policy_id IS NOT DISTINCT FROM OLD.prohibited_use_policy_id
    AND NEW.risk_classification_id IS NOT DISTINCT FROM OLD.risk_classification_id
    AND NEW.risk_method_id IS NOT DISTINCT FROM OLD.risk_method_id
    AND NEW.use_case_id IS NOT DISTINCT FROM OLD.use_case_id
    AND NEW.ai_system_id IS NOT DISTINCT FROM OLD.ai_system_id
    AND NEW.use_case_asset_link_id IS NOT DISTINCT FROM OLD.use_case_asset_link_id
    AND NEW.model_id IS NOT DISTINCT FROM OLD.model_id
    AND NEW.model_version_id IS NOT DISTINCT FROM OLD.model_version_id
    AND NEW.agent_id IS NOT DISTINCT FROM OLD.agent_id
    AND NEW.agent_version_id IS NOT DISTINCT FROM OLD.agent_version_id
    AND NEW.agent_capability_binding_id IS NOT DISTINCT FROM OLD.agent_capability_binding_id
    AND NEW.inherent_risk_tier IS NOT DISTINCT FROM OLD.inherent_risk_tier
    AND NEW.residual_risk_tier IS NOT DISTINCT FROM OLD.residual_risk_tier
    AND NEW.risk_score IS NOT DISTINCT FROM OLD.risk_score
    AND NEW.residual_risk_score IS NOT DISTINCT FROM OLD.residual_risk_score
    AND NEW.requires_high_risk_review IS NOT DISTINCT FROM OLD.requires_high_risk_review
    AND NEW.requires_prohibited_use_review IS NOT DISTINCT FROM OLD.requires_prohibited_use_review
    AND NEW.capability_key IS NOT DISTINCT FROM OLD.capability_key
    AND NEW.capability_risk_posture IS NOT DISTINCT FROM OLD.capability_risk_posture
    AND NEW.hard_deny_floor_expected IS NOT DISTINCT FROM OLD.hard_deny_floor_expected
    AND NEW.requester_user_id IS NOT DISTINCT FROM OLD.requester_user_id
    AND NEW.requested_by_participant_id IS NOT DISTINCT FROM OLD.requested_by_participant_id
    AND NEW.supersedes_case_id IS NOT DISTINCT FROM OLD.supersedes_case_id
    AND NEW.created_by_user_id IS NOT DISTINCT FROM OLD.created_by_user_id
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'regulatory_prohibited_use_cases update is restricted to lifecycle/summary/timing/supersession-target/metadata columns'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_prohibited_use_cases_guarded_update_trg
  ON govai.regulatory_prohibited_use_cases;
CREATE TRIGGER regulatory_prohibited_use_cases_guarded_update_trg
  BEFORE UPDATE ON govai.regulatory_prohibited_use_cases
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_prohibited_use_cases_guarded_update();

CREATE OR REPLACE FUNCTION govai.regulatory_prohibited_use_cases_no_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'regulatory_prohibited_use_cases: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_prohibited_use_cases_no_delete_trg
  ON govai.regulatory_prohibited_use_cases;
CREATE TRIGGER regulatory_prohibited_use_cases_no_delete_trg
  BEFORE DELETE ON govai.regulatory_prohibited_use_cases
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_prohibited_use_cases_no_delete();

DROP TRIGGER IF EXISTS regulatory_prohibited_use_cases_no_truncate_trg
  ON govai.regulatory_prohibited_use_cases;
CREATE TRIGGER regulatory_prohibited_use_cases_no_truncate_trg
  BEFORE TRUNCATE ON govai.regulatory_prohibited_use_cases
  FOR EACH STATEMENT EXECUTE FUNCTION govai.regulatory_prohibited_use_cases_no_delete();

-- regulatory_prohibited_use_evidence: identity immutable.
CREATE OR REPLACE FUNCTION govai.regulatory_prohibited_use_evidence_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
    AND NEW.prohibited_use_case_id IS NOT DISTINCT FROM OLD.prohibited_use_case_id
    AND NEW.evidence_key IS NOT DISTINCT FROM OLD.evidence_key
    AND NEW.created_by_user_id IS NOT DISTINCT FROM OLD.created_by_user_id
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'regulatory_prohibited_use_evidence update is restricted to mutable evidence columns'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_prohibited_use_evidence_guarded_update_trg
  ON govai.regulatory_prohibited_use_evidence;
CREATE TRIGGER regulatory_prohibited_use_evidence_guarded_update_trg
  BEFORE UPDATE ON govai.regulatory_prohibited_use_evidence
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_prohibited_use_evidence_guarded_update();

CREATE OR REPLACE FUNCTION govai.regulatory_prohibited_use_evidence_no_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'regulatory_prohibited_use_evidence: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_prohibited_use_evidence_no_delete_trg
  ON govai.regulatory_prohibited_use_evidence;
CREATE TRIGGER regulatory_prohibited_use_evidence_no_delete_trg
  BEFORE DELETE ON govai.regulatory_prohibited_use_evidence
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_prohibited_use_evidence_no_delete();

DROP TRIGGER IF EXISTS regulatory_prohibited_use_evidence_no_truncate_trg
  ON govai.regulatory_prohibited_use_evidence;
CREATE TRIGGER regulatory_prohibited_use_evidence_no_truncate_trg
  BEFORE TRUNCATE ON govai.regulatory_prohibited_use_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION govai.regulatory_prohibited_use_evidence_no_delete();

-- regulatory_prohibited_use_determinations: append-only.
CREATE OR REPLACE FUNCTION govai.regulatory_prohibited_use_determinations_no_modify() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'regulatory_prohibited_use_determinations append-only: % blocked', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS regulatory_prohibited_use_determinations_no_modify_trg
  ON govai.regulatory_prohibited_use_determinations;
CREATE TRIGGER regulatory_prohibited_use_determinations_no_modify_trg
  BEFORE UPDATE OR DELETE ON govai.regulatory_prohibited_use_determinations
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_prohibited_use_determinations_no_modify();

DROP TRIGGER IF EXISTS regulatory_prohibited_use_determinations_no_truncate_trg
  ON govai.regulatory_prohibited_use_determinations;
CREATE TRIGGER regulatory_prohibited_use_determinations_no_truncate_trg
  BEFORE TRUNCATE ON govai.regulatory_prohibited_use_determinations
  FOR EACH STATEMENT EXECUTE FUNCTION govai.regulatory_prohibited_use_determinations_no_modify();

-- Mandatory final-determination separation-of-duties backstop. Applies to the
-- two final determinations only — PROHIBITED_CONFIRMED and FALSE_POSITIVE.
-- NEEDS_MORE_INFORMATION may be raised by the requester (the service decides
-- whether to allow it; the DB does not block). Compared NULL-safely and
-- table-qualified against the parent case row.
CREATE OR REPLACE FUNCTION govai.regulatory_prohibited_use_determinations_sod() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.determination NOT IN ('PROHIBITED_CONFIRMED', 'FALSE_POSITIVE') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM govai.regulatory_prohibited_use_cases c
     WHERE c.id = NEW.prohibited_use_case_id
       AND (
         (c.requester_user_id IS NOT NULL
            AND NEW.determined_by_user_id IS NOT NULL
            AND c.requester_user_id = NEW.determined_by_user_id)
         OR
         (c.requested_by_participant_id IS NOT NULL
            AND NEW.determined_by_participant_id IS NOT NULL
            AND c.requested_by_participant_id = NEW.determined_by_participant_id)
       )
  ) THEN
    RAISE EXCEPTION 'prohibited_use_determination_sod_violation: requester cannot submit final determination on own case'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS regulatory_prohibited_use_determinations_sod_trg
  ON govai.regulatory_prohibited_use_determinations;
CREATE TRIGGER regulatory_prohibited_use_determinations_sod_trg
  BEFORE INSERT ON govai.regulatory_prohibited_use_determinations
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_prohibited_use_determinations_sod();

-- Terminal-case backstop: block evidence/determination inserts after the
-- parent case reaches a terminal state (DENIED, FALSE_POSITIVE, CANCELLED,
-- SUPERSEDED). The route enforces this too; this trigger is the row-level
-- defense-in-depth.
CREATE OR REPLACE FUNCTION govai.regulatory_prohibited_use_case_block_after_terminal() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM govai.regulatory_prohibited_use_cases c
     WHERE c.id = NEW.prohibited_use_case_id
       AND c.case_status IN ('DENIED', 'FALSE_POSITIVE', 'CANCELLED', 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'regulatory_prohibited_use_cases: parent case is terminal; cannot insert into %', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS regulatory_prohibited_use_evidence_terminal_trg
  ON govai.regulatory_prohibited_use_evidence;
CREATE TRIGGER regulatory_prohibited_use_evidence_terminal_trg
  BEFORE INSERT ON govai.regulatory_prohibited_use_evidence
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_prohibited_use_case_block_after_terminal();

DROP TRIGGER IF EXISTS regulatory_prohibited_use_determinations_terminal_trg
  ON govai.regulatory_prohibited_use_determinations;
CREATE TRIGGER regulatory_prohibited_use_determinations_terminal_trg
  BEFORE INSERT ON govai.regulatory_prohibited_use_determinations
  FOR EACH ROW EXECUTE FUNCTION govai.regulatory_prohibited_use_case_block_after_terminal();

-- ===========================================================================
-- RLS policies — per command × role. FK checks bypass RLS, so cross-table
-- references are visibility-checked with explicit EXISTS guards in WITH CHECK.
-- New-row columns inside EXISTS are table-qualified.
-- ===========================================================================

-- regulatory_prohibited_use_policies ---------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_policies_select_app ON govai.regulatory_prohibited_use_policies
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_policies_insert_app ON govai.regulatory_prohibited_use_policies
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_prohibited_use_policies.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_prohibited_use_policies.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_policies_update_app ON govai.regulatory_prohibited_use_policies
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_prohibited_use_policies.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_prohibited_use_policies.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_policies_select_writer ON govai.regulatory_prohibited_use_policies
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_prohibited_use_cases ------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_cases_select_app ON govai.regulatory_prohibited_use_cases
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Policy/classification/binding parents must each be own-tenant. When a
-- classification is referenced, residual=inherent=PROHIBITED and
-- requires_prohibited_use_review=true, AND all copied snapshot fields must
-- match the classification exactly. When a binding is referenced, all copied
-- snapshot fields must match the binding exactly.
DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_cases_insert_app ON govai.regulatory_prohibited_use_cases
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND (
        prohibited_use_policy_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_prohibited_use_policies p
          WHERE p.id = regulatory_prohibited_use_cases.prohibited_use_policy_id
            AND p.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        risk_classification_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_risk_classifications c
          WHERE c.id = regulatory_prohibited_use_cases.risk_classification_id
            AND c.org_id::text = current_setting('app.org_id', true)
            AND c.residual_risk_tier = 'PROHIBITED'
            AND c.inherent_risk_tier = 'PROHIBITED'
            AND c.requires_prohibited_use_review = true
            AND c.risk_method_id IS NOT DISTINCT FROM regulatory_prohibited_use_cases.risk_method_id
            AND c.use_case_id IS NOT DISTINCT FROM regulatory_prohibited_use_cases.use_case_id
            AND c.ai_system_id IS NOT DISTINCT FROM regulatory_prohibited_use_cases.ai_system_id
            AND c.use_case_asset_link_id IS NOT DISTINCT FROM regulatory_prohibited_use_cases.use_case_asset_link_id
            AND c.model_id IS NOT DISTINCT FROM regulatory_prohibited_use_cases.model_id
            AND c.model_version_id IS NOT DISTINCT FROM regulatory_prohibited_use_cases.model_version_id
            AND c.agent_id IS NOT DISTINCT FROM regulatory_prohibited_use_cases.agent_id
            AND c.agent_version_id IS NOT DISTINCT FROM regulatory_prohibited_use_cases.agent_version_id
            AND c.risk_score IS NOT DISTINCT FROM regulatory_prohibited_use_cases.risk_score
            AND c.residual_risk_score IS NOT DISTINCT FROM regulatory_prohibited_use_cases.residual_risk_score)
      )
      AND (
        agent_capability_binding_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_agent_capability_bindings b
          WHERE b.id = regulatory_prohibited_use_cases.agent_capability_binding_id
            AND b.org_id::text = current_setting('app.org_id', true)
            AND b.agent_id IS NOT DISTINCT FROM regulatory_prohibited_use_cases.agent_id
            AND b.agent_version_id IS NOT DISTINCT FROM regulatory_prohibited_use_cases.agent_version_id
            AND b.capability_key IS NOT DISTINCT FROM regulatory_prohibited_use_cases.capability_key
            AND b.risk_posture IS NOT DISTINCT FROM regulatory_prohibited_use_cases.capability_risk_posture
            AND b.hard_deny_floor_expected IS NOT DISTINCT FROM regulatory_prohibited_use_cases.hard_deny_floor_expected)
      )
      AND (
        supersedes_case_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_prohibited_use_cases prior
          WHERE prior.id = regulatory_prohibited_use_cases.supersedes_case_id
            AND prior.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        superseded_by_case_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_prohibited_use_cases next
          WHERE next.id = regulatory_prohibited_use_cases.superseded_by_case_id
            AND next.org_id::text = current_setting('app.org_id', true))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_cases_update_app ON govai.regulatory_prohibited_use_cases
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND (
        superseded_by_case_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_prohibited_use_cases next
          WHERE next.id = regulatory_prohibited_use_cases.superseded_by_case_id
            AND next.org_id::text = current_setting('app.org_id', true))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_cases_select_writer ON govai.regulatory_prohibited_use_cases
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_prohibited_use_evidence ---------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_evidence_select_app ON govai.regulatory_prohibited_use_evidence
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_evidence_insert_app ON govai.regulatory_prohibited_use_evidence
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_prohibited_use_cases c
        WHERE c.id = regulatory_prohibited_use_evidence.prohibited_use_case_id
          AND c.org_id::text = current_setting('app.org_id', true))
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_prohibited_use_evidence.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_prohibited_use_evidence.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_evidence_update_app ON govai.regulatory_prohibited_use_evidence
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_prohibited_use_cases c
        WHERE c.id = regulatory_prohibited_use_evidence.prohibited_use_case_id
          AND c.org_id::text = current_setting('app.org_id', true))
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_prohibited_use_evidence.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_prohibited_use_evidence.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_evidence_select_writer ON govai.regulatory_prohibited_use_evidence
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_prohibited_use_determinations ---------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_determinations_select_app ON govai.regulatory_prohibited_use_determinations
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_determinations_insert_app ON govai.regulatory_prohibited_use_determinations
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_prohibited_use_cases c
        WHERE c.id = regulatory_prohibited_use_determinations.prohibited_use_case_id
          AND c.org_id::text = current_setting('app.org_id', true))
      AND (
        determined_by_participant_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.workroom_participants p
          WHERE p.id = regulatory_prohibited_use_determinations.determined_by_participant_id
            AND p.org_id::text = current_setting('app.org_id', true))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_prohibited_use_determinations_select_writer ON govai.regulatory_prohibited_use_determinations
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Grants — policies/cases/evidence get SELECT/INSERT/UPDATE; determinations
-- are SELECT/INSERT only (append-only, no UPDATE grant).
-- ===========================================================================

GRANT SELECT, INSERT, UPDATE ON govai.regulatory_prohibited_use_policies       TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.regulatory_prohibited_use_cases          TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.regulatory_prohibited_use_evidence       TO govai_app;
-- Determinations are append-only and read-only via API. No UPDATE grant.
GRANT SELECT, INSERT         ON govai.regulatory_prohibited_use_determinations TO govai_app;

RESET ROLE;
