# GovAI Development Roadmap

Anchored on [current-state.md](./current-state.md) (main `8be5cfc`, evidence-first). This roadmap does **not** authorize B3; it sequences it. Each phase: Goal, Inputs, Outputs, Exit criteria, Explicit non-goals, Dependencies, Risks if skipped, Resume anchor. No dates; no compliance claims; no runtime enforcement or evidence-plane completeness claim without evidence.

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
Exit criteria: ADR-022..026 Accepted; idempotency decided; B3 plan reviewed. **Status: Phase 2 decision pack complete as architecture decision** — ADR-022/024/025/026 Accepted as design constraints, ADR-023 append→mark_sealed idempotency **DECIDED as Option A(b)** (deterministic `audit_event_id`) design constraint, B3 Technical Plan written (`specs/audit-sealer-b3-technical-plan.md`). **B3 implementation remains blocked pending implementation/tests of Option A(b), the Phase 2.5 decision, and explicit authorization.**
Explicit non-goals: no `apps/audit-sealer`; no loop.
Dependencies: Phase 1. Risks if skipped: B3 built on unresolved role/idempotency model. Resume anchor: ADRs + stale-docs-register.md.

---

## Phase 2.5 — Runtime-to-evidence dispatch / AuditBridge wiring

Goal: ensure governed/passthrough runtime audit events enter the B0/B1 capture outbox before sealing is considered product-complete. (Today, direct governed-native/passthrough `emitAuditEvent` is `app.log.info` only; there are zero `captureAuditEvent` call-sites in `apps/` — current-state.md §3.)

Inputs: direct governed/passthrough `emitAuditEvent` call sites (`governed-openai.ts:69-70`, `governed-anthropic.ts:71-72`, `passthrough-*.ts`); provider handler `deps.emitAuditEvent(ev)` sites; B1 `captureAuditEvent`; B0 outbox; B2 sealer library.
Outputs: a documented dispatch contract; a call-site plan; tests proving direct governed-native events enter the outbox; failure semantics (evidence-plane health, not provider UX failure for low-risk traffic); no provider-native parity regression.
**Decision status: ACCEPTED as ADR-027** (AuditBridge dispatch; Option A) — design constraint, **not implemented, not tested**; the route hooks receive `event: unknown` so the dispatcher must validate/narrow via `PassthroughInvokedSchema` before mapping. Exit criteria (implementation — **not satisfied yet**): at least one governed OpenAI and one governed Anthropic direct runtime path have **test evidence** that emitted audit events are validated/narrowed and captured into the outbox; **or** an explicitly accepted deferral names another authoritative evidence path. B3 product-completeness remains blocked until that implementation/tests land or such a deferral is accepted.
Explicit non-goals: do not implement the B3 runner here unless separately authorized; do not break provider-native byte fidelity.
Dependencies: Phase 2 or alongside it.
Risks if skipped: **B3 can seal an outbox that direct governed-native runtime does not feed, creating false confidence.** Resume anchor: current-state.md §3.

---

## Phase 3 — B3 AuditSealer Runner

Goal: a dedicated process that continuously seals captured events.
Inputs: accepted Phase 2 pack; Phase 2.5 dispatch decision.
Outputs: `apps/audit-sealer`; separate DB pool; explicit phase role switching; bounded claim loop (jitter/backoff); stale recovery; health/metrics; graceful shutdown; no provider traffic; no hot path.
Exit criteria: seals contiguous captures idempotently; recovers stale `sealing` rows; emits health/metrics.
Explicit non-goals: no provider traffic; no `apps/api` production loop.
Dependencies: (1) **Option A(b) implemented and tested** in a future implementation PR (deterministic append id; no-duplicate retry after append-success/mark_sealed-failure); (2) the **Phase 2.5 AuditBridge (ADR-027) implemented and tested** (route hooks validate/narrow `event: unknown` via `PassthroughInvokedSchema` and feed the outbox) — or an explicit accepted deferral naming another authoritative evidence path; (3) a **separate explicit implementation authorization**. Note: **B3 seals captures already in the outbox; it is not the same as runtime-to-outbox dispatch, and its product-completeness depends on the Phase 2.5 wiring decision.**
Risks if skipped: captures accumulate unsealed. Resume anchor: ADR-020..026 + current-state.md §3.

---

## Phase 4 — Evidence completeness and cockpit

Goal: prove and surface that every governed/provider action has evidence.
Inputs: B0 outbox data; B3 runner; Phase 2.5 wiring.
Outputs: captured/sealed/failed counts; "provider invocations without audit" detection; stream terminal-event completeness; evidence-plane health dashboard; readiness reports.
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
