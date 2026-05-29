-- Migration 0025 — Audit Capture Outbox Foundation (B0).
--
-- Evidence Plane (Plano 3) substrate for the future AuditBridge.capture (B1)
-- and AuditSealer worker (B2). B0 ships ONLY the SQL substrate: three tables
-- (chain state, outbox, capture refs), four SECURITY DEFINER functions
-- (insert_locked, claim_for_seal, mark_sealed, mark_failed), append-only +
-- status-transition triggers, RLS FORCE per tenant, and least-privilege
-- grants. B0 does NOT modify auditAppend / audit_append_locked / canonicalize
-- / verify, and does NOT touch any HTTP route or runtime TypeScript. The
-- outbox is dormant until B1 reads/writes through it.
--
-- Doctrinal invariants enforced at the DB layer:
--   - outbox content is immutable after capture (immutable-fields trigger);
--   - sealing order is strict per chain (chain_state +1 monotonic trigger);
--   - status state machine is enforced (captured -> sealing -> sealed;
--     captured/sealing -> failed; sealed/failed are terminal in B0);
--   - tenant isolation via RLS ENABLE + FORCE per org_id;
--   - sealer role cannot be impersonated by govai_app
--     (REVOKE ALL FROM PUBLIC + selective EXECUTE grants);
--   - PUBLIC cannot execute any B0 function (REVOKE ALL FROM PUBLIC explicit);
--   - mark_failed does NOT write into the HMAC chain — meta-events of
--     failure are deferred to B2/B3 when the AuditSealer worker exists;
--   - redaction_metadata guard blocks top-level raw payload keys (B0 only;
--     deeper JSON inspection is deferred to B1/B2 AuditBridge);
--   - capture_id INSERT is idempotent under advisory lock (per-chain
--     pg_advisory_xact_lock taken BEFORE any read of chain state or outbox);
--   - audit_event_capture_refs uses logical (not strict FK) references to
--     decouple this foundation from the HMAC chain table; integrity is
--     enforced by append-only + immutability triggers (see COMMENT ON COLUMN).
--
-- Pre-condition: bootstrap.sql executed with govai_audit_writer +
-- govai_audit_sealer roles in place.
--
-- Architectural references:
--   - docs/architecture/specs/spec-v2.1-governance-kernel-audit-bridge.md
--   - docs/architecture/adr/ADR-017-audit-bridge-evidence-plane.md
--   - docs/security/threat-model.md  (T1 provider-native evidence bypass;
--                                     T2 outbox tampering before seal)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- 0. Schema USAGE for the sealer role (B0).
--    govai_app already has USAGE from bootstrap; govai_audit_sealer needs it
--    here so RLS-scoped SELECTs and EXECUTEs on the SECURITY DEFINER
--    functions resolve `govai.*` identifiers under its role.
-- ===========================================================================

GRANT USAGE ON SCHEMA govai TO govai_audit_sealer;

-- ===========================================================================
-- A. govai.audit_capture_chain_state — sequence anchor per chain.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.audit_capture_chain_state (
  chain_id                 text        PRIMARY KEY,
  org_id                   uuid        NOT NULL,
  chain_category           text        NOT NULL
                            CHECK (chain_category IN ('auth','run','policy','admin')),
  last_captured_seq        bigint      NOT NULL DEFAULT 0,
  last_sealed_capture_seq  bigint      NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (last_captured_seq        >= 0),
  CHECK (last_sealed_capture_seq  >= 0),
  CHECK (last_sealed_capture_seq  <= last_captured_seq)
);

CREATE INDEX IF NOT EXISTS audit_capture_chain_state_org_idx
  ON govai.audit_capture_chain_state (org_id, chain_category);

ALTER TABLE govai.audit_capture_chain_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.audit_capture_chain_state FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- B. govai.audit_capture_outbox — write-ahead durable capture.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.audit_capture_outbox (
  id                       bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  capture_id               uuid        NOT NULL UNIQUE,
  org_id                   uuid        NOT NULL,
  chain_id                 text        NOT NULL,
  chain_category           text        NOT NULL
                            CHECK (chain_category IN ('auth','run','policy','admin')),
  capture_seq              bigint      NOT NULL,
  event_type               text        NOT NULL,
  event_version            text        NOT NULL,
  subject_type             text        NOT NULL,
  subject_id               uuid        NOT NULL,
  occurred_at              timestamptz NOT NULL,
  payload_hash             bytea       NOT NULL,
  payload_encrypted        bytea       NULL,
  dek_wrapped              bytea       NULL,
  key_id                   text        NOT NULL,
  key_version              integer     NOT NULL,
  redaction_metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  evidence_strength        text        NOT NULL DEFAULT 'hmac_internal',
  capture_integrity_tag    bytea       NULL,
  capture_integrity_alg    text        NULL,
  posture                  text        NOT NULL DEFAULT 'best_effort',
  status                   text        NOT NULL DEFAULT 'captured',
  captured_at              timestamptz NOT NULL DEFAULT now(),
  sealing_started_at       timestamptz NULL,
  sealed_at                timestamptz NULL,
  failed_at                timestamptz NULL,
  audit_event_id           uuid        NULL,
  attempts                 integer     NOT NULL DEFAULT 0,
  last_error               text        NULL,
  UNIQUE (chain_id, capture_seq),
  CHECK (attempts >= 0),
  CHECK (status IN ('captured','sealing','sealed','failed')),
  CHECK (posture IN ('strict','best_effort')),
  CHECK (
    capture_integrity_alg IS NULL
    OR capture_integrity_alg IN ('kms_hmac_sha256','sha256_digest')
  ),
  CHECK (
    (capture_integrity_tag IS NULL AND capture_integrity_alg IS NULL)
    OR
    (capture_integrity_tag IS NOT NULL AND capture_integrity_alg IS NOT NULL)
  ),
  CHECK (last_error IS NULL OR length(last_error) <= 200),
  CHECK (status <> 'sealed' OR (audit_event_id IS NOT NULL AND sealed_at IS NOT NULL)),
  CHECK (status <> 'sealed' OR failed_at IS NULL),
  CHECK (status <> 'failed' OR failed_at IS NOT NULL),
  CHECK (status <> 'failed' OR (sealed_at IS NULL AND audit_event_id IS NULL)),
  -- Top-level redaction_metadata guard (B0). Blocks the obvious raw-payload
  -- keys at the top level. Deeper JSON inspection is intentionally deferred
  -- to B1/B2 AuditBridge — B0 does not policy nested JSON.
  CHECK (
    jsonb_typeof(redaction_metadata) = 'object'
    AND NOT redaction_metadata ? 'prompt'
    AND NOT redaction_metadata ? 'response'
    AND NOT redaction_metadata ? 'raw_input'
    AND NOT redaction_metadata ? 'raw_output'
  )
);

CREATE INDEX IF NOT EXISTS audit_capture_outbox_org_status_captured_idx
  ON govai.audit_capture_outbox (org_id, status, captured_at);
CREATE INDEX IF NOT EXISTS audit_capture_outbox_chain_status_seq_idx
  ON govai.audit_capture_outbox (chain_id, status, capture_seq);
CREATE INDEX IF NOT EXISTS audit_capture_outbox_org_category_status_idx
  ON govai.audit_capture_outbox (org_id, chain_category, status);

ALTER TABLE govai.audit_capture_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.audit_capture_outbox FORCE  ROW LEVEL SECURITY;

COMMENT ON COLUMN govai.audit_capture_outbox.redaction_metadata IS
  'Top-level keys may include surface, providerId, capability, policy_ids, detector_classes, counts, hashes, redacted previews. Top-level CHECK blocks prompt/response/raw_input/raw_output. Deeper JSON inspection is deferred to AuditBridge (B1/B2); B0 does not policy nested JSON.';

COMMENT ON COLUMN govai.audit_capture_outbox.audit_event_id IS
  'Logical reference to govai.audit_events.id, set only when status=sealed. No strict FK in B0 by design; integrity is enforced by append-only immutability and SECURITY DEFINER functions.';

-- ===========================================================================
-- C. govai.audit_event_capture_refs — lateral mapping capture <-> audit event.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.audit_event_capture_refs (
  org_id          uuid        NOT NULL,
  capture_id      uuid        NOT NULL PRIMARY KEY,
  audit_event_id  uuid        NOT NULL UNIQUE,
  sealed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_event_capture_refs_org_idx
  ON govai.audit_event_capture_refs (org_id);

ALTER TABLE govai.audit_event_capture_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.audit_event_capture_refs FORCE  ROW LEVEL SECURITY;

COMMENT ON COLUMN govai.audit_event_capture_refs.capture_id IS
  'Logical reference to govai.audit_capture_outbox.capture_id. No strict FK in B0 by design; integrity is enforced by append-only immutability and SECURITY DEFINER functions.';

COMMENT ON COLUMN govai.audit_event_capture_refs.audit_event_id IS
  'Logical reference to govai.audit_events.id. No strict FK in B0 by design; integrity is enforced by append-only immutability and SECURITY DEFINER functions.';

-- ===========================================================================
-- D. Permissões base — REVOKE ALL FROM PUBLIC + grants explícitos por role.
-- ===========================================================================

REVOKE ALL ON govai.audit_capture_chain_state   FROM PUBLIC;
REVOKE ALL ON govai.audit_capture_outbox        FROM PUBLIC;
REVOKE ALL ON govai.audit_event_capture_refs    FROM PUBLIC;

-- govai_app receives read-only SELECT (RLS-scoped). Writes happen exclusively
-- via SECURITY DEFINER functions; no direct INSERT/UPDATE granted.
GRANT SELECT ON govai.audit_capture_chain_state TO govai_app;
GRANT SELECT ON govai.audit_capture_outbox      TO govai_app;
GRANT SELECT ON govai.audit_event_capture_refs  TO govai_app;

-- govai_audit_sealer also receives read-only SELECT. Sealing-time writes
-- happen via mark_sealed / mark_failed (SECURITY DEFINER, owned by writer).
GRANT SELECT ON govai.audit_capture_chain_state TO govai_audit_sealer;
GRANT SELECT ON govai.audit_capture_outbox      TO govai_audit_sealer;
GRANT SELECT ON govai.audit_event_capture_refs  TO govai_audit_sealer;

-- ===========================================================================
-- E. RLS policies — explícitas por comando E por role.
--    FORCE RLS sujeita o owner; logo SELECT precisa policy para writer também.
-- ===========================================================================

DO $$
BEGIN
  CREATE POLICY audit_capture_chain_state_select_app
    ON govai.audit_capture_chain_state FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY audit_capture_chain_state_select_sealer
    ON govai.audit_capture_chain_state FOR SELECT TO govai_audit_sealer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY audit_capture_chain_state_select_writer
    ON govai.audit_capture_chain_state FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY audit_capture_chain_state_insert_writer
    ON govai.audit_capture_chain_state FOR INSERT TO govai_audit_writer
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY audit_capture_chain_state_update_writer
    ON govai.audit_capture_chain_state FOR UPDATE TO govai_audit_writer
    USING       (org_id::text = current_setting('app.org_id', true))
    WITH CHECK  (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY audit_capture_outbox_select_app
    ON govai.audit_capture_outbox FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY audit_capture_outbox_select_sealer
    ON govai.audit_capture_outbox FOR SELECT TO govai_audit_sealer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY audit_capture_outbox_select_writer
    ON govai.audit_capture_outbox FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY audit_capture_outbox_insert_writer
    ON govai.audit_capture_outbox FOR INSERT TO govai_audit_writer
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY audit_capture_outbox_update_writer
    ON govai.audit_capture_outbox FOR UPDATE TO govai_audit_writer
    USING       (org_id::text = current_setting('app.org_id', true))
    WITH CHECK  (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY audit_event_capture_refs_select_app
    ON govai.audit_event_capture_refs FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY audit_event_capture_refs_select_sealer
    ON govai.audit_event_capture_refs FOR SELECT TO govai_audit_sealer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY audit_event_capture_refs_select_writer
    ON govai.audit_event_capture_refs FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY audit_event_capture_refs_insert_writer
    ON govai.audit_event_capture_refs FOR INSERT TO govai_audit_writer
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================================================
-- F. Triggers — append-only, status state machine, monotonic sequence.
-- ===========================================================================

-- F.1 outbox guard: immutable fields + status transitions; blocks DELETE.
CREATE OR REPLACE FUNCTION govai.audit_capture_outbox_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_capture_outbox: DELETE blocked (append-only)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Immutable identity + content fields.
  IF NEW.capture_id        <> OLD.capture_id
     OR NEW.org_id         <> OLD.org_id
     OR NEW.chain_id       <> OLD.chain_id
     OR NEW.chain_category <> OLD.chain_category
     OR NEW.capture_seq    <> OLD.capture_seq
     OR NEW.event_type     <> OLD.event_type
     OR NEW.event_version  <> OLD.event_version
     OR NEW.subject_type   <> OLD.subject_type
     OR NEW.subject_id     <> OLD.subject_id
     OR NEW.occurred_at    <> OLD.occurred_at
     OR NEW.payload_hash   <> OLD.payload_hash
     OR (NEW.payload_encrypted     IS DISTINCT FROM OLD.payload_encrypted)
     OR (NEW.dek_wrapped           IS DISTINCT FROM OLD.dek_wrapped)
     OR NEW.key_id         <> OLD.key_id
     OR NEW.key_version    <> OLD.key_version
     OR NEW.redaction_metadata     <> OLD.redaction_metadata
     OR NEW.evidence_strength      <> OLD.evidence_strength
     OR (NEW.capture_integrity_tag IS DISTINCT FROM OLD.capture_integrity_tag)
     OR (NEW.capture_integrity_alg IS DISTINCT FROM OLD.capture_integrity_alg)
     OR NEW.posture        <> OLD.posture
     OR NEW.captured_at    <> OLD.captured_at
  THEN
    RAISE EXCEPTION 'audit_capture_outbox: immutable field changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Status transition validation. Permitted transitions:
  --   captured -> sealing
  --   captured -> failed
  --   sealing  -> sealed
  --   sealing  -> failed
  -- Terminal in B0: sealed, failed.
  IF OLD.status = NEW.status THEN
    -- Same-status UPDATE may only touch attempts/last_error annotations.
    -- sealing_started_at / sealed_at / failed_at / audit_event_id stay
    -- locked once their owning transition fires.
    IF (NEW.sealing_started_at IS DISTINCT FROM OLD.sealing_started_at)
       OR (NEW.sealed_at        IS DISTINCT FROM OLD.sealed_at)
       OR (NEW.failed_at        IS DISTINCT FROM OLD.failed_at)
       OR (NEW.audit_event_id   IS DISTINCT FROM OLD.audit_event_id)
    THEN
      RAISE EXCEPTION 'audit_capture_outbox: lifecycle timestamps frozen at same-status update'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.status = 'captured' AND NEW.status = 'sealing' THEN
    IF NEW.sealing_started_at IS NULL THEN
      RAISE EXCEPTION 'audit_capture_outbox: sealing_started_at required when status=sealing'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSIF OLD.status = 'captured' AND NEW.status = 'failed' THEN
    IF NEW.failed_at IS NULL THEN
      RAISE EXCEPTION 'audit_capture_outbox: failed_at required when status=failed'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSIF OLD.status = 'sealing' AND NEW.status = 'sealed' THEN
    IF NEW.audit_event_id IS NULL OR NEW.sealed_at IS NULL THEN
      RAISE EXCEPTION 'audit_capture_outbox: audit_event_id and sealed_at required when status=sealed'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSIF OLD.status = 'sealing' AND NEW.status = 'failed' THEN
    IF NEW.failed_at IS NULL THEN
      RAISE EXCEPTION 'audit_capture_outbox: failed_at required when status=failed'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSE
    RAISE EXCEPTION 'audit_capture_outbox: invalid status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION govai.audit_capture_outbox_no_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit_capture_outbox: TRUNCATE blocked'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS audit_capture_outbox_guard_trg ON govai.audit_capture_outbox;
CREATE TRIGGER audit_capture_outbox_guard_trg
  BEFORE UPDATE OR DELETE ON govai.audit_capture_outbox
  FOR EACH ROW EXECUTE FUNCTION govai.audit_capture_outbox_guard();

DROP TRIGGER IF EXISTS audit_capture_outbox_no_truncate_trg ON govai.audit_capture_outbox;
CREATE TRIGGER audit_capture_outbox_no_truncate_trg
  BEFORE TRUNCATE ON govai.audit_capture_outbox
  FOR EACH STATEMENT EXECUTE FUNCTION govai.audit_capture_outbox_no_truncate();

-- F.2 chain_state guard: monotonic sequence, immutable identity, no DELETE.
CREATE OR REPLACE FUNCTION govai.audit_capture_chain_state_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_capture_chain_state: DELETE blocked'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.chain_id        <> OLD.chain_id
     OR NEW.org_id       <> OLD.org_id
     OR NEW.chain_category <> OLD.chain_category
     OR NEW.created_at   <> OLD.created_at
  THEN
    RAISE EXCEPTION 'audit_capture_chain_state: immutable identity field changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.last_captured_seq < OLD.last_captured_seq THEN
    RAISE EXCEPTION 'audit_capture_chain_state: last_captured_seq cannot decrease (% -> %)',
      OLD.last_captured_seq, NEW.last_captured_seq
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.last_sealed_capture_seq <> OLD.last_sealed_capture_seq
     AND NEW.last_sealed_capture_seq <> OLD.last_sealed_capture_seq + 1
  THEN
    RAISE EXCEPTION 'audit_capture_chain_state: last_sealed_capture_seq must advance exactly +1 (% -> %)',
      OLD.last_sealed_capture_seq, NEW.last_sealed_capture_seq
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION govai.audit_capture_chain_state_no_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit_capture_chain_state: TRUNCATE blocked'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS audit_capture_chain_state_guard_trg ON govai.audit_capture_chain_state;
CREATE TRIGGER audit_capture_chain_state_guard_trg
  BEFORE UPDATE OR DELETE ON govai.audit_capture_chain_state
  FOR EACH ROW EXECUTE FUNCTION govai.audit_capture_chain_state_guard();

DROP TRIGGER IF EXISTS audit_capture_chain_state_no_truncate_trg ON govai.audit_capture_chain_state;
CREATE TRIGGER audit_capture_chain_state_no_truncate_trg
  BEFORE TRUNCATE ON govai.audit_capture_chain_state
  FOR EACH STATEMENT EXECUTE FUNCTION govai.audit_capture_chain_state_no_truncate();

-- F.3 capture_refs guard: append-only puro (no UPDATE/DELETE/TRUNCATE).
CREATE OR REPLACE FUNCTION govai.audit_event_capture_refs_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit_event_capture_refs: % blocked (append-only)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS audit_event_capture_refs_no_modify_trg ON govai.audit_event_capture_refs;
CREATE TRIGGER audit_event_capture_refs_no_modify_trg
  BEFORE UPDATE OR DELETE ON govai.audit_event_capture_refs
  FOR EACH ROW EXECUTE FUNCTION govai.audit_event_capture_refs_guard();

DROP TRIGGER IF EXISTS audit_event_capture_refs_no_truncate_trg ON govai.audit_event_capture_refs;
CREATE TRIGGER audit_event_capture_refs_no_truncate_trg
  BEFORE TRUNCATE ON govai.audit_event_capture_refs
  FOR EACH STATEMENT EXECUTE FUNCTION govai.audit_event_capture_refs_guard();

-- ===========================================================================
-- G. SECURITY DEFINER functions — all REVOKE EXECUTE FROM PUBLIC + scoped grants.
-- ===========================================================================

-- G.1 audit_capture_insert_locked — idempotent capture insertion under per-chain advisory lock.
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
       OR v_existing.redaction_metadata IS DISTINCT FROM p_redaction_metadata
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

-- G.2 audit_capture_claim_for_seal — sealer-only claim of next contiguous capture.
CREATE OR REPLACE FUNCTION govai.audit_capture_claim_for_seal(
  p_org_id          uuid,
  p_chain_id        text,
  p_chain_lock_key  bigint
) RETURNS TABLE (
  capture_id              uuid,
  org_id                  uuid,
  chain_id                text,
  chain_category          text,
  capture_seq             bigint,
  event_type              text,
  event_version           text,
  subject_type            text,
  subject_id              uuid,
  occurred_at             timestamptz,
  payload_hash            bytea,
  payload_encrypted       bytea,
  dek_wrapped             bytea,
  key_id                  text,
  key_version             integer,
  redaction_metadata      jsonb,
  evidence_strength       text,
  capture_integrity_tag   bytea,
  capture_integrity_alg   text,
  posture                 text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_session_org   text   := current_setting('app.org_id', true);
  v_state_org     uuid;
  v_last_sealed   bigint;
  v_target_seq    bigint;
BEGIN
  IF v_session_org IS NULL OR v_session_org = '' OR v_session_org <> p_org_id::text THEN
    RAISE EXCEPTION 'audit_capture_claim_for_seal: tenant mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM pg_advisory_xact_lock(p_chain_lock_key);

  SELECT cs.org_id, cs.last_sealed_capture_seq
    INTO v_state_org, v_last_sealed
    FROM govai.audit_capture_chain_state cs
   WHERE cs.chain_id = p_chain_id
     FOR UPDATE;

  IF NOT FOUND THEN
    -- No captures yet on this chain.
    RETURN;
  END IF;

  IF v_state_org <> p_org_id THEN
    RAISE EXCEPTION 'audit_capture_claim_for_seal: tenant mismatch on chain state'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_target_seq := v_last_sealed + 1;

  RETURN QUERY
    UPDATE govai.audit_capture_outbox o
       SET status             = 'sealing',
           sealing_started_at = now(),
           attempts           = o.attempts + 1
     WHERE o.chain_id = p_chain_id
       AND o.capture_seq = v_target_seq
       AND o.status = 'captured'
   RETURNING
     o.capture_id, o.org_id, o.chain_id, o.chain_category, o.capture_seq,
     o.event_type, o.event_version, o.subject_type, o.subject_id, o.occurred_at,
     o.payload_hash, o.payload_encrypted, o.dek_wrapped, o.key_id, o.key_version,
     o.redaction_metadata, o.evidence_strength,
     o.capture_integrity_tag, o.capture_integrity_alg, o.posture;
END;
$$;

ALTER FUNCTION govai.audit_capture_claim_for_seal(uuid, text, bigint)
  OWNER TO govai_audit_writer;

REVOKE ALL ON FUNCTION govai.audit_capture_claim_for_seal(uuid, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION govai.audit_capture_claim_for_seal(uuid, text, bigint) TO govai_audit_sealer;

-- G.3 audit_capture_mark_sealed — strict-order seal; idempotent on same audit_event_id.
CREATE OR REPLACE FUNCTION govai.audit_capture_mark_sealed(
  p_org_id          uuid,
  p_capture_id      uuid,
  p_audit_event_id  uuid,
  p_chain_lock_key  bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_session_org   text   := current_setting('app.org_id', true);
  v_row           govai.audit_capture_outbox%ROWTYPE;
  v_state_seq     bigint;
  v_existing_ref  uuid;
BEGIN
  IF v_session_org IS NULL OR v_session_org = '' OR v_session_org <> p_org_id::text THEN
    RAISE EXCEPTION 'audit_capture_mark_sealed: tenant mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM pg_advisory_xact_lock(p_chain_lock_key);

  SELECT * INTO v_row
    FROM govai.audit_capture_outbox
   WHERE govai.audit_capture_outbox.capture_id = p_capture_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit_capture_mark_sealed: capture_id % not found', p_capture_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_row.org_id <> p_org_id THEN
    RAISE EXCEPTION 'audit_capture_mark_sealed: tenant mismatch on capture'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotent re-seal with same audit_event_id?
  IF v_row.status = 'sealed' THEN
    SELECT r.audit_event_id INTO v_existing_ref
      FROM govai.audit_event_capture_refs r
     WHERE r.capture_id = p_capture_id;
    IF v_existing_ref IS NOT NULL AND v_existing_ref = p_audit_event_id THEN
      RETURN; -- idempotent no-op
    END IF;
    RAISE EXCEPTION 'audit_capture_mark_sealed: capture already sealed with different audit_event_id'
      USING ERRCODE = 'unique_violation';
  END IF;

  IF v_row.status <> 'sealing' THEN
    RAISE EXCEPTION 'audit_capture_mark_sealed: capture status % cannot transition to sealed', v_row.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Strict sequence: capture_seq must be exactly last_sealed_capture_seq + 1.
  SELECT cs.last_sealed_capture_seq INTO v_state_seq
    FROM govai.audit_capture_chain_state cs
   WHERE cs.chain_id = v_row.chain_id
     FOR UPDATE;
  IF NOT FOUND OR v_state_seq + 1 <> v_row.capture_seq THEN
    RAISE EXCEPTION 'audit_capture_mark_sealed: sequence mismatch (chain=%, expected next=%, capture_seq=%)',
      v_row.chain_id, COALESCE(v_state_seq, -1) + 1, v_row.capture_seq
      USING ERRCODE = 'serialization_failure';
  END IF;

  INSERT INTO govai.audit_event_capture_refs (org_id, capture_id, audit_event_id, sealed_at)
       VALUES (p_org_id, p_capture_id, p_audit_event_id, now());

  UPDATE govai.audit_capture_outbox
     SET status         = 'sealed',
         sealed_at      = now(),
         audit_event_id = p_audit_event_id
   WHERE govai.audit_capture_outbox.capture_id = p_capture_id;

  UPDATE govai.audit_capture_chain_state
     SET last_sealed_capture_seq = v_row.capture_seq,
         updated_at              = now()
   WHERE govai.audit_capture_chain_state.chain_id = v_row.chain_id;
END;
$$;

ALTER FUNCTION govai.audit_capture_mark_sealed(uuid, uuid, uuid, bigint)
  OWNER TO govai_audit_writer;

REVOKE ALL ON FUNCTION govai.audit_capture_mark_sealed(uuid, uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION govai.audit_capture_mark_sealed(uuid, uuid, uuid, bigint) TO govai_audit_sealer;

-- G.4 audit_capture_mark_failed — terminal-failure marker; does NOT write to HMAC chain in B0.
CREATE OR REPLACE FUNCTION govai.audit_capture_mark_failed(
  p_org_id        uuid,
  p_capture_id    uuid,
  p_error_class   text,
  p_error_message text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_session_org text := current_setting('app.org_id', true);
  v_row         govai.audit_capture_outbox%ROWTYPE;
  v_sanitized   text;
BEGIN
  IF v_session_org IS NULL OR v_session_org = '' OR v_session_org <> p_org_id::text THEN
    RAISE EXCEPTION 'audit_capture_mark_failed: tenant mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row
    FROM govai.audit_capture_outbox
   WHERE govai.audit_capture_outbox.capture_id = p_capture_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit_capture_mark_failed: capture_id % not found', p_capture_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_row.org_id <> p_org_id THEN
    RAISE EXCEPTION 'audit_capture_mark_failed: tenant mismatch on capture'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_row.status NOT IN ('captured','sealing') THEN
    RAISE EXCEPTION 'audit_capture_mark_failed: cannot fail capture in status %', v_row.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Sanitize: enforce 200-char hard cap. The caller is responsible for not
  -- providing raw secrets/prompts/responses in the message; this DB-side
  -- truncation is defense-in-depth. B0 does NOT call auditAppend nor emit a
  -- meta-event into the HMAC chain — that is deferred to B2/B3 when the
  -- AuditSealer worker exists.
  v_sanitized := LEFT(
    '[' || COALESCE(p_error_class, 'unknown') || '] ' ||
    COALESCE(p_error_message, '<no_message>'),
    200
  );

  UPDATE govai.audit_capture_outbox
     SET status     = 'failed',
         failed_at  = now(),
         attempts   = attempts + 1,
         last_error = v_sanitized
   WHERE govai.audit_capture_outbox.capture_id = p_capture_id;
END;
$$;

ALTER FUNCTION govai.audit_capture_mark_failed(uuid, uuid, text, text)
  OWNER TO govai_audit_writer;

REVOKE ALL ON FUNCTION govai.audit_capture_mark_failed(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION govai.audit_capture_mark_failed(uuid, uuid, text, text) TO govai_audit_sealer;

-- ===========================================================================
-- End of migration 0025.
-- ===========================================================================
