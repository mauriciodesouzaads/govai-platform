-- Migration 0036 — AI Conversation PROVIDER CONTINUATION: the two column authorities P0-D1's
-- server-assembled durable context actually requires, and nothing else.
--
-- Mission:  EP-AI-CONVERSATION-CONTINUITY-V1-01
-- Movement: P0-D1-DURABLE-CONTEXT-API-PROVIDER-CONTINUATION-01
-- Spec:     docs/architecture/ai-conversation-continuity-v1.md
--           (§3 fork pins / continuation anchor, §7.5 eligibility, §11 ProviderConversationAdapter
--            + CREDENTIAL-ANCHOR RECONCILIATION, §24 LAW 1 / LAW 2 / LAW 4 / LAW 11 / LAW 17).
--
-- Migrations 0031–0035 are historical source and are NOT touched. This migration creates NO
-- table, NO column, NO index, NO trigger, NO function and NO policy: every durable structure
-- P0-D1 needs — the branch fork pins, the per-turn item/attempt lineage, the encrypted
-- `continuation_parent_*` group on attempts — ALREADY EXISTS in 0031, exactly as designed for
-- this movement. What was missing is AUTHORITY: 0034 deliberately withheld it ("P0-D" wall,
-- 0034 header items 2 and the deliberate-omissions list), and this migration adds the narrowest
-- set that makes the P0-D1 runtime real.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHAT P0-D1 NEEDS, AND WHY EACH ITEM IS THE MINIMUM
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- 1. The worker must READ the branch FORK COLUMNS (`forked_from_turn_id`,
--    `forked_from_attempt_id`, `boundary_mode`). The §34 context algorithm walks the executing
--    branch's fork ancestry to apply the §3 boundary modes (`after_attempt` replays the pinned
--    attempt's output; `before_attempt_output` excludes it), and 0034 §D's column-scoped SELECT
--    deliberately left these three columns unreachable because P0-C never read a fork boundary.
--    The existing 0034 SELECT policy on branches covers the rows; only the column list widens.
--    (`parent_branch_id` was already granted by 0034 §D.)
--
-- 2. The worker must WRITE the four `continuation_parent_*` columns — the §11 continuation
--    anchor an attempt chained FROM, persisted ENCRYPTED in the dispatch-boundary commit
--    (0031's post-boundary causal freeze opens these columns only while `state = 'accepted'`,
--    so the boundary crossing is the one lawful write site, enforced by trigger independently
--    of this grant). UPDATE ONLY, deliberately WITHOUT SELECT: the runtime derives every next
--    anchor from the durable item projection (spec §11 "continuation roots in context-eligible
--    attempts only"), never by reading an anchor back, so read authority would be authority
--    without a code path — and the 0032 posture ("anticipating a later movement's needs is not
--    least privilege") applies to columns exactly as it does to tables. The existing 0034
--    UPDATE policy on attempts covers the rows; only the column list widens.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO — each a recorded adjudication, not an oversight
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--   * NO privilege on `govai.ai_conversation_provider_state`, for ANY role. P0-D1 creates NO
--     provider-held continuation state: the OpenAI conversation-object strategy is
--     DEFERRED_WITHIN_P0D because the accepted architecture gates it on a tenant policy signal
--     permitting provider-stored state and NO such signal exists in executable source at this
--     anchor (movement dispatch §22 — inventing one is forbidden; commercial tier is not
--     governance policy); Anthropic Messages is stateless by provider design; and the OpenAI
--     `previous_response_id` chain derives its anchor from the DURABLE ITEM PROJECTION (spec
--     §11's continuation-roots rule), which leaves no second continuation store to diverge
--     from durable truth (LAW 17) and no shared provider-held object to taint or rotate
--     (LAW 9 — vacuously satisfied because no such state exists). The first strategy that
--     introduces provider-HELD state (conversation objects, Codex threads, Claude Code
--     sessions) brings its own provider_state authority WITH the taint/rotation discipline.
--   * NO SELECT on `continuation_parent_*` for the worker (see item 2) — S2's read denial
--     stays true.
--   * NO INSERT on attempts (retry minting is not P0-D1's), no DELETE anywhere, no TRUNCATE,
--     no evidence-link privilege (P0-F), no discovery-function change, no BYPASSRLS, no role
--     membership, no ownership.
--   * NO change to `govai_app`: the request plane neither assembles context nor dispatches.
--
-- Conventions follow 0028/0030/0031/0032/0033/0034/0035: idempotent DDL, column-scoped grants
-- cumulative with the existing dual-predicate FORCE-RLS policies, roles created only in
-- bootstrap.

SET ROLE govai_audit_writer;

-- Precondition: the role is created by bootstrap.sql (the 0028/0032/0034 shape).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'govai_conversation_worker') THEN
    RAISE EXCEPTION 'role govai_conversation_worker is absent; run the updated infra/postgres/bootstrap.sql first (roles are created in bootstrap, not in migrations).';
  END IF;
END
$$;

-- ===========================================================================
-- A. ai_conversation_branches — the fork boundary becomes readable (item 1)
-- ===========================================================================

GRANT SELECT (forked_from_turn_id, forked_from_attempt_id, boundary_mode)
  ON govai.ai_conversation_branches TO govai_conversation_worker;

-- ===========================================================================
-- B. ai_conversation_attempts — the continuation anchor becomes writable (item 2)
-- ===========================================================================

GRANT UPDATE (continuation_parent_ciphertext, continuation_parent_dek_wrapped,
              continuation_parent_kms_key_id, continuation_parent_kms_key_version)
  ON govai.ai_conversation_attempts TO govai_conversation_worker;

RESET ROLE;

-- ===========================================================================
-- End of migration 0036.
-- ===========================================================================
