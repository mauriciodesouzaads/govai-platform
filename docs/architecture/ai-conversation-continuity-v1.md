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
| Branch | `govai.ai_conversation_branches` | A named line of turns. Every conversation has one root branch; fork creates a new branch with `parent_branch_id` + `forked_from_turn_id`. Cross-provider continuation is ALWAYS a new branch (§17) |
| Turn | `govai.ai_conversation_turns` | One user send on a branch: `(org_id, conversation_id, client_turn_id)` unique (§8), per-branch `turn_seq` (advisory-lock + `MAX+1` + UNIQUE backstop, the technique of `workroom-transcript.ts:127-136` — technique reuse, not table reuse), state (§7), `govai_request_id` per attempt (§14) |
| Attempt | `govai.ai_conversation_attempts` | Retries of one turn (the UI already models `Turn.attempts[]`, `conversation/types.ts:171-176`). Exactly one attempt may be `eligible_for_context` |
| Provider-native Item | `govai.ai_conversation_items` | Ordered typed items per attempt: provider-native content blocks, tool calls/results, citations, refusals, provider ids (§12). Content encrypted (§6) |
| Attachment | `govai.ai_conversation_attachments` | File references (GovAI-stored bytes or provider `file_id` refs). V1 design carries the entity; upload flows land in a later wave |
| Artifact | (deferred) | Product-equivalent work surfaces; the item model must be able to mark an item as artifact-source, nothing more in V1 |
| Provider State | `govai.ai_conversation_provider_state` | Per-branch continuation state owned by the adapter (§11): e.g. OpenAI `conversation_id`/`previous_response_id`, Codex thread id, Claude Code session id, encrypted where opaque |
| Evidence Link | `govai.ai_conversation_evidence_links` | Additive projection turn/attempt → `{govai_request_id, capture_id, audit_event_id?}` (§14). Never mutates audit tables |
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
unit: `(org_id, owner_user_id, conversation_id, parent_branch_id, forked_from_turn_id)
REFERENCES ai_conversation_turns (org_id, owner_user_id, conversation_id, branch_id, id)` — a
single composite FK that simultaneously forces the fork-point turn to belong to the SAME
conversation AND to the DECLARED parent branch (with a CHECK that `parent_branch_id` and
`forked_from_turn_id` are both null on a root branch and both set on a fork). A fork therefore
cannot name a parent in conversation A while taking its fork point from conversation B or from
a sibling branch — the adapter can never restore context from the wrong lineage. Two corruption shapes are therefore structurally unrepresentable, not
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
5. Only `completed` attempts are `eligible_for_context` (matches `types.ts:75-77`).
6. Transitions are total, and ratchets are PER-ATTEMPT: every state names its successors and its
   inverse-or-ratchet (`completed/stopped/failed/rejected` are ratchets; `outcome_unknown` may
   resolve once to `completed`/`failed` by a recovery probe, never the reverse). A terminal
   ATTEMPT is never mutated — but the TURN's displayed state is DERIVED from its latest attempt,
   and **retry/regenerate is a defined operation, not an illegal un-ratchet**: it mints attempt
   N+1 on the same turn (same `client_turn_id` reservation, fresh `govai_request_id`), returning
   the turn to `accepted`-unclaimed so it re-enters the §8 queue and the standard three-commit
   flow. Retry is permitted only while the turn is the LAST turn on its branch — retrying an
   earlier turn is a FORK from that turn (§3 branches), the same semantics reference products
   ship. At most one non-terminal attempt exists per turn (single-flight applies unchanged), and
   a prior attempt's taint consequences (§11) survive its successor.
7. **No stranded states, and claimants are FENCED.** `accepted` and `dispatching` each carry a
   claim — `{claim_token, claimant, deadline}` — and each crash window has a defined recovery
   (the 0029 dispatch-boundary + `dispatch_token` discipline, applied per turn):
   - The runner's SECOND commit — the dispatch-boundary commit (`accepted → dispatching`) — is
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
     `provider_state` keeps a single fenced writer. Where the branch uses PROVIDER-HELD shared
     continuation state (the OpenAI conversation-object strategy), the fence cannot reach the
     provider's copy — that exposure is closed by §11's taint/reconcile-or-rotate rule, which
     forbids blind reuse of the shared object after any `outcome_unknown`. Honest residual,
     stated not hidden: without receiver-side fencing (providers accept no fencing token), such
     a zombie can still SPEND provider tokens on a discarded response — the protocol guarantees
     durable-state integrity, context/provider-state ordering, and (via §11) shared-state
     hygiene, not zombie-spend prevention.
   - **The lease covers `streaming` too — a dead pump cannot strand a branch.** The owning
     runner RENEWS its claim lease periodically while pumping (heartbeat on the same claim row);
     persistence of stream items continues incrementally, so the durable prefix always reflects
     what was relayed. **Every incremental write is fenced, not just the finalize:** each
     heartbeat and each item-append transaction is conditional on
     `claim_token = <mine> AND state = 'streaming'` — zero rows touched means the pump has been
     fenced out (or the attempt ratcheted) and MUST abort its relay. Without this, a stalled
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

## 8. Durable send / idempotency

- The client generates `client_turn_id` (UUID) at Send. Uniqueness arbiter:
  **`PRIMARY KEY (org_id, conversation_id, client_turn_id)`** on the turn-reservation row —
  the `run_idempotency` composite-PK pattern (`0030:22-31`, `INSERT … ON CONFLICT DO NOTHING
  RETURNING`), immutable-by-privilege (SELECT+INSERT grants only).
- One UI Send = at most one provider POST, regardless of StrictMode double-invoke, double click,
  browser retry or reconnection: the duplicate reservation returns the existing turn (replay
  semantics, `x-govai-…-replay` header convention of `routes/runs.ts:126`). Replay is NOT
  abandonment: if the existing turn is a stranded pre-dispatch `accepted` (deadline elapsed, no
  dispatch-boundary commit — §7.7), the duplicate send re-claims it via the fencing CAS
  (rotating the claim token, which locks the stalled owner out at its boundary commit) and
  DRIVES it rather than merely echoing a turn that will never execute; if it is post-boundary
  without a terminal, the reply reports `outcome_unknown` honestly — never a second POST.
- **`outcome_unknown` is QUEUE-TERMINAL.** The branch-order predicate blocks only on
  `accepted | dispatching | streaming`; every other state — `completed`, `stopped`, `failed`,
  `rejected` AND `outcome_unknown` — releases the queue. Where no recovery probe exists
  (Anthropic has none, §8 above), an unknown outcome would otherwise block the branch forever.
  Context honesty follows §7.5 unchanged: an unknown attempt is not `eligible_for_context`, so
  later turns dispatch without it; if a probe later upgrades it to `completed`, that upgrade is
  visible in the transcript but does NOT retroactively join the context of turns that already
  dispatched — the same semantics as a user continuing past a failed attempt.
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
  boundary law (0029), as a three-commit protocol: reserve-commit (`accepted`) →
  dispatch-boundary commit (`dispatching`, claim + deadline, BEFORE any provider POST) →
  provider POST → finalize-commit (terminal state). Each inter-commit crash window has the
  defined recovery of §7.7.
- **Terminalization WAKES the queue — a queued turn never waits for luck.** A turn that loses
  the branch-order predicate is reserved durably and returned to its sender as queued, but no
  one would otherwise drive it: the design therefore defines the dequeue mechanism explicitly.
  (1) In-process: whichever runner commits ANY terminal transition on a branch (finalize,
  rejection, stop, or a recovery ratchet) immediately attempts a normal claim CAS on the
  branch's next `accepted` turn and, on success, drives it through the standard three-commit
  flow. (2) Cross-process / crash: the periodic recovery sweep claims any UNCLAIMED `accepted`
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
  dispatch-boundary CAS (§7.7) carries a second predicate — it succeeds only when no
  earlier-`turn_seq` turn on the branch is in a non-terminal state — so reservations form a
  durable per-branch queue that dispatches strictly in `turn_seq` order, each turn's context
  includes every earlier terminal outcome, and `provider_state` has one writer at a time. A
  queued turn is visible to the UI as pending; Stop/discard of a queued turn is an ordinary
  pre-dispatch transition (`accepted → stopped`), which unblocks the queue behind it.

## 9. Dispatch boundary and server-owned stream

The durable-turn runner is a server-side component (apps/api) that:

1. commits the reservation + user items (`accepted`, born UNCLAIMED — §8's claim lifecycle:
   a claim, and the deadline that belongs to it, is acquired only by a successful
   head-of-queue claim CAS, whether by this creating request when the turn is at head, by a
   terminal-transition wake, or by the sweep; deadlines attach to CLAIMS, never to
   reservations, so a queued turn is always claimable the moment it reaches head);
2. builds the provider request via the adapter (§11) from durable context — not from browser
   memory;
3. commits the dispatch boundary (`dispatching`) as the §7.7 fencing CAS on its claim token —
   losing the CAS means another claimant owns the turn: abort with no POST — minting and
   persisting the attempt's `govai_request_id` and then ENTERING the identity scope itself
   (§14.1: the runner constructs the `AuditBridgeRequestIdentity` and wraps the pipeline call
   in `requestIdentityAls.run()`, because neither `/v1/ai/*` requests nor detached
   sweep/wake-driven workers pass the ingress identity hook), and only THEN
   dispatches to the SAME provider-native pipeline the direct routes use (credential resolution,
   DLP, tool classifier, beta policy, capture — unchanged semantics; the governed/passthrough
   distinction is carried per conversation mode); boundary-before-POST plus the fenced CAS is
   what makes §7.7's stranded-turn recovery at-most-one-POST safe;
4. owns the SSE pump to terminal (the `provider-stream-http` primitives —
   `pumpStreamWithTerminalEmit` — are the template), persisting items incrementally and the
   terminal state durably;
5. relays the live stream to the browser as a spectator: the browser reads, the server owns.

This inverts today's browser-owned flow and is what makes §7's rules enforceable. The existing
six direct routes remain untouched for API-native callers; the conversation runner is an
ADDITIONAL caller of the same provider pipeline, not a fork of it (two-speed doctrine, ADR-029
posture, without adjudicating that Proposed ADR).

**Detached recovery discovery under FORCE RLS (the sweep is not structurally blind).** The
dual-predicate RLS of §3 makes every `ai_*` table invisible to a session without BOTH
`app.org_id` and `app.user_id` — which a detached sweep does not have, and §22 forbids handing
any broad reader identity conversation-table grants. The resolution is the repo's own 0029
precedent (`govai.run_dispatch_recovery_candidates`, SECURITY DEFINER, keyset cursor): a narrow
**claim-plane discovery function** — e.g. `govai.ai_turn_recovery_candidates(...)` — SECURITY
DEFINER, `REVOKE ALL FROM PUBLIC`, EXECUTE granted to `govai_app` only, returning ONLY claim
metadata (`org_id`, `owner_user_id`, `conversation_id`, `turn_id`, `state`, claim token/deadline,
branch-head flags) with a keyset cursor — never titles, never content refs, never provider
state. Having discovered a candidate, the sweep drives it by entering that owner's FULL context
(`set_config` of `app.org_id` AND `app.user_id` from the candidate row, the server acting for
the owner), after which every content read passes through ordinary RLS — the definer function is
the only RLS bypass, and it is content-free by construction. Role lifecycle per the INV-1
lesson: this is a FUNCTION-scoped privilege on the existing app identity, not a new DB role;
if a dedicated recovery identity is ever split out, it gets its own complete lifecycle section
at entry and still never receives table-level conversation grants.

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
  conversation object: the adapter first reconciles against provider truth (list the
  conversation's items; adopt-or-record any phantom append) or rotates — a fresh conversation
  object (or stateless replay) seeded from the durable items. Only a pre-boundary outcome or a
  provably-unprocessed failure (e.g. a 4xx rejected before processing) leaves the object clean.
  The taint clears only by reconcile-or-rotate, never by time.
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

Cross-adapter rule: `provider_state` is opaque outside its adapter; nothing global assumes
OpenAI state ≡ Anthropic state (§17).

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
`POST /v1/ai/conversations/:id/branches` (fork) ·
`POST /v1/ai/conversations/:id/turns` (durable send, §8) + `GET .../turns/:turnId` (hydrate) +
stream re-attach endpoint.

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
| User delete | status → `deleted_pending` → rows purged; content blobs crypto-shred eligible | hash-only v4 captures REMAIN | "conversation content deleted; hash-only invocation evidence is retained by audit policy" |
| Tenant retention expiry | scheduled purge per retention class | untouched | policy text |
| Legal hold | blocks purge/shred for the hold scope | untouched | hold surfaced |
| Crypto-shred | `ai_conversation_content` DEK nulled via a SECURITY DEFINER shred function copied from the `audit_event_payload_crypto_shred` precedent (`0001:399-426` — RBAC session flag + chained admin event) | shred is itself evidenced | "content cryptographically destroyed" |
| Provider-side state | adapter deletes provider-stored objects where they exist (OpenAI conversation/response deletion, GA; Codex `thread/delete`; Claude Code session delete via SessionStore) — best-effort with recorded outcome | n/a | provider-deletion outcome shown, never assumed |

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
its own lifecycle section at entry; the ONLY sanctioned RLS bypass is §9's content-free
SECURITY DEFINER claim-plane discovery function, which is function-scoped, not a role grant);
(9) no `packages/signing` dependency (DevSigner only); (10)
no claim above `hmac_internal` evidence strength.

## 23. Implementation gating

Everything above lands via the follow-up mission **EP-AI-CONVERSATION-CONTINUITY-V1-01**
(scope adjudicated in `native-experience-parity-v1.md` §10; deliberately NOT frozen here). This
spec's acceptance for THAT mission includes: reload acceptance in a real browser, second-browser
same-key acceptance, RLS negative proof, terminal-outranks-abort proof, duplicate-send proof
under StrictMode, and correlation-triple proof against a live capture row.

END OF SPEC.
