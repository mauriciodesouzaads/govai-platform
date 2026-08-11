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

- main after PR #123: `165291d90b144d3063ed87b8eaeac73e9a506e41` — **P0.3-A / F3 durable provider dispatch** (squash of PR #123; single parent `4d6eab72` = the EP-DOCS-05 roll; post-merge main CI run `31282331366` SUCCESS). [current-state.md](./current-state.md) is the evidence-first source of truth — resume from it, not from this line alone.
- Toolchain: Node v24.15.0 (modules 137), pnpm 10.33.2.

---

## 3. Closed gates (confirmed)

- H1 v2 provider-native compatibility coverage (mandatory invariants mapped to executing tests); coverage map uses stable `RB-OAI[alias]`/`RB-ANT[alias]` anchors.
- Audit B0 (capture outbox) + B1 (capture adapter) + B2 (sealer library) merged; ADR-023 Option A(b) implemented/tested (PR #92).
- **AuditBridge runtime-to-evidence wiring (ADR-027/028) — IMPLEMENTED (PR-B / EP-004):** all four direct governed/passthrough routes dispatch into the B0/B1 capture outbox behind the ingress identity hook (I3/I4 proven).
- **B3 AuditSealer runner — AUTHORIZED + IMPLEMENTED (EP-006, `apps/audit-sealer`)**, S0–S11 integration-tested; deployable packaging shipped (EP-SEALER-DEPLOY, PR #117).
- Evidence completeness layer (EP-008A/B/C/D + EP-OBS-*): views, drop/capture counters, stream terminal completeness, EC reports + RLS-scoped `/v1/evidence` read API, gauges behind `govai_evidence_enumerator` (INV-1), OTLP collector stack.
- CI as an enforced two-job gate (unit + integration; PR #116 `GOVAI_INTEGRATION` config gate).
- P0 packages: P0.1 F5+F6 (PR #118), P0.2 F1+C-2 (PR #119), F4 preventive hardening (PR #120), **P0.3-A F3 durable dispatch (PR #123)** — F3 `DEMONSTRATED → CORRECTED`.

---

## 4. Open gates

- **ADR-032 repository promulgation — NEXT movement.** The owner adjudication is complete but the accepted decision remains staged outside the repository. **EP-11 runtime implementation must not begin until ADR-032 is promulgated in the repository.**
- **EP-11** — OpenAI Files-purpose provider-truth correction (after promulgation).
- **Remaining P0.3 slices — P0.3-C OPEN.**
- **F2** — `OPEN_PENDING_SOURCE_CLASSIFICATION`: separate source adjudication + sealed-schema decision; do not classify it (or assert an aggregate findings count) before that.
- **Real EC-5** — deferred to a separate Option-A EP.
- **LOCAL_DENY_EVIDENCE_INCOMPLETENESS** — separate P1 evidence-integrity class; remediation is a separate EP.
- **PR-0 / D9** — source corpus **LOCATED** (11/11 required paths, owner-supplied v0.9 package, hash-inventoried); **repository promulgation PENDING** (`PR0_STATUS=DOCUMENTARY_BLOCKED_PENDING_PROMULGATION`). The 2 genuine in-repo references to the D9 artifacts (migration `0025:36-37` and `core-audit/capture.ts:54` — see the register's precise classification) remain broken in-tree until promotion.
- **Runtime hard-deny enforcement** not source/test-verified as complete (regulatory prohibited-use/high-risk/agent hard-deny-floor are evidence-only; Phase 5).

---

## 5. Standard restart checklist

1. Read `current-state.md` (state + §3 runtime-to-evidence wiring).
2. Read `development-roadmap.md`.
3. Read `stale-docs-register.md` (do not trust a doc it flags).
4. Read the latest merged PR + its merge commit; confirm `main`.
5. `gh pr list` open PRs; for each, `gh pr checks` + review threads.
6. **Never start/run the B3 runner-loop against live infrastructure** without explicit owner authorization (the code is implemented; live operation is a separate authorization).
7. **Never claim evidence-plane completeness beyond what current-state.md §3 verifies** (real EC-5 is deferred; the local-deny evidence-incompleteness class is open).

---

## 6. Stop conditions

Stop and report (no push/merge) if:
- dirty tree when a clean tree was expected;
- unexpected branch / HEAD;
- CI failing or pending;
- an unresolved, **non-outdated** Codex review thread;
- a docs-only PR contains a production/test/migration/package/lock change;
- any text would overclaim compliance/certification, or claim evidence-plane completeness beyond what current-state.md §3 verifies (real EC-5 deferred; the local-deny evidence-incompleteness class open);
- **any prompt that treats the implemented B3 code as authorization to RUN the sealer loop against live infrastructure** (implementation and live operation are separate authorizations);
- any prompt that would start EP-11 runtime work **before ADR-032 is promulgated in the repository**, or that promotes D9 artifacts outside the dedicated PR-0/D9 V2 movement;
- a provider-native parity claim without tests;
- a status marked IMPLEMENTED_RUNTIME without source evidence;
- **runtime route existence used as proof of sealed evidence capture**;
- **any text that claims exactly-once provider dispatch** (the P0.3-A contract is a durable boundary + honest `run.outcome_unknown`, not exactly-once; a durable boundary is not a provider receipt).

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
- No live B3 sealer-loop operation without explicit owner authorization.
- No editing production/tests/migrations in a docs-only task.
- No ADR status changes (and no ADR-032 promulgation, no D9 artifact promotion) outside the dedicated, owner-authorized PR for that movement.
- **No evidence-plane completeness claim beyond what current-state.md §3 verifies.**
