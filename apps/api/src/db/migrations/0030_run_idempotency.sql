-- Migration 0030 — P0.3-C cross-request run execution idempotency binding.
--
-- govai.run_idempotency: IMMUTABLE tenant-scoped binding from a client
-- execution identity — (org_id, sha256(X-GovAI-Run-Idempotency-Key)) — to ONE
-- durable run, with the canonical semantic execution-intent hash
-- (govai.run_execution_intent.v1) recorded for replay correspondence.
--
-- Explicitly NOT a dispatch-state table, an attempts table, provider history,
-- an evidence chain or a replay cache: one row per (org, key), written once by
-- the TX-A reservation (INSERT ... ON CONFLICT DO NOTHING), never updated or
-- deleted by the application. The composite PRIMARY KEY is the single
-- PostgreSQL concurrency arbiter for the keyed-execution winner race.
--
-- No raw key. No request body. No metadata copy. No approval payload. No
-- native provider body. No TTL / expires_at / attempt_count / last_seen. No
-- automatic pruning. request_canonical_hash is the SHA-256 of the canonical
-- RunExecutionIntentV1 projection — NOT provider_invocations.native_request_hash,
-- which cannot encode the full GovAI logical intent.

SET ROLE govai_audit_writer;

CREATE TABLE IF NOT EXISTS govai.run_idempotency (
  org_id                 uuid        NOT NULL,
  idempotency_key_hash   bytea       NOT NULL CHECK (octet_length(idempotency_key_hash) = 32),
  request_canonical_hash bytea       NOT NULL CHECK (octet_length(request_canonical_hash) = 32),
  request_hash_version   smallint    NOT NULL CHECK (request_hash_version = 1),
  route_scope            text        NOT NULL CHECK (route_scope IN ('standalone','workroom')),
  run_id                 uuid        NOT NULL UNIQUE REFERENCES govai.runs(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, idempotency_key_hash)
);

ALTER TABLE govai.run_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.run_idempotency FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY run_idem_select_app ON govai.run_idempotency FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  CREATE POLICY run_idem_insert_app ON govai.run_idempotency FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Immutability by privilege: the application may only read and reserve.
-- Deliberately NO UPDATE / DELETE / TRUNCATE grant for govai_app — a committed
-- (org, key) → intent → run binding can never be overwritten to "fix" a
-- conflict.
GRANT SELECT, INSERT ON govai.run_idempotency TO govai_app;

RESET ROLE;
