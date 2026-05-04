-- Migration 0003 — capability overrides per org. Capability é code-defined.

SET ROLE govai_audit_writer;

CREATE TABLE IF NOT EXISTS govai.capability_overrides (
  org_id          uuid        NOT NULL,
  capability_id   text        NOT NULL,
  facet_id        text        NOT NULL,
  level_override  integer     NULL CHECK (level_override BETWEEN 0 AND 3),
  status_override text        NULL CHECK (status_override IN ('blocked','experimental')),
  reason          text        NOT NULL,
  set_by_user_id  uuid        NOT NULL,
  set_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, capability_id, facet_id)
);

ALTER TABLE govai.capability_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.capability_overrides FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY co_select_app ON govai.capability_overrides FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY co_insert_app ON govai.capability_overrides FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY co_update_app ON govai.capability_overrides FOR UPDATE TO govai_app
    USING (org_id::text = current_setting('app.org_id', true))
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY co_select_writer ON govai.capability_overrides FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sem DELETE: overrides são auditáveis; remoção é via downgrade explícito.
GRANT SELECT, INSERT, UPDATE ON govai.capability_overrides TO govai_app;

RESET ROLE;
