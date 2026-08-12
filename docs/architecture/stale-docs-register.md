# GovAI Stale Docs Register

Documents whose statements no longer match source ([current-state.md](./current-state.md), main `165291d9`). "Confidence" = how strongly source verifies the correction. "Severity" = onboarding/continuity risk. The "Blocks B3?" column is historical: B3 (the AuditSealer runner) was authorized and implemented in EP-006 — every former B3 blocker below is resolved (see the PR-B / EP-004 and EP-006 reconciliation sections).

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
| `development-roadmap.md` P0 register | EP-11 still required owner/ADR adjudication and was framed as deadline protection | ADR-032 owner adjudication is complete; this movement adds the repository-promulgation artifact (`docs/architecture/adr/ADR-032-openai-files-purpose-provider-truth.md`); EP-11 remains a separate runtime movement and is gated on the ADR artifact being present on `main`; the decision is provider-truth based and date-independent | HIGH | HIGH | Promulgate ADR-032 and replace the staged/pending pointer with the explicit main-presence implementation gate; no runtime change | no |
| `current-state.md` §"Separate P1 evidence-integrity register" | "The owner-adjudicated decision remains staged outside the repository as ADR-032; once promulgated, it requires removal of that specific branch" — accurate at anchor `165291d9`; the "staged outside the repository" clause becomes historical the moment the ADR-032 promulgation movement lands on `main` | The repository-promulgation artifact is `docs/architecture/adr/ADR-032-openai-files-purpose-provider-truth.md` (added by the promulgation movement; only the version present on `main` is canonical). The EP-11 removal requirement quoted in that sentence remains accurate and pending — the staleness is confined to the "staged outside the repository" locational clause | HIGH | MEDIUM | Reconcile in the next `current-state.md` state-roll movement; `current-state.md` edits and re-anchoring are out of scope for the docs-only promulgation movement, so this register row is the interim correction | no |

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
- **SEEDORG_FLAKE_CANDIDATE** (root cause UNVERIFIED; observed once as a primary-key prefix collision in an earlier unrelated integration attempt) and **DIRECT_STREAM_REQUEST_ID_HEADER_GAP** (PRE_EXISTING; not introduced by F4; not F4-blocking) are recorded in current-state.md §8 as narrow, non-blocking follow-ups.
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
