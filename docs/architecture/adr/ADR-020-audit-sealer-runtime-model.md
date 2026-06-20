# ADR-020 — AuditSealer Runtime Model

Status: Superseded in part by ADR-022–026; B3 **IMPLEMENTED in EP-006** (`apps/audit-sealer`)

## Supersession / current status

ADR-020 is no longer the final source for the AuditSealer runtime model. The specific decisions are now owned by the B3 decision pack (all **Accepted**), and B3 is now **implemented**:

- **ADR-022** resolves the role/session model (Accepted) — implemented as the runner's `withSealerPhaseRole` phase switching + dedicated pool.
- **ADR-023** owns stale recovery and the **append→mark_sealed partial-failure idempotency** decision (Accepted: Option A(b), deterministic `audit_event_id`) — **implemented & tested in PR #92** and consumed by the EP-006 runner's SEPARATE stale-recovery path.
- **ADR-024** owns the claim loop / backpressure (Accepted) — implemented as the runner's bounded claim loop.
- **ADR-025** owns health / metrics / observability (Accepted) — implemented as the runner's startup probe + OTel metrics.
- **ADR-026** owns the dedicated deploy unit lifecycle (Accepted) — implemented as `apps/audit-sealer`.

All four ADR-020 unblock conditions now HOLD (B3 implemented in EP-006):
- the decision pack is accepted (ADR-022/023/024/025/026);
- the append→mark_sealed idempotency mechanism (Option A(b)) is **implemented and tested** (PR #92);
- the runtime-to-evidence dispatch (Phase 2.5 / AuditBridge) is **implemented and tested** (PR-B #98);
- explicit B3 authorization was given (EP-006). The transaction choreography is decided as **Shape S** (SPEC-B3 §1).

Accepting ADR-022/024/025/026 as design constraints **does not authorize implementation**. This ADR's original "Decision/Rationale/Role Model" sections below are retained for history.

## Context

B0 introduced the audit capture outbox foundation.
B1 introduced the captureAuditEvent adapter.
B2 introduced the reusable AuditSealer core library.

The system now needs a runtime decision for how sealing will be executed continuously.

## Decision

Production AuditSealer will run as a dedicated process/deploy unit, not inside apps/api.

The reusable core remains in:

`packages/core-audit/src/sealer.ts`

A future production runner may live in:

`apps/audit-sealer`

`apps/api` must not run the production sealer loop.

A dev/test in-process runner may be added later only behind explicit configuration and must not be the production default.

## Rationale

- isolate sealing failures from HTTP request handling;
- avoid competing with provider/API request latency;
- provide independent backpressure;
- allow independent scaling;
- allow independent pause/resume;
- simplify observability and health checks;
- avoid sharing request pools with role-sensitive sealing operations;
- make role/session boundaries explicit.

## Role Model

The B0/B2 split currently requires two permission domains:

- `govai_audit_sealer` for claim/mark functions;
- `govai_app` for `auditAppend` / `audit_append_locked`.

The B2 core must not issue `SET ROLE`.
The dedicated runner owns role/session orchestration.

Open design question before runner implementation:

- introduce a dedicated runtime DB role for the sealer;
- or grant the `auditAppend` path to `govai_audit_sealer`;
- or retain explicit phase role switching in the dedicated runner.

> **Resolution note (2026-06-04):** this open question is **resolved by ADR-022** (AuditSealer Runtime Role Model), which selects explicit phase role switching in the dedicated runner via `withSealerPhaseRole`, with a separate DB pool and no `SET ROLE` in the library. ADR-022–026 are **Accepted**, and the dedicated runner that performs this phase switching is **implemented in EP-006** (`apps/audit-sealer/src/phase-role.ts` + `seal-once.ts`).

No migration is introduced by this ADR.

## Consequences

- B2 remains a library, not a process.
- No `apps/api` production runner.
- B3 must design stale sealing recovery.
- B3 must define backpressure.
- B3 must define health checks and metrics.
- B3 must define role/session model before implementation.

## Non-goals

- no runner in this ADR;
- no migration;
- no grant change;
- no provider route rewiring;
- no `apps/api` integration;
- no deploy pipeline.

## Follow-ups

- B2 hardening of sealer API/documentation.
- B3 runner design prompt after B0/B1/B2 review.
- Possible migration for dedicated sealer runtime role.
