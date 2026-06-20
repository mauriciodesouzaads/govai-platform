# GovAI Stale Docs Register

Documents whose statements no longer match source ([current-state.md](./current-state.md), main `8be5cfc`). "Confidence" = how strongly source verifies the correction. "Severity" = onboarding/continuity risk. A row that "Blocks B3" must be cleaned/accepted before the B3 runner is built.

| Document | Stale statement | Current source evidence | Confidence | Severity | Action | Blocks B3? |
|---|---|---|---|---|---|---|
| `README.md` | "Runtime Phase 1 … Passthrough e admin routes ainda em 501" | `server.ts:79-94` registers passthrough/governed/credentials/workroom/regulatory as real handlers; only `admin-audit-shred.ts:41` and `admin-dlp.ts:40` are `sendNotImplemented` stubs | HIGH (source-verified) | HIGH (onboarding) | README status updated to current surfaces + runtime-to-evidence caveat (this PR) | no |
| `docs/architecture/workroom-governance-room.md` | "proposed (architecture blueprint, no runtime implementation yet)" (line 3) | Phases 1–4 routes exist (`workrooms.ts`/`workroom-transcript.ts`/`workroom-runs.ts`/`workroom-approvals.ts`); migrations 0012–0015; orchestrator `WorkroomRunContext`; ~21 workroom tests located | HIGH (source + tests) | HIGH (architecture continuity) | Add "Implementation status" note: partial runtime (Phases 1–4); 5–7 target-only; not complete (this PR) | no |
| `docs/architecture/adr/ADR-020-audit-sealer-runtime-model.md` | (was) role/session "Open design question"; Draft | ADR-022 resolves the role model | HIGH | MEDIUM (resolved) | **Done (B3 decision-pack PR):** ADR-020 → Superseded-in-part by ADR-022–026; B3 implementation not authorized | no longer the blocker; remaining blockers are Phase 2.5 AuditBridge implementation/tests and explicit B3 runner authorization (Option A(b) implemented/tested in PR #92; ADR-028 accepted/merged) |
| `ADR-022`–`ADR-026` | (was) Status: Proposed | ADR-022/024/025/026 → **Accepted** design constraints; **ADR-023 → Accepted; Option A(b) implemented/tested in PR #92** — deterministic `audit_event_id` in `packages/core-audit/` | HIGH | LOW (done) | Option A(b) is no longer an unimplemented B3 blocker; remaining blockers are Phase 2.5 AuditBridge implementation/tests and explicit B3 runner authorization | partially — Option A(b) done and ADR-028 accepted/merged; Phase 2.5 + explicit authorization remain B3 preconditions |
| Append→mark_sealed partial-failure idempotency (ADR-023) | (was) open clause unresolved | **Option A(b) implemented/tested in PR #92** — deterministic `audit_event_id` = UUIDv5(org_id+capture_id) in `packages/core-audit/` (`auditAppend(eventId?)` lookup-after-lock + correspondence/payload-presence guards); `audit_events.id` is PK so no migration was needed | HIGH (source-verified) | LOW (done) | Option A(b) is implemented/tested; no longer an unimplemented blocker; remaining B3 blockers are Phase 2.5 AuditBridge implementation/tests and explicit B3 runner authorization (ADR-028 accepted/merged) | partially — Option A(b) done; other preconditions remain |
| **Runtime-to-evidence wiring (correction to any "runtime ⇒ evidence captured" assumption)** | Implicit assumption that governed-native runtime produces captured/sealed evidence | `governed-openai.ts:69-70` / `governed-anthropic.ts:71-72` emit via `app.log.info` only; **zero `captureAuditEvent` call-sites in `apps/`**; `/v1/runs` uses `auditAppend` to the chain, not the outbox | HIGH (source-verified) | HIGH (B3 false-confidence risk) | **Decision now exists: ADR-027 (AuditBridge) accepted as a design constraint.** Implementation/tests are absent; direct routes are not yet wired to the outbox; runtime validation/narrowing (`PassthroughInvokedSchema` over `event: unknown`) is not yet implemented; `/v1/runs` stays chain-authoritative via `auditAppend`; **ADR-028 (Accepted, in main) clarifies the AuditBridge `captureId` identity: it MUST NOT be `PassthroughInvoked.audit_event_id` (a `randomUUID()` today) — use a route-ingress `govai_request_id` + optional `X-GovAI-Idempotency-Key`; `payloadHash` is a stable `AuditBridgeCapturePayloadV1` projection; no AuditBridge code implemented yet**; B3 remains blocked for product-completeness | yes — implementation/tests (or an accepted deferral naming another authoritative path) remain before B3 |
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
- ADR-022/024/025/026 are accepted as design constraints; ADR-023 Option A(b) is implemented/tested in PR #92. Remaining blockers before B3 are the Phase 2.5 AuditBridge implementation/tests and explicit B3 runner authorization (ADR-028 is accepted/merged).

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
