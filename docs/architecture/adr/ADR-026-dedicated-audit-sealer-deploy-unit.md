# ADR-026: Dedicated AuditSealer Deploy Unit Lifecycle

Status: Accepted — design constraint for future B3 implementation (does not authorize implementation)

> **Acceptance note (B3 decision pack, 2026-06-04):** accepted as a design constraint for future B3 implementation. Does not authorize implementation. `apps/audit-sealer` may be created only after B3 is explicitly authorized AND ADR-023 (append→mark_sealed idempotency) and the Phase 2.5 runtime-to-evidence dispatch decision are resolved.

## Context

- ADR-020 decided on a dedicated process.
- ADR-022..025 define role, recovery, backpressure, and observability.
- We need the lifecycle before implementing `apps/audit-sealer`.

## Decision

- B3 may create `apps/audit-sealer` only after this pack is approved.
- The deploy unit must be independent of `apps/api`.
- Config must be explicitly separated.
- Process lifecycle:
  - startup validation;
  - readiness;
  - run loop;
  - graceful shutdown;
  - drain;
  - restart recovery.
- No provider SDK calls in the AuditSealer runner.
- No OpenAI / Anthropic runtime traffic in the AuditSealer.
- No Claude Code traffic in the AuditSealer.
- AuditSealer consumes the DB outbox only.
- AuditSealer produces audit append / seal / fail only.
- Do not expose a user-facing route by default.
- Deployment must not be required for provider calls to work in the low-risk
  path.
- If the sealer is down, evidence health degrades; the provider-native
  experience should remain intact unless an explicit high-risk policy says
  otherwise.

## Provider-native impact

- An AuditSealer deploy failure must not break Claude Code.
- An AuditSealer deploy failure must not block default OpenAI / Anthropic usage.
- AuditSealer must not become a provider gateway.
- AuditSealer must not cap, rewrite, proxy, or inspect provider streams
  directly.

## Acceptance criteria

- deploy unit boundaries;
- lifecycle;
- no provider traffic;
- startup / readiness;
- shutdown;
- failure mode;
- native provider non-impact.
