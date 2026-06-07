// Unit tests for ADR-023 Option A(b) deterministic sealer event id derivation.
//
// Pure tests: no database, no kms, no env, no provider traffic.

import { describe, it, expect } from 'vitest';

import {
  uuid5,
  deriveAuditSealerCaptureEventId,
  AUDIT_SEALER_CAPTURE_EVENT_NAMESPACE_UUID,
  AUDIT_SEALER_CAPTURE_EVENT_NAMESPACE_LABEL,
  __internalSealerEventId,
} from './sealer-event-id.js';

const V5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '44444444-4444-4444-8444-444444444444';
const CAP_A = '22222222-2222-4222-8222-222222222222';
const CAP_B = '33333333-3333-4333-8333-333333333333';

describe('AUDIT_SEALER_CAPTURE_EVENT_NAMESPACE_UUID', () => {
  it('is the reproducible uuid5(URL_NS, label) of the documented namespace label', () => {
    // The hard-coded literal must equal the derivation from the documented
    // label, so the namespace can never silently drift from ADR-023.
    const derived = uuid5(
      __internalSealerEventId.RFC4122_URL_NAMESPACE,
      AUDIT_SEALER_CAPTURE_EVENT_NAMESPACE_LABEL,
    );
    expect(AUDIT_SEALER_CAPTURE_EVENT_NAMESPACE_UUID).toBe(derived);
    expect(AUDIT_SEALER_CAPTURE_EVENT_NAMESPACE_UUID).toBe('6b005489-aad5-576d-bcf8-a8c55fe40417');
    expect(AUDIT_SEALER_CAPTURE_EVENT_NAMESPACE_LABEL).toBe('govai.audit_sealer.capture_event.v1');
  });
});

describe('uuid5', () => {
  it('matches RFC 4122 §4.3 well-known DNS vector (python.org)', () => {
    // Canonical published vector: uuid5(DNS, "python.org").
    const DNS_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    expect(uuid5(DNS_NS, 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('rejects a non-UUID namespace', () => {
    expect(() => uuid5('not-a-uuid', 'x')).toThrow(/namespace must be a UUID/);
  });
});

describe('deriveAuditSealerCaptureEventId', () => {
  it('is stable for the same orgId + captureId', () => {
    const id1 = deriveAuditSealerCaptureEventId({ orgId: ORG_A, captureId: CAP_A });
    const id2 = deriveAuditSealerCaptureEventId({ orgId: ORG_A, captureId: CAP_A });
    expect(id1).toBe(id2);
  });

  it('produces a valid v5 UUID', () => {
    const id = deriveAuditSealerCaptureEventId({ orgId: ORG_A, captureId: CAP_A });
    expect(id).toMatch(V5_RE);
  });

  it('matches the documented UUIDv5(namespace, "org:{org}:capture:{cap}") formula', () => {
    const id = deriveAuditSealerCaptureEventId({ orgId: ORG_A, captureId: CAP_A });
    const manual = uuid5(
      AUDIT_SEALER_CAPTURE_EVENT_NAMESPACE_UUID,
      `org:${ORG_A}:capture:${CAP_A}`,
    );
    expect(id).toBe(manual);
    // Golden value pins the algorithm + namespace together.
    expect(id).toBe('d13c3752-e337-5db7-9db6-7621675847ef');
  });

  it('changes when captureId changes', () => {
    const id1 = deriveAuditSealerCaptureEventId({ orgId: ORG_A, captureId: CAP_A });
    const id2 = deriveAuditSealerCaptureEventId({ orgId: ORG_A, captureId: CAP_B });
    expect(id1).not.toBe(id2);
  });

  it('changes when orgId changes', () => {
    const id1 = deriveAuditSealerCaptureEventId({ orgId: ORG_A, captureId: CAP_A });
    const id2 = deriveAuditSealerCaptureEventId({ orgId: ORG_B, captureId: CAP_A });
    expect(id1).not.toBe(id2);
  });

  it('rejects a non-UUID orgId or captureId', () => {
    expect(() => deriveAuditSealerCaptureEventId({ orgId: 'nope', captureId: CAP_A })).toThrow(
      /orgId must be a UUID/,
    );
    expect(() => deriveAuditSealerCaptureEventId({ orgId: ORG_A, captureId: 'nope' })).toThrow(
      /captureId must be a UUID/,
    );
  });
});
