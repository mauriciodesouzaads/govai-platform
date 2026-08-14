# GovAI Current State

## Status

- **Evidence-first source of truth** for the current implementation state of GovAI.
- **B3 (the AuditSealer runner) is authorized and implemented (EP-006).** `apps/audit-sealer` ships the dedicated runner; it consumes no provider traffic and runs outside the request hot path (see §3 and §7).
- Distinguishes runtime implementation, foundational controls, provider-native evidence, target architecture, stale docs, and unverified claims. Generated from repository **source manifests** at main `f381d3fac24d5938aed91b6618ef511b66ddc878` (post-P0.3-C / PR #129), not from memory.
- **Five P0 "Truth and Integrity" packages have landed:** P0.1 (F5+F6, PR #118, `ed18736a`), P0.2 (F1+C-2, PR #119, `19bcb452`), the F4 preventive hardening (PR #120, merge `719fefc2`), **P0.3-A (F3 durable provider dispatch, PR #123, squash `165291d9`)** and **P0.3-C (cross-request run execution idempotency, PR #129, squash `f381d3fa`)**. The **P0.3 runtime lane is COMPLETE**; F2 remains open (pending source classification), so the P0 Truth and Integrity **program** as a whole remains open. See §8 for the canonical F1–F6 + C-2 matrix, the F4 canonical state and the narrow follow-up register.
- **EP-DOCS-04 / PR #121 is merged and dual-verified:** squash `e422280d`, tree `196701d8`, single parent `719fefc2`. It reconciles the canonical P0 record and changes no executable behavior. EP-DOCS-05 / PR #122 (squash `4d6eab72`) rolled the canonical anchor to `e422280d`.
- **P0.3-A / PR #123 is merged:** squash `165291d9`, tree `93613383`, single parent `4d6eab72`, 38 files, one commit added to main; the squash tree is byte-identical to the audited PR head tree (`08b59930`). Post-merge main CI run `31282331366` SUCCESS (unit + integration). It moves provider network I/O outside database transactions and checked-out clients (§3 *Durable provider dispatch*). **F3: DEMONSTRATED → CORRECTED.**
- **EP-11 / ADR-032 provider-truth runtime correction is merged:** PR #126 squash `01c05fd6`, tree `20ccd433` (byte-identical to the audited PR head tree), single parent `629b6e9f` (the PR #125 ADR-032 promulgation), 6 files; post-merge main CI run `31649394857` SUCCESS (unit + integration). `ADR032_DECISION_STATUS=ACCEPTED`; `ADR032_REPOSITORY_PROMULGATION=COMPLETE` (PR #125); `ADR032_RUNTIME_IMPLEMENTATION=IMPLEMENTED` (PR #126). The ADR file's own promulgation-era `IMPLEMENTATION_STATUS=PENDING` pointer is registered as **localized documentary staleness** ([stale-docs-register.md](./stale-docs-register.md)) — deliberately not edited by this state roll; the accepted decision itself is not stale. See §8 *EP-11 / PR #126 canonical state*.
- **P0.3-C / PR #129 cross-request execution idempotency is merged:** squash `f381d3fac24d5938aed91b6618ef511b66ddc878`, tree `a64e7178` (byte-identical to the audited PR head `bfa05c5b`), single parent `21afa116` (the PR #128 authorization-semantics merge), 8 files; post-merge main CI run `31802636887` SUCCESS (unit + integration). P0.3-C implements **cross-request execution idempotency for the two governed run-creation surfaces** (`POST /v1/runs`, `POST /v1/workrooms/:id/runs`) via the optional `X-GovAI-Run-Idempotency-Key` header, the immutable tenant-scoped `govai.run_idempotency` binding (migration 0030) and the canonical `govai.run_execution_intent.v1` semantic-intent correspondence. It does **not** claim provider-side exactly-once (§3).
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

- architecture docs (`docs/architecture/**.md`): **67**
- regulatory docs (`docs/architecture/regulatory/*.md`): **20** (18–25 series present; **no** 26–30 files exist)
- ADR docs (`docs/architecture/adr/*.md`): **24** (ADR-001..014 + ADR-020..028 + ADR-032; **missing** ADR-015..019 and ADR-029..031; ADR-032 is the most recent — `Accepted` and in main, added by PR #125)
- API route files (`apps/api/src/routes/*`): **18** (17 routes + `_not-implemented.ts`; `evidence.ts` added by EP-008D)
- DB migrations (`apps/api/src/db/migrations/*`): **29** (0001..0030, **missing** 0006; highest `0030_run_idempotency.sql` — the P0.3-C immutable execution-idempotency binding)
- test files (`*.test.ts`/`*.spec.ts`): **194** on disk — **113** unit (under `apps/`+`packages/`; P0.3-C added `apps/api/src/pipeline/run-idempotency.test.ts`), **76** under `tests/integration/` (P0.3-C added `run-idempotency.test.ts` + `workroom-run-idempotency.test.ts`), **5** under `tests/live/` (live-gated, always excluded). Since the PR #116 `GOVAI_INTEGRATION` config gate (`vitest.config.ts`), the default `pnpm test` is **unit-only** (113 files, **1316** tests, reproduced locally at this anchor); `pnpm test:integration` adds the integration files (CI runs both jobs)

---

## 1. Runtime surfaces

All surfaces registered in `apps/api/src/server.ts:161-181` (the direct-route identity hook registers at `:175`; the P0.3-A dispatch-recovery worker starts at `:191`). Status reflects **runtime execution**; audit-evidence capture is a separate axis (§3).

| Surface | Status | Route/entrypoint | Handler/service | Tests | Limitations | Next step |
|---|---|---|---|---|---|---|
| Health | IMPLEMENTED_RUNTIME_SOURCE_VERIFIED_TESTS_NOT_LOCATED | `routes/health.ts` (`server.ts:161`) | inline | dedicated route test not located in this review | liveness/readiness | — |
| Capabilities | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/capabilities.ts` (`:162`) | `@govai/core-governance` | `tests/integration/capabilities-by-org.test.ts` | per-org view; default-deny | — |
| `/v1/runs` | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/runs.ts` (`:163`) | `pipeline/run-orchestrator.ts` + the P0.3-A durable dispatch layer (`run-dispatch-config.ts`, `run-dispatch-state.ts`, `run-dispatch-recovery.ts`) + the P0.3-C execution-idempotency layer (`pipeline/run-idempotency.ts`) | `tests/integration/governed-run-e2e.test.ts`, `runs-passthrough-mode.test.ts`, the `run-dispatch-*.test.ts` suites, `runs-status-endpoint.test.ts`, `run-idempotency.test.ts` (P0.3-C) | governed+passthrough; run-lifecycle chain evidence via the durable dispatch layer (§3); tenant-isolated status polling `GET /v1/runs/:run_id` (`routes/runs.ts:165`); optional `X-GovAI-Run-Idempotency-Key` — tenant-scoped execution-idempotency binding with canonical semantic-intent correspondence: a matching replay returns the current durable run (200 + `X-GovAI-Run-Idempotent-Replay`), a divergent same-key intent is 409 `idempotency_key_conflict` (distinct from the AuditBridge `X-GovAI-Idempotency-Key`, which stays direct-route evidence identity) | — |
| Audit events | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/audit-events.ts` (`:164`) | reads HMAC chain | `audit-events-rls.test.ts`, `audit-events-pagination.test.ts` | read-only | — |
| Admin audit crypto-shred | PLANNED | `routes/admin-audit-shred.ts:41` (`sendNotImplemented … 'PR3'`) | stub | n/a | not-implemented stub; `crypto_shredded` state + ADR-011 exist in schema | implement later |
| Admin DLP detector CRUD | PLANNED | `routes/admin-dlp.ts:40` (`sendNotImplemented … 'PR3'`) | stub | n/a | admin CRUD stub; DLP pre-scan itself runs in governed surfaces | implement later |
| Passthrough Anthropic | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED + IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | `routes/passthrough-anthropic.ts` (`:168`) | `@govai/provider-anthropic` | `tests/integration/anthropic-passthrough.test.ts` + raw-body tests | audit emission: logger + AuditBridge → B1 capture outbox, integration-tested (PR-B, §3) | — |
| Passthrough OpenAI | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED + IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | `routes/passthrough-openai.ts` (`:169`) | `@govai/provider-openai` | `tests/integration/openai-passthrough.test.ts` + raw-body tests | audit emission: logger + AuditBridge → B1 capture outbox, integration-tested (PR-B, §3); the retired GovAI-local Files `purpose=assistants` date policy (local deny/warning) was removed by EP-11 (PR #126) — Files requests follow the normal provider-forwarding/result-evidence path (a narrow claim; not a broader OpenAI compatibility guarantee) | — |
| Governed Anthropic | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/governed-anthropic.ts` (`:170`) | `@govai/provider-anthropic/governed` | `tests/integration/governed-anthropic.test.ts` | direct governed-native audit emission: `app.log.info` + AuditBridge → B1 capture outbox, integration-tested (PR-B, §3) | — |
| Governed OpenAI | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/governed-openai.ts` (`:171`) | `@govai/provider-openai/governed` | `tests/integration/governed-openai.test.ts` | direct governed-native audit emission: `app.log.info` + AuditBridge → B1 capture outbox, integration-tested (PR-B, §3) | — |
| Admin provider credentials | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `routes/admin-provider-credentials.ts` (`:176`) | KMS envelope; `auditAppend` (`:165,289`) | `admin-provider-credentials-*.test.ts` (6 files) | SET/GET/REVOKE; no rotation policy | — |
| Workrooms (Phase 1) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workrooms.ts` (`:177`) | inline; migration 0012 | `tests/integration/workroom-participants.test.ts` (+ ~20 workroom tests) | partial runtime (Phase 1) | — |
| Workroom transcript (Phase 2) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-transcript.ts` (`:178`) | migration 0013 | `workroom-messages.test.ts`, `workroom-audit-subview.test.ts` | partial runtime (Phase 2) | — |
| Workroom runs (Phase 3) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-runs.ts` (`:179`) | `run-orchestrator.ts` `WorkroomRunContext`; migration 0014 | `workroom-runs.test.ts`, `workroom-runs-mode.test.ts`, `workroom-run-idempotency.test.ts` (P0.3-C) | partial runtime (Phase 3); P0.3-C covers `POST /v1/workrooms/:id/runs` — current membership authorization stays mandatory (key knowledge is never an authorization capability), a matching replay does not consume the approval twice, approval provenance participates in the semantic-intent correspondence, and an in-progress replay does not fabricate a `run_event` turn | — |
| Workroom approvals (Phase 4) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED | `routes/workroom-approvals.ts` (`:180`) | migration 0015 | `workroom-approvals.test.ts`, `workroom-approvals-runs.test.ts` | partial runtime (Phase 4); SoD/TOCTOU | — |
| Regulatory | IMPLEMENTED_FOUNDATIONAL_CONTROL_SOURCE_AND_TEST_VERIFIED | `routes/regulatory.ts` (`:181`) | `regulatory/service.ts`; migrations 0016–0024 | `regulatory-*.test.ts` (11 files) | **evidence only, not runtime enforcement** (§4/§5) | — |
| Evidence read API (`/v1/evidence`) | IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED (EP-008D) | `routes/evidence.ts` (`:165`) | `pipeline/evidence-reports.ts` (EC summary + gap lists) | `tests/integration/evidence-reports.test.ts`, `evidence-cockpit.test.ts` | read-only, RLS-scoped (the auditor IS the tenant — per-org view, no cross-tenant operator role); `/gaps` enum `ec1\|ec2\|ec3seal\|ec3drop\|ec4`; EC-5 deferred | real EC-5 (separate Option-A EP) |

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
- **`/v1/runs` run-lifecycle chain writes flow through the P0.3-A durable dispatch layer** (`pipeline/run-dispatch-state.ts` — `auditAppend` call sites at `:149`, `:178`, `:350` — for the dispatch lifecycle events `run.dispatch_prepared`/`run.dispatch_claimed`/`run.outcome_unknown`/`run.outcome_reconciled`, the terminal `run.completed`/`run.failed`/`run.denied`, and the governed `passthrough.invoked` v4 capture). The orchestrator retains one direct `auditAppend` at `run-orchestrator.ts:947` (the in-transaction governed `run.denied` path). This is the HMAC append chain, **not** the capture outbox.
- **Regulatory** (`regulatory/service.ts:249`) and **admin provider credentials** (`admin-provider-credentials.ts:165,289`) also write via `auditAppend` directly.

### Durable provider dispatch (P0.3-A / F3 — PR #123, squash `165291d9`)

F3 (DEMONSTRATED: provider network I/O inside database transactions / checked-out clients) is **CORRECTED** at this anchor. The merged design:

- **Dispatch boundary:** the run is prepared and committed in TX-A (`run.dispatch_prepared` — run row + real `native_request_hash` durable **before** any provider I/O), exactly one executor wins the `queued→running` CAS (`run.dispatch_claimed`), the provider forward happens **outside** any database transaction and outside checked-out clients, and the outcome is finalized in a separate transaction (`pipeline/run-dispatch-config.ts`, `run-dispatch-state.ts`, `run-orchestrator.ts`).
- **Honest unknown semantics:** when the system cannot prove whether the provider received the request, the run terminates as `run.outcome_unknown` (closed `ForwardObservation` semantics, `packages/core-events/src/run-dispatch-lifecycle.ts`) — **never retried, never classified as failed**. A later reconciliation to a known **HTTP provider result** (with a persisted invocation) appends `run.outcome_reconciled` idempotently — the only reconciliation marker the state machine emits (`run-dispatch-state.ts:955-957`). There is **no exactly-once claim**.
- **Bounded recovery:** a periodic worker (`pipeline/run-dispatch-recovery.ts`, started in `server.ts:191`) recovers stale claims within explicit bounds, deciding the branch atomically on the durable boundary (`run-dispatch-state.ts:1191-1247`): boundary **absent** → the mandatory durable gate never committed, so provider invocation was structurally impossible → KNOWN `run.failed` with `dispatch_never_started` (never an unknown); boundary **present** → the gate was crossed but nothing past it is provable → honest `run.outcome_unknown` (`stale_dispatch_claim`, `forward_observation='not_observed'`). Every `run.outcome_unknown` is therefore post-boundary by construction; recovery never calls a provider and never generates a token.
- **Forensic lifecycle evidence:** the lifecycle/status transitions (`run.dispatch_prepared`/`run.dispatch_claimed`, the terminals, `run.outcome_unknown`/`run.outcome_reconciled`) append chain events with deterministic payload hashes; the bound lifecycle chronology rides the database clock so it can never contradict the transition order. The durable boundary commit itself is the deliberate exception: `commitDispatchBoundary()` (`run-dispatch-state.ts:481-505`) only records `dispatch_boundary_committed_at` (a `clock_timestamp()` CAS) and appends **no chain event of its own** — its timestamp is deferred-bound into the later evidence: `run.outcome_unknown` requires it by schema, and the `run.completed`/`run.failed` terminals (including `dispatch_pre_forward_failed`) bind it into both the payload hash and the safe metadata whenever the boundary was crossed. A governed block is decided **pre-forward and therefore pre-boundary** — the handler returns `blocked` at tool/enforcement validation before any `forwardRaw` call, and `beforeDispatch` commits the boundary inside `forwardRaw` immediately before `fetch` (`handle-responses.ts:265-303`, `packages/provider-*/src/passthrough/forward.ts:97-104`, `run-orchestrator.ts:1311-1317`) — so a blocked run has no committed boundary to bind, and its `run.denied` (`run-dispatch-state.ts:1059-1071`) hashing only `governed_blocked:${reason}` is consistent with that, **not** an evidence gap.
- **Tenant-isolated status polling:** `GET /v1/runs/:run_id` (`routes/runs.ts:165`), RLS-scoped.
- **Migration `0029_durable_provider_dispatch.sql`** adds the durable dispatch schema and the hardened M-B guard. **RLS process description (canonical):** `RLS_FORCE_SUSPENSION_USED=YES`, `RLS_DEFINER_FUNCTION_USED=NO` for the M-B decision count, `RLS_VISIBILITY_MECHANISM=OWNER_FORCE_SUSPENSION` (owner `NO FORCE ROW LEVEL SECURITY` window, `0029:110-115`), `RLS_ROW_SECURITY_OFF_ROLE=FAIL_CLOSED_ASSERTION` (`row_security=off` is armed so that any policy interference fails loudly, not to bypass). Stated precisely: the M-B decision count does **not** use a `SECURITY DEFINER` function; `SECURITY DEFINER` **remains in use elsewhere in 0029** — the recovery-discovery candidates primitive (`0029:460,497`).
- **Scope guard:** the shared provider handlers gained optional, orchestrator-only dispatch hooks (`beforeDispatch`/`dispatchSignal`/`monotonicDeadlineMs`/`onDispatchStart`/`preResolvedCredentialSource`); the direct governed/passthrough routes do not supply them, and their behavior and AuditBridge → outbox path are unchanged; `/v1/runs` stays chain-authoritative. Tests: `tests/integration/run-dispatch-{boundary,durability,unknown,recovery,approval-locks,migration-0029}.test.ts`, `runs-status-endpoint.test.ts`, plus the unit suites `run-dispatch-config.test.ts`, `run-dispatch-lifecycle.test.ts`, `dlp-dispatch-contract.test.ts`, `governed-v4-capture.test.ts`.

### Cross-request execution idempotency (P0.3-C — PR #129, squash `f381d3fa`)

P0.3-C adds the keyed-intent layer on top of F3 for both run-creation surfaces (`POST /v1/runs`, `POST /v1/workrooms/:id/runs`), composing with — never replacing — the F3 guarantees (`AT_MOST_ONE_LOCAL_FORWARD_INVOCATION_PER_RUN_ID`, honest `run.outcome_unknown`, recovery that never redispatches, late known-result reconciliation):

- **Identity:** optional `X-GovAI-Run-Idempotency-Key` header (distinct from the AuditBridge `X-GovAI-Idempotency-Key`); only the SHA-256 of the normalized key is ever persisted — the raw key is never stored, logged or forwarded upstream. Binding table `govai.run_idempotency` (migration `0030`): immutable, tenant-scoped (RLS ENABLE+FORCE), app-role grants SELECT+INSERT only; the composite PK `(org_id, idempotency_key_hash)` is the single PostgreSQL concurrency arbiter (`INSERT … ON CONFLICT DO NOTHING` reservation inside TX-A, before any duplicate-sensitive durable work).
- **Correspondence:** the canonical `govai.run_execution_intent.v1` semantic projection (actor, route scope, workspace, capability, model, input, resolved mode, metadata; the Workroom variant adds participant, workroom, task, governance mode and `effective_approval_request_id`), SHA-256 over a frozen canonical JSON. `provider_invocations.native_request_hash` is explicitly NOT the idempotency identity (it cannot encode the full logical intent — test-proven via metadata divergence and DLP-redaction convergence).
- **Semantics:** same tenant + same key + same canonical intent ⇒ ONE durable logical run — a matching replay returns the current durable state (200 + `X-GovAI-Run-Idempotent-Replay: true` + `Location`), with no second policy/DLP persistence, no approval consumption, no dispatch claim and **no intentional second local provider execution**. Divergent same-key intent ⇒ 409 `idempotency_key_conflict` (static body). No header ⇒ prior behavior unchanged (no auto-generated dedupe key). Workroom: a keyed approval is validated ONLY inside TX-A after the reservation winner is known; a matching replay after consumption mutates no approval state; current membership authorization is always required.
- **Explicit non-guarantees:** no attempts table, no TTL (v1), no automatic provider retry, no provider fallback, and **no provider-side exactly-once** (receipt, execution or transmission) — the strongest claim is that GovAI will not intentionally launch a second local provider execution for a matching tenant-scoped keyed intent.
- Tests: `apps/api/src/pipeline/run-idempotency.test.ts` (unit), `tests/integration/run-idempotency.test.ts` + `tests/integration/workroom-run-idempotency.test.ts` (real-Postgres winner arbitration, RLS/immutability, replay/conflict/authorization matrix, actual upstream-request counting).

**Status lines:**
- Runtime-to-evidence dispatch for **direct governed-native / passthrough** routes: **IMPLEMENTED & INTEGRATION-TESTED (PR-B / EP-004)** — the AuditBridge (ADR-027) is wired into all four routes; `event: unknown` is validated/narrowed via `PassthroughInvokedSchema` (v4) before `captureAuditEvent` → outbox. ADR-027 supersedes the older passthrough "Governed Run pipeline (PR3+)" absorption intent for direct routes; `/v1/runs` remains distinct and chain-authoritative via `auditAppend`.
- Direct-route request identity (**ADR-028**): **IMPLEMENTED** — an ingress hook mints `govai_request_id` + optional `X-GovAI-Idempotency-Key`; the AuditBridge `captureId` is the deterministic UUIDv5 (NOT `audit_event_id`), and `payloadHash` is the stable `AuditBridgeCapturePayloadV1` projection. Same-key replay reuse (I3) and divergent-`occurred_at` conflict (I4) are proven end-to-end.
- Evidence primitives (B0/B1/B2): `IMPLEMENTED_FOUNDATIONAL_CONTROL`.
- Continuous sealer runner (B3): **IMPLEMENTED & INTEGRATION-TESTED (EP-006, `apps/audit-sealer`)** — Shape-S choreography (SPEC-B3 §1), the SEPARATE stale-recovery path, startup probe, bounded loop, OTel metrics; S0–S11 against real Postgres. ADR-023 Option A(b) impl/tested PR #92; AuditBridge wiring impl/tested PR-B #98; B3 authorized + implemented. (A B0 `failed→sealing` "unstick" migration for a terminally-stalled chain is a SEPARATE future decision, not in EP-006.)
- `/v1/runs` run-lifecycle → audit chain (`auditAppend` via the P0.3-A durable dispatch layer, `run-dispatch-state.ts`): `IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED` (but to the chain, not the outbox). Durable dispatch boundary + honest `run.outcome_unknown` + bounded recovery: **IMPLEMENTED & INTEGRATION-TESTED (P0.3-A / PR #123)** — see *Durable provider dispatch* above.

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

Summarized in [stale-docs-register.md](./stale-docs-register.md): README status block, `workroom-governance-room.md` status, ADR-020 role-model wording, and the ADR-032 file's promulgation-era `IMPLEMENTATION_STATUS=PENDING` pointer (localized documentary staleness — the accepted decision is not stale; EP-11 is implemented). ADR-022..026 are Accepted and B3 (EP-006) is implemented; see the PR-B / EP-004 and EP-006 reconciliation sections in stale-docs-register.md.

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

The P0 "Truth and Integrity" program tracks source findings about evidence truthfulness (see the roadmap's operational-priority register for sequencing). The canonical per-finding state at main `f381d3fa` is the **matrix below** — deliberately **no aggregate count** ("N findings") is asserted, because F2's classification is pending a separate source adjudication and any total would prejudge it. EP-11 (PR #126) is a **subsequent provider-truth correction outside this matrix** — it is not an F-finding and must not be conflated with F2, which remains `OPEN_PENDING_SOURCE_CLASSIFICATION`.

| Finding | Classification | Implementation status | Landed by / next | Subject |
|---|---|---|---|---|
| F1 | DEMONSTRATED | CORRECTED | P0.2 / `19bcb452` (PR #119) | real provider-credential provenance |
| F2 | PENDING_SOURCE_CLASSIFICATION | OPEN | separate source adjudication + sealed-schema decision (do not classify as demonstrated, latent or disproved before that) | block-source provenance / sealed-schema decision |
| F3 | DEMONSTRATED | CORRECTED | P0.3-A / `165291d9` (PR #123) — durable provider dispatch; the remaining P0.3 slice (P0.3-C) landed as PR #129 / `f381d3fa` — the P0.3 runtime lane is COMPLETE | transaction and dispatch-state work |
| F4 | LATENT_ARCHITECTURAL_RISK_NOT_OBSERVED_AS_FAILURE | PREVENTIVE_HARDENING_MERGED_AND_DUAL_VERIFIED | PR #120 / merge `719fefc2`, tree `c13d83db` | AuditBridge request-identity lifecycle scoping |
| F5 | DEMONSTRATED | CORRECTED | P0.1 / `ed18736a` (PR #118) | demonstrated overlapping-span redaction paths |
| F6 | DEMONSTRATED | CORRECTED | P0.1 / `ed18736a` (PR #118) | evidence counts derived from fused spans |
| C-2 | DEMONSTRATED — catalogued **SEPARATE from the F1–F6 numbering** | CORRECTED | P0.2 / `19bcb452` (PR #119) | real SHA-256 of the blocked native request body (after PR #123 the real native-body hash is computed before the dispatch boundary — `run-orchestrator.ts:999` governed, `:1475` passthrough — and carried by the durable dispatch records) |

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

### P0.3-A / PR #123 canonical state

```text
PR123_STATUS=MERGED
PR123_MERGE_SHA=165291d90b144d3063ed87b8eaeac73e9a506e41
PR123_MERGE_TREE=93613383e9e0d78be3daa2641c491879f597595e
PR123_MERGE_PARENT=4d6eab725fa0b6939d90418bff74c08b62551144
PR123_PARENT_COUNT=1
PR123_AUDITED_HEAD=08b59930e3ad8920fec4ee5e7ec878264fca2253
PR123_TREE_EQUALS_AUDITED_HEAD_TREE=PASS
PR123_CHANGED_FILES=38
PR123_COMMITS_ADDED_TO_MAIN=1
PR123_POST_MERGE_MAIN_CI_RUN=31282331366
PR123_POST_MERGE_MAIN_CI=SUCCESS
PR123_SOURCE_BRANCH_PRESERVED=YES

F3_CLASSIFICATION=DEMONSTRATED
F3_STATUS=CORRECTED
P0_3_A=COMPLETE
P0_3_C=COMPLETE          (PR #129 — see the P0.3-C canonical state below;
                          was OPEN at the PR #123 anchor)
F2_STATUS=OPEN_PENDING_SOURCE_CLASSIFICATION
```

**RLS process description (migration 0029), canonical correction** — earlier
process reports described the M-B guard mechanism imprecisely:

```text
RLS_FORCE_SUSPENSION_USED=YES
RLS_DEFINER_FUNCTION_USED=NO          (for the M-B decision count)
RLS_VISIBILITY_MECHANISM=OWNER_FORCE_SUSPENSION
RLS_ROW_SECURITY_OFF_ROLE=FAIL_CLOSED_ASSERTION
```

The M-B decision count does **not** use a `SECURITY DEFINER` function; its
visibility mechanism is the owner `NO FORCE ROW LEVEL SECURITY` window
(`0029:110-115`) with `row_security=off` armed as a fail-closed assertion.
`SECURITY DEFINER` remains in use **elsewhere in 0029** — the
recovery-discovery candidates primitive (`0029:460,497`). A generic
"0029 does not use SECURITY DEFINER" claim would be false.

### EP-11 / PR #126 canonical state (ADR-032 provider-truth runtime correction)

```text
PR126_STATUS=MERGED
PR126_MERGE_SHA=01c05fd61428a76d300b73fb335021f598519d2f
PR126_MERGE_TREE=20ccd433b27b53a645962ebd51a807bc76d0398c
PR126_MERGE_PARENT=629b6e9f36a0b39baf320658e53ee5c4c60bdcef
PR126_PARENT_COUNT=1
PR126_AUDITED_HEAD=acc740fd327322d9f36fbf7eb1e95a6cb6fadf18
PR126_TREE_EQUALS_AUDITED_HEAD_TREE=PASS
PR126_CHANGED_FILES=6
PR126_POST_MERGE_MAIN_CI_RUN=31649394857
PR126_POST_MERGE_MAIN_CI=SUCCESS
PR126_SOURCE_BRANCH_PRESERVED=YES

EP11_IMPLEMENTATION=COMPLETE
EP11_PR=126
EP11_MERGE_SHA=01c05fd61428a76d300b73fb335021f598519d2f
ADR032_DECISION_STATUS=ACCEPTED
ADR032_REPOSITORY_PROMULGATION=COMPLETE
ADR032_RUNTIME_IMPLEMENTATION=IMPLEMENTED
ADR032_ADR_FILE_IMPLEMENTATION_POINTER=STALE_PENDING_SEPARATE_MAINTENANCE

LOCAL_DATE_TRIGGERED_DENY_REMOVED=YES
LOCAL_DEPRECATION_WARNING_REMOVED=YES
PROVIDER_FORWARD_PRESERVED=YES
PROVIDER_RESULT_EVIDENCE_PRESERVED=YES
```

The landed runtime deleted
`packages/provider-openai/src/passthrough/files-purpose-validator.ts` and its
dedicated unit test; removed the date-triggered `block_post_sunset` branch,
the local synthetic purpose-deprecation 403, the
`x-govai-deprecation-warning` header, the route-side supply of the three
legacy purpose-deprecation fields, and the obsolete public exports; preserved
provider forwarding and actual provider-result evidence; and retained the
historical event/emitter/capture compatibility machinery
(`packages/provider-openai/src/passthrough/audit-emit.ts`,
`packages/core-events/src/passthrough-invoked.ts`,
`packages/core-events/src/audit-bridge-capture-payload.ts`). "Runtime
implementation" (complete, PR #126) and the ADR file's own "documentary
pointer" (`IMPLEMENTATION_STATUS=PENDING` — localized staleness, separate
maintenance) are distinct statements; see the register.

### P0.3-C / PR #129 canonical state (cross-request execution idempotency)

```text
PR129_STATUS=MERGED
PR129_MERGE_SHA=f381d3fac24d5938aed91b6618ef511b66ddc878
PR129_MERGE_TREE=a64e7178ecd0e90f43d67550be3a6e688054a67c
PR129_MERGE_PARENT=21afa116e8e85b536a000f0889e6d2bf6929a4a9
PR129_PARENT_COUNT=1
PR129_AUDITED_HEAD=bfa05c5bfeca536d0bd4c41c045246ecd5124c95
PR129_TREE_EQUALS_AUDITED_HEAD_TREE=PASS
PR129_CHANGED_FILES=8
PR129_POST_MERGE_MAIN_CI_RUN=31802636887
PR129_POST_MERGE_MAIN_CI=SUCCESS
PR129_SOURCE_BRANCH_PRESERVED=YES

P0_3_C=COMPLETE
P03_RUNTIME_LANE=COMPLETE
P0_TRUTH_AND_INTEGRITY_PROGRAM=OPEN     (F2 + repository promulgation remain)
F2_STATUS=OPEN_PENDING_SOURCE_CLASSIFICATION
PROVIDER_EXACTLY_ONCE=NOT_CLAIMED
```

Review/process bookkeeping (canonical): 4 substantive review threads, all
resolved with recorded adjudications, 0 active unresolved current threads;
**3 substantive Codex correction rounds** (the configured maximum was not
exceeded) followed by **1 final verification pass** on the corrected exact
head, which produced **2 explicit clean responses** — delivered as issue
comments from the trusted Codex bot identity with exact-head attribution (a
valid clean-signal transport only when author provenance, explicit clean
content and exact-head SHA are ALL verified; see stale-docs-register.md,
process-control lessons).

#### P0.3-C known v1 boundary (non-blocking)

```text
P03C_PRE_RESERVATION_CONCURRENT_WINNER_WINDOW=KNOWN_V1_LIMITATION
CLASS=DEFERRED_LIVENESS_ENHANCEMENT_BY_FROZEN_CONSTRAINT
SAFETY_DEFECT=NO
IDEMPOTENCY_VIOLATION=NO
DUPLICATE_EXECUTION_RISK_FROM_THIS_WINDOW=NO
P03C_BLOCKER=NO
```

When two matching keyed requests overlap and the winner's TX-A is still
uncommitted at BOTH of the loser's committed reads (the initial probe and the
bounded recheck after a pre-reservation failure such as credential/KMS
resolution), the loser may return its original pre-reservation error while
the winner commits immediately afterward. This is a consistent linearizable
history for v1: no second committed run, no second provider execution, no key
poisoning, no second approval consumption — and a later retry of the same key
converges to the winner's committed run. The frozen v1 constraints
deliberately exclude the mechanisms that would close it (polling for the
winner's commit, automatic execution/credential/provider retry, candidate-run
creation before credential resolution, or an advisory-lock authority in front
of the binding-table arbiter). Revisit only if those architectural
constraints are deliberately reconsidered. This is **not** an exactly-once
gap and **not** a duplicate-execution vulnerability, and P0.3-C is not
incomplete because of it.

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
  Subfamily B, `LOCAL_DENY_NO_AUDIT_EVENT_EMITTED`, historically
  included the `purpose_deprecated_post_sunset` branch; **EP-11
  (PR #126) removed that specific branch**
  (`PURPOSE_DEPRECATED_LOCAL_DENY_BRANCH=CLOSED_BY_EP11`). The
  owner-adjudicated decision was promulgated to the repository as
  ADR-032 in PR #125 and its runtime correction merged in PR #126
  (superseding the earlier "staged outside the repository" state).
  EP-11 did **not** remediate the entire P1 family — other
  local-deny evidence gaps remain; class-wide evidence remediation
  remains a separate EP
  (`LOCAL_DENY_EVIDENCE_INCOMPLETENESS=OPEN_SEPARATE_P1`).

### F4 follow-up register (narrow, non-blocking)

- **SEEDORG_FLAKE_CANDIDATE** — root cause: **UNVERIFIED**. Observed symptom: an earlier unrelated integration attempt reported a primary-key prefix collision. Status: follow-up test-harness investigation; priority: does not block F4 closure. `seedOrg` itself is unmodified.
- **DIRECT_STREAM_REQUEST_ID_HEADER_GAP** — status: **PRE_EXISTING**; introduced by F4: NO; F4-blocking: NO. Direct streaming responses do not carry the `X-GovAI-Request-Id` echo; resolving it is a separate future behavior-and-compatibility decision.
