# Native Experience Parity V1 — Baseline

STATUS: `BASELINE_COMPLETE — TARGET_NOT_IMPLEMENTED`
MISSION: EP-PROVIDER-NATIVE-PARITY-V1-BASELINE-01
SOURCE ANCHOR: main `55eae8835c7fb3b4cad35d3f470a1163fc5eb356` (tree `5742151e`)
RESEARCH SNAPSHOT: 2026-08-21 (all provider facts verified against first-party sources on this date)
MACHINE ARTIFACT: `docs/architecture/generated/native-experience-parity-v1.json` (248 rows) —
validated by `pnpm docs:parity:check` and by the unit lane
(`scripts/native-experience-parity-manifest.test.ts`); canonicalized by `pnpm docs:parity:format`.
PRECEDENCE: `current-state.md` and `foundation-v1-freeze.md` prevail over this baseline wherever
they conflict. `specs/h1v2-coverage-map.md` remains the authoritative hermetic-coverage map; this
baseline preserves its hermetic-vs-live-acceptance separation and never restates one as the other.
COMPANION SPEC: `docs/architecture/ai-conversation-continuity-v1.md` (the P0 architecture this
baseline gates on).

This movement implements NO provider capability and NO conversation runtime. It establishes what
exists, what official provider surfaces exist as of the snapshot, the distance between the two,
and the dependency-ordered plan to close it.

---

## 1. Owner directive (normative product goal)

GovAI must aim to become the user's PRIMARY interface for OpenAI and Anthropic API-backed
experiences and for the Codex and Claude Code coding agents — adding governance, evidence, audit,
organizational controls, approvals, observability, identity and retention, while preserving
provider-native semantics. GovAI MUST NOT normalize providers down to a lowest-common-denominator
chat protocol (ADR-021 doctrine, restated as the parity axiom). The goal is not "GovAI can send
prompts to multiple providers"; the goal is "the user can live in GovAI."

## 2. Parity vocabulary (normative definitions)

- **NATIVE_PROTOCOL_PARITY** — a provider (method, path) pair relayed with byte-level fidelity per
  the H1 v2 contract (`specs/provider-native-compatibility-harness.md`): original request bytes,
  truthful response/stream relay, header policy, `native_request_hash == sha256(original)`.
  Evidence: the hermetic fidelity suites.
- **NATIVE_CAPABILITY_PARITY** — a provider capability reachable through GovAI with native
  semantics preserved: registered in a capability registry, routed, and PROVEN on the axes the
  manifest records. An endpoint being registered is NOT capability parity by itself
  (roadmap doctrine, `development-roadmap.md:289-300`).
- **NATIVE_EXPERIENCE_PARITY** — the product-level state where a user does not need to leave
  GovAI: capability parity PLUS conversation continuity, files, history, resume and the UX
  contract of `ai-conversation-continuity-v1.md` §15. This is the TARGET; it is NOT claimed.
- **PROVIDER_AGENT_NATIVE** — a coding-agent surface (Codex, Claude Code) embedded through its
  officially supported structured harness — the Codex app-server/SDK family, the Claude Agent
  SDK — never terminal/TUI scraping (ADR-031 + roadmap doctrine).
- **GOVAI_PRODUCT_EQUIVALENT** — a provider PRODUCT experience (ChatGPT/Claude/Codex/Claude Code
  app features) that GovAI must reproduce itself. Product-only features are never labeled
  provider-API-native; the manifest enforces this mechanically (PRODUCT_ONLY masquerade rules).
- **FULLY_AVAILABLE** — the per-capability bar, encoded as classification `FULL`:
  provider exposed + GovAI registered + native route + native hermetic test + native live
  acceptance + (where governance applies) governed route + governed hermetic + governed live +
  UI exposed + UI tested + UI browser acceptance + evidence path proven.
  Source adjudication of "does every capability require every axis": NO — the governed axes apply
  only where a governed surface is semantically applicable (`governed_applicable`, e.g. model
  discovery has none), and continuity axes (persistence/resume/fork, exact turn↔evidence
  correlation) are tracked as separate fields, not folded into FULL — they are conversation-level
  properties, gated by the continuity mission. The validator enforces `FULL ⇒ axes` mechanically.

Classification vocabulary: `FULL | PARTIAL | MISSING | PRODUCT_ONLY | PROVIDER_NOT_EXPOSED |
BLOCKED_BY_GOVAI | NOT_APPLICABLE`. Official-status vocabulary: `GA | BETA | EXPERIMENTAL |
DEPRECATED | PRODUCT_ONLY | UNKNOWN`. Snapshot semantics: one deliberate versioned
`research_snapshot_date`; every row's `verified_at` equals it (validated); regeneration is a NEW
baseline decision, not a build step — there are NO nondeterministic timestamps in the artifact.

## 3. GovAI's proven surface at the anchor (source-adjudicated)

- **Native (passthrough) surface**: two wildcard registrations
  (`/passthrough/openai/*`, `/passthrough/anthropic/*`) whose effective surface is exactly the
  registries' `endpoint_coverage` — **27 (method, path) pairs** (18 OpenAI: responses,
  chat/completions, models×3, embeddings, files×5, vector_stores×7; 9 Anthropic: messages,
  count_tokens, models×2, files×5). Anything else is a truthful 404/405.
- **Governed surface**: **3 POST routes** (`/governed/openai/v1/responses`,
  `/governed/openai/v1/chat/completions`, `/governed/anthropic/v1/messages`).
- **"Six-route integration"** = the 6 (mode × provider-endpoint) conversational lanes the AI
  Console uses — pinned by UI tests — not six Fastify registrations (5 registrations; 30
  provider-facing pairs total).
- **Two disjoint registries exist** (finding F below): the HTTP-exposed `/v1/capabilities`
  registry (8 capabilities, numeric facet levels, NO `policy_governed` level — the level strings
  live only in the route-internal registries) and the provider-package registries (19 capability
  entries with canonical levels/risk). Only 6 ids overlap; no invariant reconciles them.
- **Live-accepted at the runtime anchor** (M2/M2A + U1.5, per `foundation-v1-freeze.md:81-120`
  and `current-state.md:116`): the 6 conversational lanes (both providers, stream + non-stream),
  model listing (`?limit=1` verbatim), OpenAI files list-query, computer-use pre-provider block
  (4/4 surfaces), unknown/hard-denied beta handling, Anthropic request-id capture 3/3, coding
  agents via base-URL mode (Claude Code 2.1.233, Codex CLI 0.140.0-alpha.2, API-key mode only),
  and the AI Console browser acceptance (executed against real Anthropic).
- **Registered but unproven**: OpenAI embeddings, vector stores (7 pairs), model delete
  (registry/405 coverage only, no live record); Anthropic files (no multipart route-level test —
  residual R10); count_tokens (no live record).
- **Evidence**: all four direct routes capture v4 `passthrough.invoked` events — hash-only, no
  payloads, no headers; `exact_turn_evidence_correlation` is FALSE everywhere (open residual,
  target architecture in the continuity spec §14).
- **Conversation persistence**: NONE (memory-only by construction; proof in continuity spec §2).

The exact per-row truth lives in the machine manifest; this section is its narrative summary.

## 4. The four surface baselines (summary of the manifest)

Row counts at this snapshot: OPENAI_API 64 · ANTHROPIC_API 59 · CODEX 38 · CLAUDE_CODE 28 ·
product surfaces 59 (CHATGPT_APP 24, CLAUDE_APP 16, CODEX_APP 7, CLAUDE_CODE_APP 12).
Classification totals: FULL 3 · PARTIAL 85 · MISSING 88 · BLOCKED_BY_GOVAI 2 ·
PROVIDER_NOT_EXPOSED 2 · NOT_APPLICABLE 9 · PRODUCT_ONLY 59.

### 4.1 OPENAI_API — `OPENAI_BASELINE=COMPLETE`

The routed core (Responses, Chat Completions, models, embeddings, files, vector stores) is
PARTIAL-to-proven; the conversational lanes lack only UI browser live acceptance (executed on the
Anthropic lane only). The material 2026 provider movements a parity implementation must absorb:
Conversations API + response storage/background/streaming-resumption (ALL unrouted — the direct
dependency of continuity §11), server-side compaction, WebSocket transport mode (transport class
unsupported), the expanded tool surface (tool_search+namespaces, programmatic tool calling,
hosted shell+containers, apply_patch, Skills via /v1/skills, grammar custom tools, multi-agent
beta), audio/realtime/images families (unrouted), webhooks (no GovAI receive/relay architecture),
and the deprecation cliffs: **Assistants API sunsets 2026-08-26** (moot — GovAI never routed it),
**Videos/Sora API shuts down 2026-09-24** (NOT_APPLICABLE — not a durable target), fine-tuning
self-serve wind-down, DALL·E removed. Flagship families at snapshot: GPT-5.6 Sol/Terra/Luna.

### 4.2 ANTHROPIC_API — `ANTHROPIC_BASELINE=COMPLETE`

The only FULL rows of the baseline live here: `messages-create`, `messages-stream`, `models` (the LIST — retrieval-by-id is a separate PARTIAL row, its proofs being registry/route coverage only).
`/v1/messages` remains STATELESS as of the snapshot (fact row; the stateless-replay continuation
strategy in continuity §11 rests on it; the only server-stored session state on the platform is
beta Managed Agents). Body-level features (thinking + signatures, effort, structured outputs GA,
citations, prompt caching incl. automatic, 1M context, mid-conversation system messages) ride the
routed lanes verbatim (INV-008); beta-gated features (compaction, context editing, MCP connector,
advisor, fallbacks, task budgets, fast mode) are outside the pinned beta-policy snapshot and
forward-and-observe as unknown tokens (M1 OD-1=A) — policy snapshot staleness is residual R6 and
now material (see finding T). Unrouted families: message batches, Skills API (GA 2026-08-19),
admin/usage/cost/rate-limit/compliance APIs, MCP tunnels, Managed Agents. Files API went GA
2026-08-19 (header-optional upstream; the registry still models the beta dependency — staleness).
Model lineup at snapshot: Fable 5, Mythos 5 (gated), Opus 5, Sonnet 5, Haiku 4.5 + the 4.x line;
claude-3 family fully retired; sampling params deprecated (400 on 4.7+).

### 4.3 CODEX — `CODEX_BASELINE=COMPLETE`

Codex is inventoried as a DISTINCT surface (not merged into OpenAI Responses). What is proven
today is model-traffic parity only (CLI 0.140.0-alpha.2 through GovAI base-URL, live-accepted,
API-key mode — ADR-031). The embedding surface is the **app-server protocol**: thread
start/resume/read/list/archive/delete/**fork**, turn start/lifecycle/interrupt/steer, approvals
(`item/commandExecution/requestApproval`, `item/fileChange/requestApproval` — the P5 governance
hooks), sandbox modes + approval policies, skills/apps/plugins/MCP, auth modes, realtime, remote
control. STABILITY IS MARKED, per the dispatch's rule against building on unstable fields:
upstream's own words are that the app-server command and WebSocket transport are
"experimental and aren't supported for production workloads", with a STABLE schema subset gated
from experimental via `capabilities.experimentalApi`, NO wire protocol version (per-build schema
generation with precomputed stable/experimental exports). Consequences (normative for P5): pin
the Codex build per deployment, regenerate the schema per pin, consume the stable surface only,
treat plugins ("under development — do not call from production clients yet") and every
`experimental`-marked method as unavailable. The Python SDK ("stable release", drives app-server
JSON-RPC) is the preferred programmatic client; the TS SDK wraps `codex exec --experimental-json`
(status UNKNOWN). Codex cloud tasks have NO public API (PROVIDER_NOT_EXPOSED — internal ChatGPT
endpoints only). Codex keeps its own persistence (rollout JSONL + SQLite; resume across restarts
officially supported) — GovAI references thread ids, it does not re-implement Codex storage.

### 4.4 CLAUDE_CODE — `CLAUDE_CODE_BASELINE=COMPLETE`

Also a distinct surface. Proven today: model-traffic parity only (2.1.233 base-URL mode,
live-accepted). The embedding surface is the **Claude Agent SDK** (TS + Python — the Claude Code
harness as a library; explicitly NOT the API Tool Runner and NOT Managed Agents): session
start/resume/fork, list/rename/delete, permission modes incl. programmatically-settable plan
mode, `canUseTool` + hooks (the P6 governance hooks), tools, MCP (incl. in-process custom
tools), skills/plugins, subagents + orchestration, stream-json structured events (the item model
GovAI would capture), cost/usage, interrupt. Sessions are CLIENT-SIDE JSONL with a documented
`SessionStore` interface — the sanctioned hook for GovAI-owned encrypted session persistence
(continuity §11). Auth scope stays API-key mode per ADR-031 (subscription OAuth out of scope).
Checkpoint/rewind programmatic exposure is UNKNOWN at the snapshot (marked; verify at P6).
Fine SDK API/version details are agent-verified against current docs; the P6 implementation
mission re-verifies against its pinned SDK version as a matter of course.

## 5. Product UX reference — `PRODUCT_UX_REFERENCE=COMPLETE`

The 59 PRODUCT_ONLY rows answer "what does a user expect if GovAI replaces the provider's normal
UI?" — they are reference requirements for GOVAI_PRODUCT_EQUIVALENT work, never provider-API
claims (mechanically enforced). The load-bearing expectations both vendors have normalized:
conversation sidebar/history/search, Projects (files + instructions + project-scoped memory),
memory, branching (ChatGPT "Branch in new chat"; Claude Code `/branch`), model selection,
archive/delete with truthful retention, shared links, file uploads, in-app tools (search,
research, agentic browsing), a work surface (Canvas / Artifacts / ChatGPT Work / Claude Cowork),
voice, and — for the coding agents — parallel sessions, diff review, approvals UX, cloud/local
handoff, PR integration and managed code review. 2026 deltas absorbed into the manifest:
ChatGPT's unified desktop app (Chat+Work+Codex), group chats retired, Pulse folding into
scheduled tasks, GPT creation workspace-only, connectors→"apps"; Claude's memory-for-all-plans
redesign and Cowork as the agentic-work surface. GovAI's north star for §15 of the continuity
spec is this table, applied with GovAI's honesty/evidence doctrine on top.

## 6. Machine manifest contract

`docs/architecture/generated/native-experience-parity-v1.json` is a hand-curated, versioned
research baseline (NOT derived from the tree — there is deliberately no `write` mode).
Determinism and truth are enforced three ways: `pnpm docs:parity:check` (schema/vocabulary/
uniqueness/axis-coherence/no-overclaim invariants + canonical byte form), `pnpm
docs:parity:format` (canonical form restore after hand edits), and the always-on unit lane
(`scripts/lib/parity-core.test.ts` fixtures + `scripts/native-experience-parity-manifest.test.ts`
tracked-artifact enforcement, which also pins "FULL rows exist only on surfaces proven
end-to-end"). Mechanical no-overclaim rules include: `FULL ⇒ all required axes true`;
`PRODUCT_ONLY` confined to app surfaces with zero API axes; `PROVIDER_NOT_EXPOSED ⇒ ¬provider_
exposed`; `MISSING ⇒ no GovAI axes`; one snapshot date pinning every `verified_at`; per-surface
provider mapping; CODEX-only `protocol_stability`. Updating ANY row's proof axes requires the
corresponding evidence class (test file, live-acceptance record, browser acceptance) — the same
two-axis discipline as `h1v2-coverage-map.md`.

## 7. Material findings of this baseline

Provable at the anchor (full detail in the recovery evidence archive, working files outside the
repo):

- **A. Route-less provider families** — the MISSING rows of §4.1/§4.2 (manifest-derived at
  this snapshot: OPENAI_API 18 MISSING rows across 9 families; ANTHROPIC_API 8 MISSING rows
  across 4 families — zero GovAI route, incl. the continuity-critical OpenAI
  Conversations/response-storage/background family).
- **B. Registered-but-unproven** — OpenAI embeddings, vector stores, model delete: reachable in
  production with no dedicated tests and no live record.
- **C. Anthropic multipart gap** — no route-level multipart test for Anthropic `/v1/files`
  (`ANT-MP`, residual R10).
- **D. Registry/route streaming contradiction** — both `GET /v1/files/{id}/content` rows declare
  `streams: true`; both routes buffer whole bodies (`forwardRaw` → `arrayBuffer()`).
- **E. Inert registry fields** — `enforcement_default` and `tier_availability` are read by no
  runtime code; the three `ask`-defaulted destructive capabilities fall through to `observe`
  (residual R12 adjacency).
- **F. Two disjoint capability registries** — `/v1/capabilities` (8 entries) vs provider-package
  registries (19 entries); 6 shared ids; 13 capabilities invisible to API consumers; no
  reconciliation invariant. A parity implementation should adjudicate a single source of truth.
- **G. `openai-organization` never injected** — the resolver dep is supported but not wired in
  production; a client-sent header forwards verbatim.
- **H. Dead org-beta-override loader** — the direct routes' loader returns `[]` unconditionally;
  `source: 'org_override'` is unreachable.
- **I. Governed surface covers 3 of 27 native pairs** — no governed lane for models/files/
  embeddings/vector stores/count_tokens; governed routes cannot parse multipart at all.
- **T. TOOL-TAXONOMY-DRIFT-2026-08 (new, cross-referenced from both provider inventories)** —
  GovAI's computer-use guardrail matches the LEGACY shapes: tool types `computer_YYYYMMDD` /
  `computer_use_preview` (hard block, live-proven) and the three Anthropic computer-use beta
  headers (hard_denied). As of 2026-08-19 Anthropic's `computer_toolset_20260801` is GA with NO
  beta header, and OpenAI documents a newer `computer` tool type; NEITHER matches the pinned
  classifiers, so both would forward as `typed_unknown` (risk C, observe). The forward-and-
  observe doctrine is behaving as designed for unknown tools — but the computer-use FLOOR intent
  (`enforcement.ts:95-102`) is bypassed by shape drift. Same class, lower stakes: Anthropic
  browser-use toolset (GA 2026-08-19), memory tool, web_fetch, tool_search, and the new OpenAI
  tool families all classify `typed_unknown`. Both pinned beta-policy snapshots
  (`anthropic-beta-policy@2026-05-06`, `openai-beta-policy@2026-08-16`) predate material provider
  movement (residual R6, now demonstrably material).
- **P. Provider deprecation cliffs** — Assistants sunset 2026-08-26; Sora/Videos shutdown
  2026-09-24; OpenAI prompts/evals/fine-tuning wind-downs; Anthropic claude-3 retirement and
  sampling-param 400s: the baseline classifies these NOT_APPLICABLE so no parity effort is
  spent on dying surfaces.

Per the mission's no-fix rule, NOTHING above was changed in this movement.

## 8. Known platform residuals — parity impact classification

| Residual | Classification for the parity lane |
|---|---|
| `EP-AI-CONSOLE-TURN-EVIDENCE-CORRELATION` | `OPEN_WITH_TARGET_ARCHITECTURE` — absorbed into P0 (continuity spec §14); no event-schema change required |
| `AUTH-READ-CACHE-01` | `BLOCKER_BEFORE_PRODUCTION` (already `OPEN_DEPLOYMENT_BLOCKER`); P0 adds conversation reads which MUST ship `no-store` from day one and not enlarge the class |
| R14 (production human auth) | `BLOCKER_BEFORE_PRODUCTION` for multi-user/multi-device experience; NOT a blocker for pilot-scope P0 (continuity §20) |
| `PROVIDER-INBOUND-HOP-HEADER-RESIDUAL-01` | `BLOCKER_BEFORE_PRODUCTION` (cookie-relay analysis must be resolved before any cookie-based human auth; interacts with R14) |
| `EP-PROVIDER-RESPONSE-HEADER-PROVENANCE` | `BLOCKER_BEFORE_PRODUCTION` (browser cannot distinguish GovAI vs relayed provider auth errors; matters more as UI surface grows) |
| `PROVIDER-NONSTREAM-FORWARD-UNBOUNDED-01` | `SAFE_TO_DEFER` (unchanged standing adjudication; route-semantics change forbidden without owner adjudication) |
| `EP-AUTH-API-KEY-PREFIX-COLLISION-HARDENING` | `SAFE_TO_DEFER` (R14 lane) |
| `UI-DEV-PROXY-503-01`, `UI-DEV-PROXY-STREAM-CLOSE-01` | `SAFE_TO_DEFER` (dev-only; EP-UI-DEPLOY acceptance items) |
| `DIRECT_STREAM_REQUEST_ID_HEADER_GAP` | `SAFE_TO_DEFER` for P0 (server-side identity capture makes the echo unnecessary for durable turns — continuity §14); remains open for external stream callers |
| TOOL-TAXONOMY-DRIFT-2026-08 (finding T) | `BLOCKER_BEFORE_PARITY_IMPLEMENTATION` for the computer-use/browser-use class (P7 precondition: taxonomy + beta-policy refresh with fresh provider truth); `SAFE_TO_DEFER` for the observe-only tool families |

## 9. Implementation waves (dependency-adjudicated)

The dispatch's expected shape was adjudicated against source and provider contracts; the result
keeps its order with explicit dependencies:

- **P0 — Conversation Continuity Foundation** (`EP-AI-CONVERSATION-CONTINUITY-V1-01`, §10).
  Depends on: no preceding parity wave. P0 itself CONTAINS required internal prerequisites the
  continuity spec names — notably the purpose-aware envelope-encryption extension of
  `core-identity` (continuity spec §6: today's `envelopeEncrypt`/`envelopeDecrypt` hard-code
  the `payload_dek` purpose) and the keyed-digest integrity purpose — "no prior wave
  dependency" is not "no implementation prerequisite". Everything else that touches "the user
  lives here" depends on P0.
- **P1 — Rich chat: multimodal input + files.** Vision/PDF/file inputs already ride the lanes;
  the work is UI + attachment model + (OpenAI) Files/Uploads route completion + closing findings
  B/C/D for the files/vector-stores families. Depends on P0 (attachments hang off turns).
- **P2 — Search/citations/provider-hosted tools** (web search, file search, code execution
  lanes; citation rendering). Depends on P0 (tool items must persist); P1 for file search.
- **P3 — MCP / connectors / tool approvals.** Adds the approval UX GovAI's `ask` semantics never
  had (finding E / R12 adjacency) — the first place `ask` becomes real. Depends on P0/P2.
- **P4 — Projects / durable context / memory-equivalent.** Depends on P0 (containers above
  conversations), R14 for sharing.
- **P5 — Codex first-class workspace** via app-server (pinned build, stable surface, approval
  RPCs as governance hooks). Depends on P0 (thread↔conversation mapping); independent of P1–P4.
- **P6 — Claude Code first-class workspace** via Agent SDK (SessionStore over the encrypted
  store; canUseTool/hooks as governance hooks). Same dependency shape as P5.
- **P7 — Computer use / advanced execution.** Preconditions: finding T refresh (taxonomy + beta
  policy), a real sandbox/ask governance primitive (R12 closure for this class), owner risk
  adjudication. NOT before P3's approval UX exists.
- **P8 — Realtime / voice / media.** Precondition: a WebSocket/WebRTC transport class for the
  provider plane (new architecture — today's surface is HTTP-only); OpenAI realtime + Anthropic
  voice-adjacent surfaces; images/audio route families.
- **P9 — GovAI product-equivalent surfaces** (Artifacts/Canvas/Work-style deliverables,
  scheduled tasks, research mode) — the PRODUCT_ONLY table §5 as requirements, built GovAI-native
  with evidence linkage.

Cross-cutting, any wave: findings F (registry unification) and G/H (dead wiring) when their
surfaces are touched; batches/embeddings/webhooks families as independent small EPs.

## 10. Next implementation mission — `NEXT_IMPLEMENTATION_MISSION=SOURCE_ADJUDICATED`

**EP-AI-CONVERSATION-CONTINUITY-V1-01** (P0). Source-adjudicated candidate scope — final scope
frozen at that mission's own dispatch, not here:

- `ai_*` operational domain (conversations/branches/turns/attempts/items/content/provider_state/
  evidence_links) with RLS + encryption per continuity spec §3/§6 — first migrations of the lane;
- durable send with client-turn-id reservation (§8) + dispatch-outside-transaction (§9);
- server-owned stream pump with terminal-outranks-abort (§7) + reload/re-attach (§10);
- same-provider continuation adapters for the six lanes (OpenAI chaining/stateless; Anthropic
  stateless replay with thinking-signature rules) (§11);
- list/get/rename/archive + sidebar/history UI + deep link `/ai/c/:id` (§15, subset);
- turn↔evidence correlation triple persisted (§14) — closing the receipt's honest limit;
- browser reload acceptance + second-browser acceptance + RLS negative proof (§23).

Deferred OUT of that mission explicitly: cross-provider fork UX, Projects, full-content search,
attachments upload UX, provider-stored-state strategies beyond chaining, Codex/Claude Code
workspaces, retention automation.

## 11. No-overclaim declarations (mission end state)

```
NATIVE_EXPERIENCE_PARITY_V1        = BASELINE_COMPLETE_TARGET_NOT_IMPLEMENTED
OPENAI_PARITY_BASELINE             = COMPLETE
ANTHROPIC_PARITY_BASELINE          = COMPLETE
CODEX_PARITY_BASELINE              = COMPLETE
CLAUDE_CODE_PARITY_BASELINE        = COMPLETE
PRODUCT_UX_REFERENCE               = COMPLETE
CONVERSATION_CONTINUITY_REQUIREMENT= P0_ACCEPTED
CONVERSATION_CONTINUITY_ARCHITECTURE= SPECIFIED_NOT_IMPLEMENTED
CONVERSATION_PERSISTENCE           = NOT_IMPLEMENTED
WORKROOM                           = SEMANTICALLY_SEPARATE
PROJECTS                           = PLANNED_NOT_IMPLEMENTED
EP_AI_CONSOLE_TURN_EVIDENCE_CORRELATION = OPEN_WITH_TARGET_ARCHITECTURE
AI_CONSOLE_V1                      = COMPLETE_UNCHANGED
FOUNDATION_V1                      = UNCHANGED
UNIVERSAL_PROVIDER_PARITY          = NOT_CLAIMED
```

Forbidden claims remain forbidden: no "same as ChatGPT/Claude" without a defined axis, no "full
provider parity", no "all provider features supported", no "identical outputs", and no
implementation claim for anything this baseline only specified. The proven scope is exactly the
manifest's per-row axes — nothing more.

END OF BASELINE.
