# ADR-027 — Runtime-to-evidence dispatch / AuditBridge

Status: Accepted as design constraint — not implemented, not tested, does not authorize B3.

> Superseded-in-part by ADR-028 (Accepted): the "Mapping contract" and
> "Payload hash semantics" sections below are historical; identity and
> payload-hash are governed by ADR-028. Ratified by Maurício on 2026-06-12:
> "ADR-028 supersedes ADR-027 §Mapping contract and §Payload hash semantics."

## Context

In `main` at `da08952935519aec1c94f11e914c86c102f0002f`:

- direct governed-native OpenAI and Anthropic routes emit provider runtime audit events through `emitAuditEvent(event: unknown)`, but the closure currently writes to `app.log.info` only (`apps/api/src/routes/governed-openai.ts:69-70`, `governed-anthropic.ts:71-72`);
- direct passthrough OpenAI and Anthropic routes have the same logger-only `emitAuditEvent(event: unknown)` pattern (`passthrough-openai.ts:79-83`, `passthrough-anthropic.ts:83`);
- the existing passthrough route comments anticipated later audit absorption by the "Governed Run pipeline (PR3+)" (`passthrough-openai.ts:80-81`: "Wiring into audit chain (`run` chain) happens once Governed Run pipeline absorbs passthrough audit (PR3+)");
- `captureAuditEvent` exists as a B1 primitive (`packages/core-audit/src/capture.ts`) and writes to the B0 capture outbox, but there are **zero `captureAuditEvent` call-sites in `apps/`**;
- `/v1/runs` is distinct: it writes run lifecycle and handler-emitted v3 evidence directly to the HMAC chain through `auditAppend` (`apps/api/src/pipeline/run-orchestrator.ts`), not through the capture outbox;
- B3 seals captures already in the outbox and cannot prove runtime evidence completeness if runtime does not feed the outbox.

## Decision

Adopt **Option A**: direct governed-native and passthrough route-level runtime audit events must be dispatched into the B0/B1 capture outbox through a shared **AuditBridge** dispatcher.

The future wire points are:
- `apps/api/src/routes/governed-openai.ts`
- `apps/api/src/routes/governed-anthropic.ts`
- `apps/api/src/routes/passthrough-openai.ts`
- `apps/api/src/routes/passthrough-anthropic.ts`

The future shared dispatcher should live under one of:
- `apps/api/src/pipeline/audit-bridge.ts`
- `apps/api/src/pipeline/runtime-audit-dispatch.ts`

**No helper is created in this PR.**

AuditBridge must validate/narrow `event: unknown` through `PassthroughInvokedSchema` before mapping. Mapping only occurs after validation succeeds.

ADR-027 supersedes the older passthrough-route intent to absorb audit through the Governed Run pipeline. Direct routes should wire directly to AuditBridge → capture outbox; `/v1/runs` remains separate.

## Authoritative path

```
provider handler emits `PassthroughInvoked v3`
→ route-level `emitAuditEvent`
→ shared AuditBridge dispatcher
→ validate/narrow with `PassthroughInvokedSchema`
→ `captureAuditEvent`
→ `govai.audit_capture_outbox`
→ future B3 sealer
→ audit chain
```

## Current state (source-verified)

- `governed-openai.ts:69-70` / `governed-anthropic.ts:71-72`: `emitAuditEvent(event: unknown)` → `app.log.info(..., 'governed-native audit event')` (logger-only).
- `passthrough-openai.ts:79-83` / `passthrough-anthropic.ts:83`: `emitAuditEvent(event: unknown)` → `app.log.info(..., 'passthrough audit event')` (logger-only).
- Zero `captureAuditEvent` call-sites in `apps/`.
- B0 (capture outbox), B1 (`captureAuditEvent`), and B2 (sealer library) exist as foundation primitives, but **runtime routes do not feed the outbox today**.

## Runtime event validation

The route-level `emitAuditEvent` closures currently receive `event: unknown`. AuditBridge must **not** treat that value as a trusted `PassthroughInvoked v3`.

Before mapping into `CaptureAuditEventInput`, the future dispatcher must validate/narrow the event through the canonical `PassthroughInvokedSchema` from `packages/core-events/src/passthrough-invoked.ts` (or an equivalent wrapper around that schema, e.g. `PassthroughInvokedSchema.parse(event)` or a safe-parse wrapper).

Invalid events must not be inserted into `govai.audit_capture_outbox`. The implementation PR must define and test whether validation failure is handled as `best_effort` telemetry failure or `strict` request failure for each route/mode.

This ADR documents the validation contract only; **it does not implement validation**.

## Superseded prior intent

The existing passthrough route comments anticipated that passthrough audit would be absorbed later by the "Governed Run pipeline (PR3+)". ADR-027 supersedes that intent for direct provider route surfaces.

For direct governed-native and passthrough routes, the future authoritative evidence ingress is a route-level AuditBridge dispatcher into the B0/B1 capture outbox. `/v1/runs` remains a distinct chain-authoritative path through `auditAppend` and is not migrated by this ADR.

This avoids treating `/v1/runs` as the required intermediary for direct-route evidence capture and prevents B3 from sealing an outbox that the direct runtime surfaces still do not feed. The ADR does not claim the older "Governed Run pipeline (PR3+)" absorption was ever implemented; it replaces that intended direction for direct routes.

## `/v1/runs` relationship

`/v1/runs` remains chain-authoritative for now. It writes run lifecycle and handler-emitted v3 evidence through `auditAppend` (`run-orchestrator.ts`), not through the capture outbox:

- in governed-run, the handler-emitted `passthrough.invoked v3` is captured via `auditAppend`, not via the capture outbox;
- passthrough-run also writes `run.completed` / `run.failed` via `auditAppend`.

This ADR does **not** migrate `/v1/runs` into the outbox and does **not** claim B3 covers `/v1/runs`. `/v1/runs` does not count as capture-outbox coverage. A future `/v1/runs → outbox` unification requires a separate decision/PR.

## Mapping contract

**SUPERSEDED by ADR-028 — retained for history. Do not implement.**

Input to the dispatcher is `unknown`. The first step is validation/narrowing as `PassthroughInvoked v3` through `PassthroughInvokedSchema` (or an equivalent wrapper around the canonical schema). Mapping only occurs after validation succeeds. This is a **future contract, not an implementation**:

```
input            = unknown route-level emitAuditEvent payload
validatedEvent   = PassthroughInvokedSchema.parse(input) or equivalent
captureId        = validatedEvent.audit_event_id
orgId            = validatedEvent.tenant_context.org_id
chainId          = chainIdFor(orgId, 'run')
chainCategory    = 'run'
eventType        = 'passthrough.invoked'
eventVersion     = '3'
subjectType      = 'runtime_event'
subjectId        = validatedEvent.audit_event_id
occurredAt       = dispatch time, unless a future v3 timestamp is standardized
payloadHash      = sha256(canonical_json(validatedEvent))
keyId            = from app audit key-management/KMS config, not from event
keyVersion       = from app audit key-management/KMS config, not from event
payloadEncrypted = null unless future encrypted payload storage is explicitly authorized
dekWrapped       = null unless future encrypted payload storage is explicitly authorized
redactionMetadata= non-raw summary/correlation metadata only
posture          = documented implementation choice; default likely best_effort unless strict failure semantics are explicitly accepted
```

(Field availability is source-verified against `PassthroughInvokedSchema`: `audit_event_id` and `chain_category:'run'` exist on the v3 envelope; `tenant_context.org_id` exists; `native_request_hash`/`native_response_hash` exist; the schema has **no** `keyId`/`keyVersion`.)

## Key provenance

`CaptureAuditEventInput` requires:
- `keyId: string`
- `keyVersion: number`

These fields do **not** exist in `PassthroughInvoked v3`. Therefore:

- `keyId` and `keyVersion` come from the app's audit key-management / KMS / configuration subsystem;
- they do **not** come from the runtime event;
- they are **not** derived from the provider payload;
- they are **not** invented by the mapper;
- the authority is the same operational domain used by the `auditAppend` paths that receive KMS in the app/orchestrator;
- the exact API to obtain these values is a future implementation detail and must be defined before implementing.

## Payload hash semantics

**SUPERSEDED by ADR-028 — retained for history. Do not implement.**

- the capture outbox `payloadHash` is `sha256(canonical_json(validated PassthroughInvoked v3 event envelope))`;
- it is **not** merely `native_request_hash`;
- it is **not** merely `native_response_hash`;
- `native_request_hash` and `native_response_hash` remain the evidence of the provider-native bytes **inside** the v3 event;
- because those hashes are part of the canonical envelope, the capture `payloadHash` commits to both the provider-native hashes and the governed context: tenant, provider, capability, risk/enforcement decision, status, tool classifications, usage, `audit_event_id`, and `chain_category`;
- if a future implementation cannot guarantee stable canonicalization, it must stop and record a blocker; it must **not** silently substitute isolated native hashes.

## B1 boundaries

The future AuditBridge must preserve the preconditions of `captureAuditEvent` (`capture.ts`):
- caller-owned `PoolClient`;
- caller-owned transaction (client already inside a `BEGIN`);
- `app.org_id` set in the session (via `setLocalAppOrgId`);
- the caller performs `COMMIT` / `ROLLBACK`;
- `captureAuditEvent` does not open `BEGIN`/`COMMIT`/`ROLLBACK`;
- `captureAuditEvent` does not set tenant;
- `captureAuditEvent` does not acquire a global pool;
- raw prompt/response content must not enter `redactionMetadata`.

## Failure semantics

As a minimal architectural decision:
- Phase 2.5 must define, **before implementation**, whether a capture failure is `strict` or `best_effort` per route/mode.
- This ADR does not assert any implementation.
- Recommendation: default `best_effort` for the direct routes, so capture failure does not break byte fidelity / provider UX while health/metrics/reporting are not yet defined.
- `strict` may later be required for regulated / evidence-grade traffic, by explicit decision.
- Any final `strict`/`best_effort` choice must be tested in the implementation PR.
- This must not be used to claim product completeness.

## Consequences

- B3 remains blocked for product-completeness until Phase 2.5 is implemented/tested, or an explicit accepted deferral names another authoritative evidence path.
- B3 sealing an empty or incomplete outbox is false confidence.
- This ADR does not authorize implementation.
- This ADR does not authorize B3.
- This ADR does not claim evidence completeness.
- This ADR does not implement runtime validation.
- This ADR does not rewire routes.

## Non-goals

- no code;
- no tests;
- no migrations;
- no `apps/audit-sealer`;
- no B3 implementation;
- no B3 authorization;
- no live provider execution;
- no route rewiring;
- no runtime validation implementation;
- no evidence-completeness claim.
