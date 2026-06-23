-- Migration 0027 — Evidence-Completeness Read Views (EP-008A).
--
-- Additive, read-only: three SECURITY INVOKER views over the existing
-- evidence-plane tables (0025 audit_capture_outbox / audit_capture_chain_state;
-- 0002 provider_invocations; 0001 audit_events). No new tables, no writes, and
-- no ALTER of any existing table / trigger / function / index / policy / grant.
--
--   * govai.evidence_capture_completeness  — EC-1.a: capture-outbox status counts
--     + ages per (org_id, chain_category).
--   * govai.evidence_chain_backlog         — EC-1.b: per-chain unsealed backlog
--     (last_captured_seq - last_sealed_capture_seq) for chains with a backlog.
--   * govai.evidence_provider_without_audit — EC-3a: Path-A provider_invocations
--     with no terminal run.* audit event (expected EMPTY; a row is an integrity
--     gap the same-transaction orchestrator invariant should make impossible).
--
-- Tenant isolation (NON-NEGOTIABLE): every view is WITH (security_invoker = true)
-- so base-table RLS is evaluated as the INVOKER (govai_app, the most-restricted
-- role) — pinning each view's exposure to exactly the caller's org. This is
-- least-privilege + defense-in-depth: if a future migration ever loosened the
-- owner's (govai_audit_writer) RLS policy or granted it BYPASSRLS, an owner's-
-- rights view would silently inherit that and leak; security_invoker removes
-- that entire class of regression. (Works because govai_app holds SELECT on all
-- three base tables — 0025 §D.)
--
-- Grants mirror 0025: REVOKE ALL FROM PUBLIC; GRANT SELECT to govai_app ONLY
-- (the sealer is NOT granted SELECT on the EC views). Owned by govai_audit_writer
-- via SET ROLE, exactly as 0025. Idempotent/re-runnable (CREATE OR REPLACE VIEW +
-- idempotent REVOKE/GRANT), per the runner contract (migrate.ts replays every
-- migration in order).
--
-- Refs: EP-008A spec rev2 (architect + Opus GO-WITH-CHANGES @ ecc55a97);
-- development-roadmap.md Phase 4. No ADR / table / trigger change.

SET ROLE govai_audit_writer;

-- EC-1.a — capture-outbox status counts + ages, per org & chain_category.
CREATE OR REPLACE VIEW govai.evidence_capture_completeness
  WITH (security_invoker = true) AS
SELECT
  org_id,
  chain_category,
  count(*)                                                    AS total,
  count(*) FILTER (WHERE status = 'captured')                 AS captured,
  count(*) FILTER (WHERE status = 'sealing')                  AS sealing,
  count(*) FILTER (WHERE status = 'sealed')                   AS sealed,
  count(*) FILTER (WHERE status = 'failed')                   AS failed,
  min(captured_at)        FILTER (WHERE status = 'captured')  AS oldest_unsealed_at,
  min(sealing_started_at) FILTER (WHERE status = 'sealing')   AS oldest_sealing_at,
  max(attempts)                                               AS max_attempts
FROM govai.audit_capture_outbox
GROUP BY org_id, chain_category;

REVOKE ALL    ON govai.evidence_capture_completeness FROM PUBLIC;
GRANT  SELECT ON govai.evidence_capture_completeness TO   govai_app;

-- EC-1.b — per-chain unsealed backlog (contiguity gap).
CREATE OR REPLACE VIEW govai.evidence_chain_backlog
  WITH (security_invoker = true) AS
SELECT
  org_id, chain_id, chain_category,
  last_captured_seq,
  last_sealed_capture_seq,
  (last_captured_seq - last_sealed_capture_seq) AS unsealed_depth
FROM govai.audit_capture_chain_state
WHERE last_captured_seq > last_sealed_capture_seq;

REVOKE ALL    ON govai.evidence_chain_backlog FROM PUBLIC;
GRANT  SELECT ON govai.evidence_chain_backlog TO   govai_app;

-- EC-3a — Path-A provider invocations without a terminal run.* audit event (expected empty).
CREATE OR REPLACE VIEW govai.evidence_provider_without_audit
  WITH (security_invoker = true) AS
SELECT
  pi.org_id, pi.run_id, pi.id AS provider_invocation_id,
  pi.provider, pi.native_endpoint, pi.status_code, pi.error_class, pi.created_at
FROM govai.provider_invocations pi
WHERE NOT EXISTS (
  SELECT 1 FROM govai.audit_events ae
   WHERE ae.subject_type = 'run'
     AND ae.subject_id   = pi.run_id
     AND ae.event_type IN ('run.completed','run.failed','run.denied')
);

REVOKE ALL    ON govai.evidence_provider_without_audit FROM PUBLIC;
GRANT  SELECT ON govai.evidence_provider_without_audit TO   govai_app;

-- ===========================================================================
-- End of migration 0027.
-- ===========================================================================
