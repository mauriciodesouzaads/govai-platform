-- Migration 0020 — Regulatory Core PR-R5: Agent Registry (issue #59, umbrella #33).
--
-- Production-focused agent registry: the next P0 Native Regulatory Core
-- foundation after the source registry / control catalog (PR-R1 / 0016), the
-- AI System Registry (PR-R2 / 0017), the Provider Registry (PR-R3 / 0018), and
-- the Model Registry (PR-R4 / 0019).
--
--   - govai.regulatory_agents                    — tenant agent identity records.
--   - govai.regulatory_agent_versions            — per-agent version/config provenance.
--   - govai.regulatory_agent_capability_bindings — declared capability + governance evidence.
--
-- REGISTRY EVIDENCE / PROVENANCE ONLY. NO prompts, tool-manifest bodies,
-- credentials, API keys, secrets, tokens, certificates, or live runtime
-- configuration are stored here — *_hash columns are provenance metadata only.
-- NO use-case registry, risk engine, runtime agent enforcement, live tool
-- invocation, connector, UI, or report ships here — those remain future work.
-- Mutations route real audit events onto the existing `policy` ChainCategory.
--
-- Scope model: all three tables are tenant-owned only (org_id NOT NULL); there
-- is no system scope. FK checks bypass RLS, so every cross-table reference is
-- visibility-checked with an explicit EXISTS in the INSERT/UPDATE WITH CHECK
-- policies (mirrors the PR #64/#65/#66/#67 review hardening). New-row columns
-- inside those EXISTS subqueries are table-qualified to avoid resolving to a
-- same-named column on the referenced table (the PR-R4 ambiguity lesson).
--
-- Conventions follow 0001 / 0012-0019: gen_random_uuid() PK defaults (pgcrypto),
-- text columns with CHECK-pinned enums, RLS ENABLE + FORCE, idempotent
-- per-command/per-role policies, org_id columns without an FK to govai.orgs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. govai.regulatory_agents — tenant agent identity
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_agents (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid        NOT NULL,
  agent_key                text        NOT NULL,
  name                     text        NOT NULL,
  description              text        NOT NULL DEFAULT '',
  agent_type               text        NOT NULL CHECK (agent_type IN (
                             'LLM_AGENT', 'WORKFLOW_AGENT', 'TOOL_USING_AGENT', 'RETRIEVAL_AGENT',
                             'ORCHESTRATOR_AGENT', 'MONITORING_AGENT', 'EVALUATION_AGENT',
                             'HUMAN_ASSISTED_AGENT', 'OTHER')),
  agent_status             text        NOT NULL CHECK (agent_status IN (
                             'PROPOSED', 'UNDER_EVALUATION', 'APPROVED', 'APPROVED_WITH_CONDITIONS',
                             'ACTIVE', 'SUSPENDED', 'RETIRED', 'REJECTED')),
  autonomy_level           text        NOT NULL CHECK (autonomy_level IN (
                             'HUMAN_ASSISTED', 'HUMAN_APPROVAL_REQUIRED', 'SUPERVISED_AUTONOMOUS',
                             'AUTONOMOUS_WITH_GUARDRAILS', 'AUDIT_ONLY')),
  execution_boundary       text        NOT NULL CHECK (execution_boundary IN (
                             'GOVAI_WORKROOM', 'PROVIDER_NATIVE', 'CUSTOMER_ENVIRONMENT',
                             'THIRD_PARTY_RUNTIME', 'SANDBOXED_TOOL_RUNTIME', 'NOT_DEPLOYED', 'OTHER')),
  human_oversight_mode     text        NOT NULL CHECK (human_oversight_mode IN (
                             'HUMAN_IN_LOOP', 'HUMAN_ON_LOOP', 'HUMAN_REVIEW_REQUIRED',
                             'ESCALATION_ONLY', 'NOT_APPLICABLE')),
  provider_id              uuid        NULL REFERENCES govai.regulatory_providers(id),
  primary_ai_system_id     uuid        NULL REFERENCES govai.regulatory_ai_systems(id),
  primary_model_id         uuid        NULL REFERENCES govai.regulatory_models(id),
  primary_model_version_id uuid        NULL REFERENCES govai.regulatory_model_versions(id),
  primary_jurisdiction     text        NOT NULL DEFAULT 'BR',
  business_owner           text        NULL,
  technical_owner          text        NULL,
  legal_owner              text        NULL,
  dpo_owner                text        NULL,
  intended_purpose         text        NOT NULL DEFAULT '',
  prohibited_uses          text        NOT NULL DEFAULT '',
  capability_summary       text        NOT NULL DEFAULT '',
  tool_access_summary      text        NOT NULL DEFAULT '',
  data_access_summary      text        NOT NULL DEFAULT '',
  human_oversight_summary  text        NOT NULL DEFAULT '',
  last_reviewed_at         timestamptz NULL,
  next_review_at           timestamptz NULL,
  review_frequency         text        NOT NULL DEFAULT 'AD_HOC' CHECK (review_frequency IN (
                             'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'AD_HOC', 'EMERGENCY')),
  regulatory_source_id     uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id               uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id       uuid        NULL,
  updated_by_user_id       uuid        NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_agents_tenant_key_uq UNIQUE (org_id, agent_key),
  -- A primary model version is meaningless without its model. The DB rejects
  -- version-without-model even if the service layer is bypassed. (Version
  -- belongs-to-model is additionally enforced in the RLS WITH CHECK below.)
  CONSTRAINT regulatory_agents_version_requires_model
    CHECK (primary_model_version_id IS NULL OR primary_model_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS regulatory_agents_org_created_idx
  ON govai.regulatory_agents (org_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS regulatory_agents_org_status_idx
  ON govai.regulatory_agents (org_id, agent_status);
CREATE INDEX IF NOT EXISTS regulatory_agents_org_type_idx
  ON govai.regulatory_agents (org_id, agent_type);
CREATE INDEX IF NOT EXISTS regulatory_agents_org_autonomy_idx
  ON govai.regulatory_agents (org_id, autonomy_level);
CREATE INDEX IF NOT EXISTS regulatory_agents_org_boundary_idx
  ON govai.regulatory_agents (org_id, execution_boundary);
CREATE INDEX IF NOT EXISTS regulatory_agents_org_ai_system_idx
  ON govai.regulatory_agents (org_id, primary_ai_system_id);
CREATE INDEX IF NOT EXISTS regulatory_agents_org_model_idx
  ON govai.regulatory_agents (org_id, primary_model_id);
CREATE INDEX IF NOT EXISTS regulatory_agents_org_provider_idx
  ON govai.regulatory_agents (org_id, provider_id);
CREATE INDEX IF NOT EXISTS regulatory_agents_org_next_review_idx
  ON govai.regulatory_agents (org_id, next_review_at);

ALTER TABLE govai.regulatory_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_agents FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- B. govai.regulatory_agent_versions — per-agent version/config provenance
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_agent_versions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid        NOT NULL,
  agent_id                 uuid        NOT NULL REFERENCES govai.regulatory_agents(id),
  version_key              text        NOT NULL,
  version_label            text        NOT NULL,
  version_status           text        NOT NULL CHECK (version_status IN (
                             'DRAFT', 'UNDER_EVALUATION', 'APPROVED', 'ACTIVE', 'DEPRECATED',
                             'RETIRED', 'REJECTED')),
  -- Provenance metadata only — never the prompts, manifests, or policies themselves.
  configuration_hash       text        NULL,
  prompt_policy_hash       text        NULL,
  tool_manifest_hash       text        NULL,
  sandbox_policy_hash      text        NULL,
  capability_manifest_hash text        NULL,
  evaluation_score_summary text        NOT NULL DEFAULT '',
  release_notes            text        NOT NULL DEFAULT '',
  approval_reference       text        NULL,
  approved_at              timestamptz NULL,
  approved_by_user_id      uuid        NULL,
  retired_at               timestamptz NULL,
  metadata                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id       uuid        NULL,
  updated_by_user_id       uuid        NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_agent_versions_tenant_key_uq UNIQUE (org_id, agent_id, version_key)
);

CREATE INDEX IF NOT EXISTS regulatory_agent_versions_org_agent_created_idx
  ON govai.regulatory_agent_versions (org_id, agent_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS regulatory_agent_versions_org_status_idx
  ON govai.regulatory_agent_versions (org_id, version_status);
CREATE INDEX IF NOT EXISTS regulatory_agent_versions_org_approved_idx
  ON govai.regulatory_agent_versions (org_id, approved_at);
CREATE INDEX IF NOT EXISTS regulatory_agent_versions_org_config_hash_idx
  ON govai.regulatory_agent_versions (org_id, configuration_hash);
CREATE INDEX IF NOT EXISTS regulatory_agent_versions_org_prompt_hash_idx
  ON govai.regulatory_agent_versions (org_id, prompt_policy_hash);
CREATE INDEX IF NOT EXISTS regulatory_agent_versions_org_tool_hash_idx
  ON govai.regulatory_agent_versions (org_id, tool_manifest_hash);

ALTER TABLE govai.regulatory_agent_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_agent_versions FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- C. govai.regulatory_agent_capability_bindings — declared capability evidence
--
-- hard_deny_floor_expected is a declared governance expectation used as registry
-- evidence. It does not enforce runtime hard-deny behavior. Runtime enforcement
-- remains out of scope for PR-R5 and must be implemented separately.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_agent_capability_bindings (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid        NOT NULL,
  agent_id                 uuid        NOT NULL REFERENCES govai.regulatory_agents(id),
  agent_version_id         uuid        NULL REFERENCES govai.regulatory_agent_versions(id),
  capability_key           text        NOT NULL,
  capability_name          text        NOT NULL,
  capability_category      text        NOT NULL CHECK (capability_category IN (
                             'READ_ONLY', 'WRITE_ACTION', 'EXTERNAL_SIDE_EFFECT', 'DATA_ACCESS',
                             'FILESYSTEM', 'NETWORK', 'CODE_EXECUTION', 'BROWSER', 'COMMUNICATION',
                             'ADMINISTRATIVE', 'EVALUATION', 'MONITORING', 'OTHER')),
  capability_status        text        NOT NULL CHECK (capability_status IN (
                             'PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'APPROVED_WITH_CONDITIONS',
                             'SUSPENDED', 'RETIRED', 'REJECTED')),
  risk_posture             text        NOT NULL CHECK (risk_posture IN (
                             'LOW', 'MODERATE', 'HIGH', 'PROHIBITED', 'UNKNOWN')),
  -- hard_deny_floor_expected is a declared governance expectation used as registry
  -- evidence. It does not enforce runtime hard-deny behavior. Runtime enforcement
  -- remains out of scope for PR-R5 and must be implemented separately.
  hard_deny_floor_expected boolean     NOT NULL DEFAULT true,
  approval_required        boolean     NOT NULL DEFAULT false,
  evidence_required        boolean     NOT NULL DEFAULT true,
  scope_summary            text        NOT NULL DEFAULT '',
  restriction_summary      text        NOT NULL DEFAULT '',
  rationale                text        NOT NULL DEFAULT '',
  regulatory_source_id     uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id               uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id       uuid        NULL,
  updated_by_user_id       uuid        NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Uniqueness of (org_id, agent_id, agent_version_id, capability_key). Because
-- agent_version_id is nullable and SQL treats NULLs as distinct, a plain UNIQUE
-- constraint would not catch duplicate agent-level (NULL version) bindings.
-- Two partial unique indexes cover both cases deterministically.
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_agent_capability_bindings_versioned_uq
  ON govai.regulatory_agent_capability_bindings (org_id, agent_id, agent_version_id, capability_key)
  WHERE agent_version_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_agent_capability_bindings_agentlevel_uq
  ON govai.regulatory_agent_capability_bindings (org_id, agent_id, capability_key)
  WHERE agent_version_id IS NULL;

CREATE INDEX IF NOT EXISTS regulatory_agent_capability_bindings_org_agent_idx
  ON govai.regulatory_agent_capability_bindings (org_id, agent_id);
CREATE INDEX IF NOT EXISTS regulatory_agent_capability_bindings_org_version_idx
  ON govai.regulatory_agent_capability_bindings (org_id, agent_version_id);
CREATE INDEX IF NOT EXISTS regulatory_agent_capability_bindings_org_category_idx
  ON govai.regulatory_agent_capability_bindings (org_id, capability_category);
CREATE INDEX IF NOT EXISTS regulatory_agent_capability_bindings_org_status_idx
  ON govai.regulatory_agent_capability_bindings (org_id, capability_status);
CREATE INDEX IF NOT EXISTS regulatory_agent_capability_bindings_org_risk_idx
  ON govai.regulatory_agent_capability_bindings (org_id, risk_posture);
CREATE INDEX IF NOT EXISTS regulatory_agent_capability_bindings_org_hard_deny_idx
  ON govai.regulatory_agent_capability_bindings (org_id, hard_deny_floor_expected);
CREATE INDEX IF NOT EXISTS regulatory_agent_capability_bindings_org_approval_idx
  ON govai.regulatory_agent_capability_bindings (org_id, approval_required);
CREATE INDEX IF NOT EXISTS regulatory_agent_capability_bindings_org_evidence_idx
  ON govai.regulatory_agent_capability_bindings (org_id, evidence_required);
CREATE INDEX IF NOT EXISTS regulatory_agent_capability_bindings_org_created_idx
  ON govai.regulatory_agent_capability_bindings (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_agent_capability_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_agent_capability_bindings FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- RLS policies — per command × role. FK checks bypass RLS, so cross-table
-- references are visibility-checked with explicit EXISTS guards in WITH CHECK.
-- New-row columns inside EXISTS are table-qualified to avoid resolving to a
-- same-named column on the referenced table.
-- ===========================================================================

-- regulatory_agents ---------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_agents_select_app ON govai.regulatory_agents
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_agents_insert_app ON govai.regulatory_agents
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND (
        provider_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_providers p
          WHERE p.id = regulatory_agents.provider_id
            AND p.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        primary_ai_system_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_ai_systems a
          WHERE a.id = regulatory_agents.primary_ai_system_id
            AND a.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        primary_model_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_models m
          WHERE m.id = regulatory_agents.primary_model_id
            AND m.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        primary_model_version_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_model_versions v
          WHERE v.id = regulatory_agents.primary_model_version_id
            AND v.org_id::text = current_setting('app.org_id', true)
            AND v.model_id = regulatory_agents.primary_model_id)
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_agents.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_agents.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_agents_update_app ON govai.regulatory_agents
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND (
        provider_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_providers p
          WHERE p.id = regulatory_agents.provider_id
            AND p.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        primary_ai_system_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_ai_systems a
          WHERE a.id = regulatory_agents.primary_ai_system_id
            AND a.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        primary_model_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_models m
          WHERE m.id = regulatory_agents.primary_model_id
            AND m.org_id::text = current_setting('app.org_id', true))
      )
      AND (
        primary_model_version_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_model_versions v
          WHERE v.id = regulatory_agents.primary_model_version_id
            AND v.org_id::text = current_setting('app.org_id', true)
            AND v.model_id = regulatory_agents.primary_model_id)
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_agents.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_agents.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_agents_select_writer ON govai.regulatory_agents
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_agent_versions -------------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_agent_versions_select_app ON govai.regulatory_agent_versions
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_agent_versions_insert_app ON govai.regulatory_agent_versions
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_agents ag
        WHERE ag.id = regulatory_agent_versions.agent_id
          AND ag.org_id::text = current_setting('app.org_id', true))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_agent_versions_update_app ON govai.regulatory_agent_versions
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_agents ag
        WHERE ag.id = regulatory_agent_versions.agent_id
          AND ag.org_id::text = current_setting('app.org_id', true))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_agent_versions_select_writer ON govai.regulatory_agent_versions
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_agent_capability_bindings --------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_agent_capability_bindings_select_app ON govai.regulatory_agent_capability_bindings
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A binding carries the caller's org_id. agent_id must be an own-tenant agent.
-- The agent_version EXISTS additionally enforces that the referenced version is
-- own-tenant AND belongs to agent_id (its agent_id column is qualified against
-- the new binding row to avoid an inner-scope tautology). Optional source/control
-- references must be own-tenant or system.
DO $$ BEGIN
  CREATE POLICY regulatory_agent_capability_bindings_insert_app ON govai.regulatory_agent_capability_bindings
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_agents ag
        WHERE ag.id = regulatory_agent_capability_bindings.agent_id
          AND ag.org_id::text = current_setting('app.org_id', true))
      AND (
        agent_version_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_agent_versions av
          WHERE av.id = regulatory_agent_capability_bindings.agent_version_id
            AND av.org_id::text = current_setting('app.org_id', true)
            AND av.agent_id = regulatory_agent_capability_bindings.agent_id)
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_agent_capability_bindings.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_agent_capability_bindings.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_agent_capability_bindings_update_app ON govai.regulatory_agent_capability_bindings
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (SELECT 1 FROM govai.regulatory_agents ag
        WHERE ag.id = regulatory_agent_capability_bindings.agent_id
          AND ag.org_id::text = current_setting('app.org_id', true))
      AND (
        agent_version_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_agent_versions av
          WHERE av.id = regulatory_agent_capability_bindings.agent_version_id
            AND av.org_id::text = current_setting('app.org_id', true)
            AND av.agent_id = regulatory_agent_capability_bindings.agent_id)
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_agent_capability_bindings.regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true)))
      )
      AND (
        control_id IS NULL
        OR EXISTS (SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = regulatory_agent_capability_bindings.control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true)))
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_agent_capability_bindings_select_writer ON govai.regulatory_agent_capability_bindings
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Grants — SELECT/INSERT/UPDATE for the app role (no DELETE endpoint).
-- ===========================================================================

GRANT SELECT, INSERT, UPDATE ON govai.regulatory_agents                    TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.regulatory_agent_versions            TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.regulatory_agent_capability_bindings TO govai_app;

RESET ROLE;
