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

-- Five-way lifecycle state machine (EP-EVIDENCE-GAUGE-WIRING CREDENTIAL-LIFECYCLE-RUNNER).
-- Two INDEPENDENT signals drive the LOGIN state: the password GUC
-- `govai.evidence_enumerator_password` and an EXPLICIT deprovision GUC
-- `govai.evidence_enumerator_deprovision` (sole accepted value '1'). There is NO magic
-- password sentinel — an ABSENT password no longer means "deprovision" (that footgun let a
-- routine schema migration silently drop the gauges by omission). The five cells:
--   1. password present (>= 8), no deprovision  → LOGIN PASSWORD  (provision / rotate)
--   2. password present AND deprovision = '1'    → RAISE           (conflicting intent)
--   3. no password, no deprovision               → LEAVE UNTOUCHED (routine migration)
--   4. no password, deprovision = '1'            → NOLOGIN PASSWORD NULL (declarative disable)
--   5. deprovision set to anything but '1'        → RAISE           (invalid signal)
-- The migration runner enforces cells 2 and 5 (fail-loud) BEFORE it calls this file, and runs
-- the post-commit session sweep for cell 4. This block is the SAME machine, enforced in-DB, so
-- a direct bootstrap run (bypassing the runner) is equally safe. ★ NO pg_terminate_backend
-- here: the whole file runs as ONE implicit transaction, so pre-commit it is inert for the
-- reconnect race (nothing here is visible to another session until the file COMMITS). The
-- session sweep therefore lives in the runner, AFTER c.query(bootstrap) returns (the commit).
DO $$
DECLARE
  v_password text := current_setting('govai.evidence_enumerator_password', true);
  v_deprovision text := current_setting('govai.evidence_enumerator_deprovision', true);
  v_has_password boolean := v_password IS NOT NULL AND v_password <> '';
  v_deprovision_set boolean := v_deprovision IS NOT NULL AND v_deprovision <> '';
BEGIN
  IF v_deprovision_set AND v_deprovision <> '1' THEN
    -- Cell 5: an explicit deprovision signal must be exactly '1'.
    RAISE EXCEPTION 'govai.evidence_enumerator_deprovision must be unset, empty, or ''1'' (got ''%'').', v_deprovision;
  ELSIF v_has_password AND v_deprovision_set THEN
    -- Cell 2: provision and deprovision are mutually exclusive.
    RAISE EXCEPTION 'conflicting enumerator lifecycle intent: a password AND deprovision=1 are both set; provide exactly one.';
  ELSIF v_deprovision_set THEN
    -- Cell 4: declarative disable (NOLOGIN + clear the verifier). NOLOGIN blocks ALL new
    -- authentication once this file commits; the runner reaps live sessions post-commit.
    ALTER ROLE govai_evidence_enumerator WITH NOLOGIN PASSWORD NULL;
    RAISE NOTICE 'govai_evidence_enumerator deprovisioned (NOLOGIN, password cleared); the migration runner sweeps live sessions post-commit.';
  ELSIF v_has_password THEN
    -- Cell 1: provision / rotate. LOGIN and PASSWORD granted atomically; length < 8 fails loud.
    IF length(v_password) < 8 THEN
      RAISE EXCEPTION 'govai.evidence_enumerator_password must be >= 8 chars when set.';
    END IF;
    EXECUTE format('ALTER ROLE govai_evidence_enumerator WITH LOGIN PASSWORD %L', v_password);
  ELSE
    -- Cell 3: no signal ⇒ leave the role exactly as-is (a routine migration must not drop it).
    RAISE NOTICE 'govai_evidence_enumerator unchanged (no password or deprovision signal).';
  END IF;
END
$$;

-- Role: govai_conversation_worker (EP-AI-CONVERSATION-CONTINUITY-V1-01, movement P0-A2).
-- The DETACHED CONVERSATION WORKER identity — a trust domain DISTINCT from the ordinary
-- request role (LAW 11: REQUEST IDENTITY != WORKER IDENTITY). Its entire P0-A2 capability is
-- {USAGE on schema govai (here), EXECUTE on govai.ai_turn_recovery_candidates, owner-scoped
-- SELECT on three ai_* tables (migration 0032)}. It is NOINHERIT, never superuser, never
-- BYPASSRLS, owns nothing, and is NEVER granted to govai_app — so an ordinary API database
-- session can neither invoke recovery discovery nor SET ROLE its way into the worker.
-- ★ Same deliberate asymmetry as govai_evidence_enumerator: govai_app is MANDATORY and fails
-- loudly without its password; the worker is created NOLOGIN and stays unreachable until it is
-- EXPLICITLY provisioned. LOGIN and PASSWORD are granted TOGETHER, atomically, only when the GUC
-- `govai.conversation_worker_password` is present — there is NO password-less LOGIN state at any
-- point, and the GUC's absence never breaks a routine `migrate` run.
DO $$
BEGIN
  CREATE ROLE govai_conversation_worker NOINHERIT NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'role govai_conversation_worker already exists, skipping';
END
$$;

GRANT USAGE ON SCHEMA govai TO govai_conversation_worker;

-- Five-way lifecycle state machine, IDENTICAL in shape to the evidence enumerator's (the INV-1
-- lesson): two INDEPENDENT signals drive the LOGIN state — the password GUC
-- `govai.conversation_worker_password` and an EXPLICIT deprovision GUC
-- `govai.conversation_worker_deprovision` (sole accepted value '1'). There is NO magic password
-- sentinel: an ABSENT password never means "deprovision" (that footgun would let a routine schema
-- migration silently disable conversation recovery by omission). The five cells:
--   1. password present (>= 8), no deprovision  -> LOGIN PASSWORD  (provision / rotate)
--   2. password present AND deprovision = '1'    -> RAISE           (conflicting intent)
--   3. no password, no deprovision               -> LEAVE UNTOUCHED (routine migration)
--   4. no password, deprovision = '1'            -> NOLOGIN PASSWORD NULL (declarative disable)
--   5. deprovision set to anything but '1'        -> RAISE           (invalid signal)
-- The migration runner enforces cells 2 and 5 (fail-loud) BEFORE it calls this file, and runs the
-- post-commit session sweep for cell 4. This block is the SAME machine enforced in-DB, so a direct
-- bootstrap run (bypassing the runner) is equally safe. ★ NO pg_terminate_backend here: the whole
-- file runs as ONE implicit transaction, so pre-commit it is inert for the reconnect race.
DO $$
DECLARE
  v_password text := current_setting('govai.conversation_worker_password', true);
  v_deprovision text := current_setting('govai.conversation_worker_deprovision', true);
  v_has_password boolean := v_password IS NOT NULL AND v_password <> '';
  v_deprovision_set boolean := v_deprovision IS NOT NULL AND v_deprovision <> '';
BEGIN
  IF v_deprovision_set AND v_deprovision <> '1' THEN
    -- Cell 5: an explicit deprovision signal must be exactly '1'.
    RAISE EXCEPTION 'govai.conversation_worker_deprovision must be unset, empty, or ''1'' (got ''%'').', v_deprovision;
  ELSIF v_has_password AND v_deprovision_set THEN
    -- Cell 2: provision and deprovision are mutually exclusive.
    RAISE EXCEPTION 'conflicting conversation-worker lifecycle intent: a password AND deprovision=1 are both set; provide exactly one.';
  ELSIF v_deprovision_set THEN
    -- Cell 4: declarative disable (NOLOGIN + clear the verifier). NOLOGIN blocks ALL new
    -- authentication once this file commits; the runner reaps live sessions post-commit.
    ALTER ROLE govai_conversation_worker WITH NOLOGIN PASSWORD NULL;
    RAISE NOTICE 'govai_conversation_worker deprovisioned (NOLOGIN, password cleared); the migration runner sweeps live sessions post-commit.';
  ELSIF v_has_password THEN
    -- Cell 1: provision / rotate. LOGIN and PASSWORD granted atomically; length < 8 fails loud.
    IF length(v_password) < 8 THEN
      RAISE EXCEPTION 'govai.conversation_worker_password must be >= 8 chars when set.';
    END IF;
    EXECUTE format('ALTER ROLE govai_conversation_worker WITH LOGIN PASSWORD %L', v_password);
  ELSE
    -- Cell 3: no signal => leave the role exactly as-is (a routine migration must not disable it).
    RAISE NOTICE 'govai_conversation_worker unchanged (no password or deprovision signal).';
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
