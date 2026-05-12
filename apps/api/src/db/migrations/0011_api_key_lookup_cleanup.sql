-- Migration 0011 — drop legacy govai.api_key_lookup (PR3.1g, issue #29).
--
-- Background:
--   * Migration 0005 created govai.api_key_lookup(text) RETURNS TABLE(prefix,
--     hash, org_id, user_id, status) — no roles.
--   * Migration 0010 introduced govai.api_key_lookup_v2(text) RETURNS TABLE(...,
--     roles text[]) under a NEW function name because PostgreSQL refuses
--     `CREATE OR REPLACE FUNCTION` when the return type changes. The legacy
--     function was retained at that point only because migration 0005
--     re-runs `CREATE OR REPLACE FUNCTION govai.api_key_lookup` on every
--     bootstrap, and dropping the function during 0010 would have created
--     an idempotency conflict (0005 would re-create on the next run, then
--     conflict with what later migrations expected).
--   * apps/api/src/pipeline/auth.ts:55 calls `api_key_lookup_v2` exclusively.
--     No runtime code path references the legacy function. PR3.1c verified
--     this and registered issue #29 for cleanup.
--
-- Why dropping here is safe / idempotent:
--   * The migration runner re-runs every .sql file in numeric order on each
--     invocation. On a re-run, migration 0005 will CREATE OR REPLACE the
--     legacy function again (legitimate, since the function did not exist),
--     and then this migration 0011 will drop it again. Both steps are
--     idempotent under `CREATE OR REPLACE` and `DROP FUNCTION IF EXISTS`.
--   * No runtime queries the legacy function, so dropping it cannot break
--     any in-flight or future auth path. The only consumer was the legacy
--     auth lookup, which has been routed to the v2 function since PR3.1b.
--   * A SECURITY DEFINER function that is permanently unused is dead
--     attack surface: dropping it removes that surface entirely.
--
-- The legacy function takes a single `text` parameter and PostgreSQL
-- distinguishes overloads by argument types, so the explicit signature is
-- required to target the right function.

SET ROLE govai_audit_writer;

DROP FUNCTION IF EXISTS govai.api_key_lookup(text);

RESET ROLE;
