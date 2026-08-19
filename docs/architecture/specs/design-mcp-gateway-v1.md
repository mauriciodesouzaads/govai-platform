> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** ACCEPTED_TARGET_DESIGN
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; drafted 2026-06)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D11=ACCEPT_AS_TARGET_DESIGN)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (body status line normalized; body otherwise byte-preserved incl. the PR-0 header)
> **SOURCE_SHA256:** `e6f19fcc37f546c61bee11d9a2a85a1f04b5cbbbe096b7a73069985aa4e990c6` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** ACCEPTED AS TARGET DESIGN (D11) — ONE status: *Accepted as target design; NOT implemented*. The PR-0 header's "ACEITA — NÃO IMPLEMENTADA (DESIGN_ACCEPTED)" and the former body status `PROPOSED_DESIGN` were contradictory; the body status line is normalized below (bounded edit) and no other body text is changed. No `/mcp/v1` endpoint, `packages/mcp-gateway`, `mcp_*` tables or `X-GovAI-Agent-Session` header exists at the Foundation V1 anchor. Reuse-map rows describing existing primitives (capability registry, beta-policy pattern, DLP pre-scan, risk classes, Workroom approvals, AuditBridge → outbox, provider-credential envelope encryption, Workrooms) are source-verified as existing; the reuse-map row "Beta-token policy pattern (pinned, sourced, fail-closed)" describes the pre-M1 Native beta model — on the Native/Audited surface unknown betas are now forwarded and observed (ADR-021 Accepted, M1); the registry-policy analogy for MCP servers is a target choice, not a description of current beta handling.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** ACEITA — NÃO IMPLEMENTADA (DESIGN_ACCEPTED)
> **BASE DECLARADA PELO DOCUMENTO:** main pós-e8aa632 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Prioridade CONFIRMADA pelo mercado 2026 (MCP nos 4 líderes — Dossiê §3.2/§5); elevará docs/contracts/mcp-security.md (edit E8).
> **ORIGEM:** handoff 04-design-mcp-gateway-v1.md
> ---

# DESIGN — GovAI MCP Gateway v1 (the agentic second act)

Status: `ACCEPTED_TARGET_DESIGN` — accepted as target design (M3 / owner decision D11, 2026-08-18; formerly `PROPOSED_DESIGN`), NOT implemented — elevates `docs/contracts/mcp-security.md` (stub:
"Capability level 2 planejada"). Slots into workroom Phase 5 (*agent
participants + tool invocations*) and roadmap Phase 5 ("tool/MCP
enforcement"). Depends on AuditBridge (WS1) for per-call evidence and reuses
the approvals primitive (WS4 context). Market grounding (2026-06): MCP is the
de-facto AI-tool connectivity standard (multi-vendor adoption, Linux
Foundation governance); enterprise MCP gateways are an emerging control-plane
category; the protocol itself does not mandate RBAC/audit and its 2026
roadmap names audit trails, SSO auth, and gateway behavior as the least
defined enterprise area — i.e., the window for an evidence-grade entrant is
open.

## 1. Positioning

GovAI exposes **one governed MCP endpoint per organization**
(`/mcp/v1`, streamable HTTP, JSON-RPC 2.0) and acts as a *server of servers*:
agents and clients (Claude Code with `allowManagedMcpServersOnly: true`,
IDEs, Codex-style agents, internal apps) connect to GovAI; GovAI federates an
**allowlisted registry of upstream MCP servers** per org and interposes the
full governance pipeline on every `tools/call`.

Differentiator vs. the gateway field: not routing or latency — **evidence
with probative intent per tool call** plus **hash-bound one-time human
approval** for high-risk tools, neither of which the surveyed gateways offer.

## 2. Reuse map (build on what exists; do not rebuild)

| Existing primitive (verified) | MCP role |
|---|---|
| Capability registry + matchers (`packages/provider-*/src/capabilities`) pattern | New capability ids `mcp.{server_key}.{tool_name}` with levels (`passthrough_audited` / `policy_governed` / `evidence_grade`), default-deny |
| Beta-token policy pattern (pinned, sourced, fail-closed; `beta-policy.ts`) | **Server registry policy**: per-server `allowlisted/denied/verification_required`, version pin, `tool_schema_hash` pin |
| DLP pre-scan (`detectAllBaseline`, `scan-sensitive`) | Scan `tools/call` arguments (pre) and results (post); findings → `dlp_decisions`-style block on the event |
| Risk classes A–E + `detected_tool_classifications` (PassthroughInvoked v3) | Tool-level base risk from registry + escalation reasons |
| Workroom approvals: `intended_action_hash`, `FOR UPDATE`, one-time consume, SoD | **Tool-call approval binding**: approval consumed for exactly one `{server, tool, args_hash}` (TOCTOU-safe by construction) |
| AuditBridge → B0 outbox (spec 01) | Per-call evidence capture (new event type, §5) |
| `provider_credentials` envelope-encryption pattern (`0009`, KMS) | `mcp_server_credentials` per org (upstream auth tokens), fail-closed resolution matrix by operational mode |
| Workrooms (turns/tasks/evidence) | Tool calls executed *inside a workroom* attach to its timeline — the "single screen" experience's data layer |

## 3. New components

### 3.1 `packages/mcp-gateway` (protocol adapter)
- Transport v1: **streamable HTTP only** (remote servers). `stdio`/local
  servers are out of scope v1 (they live on developer machines; govern them
  via ADR-031 managed settings instead).
- Methods v1: `initialize`, `tools/list`, `tools/call`, `ping`. `resources/*`,
  `prompts/*`, `sampling`, `elicitation` are explicitly v2+ (documented
  exclusions, ADR-006 style — return JSON-RPC method-not-found with a
  GovAI-documented error datum, not silent absence).
- `tools/list` is **policy-filtered**: the union of allowlisted upstream
  tools the calling API key may see (per org + per key scope). Tool
  descriptions served to clients are the **pinned** descriptions (§3.2), not
  live upstream text — this is the description-injection defense.

### 3.2 Registry (new migration, RLS forced)
```
govai.mcp_servers(id, org_id, server_key, url, transport, status enum
  allowlisted|denied|verification_required, version_pin,
  tool_schema_hash bytea,        -- sha256(canonical_json(tools/list result))
  pinned_at, source_doc, created_by, updated_at)
govai.mcp_tools(id, org_id, server_id, tool_name, capability_id,
  base_risk_class, approval_required bool, schema_hash, pinned_description)
govai.mcp_server_credentials(... envelope-encrypted, per org, per server)
```
Drift defense ("rug pull"): on connect/refresh, GovAI recomputes the
`tools/list` hash; mismatch flips the server to `verification_required`,
blocks `tools/call` to changed tools, and emits an evidence event
(`'mcp.server.schema_drift'`). Re-approval is an admin action (audited).

### 3.3 `tools/call` interception pipeline (order is normative)
1. Authn: GovAI API key (existing `authenticateApiKey`); resolve org, roles,
   operational mode. Optional `X-GovAI-Agent-Session` propagated to evidence.
2. Resolve `{server, tool}` → capability; **default-deny** on any miss.
3. DLP pre-scan over canonicalized string arguments; policy may `warn|block`.
4. Risk: base class + escalations (arg size, destination class, DLP hits).
5. If `approval_required` or effective class ≥ org threshold:
   require header `X-GovAI-Approval-Id`; consume it one-time with
   `intended_action_hash = sha256(canonical_json({server_key, tool_name,
   args_hash: sha256(canonical_json(args)), workroom_id?}))`. Mismatch or
   reuse → deny with machine-readable reason (`approval_required`,
   `approval_hash_mismatch`, `approval_already_used` — reuse existing error
   codes where they exist).
6. Forward to upstream with org-scoped credentials (never ambient/global
   creds — confused-deputy defense), bounded by `GOVAI_MCP_TIMEOUT_MS`.
7. DLP post-scan over textual result content; policy may redact-and-flag
   (v1: flag + block-on-class-E only; redaction engine is Phase 6 territory).
8. Evidence capture (§5); return result.

### 3.4 Routes (`apps/api`)
`ALL /mcp/v1` (JSON-RPC), `GET/POST /v1/mcp/servers` (admin registry CRUD,
audited), `POST /v1/mcp/servers/{id}/verify` (recompute + pin hash).

## 4. Threat model (v1 coverage)

| Threat | Control |
|---|---|
| Malicious/unvetted server | Default-deny registry + version & schema pin |
| Tool-description prompt injection | Pinned descriptions served from registry; drift quarantine |
| Data exfiltration via args | DLP pre-scan + risk escalation + approval gate |
| Confused deputy / credential leakage | Per-org envelope-encrypted upstream creds; no client creds forwarded (mirrors passthrough header-strip doctrine) |
| Approval replay / TOCTOU | One-time consume bound to `args_hash` (existing mechanism) |
| Unauthorized tool discovery | Policy-filtered `tools/list` per key |
| Silent capability creep | Every registry mutation is an audited admin event |

Out of scope v1 (documented): upstream OAuth flows (v2 — store-and-use creds
only in v1), result-content rewriting, sampling passthrough, local stdio.

## 5. Evidence

New event `'mcp.tool.invoked'` v1 in `@govai/core-events`, deliberately
isomorphic to `PassthroughInvoked v3` where concepts match: tenant context,
`capability_id` (`mcp.*`), risk pair + reasons, enforcement decision,
`native_request_hash` = sha256(canonical args), `native_response_hash` =
sha256(canonical result), status, DLP decisions, `approval_id?`,
`workroom_id?`, latency. Dispatch path: the same AuditBridge → B0 outbox
(extend the bridge with a second schema branch or a small
`McpToolInvokedSchema` — the projection/exclusion doctrine of ADR-028 §7
applies unchanged: per-attempt fields out of the immutable hash). CaptureId
derivation reuses the ADR-028 formula with `capability_id = mcp.{server}.{tool}`.

When `workroom_id` is present, the call also appends to the workroom timeline
as a turn/evidence item — this is what makes the "one screen: chat + coding
agent + audit" experience possible later (workroom Phase 6 UI consumes it).

## 6. Sequencing

- **M0** registry + credentials + `tools/list` (read-only), admin routes,
  drift detection. No `tools/call`.
- **M1** `tools/call` with DLP + evidence (requires AuditBridge merged).
- **M2** approval binding (class-E / `approval_required` tools).
- **M3** Claude Code onboarding: managed-settings template pointing
  `allowManagedMcpServersOnly` at GovAI's `/mcp/v1`; runbook (ties to
  ADR-031).

## 7. Tests

Protocol conformance against the reference MCP inspector/client (initialize,
list, call, error shapes); registry default-deny; drift quarantine
(integration: change upstream tool list → call blocked + event emitted);
approval matrix (missing/mismatch/replay/success) reusing the existing
approval test patterns; DLP pre/post on args/results; RLS on all new tables;
evidence: one outbox capture per call with correct hashes; credential
plaintext-leak test mirroring `provider-credentials-plaintext-leak.test.ts`;
timeout behavior; per-org isolation of upstream credentials.

## 8. Exit criteria

A real remote MCP server registered, pinned, listed, and called through
GovAI with: default-deny proven, one class-E call gated by a consumed
approval, DLP finding recorded, and a verifiable capture on the outbox for
every call — plus a Claude Code instance using GovAI as its only MCP server
via managed settings.

## 9. Monetization note (for the business plan, not the code)

Pricing meter: connected MCP servers + governed agents (seats), not
tokens — consistent with the BYOK doctrine. The approval-bound high-risk
tool tier is the natural `regulated` add-on.
