-- Migration 0007 — org_beta_overrides (Matrix v2 §5.1, Batch F).
-- Tabela única de overrides per-org por (provider, beta_token).
-- Sem DELETE: revogação via UPDATE de revoked_at.
-- pgcrypto é usado APENAS para gen_random_uuid() em DEFAULT da PK; o id NÃO entra
-- em canonical de audit chain (audit chain segue gerando UUIDs em TS via randomUUID()).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- O Matrix §5.1 referencia roles `govai_runtime` (SELECT) e `govai_admin` (INSERT/UPDATE).
-- O baseline atual usa `govai_app` (runtime + admin via session). Roles dedicados
-- entram em PR3 (custom DLP CRUD + crypto-shred end-to-end). Em PR2 mapeamos:
--   govai_runtime  → govai_app  (path SELECT em runtime)
--   govai_admin    → govai_app  (path INSERT/UPDATE com checagem RBAC em app layer)
-- Ver ADR-PR2-NN se promovermos roles dedicados antes de PR3.

CREATE TABLE IF NOT EXISTS govai.org_beta_overrides (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL,
  provider        text        NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  beta_token      text        NOT NULL,
  reason          text        NOT NULL,
  set_by_user_id  uuid        NOT NULL,
  set_at          timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz NULL,
  CHECK (expires_at > set_at)
);

-- Índice único parcial (apenas overrides ativos: não revogados).
CREATE UNIQUE INDEX IF NOT EXISTS org_beta_overrides_active_unique
  ON govai.org_beta_overrides (org_id, provider, beta_token)
  WHERE revoked_at IS NULL;

-- RLS habilitada + FORCE.
ALTER TABLE govai.org_beta_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.org_beta_overrides FORCE  ROW LEVEL SECURITY;

-- Policies por comando × role.
DO $$ BEGIN
  CREATE POLICY org_beta_overrides_select_app ON govai.org_beta_overrides
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY org_beta_overrides_insert_app ON govai.org_beta_overrides
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UPDATE só permitido para revogar (define revoked_at). Não permite mudar campos
-- imutáveis. WITH CHECK garante que update sem setar revoked_at é rejeitado.
DO $$ BEGIN
  CREATE POLICY org_beta_overrides_update_revoke_app ON govai.org_beta_overrides
    FOR UPDATE TO govai_app
    USING       (org_id::text = current_setting('app.org_id', true))
    WITH CHECK  (
      org_id::text = current_setting('app.org_id', true)
      AND revoked_at IS NOT NULL
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Writer (audit_writer) precisa SELECT também sob FORCE RLS para tasks de auditoria.
DO $$ BEGIN
  CREATE POLICY org_beta_overrides_select_writer ON govai.org_beta_overrides
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sem DELETE policy → DELETE direto via app role: 0 rows affected (RLS).
-- Defesa adicional: trigger contra DELETE em qualquer caminho.
CREATE OR REPLACE FUNCTION govai.org_beta_overrides_no_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'org_beta_overrides: delete blocked (revoke via UPDATE revoked_at)'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS org_beta_overrides_no_delete_trg ON govai.org_beta_overrides;
CREATE TRIGGER org_beta_overrides_no_delete_trg
  BEFORE DELETE ON govai.org_beta_overrides
  FOR EACH ROW EXECUTE FUNCTION govai.org_beta_overrides_no_delete();

-- Sem TRUNCATE policy.
CREATE OR REPLACE FUNCTION govai.org_beta_overrides_no_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'org_beta_overrides: TRUNCATE blocked'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS org_beta_overrides_no_truncate_trg ON govai.org_beta_overrides;
CREATE TRIGGER org_beta_overrides_no_truncate_trg
  BEFORE TRUNCATE ON govai.org_beta_overrides
  FOR EACH STATEMENT EXECUTE FUNCTION govai.org_beta_overrides_no_truncate();

GRANT SELECT, INSERT, UPDATE ON govai.org_beta_overrides TO govai_app;

RESET ROLE;
