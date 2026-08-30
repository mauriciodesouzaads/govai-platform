# Native Experience Contract V1

STATUS: `NORMATIVE_CONTRACT_DRAFTED — AWAITING_INDEPENDENT_ARCHITECTURE_REVIEW`
MISSION: EP-PROVIDER-NATIVE-PARITY-V1-NATIVE-EXPERIENCE-CONTRACT-AND-CURRENT-BASELINE-01
SOURCE ANCHOR: main `79bd71407830ef2ef244fba6c53ac57cdebd11a3` (tree `c73d1ff4`)
RESEARCH SNAPSHOT: 2026-08-29 (first-party provider/product/market facts verified on this
date; evidence in the mission's external source ledger and in
`native-experience-parity-v2.md`, which carries the model-ID-level facts so this contract
does not go stale when model IDs change).
PRECEDENCE: `current-state.md` and `foundation-v1-freeze.md` prevail over this contract
wherever they conflict; merged executable source prevails over both. This contract binds
FUTURE movements (P0-D, P0-E, P0-F and later parity waves); it does not claim any runtime
behavior exists unless it cites the source that proves it.
COMPANIONS: `ai-conversation-continuity-v1.md` (the accepted P0 architecture this contract
builds on and must not contradict), `native-experience-parity-v2.md` + its machine manifest
(the current research baseline), `native-experience-parity-v1.md` (historical 2026-08-21
baseline, byte-preserved).

This movement implements NOTHING. It defines the product/architecture laws that model
discovery, the model chooser, provider continuation and the persistent AI workspace MUST
obey when their movements implement them.

---

## 1. Purpose and scope

The design target (owner directive, restated from the V1 baseline §1 and binding here):

> A user can perform serious, continuous AI work inside GovAI with OpenAI, Anthropic,
> Codex and Claude Code experiences that remain recognizably native, while GovAI adds
> organization policy, security, evidence, auditability, identity, retention and control —
> without hiding capability, silently changing provider semantics, or forcing ordinary
> users to operate a compliance console.

In scope: the normative contracts for model discovery, model/surface compatibility,
capability metadata, policy projection, the model chooser, provider-native controls, the
persistent workspace, the Project boundary, agentic (coding-agent) UX, external-provider
exit, degradation vocabulary, performance, and security — plus the explicit obligations
each contract imposes on P0-D, P0-E, P0-F and later waves.

Out of scope: any implementation; any migration; any UI; any change to P0-C semantics
(P0-C is CLOSED — `current-state.md` §P0-C canonical state); Projects implementation;
branch protection (permanently owner-declined, BY_DESIGN / NOT_A_FINDING).

## 2. Definitions

- **Provider** — one of the four durable `ai_conversations.provider` values
  (`openai | anthropic | codex | claude_code`, migration 0031 CHECK, mirrored in
  `apps/api/src/ai-conversations/contracts.ts:78`).
- **Surface** — a provider-native endpoint/harness family a conversation executes against.
  Durably a free-form bounded token (`contracts.ts:113`); the only registry is the
  fail-closed P0-C dispatch registry (`dispatch-registry.ts`), which recognizes
  `anthropic_messages` and `openai_responses` and refuses everything else truthfully.
- **Model ID** — provider-owned vocabulary. A bounded free-form token in GovAI
  (`ModelToken`, `contracts.ts:114`); never an enum, never an input to
  `resolveDispatchPlan()` (`dispatch-registry.ts:91-95`).
- **Discovery** — learning what models a provider account can see, from the provider's own
  metadata endpoints. Distinct from compatibility, capability, policy, entitlement and
  readiness (LAW NX-3).
- **Capability metadata** — per-model facts about what a model supports (modalities,
  tools, controls, limits). Provider-asymmetric by nature (§7).
- **Chooser** — the product surface where a user selects provider/surface/model/controls.
- **Workspace** — the persistent product shell of P0-E: conversations, history, work
  surfaces, approvals, artifacts-to-be.
- **Conversation ≠ Project ≠ Workroom** — per continuity spec §4/§16 and LAW NX-17.
- Parity vocabulary (`NATIVE_PROTOCOL_PARITY`, `NATIVE_CAPABILITY_PARITY`,
  `NATIVE_EXPERIENCE_PARITY`, `PROVIDER_AGENT_NATIVE`, `GOVAI_PRODUCT_EQUIVALENT`,
  `FULLY_AVAILABLE`) is inherited unchanged from `native-experience-parity-v1.md` §2 and
  re-anchored by the V2 baseline.

## 3. Provider-native doctrine (restated, still binding)

ADR-021 doctrine as encoded at the anchor and preserved by every movement since: GovAI
relays provider-native bytes, forwards-and-observes unknown semantics, fails closed only
where an explicit policy demands it, and NEVER translates one provider's semantics into
another's. The wire semantics are the provider's; GovAI's additions are identity, policy,
evidence and truthful degradation. `PROVIDER_EXACTLY_ONCE = NOT_CLAIMED` permanently.

---

## 4. Normative laws (NX series)

Each law states the requirement, the reason, the user-visible consequence, and the
implementation owner where material. These laws bind P0-D/P0-E/P0-F and every later
parity wave. "MUST/NEVER" is normative.

### LAW NX-1 — No lowest common denominator

OpenAI ≠ Anthropic ≠ Codex ≠ Claude Code. GovAI MAY offer one coherent shell; it MUST NOT
pretend provider semantics are identical, and MUST NOT reduce providers to a generic "LLM
form" with one shared control set. *Reason:* the four surfaces have structurally different
state, tool, control and lifecycle models (V2 baseline, all four surface sections; the
continuity spec §11 encodes four different continuation strategies). *Consequence:* users
get real OpenAI/Anthropic/Codex/Claude Code experiences, not a degraded average.
*Owner:* every wave; enforced by review against this contract.

### LAW NX-2 — Model ID is provider-owned

A model ID is external provider vocabulary. A NEW model ID on an already-supported native
surface MUST NOT require a GovAI release. *Source proof at the anchor:* `ModelToken` is
free-form (`contracts.ts`), `resolveDispatchPlan()` takes no model, zero model-ID
allowlists exist repo-wide (adjudicated 2026-08-29), and P0-C's post-merge live exercise
executed models that did not exist when the code was written
(`current-state.md` P0-C §, `MODEL_ID_AGNOSTICISM = PROVEN`). *Consequence:* day-zero
access to new provider models. *Owner:* preserved by all waves — any proposed model
allowlist is a contract violation requiring owner adjudication.

### LAW NX-3 — Discovery ≠ compatibility ≠ policy

Model selection has independent axes that MUST NOT be collapsed into one boolean:

```text
PROVIDER AVAILABILITY   can the active provider account see this model?
SURFACE COMPATIBILITY   is this model known to work on this endpoint/surface?
CAPABILITY SUPPORT      which modalities/tools/controls does it support?
GOVAI POLICY            may this tenant/user use it under GovAI policy?
OPERATIONAL READINESS   credential/region/quota/lifecycle constraints now?
```

*Market adjudication:* Amazon Bedrock's `GetFoundationModelAvailability` returns
agreement/authorization/entitlement/region as four orthogonal axes — the first-party
reference design; Azure and Vertex separate the same concerns (source ledger §5b).
*Consequence:* the chooser can explain exactly WHY a model is unusable instead of hiding
it behind `enabled: false`. *Owner:* P0-E (projection), P0-D (dispatch-time re-checks).

### LAW NX-4 — Unknown ≠ blocked

A compatibility/capability fact is three-valued: `KNOWN_SUPPORTED`, `KNOWN_UNSUPPORTED`,
`UNKNOWN`. `UNKNOWN` MUST NOT be presented or enforced as `BLOCKED_BY_GOVAI` unless a
separate, named security/compliance policy requires fail-closed behavior for that class.
*Reason:* the U1.5 adjudication (`apps/ui/src/features/ai/providers/models.ts:13-18`) is
correct and stands: a GovAI-invented compatibility verdict is an always-stale copy of the
provider's routing rules; the provider's own error is authoritative. *Consequence:* users
can always attempt a model GovAI lacks metadata for, and get the provider's truth.
*Owner:* P0-E chooser semantics (§9 case C); permanent.

### LAW NX-5 — No silent model or surface substitution

GovAI NEVER silently turns model A into model B, Responses into Chat Completions,
Anthropic into OpenAI, native into governed, or governed into passthrough. A substitution
affecting semantics requires explicit user-visible action, or an explicit provider-native
mechanism represented truthfully as the provider's (e.g. Anthropic's beta `fallbacks`
parameter is PROVIDER fallback and must be labeled as such, never presented as GovAI
routing). *Source basis:* dispatch-registry "FAIL CLOSED, NEVER FALL BACK"; continuity
spec §17 (endpoint-family switch is a FORK). *Consequence:* what the user chose is what
ran; receipts stay truthful. *Owner:* all waves; already law in P0-C.

### LAW NX-6 — Capability metadata is provider-specific (no symmetric fiction)

One generic provider model-metadata contract that assumes identical provider fields is
FORBIDDEN. The conceptual components are `ProviderModelDiscoveryAdapter` and
`ProviderCapabilityResolver` — per provider, behind a common GovAI product PROJECTION that
is a VIEW and never erases provider-native distinctions. Authoritative source precedence
per provider:

```text
provider account listing                → availability (both providers)
provider machine capability metadata    → strongest capability source WHERE EXPOSED
provider first-party published catalogue→ versioned metadata source where machine
                                          metadata is absent
(neither)                               → explicit UNKNOWN
```

*2026-08-29 first-party facts:* Anthropic's Models API returns per-model
`max_input_tokens`, `max_tokens` and a structured `capabilities` object (documented in the
API reference; added 2026-03-18) — machine-resolvable capability truth with real per-model
discrimination. OpenAI's Models API returns identity plus a per-model `shutdown_date` and
NO capability descriptor; OpenAI capability truth lives in its published model
documentation. Anthropic lifecycle/retirement, conversely, is docs-sourced (no lifecycle
field in its API). The asymmetry is live-confirmed (mission observations file). No runtime
web scraping of provider documentation — documentation-derived capability data enters
GovAI only as deliberately versioned committed metadata (the V2 baseline pattern).
*Owner:* P0-E defines the resolvers' data contracts; implementation wave TBD by owner.

### LAW NX-7 — The chooser is account-aware

The chooser MUST reflect the credential/account through which execution will actually
occur, not a global static list. *Proof this matters:* the same provider serves different
catalogues to different credentials (gated models absent from one account's listing —
observed live 2026-08-29; Bedrock/Azure/Vertex all separate availability from
entitlement). Model catalogue caches MUST be scoped per credential/account wherever
provider access can differ (§17 security). *Owner:* P0-E.

### LAW NX-8 — The chooser is surface-aware

Specialized model families (realtime, speech, transcription, image, embedding,
coding-agent, and future classes) MUST NOT be flattened into "chat models". A model is
evaluated against the selected experience/surface. *Current anchor truth:* the AI Console
already refuses to invent this knowledge and says LISTED ≠ USABLE — the evolution is to
ADD surface knowledge where sources support it, not to pretend it exists. *Owner:* P0-E.

### LAW NX-9 — Policy transparency (show-then-explain, not hide)

Default enterprise UX: a discoverable-but-policy-blocked model is VISIBLE, DISABLED, with
the REASON shown (tenant policy, user entitlement, provider account access,
region/data-residency, surface incompatibility, lifecycle, approval requirement).
*Market adjudication (evidence-scoped):* Microsoft Foundry is the explicit
show-then-disable UX precedent (the blocked model stays visible in the catalog, deployment
is denied at the action boundary with an error/reason). AWS Bedrock and Google Model
Garden independently demonstrate that model discovery/catalogue and action
eligibility/policy are DISTINCT dimensions (Bedrock's four-axis availability response and
per-model console access states; Vertex org-policy allow/deny at model/action level) —
their exact chooser visibility UX is not claimed beyond what first-party documentation
proves (Vertex console hide-vs-block behavior was recorded UNKNOWN in the source ledger).
GovAI therefore ADOPTS show-then-explain as its own default enterprise UX — it does not
merely copy it. Exception: an explicit, named security policy may require inventory
concealment for a class of models — concealment is then a recorded policy decision, never
a default. *Owner:* P0-E; policy engine wave supplies reasons.

### LAW NX-10 — No silent policy clamp

If a provider-native control is disallowed by GovAI policy, GovAI MUST NOT silently mutate
the request. Either the control is disabled BEFORE execution with the reason shown
(interactive path), or the request receives an explicit policy decision (API path).
*Basis:* M1's evidenced-denies doctrine; the beta-header handler blocks only `hard_denied`
and otherwise forwards-and-observes — it never rewrites. *Owner:* every wave touching
controls.

### LAW NX-11 — Provider-native controls remain native

OpenAI reasoning/effort/verbosity/service-tier controls, Anthropic
thinking/effort/context-management/caching controls, provider-specific tools, caching,
fallbacks — these keep their provider-native names, semantics and wire shapes even when
the UI organizes them coherently. Similar names are NOT the same control (both providers
have "effort"; the values and semantics differ — V2 baseline rows). *Owner:* P0-E control
panels (§10); adapters in P0-D.

### LAW NX-12 — Advanced native escape hatch

The polished chooser MUST NOT remove the existing ability to type a valid provider model
ID that cached discovery does not know (private preview, fine-tune, newly released,
regional/gated). The typed ID is labeled unlisted/custom, policy still applies, and the ID
is NEVER autocorrected, nearest-matched or rewritten. *Source basis:* `ModelPicker.tsx`
free-text semantics — a console that refuses an unlisted ID "would make those models
unreachable through GovAI for no reason of GovAI's own". *Owner:* P0-E preserves it.

### LAW NX-13 — No paid inference for chooser discovery

Populating the chooser MUST NOT spend provider inference tokens. Read-only metadata GETs
are allowed. Compatibility probing that incurs paid generation happens only in an explicit
acceptance/test context (M2-class movements), never as chooser rendering. *Owner:* P0-E;
permanent.

### LAW NX-14 — Lifecycle is a first-class UX fact

Where sourced, GovAI represents: released / preview-beta / deprecated /
retirement-shutdown date / replacement guidance. Lifecycle SOURCES are asymmetric
(NX-6): OpenAI serves machine-readable per-model `shutdown_date`; Anthropic publishes
docs-sourced retirement dates and floors; enterprise platforms stamp dated lifecycle onto
catalogue entries (Azure programmatically at GA). A conversation whose model becomes
unavailable FAILS TRUTHFULLY; GovAI NEVER silently migrates an existing branch to another
model (contrast: ChatGPT auto-mapped product conversations to successor models at the
2026-02-13 retirement — a PRODUCT choice GovAI explicitly rejects for durable branches;
see the no-silent-auto-migration rule in §9 case H). *Owner:* P0-E surfaces it; P0-F formalizes the
evidence of it.

### LAW NX-15 — Provider continuation is adapter-owned

P0-D remains provider-specific per continuity spec §11: OpenAI conversation-objects /
`previous_response_id` chaining / stateless replay (three strategies, preference-ordered,
taint-and-rotation discipline); Anthropic stateless replay with thinking-signature
preservation; Codex thread identity via the app-server stable surface; Claude Code session
identity via the Agent SDK SessionStore. No universal fake `conversation_id` abstraction
may erase these differences. *2026-08-29 reverification:* every continuity-spec §11 provider dependency
still holds (Conversations API GA with no-TTL items vs 30-day stored responses;
`/v1/messages` still stateless; Codex `thread/*` on the stable schema subset; SessionStore
now with reference adapters and a conformance suite). *Owner:* P0-D.

### LAW NX-16 — Cross-provider continuation remains a fork

Unchanged from continuity spec §17: cross-provider continuation = NEW GovAI branch with a
portable projection and DOCUMENTED quality loss (reasoning/thinking state non-portable,
provider tool-state non-transferable, citations degrade, caches reset). The UI labels the
fork; nothing is silent. *Owner:* P0-D mechanics; P0-E labeling.

### LAW NX-17 — Conversation ≠ Project ≠ Workroom

A Conversation is an owner-scoped AI interaction lineage. A Project is a FUTURE persistent
container above conversations (chats + files + instructions + memory policy +
collaborators + policy references). A Workroom is GovAI's existing, separate
governance/collaboration domain. A Workroom is NEVER silently repurposed as a Project.
`project_id uuid NULL` stays reserved (continuity spec §16); nothing more exists. *Owner:*
a future deliberate Project movement; until then the boundary is documentary law.

### LAW NX-18 — The persistent workspace is the product target

P0-E cannot be "today's chat page, but durable". The architecture MUST accommodate (as
slots, not necessarily V1 implementations): conversation/history sidebar,
projects/context, files, instructions, memory policy, tools, citations, thinking/reasoning
summaries where the provider exposes them, artifacts/work products, long-running
activities, approvals, status/progress, branch/fork, retry, stop, resume/reconnect,
receipts/evidence status. §11 assigns each to a wave. *Owner:* P0-E architecture with
explicit extension points.

### LAW NX-19 — Long-running work is not a spinner

Both providers have normalized minutes-to-hours agentic work (OpenAI background mode +
webhooks + ChatGPT Work check-ins; Anthropic Cowork cloud sessions; Managed Agents
sessions; Codex cloud tasks). The product contract reserves UI concepts for at least:
planned, queued, running, waiting_for_approval, waiting_for_user, tool_running,
background, completed, failed, stopped, outcome_unknown. The exact runtime state model
stays movement-specific (P0-C's durable turn machine already carries the honest core:
`outcome_unknown` is a real state, not an error page). *Owner:* P0-E projections; P0-D
supplies the durable truth.

### LAW NX-20 — User steering and approval are first-class

Provider surfaces normalize follow-progress / change-direction / approve / deny / resume
(Codex `turn/steer` + approval RPCs; Claude Code `canUseTool` + hooks + permission modes;
Managed Agents `always_ask` pause-and-confirm; ChatGPT Work check-ins and workspace-agent
approval checkpoints). GovAI's workspace MUST have an architecture slot for
point-of-action approval — governance approvals happen where the action is, not in a
separate bureaucracy screen, wherever possible. *Owner:* P0-E slot; P5/P6 wire the
coding-agent approval RPCs into it; R12/`ask` semantics become real here.

### LAW NX-21 — Artifact/work surface is distinct from chat

Modern UX gives substantial reusable output a dedicated surface (Artifacts, Canvas/Work
documents, diffs). GovAI reserves an artifact/work-product pane boundary WITHOUT
implementing it here, and never pretends every deliverable is an assistant message.
*Owner:* P9 (product-equivalent wave); P0-E leaves the pane slot.

### LAW NX-22 — Governance is ambient

Normal path = native experience + small truthful policy indicators + friction only when
required. Internal forensic mechanics are never mandatory conversational clutter. *Owner:*
P0-E; the Interaction Receipt vocabulary carries over.

### LAW NX-23 — Evidence claims must be provable

Trust indicators (audited / governed / policy decision / evidence available / evidence
pending / external-unmonitored) appear ONLY when backend state proves them. "Evidence
captured" is never claimed from request intent alone — capture is `best_effort` until the
capture/seal row is observed (continuity spec §14 honesty rules). *Owner:* P0-F closes the
correlation triple; P0-E renders only proven states.

### LAW NX-24 — External provider exit is policy-aware

Opening ChatGPT / Claude / Codex / Claude Code products outside GovAI is a policy-visible
act with three architecturally expressible tenant states: `ALLOWED`,
`ALLOWED_WITH_ACKNOWLEDGEMENT`, `DISALLOWED`. The acknowledgement text is truthful: the
external product may be outside GovAI's controlled execution/evidence perimeter. GovAI
does NOT claim it can detect every off-platform use — that capability does not exist and
is a separate concern. *Owner:* P0-E shell (exit links), tenant policy wave.

### LAW NX-25 — Performance is part of parity

GovAI must not turn native usage into a visibly slower enterprise portal without
necessity. Architecture accounts for: discovery cache freshness (§5), stream rendering,
background operations, latency disclosure, long-running progress, minimal governance round
trips, provider-specific caching (prompt caching is a cost/latency optimization, never a
correctness dependency — continuity spec §11). Correctness is never traded for speed;
avoidable governance latency is never added either. *Owner:* every wave; P0-E budgets.

### LAW NX-26 — Cost/latency/quality metadata must be honest

A future chooser may expose recommended use, relative speed, cost class, context, quality
category, modalities, tools — ONLY from sourced/current metadata carrying source +
effective/retrieved date. No stale numeric pricing without provenance; no invented
universal "best model" score; no political/commercial provider ranking. Provider facts +
GovAI/tenant recommendations with provenance only. *Market adjudication:* Azure's
leaderboards publish measured (not estimated) cost with documented caveats and push
"evaluate on your own data" — the honesty bar GovAI matches or exceeds. *Owner:* P0-E and
the catalogue wave.

---

## 5. Model discovery contract

**Current status (source-adjudicated at the anchor, 2026-08-29):**

```text
NATIVE_PROVIDER_MODEL_DISCOVERY      = PARTIAL
ACCOUNT_AWARE_PROVIDER_LISTING_UI    = IMPLEMENTED_IN_LEGACY_AI_CONSOLE
CAPABILITY_AWARE_CATALOGUE           = NOT_IMPLEMENTED
POLICY_AWARE_MODEL_CHOOSER           = NOT_IMPLEMENTED
USER_MODEL_CHOOSER                   = PARTIAL
```

What exists and is NOT to be dismissed as "not implemented": the AI Console performs live
account-scoped discovery through GovAI's audited native route
(`GET /passthrough/{openai,anthropic}/v1/models`; `apps/ui/src/features/ai/providers/models.ts`),
walks Anthropic pagination honestly (limit 1000, bounded page walk), ships NO hardcoded
production model list, treats the listing as suggestions, preserves free text verbatim,
and reports discovery failure as a specific fact (credential vs auth vs rate-limit vs
unavailable — `ModelPicker.tsx:34-42`). There is no server-side cache; the only cache is
the UI's 5-minute React Query staleTime.

**Normative evolution (P0-E and later):**

1. Discovery adapters per provider (NX-6) feed a GovAI catalogue PROJECTION; the
   projection records, per entry, its discovery source and refresh timestamps.
2. Caching, when added, is credential/account-scoped (NX-7), staleness-labeled (§9 case
   I), and never presented as current when it is not.
3. Discovery stays read-only and unpaid (NX-13).
4. The free-text escape hatch survives every polish pass (NX-12).
5. The U1.5 "LISTED ≠ USABLE" hint evolves into three-valued compatibility knowledge
   (NX-4) — never into a GovAI-invented boolean.

## 6. Model/surface compatibility contract

Compatibility is a per-(model, surface) fact with values KNOWN_SUPPORTED /
KNOWN_UNSUPPORTED / UNKNOWN, each carrying a source (provider machine metadata, versioned
committed catalogue metadata, or provider runtime error observed). Rules:

- The provider's runtime error remains authoritative over any GovAI cache (U1.5
  adjudication, preserved).
- Surface-first and model-first mental models are BOTH supported by the data contract:
  surface → the models known-compatible/unknown for it; model → the surfaces
  known-compatible/unknown for it. A UI may lead with one flow; the contract preserves
  both relationships; no hidden automatic surface switch ever (NX-5).
- Specialized families (realtime, speech, image, embedding, coding-agent) are distinct
  surface classes from day one of the catalogue (NX-8); their absence from a conversation
  chooser is surface-filtering, not concealment (§9 case B semantics).
- Compatibility UNKNOWN + policy ALLOWED ⇒ attemptable with "compatibility unverified"
  semantics (NX-4).

## 7. Capability metadata contract

Per provider, the resolver precedence of LAW NX-6, with these 2026-08-29 anchor facts:

- **Anthropic:** machine metadata IS exposed — the Models API's `capabilities` object
  (batch, citations, code_execution, context_management with dated sub-strategies, effort
  tiers, image/pdf input, structured_outputs, thinking types) plus `max_input_tokens` /
  `max_tokens`. This is the strongest runtime capability source and discriminates per
  model. Lifecycle is NOT in the API — retirement dates are docs-sourced.
- **OpenAI:** the Models API is availability + lifecycle (`shutdown_date`) only; there is
  no machine capability descriptor. Capability truth lives in the published model
  catalogue/documentation and enters GovAI only as versioned committed metadata (the V2
  baseline pattern), refreshed by deliberate research movements — never scraped at
  runtime.
- **Codex / Claude Code:** capability truth is harness-versioned (per-build app-server
  schema generation; Agent SDK version). The pinned build/SDK IS the metadata source; a
  deployment pin change is a capability-metadata change.

The GovAI projection carries `capability_source` per fact (the V2 machine manifest encodes
exactly this field per capability row), so a UI can say "provider-reported" vs
"documented as of DATE" vs "unknown" — and so an auditor can trace every chooser claim.

## 8. Policy projection contract

Policy is a projection LAYERED OVER discovery/compatibility — it never rewrites them
(NX-3, NX-9). Expressible states per (tenant, user, model/surface/control):

```text
ALLOWED
POLICY_BLOCKED          + machine-readable reason + human-readable explanation
APPROVAL_REQUIRED       policy turns the action into an approval workflow, not a false
FROZEN_TO_EXISTING_USE  no new adoption; existing conversations/branches keep working
                        (the market-normalized "deprecated/legacy" gate — Azure scopes it
                        to subscriptions, Bedrock to accounts; GovAI scopes it to tenants)
```

Rules: tenant availability and individual user entitlement are SEPARATE concepts; policy
reasons distinguish who/what caused the block and whether approval can change it (§15's
explanation rule); legal/attestation gates (EULA-class, use-case attestation) are their own
workflow states, not booleans; policy applies equally to the escape-hatch path (NX-12);
concealment is an explicit exception policy (NX-9). The two-disjoint-registry finding (V1
baseline finding F) must be adjudicated to a single source of truth BEFORE any
policy-aware chooser ships — a chooser reading two unreconciled registries would show two
truths. Owner: the movement that implements the policy projection (P0-E dependency,
flagged as its prerequisite).

## 9. Model chooser product projection and required semantics

**Conceptual projection** (information categories are normative; exact field names are
implementation-adjudicated):

```text
provider · model_id · display_name
availability_state + availability_source
surface_compatibility_state + compatibility_source
capabilities + capability_source
lifecycle_state + shutdown_or_retirement_date
policy_state + policy_reason + approval_requirement
region/data_residency constraints where applicable
context size where known · max output where known
reasoning/thinking controls · modalities · tool families
last_provider_refresh · last_capability_refresh
is_unlisted_manual_entry
```

**Required chooser semantics (all ten cases normative):**

- **A. Listed + compatible + allowed** → normal selectable model.
- **B. Listed + known-incompatible with selected surface** → visible but disabled for
  that surface, reason shown.
- **C. Listed + compatibility unknown + policy allows** → visible, selectable, with
  "compatibility unverified" semantics; never labeled blocked merely because GovAI lacks
  metadata (NX-4).
- **D. Listed + policy blocked** → visible/disabled with policy reason by default (NX-9).
- **E. Provider account does not expose the model** → not represented as
  account-available (it may appear as documented-but-not-entitled only where a sourced
  catalogue entry exists and policy chooses to show it).
- **F. Manually entered unlisted ID** → labeled unlisted/custom; preserved verbatim;
  policy applies; never silently replaced (NX-12).
- **G. Deprecated / shutdown approaching** → visible lifecycle warning with the sourced
  date; no silent migration (NX-14).
- **H. Selected model disappears between sessions** → the conversation remains
  historically truthful; new dispatch reports unavailability; the user chooses an explicit
  continuation/fork strategy. NO SILENT AUTO-MIGRATION OF AN EXISTING BRANCH TO A
  DIFFERENT MODEL — a new conversation may use a tenant/provider default; an existing
  branch carries its durable selected identity (LAW NX-14's no-silent-migration rule,
  restated here as chooser behavior).
- **I. Provider discovery unavailable** → previously known state may be shown AS STALE
  with its refresh timestamp; the user is told discovery is unavailable; cache is never
  presented as current.
- **J. Provider credential rejected** → the credential/provider problem is explained
  (the AI Console's `authScope: 'provider-native'` rule generalizes: a provider 401 NEVER
  ends the GovAI human session).

Defaults and last-selection: a tenant may set a recommended/default model (the enterprise
pattern: org default + auto-updating "recommended" pointer + per-role hiding); the user's
last-used selection may prefill NEW conversations; provider aliases are provider facts and
are shown as such; none of this ever rewrites an existing branch's durable triple.

## 10. Provider-native control contract

Control hierarchy (future UI):

```text
COMMON SHELL       provider · surface/experience · model · mode · attachments
PROVIDER-NATIVE    OpenAI section · Anthropic section · Codex section · Claude Code section
ADVANCED           native/raw controls where safe
```

The common shell is ergonomics, NOT permission to normalize wire semantics (NX-1, NX-11).
Control display rules: hide when definitely unsupported (provider machine metadata or
versioned catalogue says KNOWN_UNSUPPORTED); disable-with-reason when policy-blocked
(NX-10); show "unknown/unverified" when support is unverified (NX-4). Provider error
remains authoritative when an unverified control is attempted. Examples that MUST remain
independent (2026-08-29 sourced): OpenAI `reasoning`/service tiers/`prompt_cache_key` vs
Anthropic `output_config.effort`/thinking configs/`cache_control` — same-sounding names,
different semantics, values and billing; Anthropic thinking `display` modes and signatures
have no OpenAI equivalent; OpenAI `store`/`background`/`conversation` have no Anthropic
Messages equivalent.

## 11. Persistent workspace contract — market bar and wave assignment

The market bar (first-party product research, 2026-08-29) and the owning movement for
each requirement:

| Requirement (normalized by ChatGPT/Claude/Codex/Claude Code products) | Owner |
|---|---|
| Persistent conversations, reload/resume, durable send | P0-C (DONE, API level) + P0-E (UI) |
| History sidebar, open/rename/archive, deep links | P0-E |
| Search over own conversations (title-first, honest scope) | P0-E (per continuity §18) |
| Branch/fork UX (incl. cross-provider fork labeling) | P0-E (mechanics P0-B/P0-D) |
| Retry / stop / reattach-to-live-stream | P0-E (durable arms exist in P0-C; public Stop terminalization ships with its endpoint) |
| Turn↔evidence correlation surfaced truthfully | P0-F (triple; enables the proven state), P0-E (rendering infrastructure only) |
| Files/attachments on turns | P1 |
| Search/citations/hosted-tool rendering | P2 |
| MCP/connector approvals (`ask` becomes real) | P3 |
| Projects (container, files, instructions, memory policy, collaborators) | P4 (post-R14 for sharing) |
| Codex first-class workspace (threads, approvals, steering, diffs) | P5 |
| Claude Code first-class workspace (sessions, permissions, checkpoints) | P6 |
| Computer-use/browser-use class (needs taxonomy+beta refresh — finding T) | P7 |
| Realtime/voice/media (needs WebSocket/WebRTC transport class) | P8 |
| Artifacts/work-product pane, scheduled/long-running work surfaces, deliverable generation | P9 |
| Memory-equivalent (user/project memory with inspectable entries) | P4/P9 (market: memory is now inspectable, editable, scoped — the bar GovAI must meet natively, with evidence discipline) |
| Cross-device resume | P0-E (same-key), R14 for real multi-user/multi-device |
| Sharing/collaboration (shared projects, shared links with snapshot semantics) | post-R14 wave |
| Steering/approval mid-run | P0-E slot + P3/P5/P6 |
| External-provider exit links with ack policy | P0-E shell (NX-24) |

Not everything belongs to P0-E V1 — the table IS the anti-scope-creep instrument: P0-E
implements the P0-E rows and leaves labeled extension slots for the rest.

**Forward-capability gating rule (normative, preserves the P0-D → P0-E → P0-F order):**
UI slots may PRECEDE a later backend capability, but an affordance or claim may be
ENABLED only when the required backend capability is proven. Concretely: P0-E builds the
lifecycle affordance shell (archive may be enabled where its backend already exists), but
an ENABLED Delete action MUST NOT ship until P0-F's delete/retention/fencing/
provider-cleanup protocol (continuity spec §19) is implemented and backend-proven — until
then the product either omits the action or shows an explicitly unavailable/coming-later
state, and never pretends deletion is operational. The same rule governs evidence: P0-E
may build the correlation-rendering infrastructure, but the exact turn↔evidence
correlation state is enabled only after P0-F proves the triple.

## 12. Project boundary (future only)

Reconciliation of continuity §16 with 2026 market reality: both providers now ship
Projects as persistent containers (files + instructions + scoped memory + sharing;
ChatGPT adds project-only-memory isolation and shared projects; Claude adds RAG-over-
knowledge and project memory spaces). GovAI's future Project must be architecturally
capable of: project chats, files, instructions, memory policy, collaborators,
project-level tool/app policy, and project-level governance/evidence policy references.
`PROJECT IMPLEMENTATION = NOT AUTHORIZED HERE`; `PROJECT != WORKROOM` stands (NX-17);
sharing is R14-gated. The one durable reservation remains `project_id uuid NULL`.

## 13. Agentic UX contract

Codex, Claude Code and Managed Agents are THREE distinct surfaces; no merged `agent`
abstraction may erase their native lifecycles (a common GovAI activity UI may PROJECT them
coherently later; adapters stay provider-native). 2026-08-29 reverified anchors:

- **Codex** — embedding surface is the app-server JSON-RPC protocol; upstream's own words
  still mark the app-server command and WebSocket transport "experimental and aren't
  supported for production workloads"; stable schema subset gated via
  `capabilities.experimentalApi`; NO wire version (per-build schema generation).
  Consequences remain law for P5: pin the Codex build per deployment (current stable
  0.151.0 at snapshot — the pin is deployment config, not contract text), regenerate the
  schema per pin, consume the stable surface only, treat plugins ("don't call from
  production clients yet") and `experimental`-marked methods as unavailable. Approvals
  (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, and the
  NEWER `item/permissions/requestApproval` — to be re-adjudicated at P5's pin) and
  `turn/steer` are the governance/steering hooks. Cloud tasks still have no public HTTP
  API (a CLI scripting surface appeared; its transport is unverified) —
  PROVIDER_NOT_EXPOSED stands for cloud-task embedding.
- **Claude Code** — embedding surface is the Claude Agent SDK (TS+Python; explicitly a
  separate product from Managed Agents, per first-party docs). Sessions are client-side
  JSONL with a documented pluggable `SessionStore` (now with reference adapters and a
  conformance suite) — the sanctioned hook for GovAI-owned encrypted session persistence.
  `canUseTool` + hooks + permission modes are the governance hooks; programmatic
  checkpoint/rewind is now documented (was UNKNOWN at V1 — P6 gains a rewind surface).
  Session JSONL format is explicitly internal/version-unstable — GovAI consumes only the
  documented SDK surfaces, never the raw files.
- **Managed Agents** — a DISTINCT beta server-hosted surface (Anthropic runs harness +
  sandbox; sessions/environments/memory stores/permission policies; beta headers
  `managed-agents-2026-04-01` / `agent-memory-2026-07-22`). It is NOT Claude Code and NOT
  the Agent SDK; any future GovAI use is its own movement with its own adjudication.

Approval/steering/permission semantics from all three surfaces flow into the SAME GovAI
point-of-action approval slot (NX-20) without flattening their native vocabularies.

## 14. External-provider exit contract

Per LAW NX-24: tenant policy states ALLOWED / ALLOWED_WITH_ACKNOWLEDGEMENT / DISALLOWED
for opening each external provider product. Acknowledgement copy states truthfully that
work done there may be outside GovAI's execution/evidence perimeter; GovAI records the
acknowledgement event (evidence of the CHOICE, not surveillance of the external use); no
off-platform detection is claimed.

## 15. Truth and degradation vocabulary

The user-facing vocabulary distinguishes AT MINIMUM (concept-level; exact strings are
product copy):

```text
AVAILABLE · UNAVAILABLE_BY_PROVIDER
SUPPORTED · UNSUPPORTED · COMPATIBILITY_UNKNOWN
ALLOWED · POLICY_BLOCKED · APPROVAL_REQUIRED · FROZEN_TO_EXISTING_USE
DEPRECATED · RETIRING (with date + replacement guidance where sourced)
DISCOVERY_STALE · DISCOVERY_UNAVAILABLE
CAPABILITY_PARTIAL · GOVAI_NOT_IMPLEMENTED
EXTERNAL_ONLY · PRODUCT_EQUIVALENT_REQUIRED · PROVIDER_NOT_EXPOSED
```

HTTP errors are never the only product explanation; every degraded state maps to a
human-readable fact with optional technical expansion (the explanation rule: WHAT is unavailable,
WHY, WHO/WHAT policy caused it, whether approval can change it, what allowed alternative
exists).

## 16. Performance and latency principles

Per LAW NX-25. Concretely for the coming waves: chooser rendering reads projections, never
blocks on live provider round-trips it can label as background refresh; streams render
incrementally with server-owned durability never gating first-token display beyond the
durable-acceptance boundary P0-C already defines; governance decisions ride the existing
single-pass pipeline (no second policy round-trip per turn); provider-side caching
features are surfaced as provider cost/latency facts (NX-26), never as GovAI correctness
dependencies; long-running work reports progress states (NX-19) instead of holding
connections open as the only truth channel.

## 17. Security and privacy rules

The contract preserves, and every wave inherits:

- No provider credential material in browser-visible model metadata; no secret in any URL;
  no raw credential provenance in user projections (P0-B projection law).
- No cross-tenant model-availability leakage: catalogue caches are credential/account
  scoped (NX-7); a tenant's gated-model visibility is never inferable by another tenant.
- No cross-user conversation leakage: owner-scoped RLS continues; conversation reads stay
  `cache-control: no-store` (AUTH-READ-CACHE-01 class must not grow).
- No provider-docs scraping in any request path (NX-6); no automatic paid probes (NX-13).
- No off-platform monitoring claims that do not exist (NX-24).
- No provider-PRIVATE model identifiers in public docs merely because one test account saw
  them: account observations stay in bounded evidence files (the mission's observations
  artifact demonstrates the pattern).
- Chooser metadata is data, never instructions: model display names and provider-served
  strings are rendered inert.

## 18. P0-D obligations (provider continuation)

P0-D consumes this contract and MUST deliver, per continuity spec §11 and the laws above:

1. `ProviderConversationAdapter` implementations for the P0-C surfaces first (Anthropic
   stateless replay with thinking-signature rules; OpenAI strategy set with
   conversation-object/chaining/stateless preference order, taint discipline, and
   credential-anchor reconciliation) — semantics unchanged from the accepted spec.
2. Server-assembled durable branch context (`R1_DURABLE_CONTEXT_P1` remedy) — the adapter,
   not the client, owns context assembly.
3. Codex/Claude Code continuation ARCHITECTURE anchored to thread/session identity
   (implementation may land in P5/P6; P0-D fixes the identity model so `codex` /
   `claude_code` conversations created today remain continuable then).
4. Dispatch-time re-checks of availability/lifecycle facts (LAW NX-3's operational
   readiness axis) with truthful §9-case-H failures.
5. NO model gating added anywhere (NX-2); NO silent substitution (NX-5); provider
   fallbacks only as explicitly represented provider features.
6. `BOUNDARY_CAUSAL_VERSION_SNAPSHOT` re-examination (P0-C carry-forward) inside the
   server-assembled-context design.

## 19. P0-E obligations (persistent AI workspace)

P0-E consumes P0-D + this contract and MUST deliver:

1. The workspace shell of §11's P0-E rows (sidebar, history, deep links, rename, archive,
   the delete-with-truth AFFORDANCE SHELL — an enabled Delete ships only after P0-F proves
   the continuity-spec §19 protocol, per §11's forward-capability gating rule — fork UX,
   retry/stop, reattach, empty/loading/error states, keyboard accessibility — continuity
   §15 verbatim).
2. The model chooser per §9 (all ten cases) over the §5 discovery contract and §7
   capability projection, with the §8 policy projection where policy exists — and the
   free-text escape hatch (NX-12) intact.
3. Provider-native control panels per §10.
4. Approval/steering slot per NX-20; artifact pane boundary per NX-21 (slot only).
5. Ambient governance + provable trust indicators (NX-22/NX-23) using only backend-proven
   states.
6. External exit links per §14.
7. Registry-unification prerequisite: adjudicate V1 finding F (two disjoint capability
   registries) before the chooser reads capability/policy data.
8. Performance budgets per §16; security rules per §17; browser storage prohibition
   (continuity §6) unchanged.

## 20. P0-F obligations (lifecycle/evidence closeout)

1. Exact turn↔evidence correlation triple materialized and surfaced (continuity §14;
   `exact_turn_evidence_correlation` flips only on proof).
2. Continuity spec §19 delete/retention truth table implemented end-to-end (fencing protocol, provider-side
   cleanup with recorded outcomes, crypto-shred eligibility, `DELETE_ROOT_LOCK_DISCIPLINE`
   pin honored). P0-F OWNS this protocol; once proven, P0-F activates/closes the Delete
   experience whose affordance shell P0-E reserved (§11's forward-capability gating rule).
3. `STREAM_OUTCOME_FENCED_EXIT_VOCABULARY` formalized as evidence vocabulary.
4. Lifecycle evidence: model-retirement-driven failures (§9 case H) leave truthful durable
   records.
5. Receipt vocabulary finalized so P0-E's indicators are contractually backed.

## 21. Later-wave obligations

P1–P9 inherit the laws wholesale; specific bindings recorded now: P3 makes `ask` real
(finding E / R12); P5/P6 implement the agentic contract of §13 against THEIR OWN pinned
builds/SDKs (re-verify stability wording at pin time); P7 is blocked by finding T
(tool-taxonomy + beta-policy refresh — both pinned snapshots predate the providers' 2026
GA movements, and OpenAI's current computer-use tool type no longer matches the pinned
classifier shapes; the refresh is a P7 precondition, not a P0-E one); P8 requires the
WebSocket/WebRTC transport class (OpenAI realtime GA is WebRTC/WebSocket/SIP with
ephemeral client secrets — a new transport architecture, not a route registration); P9
builds product-equivalents (artifacts, scheduled work, deliverable generation, memory)
GovAI-native with evidence linkage.

## 22. Acceptance laws (for this contract's consumers)

1. A movement claiming conformance cites the specific law(s) and shows the proof class
   (test, live acceptance, browser acceptance) per axis — the V2 manifest's two-axis
   discipline applies to every new claim.
2. No movement may weaken a law silently; a deliberate change is an explicit owner-
   adjudicated contract revision (V2 of this document), never a drive-by edit.
3. The forbidden-claims list of the V1 baseline §11 remains in force verbatim (no "same as
   ChatGPT/Claude" without a defined axis, no "full provider parity", no implementation
   claims for specified-only architecture).
4. Mission end state of the movement that authored this contract:

```text
NATIVE_EXPERIENCE_CONTRACT           = DRAFTED + SOURCE-ADJUDICATED
CURRENT_PARITY_BASELINE_V2           = CREATED + VALIDATED
V1_BASELINE                          = BYTE-PRESERVED
RUNTIME_CHANGES                      = NONE
P0-C                                 = CLOSED (untouched)
P0-D / P0-E / P0-F                   = NOT_STARTED
MERGE                                = NOT PERFORMED (independent review required)
```

END OF CONTRACT.
