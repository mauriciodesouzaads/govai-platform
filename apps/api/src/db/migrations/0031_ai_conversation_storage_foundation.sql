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
  -- ── §7/§8 state × authority × provenance implication matrix ──────────────
  -- Durable notation, used by every constraint below and by the runner's own
  -- safety proofs (§7.7/§9.4 — the proofs cite these predicates, so they must
  -- exist IN the schema, never as narrative):
  --   B := dispatch_boundary_committed_at IS NOT NULL   (the §8 third commit
  --        happened — a provider POST is POSSIBLE from here on, never before)
  --   P := provider_credential_id IS NOT NULL           (the §8 fourth commit
  --        happened — commit 4 precedes EVERY POST, so ¬P is the durable
  --        provably-no-POST proof the restore paths rely on)
  -- dispatching/streaming are always claimed and always post-boundary (§7.7).
  CONSTRAINT ai_conversation_attempts_post_boundary_claim_check CHECK (
    state NOT IN ('dispatching', 'streaming')
    OR (claim_token IS NOT NULL AND dispatch_boundary_committed_at IS NOT NULL)
  ),
  -- completed ⟹ B: completed is reachable only through the boundary (§8).
  CONSTRAINT ai_conversation_attempts_completed_boundary_check CHECK (
    state <> 'completed' OR dispatch_boundary_committed_at IS NOT NULL
  ),
  -- streaming|completed ⟹ P: a stream or terminal frame proves a POST, and
  -- commit 4 precedes every POST (§8/§9.4).
  CONSTRAINT ai_conversation_attempts_post_dispatch_provenance_check CHECK (
    state NOT IN ('streaming', 'completed') OR provider_credential_id IS NOT NULL
  ),
  -- outcome_unknown ⟹ P: provenance-absent ambiguity is provably undispatched
  -- and NEVER lands in outcome_unknown — it restores to accepted or ratchets
  -- stopped (§7.7 provenance-absent arm, §25 CRASH POST-BOUNDARY, §26 AD).
  CONSTRAINT ai_conversation_attempts_unknown_provenance_check CHECK (
    state <> 'outcome_unknown' OR provider_credential_id IS NOT NULL
  ),
  -- accepted ⟹ ¬P: every sanctioned restore to accepted carries provenance
  -- absence as its durable no-POST proof (§7.7/§9.4) — an accepted attempt
  -- with provenance would be re-dispatchable after a possible POST.
  CONSTRAINT ai_conversation_attempts_accepted_no_provenance_check CHECK (
    state <> 'accepted' OR provider_credential_id IS NULL
  ),
  -- capture_id ⟹ govai_request_id: the capture id is uuidv5-DERIVED from the
  -- request id (§14.2) and cannot exist without it.
  CONSTRAINT ai_conversation_attempts_capture_requires_request_check CHECK (
    capture_id IS NULL OR govai_request_id IS NOT NULL
  ),
  -- govai_request_id ⟹ B: the ONE authoritative mint site is the
  -- dispatch-boundary commit (§14.1).
  CONSTRAINT ai_conversation_attempts_request_boundary_check CHECK (
    govai_request_id IS NULL OR dispatch_boundary_committed_at IS NOT NULL
  ),
  -- Ratchet states carry their ratchet timestamp.
  CONSTRAINT ai_conversation_attempts_terminal_at_check CHECK (
    state NOT IN ('completed', 'stopped', 'failed', 'rejected', 'outcome_unknown')
    OR terminal_at IS NOT NULL
  ),
  -- failed carries the classified error taxonomy (§7.4) — and ONLY failed
  -- carries one (the converse; an error class on completed would be a lie).
  CONSTRAINT ai_conversation_attempts_failed_class_check CHECK (
    state <> 'failed' OR error_class IS NOT NULL
  ),
  CONSTRAINT ai_conversation_attempts_error_class_failed_check CHECK (
    error_class IS NULL OR state = 'failed'
  ),
  -- outcome_unknown is post-boundary by definition (§7.7): pre-boundary
  -- ambiguity is provably-undispatched and resolves to re-drive or stopped.
  CONSTRAINT ai_conversation_attempts_unknown_boundary_check CHECK (
    state <> 'outcome_unknown' OR dispatch_boundary_committed_at IS NOT NULL
  ),
  -- Credential provenance is committed inside the dispatching window (§8
  -- commit 4): P ⟹ B — provenance present implies the boundary was crossed.
  CONSTRAINT ai_conversation_attempts_provenance_boundary_check CHECK (
    provider_credential_id IS NULL OR dispatch_boundary_committed_at IS NOT NULL
  ),
  -- NOTE on `rejected` (source-adjudicated): §7's graph admits rejection from
  -- BOTH accepted (pre-boundary governance/validation denial) AND dispatching
  -- (post-boundary 4xx before provider processing), so NO universal
  -- rejected ⟹ B/P implication exists — only the generic P ⟹ B above applies.
  -- ── §14.3 evidence identity: the referenced key evidence links bind to.
  -- A superset of the already-unique lineage key, so it stays unique; the
  -- nullable request/capture columns are lawful in a UNIQUE constraint.
  CONSTRAINT ai_conversation_attempts_evidence_identity_uniq
    UNIQUE (org_id, owner_user_id, conversation_id, branch_id, turn_id, id,
            govai_request_id, capture_id),
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
  -- §14.3/§14.4 FORENSIC IDENTITY BINDING: a link asserts "THIS identity was
  -- assigned", so it must name the identity the ATTEMPT actually carries. The
  -- link's request/capture columns are NOT NULL, so this composite FK requires
  -- the attempt to POSSESS both identities and to match them EXACTLY: a link
  -- cannot exist before the attempt has its request identity, and can never
  -- name another invocation's request or capture. NO ACTION also freezes the
  -- attempt's capture_id for as long as a link exists — a second, independent
  -- guard on the write-once rule. The lineage FK above is retained as the
  -- documentary composite-ancestry binding (LAW 1); this one adds identity.
  CONSTRAINT ai_conversation_evidence_links_identity_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id,
                 govai_request_id, capture_id)
    REFERENCES govai.ai_conversation_attempts
      (org_id, owner_user_id, conversation_id, branch_id, turn_id, id,
       govai_request_id, capture_id),
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
--
-- STATE PHYSICS (LAW 2/9/13, §7/§11/§19): beyond shape, the triggers encode
-- irreversibility — the attempt birth guard (§7.1b), the full-row terminal
-- freeze, the outcome_unknown closed resolution, the §7 forward transition
-- graph with the ¬P-gated restore, the provider-state taint/supersede
-- ratchets and the conversation lifecycle ratchet. A durable predicate a
-- later movement's safety proof cites must be enforced HERE, before any
-- writer exists.
-- ===========================================================================

-- ai_conversations: identity + immutable execution mode + defaults frozen;
-- the lifecycle status is a RATCHETED graph (LAW 13/§19): active ↔ archived
-- freely; active|archived → deleted_pending → deleted one-way — there is NO
-- edge back out of deleted_pending or deleted ("restore only from explicit
-- archive"; §21's deleted-conversation-reappearance threat).
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
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF (OLD.status = 'active'          AND NEW.status IN ('archived', 'deleted_pending'))
        OR (OLD.status = 'archived'        AND NEW.status IN ('active', 'deleted_pending'))
        OR (OLD.status = 'deleted_pending' AND NEW.status = 'deleted')
      THEN
        NULL; -- lawful lifecycle edge
      ELSE
        RAISE EXCEPTION 'ai_conversations: illegal lifecycle transition % -> % (active <-> archived; active|archived -> deleted_pending -> deleted; no reverse edge)',
          OLD.status, NEW.status
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
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

-- ai_conversation_attempts BIRTH GUARD (§7.1b): every attempt — the §9 step-1
-- reservation or a §7.6 retry mint — is born `accepted`, UNCLAIMED and
-- pre-boundary, with no fabricated authority, identity, provenance, terminal
-- metadata or causal record. Later states are REACHED through the guarded
-- transitions below, never inserted.
CREATE OR REPLACE FUNCTION govai.ai_conversation_attempts_birth_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.state = 'accepted'
    AND NEW.claim_token IS NULL
    AND NEW.claimant IS NULL
    AND NEW.claim_deadline_at IS NULL
    AND NEW.heartbeat_at IS NULL
    AND NEW.causal_version_at_build IS NULL
    AND NEW.govai_request_id IS NULL
    AND NEW.capture_id IS NULL
    AND NEW.provider_credential_id IS NULL
    AND NEW.dispatch_boundary_committed_at IS NULL
    AND NEW.continuation_parent_ciphertext IS NULL
    AND NEW.continuation_parent_dek_wrapped IS NULL
    AND NEW.continuation_parent_kms_key_id IS NULL
    AND NEW.continuation_parent_kms_key_version IS NULL
    AND NOT NEW.context_excluded
    AND NOT NEW.stop_requested
    AND NEW.error_class IS NULL
    AND NEW.terminal_at IS NULL
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ai_conversation_attempts: an attempt is born accepted, unclaimed and pre-boundary (§7.1b) — later states are reached, never inserted'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS ai_conversation_attempts_birth_guard_trg
  ON govai.ai_conversation_attempts;
CREATE TRIGGER ai_conversation_attempts_birth_guard_trg
  BEFORE INSERT ON govai.ai_conversation_attempts
  FOR EACH ROW EXECUTE FUNCTION govai.ai_conversation_attempts_birth_guard();

-- ai_conversation_attempts guarded update — the 0015 WHITELIST shape (the
-- same posture as every other guard in this file), realizing §7's physics:
--   * identity/lineage columns are immutable on every path;
--   * LAW 2/§7.6: a terminal ATTEMPT (completed/stopped/failed/rejected) is
--     NEVER mutated — full-row freeze, not a state-column ratchet;
--   * outcome_unknown has ONE closed probe-driven resolution (§7.6): only
--     {state → completed|failed, terminal_at, error_class, context_excluded,
--     updated_at} may change; every durable execution/causal/provenance
--     identity stays frozen, and the resolved row enters the terminal freeze;
--   * write-once: provider_credential_id (§8 commit 4), govai_request_id
--     (§14.1 mint-if-null), capture_id (§14.2 — derived identity),
--     dispatch_boundary_committed_at (stamped by the first boundary commit;
--     a §9.4/§7.7 restore RETAINS it);
--   * one-way flags: context_excluded, stop_requested;
--   * the §7 FORWARD TRANSITION GRAPH — with the single most important
--     predicate: dispatching → accepted is lawful ONLY while
--     OLD.provider_credential_id IS NULL (¬P — the DURABLE no-POST proof;
--     commit 4 precedes every POST). streaming → accepted is never lawful.
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

  -- LAW 2/§7.6 FULL-ROW TERMINAL FREEZE: a terminal attempt is never mutated.
  -- Whitelist-exhaustive over every non-identity column (the 8 identity
  -- columns are already pinned above; 8 + 19 = all 27 stored columns). A
  -- value-identical UPDATE may proceed; any semantic change is rejected.
  IF OLD.state IN ('completed', 'stopped', 'failed', 'rejected') THEN
    IF NEW.state IS NOT DISTINCT FROM OLD.state
      AND NEW.claim_token IS NOT DISTINCT FROM OLD.claim_token
      AND NEW.claimant IS NOT DISTINCT FROM OLD.claimant
      AND NEW.claim_deadline_at IS NOT DISTINCT FROM OLD.claim_deadline_at
      AND NEW.heartbeat_at IS NOT DISTINCT FROM OLD.heartbeat_at
      AND NEW.stop_requested IS NOT DISTINCT FROM OLD.stop_requested
      AND NEW.causal_version_at_build IS NOT DISTINCT FROM OLD.causal_version_at_build
      AND NEW.govai_request_id IS NOT DISTINCT FROM OLD.govai_request_id
      AND NEW.capture_id IS NOT DISTINCT FROM OLD.capture_id
      AND NEW.provider_credential_id IS NOT DISTINCT FROM OLD.provider_credential_id
      AND NEW.dispatch_boundary_committed_at IS NOT DISTINCT FROM OLD.dispatch_boundary_committed_at
      AND NEW.continuation_parent_ciphertext IS NOT DISTINCT FROM OLD.continuation_parent_ciphertext
      AND NEW.continuation_parent_dek_wrapped IS NOT DISTINCT FROM OLD.continuation_parent_dek_wrapped
      AND NEW.continuation_parent_kms_key_id IS NOT DISTINCT FROM OLD.continuation_parent_kms_key_id
      AND NEW.continuation_parent_kms_key_version IS NOT DISTINCT FROM OLD.continuation_parent_kms_key_version
      AND NEW.context_excluded IS NOT DISTINCT FROM OLD.context_excluded
      AND NEW.error_class IS NOT DISTINCT FROM OLD.error_class
      AND NEW.terminal_at IS NOT DISTINCT FROM OLD.terminal_at
      AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ai_conversation_attempts: terminal state % is a full-row ratchet — no column may change', OLD.state
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- §7.6 outcome_unknown CLOSED RESOLUTION: the recovery probe may resolve
  -- ONCE to completed/failed, touching ONLY {state, terminal_at, error_class,
  -- context_excluded (§7.8 post-advance marker), updated_at}. All durable
  -- execution/causal/provenance identity — claim authority, heartbeat,
  -- causal version, request/capture identity, credential provenance, the
  -- boundary, the continuation anchor, the stop flag — stays frozen.
  IF OLD.state = 'outcome_unknown' THEN
    IF NEW.claim_token IS DISTINCT FROM OLD.claim_token
      OR NEW.claimant IS DISTINCT FROM OLD.claimant
      OR NEW.claim_deadline_at IS DISTINCT FROM OLD.claim_deadline_at
      OR NEW.heartbeat_at IS DISTINCT FROM OLD.heartbeat_at
      OR NEW.stop_requested IS DISTINCT FROM OLD.stop_requested
      OR NEW.causal_version_at_build IS DISTINCT FROM OLD.causal_version_at_build
      OR NEW.govai_request_id IS DISTINCT FROM OLD.govai_request_id
      OR NEW.capture_id IS DISTINCT FROM OLD.capture_id
      OR NEW.provider_credential_id IS DISTINCT FROM OLD.provider_credential_id
      OR NEW.dispatch_boundary_committed_at IS DISTINCT FROM OLD.dispatch_boundary_committed_at
      OR NEW.continuation_parent_ciphertext IS DISTINCT FROM OLD.continuation_parent_ciphertext
      OR NEW.continuation_parent_dek_wrapped IS DISTINCT FROM OLD.continuation_parent_dek_wrapped
      OR NEW.continuation_parent_kms_key_id IS DISTINCT FROM OLD.continuation_parent_kms_key_id
      OR NEW.continuation_parent_kms_key_version IS DISTINCT FROM OLD.continuation_parent_kms_key_version
    THEN
      RAISE EXCEPTION 'ai_conversation_attempts: outcome_unknown resolution may touch only state/terminal_at/error_class/context_excluded/updated_at'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state THEN
      IF NEW.state NOT IN ('completed', 'failed') THEN
        RAISE EXCEPTION 'ai_conversation_attempts: outcome_unknown may only resolve to completed/failed'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSE
      -- Not resolving: the ratchet timestamp and error taxonomy stay frozen.
      IF NEW.terminal_at IS DISTINCT FROM OLD.terminal_at
        OR NEW.error_class IS DISTINCT FROM OLD.error_class
      THEN
        RAISE EXCEPTION 'ai_conversation_attempts: outcome_unknown terminal_at/error_class change only with a completed/failed resolution'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF OLD.context_excluded AND NOT NEW.context_excluded THEN
      RAISE EXCEPTION 'ai_conversation_attempts: context_excluded is permanent'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- Non-terminal states (accepted/dispatching/streaming) from here on.
  -- Write-once identity/provenance (§8 commit 4 / §14.1 / §14.2): once
  -- assigned, never rewritten and never nulled.
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
  IF OLD.capture_id IS NOT NULL
    AND NEW.capture_id IS DISTINCT FROM OLD.capture_id
  THEN
    RAISE EXCEPTION 'ai_conversation_attempts: capture_id is write-once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.dispatch_boundary_committed_at IS NOT NULL
    AND NEW.dispatch_boundary_committed_at IS DISTINCT FROM OLD.dispatch_boundary_committed_at
  THEN
    RAISE EXCEPTION 'ai_conversation_attempts: dispatch_boundary_committed_at records the first boundary crossing and is write-once (a restore RETAINS it, §14.1)'
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
  -- terminal_at is stamped only by the transition INTO a ratchet state.
  IF NEW.terminal_at IS DISTINCT FROM OLD.terminal_at
    AND NEW.state NOT IN ('completed', 'stopped', 'failed', 'rejected', 'outcome_unknown')
  THEN
    RAISE EXCEPTION 'ai_conversation_attempts: terminal_at is stamped only by a transition into a ratchet state'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- §7 FORWARD TRANSITION GRAPH (transitions are total; every edge named).
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state = 'accepted'
      AND NEW.state IN ('dispatching', 'stopped', 'failed', 'rejected')
    THEN
      NULL; -- boundary commit, queued discard, pre-boundary failure, rejection
    ELSIF OLD.state = 'dispatching'
      AND NEW.state IN ('streaming', 'stopped', 'failed', 'rejected', 'outcome_unknown')
    THEN
      NULL; -- stream start, stop, failure, rejection, recovery ratchet
    ELSIF OLD.state = 'dispatching' AND NEW.state = 'accepted' THEN
      -- The ONLY sanctioned restore (§9.4 rotation-restore / §7.7
      -- provenance-absent reclaim): lawful solely on the durable no-POST
      -- proof ¬P. The restore RETAINS boundary + govai_request_id (§14.1).
      IF OLD.provider_credential_id IS NOT NULL THEN
        RAISE EXCEPTION 'ai_conversation_attempts: dispatching may restore to accepted only while provider provenance is absent (the durable no-POST proof)'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF OLD.state = 'streaming'
      AND NEW.state IN ('completed', 'stopped', 'failed', 'outcome_unknown')
    THEN
      NULL; -- post-POST outcomes only: streaming NEVER returns to accepted
    ELSE
      RAISE EXCEPTION 'ai_conversation_attempts: illegal state transition % -> %', OLD.state, NEW.state
        USING ERRCODE = 'insufficient_privilege';
    END IF;
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

-- ai_conversation_provider_state: lineage, credential PROVENANCE (§19.3) and
-- the seed version binding are frozen. Lifecycle is RATCHETED (LAW 9/§11):
-- the taint NEVER clears (not by time, not by hand — clearing is a
-- reconcile-or-rotate decision that mints a NEW row); status moves only
-- active → superseded (a superseded provider object is "historical cleanup
-- state, not a reusable current anchor"); a superseded row's encrypted
-- payload + KMS binding freeze. An ACTIVE row's payload stays replaceable —
-- that is §11's captureProviderState delta.
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
    IF OLD.tainted AND NOT NEW.tainted THEN
      RAISE EXCEPTION 'ai_conversation_provider_state: tainted never clears (LAW 9 — reconcile-or-rotate mints a new row)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
      AND NOT (OLD.status = 'active' AND NEW.status = 'superseded')
    THEN
      RAISE EXCEPTION 'ai_conversation_provider_state: status is monotonic — active -> superseded only'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status = 'superseded'
      AND (NEW.state_ciphertext IS DISTINCT FROM OLD.state_ciphertext
        OR NEW.state_dek_wrapped IS DISTINCT FROM OLD.state_dek_wrapped
        OR NEW.kms_key_id IS DISTINCT FROM OLD.kms_key_id
        OR NEW.kms_key_version IS DISTINCT FROM OLD.kms_key_version)
    THEN
      RAISE EXCEPTION 'ai_conversation_provider_state: a superseded row is historical cleanup state — its payload and key binding are frozen'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
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
