# ADR-022: AuditSealer Runtime Role Model

Status: Proposed

## Context

- B2 created the reusable AuditSealer core library.
- ADR-020 decided that production sealing runs as a dedicated process.
- B0 created the SQL functions and the roles/grants
  (`govai_audit_sealer` for claim/seal/fail; `govai_app` for
  `audit_append_locked` via `auditAppend`).
- B2 exposed `withSealerPhaseRole` for the dedicated runner / test harness,
  NOT for `apps/api`.
- We need to decide the role/session model before B3.

## Decision

- The production AuditSealer runs as a dedicated deploy unit.
- `apps/api` does not execute the sealing loop in production.
- The dedicated runner must own its own identity.
- Role/session orchestration must be explicit.
- The library does not execute `SET ROLE`.
- The library does not open its own transaction.
- The caller/runner controls the transaction and session.
- Secrets must come from a secret manager / KMS in the future, not from
  `.env` read by code as part of this decision.
- Never mix the `apps/api` request pool with the sealing pool.
- If multi-role is required, the runner encapsulates phases via
  `withSealerPhaseRole`.
- No provider request depends on the sealer's role.

## Provider-native impact

- The AuditSealer role model must not impact OpenAI, Anthropic, or Claude Code.
- The sealer is asynchronous and does not sit on the hot path.
- A sealer role failure must not cripple the provider-native experience for
  low-risk traffic; it surfaces as an evidence-plane health issue.

## Acceptance criteria

- dedicated role documented;
- caller-owned transaction documented;
- `apps/api` production loop forbidden;
- separate pool documented;
- `SET ROLE` stays out of the library;
- provider path does not depend on the sealer.
