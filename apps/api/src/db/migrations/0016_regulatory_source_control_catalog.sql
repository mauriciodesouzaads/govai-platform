-- Migration 0016 — Regulatory Core PR-R1: source registry + control catalog
-- (issue #59, umbrella #33).
--
-- First production foundation for the GovAI Regulatory Core, converting the
-- PR-C2 target architecture (docs/architecture/regulatory/20-target-control-catalog.md,
-- 21-regulatory-intelligence-operating-model.md, 23-regulatory-core-roadmap.md)
-- into durable primitives. Scope is intentionally the registry/catalog data
-- model only:
--   - govai.regulatory_sources                     — authoritative source metadata.
--   - govai.regulatory_source_versions             — per-source version metadata.
--   - govai.regulatory_source_relationships        — source-to-source relations.
--   - govai.regulatory_controls                    — unified control catalog.
--   - govai.regulatory_control_source_links        — control-to-source links.
--   - govai.regulatory_control_framework_mappings  — control-to-framework maps.
--
-- NO crawler, scheduler, automated source fetching, diff engine, or connector
-- ships here — those remain future work. No full legal texts or copyrighted
-- snapshots are stored: only URLs, hashes, metadata, version records, and short
-- governance summaries. Mutations route real audit events onto the existing
-- `policy` ChainCategory via govai.audit_events (no new audit chain).
--
-- Scope model (system vs tenant):
--   - org_id IS NULL  ⇔ scope = 'system'  → platform-curated, read-only through
--     tenant APIs (seeded out-of-band / by future migrations, never by govai_app).
--   - org_id IS NOT NULL ⇔ scope = 'tenant' → customer-owned, tenant-isolated.
--   Tenants may READ system rows plus their own tenant rows; they may only
--   INSERT/UPDATE rows carrying their own org_id. Child tables
--   (versions/relationships/links/mappings) are tenant-scoped (org_id NOT NULL)
--   in PR-R1; they may reference system rows as visible parents but are never
--   themselves system rows.
--
-- Conventions follow 0001 / 0012-0015: gen_random_uuid() PK defaults (pgcrypto),
-- text columns with CHECK-pinned enums, RLS ENABLE + FORCE, idempotent
-- per-command/per-role policies, org_id columns without an FK to govai.orgs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. govai.regulatory_sources — authoritative source metadata
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_sources (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL ⇔ system scope; set ⇔ tenant scope (enforced by the consistency CHECK).
  org_id              uuid        NULL,
  scope               text        NOT NULL CHECK (scope IN ('system', 'tenant')),
  source_key          text        NOT NULL,
  title               text        NOT NULL,
  jurisdiction        text        NOT NULL DEFAULT 'BR',
  authority           text        NULL,
  instrument_type     text        NULL,
  source_quality      text        NOT NULL CHECK (source_quality IN (
                        'PRIMARY_REGULATORY_SOURCE', 'PRIMARY_OFFICIAL_SOURCE', 'PRIMARY_VENDOR_DOC',
                        'ANALYST_REPORT', 'NEWS_SOURCE', 'SECONDARY_BLOG',
                        'INTERNAL_ARCHITECTURE_ANALYSIS', 'SOURCE_VERIFICATION_REQUIRED')),
  verification_status text        NOT NULL CHECK (verification_status IN (
                        'CONFIRMED_PRIMARY_SOURCE', 'PARTIAL_PRIMARY_SOURCE', 'SECONDARY_SOURCE',
                        'INTERNAL_ANALYSIS', 'NEEDS_SOURCE_VERIFICATION')),
  legal_status        text        NOT NULL CHECK (legal_status IN (
                        'ACTIVE', 'AMENDED', 'REVOKED', 'BILL', 'DRAFT', 'REFERENCE_ONLY', 'UNKNOWN')),
  official_url        text        NULL,
  publication_date    date        NULL,
  effective_date      date        NULL,
  last_verified_at    timestamptz NULL,
  next_review_at      timestamptz NULL,
  review_frequency    text        NOT NULL DEFAULT 'AD_HOC' CHECK (review_frequency IN (
                        'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'AD_HOC', 'EMERGENCY')),
  legal_owner         text        NULL,
  product_owner       text        NULL,
  notes               text        NULL,
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id  uuid        NULL,
  updated_by_user_id  uuid        NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_sources_scope_org_consistency
    CHECK ((scope = 'system') = (org_id IS NULL))
);

-- system source_key unique among system rows; tenant source_key unique per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_sources_system_key_uq
  ON govai.regulatory_sources (source_key) WHERE scope = 'system';
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_sources_tenant_key_uq
  ON govai.regulatory_sources (org_id, source_key) WHERE scope = 'tenant';

CREATE INDEX IF NOT EXISTS regulatory_sources_org_created_idx
  ON govai.regulatory_sources (org_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS regulatory_sources_created_idx
  ON govai.regulatory_sources (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS regulatory_sources_jurisdiction_idx
  ON govai.regulatory_sources (jurisdiction);
CREATE INDEX IF NOT EXISTS regulatory_sources_authority_idx
  ON govai.regulatory_sources (authority);
CREATE INDEX IF NOT EXISTS regulatory_sources_quality_idx
  ON govai.regulatory_sources (source_quality);
CREATE INDEX IF NOT EXISTS regulatory_sources_verification_idx
  ON govai.regulatory_sources (verification_status);
CREATE INDEX IF NOT EXISTS regulatory_sources_legal_status_idx
  ON govai.regulatory_sources (legal_status);

ALTER TABLE govai.regulatory_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_sources FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- B. govai.regulatory_source_versions — per-source version metadata
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_source_versions (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid        NOT NULL,
  source_id              uuid        NOT NULL REFERENCES govai.regulatory_sources(id),
  -- Deterministic per-source ordering; assigned monotonically by the service.
  version_number         bigint      NOT NULL,
  version_key            text        NULL,
  source_url             text        NULL,
  retrieved_at           timestamptz NULL,
  verified_at            timestamptz NULL,
  -- Hashes are metadata only; no source content is stored in PR-R1.
  content_hash           text        NULL,
  diff_hash              text        NULL,
  archived_snapshot_hash text        NULL,
  change_type            text        NOT NULL DEFAULT 'UNKNOWN' CHECK (change_type IN (
                           'CLARIFICATION', 'EXPANSION', 'RESTRICTION', 'RESCISSION',
                           'DEFERRAL', 'CONSOLIDATION', 'UNKNOWN')),
  summary                text        NULL,
  verification_status    text        NOT NULL CHECK (verification_status IN (
                           'CONFIRMED_PRIMARY_SOURCE', 'PARTIAL_PRIMARY_SOURCE', 'SECONDARY_SOURCE',
                           'INTERNAL_ANALYSIS', 'NEEDS_SOURCE_VERIFICATION')),
  metadata               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id     uuid        NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, version_number)
);

CREATE INDEX IF NOT EXISTS regulatory_source_versions_source_idx
  ON govai.regulatory_source_versions (source_id, version_number DESC);
CREATE INDEX IF NOT EXISTS regulatory_source_versions_org_idx
  ON govai.regulatory_source_versions (org_id);

ALTER TABLE govai.regulatory_source_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_source_versions FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- C. govai.regulatory_source_relationships — source-to-source relations
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_source_relationships (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL,
  from_source_id     uuid        NOT NULL REFERENCES govai.regulatory_sources(id),
  to_source_id       uuid        NOT NULL REFERENCES govai.regulatory_sources(id),
  relationship_type  text        NOT NULL CHECK (relationship_type IN (
                       'AMENDS', 'AMENDED_BY', 'REVOKES', 'REVOKED_BY', 'SUPERSEDES',
                       'SUPERSEDED_BY', 'CITES', 'CITED_BY', 'IMPLEMENTS', 'RELATED')),
  notes              text        NULL,
  created_by_user_id uuid        NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Self-relationship is forbidden by default.
  CONSTRAINT regulatory_source_relationships_no_self CHECK (from_source_id <> to_source_id),
  -- Prevent duplicate equivalent relationship rows per tenant.
  UNIQUE (org_id, from_source_id, to_source_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS regulatory_source_relationships_from_idx
  ON govai.regulatory_source_relationships (from_source_id);
CREATE INDEX IF NOT EXISTS regulatory_source_relationships_to_idx
  ON govai.regulatory_source_relationships (to_source_id);
CREATE INDEX IF NOT EXISTS regulatory_source_relationships_org_idx
  ON govai.regulatory_source_relationships (org_id);

ALTER TABLE govai.regulatory_source_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_source_relationships FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- D. govai.regulatory_controls — unified control catalog
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_controls (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid        NULL,
  scope                   text        NOT NULL CHECK (scope IN ('system', 'tenant')),
  control_key             text        NOT NULL,
  domain                  text        NOT NULL,
  name                    text        NOT NULL,
  description             text        NOT NULL DEFAULT '',
  capability_type         text        NOT NULL CHECK (capability_type IN (
                            'IMPLEMENTED_FOUNDATIONAL_CONTROL', 'REQUIRED_NATIVE_CAPABILITY',
                            'NATIVE_ENHANCEMENT_REQUIRED', 'CONNECTOR_ENRICHMENT', 'EXTERNAL_SERVICE_REQUIRED',
                            'CUSTOMER_PROCESS_REQUIRED', 'PROFESSIONAL_REVIEW_REQUIRED', 'SOURCE_VERIFICATION_REQUIRED')),
  implementation_state    text        NOT NULL CHECK (implementation_state IN (
                            'NOT_STARTED', 'IMPLEMENTED_FOUNDATIONAL_CONTROL', 'PARTIAL_PRIMITIVE_EXISTS',
                            'TARGET_CAPABILITY_REQUIRED', 'CONNECTOR_REQUIRED', 'EXTERNAL_VALIDATION_REQUIRED',
                            'CUSTOMER_PROCESS_REQUIRED', 'PROFESSIONAL_REVIEW_REQUIRED', 'SOURCE_VERIFICATION_REQUIRED')),
  build_decision          text        NOT NULL CHECK (build_decision IN (
                            'BUILD_NATIVE_CORE', 'BUILD_NATIVE_ENHANCED', 'CONNECTOR_ENRICHMENT',
                            'EXTERNAL_SERVICE_REQUIRED', 'CUSTOMER_PROCESS_REQUIRED', 'PROFESSIONAL_REVIEW_REQUIRED',
                            'OBSERVE', 'DO_NOT_BUILD')),
  automation_level        text        NOT NULL DEFAULT 'MANUAL' CHECK (automation_level IN (
                            'MANUAL', 'ASSISTED', 'AUTOMATED', 'EXTERNAL', 'NOT_APPLICABLE')),
  owner_role              text        NULL,
  review_frequency        text        NOT NULL DEFAULT 'AD_HOC' CHECK (review_frequency IN (
                            'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'AD_HOC', 'EMERGENCY')),
  evidence_required       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  current_govai_primitive jsonb       NOT NULL DEFAULT '{}'::jsonb,
  metadata                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id      uuid        NULL,
  updated_by_user_id      uuid        NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulatory_controls_scope_org_consistency
    CHECK ((scope = 'system') = (org_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS regulatory_controls_system_key_uq
  ON govai.regulatory_controls (control_key) WHERE scope = 'system';
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_controls_tenant_key_uq
  ON govai.regulatory_controls (org_id, control_key) WHERE scope = 'tenant';

CREATE INDEX IF NOT EXISTS regulatory_controls_org_created_idx
  ON govai.regulatory_controls (org_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS regulatory_controls_created_idx
  ON govai.regulatory_controls (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS regulatory_controls_domain_idx
  ON govai.regulatory_controls (domain);
CREATE INDEX IF NOT EXISTS regulatory_controls_capability_idx
  ON govai.regulatory_controls (capability_type);
CREATE INDEX IF NOT EXISTS regulatory_controls_impl_state_idx
  ON govai.regulatory_controls (implementation_state);

ALTER TABLE govai.regulatory_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_controls FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- E. govai.regulatory_control_source_links — control-to-source links
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_control_source_links (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL,
  control_id         uuid        NOT NULL REFERENCES govai.regulatory_controls(id),
  source_id          uuid        NOT NULL REFERENCES govai.regulatory_sources(id),
  link_type          text        NOT NULL CHECK (link_type IN (
                       'LEGAL_DRIVER', 'FRAMEWORK_DRIVER', 'SECTOR_DRIVER', 'EVIDENCE_DRIVER', 'REFERENCE_ONLY')),
  requirement_ref    text        NOT NULL DEFAULT '',
  notes              text        NULL,
  created_by_user_id uuid        NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Prevent duplicate equivalent links per tenant.
  UNIQUE (org_id, control_id, source_id, link_type, requirement_ref)
);

CREATE INDEX IF NOT EXISTS regulatory_control_source_links_control_idx
  ON govai.regulatory_control_source_links (control_id);
CREATE INDEX IF NOT EXISTS regulatory_control_source_links_source_idx
  ON govai.regulatory_control_source_links (source_id);
CREATE INDEX IF NOT EXISTS regulatory_control_source_links_org_idx
  ON govai.regulatory_control_source_links (org_id);

ALTER TABLE govai.regulatory_control_source_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_control_source_links FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- F. govai.regulatory_control_framework_mappings — control-to-framework maps
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.regulatory_control_framework_mappings (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL,
  control_id         uuid        NOT NULL REFERENCES govai.regulatory_controls(id),
  framework_key      text        NOT NULL CHECK (framework_key IN (
                       'LGPD', 'ANPD', 'CNJ_615', 'MARCO_CIVIL', 'OAB', 'FINANCIAL_SECTOR_BR',
                       'HEALTH_SECTOR_BR', 'ISO_42001', 'ISO_27001', 'ISO_27701', 'ISO_23894',
                       'NIST_AI_RMF', 'NIST_AI_600_1', 'EU_AI_ACT', 'GDPR', 'PL_2338_READINESS')),
  requirement_ref    text        NOT NULL DEFAULT '',
  requirement_title  text        NULL,
  mapping_status     text        NOT NULL CHECK (mapping_status IN (
                       'COVERED', 'PARTIAL', 'GAP', 'NEEDS_SOURCE_VERIFICATION', 'READINESS_ONLY', 'NOT_APPLICABLE')),
  source_id          uuid        NULL REFERENCES govai.regulatory_sources(id),
  notes              text        NULL,
  metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid        NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Prevent duplicate equivalent framework mappings per tenant.
  UNIQUE (org_id, control_id, framework_key, requirement_ref)
);

CREATE INDEX IF NOT EXISTS regulatory_control_framework_mappings_control_idx
  ON govai.regulatory_control_framework_mappings (control_id);
CREATE INDEX IF NOT EXISTS regulatory_control_framework_mappings_framework_idx
  ON govai.regulatory_control_framework_mappings (framework_key);
CREATE INDEX IF NOT EXISTS regulatory_control_framework_mappings_status_idx
  ON govai.regulatory_control_framework_mappings (mapping_status);
CREATE INDEX IF NOT EXISTS regulatory_control_framework_mappings_org_idx
  ON govai.regulatory_control_framework_mappings (org_id);

ALTER TABLE govai.regulatory_control_framework_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.regulatory_control_framework_mappings FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- RLS policies — per command × role.
--
-- Top-level catalog tables (sources, controls): tenants READ system rows
-- (org_id IS NULL) plus their own; they may only INSERT/UPDATE their own
-- (org_id = app.org_id), never system rows. Child tables are tenant-scoped:
-- READ/INSERT gated on org_id = app.org_id.
-- ===========================================================================

-- regulatory_sources --------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_sources_select_app ON govai.regulatory_sources
    FOR SELECT TO govai_app
    USING (org_id IS NULL OR org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_sources_insert_app ON govai.regulatory_sources
    FOR INSERT TO govai_app
    WITH CHECK (org_id IS NOT NULL AND org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_sources_update_app ON govai.regulatory_sources
    FOR UPDATE TO govai_app
    USING      (org_id IS NOT NULL AND org_id::text = current_setting('app.org_id', true))
    WITH CHECK (org_id IS NOT NULL AND org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_sources_select_writer ON govai.regulatory_sources
    FOR SELECT TO govai_audit_writer
    USING (org_id IS NULL OR org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_source_versions ------------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_source_versions_select_app ON govai.regulatory_source_versions
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_source_versions_insert_app ON govai.regulatory_source_versions
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_source_versions_select_writer ON govai.regulatory_source_versions
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_source_relationships -------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_source_relationships_select_app ON govai.regulatory_source_relationships
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_source_relationships_insert_app ON govai.regulatory_source_relationships
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_source_relationships_select_writer ON govai.regulatory_source_relationships
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_controls -------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_controls_select_app ON govai.regulatory_controls
    FOR SELECT TO govai_app
    USING (org_id IS NULL OR org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_controls_insert_app ON govai.regulatory_controls
    FOR INSERT TO govai_app
    WITH CHECK (org_id IS NOT NULL AND org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_controls_update_app ON govai.regulatory_controls
    FOR UPDATE TO govai_app
    USING      (org_id IS NOT NULL AND org_id::text = current_setting('app.org_id', true))
    WITH CHECK (org_id IS NOT NULL AND org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_controls_select_writer ON govai.regulatory_controls
    FOR SELECT TO govai_audit_writer
    USING (org_id IS NULL OR org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_control_source_links -------------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_control_source_links_select_app ON govai.regulatory_control_source_links
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_control_source_links_insert_app ON govai.regulatory_control_source_links
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_control_source_links_select_writer ON govai.regulatory_control_source_links
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regulatory_control_framework_mappings -------------------------------------
DO $$ BEGIN
  CREATE POLICY regulatory_control_framework_mappings_select_app ON govai.regulatory_control_framework_mappings
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_control_framework_mappings_insert_app ON govai.regulatory_control_framework_mappings
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY regulatory_control_framework_mappings_select_writer ON govai.regulatory_control_framework_mappings
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Grants — top-level catalog tables get SELECT/INSERT/UPDATE (PATCH endpoints);
-- child tables get SELECT/INSERT only (create + list, no update/delete API).
-- ===========================================================================

GRANT SELECT, INSERT, UPDATE ON govai.regulatory_sources                     TO govai_app;
GRANT SELECT, INSERT         ON govai.regulatory_source_versions             TO govai_app;
GRANT SELECT, INSERT         ON govai.regulatory_source_relationships        TO govai_app;
GRANT SELECT, INSERT, UPDATE ON govai.regulatory_controls                    TO govai_app;
GRANT SELECT, INSERT         ON govai.regulatory_control_source_links        TO govai_app;
GRANT SELECT, INSERT         ON govai.regulatory_control_framework_mappings  TO govai_app;

RESET ROLE;
