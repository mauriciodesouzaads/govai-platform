-- Migration 0033 — AI Conversation CONTROL PLANE: request-plane authority,
-- fork idempotency arbiter, and the two P0-B structural closures (C4, C5).
--
-- Mission:  EP-AI-CONVERSATION-CONTINUITY-V1-01
-- Movement: P0-B-CONVERSATION-CONTROL-PLANE-01
-- Spec:     docs/architecture/ai-conversation-continuity-v1.md
--           (§3 fork pin / boundary modes / CURRENT_ATTEMPT_LINEAGE_BINDING,
--            §7.5-§7.6 eligibility handoff, §8 idempotency + lifecycle
--            serialization, §13 control-plane API, §18 titles, §19 archive,
--            §24 LAW 1 / LAW 2 / LAW 7 / LAW 10 / LAW 12 / LAW 16).
--
-- This migration ships DATABASE AUTHORITY AND STRUCTURE ONLY. It creates no
-- runner, no claim path, no provider dispatch, no worker capability and no
-- route. Migrations 0031 (P0-A1) and 0032 (P0-A2) are historical source and
-- are NOT touched.
--
-- WHAT P0-B NEEDS FROM THE DATABASE, AND NOTHING MORE:
--
--   1. `govai_app` must be able to RENAME and ARCHIVE/UNARCHIVE a conversation
--      it owns (§13's two guarded fields: title, archived). 0031 granted
--      SELECT + INSERT only, so today every such write fails closed. The grant
--      added here is COLUMN-SCOPED (the 0028 / 0032 precedent) to exactly the
--      title group + the lifecycle pair + updated_at. `retention_class` is
--      deliberately EXCLUDED: no P0-B external contract mutates it, and
--      "minimum additional authority" means the columns this movement writes,
--      not the columns 0031's guard trigger happens to tolerate.
--      ★ Consequence, and the reason column scoping was chosen: table-level
--      `has_table_privilege(govai_app, ai_conversations, 'UPDATE')` stays
--      FALSE. A future column added by a later migration is NOT silently
--      writable by the request role.
--
--   2. Fork creation must be IDEMPOTENT under a client-supplied
--      `client_fork_id` (§13), with ONE PostgreSQL concurrency arbiter. That
--      is `govai.ai_conversation_fork_idempotency` below — the 0030
--      `run_idempotency` composite-PK pattern (`INSERT ... ON CONFLICT DO
--      NOTHING RETURNING`), immutable by privilege (SELECT + INSERT only).
--
--   3. P0A1-C4 (fork-pin MODE-SPECIFIC state validity) and P0A1-C5
--      (`current_attempt_id` MONOTONIC handoff) are P0-B acceptance
--      obligations (current-state.md:694-698). Both are taken STRUCTURALLY
--      here, so the database cannot represent the unlawful shape even if an
--      application check is forgotten.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
--   * no DELETE grant anywhere (LAW 13's purge is a later movement's authority);
--   * no TRUNCATE grant (and the new table joins the domain's TRUNCATE block);
--   * no change to the `govai_conversation_worker` privilege matrix — not one
--     policy, not one column, not one EXECUTE. P0-C will need worker claim
--     authority; pre-granting it here would be pre-granting future capability;
--   * no `govai_audit_writer` (definer) policy on the new table;
--   * no UPDATE grant on branches/turns/attempts/items/content/provider_state/
--     evidence_links. The `before_attempt_output` fork mints its child turn
--     with `current_attempt_id` ALREADY SET, inside one transaction under
--     `SET CONSTRAINTS ... DEFERRED` (0031 §I made the reverse pointer FK
--     DEFERRABLE for exactly this), so the control plane needs no UPDATE
--     authority on turns at all.
--
-- Conventions follow 0009/0012/0013/0028/0030/0031/0032: idempotent DDL,
-- RLS ENABLE + FORCE with dual-predicate policies, guard triggers with a fixed
-- search_path, column-scoped grants, no FK to govai.orgs.

SET ROLE govai_audit_writer;

-- ===========================================================================
-- A. Request-plane UPDATE authority on govai.ai_conversations
--
-- RLS and table privilege are CUMULATIVE: the policy decides WHICH rows, the
-- column grant decides WHICH columns. Both are required, and both are
-- dual-predicate/least-privilege.
--
-- The USING clause is the same owner predicate 0031 wrote for SELECT/INSERT —
-- not widened, not OR-ed, not lifecycle-aware. Lifecycle legality is NOT a
-- policy concern: 0031's `ai_conversations_guarded_update` trigger owns the
-- ratchet (active <-> archived; active|archived -> deleted_pending ->
-- deleted; no reverse edge) and the P0-B service revalidates status under the
-- LAW 10 root row lock. Encoding state rules in a policy would put the same
-- invariant in two places with two different failure modes.
--
-- WITH CHECK is stated EXPLICITLY rather than inherited from USING: an owner
-- must not be able to re-stamp a row onto another org/owner, and a reader of
-- this migration should not have to know the PostgreSQL defaulting rule.
-- ===========================================================================

DO $$ BEGIN
  CREATE POLICY ai_conversations_update_app ON govai.ai_conversations
    FOR UPDATE TO govai_app
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true))
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON POLICY ai_conversations_update_app ON govai.ai_conversations IS
  'P0-B request-plane mutation surface: the SAME dual-predicate owner scope 0031 wrote for SELECT/INSERT. Row scope only — the lifecycle ratchet and column whitelist live in the 0031 guard trigger and the column grant below.';

-- Column-scoped UPDATE (the 0028 `GRANT SELECT (id) ON govai.orgs` /
-- 0032 worker-column precedent). What the narrowing BUYS, literally:
--   * `mode`, `provider`, `surface`, `model`, `org_id`, `owner_user_id`, `id`,
--     `created_at` are unreachable by the request role — the 0031 guard
--     trigger already freezes them, and now the privilege layer does too.
--   * `retention_class` is unreachable: P0-B exposes no retention control, so
--     it holds no authority over it.
-- `status` + `archived_at` are the §19 archive pair; the five title columns
-- are the §18/§6 encrypted-title group (all-or-none by the 0031 CHECK);
-- `updated_at` is the list-ordering key every mutation must bump.
GRANT UPDATE (status, archived_at, title_ciphertext, title_dek_wrapped,
              title_kms_key_id, title_kms_key_version, title_hmac, updated_at)
  ON govai.ai_conversations TO govai_app;

-- ===========================================================================
-- B. govai.ai_conversation_fork_idempotency — the fork concurrency arbiter
--
-- §13: fork creation is idempotent under a client-supplied `client_fork_id`,
-- unique per `(org_id, conversation_id, client_fork_id)`; a lost-response
-- retry REPLAYS the already-created branch, and the same key with a DIFFERENT
-- fork intent is a 409. The ancestry tuple alone cannot deduplicate (multiple
-- forks from one pinned attempt are legitimate), and for
-- `before_attempt_output` a duplicate would mint a duplicate child turn.
--
-- PHYSICAL DESIGN — why a dedicated table and not columns on the branch row
-- (source-adjudicated, both candidates evaluated against this schema):
--   * 0031's `ai_conversation_branches_guarded_update` trigger is a POSITIVE
--     whitelist over the columns that existed when it was written. Adding
--     `client_fork_id` / intent-hash columns to that table would place them
--     OUTSIDE the frozen set — silently MUTABLE the moment any future
--     movement is granted UPDATE on branches. A separate table with NO UPDATE
--     grant and a no-UPDATE guard cannot acquire that hazard.
--   * The accepted uniqueness scope is `(org_id, conversation_id,
--     client_fork_id)` — which is exactly a composite PRIMARY KEY, the
--     0030 `run_idempotency` arbiter shape the domain already proved, and the
--     same shape 0031 chose for the turn reservation
--     (`ai_conversation_turns_client_turn_uniq`).
--   * Immutability by privilege (SELECT + INSERT, no UPDATE/DELETE) is the
--     0030 rule: a committed (org, conversation, key) -> intent -> branch
--     binding can never be rewritten to "fix" a conflict.
--
-- LAW 1 applies unchanged: the binding points at its branch through the
-- COMPOSITE lineage key, never by branch id alone, so a binding structurally
-- cannot name another owner's or another conversation's branch.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS govai.ai_conversation_fork_idempotency (
  org_id                   uuid        NOT NULL,
  owner_user_id            uuid        NOT NULL,
  conversation_id          uuid        NOT NULL,
  client_fork_id           uuid        NOT NULL,
  -- SHA-256 of the canonical `govai.ai_conversation_fork_intent.v1`
  -- projection (a LOCAL, frozen canonicalization — never the evidence-plane
  -- canonicalization, the run-idempotency.ts:164-170 rule).
  fork_intent_hash         bytea       NOT NULL
                             CHECK (octet_length(fork_intent_hash) = 32),
  fork_intent_hash_version smallint    NOT NULL CHECK (fork_intent_hash_version = 1),
  branch_id                uuid        NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  -- THE single PostgreSQL concurrency arbiter for the keyed-fork winner race.
  PRIMARY KEY (org_id, conversation_id, client_fork_id),
  CONSTRAINT ai_conversation_fork_idempotency_branch_fk
    FOREIGN KEY (org_id, owner_user_id, conversation_id, branch_id)
    REFERENCES govai.ai_conversation_branches (org_id, owner_user_id, conversation_id, id),
  -- One binding per branch: a branch is minted by exactly one keyed fork, so a
  -- second key can never adopt an existing branch as its own replay target.
  CONSTRAINT ai_conversation_fork_idempotency_branch_uniq
    UNIQUE (org_id, owner_user_id, conversation_id, branch_id)
);

COMMENT ON TABLE govai.ai_conversation_fork_idempotency IS
  'EP-AI-CONVERSATION-CONTINUITY-V1 P0-B: IMMUTABLE owner-scoped binding from a client fork identity (org, conversation, client_fork_id) to ONE durable branch, with the canonical fork-intent hash recorded for replay correspondence (spec §13). Not a fork-state table, not history, not a cache: one row, written once by the fork transaction, never updated or deleted by the application.';

-- ===========================================================================
-- C. RLS + grants for the arbiter — the 0031 dual-predicate shape, unchanged
-- ===========================================================================

ALTER TABLE govai.ai_conversation_fork_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.ai_conversation_fork_idempotency FORCE  ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY ai_conversation_fork_idempotency_select_app
    ON govai.ai_conversation_fork_idempotency
    FOR SELECT TO govai_app
    USING (org_id::text = current_setting('app.org_id', true)
           AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY ai_conversation_fork_idempotency_insert_app
    ON govai.ai_conversation_fork_idempotency
    FOR INSERT TO govai_app
    WITH CHECK (org_id::text = current_setting('app.org_id', true)
                AND owner_user_id::text = current_setting('app.user_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE ALL ON govai.ai_conversation_fork_idempotency FROM PUBLIC;
GRANT SELECT, INSERT ON govai.ai_conversation_fork_idempotency TO govai_app;

-- Immutability by structure as well as by privilege (the 0031 items posture).
CREATE OR REPLACE FUNCTION govai.ai_conversation_fork_idempotency_no_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'ai_conversation_fork_idempotency bindings are immutable (a committed fork key is never rebound)'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS ai_conversation_fork_idempotency_no_update_trg
  ON govai.ai_conversation_fork_idempotency;
CREATE TRIGGER ai_conversation_fork_idempotency_no_update_trg
  BEFORE UPDATE ON govai.ai_conversation_fork_idempotency
  FOR EACH ROW EXECUTE FUNCTION govai.ai_conversation_fork_idempotency_no_update();

-- The new table joins the domain-wide TRUNCATE block (0031 §K shared function).
DROP TRIGGER IF EXISTS ai_conversation_fork_idempotency_no_truncate_trg
  ON govai.ai_conversation_fork_idempotency;
CREATE TRIGGER ai_conversation_fork_idempotency_no_truncate_trg
  BEFORE TRUNCATE ON govai.ai_conversation_fork_idempotency
  FOR EACH STATEMENT EXECUTE FUNCTION govai.ai_conversation_domain_no_truncate();

-- ===========================================================================
-- D. P0A1-C4 — FORK-PIN MODE-SPECIFIC STATE VALIDITY (structural)
--
-- §3, exactly: `after_attempt` (the child INCLUDES the pinned attempt's
-- output) requires the pin to be **completed** — forking a stopped/failed/
-- rejected attempt in this mode would replay a partial or ineligible prefix.
-- `before_attempt_output` (which EXCLUDES that output and copies only the
-- turn-owned immutable user items) accepts ANY immutable terminal attempt —
-- completed, stopped, failed or rejected. In BOTH modes `outcome_unknown` is
-- REJECTED: it may still mutate (§7.6's closed probe resolution), so it is not
-- immutable-terminal for fork purposes. No non-terminal pin is ever valid.
--
-- SCOPE OF THIS TRIGGER — deliberately the STATE predicate and nothing else.
-- LINEAGE is already structural: 0031 §I's `ai_conversation_branches_fork_fk`
-- is one composite FK over EXACTLY the tuple read below, so a pin naming
-- another conversation, another parent branch, another turn or another owner
-- is rejected by the FK. When the lookup finds no row this trigger therefore
-- RETURNS and lets that FK be the authority — it does not duplicate (or
-- pre-empt, or restate in a different SQLSTATE) an invariant 0031 already owns.
--
-- WHY A SNAPSHOT READ IS SOUND HERE: every state this trigger ACCEPTS is a
-- 0031 ratchet under the full-row terminal freeze, so an accepted pin can
-- never later become non-terminal. The only races are conservative — a pin
-- read as `dispatching`/`outcome_unknown` that terminalizes microseconds later
-- is refused, and the caller retries. There is no ordering in which an
-- unlawful pin is admitted.
--
-- INSERT-ONLY, on purpose: 0031's branches guard freezes `boundary_mode` and
-- all three fork columns on UPDATE, so a committed pin can never be retargeted;
-- re-checking on every lawful `causal_version` bump (a P0-C hot path) would buy
-- nothing and cost a read.
-- ===========================================================================

CREATE OR REPLACE FUNCTION govai.ai_conversation_branches_fork_pin_state_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pinned_state text;
BEGIN
  -- Root branch, or a partially-stated fork: 0031's fork-shape CHECK is the
  -- authority on shape. Nothing to validate here.
  IF NEW.parent_branch_id IS NULL
    OR NEW.forked_from_turn_id IS NULL
    OR NEW.forked_from_attempt_id IS NULL
    OR NEW.boundary_mode IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT a.state INTO pinned_state
    FROM govai.ai_conversation_attempts a
   WHERE a.org_id          = NEW.org_id
     AND a.owner_user_id   = NEW.owner_user_id
     AND a.conversation_id = NEW.conversation_id
     AND a.branch_id       = NEW.parent_branch_id
     AND a.turn_id         = NEW.forked_from_turn_id
     AND a.id              = NEW.forked_from_attempt_id;

  -- Not visible under this session's authority: the 0031 composite fork FK
  -- (the identical tuple, NOT deferrable) rejects it at statement end.
  IF pinned_state IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.boundary_mode = 'after_attempt' THEN
    IF pinned_state <> 'completed' THEN
      RAISE EXCEPTION 'ai_conversation_branches: an after_attempt fork must pin a COMPLETED attempt (the child replays its output); pinned attempt is %', pinned_state
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW.boundary_mode = 'before_attempt_output' THEN
    IF pinned_state NOT IN ('completed', 'stopped', 'failed', 'rejected') THEN
      RAISE EXCEPTION 'ai_conversation_branches: a before_attempt_output fork must pin an IMMUTABLE TERMINAL attempt (completed|stopped|failed|rejected); pinned attempt is % (outcome_unknown may still resolve and is never a valid pin)', pinned_state
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    -- Unreachable while the 0031 boundary_mode CHECK stands; fail closed
    -- rather than admit an unknown mode with no state rule.
    RAISE EXCEPTION 'ai_conversation_branches: unknown fork boundary_mode %', NEW.boundary_mode
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_conversation_branches_fork_pin_state_guard_trg
  ON govai.ai_conversation_branches;
CREATE TRIGGER ai_conversation_branches_fork_pin_state_guard_trg
  BEFORE INSERT ON govai.ai_conversation_branches
  FOR EACH ROW EXECUTE FUNCTION govai.ai_conversation_branches_fork_pin_state_guard();

COMMENT ON FUNCTION govai.ai_conversation_branches_fork_pin_state_guard() IS
  'P0A1-C4 (closed by P0-B): fork-pin MODE-SPECIFIC state validity, spec §3. after_attempt => completed; before_attempt_output => completed|stopped|failed|rejected; outcome_unknown and every non-terminal state rejected in BOTH modes. Lineage stays the business of 0031''s composite fork FK.';

-- ===========================================================================
-- E. P0A1-C5 — CURRENT_ATTEMPT MONOTONIC HANDOFF (structural)
--
-- 0031's CURRENT_ATTEMPT_LINEAGE_BINDING proves the pointer names an attempt
-- of the SAME turn (and owner, and conversation, and branch). Lineage is not
-- DIRECTION: it admits attempt 2 -> attempt 1, which would resurrect a
-- SUPERSEDED attempt's output into the context domain and un-do §7.6's atomic
-- eligibility handoff ("attempt N's completed output leaves the context domain
-- immediately"). This trigger closes the direction.
--
-- The rules, and why each exists:
--   * VALUE-IDENTICAL assignment is a harmless no-op (idempotent retries of
--     the same handoff must not fail).
--   * CLEARING to NULL is forbidden. §7.1b/§9.1: a turn is never attempt-less
--     after its reservation commits — every control and recovery surface is
--     attempt-scoped, so a cleared pointer strands the turn beyond §7.7.
--   * INITIAL assignment (NULL -> attempt) is LAWFUL and unrestricted here:
--     it is the reservation's own choreography (§9 step 1), and the composite
--     FK is the authority on WHICH attempt may be named. This trigger
--     deliberately does not read the target on that path — doing so would
--     pre-empt 0031's FK with a different SQLSTATE and would break under a
--     lawful `SET CONSTRAINTS ... DEFERRED` mint of turn + attempt + pointer.
--   * A HANDOFF (attempt -> different attempt) must be FORWARD, ordered by
--     `attempt_seq` — the actual attempt sequencing field (0031: NOT NULL,
--     >= 1, UNIQUE per turn). Never by uuid value, which encodes no order.
--   * A handoff whose target is not resolvable in THIS turn's lineage is
--     REJECTED (fail closed): forward motion cannot be PROVEN without the
--     target's sequence, and an unprovable eligibility handoff is exactly the
--     class this closure exists to forbid. The lawful order — mint attempt
--     N+1, then repoint — always resolves.
-- ===========================================================================

CREATE OR REPLACE FUNCTION govai.ai_conversation_turns_current_attempt_monotonic() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  old_seq integer;
  new_seq integer;
BEGIN
  IF NEW.current_attempt_id IS NOT DISTINCT FROM OLD.current_attempt_id THEN
    RETURN NEW; -- value-identical: idempotent, changes no eligibility
  END IF;

  IF NEW.current_attempt_id IS NULL THEN
    RAISE EXCEPTION 'ai_conversation_turns: current_attempt_id never clears — a reserved turn is never attempt-less (§7.1b), and every recovery surface is attempt-scoped'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.current_attempt_id IS NULL THEN
    RETURN NEW; -- initial lawful assignment; the composite FK vets the target
  END IF;

  SELECT a.attempt_seq INTO old_seq
    FROM govai.ai_conversation_attempts a
   WHERE a.org_id          = NEW.org_id
     AND a.owner_user_id   = NEW.owner_user_id
     AND a.conversation_id = NEW.conversation_id
     AND a.branch_id       = NEW.branch_id
     AND a.turn_id         = NEW.id
     AND a.id              = OLD.current_attempt_id;

  SELECT a.attempt_seq INTO new_seq
    FROM govai.ai_conversation_attempts a
   WHERE a.org_id          = NEW.org_id
     AND a.owner_user_id   = NEW.owner_user_id
     AND a.conversation_id = NEW.conversation_id
     AND a.branch_id       = NEW.branch_id
     AND a.turn_id         = NEW.id
     AND a.id              = NEW.current_attempt_id;

  IF old_seq IS NULL OR new_seq IS NULL THEN
    RAISE EXCEPTION 'ai_conversation_turns: a current_attempt_id handoff must name attempts of THIS turn whose order can be proven (§7.6 monotonic eligibility handoff)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF new_seq <= old_seq THEN
    RAISE EXCEPTION 'ai_conversation_turns: current_attempt_id is MONOTONIC — attempt_seq % may not be repointed back to % (§7.6: a superseded attempt never re-enters the context domain)', old_seq, new_seq
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_conversation_turns_current_attempt_monotonic_trg
  ON govai.ai_conversation_turns;
CREATE TRIGGER ai_conversation_turns_current_attempt_monotonic_trg
  BEFORE UPDATE ON govai.ai_conversation_turns
  FOR EACH ROW EXECUTE FUNCTION govai.ai_conversation_turns_current_attempt_monotonic();

COMMENT ON FUNCTION govai.ai_conversation_turns_current_attempt_monotonic() IS
  'P0A1-C5 (closed by P0-B): the §7.6 eligibility handoff is FORWARD-ONLY, ordered by attempt_seq. Initial NULL -> attempt assignment stays lawful; clearing and every backward or unprovable repoint is rejected. Complements — never replaces — 0031''s CURRENT_ATTEMPT_LINEAGE_BINDING composite FK.';

RESET ROLE;
