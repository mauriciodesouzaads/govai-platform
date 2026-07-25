# GovAI Development Roadmap

Anchored on [current-state.md](./current-state.md) (main `719fefc2`, evidence-first). B3 was authorized and implemented in EP-006; this roadmap sequenced it (Phases 2–3). Each phase: Goal, Inputs, Outputs, Exit criteria, Explicit non-goals, Dependencies, Risks if skipped, Resume anchor. No dates; no compliance claims; no runtime enforcement or evidence-plane completeness claim without evidence.

---

## Operational priority register — P0 (macro-phase: Phase 0 — Truth and Integrity)

Two independent axes, not one numbering scheme:

```text
Macro-phase:
Phase 0 — Truth and Integrity

Operational priority:
P0
```

**P0** is an *operational priority* lane inside the macro-phase "Phase 0 — Truth and Integrity" (a truth-and-integrity program over already-shipped evidence surfaces). A P0-priority item does **not** thereby belong to the product-phase numbering below (in particular, it is not part of "Phase 0 — Built and source-verified", which is a product phase that happens to share the label). The canonical F1–F6 + C-2 matrix and the F4 canonical state live in current-state.md §8.

Current P0 sequence (recorded 2026-07-25 at main `719fefc2`):

1. **F4 canonical state roll** — this PR (three architecture docs + one comment-only source correction).
2. **EP-11 source revalidation and deadline protection.** EP-11 has an external OpenAI deadline of 2026-08-26, but its current "Files API sunset" label must be revalidated. Official sources currently identify the Assistants API as the surface shutting down on that date, while `/v1/files` remains documented as active.
3. **P0.3-A / F3** transaction and dispatch-state program.
4. Remaining P0.3 PRs.
5. **F2** source adjudication and implementation.
6. **PR-0 / D9 documentary closure** when the missing mirror is located.

D9 state:

```text
D9_LOCATION=UNRESOLVED
PR0_STATUS=DOCUMENTARY_BLOCKED
TECHNICAL_P0_3_STATUS=NOT_BLOCKED_BY_D9
```

---

## Phase 0 — Built and source-verified

Goal: record what current-state.md confirmed so later phases do not redo it.

Confirmed (source + tests located): provider-native passthrough/governed surfaces (OpenAI+Anthropic) with the H1 v2 harness; `/v1/runs` governed+passthrough orchestrator (writes run-lifecycle audit to chain via `auditAppend`); capability registry + override resolver; audit chain (HMAC); B0 capture outbox + B1 capture adapter (tested as a primitive) + B2 sealer library; KMS + provider credentials; Workroom Phases 1–4; regulatory PR-R1..R9 (evidence-only); DLP-BR SD1/SD2A.

Exit criteria: met. Non-goals: none. Dependencies: none. Risk if skipped: re-implementing existing controls. Resume anchor: current-state.md §1–§5.

---

## Phase 1 — Documentation alignment (this PR family)

Goal: a reliable, evidence-first map so future sessions/audits do not drift.
Inputs: code at `8be5cfc`; ADRs; regulatory docs; source manifests.
Outputs: `current-state.md`, `stale-docs-register.md`, `resume-playbook.md`, `development-roadmap.md`; minimal README/Workroom/ADR-020 notes.
Exit criteria: the four docs exist, are evidence-cited, and distinguish runtime from evidence capture; stale claims corrected.
Explicit non-goals: no code; no ADR-022..026 acceptance; no B3 decision.
Dependencies: Phase 0. Risks if skipped: drift, repeated work, action on stale claims. Resume anchor: this file + resume-playbook.md.

---

## Phase 2 — AuditSealer B3 Decision Pack

Goal: make B3 a decidable, accepted plan — no implementation.
Inputs: ADR-020 (Draft), ADR-022..026 (Proposed), B0/B1/B2 code, migration 0025.
Outputs: ADR-022..026 → Accepted; ADR-020 updated/superseded; explicit append/seal idempotency resolution (key or documented guarantee — ADR-023 open clause); a written B3 Technical Plan.
Exit criteria: ADR-022..026 Accepted; idempotency decided; B3 plan reviewed. **Status: Phase 2 decision pack complete as architecture decision** — ADR-022/024/025/026 Accepted as design constraints, ADR-023 append→mark_sealed idempotency **DECIDED as Option A(b)** (deterministic `audit_event_id`) and **implemented/tested in PR #92** (`sealer-event-id.ts`, `sealer.ts`, `append.ts`; `sealer-deterministic-append.test.ts`), B3 Technical Plan written (`specs/audit-sealer-b3-technical-plan.md`). **B3 is now IMPLEMENTED (EP-006, `apps/audit-sealer`)** — all preconditions satisfied (Option A(b) PR #92; Phase 2.5 PR-B #98; explicit authorization given).
Explicit non-goals: no `apps/audit-sealer`; no loop.
Dependencies: Phase 1. Risks if skipped: B3 built on unresolved role/idempotency model. Resume anchor: ADRs + stale-docs-register.md.

---

## Phase 2.5 — Runtime-to-evidence dispatch / AuditBridge wiring

Goal: ensure governed/passthrough runtime audit events enter the B0/B1 capture outbox before sealing is considered product-complete. **Status: DONE (PR-B / EP-004).** All four direct routes now dispatch into the outbox via `makeAuditBridge`, behind an ingress identity hook; integration-tested end-to-end (current-state.md §3).

Inputs: direct governed/passthrough `emitAuditEvent` call sites (`governed-openai.ts:69-70`, `governed-anthropic.ts:71-72`, `passthrough-*.ts`); provider handler `deps.emitAuditEvent(ev)` sites; B1 `captureAuditEvent`; B0 outbox; B2 sealer library.
Outputs: a documented dispatch contract; a call-site plan; tests proving direct governed-native events enter the outbox; failure semantics (evidence-plane health, not provider UX failure for low-risk traffic); no provider-native parity regression.
**Decision status: ACCEPTED as ADR-027** (AuditBridge dispatch; Option A); **IMPLEMENTED & INTEGRATION-TESTED in PR-B (EP-004).** The dispatcher validates/narrows `event: unknown` via `PassthroughInvokedSchema` (v4) before mapping to `captureAuditEvent`. Exit criteria (implementation — **SATISFIED**): both governed OpenAI and governed Anthropic (and both passthrough) direct runtime paths have test evidence that emitted audit events are validated/narrowed and captured into the outbox — `tests/integration/audit-bridge-wiring.test.ts` (one row per route) + `audit-bridge-idempotency.test.ts` (the same-key replay reuse proof I3 and the divergent-`occurred_at` conflict proof I4). **Pre-implementation decision: ADR-028 (Accepted, merged) — now IMPLEMENTED**: an ingress hook mints `govai_request_id` + optional `X-GovAI-Idempotency-Key`; the AuditBridge `captureId` is the deterministic UUIDv5 (NOT `PassthroughInvoked.audit_event_id`), and `payloadHash` is the stable `AuditBridgeCapturePayloadV1` projection. B3's Phase-2.5 precondition is satisfied; B3 itself was subsequently authorized and implemented in EP-006 (Phase 3).
Explicit non-goals: do not implement the B3 runner here unless separately authorized; do not break provider-native byte fidelity.
Dependencies: Phase 2 or alongside it.
Risks if skipped: **B3 can seal an outbox that direct governed-native runtime does not feed, creating false confidence.** Resume anchor: current-state.md §3.

---

## Phase 3 — B3 AuditSealer Runner — **IMPLEMENTED (EP-006)**

Goal: a dedicated process that continuously seals captured events. **Status: DONE (EP-006).**
Inputs: accepted Phase 2 pack; Phase 2.5 dispatch decision.
Outputs: `apps/audit-sealer` (shipped) — separate DB pool; explicit phase role switching (`withSealerPhaseRole`); Shape-S per-seal tx; bounded claim loop (jitter/backoff); SEPARATE stale recovery; startup readiness probe; OTel health/metrics; graceful shutdown; no provider traffic; no hot path.
Exit criteria (**SATISFIED**): seals contiguous captures idempotently; recovers stale `sealing` rows (advanced, not failed; terminal stall surfaced); emits health/metrics — proven S0–S11 in `tests/integration/audit-sealer-runner.test.ts`.
Explicit non-goals (honored): no provider traffic; no `apps/api` production loop; no schema migration (the `failed→sealing` unstick is a separate future decision).
Dependencies (**all satisfied**): (1) Option A(b) implemented/tested PR #92; (2) Phase 2.5 AuditBridge wired PR-B #98; (3) explicit B3 authorization given. The precursor EP-005.5 (shared outbox-row mapping + recovery loader) merged; the runner consumes it verbatim.

---

## Phase 4 — Evidence completeness and cockpit

Goal: prove and surface that every governed/provider action has evidence.
Inputs: B0 outbox data; B3 runner; Phase 2.5 wiring.
Outputs: captured/sealed/failed counts; "provider invocations without audit" detection; stream terminal-event completeness; evidence-plane health dashboard; readiness reports. **Status: DONE except real EC-5.** The completeness reporting/metrics layer shipped: EP-008A (migration `0027` — three `security_invoker` evidence views: capture-completeness EC-1.a, chain-backlog EC-1.b, provider-without-audit EC-3a), EP-008B (best-effort EC-3b drop/capture OTel counters), EP-008C (stream terminal-event completeness via `@govai/provider-stream-http` + `stream_outcome`), EP-OBS-REFACTOR (the shared `@govai/observability` MeterProvider that exports them). The read surface then shipped too: **EP-008D** (PR #113 — EC reports, EC-4 run-lifecycle coverage, the RLS-scoped `/v1/evidence` read API; the auditor IS the tenant — per-org accumulation, no cross-tenant operator role); **EP-OBS-COLLECTOR** (PR #114 — OTLP collector/Prometheus/Grafana stack + telemetry and real-user e2e); **EP-EVIDENCE-GAUGE-WIRING** (PR #115, migration `0028` — `govai_evidence_*` gauges wired into `apps/api` boot behind the least-privilege `govai_evidence_enumerator` role, INV-1). **Remaining:** real EC-5 reports (deferred to a separate Option-A EP).
Exit criteria: a query/metric proves coverage; gaps are visible/alertable.
Explicit non-goals: no compliance certification claim; dashboards are operational.
Dependencies: Phases 3 + 2.5. Risks if skipped: silent evidence gaps. Resume anchor: current-state.md §3.

---

## Phase 5 — Runtime enforcement

Goal: turn evidence-only governance into enforced governance where intended.
Inputs: regulatory foundational controls; agent `hard_deny_floor_expected`; high-risk/prohibited-use determinations.
Outputs: runtime hard-deny; high-risk approval binding to execution; prohibited-use enforcement; tool/MCP enforcement; machine-readable policy-decision reason.
Exit criteria: a denied determination actually blocks the runtime path, with tests; provider-native low-risk parity preserved.
Explicit non-goals: do not break provider-native semantics for permitted traffic.
Dependencies: Phases 3–4. Risks if skipped: governance stays advisory. Resume anchor: current-state.md §4–§5.

---

## Phase 6 — Sensitive Data OS

Goal: from advisory detectors to an operating model.
Inputs: SD1/SD2A detectors; regulatory/24.
Outputs: expanded detectors (judicial-secrecy/privilege/professional-secrecy); persistence; policy binding; redaction/tokenization; legal hold; retention; DPO workflow.
Exit criteria: findings persist, bind to policy, drive retention/legal-hold/DSR.
Explicit non-goals: no clinical/legal interpretation.
Dependencies: Phase 5. Risks if skipped: sensitive data detected but not governed. Resume anchor: regulatory/24 + current-state.md §5.

---

## Phase 7 — Governance-as-API and external apps

Goal: let external apps run under GovAI governance.
Inputs: governed surfaces; evidence schema; capability registry.
Outputs: external-app contract; governed API mode; published evidence schema; app registry; external-action evidence.
Exit criteria: an external app submits governed actions and receives audited evidence.
Explicit non-goals: no provider-native parity regression; no governance bypass.
Dependencies: Phases 3–5. Risks if skipped: single-app platform. Resume anchor: current-state.md §1.

---

## Phase 8 — Connectors and market integrations

Goal: enrich evidence and reach with external systems.
Inputs: connector framework (target); evidence-ingestion normalization.
Outputs: GitHub/Jira/Slack; ServiceNow; M365/Google; SIEM/SOAR; OneTrust; BigID/Securiti; AWS/Azure/GCP; legal/judiciary connectors.
Exit criteria: a connector ingests external events with provenance into the evidence plane.
Explicit non-goals: connectors enrich; they are not the governance source of truth.
Dependencies: Phase 7. Risks if skipped: cannot reflect the wider control environment. Resume anchor: roadmap Phase 8.

---

## Phase 9 — Certification and audit exports

Goal: produce defensible packages for auditors/regulators/courts.
Inputs: complete evidence plane; sector mappings; chain-of-custody primitives.
Outputs: ISO 42001 readiness; NIST AI RMF mapping; EU AI Act technical-documentation/logging pack; LGPD/ANPD dossier; CNJ/Sinapses pack; court/evidence export; external TSA/ICP-Brasil integration.
Exit criteria: an export is produced from real evidence with chain-of-custody; external timestamp integration works.
Explicit non-goals: GovAI does not grant certification or legal validity; it produces readiness/evidence packages. No automatic court admissibility claim.
Dependencies: Phases 3–8 (incl. Phase 2.5 + Phase 4 evidence completeness). Risks if skipped: customers cannot use GovAI evidence in formal audits. Resume anchor: regulatory docs + current-state.md.
