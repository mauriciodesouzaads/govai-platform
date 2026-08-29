-- Migration 0035 — AI Conversation: truthful GOVAI-LOCAL failure taxonomy.
--
-- Mission:  EP-AI-CONVERSATION-CONTINUITY-V1-01
-- Movement: P0-C-DURABLE-SEND-EXECUTION-KERNEL-01 (round-three review remediation)
-- Spec:     docs/architecture/ai-conversation-continuity-v1.md §7.4 (failure taxonomy),
--           §7.7 (`outcome_unknown` is the honest AMBIGUOUS state, not a dumping ground).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHY A SCHEMA CHANGE, AND WHY IT IS THE NARROWEST ONE POSSIBLE
--
-- 0031's `error_class` enumerates PROVIDER/TRANSPORT outcomes:
--   blocked · auth_rejected · request_too_large · rate_limited · credential_unavailable ·
--   provider_error
--
-- That vocabulary has no member for a failure of GOVAI ITSELF, and the executor has exactly two
-- such cases. Before this migration both were mislabelled, in opposite directions:
--
--   (a) A local failure BEFORE any transmission — request construction rejecting a malformed
--       URL or a credential containing an invalid header byte — was recorded as
--       `provider_error`. The provider was never contacted. The label was simply false.
--
--   (b) A local failure AFTER the provider answered — a KMS encryption fault or a database
--       write error while persisting the response — was recorded as `outcome_unknown`. That is
--       worse than false: `outcome_unknown` MEANS "the provider's fate is unprovable", and §7.7
--       builds real behaviour on it (no re-drive, only a recovery probe may resolve it). When
--       the response and its status were already in hand, the fate is PROVEN. Recording
--       ambiguity there both loses a known result and pollutes the one state whose entire value
--       is that it is reserved for genuine unknowns.
--
-- ★ THE TWO NEW VALUES ARE NOT INTERCHANGEABLE, AND THAT IS THE POINT. They are OPERATIONALLY
-- OPPOSITE. After `local_error` the provider provably did not process the request, so a future
-- retry (P0-D) is safe. After `persistence_error` the provider DID process it, so a blind retry
-- would duplicate real work. Collapsing them into one "local failure" value would erase exactly
-- the distinction that makes either of them safe to act on.
--
--   local_error        GovAI failed BEFORE any transmission was attempted.
--                      The provider was never contacted.
--   persistence_error  The provider ANSWERED (status observed), and GovAI then failed to
--                      durably record the result.
--
-- WHY A NEW MIGRATION RATHER THAN AN EDIT TO 0034: 0034 has already been applied in local and
-- live environments, and the runner replays every file on each `migrate()` — an in-place edit to
-- an applied migration is not a safe way to evolve a constraint. 0031/0032/0033/0034 are
-- historical source and are NOT touched.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
--   * no new column, table, index, policy, trigger or function;
--   * no new GRANT — `error_class` is already inside 0034's column-scoped worker UPDATE;
--   * no change to the `failed <=> error_class` coupling: 0031's
--     `ai_conversation_attempts_failed_class_check` (failed => class) and
--     `..._error_class_failed_check` (class => failed) are untouched, so both new values remain
--     usable ONLY on a `failed` attempt;
--   * no backfill — the change WIDENS an accepted set, so every existing row still satisfies it.

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. Replace the enum CHECK on govai.ai_conversation_attempts.error_class
--
-- 0031 declared it as an INLINE column CHECK, so PostgreSQL auto-named it. Rather than trust a
-- naming convention, the constraint is located by its DEFINITION — the only CHECK on this table
-- that mentions `provider_error`. (The two hand-named constraints that also reference
-- `error_class` — the `failed <=> class` pair — do not contain any enum member, so they are
-- never matched and never dropped.)
--
-- Rerunnable by construction: the loop drops WHATEVER enum CHECK is present (0031's original or
-- this migration's own), then adds the canonical one back under an explicit name. Applying this
-- file twice converges to the same single constraint.
-- ===========================================================================

DO $$
DECLARE
  target record;
  dropped integer := 0;
BEGIN
  FOR target IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel      ON rel.oid = con.conrelid
      JOIN pg_namespace ns   ON ns.oid = rel.relnamespace
     WHERE ns.nspname   = 'govai'
       AND rel.relname  = 'ai_conversation_attempts'
       AND con.contype  = 'c'
       AND pg_get_constraintdef(con.oid) LIKE '%error_class%'
       AND pg_get_constraintdef(con.oid) LIKE '%''provider_error''%'
  LOOP
    EXECUTE format('ALTER TABLE govai.ai_conversation_attempts DROP CONSTRAINT %I', target.conname);
    dropped := dropped + 1;
  END LOOP;

  -- Fail LOUD rather than silently leaving the column unconstrained: if 0031's CHECK is absent
  -- the schema is not what this migration was written against.
  IF dropped = 0 THEN
    RAISE EXCEPTION 'ai_conversation_attempts: no error_class enum CHECK found to replace; expected the constraint created by migration 0031.';
  END IF;
END
$$;

ALTER TABLE govai.ai_conversation_attempts
  ADD CONSTRAINT ai_conversation_attempts_error_class_check
  CHECK (
    error_class IS NULL
    OR error_class IN (
      -- 0031's PROVIDER/TRANSPORT vocabulary, unchanged.
      'blocked',
      'auth_rejected',
      'request_too_large',
      'rate_limited',
      'credential_unavailable',
      'provider_error',
      -- P0-C: GOVAI-LOCAL failures. Operationally opposite — see the header.
      'local_error',
      'persistence_error'
    )
  );

COMMENT ON CONSTRAINT ai_conversation_attempts_error_class_check
  ON govai.ai_conversation_attempts IS
  'P0-C: 0031''s provider/transport taxonomy PLUS two GovAI-local values. `local_error` = GovAI failed before any transmission, so the provider provably did not process the request. `persistence_error` = the provider ANSWERED and GovAI then failed to durably record the result. They are operationally opposite (a retry is safe after the first and duplicates real work after the second), which is why they are two values and not one. Neither is `outcome_unknown`: that state is reserved for a provider fate that is genuinely unprovable (§7.7), and using it for a known-result local failure would both lose the known result and dilute the one state whose value is its reservation.';

RESET ROLE;

-- ===========================================================================
-- End of migration 0035.
-- ===========================================================================
