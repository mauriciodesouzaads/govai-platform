> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** CANDIDATE_TARGET_ARCHITECTURE
> **ORIGINAL_SOURCE_VERSION:** v0.9 corpus (2026-05-27)
> **ORIGINAL_SOURCE_ANCHOR:** owner-supplied v0.9 architecture package (pre-Foundation; era of the 2026-05 audits)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D1=APPROVED_AS_CANDIDATE_TARGET_ARCHITECTURE)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (status line reconciled; body otherwise byte-preserved)
> **SOURCE_SHA256:** `2a9fd8dff38daef9240e7e8a50d08ccc0a9a62cf514139da904b70d79cd7dc68` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** Candidate target architecture, NOT implemented. At the Foundation V1 anchor there is no `packages/governance-kernel`; governance decision logic remains distributed (`packages/core-governance` — `resolveGovernance` in `src/governed-native/resolve-governance.ts`, `computeEnforcement` in `src/enforcement.ts` — the provider governed handlers, and `apps/api/src/pipeline/run-orchestrator.ts`). Current implementation reality takes precedence over this ADR; acceptance of the target does not assert that the kernel exists as a single component/package.
> ---

# ADR-016 — Governance Kernel

**Status:** Candidate target architecture (M3 / owner decision D1, 2026-08-18) — originally Proposed 2026-05-27; not implemented as `packages/governance-kernel` at the Foundation V1 anchor  
**Date:** 2026-05-27  
**Related:** Master Architecture v0.9; SPEC v2.1 Governance Kernel + Audit Bridge

## Context

GovAI currently contains governance decision logic in multiple places: `/v1/runs` orchestration, provider-native handlers, governed-native resolver, DLP pipeline, policy code and regulatory service. This works for early implementation but does not scale to new providers, Shadow AI, connectors, Workroom decisions or governance-as-API.

The product doctrine requires that every AI surface use a common governance decision path. Provider-native experience must remain preserved, but no provider-native route may bypass risk, DLP, policy or evidence decisions.

## Decision

Create a `packages/governance-kernel` package that exposes a single governance decision interface.

The Kernel:
- receives a `GovernanceContext`;
- calls ports for capabilities, DLP, policy, enforcement and clock;
- returns a `GovernanceDecision` and an `AuditIntent`;
- is provider-agnostic through `providerId: string`;
- is pure with respect to persistence and upstream calls;
- is consumed by `/v1/runs`, `/governed/*`, `/passthrough/*`, Workroom-owned runs, future Shadow AI ingestion and future connector ingestion.

## Non-goals

The Kernel does not persist audit events, call providers, implement UI approval flows, replace legal judgment, or claim compliance.

## Consequences

Positive: removes duplicate governance paths, enables governance-as-API, makes provider addition predictable, enables DLP RT-bridge and improves testability.

Negative: requires refactor of orchestrator/provider-native handlers and compatibility tests.

## Acceptance criteria

- A new package exists for the Kernel.
- `/v1/runs` and provider-native supported routes call the Kernel.
- Tests fail if a supported AI execution surface bypasses the Kernel.
- The Kernel returns explicit decision, friction mode and audit intent.
- Rich DLP findings can be transformed into policy actions through a binding.

## Open questions

- How wide should `providerId` become in event schemas?
- Which policy binding model ships before Update Plane exists?
