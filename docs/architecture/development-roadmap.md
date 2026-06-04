# GovAI Development Roadmap

Ideal development sequence from the current state ([current-state.md](./current-state.md), main `8be5cfc`) toward a complete product. This roadmap does **not** authorize B3; it sequences it. Each phase lists Goal, Inputs, Outputs, Exit criteria, Explicit non-goals, Dependencies, and Risks if skipped.

---

## Phase 0 — Already built and confirmed

Goal: record what is done so later phases do not redo it.

Built (see current-state.md for evidence):
- Provider-native passthrough + governed surfaces (OpenAI + Anthropic), byte-for-byte, with the H1 v2 harness + versioned coverage map (PRs #81–#87).
- `/v1/runs` governed + passthrough orchestrator; capability registry (facets, default-deny) + org override resolver.
- Audit chain (HMAC, append-only, 3-layer defense) + B0 capture outbox (migration 0025) + B1 capture adapter + B2 sealer **library**.
- KMS envelope encryption (DevKms + AWS KMS adapter) + provider credential storage.
- Workroom Phases 1–4 (create/participants, transcript/tasks/evidence, workroom-owned runs, approvals) with orchestrator integration.
- Regulatory foundational controls PR-R1..R9 (source/control catalog; AI-system/provider/model/agent/use-case registries; risk classification; high-risk review; prohibited-use workflow) — evidence-only.
- DLP-BR baseline + SD1/SD2A detectors.

Exit criteria: met. Non-goals: none. Dependencies: none. Risk if skipped: re-implementing existing controls.

---

## Phase 1 — Documentation alignment (this PR family)

Goal: a reliable, single map of state so future sessions/audits do not drift.

Inputs: code at main `8be5cfc`; ADRs; regulatory docs.
Outputs: `current-state.md`, `stale-docs-register.md`, `resume-playbook.md`, `development-roadmap.md`; minimal README, Workroom-status, and ADR-020 notes.
Exit criteria: the four docs exist and are evidence-cited; README/Workroom no longer claim an older state; ADR-020 carries a stale/resolution note.
Explicit non-goals: no code; no ADR-022..026 acceptance; no B3 decision.
Dependencies: Phase 0.
Risks if skipped: sessions keep re-discovering state, repeat work, or act on stale claims (e.g. "routes are 501").

---

## Phase 2 — AuditSealer B3 Decision Pack

Goal: make B3 a decidable, accepted plan — **no implementation**.

Inputs: ADR-020 (Draft), ADR-022..026 (Proposed), B0/B1/B2 code, `migrations/0025`.
Outputs: ADR-022..026 moved to Accepted; ADR-020 updated/superseded to point at the accepted model; an explicit **append/seal idempotency** resolution (introduce an explicit idempotency key, or document why existing capture state/functions guarantee it — ADR-023's open clause); a written **B3 Technical Plan** (runner shape, role/session phases via `withSealerPhaseRole`, claim-loop bounds, stale recovery, health/metrics, graceful shutdown).
Exit criteria: every ADR-022..026 is Accepted; the idempotency decision is recorded; the B3 plan is reviewed.
Explicit non-goals: no `apps/audit-sealer`; no runner loop; no migration for a new role unless the decision requires one and it is reviewed separately.
Dependencies: Phase 1.
Risks if skipped: B3 gets built on an unresolved role/idempotency model → duplicate appends or chain corruption.

---

## Phase 3 — B3 AuditSealer Runner

Goal: a dedicated process that continuously seals captured events.

Inputs: accepted Phase 2 pack.
Outputs: `apps/audit-sealer` dedicated process; separate DB pool (not the request pool); explicit phase role switching; bounded claim loop (jitter/backoff, no busy-loop); stale-sealing recovery; health/readiness + metrics; graceful shutdown.
Exit criteria: runner seals contiguous captures idempotently; recovers stale `sealing` rows; emits health/metrics; never touches provider traffic and never runs in `apps/api`.
Explicit non-goals: no provider traffic; no hot-path coupling; no in-`apps/api` production loop.
Dependencies: Phase 2 accepted.
Risks if skipped: captures accumulate unsealed; evidence plane is incomplete; no continuous attestation.

---

## Phase 4 — Evidence completeness and cockpit

Goal: prove and surface that every governed/provider action has evidence.

Inputs: B0 outbox data (`attempts`, `last_error`, timestamps); B3 runner.
Outputs: captured/sealed/failed counts per org/chain/window; "provider invocations without audit" detection; stream terminal-event completeness; evidence-plane health dashboard; readiness reports.
Exit criteria: a query/metric proves coverage; gaps are visible and alertable.
Explicit non-goals: no compliance certification claim; dashboards are operational, not legal attestations.
Dependencies: Phase 3.
Risks if skipped: silent evidence gaps; "we audit everything" becomes unverifiable.

---

## Phase 5 — Runtime enforcement

Goal: turn evidence-only governance into enforced governance where intended.

Inputs: regulatory foundational controls (§5 of current-state); agent `hard_deny_floor_expected`; high-risk/prohibited-use determinations.
Outputs: runtime hard-deny; high-risk approval binding to execution; prohibited-use enforcement at the gateway; tool/MCP invocation enforcement; machine-readable policy-decision reason.
Exit criteria: a denied determination actually blocks the corresponding runtime path, with tests; provider-native low-risk parity is preserved.
Explicit non-goals: do not break provider-native semantics for permitted traffic; do not enforce on paths without an accepted policy.
Dependencies: Phases 3–4 (so enforcement is itself audited).
Risks if skipped: "governance" remains advisory; prohibited-use is recorded but not prevented.

---

## Phase 6 — Sensitive Data OS

Goal: from advisory detectors to an operating model.

Inputs: SD1/SD2A detectors; sensitive-data target model (regulatory/24).
Outputs: expanded detectors (incl. judicial-secrecy / privilege / professional-secrecy classifiers); persistence (RLS-scoped findings); policy binding; redaction/tokenization; legal hold; retention; DPO workflow.
Exit criteria: findings persist, bind to policy, and can drive retention/legal-hold and DSR.
Explicit non-goals: no clinical/legal interpretation; detectors remain signal-level unless validated.
Dependencies: Phase 5 (policy binding) for enforcement pieces.
Risks if skipped: sensitive data is detected but not governed.

---

## Phase 7 — Governance-as-API and external apps

Goal: let external apps run under GovAI governance.

Inputs: governed surfaces; evidence schema; capability registry.
Outputs: a contract for external apps; governed API mode; published evidence schema; app registry; external-action evidence.
Exit criteria: an external app can submit governed actions and receive evidence; actions are audited.
Explicit non-goals: no provider-native parity regression; no unauthenticated governance bypass.
Dependencies: Phases 3–5.
Risks if skipped: GovAI stays a single-app platform; no ecosystem.

---

## Phase 8 — Connectors and market integrations

Goal: enrich evidence and reach with external systems.

Inputs: connector framework (target); evidence-ingestion normalization.
Outputs: GitHub/Jira/Slack; ServiceNow; M365/Google; SIEM/SOAR; OneTrust; BigID/Securiti; AWS/Azure/GCP; legal/judiciary connectors.
Exit criteria: a connector ingests external events with provenance into the evidence plane.
Explicit non-goals: connectors enrich; they are not the source of truth for governance decisions.
Dependencies: Phase 7.
Risks if skipped: GovAI cannot reflect the customer's wider control environment.

---

## Phase 9 — Certification and audit exports

Goal: produce defensible packages for auditors/regulators/courts.

Inputs: complete evidence plane; sector mappings; chain-of-custody primitives.
Outputs: ISO 42001 readiness; NIST AI RMF mapping; EU AI Act technical-documentation/logging pack; LGPD/ANPD dossier; CNJ/Sinapses pack; court/evidence export; external TSA/ICP-Brasil integration.
Exit criteria: an export is produced from real evidence with chain-of-custody; external timestamp integration works.
Explicit non-goals: GovAI does not *grant* certification or legal validity; it produces readiness/evidence packages. No automatic court admissibility claim.
Dependencies: Phases 3–8.
Risks if skipped: customers cannot use GovAI evidence in formal audits.
