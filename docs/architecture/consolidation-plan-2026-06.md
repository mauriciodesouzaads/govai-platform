> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** HISTORICAL_SNAPSHOT
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; plan dated 2026-06)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D14=PRESERVE_HISTORY)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header, incl. the PR-0 header)
> **SOURCE_SHA256:** `474a7ab79703345339cedb8779365cac231c5a9ab70748a6c0c1aad2864a362b` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** HISTORICAL SNAPSHOT (D14 = PRESERVE_HISTORY) — the June 2026 consolidation plan; its status tables are a decision/scope record, not current state (the PR-0 header below already says so). At the Foundation V1 anchor: WS1 (AuditBridge + B3) delivered; WS2 (alphanumeric CNPJ, EP-007) delivered; the ADR-029/030/031 items are promulgated in this tree (ADR-031 Accepted; ADR-029/030 Proposed); WS3's "fail-closed default-deny" beta premise and R3 mitigation are superseded on the Native surface by the M1 pass-and-observe contract (ADR-021 Accepted); WS4–WS6 (enforcement floor, Shadow AI, MCP gateway) remain targets; the endpoint-coverage matrix rows still require their own decisions. Not modernized.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** HISTÓRICO-PARCIAL — WS1 (AuditBridge+B3) e WS2 (CNPJ alfanumérico) ENTREGUES e verificados no código; WS0 parcial; ordem restante regida pelo Mapa §6
> **BASE DECLARADA PELO DOCUMENTO:** main pós-e8aa632 (jun/2026) · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Não usar as tabelas de status como estado atual; usar como registro de decisão e escopo.
> **ORIGEM:** handoff 00-consolidation-plan-2026-06.md
> ---

# GovAI — Consolidation Plan (2026-06)

Status: `PROPOSED_PLAN` — review pending (Maurício). Produced from a full source
review at `main` (post-`e8aa632`), the external assessment of 2026-06-11, and
market research dated 2026-06. This document is the umbrella for the artifact
set below and defines the order in which work is executed and which existing
docs must be updated at each step. It follows the repository's evidence-based
status vocabulary: nothing here claims implementation.

## Artifact set (reading order)

| # | File | Type | Replaces / elevates |
|---|------|------|---------------------|
| 0 | `00-consolidation-plan-2026-06.md` | Plan | — |
| 1 | `01-spec-auditbridge-implementation.md` | Implementation spec | Implements ADR-027 + ADR-028 |
| 2 | `02-spec-dlp-cnpj-alfanumerico.md` | Implementation spec | Updates `packages/dlp-br` (calendar deadline: 2026-07) |
| 3 | `03-spec-shadow-ai-v1.md` | Module spec | Elevates `docs/contracts/shadow-ai.md` (stub) |
| 4 | `04-design-mcp-gateway-v1.md` | Design doc | Elevates `docs/contracts/mcp-security.md` (stub) |
| 5 | `05-adr-029-two-speed-surfaces.md` | ADR | Formalizes native vs. agnostic surface doctrine |
| 6 | `06-adr-030-standalone-and-integrated.md` | ADR | Formalizes standalone-and-integrated doctrine |
| 7 | `07-adr-031-coding-agent-surface.md` | ADR | Formalizes Claude Code / Codex as governed capability |

Suggested repo placement: specs under `docs/architecture/specs/`, ADRs under
`docs/architecture/adr/`, this plan under `docs/architecture/`.

## Workstreams, order, and gates

Order is dependency-driven. WS1 gates everything that claims evidence.

### WS0 — Operational hardening (parallel, no gate)
Source-verified issues from the 2026-06-11 review. Each is small and
independent:
- Bump Fastify 5.x patch line (clears `fast-uri` advisories on the production
  dependency path); re-run `pnpm audit --prod`.
- Remove declared-but-unused deps from `apps/api/package.json`:
  `@opentelemetry/*`, `drizzle-orm`, `drizzle-kit`, `redis`,
  `fastify-type-provider-zod`, `@govai/signing` (keep the package; drop the
  dep until a consumer exists). Re-run audit; most HIGH advisories disappear.
- `forwardRaw` (non-streaming passthrough): add explicit `AbortSignal` timeout
  (config `GOVAI_UPSTREAM_TIMEOUT_MS`, default 120000). Streaming already
  propagates abort.
- Per-org rate limiting backed by Redis (Redis is already provisioned in
  `infra/docker-compose.yml` and configured in `packages/config`, unused).
  Keyed by `org_id` (post-auth) with global IP fallback pre-auth.
- Migration ledger: add `govai.schema_migrations` (filename, sha256,
  applied_at) to `apps/api/src/db/migrate.ts`; keep idempotency as
  defense-in-depth, stop relying on it as the only mechanism. Switch the
  `SET govai.app_password` interpolation to `set_config($1, ...)`.
- Repo governance: add `LICENSE` (decide: proprietary all-rights-reserved
  notice or source-available license), `SECURITY.md`, `CONTRIBUTING.md`,
  Dependabot/Renovate config.
- `/health`: add `/health/ready` (DB ping + KMS probe), keep `/health` as
  liveness. (Partial ADR-025; full observability remains Phase 4+.)

### WS1 — AuditBridge (Phase 2.5) → B3 → minimal evidence cockpit
- Implement `01-spec-auditbridge-implementation.md` (two PRs, see spec).
- Then request explicit B3 runner authorization (roadmap Phase 3 precondition
  3) and implement `apps/audit-sealer` per ADR-020..026.
- Then Phase 4 *minimal*: captured/sealed/failed counts + "provider
  invocations without audit" detection + **Evidence Bundle v1** (per-org,
  per-period export: manifest + chain segment + verification script;
  PDF/A cover generated server-side). Reports before dashboards.
- Gate: nothing in WS4–WS6 that claims evidence ships before WS1 lands.

### WS2 — DLP: alphanumeric CNPJ (calendar deadline 2026-07)
- Implement `02-spec-dlp-cnpj-alfanumerico.md`. Independent of WS1. Ship
  before 2026-07-01.

### WS3 — Provider surface coverage + coding-agent enablement
- Adopt the endpoint coverage matrix below; resolve each `DECISION_NEEDED`
  row as an allowlist addition or a documented exclusion (one PR per
  provider, mirroring the existing capability/matcher pattern in
  `packages/provider-*/src/capabilities/index.ts`).
- Run the **empirical beta-header capture exercise** for Claude Code and
  Codex against a staging gateway; pin resulting tokens in
  `ANTHROPIC_BETA_POLICY` / `OPENAI_BETA_POLICY` with sources and
  `pinned_at` (house pattern already exists).
- Implement ADR-031 deliverables (runbook + managed-settings template).
- Institutionalize the provider-surface watch: extend
  `docs/architecture/regulatory/21-regulatory-intelligence-operating-model.md`
  with a `PROVIDER_API_SURFACE` source class (deprecations pages, changelogs)
  on a monthly diff cadence; beta policies get a `review_due` date.

### WS4 — Enforcement floor (roadmap Phase 5, reduced to MVP)
- Runtime hard-deny for prohibited-use determinations + automatic work-item
  creation (workroom task) when policy outcome requires review. Machine-
  readable decision reason on the wire (`enforcement_decision` already exists
  in `PassthroughInvoked v3`).
- Explicit non-goal: no parity regression for permitted traffic (H1 v2
  harness stays green).

### WS5 — Shadow AI v1
- Implement `03-spec-shadow-ai-v1.md`. Depends on WS1 (observations are
  evidence) and benefits from WS4 (dispositions create work items).

### WS6 — MCP Gateway v1 (second act)
- Implement `04-design-mcp-gateway-v1.md`. Depends on WS1 (per-call
  evidence) and reuses WS4 approval binding. Slot: workroom Phase 5
  (*agent participants + tool invocations*) + roadmap Phase 5 ("tool/MCP
  enforcement").

### Cross-cutting — ADRs and doctrine
- Land ADR-029/030/031 early (they are decisions, not code) so subsequent
  PRs cite them.

## Endpoint coverage matrix (source-verified at review time)

Allowlisted today (verified in `packages/provider-*/src/capabilities/index.ts`):

| Provider | Covered |
|---|---|
| OpenAI | `POST /v1/responses` (±stream), `POST /v1/chat/completions` (±stream), `GET /v1/models`, `GET/DELETE /v1/models/{id}`, `POST /v1/embeddings`, `/v1/files` CRUD + content, `/v1/vector_stores` (+files) |
| Anthropic | `POST /v1/messages` (±stream), `POST /v1/messages/count_tokens`, `GET /v1/models(/{id})`, `/v1/files` CRUD + content |

Not covered — each requires an explicit decision (`ALLOWLIST` with capability
+ level + tests, or `DOCUMENTED_EXCLUSION` with reason):

| Provider | Endpoint | Note |
|---|---|---|
| OpenAI | `/v1/conversations` | **Highest priority**: it is the declared migration target in `files-purpose-validator.ts` (`responses_api+conversations_api`); Assistants sunset 2026-08-26 is pinned correctly. |
| OpenAI | `/v1/batches` | Async jobs; evidence semantics differ (job lifecycle). |
| OpenAI | `/v1/images`, `/v1/audio/*`, `/v1/moderations`, fine-tuning | Decide per product scope. |
| OpenAI | Realtime GA (WebSocket) | New transport class; needs its own ADR; current passthrough is HTTP-only. `realtime=v1` beta header is already hard-denied (correct). |
| Anthropic | `/v1/messages/batches` | Beta token `message-batches-2024-09-24` is `verification_required` in policy but the endpoint is not allowlisted — the pending "Batch D" decision is blocking a GA use case. Resolve. |
| Anthropic | Admin/Usage APIs | Useful for cost cockpit later; decide. |

## Documentation update checklist (per workstream)

| Doc | Update | When |
|---|---|---|
| `docs/architecture/current-state.md` §3 | Move AuditBridge from "zero call-sites" to source-verified implemented status with file/line evidence | WS1 merge |
| `docs/architecture/development-roadmap.md` | Mark Phase 2.5 exit criteria satisfied; record B3 authorization decision | WS1 |
| `docs/architecture/adr/` | Add ADR-029/030/031; AuditBridge spec appendix pins `AUDIT_BRIDGE_CAPTURE_NAMESPACE_UUID` | start |
| `docs/contracts/shadow-ai.md` | Replace stub body with pointer to spec 03 + status `SPEC_ACCEPTED` | WS5 start |
| `docs/contracts/mcp-security.md` | Replace stub body with pointer to design 04 + status `DESIGN_ACCEPTED` | WS6 start |
| `packages/provider-*/src/beta-policy.ts` | Refresh pins; add `review_due`; resolve `verification_required` items | WS3 |
| `docs/architecture/regulatory/21-…` | Add `PROVIDER_API_SURFACE` watch class | WS3 |
| `docs/architecture/regulatory/15-source-register.md` | Add IN RFB 2.229/2024 (CNPJ alfanumérico) as `CONFIRMED_PRIMARY_SOURCE`; note EU AI Act Digital Omnibus timing change (Annex III → 2027-12-02, provisional) on the `REFERENCE_ONLY` row | WS2 / immediate |
| `docs/architecture/regulatory/07-sensitive-data-handling.md` + `24` | Reference alphanumeric CNPJ detector change | WS2 |
| Stale-docs register | Entries for every doc touched above | each WS |

## Risk register (delta)

- **R1 — Sequencing risk**: shipping cockpits/modules before WS1 produces
  dashboards not backed by evidence ("false confidence", per ADR-027). Gate
  enforced by this plan.
- **R2 — Calendar risk**: WS2 has an external deadline (2026-07). It is
  deliberately independent of WS1.
- **R3 — Wedge risk**: WS3's beta-header exercise is empirical; Claude Code
  releases can change header sets. Mitigation: the `review_due` cadence and
  fail-closed default-deny (sessions fail loudly, not silently).
- **R4 — Single-maintainer risk**: unchanged; outside this plan's scope but
  restated because it dominates everything else.

## Exit criteria for "consolidation complete"

1. WS1 merged with tests; `current-state.md` §3 updated with evidence.
2. WS2 merged before 2026-07-01.
3. Every row of the coverage matrix carries `ALLOWLISTED` or
   `DOCUMENTED_EXCLUSION` (no `DECISION_NEEDED` remaining).
4. ADR-029/030/031 accepted.
5. Specs 03 and 04 accepted (implementation may follow per WS order).
6. WS0 items merged; `pnpm audit --prod` shows no HIGH on production paths.
