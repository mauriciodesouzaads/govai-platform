# GovAI Stale Docs Register

Documents whose statements no longer match source ([current-state.md](./current-state.md), Foundation V1 runtime anchor `de80664a`; documentary freeze [foundation-v1-freeze.md](./foundation-v1-freeze.md)). "Confidence" = how strongly source verifies the correction. "Severity" = onboarding/continuity risk. The "Blocks B3?" column is historical: B3 (the AuditSealer runner) was authorized and implemented in EP-006 — every former B3 blocker below is resolved (see the PR-B / EP-004 and EP-006 reconciliation sections).

| Document | Stale statement | Current source evidence | Confidence | Severity | Action | Blocks B3? |
|---|---|---|---|---|---|---|
| `README.md` | "Runtime Phase 1 … Passthrough e admin routes ainda em 501" | `server.ts:161-181` registers passthrough/governed/evidence/credentials/workroom/regulatory as real handlers; only `admin-audit-shred.ts:41` and `admin-dlp.ts:40` are `sendNotImplemented` stubs | HIGH (source-verified) | HIGH (onboarding) | README status updated to current surfaces + runtime-to-evidence caveat (this PR) | no |
| `docs/architecture/workroom-governance-room.md` | "proposed (architecture blueprint, no runtime implementation yet)" (line 3) | Phases 1–4 routes exist (`workrooms.ts`/`workroom-transcript.ts`/`workroom-runs.ts`/`workroom-approvals.ts`); migrations 0012–0015; orchestrator `WorkroomRunContext`; ~21 workroom tests located | HIGH (source + tests) | HIGH (architecture continuity) | Add "Implementation status" note: partial runtime (Phases 1–4); 5–7 target-only; not complete (this PR) | no |
| `docs/architecture/adr/ADR-020-audit-sealer-runtime-model.md` | (was) role/session "Open design question"; Draft | ADR-022 resolves the role model | HIGH | MEDIUM (resolved) | **Done (B3 decision-pack PR):** ADR-020 → Superseded-in-part by ADR-022–026; B3 subsequently implemented in EP-006 | no — resolved (Option A(b) PR #92; AuditBridge PR-B/EP-004; B3 runner EP-006) |
| `ADR-022`–`ADR-026` | (was) Status: Proposed | ADR-022/024/025/026 → **Accepted** design constraints; **ADR-023 → Accepted; Option A(b) implemented/tested in PR #92** — deterministic `audit_event_id` in `packages/core-audit/` | HIGH | LOW (done) | Option A(b) is implemented (PR #92); the former B3 blockers (Phase 2.5 AuditBridge, explicit B3 authorization) are satisfied — AuditBridge wired (PR-B / EP-004), B3 implemented (EP-006) | no — resolved (Option A(b) PR #92; AuditBridge PR-B/EP-004; B3 runner EP-006) |
| Append→mark_sealed partial-failure idempotency (ADR-023) | (was) open clause unresolved | **Option A(b) implemented/tested in PR #92** — deterministic `audit_event_id` = UUIDv5(org_id+capture_id) in `packages/core-audit/` (`auditAppend(eventId?)` lookup-after-lock + correspondence/payload-presence guards); `audit_events.id` is PK so no migration was needed | HIGH (source-verified) | LOW (done) | Option A(b) is implemented/tested; the former B3 blockers (Phase 2.5 AuditBridge, explicit B3 authorization) are satisfied — AuditBridge wired (PR-B / EP-004), B3 implemented (EP-006); ADR-028 accepted/merged | no — resolved (Option A(b) PR #92; AuditBridge PR-B/EP-004; B3 runner EP-006) |
| **Runtime-to-evidence wiring (correction to any "runtime ⇒ evidence captured" assumption)** | Implicit assumption that governed-native runtime produces captured/sealed evidence | **WIRED (PR-B / EP-004):** all four direct routes dispatch `await auditBridge(event, requestIdentityAls.getStore())` via `makeAuditBridge` into the B0/B1 outbox; the ingress identity hook + ADR-028 `captureId` are implemented; I3/I4 proven (see the PR-B / EP-004 reconciliation below) | HIGH (source-verified) | HIGH (B3 false-confidence risk) | **Resolved (EP-004).** Direct-route runtime now feeds the outbox; B3 (EP-006) seals it | no — resolved (EP-004 + EP-006) |
| Regulatory roadmap (`regulatory/20`, `regulatory/23`, sector mappings) | Not stale, but dense; foundational controls not summarized in one place and are evidence-only | PR-R1..R9 live as foundational controls (migrations 0016–0024 + tests) | MEDIUM (navigability) | MEDIUM | current-state.md §5 cross-links + labels evidence-only | no |
| `docs/architecture/specs/h1v2-coverage-map.md` + H1 v2 specs | Current and versioned after PR #87 (stable aliases) | matches code at `8be5cfc` | HIGH | — (not stale) | none | no |
| `current-state.md`, `development-roadmap.md`, `stale-docs-register.md`, `resume-playbook.md` | Canonical anchor remained `main@e422280d` after PRs #122/#123 merged; `resume-playbook.md` §2/§4 still described the PR #93-era state ("AuditBridge accepted but not implemented", "zero `captureAuditEvent` call-sites", "B3 still not authorized" — all long-false) | `main=165291d9` (PR #123 squash; parent `4d6eab72` = the PR #122 EP-DOCS-05 roll); post-merge main CI run `31282331366` SUCCESS | HIGH | HIGH | Re-anchored + resume-playbook reconciled in the P0.3-A Movement 5 documentary roll (this PR) | no |
| `development-roadmap.md` P0 register | EP-11 still required owner/ADR adjudication and was framed as deadline protection | ADR-032 owner adjudication is complete; PR #125 added the repository-promulgation artifact (`docs/architecture/adr/ADR-032-openai-files-purpose-provider-truth.md`); the decision is provider-truth based and date-independent | HIGH | HIGH | **RESOLVED** — ADR-032 promulgated (PR #125, `629b6e9f`), EP-11 implemented (PR #126, `01c05fd6`), roadmap reconciled by the post-EP11 canonical state roll (this PR) | no |
| `current-state.md` §"Separate P1 evidence-integrity register" | "The owner-adjudicated decision remains staged outside the repository as ADR-032; once promulgated, it requires removal of that specific branch" — accurate at anchor `165291d9`; the "staged outside the repository" clause becomes historical the moment the ADR-032 promulgation movement lands on `main` | The repository-promulgation artifact is on `main` (PR #125); EP-11 (PR #126) removed the specific `purpose_deprecated_post_sunset` branch | HIGH | MEDIUM | **RESOLVED by the post-EP11 canonical state roll (this PR)** — the §"Separate P1 evidence-integrity register" text is reconciled (`PURPOSE_DEPRECATED_LOCAL_DENY_BRANCH=CLOSED_BY_EP11`; the class stays `OPEN_SEPARATE_P1`); this row is retained as history | no |
| `docs/architecture/adr/ADR-032-openai-files-purpose-provider-truth.md` | Promulgation-era wording: `IMPLEMENTATION_STATUS=PENDING` ("EP-11 is a subsequent, separate implementation movement") and the "Until EP-11 merges, every passthrough Files request … continues to follow the current validator behavior" consequences framing — historical after PR #126 | EP-11 is implemented: PR #126 squash-merged as `01c05fd61428a76d300b73fb335021f598519d2f` (post-merge main CI run `31649394857` SUCCESS); `files-purpose-validator.ts` and its local deny/warning paths no longer exist in the tree | HIGH (source-verified) | LOW (localized) | **RESOLVED by M3 (2026-08-18)** — the ADR file now reads `IMPLEMENTATION_STATUS=COMPLETE — implemented by EP-11 / PR #126`; the interim wording is retained as `HISTORICAL_PRE_EP11_RUNTIME`. (Was: localized documentary staleness deferred to separate maintenance.) | no |
| `resume-playbook.md` §3 (pre-roll wording) | "CI as an enforced two-job gate (unit + integration; PR #116 `GOVAI_INTEGRATION` config gate)" — conflated workflow existence with GitHub enforcement | The CI workflow executes the unit and integration jobs and successful exact-head CI is mandatory under the GovAI development/merge protocol, but workflow existence is not itself proof of GitHub branch-protection enforcement (`CI_EVIDENCE=REAL`; `MERGE_PROTOCOL=PROCESS_ENFORCED`; `GITHUB_BRANCH_ENFORCEMENT=NOT_ASSUMED`; `REPO_ENFORCEMENT_ASSESSMENT=DEFERRED_NON_BLOCKING`) | HIGH | MEDIUM | **Corrected by the post-EP11 canonical state roll (this PR)** — resume-playbook §3 rewritten source-honestly | no |

### Files referenced by prior session memory but **not present in repository manifest**

These were named in an earlier task list but do **not** exist in `docs/architecture/regulatory/` at `8be5cfc`; they are not treated as source and are not referenced elsewhere in this PR:

- `regulatory/26-certification-audit-readiness.md` — not present (the certification doc that exists is `22-certification-and-audit-readiness.md`).
- `regulatory/27-regulatory-intelligence-operating-model.md` — not present (the one that exists is `21-regulatory-intelligence-operating-model.md`).
- `regulatory/28-consolidated-regulatory-gap-analysis.md` — not present (no consolidated gap-analysis doc exists).
- `regulatory/29-future-implementation-decision-record.md` — not present.
- `regulatory/30-post-pr-c2-roadmap.md` — not present.

Notes:
- This register is the authoritative "do not trust this statement as written" list. If a doc is not listed and not in current-state.md, verify against code before relying on it.
- ADR-022/024/025/026 are accepted as design constraints; ADR-023 Option A(b) is implemented/tested in PR #92. There are no remaining B3 blockers: the Phase 2.5 AuditBridge wiring (PR-B / EP-004) and the B3 runner (EP-006) are implemented and tested; ADR-028 accepted/merged.

---

## EP-DOCS-05 reconciliation — PR #121 merged and dual-verified

PR #121 squash-merged as
`e422280d63d52da2ed08fb488146266b2ef7dac0`, with tree
`196701d877cc40d977197529f809985162c9254c`, one parent
`719fefc25502bb9f7547743f339b38fa3a20c4c7`, exact four-file
scope and no executable change. Main CI passed. Fable5 and Opus
independently verified all merge proofs from origin.

The source branch remains preserved. The historical Codex P2
remains unresolved and outdated.

### Process-control lesson — semantic Codex head attribution

The PR #121 merge remains valid and requires no remediation.
During the merge mission, a literal probe failed because the Codex
attribution used Markdown formatting:

    **Reviewed commit:** `50fb0ca143`

The executor inspected the body, proved the correct SHA and
proceeded. The substantive attribution was correct, but proceeding
after the defined literal gate failed was a fail-closed
process-control deviation.

Future irreversible dispatches must define a semantic parser that
extracts and compares the reviewed SHA. A missing field or SHA
mismatch is a STOP. The executor may not replace a failed defined
gate with free-form interpretation.

```text
FINDING=FAIL_CLOSED_GATE_REINTERPRETED_BY_EXECUTOR
CLASSIFICATION=PROCESS_CONTROL_DEVIATION
SEVERITY=P2_PROCESS
PRODUCT_IMPACT=NONE
MERGE_VALIDITY=UNAFFECTED
REMEDIATION=FUTURE_DISPATCH_SEMANTIC_PARSER
```

## EP-000 rev 1 reconciliation (2026-06-12)

Corrections applied in branch `docs/ep-000-reconciliation` (anchor before: origin/main `16fc762e`). Old claim → corrected claim:

| Document | Was (stale) | Now (corrected) |
|---|---|---|
| `adr/ADR-027-runtime-to-evidence-dispatch.md` | §"Mapping contract" / §"Payload hash semantics" read as the live contract | Superseded-in-part by ADR-028 (D1, 2026-06-12); both sections marked **SUPERSEDED — retained for history, do not implement** |
| `adr/ADR-023-stale-sealing-recovery-strategy.md` | Option A(b) "not implemented, not tested" | **implemented & tested in PR #92** (`sealer-event-id.ts`, `sealer.ts`, `append.ts`; `sealer-deterministic-append.test.ts`); still does **not** authorize the B3 runner |
| `development-roadmap.md` | Option A(b) a pending/unimplemented B3 dependency | Option A(b) **SATISFIED** (PR #92); Phase 2.5 AuditBridge + explicit authorization remain the B3 blockers |
| `resume-playbook.md` | Option A(b) "not implemented and not tested" | reconciled to **implemented/tested** (PR #92); every "B3 not authorized" guard preserved |
| `regulatory/00-philosophy-and-positioning.md` | absolutes "hard-deny floor is always active" / "Evidence is always captured" | relabeled **TARGET-state** with a link to current-state §3 (runtime hard-deny is Phase 5; direct-route evidence capture not yet implemented) |
| `README.md` | core-identity "KMS (DevKms HKDF)" only | "KMS (DevKms HKDF — dev; AWS KMS adapter — production)" |
| `.env.example` | provider-key comment "Env is only for live tests" | corrected to **dev/test runtime fallback AND live tests**, per `apps/api/src/pipeline/provider-credentials.ts` |

New register note (RR-000): `packages/core-audit/src/capture.ts` comment references **ADR-017**, which is **not tracked on main** (and whose untracked draft conflicts with ADR-027/028 on `/v1/runs` scope) — resolution owned by D3 disposition.

EP-002 rev2 (2026-06-15): `PassthroughInvoked` bumped to **v4** (required `occurred_at`). The version-contract ledger — the v3-vs-v4 re-validation rule and the idempotent-retry definition — lives in `adr/ADR-028-direct-route-request-identity-and-idempotency.md` §"PassthroughInvoked v4". v3 historical payloads stay valid under the v3 contract; never re-validate a v3 payload against the v4 schema.

## PR-B / EP-004 reconciliation (2026-06-17) — AuditBridge WIRED

The AuditBridge is no longer inert. Branch `feat/ep-004-auditbridge-wiring` (base main `d2c2785`) wires `makeAuditBridge` into the four direct routes behind an ingress identity hook, with the I1–I9 integration matrix (I3/I4 the load-bearing same-key replay reuse / divergent-`occurred_at` conflict proofs). The following two docs were the stale "unwired / Phase 2.5 outstanding" statements, now corrected:

| Document | Was (stale) | Now (corrected, PR-B) |
|---|---|---|
| `current-state.md` §3 + route table | "Runtime-to-evidence wiring (first-class gap)"; governed routes "runtime-to-B1-outbox dispatch is not implemented"; "zero `captureAuditEvent` call-sites in `apps/`" | §3 = **WIRED (source + integration verified)**; the four routes dispatch via `makeAuditBridge` → outbox; ADR-028 identity hook implemented; I3/I4 proven |
| `development-roadmap.md` Phase 2.5 | "ACCEPTED as ADR-027 … not implemented, not tested"; exit criteria "not satisfied yet" | Phase 2.5 = **DONE (PR-B)**; exit criteria SATISFIED; only the explicit B3 runner authorization remains a B3 blocker |

Not changed by PR-B (still accurate at that point): `/v1/runs` stays chain-authoritative via `auditAppend`; no sealer/`/v1/runs`/migration work shipped in PR-B.

## EP-006 reconciliation (2026-06-19) — B3 AuditSealer runner IMPLEMENTED

B3 is no longer `DOCUMENTED_TARGET_ONLY`. EP-006 ships `apps/audit-sealer` (base main `3af8840`) — the dedicated runner consuming `@govai/core-audit` verbatim (Shape-S per-seal tx, the SEPARATE stale-recovery path via the EP-005.5 `loadSealingCaptureForRecovery`, startup probe, bounded loop, OTel metrics), integration-tested S0–S11. The earlier "B3 not implemented / not authorized" statements (the rows above + the §28 note) and any residual "Option A(b) not implemented" / "AuditBridge not implemented" / "Runtime-to-evidence not yet wired" wording are FALSE at `3af8840` and are superseded:

| Document | Was (stale) | Now (corrected, EP-006) |
|---|---|---|
| `current-state.md` B3 row + §3 | "B3 — sealer runner: DOCUMENTED_TARGET_ONLY / BLOCKED"; "no `apps/audit-sealer`"; "Stale-sealing recovery: not implemented" | B3 = **IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED (EP-006)**; `apps/audit-sealer` shipped; stale recovery implemented |
| `development-roadmap.md` Phase 3 + Phase 2 | "B3 implementation remains blocked"; Phase 3 dependencies unmet | Phase 3 = **IMPLEMENTED (EP-006)**; all dependencies satisfied |
| `adr/ADR-020` | "B3 implementation not authorized"; "ADR-022–026 still Proposed" | ADR-022–026 **Accepted**; B3 **implemented in EP-006** |
| `specs/audit-sealer-b3-technical-plan.md` | "Does not authorize implementation"; "not implemented, not tested"; "blocking precondition" | **IMPLEMENTED by EP-006**; §1/§4/§8.3 preconditions SATISFIED; choreography decided (Shape S) |

The one residual B3-adjacent open item (NOT a stale claim): a B0 `failed→sealing` "unstick" migration for a chain terminally stalled by an unrecoverable `failed` row is a SEPARATE future operational decision, deliberately out of EP-006 scope (SPEC-B3 §4.2 / §9). `/v1/runs` stays chain-authoritative via `auditAppend`; EP-006 ships no migration/SQL.

## EP-007 reconciliation (2026-06-20) — alphanumeric CNPJ detector

The `cnpj` baseline DLP detector is no longer numeric-only. EP-007 (base main `efce4934`) extends `packages/dlp-br/src/baseline-detectors.ts` to recognize the IN RFB 2.229/2024 **alphanumeric** CNPJ (12 base positions `[0-9A-Z]`, 2 numeric check digits; DV = mod-11 over `ASCII − 48`), verified checksum-identical to the official Serpro/RFB validator across every official reference case and all single-character mutations (precondition #2). Any implicit "CNPJ is 14 digits / numeric-only" reading of the detector docs is now superseded:

| Document | Was (stale) | Now (corrected, EP-007) |
|---|---|---|
| `regulatory/07-sensitive-data-handling.md` | `cnpj` detector implied numeric-only | the `cnpj` detector covers numeric **and** IN RFB 2.229/2024 alphanumeric CNPJ; uppercase-only detection; numeric is a strict subset (zero regression) |
| `regulatory/24-sensitive-data-operating-model.md` | baseline `cnpj` implied numeric-only | same correction; checksum verified against the official validator |
| `regulatory/15-source-register.md` | no RFB CNPJ source registered | **BR-RFB-01** added: IN RFB nº 2.229/2024 as `CONFIRMED_PRIMARY_SOURCE` |

Scope guard (NOT stale claims): EP-007 edits only `baseline-detectors.ts` + its tests + docs. D1 = uppercase-only regex (a lowercase alphanumeric candidate is not surfaced). D2 = a `cnpj@2` versioned-detector split is deferred (no detector-id/version change in EP-007). The shared `digits()` helper and the CPF/email/phone detectors are untouched.

## EP-008 arc reconciliation (2026-06-27) — evidence completeness reporting/metrics IMPLEMENTED

The "Evidence completeness … no reporting/metrics layer" reading of current-state.md §3 is no longer true. The EP-008 arc (PRs #107–#111, all squash-merged, main now `c3cd39f3`) shipped the completeness reporting + metrics layer:

| Document | Was (stale) | Now (corrected, EP-008A/B/C) |
|---|---|---|
| `current-state.md` §3 "Evidence completeness" row | "PLANNED … no reporting/metrics layer" | **IMPLEMENTED (EP-008A/B/C):** EP-008A migration `0027` — three read-only `security_invoker` evidence views (`govai.evidence_capture_completeness` EC-1.a, `govai.evidence_chain_backlog` EC-1.b, `govai.evidence_provider_without_audit` EC-3a); EP-008B — best-effort EC-3b drop/capture OTel counters (`govai_audit_bridge_drops_total` / `govai_audit_bridge_captures_total`, observe-only, cardinality-safe); EP-008C — stream terminal-event completeness (terminal `PassthroughInvoked` on every stream termination via the new `@govai/provider-stream-http`, `stream_outcome` in the envelope + the immutable capture projection); EP-OBS-REFACTOR — the shared `@govai/observability` MeterProvider exporting the counters |
| `current-state.md` Source manifests | migrations "25 (0001..0026, highest 0026_…)" | **26 (0001..0027, missing 0006; highest `0027_evidence_completeness_views.sql`)** — EP-008A added 0027 |
| `development-roadmap.md` Phase 4 | outputs described as future | **PARTIALLY DONE:** the reporting/metrics layer (EC-1/EC-2/EC-3.seal/EC-3.drop/EC-5-marker) shipped (EP-008A/B/C); EC-4 + EC-5 reports + the cockpit read surface remain (EP-008D) |

Scope guard (NOT stale claims): EP-008A/B/C are observe-only / read-only over the existing schema except the EP-008A views (additive, `security_invoker`) and EP-008C's additive-optional `stream_outcome` field (no migration — hashed into the existing `audit_capture_outbox` blob); no provider-native regression (ADR-021 byte fidelity intact). The operator/auditor cockpit (EP-008D) needs an operator/cross-tenant scoped role (cannot use `security_invoker`) and is not yet built. `/v1/runs` stays chain-authoritative via `auditAppend`. *(Superseded in part — EP-008D subsequently shipped WITHOUT a cross-tenant operator role: the auditor IS the tenant. See the EP-DOCS-04 reconciliation below.)*

## EP-DOCS-04 reconciliation (2026-07-25) — F4 canonical state roll to main `719fefc2`

The three hand-maintained architecture docs were anchored at `c3cd39f3` (2026-06-27); eight merges have landed since — PR #113 EP-008D (`8eb1eab`), PR #114 EP-OBS-COLLECTOR/EP-E2E-USER (`d2fef204`), PR #115 EP-EVIDENCE-GAUGE-WIRING (`2f620b47`), PR #117 EP-SEALER-DEPLOY (`af8c08b`), PR #116 EP-GATE-MECHANIZATION (`f975533`), PR #118 P0.1 F5+F6 (`ed18736a`), PR #119 P0.2 F1+C-2 (`19bcb452`), PR #120 F4 preventive hardening (merge `719fefc2`, tree `c13d83db`). Corrections applied:

| Document | Was (stale) | Now (corrected, EP-DOCS-04) |
|---|---|---|
| `current-state.md` anchor + manifests | anchor `c3cd39f3`; routes **17**; migrations **26** (highest `0027`); tests **165** on disk / 162 in the default run | anchor **`719fefc2`**; routes **18** (new `evidence.ts` — the EP-008D `/v1/evidence` read API); migrations **27** (0001..0028, missing 0006; highest `0028_evidence_enumerator_policy.sql`); tests **181** on disk (109 unit + 67 integration + 5 live-gated); the default `pnpm test` is **unit-only** (109 files / 1258 tests) since the PR #116 `GOVAI_INTEGRATION` config gate |
| `current-state.md` §1 anchors | `server.ts:93-112`; orchestrator `auditAppend` at `:527,618,736,799,885,963,1229,1328`; credentials `auditAppend` at `:164,289` | `server.ts:156-176` (identity hook at `:170`); orchestrator `auditAppend` at `:558,643,761,829,915,993,1264,1363`; credentials `auditAppend` at `:165,289` |
| `current-state.md` §3 evidence-completeness row + this register's EP-008 note | "the operator/auditor cockpit read surface (EC-4 + EC-5) **remains** (EP-008D)"; "needs an operator/cross-tenant scoped role" | EP-008D **merged** (PR #113): EC reports + EC-4 + the RLS-scoped `/v1/evidence` read API, **per-org accumulation — no cross-tenant operator role** (the auditor IS the tenant); gauges wired behind the least-privilege `govai_evidence_enumerator` role (PR #115, migration `0028`, INV-1); OTLP collector stack (PR #114); **real EC-5 deferred** (separate Option-A EP) |
| `development-roadmap.md` Phase 4 | "**Remaining (EP-008D):** EC-4 + EC-5 + cockpit + OTLP collector standup" | EP-008D/#114/#115 shipped; remaining = **real EC-5** (Option-A follow-up EP) |
| (new) P0 findings register | absent — no F1–F6/C-2 state was recorded in-repo | current-state.md §8: the canonical F1–F6 + C-2 matrix (C-2 stays OUTSIDE the F1–F6 numbering); F4 = `PREVENTIVE_HARDENING`, `NO_OBSERVABLE_FAILURE_REPRODUCED`, merged `719fefc2`, dual diff- and merge-verified, main CI green; **no aggregate finding count is asserted** (F2 is pending a separate source adjudication) |
| `apps/api/src/pipeline/request-identity-hook.ts` | inline comment "the store ends with the callback" (technically imprecise — asynchronous resources created inside `run()` retain the store past the callback return) | comment-only correction: when the `run()` callback returns, the CALLER's prior ambient context is restored; asynchronous resources created by the continuation retain the request-owned store for their own lifecycle |

Notes (NOT corrections):

- **D9** *(superseded 2026-08-08 — the note below replaces the WAS-state in both of its claims)*:
  - WAS (historical): `D9_LOCATION=UNRESOLVED`; "a repo-wide search at `719fefc2` reproduced no such literal references — broken-reference count: UNVERIFIED". Both halves are superseded: the first by documentary verification, the second because it was **falsified** — the search that returned zero was wrong.
  - NOW (current): the D9 corpus was **located and integrity-inventoried from the owner-supplied v0.9/PR-0 package** (`EP-PR0-D9-RECONCILIATION-V2_MANIFEST_v0.2`: package hash verification 26/26 match; 11/11 D9 required source paths present; content SHA-256 hashed; provenance `USER_SUPPLIED_V09_PACKAGE`). The corpus has **not yet been promulgated into repository main**. PR-0/D9 remains documentary-blocked on **reconciliation/promotion, not on source location**: `D9_SOURCE_CORPUS_LOCATED=YES`; `D9_PRESENT_IN_REPOSITORY_MAIN=NO`; `D9_REPOSITORY_PROMULGATION=PENDING`; `PR0_STATUS=DOCUMENTARY_BLOCKED_PENDING_PROMULGATION`; `TECHNICAL_P0_3_STATUS=NOT_BLOCKED_BY_D9`.
  - **Broken references, reconfirmed and precisely classified at `165291d9`:** the genuine missing-target references are **2 production-source files** — `apps/api/src/db/migrations/0025_audit_capture_outbox_foundation.sql:36-37` (cites `docs/architecture/adr/ADR-017-audit-bridge-evidence-plane.md` and `docs/security/threat-model.md`) and `packages/core-audit/src/capture.ts:54` ("See ADR-017") — whose targets do not exist in the tree; no file cites `claims-policy.md`. A broad ADR-016..019 sweep returns 13 files, but the other 11 are **not** broken references to the D9 artifacts: prohibition/conditional mentions of the deliberately-never-created *message-batches* ADR-016 (`ADR-014-allow-files-beta.md:80`, the PR2 canonical/patch/execution docs, `packages/provider-anthropic/src/beta-policy.ts:28` — a reserved-number hygiene item for the future ADR-INDEX, not a missing D9 target), same-numbered but unrelated concept headings in `canonical/govai_adp_v4_2.md:673-691`, and this register's own text. Classification (for the 2 genuine ones): `REPOSITORY_REFERENCE_TARGET_MISSING=YES`; `SOURCE_ARTIFACT_AVAILABLE_EXTERNALLY=YES`; `PROMOTION_PENDING=YES`. This is a documentary-integrity / repository-hygiene gap, **not** a P0.3-A runtime defect. Do **not** state "no broken document references exist" while the promotion is pending.
- **SEEDORG_FLAKE_CANDIDATE** (first observed as a primary-key prefix collision in an earlier unrelated integration attempt; root cause **source-adjudicated by M3** — the collision domain is the API-key prefix generator/schema rather than the fixture; since **recurred in CI** as an actual `api_keys_pkey` duplicate during the AI Console closeout runs — classification `EMPIRICALLY_MANIFESTED_TEST_FIXTURE_COLLISION`; the test-fixture manifestation is now `CLOSED_BY_BOUNDED_DB_COLLISION_RETRY` via `EP-AUTH-API-KEY-PREFIX-COLLISION-HARDENING` T1 (bounded `23505`/`api_keys_pkey`-only retry at the shared test issuance boundary; no prefix/format/lookup/migration change), while the latent R14 production auth-lifecycle design risk remains OPEN — see the current-state.md §8 F4 follow-up register) and **DIRECT_STREAM_REQUEST_ID_HEADER_GAP** (PRE_EXISTING; not introduced by F4; not F4-blocking) are recorded in current-state.md §8 as narrow, non-blocking follow-ups.
- Historical anchors inside completed-phase records (e.g. roadmap Phase 2.5 "Inputs" citing `governed-openai.ts:69-70` / `governed-anthropic.ts:71-72`, or "matches code at `8be5cfc`" rows above) describe the state at the time those phases executed and are deliberately NOT rewritten.
- EP-DOCS-04 changes no runtime behavior, no tests, no migrations, no schemas/routes/events, no dependencies.

## P0.3-A / PR #123 reconciliation (2026-08-08) — Movement 5 documentary roll

PR #123 ("fix(runs): move provider dispatch outside database transactions") squash-merged as `165291d90b144d3063ed87b8eaeac73e9a506e41` — tree `93613383` byte-identical to the audited head `08b59930`, single parent `4d6eab72`, 38 files, post-merge main CI run `31282331366` SUCCESS. F3: **DEMONSTRATED → CORRECTED**; P0.3-A **COMPLETE**; P0.3-C, F2, EC-5, ADR-032 promulgation and EP-11 remain open. Corrections applied in this roll:

| Document | Was (stale) | Now (corrected, Movement 5) |
|---|---|---|
| `current-state.md` anchor + manifests | anchor `e422280d`; migrations **27** (highest `0028`); tests **181** on disk (109 unit / 67 integration / 5 live); unit run 109 files / 1258 tests | anchor **`165291d9`**; migrations **28** (0001..0029, missing 0006; highest `0029_durable_provider_dispatch.sql`); tests **192** on disk (**113** unit / **74** integration / 5 live); default `pnpm test` = 113 files / **1296** tests, reproduced locally at this anchor |
| `current-state.md` §1 anchors | `server.ts:156-176` (hook `:170`); per-route registration lines `:156`–`:176` | `server.ts:161-181` (hook `:175`; recovery worker start `:191`); per-route lines re-derived at `165291d9` |
| `current-state.md` §3 run-lifecycle bullet | "`/v1/runs` orchestrator writes … via `auditAppend` — `run-orchestrator.ts:558,643,761,829,915,993,1264,1363`" (eight direct call sites) | run-lifecycle chain writes flow through the P0.3-A durable dispatch layer (`pipeline/run-dispatch-state.ts`, `auditAppend` at `:149/:178/:350`; lifecycle events `run.dispatch_prepared`/`run.dispatch_claimed`/`run.outcome_unknown`/`run.outcome_reconciled` + terminals); the orchestrator retains ONE direct call at `:947` (in-transaction governed deny) |
| `current-state.md` §8 F3 row | F3 `OPEN` — "P0.3 transaction and dispatch-state program" | F3 **CORRECTED** by P0.3-A / PR #123 (`165291d9`); classification unchanged (**DEMONSTRATED**) |
| `current-state.md` §8 C-2 anchor | "`run-orchestrator.ts:803`" | the real native-body hash is computed before the dispatch boundary (`run-orchestrator.ts:999` governed / `:1475` passthrough) and carried by the durable dispatch records |
| RLS mechanism description (0029, process reports) | described via a definer-function reading; a generic "no SECURITY DEFINER in 0029" retort would also be false | canonical: `RLS_FORCE_SUSPENSION_USED=YES`; `RLS_DEFINER_FUNCTION_USED=NO` (M-B decision count); `RLS_VISIBILITY_MECHANISM=OWNER_FORCE_SUSPENSION` (`0029:110-115`); `RLS_ROW_SECURITY_OFF_ROLE=FAIL_CLOSED_ASSERTION`; `SECURITY DEFINER` remains in use in the 0029 recovery-discovery primitive (`0029:460,497`) |
| `resume-playbook.md` §2–§4/§6/§8 | PR #93-era state: "main after PR #93 `d037e330`"; "ADR-027 accepted but not implemented/tested"; "zero `captureAuditEvent` call-sites in `apps/`"; direct routes "logger-only"; "B3 still not authorized" | reconciled to `165291d9`: AuditBridge wired (PR-B/EP-004), B3 implemented (EP-006), EP-008 arc + P0.1/P0.2/F4/P0.3-A landed; stop conditions rewritten to the current guards (see the file) |
| `development-roadmap.md` P0 register + D9 block | "P0.3-A / F3 — NEXT"; `D9_LOCATION=UNRESOLVED` | P0.3-A **COMPLETE**; **NEXT = ADR-032 repository promulgation**; D9 = source corpus LOCATED (11/11, owner-supplied v0.9 package), repository promulgation PENDING |
| (this register) D9 note | `D9_LOCATION=UNRESOLVED` + "no literal broken references reproduced (UNVERIFIED)" | superseded and falsified respectively — see the rewritten D9 note above (2 genuine missing-target production references: `0025.sql:36-37` + `capture.ts:54`; the broader 13-file ADR-016..019 sweep is classified, its other hits being reserved-number / homonym / self-referential mentions; source available externally; promotion pending) |

Notes (NOT corrections):

- The Movement-4 record "corrigir a afirmação incorreta sobre inexistência de issue-comments do bot" targets a claim made in **out-of-repo session reports**; a search at `165291d9` found no such claim in the repository docs, so there was nothing in-tree to correct. The out-of-repo record is corrected in the Movement 5 execution report.
- Movement 5 changes no runtime source, no tests, no migrations, no schemas/routes/events, no dependencies, no lockfile — documentation only. It does **not** promulgate ADR-032, does not implement EP-11, and does not promote any D9 artifact into the tree.

## Post-EP11 canonical state roll reconciliation (2026-08-12) — EP-11 recorded COMPLETE; Standing Owner Authorization v1 promulgated

Since the Movement 5 documentary roll (PR #124, merge `ee984f2`, single
parent `165291d9` = the PR #123 runtime merge that the roll anchored the four
canonicals at), two merges landed: PR #125 promulgated ADR-032 (`629b6e9f`)
and PR #126 implemented EP-11
(`01c05fd61428a76d300b73fb335021f598519d2f`, tree `20ccd433`, single parent
`629b6e9f`, 6 files, post-merge main CI run `31649394857` SUCCESS — unit +
integration). This roll brings the four canonicals to `01c05fd6`.
Corrections applied:

| Document | Was (stale) | Now (corrected, this roll) |
|---|---|---|
| `current-state.md` anchor + manifests | anchor `165291d9`; architecture docs **66**; ADRs **23** (highest ADR-028); tests **192** on disk (113 unit / 74 integration / 5 live); default `pnpm test` 113 files / 1296 tests | anchor **`01c05fd6`**; architecture docs **67**; ADRs **24** (ADR-032 added by PR #125; missing ADR-015..019 and ADR-029..031); tests **191** on disk (**112** unit / 74 integration / 5 live — EP-11 deleted `files-purpose-validator.test.ts`, adding no replacement file and expanding `tests/integration/openai-passthrough.test.ts` instead); default `pnpm test` = 112 files / **1286** tests, reproduced locally at this anchor; routes (18) and migrations (28) unchanged by #124/#125/#126 |
| `current-state.md` §8 P1 register | Subfamily B "includes the **current** `purpose_deprecated_post_sunset` branch"; "the owner-adjudicated decision remains **staged outside the repository** as ADR-032" | EP-11 (PR #126) **removed that specific branch** (`PURPOSE_DEPRECATED_LOCAL_DENY_BRANCH=CLOSED_BY_EP11`); ADR-032 was promulgated in PR #125; the class remains `OPEN_SEPARATE_P1` (EP-11 did not remediate the family) |
| `development-roadmap.md` P0 register | ADR-032 "repository-promulgation artifact defined … EP-11 must not begin unless that ADR artifact is present on `main`"; "EP-11 — NEXT" | ADR-032 promulgation **COMPLETE** (PR #125); EP-11 **COMPLETE** (PR #126); `NEXT_DEVELOPMENT_MOVEMENT=P0.3-C`, then F2, then PR-0/D9 V2 |
| `resume-playbook.md` §2–§4 | known-good main `165291d9`; EP-11 an open gate; "CI as an enforced two-job gate" | known-good main **`01c05fd6`** (post-EP11); EP-11 moved to closed gates; CI wording corrected (workflow evidence ≠ GitHub branch enforcement; merge protocol is process-enforced) |

Process-control reconciliation — routine development authorization model:

The former external dispatch protocol used a per-merge human G17 handshake
before every squash merge. Current owner policy, promulgated by this roll in
resume-playbook.md §9:

```text
G17_ROUTINE_DEVELOPMENT=RETIRED
STANDING_OWNER_AUTHORIZATION_V1=ACTIVE
ROUTINE_SQUASH_MERGE_PREAUTHORIZED=YES
ONE_MISSION_ONE_PR_ONE_MERGE=REQUIRED
```

Reason: routine scoped development uses risk-proportional friction while
retaining every technical gate (exact-head CI, bounded review, frozen-head
merge, scope and A2 gates) and explicit human STOPs for material/high-risk
exceptions (admin bypass, force, scope expansion, destructive/irreversible
actions, secrets, production/paid infrastructure, visibility, branch
protection/rulesets, event-schema/evidence-semantic changes, live B3,
owner-reserved actions — the full list is resume-playbook.md §9). This is
**not** a weakening of the substantive CI/review gates, and branch
protection was **not** enabled as a replacement
(`REPO_ENFORCEMENT_ASSESSMENT=DEFERRED_NON_BLOCKING`; do not write
"GitHub-enforced" unless independently proven by current repository
settings).

Notes (NOT corrections):

- The ADR-032 file itself is deliberately unchanged by this roll (its
  localized `IMPLEMENTATION_STATUS=PENDING` staleness is registered in the
  table above for separate maintenance). D1–D5 and the Accepted decision are
  not stale; do not reopen the decision.
- Historical reconciliation sections in this register remain historical and
  are not rewritten.
- This roll changes exactly four documentation files (the four canonicals);
  no runtime, tests, migrations, workflows, dependencies, ADRs, or
  repository settings.

## Post-P0.3-C canonical state roll reconciliation (2026-08-14) — P0.3-C recorded COMPLETE

Since the post-EP11 roll (PR #127, merge `6da481c`) anchored the four
canonicals at `01c05fd6`, two merges landed: PR #128 refined the
routine-authorization semantics in resume-playbook §9–§10 (merge
`21afa116`), and PR #129
implemented **P0.3-C cross-request run execution idempotency** (squash
`f381d3fac24d5938aed91b6618ef511b66ddc878`, tree `a64e7178` byte-identical to
the audited head `bfa05c5b`, single parent `21afa116`, 8 files, post-merge
main CI run `31802636887` SUCCESS — unit + integration). Before this roll the
four canonicals (`current-state.md`, `development-roadmap.md`,
`stale-docs-register.md`, `resume-playbook.md`) were still anchored at the
post-EP11 state and still described **P0.3-C as open** / "the next
runtime-development movement". This roll resolves that staleness and brings
the four canonicals to `f381d3fa`. Corrections applied:

| Document | Was (stale) | Now (corrected, this roll) |
|---|---|---|
| `current-state.md` anchor + manifests | anchor `01c05fd6`; migrations **28** (highest `0029`); tests **191** on disk (112 unit / 74 integration / 5 live); default `pnpm test` 112 files / 1286 tests | anchor **`f381d3fa`**; migrations **29** (0001..0030, missing 0006; highest `0030_run_idempotency.sql`); tests **194** on disk (**113** unit / **76** integration / 5 live — P0.3-C added `run-idempotency.test.ts` unit + `run-idempotency.test.ts`/`workroom-run-idempotency.test.ts` integration); default `pnpm test` = 113 files / **1316** tests, reproduced locally at this anchor; architecture docs (67), regulatory (20), ADRs (24) and routes (18) unchanged |
| `current-state.md` §8 P0 register + PR #123 block | "the remaining P0.3 slices (P0.3-C) remain open"; `P0_3_C=OPEN` | P0.3-C **COMPLETE** (PR #129, new §8 canonical-state block); `P03_RUNTIME_LANE=COMPLETE`; `P0_TRUTH_AND_INTEGRITY_PROGRAM=OPEN` (F2 + PR-0/D9 promulgation remain); the known v1 pre-reservation window is registered as `KNOWN_V1_LIMITATION` / `DEFERRED_LIVENESS_ENHANCEMENT_BY_FROZEN_CONSTRAINT` (`SAFETY_DEFECT=NO`) |
| `development-roadmap.md` P0 register + sequencing | item 5 "Remaining P0.3 slices (P0.3-C — OPEN)"; `NEXT_DEVELOPMENT_MOVEMENT=P0.3-C` | item 5 = P0.3-C **COMPLETE** with merge evidence; `NEXT_DEVELOPMENT_MOVEMENT=F2_SOURCE_ADJUDICATION`, `THEN=PR-0/D9_V2`; independent queues (LOCAL_DENY, EC-5, repo enforcement, streams, prefix robustness, ADR-032 maintenance, Phase 5+, Workroom 5–7) preserved unabsorbed |
| `resume-playbook.md` §2–§4 | known-good main `01c05fd6` (post-EP11); open gates led by "P0.3-C OPEN" | known-good main **`f381d3fa`** (post-P0.3-C, CI run `31802636887`); P0.3-C moved to closed gates; the first open development gate is **F2** |

Review/process bookkeeping for PR #129 (canonical): **4 substantive review
threads, 4 resolved, 0 active unresolved current threads** (a thread may
remain non-outdated while correctly resolved — non-outdated ≠ unresolved);
**3 substantive Codex correction rounds** (the configured maximum was not
exceeded) + **1 final verification pass** on the corrected exact head with
**2 explicit clean responses**. Do not restate this as "6 threads" or "4
correction rounds".

### Process-control lesson — automated probe semantics

Automated textual probes (grep/regex/literal scans) may produce false
positives and false negatives — especially around negations, comments, SQL
syntax variants and semantic context. Canonical review discipline:

```text
PROBE → READ_SOURCE → UNDERSTAND_SEMANTICS → ONLY_THEN_REPORT
```

A grep/regex match alone is not a finding, and a probe miss alone is not an
absence proof. This does not weaken fail-closed gates: a defined semantic
requirement that genuinely fails still blocks.

### Process-control lesson — Codex clean-signal transport

The final clean Codex results for PR #129 arrived as **issue comments**
("Didn't find any major issues", with an explicit `Reviewed commit:`
attribution), not as `pull_request_review` objects or reactions. The
controlling invariant is **semantic**, not the transport object type:

```text
CODEX_CLEAN_ACCEPTABLE_SIGNAL =
  trusted Codex bot/App author identity
  + explicit clean result
  + reviewed SHA resolves to the EXACT current head
```

First verify the comment AUTHOR is the trusted Codex bot/App identity (the
installed Codex GitHub App's bot login, e.g. `chatgpt-codex-connector[bot]`)
— an untrusted account with comment permission could imitate a clean
response that includes the current SHA, so author provenance is part of the
gate, not an optional check. Then extract the reviewed SHA, compare it to
the exact current PR head, and classify the content. A missing, ambiguous or
mismatched reviewed SHA, an untrusted/unverifiable author, or content
containing a substantive finding — each remains fail-closed. Never treat
"a comment exists" alone as clean, and never treat the absence of one
particular transport type as the absence of a review result.

## Foundation V1 M3 canonical freeze reconciliation (2026-08-18) — reanchor to `de80664a`; PR-0/D9 promulgated

Since the post-P0.3-C roll (PR #130, `ab722deb`) anchored the four canonicals at
`f381d3fa`, three runtime merges landed — M1 (PR #131, `3e90f2fb`), M2A (PR #132,
`de80664a`) — plus the read-only M2 real-provider acceptance; M3 (PR #133,
docs-only) reanchors the canonicals to `de80664a`, promulgates the PR-0/D9 corpus
and records the Foundation V1 freeze. Corrections applied by M3:

| Document | Was (stale) | Now (corrected, M3) |
|---|---|---|
| `README.md` (root) | "B3 runner is not implemented and is not authorized"; direct audit emission "logger-only"; runtime-to-evidence "not yet wired"; external `../docs/govai_adp_v3.md` as current authority | AuditBridge wired (four routes → outbox), B3 runner implemented (`apps/audit-sealer`), Foundation V1 live-accepted (executed scope), explicit non-claims; external ADP v3 reference marked historical; navigation via `docs/README.md` (E1 / D15) |
| `current-state.md` | anchor `f381d3fa`; F2 `OPEN_PENDING_SOURCE_CLASSIFICATION`; §2 gzip/Content-Encoding PLANNED and `stream_final_hash` presence-only; beta gate "emits `passthrough.beta_denied`" (default-deny framing); no M1/M2/M2A record; D9 pending; ADRs 24 | anchor **`de80664a`**; F2 **CLOSED_WITH_REGISTERED_RESIDUAL**; §2 = Foundation V1 native contract (unknown betas / non-computer tools forwarded + observed; computer-use-only floor; Content-Encoding truth; query fidelity; `request-id`; gate order; live acceptance separated); M1/M2/M2A/M3 canonical blocks; D9 complete in tree; ADRs **31** (+ index); manifests recomputed (unit 128 files / 1453 tests) |
| `development-roadmap.md` | "F2 — the next development movement"; "PR-0/D9 — after inputs"; `POST_P03C_CANONICAL_STATE_ROLL=THIS_MOVEMENT`; D9 `PRESENT_IN_MAIN=NO` / `PR0_STATUS=DOCUMENTARY_BLOCKED…` | F2 closed with residual; PR-0/D9 complete in the M3 tree; `FOUNDATION_V1=DOCUMENTARY_FREEZE_RECORDED_IN_THIS_TREE` (tree-stable; merge lifecycle declared externally); next recommended lane `UI_UX_V1_FOUNDATION` (not started) with constraints; LOCAL_DENY class superseded |
| `resume-playbook.md` | frozen "known-good main `f381d3fa`"; open gates led by F2; "any prompt that promotes D9 artifacts outside the dedicated PR-0/D9 V2 movement" as a stop condition | dynamic current HEAD (`git rev-parse origin/main`) separated from the immutable runtime anchor and the M3 documentary freeze; F2 closed; D9 promulgated (future D9 changes need a dedicated doctrine movement); residual register + Standing Owner Authorization + next lane |
| `docs/architecture/adr/ADR-021-provider-native-experience-preservation.md` | `Status: Proposed`; B3-gating wording ("B3 must not start until…", "Stop conditions for B3") read as current | **Accepted** (owner adjudication `ADR021_FINAL_STATUS=ACCEPTED`); doctrine vs proven scope separated; B3 gates marked historical; implementation/validation section |
| `docs/architecture/adr/ADR-032-openai-files-purpose-provider-truth.md` | `IMPLEMENTATION_STATUS=PENDING`; interim validator behavior as current | `IMPLEMENTATION_STATUS=COMPLETE` (EP-11 / PR #126); interim wording `HISTORICAL_PRE_EP11_RUNTIME` |
| `docs/architecture/specs/h1v2-coverage-map.md` | anchored `9d94fedd` (2026-06-03); "pending separate B3 authorization"; CT-005 `out_of_scope_followup`; STREAM-005 presence-only; INT anchors stale | regenerated at `de80664a`; B3 wording historical; CT-005 **covered** (M1 content-encoding suites); STREAM-005 correctness over emitted bytes proven; FV1-* rows; hermetic vs live separated |
| `docs/architecture/specs/provider-native-compatibility-harness.md` | "currently untracked"; "B3 remains blocked"; gzip policy gap | Foundation V1 status addendum (tracked; B3 implemented; CT-005 closed; body preserved) |
| D9 / PR-0 (this register's D9 note above) | `D9_PRESENT_IN_REPOSITORY_MAIN=NO`; `D9_REPOSITORY_PROMULGATION=PENDING`; `PR0_STATUS=DOCUMENTARY_BLOCKED_PENDING_PROMULGATION`; 2 (in fact 3 path targets + 1 name reference) broken production references | promulgated (`d9-promulgation-manifest.md`); `0025_…sql:35-37` (SPEC v2.1, ADR-017, threat-model) and `capture.ts:54` resolve; `D9_REAL_MISSING_TARGETS_IN_PR_TREE=0`; the earlier D9 notes are HISTORICAL |
| `current-state.md` §"Separate P1 evidence-integrity register" | class-wide `LOCAL_DENY_EVIDENCE_INCOMPLETENESS=OPEN_SEPARATE_P1` | `OLD_CLASS_WIDE_LOCAL_DENY_LABEL=SUPERSEDED_BY_NARROW_RESIDUALS` (R4/R5, R2/R3) — every governance-decision block emits a durable blocked v4 since M1 |
| M2/M2A findings | (not in-repo) | carried forward from the hash-verified records into foundation-v1-freeze.md §8: request-id CLOSED, entrypoint CLOSED, query forwarding CLOSED, diagnostic taxonomy DEFERRED_NON_BLOCKING, HEAD probe DEFERRED_COMPATIBILITY_NON_BLOCKING, beta snapshot DEFERRED_RUNTIME_NON_BLOCKING |

Foundation V1 residuals (retained, not stale claims — see foundation-v1-freeze.md §6):
R1 query request-target not first-class in v4 · R2 F2 provenance · R3 unknown-beta
typed provenance · R4 credential-unresolvable durable evidence · R5 v1 diagnostics as
bridge drops · R6 beta snapshot freshness · R7 real EC-5 · R8 P0.3-C liveness window ·
R9 branch protection deferred · R10 broader endpoint parity · R11 Workroom 5–7 ·
R12 Phase 5 primitives · R13 tier/governance-profile separation · R14 human auth for a
production UI · R15 SPEC v2.2 consolidation · R16 legacy `docs/` root artifacts.

Newly registered staleness (observed by M3, deliberately NOT edited — out of the docs-only
freeze scope or awaiting a separate owner decision):

| Document | Statement | Classification | Action |
|---|---|---|---|
| `docs/architecture/source-spec.md`, `docs/architecture/baseline-decisions.md` | `govai_adp_v3.md` (external, outside the monorepo) as "fonte exclusiva de verdade arquitetural"; ADP v3 checksums | HISTORICAL_STATE (ADP-v3-era baseline documents); the in-repo canonical set (`docs/README.md` hierarchy) supersedes the external reference | the PR-0 E11 owner gate (declare `canonical/govai_adp_v4_2.md` + addendum as canonical ADP in `source-spec.md`) was NOT adjudicated by M3 — separate owner decision |
| `docs/architecture/adr/ADR-027-runtime-to-evidence-dispatch.md` status line; ADR-022/024/025/026 status lines | "not implemented, not tested, does not authorize B3" / "design constraint for future B3 implementation" | HISTORICAL_STATE in an accepted ADR (implemented by EP-004 / EP-006; recorded in `adr/ADR-INDEX.md`) | separate ADR-maintenance normalization; decisions are not stale |
| `docs/architecture/workroom-governance-room.md` | earlier-registered "proposed … no runtime implementation" framing + the approval-behavior passage flagged by the July 2026 consistency review | HISTORICAL/TARGET framing (Phases 1–4 implemented; 5–7 target) | separate docs movement (PR-0 E10 not applied) |
| `docs/architecture/governance-philosophy.md`, `docs/contracts/*.md` | TARGET-labeled absolutes (hard-deny floor "always active"; contracts elevated by target specs) | TARGET framing (labels added by EP-000; PR-0 E4/E7–E9/E13 prepends not applied) | separate docs movement |
| `tests/live/provider-live-streaming-validation.test.ts:340-345`, `tests/live/provider-live-passthrough-validation.test.ts:418-419` | comments "direct /governed routes intentionally emit via the server logger … PR3+ wiring task", "events emitted to the hijacked logger" | STALE_COMMENT_ONLY (M2 §13; contradicted by the wired AuditBridge) | test files are outside the docs-only scope; fix in a future test-touching movement |
| `docs/runbooks/user-e2e-local.md` | curl examples use the model alias `claude-3-5-haiku-latest` (not in the live model list observed by M2 for the owner's key) | NON_FOUNDATION_STALENESS_CANDIDATE (provider model lifecycle, not a Foundation V1 change) | not edited (M3 §27: no speculative runbook edits); verify and refresh in a runbook maintenance pass |
| promoted July 2026 corpus (`plans/`, `registers/`, `GOVAI-MAPA-MESTRE…`, `GOVAI-DOSSIE…`, `consolidation-plan-2026-06.md`, `execution/pr0/`) | bodies describe the state/queue at f975533d–ed18736a (F1–F6 "pendente", pre-M1 hard-deny floor, EP-11 deadline framing, D9 pending, market sources dated 2026-02..07) | HISTORICAL_SNAPSHOT / PLAN_TARGET / COMMERCIAL_EVALUATION — each file carries an M3 promulgation header naming its known-stale families and the precedence of `current-state.md` + the freeze record | none (bodies deliberately preserved; §16 large-document policy) |
| `docs/codex-*`, `docs/govai_runtime_patch_1_pre_merge_v2.md` | legacy review/prompt artifacts loose at the `docs/` root | LEGACY_ROOT_ARTIFACTS=INVENTORIED_DEFERRED_TO_SEPARATE_HYGIENE_PR (checks L1–L5 before relocation) | separate hygiene PR (R16) |

Notes (NOT corrections):

- M3 changes only documentation (`README.md` + `docs/**` + one byte-identical `.sha256`
  provenance artifact carried from the source package): no runtime, tests, migrations,
  workflows, dependencies, lockfile, event schema, AuditBridge, capture projection or
  hash-domain changes. The Foundation V1 runtime anchor stays `de80664a`.
- Historical reconciliation sections in this register remain historical and are not
  rewritten; earlier D9/F2/B3 statements in them are HISTORICAL_STATE.
- Provider beta policy tables were NOT refreshed by M3 (documented as residual R6).

## UI/UX V1 U1 reconciliation (EP-UIUX-V1-U1) — `apps/ui` exists; the lane has started

The `UI_UX_V1_FOUNDATION` lane the M3 freeze recommended has been started, and its first
milestone (U1 — evidence cockpit) is implemented as `apps/ui`. This is a code movement with a
minimal documentary reconciliation: **no backend runtime, migration, event-schema, AuditBridge,
capture-projection or hash-domain change**, so the Foundation V1 runtime anchor `de80664a`
stands. Corrections applied:

| Document | Was (stale once `apps/ui` exists) | Now (corrected) |
|---|---|---|
| `current-state.md` | no interface layer recorded at all; source manifests listed 2 apps and only the root vitest corpus | Status bullet + §1 *Interface layer* (surfaces, honesty vocabulary, i18n, session model, explicit non-claims); manifests list 3 apps and the separate `@govai/ui` suite |
| `development-roadmap.md` | `NEXT_RECOMMENDED_PRODUCT_LANE=UI_UX_V1_FOUNDATION` / `NEXT_EXECUTED=NO`; section titled "next product lane (recommended, NOT started)" | lane **STARTED**, `UI_UX_V1_U1=IMPLEMENTED_IN_THIS_TREE`, `UI_UX_V1_U2=NOT_STARTED` with its named backend prerequisites (EP-B2, EP-B4) and the other named follow-ups (EP-B7, EP-B1, EP-V1, Playwright); the constraints (R12/R13/R14, claims-policy) are retained verbatim in force |
| `resume-playbook.md` | "Next recommended product lane … NOT started"; CI described as the **unit** and **integration** jobs | current lane STARTED with U1 implemented and U2 not started; CI described as **unit**, **ui** and **integration** |

Newly registered staleness observed while re-reading the source for U1 (NOT edited — the
promoted July 2026 plan bodies are preserved under the §16 large-document policy):

| Document | Statement | Classification | Action |
|---|---|---|---|
| `plans/GOVAI-UI-MASTER-PLAN-FABLE5…` §2.1 (screen 4) and §9.2; `plans/GOVAI-MASTER-PLAN-APPLICATION-FABLE5…` §3.4 | the capabilities screen shows "em que nível (`policy_governed` vs `passthrough_audited`)" | **STALE_CONTRACT_ASSERTION** — `GET /v1/capabilities` serves `BASELINE_REGISTRY` from `@govai/core-governance`, whose facets carry a NUMERIC governance level 0–3 (ADR-004/ADR-005) and an orthogonal `evidence_strength`. `policy_governed`/`passthrough_audited`, `base_risk_class` and endpoint coverage live in the `@govai/core-types` provider registries, which that route never touches. This family is NOT covered by the M3 promulgation header's known-stale list (a)–(f) | U1 renders the numeric governance level and says so explicitly on the screen; the plan bodies are preserved |
| same plans, data conventions (`bigint SEMPRE como string decimal`) | stated as a repository-wide convention | **OVERBROAD_AS_STATED** — true for `Ec2GapRow.first_gap_seq` / `gap_count`, but `GET /v1/audit-events` narrows `sequence_number` with `Number()` server-side (`routes/audit-events.ts:84`), so it is a JSON number on that route | the UI mirrors each route's actual type; both are pinned by tests |
| same plans, §3.3 / §9.3 ("envelope de erro uniforme `{error, …}`") | stated as universal | **INCOMPLETE_AS_STATED** — the 429 body comes from `@fastify/rate-limit` and an unknown path 404s with Fastify's default; neither carries a GovAI `error` code | the UI client normalizes both shapes and keys 429 off the status code |
| `plans/GOVAI-UI-MASTER-PLAN…` §5.1 / §7.3, F1–F6 "contrato corrigido — pendente do fix" family | UI fields gated behind a `contractFixed` flag | already listed as known-stale family (a) in the M3 promulgation header (F1/F3/F4/F5/F6 + C-2 corrected, F2 closed with residual) | no flag machinery was built: U1 renders no per-request enforcement field, because no route exposes one at this base (EP-B6) |

Notes (NOT corrections):

- EP-UIUX-V1-U1 changes `apps/ui/**`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`, the
  repository-root `vitest.config.ts` (one `exclude` entry so the node-environment root config
  does not collect the jsdom UI suite) and the three canonical documents above. No `apps/api`,
  `apps/audit-sealer`, `packages/**`, migration, schema or D9 artifact is touched.
- The Foundation V1 residual register (freeze record §6) is unchanged by this movement:
  R12 (Phase 5 primitives), R13 (tier ↔ governance-profile separation) and R14 (human auth
  for a production UI) all still stand, and the U1 interface is built to respect them rather
  than to work around them.

## UI/UX V1 EP-B2 reconciliation (EP-UIUX-V1-B2-WHOAMI-01) — `GET /v1/me` exists

`GET /v1/me` is implemented (`apps/api/src/routes/me.ts`, registered at `server.ts:165`) and the
U1 interface consumes it. This is a **code** movement: an additive, read-only route plus a
bounded UI integration. **No migration, no schema object, no event schema, no AuditBridge or
capture-projection change, no provider or evidence behaviour change** — the Foundation V1
runtime anchor `de80664a` still names the accepted Foundation V1 runtime; this is a post-freeze
additive read surface, not a re-anchoring. Corrections applied:

| Document | Was (stale once `/v1/me` exists) | Now (corrected) |
|---|---|---|
| `current-state.md` §1 | `server.ts` register anchors `:162-182` (hook `:176`, worker `:192`, entry guard `:255`); "UI shell identity display … **no role, tier or operational-mode badge**, because no route serializes them and there is no `/v1/me`"; 18 route files; 209/128/76 test files; 14 UI files / 281 UI tests | anchors re-derived in this tree (`:163-184`, hook `:178`, worker `:194`, entry guard `:257` — `routes/me.ts` registers at `:165` and shifts the rest); a `/v1/me` row in the surfaces table; the identity-display row rewritten to what the shell now shows and to why tier stays out of the header (R13); 19 route files; 211/129/77; 15 UI files / 324 UI tests |
| `development-roadmap.md` | "**EP-B2** (`GET /v1/me`) … unadjudicated"; U2 gated on EP-B2 **and** EP-B4; `BACKEND_RUNTIME_CHANGE=NONE` | EP-B2 implemented, with its exact contract and its exact non-claims; U2 gated **only** on EP-B4; U1.5 (AI Console) named as not started; `BACKEND_RUNTIME_CHANGE=ADDITIVE_READ_ONLY_ROUTE` with the enumerated absences |
| `resume-playbook.md` §3/§4 | U2 "gated on EP-B2 (`GET /v1/me`) and EP-B4" | EP-B2 recorded as a closed gate; U2 gated only on EP-B4; U1.5 named as not started |
| `apps/ui/README.md` | "**No role, tier or operational-mode badge.** No route returns them at this base and there is no `/v1/me`"; "**EP-B2 `GET /v1/me`** — without it the shell cannot show roles, tier or operational mode" (a named follow-up) | an identity section stating what is shown and what it must never be read as; EP-B2 removed from the follow-up list |
| `apps/ui/src/lib/contract/errors.ts`, `apps/ui/src/lib/api/query-client.ts` | `apps/api/src/server.ts:108-111` (the rate-limit register) | `:109-112` — the same one-line shift |

Newly registered staleness observed while re-reading the source for EP-B2 (NOT edited):

| Document | Statement | Classification | Action |
|---|---|---|---|
| `plans/GOVAI-UI-MASTER-PLAN-FABLE5…`, `plans/GOVAI-UI-ARCHITECTURE-CONSULT-FABLE5…`, `plans/GOVAI-MASTER-PLAN-APPLICATION-FABLE5…`, the `registers/GOVAI-*-FABLE5…` family | `server.ts:93-105` / `:102-105` / `:116-154` / `:156-176` line anchors | **HISTORICAL_ANCHOR** — July 2026 promulgated bodies preserved verbatim under the §16 large-document policy, already anchored to a pre-U1 tree and already off by far more than EP-B2's one line | preserved; `current-state.md` is the anchor authority |
| `apps/api/src/routes/{evidence,audit-events,capabilities}.ts` | the four other authenticated read surfaces set **no** `Cache-Control` (`@fastify/helmet` sets none either), and the credential this API leads with is `x-govai-api-key` — an ordinary header, so RFC 9111 §3.5's shared-cache prohibition for `Authorization` does not apply to them | **LATENT_CROSS_TENANT_CACHE_EXPOSURE** — no repository deployment puts a caching proxy in front of `/v1/*` today (EP-UI-DEPLOY does not exist), so this is latent, not live. `GET /v1/me` sets `no-store` because it is in this movement's scope; extending it to the other four is a class fix across route files this movement was not scoped to touch | **named, deliberately not half-applied** — a follow-up (or EP-UI-DEPLOY, which is where a cache would first appear) should set it on every authenticated read surface |
| `docs/runbooks/user-e2e-local.md` §0 | "expose a one-shot seed script if you want a hand key" | **STILL ACCURATE** — no committed one-shot org-seed script exists, and EP-B2 did not add one (it would be scope this dispatch did not authorize). The EP-B2 operator acceptance used the repository's own primitives — `generateApiKey()` from `@govai/core-identity` plus the same two INSERTs `seedOrg` performs — through a throwaway `tsx` invocation, recorded in the external mission record | none; a committed dev seed script remains an unclaimed follow-up |

Notes (NOT corrections):

- EP-UIUX-V1-B2 changes `apps/api/src/routes/me.ts` (new), `apps/api/src/server.ts` (two lines:
  one import, one register), `apps/api/src/pipeline/auth.test.ts` (new),
  `tests/integration/me-route.test.ts` (new), `apps/ui/**` and the four canonical documents
  above. No migration, no `packages/**`, no `apps/audit-sealer`, no workflow, no D9 artifact and
  no Foundation V1 freeze record is touched.
- **A test that asserted an absence over a text blob stopped working silently, and that is the
  durable lesson.** `session-lifecycle.test.tsx` asserted that the shell showed no
  role/tier/mode by running whole-word regexes over the header's concatenated `textContent`.
  Adjacent elements concatenate without a separator, so the rendered `production` chip followed
  by the `Principal` chip reads as `productionprincipal`, and `\bproduction\b` returns FALSE for
  a value plainly on screen — the test would have passed even if EP-B2 had fabricated every
  value it now displays. It was replaced by per-element assertions. The pattern, not the
  instance, is what is registered here.
- The Foundation V1 residual register (freeze record §6) is unchanged by this movement. **R13**
  (tier ↔ governance-profile separation) and **R14** (human auth for a production UI) are the
  two this movement touches most closely, and both are respected rather than worked around:
  tier is rendered only in an account/details affordance, explicitly qualified as commercial and
  explicitly denied as a security/governance/policy level; and `principal_type` exists precisely
  so a controlled-pilot org credential is never presented as a human login.

---

## UI/UX V1 U1.5 reconciliation (EP-UIUX-V1-U1.5-AI-CONSOLE-01) — the AI Console exists

`/ai` is implemented (`apps/ui/src/features/ai/**`, route table `apps/ui/src/app/routes.tsx`).
**`BACKEND_RUNTIME_CHANGE=NONE`** — no route, no migration, no schema object, no event schema,
no AuditBridge or capture-projection change, no provider or governance behaviour change. The
Foundation V1 runtime anchor `de80664a` still names the accepted Foundation V1 runtime.
*(Present-tense clarifier: the `NONE` above describes the INITIAL U1.5 movement this section
recorded at its head. The final merged PR #137 tree includes the two owner-adjudicated
CLOSEOUT-02 provider-package fixes — backend changes, with root test suites — dispositioned
in the findings table below. The merged milestone is therefore not UI-only.)*

| Document | Was (stale once `/ai` exists) | Now (corrected) |
|---|---|---|
| `current-state.md` §1 | "U1.5 (AI Console) and U2 (Workroom) are not started"; interface layer titled "milestone U1"; 15 UI files / 324 UI tests | U1.5 recorded with its route, its six provider×mode combinations, its memory-only transcript, its no-auto-retry policy, its receipt limits and its two open backend findings; 31 UI files / 708 UI tests; the acceptance harness named as operator-driven and excluded from both vitest configs |
| `development-roadmap.md` | `UI_UX_V1_U1_5_AI_CONSOLE=NOT_STARTED`; "U1.5 — AI Console (not started)" | implemented, with `BACKEND_RUNTIME_CHANGE=NONE` and the two open findings stated as backend work this movement was not authorized to do |
| `resume-playbook.md` §3 | "U1.5 (AI Console) is NOT started" | implemented, with the Anthropic browser blocker named so the next session does not rediscover it |
| `apps/ui/README.md` | described a read-only evidence interface | an AI Console section: the routes it drives, what the receipt may and may not say, and the non-goals |

### ★ New findings, source-proven during the U1.5 live acceptance

Both provider-package findings were **owner-adjudicated `FIX_REQUIRED`** and are **FIXED** in
this tree by `EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02`. The rows below are kept as written —
they are the historical record of what was measured and why — and each carries its present-tense
disposition. `PROVIDER_ROUTE_SEMANTICS_CHANGE` still requires owner adjudication; this pair had
it. `UI-DEV-PROXY-STREAM-CLOSE-01` remains open and dev-only.

| Finding | Severity | Evidence | Why the UI cannot fix it |
|---|---|---|---|
| **`AI-CONSOLE-ORIGIN-RELAY-01`** — the direct provider routes relay the browser's `Origin` header upstream | **P0 for the Anthropic surface**; latent for OpenAI | `buildOutboundHeaders` in `packages/provider-anthropic/src/routes/register-passthrough.ts` (and its OpenAI twin) copies every inbound header except `HOP_BY_HOP` ∪ `STRIP_INBOUND_AUTH`; `origin` is in neither set, in either package. Measured against the running API with the same body four ways: **baseline → 200**, **+`Origin` → 401** `{"type":"error","error":{"type":"authentication_error","message":"CORS requests must set 'anthropic-dangerous-direct-browser-access' header"}}`, **+`Referer` only → 200**, **+`Sec-Fetch-Mode` only → 200**. Only `Origin` triggers it | `Origin` is a forbidden header name: page JavaScript can neither remove nor alter it, and the browser sends it on same-origin POSTs too. The only other route would be for the console to send `anthropic-dangerous-direct-browser-access`, which asserts that the provider key is exposed to the browser — the exact opposite of GovAI's architecture, and a false statement. The fix belongs on the server→provider hop: `Origin` describes the browser↔GovAI hop and has no meaning for a server-side call. **★ FIXED (CLOSEOUT-02).** `packages/provider-{openai,anthropic}/src/outbound-header-policy.ts` owns one `STRIP_INBOUND_BROWSER_HOP` per package; every outbound header builder applies it — Native/Audited route, governed handler, both OpenAI governed surfaces, streaming and non-streaming — and the legacy exported `rewritePassthroughHeaders` holds the same policy so no future caller can reintroduce the relay through it. Deliberately NOT a browser-header purge: `user-agent`, `referer` and the `sec-*` families are still forwarded, asserted by test. Wire-level regression coverage in `*.inbound-hop-headers.test.ts` (real socket, both providers, both modes, stream and non-stream); live-reaccepted against real Anthropic in Native and Governed |
| **`AI-CONSOLE-RESPONSES-DLP-GAP-01`** — the governed OpenAI Responses DLP pre-scan skips role-shaped `input[]` items | P1 (governance) | `extractOpenAIResponsesText` (`packages/provider-openai/src/governed/extract-text.ts`) hands `input[]` to `pushParts`, which acts only on items whose `type` is `text` / `input_text` / `message`. An item identified by `role` alone matches none, so it is never descended into. Measured with the same CPF: `input: "…"` → **C/enforce**; `[{type:'message', …}]` → **C/enforce**; `[{role, content:"…"}]` → **A/observe**; `[{role, content:[{type:'input_text'}]}]` → **A/observe**. Chat Completions and Anthropic Messages scan a plain string correctly | The console avoids its own exposure by sending fully-qualified typed user items (`apps/ui/src/features/ai/providers/openai-responses.ts`, with a regression test), because the alternative was shipping a Governed mode that scans nothing on its default OpenAI surface. That protects this client only — every other caller using the provider-documented shorthand still gets no scan. **★ FIXED (CLOSEOUT-02).** The extractor now recognizes the message item by `type: 'message'` OR by the role-shaped `EasyInputMessage` form (`type` optional), and walks a `content` that is a string as well as one that is an array of parts; `output_text` parts of a replayed assistant turn are covered too. All five accepted spellings extract identically. It is NOT a recursive string scan: ids, metadata, model names, tool identifiers and non-message input items are still never read as prompt text. Chat Completions is unchanged, and no risk matrix / decision table / enforcement semantics / event schema / AuditBridge posture moved — only coverage. Proven by `extract-text.test.ts` and end to end by `register-governed.dlp-equivalence.test.ts`, which asserts one governance outcome across all six representations and that the scan runs BEFORE provider dispatch |
| **`UI-DEV-PROXY-STREAM-CLOSE-01`** — the Vite DEV proxy does not propagate an abnormal upstream close | dev-only, non-blocking | With an upstream that truncates a stream mid-flight: **direct to GovAI → `curl` exit 18** ("transfer closed with outstanding read data remaining") after ~11 s, i.e. GovAI correctly ends the downstream response and records `stream_outcome: upstream_error`; **through the Vite proxy → `curl` exit 28**, the connection held open to the 30 s timeout. A normal stream closes correctly through the same proxy (exit 0) | GovAI behaves correctly; the dev server does not. In `pnpm dev` a truncated stream leaves a turn showing "Generating…" until the reader presses Stop. The production reverse proxy does not exist yet (**EP-UI-DEPLOY**), so whichever one is chosen must be verified to propagate an abnormal upstream close — added to that EP's acceptance rather than guessed at here |

### Named residual — `PROVIDER-NONSTREAM-FORWARD-UNBOUNDED-01`

Source-proven during the `CLOSEOUT-02` review rounds, **not fixed**, and deliberately so.

The NON-STREAM passthrough forward has no deadline and no body ceiling. Both routes call
`forwardRaw` with no `signal`
(`packages/provider-openai/src/routes/register-passthrough.ts:586` and the Anthropic twin at
`:578`), and `forwardRaw` awaits `res.arrayBuffer()` — an unbounded read of an upstream the
provider controls. A provider or intermediary that sends an enormous body, or never finishes
one, leaves the API buffering or waiting indefinitely; a client disconnect is not propagated on
this path either. The STREAMING forward is unaffected — EP-008C threads an `AbortController`
through it and aborts upstream on client disconnect.

What changed is only its reachability: the AI Console runs `GET /passthrough/*/v1/models`
automatically when `/ai` opens, so a browser now triggers this path routinely. The browser-side
request deadline added in this PR bounds the BROWSER's wait; it cannot bound the GovAI→provider
hop, and the register should not read as though it does.

Not fixed here for one reason: it is `packages/provider-*` route behaviour, which
`PROVIDER_ROUTE_SEMANTICS_CHANGE=FORBIDDEN_UNLESS_A_REAL_BLOCKER_IS_SOURCE_PROVEN_AND_OWNER_ADJUDICATES`
places behind owner adjudication, and it is **not one of the two findings the owner
adjudicated** for this mission. It is also pre-existing: this PR's only change to those two
files is the 11-line `Origin` strip, and both `forwardRaw` call sites are untouched. Fixing it
would be the same unilateral provider-route change the previous mission correctly refused to
make for `AI-CONSOLE-ORIGIN-RELAY-01` — the one it reported and waited for adjudication on.

It blocks no acceptance gate: every hermetic and live leg passes. Closing it needs the same
treatment the Origin relay got — an owner adjudication, then a deadline plus a body ceiling on
the non-stream forward, with client-disconnect propagation to match the streaming path.

### Named residual — `PROVIDER-INBOUND-HOP-HEADER-RESIDUAL-01`

Opened by `EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02` while fixing `AI-CONSOLE-ORIGIN-RELAY-01`.
`referer` and `cookie` describe the CLIENT→GovAI hop by exactly the same reasoning that made
`origin` wrong to relay: GovAI is not "referred" by the browser's page to the provider, and a
cookie scoped to the GovAI origin is not the provider's to receive. Both are still forwarded.

Not folded into the `origin` fix, deliberately — but the reason is **scope, not absence of a
defect**, and this row must not be read as the latter.

`Referer` was **measured at 200** against real Anthropic: it is not a rejection trigger, so
relaying it is a semantic wrong without an observable failure.

`cookie` is different, and the CLOSEOUT-02 acceptance sharpened it from "latent" to **measured**.
The earlier record said GovAI issues no cookies, which is true and beside the point: what reaches
the provider is what the BROWSER sends on the GovAI origin, not what GovAI sets. In the acceptance
browser, on `http://localhost:5173`, the page carried **6 cookies / 229 bytes** — none set by
GovAI (`localhost` is shared by every dev server the operator has ever run, and cookies are
host-scoped, not port-scoped), confirmed against a same-host listener with
`credentials: 'include'`. `cookie` is in none of the three strip sets and an arbitrary unlisted
header is proven to be relayed (`*.inbound-hop-headers.test.ts` asserts exactly that) — so the
server **would relay** an inbound `cookie` on any provider call that carries one. Stated
precisely for the official console: its `ApiClient` issues every request (GETs and provider
streaming POSTs alike) with `credentials: 'omit'`, so the browser attaches **no** cookie to
GovAI calls and none reaches the builders today —
`CURRENT_GOVAI_AI_CONSOLE_ATTACHES_BROWSER_COOKIES=NO`,
`SERVER_WOULD_RELAY_INBOUND_COOKIE=YES`,
`FUTURE_COOKIE_BASED_HUMAN_AUTH_RISK=MATERIAL` (R14). A `credentials: 'include'` caller, or any
future cookie session, hands those bytes upstream. `document.cookie` also excludes HttpOnly
cookies, so 229 bytes is a floor, not a ceiling. `referer` remains a real inbound-hop semantic
residual — it IS relayed on browser calls regardless of credentials mode.

It is still not fixed here, for two reasons and no others: the dispatch that authorized the
`origin` correction was explicit that it must not become a general browser-header purge, and
`PROVIDER_ROUTE_SEMANTICS_CHANGE` is owner-adjudicated per finding — this one was not among the
two adjudicated. There is also no deployed browser topology yet (`EP-UI-DEPLOY` is blocked), which
bounds today's exposure to development hosts. None of that makes the relay correct.

What would close it: an owner adjudication of the same class, plus the same wire-level proof the
`origin` strip carries. `packages/provider-{openai,anthropic}/src/outbound-header-policy.ts` is
the single place per package that would change, and `outbound-header-policy.test.ts` pins the
current boundary so widening it cannot happen by accident.

### Named follow-up — `EP-PROVIDER-RESPONSE-HEADER-PROVENANCE`

A browser cannot tell a GovAI 401 from a relayed provider 401 on the direct routes. The status
and the body are relayed verbatim, and `GovAIErrorBody` validates SHAPE rather than origin, so
an upstream answering `{"error":"auth_error"}` is indistinguishable from GovAI answering it.
Response headers are no help either: `filterResponseHeaders` drops only hop-by-hop names, so an
upstream could supply an `x-govai-*` marker of its own and have it relayed.

The console therefore treats a relayed body as something that may LABEL an error and may never
END a session — a third party must not be able to sign a reader out and discard a conversation
in progress. The cost is bounded and self-correcting: an expired GovAI key still ends the
session at the next GovAI-scoped read.

Closing it properly is a backend contract: strip inbound `x-govai-*` from relayed provider
responses before GovAI sets its own, which gives the client a signal the upstream cannot forge.
Not attempted here — it is provider-route behaviour.

### `UI-DEV-PROXY-503-01` — what this acceptance did and did not establish

Every 503 observed during the U1.5 acceptance coincided with an upstream that was **deliberately
stopped** (the API was restarted between runs, and once killed on purpose to test the rule that
a proxy 503 must not trigger an automatic retry — it did not; the browser network log shows the
503 and the 502 each exactly once, with no following request). With the upstream up, **0 of 11**
provider POSTs and 0 model-discovery GETs returned 503. That is NOT a root cause for the
historical B2 observation, which was seen on GETs with the API believed up. `ROOT_CAUSE`
therefore remains **NOT_PROVEN**, and StrictMode is still not claimed as the explanation.

### Unchanged by this movement

`AUTH-READ-CACHE-01` stays **OPEN_DEPLOYMENT_BLOCKER** and `EP_UI_DEPLOY` stays
**BLOCKED_UNTIL_CACHE_CLASS_ADJUDICATED**. U1.5 deliberately did not broaden into that class; it
adds one more authenticated GET surface to it, the provider `GET /v1/models` reads, which the
same eventual route/proxy policy must cover. Residuals R12, R13 and R14 are untouched, and the
Foundation V1 freeze record is not edited.

---

## Canonical source manifest gate (EP-CANONICAL-SOURCE-MANIFEST-GATE-01) — counts stop being hand-maintained

**Finding `AI-CONSOLE-CLOSEOUT-CANONICAL-MANIFEST-01`.** Hand-maintained canonical source/test
counts went stale TWICE by the same mechanism — later review rounds changed the tree after the
counts were written (U1: 244→281 UI tests; AI Console: 31/708→33/753 UI, 129/1463→136/1517 root
unit) — and the prose built on them ("U1.5 adds no root test file: it is UI-only", "re-derived
for the two post-freeze movements U1/B2") became false at merged `main@a2fb23e3`. Executor
memory is not an integrity mechanism.

**Correction (this movement):** the mechanically derivable portion of `current-state.md` §*Source
manifests* is now GENERATED from the repository tree (tracked files via `git ls-files` + the
supported `vitest list --json` collectors) into a marker-bounded block, mirrored machine-readable
in `docs/architecture/generated/source-manifest.json`, regenerated by `pnpm docs:manifest:write`
and verified by `pnpm docs:manifest:check` — which the CI `unit` job runs, so a PR that changes
tests/routes/migrations/document structure without reconciling the manifest FAILS CI. Exact
counts now live only in the generated manifest; prose references it instead of repeating them.

| Document | Was (stale at `a2fb23e3`) | Now |
|---|---|---|
| `current-state.md` §Source manifests | hand-written counts: 31/708 UI, 129/1463 root unit, 211 root files; "U1.5 adds no root test file: it is UI-only"; "re-derived for the two post-freeze movements (U1, B2)" | the generated block (machine-derived, CI-verified); durable count-free prose notes; U1.5 history stated precisely (initial implementation UI-first, final merged tree carries the two CLOSEOUT-02 backend fixes + their root suites) |
| `current-state.md` §1 interface rows | "31 files / 708 tests"; U1.5 "**zero backend change**" | rows reference the generated manifest; U1.5 row states "no new route, no migration, no event schema" and points at the CLOSEOUT-02 fixes |
| `development-roadmap.md` | `UI_UX_V1_U1_5_AI_CONSOLE=… ZERO backend change`; `BACKEND_RUNTIME_CHANGE=ADDITIVE_READ_ONLY_ROUTE (EP-B2 only…)`; `BACKEND_RUNTIME_CHANGE=NONE` in the U1.5 paragraph | present-tense truth: the two CLOSEOUT-02 provider fixes are named as backend changes wherever the lane's backend footprint is stated |
| `current-state.md` §8 + this register | SEEDORG collision "observed once…latent" | `EMPIRICALLY_MANIFESTED_TEST_FIXTURE_COLLISION` (recurred in CI as an actual `api_keys_pkey` duplicate); `EP-AUTH-API-KEY-PREFIX-COLLISION-HARDENING=OPEN_EMPIRICALLY_MANIFESTED`; no auth runtime change here |
| cookie residual rows (this register + roadmap + current-state §Status) | "those bytes go upstream on every browser-originated provider call" | precision: `SERVER_WOULD_RELAY_INBOUND_COOKIE=YES`; `CURRENT_GOVAI_AI_CONSOLE_ATTACHES_BROWSER_COOKIES=NO` (`credentials: 'omit'` on every ApiClient request); `FUTURE_COOKIE_BASED_HUMAN_AUTH_RISK=MATERIAL`; `referer` remains a real relayed residual; `PROVIDER-INBOUND-HOP-HEADER-RESIDUAL-01` stays OPEN |

Historical mission records, intermediate-head counts inside earlier register sections, and PR
commit messages describing old heads are NOT rewritten — they remain true of their heads. This
movement changes tooling/tests/CI/docs only: no backend runtime, no provider behaviour, no
migration, no event schema, no auth change. Open provider-hardening findings
(`PROVIDER-INBOUND-HOP-HEADER-RESIDUAL-01`, `PROVIDER-NONSTREAM-FORWARD-UNBOUNDED-01`,
`EP-PROVIDER-RESPONSE-HEADER-PROVENANCE`, `AUTH-READ-CACHE-01`, `UI-DEV-PROXY-503-01`,
`UI-DEV-PROXY-STREAM-CLOSE-01`, `EP-AI-CONSOLE-TURN-EVIDENCE-CORRELATION`,
`EP-AUTH-API-KEY-PREFIX-COLLISION-HARDENING`, R14) are all UNCHANGED in status.
`NATIVE_EXPERIENCE_PARITY_V1=TARGET_NOT_IMPLEMENTED` at that head; the next movement was
`EP-PROVIDER-NATIVE-PARITY-V1-BASELINE-01` (executed — see the next section).

## Native Experience Parity V1 baseline (EP-PROVIDER-NATIVE-PARITY-V1-BASELINE-01) — reconciliation

This movement is documentation + manifest + validator tooling ONLY: no backend runtime, no
provider behaviour, no migration, no event schema, no auth change, no residual fixed. It adds
`native-experience-parity-v1.md`, `ai-conversation-continuity-v1.md`,
`generated/native-experience-parity-v1.json` (248 rows, research snapshot 2026-08-21; gated by
`pnpm docs:parity:check` + the unit lane) and the `scripts/` parity validator with tests.

| Document | Was | Now |
|---|---|---|
| `development-roadmap.md` §GOVAI_NATIVE_EXPERIENCE_PARITY_V1 | "NEXT program target … first movement … Not started" | `BASELINE_COMPLETE_TARGET_NOT_IMPLEMENTED`; wave plan + next mission pointer to the baseline doc |
| `resume-playbook.md` §4 parity bullet | "first movement … not started" | baseline complete in this tree; read the two new docs; next mission `EP-AI-CONVERSATION-CONTINUITY-V1-01` |
| `current-state.md` | no parity/continuity state | status bullet + end-of-file canonical block (`BASELINE_COMPLETE_TARGET_NOT_IMPLEMENTED`, `CONVERSATION_PERSISTENCE=NOT_IMPLEMENTED`) |

Register-relevant facts this baseline PROVED but did NOT change (they stay OPEN, now with a
parity-lane classification recorded in `native-experience-parity-v1.md` §8):

- **`TOOL-TAXONOMY-DRIFT-2026-08` (NEW finding, registered here):** the computer-use guardrail
  matches legacy shapes only (`computer_YYYYMMDD` / `computer_use_preview` tool types + the three
  hard-denied Anthropic computer-use beta headers). Anthropic's `computer_toolset_20260801`
  (GA 2026-08-19, NO beta header) and OpenAI's newer `computer` tool type match NEITHER — they
  would classify `typed_unknown` (risk C) and forward under the observe doctrine, bypassing the
  computer-use floor's intent. Classification: `BLOCKER_BEFORE_PARITY_IMPLEMENTATION` for the
  computer-use/browser-use class (P7 precondition: taxonomy + beta-policy refresh). This also
  makes residual **R6 (beta snapshot staleness) demonstrably material**: both pinned policy
  snapshots (`anthropic-beta-policy@2026-05-06`, `openai-beta-policy@2026-08-16`) predate the
  providers' 2026 GA movements (Anthropic Files/Skills/computer-use GA'd 2026-08-19; the
  registry still models `files-api-2025-04-14` as a required beta dependency).
- The consolidation-plan line claiming `realtime=v1` is "already hard-denied" remains stale
  (the OpenAI beta policy has ZERO hard_denied tokens) — already registered; unchanged.
- All previously open findings above are UNCHANGED in status.

`NATIVE_EXPERIENCE_PARITY_V1=BASELINE_COMPLETE_TARGET_NOT_IMPLEMENTED`;
`EP-AI-CONVERSATION-CONTINUITY-V1-01` is IN_PROGRESS — movement P0-A1 (storage/crypto/owner-RLS
foundation, migration `0031`) is implemented in this tree; `CONVERSATION_PERSISTENCE` remains
`NOT_IMPLEMENTED` (no Send/hydrate/reload runtime exists). The continuity spec's schema sections
(§3/§6) are now PARTIALLY REALIZED by 0031; every runtime section (§7–§14, §19) remains
design-only.

## P0-B post-merge canonical reconciliation (P0-B-POST-MERGE-DOCS-RECONCILIATION-01)

Documentation-only. No backend runtime, no test, no migration, no grant/RLS, no event schema, no
CI configuration and no repository setting changed in this movement. It exists because the
independently audited P0-B tree was merged **byte-identically** — `TREE(6567d8da…) ==
770dffba…` — and that tree deliberately still carried the pre-merge wording
`P0_B_CONVERSATION_CONTROL_PLANE=IMPLEMENTED_PENDING_INDEPENDENT_CONFIRMATION`. That wording was
truthful when it was audited; promoting it could not be smuggled into the technical squash tree
without breaking the tree identity that is the whole proof, so the promotion lands here.

**Closes independent-audit finding `P0B-AUDIT-P3-02`** (`resume-playbook.md` /
`development-roadmap.md` still presented the P0-A1-era state as current — pre-existing at the
frozen base, untouched by PR #145) and **`P0B-AUDIT-P3-03`** (the carry-forward IDs
`P0B-P3-ERR-SHAPE-01` and `P0B-P4-BASE64URL-LENIENCY-01` existed only in the external handoff and
had no canonical in-tree register entry).

| Document | Was (stale at `6567d8da`) | Now |
|---|---|---|
| `current-state.md` §P0-B canonical state | `P0_B_CONVERSATION_CONTROL_PLANE=IMPLEMENTED_PENDING_INDEPENDENT_CONFIRMATION`; "deliberately NOT `COMPLETE`"; `CONVERSATION_CONTROL_PLANE=CANDIDATE_IMPLEMENTED` | `P0_B…=COMPLETE` with the full immutable evidence block (PR #145 · reviewed head `cd7a137d` · reviewed tree `770dffba` · audit PASS + its SHA-256 · squash `6567d8da` · tree identity PASS · main CI `33023935331` GREEN); `CONVERSATION_CONTROL_PLANE=COMPLETE`; a canonical nine-row carry-forward register (the seven audit P3s + the two formerly handoff-only IDs, with `P0B-AUDIT-P3-05` documented as an ALIAS of `P0B-P3-ERR-SHAPE-01` so the one risk is never double-counted); explicit restated non-claims; `P0-C` named as the next implementation movement with the `P0A2-P3-A1` / `P0A2-P3-A4` activation gates |
| `resume-playbook.md` §4 | "movement P0-A1 … is implemented in this tree … next movement P0-A2" | a dedicated current-lane bullet: `COMPLETE = P0-A1 · T1 · P0-A2 · P0-B`, `NEXT = P0-C-DURABLE-SEND-EXECUTION-KERNEL-01` (not started), the P0-B technical evidence, the two pre-activation gates, and the unchanged honesty boundary |
| `development-roadmap.md` §GOVAI_NATIVE_EXPERIENCE_PARITY_V1 | "its first movement, **P0-A1** … is implemented in this tree … Next movements: P0-A2 … onward" | a milestone token block (P0-A1 / T1 / P0-A2 / P0-B `COMPLETE`; P0-C `NOT_STARTED` marked CURRENT/NEXT; P0-D/E/F `NOT_STARTED`) with a short paragraph per finished movement and the P0-C durable-execution path |

Register-relevant facts this reconciliation records but does NOT change:

- **Five of the seven independent-audit P3 findings remain OPEN** (`P0B-AUDIT-P3-01`, `-04`,
  `-05`, `-06`, `-07`). Only the two DOCUMENTARY ones (`-02`, `-03`) are closed here. The P3
  count is **not** zero, and none of the five was fixed opportunistically — fixing behaviour is
  not what a documentation reconciliation is for.
- **`P0A2-P3-A1` and `P0A2-P3-A4` survive unchanged** as gates on the FIRST real
  conversation-worker runtime activation / on worker runtime callers expanding. They do not gate
  this reconciliation and they do not gate every preparatory P0-C step.
- `R14` / `LATENT_AUTH_LIFECYCLE_DESIGN_RISK`, the `AUTH-READ-CACHE-01` platform class, the
  provider-sourced rejection discriminator and `P0B-FORK-BAO-TRIPLE-SWITCH` are all UNCHANGED in
  status. *(Superseded in part — the provider-sourced rejection discriminator was UNCHANGED at
  this movement's anchor, before P0-C existed; it is since dispositioned
  `CLOSED_FOR_CURRENT_P0C_EXECUTION_SEMANTICS`. See the P0-C post-merge reconciliation section
  below.)*
- **Branch protection / repository rulesets — no finding, no action, no setting touched.** This
  movement inspected no repository setting for change and modified none. Per a standing owner
  governance decision, GitHub branch protection and rulesets are **intentionally not used**, so
  multi-agent development is not blocked at the repository layer: CI is enforced by the
  development protocol and reviewed as merge evidence, and the absence of GitHub-side
  enforcement is `BY_DESIGN` rather than technical debt. This movement therefore raises no
  branch-protection finding and creates no branch-protection action item. It leaves Foundation V1
  residual `R9` byte-unchanged in [foundation-v1-freeze.md](./foundation-v1-freeze.md) §6 as
  freeze-era provenance; `R9`'s CURRENT disposition is recorded in the subsection below and is
  settled by the owner, not pending.

`EP-AI-CONVERSATION-CONTINUITY-V1-01` remains IN_PROGRESS. **Superseding the parity-baseline
section's closing note above** — which said "every runtime section (§7–§14, §19) remains
design-only" and was written at PR #139's head, before P0-A2 and P0-B existed; it is retained
above as that movement's history and is no longer the current reading of the tree:

- Storage and encryption (§3/§6) are realized by migration `0031`, extended by `0033`
  (the fork-idempotency arbiter + the minimum request-plane column authority).
- §7's state PHYSICS are realized STRUCTURALLY as database guard triggers (`0031`, plus `0033`'s
  fork-pin validity and `current_attempt_id` monotonic-handoff triggers). §7's runtime
  EXECUTOR — the thing that drives those transitions — does not exist.
- §7.7/§8 recovery DISCOVERY is realized read-only by `0032`'s content-free `SECURITY DEFINER`
  function, reachable only by `govai_conversation_worker`. Nothing calls it at runtime.
- §13's control-plane API is PARTIALLY REALIZED: exactly five endpoints exist
  (`POST` / `GET` `/v1/ai/conversations`, `GET` and `PATCH` `…/:id`, `POST …/:id/branches`).
  `DELETE …/:id`, `GET …/:id/turns`, `GET …/turns/:turnId`, the stream re-attach endpoint,
  `POST …/:id/turns` (durable send), `POST …/retry` and `POST …/stop` do NOT exist.
- Everything else the runtime sections specify is still absent: durable send and `client_turn_id`
  reservation (§8), the dispatch boundary and server-owned stream (§9), reload/reconnection
  (§10), the provider conversation adapter and continuation (§11/§17), turn↔evidence correlation
  (§14) and the whole §19 delete protocol. No worker process runs; no provider call is made from
  a durable turn.

`CONVERSATION_PERSISTENCE=NOT_IMPLEMENTED`.

### Foundation V1 residual `R9` — final owner disposition

```text
FOUNDATION_V1_R9_HISTORICAL_PROVENANCE = RETAINED
CURRENT_R9_DISPOSITION                 = SUPERSEDED_BY_OWNER_GOVERNANCE_DECISION
MAIN_BRANCH_PROTECTION                 = INTENTIONALLY_DISABLED_BY_OWNER
REPOSITORY_RULESETS                    = INTENTIONALLY_NONE_BY_OWNER
R9_CURRENT_ACTION                      = NONE
R9_FUTURE_GATE                         = NONE
```

Foundation V1 residual `R9` is retained **unchanged** in
[foundation-v1-freeze.md](./foundation-v1-freeze.md) §6 as freeze-era historical provenance. What
that row recorded at freeze time — GitHub branch-protection / ruleset enforcement absent, merge
safety process-enforced — was true when it was written and is **not** being called an error. The
anti-evaporation clause is honoured: nothing is erased, rewritten or silently reclassified.

Its **current operational meaning is superseded by an explicit owner governance decision**. GitHub
branch protection and repository rulesets are intentionally not used in this repository because the
development workflow deliberately runs multiple AI executors, reviewers and orchestration agents,
and the owner prefers process-controlled merge discipline — exact SHAs, exact-head CI evidence,
review evidence and expected-head race guards — over repository-level enforcement that can block
that workflow. The absence of GitHub-side enforcement is therefore a **chosen design point**, not a
gap.

Consequently `R9` is **not** unresolved repository-governance work:

- it is **not** awaiting owner disposition — this IS the disposition;
- there is no remediation, no action item and no technical-debt entry;
- it gates nothing — not P0-C, not any later movement;
- no `OPS-*` branch-protection finding may be raised from it;
- enabling branch protection or creating a ruleset must not be proposed as future work or as a
  future requirement (any such change remains an owner-reserved action — resume-playbook.md §9).

This subsection also supersedes the **current** reading of every earlier repository-enforcement
statement still standing in the tree: the `REPO_ENFORCEMENT_ASSESSMENT=DEFERRED_NON_BLOCKING` token
in the operational note of [development-roadmap.md](./development-roadmap.md), in the `R9` row of
`foundation-v1-freeze.md` §6 and in this register's own EP-11-era table row and
Standing-Owner-Authorization note above; and the M3-era residual mirror above that lists
`R9 branch protection deferred`. Those occurrences remain as the provenance of their movements;
read as current state, no repository-enforcement assessment is deferred or pending, because the
decision has been made.

One standing statement is **not** movement provenance but a currently inaccurate comment, and is
superseded on the same terms: `.github/workflows/ci.yml:97` describes the integration job as the
strong gate that "branch protection requires … on `main`". No branch protection requires that job,
because none exists — the job is mandatory as development-protocol merge evidence, not as a
GitHub-enforced status check (`CI_EVIDENCE=REAL`, `MERGE_PROTOCOL=PROCESS_ENFORCED`,
`GITHUB_BRANCH_ENFORCEMENT=NOT_ASSUMED`). That comment configures nothing, is **not** evidence that
GitHub-side enforcement exists, and creates no action item under the owner's settled disposition.
Correcting its wording would be a comment edit, never an enforcement change, and is deliberately out
of scope here: this movement is docs-only and does not touch `.github/**`.

Still correct and still load-bearing: `CI_EVIDENCE=REAL`, `MERGE_PROTOCOL=PROCESS_ENFORCED`,
`GITHUB_BRANCH_ENFORCEMENT=NOT_ASSUMED`. Never infer that GitHub-side enforcement exists from the
existence of a CI workflow — it does not exist, by design.

## P0-C post-merge canonical reconciliation (P0-C-POST-MERGE-DOCS-RECONCILIATION-01)

Documentation-only. No runtime source, no test, no migration, no grant/RLS, no event schema, no
CI configuration, no `.env*`, no generated parity-baseline byte and no repository setting changed
in this movement. It exists because the independently audited P0-C tree was merged
**byte-identically** — `TREE(c1ddfd30…) == 92ffaa7d…` — so the P0-C promotion could not be
smuggled into the technical squash tree without breaking the tree identity that is the merge
proof; the P0-C PR deliberately rolled only the machine-derived source manifest, and the
hand-maintained narrative still predated the merge (independent-audit finding **P4-3**, which
named this movement as its owner). Anchors: PR **#147**, final frozen head `13392bbd`, merge
`c1ddfd30c811e453fc042b81f3500795b22a6837`, merged tree `92ffaa7df74635f0a9caa68a0b5373f85084e5d9`,
post-merge main CI run `33226802442` SUCCESS. `P0-C = COMPLETE`; `P0-D / P0-E / P0-F =
NOT_STARTED`.

| Document | Was (stale at `c1ddfd30`) | Now |
|---|---|---|
| `current-state.md` | status bullets and the P0-A1/P0-A2/P0-B canonical sections still carried `P0_C…=NOT_STARTED`, `CONVERSATION_PERSISTENCE=NOT_IMPLEMENTED`, "no worker process", "P0-C is the next implementation movement" | a new status bullet + a full *P0-C canonical state* section (immutable evidence block, shipped scope, surface matrix, model-agnosticism proof with its exact probative bounds, carry-forward register incl. the pinned `P3-1`, explicit non-claims); ★ UPDATED BY P0-C annotations on every superseded forward token in the P0-A1/P0-A2/P0-B sections — historical text preserved, never rewritten |
| `resume-playbook.md` §4 | lane bullet: `NEXT P0-C … (not started)`; "Two gates before P0-C's ACTIVATION boundary"; honesty boundary `CONVERSATION_PERSISTENCE=NOT_IMPLEMENTED` | `COMPLETE = P0-A1 · T1 · P0-A2 · P0-B · P0-C` with the frozen closeout anchors and an explicit do-not-reopen-P0-C guard; gates recorded DISCHARGED (`P0A2-P3-A1` / `P0A2-P3-A4` closed inside P0-C); honesty boundary updated (durable path exists API-level for the two P0-C surfaces ONLY; workspace UI / continuation / delete / correlation still absent; exactly-once never claimed); `NEXT = EP-PROVIDER-NATIVE-PARITY-V1-NATIVE-EXPERIENCE-CONTRACT-AND-CURRENT-BASELINE-01`, `THEN = P0-D` |
| `development-roadmap.md` | `P0_C…=NOT_STARTED <- CURRENT / NEXT`; "P0-C — durable send / execution kernel (NEXT, not started)"; "None of the above makes conversation persistence real" | P0-C `COMPLETE` with merge evidence; the intervening DOCUMENTARY movement `EP-PROVIDER-NATIVE-PARITY-V1-NATIVE-EXPERIENCE-CONTRACT-AND-CURRENT-BASELINE-01` inserted (planning only — nothing implemented here) with P0-D explicitly AFTER it; the persistence statement made precise (`IMPLEMENTED_API_LEVEL_FOR_P0C_SURFACES_ONLY`) |
| `stale-docs-register.md` | no P0-C section; the P0-B section's closing "current reading" (five endpoints; durable send does NOT exist; `CONVERSATION_PERSISTENCE=NOT_IMPLEMENTED`) still read as current | this section. **Superseding the P0-B post-merge section's closing "current reading" above** — retained as that movement's history: §13's control-plane API now has EIGHT registered endpoints (the five P0-B ones plus `POST …/:id/turns`, `GET …/:id/turns`, `GET …/turns/:turnId`); durable send (§8), the dispatch boundary and server-owned execution (§9), and reload-hydration's minimum bar (§10) are implemented for the two P0-C surfaces; `DELETE`, retry, stop and the stream re-attach endpoint still do NOT exist; §11 continuation, §14 correlation and the whole §19 delete protocol remain absent |

### Carry-forwards after P0-C — resolved aspects vs. preserved entries

Entries whose SOLE staleness reason was "conversation persistence not implemented / P0-C pending
/ durable execution absent" are resolved by PR #147 **for exactly that aspect**; broader entries
that also cover P0-D/E/F scope stay OPEN unchanged. The current canonical carry-forward register
lives in current-state.md's *P0-C canonical state* section; the entries, by ID:

```text
P3-1-CHAT-COMPLETIONS-STREAM-GATE-ASYMMETRY   = OPEN — pinned (see the block below)
PROVIDER_SOURCED_REJECTION_DISCRIMINATOR      = CLOSED_FOR_CURRENT_P0C_EXECUTION_SEMANTICS
                                                (source-adjudicated; see the disposition block
                                                below — reopen only on a future provider-sourced
                                                state = rejected)
R1_DURABLE_CONTEXT_P1                         = P0-D_CARRY_FORWARD (pipelining limitation)
P0C-SWEEP-01-P0B-KMS-HELD-CHECKOUT            = OPEN (P2 — merged P0-B code; mechanical follow-up)
DIRECT_HTTP_WRITABLE_BACKPRESSURE             = OPEN (pre-existing Foundation follow-up)
WORKER_DEPLOYABLE_BUNDLE_DOCKER               = REQUIRED_BEFORE_PRODUCTION_ACTIVATION
PUBLIC_STOP_TERMINALIZATION_ARM               = MUST_SHIP_WITH_STOP_ENDPOINT
DELETE_ROOT_LOCK_DISCIPLINE                   = PIN on the §19 implementer
BOUNDARY_CAUSAL_VERSION_SNAPSHOT              = RE-EXAMINE in P0-D
STREAM_OUTCOME_FENCED_EXIT_VOCABULARY         = P0-F evidence formalization
AUDITBRIDGE_RAW_ERR_MESSAGE_ON_WORKER_LOGS    = REGISTERED P3 (P4-1: pre-existing lines, new
                                                worker log sink audience)
NATIVE_PROVIDER_MODEL_DISCOVERY               = needs a productized dynamic catalogue
NATIVE_PROVIDER_FULL_PARITY                   = V1 baseline exists; implementation remains
                                                partial (3/248 FULL at the 2026-08-21 snapshot)
USER_MODEL_CHOOSER                            = API model token exists; dynamic product
                                                chooser/UI not complete
```

Unchanged in status and NOT absorbed by P0-C: `R14` / `LATENT_AUTH_LIFECYCLE_DESIGN_RISK`, the
`AUTH-READ-CACHE-01` platform class (conversations joined it already closed; the four
pre-existing read surfaces are untouched),
`P0B-FORK-BAO-TRIPLE-SWITCH=DEFERRED`, the five open P0-B audit P3s (`P0B-AUDIT-P3-01/-04/-05/
-06/-07` + alias `P0B-P3-ERR-SHAPE-01`), `PROVIDER-INBOUND-HOP-HEADER-RESIDUAL-01`,
`PROVIDER-NONSTREAM-FORWARD-UNBOUNDED-01`, `EP-PROVIDER-RESPONSE-HEADER-PROVENANCE`,
`EP-AI-CONSOLE-TURN-EVIDENCE-CORRELATION` (absorbed into P0-F's remit, still open) and every
Foundation V1 residual (R1–R16 per their current dispositions).

**Dispositioned BY P0-C's merged source (finding `DOCS-P0C-REJECTION-DISCRIMINATOR-01`,
P2_DOCUMENTARY — a canonical-state inconsistency in the first draft of this section, corrected
here):** the **provider-sourced rejection discriminator**. Its P0-B-era rationale ("P0-B exposes
no durable turn hydration or execution, so the distinction is not yet material") stopped being a
valid current reading the moment P0-C shipped durable execution and hydration; an earlier draft
of this section nevertheless listed the item as "unchanged / not absorbed", which contradicted
the carry-forward's own instruction to re-adjudicate it at P0-C. Source adjudication against the
merged tree:

```text
PROVIDER_SOURCED_REJECTION_DISCRIMINATOR = CLOSED_FOR_CURRENT_P0C_EXECUTION_SEMANTICS

RATIONALE = the P0-C executor never represents a provider-originated HTTP failure as
`rejected`: every FULLY CONSUMED provider result — stream and non-stream — classifies
through ONE
function (execute-turn.ts:1186-1204; call sites :959/:1102) as `completed` (2xx) or `failed`
with provider/error taxonomy (401/403 auth_rejected · 413 request_too_large ·
429 rate_limited · other provider_error); the exception paths that never reach status
classification are equally rejected-free (post-status body/stream failure before full
consumption → outcome_unknown via the generic catch :612-621; durable-write failure after
a complete response → failed + persistence_error :595-610; pre-forward local failure →
failed + local_error :583-593); while `rejected` is reserved for GovAI-side/
pre-provider refusals (surface_unsupported :322 · config_unreadable :325/:358 · governance
blocked pre-forward :919), each provably pre-POST and carrying error_class NULL —
structurally enforced by 0031's bidirectional CHECK (0031:361-364).

NO_NEW_SCHEMA_COLUMN_REQUIRED = TRUE
SCHEMA_GENERALITY             = UNCHANGED (0031's state graph still admits `rejected`
                                generally; 0035 widened only the error_class enum)
FUTURE_REOPEN_CONDITION       = only if a future execution surface introduces a genuinely
                                provider-sourced terminal outcome represented as
                                state = rejected — that movement re-adjudicates
RUNTIME_DEFECT                = NO · P0-C_TECHNICAL_REOPEN = NO
```

The canonical disposition block lives in current-state.md's *P0-C canonical state* section; the
historical P0-B wording is preserved there as provenance with its ★ UPDATED BY P0-C disposition
beside it.

### `P3-1-CHAT-COMPLETIONS-STREAM-GATE-ASYMMETRY` — non-blocking, PINNED

Current source fact: `packages/provider-openai/src/governed/handle-chat-completions.ts` threads
`beforeDispatch`/`onDispatchStart` into its NON-stream `forwardRaw` only; the stream branch's
`forwardStream` call carries neither hook. Current reachability fact: NO production caller
combines this stream branch with the durable dispatch gate (the direct governed route passes no
hooks; the run orchestrator pins `isStream: false`; P0-C's dispatch registry admits no
`chat.completions` surface).

```text
CURRENT_P0C_DEFECT                = NO
CURRENT_PRODUCTION_REACHABLE_DEFECT = NO
CARRY_FORWARD                     = YES
OWNER = the first future movement that makes Chat Completions streaming reachable from a
        durable/gated caller — that movement MUST close P3-1 before activation
```

### Correction ledger — `P0C-MERGE-REPORT-KEY-WORDING-CORRECTION-01`

The sealed P0-C frozen-tree merge report (external, byte-frozen with its SHA-256 sidecar) states:

```text
Historical wording:
"ANTHROPIC_API_KEY and OPENAI_API_KEY were never read, printed, copied, or modified"
```

Taken literally, "never read" is impossible — authenticated provider calls occurred during the
bounded live exercise. The sealed report is NOT modified; this ledger entry records the precise
meaning:

```text
Precise meaning:
Provider credentials were consumed in-process from the local environment
for authenticated provider requests, but their values were never printed,
logged, copied into generated handoff/audit artifacts, modified, or committed.

SECURITY_DEFECT           = NO
RUNTIME_DEFECT            = NO
HISTORICAL_REPORT_REWRITE = NO
CLASSIFICATION            = DOCUMENTARY_PRECISION
```

No API key value or fragment appears in any artifact. `.env.local` remains ignored and outside
repository state; its live-model values were updated locally during the merge protocol
(`ANTHROPIC_LIVE_MODEL=claude-sonnet-5`, `OPENAI_LIVE_MODEL=gpt-5.6-luna`) and this movement did
not touch it.

### Versioned parity baseline — preserved, and how to read `FULL`

`native-experience-parity-v1.md` + `generated/native-experience-parity-v1.json` remain the
versioned research baseline anchored at `RESEARCH_SNAPSHOT_DATE=2026-08-21` with meaning
`BASELINE_COMPLETE — TARGET_NOT_IMPLEMENTED` at that anchor. This movement changed ZERO bytes of
either (`PARITY_V1_BYTES_CHANGED=NO`): the 248 rows, the FULL/PARTIAL/MISSING counts,
`verified_at`, `source_anchor` and `research_snapshot_date` are all untouched. Post-baseline
P0-C implementation and live proofs do not retroactively rewrite its rows; a refreshed current
parity baseline requires a separate deliberate movement/version (the named next movement above).

Do NOT read "OpenAI FULL = 0" as "OpenAI does not work". `FULL` is the baseline's strongest bar —
ALL applicable parity axes satisfied (provider exposure, GovAI registration, native route,
native hermetic proof, native live acceptance, governed route/proof where applicable, UI
exposure, UI test/browser acceptance, evidence path) — and conversation-level
persistence/resume/fork are separate axes. The precise post-P0-C reading:

```text
NATIVE_ROUTING_FOUNDATION          = SUBSTANTIAL
MODEL_ID_AGNOSTICISM               = PROVEN   (GOVAI_MODEL_GATE_DEFECT = NOT PRESENT)
P0C_DURABLE_CONVERSATION_EXECUTION = IMPLEMENTED FOR ANTHROPIC_MESSAGES + OPENAI_RESPONSES
FULL_NATIVE_EXPERIENCE_PARITY      = NOT COMPLETE
```

### Sealed P0-C artifacts — unchanged

The P0-C implementation exact-head handoff + its SHA-256 sidecar, the independent final Opus
exact-head audit, and the frozen-tree merge report + its sidecar (all under
`/Users/Shared/govai-handoff/audits/ai-conversation-continuity-v1/`) are evidence records and
remain byte-identical (`SEALED_P0C_ARTIFACTS_CHANGED=NO`). Corrections are ledger entries here,
never edits there.

### Branch protection / repository rulesets — no finding, no action, no setting touched

Unchanged from the settled owner disposition above: `MAIN_BRANCH_PROTECTION =
INTENTIONALLY_DISABLED_BY_OWNER`, `REPOSITORY_RULESETS = INTENTIONALLY_NONE_BY_OWNER`,
`STATUS = BY_DESIGN / NOT_A_FINDING`. This movement inspected no repository setting for change,
modified none, raises no branch-protection finding, and creates no action item.

## Native experience contract + current baseline V2 (EP-PROVIDER-NATIVE-PARITY-V1-NATIVE-EXPERIENCE-CONTRACT-AND-CURRENT-BASELINE-01)

Documentation + deterministic documentation-validation tooling only. No runtime source, no
test outside the new docs-validator lane, no migration, no grant/RLS, no event schema, no CI
behavior outside documentation validation, no `.env*`, and **zero bytes of either V1 parity
baseline artifact** changed in this movement (`PARITY_V1_BYTES_CHANGED=NO`; sha256 before ==
after: `native-experience-parity-v1.md` `496476ba…`, `generated/native-experience-parity-v1.json`
`8b38b737…`). Base: main `79bd71407830ef2ef244fba6c53ac57cdebd11a3` (tree `c73d1ff4`); research
snapshot **2026-08-29** (first-party pass; external sealed source ledger + read-only live
model-metadata observations). `P0-C = COMPLETE` (untouched); `P0-D / P0-E / P0-F =
NOT_STARTED`. The movement's PR (#149) was NOT self-merged: it received independent
architecture review and owner authorization, and was squash-merged as
`f998f55aee405adbc12c762f237854f118b8939c` (reviewed-tree-identical; see the post-merge
status reconciliation subsection below).

| Document | Was (stale at `79bd7140`) | Now |
|---|---|---|
| *(new)* `native-experience-contract-v1.md` | did not exist — the native-experience/model-discovery laws lived only as dispatch intent | NORMATIVE contract: LAWs NX-1…NX-26, discovery/compatibility/capability/policy/chooser/controls/workspace/Projects/agentic/exit/degradation/performance/security contracts, explicit P0-D/P0-E/P0-F obligations |
| *(new)* `native-experience-parity-v2.md` + `generated/native-experience-parity-v2.json` | the only parity baseline was the byte-preserved 2026-08-21 V1 snapshot, stale as a CURRENT view (P0-C flips; provider movements incl. executed Assistants sunset, `computer` tool type, Models-API capability/lifecycle fields) | CURRENT baseline: `BASELINE_VERSION=2`, 252 rows, snapshot 2026-08-29, new fields `retirement_date`/`capability_source`/`state_nature`/`next_wave`; FULL remains 3 (all `ANTHROPIC_API`); validated by `pnpm docs:parity2:check` + unit lane; V1 history untouched |
| `current-state.md` | status bullets ended at P0-C; the P0-C register carried `NATIVE_PROVIDER_MODEL_DISCOVERY / NATIVE_PROVIDER_FULL_PARITY / USER_MODEL_CHOOSER = OPEN` with coarse wording; the NEXT bullet still pointed at an unexecuted movement | new status bullet + full movement canonical section; ★ UPDATED BY annotation on the P0-C register rows; carry-forwards re-adjudicated (`…MODEL_DISCOVERY=PARTIAL`, `USER_MODEL_CHOOSER=PARTIAL`, capability/policy-aware chooser `NOT_IMPLEMENTED`, `NATIVE_PROVIDER_FULL_PARITY=OPEN — IMPLEMENTATION_PARTIAL` at 3/252); NEXT bullet marked ★ EXECUTED |
| `development-roadmap.md` | status block still `NEXT: …CONTRACT…-01 (see below)`; planning paragraph unexecuted | status block records `AUTHORED_IN_THIS_TREE` + review-gated P0-D; planning paragraph carries the ★ EXECUTED delivery record |
| `resume-playbook.md` §4 | lane block: contract movement "not started" | `AUTHORED IN THIS TREE … PR awaits INDEPENDENT ARCHITECTURE REVIEW — no self-merge`; `THEN P0-D` now names its consumed contracts |
| `stale-docs-register.md` | no section for this movement | this section |

### Carry-forwards — resolved aspects vs preserved entries

```text
NATIVE_PROVIDER_MODEL_DISCOVERY = re-adjudicated PARTIAL (wording precision; the gap —
                                  capability/policy-aware catalogue — remains OPEN for P0-E)
USER_MODEL_CHOOSER              = re-adjudicated PARTIAL (product chooser remains P0-E)
NATIVE_PROVIDER_FULL_PARITY     = OPEN — IMPLEMENTATION_PARTIAL (3/252 FULL @ 2026-08-29)
R6 (beta-policy snapshot staleness)      = UNCHANGED, still material (registry still models
                                           files-api beta; pinned snapshots predate 2026 GAs)
TOOL-TAXONOMY-DRIFT-2026-08 (finding T)  = UNCHANGED P7 precondition; V2 adds the fact that
                                           OpenAI's GA computer-use tool type is now the
                                           string `computer`
All other P0-C register entries          = UNCHANGED (this movement closes nothing else)
```

### Versioned parity baselines — V1 preserved, V2 is the current view

`native-experience-parity-v1.md` + `generated/native-experience-parity-v1.json` remain the
byte-preserved 2026-08-21 historical snapshot (validated unchanged by the untouched V1
lane). `native-experience-parity-v2.*` is the CURRENT view with its own deliberate
`RESEARCH_SNAPSHOT_DATE=2026-08-29`, additive validator (`pnpm docs:parity2:check` /
`:format`, `scripts/lib/parity-v2-core.ts` importing V1's vocabulary so the validators
cannot diverge), and honest row deltas (+3 OpenAI admin rows, +1 ChatGPT plugins row, 4
P0-C conversation-axis flips, ~40 provider-fact note refreshes; no removals — retired
features keep annotated rows). A future refresh is again a NEW version, never an edit of
V2 history once it seals.

### Post-merge status reconciliation — `PR149-POST-MERGE-DOC-STATUS-01` (CLOSED)

PR #149 was independently reviewed, owner-authorized, and squash-merged as
`f998f55aee405adbc12c762f237854f118b8939c` (tree
`86093763952a4fb5dbb38ee6c7ef736f21f9c870` — byte-identical to the final independently
reviewed tree; post-merge main CI run `33288386315` SUCCESS). Because the exact reviewed
tree was deliberately merged unchanged, a small set of pre-merge procedural status
sentences ("awaits independent architecture review", "does not self-merge",
`AWAITING_INDEPENDENT_ARCHITECTURE_REVIEW`) remained inside the merged tree as CURRENT-status
claims. The post-merge audit classified this as `PR149-POST-MERGE-DOC-STATUS-01`
(P3 documentary status precision; no runtime/security/architecture/merge/tree-identity
defect; no P0-C reopen).

| Document | Was (stale at `f998f55a`) | Now |
|---|---|---|
| `native-experience-contract-v1.md` header | `NORMATIVE_CONTRACT_DRAFTED — AWAITING_INDEPENDENT_ARCHITECTURE_REVIEW` | `CURRENT_NORMATIVE_CONTRACT — MERGED AS PR #149` + merge anchor; explicit non-claim that merging the contract implements no runtime target |
| `current-state.md` | summary bullet + canonical section said the PR "awaits independent architecture review"; P0-D gate phrased as pending | merged-fact wording (PR #149 anchor, tree identity, CI run); movement `COMPLETE_AND_MERGED`; P0-D `NOT_STARTED / NEXT` |
| `development-roadmap.md` | status block `AUTHORED_IN_THIS_TREE … independent architecture review required`; planning header `(NEXT …)`; ★ EXECUTED record ended "awaits independent architecture review" | status block `COMPLETE_AND_MERGED` + PR #149 anchor; header `(MERGED as PR #149 …)`; delivery record carries the merged fact |
| `resume-playbook.md` §4 lane block | `NEXT = …CONTRACT…-01 (… PR awaits INDEPENDENT ARCHITECTURE REVIEW — no self-merge)` | movement listed `MERGED` with PR #149 anchor; `NEXT = P0-D PROVIDER CONTINUATION` (not started) |
| this register (movement section above) | "The movement's PR is NOT self-merged — independent architecture review required." | merged-fact wording + this disposition subsection |

`PR149-POST-MERGE-DOC-STATUS-01 = RECONCILED / CLOSED BY THIS PR`. Historical records are
NOT rewritten: the movement genuinely returned `READY_FOR_INDEPENDENT_ARCHITECTURE_REVIEW`,
its PR genuinely prohibited self-merge, and owner merge authorization genuinely arrived only
later — the "Was/Now" rows of the movement section above remain that movement's authoring-time
record. This reconciliation closes NO implementation gap: `P0-D / P0-E / P0-F` remain
`NOT_STARTED`, no parity classification changed, both parity baselines and the V1/V2
validators are byte-untouched, and no runtime source changed.
