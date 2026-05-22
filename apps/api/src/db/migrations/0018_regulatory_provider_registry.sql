-- Migration 0018 — Regulatory Core PR-R3: Provider Registry (issue #59, umbrella #33).
--
-- Next P0 Native Regulatory Core foundation after the source registry / control
-- catalog (PR-R1 / 0016) and the AI System Registry (PR-R2 / 0017). The Model
-- Registry depends on both the AI System Registry and the Provider Registry, so
-- the Provider Registry lands first. Scope is intentionally a single primitive:
-- a tenant-owned inventory of third-party providers and their governance posture.
--
--   - govai.regulatory_providers — tenant provider inventory + review posture.
--
-- POSTURE / INVENTORY ONLY. NO credential vault, API keys, client secrets, OAuth
-- tokens, certificates, passwords, or live provider configuration are stored or
-- implemented here. NO model registry, agent registry, use-case registry, risk
-- engine, connector, UI, or report ships here — those remain future work.
-- Mutations route real audit events onto the existing `policy` ChainCategory via
-- govai.audit_events (no new audit chain).
--
-- Scope model: providers are tenant-owned only (org_id NOT NULL); there is no
-- system scope. Optional nullable references into the PR-R1 source registry /
-- control catalog are visibility-checked at the RLS WITH CHECK level (a tenant
-- may reference its own or system rows, never another tenant's hidden rows —
-- mirroring the PR #64 / PR #65 review hardening).
--
-- Conventions follow 0001 / 0012-0017: gen_random_uuid() PK defaults (pgcrypto),
-- text columns with CHECK-pinned enums, RLS ENABLE + FORCE, idempotent
-- per-command/per-role policies, org_id columns without an FK to govai.orgs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. govai.regulatory_providers — tenant provider inventory + posture
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_providers (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid        NOT NULL,
  provider_key                text        NOT NULL,
  name                        text        NOT NULL,
  description                 text        NOT NULL DEFAULT '',
  provider_type               text        NOT NULL CHECK (provider_type IN (
                                'MODEL_PROVIDER', 'CLOUD_PROVIDER', 'AI_PLATFORM', 'VECTOR_DATABASE',
                                'DATA_PROCESSOR', 'EVALUATION_TOOL', 'MONITORING_TOOL', 'SECURITY_TOOL',
                                'WORKFLOW_TOOL', 'OTHER')),
  provider_status             text        NOT NULL CHECK (provider_status IN (
                                'PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'APPROVED_WITH_CONDITIONS',
                                'SUSPENDED', 'RETIRED', 'REJECTED')),
  deployment_model            text        NOT NULL CHECK (deployment_model IN (
                                'SAAS', 'API', 'CLOUD_MARKETPLACE', 'CUSTOMER_CLOUD', 'ON_PREMISE',
                                'HYBRID', 'OTHER')),
  data_processing_role        text        NOT NULL CHECK (data_processing_role IN (
                                'CONTROLLER', 'PROCESSOR', 'SUBPROCESSOR', 'JOINT_CONTROLLER',
                                'NOT_APPLICABLE', 'TO_BE_DETERMINED')),
  primary_jurisdiction        text        NOT NULL DEFAULT 'BR',
  headquarters_country        text        NULL,
  website_url                 text        NULL,
  contact_name                text        NULL,
  contact_email               text        NULL,
  dpa_status                  text        NOT NULL CHECK (dpa_status IN (
                                'NOT_STARTED', 'REQUESTED', 'UNDER_REVIEW', 'APPROVED',
                                'APPROVED_WITH_CONDITIONS', 'REJECTED', 'NOT_APPLICABLE')),
  security_review_status      text        NOT NULL CHECK (security_review_status IN (
                                'NOT_STARTED', 'UNDER_REVIEW', 'APPROVED', 'APPROVED_WITH_CONDITIONS',
                                'REJECTED', 'EXPIRED')),
  subprocessors_review_status text        NOT NULL CHECK (subprocessors_review_status IN (
                                'NOT_STARTED', 'UNDER_REVIEW', 'APPROVED', 'APPROVED_WITH_CONDITIONS',
                                'REJECTED', 'NOT_APPLICABLE')),
  ai_terms_review_status      text        NOT NULL CHECK (ai_terms_review_status IN (
                                'NOT_STARTED', 'UNDER_REVIEW', 'APPROVED', 'APPROVED_WITH_CONDITIONS',
                                'REJECTED', 'NOT_APPLICABLE')),
  last_reviewed_at            timestamptz NULL,
  next_review_at              timestamptz NULL,
  review_frequency            text        NOT NULL DEFAULT 'AD_HOC' CHECK (review_frequency IN (
                                'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'AD_HOC', 'EMERGENCY')),
  -- Optional links into the PR-R1 catalog; visibility enforced by RLS WITH CHECK.
  regulatory_source_id        uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id                  uuid        NULL REFERENCES govai.regulatory_controls(id),
  metadata                    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id          uuid        NULL,
  updated_by_user_id          uuid        NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  -- provider_key is unique per tenant; immutable through the API.
  CONSTRAINT regulatory_providers_tenant_key_uq UNIQUE (org_id, provider_key)
);

CREATE INDEX IF NOT EXISTS regulatory_providers_org_created_idx
  ON govai.regulatory_providers (org_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS regulatory_providers_org_status_idx
  ON govai.regulatory_providers (org_id, provider_status);
CREATE INDEX IF NOT EXISTS regulatory_providers_org_type_idx
  ON govai.regulatory_providers (org_id, provider_type);
CREATE INDEX IF NOT EXISTS regulatory_providers_org_jurisdiction_idx
  ON govai.regulatory_providers (org_id, primary_jurisdiction);
CREATE INDEX IF NOT EXISTS regulatory_providers_org_next_review_idx
  ON govai.regulatory_providers (org_id, next_review_at);
CREATE INDEX IF NOT EXISTS regulatory_providers_org_processing_role_idx
  ON govai.regulatory_providers (org_id, data_processing_role);

ALTER TABLE govai.regulatory_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_providers FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- RLS policies — per command × role.
--
-- Providers are strictly tenant-scoped: a row is visible/mutable only when its
-- org_id equals the caller's app.org_id. Optional parent references
-- (regulatory_source_id, control_id) must point at a row visible to the caller
-- (own-tenant or system, org_id IS NULL). FK checks bypass RLS, so the EXISTS
-- guards — not just service-layer checks — are what prevent a tenant from
-- referencing another tenant's hidden source/control.
-- ===========================================================================

DO $$ BEGIN
  CREATE POLICY regulatory_providers_select_app ON govai.regulatory_providers
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_providers_insert_app ON govai.regulatory_providers
    FOR INSERT TO govai_app
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
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
  CREATE POLICY regulatory_providers_update_app ON govai.regulatory_providers
    FOR UPDATE TO govai_app
    USING      (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (
      org_id::text = current_setting('app.org_id', true)
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
  CREATE POLICY regulatory_providers_select_writer ON govai.regulatory_providers
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Grants — SELECT/INSERT/UPDATE for the app role (no DELETE endpoint).
-- ===========================================================================

GRANT SELECT, INSERT, UPDATE ON govai.regulatory_providers TO govai_app;

RESET ROLE;
