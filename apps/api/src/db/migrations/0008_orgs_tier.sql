-- Migration 0008 — orgs.tier + orgs.operational_mode (HAE-004 / Batch G realignment).
--
-- Tier resolution primitive. Without these columns every governance value
-- emitted in passthrough.invoked v3 was hardcoded `tier='enterprise'` —
-- a simulation. With the columns populated, authenticateApiKey returns the
-- real tier and operational_mode and downstream computeEnforcement / DLP
-- decisions become real, not fake.
--
-- Defaults: tier='starter' (least-privileged tier — explicit upgrade required);
--           operational_mode='production' (canonical default per prior PR2
--           instruction: "Sem default SQL operational_mode='pilot'. Default DB
--           deve ser production. Starter pilot vem explicitamente do
--           onboarding/seed."). Onboarding flow + test fixtures set 'pilot' /
--           'test' / 'dev' explicitly when they need relaxed enforcement.
-- Org admin must explicitly upgrade tier to business/enterprise/regulated via
-- PR3 admin surface; operational_mode mutations are gated by the same admin
-- path (writer role + explicit consent).

SET ROLE govai_audit_writer;

ALTER TABLE govai.orgs
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'starter'
    CHECK (tier IN ('starter','business','enterprise','regulated'));

ALTER TABLE govai.orgs
  ADD COLUMN IF NOT EXISTS operational_mode text NOT NULL DEFAULT 'production'
    CHECK (operational_mode IN ('production','pilot','dev','test'));

-- govai_app already has SELECT on the table (migration 0005 + RLS policy
-- `orgs_select_app`). The new columns are covered by the existing table-level
-- grant; no column-level GRANT needed. RLS still confines reads to the app's
-- own org via `id::text = current_setting('app.org_id', true)`.

-- Org tier mutation is an admin operation that does NOT belong to
-- govai_audit_writer. The audit writer is the migration/audit-chain role; it
-- must not be able to silently escalate a tenant's tier or mode. PR3 will
-- introduce a dedicated `govai_admin` role + tier-promotion endpoint that
-- carries the explicit admin consent + audit trail. Until then, tier mutation
-- is restricted to direct DB administration (psql, runbook) and to the
-- migration-runner / superuser path used by tests.
--
-- govai_app remains read-only on these columns — tenant runtime cannot
-- escalate its own tier under any circumstance.

-- org_tier_lookup: SECURITY DEFINER helper called from authenticateApiKey.
-- The auth flow runs BEFORE tenant context is set (it is in fact what we use
-- to derive the tenant), so RLS-bound SELECT cannot help here. Same pattern
-- as `api_key_lookup` in migration 0005.
CREATE OR REPLACE FUNCTION govai.org_tier_lookup(p_org_id uuid)
RETURNS TABLE(tier text, operational_mode text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT o.tier, o.operational_mode
      FROM govai.orgs o
     WHERE o.id = p_org_id
     LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION govai.org_tier_lookup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION govai.org_tier_lookup(uuid) TO govai_app;

RESET ROLE;
