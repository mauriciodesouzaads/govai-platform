> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** ACCEPTED_ARCHITECTURAL_DOCTRINE
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; drafted 2026-06)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D10=ACCEPT)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (status line reconciled + bounded 'M3 reconciliation and current validation' section appended; body otherwise byte-preserved incl. the PR-0 header)
> **SOURCE_SHA256:** `c5588f5568d7e1e958f65b2dc0645f98f8cabb81933241a8bd765fbc19880dc5` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** ACCEPTED (D10) with ONE normalized status (the PR-0 dual "PROPOSTA → aceite" wording below is history). Bounded reconciliation appended at the end: (1) Decision 2 / the Context "default-deny … unknown tokens fail closed" model is SUPERSEDED by the Foundation V1 native contract (M1 OD-1=A; ADR-021 Accepted) — unknown/unresolved beta tokens are forwarded byte-intact and observed via hashed markers, only `hard_denied` (provider-hosted computer-use) betas fail closed; empirical baseline pinning survives as evidence-granularity hygiene, not as a GA precondition; (2) the `X-GovAI-Agent-Session` header and the deliverables in Decision 5 (runbook, managed-settings template, CI header-set smoke) are NOT implemented at the anchor; (3) real coding-agent acceptance exists ONLY for the executed Foundation M2/M2A lanes (Claude Code 2.1.233 and Codex CLI 0.140.0-alpha.2, passthrough + governed, API-key mode) — no universal CLI/version claim.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** PROPOSTA → aceite do dono registrado neste PR
> **BASE DECLARADA PELO DOCUMENTO:** — · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Coding agents como capability governada; wedge de GTM confirmado (agentic = fronteira dos 4 líderes).
> **ORIGEM:** handoff 07-adr-031-coding-agent-surface.md (renomeado)
> ---

# ADR-031 — Coding agents (Claude Code / Codex) as a first-class governed surface

Status: Accepted (M3 / owner decision D10, 2026-08-18) — originally Proposed (drafted 2026-06). Decision 2 and the "default-deny" context are superseded as recorded in "M3 reconciliation and current validation" below.

## Context

- Market (2026-06 research): coding agents are the fastest-growing enterprise
  AI workload (Claude Code business subscriptions quadrupled in Q1 2026 with
  enterprise >50% of revenue per public reporting); enterprises govern them
  by pointing the CLI at a gateway (`ANTHROPIC_BASE_URL` / OpenAI-compatible
  base URL) and enforcing that configuration via MDM-distributed
  `managed-settings.json`, including `allowManagedMcpServersOnly` for MCP
  allowlisting and native OpenTelemetry settings. Competing gateways already
  ship first-class Claude Code onboarding.
- Source-verified GovAI readiness: the passthrough/governed allowlists
  already cover the endpoints these agents use — Anthropic `POST /v1/messages`
  (±stream), `POST /v1/messages/count_tokens`, `GET /v1/models`; OpenAI
  `POST /v1/responses` (±stream). Provider credentials are per-org (BYOK),
  and the beta-header policy is default-deny with pinned, sourced entries.
- Risk: coding-agent clients send `anthropic-beta` tokens that change across
  releases; under default-deny, an unknown token fails closed. Failing
  closed is correct doctrine, but shipping the surface without an empirical
  token baseline would break every session on day one.

## Decision

1. Claude Code and Codex are treated as **first-class governed capabilities
   over the existing provider-native passthrough/governed surfaces** — no
   CLI fork, no wrapper binary, no protocol translation. GovAI is the base
   URL; fidelity guarantees (H1 v2) apply unchanged.
2. **Empirical beta-header baseline is a GA precondition.** Before the
   surface is announced: capture the full header set emitted by current
   Claude Code and Codex releases against a staging gateway; pin each token
   in `ANTHROPIC_BETA_POLICY` / `OPENAI_BETA_POLICY` with `source_doc`,
   `pinned_at`, and a `review_due` date (house pattern). Unknown tokens keep
   failing closed — loudly, with the machine-readable beta-policy error.
3. **Identity model:** one GovAI API key per developer (or per agent
   identity for CI), issued under the org; optional `X-GovAI-Agent-Session`
   header propagated into evidence (`redactionMetadata.audit_bridge` /
   future session field). Evidence answers *who, which agent, which
   session* — not just *which org*.
4. **Scope:** API-key mode only (Anthropic Console / OpenAI platform keys
   resolved via GovAI per-org credentials). Subscription/OAuth login modes
   are explicitly out of scope and documented as such — they do not route
   through a corporate base URL the same way.
5. **Deliverables bound to this ADR:** (a) runbook "Govern Claude Code in 15
   minutes" (env vars + verification steps); (b) `managed-settings.json`
   template (base URL, telemetry, `allowManagedMcpServersOnly` pointed at
   GovAI `/mcp/v1` once the MCP gateway ships) with MDM distribution notes
   (Jamf/Kandji/Intune); (c) a smoke test in CI that replays a recorded
   agent session header-set against the gateway to catch policy drift.
6. **Workroom linkage (forward-looking):** agent sessions carrying a
   workroom binding attach their evidence to that workroom's timeline,
   enabling the single-screen "chat + coding agent + audit" experience when
   workroom Phase 6 (UI) lands. This ADR establishes the session header now
   so the data exists before the UI does.

## Consequences

- The cheapest credible go-to-market wedge ships on infrastructure that
  already exists; remaining work is policy baselining + documentation +
  identity plumbing (shared with AuditBridge D1).
- Beta-policy maintenance gains a hard consumer: the `review_due` cadence
  (consolidation plan WS3) stops being optional hygiene and becomes a
  product SLA.
- Sessions that fail closed on a new agent release are a *detection
  feature* (policy drift alarm), but only if the error is loud and the
  smoke test exists — both are required by this ADR.

## Non-goals

No CLI modification; no OAuth/subscription interception; no IDE plugins; no
local stdio MCP governance (covered by managed settings + MCP gateway
design); no latency-optimization commitments beyond existing parity budgets.

## M3 reconciliation and current validation (2026-08-18, Foundation V1 anchor `de80664a`)

- **Superseded — Decision 2 and the Context bullet "the beta-header policy is
  default-deny … an unknown token fails closed":** the Foundation V1 native
  contract (EP-FOUNDATION-V1-M1, owner decision OD-1=A; ADR-021 Accepted) makes
  the Native/Audited surface pass-and-observe by default: unknown or unresolved
  `anthropic-beta` / `OpenAI-Beta` tokens are forwarded byte-intact, the
  provider is the truth, and the sealed v4 event records a bounded hashed
  marker (`beta:unknown_token:sha256:<64hex>` in `risk_escalation_reasons`;
  the raw token is never stored). Only `hard_denied` tokens (the
  provider-hosted computer-use family) fail closed, explicitly (403 + durable
  blocked v4 capture). Consequently a new agent release does not break every
  session on day one; empirical baseline pinning remains valuable as evidence
  granularity and policy hygiene (typed beta provenance is a registered
  Foundation V1 residual), not as a GA precondition. Live: M2/M2A observed the
  current Claude Code beta tokens as hashed `unknown_token` markers with the
  session succeeding through GovAI.
- **Decision 1 (no fork/wrapper; GovAI is the base URL) — validated in the
  executed scope:** M2 (2026-08-16/17, base `3e90f2fb`) and M2A (`7cdde191`,
  tree identical to the Foundation V1 anchor) ran **Claude Code 2.1.233**
  (`claude -p`, `ANTHROPIC_BASE_URL` → `/passthrough/anthropic` and
  `/governed/anthropic`, `ANTHROPIC_AUTH_TOKEN` = GovAI tenant key, model
  `claude-haiku-4-5-20251001`) and **Codex CLI 0.140.0-alpha.2** (`codex exec`,
  custom `model_providers.govai` base URL → `/passthrough/openai/v1` and
  `/governed/openai/v1`, `env_key` = GovAI tenant key, `wire_api="responses"`,
  model `gpt-4.1-mini`) through GovAI against the real providers with durable
  captures and zero provider-secret leakage. Nothing beyond those lanes,
  versions, models and modes is claimed. Observed, non-fatal: Claude Code
  probes `HEAD <base>/api/hello` before the first Messages call (401 on
  passthrough, 404 on governed) — recorded, not a registry change.
- **Decision 3 (`X-GovAI-Agent-Session`):** NOT implemented — no occurrence in
  `apps/` or `packages/` at the anchor. Evidence identity today is the org +
  API-key principal plus the AuditBridge request identity (ADR-028).
- **Decision 4 (API-key mode only):** consistent with the executed lanes
  (agent children received only the GovAI tenant credential; no OAuth /
  subscription interception).
- **Decision 5 deliverables (a) runbook, (b) `managed-settings.json` template,
  (c) CI header-set smoke:** NOT implemented in the repository at the anchor
  (target work; see `docs/architecture/development-roadmap.md`).
- **Decision 6 (Workroom linkage):** target — Workroom Phase 6 (UI) does not
  exist; no session header exists to bind.
