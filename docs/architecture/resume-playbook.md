# GovAI Resume Playbook

Purpose: resume the project after a crash, a stalled session, or a fresh Claude Code / audit session **without losing context or drifting**. Read this first, then [current-state.md](./current-state.md) and [development-roadmap.md](./development-roadmap.md).

---

## 1. How to identify current repo state (dynamic — never trust a frozen SHA)

```bash
cd <repo-root>            # the govai-platform checkout
git fetch origin --prune
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main         # CURRENT_REPOSITORY_HEAD — obtain it here, every time
git status --short
gh pr list --state open
gh pr checks <PR#>
pnpm -v       # expect 10.33.2
node -v       # expect v24.x (nvm use 24.15.0 — under Node 22 re2 fails ABI load)
```

Repo shell note: `grep` may be a hanging shell function in this repo's shell — use `command grep`; prefer `GIT_PAGER=cat`.

Three different anchors, never conflated:

```text
CURRENT_REPOSITORY_HEAD          = whatever `git rev-parse origin/main` returns NOW (mutable; do not freeze it in this file)
FOUNDATION_V1_RUNTIME_ANCHOR     = de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68 (tree 0174a5c5…) — immutable; last runtime-changing Foundation V1 commit (PR #132 / M2A)
FOUNDATION_V1_DOCUMENTARY_FREEZE = the M3 canonical-freeze PR #133 (branch docs/foundation-v1-m3-canonical-freeze; frozen head/tree + merge SHA in the external M3 mission record)
```

---

## 2. Foundation V1 baseline (not a frozen "current main")

- **Runtime:** the Backend Foundation V1 runtime is COMPLETE and real-provider accepted (executed scope) at `de80664a` — M1 (PR #131, native/governed contract), M2 (live acceptance: real Anthropic + OpenAI, official SDKs, Claude Code, Codex CLI, `/v1/runs`, AuditBridge captures, bounded seal), M2A (PR #132: `request-id` evidence, entrypoints, raw query). `FOUNDATION_V1_KNOWN_RUNTIME_BLOCKERS=0`. Read [current-state.md](./current-state.md) (evidence-first SoT) and [foundation-v1-freeze.md](./foundation-v1-freeze.md) (freeze assertions, explicit negatives, residual register R1–R16, anti-evaporation clause) — resume from them, never from a SHA in this file. Any commit after `de80664a` is post-Foundation work; check its PR/CI/merge proofs before treating it as known-good.
- **Documentary:** PR-0/D9 promulgated (M3, PR #133); ADR-021 Accepted; ADR-032 implementation reconciled; H1 coverage map regenerated; navigation and hierarchy of truth in [../README.md](../README.md).
- Toolchain: Node v24.15.0 (modules 137), pnpm 10.33.2.

---

## 3. Closed gates (confirmed)

- H1 v2 provider-native compatibility coverage (mandatory invariants mapped to executing tests); coverage map uses stable `RB-OAI[alias]`/`RB-ANT[alias]` anchors.
- Audit B0 (capture outbox) + B1 (capture adapter) + B2 (sealer library) merged; ADR-023 Option A(b) implemented/tested (PR #92).
- **AuditBridge runtime-to-evidence wiring (ADR-027/028) — IMPLEMENTED (PR-B / EP-004):** all four direct governed/passthrough routes dispatch into the B0/B1 capture outbox behind the ingress identity hook (I3/I4 proven).
- **B3 AuditSealer runner — AUTHORIZED + IMPLEMENTED (EP-006, `apps/audit-sealer`)**, S0–S11 integration-tested; deployable packaging shipped (EP-SEALER-DEPLOY, PR #117).
- Evidence completeness layer (EP-008A/B/C/D + EP-OBS-*): views, drop/capture counters, stream terminal completeness, EC reports + RLS-scoped `/v1/evidence` read API, gauges behind `govai_evidence_enumerator` (INV-1), OTLP collector stack.
- **UI/UX V1 U1 — IMPLEMENTED (`apps/ui`).** A static React+TS+Vite SPA over the
  three existing read surfaces (`/v1/evidence/*`, `/v1/audit-events`,
  `/v1/capabilities`); zero backend change. Its honesty vocabulary is
  table-driven and tested (EC-6 pending is never verified; an unobserved
  EC-3.drop is never "no loss"; a 1.0 ratio over an empty population is never
  full coverage; "blocked" only for a real 403). pt-BR/en-US/es.
- **UI/UX V1 EP-B2 — IMPLEMENTED (`GET /v1/me` + UI identity).** The one backend
  addition of this lane so far: a read-only projection of the `AuthIdentity` that
  `authenticateApiKey` already resolves per request (`principal_type` = the literal
  `api_key`, `org_id`, `user_id`, `roles`, `tier`, `operational_mode`) — no
  migration, no schema object, no transaction, no tenant context, no new query,
  and never the raw key / argon2 hash / `api_key_prefix` / a provider credential.
  The `/enter` probe is now that read, so the shell shows the server-supplied
  operational mode, principal type and roles, with user id and tier behind an
  account/details affordance in which tier is explicitly commercial/account
  context (R13). **This is not production human auth** — `principal_type` exists
  so a controlled-pilot org credential is never presented as a human login (R14
  stands).
- The repository CI workflow executes the **unit**, **ui** and **integration** jobs
  (PR #116 `GOVAI_INTEGRATION` config gate; the `ui` job added by EP-UIUX-V1-U1);
  successful exact-head CI is
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
  **no provider-side exactly-once claim**. `P03_RUNTIME_LANE=COMPLETE`.
- **F2 — CLOSED WITH REGISTERED RESIDUAL (M3).** `EVIDENCE_GRANULARITY_GAP`,
  no runtime defect, no false evidence, no v5; recommendation vs applied is
  honest over HTTP since M1 (residual R2; anti-evaporation clause).
- **PR-0 / D9 V2 — PROMULGATED (M3, PR #133).** 43/43 · 26/26 · 15 · 11/11;
  authority classes D0–D16 in every promoted file's header and in
  `d9-promulgation-manifest.md`; the `0025_…sql` / `capture.ts` references
  resolve. The P0 Truth-and-Integrity program is CLOSED at the Foundation V1
  freeze.
- **Foundation V1 M1 / M2 / M2A — COMPLETE** (see §2). Native contract:
  pass-and-observe (unknown betas / non-computer tools forwarded + observed;
  hashed markers), computer-use-only hard floor with durable blocked v4
  evidence, Content-Encoding truth, gate order auth → 404 → 405 → floors →
  credential 502 → forward, raw query preserved, Anthropic `request-id`
  captured, governed recommendation-vs-applied honesty. **ADR-021 Accepted**
  (doctrine ≠ universal parity).
- **ADR-032 — ACCEPTED + PROMULGATED (PR #125) + IMPLEMENTATION RECONCILED (M3).**
  `docs/architecture/adr/ADR-032-openai-files-purpose-provider-truth.md` now
  reads `IMPLEMENTATION_STATUS=COMPLETE — implemented by EP-11 / PR #126`;
  the interim wording is retained as historical. Only the version present on
  `main` is canonical.
- **EP-11 — IMPLEMENTED (PR #126, squash `01c05fd6`).** The false local
  deny and warning are removed (validator + unit test deleted;
  `block_post_sunset`, the synthetic local 403 and
  `x-govai-deprecation-warning` gone); provider forwarding and
  provider-result evidence preserved. `EP11_IMPLEMENTATION=COMPLETE`;
  `ADR032_RUNTIME_IMPLEMENTATION=IMPLEMENTED`.

---

## 4. Open gates and residuals

- **Foundation V1 residual register** — R1–R16 in [foundation-v1-freeze.md](./foundation-v1-freeze.md) §6 (evidence-granularity R1–R4, diagnostics noise R5, beta snapshot R6, real EC-5 R7, P0.3-C liveness window R8, branch protection R9, broader parity R10, Workroom 5–7 R11, Phase 5 primitives R12, tier/profile separation R13, human auth for a production UI R14, SPEC v2.2 R15, legacy docs-root hygiene R16). None is a runtime blocker; none may be silently erased (anti-evaporation clause §7 for schema residuals).
- **Runtime hard-deny enforcement** beyond the computer-use floor and the governed matrix `blocked` outcome is not implemented (regulatory prohibited-use/high-risk/agent hard-deny-floor are evidence-only; Phase 5).
- **Current product lane:** `UI_UX_V1_FOUNDATION` — **STARTED**. **U1 (evidence cockpit, `apps/ui`) is implemented**; **EP-B2 (`GET /v1/me`, the shared identity prerequisite) is implemented**; **U1.5 (AI Console, `/ai`) is IMPLEMENTED** — and the two backend findings its live acceptance produced were owner-adjudicated and are **FIXED** in the same lane (`EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02`): `AI-CONSOLE-ORIGIN-RELAY-01` (the server→provider hop no longer relays the browser's `Origin`, class-wide across both providers and both modes — the Anthropic surface works from a browser, live-reaccepted) and `AI-CONSOLE-RESPONSES-DLP-GAP-01` (governed Responses DLP now reads all five accepted message spellings). Those two are this milestone's ONLY backend runtime change. Two residuals stay OPEN and deliberately unfixed, both provider-route behaviour the owner adjudicates per finding: `PROVIDER-INBOUND-HOP-HEADER-RESIDUAL-01` (`referer` / `cookie`) and `PROVIDER-NONSTREAM-FORWARD-UNBOUNDED-01` (non-stream `forwardRaw` has no deadline and no body ceiling; streaming is unaffected); **U2 (workroom console) is NOT started** and is now gated only on EP-B4 (workroom participants). A production human release still requires the human auth / session / API-key lifecycle that does not exist (residual R14) — the U1 session is an explicitly labelled development / controlled-pilot mechanism, not production auth. No UI may represent ask/sandbox/enforcement as applied (R12) or couple commercial tier to governance profile (R13). See development-roadmap.md and current-state.md §1 *Interface layer*.
- **`GOVAI_NATIVE_EXPERIENCE_PARITY_V1` = `BASELINE_COMPLETE_TARGET_NOT_IMPLEMENTED`.** The owner's declared program direction — the baseline movement is complete in this tree, the target itself is NOT implemented and no capability wave is in flight: expose OpenAI, Anthropic, **Codex** and **Claude Code** capabilities with provider-native fidelity where an official supported programmatic interface exists, and a GovAI-product-equivalent experience where the provider app has no equivalent public interface. Doctrine: native semantics preserved (no normalization to a common denominator); a registered endpoint is NOT a fully-available capability; Native and Governed coverage proven independently; UI exposure an independent axis; live acceptance an independent axis; app-only features are `GOVAI_PRODUCT_EQUIVALENT`, never `PROVIDER_NATIVE`; Codex via supported structured interfaces (e.g. `codex app-server`) not terminal scraping; Claude Code via the supported Agent SDK / structured CLI, not TUI scraping. First movement — **`EP-PROVIDER-NATIVE-PARITY-V1-BASELINE-01`** — is **COMPLETE in this tree** (research snapshot 2026-08-21): the parity status is now `BASELINE_COMPLETE_TARGET_NOT_IMPLEMENTED`. Read [native-experience-parity-v1.md](./native-experience-parity-v1.md) (baseline, findings incl. `TOOL-TAXONOMY-DRIFT-2026-08`, wave plan) + [ai-conversation-continuity-v1.md](./ai-conversation-continuity-v1.md) (the P0 DESIGN spec — `CONVERSATION_PERSISTENCE=NOT_IMPLEMENTED`); the machine manifest is `generated/native-experience-parity-v1.json`, gated by `pnpm docs:parity:check` and the unit lane. The implementation mission `EP-AI-CONVERSATION-CONTINUITY-V1-01` is IN_PROGRESS — see the dedicated lane bullet below for its current movement state.
- **Current implementation lane: `EP-AI-CONVERSATION-CONTINUITY-V1-01` — IN_PROGRESS.** This is
  the lane a new session resumes today. Do **not** start P0-A1, P0-A2 or P0-B: all three are
  finished and merged.

  ```text
  PROGRAM   EP-AI-CONVERSATION-CONTINUITY-V1-01
  COMPLETE  P0-A1 · T1 · P0-A2 · P0-B
  NEXT      P0-C-DURABLE-SEND-EXECUTION-KERNEL-01   (not started)
  LATER     P0-D · P0-E · P0-F                      (not started)
  ```

  **★ `T1=COMPLETE` is narrowly scoped.** T1 is
  `EP-AUTH-API-KEY-PREFIX-COLLISION-HARDENING` movement `T1-TEST-ISSUANCE-BOUNDARY-RETRY-01`: a
  bounded `23505`/`api_keys_pkey` retry at the SHARED TEST issuance boundary and nothing more. It
  made **no production runtime change** and did not touch the short lookup-prefix contract that
  causes the collision domain, so `PRODUCTION_API_KEY_ISSUANCE_LIFECYCLE=NOT_IMPLEMENTED` and
  `LATENT_AUTH_LIFECYCLE_DESIGN_RISK=OPEN_R14` stay OPEN. Never read it as finished production
  API-key collision handling.

  **P0-B (conversation control plane) technical evidence** — PR **#145**, squash merge
  `6567d8da75b5c72506cb8b22aba69e0d40bd4b29`, reviewed tree
  `770dffba7dbf8784b74047a9034ffa5f8b692986` (the merge commit's tree IS that tree, byte for
  byte), independent exact-head Opus 5 Max audit **PASS** (`P0=0 · P1=0 · P2=0 · P3=7`),
  post-merge main CI run **33023935331 GREEN**. What shipped: migration `0033`, five
  `/v1/ai/conversations*` routes, encrypted titles, the fork control plane with body-carried
  `client_fork_id` idempotency, and the STRUCTURAL closure of `P0A1-C4` / `P0A1-C5`.
  Full canonical detail — including the seven P3 carry-forwards — is in current-state.md's
  *P0-B canonical state* section.

  **★ Two gates before P0-C's ACTIVATION boundary** (they gate the first real worker activation,
  **not** every preparatory P0-C step): `P0A2-P3-A1` must be adjudicated/closed before the FIRST
  real conversation-worker runtime activation, and `P0A2-P3-A4` must receive its required
  pre-activation review before worker runtime callers expand.

  **★ Honesty boundary, unchanged and load-bearing:**
  `CONVERSATION_PERSISTENCE=NOT_IMPLEMENTED`. A completed control plane is **not** persistent
  chat — there is still no `Send → durable accepted turn → server-owned execution →
  hydrate/reload` path, no worker process, no provider dispatch from a durable turn, and the AI
  Console transcript remains memory-only by construction. Never quote `P0_B=COMPLETE` as
  conversation persistence.
- Untouched documentary follow-ups: `source-spec.md` ADP-canonical declaration (owner gate), ADR-022–027 status-line normalization, `workroom-governance-room.md`/`governance-philosophy.md`/`contracts/*` prepends, two `tests/live/*` comments, legacy `docs/` root artifacts (see stale-docs-register.md, M3 section).

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
8. **Never claim evidence-plane completeness beyond what current-state.md §3 verifies** (real EC-5 is deferred; the former class-wide local-deny label is superseded by the narrow residuals R2–R5 in the freeze record).
9. **Codex clean-signal handling:** do not wait indefinitely for only a
   `pull_request_review` object or a reaction — an explicit Codex
   clean/finding result may arrive as an **issue comment**. The gate is
   three-part, ALL required: (a) **author provenance** — the signal must come
   from the trusted Codex bot/App identity (the installed Codex GitHub App's
   bot login, e.g. `chatgpt-codex-connector[bot]`), never merely any account
   with comment permission; (b) extract the reviewed SHA and verify
   `reviewed SHA == exact current PR head`; (c) classify the content as
   explicitly clean vs. containing findings. Never treat "a comment exists"
   alone as clean; a missing/ambiguous/mismatched reviewed SHA — or an
   untrusted/unverifiable author — stays fail-closed.
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
- any text would overclaim compliance/certification, or claim evidence-plane completeness beyond what current-state.md §3 verifies (real EC-5 deferred; residuals R1–R6 registered);
- **any prompt that treats the implemented B3 code as authorization to RUN the sealer loop against live infrastructure** (implementation and live operation are separate authorizations);
- any prompt that changes the promulgated D9 doctrine (ADR-016..019, master architecture, claims-policy, threat-model, artifact-hygiene, SPEC v2.1, the two futures) outside a dedicated architecture/doctrine movement (M3 was the dedicated promulgation movement — that former "do not promulgate" guard is historical);
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
- No ADR status changes (and no D9 doctrine changes) outside a dedicated, owner-authorized movement.
- **No evidence-plane completeness claim beyond what current-state.md §3 verifies.**
- No claim of universal provider parity, exactly-once provider execution, certification/compliance, full Phase 5, full Workroom, EC-5, production human auth, or complete query request-target sealed reconstruction (foundation-v1-freeze.md §3 explicit negatives).

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

## 11. Known limits / do not overclaim (P0.3-C; Foundation V1 negatives)

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
- **Foundation V1 explicit negatives** (freeze record §3): `UNIVERSAL_PROVIDER_PARITY=NOT_CLAIMED`,
  `PROVIDER_EXACTLY_ONCE=NOT_CLAIMED`, `CERTIFICATION=NOT_CLAIMED`,
  `REGULATORY_COMPLIANCE=NOT_CLAIMED`, `PRODUCT_COMPLETE=NO`, `PHASE5_COMPLETE=NO`,
  `WORKROOM_COMPLETE=NO`, `HUMAN_AUTH_COMPLETE=NO`, `EC5_COMPLETE=NO`,
  `QUERY_TARGET_FULL_SEALED_RECONSTRUCTION=NOT_CLAIMED`. "Foundation V1 works
  against real AI providers" is permitted only with the executed-scope
  qualification (freeze record §4).
