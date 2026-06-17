// AuditBridge request identity (SPEC-01 §2; ADR-028 §1-§3). PR-A exports the
// types, the AsyncLocalStorage store, the builder, and header normalization.
// It is NOT registered as a hook here — PR-B wires the onRequest hook for the
// four direct-route paths and echoes `X-GovAI-Request-Id`.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';

export type AuditBridgeIdentityScope = 'govai_request_id' | 'client_idempotency_key';

export interface AuditBridgeRequestIdentity {
  /** UUIDv4 generated exactly once per inbound request. */
  govaiRequestId: string;
  /** Which key the AuditBridge captureId is scoped to. */
  identityScope: AuditBridgeIdentityScope;
  /** sha256(normalized idempotency key) lowercase hex — never the raw value. */
  idempotencyKeyHash?: string;
}

// AR-2: AsyncLocalStorage is the PRIMARY request-identity propagation channel.
// The WeakMap<FastifyRequest> precedent (`routes/passthrough-anthropic.ts:26`)
// is the pre-approved fallback if the PR-B streaming integration test fails
// deterministically — that switch is recorded in the PR-B description and needs
// no new review round. PR-A only exports the store; PR-B runs the hook inside it.
export const requestIdentityAls = new AsyncLocalStorage<AuditBridgeRequestIdentity>();

const MAX_IDEMPOTENCY_KEY_LEN = 256;

/** True if `s` contains any ASCII control character (C0 range or DEL). */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Thrown when a client-supplied `X-GovAI-Idempotency-Key` header is malformed.
 * The PR-B ingress hook maps this to HTTP 400 `invalid_idempotency_key`. This is
 * the ONLY strict (request-failing) behavior in the identity/evidence path
 * (ADR-028 §3); every other AuditBridge failure mode is best_effort.
 */
export class InvalidIdempotencyKeyError extends Error {
  readonly code = 'invalid_idempotency_key';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidIdempotencyKeyError';
  }
}

/**
 * Build the per-request AuditBridge identity. Always generates a fresh
 * `govaiRequestId` (UUIDv4) exactly once. When a client idempotency header is
 * present it is trimmed, validated (non-empty, <= 256 chars, no control chars),
 * and hashed (sha256 lowercase hex); the raw value is never stored or logged.
 * No header => scope `govai_request_id`.
 */
export function buildRequestIdentity(idempotencyHeader?: string): AuditBridgeRequestIdentity {
  const govaiRequestId = randomUUID();
  if (idempotencyHeader === undefined) {
    return { govaiRequestId, identityScope: 'govai_request_id' };
  }
  const normalized = idempotencyHeader.trim();
  if (normalized.length === 0) {
    throw new InvalidIdempotencyKeyError('X-GovAI-Idempotency-Key must not be empty after trim');
  }
  if (normalized.length > MAX_IDEMPOTENCY_KEY_LEN) {
    throw new InvalidIdempotencyKeyError(
      `X-GovAI-Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LEN} characters`,
    );
  }
  if (hasControlChars(normalized)) {
    throw new InvalidIdempotencyKeyError(
      'X-GovAI-Idempotency-Key must not contain control characters',
    );
  }
  const idempotencyKeyHash = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return { govaiRequestId, identityScope: 'client_idempotency_key', idempotencyKeyHash };
}
