# GovAI Current State

## Status

- **Evidence-first source of truth** for the current implementation state of GovAI.
- **B3 (the AuditSealer runner) is authorized and implemented (EP-006).** `apps/audit-sealer` ships the dedicated runner; it consumes no provider traffic and runs outside the request hot path (see §3 and §7).
- Distinguishes runtime implementation, foundational controls, provider-native evidence, target architecture, stale docs, and unverified claims. Generated from repository **source manifests** at main `e422280d63d52da2ed08fb488146266b2ef7dac0`, not from memory.
- **Three P0 "Truth and Integrity" packages have landed:** P0.1 (F5+F6, PR #118, `ed18736a`), P0.2 (F1+C-2, PR #119, `19bcb452`) and the F4 preventive hardening (PR #120, merge `719fefc2`). F2 and F3 remain open. See §8 for the canonical F1–F6 + C-2 matrix, the F4 canonical state and the narrow follow-up register.
- **EP-DOCS-04 / PR #121 is merged and dual-verified:** squash `e422280d`, tree `196701d8`, single parent `719fefc2`. It reconciles the canonical P0 record and changes no executable behavior.
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
- API route files (`apps/api/src/routes/*`): **18** (17 routes + `_not-implemented.ts`; `evidence.ts` added by EP-008D)
- DB migrations (`apps/api/src/db/migrations/*`): **27** (0001..0028, **missing** 0006; highest `0028_evidence_enumerator_policy.sql`)
- test files (`*.test.ts`/`*.spec.ts`): **181** on disk — **109** unit (under `apps/`+`packages/`), **67** under `tests/integration/`, **5** under `tests/live/` (live-gated, always excluded). Since the PR #116 `GOVAI_INTEGRATION` config gate (`vitest.config.ts`), the default `pnpm test` is **unit-only** (109 files, **1258** tests, reproduced locally at this anchor); `pnpm test:integration` adds the integration files (CI runs both jobs)

---

## 1. Runtime surfaces

All surfaces registered in `apps/api/src/server.ts:156-176` (the direct-route identity hook registers at `:170`). Status reflects **runtime execution**; audit-evidence capture is a separate axis (§3).

| Surface | Status | Route/entrypoint | Handler/service | Tests | Limitations | Next step |
|---|---|---|---|---|---|---|
| Health | IMPLEMENTED_RUNTIME_SOURCE_VERIFIED_TESTS_NOT_LOCATED | `routes/health.ts` (`server.ts:156`) | inline | dedicated route test not located in this review | liveness/readiness | — |
| Capabilities | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/capabilities.ts` (`:157`) | `@govai/core-governance` | `tests/integration/capabilities-by-org.test.ts` | per-org view; default-deny | — |
| `/v1/runs` | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/runs.ts` (`:158`) | `pipeline/run-orchestrator.ts` | `tests/integration/governed-run-e2e.test.ts`, `runs-passthrough-mode.test.ts` | governed+passthrough; writes run-lifecycle audit to chain via `auditAppend` (§3) | — |
| Audit events | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/audit-events.ts` (`:159`) | reads HMAC chain | `audit-events-rls.test.ts`, `audit-events-pagination.test.ts` | read-only | — |
| Admin audit crypto-shred | PLANNED | `routes/admin-audit-shred.ts:41` (`sendNotImplemented … 'PR3'`) | stub | n/a | not-implemented stub; `crypto_shredded` state + ADR-011 exist in schema | implement later |
| Admin DLP detector CRUD | PLANNED | `routes/admin-dlp.ts:40` (`sendNotImplemented … 'PR3'`) | stub | n/a | admin CRUD stub; DLP pre-scan itself runs in governed surfaces | implement later |
| Passthrough Anthropic | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED + IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | `routes/passthrough-anthropic.ts` (`:163`) | `@govai/provider-anthropic` | `tests/integration/anthropic-passthrough.test.ts` + raw-body tests | audit emission: logger + AuditBridge → B1 capture outbox, integration-tested (PR-B, §3) | — |
| Passthrough OpenAI | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED + IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | `routes/passthrough-openai.ts` (`:164`) | `@govai/provider-openai` | `tests/integration/openai-passthrough.test.ts` + raw-body tests | audit emission: logger + AuditBridge → B1 capture outbox, integration-tested (PR-B, §3) | — |
| Governed Anthropic | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/governed-anthropic.ts` (`:165`) | `@govai/provider-anthropic/governed` | `tests/integration/governed-anthropic.test.ts` | direct governed-native audit emission: `app.log.info` + AuditBridge → B1 capture outbox, integration-tested (PR-B, §3) | — |
| Governed OpenAI | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/governed-openai.ts` (`:166`) | `@govai/provider-openai/governed` | `tests/integration/governed-openai.test.ts` | direct governed-native audit emission: `app.log.info` + AuditBridge → B1 capture outbox, integration-tested (PR-B, §3) | — |
| Admin provider credentials | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `routes/admin-provider-credentials.ts` (`:171`) | KMS envelope; `auditAppend` (`:165,289`) | `admin-provider-credentials-*.test.ts` (6 files) | SET/GET/REVOKE; no rotation policy | — |
| Workrooms (Phase 1) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workrooms.ts` (`:172`) | inline; migration 0012 | `tests/integration/workroom-participants.test.ts` (+ ~20 workroom tests) | partial runtime (Phase 1) | — |
| Workroom transcript (Phase 2) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-transcript.ts` (`:173`) | migration 0013 | `workroom-messages.test.ts`, `workroom-audit-subview.test.ts` | partial runtime (Phase 2) | — |
| Workroom runs (Phase 3) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-runs.ts` (`:174`) | `run-orchestrator.ts` `WorkroomRunContext`; migration 0014 | `workroom-runs.test.ts`, `workroom-runs-mode.test.ts` | partial runtime (Phase 3) | — |
| Workroom approvals (Phase 4) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-approvals.ts` (`:175`) | migration 0015 | `workroom-approvals.test.ts`, `workroom-approvals-runs.test.ts` | partial runtime (Phase 4); SoD/TOCTOU | — |
| Regulatory | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `routes/regulatory.ts` (`:176`) | `regulatory/service.ts`; migrations 0016–0024 | `regulatory-*.test.ts` (11 files) | **evidence only, not runtime enforcement** (§4/§5) | — |
| Evidence read API (`/v1/evidence`) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED (EP-008D) | `routes/evidence.ts` (`:160`) | `pipeline/evidence-reports.ts` (EC summary + gap lists) | `tests/integration/evidence-reports.test.ts`, `evidence-cockpit.test.ts` | read-only, RLS-scoped (the auditor IS the tenant — per-org view, no cross-tenant operator role); `/gaps` enum `ec1\|ec2\|ec3seal\|ec3drop\|ec4`; EC-5 deferred | real EC-5 (separate Option-A EP) |

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
| Evidence completeness (counts, provider-without-audit) | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED (EP-008A/B/C) | EP-008A migration `0027` ships three read-only `security_invoker` evidence views — `govai.evidence_capture_completeness` (EC-1.a), `govai.evidence_chain_backlog` (EC-1.b), `govai.evidence_provider_without_audit` (EC-3a); EP-008B adds the best-effort EC-3b drop/capture OTel counters (`govai_audit_bridge_drops_total` / `govai_audit_bridge_captures_total`, cardinality-safe, observe-only) in `apps/api/src/pipeline/audit-bridge-metrics.ts`; EP-008C adds stream-terminal completeness (the terminal `PassthroughInvoked` fires on every stream termination via `@govai/provider-stream-http`, with `stream_outcome` in the envelope + the capture projection); the OTel MeterProvider exporting the counters is the shared `@govai/observability` bootstrap (EP-OBS-REFACTOR). The reporting/metrics layer EXISTS, and the read surface shipped after this row was first written: EP-008D (PR #113, main `8eb1eab`) added the EC reports (`pipeline/evidence-reports.ts`), the RLS-scoped `/v1/evidence` read API (`routes/evidence.ts` — the auditor IS the tenant; per-org accumulation, no cross-tenant operator role) and EC-4 run-lifecycle coverage; EP-OBS-COLLECTOR (PR #114, `d2fef204`) added the OTLP collector/Prometheus/Grafana stack; EP-EVIDENCE-GAUGE-WIRING (PR #115, `2f620b47`, migration `0028`) wired the `govai_evidence_*` gauges into `apps/api` boot behind the least-privilege `govai_evidence_enumerator` role (INV-1: no single DB identity holds enumerate+read). Real EC-5 remains deferred to a separate Option-A EP. Tests: `tests/integration/evidence-completeness.test.ts` (EP-008A views + tenant isolation + security_invoker catalog guard); the `@govai/provider-stream-http` helper unit tests (`packages/provider-stream-http/src/index.test.ts`) + the four per-surface stream-terminal e2e (`packages/provider-{anthropic,openai}/src/{routes,governed}/register-*.stream-terminal.test.ts`) (EP-008C); the EC-3b counter coverage in `apps/api/src/pipeline/audit-bridge-metrics.test.ts` (EP-008B) |

### Runtime-to-evidence wiring (WIRED — PR-B / EP-004, source + integration verified)

This was the loose thread between runtime and the evidence plane; **PR-B (EP-004) wires it.** **Source-verified on the EP-004 branch (base main `d2c2785`); integration-tested against real Postgres:**

1. **Direct governed-native and passthrough routes now dispatch into the B0/B1 capture outbox.** Each route's `emitAuditEvent` closure keeps its existing `app.log.info(...)` line AND appends `await auditBridge(event, requestIdentityAls.getStore())`, where `auditBridge = makeAuditBridge({ pool: app.govai.pool, log: app.log })` — in all four of `routes/governed-openai.ts`, `routes/governed-anthropic.ts`, `routes/passthrough-openai.ts`, `routes/passthrough-anthropic.ts`.
2. **An ingress identity hook** (`pipeline/request-identity-hook.ts`, registered once in `server.ts` via `registerRequestIdentityHook(app)`) builds the per-request `AuditBridgeRequestIdentity` for the four direct-route prefixes (reading `X-GovAI-Idempotency-Key`), runs the remainder of the request lifecycle inside a request-owned `requestIdentityAls.run()` scope so the dispatcher reads the SAME identity (the F4 preventive hardening, PR #120 — see §8), echoes `X-GovAI-Request-Id` (the echo does not reach direct streaming responses — a pre-existing, separately-tracked gap; §8), and returns HTTP 400 `invalid_idempotency_key` on a malformed key. The passthrough producers take an injectable clock (`now?`) so an idempotent replay can hold `occurred_at` stable.
3. **`captureAuditEvent` now has runtime call-sites** (via `makeAuditBridge` → `pipeline/audit-bridge.ts`). The AuditBridge validates/narrows `event: unknown` via `PassthroughInvokedSchema` (v4) before mapping to `captureAuditEvent` → outbox; it is best_effort (never fails the request path).
4. **Integration-tested end-to-end:** `tests/integration/audit-bridge-wiring.test.ts` (one capture row per route; rev4 `redaction_metadata.audit_bridge` shape; RLS isolation; no banned keys/raw content; byte-fidelity non-regression; best_effort on capture failure; ingress 400 + `X-GovAI-Request-Id`) and `tests/integration/audit-bridge-idempotency.test.ts` (the same-key replay REUSE proof I3 — one row, stable `capture_seq`, no conflict — and the divergent-`occurred_at` CONFLICT proof I4 — 23505 → error log → request still 2xx → no second row).
5. **B3 seals captures already in the outbox.** With the four direct routes now feeding the outbox (PR-B #98) and the B3 runner implemented (EP-006, `apps/audit-sealer`), the runtime → capture → seal arc is closed: direct-route runtime events are captured to the outbox and the dedicated sealer advances them into the HMAC chain.

Separately documented (not the same path):
- **`/v1/runs` orchestrator writes some audit events directly to the HMAC chain via `auditAppend`** (run lifecycle: deny/complete/fail/run) — `run-orchestrator.ts:558,643,761,829,915,993,1264,1363`. This is the legacy append chain, **not** the capture outbox.
- **Regulatory** (`regulatory/service.ts:249`) and **admin provider credentials** (`admin-provider-credentials.ts:165,289`) also write via `auditAppend` directly.

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

---

## 8. P0 findings register (F1–F6, C-2) and F4 canonical state

The P0 "Truth and Integrity" program tracks source findings about evidence truthfulness (see the roadmap's operational-priority register for sequencing). The canonical per-finding state at main `e422280d` is the **matrix below** — deliberately **no aggregate count** ("N findings") is asserted, because F2's classification is pending a separate source adjudication and any total would prejudge it.

| Finding | Classification | Implementation status | Landed by / next | Subject |
|---|---|---|---|---|
| F1 | DEMONSTRATED | CORRECTED | P0.2 / `19bcb452` (PR #119) | real provider-credential provenance |
| F2 | PENDING_SOURCE_CLASSIFICATION | OPEN | separate source adjudication + sealed-schema decision (do not classify as demonstrated, latent or disproved before that) | block-source provenance / sealed-schema decision |
| F3 | DEMONSTRATED | OPEN | P0.3 transaction and dispatch-state program | transaction and dispatch-state work |
| F4 | LATENT_ARCHITECTURAL_RISK_NOT_OBSERVED_AS_FAILURE | PREVENTIVE_HARDENING_MERGED_AND_DUAL_VERIFIED | PR #120 / merge `719fefc2`, tree `c13d83db` | AuditBridge request-identity lifecycle scoping |
| F5 | DEMONSTRATED | CORRECTED | P0.1 / `ed18736a` (PR #118) | demonstrated overlapping-span redaction paths |
| F6 | DEMONSTRATED | CORRECTED | P0.1 / `ed18736a` (PR #118) | evidence counts derived from fused spans |
| C-2 | DEMONSTRATED — catalogued **SEPARATE from the F1–F6 numbering** | CORRECTED | P0.2 / `19bcb452` (PR #119) | real SHA-256 of the blocked native request body (`run-orchestrator.ts:803`) |

### EP-DOCS-04 / PR #121 canonical state

```text
PR121_STATUS=MERGED_AND_DUAL_VERIFIED
PR121_MERGE_SHA=e422280d63d52da2ed08fb488146266b2ef7dac0
PR121_MERGE_TREE=196701d877cc40d977197529f809985162c9254c
PR121_MERGE_PARENT=719fefc25502bb9f7547743f339b38fa3a20c4c7
PR121_PARENT_COUNT=1
PR121_SCOPE=THREE_ARCHITECTURE_DOCS_PLUS_COMMENT_ONLY_ALS_CORRECTION
PR121_RUNTIME_CHANGE=NONE
PR121_MAIN_CI=GREEN
PR121_FABLE5_MERGE_VERIFY=PASS
PR121_OPUS_MERGE_VERIFY=PASS
```

The squash tree is byte-identical to the reviewed PR head tree.
PR #121 does not change the F1–F6 + C-2 classification matrix and
is not a second F4 runtime implementation.

### F4 canonical state

```text
F4_CODE_STATUS=CLOSED
F4_CLASSIFICATION=PREVENTIVE_HARDENING
F4_BASELINE_FALSIFICATION_RESULT=NO_OBSERVABLE_FAILURE_REPRODUCED
F4_MERGE_SHA=719fefc25502bb9f7547743f339b38fa3a20c4c7
F4_MERGE_TREE=c13d83dbc78b7ddda81b542cb6fab568623a54ff
F4_DUAL_DIFF_VERIFY=PASS
F4_DUAL_MERGE_VERIFY=PASS
F4_MAIN_CI=GREEN
```

F4 is **preventive hardening** — it is NOT a proven cross-request contamination defect, NOT a repaired evidence lie, and NOT a reproduced production failure:

- The deterministic falsification harness (`tests/integration/request-identity-isolation.test.ts`) reproduced **no** observable identity contamination and **no** delayed-stream context loss against the tested previous implementation.
- `enterWith()` nevertheless lacked an explicit callback-owned restoration boundary.
- The merged change places Fastify's continuation (`done()`) inside `AsyncLocalStorage.run()` in `pipeline/request-identity-hook.ts`.
- Asynchronous resources created by that continuation retain the request-owned store; the caller's previous ambient context is restored when the `run()` callback returns.
- The harness is now a permanent regression guard for the asynchronous and transactional work expected in P0.3.
- The harness cleanup fix tracks complete request Promises, so parked requests cannot obscure the original test failure.

### Separate P1 evidence-integrity register

- **LOCAL_DENY_EVIDENCE_INCOMPLETENESS** — separate P1
  evidence-integrity family, outside the F1–F6 + C-2 numbering and
  outside the narrow EP-11 implementation scope. Subfamily A,
  `LOCAL_DENY_EVENT_EMITTED_THEN_DROPPED`, currently includes
  `passthrough.beta_denied` and `tool.validation_blocked`.
  Subfamily B, `LOCAL_DENY_NO_AUDIT_EVENT_EMITTED`, includes the
  current `purpose_deprecated_post_sunset` branch. The
  owner-adjudicated decision remains staged outside the repository
  as ADR-032; once promulgated, it requires removal of that specific
  branch. Class-wide evidence remediation remains a separate EP.

### F4 follow-up register (narrow, non-blocking)

- **SEEDORG_FLAKE_CANDIDATE** — root cause: **UNVERIFIED**. Observed symptom: an earlier unrelated integration attempt reported a primary-key prefix collision. Status: follow-up test-harness investigation; priority: does not block F4 closure. `seedOrg` itself is unmodified.
- **DIRECT_STREAM_REQUEST_ID_HEADER_GAP** — status: **PRE_EXISTING**; introduced by F4: NO; F4-blocking: NO. Direct streaming responses do not carry the `X-GovAI-Request-Id` echo; resolving it is a separate future behavior-and-compatibility decision.
