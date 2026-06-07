# GovAI Current State

## Status

- **Evidence-first source of truth** for the current implementation state of GovAI.
- **Does not authorize B3.** The AuditSealer runner is not started and is not authorized here.
- Distinguishes runtime implementation, foundational controls, provider-native evidence, target architecture, stale docs, and unverified claims. Generated from repository **source manifests** at main `8be5cfc74f67feb2824d0cb25da0816b7689a163` (2026-06-04), not from memory.
- **Runtime route existence does not imply runtime evidence capture.** See §3 *Runtime-to-evidence wiring*.

### Status vocabulary (every IMPLEMENTED_* row must cite source; SOURCE_AND_TEST also cites a test)

- `IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED`
- `IMPLEMENTED_RUNTIME_SOURCE_VERIFIED_TESTS_NOT_LOCATED`
- `IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED`
- `IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_VERIFIED_TESTS_NOT_LOCATED`
- `IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE`
- `DOCUMENTED_TARGET_ONLY`
- `STALE_DOC_NEEDS_UPDATE`
- `NEEDS_SOURCE_VERIFICATION`
- `PLANNED`
- `BLOCKED_BY_DECISION`

## Source manifests

Counts from `find` at the source commit (not from docs):

- architecture docs (`docs/architecture/**.md`): **71**
- regulatory docs (`docs/architecture/regulatory/*.md`): **20** (18–25 series present; **no** 26–30 files exist)
- ADR docs (`docs/architecture/adr/*.md`): **25** (ADR-001..026, no ADR-015)
- API route files (`apps/api/src/routes/*`): **17** (16 routes + `_not-implemented.ts`)
- DB migrations (`apps/api/src/db/migrations/*`): **24**
- test files (`*.test.ts` under tests/apps/packages): **137**

---

## 1. Runtime surfaces

All surfaces registered in `apps/api/src/server.ts:79-94`. Status reflects **runtime execution**; audit-evidence capture is a separate axis (§3).

| Surface | Status | Route/entrypoint | Handler/service | Tests | Limitations | Next step |
|---|---|---|---|---|---|---|
| Health | IMPLEMENTED_RUNTIME_SOURCE_VERIFIED_TESTS_NOT_LOCATED | `routes/health.ts` (`server.ts:79`) | inline | dedicated route test not located in this review | liveness/readiness | — |
| Capabilities | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/capabilities.ts` (`:80`) | `@govai/core-governance` | `tests/integration/capabilities-by-org.test.ts` | per-org view; default-deny | — |
| `/v1/runs` | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/runs.ts` (`:81`) | `pipeline/run-orchestrator.ts` | `tests/integration/governed-run-e2e.test.ts`, `runs-passthrough-mode.test.ts` | governed+passthrough; writes run-lifecycle audit to chain via `auditAppend` (§3) | — |
| Audit events | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/audit-events.ts` (`:82`) | reads HMAC chain | `audit-events-rls.test.ts`, `audit-events-pagination.test.ts` | read-only | — |
| Admin audit crypto-shred | PLANNED | `routes/admin-audit-shred.ts:41` (`sendNotImplemented … 'PR3'`) | stub | n/a | not-implemented stub; `crypto_shredded` state + ADR-011 exist in schema | implement later |
| Admin DLP detector CRUD | PLANNED | `routes/admin-dlp.ts:40` (`sendNotImplemented … 'PR3'`) | stub | n/a | admin CRUD stub; DLP pre-scan itself runs in governed surfaces | implement later |
| Passthrough Anthropic | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED + IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | `routes/passthrough-anthropic.ts` (`:85`) | `@govai/provider-anthropic` | `tests/integration/anthropic-passthrough.test.ts` + raw-body tests | audit emission is logger-only (§3) | — |
| Passthrough OpenAI | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED + IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | `routes/passthrough-openai.ts` (`:86`) | `@govai/provider-openai` | `tests/integration/openai-passthrough.test.ts` + raw-body tests | audit emission is logger-only (§3) | — |
| Governed Anthropic | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/governed-anthropic.ts` (`:87`) | `@govai/provider-anthropic/governed` | `tests/integration/governed-anthropic.test.ts` | **direct governed-native audit emission uses `app.log.info` (`governed-anthropic.ts:71-72`); runtime-to-B1-outbox dispatch is not implemented/source-verified** (§3) | wire to capture outbox (Phase 2.5) |
| Governed OpenAI | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/governed-openai.ts` (`:88`) | `@govai/provider-openai/governed` | `tests/integration/governed-openai.test.ts` | **direct governed-native audit emission uses `app.log.info` (`governed-openai.ts:69-70`); runtime-to-B1-outbox dispatch is not implemented/source-verified** (§3) | wire to capture outbox (Phase 2.5) |
| Admin provider credentials | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `routes/admin-provider-credentials.ts` (`:89`) | KMS envelope; `auditAppend` (`:164,289`) | `admin-provider-credentials-*.test.ts` (6 files) | SET/GET/REVOKE; no rotation policy | — |
| Workrooms (Phase 1) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workrooms.ts` (`:90`) | inline; migration 0012 | `tests/integration/workroom-participants.test.ts` (+ ~20 workroom tests) | partial runtime (Phase 1) | — |
| Workroom transcript (Phase 2) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-transcript.ts` (`:91`) | migration 0013 | `workroom-messages.test.ts`, `workroom-audit-subview.test.ts` | partial runtime (Phase 2) | — |
| Workroom runs (Phase 3) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-runs.ts` (`:92`) | `run-orchestrator.ts` `WorkroomRunContext`; migration 0014 | `workroom-runs.test.ts`, `workroom-runs-mode.test.ts` | partial runtime (Phase 3) | — |
| Workroom approvals (Phase 4) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-approvals.ts` (`:93`) | migration 0015 | `workroom-approvals.test.ts`, `workroom-approvals-runs.test.ts` | partial runtime (Phase 4); SoD/TOCTOU | — |
| Regulatory | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `routes/regulatory.ts` (`:94`) | `regulatory/service.ts`; migrations 0016–0024 | `regulatory-*.test.ts` (11 files) | **evidence only, not runtime enforcement** (§4/§5) | — |

Workroom Phases 5 (tool invocations), 6 (UI), 7 (external autonomous agents) are `DOCUMENTED_TARGET_ONLY`. Workroom is **not complete**.

---

## 2. Provider-native layer

`IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE`, proven by the H1 v2 harness/coverage map (versioned; PRs #81/#82/#83/#84/#86/#87). This is **byte/parity evidence**, not evidence-plane dispatch (see §3).

| Capability | Status | Evidence | Remaining follow-ups |
|---|---|---|---|
| OpenAI raw-body preservation | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB-OAI[byte-for-byte] | — |
| Anthropic raw-body preservation | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB-ANT[byte-for-byte] | — |
| `native_request_hash` over original bytes | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB-OAI/RB-ANT hash | — |
| `body_forward_mode:"raw"` | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | byte equality | — |
| Valid-tools pass-through | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | PR #87 RB-OAI/RB-ANT[valid-tools] | — |
| Invalid-tools block | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB[tools-block] (403) | — |
| Unknown/future fields preserved | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB[byte-for-byte] + [valid-tools] | — |
| Response hop-by-hop filter | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | PR #86 RH-OAI/RH-ANT + RB[hop-by-hop] | downstream keep-alive/transfer-encoding/content-length is runtime-owned (non-blocking) |
| Malformed JSON forwarded | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB[malformed] | — |
| Streaming detection | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB[nested-stream] | — |
| gzip / `Content-Encoding` policy | PLANNED | spec §12/§15 | non-blocking |
| Anthropic multipart route-level | PLANNED | spec §9/§15 | non-blocking |
| `stream_final_hash` hash-over-bytes | PLANNED | presence only | non-blocking |

---

## 3. Audit and Evidence Plane

| Item | Status | Evidence |
|---|---|---|
| Audit chain baseline (HMAC, append-only) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `packages/core-audit/src/append.ts`; migration 0001; `audit-events-*.test.ts`; ADR-009 |
| Crypto-shred / right-to-erasure | IMPLEMENTED_FOUNDATIONAL_CONTROL (state+ADR) / PLANNED (admin route) | ADR-011; `crypto_shredded` state in migration 0001; admin route is a stub (`admin-audit-shred.ts:41`) |
| B0 — capture outbox foundation | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0025; `tests/integration/audit-capture-outbox-foundation.test.ts` |
| B1 — `captureAuditEvent` adapter | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `packages/core-audit/src/capture.ts`; `audit-capture-bridge.test.ts` (titled "B1 integration tests for the captureAuditEvent adapter"), `capture.test.ts` — **tested as a primitive; see §3 wiring** |
| B2 — sealer **library** | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `packages/core-audit/src/sealer.ts`; `audit-sealer-core.test.ts`, `sealer.test.ts` — one-shot primitives, no loop/process/`SET ROLE` |
| B3 — sealer **runner** | DOCUMENTED_TARGET_ONLY / BLOCKED_BY_IMPLEMENTATION_AND_AUTHORIZATION | no `apps/audit-sealer`; no claim/seal loop. Decision pack: ADR-022/024/025/026 Accepted as design constraints; ADR-020 superseded-in-part; ADR-023 Accepted as design constraint with Option A(b) deterministic `audit_event_id`, but **NOT implemented and NOT tested**. B3 still blocked by Option A(b) implementation/tests, Phase 2.5 runtime-to-evidence dispatch, and explicit authorization; see `specs/audit-sealer-b3-technical-plan.md` |
| Append/seal idempotency | capture: SOLVED; mark_sealed same-event: PARTIAL; **append→mark_sealed partial-failure: DECIDED (Option A(b)), NOT IMPLEMENTED, NOT TESTED** | ADR-023 chose a deterministic `audit_event_id` = UUIDv5(org_id+capture_id) as a design constraint (technical plan §8.3); `audit_events.id` is already PK so no migration for the minimal guard. B3 still blocked by future impl/tests, Phase 2.5 dispatch, and explicit authorization |
| Stale-sealing recovery | DOCUMENTED_TARGET_ONLY | ADR-023; not implemented |
| Evidence completeness (counts, provider-without-audit) | PLANNED | B0 stores `attempts`/`last_error`/timestamps; no reporting/metrics layer |

### Runtime-to-evidence wiring (first-class gap — source-verified)

This is the loose thread between runtime and the evidence plane. **Source-verified at `8be5cfc`:**

1. **Direct governed-native routes** (`governed-openai.ts`, `governed-anthropic.ts`) are implemented runtime surfaces (§1). Their `emitAuditEvent` closure writes to **`app.log.info` only** — `governed-openai.ts:69-70` and `governed-anthropic.ts:71-72` (`app.log.info({ audit_event: event }, 'governed-native audit event')`). The same is true for **passthrough** routes (`passthrough-openai.ts:79-82`, `passthrough-anthropic.ts:83-86`). The provider governed handlers call `deps.emitAuditEvent(ev)` for `passthrough.invoked` (e.g. `provider-openai/src/governed/handle-chat-completions.ts:188,245,308`), which resolves to that logger closure.
2. **Logger emission is not the same as dispatching into `captureAuditEvent` / the B1 capture outbox.** There are **zero `captureAuditEvent` call-sites in `apps/`** (grep). B1 is tested only as a primitive (`audit-capture-bridge.test.ts`).
3. **B0/B1/B2 exist** (foundation outbox, capture adapter, sealer library) — but no runtime route feeds the outbox.
4. **Therefore the direct governed-native / passthrough runtime-to-outbox wiring is not implemented / not source-verified.** This is a **first-class gap, not a contradiction**: runtime exists; evidence primitives exist; the dispatch wire between them is incomplete.
5. **B3 seals captures already in the outbox.** B3 alone does **not** prove that runtime events enter the outbox. An **AuditBridge / runtime-dispatch wiring** must be planned **before or alongside** B3.

Separately documented (not the same path):
- **`/v1/runs` orchestrator writes some audit events directly to the HMAC chain via `auditAppend`** (run lifecycle: deny/complete/fail/run) — `run-orchestrator.ts:526,618,737,801,888,967,1234,1334`. This is the legacy append chain, **not** the capture outbox.
- **Regulatory** (`regulatory/service.ts:249`) and **admin provider credentials** (`admin-provider-credentials.ts:164,289`) also write via `auditAppend` directly.

**Status lines:**
- Runtime-to-evidence dispatch for **direct governed-native / passthrough** routes: **DECISION ACCEPTED (ADR-027 AuditBridge, Option A) but NOT implemented / NOT tested** — logger-only in source today; route hooks receive `event: unknown`, so the future AuditBridge must validate/narrow via `PassthroughInvokedSchema` before mapping to `captureAuditEvent` → outbox. ADR-027 supersedes the older passthrough "Governed Run pipeline (PR3+)" absorption intent for direct routes; `/v1/runs` remains distinct and chain-authoritative via `auditAppend`.
- Evidence primitives (B0/B1/B2): `IMPLEMENTED_FOUNDATIONAL_CONTROL`.
- Continuous sealer runner (B3): `DOCUMENTED_TARGET_ONLY` / `BLOCKED_BY_IMPLEMENTATION_AND_AUTHORIZATION` — ADR-023 Option A(b) and ADR-027 are accepted as design constraints, but Option A(b) implementation/tests, Phase 2.5/AuditBridge implementation/tests, and explicit B3 authorization remain missing.
- `/v1/runs` run-lifecycle → audit chain (`auditAppend`): `IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED` (but to the chain, not the outbox).

---

## 4. Governance and policy

| Item | Status | Evidence / note |
|---|---|---|
| Capability registry (facets, default-deny) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `@govai/core-governance`; `capability.test.ts`; ADR-004 |
| Org override downgrade resolver | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `@govai/core-governance`; `resolve-governance.test.ts` |
| `/v1/runs` governed mode | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `run-orchestrator.ts`; `governed-run-e2e.test.ts` |
| `/v1/runs` passthrough mode | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `run-orchestrator.ts`; `runs-passthrough-mode.test.ts` |
| DLP pre-scan (scan-only) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `@govai/dlp-br`; governed handlers `dlpScan`; `scan-sensitive.test.ts` |
| Policy decision persistence | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | beta-policy gate emits `passthrough.beta_denied`; `passthrough-beta-denied.test.ts` |
| Workroom approval override (passthrough) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `workroom-approvals.ts`; `workroom-approvals-runs.test.ts` |
| Hard-deny runtime enforcement (regulatory) | DOCUMENTED_TARGET_ONLY | beta-policy does 403 at the provider surface, but regulatory prohibited-use/high-risk/agent hard-deny-floor are **evidence only** — no runtime gateway block. **Not claimed complete.** |

---

## 5. Regulatory Core

PR-R1..R9 are foundational controls — **governance evidence, not runtime enforcement** (no execution is blocked). Migrations + tests verified present.

| Capability | Status | Source | Tests | Runtime enforcement? | Next step |
|---|---|---|---|---|---|
| Regulatory Source Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0016; `regulatory/service.ts` | `regulatory-catalog.test.ts` | no | change/diff engine |
| Unified Control Catalog | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0016 | `regulatory-catalog.test.ts` | no | drift detection |
| AI System Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0017 | `regulatory-ai-systems.test.ts` | no | — |
| Provider Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0018 | `regulatory-providers.test.ts` | no | — |
| Model Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0019 | `regulatory-models.test.ts` | no | — |
| Agent Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0020 | `regulatory-agents.test.ts` | no — `hard_deny_floor_expected` is a declared expectation, not enforced | wire to runtime later |
| Use-case Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0021 | `regulatory-use-cases.test.ts` | no | — |
| Risk Classification Engine | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0022; `service.ts::classifyRisk` | `regulatory-risk-classifications.test.ts` | no | — |
| High-risk Review Workflow | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0023 | `regulatory-high-risk-reviews.test.ts` | no — APPROVED = evidence, not runtime authorization | bind to execution (future) |
| Prohibited-use Workflow | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0024 | `regulatory-prohibited-use-workflow.test.ts` | no — DENIED = evidence, not a runtime block | runtime gateway (future) |
| Sensitive Data taxonomy/detectors | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `@govai/dlp-br` SD1 + SD2A | `secret-detectors.test.ts`, `financial-detectors.test.ts`, `health-detectors.test.ts` | no — advisory only | SD persistence + policy binding |
| CNJ/Sinapses readiness | DOCUMENTED_TARGET_ONLY | regulatory/25-cnj-sinapses-readiness.md | n/a | no | — |
| Certification/readiness dossiers | DOCUMENTED_TARGET_ONLY | regulatory/22-certification-and-audit-readiness.md | n/a | no | — |
| Regulatory intelligence (monitor/diff) | DOCUMENTED_TARGET_ONLY | regulatory/21-regulatory-intelligence-operating-model.md | n/a | no | — |

The README and regulatory docs explicitly disclaim LGPD/judicial/legal/medical/financial/ISO/NIST/EU-AI-Act compliance, certification, or court admissibility. This document makes no compliance claim.

---

## 6. Known stale docs

Summarized in [stale-docs-register.md](./stale-docs-register.md): README status block, `workroom-governance-room.md` status, and ADR-020 role-model wording. Addressed minimally in this PR; ADR-022..026 acceptance + idempotency are a separate B3 decision-pack PR.

---

## 7. Current non-negotiables

- **Provider-native semantics are sacred** (no re-serialization / hidden defaults / schema narrowing on the native surface).
- **B3 is not authorized.**
- **No provider traffic in the AuditSealer.**
- **Evidence failure is evidence-plane health, not provider UX failure** for low-risk traffic.
- **No runtime hard-deny claim** unless implemented and tested.
- **No compliance/legal/certification claim** unless validated externally.
- **No document is a source of truth unless it distinguishes evidence from target architecture.**
- **Runtime route existence does not imply runtime evidence capture** (see §3).
