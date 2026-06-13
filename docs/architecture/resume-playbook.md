# GovAI Resume Playbook

Purpose: resume the project after a crash, a stalled session, or a fresh Claude Code / audit session **without losing context or drifting**. Read this first, then [current-state.md](./current-state.md) and [development-roadmap.md](./development-roadmap.md).

---

## 1. How to identify current repo state

```bash
cd "/Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform"
git branch --show-current
git rev-parse HEAD
git status --short
gh pr list --state open
gh pr checks <PR#>
pnpm -v       # expect 10.33.2
node -v       # expect v24.x (nvm use 24)
```

Repo shell note: `grep` is a hanging function — use `command grep`; prefer `GIT_PAGER=cat`.

---

## 2. Current known-good main

- main after PR #93: `d037e3309977dbc721c5404dac63c52375211db3` (#88–#91 docs-only; **#92 first code merge — ADR-023 Option A(b) implemented/tested** in `packages/core-audit/`; **#93 docs-only — ADR-028 Accepted**). ADR-027 (Phase 2.5 AuditBridge) is **accepted but not implemented/tested**. **ADR-028 (Accepted, docs-only, merged)** decides direct-route request identity (`govai_request_id` at ingress + optional `X-GovAI-Idempotency-Key`; `captureId` MUST NOT be `audit_event_id`; `payloadHash` is a stable `AuditBridgeCapturePayloadV1` projection, not the full envelope). Next step: the AuditBridge implementation PR (ADR-027 + ADR-028). B3 still not authorized.
- Toolchain: Node v24.15.0 (modules 137), pnpm 10.33.2.

---

## 3. Closed gates (confirmed)

- H1 v2 provider-native compatibility coverage (mandatory invariants mapped to executing tests).
- PR #87: valid-tools pass-through positive byte-for-byte.
- Coverage map uses stable `RB-OAI[alias]`/`RB-ANT[alias]` anchors.
- Audit B0 (capture outbox) + B1 (capture adapter, tested as a primitive) + B2 (sealer library) merged.

---

## 4. Open gates

- **B3 decision pack accepted (architecture decisions only)** — ADR-022/024/025/026 Accepted as design constraints; **ADR-023 decision made: Option A(b)** — deterministic `audit_event_id` derived from `org_id + capture_id`; accepted as a design constraint and **implemented/tested in PR #92** (`sealer-event-id.ts`, `sealer.ts`, `append.ts`; `sealer-deterministic-append.test.ts`); **still does not authorize B3**. B3 Technical Plan written (`specs/audit-sealer-b3-technical-plan.md`). ADR-020 Superseded-in-part.
- **Append→mark_sealed partial-failure idempotency** — **mechanism DECIDED (Option A(b)) and implemented/tested in PR #92**; the §8.3 append-succeeded / `mark_sealed`-failed no-duplicate-retry case is covered by `sealer-deterministic-append.test.ts`. **Capture idempotency and append→mark_sealed idempotency are distinct layers — both are now implemented.** B3 remains blocked on the **runner + Phase 2.5 wiring + explicit authorization**, not on Option A(b) (technical plan §8.3/§11).
- **B3 Technical Plan** — written as a draft / decision-pack candidate in `docs/architecture/specs/audit-sealer-b3-technical-plan.md`; it does **not** authorize implementation. It records ADR-023 Option A(b) as the design decision (now implemented/tested in PR #92), while B3 remains blocked by the **Phase 2.5 runtime-to-evidence dispatch** implementation/tests and **explicit authorization**.
- **Runtime-to-evidence wiring (Phase 2.5 / ADR-027): decision ACCEPTED as a design constraint, but NOT implemented / NOT tested.** Direct governed-native + passthrough routes are still logger-only in source (`governed-openai.ts:69-70`, `governed-anthropic.ts:71-72`; `passthrough-*.ts`); **zero `captureAuditEvent` call-sites in `apps/`**. The route hooks receive `event: unknown`, so the future **AuditBridge** must validate/narrow via `PassthroughInvokedSchema` before `captureAuditEvent` → outbox. ADR-027 supersedes the older passthrough "Governed Run pipeline (PR3+)" intent for direct routes; `/v1/runs` stays distinct/chain-authoritative via `auditAppend`. B3 still blocked until AuditBridge is implemented/tested (or an accepted deferral names another path).
- **`/v1/runs` orchestrator writes run-lifecycle audit to the chain via `auditAppend`** (`run-orchestrator.ts`), **not** to the capture outbox — distinct path.
- **Runtime hard-deny enforcement** not source/test-verified as complete (regulatory prohibited-use/high-risk/agent hard-deny-floor are evidence-only).
- **Evidence completeness / cockpit** not complete (no captured/sealed/failed counts, no provider-without-audit detection).

---

## 5. Standard restart checklist

1. Read `current-state.md` (state + §3 runtime-to-evidence wiring).
2. Read `development-roadmap.md`.
3. Read `stale-docs-register.md` (do not trust a doc it flags).
4. Read the latest merged PR + its merge commit; confirm `main`.
5. `gh pr list` open PRs; for each, `gh pr checks` + review threads.
6. **Never start B3** without an explicitly accepted decision pack.
7. **Never claim evidence completeness** unless runtime-to-evidence wiring is verified.

---

## 6. Stop conditions

Stop and report (no push/merge) if:
- dirty tree when a clean tree was expected;
- unexpected branch / HEAD;
- CI failing or pending;
- an unresolved, **non-outdated** Codex review thread;
- a docs-only PR contains a production/test/migration/package/lock change;
- any text would overclaim B3 ("B3 authorized", "ready for B3") or compliance/certification;
- **any prompt that treats the ADR-023 Option A(b) decision (or its PR #92 implementation) as B3 runner authorization** (Option A(b) is implemented/tested, but the B3 runner remains unauthorized);
- a provider-native parity claim without tests;
- a status marked IMPLEMENTED_RUNTIME without source evidence;
- an **evidence-plane completeness claim while direct governed-native audit is logger-only**;
- **runtime route existence used as proof of sealed evidence capture**.

---

## 7. Prompt handoff format

End every task with:
- **Repo** — path.
- **Branch** — current branch.
- **Head** — commit SHA.
- **Files changed** — exact list (scope respected).
- **Evidence files** — the source/test files that back the claims.
- **Tests** — what ran, counts, before/after.
- **CI** — run id + conclusion + key steps.
- **Open threads** — review threads (resolved/outdated/open).
- **Safety** — the no-touch list (AWS/KMS/env/secrets/live/B3/etc.).
- **Next recommended prompt** — the single best next step.

---

## 8. What not to do

- No `--admin` merge; no force push; no branch deletion.
- No AWS/KMS use without explicit scope; no reading `.env`/secrets; no live provider tests unless requested.
- No B3 implementation until the decision pack is accepted.
- No editing production/tests/migrations in a docs-only task.
- No marking ADR-022..026 Accepted outside the dedicated B3 decision-pack PR.
- **No evidence-completeness claim before runtime-to-evidence dispatch is verified.**
