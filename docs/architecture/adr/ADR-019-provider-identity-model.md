> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** ACCEPTED_TARGET_DECISION
> **ORIGINAL_SOURCE_VERSION:** v0.9 corpus (2026-05-27)
> **ORIGINAL_SOURCE_ANCHOR:** owner-supplied v0.9 architecture package
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D4=ACCEPT_AS_TARGET_DECISION)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (status line reconciled; body otherwise byte-preserved)
> **SOURCE_SHA256:** `c94582fdf9f03c2ec9170c01ba4d239d8513e59c3f23e32fe875bae61d243605` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** ACCEPTED as a TARGET decision (D4). Arbitrary-provider expansion (P2.7) is NOT implemented at the Foundation V1 anchor: the sealed `PassthroughInvoked` v4 schema keeps `provider: z.enum(['anthropic','openai'])` (`packages/core-events/src/passthrough-invoked.ts`) and `packages/core-types/src/capability.ts` keeps the literal `'anthropic' | 'openai'` union; there is no provider registry accepting `providerId: string`. Do not read this target identity model as current universal provider support — the current proven scope is exactly Anthropic and OpenAI on the registered surfaces.
> ---

# ADR-019 — Provider Identity Model

**Status:** Accepted as target decision (M3 / owner decision D4, 2026-08-18) — originally Proposed 2026-05-27; implementation (P2.7 arbitrary-provider expansion) NOT started  
**Date:** 2026-05-27  
**Related:** ADR-016; SPEC v2.1

## Context

GovAI currently prioritizes Anthropic and OpenAI. Some existing schemas and handlers may use literal provider unions such as `anthropic | openai`. The target architecture requires future providers such as Azure OpenAI, AWS Bedrock, Vertex AI, local/sovereign providers and provider-specific wrappers. A narrow union can make every provider addition a schema migration.

## Decision

Use `providerId: string` at the Governance Kernel boundary and provider registry boundary.

Short term: preserve existing event versions if they require literal provider values, and map broader provider IDs internally or through future event versions.

Long term: introduce a new event version where `providerId` is a string validated against a provider registry, not a literal union.

## Consequences

Positive: supports provider extensibility and reduces core type churn.

Negative: requires careful migration and tests to avoid accepting unknown providers without registry validation.

## Acceptance criteria

- Kernel accepts `providerId: string`.
- Provider registry validates known providers/capabilities.
- Event schema migration path is documented before changing `core-events`.
- Unknown provider IDs fail safely unless explicitly registered.
