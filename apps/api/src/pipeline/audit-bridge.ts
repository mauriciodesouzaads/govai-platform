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
   *
   * ★ THE CONTRACT, STATED EXACTLY, BECAUSE GETTING IT WRONG POISONS A POOL. The override owns
   * the CHECKOUT (obtain, guard, release/destroy). This dispatcher owns the TRANSACTION: it
   * issues `BEGIN`, so it guarantees a matching `COMMIT` or `ROLLBACK` BEFORE the callback
   * returns. The two are different lifecycles, and an earlier revision conflated them — it
   * skipped the rollback believing the override would do it, so a capture failure after `BEGIN`
   * returned an aborted transaction to the pool and the next borrower failed `25P02`.
   *
   * `markUnusable` is how this dispatcher reports the one case it cannot fix: a `ROLLBACK` that
   * itself fails. The connection is then destroyed rather than returned healthy.
   */
  withClient?: <T>(
    fn: (client: PoolClient, markUnusable: () => void) => Promise<T>,
  ) => Promise<T>;
  /**
   * Failure posture. `best_effort` (the default, and every DIRECT ROUTE): a capture drop or
   * failure is logged + counted and the promise RESOLVES — v1 never fails a user's request
   * over evidence (ADR-028 §9). `strict` (the CONVERSATION WORKER's own bridge instance,
   * P0-C): EVERY drop class — identity, validation, canonicalization and transaction alike —
   * REJECTS, so the executor can classify a missing capture as `persistence_error` instead of
   * completing an attempt whose required evidence silently vanished.
   */
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

/**
 * Raised under `strict` posture when the dispatcher DROPS a capture before its transaction
 * stage — a missing identity, an event that failed schema validation, or a projection/
 * canonicalization failure. It carries the drop reason and nothing else: the log line at the
 * drop site already recorded the diagnostic detail, and this error's job is to make the drop
 * OBSERVABLE to a strict caller, never to transport payload material.
 */
export class AuditBridgeCaptureDropped extends Error {
  constructor(readonly reason: AuditBridgeFailureReason) {
    super(`audit-bridge capture dropped: ${reason}`);
    this.name = 'AuditBridgeCaptureDropped';
  }
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
 * than a little latency. Under `best_effort` (the direct routes) it never throws
 * on the request path (ADR-028 §9); under `strict` (the conversation worker's
 * bridge instance) every drop class rejects — see `AuditBridgeDeps.posture`.
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

  // ★ ONE DROP POLICY FOR EVERY FAILURE CLASS (P0-C closeout). Observability is
  // posture-independent — by the time this runs, the drop site has ALREADY logged and
  // counted. What the posture decides is whether the CALLER is told. `best_effort`
  // resolves: the request path never fails over evidence capture. `strict` rejects: the
  // conversation worker adopted it precisely so an attempt can never reach a successful
  // terminal state while its required evidence silently vanished — and a validation or
  // canonicalization drop is exactly such a vanishing, no less than a failed INSERT. An
  // earlier revision enforced `strict` only at the transaction stage (step 7), so a
  // schema-invalid worker event resolved normally and the executor's `persistence_error`
  // classification was structurally unreachable for that whole drop class.
  //
  // `cause` carries the ORIGINAL error where one exists (the step-7 transaction path), so
  // the executor seam keeps observing exactly the failure it always observed; the
  // validation/identity/canonicalization drops have no failure object a caller should see
  // and throw the typed reason-bearing marker instead.
  const dropped = (reason: AuditBridgeFailureReason, cause?: unknown): void => {
    if (posture === 'strict') throw cause ?? new AuditBridgeCaptureDropped(reason);
  };

  return async (event: unknown, identityArg?: AuditBridgeRequestIdentity): Promise<void> => {
    // 1. Resolve request identity (arg overrides ALS store).
    const identity = identityArg ?? requestIdentityAls.getStore();
    if (!identity) {
      deps.log.error({ reason: 'missing_request_identity' }, 'audit-bridge: no request identity');
      // S1: no identity/event parsed yet → reason-only (cardinality-safe).
      safeMetric(() => metrics.dropTotal({ reason: 'missing_request_identity' }));
      dropped('missing_request_identity');
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
      dropped('invalid_runtime_event');
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
      // The typed marker, NOT the raw error: a canonicalization failure can carry a fragment
      // of the projected payload in its message, and the log line above already recorded it.
      dropped('canonicalization_failed');
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
        await deps.withClient(async (c, markUnusable) => {
          client = c;
          try {
            await runEnvelope(c);
          } catch (envelopeErr) {
            // ★ THE COMPONENT THAT OPENED `BEGIN` CLOSES IT — here, before the client can leave
            // this callback. Deferring to the override was the defect: it owns the checkout, not
            // the transaction, so the client went back to the pool still inside one.
            try {
              await c.query('ROLLBACK');
            } catch {
              // The transaction could not be proven closed, so the connection must not be
              // reused. Destroying it costs one reconnect; returning it costs every subsequent
              // borrower a `25P02`.
              markUnusable();
            }
            throw envelopeErr; // the ORIGINAL failure, never the rollback's
          }
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
      // The override path has ALREADY rolled back, inside its callback and before its client was
      // released — issuing another ROLLBACK here would target a connection this function no
      // longer holds.
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
      // 8. The posture decides visibility. `best_effort` resolves — the request path never
      // fails over evidence. `strict` rethrows the ORIGINAL failure (`cause`), so the
      // executor seam observes exactly the error the transaction stage produced.
      dropped(reason, err);
      return;
    } finally {
      // Only release what THIS function checked out. The override released its own client when
      // its callback returned, and releasing twice throws.
      if (client && !usingOverride) client.release();
    }
  };
}
