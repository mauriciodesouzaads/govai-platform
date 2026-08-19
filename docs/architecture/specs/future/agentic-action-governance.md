> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** TARGET_VISION
> **ORIGINAL_SOURCE_VERSION:** v0.9 corpus (2026-05-27, Proposed — not in current roadmap)
> **ORIGINAL_SOURCE_ANCHOR:** owner-supplied v0.9 architecture package
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D7=APPROVED_AS_TARGET_VISION)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header)
> **SOURCE_SHA256:** `59ad3d97da44935eb576c5c4724a0cf41ea326569dfba8ff9035bc76f9eafc5c` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** TARGET VISION / FUTURE DESIGN (D7). NOT implemented. The Workroom approval primitive (`intended_action_hash` + SoD, Phase 4) is a related precursor already in the runtime, but no agentic-action governance capability (tool invocations, external-state mutation governance, Phase 5 ask/sandbox/enforce primitives) exists at the Foundation V1 anchor; commercial claims remain prohibited per this document and the claims policy.
> ---

# Future SPEC — Agentic Action Governance

**Status:** Proposed — not in current roadmap  
**Date:** 2026-05-27

This document reserves the design space for future governance of AI agents that can take actions outside a model conversation.

No commercial claim may reference this capability until a roadmap release includes it and implementation reaches `supported`.

## Principle

Any agentic action that can mutate external state must carry:
- intended-action hash;
- risk class;
- least-privilege tool scope;
- policy decision;
- approval requirement when applicable;
- post-action evidence;
- rollback metadata where possible.

Detailed taxonomy is intentionally deferred.
