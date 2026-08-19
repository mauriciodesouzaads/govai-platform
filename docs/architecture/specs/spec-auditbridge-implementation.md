> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** IMPLEMENTATION_RECORD
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; spec drafted 2026-06 at main post-e8aa632)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision PR-0 27-tree disposition (NOT_REQUIRED — implementation fact, source-verified))
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header, incl. the PR-0 header)
> **SOURCE_SHA256:** `5a504e5f4bbac667eb6bca46eca6902b432ba9339eb0e865e1ee12747ce24e4f` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** IMPLEMENTATION RECORD (implemented; retained as the reference contract of the AuditBridge). The body's own `Status: PROPOSED_IMPLEMENTATION_SPEC` and "logger-only today" baseline describe the pre-implementation state at `main` post-`e8aa632` and are HISTORICAL — the AuditBridge is implemented and wired on the four direct provider routes (PR-B / EP-004: `apps/api/src/pipeline/audit-bridge.ts`, `pipeline/request-identity-hook.ts`, `packages/core-events/src/audit-bridge-capture-payload.ts`), integration-tested (`tests/integration/audit-bridge-wiring.test.ts`, `audit-bridge-idempotency.test.ts`), and the B3 sealer (EP-006, `apps/audit-sealer`) consumes the outbox. Where the merged implementation differs from this spec (e.g. event schema v4 rather than v3; ALS-based identity propagation; F4 `run()` scoping; EP-008C `stream_outcome`), the merged source and ADR-027/ADR-028 prevail; `/v1/runs` remains chain-authoritative (not migrated to the outbox).
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** IMPLEMENTADA — o bridge está wired nas 4 rotas diretas e o sealer B3 existe (apps/audit-sealer/); manter como spec de referência do contrato
> **BASE DECLARADA PELO DOCUMENTO:** main pós-e8aa632 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Evidência: apps/api/src/pipeline/audit-bridge.ts consumido pelas rotas governed/passthrough; ADR-027/028 satisfeitos.
> **ORIGEM:** handoff 01-spec-auditbridge-implementation.md
> ---

# SPEC — AuditBridge implementation (Phase 2.5)

Status: `PROPOSED_IMPLEMENTATION_SPEC` — implements ADR-027 (Option A) and
ADR-028. This spec authorizes nothing by itself; it defines the two PRs that,
once merged with the tests below, satisfy the roadmap Phase 2.5 exit criteria.
It does NOT authorize B3 (separate authorization, roadmap Phase 3 precondition
3) and does NOT migrate `/v1/runs` (ADR-027 §"/v1/runs relationship").

Source baseline (verified): `main` post-`e8aa632`.
- Wire points (logger-only today): `apps/api/src/routes/governed-openai.ts:69-70`,
  `governed-anthropic.ts:71-72`, `passthrough-openai.ts:79-83`,
  `passthrough-anthropic.ts:83`.
- B1 primitive: `packages/core-audit/src/capture.ts` (`captureAuditEvent`,
  `CaptureAuditEventInput`, banned redaction keys, caller-owned txn contract).
- B0 outbox: migration `0025_audit_capture_outbox_foundation.sql`
  (`govai.audit_capture_outbox`, `govai.audit_capture_insert_locked`).
- Event schema: `packages/core-events/src/passthrough-invoked.ts`
  (`PassthroughInvokedSchema`, v3).
- Chain id derivation: `chainIdFor(orgId, category)` from `@govai/core-events`
  (= `"${orgId}:${category}"`, per `sealer.ts:343` comment).

## 1. Deliverables

### D1 — Ingress identity plugin (ADR-028 §2–§3)

New file `apps/api/src/pipeline/request-identity.ts`, registered as a Fastify
`onRequest` hook for the four direct provider route prefixes only
(`/governed/openai`, `/governed/anthropic`, `/passthrough/openai`,
`/passthrough/anthropic` — match the actual registered prefixes at wiring
time; do not apply globally in v1).

Behavior:
- Generate `govai_request_id = randomUUID()` exactly once per inbound request;
  attach to `req.govai = { requestId, identityScope, idempotencyKeyHash? }`.
- If header `X-GovAI-Idempotency-Key` is present:
  - normalize: trim; reject if empty after trim, length > 256, or contains
    control characters (reply `400` with a machine-readable error code
    `invalid_idempotency_key` — this is the only strict behavior in v1 and is
    a client-contract error, not an evidence failure);
  - `idempotencyKeyHash = sha256(normalizedKey)` lowercase hex; the raw value
    is never stored, never logged (ADR-028 §3);
  - `identityScope = 'client_idempotency_key'`.
- Else `identityScope = 'govai_request_id'`.
- Echo `X-GovAI-Request-Id: <govai_request_id>` on the response (operational
  reconciliation aid; cheap; documented).

### D2 — Dispatcher module

New file `apps/api/src/pipeline/audit-bridge.ts` (ADR-027 names this path as
one of the two allowed locations). Public surface:

```ts
export const AUDIT_BRIDGE_CAPTURE_NAMESPACE_UUID = '<PINNED-UUIDv4>';
// Generate once at implementation time, pin in code, record in the ADR-028
// appendix and in this spec's changelog. Never rotate without a new ADR.

export interface AuditBridgeDeps {
  pool: Pool;                       // app.govai.pool
  resolveCaptureKey: (orgId: string) =>
    Promise<{ keyId: string; keyVersion: number }>;
  log: FastifyBaseLogger;
  posture?: 'best_effort' | 'strict'; // v1 default 'best_effort' (ADR-028 §9)
}

export interface AuditBridgeRequestIdentity {
  govaiRequestId: string;
  identityScope: 'govai_request_id' | 'client_idempotency_key';
  idempotencyKeyHash?: string;      // 64-hex, present iff scope = client key
}

export function makeAuditBridge(deps: AuditBridgeDeps):
  (event: unknown, identity: AuditBridgeRequestIdentity) => Promise<void>;
```

Dispatch algorithm (one function, no branching across routes):
1. `const parsed = PassthroughInvokedSchema.safeParse(event)`. On failure:
   log `warn` with `{ govai_request_id, reason: 'invalid_runtime_event' }`,
   increment failure counter (log-based until ADR-025), **do not insert**
   (ADR-027 §"Runtime event validation"), return. Never throw.
2. Build `AuditBridgeCapturePayloadV1` (D3) from `parsed.data`.
3. `payloadHash = sha256(canonicalJson(payload))` using `canonicalJson` from
   `@govai/core-audit` — the same canonicalization semantics as the chain
   (ADR-028 §7 "same canonicalization semantics as core-audit"). If
   canonicalization throws, log + return (recorded blocker semantics; never
   substitute native hashes — ADR-027 §"Payload hash semantics").
4. Derive `captureId` per ADR-028 §4, verbatim:
   - scope `client_idempotency_key`:
     `UUIDv5(NS, "org:{org_id}:provider:{provider}:capability:{capability_id}:method:{native_method}:endpoint:{native_endpoint}:idempotency:{idempotencyKeyHash}")`
   - scope `govai_request_id`:
     `UUIDv5(NS, "org:{org_id}:provider:{provider}:capability:{capability_id}:method:{native_method}:endpoint:{native_endpoint}:request:{govaiRequestId}")`
   Implementation note: UUIDv5 via `crypto` (RFC 4122 §4.3) or the `uuid`
   package's `v5` — pick one, test against fixed vectors (Appendix B).
5. Resolve `{ keyId, keyVersion } = await resolveCaptureKey(org_id)`.
   `resolveCaptureKey` MUST be a thin wrapper over the exact key-resolution
   helper already used by the `auditAppend` call-sites in
   `apps/api/src/pipeline/run-orchestrator.ts` (same KMS purpose, per-org,
   app-owned). Introducing a second derivation is forbidden (ADR-027 §"Key
   provenance"). If today's helper is inline in the orchestrator, extract it
   to `apps/api/src/pipeline/audit-keys.ts` and have both call-sites use it —
   that extraction is in-scope for PR-A and must be covered by the existing
   orchestrator integration tests staying green.
6. Acquire client; run the B1 envelope exactly per `capture.ts` contract:
   ```
   client = await pool.connect()
   try {
     await client.query('BEGIN')
     await setLocalAppOrgId(client, org_id)        // @govai/core-tenant
     await captureAuditEvent(client, input)        // see §D4 field map
     await client.query('COMMIT')
   } catch (e) { await client.query('ROLLBACK'); throw e }
   finally { client.release() }
   ```
7. Error handling (posture `best_effort`, ADR-028 §9): catch everything from
   steps 5–6; classify:
   - `evidence_idempotency_conflict` (B1 fail-safe on same `captureId` +
     divergent immutable fields): log at `error` level with
     `{ capture_id, org_id, identity_scope }` — this is a reportable
     integrity signal, not noise;
   - other failures: log `warn` `{ reason: 'capture_failed' }`.
   In both cases return normally. The provider request path is never failed
   by the bridge in v1 (preserves byte fidelity / provider UX; ADR-027
   recommendation; ADR-028 §9). `strict` posture is plumbed but not enabled
   for any route in v1; enabling it later is a config + test change, not a
   code change.
8. The dispatcher is `await`ed inside the route-level `emitAuditEvent`
   closure (handlers already `await deps.emitAuditEvent(ev)`); cost is one
   short transaction. No fire-and-forget in v1 — silent task loss is worse
   than ~1–3 ms. If p95 route latency regresses beyond the harness budget,
   revisit with an explicit ADR (do not quietly detach).

### D3 — `AuditBridgeCapturePayloadV1` (closes the ADR-028 §7 open item)

New file `packages/core-events/src/audit-bridge-capture-payload.ts` exporting
a Zod schema + a pure projector
`projectCapturePayloadV1(e: PassthroughInvoked): AuditBridgeCapturePayloadV1`.

**Included (semantic evidence — closed list, v1):**
`schema: 'audit_bridge_capture_payload'`, `schema_version: 1`,
`event_type` (`'passthrough.invoked'`), `event_schema_version` (3),
`chain_category` (`'run'`), `provider`, `capability_id`, `capability_level`,
`capability_canonical_level`, `native_endpoint`, `native_method`,
`is_stream`, `is_multipart`, `base_risk_class`, `effective_risk_class`,
`risk_escalation_reasons`, `enforcement_decision`, `native_request_hash`,
`native_response_hash?`, `stream_final_hash?`, `status_code`,
`credential_source`, `allowlist_version`, `body_forward_mode`,
`dlp_decisions`, `beta_allowlist_sources`, `detected_tool_classifications`,
`tools_taxonomy_version?`, `purpose_deprecated?`, `usage?`,
`tenant: { org_id, tier, operational_mode, user_id? }`.

Rationale for `usage`: if a retry truly re-executed upstream, the native
response hash already diverges (conflict, fail safe); if it did not, usage is
identical. Including it keeps token accounting inside the immutable evidence.

**Excluded (per-attempt, ADR-028 §7 — verbatim):** `audit_event_id`,
`latency_ms`, `provider_request_id`, and the raw `govai_request_id` when
`identity_scope = 'client_idempotency_key'`.

**Traceability:** excluded fields go to `redactionMetadata.audit_bridge`
(outside the immutable hash): `{ govai_request_id?, identity_scope,
idempotency_key_hash?, provider_request_id?, latency_ms, audit_event_id }`.
`govai_request_id` is included here in both scopes except that, under
`client_idempotency_key`, ADR-028 excludes it from the *projection*; keeping
it in redaction metadata is allowed (non-normative example list in ADR-028
already shows it) and required for duplicate reconciliation. None of the
banned top-level keys (`prompt`, `response`, `raw_input`, `raw_output`,
`messages`, `completion`, `requestBody`, `responseBody`) may ever appear —
B1 enforces SQL+TS guards; the projector must not need them.

**Stability law (tested):** two envelopes that differ only in excluded fields
MUST produce byte-identical canonical projections; any difference in an
included field MUST change `payloadHash`.

### D4 — `CaptureAuditEventInput` field map

| Field | Value |
|---|---|
| `captureId` | D2 step 4 |
| `orgId` | `parsed.data.tenant_context.org_id` |
| `chainId` | `chainIdFor(orgId, 'run')` |
| `chainCategory` | `'run'` |
| `eventType` | `'passthrough.invoked'` |
| `eventVersion` | `'3'` |
| `subjectType` | `'runtime_event'` |
| `subjectId` | `parsed.data.audit_event_id` (subject linkage only; NOT identity — ADR-028 §1) |
| `occurredAt` | dispatch time (`new Date()`) — ADR-027 mapping contract |
| `payloadHash` | D2 step 3 (32-byte Buffer) |
| `payloadEncrypted` / `dekWrapped` | `null` (not authorized; ADR-027) |
| `keyId` / `keyVersion` | D2 step 5 |
| `redactionMetadata` | `{ audit_bridge: {...} }` per D3 |
| `evidenceStrength` | `'hmac_internal'` (same vocabulary as chain default; confirm against the existing enum at implementation; if outbox default differs, follow B0) |
| `captureIntegrityTag/Alg` | `null` in v1 (sealer-side integrity comes with B3) |
| `posture` | `'best_effort'` |

### D5 — Wiring the four routes

Replace the four logger-only closures with:

```ts
const auditBridge = makeAuditBridge({ pool: app.govai.pool, resolveCaptureKey, log: app.log });
const emitAuditEvent = async (event: unknown): Promise<void> => {
  app.log.info({ audit_event: event }, '<route> audit event'); // keep the log line
  await auditBridge(event, requestIdentityFrom(req));          // new
};
```

Note on plumbing: the closures are currently built per-route at registration
time, while identity is per-request. The concrete mechanism (closure built in
a per-request scope, or identity read from request-local context/ALS) is the
implementer's choice; the contract is: the identity attached by D1 for *this*
request reaches the dispatcher unmodified, never regenerated (ADR-028 §2).
Passthrough emitters (`provider-*/src/passthrough/audit-emit.ts`) and governed
handlers already construct the v3 envelope — no provider-package changes.

## 2. Config

`GOVAI_AUDIT_BRIDGE_ENABLED` (default `true`; boot log states the value).
Disabling restores logger-only behavior — operational kill switch only; the
flag must not be used to claim partial completeness.

## 3. Test plan

Unit (`packages/core-events`, `apps/api`):
- U1 projector stability law (property-style: mutate excluded fields → same
  canonical bytes; mutate each included field → different hash).
- U2 captureId vectors: fixed namespace + fixed inputs → expected UUIDv5
  (both scopes); normalization cases (trim, length, control chars → reject).
- U3 invalid envelope → no DB call (mock), `warn` logged, no throw.
- U4 key resolver: bridge uses the shared helper (spy), never derives.

Integration (Testcontainers, `tests/integration/audit-bridge-*.test.ts`):
- I1 governed-native OpenAI happy path → exactly one outbox row; field
  assertions on `chain_id`, `payload_hash`, `redaction_metadata.audit_bridge`.
- I2 same for governed Anthropic and both passthrough routes (matrix can be
  parameterized; ADR-027 exit criteria require at least one OpenAI and one
  Anthropic governed path with test evidence).
- I3 retry with same `X-GovAI-Idempotency-Key` + identical semantic evidence
  → one row, same `capture_seq` returned (B1 idempotent reuse).
- I4 same key + divergent `native_request_hash` → conflict logged at `error`;
  request still succeeds (best_effort); no second row.
- I5 no header → two requests = two rows (no dedupe; ADR-028 "without key").
- I6 DB unavailable during dispatch → request still succeeds; `warn` logged.
- I7 RLS: outbox row invisible under another org's `app.org_id`.
- I8 banned redaction keys can never appear (guard test on projector output).
- I9 H1 v2 byte-fidelity harness green (non-regression gate; ADR-027
  non-goal "no provider-native parity regression").

## 4. PR sequencing

- **PR-A**: D1 + D2 + D3 + key-helper extraction + unit tests. No route
  behavior change (bridge exported, unused).
- **PR-B**: D5 wiring + integration tests + `current-state.md` §3 update +
  roadmap Phase 2.5 status update.
- After merge: request B3 authorization (separate decision, per roadmap).

## 5. Exit criteria (mirrors roadmap Phase 2.5)

At least one governed OpenAI and one governed Anthropic direct runtime path
have **test evidence** that emitted audit events are validated/narrowed and
captured into the outbox; failure semantics documented and tested
(`best_effort`); no provider-native parity regression; docs updated.

## 6. Non-goals

No B3 runner; no `/v1/runs` migration; no encrypted capture payloads; no
strict posture enablement; no provider execution idempotency; no metrics
stack (counters are structured logs until ADR-025).

## Appendix A — Failure taxonomy (log `reason` values)
`invalid_runtime_event` | `canonicalization_failed` | `key_resolution_failed`
| `evidence_idempotency_conflict` | `capture_failed`.

## Appendix B — To pin at implementation time
`AUDIT_BRIDGE_CAPTURE_NAMESPACE_UUID` literal; UUIDv5 test vectors (3 fixed
tuples per scope); the confirmed `evidenceStrength` default for outbox rows.
