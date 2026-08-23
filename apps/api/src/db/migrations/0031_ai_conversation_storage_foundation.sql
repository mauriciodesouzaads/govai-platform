-- Migration 0031 — AI Conversation storage + security foundation.
--
-- Mission:  EP-AI-CONVERSATION-CONTINUITY-V1-01
-- Movement: P0-A1-OPERATIONAL-STORAGE-CRYPTO-OWNER-RLS-FOUNDATION-01
-- Spec:     docs/architecture/ai-conversation-continuity-v1.md (§3 domain
--           model, §5 operational-vs-forensic, §6 encryption, §7 durable state
--           schema support, §14 evidence links, §19 lifecycle schema, §24 laws).
--
-- Creates the OPERATIONAL conversation domain (prefix `ai_`): storage,
-- cryptographic shape and owner-scoped database security ONLY. No runtime, no
-- routes, no runner, no worker role, no provider behavior ships here.
--
-- OWNERSHIP INVARIANT (LAW 1): every `ai_*` table carries BOTH `org_id` AND
-- `owner_user_id`; RLS (ENABLE + FORCE) requires BOTH `app.org_id` AND
-- `app.user_id` on every policy — a same-org different-owner session sees
-- nothing. Ownership is policy-enforced, never per-query WHERE discipline.
--
-- COMPOSITE LINEAGE (LAW 1): no security/causal pointer by id alone. Every
-- child references its parent through a composite key carrying the full
-- denormalized ancestry, so cross-owner and cross-conversation grafting are
-- structurally unrepresentable. The Turn↔Attempt circular reverse pointer
-- (`current_attempt_id`) is a nullable DEFERRABLE composite FK (§3's
-- sanctioned technique).
--
-- ENCRYPTION (LAW 12 / §6): content and titles exist ONLY as envelope
-- ciphertext (`conversation_content` KMS purpose) + a KEYED integrity digest
-- (`conversation_content_integrity` HMAC purpose). No plaintext body columns
-- exist. The disposal-ledger/attachment tables are NOT created here (later
-- movements own them; §3 records the ledger's lifecycle-independence rules).
--
-- GRANTS (least authority for THIS movement): govai_app gets SELECT + INSERT
-- only. No UPDATE/DELETE grant exists yet — the movements that implement
-- lifecycle mutation (P0-A2+) add their own narrowed grants + policies, the
-- 0013 workroom_tasks precedent. DELETE is deliberately NOT trigger-blocked:
-- LAW 13 makes purge a lawful future operation (unlike append-only audit
-- tables); it is simply not granted. TRUNCATE is trigger-blocked everywhere.
--
-- Recorded adjudications (source: dispatch §21 + spec §3/§16):
--   * `project_id` is DEFERRED — govai.projects does not exist, so no safe
--     composite (org_id, id) binding target exists; an unconstrained pointer
--     is forbidden (NO_SECURITY_OR_CAUSAL_POINTER_BY_ID_ALONE).
--   * `workroom_id` attribution is DEFERRED — govai.workrooms has an id-only
--     PK (0012) and no existing (org_id, id) composite identity to bind.
--   * `draft` is NOT an attempt state: §7's reservation commits `accepted`
--     with attempt 1 minted in the same transaction (§7.1b); `draft` never
--     exists durably.
--   * No worker role, no SECURITY DEFINER discovery functions here (P0-A2).
--
-- Conventions follow 0009/0012/0013/0029/0030: gen_random_uuid() PKs, RLS
-- ENABLE + FORCE, idempotent per-command policies, guard triggers with fixed
-- search_path, no FK to govai.orgs (and no users table exists — owner_user_id
-- stays a bare uuid, the 0012 rule).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. govai.provider_credentials — additive org-composite referenced identity
--
-- The PK is id-only (0009:25-27); a bare provider_credential_id FK could
-- cross tenants. The conversation domain references credentials ONLY through
-- (org_id, id). Purely additive: no column, policy, grant or trigger of 0009
-- changes; rotation/revocation behavior is untouched.
-- ===========================================================================

DO $$ BEGIN
  ALTER TABLE govai.provider_credentials
    ADD CONSTRAINT provider_credentials_org_id_id_uniq UNIQUE (org_id, id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- ===========================================================================
-- B. govai.ai_conversations — root container
--
-- `mode` is the IMMUTABLE execution lane (§3): a detached dispatch and a
-- post-reload resume must choose governed vs passthrough from durable state
-- alone. provider/surface/model are conversation DEFAULTS; the branch owns
-- the executing triple. Title is ciphertext-only with a KEYED digest (§6) —
-- there is no plaintext title column to misuse.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.ai_conversations (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid        NOT NULL,
  owner_user_id         uuid        NOT NULL,
  mode                  text        NOT NULL CHECK (mode IN ('governed', 'passthrough')),
  provider              text        NOT NULL
                          CHECK (provider IN ('openai', 'anthropic', 'codex', 'claude_code')),
  surface               text        NOT NULL,
  model                 text        NOT NULL,
  status                text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'archived', 'deleted_pending', 'deleted')),
  retention_class       text        NOT NULL DEFAULT 'standard',
  title_ciphertext      bytea       NULL,
  title_dek_wrapped     bytea       NULL,
  title_kms_key_id      text        NULL,
  title_kms_key_version integer     NULL,
  title_hmac            bytea       NULL
                          CHECK (title_hmac IS NULL OR octet_length(title_hmac) = 32),
  archived_at           timestamptz NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Referenced identity for every child's composite-lineage FK.
  CONSTRAINT ai_conversations_org_owner_id_uniq UNIQUE (org_id, owner_user_id, id),
  -- Encrypted-title group: all present or all absent — a row can never hold
  -- a digest without ciphertext (or vice versa).
  CONSTRAINT ai_conversations_title_group_check CHECK (
    (title_ciphertext IS NULL AND title_dek_wrapped IS NULL AND title_kms_key_id IS NULL
     AND title_kms_key_version IS NULL AND title_hmac IS NULL)
    OR
    (title_ciphertext IS NOT NULL AND title_dek_wrapped IS NOT NULL AND title_kms_key_id IS NOT NULL
     AND title_kms_key_version IS NOT NULL AND title_hmac IS NOT NULL)
  )
);

-- Owner conversation listing by status/recency (§13 keyset list, §24 dispatch).
CREATE INDEX IF NOT EXISTS ai_conversations_owner_list_idx
  ON govai.ai_conversations (org_id, owner_user_id, status, updated_at DESC);

-- ===========================================================================
-- C. govai.ai_conversation_branches — durable execution identity
--
-- The branch owns provider/surface/model (adapter selection reads the BRANCH,
-- §3) and the monotonic `causal_version` (§7.8). Fork columns are all-NULL on
-- the root branch and all-set on a fork; the fork FK pins a SPECIFIC attempt
-- through one composite constraint (added in section I, after attempts
-- exists). Exactly one root branch per conversation.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.ai_conversation_branches (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid        NOT NULL,
  owner_user_id          uuid        NOT NULL,
  conversation_id        uuid        NOT NULL,
  provider               text        NOT NULL
                           CHECK (provider IN ('openai', 'anthropic', 'codex', 'claude_code')),
  surface                text        NOT NULL,
  model                  text        NOT NULL,
  causal_version         bigint      NOT NULL DEFAULT 0 CHECK (causal_version >= 0),
  parent_branch_id       uuid        NULL,
  forked_from_turn_id    uuid        NULL,
  forked_from_attempt_id uuid        NULL,
  boundary_mode          text        NULL
                           CHECK (boundary_mode IN ('after_attempt', 'before_attempt_output')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_conversation_branches_conv_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id)
    REFERENCES govai.ai_conversations (org_id, owner_user_id, id),
  CONSTRAINT ai_conversation_branches_lineage_uniq
    UNIQUE (org_id, owner_user_id, conversation_id, id),
  -- Root branch: fork columns all NULL. Fork: all set (§3 CHECK rule).
  CONSTRAINT ai_conversation_branches_fork_shape_check CHECK (
    (parent_branch_id IS NULL AND forked_from_turn_id IS NULL
     AND forked_from_attempt_id IS NULL AND boundary_mode IS NULL)
    OR
    (parent_branch_id IS NOT NULL AND forked_from_turn_id IS NOT NULL
     AND forked_from_attempt_id IS NOT NULL AND boundary_mode IS NOT NULL)
  )
);

-- Exactly one root branch per conversation.
CREATE UNIQUE INDEX IF NOT EXISTS ai_conversation_branches_root_uniq
  ON govai.ai_conversation_branches (org_id, owner_user_id, conversation_id)
  WHERE parent_branch_id IS NULL;

-- ===========================================================================
-- D. govai.ai_conversation_content — domain-owned encrypted blob store
--
-- The provider_credentials "encrypted blob" template (0009:25-38) + the
-- audit_event_payloads status machine (0001:69-81). Envelope purpose is
-- `conversation_content`; `content_hmac` is Kms.hmacSha256 under
-- `conversation_content_integrity` — NEVER raw sha256(plaintext) (§6: a raw
-- deterministic hash beside ciphertext enables offline confirmation attacks
-- on low-entropy content). Crypto-shred nulls dek_wrapped ONLY.
-- Ancestry: conversation-level (§3 — items bind content to turn/attempt).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.ai_conversation_content (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL,
  owner_user_id   uuid        NOT NULL,
  conversation_id uuid        NOT NULL,
  ciphertext      bytea       NOT NULL,
  dek_wrapped     bytea       NULL,
  kms_key_id      text        NOT NULL,
  kms_key_version integer     NOT NULL,
  content_hmac    bytea       NOT NULL CHECK (octet_length(content_hmac) = 32),
  status          text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'crypto_shredded', 'tombstoned')),
  shredded_at     timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_conversation_content_conv_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id)
    REFERENCES govai.ai_conversations (org_id, owner_user_id, id),
  CONSTRAINT ai_conversation_content_lineage_uniq
    UNIQUE (org_id, owner_user_id, conversation_id, id),
  CONSTRAINT ai_conversation_content_status_consistency CHECK (
    (status = 'active'          AND shredded_at IS NULL     AND dek_wrapped IS NOT NULL) OR
    (status = 'crypto_shredded' AND shredded_at IS NOT NULL AND dek_wrapped IS NULL) OR
    (status = 'tombstoned'      AND shredded_at IS NOT NULL)
  )
);

-- ===========================================================================
-- E. govai.ai_conversation_turns — one user send on a branch
--
-- TURN OWNS INPUT (LAW 2): reservation identity (`client_turn_id`, the §8
-- arbiter), per-branch ordering (`turn_seq`), the immutable native request
-- config (an encrypted content row — a detached claimant must reconstruct
-- the POST from durable state alone), and the `current_attempt_id` reverse
-- pointer (CURRENT_ATTEMPT_LINEAGE_BINDING, FK added in section I). The turn
-- carries NO lifecycle state — the attempt is authoritative (§3).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.ai_conversation_turns (
  id                               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                           uuid        NOT NULL,
  owner_user_id                    uuid        NOT NULL,
  conversation_id                  uuid        NOT NULL,
  branch_id                        uuid        NOT NULL,
  client_turn_id                   uuid        NOT NULL,
  turn_seq                         bigint      NOT NULL CHECK (turn_seq >= 1),
  current_attempt_id               uuid        NULL,
  native_request_config_content_id uuid        NOT NULL,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_conversation_turns_branch_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id, branch_id)
    REFERENCES govai.ai_conversation_branches (org_id, owner_user_id, conversation_id, id),
  -- §8 idempotency arbiter — the run_idempotency composite-key pattern.
  CONSTRAINT ai_conversation_turns_client_turn_uniq
    UNIQUE (org_id, conversation_id, client_turn_id),
  CONSTRAINT ai_conversation_turns_turn_seq_uniq
    UNIQUE (org_id, owner_user_id, conversation_id, branch_id, turn_seq),
  -- Referenced identity for attempts' composite-lineage FK.
  CONSTRAINT ai_conversation_turns_lineage_uniq
    UNIQUE (org_id, owner_user_id, conversation_id, branch_id, id),
  CONSTRAINT ai_conversation_turns_config_content_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id, native_request_config_content_id)
    REFERENCES govai.ai_conversation_content (org_id, owner_user_id, conversation_id, id)
);

-- ===========================================================================
-- F. govai.ai_conversation_attempts — THE authoritative execution lifecycle
--
-- ATTEMPT OWNS OUTPUT + EXECUTION (LAW 2/§3): the §7 state machine, the
-- claim (lease + fencing, LAW 7), the durable stop flag, causal-version-at-
-- build, `govai_request_id`/`capture_id` (§14), the ORG-COMPOSITE dispatch
-- credential provenance (commit 4's durable POST-possibility proof, §8), and
-- the encrypted continuation anchor (§11 retry mechanics; §21 classifies
-- provider identifiers as sensitive → ciphertext, never plaintext).
-- This movement creates the SCHEMA only: no claim/runner behavior ships.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.ai_conversation_attempts (
  id                                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                              uuid        NOT NULL,
  owner_user_id                       uuid        NOT NULL,
  conversation_id                     uuid        NOT NULL,
  branch_id                           uuid        NOT NULL,
  turn_id                             uuid        NOT NULL,
  attempt_seq                         integer     NOT NULL CHECK (attempt_seq >= 1),
  state                               text        NOT NULL DEFAULT 'accepted'
                                        CHECK (state IN
                                          ('accepted', 'dispatching', 'streaming', 'completed',
                                           'stopped', 'failed', 'rejected', 'outcome_unknown')),
  claim_token                         uuid        NULL,
  claimant                            text        NULL,
  claim_deadline_at                   timestamptz NULL,
  heartbeat_at                        timestamptz NULL,
  stop_requested                      boolean     NOT NULL DEFAULT false,
  causal_version_at_build             bigint      NULL,
  govai_request_id                    uuid        NULL,
  capture_id                          uuid        NULL,
  provider_credential_id              uuid        NULL,
  dispatch_boundary_committed_at      timestamptz NULL,
  continuation_parent_ciphertext      bytea       NULL,
  continuation_parent_dek_wrapped     bytea       NULL,
  continuation_parent_kms_key_id      text        NULL,
  continuation_parent_kms_key_version integer     NULL,
  context_excluded                    boolean     NOT NULL DEFAULT false,
  error_class                         text        NULL
                                        CHECK (error_class IS NULL OR error_class IN
                                          ('blocked', 'auth_rejected', 'request_too_large',
                                           'rate_limited', 'credential_unavailable',
                                           'provider_error')),
  terminal_at                         timestamptz NULL,
  created_at                          timestamptz NOT NULL DEFAULT now(),
  updated_at                          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_conversation_attempts_turn_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id, branch_id, turn_id)
    REFERENCES govai.ai_conversation_turns (org_id, owner_user_id, conversation_id, branch_id, id),
  CONSTRAINT ai_conversation_attempts_attempt_seq_uniq
    UNIQUE (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq),
  -- Referenced identity for current_attempt_id, the fork pin, items and links.
  CONSTRAINT ai_conversation_attempts_lineage_uniq
    UNIQUE (org_id, owner_user_id, conversation_id, branch_id, turn_id, id),
  -- Org-composite credential provenance (§17 of the movement): an attempt for
  -- org A structurally cannot reference org B's credential.
  CONSTRAINT ai_conversation_attempts_credential_fk
    FOREIGN KEY (org_id, provider_credential_id)
    REFERENCES govai.provider_credentials (org_id, id),
  -- Claim triple is all-or-none (§7.7: UNCLAIMED vs ACTIVELY CLAIMED).
  CONSTRAINT ai_conversation_attempts_claim_shape_check CHECK (
    ((claim_token IS NULL) = (claimant IS NULL))
    AND ((claim_token IS NULL) = (claim_deadline_at IS NULL))
  ),
  -- dispatching/streaming are always claimed and always post-boundary (§7.7).
  CONSTRAINT ai_conversation_attempts_post_boundary_claim_check CHECK (
    state NOT IN ('dispatching', 'streaming')
    OR (claim_token IS NOT NULL AND dispatch_boundary_committed_at IS NOT NULL)
  ),
  -- Ratchet states carry their ratchet timestamp.
  CONSTRAINT ai_conversation_attempts_terminal_at_check CHECK (
    state NOT IN ('completed', 'stopped', 'failed', 'rejected', 'outcome_unknown')
    OR terminal_at IS NOT NULL
  ),
  -- failed carries the classified error taxonomy (§7.4).
  CONSTRAINT ai_conversation_attempts_failed_class_check CHECK (
    state <> 'failed' OR error_class IS NOT NULL
  ),
  -- outcome_unknown is post-boundary by definition (§7.7): pre-boundary
  -- ambiguity is provably-undispatched and resolves to re-drive or stopped.
  CONSTRAINT ai_conversation_attempts_unknown_boundary_check CHECK (
    state <> 'outcome_unknown' OR dispatch_boundary_committed_at IS NOT NULL
  ),
  -- Credential provenance is committed inside the dispatching window (§8
  -- commit 4): provenance present implies the boundary was crossed.
  CONSTRAINT ai_conversation_attempts_provenance_boundary_check CHECK (
    provider_credential_id IS NULL OR dispatch_boundary_committed_at IS NOT NULL
  ),
  -- Encrypted continuation-anchor group: all present or all absent.
  CONSTRAINT ai_conversation_attempts_continuation_group_check CHECK (
    (continuation_parent_ciphertext IS NULL AND continuation_parent_dek_wrapped IS NULL
     AND continuation_parent_kms_key_id IS NULL AND continuation_parent_kms_key_version IS NULL)
    OR
    (continuation_parent_ciphertext IS NOT NULL AND continuation_parent_dek_wrapped IS NOT NULL
     AND continuation_parent_kms_key_id IS NOT NULL AND continuation_parent_kms_key_version IS NOT NULL)
  )
);

-- Recovery scans (§7.7 sweep; §24 dispatch): claimed-work deadlines and
-- unclaimed head pickup both read state + deadline.
CREATE INDEX IF NOT EXISTS ai_conversation_attempts_recovery_idx
  ON govai.ai_conversation_attempts (state, claim_deadline_at)
  WHERE state IN ('accepted', 'dispatching', 'streaming');

-- ===========================================================================
-- G. govai.ai_conversation_items — provider-native typed items
--
-- Explicit OWNER discriminator (§3): attempt_id NULL = TURN-owned user/input
-- items (committed at reservation, survive every retry); attempt_id set =
-- ATTEMPT-owned output. Content lives in ai_conversation_content (encrypted);
-- the item row carries only structural metadata.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.ai_conversation_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL,
  owner_user_id   uuid        NOT NULL,
  conversation_id uuid        NOT NULL,
  branch_id       uuid        NOT NULL,
  turn_id         uuid        NOT NULL,
  attempt_id      uuid        NULL,
  item_seq        integer     NOT NULL CHECK (item_seq >= 1),
  item_type       text        NOT NULL,
  content_id      uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_conversation_items_turn_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id, branch_id, turn_id)
    REFERENCES govai.ai_conversation_turns (org_id, owner_user_id, conversation_id, branch_id, id),
  -- Enforced only when attempt_id IS NOT NULL (MATCH SIMPLE): an output item
  -- structurally belongs to an attempt of ITS OWN turn.
  CONSTRAINT ai_conversation_items_attempt_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id)
    REFERENCES govai.ai_conversation_attempts
      (org_id, owner_user_id, conversation_id, branch_id, turn_id, id),
  CONSTRAINT ai_conversation_items_content_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id, content_id)
    REFERENCES govai.ai_conversation_content (org_id, owner_user_id, conversation_id, id)
);

-- Ordering is unique per owner scope: turn-owned and attempt-owned items
-- each keep their own dense sequence (partial-unique house pattern).
CREATE UNIQUE INDEX IF NOT EXISTS ai_conversation_items_turn_owned_seq_uniq
  ON govai.ai_conversation_items
     (org_id, owner_user_id, conversation_id, branch_id, turn_id, item_seq)
  WHERE attempt_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_conversation_items_attempt_owned_seq_uniq
  ON govai.ai_conversation_items
     (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id, item_seq)
  WHERE attempt_id IS NOT NULL;

-- ===========================================================================
-- H. govai.ai_conversation_provider_state — per-branch continuation state
--
-- Adapter-owned opaque state (§11), ENCRYPTED (§21: provider identifiers are
-- sensitive). Carries `seeded_at_causal_version` (staleness binding, §3) and
-- IMMUTABLE org-composite credential provenance (provider objects are
-- account-scoped; cleanup must resolve the HISTORICAL credential, §19.3).
-- Rotation supersedes rows (status), it never rewrites provenance.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.ai_conversation_provider_state (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid        NOT NULL,
  owner_user_id            uuid        NOT NULL,
  conversation_id          uuid        NOT NULL,
  branch_id                uuid        NOT NULL,
  state_ciphertext         bytea       NOT NULL,
  state_dek_wrapped        bytea       NOT NULL,
  kms_key_id               text        NOT NULL,
  kms_key_version          integer     NOT NULL,
  seeded_at_causal_version bigint      NOT NULL CHECK (seeded_at_causal_version >= 0),
  provider_credential_id   uuid        NOT NULL,
  status                   text        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'superseded')),
  tainted                  boolean     NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_conversation_provider_state_branch_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id, branch_id)
    REFERENCES govai.ai_conversation_branches (org_id, owner_user_id, conversation_id, id),
  CONSTRAINT ai_conversation_provider_state_credential_fk
    FOREIGN KEY (org_id, provider_credential_id)
    REFERENCES govai.provider_credentials (org_id, id)
);

-- At most one ACTIVE continuation state per branch (single fenced writer, §7.7).
CREATE UNIQUE INDEX IF NOT EXISTS ai_conversation_provider_state_active_uniq
  ON govai.ai_conversation_provider_state (org_id, owner_user_id, conversation_id, branch_id)
  WHERE status = 'active';

-- ===========================================================================
-- I. Deferred composite FKs closing the Turn↔Attempt / Branch↔Attempt circles
-- ===========================================================================

-- CURRENT_ATTEMPT_LINEAGE_BINDING (§3): the reverse pointer that controls
-- context eligibility is composite-bound exactly like the forward chain — a
-- turn structurally CANNOT select another turn's (or owner's, or org's)
-- attempt. Nullable + DEFERRABLE INITIALLY IMMEDIATE: the sanctioned §3
-- technique for the intentionally-circular relationship (a transaction may
-- SET CONSTRAINTS DEFERRED to mint turn+attempt+pointer atomically).
DO $$ BEGIN
  ALTER TABLE govai.ai_conversation_turns
    ADD CONSTRAINT ai_conversation_turns_current_attempt_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id, branch_id, id, current_attempt_id)
    REFERENCES govai.ai_conversation_attempts
      (org_id, owner_user_id, conversation_id, branch_id, turn_id, id)
    DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Fork pin (§3): one composite FK simultaneously forces the fork point to the
-- SAME conversation, the DECLARED parent branch, the named turn and a
-- SPECIFIC attempt whose items never change. MATCH SIMPLE: inert on root
-- branches (fork columns NULL), fully enforced on forks (shape CHECK above).
DO $$ BEGIN
  ALTER TABLE govai.ai_conversation_branches
    ADD CONSTRAINT ai_conversation_branches_fork_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id, parent_branch_id,
                 forked_from_turn_id, forked_from_attempt_id)
    REFERENCES govai.ai_conversation_attempts
      (org_id, owner_user_id, conversation_id, branch_id, turn_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- J. govai.ai_conversation_evidence_links — link, never copy (§14)
--
-- Additive operational projection attempt → {govai_request_id, capture_id,
-- audit_event_id?}. `audit_event_id` is a PLAIN VALUE (no FK into the
-- evidence plane — the link asserts identity assignment, never evidence
-- existence, and the forensic store stays untouched; the 0013 payload_ref
-- precedent). One link row per attempt.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.ai_conversation_evidence_links (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL,
  owner_user_id    uuid        NOT NULL,
  conversation_id  uuid        NOT NULL,
  branch_id        uuid        NOT NULL,
  turn_id          uuid        NOT NULL,
  attempt_id       uuid        NOT NULL,
  govai_request_id uuid        NOT NULL,
  capture_id       uuid        NOT NULL,
  audit_event_id   uuid        NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_conversation_evidence_links_attempt_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id)
    REFERENCES govai.ai_conversation_attempts
      (org_id, owner_user_id, conversation_id, branch_id, turn_id, id),
  CONSTRAINT ai_conversation_evidence_links_attempt_uniq
    UNIQUE (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id)
);

-- Correlation lookup by request identity (§14).
CREATE INDEX IF NOT EXISTS ai_conversation_evidence_links_request_idx
  ON govai.ai_conversation_evidence_links (org_id, govai_request_id);

-- ===========================================================================
-- K. Guard triggers — immutability by structure, not query discipline
--
-- The 0015:132-165 guarded-update shape: identity/lineage/causal columns are
-- frozen for EVERY role; mutable columns are whitelisted per table. UPDATE is
-- not granted to govai_app in P0-A1 — these triggers are defense-in-depth for
-- the owner path and for every future grant.
-- ===========================================================================

-- ai_conversations: identity + immutable execution mode + defaults frozen.
CREATE OR REPLACE FUNCTION govai.ai_conversations_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
    AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id
    AND NEW.mode IS NOT DISTINCT FROM OLD.mode
    AND NEW.provider IS NOT DISTINCT FROM OLD.provider
    AND NEW.surface IS NOT DISTINCT FROM OLD.surface
    AND NEW.model IS NOT DISTINCT FROM OLD.model
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ai_conversations update is restricted to status/title/retention/archive/updated_at columns'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS ai_conversations_guarded_update_trg ON govai.ai_conversations;
CREATE TRIGGER ai_conversations_guarded_update_trg
  BEFORE UPDATE ON govai.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION govai.ai_conversations_guarded_update();

-- ai_conversation_branches: only causal_version (monotonic, LAW 3) and
-- updated_at may change. Execution identity and fork pins are frozen.
CREATE OR REPLACE FUNCTION govai.ai_conversation_branches_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
    AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id
    AND NEW.conversation_id IS NOT DISTINCT FROM OLD.conversation_id
    AND NEW.provider IS NOT DISTINCT FROM OLD.provider
    AND NEW.surface IS NOT DISTINCT FROM OLD.surface
    AND NEW.model IS NOT DISTINCT FROM OLD.model
    AND NEW.parent_branch_id IS NOT DISTINCT FROM OLD.parent_branch_id
    AND NEW.forked_from_turn_id IS NOT DISTINCT FROM OLD.forked_from_turn_id
    AND NEW.forked_from_attempt_id IS NOT DISTINCT FROM OLD.forked_from_attempt_id
    AND NEW.boundary_mode IS NOT DISTINCT FROM OLD.boundary_mode
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND NEW.causal_version >= OLD.causal_version
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ai_conversation_branches update is restricted to a monotonic causal_version bump + updated_at'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS ai_conversation_branches_guarded_update_trg
  ON govai.ai_conversation_branches;
CREATE TRIGGER ai_conversation_branches_guarded_update_trg
  BEFORE UPDATE ON govai.ai_conversation_branches
  FOR EACH ROW EXECUTE FUNCTION govai.ai_conversation_branches_guarded_update();

-- ai_conversation_turns: ONLY current_attempt_id (the §7.6 atomic eligibility
-- handoff) may change. Turn input identity is immutable from the reservation.
CREATE OR REPLACE FUNCTION govai.ai_conversation_turns_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
    AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id
    AND NEW.conversation_id IS NOT DISTINCT FROM OLD.conversation_id
    AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
    AND NEW.client_turn_id IS NOT DISTINCT FROM OLD.client_turn_id
    AND NEW.turn_seq IS NOT DISTINCT FROM OLD.turn_seq
    AND NEW.native_request_config_content_id IS NOT DISTINCT FROM OLD.native_request_config_content_id
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ai_conversation_turns update is restricted to current_attempt_id'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS ai_conversation_turns_guarded_update_trg ON govai.ai_conversation_turns;
CREATE TRIGGER ai_conversation_turns_guarded_update_trg
  BEFORE UPDATE ON govai.ai_conversation_turns
  FOR EACH ROW EXECUTE FUNCTION govai.ai_conversation_turns_guarded_update();

-- ai_conversation_attempts: identity/lineage frozen; per-attempt ratchets
-- enforced structurally (§7.6): a terminal state never un-ratchets;
-- outcome_unknown may resolve ONCE to completed/failed (probe upgrade);
-- provenance and govai_request_id are write-once; context_excluded and
-- stop_requested never clear.
CREATE OR REPLACE FUNCTION govai.ai_conversation_attempts_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
    OR NEW.turn_id IS DISTINCT FROM OLD.turn_id
    OR NEW.attempt_seq IS DISTINCT FROM OLD.attempt_seq
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'ai_conversation_attempts identity/lineage columns are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- §7.6 per-attempt ratchet: completed/stopped/failed/rejected are final.
  IF OLD.state IN ('completed', 'stopped', 'failed', 'rejected')
    AND NEW.state IS DISTINCT FROM OLD.state
  THEN
    RAISE EXCEPTION 'ai_conversation_attempts: terminal state % is a ratchet', OLD.state
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- outcome_unknown resolves only via a recovery probe, only to completed/failed.
  IF OLD.state = 'outcome_unknown'
    AND NEW.state IS DISTINCT FROM OLD.state
    AND NEW.state NOT IN ('completed', 'failed')
  THEN
    RAISE EXCEPTION 'ai_conversation_attempts: outcome_unknown may only resolve to completed/failed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Write-once identity/provenance (§8 commit 4 / §14.1 mint-if-null).
  IF OLD.provider_credential_id IS NOT NULL
    AND NEW.provider_credential_id IS DISTINCT FROM OLD.provider_credential_id
  THEN
    RAISE EXCEPTION 'ai_conversation_attempts: provider_credential_id provenance is write-once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.govai_request_id IS NOT NULL
    AND NEW.govai_request_id IS DISTINCT FROM OLD.govai_request_id
  THEN
    RAISE EXCEPTION 'ai_conversation_attempts: govai_request_id is write-once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Durable one-way flags (§7.8 / §13).
  IF OLD.context_excluded AND NOT NEW.context_excluded THEN
    RAISE EXCEPTION 'ai_conversation_attempts: context_excluded is permanent'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.stop_requested AND NOT NEW.stop_requested THEN
    RAISE EXCEPTION 'ai_conversation_attempts: stop_requested never clears'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_conversation_attempts_guarded_update_trg
  ON govai.ai_conversation_attempts;
CREATE TRIGGER ai_conversation_attempts_guarded_update_trg
  BEFORE UPDATE ON govai.ai_conversation_attempts
  FOR EACH ROW EXECUTE FUNCTION govai.ai_conversation_attempts_guarded_update();

-- ai_conversation_items: append-only in place — no UPDATE on any path (row
-- removal is the §19 purge, a later movement's DELETE authority).
CREATE OR REPLACE FUNCTION govai.ai_conversation_items_no_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'ai_conversation_items are immutable (append-only until purge)'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS ai_conversation_items_no_update_trg ON govai.ai_conversation_items;
CREATE TRIGGER ai_conversation_items_no_update_trg
  BEFORE UPDATE ON govai.ai_conversation_items
  FOR EACH ROW EXECUTE FUNCTION govai.ai_conversation_items_no_update();

-- ai_conversation_content: only the crypto-shred/tombstone lifecycle may
-- mutate (status, shredded_at, dek_wrapped→NULL). Ciphertext, digest and key
-- binding are frozen; a wrapped DEK can be destroyed, never replaced.
CREATE OR REPLACE FUNCTION govai.ai_conversation_content_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
    AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id
    AND NEW.conversation_id IS NOT DISTINCT FROM OLD.conversation_id
    AND NEW.ciphertext IS NOT DISTINCT FROM OLD.ciphertext
    AND NEW.kms_key_id IS NOT DISTINCT FROM OLD.kms_key_id
    AND NEW.kms_key_version IS NOT DISTINCT FROM OLD.kms_key_version
    AND NEW.content_hmac IS NOT DISTINCT FROM OLD.content_hmac
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND (NEW.dek_wrapped IS NOT DISTINCT FROM OLD.dek_wrapped OR NEW.dek_wrapped IS NULL)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ai_conversation_content update is restricted to the shred/tombstone lifecycle'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS ai_conversation_content_guarded_update_trg
  ON govai.ai_conversation_content;
CREATE TRIGGER ai_conversation_content_guarded_update_trg
  BEFORE UPDATE ON govai.ai_conversation_content
  FOR EACH ROW EXECUTE FUNCTION govai.ai_conversation_content_guarded_update();

-- ai_conversation_provider_state: state payload/lifecycle mutable; lineage,
-- credential PROVENANCE (§19.3) and the seed version binding are frozen.
CREATE OR REPLACE FUNCTION govai.ai_conversation_provider_state_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
    AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id
    AND NEW.conversation_id IS NOT DISTINCT FROM OLD.conversation_id
    AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
    AND NEW.provider_credential_id IS NOT DISTINCT FROM OLD.provider_credential_id
    AND NEW.seeded_at_causal_version IS NOT DISTINCT FROM OLD.seeded_at_causal_version
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ai_conversation_provider_state lineage/provenance/seed-version columns are immutable'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS ai_conversation_provider_state_guarded_update_trg
  ON govai.ai_conversation_provider_state;
CREATE TRIGGER ai_conversation_provider_state_guarded_update_trg
  BEFORE UPDATE ON govai.ai_conversation_provider_state
  FOR EACH ROW EXECUTE FUNCTION govai.ai_conversation_provider_state_guarded_update();

-- ai_conversation_evidence_links: the ONLY admissible mutation is the
-- one-way audit_event_id fill (NULL → value) once sealing is observed (§14).
CREATE OR REPLACE FUNCTION govai.ai_conversation_evidence_links_guarded_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
    AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id
    AND NEW.conversation_id IS NOT DISTINCT FROM OLD.conversation_id
    AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
    AND NEW.turn_id IS NOT DISTINCT FROM OLD.turn_id
    AND NEW.attempt_id IS NOT DISTINCT FROM OLD.attempt_id
    AND NEW.govai_request_id IS NOT DISTINCT FROM OLD.govai_request_id
    AND NEW.capture_id IS NOT DISTINCT FROM OLD.capture_id
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND (NEW.audit_event_id IS NOT DISTINCT FROM OLD.audit_event_id
         OR (OLD.audit_event_id IS NULL AND NEW.audit_event_id IS NOT NULL))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ai_conversation_evidence_links update is restricted to the one-way audit_event_id fill'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS ai_conversation_evidence_links_guarded_update_trg
  ON govai.ai_conversation_evidence_links;
CREATE TRIGGER ai_conversation_evidence_links_guarded_update_trg
  BEFORE UPDATE ON govai.ai_conversation_evidence_links
  FOR EACH ROW EXECUTE FUNCTION govai.ai_conversation_evidence_links_guarded_update();

-- TRUNCATE is blocked on the whole domain, every path (shared function).
CREATE OR REPLACE FUNCTION govai.ai_conversation_domain_no_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'ai_conversation domain: TRUNCATE blocked'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS ai_conversations_no_truncate_trg ON govai.ai_conversations;
CREATE TRIGGER ai_conversations_no_truncate_trg
  BEFORE TRUNCATE ON govai.ai_conversations
  FOR EACH STATEMENT EXECUTE FUNCTION govai.ai_conversation_domain_no_truncate();

DROP TRIGGER IF EXISTS ai_conversation_branches_no_truncate_trg
  ON govai.ai_conversation_branches;
CREATE TRIGGER ai_conversation_branches_no_truncate_trg
  BEFORE TRUNCATE ON govai.ai_conversation_branches
  FOR EACH STATEMENT EXECUTE FUNCTION govai.ai_conversation_domain_no_truncate();

DROP TRIGGER IF EXISTS ai_conversation_turns_no_truncate_trg ON govai.ai_conversation_turns;
CREATE TRIGGER ai_conversation_turns_no_truncate_trg
  BEFORE TRUNCATE ON govai.ai_conversation_turns
  FOR EACH STATEMENT EXECUTE FUNCTION govai.ai_conversation_domain_no_truncate();

DROP TRIGGER IF EXISTS ai_conversation_attempts_no_truncate_trg
  ON govai.ai_conversation_attempts;
CREATE TRIGGER ai_conversation_attempts_no_truncate_trg
  BEFORE TRUNCATE ON govai.ai_conversation_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION govai.ai_conversation_domain_no_truncate();

DROP TRIGGER IF EXISTS ai_conversation_items_no_truncate_trg ON govai.ai_conversation_items;
CREATE TRIGGER ai_conversation_items_no_truncate_trg
  BEFORE TRUNCATE ON govai.ai_conversation_items
  FOR EACH STATEMENT EXECUTE FUNCTION govai.ai_conversation_domain_no_truncate();

DROP TRIGGER IF EXISTS ai_conversation_content_no_truncate_trg
  ON govai.ai_conversation_content;
CREATE TRIGGER ai_conversation_content_no_truncate_trg
  BEFORE TRUNCATE ON govai.ai_conversation_content
  FOR EACH STATEMENT EXECUTE FUNCTION govai.ai_conversation_domain_no_truncate();

DROP TRIGGER IF EXISTS ai_conversation_provider_state_no_truncate_trg
  ON govai.ai_conversation_provider_state;
CREATE TRIGGER ai_conversation_provider_state_no_truncate_trg
  BEFORE TRUNCATE ON govai.ai_conversation_provider_state
  FOR EACH STATEMENT EXECUTE FUNCTION govai.ai_conversation_domain_no_truncate();

DROP TRIGGER IF EXISTS ai_conversation_evidence_links_no_truncate_trg
  ON govai.ai_conversation_evidence_links;
CREATE TRIGGER ai_conversation_evidence_links_no_truncate_trg
  BEFORE TRUNCATE ON govai.ai_conversation_evidence_links
  FOR EACH STATEMENT EXECUTE FUNCTION govai.ai_conversation_domain_no_truncate();

-- ===========================================================================
-- L. RLS — ENABLE + FORCE, DUAL-PREDICATE policies (org AND owner)
--
-- Every policy requires BOTH transaction-local GUCs. Missing either one (or
-- both) yields zero rows — never an error, never a neighbour's data. Only
-- govai_app has policies in P0-A1: no broad reader identity exists for this
-- domain (§22 forbidden coupling 8), and the worker role is P0-A2.
-- ===========================================================================

ALTER TABLE govai.ai_conversations                ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversations                FORCE  ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_branches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_branches       FORCE  ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_turns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_turns          FORCE  ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_attempts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_attempts       FORCE  ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_items          FORCE  ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_content        ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_content        FORCE  ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_provider_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_provider_state FORCE  ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_evidence_links FORCE  ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY ai_conversations_select_app ON govai.ai_conversations
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversations_insert_app ON govai.ai_conversations
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_branches_select_app ON govai.ai_conversation_branches
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_branches_insert_app ON govai.ai_conversation_branches
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_turns_select_app ON govai.ai_conversation_turns
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_turns_insert_app ON govai.ai_conversation_turns
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_attempts_select_app ON govai.ai_conversation_attempts
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_attempts_insert_app ON govai.ai_conversation_attempts
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_items_select_app ON govai.ai_conversation_items
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_items_insert_app ON govai.ai_conversation_items
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_content_select_app ON govai.ai_conversation_content
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_content_insert_app ON govai.ai_conversation_content
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_provider_state_select_app ON govai.ai_conversation_provider_state
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_provider_state_insert_app ON govai.ai_conversation_provider_state
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_evidence_links_select_app ON govai.ai_conversation_evidence_links
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_evidence_links_insert_app ON govai.ai_conversation_evidence_links
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- M. Grants — least authority for P0-A1 (SELECT + INSERT only)
-- ===========================================================================

REVOKE ALL ON govai.ai_conversations                FROM PUBLIC;
REVOKE ALL ON govai.ai_conversation_branches       FROM PUBLIC;
REVOKE ALL ON govai.ai_conversation_turns          FROM PUBLIC;
REVOKE ALL ON govai.ai_conversation_attempts       FROM PUBLIC;
REVOKE ALL ON govai.ai_conversation_items          FROM PUBLIC;
REVOKE ALL ON govai.ai_conversation_content        FROM PUBLIC;
REVOKE ALL ON govai.ai_conversation_provider_state FROM PUBLIC;
REVOKE ALL ON govai.ai_conversation_evidence_links FROM PUBLIC;

GRANT SELECT, INSERT ON govai.ai_conversations                TO govai_app;
GRANT SELECT, INSERT ON govai.ai_conversation_branches       TO govai_app;
GRANT SELECT, INSERT ON govai.ai_conversation_turns          TO govai_app;
GRANT SELECT, INSERT ON govai.ai_conversation_attempts       TO govai_app;
GRANT SELECT, INSERT ON govai.ai_conversation_items          TO govai_app;
GRANT SELECT, INSERT ON govai.ai_conversation_content        TO govai_app;
GRANT SELECT, INSERT ON govai.ai_conversation_provider_state TO govai_app;
GRANT SELECT, INSERT ON govai.ai_conversation_evidence_links TO govai_app;

RESET ROLE;
