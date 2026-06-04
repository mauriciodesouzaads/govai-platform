# Workroom — GovAI Multi-Agent Governance Room

**Status:** target architecture — **partially implemented** (Phases 1–4 are live at runtime; see *Implementation status* below)
**Issue:** #33
**Authors:** PR3.2a CP1
**Audience:** GovAI architecture, platform engineering, governance reviewers
**Predecessors:**
- ADR-001 (Run as central unit) — runs remain the execution primitive
- ADR-003 (Provider-native) — `/governed/{provider}/*` is the canonical native surface
- ADR-005 (Levels and evidence strength) — capability levels remain the canonical governance grade
- ADR-009 (Audit chain defense-in-depth) — the existing append-only audit chain stays the source of truth
- ADR-011 (Right to erasure) — crypto-shred paths stay the basis for deletion semantics

> This document defines the **target architecture** for the GovAI Workroom (a.k.a. Multi-Agent Governance Room) **before** any runtime is built. Phased implementation is derived from the target — not the other way around. There are no placeholder endpoints in this blueprint and there must be none in any phase that implements it.

---

## Implementation status

> Added 2026-06-04 without rewriting the target architecture below.

- This document **remains the target architecture**; the sections that follow are the blueprint, not a status report.
- Runtime implementation has **begun** after the original blueprint. **Phases 1–4 are live at runtime** (create/participants; transcript/tasks/evidence; workroom-owned runs; approvals) — routes `apps/api/src/routes/workrooms.ts`, `workroom-transcript.ts`, `workroom-runs.ts`, `workroom-approvals.ts`; migrations 0012–0015; orchestrator `WorkroomRunContext` integration in `pipeline/run-orchestrator.ts`.
- Implemented pieces are tracked authoritatively in [current-state.md](./current-state.md) §1.
- **Not all** target Workroom capabilities are complete. Phase 5 (tool invocations), Phase 6 (UI), and Phase 7 (external autonomous agents) remain target-only. A mode-downgrade approval flow is designed but its route is not exposed.
- The hard-deny floor, external tool governance, full evidence bundle/export, and UI/cockpit remain **future or partial** unless a specific item is cited as implemented in current-state.md.

---

## 1. Why Workroom exists

Today, the manual GovAI development loop spans four surfaces stitched by a human:

| Role today | Concrete actor | Surface |
|---|---|---|
| `human_owner` | Mauricio | decides goals, authorizes, merges |
| `architect_agent` | GPT (in another app) | drafts plans, prompts |
| `auditor_agent` | Opus (in another app) | second-opinion review, finds risks |
| `executor_agent` | Claude Code (in this repo) | reads, edits, runs tests, opens PRs |
| `external_work_system` | GitHub + CI | branches, commits, checks, issues, comments |
| `evidence_substrate` | PRs, issues, CI runs | audit trail that lives across N tools |

This loop already works because a disciplined human carries the evidence from one tool to another and refuses to merge what wasn't reviewed. Inside the GovAI platform that human is not a scalable assumption: regulated tenants will run dozens of these loops concurrently, with multiple agents (some autonomous), multiple human roles (owner / approver / auditor / DPO), and binding outcomes (commits, deploys, decisions on regulated data).

**Workroom is the production-grade primitive that brings this loop inside GovAI without losing any of the governance that the four-tool dance has today.** Concretely, it is:

- a **durable** collaboration container scoped to a single piece of governed work;
- a **policy-governed** execution environment for multi-agent + multi-human collaboration;
- an **evidence container** linked into the existing audit chain;
- the **control plane** above runs, approvals, tool invocations, and external-system artifacts;
- the **surface** where a human decides, an architect agent proposes, an auditor agent challenges, and an executor agent acts — under the same governance every other GovAI surface is bound by.

Workroom is **not**:

- `/v1/runs` renamed,
- a generic chat window,
- an ungoverned agent swarm,
- a provider abstraction,
- a UI-only feature,
- a replacement for `/governed/{provider}/*` or `/passthrough/{provider}/*`,
- a place to hide unaudited tool calls.

---

## 2. Mapping today's manual loop to the target product

| Manual concept (today) | Workroom concept (target) | Notes |
|---|---|---|
| Mauricio | `WorkroomParticipant{kind: human, role: human_owner}` | One human owner per workroom by default; co-owners allowed. |
| GPT prompt sessions | `WorkroomParticipant{kind: agent, role: architect_agent}` | Architect agent emits proposed plans/turns into the workroom. |
| Opus reviews | `WorkroomParticipant{kind: agent, role: auditor_agent}` | Auditor agent emits `ReviewFinding` artifacts and may block. |
| Claude Code session | `WorkroomParticipant{kind: agent, role: executor_agent}` | Executor agent owns `ToolInvocation`s and proposes `Run`s. |
| GitHub repo, PRs, CI runs | `ExternalSystemLink` | Linked, not duplicated; evidence carries the link. |
| Slack/manual messages | `ConversationMessage` (in workroom transcript) | The workroom transcript is the canonical channel. |
| "Authorize merge" decision | `ApprovalDecision{policy: human_approver, scope: merge}` | Approval becomes a first-class, audited artifact. |
| Final audit report | `WorkroomEvidenceBundle` (a queryable index over `EvidenceArtifact`s) | No new chain — leverages the existing audit chain. |

The point is **one-to-one identifiability**: every signal that today exists somewhere in the human's head or in a tab they kept open must have a typed representation in the workroom.

---

## 3. Non-negotiable principles

1. **Target architecture first; phased implementation second.** Every phase below maps to a piece of *this* target, not a parallel design that will be reshaped later.
2. **No fake endpoints.** A route ships only with the contract, the audit emission, the policy enforcement, and the persistence it claims to have.
3. **No agent runs outside governance.** An "agent" that cannot be paused, audited, and revoked is not an agent — it is a liability.
4. **Runs are still the execution unit.** Workroom is the *collaboration container above runs*. ADR-001 stays canonical.
5. **No new audit chain.** Workroom reuses `govai.audit_events` and the existing `ChainCategory` model. New event types extend the catalogue; the chain stays defense-in-depth (ADR-009).
6. **No implicit approvals on risky actions.** Every action with a risk class above a tenant's `auto_approval_ceiling` requires an explicit `ApprovalDecision`.
7. **Provider-native semantics are sacred.** The governed and passthrough surfaces keep their byte-perfect contracts. Workroom never bypasses them.
8. **External agents are not exempt.** OpenClaw, NemoClaw, MCP servers, and any future autonomous runtime are modeled as `agent` participants that speak the same Workroom API as everything else.
9. **Tenant isolation is non-negotiable.** A workroom belongs to one `org_id`. Cross-tenant participants are explicit, audited, and out of scope for the first phase.
10. **No phase ships behavior the user cannot see in the evidence chain.** If we cannot show it in the audit, we cannot do it.

---

## 4. The Workroom concept, precisely

A **Workroom** is a tenant-scoped, durable, append-only-by-default coordination container with:

- a fixed `org_id` and `workspace_id` (carrying forward today's runs schema);
- a set of `WorkroomParticipant`s (human and agent), each with a typed role and a permission scope;
- a chronological `WorkroomTurn`-ordered transcript of `ConversationMessage`s, `ToolInvocation`s, `Run` references, `ApprovalRequest`s, `ApprovalDecision`s, and `ReviewFinding`s;
- one or more `WorkroomTask`s representing the work being done;
- zero or more `Run`s (the existing `govai.runs` rows) attributed to the workroom;
- an `EvidenceBundle` view that exposes every artifact + its audit chain anchor;
- a lifecycle (`draft → open → blocked_on_approval → completed | cancelled | archived`) and an explicit retention/erasure policy.

A workroom is **the only place** where a multi-agent loop is allowed to execute inside the platform. Calling a governed/passthrough provider surface remains permissible without a workroom (existing single-call flows), but **any multi-agent orchestration must happen inside a workroom or be denied at admission.**

### 4.1 Workroom governance modes

Every Workroom is created in exactly one of two **governance modes**. The mode is a first-class property of the Workroom — recorded at creation, surfaced in every event/run/approval/evidence record, and visible in the UI at all times. The mode is the analogue at the *collaboration* layer of the existing `/governed` vs `/passthrough` split at the *provider-native* layer.

```ts
type WorkroomGovernanceMode =
  | 'governance_active'
  | 'audit_only';
```

#### governance_active (default)

- **Default mode** for every newly created Workroom.
- Policy can **block**: `policy_decisions.decision ∈ {deny, ask, mutate}` actually halt or rewrite execution.
- Approvals are **enforced** at admission, not after-the-fact.
- High-risk actions (`risk_class ∈ {C, D, E}`) and any regulated-data action (`pii_strong`) require HITL per §8.2.
- Provider calls default to `/governed/{provider}/*`.
- Appropriate for production, regulated, enterprise, customer-facing, or high-risk work.

#### audit_only (explicit opt-in)

- Explicit opt-in mode; never auto-selected.
- Policy **observes and records**, but does not block low/medium-risk actions.
- Provider calls may default to `/passthrough/{provider}/*`.
- Evidence chain, audit metadata, tenant isolation, RBAC, no-leak invariants, and cost/rate limits are **fully preserved**.
- Hard-deny boundaries (§4.2) remain enforced regardless.
- Appropriate for research, experimentation, development, exploratory analysis, internal labs, and power-user workflows.

> **Default mode is `governance_active`. Audit-only is a first-class product option, not a loophole or a bypass.**

### 4.2 Audit-only is not ungoverned

The `audit_only` mode is **never** a path to:

- no audit;
- no evidence;
- no tenant isolation;
- no RBAC;
- no cost controls;
- no secret handling;
- no safety floor;
- no accountability;
- direct provider access outside GovAI's resolver;
- unbounded autonomous agent action.

Every Workroom — regardless of governance mode — enforces the following **hard-deny floor**:

- Secret and credential exfiltration is denied.
- Destructive system actions outside the participant's `tool_grants` are denied.
- Malware-authoring and abuse workflows are denied.
- Production-impacting actions outside the workroom's `workspace_id` are denied.
- Regulated data above the org's configured policy ceiling is denied (DPO escalation path applies).
- Autonomous browser/system actions above the configured risk class are denied.
- External integrations above the configured risk/cost limits are denied.
- Any attempt to bypass tenant provider credential resolution is denied.
- Any attempt to disable, mute, or weaken evidence/audit capture is denied.

Operational principle:

> **audit_only = observe-first, block-only-for-hard-boundaries.**

The difference between `governance_active` and `audit_only` is **how aggressively policy intervenes on the soft-deny / advisory boundary**, not whether the hard floor exists. The hard floor is invariant.

### 4.3 Mode selection and mode changes

- `governance_mode` is selected at Workroom creation and persisted on the `Workroom` row.
- **Upgrade (`audit_only → governance_active`)** is allowed for any participant with `human_owner` role and is audit-recorded. No cool-down.
- **Downgrade (`governance_active → audit_only`)** is a risk downgrade and requires:
  - an explicit `ApprovalRequest{subject_kind: workroom_state}`,
  - granted by `human_owner` AND (where org policy mandates segregation of duties) a second human approver,
  - audit-recorded as a typed `WorkroomPolicyChanged` event (Phase-4 detail; defined here only conceptually — no event schema in this PR).
- **Active runs do not silently inherit a downgraded mode mid-flight.** An in-flight run records the mode it started under; the downgrade applies only to runs created after the transition.
- The org-level admin policy may **disable audit-only entirely** for a tenant (e.g. regulated tier). When disabled, `POST /v1/workrooms` rejects `governance_mode: audit_only` at admission.
- The UI and the `GET /v1/workrooms/{id}` response must expose the current mode and the most recent transition.

Conceptual `WorkroomPolicyProfile` shape (the field-level entity is defined in §13; this is the typed view from the architecture):

```ts
type WorkroomPolicyProfile = {
  governance_mode: 'governance_active' | 'audit_only';
  default_provider_surface: 'governed' | 'passthrough';
  max_risk_without_approval: 'A' | 'B' | 'C' | 'D' | 'E';
  hard_denies_enabled: true;  // invariant: always true; not a togglable boolean
  approval_policy_id?: string;
};
```

Notes:
- `hard_denies_enabled` is shown above for clarity, but it is **not a configurable field** — it is an invariant of every profile. It is documented in the conceptual type so future migrations don't accidentally model it as optional.
- Whether a tenant may create audit-only Workrooms is an **org-level** policy decision (admin endpoint), not a per-Workroom toggle.
- Regulated/production tiers may seed a stricter default profile (e.g. `max_risk_without_approval = 'B'`, `audit_only` disallowed).

**Invariant:** Every Workroom-created run, approval request, policy decision, evidence artifact, tool invocation, and audit event carries the Workroom's `governance_mode` in its audit context. There is no log line or evidence row in which the mode is implicit.

---

## 5. Control plane vs data plane

| Plane | Lives in | Responsibilities |
|---|---|---|
| **Control plane** | `/v1/workrooms/*`, `/v1/admin/*`, future approval/policy endpoints, audit/event subscription | workroom creation, participants, roles, permissions, approval policies, run orchestration, task assignment, evidence indexing, state transitions, RBAC enforcement |
| **Data plane** | `/governed/{provider}/*`, `/passthrough/{provider}/*`, `/v1/runs` execution path, tool execution sandboxes, artifact storage, external integration adapters | provider calls, tool calls, streaming outputs, artifact storage, logs, evidence payload bytes, external system I/O |

Mapping existing surfaces:

| Surface | Plane | Owned by Workroom? |
|---|---|---|
| `/governed/{provider}/*` (PR3.1d/h) | data | no — called by data plane on behalf of a run; run may belong to a workroom |
| `/passthrough/{provider}/*` (PR3.1i/j) | data | no — same as governed; admitted into a workroom only by explicit policy |
| `/v1/runs` (PR2/PR3.1*) | data | runs may be created **inside** a workroom (preferred) or remain standalone (legacy + non-workroom integrations) |
| `/v1/admin/*` (PR3.1b) | control | continues to own credentials, beta overrides, RBAC, KMS |
| **future `/v1/workrooms/*`** | control | new — the workroom control plane lives here |

**Design rule:** anything that mutates a workroom's participants, policies, or lifecycle is a control-plane call. Anything that emits provider/tool bytes is a data-plane call. The two planes share auth, RBAC, and audit chain, but never share request handlers.

---

## 6. Relationship to existing surfaces

### 6.1 `/governed/{provider}/*` — unchanged

`/governed/{provider}/*` remains the enforcement-active provider-native surface. Workroom-owned runs hit it the same way `/v1/runs` does today (the governed handler is reused via `handleAnthropicGovernedMessages` / `handleOpenAIGovernedResponses` / `handleOpenAIGovernedChatCompletions`). PR3.1k's contract (`resolveProviderKey(orgId, operationalMode)`) requires nothing new from Workroom — the workroom-owned run still authenticates via API key, builds an `AuthIdentity`, and threads operational mode through.

A `governance_active` Workroom **defaults** to this surface for every provider call. An `audit_only` Workroom may still call this surface freely — using `/governed/*` from inside an audit-only Workroom is a stricter execution choice (see §6.5).

### 6.2 `/passthrough/{provider}/*` — surface choice depends on Workroom mode

`/passthrough/{provider}/*` continues to be the audit-only provider-native compatibility surface. Its admission into a Workroom now depends on the Workroom's `governance_mode` (see §4.1):

- In a **`governance_active` Workroom**, passthrough is **never** the default. A workroom-owned run may target passthrough only if:
  1. the tenant's `WorkroomPolicyProfile.default_provider_surface` or a per-task override allows it, **and**
  2. an explicit `ApprovalDecision{subject_kind: passthrough_run}` is recorded for that run, OR the profile's `max_risk_without_approval` ceiling explicitly admits this combination (regulated tenants will not).

- In an **`audit_only` Workroom**, passthrough **may be the default**, controlled by `WorkroomPolicyProfile.default_provider_surface`. Per-run upgrade to `/governed/*` is always allowed without extra approval (stricter execution is never gated). Per-run downgrade is not possible (`audit_only` is already the relaxed mode at the Workroom layer).

In both cases, passthrough invocations preserve the existing semantics validated by PR3.1i/j: byte-perfect forwarding, the `passthrough.invoked` v3 audit event with `enforcement_decision='observe'`, `credential_source='tenant_provider_credential'`, `body_forward_mode='raw'`, and (for streams) `stream_final_hash`. Passthrough is not a route to bypass evidence — it is a route to bypass enforcement *intervention*, which the Workroom's audit chain records exactly as today.

### 6.3 `/v1/runs` — explicit resolution

> **Decision:** `/v1/runs` remains the canonical GovAI execution primitive. Workroom is the collaboration container **above** runs. A workroom can create and supervise many runs. A run **may optionally** belong to a workroom. Provider-native execution always flows through `/governed/*` or `/passthrough/*`.

Concretely:

- The `govai.runs` row gains an optional `workroom_id uuid NULL REFERENCES govai.workrooms(id)` and an optional `created_by_participant_id uuid NULL` (proposed in §11).
- Workroom-owned runs are created via `POST /v1/workrooms/{workroom_id}/runs` (control plane), which delegates execution to the same `run-orchestrator` already in `apps/api/src/pipeline/run-orchestrator.ts` (no fork).
- `POST /v1/runs` continues to work for non-workroom integrations (the existing PR3.1k-era contract is unchanged). When `workroom_id` is omitted in either path, the run is standalone.
- We do **not** introduce subroute sprawl under `/v1/runs`. We do not create `/v1/runs/{id}/messages`, `/v1/runs/{id}/approvals`, etc. Those live on the workroom because they are coordination concerns, not run-internal state.

> **Why this direction:** `/v1/runs` already carries `mode ∈ {governed, passthrough, shadow}`, `status` with `awaiting_approval`, `risk_level`, `workspace_id`, and `assistant_id`. The runs schema was designed to be extensible. Workroom adds a *parent* edge and a *coordination* layer on top, without redefining what a run is.

### 6.4 `/v1/admin/*` — unchanged

Admin endpoints stay the way they are. Workroom-level admin (e.g. tenant-wide `WorkroomPolicy` configuration) is exposed via `/v1/admin/workroom-policies/*` when Phase 4 lands; it does not retroactively rename existing admin routes.

### 6.5 `Workroom.governance_mode` × `runs.mode` — orthogonal axes

`Workroom.governance_mode` (per collaboration room) and `runs.mode` (per execution, already shipped in `govai.runs.mode ∈ {governed, passthrough, shadow}`) are **orthogonal**. One does not replace the other. The Workroom mode controls the *defaults* and the *approval ceiling*; the run mode is still the per-execution choice.

| Workroom mode | Run mode | Meaning | Approval status | Audit annotation |
|---|---|---|---|---|
| `governance_active` | `governed` | Default enforcement-active execution inside an enforcement-active room. | Default, no extra mode-related approval. | `mode_match=true` |
| `governance_active` | `passthrough` | Audit-only execution inside an enforcement-active room. | **Exception** — explicit `ApprovalDecision{subject_kind: passthrough_run}` required (or org-level policy exception). | `mode_override=true` |
| `audit_only` | `passthrough` | Default audit-only execution inside an audit-only room. | Default, no extra mode-related approval. | `mode_match=true` |
| `audit_only` | `governed` | Enforcement-active execution inside an audit-only room. | Always allowed; never requires extra approval (stricter execution is never gated). | `mode_upgrade=true` |

Operational rules:

- The Workroom's `governance_mode` controls the **default** `runs.mode` for runs created inside that Workroom, via `WorkroomPolicyProfile.default_provider_surface`.
- `runs.mode` remains the per-execution choice. It is set at run creation and never mutated thereafter.
- A `governance_active` Workroom may admit `passthrough` runs only by policy exception, explicit task override, or human approval.
- An `audit_only` Workroom may always admit `governed` runs — stricter execution is never gated.
- An in-flight run does **not** change its `runs.mode` if the Workroom's `governance_mode` changes mid-flight. The run carries the mode it started with for its entire lifetime.
- Every Workroom-created run records **both**:
  - `workroom.governance_mode` (a snapshot at run creation),
  - `runs.mode` (the per-execution choice),
  - and the audit annotation (`mode_match`, `mode_override`, `mode_upgrade`) for forensic clarity.
- Every `EvidenceArtifact`, `PolicyDecision`, `ApprovalRequest`, and `ApprovalDecision` emitted in the run also includes both values in its audit context. There is no event that records `runs.mode` without `workroom.governance_mode` once the run belongs to a Workroom.
- Standalone runs (`workroom_id IS NULL`) retain the existing audit shape; the new annotations apply only to Workroom-owned runs.

This matrix is the single source of truth for how the Workroom mode and run mode interact. Future ADRs that change either axis must update this matrix.

---

## 7. Domain model

The following entities are defined at field-level detail so DB migrations can be derived later. They are **not** migrations — they are the typed model the migrations must materialize.

### 7.1 `Workroom`

- `id: uuid` (pk)
- `org_id: uuid` (tenant key, RLS)
- `workspace_id: uuid` (carry-forward from runs.workspace_id)
- `name: text`
- `purpose: text` (free-form goal statement; immutable after first message — see §10)
- `status: WorkroomStatus` (see §10.1)
- `governance_mode: 'governance_active' | 'audit_only'` (see §4.1; selected at creation, mutable only via §4.3 transition rules)
- `policy_profile_id: uuid` (FK → `WorkroomPolicyProfile`; defines approval ceilings, allowed surfaces, default risk class, and is consistent with `governance_mode`)
- `created_by_user_id: uuid`
- `created_at, updated_at: timestamptz`
- `closed_at, archived_at: timestamptz NULL`
- `retention_class: text` (see §13 — retention/erasure)
- `metadata: jsonb` (free-form, audited)

Ownership: org-scoped. RLS by `org_id`. Append-only-by-default — status transitions and `governance_mode` transitions (§4.3) are the only mutations allowed after creation, with the exception of `metadata` extension (additive, audited). Every `governance_mode` change emits a typed audit event (Phase-4 detail).

### 7.2 `WorkroomParticipant`

- `id: uuid` (pk)
- `workroom_id: uuid`
- `kind: 'human' | 'agent'`
- `role: WorkroomParticipantRole` (see §8)
- For `kind=human`: `user_id: uuid` and the participant inherits the user's RBAC + workroom-scoped grants.
- For `kind=agent`: `agent_profile_id: uuid` (FK → `AgentProfile`)
- `permission_scope: jsonb` (the typed permissions this participant has in this workroom; cannot exceed the user's or agent profile's permissions — workroom is a *narrowing* lens, never a *widening* one)
- `added_by_participant_id: uuid NULL`
- `added_at: timestamptz`
- `removed_at: timestamptz NULL`
- `status: 'invited' | 'active' | 'removed'`

### 7.3 `AgentProfile`

A reusable definition of an agent participant template (e.g. "Opus auditor"). Tenant-scoped.

- `id, org_id: uuid`
- `name: text` (e.g. `opus-auditor-v1`)
- `provider: 'anthropic' | 'openai' | 'external'` (`external` covers OpenClaw/NemoClaw/MCP — see §10)
- `model: text NULL` (for in-platform providers; null for external runtimes)
- `default_role: WorkroomParticipantRole`
- `tool_grants: jsonb` (whitelist of `capability_id`s the agent may invoke; never a free-for-all)
- `default_approval_policy_id: uuid`
- `cost_attribution: jsonb` (per ADR-012)
- `is_disabled: boolean`

### 7.4 `HumanParticipant`

Not a separate table — modeled as `WorkroomParticipant{kind: human, user_id: …}`. Kept in the domain model so role separation between `human_owner / human_approver / human_reviewer / dpo_reviewer` is explicit (see §8).

### 7.5 `WorkroomSession`

Optional bounded execution window inside a workroom (e.g. "today's coding session"). Useful for cost attribution, retention windows, and large-scale workrooms; **the v1 implementation may treat the workroom itself as a single session**.

- `id, workroom_id`
- `opened_at, closed_at`
- `cost_attribution: jsonb`

### 7.6 `WorkroomTurn`

The strictly-ordered unit of progress within a workroom. Every artifact added to the transcript belongs to exactly one turn.

- `id, workroom_id`
- `turn_number: bigint` (per-workroom monotonic)
- `actor_participant_id: uuid` (who emitted the turn)
- `kind: 'message' | 'tool_invocation' | 'run_event' | 'approval_request' | 'approval_decision' | 'review_finding' | 'evidence' | 'state_transition'`
- `occurred_at: timestamptz`
- `payload_ref: uuid NULL` (FK to the concrete typed table — `ConversationMessage`, `ToolInvocation`, etc.)
- `audit_event_id: uuid` (FK into the existing audit chain — see §9)

### 7.7 `WorkroomTask`

A unit of work scoped to the workroom.

- `id, workroom_id`
- `title, description`
- `status: TaskStatus` (§10)
- `assigned_participant_id: uuid NULL`
- `risk_class: 'A'|'B'|'C'|'D'|'E'` (carry-forward from existing governance grade)
- `requires_approval: boolean`
- `created_by_participant_id`
- `created_at, updated_at`
- `linked_run_ids: uuid[]` (denormalised for query efficiency; canonical edge is `govai.runs.workroom_id`)

### 7.8 `Run`

Existing `govai.runs` row, extended (proposed):

- `+ workroom_id: uuid NULL REFERENCES govai.workrooms(id)`
- `+ workroom_task_id: uuid NULL`
- `+ created_by_participant_id: uuid NULL`
- `+ approval_policy_id: uuid NULL`
- `+ workroom_governance_mode: 'governance_active' | 'audit_only' NULL` — snapshotted from `Workroom.governance_mode` at run creation; immutable thereafter; NULL for standalone runs. Combined with the existing `runs.mode` column, this gives the forensic axes documented in §6.5 (`mode_match` / `mode_override` / `mode_upgrade`).

No change to `mode`, `status`, `risk_level`, or any other existing column. The new columns are nullable so existing rows and standalone-run flows continue to work. The existing `runs.mode ∈ {governed, passthrough, shadow}` remains the per-execution choice; the new `workroom_governance_mode` is the parent Workroom's mode snapshot at creation.

### 7.9 `RunStep`

Already represented today by `govai.provider_invocations` (one or more per run). No new entity needed in v1; we add a `workroom_turn_id` column to surface invocations in the transcript.

### 7.10 `ToolInvocation`

The act of an agent invoking a non-provider capability (a code edit, a shell command, a file write, a database query, an external API call, an MCP tool).

- `id, workroom_id, workroom_turn_id, run_id NULL`
- `actor_participant_id`
- `capability_id: text` (governed via the existing capability registry — never free-text)
- `arguments_hash: bytea` (HMAC over canonicalised arguments; payload encrypted-at-rest in `audit_event_payloads`)
- `decision: 'allow' | 'deny' | 'ask' | 'mutate'` (mirrors `policy_decisions.decision`)
- `policy_decision_id: uuid` (FK into `govai.policy_decisions`)
- `status: 'pending_approval' | 'running' | 'completed' | 'failed' | 'denied'`
- `result_hash: bytea NULL`
- `latency_ms, started_at, completed_at`

Tool execution itself happens on the data plane (in a sandboxed executor); the control plane only records the `ToolInvocation` envelope.

### 7.11 `ApprovalRequest`

- `id, workroom_id, workroom_turn_id`
- `requested_by_participant_id`
- `subject_kind: 'tool_invocation' | 'run' | 'file_edit' | 'commit' | 'push' | 'pr_open' | 'pr_merge' | 'external_action' | 'passthrough_run' | 'workroom_state'`
- `subject_ref_id: uuid`
- `risk_class: 'A'..'E'`
- `policy_id: uuid` (which approval policy is being evaluated)
- `required_approver_roles: WorkroomParticipantRole[]`
- `required_approver_count: int` (defaults to 1; regulated tenants may require N>=2)
- `expires_at: timestamptz`
- `status: 'pending' | 'granted' | 'denied' | 'expired' | 'revoked'`

### 7.12 `ApprovalDecision`

- `id, approval_request_id`
- `decided_by_participant_id`
- `decision: 'grant' | 'deny' | 'request_changes'`
- `reason: text` (required for `deny` and `request_changes`; recommended for `grant`)
- `decided_at`
- `decision_audit_event_id`

### 7.13 `EvidenceArtifact`

The typed wrapper around any piece of evidence emitted in the workroom. **Every** artifact is anchored to the audit chain (§9).

- `id, workroom_id, workroom_turn_id`
- `artifact_kind: 'prompt' | 'agent_response' | 'tool_invocation_result' | 'file_diff' | 'commit' | 'pr' | 'ci_run' | 'issue_comment' | 'human_approval' | 'auditor_finding' | 'merge_decision' | 'external_artifact'`
- `payload_ref: uuid` (into `audit_event_payloads` — encrypted-at-rest)
- `payload_hash: bytea` (matches the `audit_events.payload_hash`)
- `redaction_metadata: jsonb`
- `external_link_id: uuid NULL` (FK → `ExternalSystemLink` if this artifact refers to something outside GovAI)
- `created_at`

### 7.14 `ReviewFinding`

What an auditor agent or human reviewer emits.

- `id, workroom_id, workroom_turn_id`
- `reviewer_participant_id`
- `severity: 'info' | 'note' | 'warning' | 'risk' | 'blocker'`
- `subject_ref_id: uuid` (the artifact under review)
- `text_ref: uuid` (into `audit_event_payloads`)
- `blocks_until_resolved: boolean`
- `resolved_by_decision_id: uuid NULL`

### 7.15 `PolicyDecision`

Already exists as `govai.policy_decisions`. Workroom-emitted decisions get a `workroom_turn_id` column (additive). No fork.

### 7.16 `RiskClassification`

Not a stored entity in v1 — risk class is a computed property attached to tasks, tool invocations, and runs, derived from the existing governance functions (`computeEnforcement`, `resolveGovernance`). The architecture pins risk class as the lingua franca for approval policy.

### 7.17 `ConversationMessage`

- `id, workroom_id, workroom_turn_id, participant_id`
- `role: 'user' | 'assistant' | 'system' | 'auditor_note'` (note: `system` messages are restricted to platform-emitted, not free-form from participants)
- `content_ref: uuid` (into `audit_event_payloads`)
- `tokens_in, tokens_out: int NULL` (when the message backs a provider call)
- `provider_invocation_id: uuid NULL`

### 7.18 `ExternalSystemLink`

- `id, workroom_id`
- `external_system: 'github' | 'gitlab' | 'jira' | 'linear' | 'slack' | 'custom'`
- `link_kind: 'pr' | 'issue' | 'commit' | 'ci_run' | 'comment' | 'thread' | 'other'`
- `external_id: text` (e.g. `mauriciodesouzaads/govai-platform#41`)
- `url: text`
- `linked_by_participant_id`
- `verified_at: timestamptz NULL` (when GovAI has confirmed the linked entity exists and is owned by the tenant)

External system writes go through `ToolInvocation` (i.e. a `github.pr.merge` capability), not through `ExternalSystemLink` directly. `ExternalSystemLink` is the *reference*, not the *action*.

---

## 8. Roles, permissions, and governance rules

### 8.1 Participant roles

| Role | Kind | Allowed | Forbidden | Default approval requirement |
|---|---|---|---|---|
| `human_owner` | human | everything within the workroom; only role allowed to archive/cancel | grant approval over own actions when policy requires segregation of duties | none for own messages; required for own risky actions if SoD enabled |
| `human_approver` | human | grant/deny `ApprovalRequest`s; emit `ReviewFinding` | execute tools; create runs; merge | n/a (they are the approver) |
| `human_reviewer` | human | emit `ReviewFinding`; comment | grant approvals; execute | n/a |
| `dpo_reviewer` | human | inspect any artifact; demand redaction; block on privacy | execute tools | mandatory approver when `risk_class ∈ {D,E}` AND artifact carries DLP findings of class `pii_strong` |
| `architect_agent` | agent | emit messages, propose plans, request approvals, request runs | execute tools; commit; push; merge; touch external systems | every run + tool invocation request gets approved by `human_owner` or `human_approver` |
| `auditor_agent` | agent | inspect artifacts, emit `ReviewFinding` (including `blocker`), propose redactions | execute tools; commit; merge; mutate workroom state | n/a (advisory; cannot grant) |
| `executor_agent` | agent | execute approved tool invocations; create runs; emit tool results | self-approve risky actions; bypass policy; act outside its `tool_grants` whitelist | every tool invocation evaluated against `auto_approval_ceiling`; anything above ceiling requires human approval |
| `observer_agent` | agent | read transcript; emit summaries | emit any `state_transition`, `approval_*`, `tool_invocation`, `run` | n/a |
| `tool_agent` | agent | execute one specific capability (e.g. `github.pr.create`) under approval | act outside its single capability | per-invocation, unless ceiling explicitly allows |
| `external_agent` | agent | participate as architect/executor/auditor *only* via the OpenClaw/NemoClaw adapter boundary (see §10) | bypass any of the above; act without an `AgentProfile` | always — external_agent never auto-approved |

### 8.2 Approval policy rules (default ceiling)

The default ceiling depends on the Workroom's `governance_mode`. The columns below give the **default** approval requirement for each mode; an org-level admin policy may tighten any cell but never loosen the hard-deny floor (§4.2).

| Action | `governance_active` default | `audit_only` default |
|---|---|---|
| agent emits a `ConversationMessage` | none | none |
| agent requests a `Run` against `/governed/*` with `risk_class ∈ {A,B}` | none | none |
| agent requests a `Run` against `/governed/*` with `risk_class ∈ {C,D,E}` | `human_owner` OR `human_approver` | `human_owner` OR `human_approver` (unchanged — stricter execution is never gated below `governance_active` rules) |
| agent requests a `Run` against `/passthrough/*` with `risk_class ∈ {A,B}` | `human_owner` OR `human_approver` (always — `mode_override`) | none (default surface in audit-only) |
| agent requests a `Run` against `/passthrough/*` with `risk_class ∈ {C,D,E}` | `human_owner` OR `human_approver` (always — `mode_override`) | `human_owner` OR `human_approver` |
| agent requests a `ToolInvocation` reading the repository | none | none |
| agent requests a `ToolInvocation` writing a file in the repository | `human_owner` OR `human_approver` | advisory `ReviewFinding`; approval not required (subject to per-tool `tool_grants`) |
| agent requests `git commit` | `human_owner` OR `human_approver` | `human_owner` OR `human_approver` (commits are not soft-deny territory even in audit-only) |
| agent requests `git push` | `human_owner` (always; never auto) | `human_owner` (always; never auto — hard floor) |
| agent requests `gh pr create` | `human_owner` OR `human_approver` | advisory; approval not required (still recorded as evidence) |
| agent requests `gh pr merge` | `human_owner` AND CI green AND `auditor_agent` finding `severity != blocker` | `human_owner` (always — merges affect shared state; hard floor) |
| agent requests action on regulated data (`pii_strong` finding) | `dpo_reviewer` (always) | `dpo_reviewer` (always — regulated data is hard floor regardless of mode) |
| agent requests an external integration (Slack, WhatsApp, browser, system command) | `human_owner` (always) AND the action must map to a registered `tool_agent` capability | `human_owner` (always) — external integrations remain hard floor |
| autonomous browser/system action (class D/E, including external agents) | `human_owner` (always) | `human_owner` (always — autonomy at risk D/E is hard floor) |

Summary of the audit-only delta: `audit_only` reduces approval friction for **low/medium-risk soft-deny territory** (file edits, PR creation, low-risk passthrough). It does **not** loosen the hard floor (push, merge, external integrations, regulated data, class D/E autonomy). The hard floor is invariant across modes.

> **Audit-only mode may reduce approval friction for low/medium-risk actions, but must not bypass approvals for destructive, external, privileged, regulated, or high-cost actions.**

### 8.3 Conflict resolution

When two agents disagree (e.g. architect proposes X, auditor flags X as `blocker`), the workroom **does not auto-resolve**. The conflict surfaces as an `ApprovalRequest` to `human_owner` (or to `human_approver` if SoD is required). The architecture explicitly forbids any rule like "majority of agents wins" — agents do not vote; humans decide.

---

## 9. Evidence chain

Workroom does **not** invent a new audit chain. It extends the existing one (ADR-009).

### 9.1 What gets recorded

| Workroom artifact | Audit event type (new) | Chain category | Payload encrypted-at-rest |
|---|---|---|---|
| `Workroom` created/state-changed | `workroom.lifecycle` | `run` (workrooms are run containers) | yes |
| `WorkroomParticipant` added/removed/role-changed | `workroom.participant` | `admin` (participation is a permission grant) | yes |
| `ConversationMessage` | `workroom.message` | `run` | yes |
| `ToolInvocation` (request, decision, result) | `workroom.tool_invocation` | `run` | yes (arguments + result encrypted) |
| `ApprovalRequest` opened | `workroom.approval_request` | `policy` | yes |
| `ApprovalDecision` | `workroom.approval_decision` | `policy` | yes |
| `ReviewFinding` | `workroom.review_finding` | `policy` | yes |
| `EvidenceArtifact` (file diff, commit ref, PR ref, CI run ref, etc.) | `workroom.evidence` | `run` | yes (the artifact body); external links stored as references only |
| `Run` lifecycle inside a workroom | existing `run.*` events | `run` | unchanged |
| Provider invocation inside a workroom | existing `passthrough.invoked` v3 | `run` | unchanged |

### 9.2 Chain categories

We do **not** introduce new `ChainCategory` values. Workroom events route into `run`, `policy`, or `admin` based on what they semantically are. The existing `auth` chain remains untouched.

### 9.3 What is hashed vs stored raw vs redacted vs external

| Class | Storage |
|---|---|
| Prompts, agent responses, tool arguments, tool results | encrypted-at-rest in `audit_event_payloads`; `payload_hash` in `audit_events`; HMAC and chain linking unchanged from ADR-009 |
| File diffs and large binary artifacts | encrypted-at-rest; if size exceeds a configured threshold, stored in object storage with a hash-anchored reference (Phase 2 detail) |
| External references (GitHub PR URL, CI run URL) | stored as URL + canonical id in `ExternalSystemLink`; only the *reference* is in `audit_events`, never the external body |
| DLP-redacted fields | redacted payload in `audit_event_payloads.encrypted_payload`; redaction metadata in `audit_events.redaction_metadata` (existing column) |
| Provider credentials, KMS material, raw API keys | **never** in any audit row, payload, or external link. PR3.1d/h leak invariants apply unchanged |

### 9.4 HMAC and tamper resistance

Every new `workroom.*` event type receives the same HMAC + `pg_advisory_xact_lock(chain_lock_key)` treatment that runs/policy/admin already get (ADR-009). No new key, no new lock, no new chain.

### 9.5 Erasure

A workroom inherits the org's retention class. When erasure is invoked (right-to-erasure, ADR-011), the payload of every workroom event is crypto-shredded via the existing `audit_event_payload_crypto_shred` SECURITY DEFINER function; the audit_events rows survive with `status='crypto_shredded'`. External references in `ExternalSystemLink` are tombstoned but not deleted — pointing to GitHub PRs continues to be useful evidence even after the local body is shredded.

---

## 10. State machines

All workroom-related entities have explicit lifecycles. No "draft state implied" anywhere.

### 10.1 `Workroom`

```
draft ──open──▶ open ──block──▶ blocked_on_approval ──unblock──▶ open
                  │                       │
                  │                       └── (timeout) ──▶ open (with stale-approval audit)
                  ├── (owner closes) ──▶ completed
                  ├── (owner cancels) ──▶ cancelled
                  └── (retention expiry / archive) ──▶ archived
```

- Transitions emit `workroom.lifecycle` events.
- `archived` is the terminal state — no further turns may be appended, but the transcript and evidence remain queryable until crypto-shred.

### 10.2 `WorkroomTask`

```
draft ──queue──▶ queued ──assign──▶ assigned ──run──▶ running
                                                      │
                                  ┌───────────────────┼────────────────────┐
                                  ▼                   ▼                    ▼
                          blocked_on_approval     failed             completed
                                  │
                                  ▼
                          (resolve) → running OR cancelled
```

### 10.3 `Run` (existing, unchanged)

The existing `govai.runs.status ∈ {queued, running, completed, failed, denied, awaiting_approval}` machine stays as-is. Workroom adds the **parent-edge** `workroom_id`, not a new state.

### 10.4 `ApprovalRequest`

```
pending ──decide──▶ granted | denied
   │
   ├── (expiry) ──▶ expired
   └── (requester revokes) ──▶ revoked
```

`expired` and `revoked` are terminal; a new `ApprovalRequest` must be opened.

### 10.5 `ToolInvocation`

```
pending_approval ──approve──▶ running ──ok──▶ completed
        │                       │
        │                       └── err ──▶ failed
        └── deny ──▶ denied
```

### 10.6 `EvidenceArtifact`

Append-only. The only "transition" is `status: active → tombstoned` (post-erasure) and `status: active → crypto_shredded` (post right-to-erasure).

---

## 11. API surface proposal

> **All endpoints below are *proposed* and ship only when their phase ships.** None are implemented in this CP1 doc. Each carries the audit, RBAC, and persistence its contract claims.

### 11.1 Control plane

| Method + path | Purpose | Auth/RBAC | Audit event(s) | Idempotency | Streaming | Risk | First-phase? |
|---|---|---|---|---|---|---|---|
| `POST /v1/workrooms` | Create a workroom | API key with role `developer` or higher | `workroom.lifecycle{transition: created}` | client-supplied `Idempotency-Key` | no | A | Phase 1 |
| `GET /v1/workrooms/{id}` | Fetch metadata | API key, RLS by `org_id` | none | n/a | no | A | Phase 1 |
| `GET /v1/workrooms?status=…` | List | API key, RLS | none | n/a | no | A | Phase 1 |
| `POST /v1/workrooms/{id}/participants` | Add participant | API key + `permission_scope` ≤ caller's scope | `workroom.participant{transition: added}` | idempotency key | no | B | Phase 1 |
| `DELETE /v1/workrooms/{id}/participants/{participant_id}` | Remove | only `human_owner` | `workroom.participant{transition: removed}` | n/a | no | B | Phase 1 |
| `POST /v1/workrooms/{id}/messages` | Append a `ConversationMessage` | API key bound to a participant | `workroom.message` | idempotency key (client-side) | no | A | Phase 2 |
| `POST /v1/workrooms/{id}/tasks` | Create a task | API key bound to a participant | `workroom.task.created` | idempotency key | no | A | Phase 2 |
| `POST /v1/workrooms/{id}/runs` | Create a workroom-owned run | API key bound to participant, `tool_grants` covers capability | `run.queued` (existing) + `workroom.evidence{run_ref}` | idempotency key | no (run streaming uses the existing governed surface) | depends on run | Phase 3 |
| `GET /v1/workrooms/{id}/runs` | List runs in the workroom | API key, RLS | none | n/a | no | A | Phase 3 |
| `POST /v1/workrooms/{id}/approvals` | Open an `ApprovalRequest` | API key bound to participant | `workroom.approval_request` | idempotency key | no | depends on subject | Phase 4 |
| `POST /v1/workrooms/{id}/approvals/{approval_id}/decisions` | Grant/deny | API key bound to a participant whose role is in `required_approver_roles` | `workroom.approval_decision` | idempotency key | no | depends on subject | Phase 4 |
| `GET /v1/workrooms/{id}/evidence` | Query the evidence index | API key, RLS, may require `auditor` for cross-participant view | none (queries are not audited beyond standard access logs) | n/a | no (cursor pagination) | A | Phase 2 |
| `GET /v1/workrooms/{id}/audit` | Query the audit subchain attributed to this workroom | API key, RLS, `auditor` role required | none | n/a | no | A | Phase 2 |
| `GET /v1/workrooms/{id}/events` (SSE) | Server-sent stream of workroom turns for live UI | API key bound to a participant | none (per-event audit happens at emission, not subscription) | n/a | yes (SSE) | A | Phase 5 (UI) |

### 11.2 Effect on `/v1/runs`

`/v1/runs` continues to accept the request shape it already accepts in PR3.1k. New nullable fields the runtime *may* read on the request:

- `workroom_id: uuid` (if present, the run is created inside the workroom and is subject to its approval policy)
- `workroom_task_id: uuid`
- `approval_policy_id: uuid`
- `created_by_participant_id: uuid`

When none are provided, the request behaves exactly as today (standalone run). When `workroom_id` is provided, the orchestrator looks up the workroom's `policy_profile_id` and consults its approval policy before queuing the run.

### 11.3 Streaming and SSE

Workroom streaming is **not** a new transport — it reuses the existing pattern (PR3.1j fixed governed/passthrough streaming headers). The only new stream is `GET /v1/workrooms/{id}/events` (SSE of workroom turns), which is a coordination concern, not a provider-byte concern. Provider streams continue to come from `/governed/*` exactly as before.

---

## 12. Security model

### 12.1 Tenant isolation

- Every Workroom, participant, task, run, approval, tool invocation, message, evidence artifact, and external link carries `org_id`.
- All new tables get `ROW LEVEL SECURITY ENABLE + FORCE` and the same `(org_id::text = current_setting('app.org_id'))` predicate the existing runs/policy_decisions/audit tables already use.
- A workroom never references an entity in another tenant.

### 12.2 RBAC

- Reuses `Role ∈ {admin, data_protection_officer, dlp_admin, developer, auditor}` (PR3.1b).
- New role-style concept (workroom-scoped only): `WorkroomParticipantRole` (§8.1). Workroom participant roles **narrow** but never **widen** the API-key user's RBAC. An `auditor` API key participating as `executor_agent` still cannot execute privileged actions outside the auditor RBAC.
- Workroom-scoped grants live in `WorkroomParticipant.permission_scope` and are evaluated *after* RBAC, never as a substitute.

### 12.3 Service accounts and agent credentials

- Agents call workroom endpoints via API keys that are bound to an `AgentProfile`. The API key authenticates the agent's runtime; the `AgentProfile` defines its allowed capabilities.
- We **do not** introduce a new "agent token" type. The existing API key + RBAC + role binding is sufficient.

### 12.4 Provider credentials

- Workrooms inherit the tenant's `provider_credentials` (PR3.1a). Provider keys remain encrypted-at-rest, looked up via `resolveAnthropicProviderKey` / `resolveOpenAIProviderKey`. Workroom does not store or transit raw provider keys.

### 12.5 Prompt injection and tool execution boundaries

- Every tool invocation is admission-controlled by the capability registry (existing `Capability` model).
- A workroom does **not** treat user-controlled message content as a trusted source of capability instructions. A tool can only run if it was either:
  - explicitly requested via `POST /v1/workrooms/{id}/runs` or a typed `ToolInvocation` request, **and**
  - admitted by the participant's permission scope and `tool_grants`, **and**
  - approved per the policy ceiling.
- An LLM "calling" a tool via natural language is not a tool invocation; it is a *proposal* that materialises as an `ApprovalRequest` (synchronous if the policy ceiling allows auto-approve; asynchronous otherwise).

### 12.6 File system, browser, and system access

- Out of scope for any phase before Phase 5.
- When introduced, every such capability is registered (`fs.write`, `browser.click`, `shell.exec`, `mcp.*`) with risk class `D` or `E` by default, denied unless explicitly granted to an `AgentProfile`, and requires `human_owner` approval per-invocation.
- Sandboxing is a Phase-5 concern with its own design doc — it does not exist in v1.

### 12.7 Audit tamper resistance

- ADR-009 invariants apply to every workroom event type. Workrooms cannot disable, soften, or skip the chain.

### 12.8 Data retention and crypto-shred

- A workroom inherits the org's retention class.
- DPO-driven erasure crypto-shreds workroom payloads via the existing function; the workroom row itself is preserved with a tombstoned status so audit anchors do not break.
- External-system references survive erasure (the body in GitHub is not GovAI's to delete).

### 12.9 Rate limits and abuse

- Workroom message/tool-invocation/run creation is rate-limited per (`org_id`, `participant_id`) at the same layer that limits `/v1/runs` today.
- A runaway agent that exceeds its rate budget is paused (not killed). The pause is itself a `workroom.participant{transition: paused}` event.

### 12.10 What is denied by default

- Cross-tenant invitations.
- Agents granting their own approvals.
- Agents creating other agents.
- External agents executing without an `AgentProfile`.
- Workrooms enabling `passthrough` runs without explicit policy.
- Any tool not in the capability registry.
- Any `system` message authored by an agent (system messages are platform-emitted only).

---

## 13. Persistence model (conceptual; no migrations in this PR)

| Table (proposed) | Tenant key | PK | Important indexes | RLS | Append-only? | Audit chain anchor |
|---|---|---|---|---|---|---|
| `govai.workrooms` | `org_id` | `id` | `(org_id, created_at DESC)`, `(org_id, status)` | yes | append-only except `status`, `metadata`, `updated_at`, `closed_at`, `archived_at` | every transition emits `workroom.lifecycle` |
| `govai.workroom_participants` | `org_id` | `id` | `(workroom_id)`, `(user_id) WHERE kind='human'`, `(agent_profile_id) WHERE kind='agent'` | yes | append-only except `status`, `removed_at` | `workroom.participant` |
| `govai.agent_profiles` | `org_id` | `id` | `(org_id, name)` unique | yes | append-only except `is_disabled` | `workroom.agent_profile` (admin chain) |
| `govai.workroom_turns` | `org_id` | `id` | `(workroom_id, turn_number)` unique | yes | append-only (no updates ever) | every row carries `audit_event_id` |
| `govai.workroom_tasks` | `org_id` | `id` | `(workroom_id, status)` | yes | append-only except `status`, `assigned_participant_id` | `workroom.task.*` |
| `govai.workroom_messages` | `org_id` | `id` | `(workroom_id, workroom_turn_id)` | yes | append-only | `workroom.message` |
| `govai.workroom_tool_invocations` | `org_id` | `id` | `(workroom_id, status)`, `(capability_id)` | yes | append-only except `status`, `result_hash`, `completed_at` | `workroom.tool_invocation` |
| `govai.workroom_approval_requests` | `org_id` | `id` | `(workroom_id, status)`, `(subject_kind, subject_ref_id)` | yes | append-only except `status` | `workroom.approval_request` |
| `govai.workroom_approval_decisions` | `org_id` | `id` | `(approval_request_id)` | yes | append-only | `workroom.approval_decision` |
| `govai.workroom_review_findings` | `org_id` | `id` | `(workroom_id, severity)` | yes | append-only except `resolved_by_decision_id` | `workroom.review_finding` |
| `govai.workroom_evidence_artifacts` | `org_id` | `id` | `(workroom_id, artifact_kind)`, `(payload_ref)` | yes | append-only except `status` (tombstone/shred) | `workroom.evidence` |
| `govai.workroom_external_links` | `org_id` | `id` | `(workroom_id, external_system, external_id)` unique | yes | append-only except `verified_at`, `status` | `workroom.evidence{kind: external_artifact}` |
| `govai.workroom_policy_profiles` | `org_id` | `id` | `(org_id, name)` unique | yes | append-only except `is_disabled`; profile-level fields (`governance_mode`, `default_provider_surface`, `max_risk_without_approval`, `approval_policy_id`) are versioned via new-row-replacement, not mutation | `workroom.policy_profile` (admin chain) |
| `govai.runs` (existing) | `org_id` | `id` | extends existing indexes with `(workroom_id)` | yes | adds `workroom_id`, `workroom_task_id`, `created_by_participant_id`, `approval_policy_id`, `workroom_governance_mode` (all NULL for standalone runs); `runs.mode` column unchanged | unchanged |

RLS predicates copy the existing pattern verbatim: `org_id::text = current_setting('app.org_id', true)`.

---

## 14. External autonomous agents (OpenClaw, NemoClaw, MCP) — integration stance

> **Decision:** External autonomous agents integrate as Workroom participants through standard Workroom and Run APIs. Agent-specific adapters may exist at the integration boundary, but governance semantics stay common. There is **no** one-off route per external runtime.

### 14.1 What "external agent" means here

- A runtime outside GovAI that proposes plans, executes tools, calls providers, or interacts with the world (browser, OS, MCP server) on behalf of a human.
- Examples: OpenClaw, NemoClaw, an MCP-hosted toolserver, a customer-built executor.

### 14.2 How they participate

- Each external agent runtime authenticates to GovAI with an API key whose `AgentProfile.provider = 'external'`.
- The agent's actions flow through the workroom as `ConversationMessage`s, `ToolInvocation`s, and `ApprovalRequest`s.
- All provider calls the external agent wants to make against Anthropic/OpenAI go through `/governed/*` or `/passthrough/*` — never directly. This is enforced because the agent's API key cannot reach the upstream provider without GovAI's tenant-scoped credential resolver.

### 14.3 Capabilities and approvals

- The external agent's `AgentProfile.tool_grants` whitelists exactly the capabilities (e.g. `github.issue.comment`, `slack.message.send`, `mcp.fs.read`) it may invoke.
- Every action above the workroom's `auto_approval_ceiling` requires explicit `ApprovalDecision`.
- Browser/system/24x7 actions are class `D` or `E` by default → always require `human_owner` approval until per-tenant policy elevates the ceiling.

### 14.4 Mode-awareness for external agents

External agents are **mode-aware** — their participation in an `audit_only` Workroom is allowed only under stricter preconditions than in-platform agents:

- The org's `WorkroomPolicyProfile` must explicitly permit `external_agent` participation in audit-only mode (default: not permitted for regulated tier; opt-in for business/enterprise).
- The agent's `AgentProfile.tool_grants` must be **bounded** by:
  - risk class (max class `C` unless per-tenant policy elevates with `human_owner` approval),
  - cost (per-turn and per-session budgets enforced at admission, not after the fact),
  - time (every external-agent session has an expiry; 24/7 autonomy is opt-in and revocable),
  - tool scope (no wildcard capability grants; every capability is explicit).
- All actions are recorded as `ToolInvocation` + `EvidenceArtifact` regardless of Workroom mode.
- Provider calls still flow through GovAI's `/governed/*` or `/passthrough/*` (never direct), with the Workroom's mode controlling which surface is the default per §6.5.
- High-risk browser/system/file-system actions (class `D` or `E`) still require `human_owner` approval **regardless of Workroom mode**. The audit-only relaxation never applies to these. This is part of the §4.2 hard-deny floor.
- 24/7 autonomy must carry explicit revocation, expiry, and spend/rate limits per session; an audit-only Workroom does not relax any of these.

### 14.5 Adapter boundary

- There is **one** adapter shape (an "agent runtime adapter") that translates a workroom turn into a runtime invocation and back. OpenClaw and NemoClaw each ship a thin adapter; the workroom does not learn their internals.
- The adapter is responsible for: signing requests with the agent's API key, mapping the runtime's tool taxonomy onto the GovAI capability registry, and emitting `ToolInvocation` and `EvidenceArtifact` records faithfully.
- The adapter must read the Workroom's `governance_mode` from the run context and refuse to invoke actions that the mode does not permit (defense-in-depth on top of the admission check).

### 14.6 What is forbidden

- No external agent can register a new capability at runtime. Capabilities are admin-managed (existing capability registry).
- No external agent can bypass approval policy.
- No external agent's request reaches an upstream provider without going through GovAI's governed/passthrough surfaces (i.e. no "let the agent use its own API key").
- No external agent runs on a Workroom unless its `AgentProfile` has been added as a participant.
- No external agent may execute class `D`/`E` actions without explicit per-invocation `human_owner` approval, regardless of Workroom mode.

---

## 15. Streaming and UI implications

UI is out of scope for this blueprint. The architecture only states what the UI must reflect, so backend contracts do not box the UI into bad choices.

- Multi-agent messages render in turn order. The UI must show each turn's `actor_participant_id` and `role`. No "anonymous AI" surface.
- Tool invocations are visually distinct from messages. A tool result is never silently merged into a chat bubble.
- Approvals interrupt execution. A pending `ApprovalRequest` blocks the affected turn visually and refuses to allow the affected action to proceed until decided.
- Evidence is a sibling pane, not a hidden tab. File diffs, commits, PR links, and CI runs are visible alongside the transcript.
- Auditor findings appear in the transcript, anchored to the artifact under review, and may carry `blocker` severity that disables downstream actions.
- The UI must never hide what is in the audit chain. A "compact" view may collapse turns, but a "full" view always exists, and the API exposes the full ordered transcript regardless of UI state.
- Streaming output from `/governed/*` is rendered inline in the workroom for the originating run, with the same byte-perfect semantics governed has today.

### 15.1 Governance mode in the UI

- The Workroom's current `governance_mode` is **visible at all times** in the workroom header — there is no "subtle indicator." A user must understand instantly whether GovAI is enforcing or observing.
- **`governance_active` and `audit_only` Workrooms must not look identical.** Distinct visual treatment (color band, icon, header label) communicates the mode without requiring the user to dig.
- Every `governance_mode` transition appears in the timeline/evidence view as a typed event (the `WorkroomPolicyChanged` event from §4.3) with actor, previous mode, new mode, reason, and approval reference.
- `audit_only` Workrooms carry a persistent "Audit-only" indicator in the header and in any summary surface (lists, search results, exported reports). The indicator is non-dismissable.
- When a per-run `runs.mode` differs from the Workroom's default (i.e. `mode_override` or `mode_upgrade` per §6.5), the run row in the UI surfaces that annotation alongside `risk_class` and `status`.
- When the agent proposes a passthrough run inside a `governance_active` Workroom, the resulting `ApprovalRequest` UI must explicitly state that this is a `mode_override` and call out the audit-only semantics the request would entail.
- Streaming output from `/passthrough/*` is rendered inline exactly like `/governed/*`, but the run-row annotation makes the surface choice visible at-a-glance.

---

## 16. Implementation phases

Each phase implements a coherent slice of the target architecture. **No phase introduces fake routes, placeholder behavior, or unaudited paths.** A phase ships only when its acceptance criteria are met end-to-end.

### Phase 0 — Architecture / ADR (this PR)

- Objective: ship this document and link it from #33.
- Files touched: `docs/architecture/workroom-governance-room.md` (this file).
- Acceptance: PR3.2a merged, #33 has a summary comment.
- Tests: none (docs only).
- What must NOT be faked: nothing — there is no runtime yet.

### Phase 1 — Domain skeleton + control plane contracts

- Objective: persist workrooms, participants, policy profiles, and turns; expose `POST /v1/workrooms`, `GET /v1/workrooms/{id}`, `POST /v1/workrooms/{id}/participants`, `DELETE /v1/workrooms/{id}/participants/{participant_id}`.
- Mode awareness: `Workroom.governance_mode` and `WorkroomPolicyProfile.governance_mode` ship in this phase. `POST /v1/workrooms` accepts the mode at creation, defaults to `governance_active`, and rejects `audit_only` if org policy disallows. The `GET /v1/workrooms/{id}` response always returns the current mode.
- Files: new migration `0011_workrooms.sql` (workrooms with `governance_mode`, workroom_participants, agent_profiles, workroom_policy_profiles with `governance_mode` + `default_provider_surface` + `max_risk_without_approval`, workroom_turns); new core-events files (`workroom-lifecycle.ts`, `workroom-participant.ts`, `workroom-policy-changed.ts`); new routes under `apps/api/src/routes/workrooms.ts`.
- Acceptance: a workroom can be created with both modes; participants added/removed; every transition writes the right `workroom.*` event including `governance_mode` in the audit context; RLS enforced; admin tests cover RBAC and the org-level "audit-only disallowed" toggle.
- Tests: new integration `workroom-lifecycle.test.ts`, `workroom-participants-rbac.test.ts`, `workroom-governance-mode.test.ts` (covers create-with-mode, upgrade, downgrade-requires-approval, org-level disallow). No live providers.
- What must NOT be faked: every endpoint returns a real persisted row; no in-memory state; full audit emission from day one; `governance_mode` is real, not stub-defaulted to active.

### Phase 2 — Messages, tasks, and evidence index

- Objective: append-only transcript + evidence index. `POST /v1/workrooms/{id}/messages`, `POST /v1/workrooms/{id}/tasks`, `GET /v1/workrooms/{id}/evidence`, `GET /v1/workrooms/{id}/audit`.
- Mode awareness: every message, task, and evidence row records the Workroom's `governance_mode` in its audit context. The `/audit` and `/evidence` query responses include the mode for forensic filtering.
- Files: migration `0012_workroom_messages_tasks_evidence.sql`; core-events `workroom-message.ts`, `workroom-task.ts`, `workroom-evidence.ts`; routes extended.
- Acceptance: messages and tasks land in `workroom_turns` with correct `turn_number` monotonicity under `pg_advisory_xact_lock`; evidence index is queryable; audit subview returns the right chain anchors **and** the mode annotation.
- Tests: integration tests covering turn ordering under concurrency, evidence query RLS, payload encryption-at-rest, and mode annotation on every artifact emitted in both `governance_active` and `audit_only` Workrooms.
- What must NOT be faked: turn ordering is real (no client-supplied turn numbers); evidence rows are real; encryption happens on the write path, not on retrieval; the mode annotation comes from the parent Workroom, never a default.

### Phase 3 — Workroom-owned runs

- Objective: `POST /v1/workrooms/{id}/runs` and the optional `workroom_id` field on existing `POST /v1/runs`. The run orchestrator threads workroom context.
- Mode awareness: the orchestrator reads the Workroom's `governance_mode` and the `WorkroomPolicyProfile.default_provider_surface` and computes the default `runs.mode` per §6.5. A request that asks for `runs.mode = passthrough` inside a `governance_active` Workroom triggers a `mode_override` approval flow (deferred admission until Phase 4 ships approvals — until then, such requests are rejected at admission). A request for `runs.mode = governed` inside an `audit_only` Workroom is always allowed (`mode_upgrade`).
- Files: migration `0013_runs_workroom_link.sql` (add `workroom_id`, `workroom_task_id`, `created_by_participant_id`, `approval_policy_id`, `workroom_governance_mode` to `govai.runs`); `apps/api/src/pipeline/run-orchestrator.ts` extended to accept and persist the parent edge and the mode snapshot; new turn type `run_event` in workroom transcript.
- Acceptance: a workroom-owned run is created, executes against `/governed/*` or `/passthrough/*` exactly as standalone runs do today, and its lifecycle emits both the existing `run.*` events and the workroom-level `workroom.evidence{run_ref}` event; the audit context includes both `workroom_governance_mode` and `runs.mode` with the correct `mode_match` / `mode_override` / `mode_upgrade` annotation; standalone runs continue to work unchanged.
- Tests: integration `workroom-runs-e2e.test.ts` covering all four cells of the §6.5 matrix against the hermetic provider fixture; regression on `governed-org-tier-lookup-count.test.ts` ensures the new path still issues exactly one `org_tier_lookup` per request.
- What must NOT be faked: the workroom-owned run is the *same* run row; it goes through the *same* orchestrator; it emits the *same* audit events plus the new envelope; mode annotations are computed, not hard-coded.

### Phase 4 — Approvals / HITL enforcement

- Objective: `ApprovalRequest`, `ApprovalDecision`, `WorkroomPolicyProfile` enforcement on the run/tool-invocation admission path.
- Mode awareness: the approval ceiling table from §8.2 is applied as written — `audit_only` reduces friction only for soft-deny territory; the hard floor (§4.2) is invariant. The `mode_override` flow (passthrough request in a `governance_active` Workroom) becomes a typed approval subject. The `WorkroomPolicyChanged` event (mode downgrade) goes through this same approval path.
- Files: migration `0014_workroom_approvals.sql`; core-events `workroom-approval-request.ts`, `workroom-approval-decision.ts`, `workroom-policy-profile.ts`; orchestrator + admission middleware.
- Acceptance: a run/tool invocation requiring approval is blocked until granted; a denied approval is final until a new request is opened; expiry and revocation work; SoD enforced where policy dictates; auditor `blocker` findings prevent state advance; the mode-aware ceiling matrix from §8.2 is enforced in both modes; `mode_override` and `WorkroomPolicyChanged` (downgrade) approvals are tested end-to-end.
- Tests: integration covering the full approval lifecycle including expiry, revocation, multi-approver, SoD, DPO escalation for `pii_strong` findings, mode-aware ceiling for both `governance_active` and `audit_only`, and the mode-downgrade approval flow.
- What must NOT be faked: enforcement runs on the *admission* path, not as a post-hoc check; a missing approval means the action does not happen; the hard floor is enforced for both modes.

### Phase 5 — Agent participants + tool invocations

- Objective: typed `ToolInvocation` admission and execution; `architect_agent` / `auditor_agent` / `executor_agent` participation; `tool_agent` capabilities for in-platform tools (commits, PR creation, CI watch). Sandbox boundaries defined here.
- Mode awareness: agents read the Workroom's `governance_mode` from the run context and emit tool-invocation requests with mode-appropriate approval expectations. The capability registry's risk class still drives admission; the Workroom mode controls the friction below the hard floor.
- Files: migration `0015_workroom_tool_invocations.sql`; capability registry extensions for `git.*`, `gh.*`, `fs.*` (where introduced); sandbox runtime design doc (its own PR before this phase merges).
- Acceptance: a workroom with `architect_agent + auditor_agent + executor_agent + human_owner` can produce a real PR end-to-end with every action audited and every risky step approved, in both `governance_active` and `audit_only` modes (the audit-only run exercises the soft-deny relaxation; the hard-floor actions still require approval).
- Tests: integration with full multi-agent loop against the hermetic stack in both modes; no live external systems in CI (CI runs against fake GitHub adapter — fake at the network boundary, not at the audit boundary).
- What must NOT be faked: tool invocations must be real on the agent side; the GitHub adapter is fake only as a network mock — its emission of `ExternalSystemLink` rows and `EvidenceArtifact`s is real.

### Phase 6 — UI

- Objective: surface the workroom in the GovAI UI: transcript, evidence pane, approvals dialog, auditor findings, run timeline.
- Mode awareness: §15.1 applies. `governance_active` and `audit_only` Workrooms are visually distinct at-a-glance; the mode is in the header at all times; mode transitions appear as typed timeline entries; per-run `mode_override` / `mode_upgrade` annotations appear in the run row.
- Files: separate `apps/ui-*` or equivalent.
- Acceptance: a human owner can drive a complete loop entirely in-product without leaving for GitHub, ChatGPT, or Claude, in either mode, with the mode unmistakably visible.
- What must NOT be faked: the UI binds 1:1 to the API; no fields are invented client-side; no "draft" state lives only in localStorage; the mode indicator is not dismissable in `audit_only`.

### Phase 7 — External autonomous agents

- Objective: adapter for OpenClaw, NemoClaw, and an MCP-host pattern. Browser/system capabilities (class D/E) gated behind tenant opt-in and human approval.
- Mode awareness: §14.4 applies. External agents participate in `audit_only` Workrooms only under the stricter preconditions listed there; the hard floor on class D/E actions is never relaxed by Workroom mode, regardless of tenant settings.
- Files: new adapter packages; capability registry extensions for the new capability families.
- Acceptance: an external agent runtime can participate in a workroom, propose actions, and execute them — all bound by the same approval/audit/evidence rules in-platform agents already follow, in both Workroom modes, with the mode visible in every audit row the adapter emits.
- What must NOT be faked: external action receipts (browser screenshots, OS exit codes) become `EvidenceArtifact`s; nothing the agent does is auditless; the adapter's defense-in-depth mode check is real, not stubbed.

---

## 17. Non-goals (explicit, by phase)

For this CP1 document:

- No runtime implementation.
- No DB migration.
- No new route.
- No UI.
- No OpenClaw/NemoClaw integration.
- No browser/shell/filesystem access.
- No 24/7 autonomous loops.
- No WhatsApp/Telegram connectors.
- No `lookupOperationalMode` reintroduction (PR3.1k stays in force).
- No changes to `/governed/*`, `/passthrough/*`, `/v1/runs`, `/v1/admin/*`, capability registry, KMS, or audit chain semantics.

### 17.1 Audit-only Workroom is NOT

To remove any ambiguity introduced by exposing `audit_only` as a first-class mode, the following are explicitly **not** what audit-only means. Each item is enforced by the hard-deny floor (§4.2) or by the invariants stated in §4.1 / §6.5:

- Audit-only is **not** an "unsafe mode" — the hard floor applies regardless.
- Audit-only is **not** a direct-provider bypass — provider calls still flow through GovAI's `/governed/*` or `/passthrough/*`, and the tenant-scoped credential resolver still owns provider keys.
- Audit-only is **not** a tenant isolation bypass — RLS, `org_id` scoping, and cross-tenant denial remain invariant.
- Audit-only is **not** a secret-handling bypass — no-leak invariants from PR3.1d/h/i/j still apply on every provider invocation.
- Audit-only is **not** an unbounded autonomous-execution mode — class D/E actions (browser, shell, file-system, external integrations) still require explicit `human_owner` approval.
- Audit-only is **not** a bypass for the evidence chain — every artifact still anchors to `audit_events`; no event is implicit.
- Audit-only is **not** a bypass for RBAC — `Role` + `WorkroomParticipantRole` enforcement is unchanged.
- Audit-only is **not** a bypass for cost/rate limits — per-org budgets and per-participant rate limits still apply.
- Audit-only is **not** a replacement for `/passthrough/{provider}/*` — passthrough remains the byte-perfect provider-native compatibility surface; the Workroom mode controls only the **default surface choice** and the **approval ceiling**.
- Audit-only is **not** a replacement for `/governed/{provider}/*` — governed remains the enforcement-active provider-native surface and is always available (even from an `audit_only` Workroom as a stricter execution upgrade per §6.5).
- Audit-only is **not** automatically available to every tenant — org-level admin policy may disable it entirely (regulated tier default).

For Phase 1:

- No tool execution.
- No approval enforcement.
- No agent runtimes.
- No streaming of workroom turns (SSE comes in Phase 5).

For Phase 4:

- No external autonomous agents yet.
- No browser/system capabilities.

For Phase 7:

- No removal of human approval for class D/E actions, ever, regardless of tenant request.

---

## 18. Open questions (to resolve before each phase)

1. **Workroom-scoped quotas.** Do we cap turns per workroom, runs per workroom, or token spend per workroom? Default per Phase 4: token spend cap inherited from org; soft warning at 70%, hard stop at 100%.
2. **Default `auto_approval_ceiling` per tier.** Starter, business, enterprise, regulated — each gets a default profile. The matrix is owned by `WorkroomPolicyProfile` and shipped as seed in Phase 4. **Regulated tier defaults: every class C+ action is human-approved.**
3. **Cross-tenant workrooms.** Out of scope; explicitly denied at the persistence layer. If demand emerges, that's its own ADR with its own threat model.
4. **Workroom forking / templates.** Useful but secondary. Will be considered after Phase 5 once real usage patterns exist.
5. **Replay / rehydration.** Reconstructing a workroom from its audit chain is implicit in the design (every artifact is anchored); a dedicated "replay" API can be added later without schema changes.
6. **Cost attribution per participant.** Phase 1 attributes to the `created_by_user_id`; Phase 5 attributes per `participant_id`. Both are subsets of the existing cost-attribution surface (ADR-012).
7. **Workroom transcript export.** Likely a Phase 6 concern; the underlying data is already exportable via the `/audit` endpoint.

---

## 19. Acceptance criteria for the first implementation PR (Phase 1)

A future PR that opens "Phase 1 — Domain skeleton" is mergeable when **all** of the following are true:

- A migration creates `govai.workrooms`, `govai.workroom_participants`, `govai.agent_profiles`, `govai.workroom_policy_profiles`, `govai.workroom_turns` with the RLS pattern matching existing tables.
- Core-events ships `workroom-lifecycle.ts` and `workroom-participant.ts` (Zod schemas + tests).
- `POST /v1/workrooms`, `GET /v1/workrooms/{id}`, `GET /v1/workrooms`, `POST /v1/workrooms/{id}/participants`, `DELETE /v1/workrooms/{id}/participants/{participant_id}` are implemented end-to-end.
- Every endpoint writes the right `workroom.*` event to the audit chain; chain HMAC and advisory locks remain ADR-009 compliant.
- RBAC + RLS tests cover cross-tenant denial, role narrowing, and human-only operations like `DELETE participant`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test -- --coverage` all green.
- Zero changes to provider packages, governed/passthrough routes, `/v1/runs`, capability registry, KMS, or admin endpoints.
- The PR body links back to this document and to #33.
- A regression test ensures `/v1/runs` and `/governed/*` continue to issue exactly one `govai.org_tier_lookup` per request (carryforward of PR3.1k invariant).

---

## 20. Glossary

- **Workroom** — tenant-scoped, durable coordination container; the unit of multi-agent governed work.
- **WorkroomTurn** — append-only ordered unit within a workroom; every artifact belongs to one.
- **Participant** — human or agent in a workroom; carries a typed role.
- **Run** — existing `govai.runs` row; the execution primitive (ADR-001). May belong to a workroom.
- **Capability** — registered, classifiable action (existing concept; carries over).
- **ApprovalRequest / ApprovalDecision** — typed admission-control artifacts.
- **EvidenceArtifact** — anything that should appear in the workroom's evidence pane and the audit chain.
- **ExternalSystemLink** — reference to an external object (PR, issue, CI run). Reference only; the body lives outside GovAI.
- **AgentProfile** — reusable agent template (provider, model, tool grants, default policy).
- **WorkroomPolicyProfile** — tenant-scoped approval ceiling, allowed surfaces, allowed external integrations.

---

## 21. References

- Issue #33 — the originating request.
- ADR-001 — Run as central unit.
- ADR-003 — Provider-native surfaces.
- ADR-005 — Capability levels and evidence strength.
- ADR-009 — Audit chain defense-in-depth.
- ADR-011 — Right to erasure (crypto-shred).
- ADR-012 — Cost attribution source.
- PR2 (#8) — Native provider substrate.
- PR3.1a (#23) — Tenant-scoped provider credentials.
- PR3.1b (#24) — Admin provider credential endpoints.
- PR3.1d (#32) — Governed live provider validation.
- PR3.1h (#37) — Governed live streaming validation.
- PR3.1i (#39) — Live passthrough validation.
- PR3.1j (#40) — Passthrough streaming header propagation.
- PR3.1k (#41) — Eliminate redundant governed operational mode lookup.
