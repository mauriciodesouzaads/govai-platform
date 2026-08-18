# GovAI Development Roadmap

Anchored on [current-state.md](./current-state.md) at the **Foundation V1 runtime anchor** `de80664a` (evidence-first, post-M2A) and on the Foundation V1 freeze record [foundation-v1-freeze.md](./foundation-v1-freeze.md). B3 was authorized and implemented in EP-006; this roadmap sequenced it (Phases 2–3). Each phase: Goal, Inputs, Outputs, Exit criteria, Explicit non-goals, Dependencies, Risks if skipped, Resume anchor. No dates; no compliance claims; no runtime enforcement or evidence-plane completeness claim without evidence.

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

P0 sequence, final state at the Foundation V1 anchor `de80664a` (all items dispositioned):

1. **Prior documentary reconciliation — COMPLETE.** EP-DOCS-04 / PR #121
   (squash `e422280d`, dual merge-verified), the EP-DOCS-05 anchor roll
   (PR #122, `4d6eab72`) and the post-P0.3-A canonical roll (PR #124,
   `ee984f2`). Docs-only; no executable behavior changed.
2. **P0.3-A / F3 — COMPLETE.** PR #123 squash-merged as
   `165291d9` (tree byte-identical to the audited head
   `08b59930`; single parent `4d6eab72`; post-merge main CI run
   `31282331366` SUCCESS). Provider network I/O moved outside
   database transactions and checked-out clients; durable dispatch
   boundary, honest `run.outcome_unknown` semantics, bounded
   recovery, forensic lifecycle evidence, tenant-isolated status
   polling, migration 0029 (see current-state.md §3/§8).
   **F3: DEMONSTRATED → CORRECTED.**
3. **ADR-032 promulgation — COMPLETE (PR #125).** Decision **Accepted**;
   the controlling provider-truth constraint
   `docs/architecture/adr/ADR-032-openai-files-purpose-provider-truth.md`
   is present on `main` (added by PR #125, merge `629b6e9f`). Runtime
   implemented by PR #126. The ADR file's promulgation-era
   `IMPLEMENTATION_STATUS=PENDING` wording (a localized documentary
   staleness registered at the time) was **reconciled by M3** (2026-08-18):
   the file now reads `IMPLEMENTATION_STATUS=COMPLETE — implemented by
   EP-11 / PR #126`, with the interim wording retained as historical.
4. **EP-11 — OpenAI Files-purpose provider-truth runtime correction —
   COMPLETE.** PR #126 squash-merged as `01c05fd6` (tree `20ccd433`
   byte-identical to the audited head `acc740fd`; single parent
   `629b6e9f`; 6 files; post-merge main CI run `31649394857` SUCCESS).
   The false local deny and warning are removed (validator + its unit
   test deleted; `block_post_sunset`, the synthetic local 403 and
   `x-govai-deprecation-warning` removed) while provider forwarding and
   provider-result evidence are preserved (current-state.md §8).
5. **P0.3-C — cross-request run execution idempotency — COMPLETE.** PR #129
   squash-merged as `f381d3fa` (tree `a64e7178` byte-identical to the audited
   head `bfa05c5b`; single parent `21afa116`; 8 files; post-merge main CI run
   `31802636887` SUCCESS). Both run-creation surfaces (standalone `/v1/runs`
   + Workroom `POST /v1/workrooms/:id/runs`) accept the optional
   `X-GovAI-Run-Idempotency-Key`; the immutable tenant-scoped
   `govai.run_idempotency` binding (migration 0030) plus the canonical
   `govai.run_execution_intent.v1` semantic-intent correspondence give one
   durable logical run per matching keyed intent, with no intentional second
   local provider execution and no second approval consumption. **No
   provider-side exactly-once is claimed** (current-state.md §3).
   **The P0.3 runtime lane is COMPLETE.**
6. **F2 — CLOSED WITH REGISTERED RESIDUAL (M3, 2026-08-18).** Source
   adjudication at `de80664a`: `F2_CLASSIFICATION=EVIDENCE_GRANULARITY_GAP`,
   `F2_RUNTIME_DEFECT=NO`, `F2_FALSE_EVIDENCE=NO`, `F2_FOUNDATION_BLOCKER=NO`,
   `F2_SCHEMA_V5_REQUIRED_NOW=NO`. M1 (PR #131) made recommendation vs applied
   honest over HTTP; the applied-vs-recommended provenance is not first-class
   in sealed v4 (residual R2, anti-evaporation clause). See
   foundation-v1-freeze.md §5.
7. **PR-0 / D9 V2 — COMPLETE IN THE M3 TREE.** The verified corpus
   (43/43 external ledger, PR-0 26/26, v0.9 15, D9 11/11) is promulgated with
   the owner's D0–D16 authority classes; provenance in
   [d9-promulgation-manifest.md](./d9-promulgation-manifest.md).
8. **Foundation V1 runtime — COMPLETE and real-provider accepted (executed
   scope).** M1 (PR #131, `3e90f2fb`), M2 (read-only live acceptance), M2A
   (PR #132, `de80664a`); `FOUNDATION_V1_KNOWN_RUNTIME_BLOCKERS=0`.

Sequencing after the M3 canonical freeze:

```text
P03_RUNTIME_LANE=COMPLETE
F2_FOUNDATION_STATUS=CLOSED_WITH_RESIDUAL
PR0_D9_V2=COMPLETE_IN_M3_TREE
FOUNDATION_V1=DOCUMENTARY_FREEZE_RECORDED_IN_THIS_TREE   (tree-stable; lifecycle: FREEZE_PENDING_M3_MERGE while PR #133 is open → FROZEN_BASELINE once the external post-merge proof passes — declared by the external mission record, not by this file)
P0_TRUTH_AND_INTEGRITY_PROGRAM=CLOSED_AT_FOUNDATION_V1_FREEZE
NEXT_RECOMMENDED_PRODUCT_LANE=UI_UX_V1_FOUNDATION   (do NOT start inside M3)
```

Operational note (not a blocker): the P0.3-C
known v1 boundary — the pre-reservation concurrent-winner window — is
registered as `KNOWN_V1_LIMITATION` /
`DEFERRED_LIVENESS_ENHANCEMENT_BY_FROZEN_CONSTRAINT` (`SAFETY_DEFECT=NO`;
no duplicate execution, no key poisoning; a same-key retry converges; no
polling in v1). It is **not** a P0.3-C runtime defect and requires no
corrective runtime PR; see current-state.md §8 *P0.3-C known v1 boundary*.

Operational note (not a blocker):
`REPO_ENFORCEMENT_ASSESSMENT=DEFERRED_NON_BLOCKING` — repository
branch-protection/ruleset hardening remains a deferred, non-blocking
assessment. Repository enforcement is **not claimed enabled**; the CI
workflow executing unit + integration jobs is real evidence, and the merge
protocol is process-enforced (see resume-playbook.md).

Former separate P1 evidence-integrity follow-up — SUPERSEDED (M3):

- **LOCAL_DENY_EVIDENCE_INCOMPLETENESS** is no longer carried as a class
  (`OLD_CLASS_WIDE_LOCAL_DENY_LABEL=SUPERSEDED_BY_NARROW_RESIDUALS`): since M1
  every Native/Governed pre-provider governance block emits a durable blocked
  v4 capture; Subfamily B's member was removed by EP-11. What remains is
  registered narrowly in foundation-v1-freeze.md §6/§9 — R4
  (credential-unresolvable path: 502 + structured log, no fabricated v4), R5
  (v1 diagnostics counted as bridge drops), R2/R3 (evidence granularity).

D9 state (final — the former `D9_LOCATION=UNRESOLVED` (until 2026-08-08) and
`D9_PRESENT_IN_REPOSITORY_MAIN=NO` / `PR0_STATUS=DOCUMENTARY_BLOCKED_PENDING_PROMULGATION`
(until the M3 tree) are HISTORICAL):

```text
D9_SOURCE_CORPUS_LOCATED=YES
D9_SOURCE_PROVENANCE=USER_SUPPLIED_V09_PACKAGE
D9_EXTERNAL_LEDGER=43_OF_43_PASS
D9_REQUIRED_PATHS_SOURCE=11_OF_11
D9_HASH_VERIFICATION=11_OF_11_PASS
D9_PRIOR_CANONICAL_HASH_LEDGER=NOT_AVAILABLE

D9_PRESENT_IN_REPOSITORY_MAIN=YES_IN_M3_TREE      (post-merge proof re-runs against main)
D9_REPOSITORY_PROMULGATION=COMPLETE_IN_M3_TREE
D9_REAL_MISSING_TARGETS_IN_PR_TREE=0

PR0_STATUS=PROMULGATED_BY_M3
TECHNICAL_P0_3_STATUS=NOT_BLOCKED_BY_D9
```

The two production-source references that were broken while promotion was
pending — `apps/api/src/db/migrations/0025_audit_capture_outbox_foundation.sql:35-37`
(SPEC v2.1, ADR-017, `docs/security/threat-model.md`) and
`packages/core-audit/src/capture.ts:54` ("See ADR-017") — now resolve to
promulgated files. Future D9 doctrine changes require a dedicated
architecture/doctrine movement (M3 was that movement for the initial promulgation).

## Foundation V1 → next product lane (recommended, NOT started)

```text
NEXT_RECOMMENDED_PRODUCT_LANE=UI_UX_V1_FOUNDATION
NEXT_EXECUTED=NO
```

Initial architecture direction only (from the July 2026 UI plans, reconciled to
Foundation V1 — see `plans/GOVAI-UI-MASTER-PLAN…` header, `plans/GOVAI-UI-ARCHITECTURE-CONSULT…`,
and foundation-v1-freeze.md §11):

- conversational / native streaming UX → the direct native/governed provider routes;
- durable work, replay, workrooms → `/v1/runs` (+ `X-GovAI-Run-Idempotency-Key`);
- evidence views → `/v1/evidence`, `/v1/audit-events`;
- constraints that must hold: a production human UI requires a human auth /
  session / API-key lifecycle (none exists — residual R14); governance settings
  and high-risk agentic UX cannot pretend ask/sandbox/enforce primitives exist
  (they do not — R12) or couple commercial tier to governance profile (R13);
  simple interactive chat may use direct native/governed streaming; a UI must not
  represent ask/sandbox/enforcement as applied. Claims follow
  `claims-policy.md`.

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
