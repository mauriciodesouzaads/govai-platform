-- Migration 0010 — govai.api_keys.roles (PR3.1b, issue #22).
--
-- Minimal RBAC foundation per API key. Adds a `roles text[]` column to
-- govai.api_keys with an array-element CHECK constraint locking values to the
-- canonical Role enum from `@govai/core-identity`. The existing
-- api_key_lookup SECURITY DEFINER function is extended to return roles so the
-- application's authenticateApiKey can populate AuthIdentity.roles in one
-- roundtrip (no extra query).
--
-- DESIGN SCOPE LOCK: this is per-API-key RBAC, NOT per-user-org-admin. A
-- proper org_admins relationship table (with explicit grant/revoke audit and
-- multi-user-per-org admin model) is PR3.x territory. The roles column on
-- api_keys is sufficient for PR3.1b's admin endpoints because today each
-- tenant has exactly one operator API key. Do NOT promote this column to a
-- multi-user admin substitute without an ADR.
--
-- Backfill: every existing api_keys row keeps `roles='{}'` after this
-- migration, so no key is silently elevated to admin. Admin grants are
-- explicit, made via the migration runner / seed scripts / future admin path.

SET ROLE govai_audit_writer;

ALTER TABLE govai.api_keys
  ADD COLUMN IF NOT EXISTS roles text[] NOT NULL DEFAULT '{}'::text[];

-- Lock each element of `roles` to the canonical Role enum. Postgres has no
-- direct "array of enum-values" CHECK; we constrain via the @> (contained in)
-- operator: every element of `roles` must be in the allowlist array.
-- Adding/removing roles in the future means updating the enum here AND in
-- packages/core-identity/src/rbac.ts.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'api_keys_roles_allowlist_chk'
       AND conrelid = 'govai.api_keys'::regclass
  ) THEN
    ALTER TABLE govai.api_keys
      ADD CONSTRAINT api_keys_roles_allowlist_chk
      CHECK (
        roles <@ ARRAY[
          'admin',
          'data_protection_officer',
          'dlp_admin',
          'developer',
          'auditor'
        ]::text[]
      );
  END IF;
END $$;

-- Introduce api_key_lookup_v2 — same SECURITY DEFINER + safe search_path
-- pattern as the prior api_key_lookup (migration 0005), but with `roles text[]`
-- in the return type. We use a NEW function name (not CREATE OR REPLACE on
-- the existing one) because PostgreSQL refuses CREATE OR REPLACE when the
-- return type changes, which would break bootstrap idempotency: the
-- migration runner re-runs every .sql file from scratch on every invocation,
-- and 0005's CREATE OR REPLACE of api_key_lookup would conflict with 0010's
-- new return type on the second run. Keeping a fresh function name means
-- both migrations are independently idempotent without modifying 0005.
--
-- The prior api_key_lookup function stays in place and unused. authenticate
-- API key now calls api_key_lookup_v2 exclusively.
CREATE OR REPLACE FUNCTION govai.api_key_lookup_v2(p_prefix text)
RETURNS TABLE(prefix text, hash text, org_id uuid, user_id uuid, status text, roles text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT k.prefix, k.hash, k.org_id, k.user_id, k.status, k.roles
      FROM govai.api_keys k
     WHERE k.prefix = p_prefix
       AND k.status = 'active'
     LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION govai.api_key_lookup_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION govai.api_key_lookup_v2(text) TO govai_app;

RESET ROLE;
