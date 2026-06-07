// ADR-023 Option A(b): deterministic audit_event_id for the AuditSealer
// append path.
//
// This module is PURE. It derives a stable audit_event_id from
// (org_id, capture_id) so that a retried seal of the same capture re-derives
// the SAME id and therefore cannot append a duplicate chain event. It does
// NOT implement AuditBridge, a runner, a loop, a worker, route wiring, or any
// runtime-to-outbox dispatch. No randomness, no time, no env, no secrets, no
// KMS — the same inputs yield the same id on every call and every machine.

import { createHash } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RFC 4122 §4.3 name-based UUID version 5 (SHA-1).
 *
 * Implemented locally with `node:crypto` so core-audit gains no new
 * dependency (the package already relies on `node:crypto` in `append.ts`).
 * `uuid5(namespace, name)` is deterministic: same inputs → same UUID.
 */
export function uuid5(namespaceUuid: string, name: string): string {
  if (!UUID_RE.test(namespaceUuid)) {
    throw new Error(
      `uuid5: namespace must be a UUID (got ${JSON.stringify(namespaceUuid)})`,
    );
  }
  const ns = Buffer.from(namespaceUuid.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * RFC 4122 URL namespace. Used ONLY to turn the documented namespace label
 * below into a concrete, reproducible UUID — never as the id namespace itself.
 */
const RFC4122_URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/**
 * Human-readable label for the AuditSealer capture-event namespace, fixed at
 * v1 by ADR-023 Option A(b). Changing the suffix changes every derived id and
 * therefore requires a new ADR.
 */
export const AUDIT_SEALER_CAPTURE_EVENT_NAMESPACE_LABEL =
  'govai.audit_sealer.capture_event.v1';

/**
 * Fixed namespace UUID for ADR-023 Option A(b) deterministic sealer event ids.
 *
 * The literal is the reproducible derivation
 *   uuid5(RFC4122_URL_NAMESPACE, AUDIT_SEALER_CAPTURE_EVENT_NAMESPACE_LABEL)
 * hard-coded so runtime never recomputes it and never reaches for randomness,
 * time, env, or KMS. `sealer-event-id.test.ts` asserts the literal still equals
 * that derivation, so the constant cannot silently drift.
 */
export const AUDIT_SEALER_CAPTURE_EVENT_NAMESPACE_UUID =
  '6b005489-aad5-576d-bcf8-a8c55fe40417';

export interface DeriveAuditSealerCaptureEventIdInput {
  orgId: string;
  captureId: string;
}

/**
 * ADR-023 Option A(b): the deterministic audit_event_id for a sealed capture.
 *
 *   audit_event_id = UUIDv5(
 *     namespace = AUDIT_SEALER_CAPTURE_EVENT_NAMESPACE_UUID,
 *     name      = `org:${orgId}:capture:${captureId}`,
 *   )
 *
 * Stable for the same (orgId, captureId); changes if either changes. Both
 * inputs must be UUIDs; the output is a valid v5 UUID.
 */
export function deriveAuditSealerCaptureEventId(
  input: DeriveAuditSealerCaptureEventIdInput,
): string {
  if (!UUID_RE.test(input.orgId)) {
    throw new Error(
      `deriveAuditSealerCaptureEventId: orgId must be a UUID (got ${JSON.stringify(input.orgId)})`,
    );
  }
  if (!UUID_RE.test(input.captureId)) {
    throw new Error(
      `deriveAuditSealerCaptureEventId: captureId must be a UUID (got ${JSON.stringify(input.captureId)})`,
    );
  }
  return uuid5(
    AUDIT_SEALER_CAPTURE_EVENT_NAMESPACE_UUID,
    `org:${input.orgId}:capture:${input.captureId}`,
  );
}

// Re-derive at module load is intentionally NOT done; the constant above is a
// literal. The reproducibility guarantee lives in the test, keeping runtime
// free of any hashing just to obtain the namespace. RFC4122_URL_NAMESPACE is
// exported below only so the test can re-derive and assert equality.
export const __internalSealerEventId = Object.freeze({
  RFC4122_URL_NAMESPACE,
});
