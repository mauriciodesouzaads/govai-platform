> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** HISTORICAL_PRE_FOUNDATION_RUNTIME
> **ORIGINAL_SOURCE_VERSION:** v0.9 corpus (2026-05-27, Draft; supersedes SPEC v2 draft)
> **ORIGINAL_SOURCE_ANCHOR:** owner-supplied v0.9 architecture package
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D8 (SPEC_V2_1_CLASSIFICATION=HISTORICAL_PRE_FOUNDATION_RUNTIME; SPEC_V2_2_AUTHORING_IN_M3=NO))
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header)
> **SOURCE_SHA256:** `c7a6f410c7b62c909c0ff495c5f51aab27723981684098d2e780f617bc3fe683` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** HISTORICAL — PRE-FOUNDATION RUNTIME (D8): `SPEC_V2_1_CURRENT_AUTHORITY=NO`. This specification is no longer authoritative after P0.3-A (durable provider dispatch, PR #123 / migration 0029), P0.3-C (run idempotency, migration 0030), EP-11 and the Foundation V1 M1/M2/M2A runtime; the merged source, migrations, executing tests, accepted ADRs (ADR-020..028, ADR-032), `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` are the current operational truth. Where this text names objects, states or functions that differ from the merged migrations (e.g. §5–§7 dispatch states, streaming state machine), the migrations and source prevail. A consolidated successor (SPEC v2.2 — Governance Kernel, AuditBridge and Durable Run Dispatch) is a NAMED FOLLOW-UP (`EP-FOUNDATION-V1-SPEC-V2.2-CONSOLIDATION`); it does NOT exist yet and no file for it is referenced. Referenced by `apps/api/src/db/migrations/0025_audit_capture_outbox_foundation.sql` (historical reference, now resolvable).
> ---

# SPEC v2.1 — Governance Kernel + Audit Bridge Hardening

**Status:** Draft  
**Date:** 2026-05-27  
**Supersedes:** SPEC v2 draft  
**Related ADRs:** ADR-016, ADR-017, ADR-019

## 1. Purpose

This SPEC defines the implementation-ready hardening patch for the Governance Kernel and Audit Bridge. It accepts the SPEC v2 direction while adding database role discipline, state-machine constraints, provider dispatch precision, metadata minimization and idempotency capability modeling.

## 2. Non-negotiable invariants

1. No supported AI surface may bypass the Governance Kernel.
2. No supported AI surface may produce only log-based evidence.
3. `auditAppend` and canonical chain semantics remain unchanged.
4. Outbox content is immutable after capture.
5. Sealing order is strict per chain.
6. Evidence is either sealed, pending within SLO, or failed/alerted.
7. Provider dispatch uncertainty is represented honestly.
8. No raw prompt/output or raw sensitive match text is stored in plaintext metadata.
9. KMS/HMAC operations fail closed where policy requires strict posture.
10. Claims are tied to capability status.

## 3. Architecture flow

1. Surface builds `GovernanceContext`.
2. Kernel returns `GovernanceDecision` + `AuditIntent`.
3. Surface performs pre-capture through Audit Bridge.
4. Surface persists provider invocation in `prepared` state.
5. Surface transitions to `dispatching` immediately before the upstream call.
6. Provider call runs outside DB transaction.
7. Surface finalizes provider invocation and captures terminal outcome.
8. Sealer writes capture into HMAC chain in strict sequence.

## 4. Governance Kernel contract

The Kernel package exports `GovernanceContext`, `GovernanceDecision`, `AuditIntent`, `GovernanceKernel.apply(ctx, ports)` and `GovernanceKernel.finalize(ctx, decision, outcome)`.

Provider identity is `providerId: string`, validated by registry ports. The Kernel does not persist data and does not call providers.

## 5. DB objects

### 5.1 Roles

Do not create `govai_audit_sealer` inside a normal application migration unless the migration runner has `CREATEROLE`.

Preferred:
- create role in bootstrap/admin migration;
- grant only required execution on SECURITY DEFINER functions;
- avoid direct broad updates by `govai_app`.

### 5.2 Outbox

`govai.audit_capture_outbox` includes `capture_id`, `org_id`, `chain_id`, `chain_category`, `capture_seq`, frozen event content, encrypted payload envelope, minimized redaction metadata, `capture_integrity_tag`, `capture_integrity_alg`, status, sealed fields and attempts/error tracking.

Required constraints:
- `status != 'sealed' OR (audit_event_id IS NOT NULL AND sealed_at IS NOT NULL)`;
- `status != 'failed' OR last_error IS NOT NULL`;
- unique `(chain_id, capture_seq)`;
- unique `capture_id`.

### 5.3 Chain state

`govai.audit_capture_chain_state` tracks `chain_id`, `org_id`, `last_captured_seq` and `last_sealed_capture_seq`. Only trusted functions may advance `last_sealed_capture_seq`.

### 5.4 Capture refs

`govai.audit_event_capture_refs` maps `capture_id` to `audit_event_id` without modifying `audit_events`.

## 6. SECURITY DEFINER functions

Required functions:

1. `govai.audit_capture_insert_locked(...)`: validates tenant, allocates `capture_seq`, inserts immutable capture.
2. `govai.audit_capture_claim_for_seal(...)`: sealer-only claim of next contiguous capture.
3. `govai.audit_capture_mark_sealed(...)`: verifies sequence and capture ref, advances chain state.
4. `govai.audit_capture_mark_failed(...)`: records failure/error and emits alert metric/log without sensitive payload.
5. `govai.audit_capture_admin_reset_failed(...)`: admin-only reset with audit event.

`govai_app` must not directly mark a capture sealed or advance sealed sequence.

## 7. Provider invocation dispatch state

Extend `provider_invocations` with `dispatch_status` values:

- `prepared`
- `dispatching`
- `completed`
- `failed`
- `failed_before_dispatch`
- `unknown_after_dispatch`
- `reconciled`

Also add `idempotency_key`, `dispatched_at`, `finalized_at` and `provider_request_id` if absent.

Rules:
- T1 writes `prepared`.
- Immediately before upstream fetch, transition to `dispatching`.
- Crash in `prepared` may reconcile to `failed_before_dispatch`.
- Crash in `dispatching` may reconcile to known status or `unknown_after_dispatch`.
- Completed/failed are terminal except explicit reconciler transition.

## 8. Provider idempotency metadata

Capability registry must describe idempotency support:

```ts
interface ProviderIdempotencyCapability {
  supportsIdempotencyKey: boolean;
  headerName?: string;
  scope?: 'request' | 'operation' | 'endpoint';
  ttlSeconds?: number;
  safeToRetryAfterDispatch: boolean;
}
```

Do not assume provider/endpoint idempotency unless registry says so.

## 9. Streaming state machine

Required events:
- `stream.started`;
- `stream.completed`;
- `stream.aborted`;
- `stream.unknown_after_dispatch`.

Strict streaming: `stream.started` must be sealed or durably captured according to strict policy before first byte. Terminal evidence can only be captured after final byte, abort or unknown detection.

`provider_invocation_streams` tracks provider invocation, status, start/last chunk, byte count, incremental hash and final hash.

## 10. Metadata minimization

Plaintext JSONB may include surface, providerId, capability, policy ids, detector classes, counts, hashes, redacted previews and evidence posture.

Plaintext JSONB must not include raw prompt, raw output, raw match text, provider keys or decrypted payload. Richer event data must be encrypted.

## 11. Posture

`resolvePosture` uses risk first, tier second.

Strict if regulated tier, high-risk capability, sensitive health/court/financial/secret signal, irreversible tool/action, strict policy binding or evidence-grade capability.

Best-effort only when no escalating signal exists, tier/surface allows and durable capture succeeds.

## 12. Observability and completeness

Metrics: capture total, seal lag, outbox depth, failed captures, unknown dispatches, stream orphans, invocation without audit and audit without invocation.

Alerts: integrity mismatch P0; failed capture P0/P1; seal lag breach P1; increasing pending depth P1.

## 13. Test matrix

Required tests:
- no provider-native route logs raw event instead of bridge;
- outbox content update fails;
- chain sequence cannot skip;
- sealer idempotency;
- RLS tenant isolation;
- strict posture blocks response on capture/seal failure;
- best_effort response requires durable capture;
- crash in prepared => `failed_before_dispatch`;
- crash in dispatching => `unknown_after_dispatch`;
- streaming terminal events;
- metadata minimization;
- no raw secrets in logs.

## 14. Implementation order

DB role/bootstrap review → outbox/chain_state/capture_refs migration → SECURITY DEFINER functions → DB tests → `AuditBridge.capture` → sealer/verifier → dispatch states → provider-native rewiring → `/v1/runs` transaction split → streaming terminal events → completeness metrics/read model.
