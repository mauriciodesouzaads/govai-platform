-- Migration 0004 — DLP custom detectors per org

SET ROLE govai_audit_writer;

CREATE TABLE IF NOT EXISTS govai.dlp_detectors_custom (
  id              uuid        PRIMARY KEY,
  org_id          uuid        NOT NULL,
  name            text        NOT NULL,
  version         integer     NOT NULL DEFAULT 1,
  pattern_re2     text        NOT NULL,
  action          text        NOT NULL CHECK (action IN ('detect','redact','deny')),
  input_max_chars integer     NOT NULL DEFAULT 50000 CHECK (input_max_chars BETWEEN 1 AND 200000),
  status          text        NOT NULL CHECK (status IN ('active','disabled')),
  created_by      uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name, version)
);

CREATE TABLE IF NOT EXISTS govai.dlp_findings (
  id              uuid        PRIMARY KEY,
  run_id          uuid        NOT NULL REFERENCES govai.runs(id),
  org_id          uuid        NOT NULL,
  detector_id     text        NOT NULL,
  detector_kind   text        NOT NULL CHECK (detector_kind IN ('baseline','custom')),
  count           integer     NOT NULL,
  action          text        NOT NULL CHECK (action IN ('detect','redact','deny')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE govai.dlp_detectors_custom ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.dlp_detectors_custom FORCE  ROW LEVEL SECURITY;
ALTER TABLE govai.dlp_findings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.dlp_findings         FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY dlp_dc_select_app ON govai.dlp_detectors_custom FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY dlp_dc_insert_app ON govai.dlp_detectors_custom FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY dlp_dc_update_app ON govai.dlp_detectors_custom FOR UPDATE TO govai_app
    USING (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY dlp_dc_select_writer ON govai.dlp_detectors_custom FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY dlp_f_select_app ON govai.dlp_findings FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY dlp_f_insert_app ON govai.dlp_findings FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY dlp_f_select_writer ON govai.dlp_findings FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON govai.dlp_detectors_custom TO govai_app;
GRANT SELECT, INSERT          ON govai.dlp_findings         TO govai_app;

RESET ROLE;
