-- Migration 0026 — Audit Capture idempotency content anchor (EP-008-PRE-EQ).
--
-- CREATE OR REPLACE of govai.audit_capture_insert_locked that removes EXACTLY ONE
-- clause from the Step-3 idempotency divergence check:
--   OR v_existing.redaction_metadata IS DISTINCT FROM p_redaction_metadata
-- The other 17 divergence columns (org_id, chain_id, chain_category, event_type,
-- event_version, subject_type, subject_id, occurred_at, payload_hash,
-- payload_encrypted, dek_wrapped, key_id, key_version, evidence_strength,
-- capture_integrity_tag, capture_integrity_alg, posture) and the ENTIRE rest of
-- the function (signature, DECLARE, validations, advisory lock, chain-state
-- row-lock, the Step-3 reuse RETURN, the Step-4 insert, OWNER/REVOKE/GRANT) are
-- byte-identical to the 0025 definition.
--
-- Why (Codex bot P1 on PR #102, head d93ccb43 — cross-deploy replay gap): a
-- capture written by the PRE-enrichment code (old-shape redaction_metadata,
-- `{audit_bridge:{identity_scope}}`) and re-projected by the POST-enrichment code
-- (new shape, `{audit_bridge:{identity_scope,provider,capability_id}}`) shares the
-- SAME capture_id, payload_hash, occurred_at and every other immutable column, yet
-- diverged ONLY on redaction_metadata → SQLSTATE 23505 → a false
-- evidence_idempotency_conflict instead of an idempotent reuse.
--
-- Doctrine (ADR-028 amendment, 2026-06-20 — idempotency content anchor):
--   - redaction_metadata is OBSERVATIONAL and a deterministic function of the
--     captureId inputs (identity_scope/idempotency_key_hash, and now
--     provider/capability_id — all origin-stable). It is NOT a content anchor.
--   - payload_hash remains THE content anchor for idempotent-capture divergence;
--     it (and the 16 other immutable columns) still raise 23505 on real divergence.
--   - First-writer-wins on reuse: the idempotent-reuse path returns the EXISTING
--     row with NO UPDATE, so the originally-stored redaction_metadata is preserved.
--   - The immutability trigger govai.audit_capture_outbox_guard (BEFORE UPDATE OR
--     DELETE) is a SEPARATE, UNTOUCHED mechanism: redaction_metadata stays
--     immutable-after-write. This migration relaxes ONLY insert-idempotency,
--     never row-immutability, and writes no backfill.
--
-- Idempotent/re-runnable (CREATE OR REPLACE + idempotent OWNER/REVOKE/GRANT), per
-- the runner contract (apps/api/src/db/migrate.ts replays every migration).
--
-- Architectural references:
--   - docs/architecture/adr/ADR-028-direct-route-request-identity-and-idempotency.md
--     (## Amendment (2026-06-20) — idempotency content anchor)
--   - apps/api/src/db/migrations/0025_audit_capture_outbox_foundation.sql (the base)

SET ROLE govai_audit_writer;

CREATE OR REPLACE FUNCTION govai.audit_capture_insert_locked(
  p_capture_id              uuid,
  p_org_id                  uuid,
  p_chain_id                text,
  p_chain_category          text,
  p_chain_lock_key          bigint,
  p_event_type              text,
  p_event_version           text,
  p_subject_type            text,
  p_subject_id              uuid,
  p_occurred_at             timestamptz,
  p_payload_hash            bytea,
  p_payload_encrypted       bytea,
  p_dek_wrapped             bytea,
  p_key_id                  text,
  p_key_version             integer,
  p_redaction_metadata      jsonb,
  p_evidence_strength       text,
  p_capture_integrity_tag   bytea,
  p_capture_integrity_alg   text,
  p_posture                 text
) RETURNS TABLE (capture_id uuid, capture_seq bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_session_org text := current_setting('app.org_id', true);
  v_current_seq bigint;
  v_next_seq    bigint;
  v_existing    govai.audit_capture_outbox%ROWTYPE;
  v_state_org   uuid;
BEGIN
  IF v_session_org IS NULL OR v_session_org = '' OR v_session_org <> p_org_id::text THEN
    RAISE EXCEPTION 'audit_capture_insert_locked: tenant mismatch (session=% input=%)',
      COALESCE(NULLIF(v_session_org,''),'NULL'), p_org_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_chain_category NOT IN ('auth','run','policy','admin') THEN
    RAISE EXCEPTION 'audit_capture_insert_locked: invalid chain_category %', p_chain_category
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_posture NOT IN ('strict','best_effort') THEN
    RAISE EXCEPTION 'audit_capture_insert_locked: invalid posture %', p_posture
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF jsonb_typeof(p_redaction_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'audit_capture_insert_locked: redaction_metadata must be a JSON object'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_redaction_metadata ? 'prompt'
     OR p_redaction_metadata ? 'response'
     OR p_redaction_metadata ? 'raw_input'
     OR p_redaction_metadata ? 'raw_output'
  THEN
    RAISE EXCEPTION 'audit_capture_insert_locked: redaction_metadata cannot contain raw payload keys at top level'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF (p_capture_integrity_tag IS NULL) <> (p_capture_integrity_alg IS NULL) THEN
    RAISE EXCEPTION 'audit_capture_insert_locked: capture_integrity_tag/alg must be both null or both set'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_capture_integrity_alg IS NOT NULL
     AND p_capture_integrity_alg NOT IN ('kms_hmac_sha256','sha256_digest')
  THEN
    RAISE EXCEPTION 'audit_capture_insert_locked: invalid capture_integrity_alg %', p_capture_integrity_alg
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Concurrency contract (B0 final-hardening review):
  --
  -- The advisory xact lock below is a PERFORMANCE HINT only. Correctness does
  -- NOT depend on p_chain_lock_key being correctly derived by the caller — a
  -- wrong key only reduces parallelism (or creates contention on an unrelated
  -- chain) but cannot produce gaps, orphans, or duplicate capture_seq, because
  -- the chain_state row-level lock taken in step 2 below is the actual
  -- serialization primitive.
  --
  -- Per-chain steps, in strict order:
  --   1. PERFORM pg_advisory_xact_lock(p_chain_lock_key) — caller hint.
  --   2. INSERT ... ON CONFLICT DO UPDATE on chain_state to ATOMICALLY take
  --      an exclusive row-level lock on the chain_state row (creating it if
  --      missing). The DO UPDATE clause is a no-op aside from acquiring the
  --      lock and refreshing updated_at; it does NOT advance last_captured_seq.
  --   3. Idempotency check on outbox NOW under the row-level lock: any
  --      concurrent caller targeting the same chain blocks at step 2 above
  --      until this transaction either commits or rolls back, so a re-entrant
  --      caller with the same capture_id will always observe the prior insert.
  --   4. If new capture: UPDATE chain_state SET last_captured_seq = +1, then
  --      INSERT into outbox. Both happen under the same row-level lock.
  --
  -- Result: even with concurrent callers supplying DIFFERENT (incorrect)
  -- p_chain_lock_key values for the same p_chain_id, the function preserves
  -- - capture_id idempotency,
  -- - strict +1 monotonicity of last_captured_seq,
  -- - absence of capture_seq gaps,
  -- - no orphan rows.
  PERFORM pg_advisory_xact_lock(p_chain_lock_key);

  -- Step 2: acquire exclusive row-level lock on chain_state (create if missing).
  -- The DO UPDATE no-op forces ON CONFLICT to take the row lock; without it,
  -- ON CONFLICT DO NOTHING would not lock the existing row.
  INSERT INTO govai.audit_capture_chain_state (chain_id, org_id, chain_category, last_captured_seq, updated_at)
       VALUES (p_chain_id, p_org_id, p_chain_category, 0, now())
  ON CONFLICT (chain_id) DO UPDATE
     SET updated_at = now()
   RETURNING govai.audit_capture_chain_state.org_id,
             govai.audit_capture_chain_state.last_captured_seq
        INTO v_state_org, v_current_seq;

  IF v_state_org <> p_org_id THEN
    RAISE EXCEPTION 'audit_capture_insert_locked: chain_state tenant mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Step 3: idempotency check under the row-level lock.
  SELECT * INTO v_existing
    FROM govai.audit_capture_outbox
   WHERE govai.audit_capture_outbox.capture_id = p_capture_id;

  IF FOUND THEN
    IF v_existing.org_id                IS DISTINCT FROM p_org_id
       OR v_existing.chain_id           IS DISTINCT FROM p_chain_id
       OR v_existing.chain_category     IS DISTINCT FROM p_chain_category
       OR v_existing.event_type         IS DISTINCT FROM p_event_type
       OR v_existing.event_version      IS DISTINCT FROM p_event_version
       OR v_existing.subject_type       IS DISTINCT FROM p_subject_type
       OR v_existing.subject_id         IS DISTINCT FROM p_subject_id
       OR v_existing.occurred_at        IS DISTINCT FROM p_occurred_at
       OR v_existing.payload_hash       IS DISTINCT FROM p_payload_hash
       OR v_existing.payload_encrypted  IS DISTINCT FROM p_payload_encrypted
       OR v_existing.dek_wrapped        IS DISTINCT FROM p_dek_wrapped
       OR v_existing.key_id             IS DISTINCT FROM p_key_id
       OR v_existing.key_version        IS DISTINCT FROM p_key_version
       OR v_existing.evidence_strength  IS DISTINCT FROM p_evidence_strength
       OR v_existing.capture_integrity_tag IS DISTINCT FROM p_capture_integrity_tag
       OR v_existing.capture_integrity_alg IS DISTINCT FROM p_capture_integrity_alg
       OR v_existing.posture            IS DISTINCT FROM p_posture
    THEN
      RAISE EXCEPTION 'audit_capture_insert_locked: capture_id % already exists with divergent immutable content', p_capture_id
        USING ERRCODE = 'unique_violation';
    END IF;
    capture_id  := v_existing.capture_id;
    capture_seq := v_existing.capture_seq;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Step 4: assign next sequence under the row-level lock.
  v_next_seq := v_current_seq + 1;

  UPDATE govai.audit_capture_chain_state
     SET last_captured_seq = v_next_seq,
         updated_at        = now()
   WHERE govai.audit_capture_chain_state.chain_id = p_chain_id;

  INSERT INTO govai.audit_capture_outbox (
    capture_id, org_id, chain_id, chain_category, capture_seq,
    event_type, event_version, subject_type, subject_id, occurred_at,
    payload_hash, payload_encrypted, dek_wrapped, key_id, key_version,
    redaction_metadata, evidence_strength,
    capture_integrity_tag, capture_integrity_alg, posture,
    status, captured_at
  ) VALUES (
    p_capture_id, p_org_id, p_chain_id, p_chain_category, v_next_seq,
    p_event_type, p_event_version, p_subject_type, p_subject_id, p_occurred_at,
    p_payload_hash, p_payload_encrypted, p_dek_wrapped, p_key_id, p_key_version,
    p_redaction_metadata, p_evidence_strength,
    p_capture_integrity_tag, p_capture_integrity_alg, p_posture,
    'captured', now()
  );

  capture_id  := p_capture_id;
  capture_seq := v_next_seq;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION govai.audit_capture_insert_locked(
  uuid, uuid, text, text, bigint, text, text, text, uuid, timestamptz,
  bytea, bytea, bytea, text, integer, jsonb, text, bytea, text, text
) OWNER TO govai_audit_writer;

REVOKE ALL ON FUNCTION govai.audit_capture_insert_locked(
  uuid, uuid, text, text, bigint, text, text, text, uuid, timestamptz,
  bytea, bytea, bytea, text, integer, jsonb, text, bytea, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION govai.audit_capture_insert_locked(
  uuid, uuid, text, text, bigint, text, text, text, uuid, timestamptz,
  bytea, bytea, bytea, text, integer, jsonb, text, bytea, text, text
) TO govai_app;

-- ===========================================================================
-- End of migration 0026.
-- ===========================================================================
