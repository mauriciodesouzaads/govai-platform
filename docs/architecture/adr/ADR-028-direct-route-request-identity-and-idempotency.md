# ADR-028 — Direct-route request identity and AuditBridge capture idempotency

## Status

Proposed.

This ADR is a short pre-implementation decision that must be reviewed before the
AuditBridge (ADR-027) is implemented — analogous to ADR-023 preceding the B3
runner: decide the identity key first so the right primitive is not built with
the wrong key. It is **not** Accepted yet because the `X-GovAI-Idempotency-Key`
API-contract commitment (header name and opt-in semantics) is pending final
confirmation by Maurício during this ADR's review. Do not mark Accepted before
the review/merge of this PR. No code is written by this decision.

## Context

- ADR-027 decided that the four direct routes (governed-native OpenAI, governed-native
  Anthropic, passthrough OpenAI, passthrough Anthropic) must emit evidence into the
  B0/B1 capture outbox via a future **AuditBridge** dispatcher.
- Source reading at `e8aa632` shows `PassthroughInvoked.audit_event_id` is generated
  as `randomUUID()` in every current handler path — blocked, stream, and non-stream:
  `provider-openai/src/governed/handle-chat-completions.ts:185,242,305`,
  `handle-responses.ts:254,311,374`, `provider-anthropic/src/governed/handle-messages.ts:278,344,408`,
  and the passthrough emitters `provider-openai/src/passthrough/audit-emit.ts:105,131,163`,
  `provider-anthropic/src/passthrough/audit-emit.ts:99,125,157`.
- Therefore, using `captureId = audit_event_id` in the AuditBridge would today be
  equivalent to `captureId = randomUUID()`. That does **not** preserve idempotency
  across retries.
- `captureAuditEvent` (`packages/core-audit/src/capture.ts`) uses `captureId` as the
  outbox idempotency key: a second call with the same `captureId` and identical
  immutable fields returns the same `captureSeq`, while a second call with the same
  `captureId` but divergent immutable content fails safe (`capture.ts:274-275`).
- `native_request_hash` (`PassthroughInvokedSchema` v3, `passthrough-invoked.ts:107`,
  a required 64-hex `sha256` of the raw native request body) is stable for the same
  body, but it does **not** identify a unique logical request: two genuinely distinct
  executions can have byte-identical bodies.
- `provider_request_id` is optional (`passthrough-invoked.ts:123`) and may be absent
  on error/blocked paths or for transport reasons, so it cannot be a primary key.
- The v3 envelope carries no `keyId` / `keyVersion`.
- In compliance/GRC, **undercounting** by improper dedupe is worse than a
  reconciliable duplicate: collapsing two genuine events into one evidence record
  hides real AI usage.
- Dominant principle: never collapse two events into one evidence record unless the
  client or a trusted ingress explicitly declares they are the same logical request.

PR #92 (merged, main `e8aa632`) implemented ADR-023 Option A(b) and `auditAppend(eventId?)`,
but that is the **sealing** path (capture → chain). It is not the AuditBridge and does
not decide the AuditBridge capture identity.

## Decision

1. The AuditBridge `captureId` **MUST NOT** use `PassthroughInvoked.audit_event_id`
   (which is `randomUUID()` in current handlers).

2. Direct routes **MUST** create a `govai_request_id` once at route ingress:
   - UUIDv4;
   - generated exactly once per inbound request;
   - propagated through the provider handler and the AuditBridge path;
   - never regenerated internally downstream.

3. Direct routes **SHOULD** accept optional client-provided request idempotency:
   - header `X-GovAI-Idempotency-Key`;
   - normalized before hashing;
   - used only as a hash-derived identity, never stored as the raw value;
   - API contract pending final confirmation by Maurício during ADR review.

4. CaptureId derivation. Define a future fixed namespace constant
   `AUDIT_BRIDGE_CAPTURE_NAMESPACE_UUID`.

   With `X-GovAI-Idempotency-Key`:

   ```text
   captureId = UUIDv5(
     AUDIT_BRIDGE_CAPTURE_NAMESPACE_UUID,
     "org:{org_id}:provider:{provider}:capability:{capability_id}:method:{native_method}:endpoint:{native_endpoint}:idempotency:{sha256(normalized_key)}"
   )
   ```

   Without `X-GovAI-Idempotency-Key`:

   ```text
   captureId = UUIDv5(
     AUDIT_BRIDGE_CAPTURE_NAMESPACE_UUID,
     "org:{org_id}:provider:{provider}:capability:{capability_id}:method:{native_method}:endpoint:{native_endpoint}:request:{govai_request_id}"
   )
   ```

5. `native_request_hash` is **correspondence validation, not identity**:
   - same scoped idempotency key + different `native_request_hash` = evidence
     idempotency conflict;
   - the conflict must fail safe in the AuditBridge/capture path;
   - no silent new capture; no silent reuse.

6. `provider_request_id` is **enrichment, not identity**:
   - optional in the schema;
   - unavailable on blocked/error paths;
   - may be absent for provider or transport reasons.

7. `payloadHash` for `captureAuditEvent`:
   - must be `sha256(canonical_json(validated PassthroughInvoked v3 envelope))`;
   - must use the same canonicalization semantics as `core-audit`;
   - must **not** be `native_request_hash`;
   - must **not** be `native_response_hash`;
   - must **not** be `stream_final_hash`.

8. `keyId` / `keyVersion`:
   - resolved from app-owned audit key-management/KMS config;
   - not from `PassthroughInvokedSchema`, which does not carry them.

9. Failure mode:
   - default for the four direct provider-native routes is `best_effort`;
   - AuditBridge/capture failures are logged and do **not** fail the provider-native
     request;
   - this preserves native provider UX/parity;
   - failure telemetry must be auditable/logged, but must not block the request in v1.

10. `/v1/runs`:
    - remains distinct and chain-authoritative via `auditAppend`;
    - is **not** migrated to the AuditBridge/outbox in this decision.

11. B3:
    - remains out of scope;
    - not started;
    - **not** authorized by ADR-028;
    - future B3 remains blocked until its explicit runner authorization.

### What v1 does and does not guarantee

**Without `X-GovAI-Idempotency-Key`:**
- each inbound request gets a unique `govai_request_id`;
- events are distinct by default;
- this avoids suppressing real AI usage;
- retry duplicates are possible;
- duplicates are reconciliable via `govai_request_id`, identity scope,
  `native_request_hash`, provider metadata, timing, and logs;
- this does **not** provide strong cross-retry idempotency.

**With `X-GovAI-Idempotency-Key`:**
- repeated attempts with the same scoped key derive the same `captureId`;
- repeated identical evidence reuses the same outbox capture;
- repeated same key with divergent `native_request_hash` is an evidence
  idempotency conflict (fail safe);
- this provides strong evidence-capture idempotency for clients that opt in.

**Out of scope for v1:**
- guaranteed exactly-once provider-side execution;
- suppressing the second provider call under retry;
- replaying provider responses;
- storing idempotency-key request bodies for provider-call suppression;
- client-visible idempotent response replay;
- a global request-id store;
- `/v1/runs` is not migrated;
- the B3 runner.

> **Evidence idempotency is not the same as execution idempotency.** This ADR
> governs how runtime evidence is keyed into the outbox; it does not change how
> many times a provider call actually runs.

## Consequences

**Positive:**
- avoids using a random `audit_event_id` as the idempotency key;
- avoids dedupe by raw request hash;
- supports opt-in idempotent evidence capture for regulated clients;
- preserves native provider UX in v1;
- makes retry semantics explicit and auditable;
- aligns with the Option A(b) correspondence-validation doctrine (validate identity,
  fail safe on divergence).

**Tradeoffs:**
- clients need to supply `X-GovAI-Idempotency-Key` for strong cross-retry idempotency;
- without it, duplicate retry evidence can still occur;
- the future implementation must propagate `govai_request_id` end to end;
- the future implementation must add tests for: duplicate key, divergent
  `native_request_hash`, missing header, `provider_request_id` absence, and
  `best_effort` failure.

## Alternatives considered

1. **`captureId = PassthroughInvoked.audit_event_id`** — Rejected. Source shows
   handlers currently set `audit_event_id: randomUUID()`, so it does not preserve
   cross-retry idempotency; it is equivalent to a random capture id today.

2. **`captureId = native_request_hash`** — Rejected. Stable for the same raw body,
   but it collapses distinct legitimate executions that share an identical body.
   Undercounting real AI usage is worse than reconciliable duplicate evidence.

3. **`captureId = provider_request_id`** — Rejected as primary identity. Optional in
   the schema, unavailable before the provider response, missing on blocked/error
   paths, and provider-dependent.

4. **Always require `X-GovAI-Idempotency-Key`** — Deferred / not selected for v1.
   Stronger semantics but a heavier API contract that could break provider-native
   ease of adoption. The current decision allows an opt-in key while still
   generating `govai_request_id` for every request.

5. **Do nothing / use random capture ids** — Rejected. It would knowingly produce
   duplicate evidence under retry and undermine confidence in compliance reporting.

## Non-goals / out of scope

- no code;
- no route wiring;
- no dispatcher;
- no `capture.ts` change;
- no schema change;
- no tests;
- no B3 runner;
- no `apps/audit-sealer`;
- no `/v1/runs` migration;
- no provider execution idempotency.
