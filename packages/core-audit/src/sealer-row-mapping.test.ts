// EP-005.5 — anti-drift tests for the single-source outbox-row mapping.
//
// The whole point of extracting `mapOutboxRowToClaimedAuditCapture` is that the
// normal claim path (`claimAuditCaptureForSeal`) and the future B3 stale-recovery
// path (`loadSealingCaptureForRecovery`) map an outbox row IDENTICALLY, so a
// hex/ISO/presence-flag divergence can never re-enter and later make the runner
// mark a RECOVERABLE row `failed`. These tests lock that invariant and cover the
// conversion edge cases. No database: a fake PoolClient returns canned rows.

import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';

import {
  mapOutboxRowToClaimedAuditCapture,
  claimAuditCaptureForSeal,
  loadSealingCaptureForRecovery,
  type AuditCaptureOutboxRow,
} from './sealer.js';

const ORG = '22222222-2222-4222-8222-222222222222';
const CAPTURE = '11111111-1111-4111-8111-111111111111';

function fakeClient(rows: unknown[]): PoolClient {
  return { query: vi.fn(async () => ({ rows, rowCount: rows.length })) } as unknown as PoolClient;
}

function sampleRow(overrides: Partial<AuditCaptureOutboxRow> = {}): AuditCaptureOutboxRow {
  return {
    capture_id: CAPTURE,
    org_id: ORG,
    chain_id: `org:${ORG}:run:33333333-3333-4333-8333-333333333333`,
    chain_category: 'run',
    capture_seq: '7',
    event_type: 'passthrough.invoked',
    event_version: '4',
    subject_type: 'runtime_event',
    subject_id: '44444444-4444-4444-8444-444444444444',
    occurred_at: '2026-06-15T00:00:00.000Z',
    payload_hash: Buffer.from('ab'.repeat(32), 'hex'),
    payload_encrypted: null,
    dek_wrapped: null,
    key_id: 'audit-1',
    key_version: 1,
    redaction_metadata: { audit_bridge: { identity_scope: 'govai_request_id' } },
    evidence_strength: 'hmac_internal',
    capture_integrity_tag: null,
    capture_integrity_alg: null,
    posture: 'best_effort',
    ...overrides,
  };
}

describe('EP-005.5 — single-source outbox-row mapping (anti-drift)', () => {
  it('claim path and the direct mapper produce deep-equal ClaimedAuditCapture for the same row', async () => {
    const row = sampleRow();
    const viaMapper = mapOutboxRowToClaimedAuditCapture(row);
    const viaClaim = await claimAuditCaptureForSeal(fakeClient([row]), {
      orgId: ORG,
      chainId: `org:${ORG}:run:33333333-3333-4333-8333-333333333333`,
    });
    expect(viaClaim).toEqual(viaMapper);
  });

  it('recovery loader maps via the SAME single source as the claim path', async () => {
    const row = sampleRow();
    const viaMapper = mapOutboxRowToClaimedAuditCapture(row);
    const viaRecovery = await loadSealingCaptureForRecovery(fakeClient([row]), {
      orgId: ORG,
      captureId: CAPTURE,
    });
    expect(viaRecovery).toEqual(viaMapper);
    // and both equal what the claim path would produce for the identical row.
    const viaClaim = await claimAuditCaptureForSeal(fakeClient([row]), {
      orgId: ORG,
      chainId: 'org:x:run:y',
    });
    expect(viaRecovery).toEqual(viaClaim);
  });

  it('recovery loader returns null when no sealing row exists', async () => {
    const out = await loadSealingCaptureForRecovery(fakeClient([]), { orgId: ORG, captureId: CAPTURE });
    expect(out).toBeNull();
  });

  it('payload_hash maps to the same hex whether a Buffer or a \\x-prefixed string', () => {
    const hex = 'ab'.repeat(32);
    const fromBuffer = mapOutboxRowToClaimedAuditCapture(sampleRow({ payload_hash: Buffer.from(hex, 'hex') }));
    const fromHexStr = mapOutboxRowToClaimedAuditCapture(sampleRow({ payload_hash: `\\x${hex}` }));
    expect(fromBuffer.payloadHashHex).toBe(hex);
    expect(fromHexStr.payloadHashHex).toBe(hex);
    expect(fromBuffer.payloadHashHex).toBe(fromHexStr.payloadHashHex);
  });

  it('occurred_at maps to the same ISO whether a Date or an ISO string', () => {
    const iso = '2026-06-15T12:34:56.789Z';
    const fromDate = mapOutboxRowToClaimedAuditCapture(sampleRow({ occurred_at: new Date(iso) }));
    const fromStr = mapOutboxRowToClaimedAuditCapture(sampleRow({ occurred_at: iso }));
    expect(fromDate.occurredAt).toBe(iso);
    expect(fromStr.occurredAt).toBe(iso);
  });

  it('presence flags reflect null vs non-null bytea fields', () => {
    const allNull = mapOutboxRowToClaimedAuditCapture(
      sampleRow({ payload_encrypted: null, dek_wrapped: null, capture_integrity_tag: null }),
    );
    expect(allNull.hasPayloadEncrypted).toBe(false);
    expect(allNull.hasDekWrapped).toBe(false);
    expect(allNull.hasCaptureIntegrityTag).toBe(false);

    const allSet = mapOutboxRowToClaimedAuditCapture(
      sampleRow({
        payload_encrypted: Buffer.from('00', 'hex'),
        dek_wrapped: Buffer.from('00', 'hex'),
        capture_integrity_tag: Buffer.from('00', 'hex'),
        capture_integrity_alg: 'kms_hmac_sha256',
      }),
    );
    expect(allSet.hasPayloadEncrypted).toBe(true);
    expect(allSet.hasDekWrapped).toBe(true);
    expect(allSet.hasCaptureIntegrityTag).toBe(true);
    expect(allSet.captureIntegrityAlg).toBe('kms_hmac_sha256');
  });

  it('a non-object redaction_metadata maps to {}', () => {
    for (const bad of [null, 'a string', 42, ['arr']]) {
      const mapped = mapOutboxRowToClaimedAuditCapture(
        sampleRow({ redaction_metadata: bad as unknown as Record<string, unknown> }),
      );
      expect(mapped.redactionMetadata).toEqual({});
    }
  });
});
