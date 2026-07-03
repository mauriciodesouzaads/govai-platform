-- Migration 0028 — evidence enumerator policy (EP-EVIDENCE-GAUGE-WIRING)
--
-- Grants the least-privilege enumerate-only role `govai_evidence_enumerator`
-- (created NOLOGIN-until-provisioned in infra/postgres/bootstrap.sql) its ENTIRE
-- capability: SELECT on the `id` COLUMN of govai.orgs under a registry-wide USING (true)
-- row policy — the writer's registry-wide row shape (0005:47-48) narrowed to one column,
-- on a role that owns nothing, executes nothing, and can read no evidence and no other
-- org column (name / tier / operational_mode).
--
-- INV-1 (no single database identity holds both "enumerate all orgs" and "read
-- evidence"): the enumerator receives ONLY {USAGE on schema govai (bootstrap),
-- SELECT (id) on govai.orgs (here)}. It has zero grants on the evidence read-set
-- (audit_capture_outbox / audit_events / provider_invocations / the 0027 views) and
-- zero EXECUTE on the SECURITY DEFINER capture functions — the safety is the ABSENCE
-- of grants, asserted in DB by integration test I2.
--
-- Runs under SET ROLE govai_audit_writer (the owner of govai.orgs; house pattern
-- 0005:6). Idempotent/re-runnable (duplicate_object guard on the policy).

SET ROLE govai_audit_writer;

-- Precondition: the role is created by bootstrap.sql (roles are cluster-level and
-- are never created in migrations). Fail loudly with a fix hint if it is absent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'govai_evidence_enumerator') THEN
    RAISE EXCEPTION 'role govai_evidence_enumerator is absent; run the updated infra/postgres/bootstrap.sql first (roles are created in bootstrap, not in migrations).';
  END IF;
END
$$;

-- Column-scoped SELECT: ONLY the id column, so the "org UUIDs and nothing more" blast
-- radius is LITERAL. A table-level grant + the USING(true) policy would have exposed every
-- column (name / tier / operational_mode / created_at) of every org. REVOKE first as an
-- idempotent belt for any environment where the prior table-level grant already ran (e.g.
-- rebuilt test containers); a table-level REVOKE does not touch column grants, so re-runs
-- keep only the id column grant.
REVOKE SELECT ON govai.orgs FROM govai_evidence_enumerator;
GRANT SELECT (id) ON govai.orgs TO govai_evidence_enumerator;

DO $$
BEGIN
  CREATE POLICY orgs_select_evidence_enumerator ON govai.orgs FOR SELECT TO govai_evidence_enumerator
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

COMMENT ON POLICY orgs_select_evidence_enumerator ON govai.orgs IS
  'INV-1: enumerate-only identity for the evidence gauges — SELECT on column id of govai.orgs ONLY (org UUIDs and nothing more, literal); must never receive read grants on the evidence read-set or any other org column. See EP-EVIDENCE-GAUGE-WIRING.';

RESET ROLE;
