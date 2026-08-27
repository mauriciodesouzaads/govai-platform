// AuditBridge dispatcher (SPEC-01 §6; ADR-027 topology + ADR-028 identity &
// payload-hash). Maps a validated `PassthroughInvoked v4` runtime event into the
// B0/B1 capture outbox via `captureAuditEvent`. The factory and the pure
// captureId helper are exported here and wired into all four direct-provider
// route closures (PR-B / EP-004), each awaiting the dispatcher per request.

import type { Pool, PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

import { sha256, canonicalize, captureAuditEvent } from '@govai/core-audit';
import type { CaptureAuditEventInput } from '@govai/core-audit';
import { chainIdFor, PassthroughInvokedSchema, projectCapturePayloadV1, uuidv5 } from '@govai/core-events';
import type { PassthroughInvoked } from '@govai/core-events';
import { setLocalAppOrgId } from '@govai/core-tenant';

import { AUDIT_CHAIN_KEY } from './audit-keys.js';
import { createOtelAuditBridgeMetrics } from './audit-bridge-metrics.js';
import type { AuditBridgeMetrics } from './audit-bridge-metrics.js';
import { requestIdentityAls } from './request-identity.js';
import type { AuditBridgeRequestIdentity } from './request-identity.js';

// Pinned ONCE at implementation (uuidgen) and never rotated without a new ADR
// (SPEC-01 §5/§6 namespace-first rule). The six U2 captureId vectors in
// `audit-bridge.test.ts` are precomputed against THIS literal by an independent
// reference; changing it must regenerate them.
export const AUDIT_BRIDGE_CAPTURE_NAMESPACE_UUID = '2ce65cb8-4e28-42e2-b7cd-0be36d6e6f7b';

export type AuditBridgeFailureReason =
  | 'missing_request_identity'
  | 'invalid_runtime_event'
  | 'canonicalization_failed'
  | 'key_resolution_failed'
  | 'evidence_idempotency_conflict'
  | 'capture_failed';

export interface AuditBridgeDeps {
  pool: Pool;
  log: FastifyBaseLogger;
  /**
   * OPTIONAL checkout override. When present it replaces `pool.connect()`/`release()` entirely,
   * and the dispatcher runs its BEGIN → set_config → capture → COMMIT envelope on the client this
   * hands it.
   *
   * ★ WHY IT EXISTS (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C). The detached conversation worker's
   * connections must pass a LIVE database-identity attestation and must carry a per-checkout
   * `error` listener — without the listener an asynchronous backend disconnect while the client
   * is checked out is an unhandled `'error'` that kills the process, and without the attestation
   * a misconfigured elevated credential reaches the operation unchecked. Handing this dispatcher
   * a raw pool created a SECOND checkout path that had neither, silently bypassing both for
   * evidence capture specifically. Direct routes omit this and keep using `deps.pool` unchanged.
   */
  withClient?: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
  /** `strict` is plumbed but NEVER enabled in v1 (ADR-028 §9). */
  posture?: 'best_effort' | 'strict';
  /**
   * Cardinality-safe OTel drop/capture counters (EP-008B / EC-3b). Optional;
   * defaults to the OTel-backed impl. Observe-only: the calls are non-throwing
   * (swallowed) and never affect the request path. Tests inject the recording
   * double. No-op until the API MeterProvider is wired (EP-008B-FOLLOWUP).
   */
  metrics?: AuditBridgeMetrics;
}

/** Fields read from the validated envelope to scope the captureId (ADR-028 §4). */
interface CaptureScopeFields {
  orgId: string;
  provider: string;
  capabilityId: string;
  nativeMethod: string;
  nativeEndpoint: string;
}

/**
 * Derive the AuditBridge `captureId` per ADR-028 §4. The captureId is
 * `uuidv5(NAMESPACE, scopedName)`; the scoped name is built from immutable
 * request coordinates plus either the client idempotency-key hash or the
 * per-request `govai_request_id`. Pure and exported so the U2 vectors can be
 * checked against an independent reference without invoking the dispatcher.
 */
export function auditBridgeCaptureId(
  identity: AuditBridgeRequestIdentity,
  fields: CaptureScopeFields,
): string {
  const prefix =
    `org:${fields.orgId}` +
    `:provider:${fields.provider}` +
    `:capability:${fields.capabilityId}` +
    `:method:${fields.nativeMethod}` +
    `:endpoint:${fields.nativeEndpoint}`;
  const name =
    identity.identityScope === 'client_idempotency_key'
      ? `${prefix}:idempotency:${identity.idempotencyKeyHash}`
      : `${prefix}:request:${identity.govaiRequestId}`;
  return uuidv5(AUDIT_BRIDGE_CAPTURE_NAMESPACE_UUID, name);
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function classifyCaptureError(err: unknown): 'evidence_idempotency_conflict' | 'capture_failed' {
  // B1 fails safe on divergent immutable content for an existing captureId with
  // SQLSTATE 23505 (unique_violation) — a reportable integrity signal, not a
  // benign capture failure (capture.ts:273-276; migration 0025:657-658).
  if (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  ) {
    return 'evidence_idempotency_conflict';
  }
  return 'capture_failed';
}

/**
 * Build the AuditBridge dispatcher. The returned function is AWAITED by the
 * caller (no fire-and-forget): the cost is ~ms and silent evidence loss is worse
 * than a little latency. In v1 it is best_effort and never throws on the request
 * path (ADR-028 §9); `strict` is plumbed into the capture row but not enabled.
 */
export function makeAuditBridge(
  deps: AuditBridgeDeps,
): (event: unknown, identity?: AuditBridgeRequestIdentity) => Promise<void> {
  const posture: 'best_effort' | 'strict' = deps.posture ?? 'best_effort';
  // EP-008B: cardinality-safe drop/capture counters. Resolved once per factory
  // call; observe-only and non-throwing (see audit-bridge-metrics.ts).
  const metrics = deps.metrics ?? createOtelAuditBridgeMetrics();
  // Observe-only must be STRUCTURAL: no injected metrics impl may throw into the
  // request/capture path. (A throw from captureTotal at Step 7b would otherwise be
  // caught by the Step-7 catch and misclassify a committed capture as capture_failed,
  // or rethrow under strict.) The impl's internal .add() swallow remains defense-in-depth.
  const safeMetric = (f: () => void): void => {
    try {
      f();
    } catch {
      /* observe-only: metrics never perturb the request/capture path */
    }
  };

  return async (event: unknown, identityArg?: AuditBridgeRequestIdentity): Promise<void> => {
    // 1. Resolve request identity (arg overrides ALS store).
    const identity = identityArg ?? requestIdentityAls.getStore();
    if (!identity) {
      deps.log.error({ reason: 'missing_request_identity' }, 'audit-bridge: no request identity');
      // S1: no identity/event parsed yet → reason-only (cardinality-safe).
      safeMetric(() => metrics.dropTotal({ reason: 'missing_request_identity' }));
      return;
    }

    // 2. Validate / narrow the runtime event. An invalid event is never inserted.
    const parsed = PassthroughInvokedSchema.safeParse(event);
    if (!parsed.success) {
      deps.log.warn(
        { reason: 'invalid_runtime_event', govai_request_id: identity.govaiRequestId },
        'audit-bridge: invalid runtime event',
      );
      // S2: event failed to parse → reason-only (govai_request_id is high-
      // cardinality; it stays in the log, never as a label).
      safeMetric(() => metrics.dropTotal({ reason: 'invalid_runtime_event' }));
      return;
    }
    const e: PassthroughInvoked = parsed.data;

    // 3. Project + hash. payloadHash = sha256(canonicalize(projection)).
    let payloadHash: Buffer;
    try {
      const payload = projectCapturePayloadV1(e);
      payloadHash = Buffer.from(sha256(Buffer.from(canonicalize(payload), 'utf8')));
    } catch (err) {
      deps.log.error(
        { reason: 'canonicalization_failed', govai_request_id: identity.govaiRequestId, err: errMessage(err) },
        'audit-bridge: canonicalization failed',
      );
      // S3: `e` is in scope (assigned at the end of Step 2); the local `orgId` is
      // NOT yet declared here, so read the org via `e.tenant_context.org_id`.
      safeMetric(() =>
        metrics.dropTotal({
          reason: 'canonicalization_failed',
          provider: e.provider,
          capability_level: e.capability_level,
          org_id: e.tenant_context.org_id,
        }),
      );
      return;
    }

    const orgId = e.tenant_context.org_id;

    // 4. captureId (ADR-028 §4). 5. Keys from the single source of truth (§3).
    const captureId = auditBridgeCaptureId(identity, {
      orgId,
      provider: e.provider,
      capabilityId: e.capability_id,
      nativeMethod: e.native_method,
      nativeEndpoint: e.native_endpoint,
    });
    const { keyId, keyVersion } = AUDIT_CHAIN_KEY;

    // 6. B1 envelope — exactly the capture.ts contract. The capture row carries
    // ONLY retry-stable content, so every one of the 17 SQL-equality columns is
    // byte-identical across a faithful idempotent replay and
    // `audit_capture_insert_locked` REUSES the existing capture instead of
    // raising 23505 (ADR-028; EP-003 P1 fix). redaction_metadata is validated and
    // stored but EXCLUDED from the idempotency divergence check since the
    // EP-008-PRE-EQ content-anchor amendment (migration 0026), so a cross-deploy
    // change to its shape no longer raises 23505. Per-attempt data is emitted as a
    // structured log AFTER the commit, never on the row.
    const input: CaptureAuditEventInput = {
      captureId,
      orgId,
      chainId: chainIdFor(orgId, 'run'),
      chainCategory: 'run',
      eventType: 'passthrough.invoked',
      eventVersion: '4',
      subjectType: 'runtime_event',
      // linkage to the deterministic capture identity; stable across idempotent
      // replays (was per-attempt audit_event_id — the P1, column #7).
      subjectId: captureId,
      // origin-stable event-time read from the v4 envelope; identical across a
      // faithful replay by the producer's injectable clock (column #8, ADR-028).
      occurredAt: new Date(e.occurred_at),
      payloadHash,
      payloadEncrypted: null,
      dekWrapped: null,
      keyId,
      keyVersion,
      redactionMetadata: {
        audit_bridge: {
          identity_scope: identity.identityScope,
          ...(identity.idempotencyKeyHash
            ? { idempotency_key_hash: identity.idempotencyKeyHash }
            : {}),
          provider: e.provider,
          capability_id: e.capability_id,
        },
      },
      captureIntegrityTag: null,
      captureIntegrityAlg: null,
      posture,
    };

    // 7. B1 transaction envelope (caller-owned): connect -> BEGIN ->
    // setLocalAppOrgId -> captureAuditEvent -> COMMIT; ROLLBACK + release on error.
    let client: PoolClient | undefined;
    let usingOverride = false;
    try {
      // The transaction envelope is IDENTICAL on both paths; only how the client is obtained and
      // released differs, so no capture semantics change with the override present.
      const runEnvelope = async (c: PoolClient): Promise<void> => {
        await c.query('BEGIN');
        await setLocalAppOrgId(c, orgId);
        await captureAuditEvent(c, input);
        await c.query('COMMIT');
      };
      if (deps.withClient) {
        usingOverride = true;
        await deps.withClient(async (c) => {
          client = c;
          await runEnvelope(c);
        });
      } else {
        client = await deps.pool.connect();
        await runEnvelope(client);
      }
      // 7b. Per-attempt traceability that intentionally left the capture row (to
      // keep it replay-stable) is preserved here as ONE structured log line. A
      // durable side table is a future EP, not this revN.
      deps.log.info(
        {
          capture_id: captureId,
          govai_request_id: identity.govaiRequestId,
          audit_event_id: e.audit_event_id,
          latency_ms: e.latency_ms,
          provider_request_id: e.provider_request_id,
          identity_scope: identity.identityScope,
        },
        'audit_bridge.capture',
      );
      // Step 7b SUCCESS denominator (strictly post-COMMIT): the drop-rate base.
      safeMetric(() =>
        metrics.captureTotal({
          provider: e.provider,
          capability_level: e.capability_level,
          org_id: e.tenant_context.org_id,
        }),
      );
    } catch (err) {
      // The override owns its own client lifecycle (and its own rollback-on-throw), so rolling
      // back here would issue a ROLLBACK on a connection it has already released.
      if (client && !usingOverride) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      const reason = classifyCaptureError(err);
      if (reason === 'evidence_idempotency_conflict') {
        deps.log.error(
          { reason, govai_request_id: identity.govaiRequestId, capture_id: captureId },
          'audit-bridge: evidence idempotency conflict',
        );
        // S4: 23505 conflict. `e` (and `orgId`) are in scope; read via `e`.
        safeMetric(() =>
          metrics.dropTotal({
            reason,
            provider: e.provider,
            capability_level: e.capability_level,
            org_id: e.tenant_context.org_id,
          }),
        );
      } else {
        deps.log.warn(
          { reason, govai_request_id: identity.govaiRequestId, err: errMessage(err) },
          'audit-bridge: capture failed',
        );
        // S5: generic capture failure (incl. connect/set_config/captureAuditEvent).
        safeMetric(() =>
          metrics.dropTotal({
            reason,
            provider: e.provider,
            capability_level: e.capability_level,
            org_id: e.tenant_context.org_id,
          }),
        );
      }
      // 8. best_effort: the request path never fails in v1. `strict` request-
      // failing enforcement is intentionally deferred to a future PR.
      if (posture === 'strict') throw err;
      return;
    } finally {
      // Only release what THIS function checked out. The override released its own client when
      // its callback returned, and releasing twice throws.
      if (client && !usingOverride) client.release();
    }
  };
}
