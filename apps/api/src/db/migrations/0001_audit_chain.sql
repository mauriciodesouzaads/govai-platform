-- Migration 0001 — audit chain (defense-in-depth)
-- Cria audit_event_payloads, audit_events, RLS policies (por comando E por role),
-- triggers append-only, função audit_append_locked (SECURITY DEFINER) e
-- função audit_event_payload_crypto_shred (SECURITY DEFINER).
--
-- Pré-condição: bootstrap.sql executado. Migrator pode SET ROLE govai_audit_writer.

SET ROLE govai_audit_writer;

-- ===========================================================================
-- Tabelas
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.audit_event_payloads (
  id                uuid        PRIMARY KEY,
  org_id            uuid        NOT NULL,
  encrypted_payload bytea       NOT NULL,
  dek_wrapped       bytea       NULL,
  key_id            text        NOT NULL,
  key_version       integer     NOT NULL,
  status            text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','crypto_shredded','tombstoned')),
  shredded_at       timestamptz NULL,
  shredded_by_event uuid        NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS govai.audit_events (
  id                 uuid        PRIMARY KEY,
  org_id             uuid        NOT NULL,
  chain_id           text        NOT NULL,
  sequence_number    bigint      NOT NULL,
  event_type         text        NOT NULL,
  event_version      text        NOT NULL,
  subject_type       text        NOT NULL,
  subject_id         uuid        NOT NULL,
  occurred_at        timestamptz NOT NULL,
  payload_hash       bytea       NOT NULL,
  payload_ref        uuid        NULL REFERENCES govai.audit_event_payloads(id),
  redaction_metadata jsonb       NOT NULL DEFAULT '{}'::jsonb,
  previous_hmac      bytea       NULL,
  hmac               bytea       NOT NULL,
  canonical_hash     bytea       NOT NULL,
  canonical_bytes    bytea       NOT NULL,
  key_id             text        NOT NULL,
  key_version        integer     NOT NULL,
  chain_anchor_id    uuid        NULL,
  evidence_strength  text        NOT NULL DEFAULT 'hmac_internal'
                     CHECK (evidence_strength IN
                       ('hmac_internal','dev_signed','external_anchor',
                        'customer_signed','icp_brasil_tsa')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS audit_events_org_chain_seq_idx
  ON govai.audit_events (org_id, chain_id, sequence_number);

DO $$
BEGIN
  ALTER TABLE govai.audit_event_payloads
    ADD CONSTRAINT audit_event_payloads_shredded_by_event_fk
    FOREIGN KEY (shredded_by_event) REFERENCES govai.audit_events(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE govai.audit_event_payloads
    ADD CONSTRAINT audit_event_payloads_status_consistency
    CHECK (
      (status = 'active'           AND shredded_at IS NULL     AND shredded_by_event IS NULL  AND dek_wrapped IS NOT NULL) OR
      (status = 'crypto_shredded'  AND shredded_at IS NOT NULL AND shredded_by_event IS NOT NULL AND dek_wrapped IS NULL) OR
      (status = 'tombstoned'       AND shredded_at IS NOT NULL)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE govai.audit_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.audit_events           FORCE  ROW LEVEL SECURITY;
ALTER TABLE govai.audit_event_payloads   ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.audit_event_payloads   FORCE  ROW LEVEL SECURITY;

-- ===========================================================================
-- Permissões base
-- ===========================================================================

REVOKE ALL ON govai.audit_events         FROM PUBLIC;
REVOKE ALL ON govai.audit_event_payloads FROM PUBLIC;

GRANT SELECT ON govai.audit_events       TO govai_app;
GRANT SELECT ON govai.audit_event_payloads TO govai_app;

-- ===========================================================================
-- RLS policies — explícitas por comando E por role.
-- FORCE RLS sujeita o owner; logo SELECT precisa policy para writer também.
-- ===========================================================================

DO $$
BEGIN
  CREATE POLICY audit_events_select_app
    ON govai.audit_events FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE POLICY audit_events_select_writer
    ON govai.audit_events FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE POLICY audit_events_insert_writer
    ON govai.audit_events FOR INSERT TO govai_audit_writer
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE POLICY audit_event_payloads_select_app
    ON govai.audit_event_payloads FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE POLICY audit_event_payloads_select_writer
    ON govai.audit_event_payloads FOR SELECT TO govai_audit_writer
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE POLICY audit_event_payloads_insert_writer
    ON govai.audit_event_payloads FOR INSERT TO govai_audit_writer
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE POLICY audit_event_payloads_update_writer
    ON govai.audit_event_payloads FOR UPDATE TO govai_audit_writer
    USING       (org_id::text = current_setting('app.org_id', true))
    WITH CHECK  (org_id::text = current_setting('app.org_id', true));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- ===========================================================================
-- Triggers append-only
-- ===========================================================================

CREATE OR REPLACE FUNCTION govai.audit_no_modify_row() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit table append-only: % blocked at row-level', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE FUNCTION govai.audit_no_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit table append-only: TRUNCATE blocked'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_no_update_delete_trg ON govai.audit_events;
CREATE TRIGGER audit_events_no_update_delete_trg
  BEFORE UPDATE OR DELETE ON govai.audit_events
  FOR EACH ROW EXECUTE FUNCTION govai.audit_no_modify_row();

DROP TRIGGER IF EXISTS audit_events_no_truncate_trg ON govai.audit_events;
CREATE TRIGGER audit_events_no_truncate_trg
  BEFORE TRUNCATE ON govai.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION govai.audit_no_truncate();

DROP TRIGGER IF EXISTS audit_event_payloads_no_delete_trg ON govai.audit_event_payloads;
CREATE TRIGGER audit_event_payloads_no_delete_trg
  BEFORE DELETE ON govai.audit_event_payloads
  FOR EACH ROW EXECUTE FUNCTION govai.audit_no_modify_row();

DROP TRIGGER IF EXISTS audit_event_payloads_no_truncate_trg ON govai.audit_event_payloads;
CREATE TRIGGER audit_event_payloads_no_truncate_trg
  BEFORE TRUNCATE ON govai.audit_event_payloads
  FOR EACH STATEMENT EXECUTE FUNCTION govai.audit_no_truncate();

CREATE OR REPLACE FUNCTION govai.audit_event_payloads_restrict_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.id              <> OLD.id              OR
     NEW.org_id          <> OLD.org_id          OR
     NEW.encrypted_payload <> OLD.encrypted_payload OR
     NEW.key_id          <> OLD.key_id          OR
     NEW.key_version     <> OLD.key_version     OR
     NEW.created_at      <> OLD.created_at
  THEN
    RAISE EXCEPTION 'audit_event_payloads: immutable field changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.status <> 'active' THEN
    RAISE EXCEPTION 'audit_event_payloads: status transition from % blocked', OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status NOT IN ('crypto_shredded','tombstoned') THEN
    RAISE EXCEPTION 'audit_event_payloads: invalid target status %', NEW.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Both crypto_shredded and tombstoned imply data destruction: dek_wrapped MUST be NULL.
  IF NEW.dek_wrapped IS NOT NULL THEN
    RAISE EXCEPTION 'audit_event_payloads: dek_wrapped must be NULL when leaving active'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.shredded_at IS NULL THEN
    RAISE EXCEPTION 'audit_event_payloads: shredded_at required when leaving active'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status = 'crypto_shredded' THEN
    IF NEW.shredded_by_event IS NULL THEN
      RAISE EXCEPTION 'audit_event_payloads: shredded_by_event required for crypto_shredded'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.shredded_by_event IS NOT NULL THEN
      RAISE EXCEPTION 'audit_event_payloads: shredded_by_event already set'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_event_payloads_restrict_update_trg ON govai.audit_event_payloads;
CREATE TRIGGER audit_event_payloads_restrict_update_trg
  BEFORE UPDATE ON govai.audit_event_payloads
  FOR EACH ROW EXECUTE FUNCTION govai.audit_event_payloads_restrict_update();

-- ===========================================================================
-- Função audit_append_locked
-- ===========================================================================

CREATE OR REPLACE FUNCTION govai.audit_append_locked(
  p_event_id            uuid,
  p_org_id              uuid,
  p_chain_id            text,
  p_chain_lock_key      bigint,
  p_expected_prev_hmac  bytea,
  p_expected_sequence   bigint,
  p_canonical_hash      bytea,
  p_canonical_bytes     bytea,
  p_hmac                bytea,
  p_event_type          text,
  p_event_version       text,
  p_subject_type        text,
  p_subject_id          uuid,
  p_occurred_at         timestamptz,
  p_payload_hash        bytea,
  p_payload_id          uuid,
  p_payload_encrypted   bytea,
  p_dek_wrapped         bytea,
  p_key_id              text,
  p_key_version         integer,
  p_redaction_metadata  jsonb,
  p_evidence_strength   text DEFAULT 'hmac_internal'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_session_org   text   := current_setting('app.org_id', true);
  v_actual_prev   bytea;
  v_actual_seq    bigint;
BEGIN
  IF v_session_org IS NULL OR v_session_org = '' OR v_session_org <> p_org_id::text THEN
    RAISE EXCEPTION 'audit_append_locked: tenant mismatch (session=% input=%)',
      COALESCE(NULLIF(v_session_org,''),'NULL'), p_org_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_evidence_strength NOT IN ('hmac_internal','dev_signed') THEN
    RAISE EXCEPTION 'audit_append_locked: evidence_strength % not implemented in baseline',
      p_evidence_strength
      USING ERRCODE = 'feature_not_supported';
  END IF;

  IF p_payload_encrypted IS NULL AND p_payload_id IS NOT NULL THEN
    RAISE EXCEPTION 'audit_append_locked: payload_id provided without payload_encrypted'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_payload_encrypted IS NOT NULL THEN
    IF p_payload_id IS NULL OR p_dek_wrapped IS NULL THEN
      RAISE EXCEPTION 'audit_append_locked: payload provided without payload_id or dek_wrapped'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  -- Validação canonical_bytes vs canonical_hash ocorre em TS (sem dependência pgcrypto).

  PERFORM pg_advisory_xact_lock(p_chain_lock_key);

  SELECT hmac, sequence_number
    INTO v_actual_prev, v_actual_seq
    FROM govai.audit_events
   WHERE chain_id = p_chain_id
   ORDER BY sequence_number DESC
   LIMIT 1;

  IF (v_actual_prev IS DISTINCT FROM p_expected_prev_hmac) THEN
    RAISE EXCEPTION 'audit_append_locked: previous_hmac mismatch (chain advanced)'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF (COALESCE(v_actual_seq, 0) + 1) <> p_expected_sequence THEN
    RAISE EXCEPTION 'audit_append_locked: sequence mismatch (expected=% actual_next=%)',
      p_expected_sequence, COALESCE(v_actual_seq, 0) + 1
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF p_payload_encrypted IS NOT NULL THEN
    INSERT INTO govai.audit_event_payloads (
      id, org_id, encrypted_payload, dek_wrapped, key_id, key_version
    ) VALUES (
      p_payload_id, p_org_id, p_payload_encrypted, p_dek_wrapped, p_key_id, p_key_version
    );
  END IF;

  INSERT INTO govai.audit_events (
    id, org_id, chain_id, sequence_number, event_type, event_version,
    subject_type, subject_id, occurred_at, payload_hash, payload_ref,
    redaction_metadata, previous_hmac, hmac, canonical_hash, canonical_bytes,
    key_id, key_version, evidence_strength
  ) VALUES (
    p_event_id, p_org_id, p_chain_id, p_expected_sequence, p_event_type, p_event_version,
    p_subject_type, p_subject_id, p_occurred_at, p_payload_hash, p_payload_id,
    p_redaction_metadata, p_expected_prev_hmac, p_hmac, p_canonical_hash, p_canonical_bytes,
    p_key_id, p_key_version, p_evidence_strength
  );

  RETURN p_event_id;
END;
$$;

ALTER FUNCTION govai.audit_append_locked(
  uuid, uuid, text, bigint, bytea, bigint, bytea, bytea, bytea,
  text, text, text, uuid, timestamptz, bytea,
  uuid, bytea, bytea, text, integer, jsonb, text
) OWNER TO govai_audit_writer;

REVOKE ALL ON FUNCTION govai.audit_append_locked(
  uuid, uuid, text, bigint, bytea, bigint, bytea, bytea, bytea,
  text, text, text, uuid, timestamptz, bytea,
  uuid, bytea, bytea, text, integer, jsonb, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION govai.audit_append_locked(
  uuid, uuid, text, bigint, bytea, bigint, bytea, bytea, bytea,
  text, text, text, uuid, timestamptz, bytea,
  uuid, bytea, bytea, text, integer, jsonb, text
) TO govai_app;

-- ===========================================================================
-- Função audit_event_payload_crypto_shred
-- ===========================================================================

CREATE OR REPLACE FUNCTION govai.audit_event_payload_crypto_shred(
  p_payload_id              uuid,
  p_org_id                  uuid,
  p_admin_event_id          uuid,
  p_admin_chain_id          text,
  p_admin_chain_lock_key    bigint,
  p_expected_prev_hmac      bytea,
  p_expected_sequence       bigint,
  p_canonical_hash          bytea,
  p_canonical_bytes         bytea,
  p_hmac                    bytea,
  p_occurred_at             timestamptz,
  p_actor_user_id           uuid,
  p_reason_hash             bytea,
  p_redaction_metadata      jsonb,
  p_key_id                  text,
  p_key_version             integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_session_org    text  := current_setting('app.org_id', true);
  v_authorized     text  := current_setting('app.crypto_shred_authorized', true);
  v_payload_org    uuid;
  v_payload_status text;
  v_event_id       uuid;
BEGIN
  IF v_session_org IS NULL OR v_session_org = '' OR v_session_org <> p_org_id::text THEN
    RAISE EXCEPTION 'crypto_shred: tenant mismatch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Defense-in-depth: app layer must explicitly set this session var after RBAC check.
  -- App route handlers do `SET LOCAL app.crypto_shred_authorized = 'true'` once role
  -- (admin or data_protection_officer) is confirmed.
  IF v_authorized IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'crypto_shred: app.crypto_shred_authorized session flag not set'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM pg_advisory_xact_lock(p_admin_chain_lock_key);

  SELECT org_id, status
    INTO v_payload_org, v_payload_status
    FROM govai.audit_event_payloads
   WHERE id = p_payload_id
   FOR UPDATE;

  IF v_payload_org IS NULL THEN
    RAISE EXCEPTION 'crypto_shred: payload not found';
  END IF;
  IF v_payload_org <> p_org_id THEN
    RAISE EXCEPTION 'crypto_shred: payload org mismatch';
  END IF;
  IF v_payload_status <> 'active' THEN
    RAISE EXCEPTION 'crypto_shred: payload already %', v_payload_status;
  END IF;

  v_event_id := govai.audit_append_locked(
    p_event_id            => p_admin_event_id,
    p_org_id              => p_org_id,
    p_chain_id            => p_admin_chain_id,
    p_chain_lock_key      => p_admin_chain_lock_key,
    p_expected_prev_hmac  => p_expected_prev_hmac,
    p_expected_sequence   => p_expected_sequence,
    p_canonical_hash      => p_canonical_hash,
    p_canonical_bytes     => p_canonical_bytes,
    p_hmac                => p_hmac,
    p_event_type          => 'audit_event.payload_crypto_shredded',
    p_event_version       => '1',
    p_subject_type        => 'audit_event_payload',
    p_subject_id          => p_payload_id,
    p_occurred_at         => p_occurred_at,
    p_payload_hash        => p_reason_hash,
    p_payload_id          => NULL,
    p_payload_encrypted   => NULL,
    p_dek_wrapped         => NULL,
    p_key_id              => p_key_id,
    p_key_version         => p_key_version,
    p_redaction_metadata  => p_redaction_metadata
                              || jsonb_build_object('actor_user_id', p_actor_user_id),
    p_evidence_strength   => 'hmac_internal'
  );

  UPDATE govai.audit_event_payloads
     SET status            = 'crypto_shredded',
         dek_wrapped       = NULL,
         shredded_at       = now(),
         shredded_by_event = v_event_id
   WHERE id = p_payload_id;

  RETURN v_event_id;
END;
$$;

ALTER FUNCTION govai.audit_event_payload_crypto_shred(
  uuid, uuid, uuid, text, bigint, bytea, bigint, bytea, bytea, bytea,
  timestamptz, uuid, bytea, jsonb, text, integer
) OWNER TO govai_audit_writer;

REVOKE ALL ON FUNCTION govai.audit_event_payload_crypto_shred(
  uuid, uuid, uuid, text, bigint, bytea, bigint, bytea, bytea, bytea,
  timestamptz, uuid, bytea, jsonb, text, integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION govai.audit_event_payload_crypto_shred(
  uuid, uuid, uuid, text, bigint, bytea, bigint, bytea, bytea, bytea,
  timestamptz, uuid, bytea, jsonb, text, integer
) TO govai_app;

RESET ROLE;
