# ADR-020 — AuditSealer Runtime Model

Status: Draft

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
