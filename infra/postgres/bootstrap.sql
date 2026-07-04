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

-- Role: govai_audit_sealer (B0 — Audit Capture Outbox foundation).
-- NOLOGIN. Acts via SET LOCAL ROLE only inside trusted callers (the future
-- AuditSealer worker). Receives EXECUTE on SECURITY DEFINER claim/seal/fail
-- functions in migration 0025; no direct UPDATE/INSERT on outbox tables.
-- Per SPEC v2.1 §5.1, the sealer role lives in bootstrap (admin-owned),
-- not in an application migration, so the migration runner does not need
-- CREATEROLE.
DO $$
BEGIN
  CREATE ROLE govai_audit_sealer NOINHERIT NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'role govai_audit_sealer already exists, skipping';
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

-- Role: govai_evidence_enumerator (EP-EVIDENCE-GAUGE-WIRING).
-- Least-privilege enumerate-only identity for the evidence gauge source: its ENTIRE
-- capability is SELECT on govai.orgs (granted in migration 0028). It can read no
-- evidence, execute no function, and write nothing (INV-1: no single database
-- identity holds both "enumerate all orgs" and "read evidence").
-- ★ Deliberate asymmetry vs govai_app: govai_app is MANDATORY and FAILS loudly
-- without its password; the enumerator is an OPTIONAL feature, so it is created
-- NOLOGIN and stays unreachable until explicitly provisioned. LOGIN and PASSWORD are
-- granted TOGETHER, atomically, only when the GUC `govai.evidence_enumerator_password`
-- is present — there is NO password-less LOGIN state at any point (so an unprovisioned
-- role is unreachable under every pg_hba auth mode), and the GUC's absence never breaks
-- an existing `migrate` run.
DO $$
BEGIN
  CREATE ROLE govai_evidence_enumerator NOINHERIT NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'role govai_evidence_enumerator already exists, skipping';
END
$$;

GRANT USAGE ON SCHEMA govai TO govai_evidence_enumerator;

-- Conditional provisioning: the GUC is the SINGLE SOURCE OF TRUTH for the LOGIN state on
-- EVERY run (FIXUP4). Absent/empty ⇒ DEPROVISION (NOLOGIN + clear the stored password
-- verifier, declaratively and idempotent — removing the GUC both disables AND rotates);
-- present + valid (>= 8) ⇒ LOGIN with that password; present + invalid (< 8) ⇒ fail loud.
DO $$
DECLARE
  v_password text := current_setting('govai.evidence_enumerator_password', true);
BEGIN
  IF v_password IS NULL OR v_password = '' THEN
    -- Terminate any live enumerator sessions so deprovision is immediate + total: NOLOGIN
    -- only blocks NEW connections; pg_terminate_backend closes existing ones. Idempotent
    -- (no rows when none are connected). Runs as the migration superuser (may signal backends).
    PERFORM pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE usename = 'govai_evidence_enumerator' AND pid <> pg_backend_pid();
    ALTER ROLE govai_evidence_enumerator WITH NOLOGIN PASSWORD NULL;
    RAISE NOTICE 'govai_evidence_enumerator deprovisioned (NOLOGIN, password cleared, live sessions terminated); set govai.evidence_enumerator_password to (re)provision.';
  ELSIF length(v_password) < 8 THEN
    RAISE EXCEPTION 'govai.evidence_enumerator_password must be >= 8 chars when set.';
  ELSE
    EXECUTE format('ALTER ROLE govai_evidence_enumerator WITH LOGIN PASSWORD %L', v_password);
  END IF;
END
$$;

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
