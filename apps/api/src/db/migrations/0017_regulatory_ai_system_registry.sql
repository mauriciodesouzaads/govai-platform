-- Migration 0017 — Regulatory Core PR-R2: AI System Registry (issue #59, umbrella #33).
--
-- Next P0 Native Regulatory Core foundation after the source registry and
-- unified control catalog (PR-R1 / migration 0016). Scope is intentionally a
-- single primitive: a tenant-owned inventory of AI systems.
--
--   - govai.regulatory_ai_systems — tenant AI system inventory records.
--
-- NO model registry, agent registry, use-case registry, provider registry,
-- risk-classification engine, CNJ/Sinapses data model, connector, scheduler,
-- UI, or report ships here — those remain future work. Mutations route real
-- audit events onto the existing `policy` ChainCategory via govai.audit_events
-- (no new audit chain).
--
-- Scope model: AI systems are tenant-owned only (org_id NOT NULL). Unlike
-- regulatory_sources / regulatory_controls there is no system scope here — an
-- AI system is always a customer asset. Optional nullable references to the
-- PR-R1 source registry / control catalog are visibility-checked at the RLS
-- WITH CHECK level (a tenant may reference its own or system rows, never another
-- tenant's hidden rows — mirroring the PR #64 review hardening). external_provider_id
-- is a forward-compatibility column for a future Provider Registry and carries
-- NO foreign key in this PR.
--
-- Conventions follow 0001 / 0012-0016: gen_random_uuid() PK defaults (pgcrypto),
-- text columns with CHECK-pinned enums, RLS ENABLE + FORCE, idempotent
-- per-command/per-role policies, org_id columns without an FK to govai.orgs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. govai.regulatory_ai_systems — tenant AI system inventory
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_ai_systems (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid        NOT NULL,
  system_key             text        NOT NULL,
  name                   text        NOT NULL,
  description            text        NOT NULL DEFAULT '',
  system_type            text        NOT NULL CHECK (system_type IN (
                           'INTERNAL_PRODUCT', 'INTERNAL_WORKFLOW', 'THIRD_PARTY_PRODUCT',
                           'THIRD_PARTY_API', 'AGENTIC_WORKFLOW', 'DECISION_SUPPORT',
                           'DOCUMENT_PROCESSING', 'MODEL_ENDPOINT', 'OTHER')),
  lifecycle_state        text        NOT NULL CHECK (lifecycle_state IN (
                           'PROPOSED', 'DESIGN', 'EVALUATION', 'PILOT', 'ACTIVE',
                           'SUSPENDED', 'RETIRED')),
  business_owner         text        NULL,
  technical_owner        text        NULL,
  legal_owner            text        NULL,
  dpo_owner              text        NULL,
  intended_purpose       text        NOT NULL DEFAULT '',
  primary_jurisdiction   text        NOT NULL DEFAULT 'BR',
  deployment_environment text        NOT NULL CHECK (deployment_environment IN (
                           'DEVELOPMENT', 'STAGING', 'PRODUCTION', 'CUSTOMER_MANAGED',
                           'THIRD_PARTY_MANAGED', 'NOT_DEPLOYED')),
  -- Forward-compatibility for a future Provider Registry; NO FK in this PR.
  external_provider_id   uuid        NULL,
  -- Optional links into the PR-R1 catalog; visibility enforced by RLS WITH CHECK.
  regulatory_source_id   uuid        NULL REFERENCES govai.regulatory_sources(id),
  control_id             uuid        NULL REFERENCES govai.regulatory_controls(id),
  review_frequency       text        NOT NULL DEFAULT 'AD_HOC' CHECK (review_frequency IN (
                           'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'AD_HOC', 'EMERGENCY')),
  last_reviewed_at       timestamptz NULL,
  next_review_at         timestamptz NULL,
  metadata               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id     uuid        NULL,
  updated_by_user_id     uuid        NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- system_key is unique per tenant; immutable through the API.
  CONSTRAINT regulatory_ai_systems_tenant_key_uq UNIQUE (org_id, system_key)
);

CREATE INDEX IF NOT EXISTS regulatory_ai_systems_org_created_idx
  ON govai.regulatory_ai_systems (org_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS regulatory_ai_systems_org_lifecycle_idx
  ON govai.regulatory_ai_systems (org_id, lifecycle_state);
CREATE INDEX IF NOT EXISTS regulatory_ai_systems_org_type_idx
  ON govai.regulatory_ai_systems (org_id, system_type);
CREATE INDEX IF NOT EXISTS regulatory_ai_systems_org_jurisdiction_idx
  ON govai.regulatory_ai_systems (org_id, primary_jurisdiction);
CREATE INDEX IF NOT EXISTS regulatory_ai_systems_org_next_review_idx
  ON govai.regulatory_ai_systems (org_id, next_review_at);

ALTER TABLE govai.regulatory_ai_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_ai_systems FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- RLS policies — per command × role.
--
-- AI systems are strictly tenant-scoped: a row is visible/mutable only when its
-- org_id equals the caller's app.org_id. Optional parent references
-- (regulatory_source_id, control_id) must point at a row visible to the caller
-- (own-tenant or system, org_id IS NULL). FK checks bypass RLS, so the EXISTS
-- guards — not just service-layer checks — are what prevent a tenant from
-- referencing another tenant's hidden source/control (mirrors PR #64 review).
-- ===========================================================================

DO $$ BEGIN
  CREATE POLICY regulatory_ai_systems_select_app ON govai.regulatory_ai_systems
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_ai_systems_insert_app ON govai.regulatory_ai_systems
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
  CREATE POLICY regulatory_ai_systems_update_app ON govai.regulatory_ai_systems
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
  CREATE POLICY regulatory_ai_systems_select_writer ON govai.regulatory_ai_systems
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Grants — SELECT/INSERT/UPDATE for the app role (no DELETE endpoint).
-- ===========================================================================

GRANT SELECT, INSERT, UPDATE ON govai.regulatory_ai_systems TO govai_app;

RESET ROLE;
