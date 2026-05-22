-- Migration 0021 — Regulatory Core PR-R6: Use-case Registry (issue #59, umbrella #33).
--
-- Production-focused use-case registry: the next P0 Native Regulatory Core
-- foundation after the source registry / control catalog (PR-R1 / 0016), the
-- AI System Registry (PR-R2 / 0017), the Provider Registry (PR-R3 / 0018), the
-- Model Registry (PR-R4 / 0019), and the Agent Registry (PR-R5 / 0020).
--
--   - govai.regulatory_use_cases            — tenant use-case identity + governance.
--   - govai.regulatory_use_case_asset_links — use-case ↔ AI-system/model/agent bindings.
--   - govai.regulatory_use_case_reviews      — periodic review evidence.
--
-- GOVERNANCE EVIDENCE ONLY. This registry records intended purpose, ownership,
-- jurisdiction, legal/regulatory-basis summaries, asset linkage, and review
-- cadence. It does NOT implement risk classification, high-risk approval
-- workflow, prohibited-use hard-deny workflow, legal-basis automation, runtime
-- enforcement, or a workflow engine — those remain future work. No prompts,
-- credentials, secrets, legal opinions, medical records, or raw sensitive data
-- are stored. Mutations route real audit events onto the existing `policy`
-- ChainCategory.
--
-- Scope model: all three tables are tenant-owned only (org_id NOT NULL); there
-- is no system scope. FK checks bypass RLS, so every cross-table reference is
-- visibility-checked with an explicit EXISTS in the INSERT/UPDATE WITH CHECK
-- policies, and new-row columns inside those EXISTS subqueries are table-
-- qualified to avoid resolving to a same-named column on the referenced table
-- (the PR-R4/R5 ambiguity lesson). Asset-link uniqueness uses partial unique
-- indexes because the nullable version columns make a plain UNIQUE constraint
-- treat NULLs as distinct.
--
-- Conventions follow 0001 / 0012-0020: gen_random_uuid() PK defaults (pgcrypto),
-- text columns with CHECK-pinned enums, RLS ENABLE + FORCE, idempotent
-- per-command/per-role policies, org_id columns without an FK to govai.orgs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. govai.regulatory_use_cases — tenant use-case identity + governance
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_use_cases (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid        NOT NULL,
  use_case_key             text        NOT NULL,
  name                     text        NOT NULL,
  description              text        NOT NULL DEFAULT '',
  use_case_status          text        NOT NULL CHECK (use_case_status IN (
                             'PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'APPROVED_WITH_CONDITIONS',
                             'ACTIVE', 'SUSPENDED', 'RETIRED', 'REJECTED')),
  use_case_category        text        NOT NULL CHECK (use_case_category IN (
                             'INTERNAL_PRODUCTIVITY', 'CUSTOMER_SUPPORT', 'LEGAL_SUPPORT', 'JUDICIAL_SUPPORT',
                             'COMPLIANCE_MONITORING', 'SECURITY_MONITORING', 'HR_EMPLOYMENT',
                             'FINANCIAL_SERVICES', 'HEALTHCARE_SUPPORT', 'PUBLIC_SECTOR_SERVICE',
                             'RESEARCH_AND_ANALYTICS', 'SOFTWARE_ENGINEERING', 'DOCUMENT_PROCESSING',
                             'DECISION_SUPPORT', 'OTHER')),
  business_criticality     text        NOT NULL CHECK (business_criticality IN (
                             'LOW', 'MEDIUM', 'HIGH', 'MISSION_CRITICAL')),
  deployment_scope         text        NOT NULL CHECK (deployment_scope IN (
                             'INTERNAL_ONLY', 'CUSTOMER_FACING', 'PUBLIC_FACING', 'JUDICIARY_INTERNAL',
                             'REGULATED_WORKFLOW', 'THIRD_PARTY_MANAGED', 'NOT_DEPLOYED', 'OTHER')),
  primary_jurisdiction     text        NOT NULL DEFAULT 'BR',
  business_owner           text        NULL,
  technical_owner          text        NULL,
  legal_owner              text        NULL,
  dpo_owner                text        NULL,
  accountable_executive    text        NULL,
  intended_purpose         text        NOT NULL DEFAULT '',
  expected_benefits        text        NOT NULL DEFAULT '',
  prohibited_uses          text        NOT NULL DEFAULT '',
  restricted_uses          text        NOT NULL DEFAULT '',
  target_users             text        NOT NULL DEFAULT '',
  affected_subjects        text        NOT NULL DEFAULT '',
  data_categories_summary  text        NOT NULL DEFAULT '',
  sensitive_data_summary   text        NOT NULL DEFAULT '',
  legal_basis_summary      text        NOT NULL DEFAULT '',
  regulatory_basis_summary text        NOT NULL DEFAULT '',
  human_oversight_summary  text        NOT NULL DEFAULT '',
  review_frequency         text        NOT NULL DEFAULT 'AD_HOC' CHECK (review_frequency IN (
                             'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL',
                             'AD_HOC', 'EMERGENCY')),
  last_reviewed_at         timestamptz NULL,
  next_review_at           timestamptz NULL,
  primary_ai_system_id     uuid        NULL REFERENCES govai.regulatory_ai_systems(id),
  regulatory_source_id     uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id               uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id       uuid        NULL,
  updated_by_user_id       uuid        NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_use_cases_tenant_key_uq UNIQUE (org_id, use_case_key)
);

CREATE INDEX IF NOT EXISTS regulatory_use_cases_org_created_idx
  ON govai.regulatory_use_cases (org_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS regulatory_use_cases_org_status_idx
  ON govai.regulatory_use_cases (org_id, use_case_status);
CREATE INDEX IF NOT EXISTS regulatory_use_cases_org_category_idx
  ON govai.regulatory_use_cases (org_id, use_case_category);
CREATE INDEX IF NOT EXISTS regulatory_use_cases_org_criticality_idx
  ON govai.regulatory_use_cases (org_id, business_criticality);
CREATE INDEX IF NOT EXISTS regulatory_use_cases_org_scope_idx
  ON govai.regulatory_use_cases (org_id, deployment_scope);
CREATE INDEX IF NOT EXISTS regulatory_use_cases_org_jurisdiction_idx
  ON govai.regulatory_use_cases (org_id, primary_jurisdiction);
CREATE INDEX IF NOT EXISTS regulatory_use_cases_org_ai_system_idx
  ON govai.regulatory_use_cases (org_id, primary_ai_system_id);
CREATE INDEX IF NOT EXISTS regulatory_use_cases_org_next_review_idx
  ON govai.regulatory_use_cases (org_id, next_review_at);

ALTER TABLE govai.regulatory_use_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_use_cases FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- B. govai.regulatory_use_case_asset_links — use-case ↔ asset bindings
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_use_case_asset_links (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid        NOT NULL,
  use_case_id            uuid        NOT NULL REFERENCES govai.regulatory_use_cases(id),
  ai_system_id           uuid        NOT NULL REFERENCES govai.regulatory_ai_systems(id),
  model_id               uuid        NULL REFERENCES govai.regulatory_models(id),
  model_version_id       uuid        NULL REFERENCES govai.regulatory_model_versions(id),
  agent_id               uuid        NULL REFERENCES govai.regulatory_agents(id),
  agent_version_id       uuid        NULL REFERENCES govai.regulatory_agent_versions(id),
  link_status            text        NOT NULL CHECK (link_status IN (
                           'PROPOSED', 'ACTIVE', 'SUSPENDED', 'RETIRED', 'REJECTED')),
  usage_role             text        NOT NULL CHECK (usage_role IN (
                           'PRIMARY_SYSTEM', 'SUPPORTING_SYSTEM', 'PRIMARY_MODEL', 'FALLBACK_MODEL',
                           'PRIMARY_AGENT', 'SUPPORTING_AGENT', 'EMBEDDING', 'RERANKING',
                           'CLASSIFICATION', 'SAFETY', 'EVALUATION', 'MONITORING', 'OTHER')),
  deployment_environment text        NOT NULL CHECK (deployment_environment IN (
                           'DEVELOPMENT', 'STAGING', 'PRODUCTION', 'CUSTOMER_MANAGED',
                           'THIRD_PARTY_MANAGED', 'NOT_DEPLOYED', 'OTHER')),
  effective_from         timestamptz NULL,
  effective_to           timestamptz NULL,
  rationale              text        NOT NULL DEFAULT '',
  evidence_reference     text        NULL,
  regulatory_source_id   uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id             uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id     uuid        NULL,
  updated_by_user_id     uuid        NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- A version is meaningless without its parent; the DB rejects this even if the
  -- service is bypassed. (Belongs-to-parent is enforced in the RLS WITH CHECK.)
  CONSTRAINT regulatory_use_case_asset_links_model_version_requires_model
    CHECK (model_version_id IS NULL OR model_id IS NOT NULL),
  CONSTRAINT regulatory_use_case_asset_links_agent_version_requires_agent
    CHECK (agent_version_id IS NULL OR agent_id IS NOT NULL),
  CONSTRAINT regulatory_use_case_asset_links_effective_range
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

-- Uniqueness via partial indexes (NULLs are distinct in a plain UNIQUE), one per
-- combination of present version columns.
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_use_case_asset_links_mv_av_uq
  ON govai.regulatory_use_case_asset_links
     (org_id, use_case_id, ai_system_id, model_version_id, agent_version_id, usage_role, deployment_environment)
  WHERE model_version_id IS NOT NULL AND agent_version_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_use_case_asset_links_mv_only_uq
  ON govai.regulatory_use_case_asset_links
     (org_id, use_case_id, ai_system_id, model_version_id, usage_role, deployment_environment)
  WHERE model_version_id IS NOT NULL AND agent_version_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_use_case_asset_links_av_only_uq
  ON govai.regulatory_use_case_asset_links
     (org_id, use_case_id, ai_system_id, agent_version_id, usage_role, deployment_environment)
  WHERE model_version_id IS NULL AND agent_version_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_use_case_asset_links_none_uq
  ON govai.regulatory_use_case_asset_links
     (org_id, use_case_id, ai_system_id, usage_role, deployment_environment)
  WHERE model_version_id IS NULL AND agent_version_id IS NULL;

CREATE INDEX IF NOT EXISTS regulatory_use_case_asset_links_org_use_case_idx
  ON govai.regulatory_use_case_asset_links (org_id, use_case_id);
CREATE INDEX IF NOT EXISTS regulatory_use_case_asset_links_org_ai_system_idx
  ON govai.regulatory_use_case_asset_links (org_id, ai_system_id);
CREATE INDEX IF NOT EXISTS regulatory_use_case_asset_links_org_model_idx
  ON govai.regulatory_use_case_asset_links (org_id, model_id);
CREATE INDEX IF NOT EXISTS regulatory_use_case_asset_links_org_model_version_idx
  ON govai.regulatory_use_case_asset_links (org_id, model_version_id);
CREATE INDEX IF NOT EXISTS regulatory_use_case_asset_links_org_agent_idx
  ON govai.regulatory_use_case_asset_links (org_id, agent_id);
CREATE INDEX IF NOT EXISTS regulatory_use_case_asset_links_org_agent_version_idx
  ON govai.regulatory_use_case_asset_links (org_id, agent_version_id);
CREATE INDEX IF NOT EXISTS regulatory_use_case_asset_links_org_status_idx
  ON govai.regulatory_use_case_asset_links (org_id, link_status);
CREATE INDEX IF NOT EXISTS regulatory_use_case_asset_links_org_role_idx
  ON govai.regulatory_use_case_asset_links (org_id, usage_role);
CREATE INDEX IF NOT EXISTS regulatory_use_case_asset_links_org_environment_idx
  ON govai.regulatory_use_case_asset_links (org_id, deployment_environment);
CREATE INDEX IF NOT EXISTS regulatory_use_case_asset_links_org_created_idx
  ON govai.regulatory_use_case_asset_links (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_use_case_asset_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_use_case_asset_links FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- C. govai.regulatory_use_case_reviews — periodic review evidence
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_use_case_reviews (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL,
  use_case_id          uuid        NOT NULL REFERENCES govai.regulatory_use_cases(id),
  review_key           text        NOT NULL,
  review_type          text        NOT NULL CHECK (review_type IN (
                         'INITIAL_REVIEW', 'PERIODIC_REVIEW', 'MATERIAL_CHANGE_REVIEW',
                         'INCIDENT_TRIGGERED_REVIEW', 'EMERGENCY_REVIEW', 'RETIREMENT_REVIEW', 'OTHER')),
  review_status        text        NOT NULL CHECK (review_status IN (
                         'DRAFT', 'IN_REVIEW', 'COMPLETED', 'SUPERSEDED', 'CANCELLED')),
  review_outcome       text        NOT NULL CHECK (review_outcome IN (
                         'APPROVED', 'APPROVED_WITH_CONDITIONS', 'CHANGES_REQUIRED', 'SUSPENDED',
                         'RETIRED', 'NO_DECISION', 'REJECTED')),
  reviewer_user_id     uuid        NULL,
  reviewer_name        text        NULL,
  reviewed_at          timestamptz NULL,
  next_review_at       timestamptz NULL,
  findings_summary     text        NOT NULL DEFAULT '',
  decision_summary     text        NOT NULL DEFAULT '',
  conditions_summary   text        NOT NULL DEFAULT '',
  evidence_reference   text        NULL,
  evidence_hash        text        NULL,
  regulatory_source_id uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id           uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id   uuid        NULL,
  updated_by_user_id   uuid        NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_use_case_reviews_tenant_key_uq UNIQUE (org_id, use_case_id, review_key)
);

CREATE INDEX IF NOT EXISTS regulatory_use_case_reviews_org_use_case_created_idx
  ON govai.regulatory_use_case_reviews (org_id, use_case_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS regulatory_use_case_reviews_org_type_idx
  ON govai.regulatory_use_case_reviews (org_id, review_type);
CREATE INDEX IF NOT EXISTS regulatory_use_case_reviews_org_status_idx
  ON govai.regulatory_use_case_reviews (org_id, review_status);
CREATE INDEX IF NOT EXISTS regulatory_use_case_reviews_org_outcome_idx
  ON govai.regulatory_use_case_reviews (org_id, review_outcome);
CREATE INDEX IF NOT EXISTS regulatory_use_case_reviews_org_reviewed_idx
  ON govai.regulatory_use_case_reviews (org_id, reviewed_at);
CREATE INDEX IF NOT EXISTS regulatory_use_case_reviews_org_next_review_idx
  ON govai.regulatory_use_case_reviews (org_id, next_review_at);

ALTER TABLE govai.regulatory_use_case_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_use_case_reviews FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- RLS policies — per command × role. FK checks bypass RLS, so cross-table
-- references are visibility-checked with explicit EXISTS guards in WITH CHECK.
-- New-row columns inside EXISTS are table-qualified to avoid resolving to a
-- same-named column on the referenced table.
-- ===========================================================================

-- regulatory_use_cases ------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_use_cases_select_app ON govai.regulatory_use_cases
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_use_cases_insert_app ON govai.regulatory_use_cases
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND (
        primary_ai_system_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_ai_systems a
          WHERE a.id = regulatory_use_cases.primary_ai_system_id
            AND a.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_use_cases.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_use_cases.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_use_cases_update_app ON govai.regulatory_use_cases
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND (
        primary_ai_system_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_ai_systems a
          WHERE a.id = regulatory_use_cases.primary_ai_system_id
            AND a.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_use_cases.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_use_cases.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_use_cases_select_writer ON govai.regulatory_use_cases
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_use_case_asset_links -------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_use_case_asset_links_select_app ON govai.regulatory_use_case_asset_links
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- All references must be own-tenant; model_version / agent_version EXISTS also
-- enforce belongs-to-parent (their parent-id columns are qualified against the
-- new link row to avoid an inner-scope tautology). source/control may be system.
DO $$ BEGIN
  CREATE POLICY regulatory_use_case_asset_links_insert_app ON govai.regulatory_use_case_asset_links
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_use_cases u
        WHERE u.id = regulatory_use_case_asset_links.use_case_id
          AND u.org_id::text = current_setting('app.org_id', true))
      AND EXISTS (SELECT 1 FROM govai.regulatory_ai_systems a
        WHERE a.id = regulatory_use_case_asset_links.ai_system_id
          AND a.org_id::text = current_setting('app.org_id', true))
      AND (
        model_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_models m
          WHERE m.id = regulatory_use_case_asset_links.model_id
            AND m.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        model_version_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_model_versions mv
          WHERE mv.id = regulatory_use_case_asset_links.model_version_id
            AND mv.org_id::text = current_setting('app.org_id', true)
            AND mv.model_id = regulatory_use_case_asset_links.model_id)
      )
      AND (
        agent_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_agents ag
          WHERE ag.id = regulatory_use_case_asset_links.agent_id
            AND ag.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        agent_version_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_agent_versions av
          WHERE av.id = regulatory_use_case_asset_links.agent_version_id
            AND av.org_id::text = current_setting('app.org_id', true)
            AND av.agent_id = regulatory_use_case_asset_links.agent_id)
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_use_case_asset_links.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_use_case_asset_links.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_use_case_asset_links_update_app ON govai.regulatory_use_case_asset_links
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_use_cases u
        WHERE u.id = regulatory_use_case_asset_links.use_case_id
          AND u.org_id::text = current_setting('app.org_id', true))
      AND EXISTS (SELECT 1 FROM govai.regulatory_ai_systems a
        WHERE a.id = regulatory_use_case_asset_links.ai_system_id
          AND a.org_id::text = current_setting('app.org_id', true))
      AND (
        model_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_models m
          WHERE m.id = regulatory_use_case_asset_links.model_id
            AND m.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        model_version_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_model_versions mv
          WHERE mv.id = regulatory_use_case_asset_links.model_version_id
            AND mv.org_id::text = current_setting('app.org_id', true)
            AND mv.model_id = regulatory_use_case_asset_links.model_id)
      )
      AND (
        agent_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_agents ag
          WHERE ag.id = regulatory_use_case_asset_links.agent_id
            AND ag.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        agent_version_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_agent_versions av
          WHERE av.id = regulatory_use_case_asset_links.agent_version_id
            AND av.org_id::text = current_setting('app.org_id', true)
            AND av.agent_id = regulatory_use_case_asset_links.agent_id)
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_use_case_asset_links.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_use_case_asset_links.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_use_case_asset_links_select_writer ON govai.regulatory_use_case_asset_links
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_use_case_reviews -----------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_use_case_reviews_select_app ON govai.regulatory_use_case_reviews
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_use_case_reviews_insert_app ON govai.regulatory_use_case_reviews
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_use_cases u
        WHERE u.id = regulatory_use_case_reviews.use_case_id
          AND u.org_id::text = current_setting('app.org_id', true))
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_use_case_reviews.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_use_case_reviews.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_use_case_reviews_update_app ON govai.regulatory_use_case_reviews
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_use_cases u
        WHERE u.id = regulatory_use_case_reviews.use_case_id
          AND u.org_id::text = current_setting('app.org_id', true))
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_use_case_reviews.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_use_case_reviews.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_use_case_reviews_select_writer ON govai.regulatory_use_case_reviews
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Grants — SELECT/INSERT/UPDATE for the app role (no DELETE endpoint).
-- ===========================================================================

GRANT SELECT, INSERT, UPDATE ON govai.regulatory_use_cases            TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.regulatory_use_case_asset_links TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.regulatory_use_case_reviews     TO govai_app;

RESET ROLE;
