-- Migration 0022 — Regulatory Core PR-R7: Risk Classification Engine (issue #59, umbrella #33).
--
-- Production-focused deterministic technical risk classifier and its evidence
-- tables. Next P0 Native Regulatory Core foundation after the source registry /
-- control catalog (PR-R1 / 0016), the AI System / Provider / Model / Agent /
-- Use-case registries (PR-R2..R6 / 0017..0021).
--
--   - govai.regulatory_risk_methods                    — methodology evidence.
--   - govai.regulatory_risk_classifications            — classification records.
--   - govai.regulatory_risk_classification_factors     — factor evidence rows.
--   - govai.regulatory_reclassification_triggers       — trigger evidence rows.
--
-- TECHNICAL GOVERNANCE EVIDENCE ONLY. Classifications are deterministic
-- technical evidence with rationale and factor records. PR-R7 does NOT
-- implement high-risk approval workflow, prohibited-use hard-deny workflow,
-- runtime enforcement, mitigation-weighted downgrading, legal advice,
-- compliance certification, or CNJ/Sinapses submission. Mitigation posture is
-- recorded as evidence only; residual risk mirrors inherent risk in PR-R7. The
-- review flags (requires_high_risk_review / requires_prohibited_use_review)
-- record that review attention is required — they do NOT create workflows,
-- assign reviewers, block execution, or enforce runtime decisions.
--
-- Scope model: all four tables are tenant-owned only (org_id NOT NULL); there
-- is no system scope. FK checks bypass RLS, so every cross-table reference is
-- visibility-checked with an explicit EXISTS in INSERT/UPDATE WITH CHECK
-- policies, and new-row columns inside EXISTS subqueries are table-qualified
-- to avoid resolving to a same-named column on the referenced table.
--
-- Conventions follow 0001 / 0012-0021: gen_random_uuid() PK defaults (pgcrypto),
-- text columns with CHECK-pinned enums, RLS ENABLE + FORCE, idempotent
-- per-command/per-role policies, org_id columns without an FK to govai.orgs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. govai.regulatory_risk_methods — tenant risk methodology evidence
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_risk_methods (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid        NOT NULL,
  method_key                  text        NOT NULL,
  method_version              text        NOT NULL,
  name                        text        NOT NULL,
  method_status               text        NOT NULL CHECK (method_status IN (
                                'DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED')),
  framework_profile           text        NOT NULL CHECK (framework_profile IN (
                                'GOVAI_BASELINE', 'BR_AI_GOVERNANCE', 'CNJ_615_READINESS',
                                'LGPD_ANPD', 'ISO_42001', 'NIST_AI_RMF', 'EU_AI_ACT_REFERENCE', 'CUSTOM')),
  methodology_summary         text        NOT NULL DEFAULT '',
  scoring_summary             text        NOT NULL DEFAULT '',
  high_risk_criteria_summary  text        NOT NULL DEFAULT '',
  prohibited_criteria_summary text        NOT NULL DEFAULT '',
  mitigation_policy_summary   text        NOT NULL DEFAULT '',
  regulatory_source_id        uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id                  uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata                    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id          uuid        NULL,
  updated_by_user_id          uuid        NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_risk_methods_tenant_key_uq UNIQUE (org_id, method_key, method_version)
);

CREATE INDEX IF NOT EXISTS regulatory_risk_methods_org_key_idx
  ON govai.regulatory_risk_methods (org_id, method_key);
CREATE INDEX IF NOT EXISTS regulatory_risk_methods_org_status_idx
  ON govai.regulatory_risk_methods (org_id, method_status);
CREATE INDEX IF NOT EXISTS regulatory_risk_methods_org_profile_idx
  ON govai.regulatory_risk_methods (org_id, framework_profile);
CREATE INDEX IF NOT EXISTS regulatory_risk_methods_org_created_idx
  ON govai.regulatory_risk_methods (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_risk_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_risk_methods FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- B. govai.regulatory_risk_classifications — deterministic classification records
--
-- The DB enforces in PR-R7: residual_risk_tier = inherent_risk_tier and
-- residual_risk_score = risk_score. Mitigation posture is evidence only; it
-- does NOT downgrade tier or score in PR-R7.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_risk_classifications (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                        uuid        NOT NULL,
  classification_key            text        NOT NULL,
  classification_status         text        NOT NULL CHECK (classification_status IN (
                                  'DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED', 'REJECTED')),
  risk_method_id                uuid        NOT NULL REFERENCES govai.regulatory_risk_methods(id),
  use_case_id                   uuid        NOT NULL REFERENCES govai.regulatory_use_cases(id),
  ai_system_id                  uuid        NOT NULL REFERENCES govai.regulatory_ai_systems(id),
  use_case_asset_link_id        uuid        NULL REFERENCES govai.regulatory_use_case_asset_links(id),
  model_id                      uuid        NULL REFERENCES govai.regulatory_models(id),
  model_version_id              uuid        NULL REFERENCES govai.regulatory_model_versions(id),
  agent_id                      uuid        NULL REFERENCES govai.regulatory_agents(id),
  agent_version_id              uuid        NULL REFERENCES govai.regulatory_agent_versions(id),
  classification_basis          text        NOT NULL CHECK (classification_basis IN (
                                  'RULE_EVALUATION', 'MANUAL_ATTESTATION', 'MATERIAL_CHANGE_REVIEW',
                                  'PERIODIC_REVIEW', 'IMPORTED_EVIDENCE')),
  decision_scope                text        NOT NULL CHECK (decision_scope IN (
                                  'INTERNAL_ASSISTANCE', 'DECISION_SUPPORT', 'AUTOMATED_DECISION',
                                  'EXTERNAL_EFFECT', 'PUBLIC_SECTOR_DECISION', 'JUDICIAL_SUPPORT', 'OTHER')),
  inherent_risk_tier            text        NOT NULL CHECK (inherent_risk_tier IN (
                                  'MINIMAL', 'LOW', 'MODERATE', 'HIGH', 'PROHIBITED', 'UNKNOWN')),
  residual_risk_tier            text        NOT NULL CHECK (residual_risk_tier IN (
                                  'MINIMAL', 'LOW', 'MODERATE', 'HIGH', 'PROHIBITED', 'UNKNOWN')),
  risk_score                    integer     NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  residual_risk_score           integer     NOT NULL CHECK (residual_risk_score >= 0 AND residual_risk_score <= 100),
  mitigation_strength           text        NOT NULL CHECK (mitigation_strength IN (
                                  'NONE', 'PARTIAL', 'STRONG', 'UNKNOWN')),
  requires_high_risk_review     boolean     NOT NULL DEFAULT false,
  requires_prohibited_use_review boolean    NOT NULL DEFAULT false,
  insufficient_information      boolean     NOT NULL DEFAULT false,
  rationale_summary             text        NOT NULL DEFAULT '',
  factor_summary                text        NOT NULL DEFAULT '',
  evidence_summary              text        NOT NULL DEFAULT '',
  mitigation_summary            text        NOT NULL DEFAULT '',
  residual_risk_summary         text        NOT NULL DEFAULT '',
  recommended_controls_summary  text        NOT NULL DEFAULT '',
  review_notes                  text        NOT NULL DEFAULT '',
  effective_from                timestamptz NULL,
  effective_to                  timestamptz NULL,
  supersedes_classification_id  uuid        NULL REFERENCES govai.regulatory_risk_classifications(id),
  regulatory_source_id          uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id                    uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id            uuid        NULL,
  updated_by_user_id            uuid        NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  -- Version-requires-parent invariants (DB CHECK is the backstop for bypass paths).
  CONSTRAINT regulatory_risk_classifications_model_version_requires_model
    CHECK (model_version_id IS NULL OR model_id IS NOT NULL),
  CONSTRAINT regulatory_risk_classifications_agent_version_requires_agent
    CHECK (agent_version_id IS NULL OR agent_id IS NOT NULL),
  CONSTRAINT regulatory_risk_classifications_effective_range
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  -- Residual-equals-inherent invariant. PR-R7 does NOT implement mitigation-
  -- weighted downgrading; residual mirrors inherent until a future methodology
  -- PR defines and tests bounded downgrade rules.
  CONSTRAINT regulatory_risk_classifications_residual_equals_inherent_tier
    CHECK (residual_risk_tier = inherent_risk_tier),
  CONSTRAINT regulatory_risk_classifications_residual_equals_risk_score
    CHECK (residual_risk_score = risk_score),
  -- Review-flag implications: evidence-only honesty (these flags do NOT trigger
  -- workflow/approval/enforcement — they record that review attention is required).
  CONSTRAINT regulatory_risk_classifications_prohibited_implies_prohibited_review
    CHECK (residual_risk_tier <> 'PROHIBITED' OR requires_prohibited_use_review = true),
  CONSTRAINT regulatory_risk_classifications_high_or_prohibited_implies_high_review
    CHECK (residual_risk_tier NOT IN ('HIGH', 'PROHIBITED') OR requires_high_risk_review = true),
  CONSTRAINT regulatory_risk_classifications_tenant_key_uq UNIQUE (org_id, classification_key)
);

CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_use_case_idx
  ON govai.regulatory_risk_classifications (org_id, use_case_id);
CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_ai_system_idx
  ON govai.regulatory_risk_classifications (org_id, ai_system_id);
CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_asset_link_idx
  ON govai.regulatory_risk_classifications (org_id, use_case_asset_link_id);
CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_method_idx
  ON govai.regulatory_risk_classifications (org_id, risk_method_id);
CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_model_idx
  ON govai.regulatory_risk_classifications (org_id, model_id);
CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_model_version_idx
  ON govai.regulatory_risk_classifications (org_id, model_version_id);
CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_agent_idx
  ON govai.regulatory_risk_classifications (org_id, agent_id);
CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_agent_version_idx
  ON govai.regulatory_risk_classifications (org_id, agent_version_id);
CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_status_idx
  ON govai.regulatory_risk_classifications (org_id, classification_status);
CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_inherent_tier_idx
  ON govai.regulatory_risk_classifications (org_id, inherent_risk_tier);
CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_residual_tier_idx
  ON govai.regulatory_risk_classifications (org_id, residual_risk_tier);
CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_high_review_idx
  ON govai.regulatory_risk_classifications (org_id, requires_high_risk_review);
CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_prohibited_review_idx
  ON govai.regulatory_risk_classifications (org_id, requires_prohibited_use_review);
CREATE INDEX IF NOT EXISTS regulatory_risk_classifications_org_created_idx
  ON govai.regulatory_risk_classifications (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_risk_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_risk_classifications FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- C. govai.regulatory_risk_classification_factors — factor evidence rows
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_risk_classification_factors (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL,
  classification_id    uuid        NOT NULL REFERENCES govai.regulatory_risk_classifications(id),
  factor_key           text        NOT NULL,
  factor_category      text        NOT NULL CHECK (factor_category IN (
                         'DATA_SENSITIVITY', 'SUBJECT_RIGHTS', 'AUTOMATION', 'DECISION_SCOPE',
                         'SECTOR_CONTEXT', 'JURISDICTION_CONTEXT', 'JUDICIARY_CONTEXT', 'MODEL_RISK',
                         'AGENT_AUTONOMY', 'PROVIDER_POSTURE', 'SECURITY', 'HUMAN_OVERSIGHT',
                         'MITIGATION', 'INSUFFICIENT_INFORMATION', 'PROHIBITED_SIGNAL', 'OTHER')),
  factor_severity      text        NOT NULL CHECK (factor_severity IN (
                         'MINIMAL', 'LOW', 'MODERATE', 'HIGH', 'PROHIBITED', 'UNKNOWN')),
  factor_value         text        NOT NULL DEFAULT '',
  triggered            boolean     NOT NULL DEFAULT true,
  score_contribution   integer     NOT NULL DEFAULT 0
                         CHECK (score_contribution >= 0 AND score_contribution <= 100),
  rationale            text        NOT NULL DEFAULT '',
  evidence_reference   text        NULL,
  regulatory_source_id uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id           uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id   uuid        NULL,
  updated_by_user_id   uuid        NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_risk_classification_factors_uq UNIQUE (org_id, classification_id, factor_key)
);

CREATE INDEX IF NOT EXISTS regulatory_risk_classification_factors_org_classification_idx
  ON govai.regulatory_risk_classification_factors (org_id, classification_id);
CREATE INDEX IF NOT EXISTS regulatory_risk_classification_factors_org_category_idx
  ON govai.regulatory_risk_classification_factors (org_id, factor_category);
CREATE INDEX IF NOT EXISTS regulatory_risk_classification_factors_org_severity_idx
  ON govai.regulatory_risk_classification_factors (org_id, factor_severity);
CREATE INDEX IF NOT EXISTS regulatory_risk_classification_factors_org_triggered_idx
  ON govai.regulatory_risk_classification_factors (org_id, triggered);
CREATE INDEX IF NOT EXISTS regulatory_risk_classification_factors_org_created_idx
  ON govai.regulatory_risk_classification_factors (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_risk_classification_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_risk_classification_factors FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- D. govai.regulatory_reclassification_triggers — reclassification trigger evidence
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_reclassification_triggers (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL,
  trigger_key          text        NOT NULL,
  trigger_status       text        NOT NULL CHECK (trigger_status IN (
                         'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPERSEDED', 'CANCELLED')),
  trigger_type         text        NOT NULL CHECK (trigger_type IN (
                         'MATERIAL_CHANGE', 'PERIODIC_REVIEW_DUE', 'MODEL_VERSION_CHANGE',
                         'AGENT_VERSION_CHANGE', 'DATA_SCOPE_CHANGE', 'INCIDENT_SIGNAL',
                         'REGULATORY_SOURCE_CHANGE', 'MANUAL_REVIEW', 'OTHER')),
  recommended_action   text        NOT NULL CHECK (recommended_action IN (
                         'RECLASSIFY', 'REVIEW_REQUIRED', 'NO_ACTION', 'RETIRE', 'SUSPEND', 'OTHER')),
  classification_id    uuid        NULL REFERENCES govai.regulatory_risk_classifications(id),
  use_case_id          uuid        NOT NULL REFERENCES govai.regulatory_use_cases(id),
  ai_system_id         uuid        NOT NULL REFERENCES govai.regulatory_ai_systems(id),
  prior_risk_tier      text        NULL CHECK (prior_risk_tier IS NULL OR prior_risk_tier IN (
                         'MINIMAL', 'LOW', 'MODERATE', 'HIGH', 'PROHIBITED', 'UNKNOWN')),
  trigger_reason       text        NOT NULL DEFAULT '',
  evidence_reference   text        NULL,
  detected_at          timestamptz NULL,
  due_at               timestamptz NULL,
  resolved_at          timestamptz NULL,
  regulatory_source_id uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id           uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id   uuid        NULL,
  updated_by_user_id   uuid        NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_reclassification_triggers_tenant_key_uq UNIQUE (org_id, trigger_key),
  CONSTRAINT regulatory_reclassification_triggers_resolved_after_detected
    CHECK (resolved_at IS NULL OR detected_at IS NULL OR resolved_at >= detected_at)
);

CREATE INDEX IF NOT EXISTS regulatory_reclassification_triggers_org_classification_idx
  ON govai.regulatory_reclassification_triggers (org_id, classification_id);
CREATE INDEX IF NOT EXISTS regulatory_reclassification_triggers_org_use_case_idx
  ON govai.regulatory_reclassification_triggers (org_id, use_case_id);
CREATE INDEX IF NOT EXISTS regulatory_reclassification_triggers_org_ai_system_idx
  ON govai.regulatory_reclassification_triggers (org_id, ai_system_id);
CREATE INDEX IF NOT EXISTS regulatory_reclassification_triggers_org_status_idx
  ON govai.regulatory_reclassification_triggers (org_id, trigger_status);
CREATE INDEX IF NOT EXISTS regulatory_reclassification_triggers_org_type_idx
  ON govai.regulatory_reclassification_triggers (org_id, trigger_type);
CREATE INDEX IF NOT EXISTS regulatory_reclassification_triggers_org_action_idx
  ON govai.regulatory_reclassification_triggers (org_id, recommended_action);
CREATE INDEX IF NOT EXISTS regulatory_reclassification_triggers_org_due_idx
  ON govai.regulatory_reclassification_triggers (org_id, due_at);
CREATE INDEX IF NOT EXISTS regulatory_reclassification_triggers_org_created_idx
  ON govai.regulatory_reclassification_triggers (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_reclassification_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_reclassification_triggers FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- RLS policies — per command × role. FK checks bypass RLS, so cross-table
-- references are visibility-checked with explicit EXISTS guards in WITH CHECK.
-- New-row columns inside EXISTS are table-qualified.
-- ===========================================================================

-- regulatory_risk_methods ---------------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_risk_methods_select_app ON govai.regulatory_risk_methods
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_risk_methods_insert_app ON govai.regulatory_risk_methods
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_risk_methods.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_risk_methods.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_risk_methods_update_app ON govai.regulatory_risk_methods
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_risk_methods.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_risk_methods.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_risk_methods_select_writer ON govai.regulatory_risk_methods
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_risk_classifications -------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_risk_classifications_select_app ON govai.regulatory_risk_classifications
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Method/use-case/AI-system parents must be own-tenant. The asset-link EXISTS
-- additionally enforces it belongs to the same use_case_id and ai_system_id.
-- model_version / agent_version EXISTS also enforce belongs-to-parent (their
-- parent-id columns are qualified against the new classification row to avoid
-- inner-scope tautologies). source/control may be system.
DO $$ BEGIN
  CREATE POLICY regulatory_risk_classifications_insert_app ON govai.regulatory_risk_classifications
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_risk_methods rm
        WHERE rm.id = regulatory_risk_classifications.risk_method_id
          AND rm.org_id::text = current_setting('app.org_id', true))
      AND EXISTS (SELECT 1 FROM govai.regulatory_use_cases u
        WHERE u.id = regulatory_risk_classifications.use_case_id
          AND u.org_id::text = current_setting('app.org_id', true))
      AND EXISTS (SELECT 1 FROM govai.regulatory_ai_systems a
        WHERE a.id = regulatory_risk_classifications.ai_system_id
          AND a.org_id::text = current_setting('app.org_id', true))
      AND (
        use_case_asset_link_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_use_case_asset_links al
          WHERE al.id = regulatory_risk_classifications.use_case_asset_link_id
            AND al.org_id::text = current_setting('app.org_id', true)
            AND al.use_case_id = regulatory_risk_classifications.use_case_id
            AND al.ai_system_id = regulatory_risk_classifications.ai_system_id)
      )
      AND (
        model_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_models m
          WHERE m.id = regulatory_risk_classifications.model_id
            AND m.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        model_version_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_model_versions mv
          WHERE mv.id = regulatory_risk_classifications.model_version_id
            AND mv.org_id::text = current_setting('app.org_id', true)
            AND mv.model_id = regulatory_risk_classifications.model_id)
      )
      AND (
        agent_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_agents ag
          WHERE ag.id = regulatory_risk_classifications.agent_id
            AND ag.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        agent_version_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_agent_versions av
          WHERE av.id = regulatory_risk_classifications.agent_version_id
            AND av.org_id::text = current_setting('app.org_id', true)
            AND av.agent_id = regulatory_risk_classifications.agent_id)
      )
      AND (
        supersedes_classification_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_risk_classifications prior
          WHERE prior.id = regulatory_risk_classifications.supersedes_classification_id
            AND prior.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_risk_classifications.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_risk_classifications.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_risk_classifications_update_app ON govai.regulatory_risk_classifications
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_risk_methods rm
        WHERE rm.id = regulatory_risk_classifications.risk_method_id
          AND rm.org_id::text = current_setting('app.org_id', true))
      AND EXISTS (SELECT 1 FROM govai.regulatory_use_cases u
        WHERE u.id = regulatory_risk_classifications.use_case_id
          AND u.org_id::text = current_setting('app.org_id', true))
      AND EXISTS (SELECT 1 FROM govai.regulatory_ai_systems a
        WHERE a.id = regulatory_risk_classifications.ai_system_id
          AND a.org_id::text = current_setting('app.org_id', true))
      AND (
        use_case_asset_link_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_use_case_asset_links al
          WHERE al.id = regulatory_risk_classifications.use_case_asset_link_id
            AND al.org_id::text = current_setting('app.org_id', true)
            AND al.use_case_id = regulatory_risk_classifications.use_case_id
            AND al.ai_system_id = regulatory_risk_classifications.ai_system_id)
      )
      AND (
        model_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_models m
          WHERE m.id = regulatory_risk_classifications.model_id
            AND m.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        model_version_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_model_versions mv
          WHERE mv.id = regulatory_risk_classifications.model_version_id
            AND mv.org_id::text = current_setting('app.org_id', true)
            AND mv.model_id = regulatory_risk_classifications.model_id)
      )
      AND (
        agent_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_agents ag
          WHERE ag.id = regulatory_risk_classifications.agent_id
            AND ag.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        agent_version_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_agent_versions av
          WHERE av.id = regulatory_risk_classifications.agent_version_id
            AND av.org_id::text = current_setting('app.org_id', true)
            AND av.agent_id = regulatory_risk_classifications.agent_id)
      )
      AND (
        supersedes_classification_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_risk_classifications prior
          WHERE prior.id = regulatory_risk_classifications.supersedes_classification_id
            AND prior.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_risk_classifications.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_risk_classifications.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_risk_classifications_select_writer ON govai.regulatory_risk_classifications
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_risk_classification_factors ------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_risk_classification_factors_select_app ON govai.regulatory_risk_classification_factors
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- INSERT only (no UPDATE grant). The parent classification must be own-tenant.
DO $$ BEGIN
  CREATE POLICY regulatory_risk_classification_factors_insert_app ON govai.regulatory_risk_classification_factors
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_risk_classifications c
        WHERE c.id = regulatory_risk_classification_factors.classification_id
          AND c.org_id::text = current_setting('app.org_id', true))
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_risk_classification_factors.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_risk_classification_factors.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_risk_classification_factors_select_writer ON govai.regulatory_risk_classification_factors
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_reclassification_triggers --------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_reclassification_triggers_select_app ON govai.regulatory_reclassification_triggers
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- use_case/ai_system must be own-tenant. classification (when present) must be
-- own-tenant AND match use_case_id and ai_system_id (table-qualified outer refs).
DO $$ BEGIN
  CREATE POLICY regulatory_reclassification_triggers_insert_app ON govai.regulatory_reclassification_triggers
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_use_cases u
        WHERE u.id = regulatory_reclassification_triggers.use_case_id
          AND u.org_id::text = current_setting('app.org_id', true))
      AND EXISTS (SELECT 1 FROM govai.regulatory_ai_systems a
        WHERE a.id = regulatory_reclassification_triggers.ai_system_id
          AND a.org_id::text = current_setting('app.org_id', true))
      AND (
        classification_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_risk_classifications c
          WHERE c.id = regulatory_reclassification_triggers.classification_id
            AND c.org_id::text = current_setting('app.org_id', true)
            AND c.use_case_id = regulatory_reclassification_triggers.use_case_id
            AND c.ai_system_id = regulatory_reclassification_triggers.ai_system_id)
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_reclassification_triggers.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_reclassification_triggers.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_reclassification_triggers_update_app ON govai.regulatory_reclassification_triggers
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_use_cases u
        WHERE u.id = regulatory_reclassification_triggers.use_case_id
          AND u.org_id::text = current_setting('app.org_id', true))
      AND EXISTS (SELECT 1 FROM govai.regulatory_ai_systems a
        WHERE a.id = regulatory_reclassification_triggers.ai_system_id
          AND a.org_id::text = current_setting('app.org_id', true))
      AND (
        classification_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_risk_classifications c
          WHERE c.id = regulatory_reclassification_triggers.classification_id
            AND c.org_id::text = current_setting('app.org_id', true)
            AND c.use_case_id = regulatory_reclassification_triggers.use_case_id
            AND c.ai_system_id = regulatory_reclassification_triggers.ai_system_id)
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_reclassification_triggers.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_reclassification_triggers.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_reclassification_triggers_select_writer ON govai.regulatory_reclassification_triggers
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Grants — SELECT/INSERT/UPDATE for the app role (no DELETE, no UPDATE on factors).
-- ===========================================================================

GRANT SELECT, INSERT, UPDATE ON govai.regulatory_risk_methods                   TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.regulatory_risk_classifications           TO govai_app;
-- Factors are written only as part of classification creation and are read-only
-- via API. No UPDATE grant is intentional (RLS would also block any update).
GRANT SELECT, INSERT         ON govai.regulatory_risk_classification_factors    TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.regulatory_reclassification_triggers      TO govai_app;

RESET ROLE;
