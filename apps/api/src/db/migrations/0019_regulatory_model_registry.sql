-- Migration 0019 — Regulatory Core PR-R4: Model Registry (issue #59, umbrella #33).
--
-- Production-focused model registry: the next P0 Native Regulatory Core
-- foundation after the source registry / control catalog (PR-R1 / 0016), the
-- AI System Registry (PR-R2 / 0017), and the Provider Registry (PR-R3 / 0018).
-- The Model Registry depends on both the AI System Registry and the Provider
-- Registry; both are now in place.
--
--   - govai.regulatory_models               — tenant model identity records.
--   - govai.regulatory_model_versions        — per-model version provenance.
--   - govai.regulatory_ai_system_model_links — AI-system ↔ model-version bindings.
--
-- PROVENANCE / METADATA ONLY. NO model artifact bytes, training data, evaluation
-- datasets, credentials, API keys, secrets, tokens, or certificates are stored
-- here — artifact_uri / *_hash columns are provenance metadata only. NO agent
-- registry, use-case registry, risk engine, runtime enforcement, connector, UI,
-- or report ships here — those remain future work. Mutations route real audit
-- events onto the existing `policy` ChainCategory via govai.audit_events.
--
-- Scope model: all three tables are tenant-owned only (org_id NOT NULL); there
-- is no system scope. FK checks bypass RLS, so every cross-table reference is
-- visibility-checked with an explicit EXISTS in the INSERT/UPDATE WITH CHECK
-- policies (mirrors the PR #64/#65/#66 review hardening). For links, a single
-- EXISTS additionally enforces that model_version_id belongs to model_id.
--
-- Conventions follow 0001 / 0012-0018: gen_random_uuid() PK defaults (pgcrypto),
-- text columns with CHECK-pinned enums, RLS ENABLE + FORCE, idempotent
-- per-command/per-role policies, org_id columns without an FK to govai.orgs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. govai.regulatory_models — tenant model identity
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_models (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid        NOT NULL,
  model_key             text        NOT NULL,
  name                  text        NOT NULL,
  description           text        NOT NULL DEFAULT '',
  model_type            text        NOT NULL CHECK (model_type IN (
                          'FOUNDATION_MODEL', 'FINE_TUNED_MODEL', 'EMBEDDING_MODEL', 'CLASSIFIER',
                          'RERANKER', 'RULE_BASED_MODEL', 'ENSEMBLE', 'THIRD_PARTY_MODEL', 'OTHER')),
  model_status          text        NOT NULL CHECK (model_status IN (
                          'PROPOSED', 'UNDER_EVALUATION', 'APPROVED', 'APPROVED_WITH_CONDITIONS',
                          'ACTIVE', 'SUSPENDED', 'RETIRED', 'REJECTED')),
  provider_id           uuid        NOT NULL REFERENCES govai.regulatory_providers(id),
  primary_ai_system_id  uuid        NULL REFERENCES govai.regulatory_ai_systems(id),
  primary_jurisdiction  text        NOT NULL DEFAULT 'BR',
  business_owner        text        NULL,
  technical_owner       text        NULL,
  legal_owner           text        NULL,
  dpo_owner             text        NULL,
  intended_use          text        NOT NULL DEFAULT '',
  prohibited_uses       text        NOT NULL DEFAULT '',
  training_data_summary text        NOT NULL DEFAULT '',
  evaluation_summary    text        NOT NULL DEFAULT '',
  human_oversight_summary text      NOT NULL DEFAULT '',
  last_reviewed_at      timestamptz NULL,
  next_review_at        timestamptz NULL,
  review_frequency      text        NOT NULL DEFAULT 'AD_HOC' CHECK (review_frequency IN (
                          'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'AD_HOC', 'EMERGENCY')),
  regulatory_source_id  uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id            uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id    uuid        NULL,
  updated_by_user_id    uuid        NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_models_tenant_key_uq UNIQUE (org_id, model_key)
);

CREATE INDEX IF NOT EXISTS regulatory_models_org_created_idx
  ON govai.regulatory_models (org_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS regulatory_models_org_status_idx
  ON govai.regulatory_models (org_id, model_status);
CREATE INDEX IF NOT EXISTS regulatory_models_org_type_idx
  ON govai.regulatory_models (org_id, model_type);
CREATE INDEX IF NOT EXISTS regulatory_models_org_provider_idx
  ON govai.regulatory_models (org_id, provider_id);
CREATE INDEX IF NOT EXISTS regulatory_models_org_ai_system_idx
  ON govai.regulatory_models (org_id, primary_ai_system_id);
CREATE INDEX IF NOT EXISTS regulatory_models_org_next_review_idx
  ON govai.regulatory_models (org_id, next_review_at);

ALTER TABLE govai.regulatory_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_models FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- B. govai.regulatory_model_versions — per-model version provenance
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_model_versions (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid        NOT NULL,
  model_id                uuid        NOT NULL REFERENCES govai.regulatory_models(id),
  version_key             text        NOT NULL,
  version_label           text        NOT NULL,
  version_status          text        NOT NULL CHECK (version_status IN (
                            'DRAFT', 'UNDER_EVALUATION', 'APPROVED', 'ACTIVE', 'DEPRECATED',
                            'RETIRED', 'REJECTED')),
  provider_model_name     text        NULL,
  provider_model_version  text        NULL,
  -- Provenance metadata only — never the artifact bytes / data themselves.
  artifact_uri            text        NULL,
  artifact_hash           text        NULL,
  training_data_hash      text        NULL,
  evaluation_dataset_hash text        NULL,
  evaluation_score_summary text       NOT NULL DEFAULT '',
  release_notes           text        NOT NULL DEFAULT '',
  approval_reference      text        NULL,
  approved_at             timestamptz NULL,
  approved_by_user_id     uuid        NULL,
  retired_at              timestamptz NULL,
  metadata                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id      uuid        NULL,
  updated_by_user_id      uuid        NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_model_versions_tenant_key_uq UNIQUE (org_id, model_id, version_key)
);

CREATE INDEX IF NOT EXISTS regulatory_model_versions_org_model_created_idx
  ON govai.regulatory_model_versions (org_id, model_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS regulatory_model_versions_org_status_idx
  ON govai.regulatory_model_versions (org_id, version_status);
CREATE INDEX IF NOT EXISTS regulatory_model_versions_org_approved_idx
  ON govai.regulatory_model_versions (org_id, approved_at);
CREATE INDEX IF NOT EXISTS regulatory_model_versions_org_artifact_hash_idx
  ON govai.regulatory_model_versions (org_id, artifact_hash);
CREATE INDEX IF NOT EXISTS regulatory_model_versions_org_training_hash_idx
  ON govai.regulatory_model_versions (org_id, training_data_hash);

ALTER TABLE govai.regulatory_model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_model_versions FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- C. govai.regulatory_ai_system_model_links — AI-system ↔ model-version binding
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_ai_system_model_links (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid        NOT NULL,
  ai_system_id           uuid        NOT NULL REFERENCES govai.regulatory_ai_systems(id),
  model_id               uuid        NOT NULL REFERENCES govai.regulatory_models(id),
  model_version_id       uuid        NOT NULL REFERENCES govai.regulatory_model_versions(id),
  link_status            text        NOT NULL CHECK (link_status IN (
                           'PROPOSED', 'ACTIVE', 'SUSPENDED', 'RETIRED')),
  usage_role             text        NOT NULL CHECK (usage_role IN (
                           'PRIMARY_MODEL', 'FALLBACK_MODEL', 'EMBEDDING_MODEL', 'RERANKING_MODEL',
                           'CLASSIFICATION_MODEL', 'SAFETY_MODEL', 'EVALUATION_MODEL', 'OTHER')),
  deployment_environment text        NOT NULL CHECK (deployment_environment IN (
                           'DEVELOPMENT', 'STAGING', 'PRODUCTION', 'CUSTOMER_MANAGED',
                           'THIRD_PARTY_MANAGED', 'NOT_DEPLOYED')),
  effective_from         timestamptz NULL,
  effective_to           timestamptz NULL,
  rationale              text        NOT NULL DEFAULT '',
  metadata               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id     uuid        NULL,
  updated_by_user_id     uuid        NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_ai_system_model_links_uq
    UNIQUE (org_id, ai_system_id, model_version_id, usage_role, deployment_environment)
);

CREATE INDEX IF NOT EXISTS regulatory_ai_system_model_links_org_ai_system_idx
  ON govai.regulatory_ai_system_model_links (org_id, ai_system_id);
CREATE INDEX IF NOT EXISTS regulatory_ai_system_model_links_org_model_idx
  ON govai.regulatory_ai_system_model_links (org_id, model_id);
CREATE INDEX IF NOT EXISTS regulatory_ai_system_model_links_org_version_idx
  ON govai.regulatory_ai_system_model_links (org_id, model_version_id);
CREATE INDEX IF NOT EXISTS regulatory_ai_system_model_links_org_status_idx
  ON govai.regulatory_ai_system_model_links (org_id, link_status);
CREATE INDEX IF NOT EXISTS regulatory_ai_system_model_links_org_environment_idx
  ON govai.regulatory_ai_system_model_links (org_id, deployment_environment);
CREATE INDEX IF NOT EXISTS regulatory_ai_system_model_links_org_created_idx
  ON govai.regulatory_ai_system_model_links (org_id, created_at DESC, id DESC);

ALTER TABLE govai.regulatory_ai_system_model_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_ai_system_model_links FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- RLS policies — per command × role. FK checks bypass RLS, so cross-table
-- references are visibility-checked with explicit EXISTS guards in WITH CHECK.
-- ===========================================================================

-- regulatory_models ---------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_models_select_app ON govai.regulatory_models
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A model carries the caller's org_id; provider_id must be an own-tenant
-- provider; primary_ai_system_id (optional) an own-tenant AI system; the
-- catalog references (optional) own-tenant or system rows.
DO $$ BEGIN
  CREATE POLICY regulatory_models_insert_app ON govai.regulatory_models
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (
        SELECT 1 FROM govai.regulatory_providers p
        WHERE p.id = provider_id AND p.org_id::text = current_setting('app.org_id', true)
      )
      AND (
        primary_ai_system_id IS NULL
        OR EXISTS (
          SELECT 1 FROM govai.regulatory_ai_systems a
          WHERE a.id = primary_ai_system_id AND a.org_id::text = current_setting('app.org_id', true)
        )
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (
          SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true))
        )
      )
      AND (
        control_id IS NULL
        OR EXISTS (
          SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true))
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_models_update_app ON govai.regulatory_models
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (
        SELECT 1 FROM govai.regulatory_providers p
        WHERE p.id = provider_id AND p.org_id::text = current_setting('app.org_id', true)
      )
      AND (
        primary_ai_system_id IS NULL
        OR EXISTS (
          SELECT 1 FROM govai.regulatory_ai_systems a
          WHERE a.id = primary_ai_system_id AND a.org_id::text = current_setting('app.org_id', true)
        )
      )
      AND (
        regulatory_source_id IS NULL
        OR EXISTS (
          SELECT 1 FROM govai.regulatory_sources s
          WHERE s.id = regulatory_source_id
            AND (s.org_id IS NULL OR s.org_id::text = current_setting('app.org_id', true))
        )
      )
      AND (
        control_id IS NULL
        OR EXISTS (
          SELECT 1 FROM govai.regulatory_controls c
          WHERE c.id = control_id
            AND (c.org_id IS NULL OR c.org_id::text = current_setting('app.org_id', true))
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_models_select_writer ON govai.regulatory_models
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_model_versions -------------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_model_versions_select_app ON govai.regulatory_model_versions
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A version carries the caller's org_id and must anchor to an own-tenant model.
DO $$ BEGIN
  CREATE POLICY regulatory_model_versions_insert_app ON govai.regulatory_model_versions
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (
        SELECT 1 FROM govai.regulatory_models m
        WHERE m.id = model_id AND m.org_id::text = current_setting('app.org_id', true)
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_model_versions_update_app ON govai.regulatory_model_versions
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (
        SELECT 1 FROM govai.regulatory_models m
        WHERE m.id = model_id AND m.org_id::text = current_setting('app.org_id', true)
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_model_versions_select_writer ON govai.regulatory_model_versions
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_ai_system_model_links ------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_ai_system_model_links_select_app ON govai.regulatory_ai_system_model_links
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A link carries the caller's org_id. ai_system_id and model_id must be
-- own-tenant rows. The model_version EXISTS additionally enforces that the
-- referenced version is own-tenant AND belongs to model_id (no mismatched
-- model/version, no cross-tenant existence oracle).
DO $$ BEGIN
  CREATE POLICY regulatory_ai_system_model_links_insert_app ON govai.regulatory_ai_system_model_links
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (
        SELECT 1 FROM govai.regulatory_ai_systems a
        WHERE a.id = regulatory_ai_system_model_links.ai_system_id
          AND a.org_id::text = current_setting('app.org_id', true)
      )
      AND EXISTS (
        SELECT 1 FROM govai.regulatory_models m
        WHERE m.id = regulatory_ai_system_model_links.model_id
          AND m.org_id::text = current_setting('app.org_id', true)
      )
      AND EXISTS (
        SELECT 1 FROM govai.regulatory_model_versions v
        WHERE v.id = regulatory_ai_system_model_links.model_version_id
          AND v.org_id::text = current_setting('app.org_id', true)
          -- v.model_id is a column on regulatory_model_versions; the new-row
          -- column must be table-qualified or it would resolve to v.model_id
          -- (a tautology) and skip the version-belongs-to-model guard.
          AND v.model_id = regulatory_ai_system_model_links.model_id
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_ai_system_model_links_update_app ON govai.regulatory_ai_system_model_links
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
      AND EXISTS (
        SELECT 1 FROM govai.regulatory_ai_systems a
        WHERE a.id = regulatory_ai_system_model_links.ai_system_id
          AND a.org_id::text = current_setting('app.org_id', true)
      )
      AND EXISTS (
        SELECT 1 FROM govai.regulatory_models m
        WHERE m.id = regulatory_ai_system_model_links.model_id
          AND m.org_id::text = current_setting('app.org_id', true)
      )
      AND EXISTS (
        SELECT 1 FROM govai.regulatory_model_versions v
        WHERE v.id = regulatory_ai_system_model_links.model_version_id
          AND v.org_id::text = current_setting('app.org_id', true)
          AND v.model_id = regulatory_ai_system_model_links.model_id
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_ai_system_model_links_select_writer ON govai.regulatory_ai_system_model_links
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Grants — SELECT/INSERT/UPDATE for the app role (no DELETE endpoint).
-- ===========================================================================

GRANT SELECT, INSERT, UPDATE ON govai.regulatory_models               TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.regulatory_model_versions        TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.regulatory_ai_system_model_links TO govai_app;

RESET ROLE;
