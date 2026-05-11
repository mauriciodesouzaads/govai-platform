-- Migration 0009 — provider_credentials (PR3.1a, issue #13).
-- Tenant-scoped provider credentials with envelope-encrypted ciphertext.
-- The plaintext key NEVER hits any DB column: only ciphertext + dek_wrapped
-- + safe metadata (key_prefix + key_last4) are stored.
--
-- Roles: aligned with migration 0007. The app layer (`govai_app`) handles both
-- runtime SELECT (resolver path) and admin INSERT/UPDATE (CLI bridge in PR3.1a,
-- HTTP admin endpoint in PR3.1b). Dedicated `govai_admin` role is intentionally
-- deferred — the admin path uses the same role with RBAC checks at app layer.
--
-- DESIGN LOCK: ONE active credential per (org_id, provider). Workspace and
-- environment scoping are deliberately out of scope for PR3.1a. The unique
-- partial index `provider_credentials_active_unique` is the enforcement
-- primitive — do NOT relax it without an ADR. Multi-version rotation, expiry,
-- canary/blue-green, and per-credential budget binding are PR3.x territory.
--
-- No DELETE: revocation is via UPDATE setting status='revoked'. Trigger
-- enforces the no-DELETE / no-TRUNCATE invariant defense-in-depth, mirroring
-- the org_beta_overrides pattern.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

CREATE TABLE IF NOT EXISTS govai.provider_credentials (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL,
  provider             text        NOT NULL CHECK (provider IN ('anthropic', 'openai')),

  -- Envelope-encrypted plaintext (AES-256-GCM via KMS). Plaintext is never
  -- stored. ciphertext = IV || GCM_TAG || ENC(plaintext); dek_wrapped =
  -- IV || GCM_TAG || ENC(DEK with KEK derived per (orgId, keyId, version)).
  ciphertext           bytea       NOT NULL,
  dek_wrapped          bytea       NOT NULL,

  -- KMS key binding metadata (allows future rotation; locked to v1 in PR3.1a).
  kms_key_id           text        NOT NULL DEFAULT 'tenant-provider-credential-v1',
  kms_key_version      integer     NOT NULL DEFAULT 1,

  -- Safe operator-visible metadata only. NEVER any portion that could be
  -- combined to recover the plaintext (no full key, no key middle, no entropy).
  -- key_prefix is intended to be the provider's public prefix ('sk-ant-' or
  -- 'sk-') and key_last4 is the last 4 chars for human disambiguation.
  key_prefix           text        NOT NULL,
  key_last4            text        NOT NULL,

  status               text        NOT NULL DEFAULT 'active'
                                     CHECK (status IN ('active', 'revoked')),
  set_by_user_id       uuid        NOT NULL,
  set_at               timestamptz NOT NULL DEFAULT now(),
  revoked_at           timestamptz NULL,
  revoked_by_user_id   uuid        NULL,
  revocation_reason    text        NULL,

  CHECK (
    (status = 'active'  AND revoked_at IS NULL AND revoked_by_user_id IS NULL)
    OR
    (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
  )
);

-- Partial unique index — ONE active credential per (org_id, provider). Revoked
-- rows accumulate as historical record. Replace-active is a transactional
-- revoke-then-insert in the helper. DO NOT relax without an ADR.
CREATE UNIQUE INDEX IF NOT EXISTS provider_credentials_active_unique
  ON govai.provider_credentials (org_id, provider)
  WHERE status = 'active';

-- RLS habilitada + FORCE.
ALTER TABLE govai.provider_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.provider_credentials FORCE  ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY provider_credentials_select_app ON govai.provider_credentials
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY provider_credentials_insert_app ON govai.provider_credentials
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UPDATE só permitido para revogar (status muda de 'active' para 'revoked').
-- WITH CHECK garante que o resultado da linha tem status='revoked' AND
-- revoked_at IS NOT NULL — qualquer outro UPDATE é rejeitado pelo DB.
DO $$ BEGIN
  CREATE POLICY provider_credentials_update_revoke_app ON govai.provider_credentials
    FOR UPDATE TO govai_app
    USING       (org_id::text = current_setting('app.org_id', true))
    WITH CHECK  (
      org_id::text = current_setting('app.org_id', true)
      AND status = 'revoked'
      AND revoked_at IS NOT NULL
      AND revoked_by_user_id IS NOT NULL
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auditor role: SELECT only. Cannot mutate credentials.
DO $$ BEGIN
  CREATE POLICY provider_credentials_select_writer ON govai.provider_credentials
    FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sem DELETE policy → DELETE direto via app role: 0 rows affected (RLS).
-- Defesa adicional: trigger contra DELETE em qualquer caminho.
CREATE OR REPLACE FUNCTION govai.provider_credentials_no_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'provider_credentials: delete blocked (revoke via UPDATE status=revoked)'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS provider_credentials_no_delete_trg ON govai.provider_credentials;
CREATE TRIGGER provider_credentials_no_delete_trg
  BEFORE DELETE ON govai.provider_credentials
  FOR EACH ROW EXECUTE FUNCTION govai.provider_credentials_no_delete();

CREATE OR REPLACE FUNCTION govai.provider_credentials_no_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'provider_credentials: TRUNCATE blocked'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS provider_credentials_no_truncate_trg ON govai.provider_credentials;
CREATE TRIGGER provider_credentials_no_truncate_trg
  BEFORE TRUNCATE ON govai.provider_credentials
  FOR EACH STATEMENT EXECUTE FUNCTION govai.provider_credentials_no_truncate();

GRANT SELECT, INSERT, UPDATE ON govai.provider_credentials TO govai_app;

RESET ROLE;
