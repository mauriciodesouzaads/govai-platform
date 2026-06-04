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

- main after PR #87: `8be5cfc74f67feb2824d0cb25da0816b7689a163`
- Toolchain: Node v24.15.0 (modules 137), pnpm 10.33.2.

---

## 3. Closed gates (confirmed)

- H1 v2 provider-native compatibility coverage (mandatory invariants mapped to executing tests).
- PR #87: valid-tools pass-through positive byte-for-byte.
- Coverage map uses stable `RB-OAI[alias]`/`RB-ANT[alias]` anchors.
- Audit B0 (capture outbox) + B1 (capture adapter, tested as a primitive) + B2 (sealer library) merged.

---

## 4. Open gates

- **B3 decision pack partially accepted** — ADR-022/024/025/026 Accepted as design constraints (NOT implementation authorization); **ADR-023 remains Proposed/BLOCKED** (append→mark_sealed idempotency); B3 Technical Plan written (`specs/audit-sealer-b3-technical-plan.md`). ADR-020 now Superseded-in-part.
- **Append→mark_sealed partial-failure idempotency** — still open. **Capture idempotency solved does NOT mean append→mark_sealed idempotency solved**; `auditAppend` has no per-capture key (`append.ts:72`). B3 blocked until a level-3 mechanism is selected/testable (technical plan §8.3).
- **B3 Technical Plan** — not written.
- **Runtime-to-evidence wiring for direct governed-native routes is NOT implemented / not source-verified as complete.** `governed-openai.ts:69-70` and `governed-anthropic.ts:71-72` emit audit events via `app.log.info` (logger-only); there are **zero `captureAuditEvent` call-sites in `apps/`**. Future **AuditBridge** work must wire these events to `captureAuditEvent` / the outbox (roadmap Phase 2.5).
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
