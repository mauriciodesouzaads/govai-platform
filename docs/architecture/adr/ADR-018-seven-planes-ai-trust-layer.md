> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** ACCEPTED_ARCHITECTURAL_DOCTRINE
> **ORIGINAL_SOURCE_VERSION:** v0.9 corpus (2026-05-27)
> **ORIGINAL_SOURCE_ANCHOR:** owner-supplied v0.9 architecture package
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D3=ACCEPT)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (status line reconciled; body otherwise byte-preserved)
> **SOURCE_SHA256:** `e5e0e7d29b079601a7cde866a06124559f4e0fa5b2685e3ad676f03da87ce187` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** ACCEPTED as architectural doctrine (D3). Acceptance does NOT mean every projected plane is fully implemented. Separation at the Foundation V1 anchor — DOCTRINE: the seven-plane model and the "GovAI AI Trust Layer" name. CURRENT IMPLEMENTATION (source-verified, see `current-state.md`): Plane 1 (provider-native passthrough/governed surfaces, `/v1/runs`, streaming, tool forwarding), Plane 3 (HMAC chain, capture outbox, AuditBridge, B3 sealer, evidence views/read API), Plane 4 (API keys, RBAC, KMS envelope credentials, AWS KMS adapter), Plane 7 backend only (Workroom Phases 1–4; no UI), Plane 6 as evidence-only regulatory registries, Plane 2 as distributed decision logic (no single kernel). TARGET/FUTURE: Plane 5 (Shadow AI / connectors), Plane 6 update-pack machinery, Plane 7 cockpit UI/reporting, Plane 2 kernel extraction. No plane is claimed complete.
> ---

# ADR-018 — Seven-Plane GovAI AI Trust Layer

**Status:** Accepted as architectural doctrine (M3 / owner decision D3, 2026-08-18) — originally Proposed 2026-05-27; doctrine only — plane implementation status is recorded in `docs/architecture/current-state.md`  
**Date:** 2026-05-27  
**Related:** Master Architecture v0.9

## Context

GovAI now spans provider-native surfaces, `/v1/runs`, Workroom, DLP, regulatory registries, audit/evidence, Shadow AI ambition and future connectors. A smaller plane model underrepresented Integration/Shadow AI and Update Plane, which are required for the doctrine that GovAI works standalone and becomes more powerful when integrated.

## Decision

Adopt the Seven-Plane architecture:

1. Native Experience / Data Plane.
2. Governance Kernel / Policy Plane.
3. Evidence Plane.
4. Identity / Secrets / KMS Plane.
5. Integration / Shadow AI Plane.
6. Regulatory Intelligence / Update Plane.
7. Cockpit / Workroom / Reporting Plane.

Use **GovAI AI Trust Layer** as the canonical architecture/product substance name.

## Consequences

Positive: keeps ambition while clarifying boundaries and prevents provider-native, Shadow AI and Update Plane from becoming afterthoughts.

Negative: requires discipline so future capabilities are not mistaken for Foundation commitments.

## Acceptance criteria

- Master architecture describes each plane with current state, target state and gap.
- Foundation Release only includes the subset needed for honest paid/trusted pilots.
- Future capabilities are labeled future/proposed until on roadmap.
- No plane may bypass Kernel or Evidence Plane when executing or ingesting AI events.
