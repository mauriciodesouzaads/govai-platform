-- Migration 0005 — runtime-patch-1 support
-- api_keys: lookup by indexed prefix, full match by argon2id verify in app layer.
-- dlp_baseline_config: per-org action override for baseline detectors (cpf/cnpj/email/phone_br).
-- orgs: minimal table for joins (no full Org schema yet).

SET ROLE govai_audit_writer;

CREATE TABLE IF NOT EXISTS govai.orgs (
  id          uuid        PRIMARY KEY,
  name        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS govai.api_keys (
  prefix      text        PRIMARY KEY,
  hash        text        NOT NULL,
  org_id      uuid        NOT NULL,
  user_id     uuid        NOT NULL,
  status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS api_keys_org_idx ON govai.api_keys (org_id);

CREATE TABLE IF NOT EXISTS govai.dlp_baseline_config (
  org_id   uuid NOT NULL,
  detector text NOT NULL CHECK (detector IN ('cpf','cnpj','email','phone_br')),
  action   text NOT NULL CHECK (action IN ('detect','redact','deny')),
  PRIMARY KEY (org_id, detector)
);

ALTER TABLE govai.orgs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.orgs                 FORCE  ROW LEVEL SECURITY;
ALTER TABLE govai.api_keys             ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.api_keys             FORCE  ROW LEVEL SECURITY;
ALTER TABLE govai.dlp_baseline_config  ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.dlp_baseline_config  FORCE  ROW LEVEL SECURITY;

-- orgs: app SELECT only its own; writer SELECT all (for cross-org admin tasks not in scope here).
DO $$ BEGIN
  CREATE POLICY orgs_select_app ON govai.orgs FOR SELECT TO govai_app
    USING (id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY orgs_select_writer ON govai.orgs FOR SELECT TO govai_audit_writer
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY orgs_insert_writer ON govai.orgs FOR INSERT TO govai_audit_writer
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- api_keys lookup by prefix happens BEFORE tenant context is known. Two-step:
--  1) writer (definer-call from app boot) reads by prefix; returns org_id + hash.
--  2) app sets tenant context, then RLS-bound queries.
-- We expose a SECURITY DEFINER lookup function instead of broad SELECT.

CREATE OR REPLACE FUNCTION govai.api_key_lookup(p_prefix text)
RETURNS TABLE(prefix text, hash text, org_id uuid, user_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT k.prefix, k.hash, k.org_id, k.user_id, k.status
      FROM govai.api_keys k
     WHERE k.prefix = p_prefix
       AND k.status = 'active'
     LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION govai.api_key_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION govai.api_key_lookup(text) TO govai_app;

DO $$ BEGIN
  CREATE POLICY api_keys_select_writer ON govai.api_keys FOR SELECT TO govai_audit_writer
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY api_keys_insert_writer ON govai.api_keys FOR INSERT TO govai_audit_writer
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- last_used_at update path: app can update its own org's keys.
DO $$ BEGIN
  CREATE POLICY api_keys_select_app ON govai.api_keys FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY api_keys_update_app ON govai.api_keys FOR UPDATE TO govai_app
    USING       (org_id::text = current_setting('app.org_id', true))
    WITH CHECK  (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- dlp_baseline_config: per-tenant CRUD by app.
DO $$ BEGIN
  CREATE POLICY dbc_select_app ON govai.dlp_baseline_config FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY dbc_insert_app ON govai.dlp_baseline_config FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY dbc_update_app ON govai.dlp_baseline_config FOR UPDATE TO govai_app
    USING       (org_id::text = current_setting('app.org_id', true))
    WITH CHECK  (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY dbc_select_writer ON govai.dlp_baseline_config FOR SELECT TO govai_audit_writer
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY dbc_insert_writer ON govai.dlp_baseline_config FOR INSERT TO govai_audit_writer
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, UPDATE                   ON govai.api_keys             TO govai_app;
GRANT SELECT, INSERT, UPDATE, DELETE   ON govai.dlp_baseline_config  TO govai_app;
GRANT SELECT                           ON govai.orgs                 TO govai_app;

RESET ROLE;
