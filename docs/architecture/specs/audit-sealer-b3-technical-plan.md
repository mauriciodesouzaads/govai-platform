# AuditSealer B3 Technical Plan

Status:
- **IMPLEMENTED by EP-006** (`apps/audit-sealer`). The architecture below (§5–§11) is current and binding; the implementation chose **Shape S** for the transaction choreography (one committed tx per seal; SPEC-B3 §1).
- The preconditions in §1/§4/§8.3 below are now SATISFIED (see the inline notes).
- Source commit reviewed: main `11b227b` (decision-pack branch); implemented on main `3af8840`.

## 1. Preconditions — **all SATISFIED (EP-006)**

- `current-state.md` merged (evidence-first source of truth).
- Provider-native gate closed (H1 v2).
- ADR-022 role/session model: **Accepted** — implemented (runner `withSealerPhaseRole` + dedicated pool).
- ADR-023 append→mark_sealed partial-failure idempotency: Option A(b) (deterministic `audit_event_id`) — **implemented & tested in PR #92** (see §8.3), consumed by the EP-006 runner.
- ADR-024/025/026: **Accepted** — implemented (claim loop / OTel metrics / `apps/audit-sealer` deploy unit).
- Phase 2.5 runtime-to-evidence dispatch: ADR-027 (AuditBridge) — **implemented & tested in PR-B #98** (the four direct routes feed the outbox).
- B3 implementation was explicitly authorized (EP-006).

## 2. What B3 does

- Runs as a dedicated process / deploy unit (`apps/audit-sealer`, future).
- Claims captured rows from the B0 outbox (`claimAuditCaptureForSeal`).
- Builds a sealed audit event from the capture (`buildAuditCaptureSealingEvent`).
- Calls the B2 sealer primitives (`auditAppend` → `markAuditCaptureSealed`).
- Marks sealed / failed (`markAuditCaptureSealed` / `markAuditCaptureFailed`).
- Emits health / metrics / logs (ADR-025).
- Recovers stale `sealing` rows (ADR-023).

## 3. What B3 does NOT do

- Does not receive provider traffic.
- Does not sit on the provider hot path.
- Does not replace provider-native routes.
- Does not by itself make runtime events enter the outbox (see §4).
- Does not implement runtime hard-deny.
- Does not certify compliance.
- Does not read secrets or call providers.

## 4. Runtime-to-evidence relationship (Phase 2.5 — **SATISFIED, PR-B #98**)

- Direct governed-native and passthrough routes are currently **logger-only** for audit emission: `apps/api/src/routes/governed-openai.ts:69-70` and `governed-anthropic.ts:71-72` (`emitAuditEvent` → `app.log.info`), same for `passthrough-*.ts`.
- There are **zero `captureAuditEvent` call-sites in `apps/`** — no runtime route feeds the B0/B1 capture outbox.
- `/v1/runs` writes run-lifecycle events to the HMAC chain via `auditAppend` (`run-orchestrator.ts`), which is a **distinct path** from the capture outbox.
- Phase 2.5 dispatch **decision is now made: ADR-027 (AuditBridge)** — the dispatch contract (validate/narrow `event: unknown` via `PassthroughInvokedSchema` → `captureAuditEvent` → outbox) is **documented but not implemented/tested**. Implementing/testing it (or an accepted deferral naming another authoritative path) remains required **before or alongside** B3.
- **B3 seals only what is already captured.** If runtime does not feed the outbox, B3 can create **false confidence** (a sealed-but-empty evidence plane for governed-native traffic).
- This plan therefore treats the Phase 2.5 dispatch decision as a **blocking precondition** for B3 product-completeness.

## 5. Role/session model (from ADR-022 — Accepted)

- Dedicated runner deploy identity; membership in both `govai_audit_sealer` (claim/mark) and `govai_app` (`audit_append_locked`) roles, not collapsed into a broad owner.
- Separate DB pool from `apps/api` (initial max pool size 2); never the request pool.
- Runner owns session/transaction/retry/phase orchestration.
- The library does not execute `SET ROLE` and does not open/commit transactions.
- Explicit phase role switching via `withSealerPhaseRole` (runner/test-harness only), at the claim → append → mark_sealed phase boundaries.
- Startup validation of required SQL functions/permissions before readiness.

## 6. Claim loop (from ADR-024 — Accepted)

- Bounded batch (default 10); max in-flight (default 2); idle sleep (default 1000 ms).
- Empty-queue backoff (exp 1s→30s w/ jitter); error backoff (exp 30s→5m w/ jitter).
- Lock wait timeout: fail fast / no long blocking wait.
- Graceful shutdown drain (default 30s); no busy loop; no starvation.
- No provider-path throttling; no silent caps; backlog alerts (oldest pending > 5m or > 1000 pending).

## 7. Stale recovery (from ADR-023 — **IMPLEMENTED, EP-006 SEPARATE path**: `apps/audit-sealer/src/stale-recovery.ts`)

- Stale threshold (default 10 min); max retries (default 3); exponential backoff (30s→5m).
- Terminal failure after max retries or unrecoverable integrity error; recovery batch (default 10).
- Recovery is transactional; opens a FRESH transaction (never reuses an aborted one); emits metrics.
- **Must detect "append succeeded but mark_sealed failed" before deciding retry vs failed** — §8.3 now selects Option A(b), a deterministic `audit_event_id` derived from `org_id + capture_id`, as a design constraint. Stale recovery remains unsafe to implement until Option A(b) is implemented/tested and the future B3 runner defines the transaction choreography. Phase 2.5 runtime-to-evidence dispatch remains a separate blocker.

## 8. Idempotency decision

The plan distinguishes **three separate idempotency layers**. Conflating them is the central risk.

### 8.1 Capture idempotency — SOLVED

- Source: `captureAuditEvent` (`packages/core-audit/src/capture.ts`) → `govai.audit_capture_insert_locked` (migration 0025) under `capture_id` UNIQUE + `chain_state` row-level lock.
- Same `capture_id` + identical immutable fields returns the same `capture_seq`; same `capture_id` + divergent content raises `unique_violation`.
- This protects **capture insertion into the outbox only**. It does **not** protect the later B3 `auditAppend → mark_sealed` sequence.

### 8.2 mark_sealed idempotency — PARTIALLY SOLVED

- Source: `markAuditCaptureSealed` (migration 0025): if a capture is already sealed with the **same** `audit_event_id`, it is an idempotent no-op; a **different** `audit_event_id` raises `unique_violation`.
- This protects **repeated `mark_sealed` calls for the same already-known event id only**. It does **not** prove that an earlier successful `auditAppend` can be rediscovered if `mark_sealed` never recorded the reference.

### 8.3 append→mark_sealed partial-failure idempotency — DECIDED AS DESIGN CONSTRAINT (Option A(b)); NOT IMPLEMENTED; NOT TESTED

Critical failure case:
1. B3 claims a capture (`claim_for_seal` flips the row to `sealing`).
2. B3 builds and appends an audit event to the HMAC chain (`auditAppend`).
3. `auditAppend` succeeds.
4. Before `mark_sealed` records the `audit_event_id` / `audit_event_capture_refs`, the transaction/session/process fails.
5. Recovery sees the capture again.
6. B3 must avoid appending a **duplicate** audit event to the chain.

**Source finding (why a deterministic key is required):** `auditAppend` (`packages/core-audit/src/append.ts:72`) generates a fresh `const eventId = randomUUID()` on **every** call and has **no per-capture idempotency key** — its `pg_advisory_xact_lock` (`append.ts:58`) only serializes concurrent appends on the same chain; it does not deduplicate a logical capture. So a second append for the same capture would create a **second, distinct** chain event. The only thing that could prevent an orphan append is transaction **atomicity** (claim+append+mark_sealed in a single committed transaction), but the transaction boundary is **caller-owned** (`sealNextAuditCapture` runs all three on one `client` with no internal BEGIN/COMMIT — `sealer.ts:658-722`), and ADR-023's own premise (captures "left in `sealing` if the runner crashes between claim and mark-sealed") implies the `claim`/`sealing` state may be committed separately, which re-opens the orphan-append window. **The transaction choreography remains a future B3 implementation decision. The append idempotency mechanism is now decided as Option A(b), but it is not implemented and not tested.**

**This plan selects Option A(b): a deterministic `audit_event_id` derived from `org_id + capture_id`** (see ADR-023 §"Decision"). This is a **design constraint only — not implemented, not tested, and does not authorize B3.**

- Formula: `audit_event_id = UUIDv5(namespace = govai.audit_sealer.capture_event.v1, name = "org:{org_id}:capture:{capture_id}")` (the exact namespace UUID is documented as a constant in the implementation PR, not here).
- Capture idempotency (§8.1) and mark_sealed idempotency (§8.2) remain separate layers and do **not** cover this case.
- Future B3 must modify/evolve the append path: today `auditAppend` generates `randomUUID()` per call (`append.ts:72`) and passes it to `govai.audit_append_locked(p_event_id, …)` — the SQL already takes a caller-supplied id, but `AuditAppendInput` must be evolved (or a sealer-only append adapter added) to accept the deterministic id.
- B3 must look up `govai.audit_events.id = deterministic_audit_event_id` **before** append; `audit_events.id` is already a `uuid PRIMARY KEY` (migration 0001:29), so it serves as the deterministic-id collision point.
- `audit_event_capture_refs` is written **only by `mark_sealed`** (migration 0025:863), and may be **absent if `mark_sealed` failed before recording the ref** — so it **cannot** be the primary orphan-append detector in the failure window. (`mark_failed` only updates `audit_capture_outbox` to failed; it does not write `audit_event_capture_refs`.) No `capture_id` column exists in `audit_events` today.
- **No migration is required by this design decision for the minimal duplicate-append guard, because `audit_events.id` is already PRIMARY KEY.** A future implementation may still choose a migration for observability or stronger validation, but it is not part of this decision PR.
- **Future B3 is still blocked** until this mechanism is implemented and tested, the Phase 2.5 runtime-to-evidence dispatch decision is made, and B3 implementation is explicitly authorized.

## 9. Health / readiness / metrics (from ADR-025 — Accepted)

- Liveness; readiness (DB reachable, required permissions validated, backlog below critical threshold, no fatal config); readiness failure of the sealer must not imply provider-native endpoints are down.
- Metrics (OTel-compatible): claimed/sealed/failed totals; claim/seal/append latency; backlog depth; oldest pending age; stale count; retry/terminal-failure totals; provider-native latency/error tracked **separately**.
- No raw prompts/responses/secrets in health/logs/metrics; no high-cardinality labels (raw capture_id/run_id/etc.).

## 10. Deployment unit (from ADR-026 — Accepted)

- Future `apps/audit-sealer`, independent of `apps/api`; explicit config separation; lifecycle: startup validation → readiness → run loop → graceful shutdown → drain → restart recovery.
- No provider SDK calls; consumes the DB outbox only; produces append/seal/fail only; not a user-facing route by default.
- Provider-native low-risk traffic must not require the sealer to be deployed/healthy.

## 11. Test plan (future tests only — none added in this PR)

- role startup validation; claim one row; seal success; mark_failed; stale recovery;
- **deterministic event id is stable** for the same `org_id + capture_id`;
- **retry after `auditAppend` success + `mark_sealed` failure does not append a duplicate** (the §8.3 case);
- **existing `audit_event` lookup succeeds when the ref is absent** (`audit_event_capture_refs` not yet written);
- **mismatched existing event fails safely** (correspondence validation);
- **collision-race re-query path** (re-read by deterministic id, validate, continue to `mark_sealed`);
- `mark_sealed` receives the same deterministic id;
- capture eventually reaches `sealed` or terminal `failed`;
- recovery safe under concurrent runner attempts;
- bounded loop; shutdown drain; health/readiness; metrics;
- no provider traffic; no `apps/api` loop.

These tests are specified by the Option A(b) decision (§8.3) but are **not written in this PR** (no code/tests here).

## 12. Stop conditions

- deterministic append idempotency (Option A(b)) **not implemented/tested** → STOP;
- explicit B3 implementation authorization absent → STOP;
- any prompt that treats the Option A(b) **design decision** as B3 implementation authorization → STOP;
- role/session unresolved (resolved by ADR-022);
- runtime-to-evidence dispatch decision absent (current state → STOP);
- B3 tries to handle provider traffic;
- B3 lives inside the `apps/api` production path;
- evidence failures impact low-risk provider-native UX without explicit policy.

## 13. Authorization

- **This document does not authorize implementation.**
- B3 implementation requires a **separate explicit user authorization** after this plan is reviewed, AND the resolution of §8.3 (append→mark_sealed idempotency) AND the Phase 2.5 runtime-to-evidence dispatch decision.
