// AuditBridge dispatcher (SPEC-01 §6; ADR-027 topology + ADR-028 identity &
// payload-hash). Maps a validated `PassthroughInvoked v3` runtime event into the
// B0/B1 capture outbox via `captureAuditEvent`. PR-A exports the factory and the
// pure captureId helper; it is NOT wired into any route closure (that is PR-B).

import type { Pool, PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

import { sha256, canonicalize, captureAuditEvent } from '@govai/core-audit';
import type { CaptureAuditEventInput } from '@govai/core-audit';
import { chainIdFor, PassthroughInvokedSchema, projectCapturePayloadV1, uuidv5 } from '@govai/core-events';
import type { PassthroughInvoked } from '@govai/core-events';
import { setLocalAppOrgId } from '@govai/core-tenant';

import { AUDIT_CHAIN_KEY } from './audit-keys.js';
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
  /** `strict` is plumbed but NEVER enabled in v1 (ADR-028 §9). */
  posture?: 'best_effort' | 'strict';
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

  return async (event: unknown, identityArg?: AuditBridgeRequestIdentity): Promise<void> => {
    // 1. Resolve request identity (arg overrides ALS store).
    const identity = identityArg ?? requestIdentityAls.getStore();
    if (!identity) {
      deps.log.error({ reason: 'missing_request_identity' }, 'audit-bridge: no request identity');
      return;
    }

    // 2. Validate / narrow the runtime event. An invalid event is never inserted.
    const parsed = PassthroughInvokedSchema.safeParse(event);
    if (!parsed.success) {
      deps.log.warn(
        { reason: 'invalid_runtime_event', govai_request_id: identity.govaiRequestId },
        'audit-bridge: invalid runtime event',
      );
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

    // 6. B1 envelope — exactly the capture.ts contract. Per-attempt fields live
    // in redactionMetadata.audit_bridge (outside the hash), never in the payload.
    const input: CaptureAuditEventInput = {
      captureId,
      orgId,
      chainId: chainIdFor(orgId, 'run'),
      chainCategory: 'run',
      eventType: 'passthrough.invoked',
      eventVersion: '3',
      subjectType: 'runtime_event',
      subjectId: e.audit_event_id, // linkage only, NOT identity (ADR-028 §1)
      occurredAt: new Date(),
      payloadHash,
      payloadEncrypted: null,
      dekWrapped: null,
      keyId,
      keyVersion,
      redactionMetadata: {
        audit_bridge: {
          govai_request_id: identity.govaiRequestId,
          identity_scope: identity.identityScope,
          idempotency_key_hash: identity.idempotencyKeyHash,
          provider_request_id: e.provider_request_id,
          latency_ms: e.latency_ms,
          audit_event_id: e.audit_event_id,
        },
      },
      captureIntegrityTag: null,
      captureIntegrityAlg: null,
      posture,
    };

    // 7. B1 transaction envelope (caller-owned): connect -> BEGIN ->
    // setLocalAppOrgId -> captureAuditEvent -> COMMIT; ROLLBACK + release on error.
    let client: PoolClient | undefined;
    try {
      client = await deps.pool.connect();
      await client.query('BEGIN');
      await setLocalAppOrgId(client, orgId);
      await captureAuditEvent(client, input);
      await client.query('COMMIT');
    } catch (err) {
      if (client) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      const reason = classifyCaptureError(err);
      if (reason === 'evidence_idempotency_conflict') {
        deps.log.error(
          { reason, govai_request_id: identity.govaiRequestId, capture_id: captureId },
          'audit-bridge: evidence idempotency conflict',
        );
      } else {
        deps.log.warn(
          { reason, govai_request_id: identity.govaiRequestId, err: errMessage(err) },
          'audit-bridge: capture failed',
        );
      }
      // 8. best_effort: the request path never fails in v1. `strict` request-
      // failing enforcement is intentionally deferred to a future PR.
      if (posture === 'strict') throw err;
      return;
    } finally {
      if (client) client.release();
    }
  };
}
