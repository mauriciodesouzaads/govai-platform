# AI Conversation Continuity V1 — Architecture Specification

STATUS: `DESIGN_SPEC_ACCEPTED_TARGET — NOT IMPLEMENTED`
MISSION: EP-PROVIDER-NATIVE-PARITY-V1-BASELINE-01 (baseline movement; no runtime change)
SOURCE ANCHOR: main `55eae8835c7fb3b4cad35d3f470a1163fc5eb356` (tree `5742151e`)
RESEARCH SNAPSHOT: 2026-08-21 (provider facts verified against first-party sources on this date)
PRECEDENCE: `current-state.md` and `foundation-v1-freeze.md` prevail over this spec wherever they
conflict. This document specifies TARGET architecture. Nothing here claims runtime existence.

This movement creates NO migration, NO route, NO table and NO conversation runtime. Every schema,
endpoint and state machine below is design, gated behind the follow-up implementation mission
(§23). File:line citations refer to the source anchor above.

---

## 1. Requirement and posture

The owner product directive (EP-PROVIDER-NATIVE-PARITY-V1-BASELINE-01 §0) sets
`CONVERSATION_CONTINUITY=P0_NATIVE_EXPERIENCE_PREREQUISITE`: GovAI must become a primary interface
for OpenAI/Anthropic API experiences and for the Codex and Claude Code coding agents, and a
conversation must eventually survive route changes, reload, browser restart, recoverable network
interruption, logout/login, and (post-R14) device/session change. Users must be able to reopen,
resume, search, rename, archive, branch and delete conversations under policy.

Posture: GovAI adds trust; GovAI must not subtract capability. Continuity is therefore designed
to carry provider-NATIVE semantics (content blocks, tool calls, citations, provider ids, reasoning
continuation state) — not a lowest-common-denominator `role+text` transcript.

## 2. Source-adjudicated current state (proof, not assumption)

Adjudicated at the source anchor:

- The AI Console transcript is **memory-only by construction**: the only home of user and
  assistant turns is `useReducer` state in the `/ai` route component
  (`apps/ui/src/features/ai/AiConsolePage.tsx:120`; doctrine comment
  `apps/ui/src/features/ai/conversation/reducer.ts:6-11`). Route navigation, reload, sign-out and
  a second browser all lose it; regression-pinned by `apps/ui/tests/ai/persistence.test.tsx`.
- **No conversation API exists anywhere.** The string `conversation` has zero hits in `apps/api`;
  no `/v1/ai/*` or `/conversations` route exists; migrations 0001–0030 contain no
  non-workroom transcript table.
- The only transcript-like tables are workroom-scoped (`govai.workroom_messages`,
  `govai.workroom_turns` — 0013:51, 0012:237) and are adjudicated NOT reusable as a chat store
  (§4).
- The audit plane stores **hashes and metadata, never prompt/completion text**
  (`0001_audit_chain.sql:28-54`; capture projection
  `packages/core-events/src/audit-bridge-capture-payload.ts:61-116`), and the direct-route capture
  path hardcodes `payloadEncrypted: null` (`apps/api/src/pipeline/audit-bridge.ts:210-211`).
- No end-to-end identifier links a UI turn to its audit evidence today
  (`EP-AI-CONSOLE-TURN-EVIDENCE-CORRELATION`, `current-state.md:114`); hijacked streaming replies
  do not echo `X-GovAI-Request-Id` (`DIRECT_STREAM_REQUEST_ID_HEADER_GAP`, `current-state.md:591`).

Verdict recorded: `CONVERSATION_PERSISTENCE=NOT_IMPLEMENTED`. Continuity is a green-field domain.

## 3. Domain model

New domain, prefix `ai_` (grep-clean separation from `workroom_*`). All tables follow the house
conventions proven in 0012/0013 — `uuid` PKs, RLS `ENABLE + FORCE`, per-command policies,
least-privilege grants — with ONE deliberate strengthening: because a conversation is
OWNER-authorized (not org-authorized like the read surfaces, and not participant-authorized like
workrooms), the tenant predicate alone is insufficient inside a multi-user org. Every `ai_*`
table therefore carries BOTH `org_id` and a denormalized `owner_user_id`, and its RLS policies
require both `org_id::text = current_setting('app.org_id', true)` AND
`owner_user_id::text = current_setting('app.user_id', true)` — the authenticated `user_id` the
key lookup already resolves is propagated into the session context alongside `app.org_id` by the
tenant helper. Ownership is enforced IN POLICY, never left to per-query `WHERE` discipline: a
forgotten predicate in a list/hydrate/attachment/re-attach query must return nothing, not a
same-org neighbour's conversation. (Post-R14 sharing is an explicit policy evolution — owner OR
recorded grant — not a relaxation of the default.)

| Entity | Table (target) | Purpose |
|---|---|---|
| Conversation | `govai.ai_conversations` | Root container: org/owner scope, provider+surface+model defaults, title (encrypted), status (`active\|archived\|deleted_pending\|deleted`), `project_id uuid NULL` (future, §16), `workroom_id uuid NULL` (optional attribution, §4), retention class, timestamps |
| Branch | `govai.ai_conversation_branches` | A named line of turns, and the DURABLE owner of execution identity: each branch carries its own `provider + surface + model` (copied from the conversation defaults at root-branch creation; supplied by the fork operation for provider/model switches). Adapter selection reads the BRANCH, never the conversation root — a cross-provider fork must be replayable after reload with no in-memory hint and possibly no provider_state yet. Every conversation has one root branch; fork creates a new branch with `parent_branch_id` + `forked_from_turn_id`/`forked_from_attempt_id`. Cross-provider continuation is ALWAYS a new branch (§17) |
| Turn | `govai.ai_conversation_turns` | One user send on a branch: `(org_id, conversation_id, client_turn_id)` unique (§8), per-branch `turn_seq` (advisory-lock + `MAX+1` + UNIQUE backstop, the technique of `workroom-transcript.ts:127-136` — technique reuse, not table reuse), `current_attempt_id` (lineage-bound, §3). The turn carries NO authoritative lifecycle state: its state is a DERIVED PROJECTION of its current attempt's state — retry could not otherwise keep attempt N's terminal ratchet immutable while N+1 independently becomes `accepted` |
| Attempt | `govai.ai_conversation_attempts` | Retries of one turn (the UI already models `Turn.attempts[]`, `conversation/types.ts:171-176`) — and THE AUTHORITATIVE HOME of execution lifecycle: the §7 state machine's `state`, the claim `{claim_token, claimant, deadline, heartbeat}`, the durable stop-request flag, the causal-version-at-build, `govai_request_id` (§14), and the provider CONTINUATION ANCHOR it chained from (e.g. `continuation_parent_response_id`, §11 retry mechanics). Per-attempt authority is what §7.6's ratchets REQUIRE: attempt N's terminal state is immutable while N+1 independently runs its own lifecycle — one authoritative state per attempt, never two divergent copies. The TURN carries the `current_attempt_id` pointer — the atomic eligibility handoff of §7.6: at most the CURRENT attempt's completed output is context-eligible; prior attempts stay immutable and visible but never contribute |
| Provider-native Item | `govai.ai_conversation_items` | Ordered typed items with an explicit OWNER discriminator: USER/INPUT items are TURN-owned (`attempt_id` NULL — they are committed at the §7.1 reservation, before any attempt exists, and survive every retry), while assistant/tool OUTPUT items are ATTEMPT-owned. Both owners are reached through the same composite lineage chain. Provider-native content blocks, tool calls/results, citations, refusals, provider ids (§12); content encrypted (§6) |
| Attachment | `govai.ai_conversation_attachments` | File references (GovAI-stored bytes or provider `file_id` refs). V1 design carries the entity; upload flows land in a later wave |
| Artifact | (deferred) | Product-equivalent work surfaces; the item model must be able to mark an item as artifact-source, nothing more in V1 |
| Provider State | `govai.ai_conversation_provider_state` | Per-branch continuation state owned by the adapter (§11): e.g. OpenAI `conversation_id`/`previous_response_id`, Codex thread id, Claude Code session id, encrypted where opaque |
| Evidence Link | `govai.ai_conversation_evidence_links` | Additive projection turn/attempt → `{govai_request_id, capture_id, audit_event_id?}` (§14). Never mutates audit tables |
| Disposal ledger | `govai.ai_provider_disposal_ledger` | THE ONE deliberate exception to LAW 1's composite binding: org+owner-scoped (RLS as usual) but LIFECYCLE-INDEPENDENT of its conversation — `conversation_id` is a PLAIN VALUE, not an FK — because disposal records must be appendable AFTER the conversation is purged (a fenced zombie's late stored-response id, §7.7), must survive purge until cleanup consumes them (§19), and are the SOLE admissible §19 step-4 handoff target for provider-cleanup obligations still pending at purge time (transcribed in the same transaction as the purge). The `provider_object_id` it carries is ENVELOPE-ENCRYPTED (§6): §21 classifies provider identifiers as sensitive, and the ledger outlives the purged conversation and its encrypted provider_state — a plaintext column would hand a DB snapshot exactly the identifiers the opaque-discovery design protects; the worker decrypts only after owner-scoped context entry. Justification recorded here so the exception can never silently generalize |
| Content blob | `govai.ai_conversation_content` | Envelope-encrypted payload store owned by THIS domain (§6) — deliberately not `audit_event_payloads` |

Ownership/tenant scope: every row carries `org_id` AND `owner_user_id` (the stable `user_id`
from `govai.api_key_lookup_v2`, `pipeline/auth.ts:52-53`), both enforced by RLS as above.
Authorization = owner (or, post-R14, explicit sharing) — NOT participant rosters (§4).
**Denormalized ownership AND lineage are FK-BOUND to the parent, not merely stamped:** every
child row denormalizes its full ancestry `(org_id, owner_user_id, conversation_id, …)` and
references its parent by a COMPOSITE key that carries that ancestry. Branches carry
`UNIQUE (org_id, owner_user_id, conversation_id, id)`; turns reference
`(org_id, owner_user_id, conversation_id, branch_id) REFERENCES ai_conversation_branches
(org_id, owner_user_id, conversation_id, id)`; attempts/items/content/provider_state/
evidence_links continue the same chain, and the branch FORK references are lineage-bound as one
unit AND pinned to an IMMUTABLE ancestor: because retry makes a turn's eligible attempt mutable
(§7.6), a fork that named only a turn could silently change ancestry when the source turn is
regenerated. The fork therefore references the specific attempt:
`(org_id, owner_user_id, conversation_id, parent_branch_id, forked_from_turn_id,
forked_from_attempt_id) REFERENCES ai_conversation_attempts (org_id, owner_user_id,
conversation_id, branch_id, turn_id, id)` — one composite FK that simultaneously forces the
fork point to belong to the SAME conversation, the DECLARED parent branch, the named turn, and
a SPECIFIC attempt whose items never change. Fork creation additionally REQUIRES the pinned
attempt to be **`completed`** — the ratchet state with immutable items. Context-eligibility on
the attempt's ORIGINAL branch is deliberately NOT required: a completed attempt carrying the
§7.8 `context_excluded` marker is a VALID fork source — that fork is precisely how §7.8 says a
post-advance recovered answer is continued (the marker keeps it out of its original branch's
context; the child branch is where its causal line lives). Forking a
`stopped`/`failed`/`rejected` attempt would replay a partial or ineligible prefix, and an
`outcome_unknown` attempt may still mutate; fork requests naming any non-completed attempt are
rejected with a wait-or-retry pointer.
**CURRENT_ATTEMPT_LINEAGE_BINDING:** the REVERSE pointer that controls eligibility is
composite-bound exactly like the forward chain. `current_attempt_id` on a turn is constrained
by `(org_id, owner_user_id, conversation_id, branch_id, id, current_attempt_id) REFERENCES
ai_conversation_attempts (org_id, owner_user_id, conversation_id, branch_id, turn_id, id)` —
a turn structurally CANNOT select another turn's attempt, so a corrupt or accidental handoff
assignment cannot make the context builder consume unrelated output. The Turn→Attempt /
Attempt→Turn relationship is intentionally circular; the implementation mission resolves it
with a nullable `current_attempt_id` plus guarded transactional update and/or a DEFERRABLE
composite FK — a migration-time technique, deliberately not designed further here. Sweep
doctrine applied across the model — NO SECURITY/CAUSAL POINTER BY ID ALONE: every in-domain
causal pointer above is composite-bound; cross-DOMAIN attribution pointers
(`workroom_id`, future `project_id`) bind at least `(org_id, id)` to their target so an
attribution can never cross tenants, while carrying no owner column because those domains are
not owner-scoped.
**A fork declares its BOUNDARY MODE**, recorded durably on the branch, because "continue from
here" and "regenerate this answer" need different replay boundaries:
- `after_attempt` (continuation, the default): the child's context includes the pinned
  attempt's output and everything before it.
- `before_attempt_output` (regeneration of an earlier turn): the child's context includes every
  EARLIER turn's completed output plus the source TURN's USER items — which are TURN-owned and
  immutable from the reservation commit (§7.1), not attempt-owned — and EXCLUDES the pinned
  attempt's output. Mechanically, the fork creates a NEW TURN on the CHILD branch that COPIES
  the source turn's immutable user items, and the fresh attempt attaches to THAT turn — never
  to the source turn, which belongs to the parent branch and whose composite lineage FKs (§3
  above) would otherwise be violated. The pinned completed attempt still serves as the
  immutable ancestry marker in both modes.
Without the second mode, redirecting earlier-turn retry to the fork protocol would replay the
very response being regenerated and then answer AFTER it instead of REPLACING it. A CHECK requires the fork columns all-null on a root branch and all-set
on a fork. Fork-context replay reads THAT
attempt's items, so a later retry of the source turn changes nothing behind the fork — retry
after a fork stays permitted without ancestry drift, and a fork can never take its context from
conversation B, a sibling branch, or a regenerated attempt it did not name. Two corruption shapes are therefore structurally unrepresentable, not
query-discipline-dependent: a child whose stamped ownership disagrees with its parent's
(cross-OWNER grafting), and a child whose stamped `conversation_id` disagrees with its
parent branch's conversation (cross-CONVERSATION grafting within one owner — a turn keyed to
conversation A silently following a branch of conversation B).

## 4. Conversation ≠ Workroom (adjudicated boundary)

Hypothesis `AI_CONVERSATION_DOMAIN != WORKROOM_DOMAIN` was tested against source and SURVIVES.
Six structural blockers prove workroom tables cannot host ordinary chat:

1. The workroom transcript has **no read path by construction** (no `GET .../messages`; zero
   `SELECT` of `workroom_messages` in the tree; POST response omits content —
   `workroom-transcript.ts:341-358`).
2. `workroom_messages`/`workroom_turns` are **append-only for every role** via triggers
   (`0013:80-98`, `0012:260-273`) with `UNIQUE(workroom_turn_id)`; chat needs retry, regenerate,
   edit-forward, branch.
3. A workroom message **cannot trigger a provider invocation** — deliberate doctrine
   (`workroom-governance-room.md:712`); the run primitive takes one input string with no history
   (`run-orchestrator.ts:453-461`).
4. Every workroom message write mandatorily emits an audit event + evidence artifact
   (`workroom-transcript.ts:249-336`); casual chat would flood the tenant's `run` chain.
5. Approval gating, task coupling and participant-roster authorization are structural
   (`0015`, `workroom-runs.ts:177-213`, `workroom-transcript.ts:151-163`).
6. The doctrine says so in writing: a Workroom is not "a generic chat window"
   (`workroom-governance-room.md:53-61`); the AI Console's non-goals include "any Workroom
   responsibility" (`current-state.md:115`).

Boundary doctrine (normative):

- An AI Conversation is ordinary persistent user↔provider interaction, owner-authorized.
- A Workroom is a governance/collaboration/approval/evidence container, participant-authorized.
- A conversation MAY later: link to a workroom (`workroom_id NULL` attribution), be promoted into
  a workroom (copy/reference, one-way), be referenced by one, or supply SELECTED items as
  workroom evidence via the existing workroom write path. Ordinary chat never requires workroom
  creation, and workroom tables are never silently repurposed.
- Reused from the workroom domain: PATTERNS only (RLS style, id conventions, guarded-update
  trigger shape `0015:132-165`, keyset pagination, advisory-lock sequencing, envelope-encryption
  wire path). Not reused: its tables, its turn numbering, its membership model, its mandatory
  evidence emission.

## 5. Operational store ≠ forensic store

Two stores with different lifecycle physics:

- **Operational conversation store** (the `ai_*` tables): fast retrieval, history, resume, rename,
  archive, branch, retention, deletion. Mutable under guarded-update triggers (whitelisted
  columns), owner-scoped RLS.
- **Forensic evidence store** (`audit_events` + capture outbox + sealer): append-only,
  hash-chained, sealed. UNCHANGED by this design.

Rules (normative, from the evidence-plane adjudication):

1. The immutable audit payload table is NOT the operational conversation database. Conversation
   content lives in `govai.ai_conversation_content`, a domain-owned encrypted blob table shaped
   like `provider_credentials` (`ciphertext + dek_wrapped + kms_key_id/version`, `0009:25-38`) —
   the "domain-owned encrypted blob" template — with its own status machine
   (`active | crypto_shredded | tombstoned`) copied from `audit_event_payloads` (`0001:69-81`).
2. Nothing conversational is added to `AuditBridgeCapturePayloadV1`. It is a closed, hashed,
   immutable projection; any required field shifts every historical `payload_hash`
   (`audit-bridge-capture-payload.ts:6-15`; the 0026 scar). Only additive-OPTIONAL fields are
   hash-safe, and none are needed for V1 (§14 achieves correlation without schema change).
3. Conversation writes never ride the AuditBridge `best_effort` envelope
   (`audit-bridge.ts:39,111`): a continuity write that must succeed gets its own transaction and
   its own failure semantics.
4. Conversation events do not enter the `run` chain category (head-of-line sealing risk,
   `0025:112` strict contiguity). If conversation lifecycle evidence is later wanted, it is a new
   chain category — an explicit schema decision deferred out of V1.
5. What becomes evidence, when: exactly what already becomes evidence today — the provider
   invocation itself (v4 `passthrough.invoked` capture, hash-only). The conversation store adds a
   LINK to that evidence (§14), never a copy of it. Under a future operational mode/policy, a
   tenant may opt specific conversations into workroom-grade evidence via workroom promotion (§4);
   that is the only path by which conversation content acquires evidence-grade retention.
6. Deletion boundaries (§19): operational rows can be deleted/crypto-shredded; hash-only evidence
   of the provider calls remains, and the UI must say so.

## 6. Encryption at rest

- **No plaintext message-content storage, by default and by schema**: item content and attachment
  bytes live only as `ciphertext + dek_wrapped` via `Kms.envelopeEncrypt`
  (`packages/core-identity/src/kms/index.ts:40-53`; AWS adapter `kms/aws-kms.ts` with versioned
  envelope magic `GVK1`). A NEW KMS purpose (e.g. `conversation_content`) is added to the closed
  purpose enum (`kms/index.ts:7-11`) so conversation keys are derivationally isolated from
  `audit_hmac`/`payload_dek`/`provider_credential`. ADJUDICATED PREREQUISITE, because the enum
  value alone would be inert: the CURRENT envelope API accepts no purpose — both implementations
  hard-code `payload_dek` into the wrapping-key derivation (`kms/index.ts:128`,
  `kms/aws-kms.ts:229`) — so the continuity implementation must first EXTEND the envelope
  surface (purpose-parameterized `envelopeEncrypt`/`envelopeDecrypt`, or purpose-specific
  methods), with `payload_dek` remaining the default for every existing caller. A small,
  additive `core-identity` change, named here so the isolation claim is real rather than
  nominal.
- Key id/version are persisted per row (house convention); rotation remains an explicit future
  ADR (`audit-keys.ts:9-10`) — V1 inherits the frozen-key limitation and says so.
- **Titles are encrypted too.** Adjudication: titles are derived from user content (§18) and can
  leak the most sensitive line of a conversation; plaintext-for-UI-convenience is rejected.
  Sidebar listing decrypts titles server-side per page (page cap ≤ 50, §13), which is bounded and
  acceptable; a derived REDACTED display title (DLP-scrubbed) may later be stored alongside as a
  search accelerator — recorded as future work, not silently plaintext.
- Hashes: each content blob stores a **KEYED digest** — `hmacSha256` under a dedicated,
  purpose-isolated integrity key (the `Kms.hmacSha256` primitive with its own purpose), NOT a
  raw `sha256(plaintext)`: a deterministic unkeyed hash beside the ciphertext would let anyone
  holding a DB dump or backup — without KMS access — CONFIRM guesses of low-entropy content
  (titles, short replies, tool statuses, boilerplate prompts), quietly undercutting the
  encryption-at-rest boundary. The wire order stays hash → encrypt → store
  (`workroom-transcript.ts:215-222` convention). Where content is later PROMOTED to workroom
  evidence, the promotion path decrypts anyway and computes the evidence-plane `sha256`
  payload hash at that moment, in that domain — the operational keyed digest never doubles as
  an evidence hash.
- The browser stores nothing: the credential stays in the module-scoped holder
  (`apps/ui/src/lib/session/credential.ts`), and no conversation content enters
  localStorage/sessionStorage/IndexedDB (today's invariant, `persistence.test.tsx`, carried
  forward as an acceptance criterion).

## 7. Durable turn state machine

States (adjudicated; supersets the UI's in-memory `TurnState`):

```
draft → accepted → dispatching → streaming → completed
           │            │            │
           │            │            ├→ stopped          (user Stop; terminal event absent)
           │            │            ├→ failed           (provider/transport error, classified)
           │            │            └→ outcome_unknown  (dispatch fate unprovable)
           │            ├→ stopped / failed / outcome_unknown   (post-boundary, pre-stream — same semantics)
           │            └→ rejected                      (governance 403 / validation / 4xx before provider processing)
           └→ stopped                                    (user discards a QUEUED turn pre-dispatch — releases the branch queue, §8)
```

Normative rules:

1. `accepted` is COMMITTED (turn row + encrypted user items durable) BEFORE any provider dispatch
   (§8, §9). Reload after `accepted` always shows the user turn.
1b. A reservation is never attempt-less: the reserve-commit mints attempt 1 and sets
   `current_attempt_id` atomically (§9 step 1), keeping input items turn-owned — so
   attempt-scoped Stop, deletion fencing and worker recovery have their target from birth.
2. **A terminal provider event outranks local abort semantics** — the U1.5 lesson, already
   enforced client-side (`run-turn.ts:237-254`) and now enforced server-side: if the terminal
   frame was observed, the attempt is `completed` even if the user pressed Stop or the browser
   vanished.
3. Browser disconnect is NOT a failure state. The server-side turn runner owns the provider
   stream (§9); client disconnect changes only delivery, mirroring the EP-008C detach discipline
   (`sse.ts:63-79` on the client; `pumpStreamWithTerminalEmit` on the server).
4. `stopped` means user-intent stop honored with no terminal frame; `failed` carries the existing
   error taxonomy (`blocked | auth_rejected | request_too_large | rate_limited |
   credential_unavailable | provider_error`, `run-turn.ts:323-331`); `outcome_unknown` is the
   honest ambiguous-upstream state, named identically to the run-dispatch vocabulary
   (`core-events` `RunStatus`, 0029).
5. Only `completed` attempts are `eligible_for_context` (matches `types.ts:75-77`) — AND only a
   turn's CURRENT attempt contributes, AND the attempt must not carry the `context_excluded`
   marker (§7.8): a turn's context contribution is exactly its turn-owned user items plus its
   `current_attempt_id` attempt's completed, non-excluded output. A superseded attempt is NEVER
   context, however completed it is. **FORK-PIN EXEMPTION (the filters are branch-scoped):**
   currency and `context_excluded` are judgments about an attempt's standing on ITS OWN branch.
   On a fork CHILD, the §3 pin is itself the explicit selection, so at the fork boundary the
   PINNED attempt's completed output is context-eligible FOR THE CHILD (per its declared
   boundary mode) even if, on the parent branch, that attempt is superseded or
   `context_excluded`. The exemption is exactly ONE attempt wide: every other prefix ancestor
   is still evaluated under this rule on its own branch, and the pinned attempt remains
   excluded from its ORIGINAL branch's context. Without this, §7.8's prescribed recovery fork
   could pin an attempt whose output no strategy would ever replay.
6. Transitions are total, and ratchets are PER-ATTEMPT: every state names its successors and its
   inverse-or-ratchet (`completed/stopped/failed/rejected` are ratchets; `outcome_unknown` may
   resolve once to `completed`/`failed` by a recovery probe, never the reverse). A terminal
   ATTEMPT is never mutated — but the TURN's displayed state is DERIVED from its CURRENT attempt (state lives authoritatively on the attempt, §3),
   and **retry/regenerate is a defined operation, not an illegal un-ratchet**: it mints attempt
   N+1 on the same turn (same `client_turn_id` reservation, fresh `govai_request_id`), returning
   the turn to `accepted`-unclaimed so it re-enters the §8 queue and the standard four-commit
   flow (§8). Minting N+1 is an ATOMIC ELIGIBILITY HANDOFF: the same commit repoints the turn's
   `current_attempt_id` to N+1, so attempt N's completed output leaves the context domain
   immediately — without mutating attempt N's ratcheted rows — and N+1's request context is
   built from the earlier turns plus THIS turn's user items only, never any prior attempt's
   output. Without the handoff, retrying a COMPLETED last turn would include the very answer
   being regenerated and continue after it instead of replacing it.
   **RETRY_REGENERATE_CONTEXT_BOUNDARY (invariant):** the handoff governs BOTH context domains
   or it governs nothing — the boundary excluding attempt N's output must be identical in the
   GovAI durable-item projection AND in the provider continuation state the adapter will use.
   Repointing `current_attempt_id` alone is NOT a complete retry on any strategy that carries
   provider-side continuation: the same operation must rewind or rotate that state to the same
   before-N-output boundary (per-strategy mechanics in §11), and N+1 may not dispatch until
   both agree. Retry is permitted only while the turn is the LAST turn on its branch — retrying an
   earlier turn is a REGENERATION FORK from that turn (`before_attempt_output` boundary mode,
   §3), the same semantics reference products ship. At most one non-terminal attempt exists per turn (single-flight applies unchanged), and
   a prior attempt's taint consequences (§11) survive its successor.
7. **No stranded states, and claimants are FENCED.** An `accepted` attempt is in exactly one of
   two claim states: UNCLAIMED (queued — no claim, no deadline; exempt from deadline recovery
   and driven only by the §8 head-of-queue pickup, which is not deadline-gated) or ACTIVELY
   CLAIMED — `{claim_token, claimant, deadline}`; `dispatching` and `streaming` are always
   claimed. Deadline-based recovery applies ONLY to claimed attempts — ordinary queued work can
   never be misread as stranded — and each crash window has a defined recovery
   (the 0029 dispatch-boundary + `dispatch_token` discipline, applied per turn):
   - The runner's dispatch-boundary commit (`accepted → dispatching`) — the THIRD commit of
     the §8 four-commit protocol, after the reservation and the separate CLAIM commit that
     minted the token it fences — is
     written BEFORE any provider POST, and it is a CONDITIONAL compare-and-swap: it succeeds
     only where the committing runner's `claim_token` is still the turn's current token
     (`UPDATE … WHERE turn_id = ? AND state = 'accepted' AND claim_token = ?`, plus §8's
     branch-order predicate — no earlier non-terminal turn on the branch). Zero rows updated =
     fenced out or not yet at the head of the branch queue: abort without dispatching.
   - Re-claiming a past-deadline `accepted` turn (by the recovery sweep or by the next duplicate
     send, §8) ROTATES the claim token in its own committed CAS. From that commit on, the
     expired owner — merely stalled, not dead — can no longer pass its boundary CAS, so it can
     never POST. Boundary-before-POST alone does NOT serialize two claimants; the fencing token
     is what makes re-drive at-most-one-POST safe (§8), and the DB row is the single arbiter.
   - A turn past its deadline in `dispatching` (boundary committed, no terminal recorded)
     resolves to `outcome_unknown` (§7.4) — NEVER re-dispatched, by any claimant: post-boundary,
     a provider POST may already exist, so re-drive is forbidden and only the recovery probe may
     upgrade the state.
   - **The post-boundary window is governed as a LEASE, and the finalize-commit is fenced too.**
     A boundary CAS win alone cannot stop a runner that stalls between boundary and POST, then
     resumes after recovery has marked the turn `outcome_unknown` and released the branch queue
     — its first POST would race the next turn. Three rules bound that zombie:
     (1) the runner re-validates its lease immediately before the provider POST and aborts if
     the claim was rotated/expired; (2) the recovery sweep may not act on a `dispatching` turn
     before `deadline + δ` (an explicit grace window over the lease check, so a runner that
     validates in time POSTs before recovery moves); (3) the FINALIZE-commit carries the same
     claim-token CAS as the boundary commit — a zombie that slips through (1)/(2) via an
     unbounded pause between its lease check and its POST cannot write ANY durable state: its
     finalize loses the CAS and is discarded with a diagnostic, its attempt stays
     `outcome_unknown`/superseded, its output never becomes `eligible_for_context`, and
     `provider_state` keeps a single fenced writer. ONE narrowly-typed write survives the
     fence: a discarded finalize MAY append an ORPHAN-DISPOSAL record —
     `{org, owner, conversation, provider, object_kind, provider_object_id}` — to a dedicated
     append-only cleanup ledger that is branch-state-INDEPENDENT and, by the §3 exception,
     CONVERSATION-LIFECYCLE-INDEPENDENT: the append works even after the conversation was
     purged, so a zombie that resumes post-deletion still hands its provider identifier to
     cleanup instead of stranding a provider object behind a completed deletion. The ledger's
     `provider_object_id` is envelope-encrypted at append time (§3/§6) — the fenced writer
     encrypts before the append, and only an owner-context worker decrypts. Without it, a fenced chaining
     runner that received a stored provider response would discard the only copy of that
     response's id, and §19's provider cleanup could never delete an orphan it has no
     identifier for; provider-retained content would survive user deletion. The ledger is a
     disposal queue, never context or provider_state — writing to it asserts nothing about the
     turn. (Rotation-abandoned shared objects have the same guarantee differently: superseded
     `provider_state` rows stay durable until §19 cleanup consumes them.) Where the branch uses
     PROVIDER-HELD shared continuation state (the OpenAI conversation-object strategy), the
     fence cannot reach the provider's copy — that exposure is closed by §11's
     taint/reconcile-or-rotate rule, which forbids blind reuse of the shared object after any
     `outcome_unknown`. Honest residual, stated not hidden: without receiver-side fencing
     (providers accept no fencing token), such a zombie can still SPEND provider tokens on a
     discarded response — the protocol guarantees durable-state integrity,
     context/provider-state ordering, shared-state hygiene (§11) and orphan disposability, not
     zombie-spend prevention.
   - **The lease covers the ENTIRE post-boundary window — `dispatching` and `streaming` alike —
     and the heartbeat is TIMER-driven, never event-driven.** The owning runner renews its claim
     on a concurrent timer from the moment the boundary commits: while the provider POST is in
     flight (before the first byte — a slow non-stream response or slow time-to-first-byte is a
     LIVE attempt, and must not be ratcheted out from under a healthy runner), and while
     pumping. The same timer tick also READS the durable stop-request flag (§13 Stop), so both
     lease renewal and stop observation are bounded by the heartbeat interval even when the
     provider produces no events at all. Persistence of stream items continues incrementally,
     so the durable prefix always reflects what was relayed. **Every incremental write is fenced, not just the finalize:** each item-append
     transaction is conditional on `claim_token = <mine> AND state = 'streaming'`, and each
     HEARTBEAT on `claim_token = <mine> AND state IN ('dispatching', 'streaming')` — the
     heartbeat predicate accepts BOTH post-boundary states, because the timer starts at the
     boundary commit and a time-to-first-byte longer than one interval would otherwise make a
     healthy runner's first tick touch zero rows and self-abort. Zero rows touched means the
     writer has been fenced out (or the attempt ratcheted) and MUST abort its relay. Without this, a stalled
     pump that resumes after the recovery ratchet could keep appending to a prefix the ratchet
     already declared terminal-partial, silently mutating "terminal" state the finalize CAS
     alone does not protect. A `streaming` turn whose lease has lapsed past `deadline + δ` is resolved
     by the recovery sweep exactly like a lapsed `dispatching` turn: provider recovery probe
     where one exists (OpenAI response retrieval), otherwise ratchet to `outcome_unknown` — with
     the durable item prefix retained and MARKED PARTIAL, never presented as a completed
     answer. Reload during this window hydrates the partial prefix and then observes the
     ratchet; it never waits on a dead runner. Since `streaming` is branch-blocking in §8, this
     rule is what guarantees the queue always drains after a crash.
   `accepted` is therefore a state with an exit on every path, and every durable exit — boundary
   AND finalize — is single-writer.
8. **BRANCH_CAUSAL_CONTEXT_MONOTONICITY.** `outcome_unknown` is queue-terminal (§8), so turn
   N+1 may legitimately dispatch WITHOUT N's output. If a later provider recovery probe then
   discovers that N actually completed, the upgrade must not rewrite the branch's causal
   history: without this rule, §7.5 would automatically restore recovered-N to eligibility and
   turn N+2 would be generated WITH an output N+1 was generated WITHOUT — and the provider
   continuation state (already causally rooted in N+1) would diverge from the durable replay
   projection. **RECOVERY_ADVANCE_SERIALIZATION:** the advance check and the eligibility
   decision execute UNDER THE BRANCH EXECUTION AUTHORITY — the same per-branch serialization
   primitive every dispatch-boundary commit holds (§8/LAW 16) — atomically with the upgrade.
   An atomic-but-unserialized check would race a concurrent N+1 boundary transaction (probe
   observes "not advanced" while N+1 builds context without N; both commit; monotonicity
   broken). Under the shared authority exactly two orderings exist and both are safe: PROBE
   WINS — N's eligibility resolves first, and N+1's boundary (acquiring the authority
   afterward) builds the resulting context; DISPATCH WINS — N+1's boundary commits first
   without N, and the probe (acquiring the authority afterward) observes the advance and
   records `context_excluded`. There is no third outcome. **And the REQUEST PAYLOAD obeys the
   same serialization (causal-context version):** context construction is deliberately done
   OUTSIDE the authority (it involves decrypt work — holding a lock across it would serialize
   the world), so a probe could still win the authority BETWEEN a runner's context build and
   its boundary commit, leaving a stale request that contradicts the probe-wins outcome. Every
   branch therefore carries a monotonic `causal_version`, bumped by EVERY eligibility-changing
   commit (probe upgrades, eligibility handoffs, `context_excluded` markings); the runner
   records the version its context was built at, and the dispatch-boundary CAS carries
   `causal_version = <as-built>` as one more predicate — a stale build loses the CAS before
   any POST (boundary-before-POST, §7.7) and simply rebuilds. The probe's decision branches:
   - **Branch NOT advanced** (no later turn on the branch has crossed its dispatch boundary
     since N was ratcheted — queued reservations do not count): the recovered attempt regains
     ordinary eligibility. This is safe by construction, because every strategy derives its
     next continuation from the durable projection at dispatch time (§11): stateless replay and
     chaining anchors are computed from context-eligible attempts, and the recovery-ratchet
     taint already forces conversation-object ROTATION seeded from durable items — both
     domains reconcile to the same boundary with no extra machinery.
   - **Branch ADVANCED** (any later turn crossed the boundary after the ratchet): the upgrade
     records `completed` WITH a durable `context_excluded` marker, permanently. The recovered
     answer is TRANSCRIPT-ONLY on that branch: visible to the user, honestly labeled, never
     context (§7.5). Continuing WITH the recovered answer is an explicit FORK pinned to the
     recovered completed attempt (§3 — fork requires `completed`, which it now is); the fork's
     child branch is where that causal line lives, and §7.5's fork-pin exemption is what makes
     the fork EFFECTIVE — the pinned recovered output IS context on the child while remaining
     excluded from the original branch.
   No retroactive context insertion after branch advance — the branch's context history only
   ever moves forward.

## 8. Durable send / idempotency

- **CONVERSATION_LIFECYCLE_RESERVATION_SERIALIZATION:** every operation that creates an
  execution-capable descendant of a conversation — a Send reservation, a Retry attempt mint, a
  Fork branch creation — serializes against lifecycle transitions on the SAME conversation root
  inside ONE transaction: take the conversation row lock (`SELECT … FOR UPDATE` on
  `ai_conversations`, or a conditional write with source-proven equivalent serialization),
  REVALIDATE `status` under the lock, then write. A check-then-write sequence (validate
  `active` → deletion commits `deleted_pending` → child insert succeeds) is forbidden: it
  creates a late execution-capable descendant deletion never enumerated — unfenced,
  unclaimable after `deleted_pending`, and able to strand deletion at its wait-for-terminal
  step or race the purge. The lock yields exactly two orderings, both safe:
  (A) the reservation wins — it validates `active`, commits its child, and the deletion
  (acquiring the lock afterward) SEES and fences the now-existing work in its §19 enumeration;
  (B) the deletion wins — `active|archived → deleted_pending` commits atomically, the waiting
  reservation rechecks status under the lock and REJECTS, and no new descendant exists. The
  same discipline yields the remaining proofs: a queued reservation can never claim after the
  root is `deleted_pending` (the §7.7/§8 claim CAS predicates exclude `deleted_pending`
  conversations); already-in-flight attempts remain covered by §19's stop-and-wait fencing;
  archived deletion is unchanged (§19 admits both origins); and duplicate idempotent
  operations stay coherent because replay reads current state under the same lock discipline.
- The client generates `client_turn_id` (UUID) at Send. Uniqueness arbiter:
  **`PRIMARY KEY (org_id, conversation_id, client_turn_id)`** on the turn-reservation row —
  the `run_idempotency` composite-PK pattern (`0030:22-31`, `INSERT … ON CONFLICT DO NOTHING
  RETURNING`), immutable-by-privilege (SELECT+INSERT grants only).
- One UI Send = at most one provider POST, regardless of StrictMode double-invoke, double click,
  browser retry or reconnection: the duplicate reservation returns the existing turn (replay
  semantics, `x-govai-…-replay` header convention of `routes/runs.ts:126`). Replay reflects the
  turn's CURRENT durable state — a duplicate is a read, never a verdict:
  - queued `accepted` → "queued" (position visible);
  - stranded pre-dispatch `accepted` (deadline elapsed, no boundary commit — §7.7) → the
    duplicate re-claims via the fencing CAS (rotating the claim token, locking the stalled
    owner out at its boundary commit) and DRIVES the turn rather than echoing one that will
    never execute;
  - LIVE `dispatching`/`streaming` under a valid heartbeating lease → the current live state
    plus the §10 re-attach pointer. A healthy post-boundary turn is NEVER reported
    `outcome_unknown` merely for lacking a terminal event — StrictMode, double-click and
    browser-retry duplicates are routine, and an ambiguous-failure reply for a healthy turn
    would be a false verdict;
  - `outcome_unknown` appears in a duplicate's reply ONLY when recovery actually ratcheted the
    attempt there (§7.7). Never a second POST in any branch.
- **`outcome_unknown` is QUEUE-TERMINAL.** The branch-order predicate blocks only on
  `accepted | dispatching | streaming`; every other state — `completed`, `stopped`, `failed`,
  `rejected` AND `outcome_unknown` — releases the queue. Where no recovery probe exists
  (Anthropic has none, §8 above), an unknown outcome would otherwise block the branch forever.
  Context honesty: an unknown attempt is not `eligible_for_context`, so later turns dispatch
  without it; what a LATER probe upgrade may or may not restore is governed entirely by
  §7.8's BRANCH_CAUSAL_CONTEXT_MONOTONICITY — pre-advance recovery restores eligibility,
  post-advance recovery is transcript-only with `context_excluded`, and continuation with the
  recovered answer is an explicit fork.
- A NEW header (e.g. `X-GovAI-Client-Turn-Id`) and a NEW reservation table are minted. The
  existing `X-GovAI-Idempotency-Key` (evidence-capture identity, stripped at ingress,
  `request-identity-hook.ts:79`) and `X-GovAI-Run-Idempotency-Key` (run intent) are NOT
  overloaded — the repo's established rule (`run-idempotency.ts:14-24`).
- Intent hashing: same-key + different-body ⇒ 409 conflict, via a LOCAL `stableCanonicalJson`
  clone (never evidence canonicalization — `run-idempotency.ts:164-170` rule).
- **No provider exactly-once is claimed.** If the server crashes after dispatch and before any
  terminal record, the attempt resolves to `outcome_unknown` (§7); a bounded recovery probe (via
  provider-side state where it exists: OpenAI `GET /v1/responses/:id`; else none) may upgrade it.
- Provider dispatch NEVER occurs inside a long DB transaction — the P0.3-A durable-dispatch
  boundary law (0029), extended here to a FOUR-commit protocol because reservations are born
  UNCLAIMED (§7.7/§8): reserve-commit (`accepted`, no claim) → CLAIM commit (the head-of-queue
  claim CAS on the unclaimed head, minting `{claim_token, claimant, deadline}` — the §8
  pickup, whether performed by the creating request at head, a terminal-transition wake, or
  the sweep) → context construction OUTSIDE any lock (recording the as-built `causal_version`,
  §7.8) → dispatch-boundary commit (`dispatching`, BEFORE any provider POST) → provider POST →
  finalize-commit (terminal state). The boundary commit VALIDATES the ALREADY-HELD
  `claim_token` (plus the `causal_version` predicate); it never mints the claim — collapsing
  claim and boundary into one commit would leave the boundary CAS no previously owned token to
  fence, and §7.7's fenced writes all presuppose `claim_token = <mine>` from before the
  boundary. Each inter-commit crash window has the defined recovery of §7.7.
- **Terminalization WAKES the queue — a queued turn never waits for luck.** A turn that loses
  the branch-order predicate is reserved durably and returned to its sender as queued, but no
  one would otherwise drive it: the design therefore defines the dequeue mechanism explicitly.
  (1) In-process: whichever runner commits ANY terminal transition on a branch (finalize,
  rejection, stop, or a recovery ratchet) immediately attempts a normal claim CAS on the
  branch's next `accepted` turn — that claim CAS IS the four-commit protocol's CLAIM commit —
  and, on success, drives the remaining commits (context build → boundary → POST → finalize). (2) Cross-process / crash: the periodic recovery sweep claims any UNCLAIMED `accepted`
  turn standing at the head of its branch (no earlier non-terminal turn) — head-of-queue
  pickup is NOT deadline-gated; deadlines govern only the RE-claiming of already-claimed turns
  (§7.7). Claim lifecycle stated plainly: a reservation is born unclaimed; its creating request
  claims and drives it only if it is at head; otherwise it waits for the terminal-transition
  wake or the sweep, whichever comes first.
- **Distinct sends on one branch are SERIALIZED at dispatch, not just at numbering.** The
  per-branch advisory lock orders `turn_seq` assignment only — two tabs reserving different
  `client_turn_id`s both succeed and would otherwise dispatch concurrently, letting the later
  turn build context without the earlier result and racing writes to per-branch
  `provider_state` (e.g. `previous_response_id`). Rule: a branch is SINGLE-FLIGHT. The
  dispatch-boundary CAS (§7.7) executes UNDER the branch execution authority (the per-branch
  serialization primitive of LAW 16 — the same authority §7.8's recovery decision must hold)
  and carries two further predicates — no
  earlier-`turn_seq` turn on the branch in a non-terminal state, AND the §7.8 causal-context
  version the request was built at still current — so reservations form a
  durable per-branch queue that dispatches strictly in `turn_seq` order with never-stale
  request payloads, each turn's context
  includes every earlier terminal outcome, and `provider_state` has one writer at a time. A
  queued turn is visible to the UI as pending; Stop/discard of a queued turn is an ordinary
  pre-dispatch transition (`accepted → stopped`), which unblocks the queue behind it.

## 9. Dispatch boundary and server-owned stream

The durable-turn runner is a server-side component (apps/api) that:

1. commits the reservation + user items + the INITIAL ATTEMPT ROW, with `current_attempt_id`
   set, in ONE transaction — a turn NEVER exists without an attempt, because every control and
   recovery surface is attempt-scoped: §13's Stop names an `attemptId`, §19's deletion
   stop-requests non-terminal ATTEMPTS, and the §9 worker holds SELECT/UPDATE (not INSERT) on
   attempts — a crash immediately after an attempt-less reservation would otherwise strand the
   turn beyond every recovery path, blocking its branch queue and its conversation's deletion
   (`accepted`, born UNCLAIMED — §8's claim lifecycle:
   a claim, and the deadline that belongs to it, is acquired only by a successful
   head-of-queue claim CAS, whether by this creating request when the turn is at head, by a
   terminal-transition wake, or by the sweep; deadlines attach to CLAIMS, never to
   reservations, so a queued turn is always claimable the moment it reaches head);
2. commits the CLAIM (the §8 four-commit protocol's CLAIM commit): if the turn is at its
   branch head, the creating request performs the head-of-queue claim CAS, minting
   `{claim_token, claimant, deadline}`; otherwise it returns "queued" to its sender and steps
   3–6 run later under WHICHEVER claimant wins the head-of-queue pickup (terminal-transition
   wake or sweep) — the remaining steps belong to THE CLAIMANT, not necessarily the reserving
   request, and no context construction happens before a claim is held;
3. builds the provider request via the adapter (§11) from durable context — not from browser
   memory — recording the as-built `causal_version` (§7.8);
4. commits the dispatch boundary (`dispatching`) as the §7.7 fencing CAS on the step-2 claim token —
   losing the CAS means another claimant owns the turn: abort with no POST — minting and
   persisting the attempt's `govai_request_id` and then ENTERING the identity scope itself
   (§14.1: the runner constructs the `AuditBridgeRequestIdentity` and wraps the pipeline call
   in `requestIdentityAls.run()`, because neither `/v1/ai/*` requests nor detached
   sweep/wake-driven workers pass the ingress identity hook), and only THEN
   dispatches to the SAME provider-native pipeline the direct routes use (credential resolution,
   DLP, tool classifier, beta policy, capture — unchanged semantics; the governed/passthrough
   distinction is carried per conversation mode); boundary-before-POST plus the fenced CAS is
   what makes §7.7's stranded-turn recovery at-most-one-POST safe;
5. owns the SSE pump to terminal (the `provider-stream-http` primitives —
   `pumpStreamWithTerminalEmit` — are the template), persisting items incrementally and the
   terminal state durably;
6. relays the live stream to the browser as a spectator: the browser reads, the server owns.

This inverts today's browser-owned flow and is what makes §7's rules enforceable. The existing
six direct routes remain untouched for API-native callers; the conversation runner is an
ADDITIONAL caller of the same provider pipeline, not a fork of it (two-speed doctrine, ADR-029
posture, without adjudicating that Proposed ADR).

**Detached recovery discovery under FORCE RLS (the sweep is not structurally blind), executed
under a SEPARATE WORKER IDENTITY (WORKER_IDENTITY_SEPARATION / OWNER_DISCOVERY_NON_IMPERSONATION).**
The dual-predicate RLS of §3 makes every `ai_*` table invisible to a session without BOTH
`app.org_id` and `app.user_id` — which a detached sweep does not have, and §22 forbids handing
any broad reader identity conversation-table grants. The resolution is the repo's own 0029
precedent (`govai.run_dispatch_recovery_candidates`, SECURITY DEFINER, keyset cursor): two
narrow **claim-plane discovery functions** — `govai.ai_turn_recovery_candidates(...)`
(returning ONLY claim metadata: `org_id`, `owner_user_id`, `conversation_id`, `turn_id`,
`state`, claim token/deadline, branch-head flags) and `govai.ai_cleanup_candidates(...)`
(returning ONLY `{org_id, owner_user_id, conversation_id, cleanup_job_id (an OPAQUE row id),
cleanup state/attempts}` — deliberately never provider, `object_kind` or `provider_object_id`,
which §21 classifies as sensitive) — both SECURITY DEFINER with a FIXED `search_path`,
`REVOKE ALL FROM PUBLIC`, keyset-cursor bounded, content-free.
**EXECUTE is granted to a DEDICATED worker identity — never to `govai_app`.** The RLS trust
model treats `app.org_id`/`app.user_id` as APPLICATION-established security context derived
from authenticated identity — they are authorization, not data. A discovery result containing
`(org_id, owner_user_id)` is therefore a set of REUSABLE CREDENTIALS for every policy in the
domain: if the shared request role could invoke discovery, any ordinary API database session
could enumerate valid owner identities and then follow the prescribed `set_config` step to
assume each owner's RLS context and read their conversations — stripping content from the
result does not preserve isolation when the result IS the credential. Consequently, the
ordinary request role and the detached-worker identity are DISTINCT TRUST DOMAINS:
- the request pool (`govai_app`) holds NO EXECUTE on either discovery function, cannot
  `SET ROLE` to the worker, and the worker role is NOINHERIT and never granted to `govai_app`
  — renaming without this separation would create no boundary;
- the detached workers run on a dedicated least-privilege identity (source-adjudicated
  equivalent of `govai_conversation_worker`, following the repo's dedicated-role precedents —
  `govai_audit_writer`, `govai_evidence_enumerator` — including the complete entry-time
  lifecycle section the INV-1 lesson requires: provision/deprovision, NOINHERIT,
  no-login-until-provisioned, separate credential and connection-pool lifecycle);
- **WORKER_LEAST_PRIVILEGE_UNDER_FORCE_RLS:** table privilege and RLS are CUMULATIVE controls
  — RLS answers "which rows may this authorized operation touch?", never "may this role
  SELECT/UPDATE at all?" — so "zero table grants + ordinary RLS-scoped work" is internally
  inconsistent and is NOT the model. The worker identity holds EXECUTE on the two discovery
  functions PLUS the MINIMUM ordinary table privileges its flows require (matrix below), under
  FORCE RLS like every other session: no `BYPASSRLS`, no table ownership, no superuser,
  `NOINHERIT`, never grantable to or `SET ROLE`-able from `govai_app`. The detached workflow is
  therefore: worker identity → SECURITY DEFINER discovery (opaque candidate + minimum owner
  identity) → transaction-local owner context → ordinary least-privilege SQL → FORCE RLS
  row-scoping → candidate processing. SECURITY DEFINER surface stays MINIMAL — discovery only;
  worker logic is NOT folded into large definer procedures to dodge grants (that would enlarge
  privileged code and hollow out auditability); if implementation proves one narrow definer
  mutation safer for a specific step, it is documented as an explicit exception.
- **Worker privilege matrix (conceptual, least-privilege; the implementation mission derives
  exact grants from it — column-level narrowing preferred where the house conventions support
  it and it meaningfully reduces authority):**

  | Flow | Resource | Privileges | Rationale |
  |---|---|---|---|
  | Recovery/queue-head pickup, reclaim, lifecycle mutation | `ai_conversation_attempts` | SELECT, UPDATE | claim CAS, lease/heartbeat, stop-flag read, state transitions, ratchets/probe upgrades, `context_excluded` — ALL lifecycle authority lives on the attempt (§3) |
  | Queue predicates, reservation identity reads | `ai_conversation_turns` | SELECT | turn rows carry no lifecycle state (§3); recovery reads reservation identity, `turn_seq` ordering and `current_attempt_id` only |
  | Context build + incremental stream persistence (worker-driven runner) | `ai_conversation_items`, `ai_conversation_content` | SELECT, INSERT | replay projection reads; fenced item/blob appends |
  | Provider-state reconciliation/rotation/taint | `ai_conversation_provider_state` | SELECT, INSERT, UPDATE | anchors, taint flags, rotation supersession |
  | Branch causal authority (single-flight predicate, fork ancestry checks, `causal_version` bump, LAW 16 level-2 row lock) | `ai_conversation_branches` | SELECT, UPDATE (column-narrowed to `causal_version` where house conventions support it) | EVERY worker-side eligibility-changing commit (§7.8 probe upgrades, completion eligibility handoffs, `context_excluded` markings) MUST bump the branch `causal_version` in the SAME transaction — SELECT-only would silently omit the bump and let an already-built stale request pass its boundary CAS; and the LAW 16 level-2 branch row lock is itself unrealizable without UPDATE (PostgreSQL row-locking reads — `SELECT … FOR UPDATE`/`FOR NO KEY UPDATE` — require UPDATE privilege). Still NO INSERT/DELETE: branch creation stays request-plane (fork); removal stays §19 purge-step |
  | `deleted_pending` completion + purge | `ai_conversations` + child tables | SELECT, UPDATE; DELETE (purge step ONLY) | status transitions; §19 step-4 row purge |
  | Orphan-disposal processing | disposal ledger | SELECT, UPDATE, INSERT, DELETE | read job under owner RLS, record outcomes/retries; INSERT for worker-side enqueue during recovery AND the §19 step-4 same-transaction transcription of still-pending provider cleanup at purge; DELETE strictly post-success (§19 removes completed rows — the ledger outlives purge, so without removal its encrypted provider identifiers would accumulate indefinitely) |
  | Evidence-link post-processing | `ai_conversation_evidence_links` | SELECT, INSERT — CONDITIONAL | only if §14 linkage is materialized by the worker; otherwise no grant |

  **Provider-pipeline execution privileges (worker-driven dispatch):** the worker does not
  only manage conversation rows — a claimed turn DISPATCHES through the SAME provider-native
  pipeline (§9), and that pipeline reads and writes beyond the `ai_*` domain. Denying the
  worker everything else would make background dispatch fail at credential resolution
  (`pipeline/provider-credentials.ts:124-137` SELECTs `govai.provider_credentials`, which 0009
  grants to `govai_app` only) and silently drop evidence capture. The matrix therefore
  includes, org-scoped under the entered owner context and FORCE RLS:

  | Flow | Resource | Privileges | Rationale |
  |---|---|---|---|
  | Credential resolution | `govai.provider_credentials` | SELECT | tenant-key decrypt path; 0009's org-scoped RLS applies; never outside the entered org context |
  | Evidence capture | `govai.audit_capture_insert_locked(...)` (+ the bridge's read surface) | EXECUTE | a worker-driven dispatch must capture identically to a request-driven one — never a silent evidence gap |
  | Tenant governance inputs | `govai.org_tier_lookup(...)`; org-scoped governance config the pipeline reads (capability/beta overrides, DLP custom patterns) | EXECUTE / SELECT | governed-lane resolution needs tier/mode + org config; exact object list is TRACED FROM THE PIPELINE at implementation, not guessed |

  Acceptance proofs at implementation: (positive) a worker-driven dispatch resolves
  credentials, applies governance and captures evidence byte-equivalently to a request-driven
  dispatch; (negative) the worker cannot read `provider_credentials` outside the entered org
  context, and holds no privilege the traced pipeline does not require. The alternative — a
  separate-identity "handoff" that re-enters dispatch through an app-identity execution
  service — is REJECTED: it would blur the §9 trust boundary by making the worker able to
  invoke app-identity execution anyway, while doubling the execution paths to audit.
  No worker privilege on anything else (titles are readable via `ai_conversations` SELECT the
  lifecycle flow already requires; attachments/artifacts are request-plane in V1).
- **Owner-context lifecycle (no cross-candidate leakage):** the worker sets BOTH GUCs
  TRANSACTION-LOCALLY (`set_config(..., true)`) at the start of each candidate's transaction;
  commit/rollback clears them, so a pooled connection cannot carry candidate A's identity into
  candidate B's work even on reuse — plus a defensive context reset on connection checkout.
  Candidate processing never begins without explicit context establishment; negative
  integration proofs (context-leak and cross-candidate tests) are required at implementation.
  Doctrine: `app.org_id`/`app.user_id` are APPLICATION-established database security context
  derived from authenticated identity or from a discovered candidate under the worker's
  authority — never end-user-supplied tokens. Threat-model honesty: compromise of the worker
  DATABASE CREDENTIAL is a privileged-component compromise; least privilege + FORCE RLS bound
  the blast radius and catch programming mistakes, they do not make a stolen worker credential
  harmless — credential custody follows the same secret-handling rules as every other
  privileged credential in the platform.
**Detached-flow sweep (no worker security model left implicit)** — every cross-owner background
flow uses exactly this shape: DB identity = the worker role; discovery primitive = one of the
two functions above; discovery data = claim/job metadata only; owner context = per-item
`set_config` from the candidate row; `govai_app` = no access; provider/content identifiers =
read only after owner-context entry. This covers: the recovery sweep, head-of-queue pickup
after a process crash, the cleanup worker, provider-object deletion, orphan-disposal retry,
`deleted_pending` completion, and any future background reconciliation — a new detached flow
must either fit one of the two functions or add its own, under the same identity and the same
constraints. These TWO definer functions remain the only RLS bypasses, and both are
content-free by construction.

## 10. Reload / reconnection contract

Product goal (normative): reload → reopen same conversation → durable user turn visible →
current terminal state visible → assistant output recovered when possible.

- If the turn is terminal: `GET` hydrates the full attempt (items + receipt). Always works.
- If the turn is `streaming`: the client re-attaches to the server relay (live tail from the
  durable item prefix + ongoing deltas). The server never depended on the first browser.
- Provider-side resumability is adapter-specific and used opportunistically by the SERVER, not
  required: OpenAI Responses supports background mode + `GET /v1/responses/:id?stream=true&
  starting_after=<n>` re-cursoring (verified GA 2026-08-21); Anthropic Messages streams are not
  re-cursorable (no server-stored `/v1/messages` state — verified stateless 2026-08-21), so
  recovery there = server-drained terminal + hydrate.
- Minimum bar when replay is impossible: the server persists/drains the terminal result and a
  subsequent GET hydrates it. Browser memory is never the sole owner of a stream result.

## 11. ProviderConversationAdapter

One interface, per-provider strategies; providers are NOT forced into identical state models:

```
ProviderConversationAdapter
  buildNextRequest(branchContext, newUserItems, config) → native request body
  captureNativeItem(streamEvent | responseBody)         → typed items (§12)
  captureProviderState(responseMeta)                    → provider_state delta
  restoreContinuation(provider_state, branchContext)    → continuation inputs
  forkContinuation(provider_state, atTurn)              → forked state or NEED_REPLAY
  supportsResume() / supportsProviderStoredState() / supportsStatelessReplay()
  compactIfSupported(branchContext)                     → provider-native compaction call or NO_OP
```

Per-provider adjudication (provider facts verified 2026-08-21, first-party):

- **OPENAI (Responses family)**: three continuation strategies, in preference order —
  (1) `conversation` objects (`POST /v1/conversations`, GA) where tenant policy permits
  provider-stored state; (2) `previous_response_id` chaining with `store:true`;
  (3) stateless replay of persisted native output items (incl. `encrypted_content` reasoning
  items, emitted by default in stateless mode) for ZDR-style tenants. Compaction:
  `context_management: [{type:"compaction"}]` + `POST /v1/responses/compact`.
  Chat Completions lane: stateless replay only. Provider-stored state creates provider-side
  deletion obligations (§19).
  **Retry mechanics per strategy (§7.6's RETRY_REGENERATE_CONTEXT_BOUNDARY):**
  - *Chaining (`previous_response_id`)*: every attempt durably records, at dispatch, the
    CONTINUATION ANCHOR it chained FROM (`continuation_parent_response_id` on the attempt row).
    A retry of completed attempt N chains N+1 from N's recorded PARENT anchor — never from N's
    own response id, which the branch's provider_state still names as latest and which §11's
    preference order would otherwise select, silently continuing after the answer being
    regenerated. If the parent anchor is unavailable (expired, or stored with `store:false`),
    the retry is FORCED through stateless replay, whose durable-item projection already
    excludes superseded attempts.
  - *Conversation objects*: attempt N's completed answer is INSIDE the shared object, and a
    normal completion never taints it — so a completed-turn retry MUST NOT reuse the object.
    The retry rotates: a fresh conversation object (or stateless replay) seeded to the
    before-N-output boundary from durable items; the superseded object follows the standard
    §19 cleanup path via its retained provider_state row.
  - *Stateless replay*: inherently boundary-correct — the projection is the boundary.
  - *Codex / Claude Code*: regenerate maps to the harness's own fork-from-boundary primitive
    (`thread/fork` before N's turn; session fork via the SessionStore) — never in-place
    mutation of the shared thread/session an expired or superseded attempt already touched.
  **Zombie-vs-shared-state rule (the §7.7 fence does not reach the provider):** the three
  strategies are NOT equally exposed to a zombie POST that lands after the branch queue is
  released. Chaining and stateless replay are structurally insulated — a zombie's stored
  response is simply never referenced (the next turn chains from the last KNOWN completed
  response id), leaving only an orphaned provider object for §19 cleanup. A shared
  `conversation` OBJECT is not insulated: the provider appends output to state every later turn
  implicitly consumes. Therefore, on a branch using the conversation-object strategy, ANY
  post-boundary attempt that ends NOT `completed` — `outcome_unknown`, `stopped` (a user Stop
  after the POST began can still leave a full provider-side append behind the abort), or a
  `failed` whose error class does not PROVE the provider never processed the request — marks
  that branch's `provider_state` **TAINTED**, and the next turn MUST NOT blindly reuse the
  conversation object. The clearing criterion is single and strict: **was the PROVIDER'S
  terminal verdict for the tainting request observed?** A reconcile that sees "no phantom
  append yet" proves nothing — not for a zombie that has not POSTed yet, and not for an aborted
  request either: closing the runner's LOCAL HTTP request does not prove the provider stopped
  processing what it had already buffered, so a delayed append can land after the observation.
  - **Provider-terminal-evidence taint** (the provider's own verdict for that request was
    received: a terminal error RESPONSE body, or a terminal stream frame — the request's fate
    is settled provider-side): reconcile-or-rotate. Listing the conversation's items and
    adopting-or-recording what is there is sound, because nothing more from that request can
    arrive.
  - **No provider terminal evidence** (aborted mid-flight, transport failure, timeout,
    `outcome_unknown` — regardless of who reported the local state): **ROTATION IS MANDATORY.**
    The next turn abandons the shared object — a fresh conversation object or stateless replay
    seeded from the durable items — and the abandoned object becomes a §19 cleanup orphan;
    whatever lands late arrives in state no later turn will ever read.
  Only a pre-boundary outcome or a provably-unprocessed failure (e.g. a 4xx rejected before
  processing — which IS provider terminal evidence) leaves the object clean. The taint never
  clears by time.
- **ANTHROPIC (Messages)**: the API is stateless — full message list resent per call (verified;
  the only server-stored state in the platform is beta Managed Agents, out of V1 scope).
  Strategy: stateless replay from durable items with STRICT preservation of thinking blocks +
  signatures per current continuation rules (pass back unchanged within tool-use turns; per-model
  keep-all vs auto-strip; strip on model switch), compaction blocks echoed verbatim
  (`compact-2026-01-12` beta), `cache_control` breakpoints managed by the adapter. Prompt caching
  is a cost optimization, never a correctness dependency.
- **CODEX**: continuation = `thread/resume`, fork = `thread/fork`, listing = `thread/list`, via
  the app-server protocol (stable schema subset). MARKED DEPENDENCY: the app-server command is
  documented "experimental and aren't supported for production workloads", with a stable/
  experimental two-tier schema and no wire protocol version (per-build schema generation).
  Architecture rule: GovAI pins the Codex CLI build per deployment, regenerates the schema per
  pinned build, and uses ONLY the stable surface without `experimentalApi` opt-in. Codex keeps
  its own rollout JSONL/SQLite state under `$CODEX_HOME`; GovAI's conversation rows REFERENCE
  thread ids and mirror displayable items; GovAI does not re-implement Codex persistence.
- **CLAUDE_CODE**: continuation = Agent SDK session resume/fork by session id; persistence =
  client-side JSONL with a documented `SessionStore` interface (append/load/list/delete) that
  GovAI implements over the encrypted conversation store — the sanctioned hook for owning
  session durability. No TUI scraping; the Agent SDK is the only integration surface.

Cross-adapter rules:

- `provider_state` is opaque outside its adapter; nothing global assumes OpenAI state ≡
  Anthropic state (§17).
- **Continuation roots in CONTEXT-ELIGIBLE attempts only** (§7.5/§7.8): every strategy derives
  its next-dispatch continuation — the stateless replay projection, the chaining anchor, the
  rotation seed — from attempts that are completed, current AND not `context_excluded`, each
  filter evaluated per branch under §7.5 INCLUDING its fork-pin exemption (on a fork child the
  pinned attempt is a valid continuation root at the boundary even when superseded or
  `context_excluded` on the parent branch), so the
  provider continuation domain and the durable replay domain are causally rooted in the same
  boundary by construction (the mechanism behind BRANCH_CAUSAL_CONTEXT_MONOTONICITY's
  pre-advance restoration being safe).
- **The taint discipline is a PROPERTY OF SHARED PROVIDER-HELD STATE, not an OpenAI special
  case.** Every strategy that reuses provider-held mutable continuation state — the OpenAI
  conversation object above, a CODEX THREAD, a Claude Code SESSION — inherits the same rule: a
  post-boundary attempt that ends without provider terminal evidence taints that shared state,
  and the next turn must not blindly reuse it. Codex specifics: an expired runner can resume
  against the same persisted thread (rollout/SQLite) and reorder the context later turns
  consume; on a recovery-ratchet taint the adapter ROTATES via `thread/fork` from the last
  known-good boundary (fork is a first-class thread primitive) or a fresh thread seeded from
  GovAI's durable items — and, because the app-server is a GovAI-OWNED LOCAL runtime (unlike a
  remote HTTP provider), the supervisor additionally holds a real receiver-side fence: it
  terminates the expired runner's app-server process/connection before releasing the queue,
  making the Codex zombie killable rather than merely isolated. Claude Code mirrors Codex: fork
  or fresh session via the SessionStore, plus process-level termination of the expired SDK
  runner. Stateless-replay strategies (Anthropic Messages; OpenAI chaining) remain structurally
  insulated as stated above.

## 12. Preserve raw/native semantics

Stored items are provider-native, not normalized-lossy. Per item: `item_type` (provider
vocabulary: e.g. Anthropic content-block types incl. `thinking`/`redacted_thinking` with
signatures; OpenAI output items incl. `reasoning` `encrypted_content`, tool calls, `phase`),
provider ids (`response_id`, `message_id`, item ids), tool call/result payloads, citations/
annotations, file/image refs, refusal + stop metadata (`stop_reason`/`stop_details`,
`incomplete_details`), usage, and any officially-required continuation fields — encrypted (§6).
The UI renders normalized projections; the stored truth stays native. Unknown/future item types
are stored verbatim-encrypted (forward-compatible by construction, ADR-021 posture).

## 13. Conversation control-plane API (design only)

`POST /v1/ai/conversations` · `GET /v1/ai/conversations` (keyset-paged, page ≤ 50) ·
`GET /v1/ai/conversations/:id` · `PATCH /v1/ai/conversations/:id` (guarded fields: title,
archived) · `DELETE /v1/ai/conversations/:id` (lifecycle per §19) ·
`GET /v1/ai/conversations/:id/turns` (items hydrated per attempt) ·
`POST /v1/ai/conversations/:id/branches` (fork; names its `forked_from_turn_id` AND
`forked_from_attempt_id` plus the §3 boundary mode (`after_attempt` default,
`before_attempt_output` for earlier-turn regeneration), and accepts the target
`provider/surface/model` triple — omitted
means inherit the parent branch's; supplied is what makes a §17 cross-provider or model-switch
fork durable and reload-replayable) ·
`POST /v1/ai/conversations/:id/turns` (durable send, §8) + `GET .../turns/:turnId` (hydrate) +
stream re-attach endpoint ·
`POST /v1/ai/conversations/:id/turns/:turnId/retry` — the explicit operation that invokes §7.6
retry/regenerate: mints attempt N+1 and re-enters the queue; idempotent via a client-supplied
`client_attempt_id` unique per `(org_id, turn_id)` (the §8 reservation pattern at attempt
granularity — a duplicate retry replays the existing attempt, it never mints a second one);
rejected with a fork pointer when the turn is not the last on its branch ·
`POST /v1/ai/conversations/:id/turns/:turnId/attempts/:attemptId/stop` — the explicit Stop
command the server-owned stream makes NECESSARY (§9/§10: browser disconnect is delivery-only,
so aborting the SSE re-attach is NOT Stop), and it is **ATTEMPT-scoped
(STOP_ATTEMPT_TARGET_STABILITY)**: a control command that changes execution state must be bound
to the execution instance it intends to control. A turn-scoped Stop would resolve "the current
attempt" at arrival time, so a delayed or HTTP-retried Stop meant for attempt N could abort the
regenerated attempt N+1 — violating idempotency, attempt immutability and user intent. The
contract: Stop names its `attemptId` (full §3 lineage authorization — org, owner, conversation,
branch, turn, attempt; NO_SECURITY_OR_CAUSAL_POINTER_BY_ID_ALONE); it carries a
`client_stop_id` unique within the target attempt (the §8 reservation pattern at stop
granularity); a stale Stop NEVER retargets to a newer `current_attempt_id`. Semantics: target
attempt active → durable stop-request flag + active wake of THAT attempt's current claimant
(the abort/wake registry is keyed by attempt/claim, never by the mutable turn; clients hold
stable attempt identity, the server resolves the current claimant internally); target attempt
already terminal → replay its terminal state, mutate nothing — especially not a later attempt;
repeated Stop → replay the same outcome. Stopping a QUEUED turn stops its accepted attempt
(the §7 `accepted → stopped` discard edge). Authenticated and DURABLE: the flag lives on
the attempt's claim row AND actively wakes the owner — in-process via a claim-keyed abort registry
(the endpoint triggers the owning runner's `AbortController` directly), cross-process via a
notification channel (Postgres LISTEN/NOTIFY is the in-house primitive). Delivery is
GUARANTEED-bounded independent of notification delivery, because the §7.7 heartbeat timer reads
the flag on every tick — a stalled provider stream produces no pump iterations, so
"check between events" alone would let Stop pend indefinitely while the heartbeat kept the
lease alive; the timer check closes exactly that hole. On observing Stop, the runner aborts its
provider request and finalizes `stopped` under the normal fenced finalize — with
terminal-outranks-abort intact (a terminal frame already observed wins, exactly the U1.5 rule).
Stop of a QUEUED turn takes the §7 `accepted → stopped` discard edge and releases the queue.

- NO generic provider request schema is invented: the turn-send body embeds the provider-native
  request fragment; execution continues through provider-specific adapters over the existing
  native pipeline (§9).
- Native routes stay linkable: `X-GovAI-Conversation-Id` / `X-GovAI-Turn-Id` metadata headers may
  attribute a DIRECT native call to a conversation. Both MUST join the auth-strip set at the
  server→provider boundary (the `STRIP` list in `register-passthrough.ts:83-84` is the exact
  precedent) — provider never sees GovAI metadata.
- Auth: same `x-govai-api-key` identity; owner-scoped RLS; `cache-control: no-store` on every
  conversation read (the `/v1/me` rule, `me.ts:48-62`) — conversations join the
  AUTH-READ-CACHE-01 class and must not extend it.

## 14. Exact turn ↔ evidence correlation (target architecture)

Closes `EP-AI-CONSOLE-TURN-EVIDENCE-CORRELATION` WITHOUT event-schema change:

1. The runner OWNS attempt identity — it never inherits it from an inbound request, because no
   inbound scope exists to inherit: the ingress identity hook installs the ALS store only for
   the four direct-route prefixes (`request-identity-hook.ts:21-31`), the `/v1/ai/*`
   control-plane routes are outside that set, a sweep- or wake-driven worker has no inbound
   request at all, and the AuditBridge DROPS captures when the store is empty
   (`audit-bridge.ts:129`). Rule: at claim time the runner MINTS `govai_request_id`
   (`randomUUID()`), PERSISTS it on the attempt row FIRST, and then explicitly enters the
   identity scope (`requestIdentityAls.run()` with a constructed `AuditBridgeRequestIdentity`)
   around its provider-pipeline call — for browser-attached sends and detached worker dispatch
   alike. This also means no header echo is needed, which is why
   `DIRECT_STREAM_REQUEST_ID_HEADER_GAP` (`current-state.md:591`) does not block this design
   (it remains a separate, unresolved gap for external stream callers).
2. `capture_id` is DERIVABLE: `uuidv5(pinned-namespace, scoped-name)` over
   org/provider/capability/method/endpoint + `request:{govaiRequestId}`
   (`audit-bridge.ts:26,71-79`) — recomputable from persisted fields.
3. The attempt row persists `{govai_request_id, capture_id}`;
   `govai.audit_event_capture_refs` (`0025:162-167`) then yields `audit_event_id` after sealing.
   `ai_conversation_evidence_links` materializes the triple additively.
4. Honesty rules: capture is `best_effort` — a link asserts "this identity was assigned", never
   "evidence exists" until the capture/seal row is observed; the Interaction Receipt vocabulary
   (`InteractionReceipt.tsx:10-44`) carries over. `conversation_id`/`turn_id` never enter OTel
   labels (cardinality allow-list rule, `evidence-metrics.ts:41-45`) and never enter the capture
   payload (§5.2).

## 15. Conversation history UX contract (normative, eventual)

Sidebar with New Chat, recent conversations (title, provider badge, mode badge, last activity);
open/resume; rename; archive; delete-with-truth (§19); search (§18); branch/fork; move-to-Project
(post-§16); pin/favorite (justified by both reference products — ChatGPT and Claude ship it);
responsive loading; empty/loading/error states; keyboard accessibility. Deep link
`/ai/c/:conversation_id` (extends today's `routes.tsx` table; no conversation route exists yet).
No provider credentials in URLs; no secrets in browser storage (§6). Every affordance keeps the
honesty doctrine: no "evidence captured" claims the backend cannot prove.

## 16. Projects future compatibility

`ai_conversations.project_id uuid NULL` from day one; NO Projects implementation in V1; a Project
(chats + files + instructions + memory policy + collaborators) is a later container ABOVE
conversations. `project_id` is never mandatory, and a Workroom is NOT a Project substitute (§4).

## 17. Cross-provider continuation

Adjudicated semantics:

- Same-provider continuation: native (adapter strategy §11).
- Model switch, same provider/family: allowed where the provider defines it (Anthropic: strip
  thinking blocks on switch; OpenAI: chaining semantics unchanged); adapter enforces the rules.
- Endpoint-family switch (e.g. Chat Completions → Responses): a FORK with stateless replay.
- **Cross-provider continuation is ALWAYS a FORK to a new branch** that replays a GovAI-owned
  PORTABLE context projection (normalized text + attachments + declared tool outcomes).
  Documented quality loss (never silent): reasoning/thinking state is non-portable (signatures
  are provider-bound; `encrypted_content` is opaque), provider tool-state (containers, vector
  stores, hosted-tool context) does not transfer, citations degrade to text, prompt caches reset.
  The UI labels the fork "continued with <provider> — provider-native state does not transfer".

## 18. Titles and search

- Title creation: default = first-user-message derivation, truncated client-side; optional
  background provider-generated title is an explicit tenant policy (costs a paid call and sends
  content to the provider — privacy consequence stated); manual rename always wins
  (guarded-update column).
- Search V1: title search over the CALLER'S OWN conversations only, and EXHAUSTIVE by explicit
  design, not silently window-bounded: the server decrypt-scans the owner's titles in keyset
  order with a bounded per-request budget and returns matches plus a continuation cursor; the
  client (or the server loop) continues until the cursor is exhausted, so a match beyond the
  first window is found, not silently unreachable. This is tractable because the scan domain is
  one owner's title set (small at pilot scale), never the org's — the prohibition stands against
  ORG-WIDE decrypt-everything, which owner-scoped exhaustive scan does not violate. The scale
  path — a privacy-preserving derived title index (DLP-scrubbed or keyed-token) — is a named
  follow-up, required before search is offered over large multi-thousand-conversation tenants.
  Full-content search over encrypted items requires the same class of dedicated indexing design
  — recorded honestly as NOT part of V1.

## 19. Delete / archive / retention (truth table)

| Operation | Operational store | Evidence plane | UI truth |
|---|---|---|---|
| Archive | `archived_at` set; hidden from default list | untouched | "archived, recoverable" |
| User delete | status → `deleted_pending` (a real FENCING phase, protocol below) → rows purged; content blobs crypto-shred eligible | hash-only v4 captures REMAIN | "conversation content deleted; hash-only invocation evidence is retained by audit policy" |
| Tenant retention expiry | scheduled purge per retention class | untouched | policy text |
| Legal hold | blocks purge/shred for the hold scope | untouched | hold surfaced |
| Crypto-shred | `ai_conversation_content` DEK nulled via a SECURITY DEFINER shred function copied from the `audit_event_payload_crypto_shred` precedent (`0001:399-426` — RBAC session flag + chained admin event) | shred is itself evidenced | "content cryptographically destroyed" |
| Provider-side state | adapter deletes provider-stored objects where they exist (OpenAI conversation/response deletion, GA; Codex `thread/delete`; Claude Code session delete via SessionStore) — best-effort with recorded outcome | n/a | provider-deletion outcome shown, never assumed |

**`deleted_pending` is an ordered fencing protocol, not a label** — deletion must not race
active turns, and provider cleanup must not lose its tracking data:

1. BOTH `active` and `archived` transition atomically to `deleted_pending` — deleting an
   archived conversation enters the SAME fencing protocol, never a bypass and never a forced
   restore-first detour. The transition acquires the SAME conversation-root row lock §8's
   reservation serialization uses, so it strictly orders against every in-flight
   send/retry/fork: whatever committed before it is enumerated and fenced; whatever waited
   behind it rechecks and rejects (CONVERSATION_LIFECYCLE_RESERVATION_SERIALIZATION). The
   transition closes the conversation to new work:
   the control plane rejects sends/retries/forks/re-attaches, and the claim CAS predicates
   (§7.7/§8) exclude `deleted_pending` conversations, so no new claim and no queue pickup can
   start after the commit.
2. Every non-terminal attempt is stop-requested via the durable §13 Stop machinery (flag +
   active wake); owning runners observe within a heartbeat interval and finalize under the
   fenced finalize; a dead owner's turn resolves through the ordinary lease-lapse recovery.
   Purge WAITS until every turn on the conversation is terminal.
3. Provider-side cleanup then runs as a DURABLE scheduled step with recorded outcomes and
   retries — honoring §11's terminal-evidence rule: an aborted request's provider-side mutation
   may still land late, so cleanup of provider-stored objects is re-runnable, not
   fire-and-forget.
4. Row purge is LAST, and only after provider cleanup has COMPLETED — or, for any obligation
   still pending, been handed off to the ONE admissible target: the lifecycle-independent
   disposal ledger (§3). No other handoff target exists BY CONSTRUCTION: any other queue row is
   composite-bound to its conversation (LAW 1), so it would either hold an FK that blocks this
   purge or be cascade-destroyed WITH the provider identifier it still needs — leaving
   provider-held content undeleted while the UI reports deletion. The handoff TRANSCRIBES the
   pending job (envelope-encrypted provider identifier, plain-value `conversation_id`, retry
   state) into the ledger IN THE SAME TRANSACTION as the row purge, so there is no window in
   which the conversation rows are gone but the obligation is unrecorded — purging must never
   orphan the very data the cleanup requires. Content blobs become crypto-shred eligible at
   this point. Purge does NOT delete pending disposal-ledger rows (the ledger is
   lifecycle-independent, §3) and does NOT wait on stale claimants — an unbounded zombie can
   never gate purge, because its late identifier lands in the post-purge-writable ledger and
   is cleaned from there; ledger rows are removed only by cleanup completion.

A UI "Delete conversation" never promises evidence erasure the audit plane legitimately prevents;
it states exactly what is deleted and what hash-only evidence remains. LGPD erasure of CONTENT is
satisfied by crypto-shred; the evidence plane holds no content (§2), so no conflict is created.

## 20. Current auth limitation (R14)

R14 (production human auth) is OPEN (`foundation-v1-freeze.md:182`; `me.ts:13-16`). Implementable
NOW under the controlled-pilot API-key identity: persistence keyed to the stable
`(org_id, user_id)` the key lookup already returns — durable history, reload survival, resume,
rename, archive, branch, and cross-BROWSER access for the same key. Requires R14: real
multi-user/multi-device experience, sharing, per-human ownership distinct from key identity,
cookie/session semantics (which also re-triggers `PROVIDER-INBOUND-HOP-HEADER-RESIDUAL-01`'s
cookie-relay analysis before any cookie-based auth ships). The design does not pretend API-key
entry is human login.

## 21. Threat model → required controls and gates

| Threat | Control (implementation gate) |
|---|---|
| Cross-tenant history leakage | RLS ENABLE+FORCE on every `ai_*` table; negative-privilege integration proof (the I2 pattern) BEFORE first release |
| Same-org cross-USER leakage | owner_user_id in every `ai_*` RLS policy via paired session context (`app.org_id` + `app.user_id`, §3) — policy-enforced, never query-discipline; per-user negative proof added to the I2-style suite |
| IDOR / conversation enumeration | UUID ids + policy-level owner scoping (§3); 404-not-403 on foreign ids; no sequential ids |
| Cache leakage | `cache-control: no-store` on all conversation reads from day one (AUTH-READ-CACHE-01 must not grow) |
| Provider credential leakage | unchanged pipeline (§9); credentials never in conversation rows/URLs |
| Browser storage | nothing conversational client-persisted; acceptance-pinned |
| Payload/title encryption | §6; no plaintext columns exist to misuse |
| Tool-result sensitive data | tool results are items ⇒ encrypted like all content |
| Attachment access | attachment reads owner-scoped + streamed with auth; no public URLs |
| Deleted-conversation reappearance | purge covers items+blobs+provider_state+links; provider-side deletion recorded; restore only from explicit archive |
| Provider-state identifiers | provider ids treated as sensitive (they unlock provider-stored content); encrypted at rest in `provider_state` |
| Replay/fork authorization | fork requires read right on source branch; cross-provider fork re-runs DLP on the portable projection |
| Concurrent sends | §8 reservation PK (duplicate) + per-branch single-flight boundary predicate (distinct turns) + §7.7 fencing CAS (competing claimants) |
| Late recovery vs branch causality | BRANCH_CAUSAL_CONTEXT_MONOTONICITY (§7.8): atomic advance-check on probe upgrade; post-advance recovery is transcript-only + `context_excluded`; continuation via explicit fork — acceptance proof required at implementation |
| Delete racing reservation | CONVERSATION_LIFECYCLE_RESERVATION_SERIALIZATION (§8/§19): root-row lock + status revalidation in one transaction on every descendant-creating operation and on the `deleted_pending` transition — the check-then-write race is an acceptance-proof item at implementation |
| Owner impersonation via discovery | WORKER_IDENTITY_SEPARATION / OWNER_DISCOVERY_NON_IMPERSONATION (§9): discovery EXECUTE confined to the dedicated NOINHERIT worker identity with its own credential/pool lifecycle; `govai_app` holds no discovery access and cannot SET ROLE to the worker — negative-privilege proof required at implementation |
| Cross-turn attempt corruption | CURRENT_ATTEMPT_LINEAGE_BINDING (§3): composite-FK-bound reverse pointer — a turn cannot select another turn's attempt |
| Stream hijacking | re-attach requires the same auth as the turn; relay carries no provider credentials; no cross-user attach |
| Future shared Projects | out of V1; sharing model gated on R14 |
| Workroom promotion | one-way copy/reference with its own audit event; never silent |

## 22. Forbidden couplings (inherited laws)

(1) No conversation data in the capture projection or outbox; (2) no AuditBridge envelope for
must-succeed writes; (3) no reuse of either existing idempotency header; (4) no `run`-chain
events; (5) no mutation of sealed rows ever — post-hoc linkage only via the shred/anchoring
precedent (narrow SECURITY DEFINER + monotonic transition + chained event); (6) no evidence
canonicalization reuse for intent hashes; (7) no high-cardinality ids in metrics labels; (8) no
sealer/enumerator grants on conversation tables (INV-1 discipline — a new reader identity needs
its own lifecycle section at entry; the ONLY sanctioned RLS bypasses are §9's TWO content-free
SECURITY DEFINER claim-plane discovery functions — turn-recovery and cleanup candidates —
EXECUTE-able solely by the dedicated `govai_conversation_worker` identity, never by
`govai_app`, per WORKER_IDENTITY_SEPARATION);
(9) no `packages/signing` dependency (DevSigner only); (10)
no claim above `hmac_internal` evidence strength.

## 23. Implementation gating

Everything above lands via the follow-up mission **EP-AI-CONVERSATION-CONTINUITY-V1-01**
(scope adjudicated in `native-experience-parity-v1.md` §10; deliberately NOT frozen here). This
spec's acceptance for THAT mission includes: reload acceptance in a real browser, second-browser
same-key acceptance, RLS negative proof, terminal-outranks-abort proof, duplicate-send proof
under StrictMode, and correlation-triple proof against a live capture row.

## 24. REFERENCE ARCHITECTURE — SYSTEM LAWS

The eighteen laws below are the normative index of this specification. Each law BINDS the
sections it cites; any sentence elsewhere in this document that contradicts a law is a defect
in that sentence, not a second doctrine. Laws 1–15, 17, 18 consolidate invariants already
normative above; LAW 16 is introduced here.

- **LAW 1 — IDENTITY AND OWNERSHIP** (one documented exception: the disposal ledger's lifecycle independence, §3)**.** Canonical ownership is `(org_id, owner_user_id)`;
  dual-predicate FORCE RLS everywhere; NO_SECURITY_OR_CAUSAL_POINTER_BY_ID_ALONE — every
  authorization/context/causality/execution/cleanup pointer is composite-lineage-bound
  (branch→conversation, turn→branch, attempt→turn, `current_attempt_id`→same-turn ancestry
  via CURRENT_ATTEMPT_LINEAGE_BINDING, fork→exact immutable source ancestry, provider
  state→owning branch, cleanup→owning conversation). (§3)
- **LAW 2 — TURN OWNS INPUT; ATTEMPT OWNS OUTPUT.** User/input items are turn-owned and
  immutable from the reservation commit; assistant/tool output is attempt-owned; retries mint
  NEW attempts and never mutate a completed one; only the current, non-excluded attempt
  contributes output (both filters branch-scoped — a fork child includes its pinned attempt at
  the boundary, §7.5 fork-pin exemption). (§3, §7.5, §7.6)
- **LAW 3 — BRANCH CAUSALITY IS MONOTONIC.** BRANCH_CAUSAL_CONTEXT_MONOTONICITY: after the
  branch advanced past an ambiguous ancestor, late recovery is transcript-only
  (`context_excluded`); continuation with the recovered result is an explicit fork;
  pre-advance restoration requires both context domains reconciled to the same boundary, and
  the advance check itself is SERIALIZED on the branch execution authority
  (RECOVERY_ADVANCE_SERIALIZATION), and request payloads carry the branch `causal_version`
  into the boundary CAS so a stale context build can never dispatch. (§7.8, §8, LAW 16)
- **LAW 4 — RETRY IS CAUSAL REPLACEMENT.** RETRY_REGENERATE_CONTEXT_BOUNDARY: attempt N+1 =
  context-before-N-output + same immutable user input; the boundary is identical in the durable
  projection AND provider continuation (chaining rewinds to the parent anchor or stateless
  replay; shared objects rotate; Anthropic rebuilds statelessly; coding harnesses use their own
  fork/session semantics). (§7.6, §11)
- **LAW 5 — SERVER OWNS EXECUTION AFTER DURABLE ACCEPTANCE.** Browser disconnect is
  delivery-only; reload hydrates durable truth; Stop is a durable authenticated control-plane
  operation, never an SSE abort. (§9, §10, §13)
- **LAW 6 — SINGLE-FLIGHT PROVIDER EXECUTION PER BRANCH.** Reservations are concurrent;
  execution is ordered by `turn_seq`; terminalization actively wakes/claims the next head —
  never deadline-waited when normal progression is possible. (§8)
- **LAW 7 — CLAIM = LEASE + FENCING.** Every post-claim durable mutation proves current
  authority: boundary CAS, timer-driven heartbeat across `dispatching` AND `streaming`,
  fenced incremental writes, fenced finalize; an expired claimant never regains authority by
  resuming; execution-control commands bind to the execution INSTANCE they target
  (STOP_ATTEMPT_TARGET_STABILITY, §13). (§7.7, §13)
- **LAW 8 — OUTCOME_UNKNOWN IS HONEST.** Post-side-effect ambiguity is never auto-retried;
  `outcome_unknown` is real, queue-terminal, not context-eligible; probes may resolve it under
  LAW 3; no exactly-once claim, ever. (§7, §8)
- **LAW 9 — SHARED PROVIDER STATE REQUIRES RECEIVER-SIDE SAFETY.** Taint on any post-boundary
  non-completed attempt; cleared only by provider terminal evidence, else rotate/abandon;
  local harnesses (app-server, Agent SDK) additionally get real process/connection
  termination as a receiver-side fence — strategies stay provider-specific. (§11)
- **LAW 10 — LIFECYCLE SERIALIZES WITH CHILD CREATION.**
  CONVERSATION_LIFECYCLE_RESERVATION_SERIALIZATION: send/retry/fork and
  `active|archived → deleted_pending` serialize on the conversation-root authority; both lock
  orderings are safe by construction; queued claims require an execution-eligible root. (§8, §19)
- **LAW 11 — REQUEST IDENTITY ≠ WORKER IDENTITY.** WORKER_IDENTITY_SEPARATION,
  OWNER_DISCOVERY_NON_IMPERSONATION, and WORKER_LEAST_PRIVILEGE_UNDER_FORCE_RLS: discovery is
  worker-only; the request role can neither enumerate owners nor assume the worker; the worker
  carries minimum table privileges under FORCE RLS with transaction-local owner context. (§9)
- **LAW 12 — OPERATIONAL STORE ≠ FORENSIC STORE.** Purpose-aware envelope encryption + KEYED
  operational digests; evidence-plane hashes separate; the audit payload table is never the
  conversation database. (§5, §6)
- **LAW 13 — DELETE IS A PROTOCOL.** The §19 ordered fencing pipeline, with durable provider
  cleanup whose identifiers are never purged before cleanup completes or is durably handed
  off; the disposal ledger stays writable AFTER purge (the LAW 1 exception) so stale claimants
  can neither gate purge nor strand provider objects; evidence-plane retention reported
  honestly. (§19, §3)
- **LAW 14 — CONVERSATION ≠ WORKROOM ≠ PROJECT.** No workroom-as-chat-storage, no
  workroom-per-conversation, `project_id` optional and future-compatible. (§4, §16)
- **LAW 15 — COMMON CONTROL PLANE, PROVIDER-NATIVE DATA PLANE.** GovAI standardizes identity,
  metadata, lifecycle, governance, receipts, evidence linkage; content/continuation stays
  provider-native — never `role+text` as the central persistence or continuation abstraction.
  (§1, §12; ADR-021)
- **LAW 16 — LOCK ORDER MUST BE EXPLICIT (introduced here, normative).** Canonical acquisition
  order: **(1) conversation root lifecycle authority (§8/§10 row lock) → (2) branch execution
  authority (per-branch `turn_seq` advisory lock / single-flight predicate) → (3) turn/attempt
  row mutation (claim CAS, fenced writes)**. No flow acquires a higher level after holding a
  lower one. **Any decision that establishes or reads the branch's CAUSAL BOUNDARY — a
  dispatch-boundary commit, or a late-recovery eligibility decision (§7.8's
  RECOVERY_ADVANCE_SERIALIZATION) — must HOLD (2), the branch execution authority; the
  advance-absence predicate and the boundary crossing may never race.** Sweep:
  SEND/RETRY/FORK take (1)→(2)→(3); DELETE takes (1), then per-turn (3) via the Stop flags
  (no branch authority needed — it stops, never dispatches); STOP touches only (3);
  QUEUE WAKE's claim CAS is (3)-only (claiming changes no
  context eligibility), and its dispatch-boundary commit takes (2)→(3) — EVERY
  dispatch-boundary commit holds the branch execution authority, wake-driven or not; LATE RECOVERY that may
  change context eligibility takes (2)→(3); lease-lapse ratchets that CANNOT change
  eligibility (to `outcome_unknown`) remain (3)-only; CLEANUP/purge re-enters at (1) then (3)
  in a fresh transaction. A future flow that cannot fit this order must document its safe
  reason explicitly.
- **LAW 17 — PROVIDER CONTINUATION COMMIT MATCHES DURABLE CAUSAL COMMIT.** No operation may
  leave the two domains claiming different ancestry; where atomic remote mutation is
  impossible, enough local state is persisted to recover/rebuild honestly; no local
  transaction implies provider exactly-once. (§7.6, §7.8, §11)
- **LAW 18 — HONESTY / NON-OVERCLAIM.** Never claim exactly-once, universal parity, production
  human auth, evidence-by-id-assignment, unproven provider deletion, or native status for
  product-only capability; `CONVERSATION_PERSISTENCE=NOT_IMPLEMENTED` until runtime lands.
  (§14, §18-§20; parity baseline §11)

## 25. ARCHITECTURE CONSISTENCY MATRIX

One row per critical operation; cells cite the governing law/section. OWN = ownership check
(LAW 1 RLS + composite lineage, always); ROOT = root lifecycle check; LOCKS in LAW 16 order;
FENCE = claim/fence discipline (LAW 7); CTX = context boundary; PSTATE = provider-state effect
(LAW 9/17); RLSID = executing DB identity; REC = recovery path; TERM = terminality; EVID =
evidence link (§14); TRUTH = user-visible truth.

| Operation | ROOT | LOCKS | FENCE | CTX | PSTATE | RLSID | REC | TERM | EVID | TRUTH |
|---|---|---|---|---|---|---|---|---|---|---|
| SEND | §8 root lock + status revalidate | (1)→(2)→(3) | reservation PK; claim at head | §7.5 projection | adapter builds anchor at boundary | request (`govai_app`) | §7.7 stranded/lapse | §7 machine | §14 triple | queued/live/terminal state |
| RETRY (last turn) | same as SEND | (1)→(2)→(3) | new attempt, handoff CAS | LAW 4 before-N-output, both domains | rewind anchor / rotate object | request | same | same | new attempt triple | replaced answer; prior attempt visible |
| EARLIER-TURN REGENERATE | same | (1)→(2)→(3) | fork + new child turn/attempt | `before_attempt_output` mode | child branch state fresh/rotated | request | same | same | child triples | new branch, old intact |
| FORK / CROSS-PROVIDER FORK | §8 root lock | (1)→(2) | pinned completed attempt | §3 boundary modes; §17 portable projection | branch-owned provider triple; fresh state | request | n/a (no dispatch yet) | n/a | inherits at dispatch | labeled quality loss (§17) |
| STOP | none (attempt-scoped, lineage-authorized) | (3) only | attempt-keyed flag + active wake + heartbeat-tick read; `client_stop_id` idempotency; never retargets (STOP_ATTEMPT_TARGET_STABILITY) | terminal-outranks-abort | §11 taint if post-boundary non-completed | request | flag survives crashes | `stopped` (target attempt only) | attempt triple | honest stop state |
| RELOAD / RE-ATTACH | none | none (reads) | n/a | hydrate durable prefix/terminal | none | request | §10 | n/a | n/a | partial marked partial |
| DUPLICATE SEND | none | (3) read | replay, never verdict | current state | none | request | drives stranded head | n/a | existing | queued/live/terminal replay |
| CRASH PRE-BOUNDARY | n/a | (3) reclaim | token rotation | none emitted | none | worker | §7.7 re-drive (provably undispatched) | continues | n/a | seamless |
| CRASH POST-BOUNDARY | n/a | (3) | fenced finalize loses; ledger append allowed | not eligible | §11 taint/rotation | worker | probe or ratchet | `outcome_unknown` | orphan ledger | honest ambiguity |
| STREAM CRASH | n/a | (3) | fenced item writes stop; lease lapses | prefix marked partial | taint per §11 | worker | §7.7 ratchet | `outcome_unknown` | partial prefix | partial, labeled |
| LATE RECOVERY | n/a | (2)→(3) — RECOVERY_ADVANCE_SERIALIZATION | probe upgrade CAS under branch authority | LAW 3 advance check, serialized | anchors root in eligible attempts only | worker | §7.8 | completed(+excluded) or failed | upgraded triple | transcript vs context stated |
| QUEUE WAKE | root still eligible (LAW 10) | claim CAS at (3); boundary commit (2)→(3) (LAW 16 — reading the (2) predicate without holding it would not serialize against a concurrent eligibility update) | claim CAS on unclaimed head (the CLAIM commit); boundary validates the held token | §7.5 at dispatch | adapter at boundary | worker or terminalizing runner | sweep fallback | continues | n/a | pending→live |
| DELETE | §19.1 root lock, both origins | (1) then per-turn (3) | stop-flags; claim predicates exclude | frozen | §19 cleanup scheduled | request → worker completes | §19 wait-terminal via recovery | `deleted_pending`→purge | hash-only captures remain | truth contract §19 |
| PROVIDER CLEANUP | deleted or superseded state | (1)→(3) fresh txn | durable job outcomes/retries | n/a | provider deletion recorded, never assumed | worker | re-runnable | job terminal | outcome recorded | provider-deletion outcome shown |
| ORPHAN CLEANUP | n/a | (3) ledger rows (lifecycle-independent, post-purge writable) | opaque job id; owner context first | n/a | orphan object deleted | worker | keyset re-discovery | job terminal | ledger row | n/a (background) |

## 26. ADVERSARIAL COUNTEREXAMPLE SWEEP (executed pre-review; one deterministic outcome each)

A concurrent-sends → LAW 6/10: both reserve, one dispatches, wake chains — PASS. B duplicate
id during streaming → §8 live replay + re-attach, no verdict — PASS. C crash pre-dispatch →
§7.7 provably-undispatched re-drive — PASS. D pause boundary→POST → lease revalidation +
grace window; fenced boundary already won, zombie fenced at finalize — PASS. E pause
POST→first-byte → timer heartbeat covers `dispatching` — PASS. F stream pause + lease loss →
fenced item writes abort the resumed pump — PASS. G unknown→advance→recovered → LAW 3
transcript-only + fork — PASS. H retry w/ chaining → parent-anchor rewind — PASS. I retry w/
conversation object → mandatory rotation — PASS. J earlier-turn retry → regeneration fork,
child turn copies user items — PASS. K fork source later retried → fork pins the attempt, not
the mutable turn — PASS. L Stop on stalled stream → active wake + heartbeat-tick flag read —
PASS. M/N/O delete vs send/retry/fork → LAW 10 lock orderings, both safe — PASS. P worker
crash post-discovery → nothing mutated; keyset re-discovery — PASS. Q pooled connection reuse
→ transaction-local GUCs + checkout reset — PASS. R `govai_app` tries discovery → no EXECUTE,
permission denied — PASS. S cleanup provider id → opaque job id, owner-RLS read — PASS. T
tainted shared object → provider-terminal-evidence-or-rotate — PASS. U old Codex runner vs
newer owner → process/connection termination + thread fork — PASS. V old Agent-SDK session
runner → same receiver-side fence — PASS. W provider success + lost fence → finalize
discarded; orphan-disposal record preserves the id — PASS. X orphan after advance → never
referenced; ledger cleanup — PASS. AC zombie resumes AFTER conversation purge with a stored
response id → the lifecycle-independent ledger accepts the append; cleanup consumes it;
nothing survives deletion and purge never waited on the zombie — PASS. Y legal hold during delete → §19 hold row blocks
purge/shred; fencing proceeds, purge waits — PASS. Z archived→deleted → §19.1 admits both
origins — PASS. AA concurrent probe upgrade vs
N+1 dispatch boundary → RECOVERY_ADVANCE_SERIALIZATION: both hold the branch execution
authority; probe-wins and dispatch-wins are the only orderings, no third outcome; a probe
that wins BETWEEN N+1's context build and boundary commit bumps `causal_version`, so the
stale build loses the boundary CAS pre-POST and rebuilds — PASS. AB
Stop(N) delayed until Retry minted N+1 → STOP_ATTEMPT_TARGET_STABILITY: the attempt-scoped
command replays N's terminal state and never touches N+1 — PASS. No scenario yields two
plausible outcomes, missing authority, an unbounded
stranded state, cross-owner reach, retroactive causal rewrite, or domain divergence.

END OF SPEC.
