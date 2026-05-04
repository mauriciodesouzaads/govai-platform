-- Migration 0002 — runs e provider_invocations e policy_decisions

SET ROLE govai_audit_writer;

CREATE TABLE IF NOT EXISTS govai.runs (
  id             uuid        PRIMARY KEY,
  org_id         uuid        NOT NULL,
  workspace_id   uuid        NOT NULL,
  actor_user_id  uuid        NOT NULL,
  assistant_id   uuid        NULL,
  provider       text        NOT NULL,
  model          text        NOT NULL,
  mode           text        NOT NULL CHECK (mode IN ('governed','passthrough','shadow')),
  status         text        NOT NULL CHECK (status IN ('queued','running','completed','failed','denied','awaiting_approval')),
  risk_level     text        NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz NULL,
  completed_at   timestamptz NULL,
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS runs_org_created_idx
  ON govai.runs (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS govai.provider_invocations (
  id                       uuid        PRIMARY KEY,
  run_id                   uuid        NOT NULL REFERENCES govai.runs(id),
  org_id                   uuid        NOT NULL,
  provider                 text        NOT NULL,
  native_endpoint          text        NOT NULL,
  native_method            text        NOT NULL,
  native_request_hash      bytea       NOT NULL,
  native_response_hash     bytea       NULL,
  streaming                boolean     NOT NULL DEFAULT false,
  usage_json               jsonb       NOT NULL,
  latency_ms               integer     NULL,
  status_code              integer     NULL,
  provider_request_id      text        NULL,
  error_class              text        NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS govai.policy_decisions (
  id                  uuid        PRIMARY KEY,
  run_id              uuid        NOT NULL REFERENCES govai.runs(id),
  org_id              uuid        NOT NULL,
  step_id             uuid        NULL,
  decision            text        NOT NULL CHECK (decision IN ('allow','deny','mutate','ask')),
  policy_version_id   bytea       NOT NULL,
  reasons             jsonb       NOT NULL,
  mutations           jsonb       NULL,
  framework_refs      jsonb       NULL,
  evaluated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE govai.runs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.runs                  FORCE  ROW LEVEL SECURITY;
ALTER TABLE govai.provider_invocations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.provider_invocations  FORCE  ROW LEVEL SECURITY;
ALTER TABLE govai.policy_decisions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.policy_decisions      FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY runs_select_app ON govai.runs FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY runs_insert_app ON govai.runs FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY runs_update_app ON govai.runs FOR UPDATE TO govai_app
    USING (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY runs_select_writer ON govai.runs FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY pi_select_app ON govai.provider_invocations FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY pi_insert_app ON govai.provider_invocations FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY pi_select_writer ON govai.provider_invocations FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY pd_select_app ON govai.policy_decisions FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY pd_insert_app ON govai.policy_decisions FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY pd_select_writer ON govai.policy_decisions FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON govai.runs                 TO govai_app;
GRANT SELECT, INSERT          ON govai.provider_invocations TO govai_app;
GRANT SELECT, INSERT          ON govai.policy_decisions     TO govai_app;

RESET ROLE;
