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
gh pr checks <PR#>            # for any open PR you are about to touch
node -v                       # expect v24.x (nvm use 24)
pnpm -v                       # expect 10.33.2
```

Note: in this repo's shell, `grep` is a hanging function — use `command grep`, and prefer `GIT_PAGER=cat` for git output.

---

## 2. Current known-good main

- main after PR #87: `8be5cfc74f67feb2824d0cb25da0816b7689a163`
- Toolchain: Node v24.15.0 (NODE_MODULE_VERSION 137), pnpm 10.33.2.
- Provider-native harness + coverage map are versioned and green in CI on this commit.

---

## 3. Closed gates

- H1 v2 provider-native compatibility coverage (all mandatory invariants mapped to executing tests).
- PR #87: valid-tools pass-through positive byte-for-byte (INV-006/INV-009) — the last documented provider-native follow-up.
- Coverage map uses stable `RB-OAI[alias]` / `RB-ANT[alias]` anchors (no fragile line-only references).
- Audit B0 (capture outbox) + B1 (capture adapter) + B2 (sealer library) merged.

---

## 4. Open gates

- **B3 decision pack not accepted** — ADR-022..026 are Proposed, not Accepted.
- **ADR-020 stale** — role-model open question; resolved by ADR-022 but ADR-020 not yet updated/superseded.
- **Append/seal idempotency decision** — ADR-023 leaves an explicit append idempotency key open for B3.
- **B3 Technical Plan** — not written.
- **Runtime hard-deny** — regulatory prohibited-use/high-risk/agent hard-deny-floor are evidence-only; no runtime gateway enforcement.
- **Evidence completeness / cockpit** — captured/sealed/failed counts and "provider-without-audit" detection not implemented.

---

## 5. Standard restart checklist

For any new session:
1. Read `current-state.md` (state of every surface).
2. Read `development-roadmap.md` (what comes next and why).
3. Read `stale-docs-register.md` (do not trust a doc it flags).
4. Read the latest merged PR (and its merge commit) to confirm `main`.
5. `gh pr list` open PRs; for each, `gh pr checks` and review threads.
6. **Never start B3** without an explicitly accepted decision pack (Phase 2).

---

## 6. Stop conditions

Stop and report (do not push/merge) if:
- working tree is dirty when a clean tree was expected;
- you are on an unexpected branch / unexpected HEAD;
- CI is failing or pending;
- there is an unresolved, **non-outdated** Codex review thread;
- a PR expected to be docs-only contains a production/test/migration/package/lock change;
- any text would overclaim B3 ("B3 authorized", "ready for B3") or compliance/certification;
- a provider-native parity claim is made without tests.

---

## 7. Prompt handoff format

End every task with a structured report so the next session can resume:
- **Repo** — path.
- **Branch** — current branch.
- **Head** — commit SHA.
- **Files changed** — exact list (and that scope was respected).
- **Tests** — what ran, counts, before/after.
- **CI** — run id + conclusion + key steps.
- **Open threads** — review threads (resolved/outdated/open).
- **Safety** — the no-touch list (AWS/KMS/env/secrets/live/B3/etc.).
- **Next recommended prompt** — the single best next step.

---

## 8. What not to do

- No `--admin` merge.
- No force push.
- No branch deletion.
- No AWS/KMS use without explicit scope.
- No reading `.env` or secrets.
- No live provider tests unless explicitly requested.
- No B3 implementation until the decision pack is accepted.
- No editing production/tests/migrations in a docs-only task.
- No marking ADR-022..026 Accepted outside the dedicated B3 decision-pack PR.
