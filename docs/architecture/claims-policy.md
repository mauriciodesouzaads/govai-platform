> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** ACCEPTED_ARCHITECTURAL_DOCTRINE
> **ORIGINAL_SOURCE_VERSION:** v0.9 corpus (2026-05-27, Draft)
> **ORIGINAL_SOURCE_ANCHOR:** owner-supplied v0.9 architecture package (package path `docs/product/claims-policy.md`)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D6=ACCEPT_AS_DOCTRINE)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (status line reconciled; body otherwise byte-preserved)
> **SOURCE_SHA256:** `de65ab5ae1fdac1b17ecf131c752b4bc1f6abaeb3bf220e4c6ee9f7115829c4a` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** ACCEPTED as doctrine (D6). Promulgated at the D9 destination `docs/architecture/claims-policy.md` (the v0.9 package path was `docs/product/claims-policy.md`; the owner's D9 destination manifest governs). Applies to every capability claim in this repository; capability status for the Foundation V1 surfaces is recorded in `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` (which claims nothing beyond executed-scope acceptance: no certification, no regulatory-compliance, no universal provider parity, no exactly-once).
> ---

# GovAI Claims Policy

**Status:** Accepted as doctrine (M3 / owner decision D6, 2026-08-18) — originally Draft 2026-05-27  
**Date:** 2026-05-27  
**Purpose:** Prevent legal, regulatory and commercial overclaim.

## 1. Rule

A claim may only be used if the underlying capability is in the required status.

Capability states:
- `planned`: claim prohibited except internal roadmap;
- `foundational`: claim only as technical foundation;
- `partial`: claim only with scope and limitations;
- `supported`: claim allowed within documented scope;
- `deprecated`: claim prohibited except migration notes.

## 2. Allowed claims

Allowed if accurate:
- GovAI is building a Brazil-first AI Trust Layer.
- GovAI supports technical evidence where the capability is supported.
- GovAI applies configurable AI usage policies where implemented.
- GovAI records auditable technical events where Audit Bridge/chain support exists.
- GovAI helps organizations prepare evidence and workflows for governance review.

## 3. Qualified claims

Only with explicit scope:
- “Supports forensic review” — only after Audit Bridge covers the relevant surface.
- “Supports LGPD workflows” — only for implemented workflows; never legal compliance guarantee.
- “Supports compliance readiness” — only as readiness/evidence support.
- “Supports Shadow AI visibility” — only after Shadow AI ingestion is implemented.
- “Supports agentic governance” — prohibited until capability is on roadmap and supported.

## 4. Prohibited claims

Never say:
- guarantees LGPD compliance;
- certifies legal use of AI;
- replaces DPO/lawyer/auditor/regulator;
- prevents all data leakage;
- eliminates AI risk;
- is ISO/EU/LGPD certified unless a real certification exists;
- provides full forensic evidence for unsupported surfaces.

## 5. UI/report wording

Use:
- “blocked by configured policy”;
- “risk signal detected”;
- “requires review under organization policy”;
- “technical evidence bundle”;
- “governance readiness support”.

Avoid:
- “illegal”;
- “LGPD violation”;
- “certified compliant”;
- “legally safe”;
- “guaranteed secure”.

## 6. Operational gate

Before external material uses a qualified claim:
1. identify capability;
2. confirm status;
3. confirm acceptance tests;
4. cite scope;
5. include limitation statement.
