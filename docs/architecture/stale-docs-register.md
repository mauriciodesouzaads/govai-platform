# GovAI Stale Docs Register

Documents whose statements no longer match source ([current-state.md](./current-state.md), main `719fefc2`). "Confidence" = how strongly source verifies the correction. "Severity" = onboarding/continuity risk. The "Blocks B3?" column is historical: B3 (the AuditSealer runner) was authorized and implemented in EP-006 — every former B3 blocker below is resolved (see the PR-B / EP-004 and EP-006 reconciliation sections).

| Document | Stale statement | Current source evidence | Confidence | Severity | Action | Blocks B3? |
|---|---|---|---|---|---|---|
| `README.md` | "Runtime Phase 1 … Passthrough e admin routes ainda em 501" | `server.ts:156-176` registers passthrough/governed/evidence/credentials/workroom/regulatory as real handlers; only `admin-audit-shred.ts:41` and `admin-dlp.ts:40` are `sendNotImplemented` stubs | HIGH (source-verified) | HIGH (onboarding) | README status updated to current surfaces + runtime-to-evidence caveat (this PR) | no |
| `docs/architecture/workroom-governance-room.md` | "proposed (architecture blueprint, no runtime implementation yet)" (line 3) | Phases 1–4 routes exist (`workrooms.ts`/`workroom-transcript.ts`/`workroom-runs.ts`/`workroom-approvals.ts`); migrations 0012–0015; orchestrator `WorkroomRunContext`; ~21 workroom tests located | HIGH (source + tests) | HIGH (architecture continuity) | Add "Implementation status" note: partial runtime (Phases 1–4); 5–7 target-only; not complete (this PR) | no |
| `docs/architecture/adr/ADR-020-audit-sealer-runtime-model.md` | (was) role/session "Open design question"; Draft | ADR-022 resolves the role model | HIGH | MEDIUM (resolved) | **Done (B3 decision-pack PR):** ADR-020 → Superseded-in-part by ADR-022–026; B3 subsequently implemented in EP-006 | no — resolved (Option A(b) PR #92; AuditBridge PR-B/EP-004; B3 runner EP-006) |
| `ADR-022`–`ADR-026` | (was) Status: Proposed | ADR-022/024/025/026 → **Accepted** design constraints; **ADR-023 → Accepted; Option A(b) implemented/tested in PR #92** — deterministic `audit_event_id` in `packages/core-audit/` | HIGH | LOW (done) | Option A(b) is implemented (PR #92); the former B3 blockers (Phase 2.5 AuditBridge, explicit B3 authorization) are satisfied — AuditBridge wired (PR-B / EP-004), B3 implemented (EP-006) | no — resolved (Option A(b) PR #92; AuditBridge PR-B/EP-004; B3 runner EP-006) |
| Append→mark_sealed partial-failure idempotency (ADR-023) | (was) open clause unresolved | **Option A(b) implemented/tested in PR #92** — deterministic `audit_event_id` = UUIDv5(org_id+capture_id) in `packages/core-audit/` (`auditAppend(eventId?)` lookup-after-lock + correspondence/payload-presence guards); `audit_events.id` is PK so no migration was needed | HIGH (source-verified) | LOW (done) | Option A(b) is implemented/tested; the former B3 blockers (Phase 2.5 AuditBridge, explicit B3 authorization) are satisfied — AuditBridge wired (PR-B / EP-004), B3 implemented (EP-006); ADR-028 accepted/merged | no — resolved (Option A(b) PR #92; AuditBridge PR-B/EP-004; B3 runner EP-006) |
| **Runtime-to-evidence wiring (correction to any "runtime ⇒ evidence captured" assumption)** | Implicit assumption that governed-native runtime produces captured/sealed evidence | **WIRED (PR-B / EP-004):** all four direct routes dispatch `await auditBridge(event, requestIdentityAls.getStore())` via `makeAuditBridge` into the B0/B1 outbox; the ingress identity hook + ADR-028 `captureId` are implemented; I3/I4 proven (see the PR-B / EP-004 reconciliation below) | HIGH (source-verified) | HIGH (B3 false-confidence risk) | **Resolved (EP-004).** Direct-route runtime now feeds the outbox; B3 (EP-006) seals it | no — resolved (EP-004 + EP-006) |
| Regulatory roadmap (`regulatory/20`, `regulatory/23`, sector mappings) | Not stale, but dense; foundational controls not summarized in one place and are evidence-only | PR-R1..R9 live as foundational controls (migrations 0016–0024 + tests) | MEDIUM (navigability) | MEDIUM | current-state.md §5 cross-links + labels evidence-only | no |
| `docs/architecture/specs/h1v2-coverage-map.md` + H1 v2 specs | Current and versioned after PR #87 (stable aliases) | matches code at `8be5cfc` | HIGH | — (not stale) | none | no |

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

- **D9**: `D9_LOCATION=UNRESOLVED`; `PR0_STATUS=DOCUMENTARY_BLOCKED`; `TECHNICAL_P0_3_STATUS=NOT_BLOCKED_BY_D9`. Prior sessions reported in-repo references broken while the D9 mirror is unavailable; a repo-wide search at `719fefc2` reproduced no such literal references — broken-reference count: **UNVERIFIED**.
- **SEEDORG_FLAKE_CANDIDATE** (root cause UNVERIFIED; observed once as a primary-key prefix collision in an earlier unrelated integration attempt) and **DIRECT_STREAM_REQUEST_ID_HEADER_GAP** (PRE_EXISTING; not introduced by F4; not F4-blocking) are recorded in current-state.md §8 as narrow, non-blocking follow-ups.
- Historical anchors inside completed-phase records (e.g. roadmap Phase 2.5 "Inputs" citing `governed-openai.ts:69-70` / `governed-anthropic.ts:71-72`, or "matches code at `8be5cfc`" rows above) describe the state at the time those phases executed and are deliberately NOT rewritten.
- EP-DOCS-04 changes no runtime behavior, no tests, no migrations, no schemas/routes/events, no dependencies.
