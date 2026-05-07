-- GovAI Platform — Postgres bootstrap (idempotente)
-- Executa com superuser/DBA. Cria roles e schema base.
-- Migrations da app (0001+) executam separadamente, com role que pode SET ROLE govai_audit_writer.

-- Role: govai_audit_writer (owner do schema, sem LOGIN, sem BYPASSRLS)
DO $$
BEGIN
  CREATE ROLE govai_audit_writer NOINHERIT;
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'role govai_audit_writer already exists, skipping';
END
$$;

-- Role: govai_app (role de aplicação, LOGIN, sem BYPASSRLS, sem SUPERUSER).
-- A senha NÃO é hardcoded. O caller deve definir o GUC `govai.app_password` via
-- `SET govai.app_password = '<segredo>'` na MESMA sessão antes de rodar este script.
-- Testcontainers gera uma senha aleatória por container; production injeta via
-- env var (ver docs/runbooks/db-roles-production.md).
DO $$
DECLARE
  v_password text := current_setting('govai.app_password', true);
BEGIN
  IF v_password IS NULL OR length(v_password) < 8 THEN
    RAISE EXCEPTION 'bootstrap.sql requires `SET govai.app_password = ''<>''` (>= 8 chars) in the same session before execution. See docs/runbooks/db-roles-production.md.';
  END IF;

  BEGIN
    EXECUTE format('CREATE ROLE govai_app NOINHERIT LOGIN PASSWORD %L', v_password);
  EXCEPTION
    WHEN duplicate_object THEN
      -- Role exists already — re-apply the password supplied for THIS session
      -- so dev/test re-runs converge. Production should run bootstrap exactly once.
      EXECUTE format('ALTER ROLE govai_app WITH LOGIN PASSWORD %L', v_password);
      RAISE NOTICE 'role govai_app already exists; password re-applied from session GUC';
  END;
END
$$;

-- Schema com owner explícito
CREATE SCHEMA IF NOT EXISTS govai AUTHORIZATION govai_audit_writer;

GRANT USAGE ON SCHEMA govai TO govai_app;

-- Migrator role recipe (executor das migrations da app):
-- O usuário que rodar as migrations 0001+ precisa poder fazer SET ROLE govai_audit_writer.
-- Em Testcontainers/dev: o superuser conecta e roda este script + as migrations diretamente.
-- Para que migrations possam SET ROLE, garantir que o role ativo recebeu govai_audit_writer:
DO $$
DECLARE
  current_user_name text := current_user;
BEGIN
  IF current_user_name <> 'govai_audit_writer' THEN
    EXECUTE format('GRANT govai_audit_writer TO %I', current_user_name);
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'grant govai_audit_writer to current_user skipped: %', SQLERRM;
END
$$;

-- Garantir que govai_app exista mesmo se este script rodar sob superuser que não é dono
-- (não há ALTER DEFAULT PRIVILEGES aqui — privilégios concretos vêm em 0001+).
