# GovAI Current State

## Status

- **Evidence-first source of truth** for the current implementation state of GovAI.
- **B3 (the AuditSealer runner) is authorized and implemented (EP-006).** `apps/audit-sealer` ships the dedicated runner; it consumes no provider traffic and runs outside the request hot path (see §3 and §7).
- Distinguishes runtime implementation, foundational controls, provider-native evidence, target architecture, stale docs, and unverified claims. Generated from repository **source manifests** at main `c3cd39f36c0b465ac236ed8d01aedabe20703c77` (2026-06-27), not from memory.
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

- architecture docs (`docs/architecture/**.md`): **66**
- regulatory docs (`docs/architecture/regulatory/*.md`): **20** (18–25 series present; **no** 26–30 files exist)
- ADR docs (`docs/architecture/adr/*.md`): **23** (ADR-001..014 + ADR-020..028; **missing** ADR-015..019; ADR-028 is the most recent — `Accepted` and in main)
- API route files (`apps/api/src/routes/*`): **17** (16 routes + `_not-implemented.ts`)
- DB migrations (`apps/api/src/db/migrations/*`): **26** (0001..0027, **missing** 0006; highest `0027_evidence_completeness_views.sql`)
- test files (`*.test.ts`/`*.spec.ts`): **165** on disk; **162** run by the default `pnpm test` (3 under `tests/live/` are live-gated; the suite runs **2056** tests)

---

## 1. Runtime surfaces

All surfaces registered in `apps/api/src/server.ts:93-112`. Status reflects **runtime execution**; audit-evidence capture is a separate axis (§3).

| Surface | Status | Route/entrypoint | Handler/service | Tests | Limitations | Next step |
|---|---|---|---|---|---|---|
| Health | IMPLEMENTED_RUNTIME_SOURCE_VERIFIED_TESTS_NOT_LOCATED | `routes/health.ts` (`server.ts:93`) | inline | dedicated route test not located in this review | liveness/readiness | — |
| Capabilities | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/capabilities.ts` (`:94`) | `@govai/core-governance` | `tests/integration/capabilities-by-org.test.ts` | per-org view; default-deny | — |
| `/v1/runs` | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/runs.ts` (`:95`) | `pipeline/run-orchestrator.ts` | `tests/integration/governed-run-e2e.test.ts`, `runs-passthrough-mode.test.ts` | governed+passthrough; writes run-lifecycle audit to chain via `auditAppend` (§3) | — |
| Audit events | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/audit-events.ts` (`:96`) | reads HMAC chain | `audit-events-rls.test.ts`, `audit-events-pagination.test.ts` | read-only | — |
| Admin audit crypto-shred | PLANNED | `routes/admin-audit-shred.ts:41` (`sendNotImplemented … 'PR3'`) | stub | n/a | not-implemented stub; `crypto_shredded` state + ADR-011 exist in schema | implement later |
| Admin DLP detector CRUD | PLANNED | `routes/admin-dlp.ts:40` (`sendNotImplemented … 'PR3'`) | stub | n/a | admin CRUD stub; DLP pre-scan itself runs in governed surfaces | implement later |
| Passthrough Anthropic | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED + IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | `routes/passthrough-anthropic.ts` (`:99`) | `@govai/provider-anthropic` | `tests/integration/anthropic-passthrough.test.ts` + raw-body tests | audit emission: logger + AuditBridge → B1 capture outbox, integration-tested (PR-B, §3) | — |
| Passthrough OpenAI | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED + IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | `routes/passthrough-openai.ts` (`:100`) | `@govai/provider-openai` | `tests/integration/openai-passthrough.test.ts` + raw-body tests | audit emission: logger + AuditBridge → B1 capture outbox, integration-tested (PR-B, §3) | — |
| Governed Anthropic | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/governed-anthropic.ts` (`:101`) | `@govai/provider-anthropic/governed` | `tests/integration/governed-anthropic.test.ts` | direct governed-native audit emission: `app.log.info` + AuditBridge → B1 capture outbox, integration-tested (PR-B, §3) | — |
| Governed OpenAI | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/governed-openai.ts` (`:102`) | `@govai/provider-openai/governed` | `tests/integration/governed-openai.test.ts` | direct governed-native audit emission: `app.log.info` + AuditBridge → B1 capture outbox, integration-tested (PR-B, §3) | — |
| Admin provider credentials | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `routes/admin-provider-credentials.ts` (`:107`) | KMS envelope; `auditAppend` (`:164,289`) | `admin-provider-credentials-*.test.ts` (6 files) | SET/GET/REVOKE; no rotation policy | — |
| Workrooms (Phase 1) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workrooms.ts` (`:108`) | inline; migration 0012 | `tests/integration/workroom-participants.test.ts` (+ ~20 workroom tests) | partial runtime (Phase 1) | — |
| Workroom transcript (Phase 2) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-transcript.ts` (`:109`) | migration 0013 | `workroom-messages.test.ts`, `workroom-audit-subview.test.ts` | partial runtime (Phase 2) | — |
| Workroom runs (Phase 3) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-runs.ts` (`:110`) | `run-orchestrator.ts` `WorkroomRunContext`; migration 0014 | `workroom-runs.test.ts`, `workroom-runs-mode.test.ts` | partial runtime (Phase 3) | — |
| Workroom approvals (Phase 4) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-approvals.ts` (`:111`) | migration 0015 | `workroom-approvals.test.ts`, `workroom-approvals-runs.test.ts` | partial runtime (Phase 4); SoD/TOCTOU | — |
| Regulatory | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `routes/regulatory.ts` (`:112`) | `regulatory/service.ts`; migrations 0016–0024 | `regulatory-*.test.ts` (11 files) | **evidence only, not runtime enforcement** (§4/§5) | — |

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
| `stream_final_hash` hash-over-bytes | PLANNED | presence only (EP-008C adds the terminal-outcome marker `stream_outcome` on every stream termination; the hash-over-bytes content itself is still presence-only) | non-blocking |

---

## 3. Audit and Evidence Plane

| Item | Status | Evidence |
|---|---|---|
| Audit chain baseline (HMAC, append-only) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `packages/core-audit/src/append.ts`; migration 0001; `audit-events-*.test.ts`; ADR-009 |
| Crypto-shred / right-to-erasure | IMPLEMENTED_FOUNDATIONAL_CONTROL (state+ADR) / PLANNED (admin route) | ADR-011; `crypto_shredded` state in migration 0001; admin route is a stub (`admin-audit-shred.ts:41`) |
| B0 — capture outbox foundation | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | migration 0025; `tests/integration/audit-capture-outbox-foundation.test.ts` |
| B1 — `captureAuditEvent` adapter | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `packages/core-audit/src/capture.ts`; `audit-capture-bridge.test.ts` (titled "B1 integration tests for the captureAuditEvent adapter"), `capture.test.ts` — **tested as a primitive; see §3 wiring** |
| B2 — sealer **library** | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `packages/core-audit/src/sealer.ts`; `audit-sealer-core.test.ts`, `sealer.test.ts` — one-shot primitives, no loop/process/`SET ROLE` |
| B3 — sealer **runner** | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED (EP-006) | `apps/audit-sealer` — a dedicated deploy unit consuming `@govai/core-audit` verbatim: Shape-S per-seal tx (claim→append→mark_sealed via `withSealerPhaseRole`), the SEPARATE stale-recovery path (`loadSealingCaptureForRecovery` → idempotent re-append + mark_sealed; recoverable rows ADVANCED never failed; terminal stall surfaced via `terminal_failure` metric, not silently retried), startup readiness probe, bounded claim loop, OTel metrics. Integration-tested S0–S11 (`tests/integration/audit-sealer-runner.test.ts`) incl. the §8.3 no-duplicate byte-identical recovery proof. ADR-022–026 Accepted; ADR-023 Option A(b) impl/tested PR #92; Phase 2.5 wired PR-B #98. B3 authorized + implemented (EP-006); see `specs/audit-sealer-b3-technical-plan.md` |
| Append/seal idempotency | capture: SOLVED; mark_sealed same-event: PARTIAL; **append→mark_sealed partial-failure: Option A(b) IMPLEMENTED/TESTED (PR #92)** | ADR-023 Option A(b) implemented/tested in PR #92 — deterministic `audit_event_id` = UUIDv5(org_id+capture_id) in `packages/core-audit/` (`auditAppend(eventId?)` lookup-after-lock + correspondence/payload-presence guards); `audit_events.id` is PK so no migration was needed. These former B3 preconditions are now satisfied — Phase 2.5/AuditBridge wiring (PR-B / EP-004) and the B3 runner (EP-006) are implemented and tested; ADR-028 accepted/merged |
| Stale-sealing recovery | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED (EP-006) | ADR-023; implemented as the SEPARATE stale-recovery path in `apps/audit-sealer/src/stale-recovery.ts` (reconstructs via the EP-005.5 `loadSealingCaptureForRecovery`, idempotent re-append + mark_sealed; recoverable rows advanced, unrecoverable/divergent rows terminal-failed + alerted). Tested S3/S5/S6 |
| Evidence completeness (counts, provider-without-audit) | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED (EP-008A/B/C) | EP-008A migration `0027` ships three read-only `security_invoker` evidence views — `govai.evidence_capture_completeness` (EC-1.a), `govai.evidence_chain_backlog` (EC-1.b), `govai.evidence_provider_without_audit` (EC-3a); EP-008B adds the best-effort EC-3b drop/capture OTel counters (`govai_audit_bridge_drops_total` / `govai_audit_bridge_captures_total`, cardinality-safe, observe-only) in `apps/api/src/pipeline/audit-bridge-metrics.ts`; EP-008C adds stream-terminal completeness (the terminal `PassthroughInvoked` fires on every stream termination via `@govai/provider-stream-http`, with `stream_outcome` in the envelope + the capture projection); the OTel MeterProvider exporting the counters is the shared `@govai/observability` bootstrap (EP-OBS-REFACTOR). The reporting/metrics layer EXISTS; the operator/auditor cockpit read surface (EC-4 run-lifecycle + EC-5 reports) remains (EP-008D / Phase-4 §7) |

### Runtime-to-evidence wiring (WIRED — PR-B / EP-004, source + integration verified)

This was the loose thread between runtime and the evidence plane; **PR-B (EP-004) wires it.** **Source-verified on the EP-004 branch (base main `d2c2785`); integration-tested against real Postgres:**

1. **Direct governed-native and passthrough routes now dispatch into the B0/B1 capture outbox.** Each route's `emitAuditEvent` closure keeps its existing `app.log.info(...)` line AND appends `await auditBridge(event, requestIdentityAls.getStore())`, where `auditBridge = makeAuditBridge({ pool: app.govai.pool, log: app.log })` — in all four of `routes/governed-openai.ts`, `routes/governed-anthropic.ts`, `routes/passthrough-openai.ts`, `routes/passthrough-anthropic.ts`.
2. **An ingress identity hook** (`pipeline/request-identity-hook.ts`, registered once in `server.ts` via `registerRequestIdentityHook(app)`) builds the per-request `AuditBridgeRequestIdentity` for the four direct-route prefixes (reading `X-GovAI-Idempotency-Key`), enters it into `requestIdentityAls` so the dispatcher reads the SAME identity, echoes `X-GovAI-Request-Id`, and returns HTTP 400 `invalid_idempotency_key` on a malformed key. The passthrough producers take an injectable clock (`now?`) so an idempotent replay can hold `occurred_at` stable.
3. **`captureAuditEvent` now has runtime call-sites** (via `makeAuditBridge` → `pipeline/audit-bridge.ts`). The AuditBridge validates/narrows `event: unknown` via `PassthroughInvokedSchema` (v4) before mapping to `captureAuditEvent` → outbox; it is best_effort (never fails the request path).
4. **Integration-tested end-to-end:** `tests/integration/audit-bridge-wiring.test.ts` (one capture row per route; rev4 `redaction_metadata.audit_bridge` shape; RLS isolation; no banned keys/raw content; byte-fidelity non-regression; best_effort on capture failure; ingress 400 + `X-GovAI-Request-Id`) and `tests/integration/audit-bridge-idempotency.test.ts` (the same-key replay REUSE proof I3 — one row, stable `capture_seq`, no conflict — and the divergent-`occurred_at` CONFLICT proof I4 — 23505 → error log → request still 2xx → no second row).
5. **B3 seals captures already in the outbox.** With the four direct routes now feeding the outbox (PR-B #98) and the B3 runner implemented (EP-006, `apps/audit-sealer`), the runtime → capture → seal arc is closed: direct-route runtime events are captured to the outbox and the dedicated sealer advances them into the HMAC chain.

Separately documented (not the same path):
- **`/v1/runs` orchestrator writes some audit events directly to the HMAC chain via `auditAppend`** (run lifecycle: deny/complete/fail/run) — `run-orchestrator.ts:527,618,736,799,885,963,1229,1328`. This is the legacy append chain, **not** the capture outbox.
- **Regulatory** (`regulatory/service.ts:249`) and **admin provider credentials** (`admin-provider-credentials.ts:164,289`) also write via `auditAppend` directly.

**Status lines:**
- Runtime-to-evidence dispatch for **direct governed-native / passthrough** routes: **IMPLEMENTED & INTEGRATION-TESTED (PR-B / EP-004)** — the AuditBridge (ADR-027) is wired into all four routes; `event: unknown` is validated/narrowed via `PassthroughInvokedSchema` (v4) before `captureAuditEvent` → outbox. ADR-027 supersedes the older passthrough "Governed Run pipeline (PR3+)" absorption intent for direct routes; `/v1/runs` remains distinct and chain-authoritative via `auditAppend`.
- Direct-route request identity (**ADR-028**): **IMPLEMENTED** — an ingress hook mints `govai_request_id` + optional `X-GovAI-Idempotency-Key`; the AuditBridge `captureId` is the deterministic UUIDv5 (NOT `audit_event_id`), and `payloadHash` is the stable `AuditBridgeCapturePayloadV1` projection. Same-key replay reuse (I3) and divergent-`occurred_at` conflict (I4) are proven end-to-end.
- Evidence primitives (B0/B1/B2): `IMPLEMENTED_FOUNDATIONAL_CONTROL`.
- Continuous sealer runner (B3): **IMPLEMENTED & INTEGRATION-TESTED (EP-006, `apps/audit-sealer`)** — Shape-S choreography (SPEC-B3 §1), the SEPARATE stale-recovery path, startup probe, bounded loop, OTel metrics; S0–S11 against real Postgres. ADR-023 Option A(b) impl/tested PR #92; AuditBridge wiring impl/tested PR-B #98; B3 authorized + implemented. (A B0 `failed→sealing` "unstick" migration for a terminally-stalled chain is a SEPARATE future decision, not in EP-006.)
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

Summarized in [stale-docs-register.md](./stale-docs-register.md): README status block, `workroom-governance-room.md` status, and ADR-020 role-model wording. ADR-022..026 are Accepted and B3 (EP-006) is implemented; see the PR-B / EP-004 and EP-006 reconciliation sections in stale-docs-register.md.

---

## 7. Current non-negotiables

- **Provider-native semantics are sacred** (no re-serialization / hidden defaults / schema narrowing on the native surface).
- **No provider traffic in the AuditSealer.**
- **Evidence failure is evidence-plane health, not provider UX failure** for low-risk traffic.
- **No runtime hard-deny claim** unless implemented and tested.
- **No compliance/legal/certification claim** unless validated externally.
- **No document is a source of truth unless it distinguishes evidence from target architecture.**
- **Runtime route existence does not imply runtime evidence capture** (see §3).
