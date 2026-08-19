> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** HISTORICAL_PRECURSOR
> **ORIGINAL_SOURCE_VERSION:** v0.9 corpus (2026-05-27)
> **ORIGINAL_SOURCE_ANCHOR:** owner-supplied v0.9 architecture package (pre-Foundation; logger-only era)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D2=OPTION_A)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (status line reconciled; body otherwise byte-preserved)
> **SOURCE_SHA256:** `b23f1d7021d2a2f33f207fe0c92080a2484fc9b5dc1dbb134ab4da466f236644` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** HISTORICAL PRECURSOR (D2 = Option A). Written in the logger-only era; its Context ("Direct provider-native surfaces currently emit audit events to application logs") describes the state at 2026-05-27 and is NOT current. Superseded in implementation detail by ADR-027 (runtime-to-evidence dispatch / AuditBridge), ADR-028 (direct-route request identity and capture idempotency), the implemented AuditBridge (`apps/api/src/pipeline/audit-bridge.ts`, wired on the four direct provider routes — PR-B / EP-004) and the implemented B3 AuditSealer runner (`apps/audit-sealer`, EP-006). Historical rationale is preserved; the acceptance criteria below were realized by that later work in a different shape (e.g. `/v1/runs` remains chain-authoritative via `auditAppend`, not the outbox — ADR-027/ADR-029). Referenced by `apps/api/src/db/migrations/0025_audit_capture_outbox_foundation.sql` and `packages/core-audit/src/capture.ts` (historical references, now resolvable).
> ---

# ADR-017 — Audit Bridge and Evidence Plane

**Status:** Historical precursor (M3 / owner decision D2 Option A, 2026-08-18) — originally Proposed 2026-05-27; superseded in implementation detail by ADR-027, ADR-028 and the implemented AuditBridge / B3 sealer  
**Date:** 2026-05-27  
**Related:** SPEC v2.1 Governance Kernel + Audit Bridge

## Context

The existing HMAC audit chain is strong where it is used. `/v1/runs` uses it. Direct provider-native surfaces currently emit audit events to application logs and do not persist those events to the HMAC chain. This violates GovAI's doctrine that provider-native usage must preserve experience while adding governance and evidence.

Directly calling `auditAppend` synchronously in every provider-native route would improve evidence but may harm latency and chain contention.

## Decision

Introduce an Evidence Plane with an Audit Bridge:

1. A durable outbox captures frozen audit inputs.
2. A chain state table assigns capture sequence per chain.
3. A sealer writes captures into the existing HMAC chain by calling `auditAppend` without changing its cryptographic semantics.
4. Strict posture waits for capture and seal where required.
5. Best-effort posture waits for durable capture and seals asynchronously.
6. Evidence completeness is monitored and visible.
7. Provider-native routes stop logging raw audit events and use the bridge.

## Non-goals

Do not rewrite `auditAppend`; do not alter canonical JSON; do not claim external legal validity before external anchoring exists; do not allow async evidence without durable capture.

## Consequences

Positive: closes provider-native forensic gap, preserves low-latency paths where risk allows, enables completeness metrics and evidence bundles.

Negative: introduces sealer role/outbox attack surface and requires operational monitoring.

## Acceptance criteria

- `/governed/anthropic`, `/governed/openai`, `/passthrough/anthropic`, `/passthrough/openai`, and `/v1/runs` persist evidence through the bridge for supported paths.
- No supported surface emits raw audit events to app logs.
- Failed or delayed captures are visible and alertable.
- Outbox content is immutable after capture.
- Sealing order is strict per chain.
- Re-sealing a capture is idempotent.
