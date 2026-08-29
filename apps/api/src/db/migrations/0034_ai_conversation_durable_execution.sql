-- Migration 0034 — AI Conversation DURABLE EXECUTION: the worker's execution privilege
-- matrix, its FORCE-RLS write surface, and the send-reservation read the request role needs.
--
-- Mission:  EP-AI-CONVERSATION-CONTINUITY-V1-01
-- Movement: P0-C-DURABLE-SEND-EXECUTION-KERNEL-01
-- Spec:     docs/architecture/ai-conversation-continuity-v1.md
--           (§7.7 claim/lease/fencing, §8 five-commit durable send, §9 dispatch boundary and
--            server-owned stream, §14.1 request identity, §24 LAW 1 / LAW 7 / LAW 10 / LAW 11 /
--            LAW 16).
--
-- Migrations 0031 (P0-A1), 0032 (P0-A2) and 0033 (P0-B) are historical source and are NOT
-- touched. Every state predicate P0-C relies on ALREADY EXISTS as a CHECK or a guard trigger in
-- 0031; this migration adds no new physics. What it adds is AUTHORITY — the narrowest privilege
-- set that lets the detached worker execute the §8 protocol, plus the matching FORCE-RLS
-- policies without which every grant here would silently yield zero rows.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHAT P0-C NEEDS, AND WHY EACH ITEM IS THE MINIMUM
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- 1. govai_conversation_worker must UPDATE the ATTEMPT claim/execution plane: the claim CAS
--    (§8 commit 2), the dispatch boundary (commit 3), the credential-provenance write
--    (commit 4), the heartbeat, and the fenced finalize (commit 5). Column-scoped, so the
--    identity/lineage columns and `attempt_seq` are unreachable by privilege as well as by the
--    0031 guard trigger.
--
-- 2. It must READ the attempt columns 0032 deliberately withheld — `provider_credential_id`
--    (the durable no-POST proof `¬P`), `govai_request_id`/`capture_id` (§14) and
--    `causal_version_at_build` (§7.8). 0032 withheld them because P0-A2 had no code path that
--    needed them; P0-C's recovery arms and boundary CAS are exactly that path.
--    ★ The four `continuation_parent_*` columns stay UNREACHABLE: they are the §11 provider
--    continuation anchor, and P0-C implements no continuation (that is P0-D). A grant here
--    would be pre-granting future capability.
--
-- 3. It must READ `ai_conversation_turns.native_request_config_content_id` — the pointer to the
--    immutable native request the detached claimant must reconstruct the POST from. 0032
--    withheld it for the same "no path needs it yet" reason.
--
-- 4. It must SELECT + INSERT `ai_conversation_content` and `ai_conversation_items`: read the
--    turn's user input and native request config, write the attempt's output. NO UPDATE and NO
--    DELETE — both tables are append-only in place (0031's items no-UPDATE trigger and the
--    content guard), and crypto-shred/purge are later movements' authority.
--
-- 5. It must SELECT + UPDATE `ai_conversation_branches.causal_version` — §7.8's monotonic
--    context version. The worker SAMPLES it before building the request (persisting the sample
--    as `causal_version_at_build`), the boundary CAS re-validates it, and a terminal transition
--    BUMPS it so a concurrently-building sibling detects staleness. The 0031 branches guard
--    already refuses anything but a monotonic bump.
--
-- 6. It must SELECT `govai.provider_credentials` under a NEW worker-scoped policy — §8 commit 4
--    resolves the ACTIVE credential and persists its ROW ID as durable provenance. The policy
--    is ORG-scoped (matching 0009's own shape for this table, which carries no
--    `owner_user_id`), and the worker enters that org context only from a discovery row.
--
-- 7. It must EXECUTE `govai.audit_capture_insert_locked` — the ONE function
--    `captureAuditEvent` touches (`packages/core-audit/src/capture.ts:316-318`). This is what
--    keeps worker-driven dispatch on the SAME evidence contract as request-driven dispatch
--    instead of creating a silent audit-capture gap. Nothing else on the evidence plane is
--    granted: no table, no chain state, no outbox, no sealer function.
--
-- 8. ★ It must hold UPDATE on ai_conversations to take the §9-step-4 root `FOR KEY SHARE`.
--    THIS IS A POSTGRESQL REQUIREMENT, NOT A DESIGN CHOICE: any row-locking clause raises
--    `ACL_SELECT_FOR_UPDATE`, and `#define ACL_SELECT_FOR_UPDATE ACL_UPDATE` — a role with no
--    UPDATE privilege on the table simply cannot take the lock. The accepted design REQUIRES
--    that lock ("The share lock is what makes this RIGOROUS, not merely probabilistic": it
--    conflicts with §19 step 1's root `FOR UPDATE`, so either the boundary commits first or the
--    `deleted_pending` transition does and the boundary's predicate sees it). The minimum that
--    realizes it is `GRANT UPDATE (updated_at)` plus a dual-predicate UPDATE policy. What that
--    authority actually is, stated plainly: the worker can bump a row's `updated_at` on a
--    conversation it already reached through owner discovery. `status`, `archived_at`,
--    `retention_class` and all five encrypted-title columns are NOT in the column grant, so the
--    lifecycle and the title stay unreachable by privilege — and 0031's guard trigger continues
--    to police the shape independently.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
--   * no DELETE grant anywhere (LAW 13's purge is a later movement's authority);
--   * no TRUNCATE grant;
--   * no INSERT grant on `ai_conversation_attempts` for the worker — §9 is explicit that the
--     worker holds SELECT/UPDATE and NOT INSERT: an attempt is minted by the reservation (§9
--     step 1) or by retry (P0-D), never by the executor;
--   * no `ai_conversation_provider_state` privilege for ANY role beyond 0031's — P0-C writes
--     no continuation state (§23's P0-D wall);
--   * no `ai_conversation_evidence_links` privilege change — §14's link materialization is
--     P0-F's closeout;
--   * no new grant on `ai_conversation_turns` for `govai_app`: the reservation mints the turn
--     with `current_attempt_id` ALREADY SET under `SET CONSTRAINTS ... DEFERRED` (0031 §I made
--     the reverse pointer DEFERRABLE for exactly this, and 0033's fork already proves the
--     technique), so the request plane never acquires the authority to REPOINT a live turn;
--   * no BYPASSRLS, no superuser, no table ownership, no role membership, no SET ROLE path.
--
-- Conventions follow 0009/0012/0013/0028/0030/0031/0032/0033: idempotent DDL, dual-predicate
-- FORCE-RLS policies, column-scoped grants, no FK to govai.orgs.

SET ROLE govai_audit_writer;

-- Precondition: the role is created by bootstrap.sql. Fail loudly with a fix hint if it is
-- absent (the 0028/0032 shape).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'govai_conversation_worker') THEN
    RAISE EXCEPTION 'role govai_conversation_worker is absent; run the updated infra/postgres/bootstrap.sql first (roles are created in bootstrap, not in migrations).';
  END IF;
END
$$;

-- ===========================================================================
-- A. ai_conversations — the LAW 16 level (1) root lock surface for the worker
--
-- SELECT already exists (0032). The UPDATE policy + `updated_at` column grant exist ONLY to
-- make `SELECT ... FOR KEY SHARE` legal for this role (see header item 8). The worker issues no
-- UPDATE against this table anywhere in P0-C.
-- ===========================================================================

DO $$ BEGIN
  CREATE POLICY ai_conversations_update_conversation_worker ON govai.ai_conversations
    FOR UPDATE TO govai_conversation_worker
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true))
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON POLICY ai_conversations_update_conversation_worker ON govai.ai_conversations IS
  'P0-C: exists so the dispatch-boundary transaction may take the §9 root FOR KEY SHARE lock — PostgreSQL raises ACL_SELECT_FOR_UPDATE (= ACL_UPDATE) for any row-locking clause. Same dual-predicate owner scope as every other ai_* policy. The accompanying column grant is updated_at ALONE, so status, archived_at, retention_class and the five encrypted-title columns stay unreachable by privilege.';

GRANT UPDATE (updated_at) ON govai.ai_conversations TO govai_conversation_worker;

-- The IMMUTABLE execution lane (§3). 0032 granted `status` but not `mode`, because P0-A2's
-- discovery re-validation needed only the lifecycle predicate. P0-C's executor MUST read `mode`:
-- it is what selects governed vs passthrough for a DETACHED dispatch, and §9 requires that
-- choice to come from durable state alone ("read at hydration and at EVERY dispatch,
-- request-driven or detached"). Without it the executor cannot resolve its own lane — and,
-- because PostgreSQL reports a missing COLUMN privilege as `permission denied for table`, its
-- absence surfaces as an opaque table-level denial rather than an obvious missing column.
-- Still no title columns: the worker cannot read a conversation title in any form.
GRANT SELECT (mode) ON govai.ai_conversations TO govai_conversation_worker;

-- ===========================================================================
-- B. ai_conversation_turns — the immutable native request config pointer
--
-- Additive to 0032's column grant. `SELECT` policy already exists; a column grant is cumulative
-- with it, so only the column list widens by exactly one column.
-- ===========================================================================

GRANT SELECT (native_request_config_content_id)
  ON govai.ai_conversation_turns TO govai_conversation_worker;

-- ===========================================================================
-- C. ai_conversation_attempts — the execution plane
--
-- C.1 the three columns 0032 withheld, now needed by the boundary CAS and the recovery arms.
--     `continuation_parent_*` stays withheld (P0-D).
-- ===========================================================================

GRANT SELECT (provider_credential_id, govai_request_id, capture_id, causal_version_at_build,
              terminal_at, error_class, context_excluded)
  ON govai.ai_conversation_attempts TO govai_conversation_worker;

-- C.2 the WRITE surface: exactly the columns the five-commit protocol mutates.
--
-- Column-by-column justification (nothing here is "while we are at it"):
--   state                           §7 forward transitions (graph enforced by 0031's trigger)
--   claim_token/claimant/
--     claim_deadline_at             §8 commit 2 claim + §7.7 rotation (LAW 7 fencing triple)
--   heartbeat_at                    §7.7 timer-driven lease renewal
--   dispatch_boundary_committed_at  §8 commit 3 (write-once by trigger)
--   govai_request_id                §14.1's ONE authoritative mint site, at the boundary commit
--   capture_id                      §14.2 derived identity
--   provider_credential_id          §8 commit 4 provenance (write-once by trigger)
--   causal_version_at_build         §7.8 as-built version, stamped by a boundary CROSSING
--   context_excluded                §7.8 post-advance marker (one-way by trigger)
--   error_class / terminal_at       §7.4 taxonomy + ratchet stamp
--   updated_at                      every mutation bumps it
--
-- NOT granted: id/org_id/owner_user_id/conversation_id/branch_id/turn_id/attempt_seq
-- (identity + lineage — frozen by the guard trigger and now unreachable by privilege too),
-- created_at, the four continuation_parent_* columns, and `stop_requested`.
-- ★ `stop_requested` is deliberately WRITE-DENIED to the worker: the flag is a REQUEST-plane
-- command (§13's Stop endpoint) that the worker only ever READS as a fence. P0-C ships no public
-- Stop, so nothing may set it in this movement — and when Stop lands, the setter is the request
-- role, never the executor. The worker keeps its 0032 SELECT on it.
GRANT UPDATE (state, claim_token, claimant, claim_deadline_at, heartbeat_at,
              dispatch_boundary_committed_at, govai_request_id, capture_id,
              provider_credential_id, causal_version_at_build, context_excluded,
              error_class, terminal_at, updated_at)
  ON govai.ai_conversation_attempts TO govai_conversation_worker;

DO $$ BEGIN
  CREATE POLICY ai_conversation_attempts_update_conversation_worker
    ON govai.ai_conversation_attempts
    FOR UPDATE TO govai_conversation_worker
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true))
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON POLICY ai_conversation_attempts_update_conversation_worker
  ON govai.ai_conversation_attempts IS
  'P0-C worker execution surface: the §8 five-commit protocol''s claim, boundary, credential-provenance, heartbeat and finalize writes. Row scope is the SAME dual-predicate owner scope 0031 wrote for SELECT/INSERT — a worker session with no owner context writes ZERO rows. The state graph, the write-once identity columns and the terminal freeze remain enforced by 0031''s guard trigger, which this policy neither weakens nor duplicates.';

-- ===========================================================================
-- D. ai_conversation_branches — §7.8 causal version
--
-- 0032 gave the worker NOTHING on this table (its discovery query reads `branch_id` off the
-- denormalized attempt row). P0-C needs the branch itself: the durable execution triple
-- (provider/surface/model) selects the adapter AFTER a reload, and `causal_version` is the
-- §7.8 staleness binding.
-- ===========================================================================

DO $$ BEGIN
  CREATE POLICY ai_conversation_branches_select_conversation_worker
    ON govai.ai_conversation_branches
    FOR SELECT TO govai_conversation_worker
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_branches_update_conversation_worker
    ON govai.ai_conversation_branches
    FOR UPDATE TO govai_conversation_worker
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true))
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Column-scoped: the fork pins and the execution triple are READ-ONLY to the worker, and only
-- the monotonic causal version (plus updated_at) is writable. 0031's branches guard rejects any
-- other column change and any non-monotonic bump, independently of this grant.
REVOKE ALL ON govai.ai_conversation_branches FROM govai_conversation_worker;
GRANT SELECT (id, org_id, owner_user_id, conversation_id, provider, surface, model,
              causal_version, parent_branch_id, created_at, updated_at)
  ON govai.ai_conversation_branches TO govai_conversation_worker;
GRANT UPDATE (causal_version, updated_at)
  ON govai.ai_conversation_branches TO govai_conversation_worker;

-- ===========================================================================
-- E. ai_conversation_content + ai_conversation_items — input read, output write
--
-- Table-level (not column-scoped) SELECT/INSERT: unlike the claim plane, there is no subset of
-- these rows' columns the worker can do without — it reads the whole envelope group to decrypt
-- and writes the whole envelope group to persist. Column scoping here would buy nothing and
-- would break on the next legitimate column. No UPDATE, no DELETE on either table.
-- ===========================================================================

DO $$ BEGIN
  CREATE POLICY ai_conversation_content_select_conversation_worker
    ON govai.ai_conversation_content
    FOR SELECT TO govai_conversation_worker
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_content_insert_conversation_worker
    ON govai.ai_conversation_content
    FOR INSERT TO govai_conversation_worker
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_items_select_conversation_worker
    ON govai.ai_conversation_items
    FOR SELECT TO govai_conversation_worker
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_items_insert_conversation_worker
    ON govai.ai_conversation_items
    FOR INSERT TO govai_conversation_worker
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT ON govai.ai_conversation_content TO govai_conversation_worker;
GRANT SELECT, INSERT ON govai.ai_conversation_items   TO govai_conversation_worker;

-- ===========================================================================
-- F. provider_credentials — §8 commit 4 provenance
--
-- ORG-scoped, mirroring 0009's own `provider_credentials_select_app` exactly (the table has no
-- `owner_user_id` column, so an owner predicate is not expressible here). The worker reaches an
-- org context only through a discovery row, and the attempt's ORG-COMPOSITE credential FK
-- (0031 §F) makes cross-tenant provenance structurally unrepresentable regardless.
--
-- SELECT ONLY: no INSERT (issuance is the admin surface), no UPDATE (revocation is the admin
-- surface). The worker reads the envelope group to decrypt in memory and records the ROW ID.
-- ===========================================================================

DO $$ BEGIN
  CREATE POLICY provider_credentials_select_conversation_worker ON govai.provider_credentials
    FOR SELECT TO govai_conversation_worker
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON POLICY provider_credentials_select_conversation_worker ON govai.provider_credentials IS
  'P0-C: the detached executor resolves the org''s ACTIVE provider credential and persists its ROW ID onto the attempt BEFORE any POST (§8 commit 4). Org-scoped because 0009''s table carries no owner column; the entered org context originates ONLY from a worker discovery row, never from HTTP input.';

REVOKE ALL ON govai.provider_credentials FROM govai_conversation_worker;
GRANT SELECT (id, org_id, provider, status, ciphertext, dek_wrapped, kms_key_id, kms_key_version)
  ON govai.provider_credentials TO govai_conversation_worker;

-- ===========================================================================
-- F2. govai.orgs — the tenant facts the evidence envelope requires
--
-- The v4 `passthrough.invoked` envelope carries `tenant_context` (org, tier, operational_mode)
-- and the enforcement matrix reads `tier`. A worker-driven dispatch that could not read them
-- would have to FABRICATE or OMIT them, and either one breaks the §32 equivalence between a
-- worker-driven and a request-driven capture — the evidence would no longer describe the same
-- tenant facts for the same call.
--
-- ★ NARROWER THAN THE REQUEST PLANE'S PATH ON PURPOSE. `govai_app` reaches these values through
-- `govai.org_tier_lookup(uuid)`, a SECURITY DEFINER function that accepts ANY org id — it must,
-- because the auth flow runs BEFORE a tenant context exists. The worker has no such problem: it
-- is already INSIDE an entered org context by the time it needs these values. So it gets a
-- column-scoped SELECT under an org-scoped policy instead of EXECUTE on the definer, and can
-- therefore read the tier of exactly ONE org — the one it entered — rather than of any org.
-- (The 0028 `GRANT SELECT (id) ON govai.orgs TO govai_evidence_enumerator` precedent.)
-- ===========================================================================

DO $$ BEGIN
  CREATE POLICY orgs_select_conversation_worker ON govai.orgs
    FOR SELECT TO govai_conversation_worker
    USING (id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON POLICY orgs_select_conversation_worker ON govai.orgs IS
  'P0-C: the detached executor reads its ENTERED org''s tier + operational_mode for the v4 evidence envelope and the enforcement matrix. Org-scoped, column-scoped, and deliberately NOT EXECUTE on govai.org_tier_lookup — the definer accepts any org id, which the worker does not need.';

REVOKE ALL ON govai.orgs FROM govai_conversation_worker;
GRANT SELECT (id, tier, operational_mode) ON govai.orgs TO govai_conversation_worker;

-- ===========================================================================
-- G. Evidence capture — the ONE function worker-driven dispatch needs
--
-- `captureAuditEvent` (packages/core-audit/src/capture.ts) issues exactly one statement:
-- `SELECT ... FROM govai.audit_capture_insert_locked(...)`. Granting EXECUTE on that SECURITY
-- DEFINER function — and nothing else — is what makes a worker-driven provider call traverse
-- the SAME evidence path as a request-driven one. Without it, detached dispatch would be a
-- silent audit-capture gap; with anything more, the worker would hold evidence-plane authority
-- it never exercises.
--
-- The signature is 0026's (which re-created the function with the content-anchor amendment).
-- ===========================================================================

GRANT EXECUTE ON FUNCTION govai.audit_capture_insert_locked(
  uuid, uuid, text, text, bigint, text, text, text, uuid, timestamptz,
  bytea, bytea, bytea, text, integer, jsonb, text, bytea, text, text
) TO govai_conversation_worker;

RESET ROLE;

-- ===========================================================================
-- End of migration 0034.
-- ===========================================================================
