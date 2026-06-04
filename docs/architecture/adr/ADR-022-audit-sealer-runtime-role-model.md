# ADR-022: AuditSealer Runtime Role Model

Status: Accepted — design constraint for future B3 implementation (does not authorize implementation)

> **Acceptance note (B3 decision pack, 2026-06-04):** accepted as a **design constraint** for future B3 implementation. **Does not authorize implementation.** The role/session model is final: a dedicated runner identity holding membership in both `govai_audit_sealer` (claim/mark) and `govai_app` (`audit_append_locked`) roles (not collapsed into a broad owner), a separate DB pool from `apps/api` (never the request pool), runner-owned session/transaction/retry/phase orchestration, no `SET ROLE` in the library, explicit phase role switching via `withSealerPhaseRole` (runner/test-harness only), and startup validation before readiness. This resolves the role/session open question left by ADR-020.

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

## Final role/session model for B3

- B3 uses one dedicated deploy identity for the AuditSealer process.
- The deploy identity must use a separate DB pool from `apps/api`.
- The deploy identity must not share the request pool.
- The library does not execute `SET ROLE`.
- The library does not open or commit transactions.
- The runner owns session, transaction, retry, and phase orchestration.
- The runner must use the least-privilege role required for each phase.
- If existing grants require separate phases, the runner must make those phase boundaries explicit.
- `withSealerPhaseRole` is allowed only in the dedicated runner/test harness, not in `apps/api`.
- Provider requests never depend on sealer role/session state.
- Sealer role/session failure is evidence-plane degraded state for low-risk traffic, not provider UX failure.

The current B0 grants split responsibilities across two roles: claim,
mark_sealed, and mark_failed are granted to `govai_audit_sealer`, while the
`auditAppend` path (`audit_append_locked`) is granted to `govai_app`. The B3
runner must therefore treat claim/mark and append as distinct least-privilege
phases inside a single caller-owned transaction, switching role explicitly at
each phase boundary via `withSealerPhaseRole`. The runner identity must hold
membership in both roles; it must not collapse them into a broad owner role.

## Prohibited role models

- No production sealing loop in `apps/api`.
- No shared `apps/api` request pool for sealing.
- No implicit role switching inside core library.
- No superuser/broad-owner role for convenience.
- No provider request waiting on sealer role availability.
- No role model that requires AuditSealer to proxy OpenAI/Anthropic/Claude Code traffic.

## B3 acceptance defaults

- dedicated DB pool: required;
- max pool size initial default: 2;
- transaction ownership: runner-owned;
- role switching: runner/test-harness only if required by grants;
- startup validation: verify required SQL functions/permissions before readiness;
- failure mode: not ready for sealer, provider-native low-risk path remains available.

## Acceptance criteria

- dedicated role documented;
- caller-owned transaction documented;
- `apps/api` production loop forbidden;
- separate pool documented;
- `SET ROLE` stays out of the library;
- provider path does not depend on the sealer.
