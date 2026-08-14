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

- main after PR #129 (post-P0.3-C): `f381d3fac24d5938aed91b6618ef511b66ddc878` — **P0.3-C cross-request run execution idempotency** (squash of PR #129, "feat(runs): add cross-request execution idempotency"; single parent `21afa116` = the PR #128 authorization-semantics merge; tree `a64e7178` byte-identical to the audited head `bfa05c5b`; post-merge main CI run `31802636887` SUCCESS, unit + integration). [current-state.md](./current-state.md) is the evidence-first source of truth — resume from it, not from this line alone.
- Toolchain: Node v24.15.0 (modules 137), pnpm 10.33.2.

---

## 3. Closed gates (confirmed)

- H1 v2 provider-native compatibility coverage (mandatory invariants mapped to executing tests); coverage map uses stable `RB-OAI[alias]`/`RB-ANT[alias]` anchors.
- Audit B0 (capture outbox) + B1 (capture adapter) + B2 (sealer library) merged; ADR-023 Option A(b) implemented/tested (PR #92).
- **AuditBridge runtime-to-evidence wiring (ADR-027/028) — IMPLEMENTED (PR-B / EP-004):** all four direct governed/passthrough routes dispatch into the B0/B1 capture outbox behind the ingress identity hook (I3/I4 proven).
- **B3 AuditSealer runner — AUTHORIZED + IMPLEMENTED (EP-006, `apps/audit-sealer`)**, S0–S11 integration-tested; deployable packaging shipped (EP-SEALER-DEPLOY, PR #117).
- Evidence completeness layer (EP-008A/B/C/D + EP-OBS-*): views, drop/capture counters, stream terminal completeness, EC reports + RLS-scoped `/v1/evidence` read API, gauges behind `govai_evidence_enumerator` (INV-1), OTLP collector stack.
- The repository CI workflow executes the **unit** and **integration** jobs
  (PR #116 `GOVAI_INTEGRATION` config gate); successful exact-head CI is
  mandatory under the GovAI development/merge protocol. **Do not infer
  GitHub branch-protection enforcement from workflow existence** —
  `CI_EVIDENCE=REAL`, `MERGE_PROTOCOL=PROCESS_ENFORCED`,
  `GITHUB_BRANCH_ENFORCEMENT=NOT_ASSUMED`; do not state current branch
  protection/ruleset status unless independently verified against current
  repository settings (`REPO_ENFORCEMENT_ASSESSMENT=DEFERRED_NON_BLOCKING`).
- P0 packages: P0.1 F5+F6 (PR #118), P0.2 F1+C-2 (PR #119), F4 preventive hardening (PR #120), **P0.3-A F3 durable dispatch (PR #123)** — F3 `DEMONSTRATED → CORRECTED`.
- **P0.3-C — COMPLETE (PR #129, squash `f381d3fa`).** Cross-request run
  execution idempotency on both run-creation surfaces (standalone `/v1/runs`
  + Workroom): optional `X-GovAI-Run-Idempotency-Key`, the immutable
  tenant-scoped `govai.run_idempotency` binding (migration 0030), the
  canonical `govai.run_execution_intent.v1` semantic intent — one durable
  logical run per matching keyed intent, **no intentional second local
  provider execution**, a matching replay consumes no approval twice, and
  **no provider-side exactly-once claim**. `P03_RUNTIME_LANE=COMPLETE`
  (the P0 Truth-and-Integrity **program** stays open — F2 + PR-0/D9 remain).
- **ADR-032 — ACCEPTED + PROMULGATED (PR #125).** The controlling
  provider-truth decision is Accepted and its repository-promulgation
  artifact
  `docs/architecture/adr/ADR-032-openai-files-purpose-provider-truth.md`
  is on `main`. Only the version present on `main` is canonical. The ADR
  file's own `IMPLEMENTATION_STATUS=PENDING` pointer is registered
  localized staleness (separate maintenance; see the register).
- **EP-11 — IMPLEMENTED (PR #126, squash `01c05fd6`).** The false local
  deny and warning are removed (validator + unit test deleted;
  `block_post_sunset`, the synthetic local 403 and
  `x-govai-deprecation-warning` gone); provider forwarding and
  provider-result evidence preserved. `EP11_IMPLEMENTATION=COMPLETE`;
  `ADR032_RUNTIME_IMPLEMENTATION=IMPLEMENTED`.

---

## 4. Open gates

- **F2** — `OPEN_PENDING_SOURCE_CLASSIFICATION`: separate source adjudication + sealed-schema decision; do not classify it (or assert an aggregate findings count) before that. **`NEXT_DEVELOPMENT_MOVEMENT=F2_SOURCE_ADJUDICATION`** (P0.3-C is closed — see §3).
- **Real EC-5** — deferred to a separate Option-A EP.
- **LOCAL_DENY_EVIDENCE_INCOMPLETENESS** — separate P1 evidence-integrity class; remediation is a separate EP. EP-11 removed only the specific `purpose_deprecated_post_sunset` no-audit-event branch (`PURPOSE_DEPRECATED_LOCAL_DENY_BRANCH=CLOSED_BY_EP11`); other local-deny evidence gaps remain open.
- **PR-0 / D9** — source corpus **LOCATED** (11/11 required paths, owner-supplied v0.9 package, hash-inventoried); **repository promulgation PENDING** (`PR0_STATUS=DOCUMENTARY_BLOCKED_PENDING_PROMULGATION`). The 2 genuine in-repo references to the D9 artifacts (migration `0025:36-37` and `core-audit/capture.ts:54` — see the register's precise classification) remain broken in-tree until promotion.
- **Runtime hard-deny enforcement** not source/test-verified as complete (regulatory prohibited-use/high-risk/agent hard-deny-floor are evidence-only; Phase 5).

---

## 5. Standard restart checklist

1. Read `current-state.md` (state + §3 runtime-to-evidence wiring).
2. Read `development-roadmap.md`.
3. Read `stale-docs-register.md` (do not trust a doc it flags).
4. Read the latest merged PR + its merge commit; confirm `main`.
5. `gh pr list` open PRs; for each, `gh pr checks` + review threads.
6. Read §9 *Routine development authorization model* below, then determine
   which authorization model the ACTIVE dispatch states. If it explicitly
   incorporates Standing Owner Authorization v1: no routine G17 stop, and
   the routine squash merge is preauthorized once every technical gate
   passes. If it does not: do **not** infer merge preauthorization merely
   from this playbook — follow the authorization/merge model explicitly
   stated in that dispatch. Absence of Standing Authorization v1 does
   **not** automatically reinstate G17
   (`G17_ROUTINE_DEVELOPMENT=RETIRED`); G17 applies only if the active
   dispatch explicitly requires it. The §9 STOP exceptions always apply.
7. **Never start/run the B3 runner-loop against live infrastructure** without explicit owner authorization (the code is implemented; live operation is a separate authorization).
8. **Never claim evidence-plane completeness beyond what current-state.md §3 verifies** (real EC-5 is deferred; the local-deny evidence-incompleteness class is open).
9. **Codex clean-signal handling:** do not wait indefinitely for only a
   `pull_request_review` object or a reaction — an explicit Codex
   clean/finding result may arrive as an **issue comment**. Always extract
   the reviewed SHA and verify `reviewed SHA == exact current PR head`, then
   classify the content. Never treat "a comment exists" alone as clean; a
   missing/ambiguous/mismatched reviewed SHA stays fail-closed.
10. **Automated probe discipline:** a literal/regex probe hit or miss is
    **not** an automatic semantic finding or absence proof — inspect the
    source before adjudicating (`PROBE → READ_SOURCE → UNDERSTAND_SEMANTICS
    → ONLY_THEN_REPORT`). This does not weaken fail-closed gates: a defined
    semantic requirement that genuinely fails still blocks.

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
- any prompt that promotes D9 artifacts outside the dedicated PR-0/D9 V2 movement;
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
- No ADR status changes (and no D9 artifact promotion) outside the dedicated, owner-authorized PR for that movement.
- **No evidence-plane completeness claim beyond what current-state.md §3 verifies.**

---

## 9. Routine development authorization model (Standing Owner Authorization v1)

```text
G17_ROUTINE_DEVELOPMENT=RETIRED
OWNER_STANDING_AUTHORIZATION=ACTIVE
ROUTINE_SQUASH_MERGE_PREAUTHORIZED=YES
ONE_MISSION_ONE_PR_ONE_MERGE=REQUIRED
NO_ROUTINE_G17_STOP=YES
```

The former external dispatch protocol required a per-merge human G17
handshake before every squash merge. That handshake is **retired for routine
scoped development**. Standing Owner Authorization v1 is the **intended
default model for new routine GovAI dispatches**; authority remains
**mission-scoped** — the active dispatch must explicitly incorporate it.
For a normal scoped development mission **whose dispatch explicitly
incorporates Standing Owner Authorization v1**, the issued dispatch itself
authorizes the entire lifecycle without a second owner message:

branch → edit → tests → commit → normal push → one PR → CI → bounded Codex
review → in-scope correction → final head/tree freeze → normal squash merge
→ structural post-merge proof → post-merge CI.

The executor must **not** stop merely to ask for ordinary merge
authorization once all technical gates pass (exact-head CI success, zero
blocking review findings, zero unresolved current threads, exact scope
match, clean A2). Retiring the routine handshake changes **friction**, not
substance: the technical CI/review/frozen-head gates remain mandatory.

### Scope: one mission, one PR, one merge

Standing authorization is **per dispatch/mission**. It covers only the
single PR opened by that mission. It does not authorize merging unrelated
PRs, modifying other branches for other missions, or reuse for later work.
A future dispatch inherits Standing Owner Authorization v1 only when that
dispatch explicitly incorporates it.

A dispatch that does **not** explicitly incorporate Standing Owner
Authorization v1 conveys no merge preauthorization from this playbook —
the executor follows the authorization/merge model explicitly stated in
that dispatch. Absence of Standing Authorization v1 does **not**
automatically reinstate the retired G17 handshake; G17 applies only if an
active dispatch explicitly requires it.

### Mandatory human STOP exceptions

Standing authorization never covers exceptional/high-risk actions. STOP
before mutation for any of:

- `--admin` or any GitHub administrative bypass;
- force push / force-with-lease;
- material scope expansion beyond the mission's declared file set;
- an unresolved substantive P0/P1 finding;
- material semantic base drift or merge conflict;
- destructive/irreversible data or database action, or destructive
  migration;
- secrets or credential mutation/access outside ordinary existing CI;
- production deployment;
- material paid-infrastructure mutation;
- repository visibility change;
- branch protection / repository ruleset change;
- event schema version change;
- evidence-chain semantic change;
- evidence canonicalization/hash semantic change;
- live B3 sealer-loop operation;
- any action explicitly reserved to the owner.

Do not expand ordinary development steps into owner stops; do not
reinterpret an exception as routine authority.

---

## 10. A2 semantics (canonical)

- **A2 on PR:** must PASS when applicable (the CI A2 step checks commit
  messages + PR body on `pull_request` events).
- **A2 on push/main:** may be `SKIPPED_BY_DESIGN` under the current
  workflow (the step is PR-only). **Never infer push-A2 success from a
  skipped step.**
- **Before squash:** the exact squash title/body must be locally
  pattern-checked clean against the forbidden authorship/tool-attribution
  strings — this is the compensating control for the push-time skip.

---

## 11. Known limits / do not overclaim (P0.3-C)

- **Pre-reservation concurrent-winner window (v1):** when two matching keyed
  requests overlap and the winner's TX-A is still uncommitted at both of the
  loser's committed reads (probe + the bounded post-failure recheck), a
  pre-reservation failure (e.g. credential/KMS) may surface its original
  error even though the winner commits immediately afterward.
  Classification: `KNOWN_V1_LIMITATION` /
  `DEFERRED_LIVENESS_ENHANCEMENT_BY_FROZEN_CONSTRAINT`; `SAFETY_DEFECT=NO`.
  **No duplicate execution, no key burn, no second approval consumption** —
  a subsequent retry of the same key converges to the winner's committed
  run; v1 deliberately does **no polling** and no automatic retry. This is
  not an open runtime gate and not an exactly-once gap (see
  current-state.md §8 *P0.3-C known v1 boundary*).
- **Never claim provider-side exactly-once** (receipt, execution or
  transmission). P0.3-C's strongest statement: GovAI will not intentionally
  launch a second local provider execution for a matching tenant-scoped
  keyed execution intent.
