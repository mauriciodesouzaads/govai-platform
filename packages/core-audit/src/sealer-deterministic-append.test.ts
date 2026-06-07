// Integration of ADR-023 Option A(b) into the sealer composite path.
//
// Drives sealNextAuditCapture's full claim → auditAppend → mark_sealed flow
// through a fake PoolClient + fake kms (no database, no provider traffic). The
// focus is the deterministic-id contract and the §8.3 retry case (append
// succeeded, mark_sealed retried) producing no duplicate append.

import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Kms } from '@govai/core-identity';

import {
  sealNextAuditCapture,
  buildAuditCaptureSealingEvent,
  type ClaimedAuditCapture,
} from './sealer.js';
import { deriveAuditSealerCaptureEventId } from './sealer-event-id.js';

type RecordedCall = { sql: string; values: unknown[] };

function makeFakeClient(opts?: {
  responses?: Array<{ rows: unknown[]; rowCount?: number }>;
}): { client: PoolClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let n = 0;
  const queryFn = vi.fn(async (sql: string, values: unknown[]) => {
    calls.push({ sql, values });
    n += 1;
    return opts?.responses?.[n - 1] ?? { rows: [], rowCount: 0 };
  });
  return { client: { query: queryFn } as unknown as PoolClient, calls };
}

function fakeKms(): Kms {
  return { hmacSha256: async () => new Uint8Array(32).fill(7) } as unknown as Kms;
}

function claimedRow(overrides: Partial<ClaimedAuditCapture> = {}): ClaimedAuditCapture {
  return {
    captureId: randomUUID(),
    orgId: randomUUID(),
    chainId: `org:${randomUUID()}:run:${randomUUID()}`,
    chainCategory: 'run',
    captureSeq: '1',
    eventType: 'passthrough.invoked',
    eventVersion: '3',
    subjectType: 'run',
    subjectId: randomUUID(),
    occurredAt: '2026-05-27T12:00:00.000Z',
    payloadHashHex: '00'.repeat(32),
    hasPayloadEncrypted: false,
    hasDekWrapped: false,
    keyId: 'audit-1',
    keyVersion: 1,
    redactionMetadata: { surface: 'provider-native' },
    evidenceStrength: 'hmac_internal',
    captureIntegrityAlg: null,
    hasCaptureIntegrityTag: false,
    posture: 'best_effort',
    ...overrides,
  };
}

function claimRowSqlShape(c: ClaimedAuditCapture): Record<string, unknown> {
  return {
    capture_id: c.captureId,
    org_id: c.orgId,
    chain_id: c.chainId,
    chain_category: c.chainCategory,
    capture_seq: c.captureSeq,
    event_type: c.eventType,
    event_version: c.eventVersion,
    subject_type: c.subjectType,
    subject_id: c.subjectId,
    occurred_at: c.occurredAt,
    payload_hash: Buffer.from(c.payloadHashHex, 'hex'),
    payload_encrypted: null,
    dek_wrapped: null,
    key_id: c.keyId,
    key_version: c.keyVersion,
    redaction_metadata: c.redactionMetadata,
    evidence_strength: c.evidenceStrength,
    capture_integrity_tag: null,
    capture_integrity_alg: c.captureIntegrityAlg,
    posture: c.posture,
  };
}

/** Build an audit_events row consistent with buildAuditCaptureSealingEvent(claimed). */
function existingEventRowForClaim(claimed: ClaimedAuditCapture): Record<string, unknown> {
  const appendInput = buildAuditCaptureSealingEvent(claimed);
  const deterministicId = deriveAuditSealerCaptureEventId({
    orgId: claimed.orgId,
    captureId: claimed.captureId,
  });
  return {
    id: deterministicId,
    org_id: appendInput.orgId,
    chain_id: appendInput.chainId,
    sequence_number: '5',
    event_type: appendInput.eventType,
    event_version: appendInput.eventVersion,
    subject_type: appendInput.subjectType,
    subject_id: appendInput.subjectId,
    occurred_at: appendInput.occurredAt.toISOString(),
    payload_hash: Buffer.from(appendInput.payloadHash),
    payload_ref: null,
    redaction_metadata: appendInput.redactionMetadata,
    hmac: Buffer.from('aa'.repeat(32), 'hex'),
    canonical_hash: Buffer.from('bb'.repeat(32), 'hex'),
    canonical_bytes: Buffer.from(`{"event_id":"${deterministicId}"}`, 'utf8'),
    key_id: appendInput.keyId,
    key_version: appendInput.keyVersion,
    evidence_strength: appendInput.evidenceStrength ?? 'hmac_internal',
  };
}

const empty = { rows: [] };

describe('sealNextAuditCapture — deterministic append id (ADR-023 Option A(b))', () => {
  it('passes the deterministic id to auditAppend and mark_sealed on a fresh seal', async () => {
    const claimed = claimedRow();
    const deterministicId = deriveAuditSealerCaptureEventId({
      orgId: claimed.orgId,
      captureId: claimed.captureId,
    });
    const { client, calls } = makeFakeClient({
      responses: [
        { rows: [claimRowSqlShape(claimed)] }, // claim
        { rows: [{ v: claimed.orgId }] }, // auditAppend tenant
        empty, // advisory lock
        empty, // lookup miss
        empty, // head (empty chain)
        empty, // append_locked
        empty, // mark_sealed
      ],
    });

    const r = await sealNextAuditCapture(client, {
      orgId: claimed.orgId,
      chainId: claimed.chainId,
      kms: fakeKms(),
    });

    expect(r.status).toBe('sealed');
    if (r.status !== 'sealed') throw new Error('unreachable');
    expect(r.auditEventId).toBe(deterministicId);

    const append = calls.find((c) => c.sql.includes('audit_append_locked'));
    expect(append!.values[0]).toBe(deterministicId); // p_event_id
    const markSealed = calls.find((c) => c.sql.includes('audit_capture_mark_sealed'));
    expect(markSealed!.values[2]).toBe(deterministicId); // p_audit_event_id
  });

  it('retry after append-success + mark_sealed-failure reuses the event and does not duplicate', async () => {
    const claimed = claimedRow();
    const deterministicId = deriveAuditSealerCaptureEventId({
      orgId: claimed.orgId,
      captureId: claimed.captureId,
    });
    const { client, calls } = makeFakeClient({
      responses: [
        { rows: [claimRowSqlShape(claimed)] }, // claim
        { rows: [{ v: claimed.orgId }] }, // tenant
        empty, // advisory lock
        { rows: [existingEventRowForClaim(claimed)] }, // lookup HIT
        empty, // mark_sealed
      ],
    });

    const r = await sealNextAuditCapture(client, {
      orgId: claimed.orgId,
      chainId: claimed.chainId,
      kms: fakeKms(),
    });

    expect(r.status).toBe('sealed');
    if (r.status !== 'sealed') throw new Error('unreachable');
    expect(r.auditEventId).toBe(deterministicId);
    // No duplicate append on retry.
    expect(calls.some((c) => c.sql.includes('audit_append_locked'))).toBe(false);
    // mark_sealed still receives the same deterministic id.
    const markSealed = calls.find((c) => c.sql.includes('audit_capture_mark_sealed'));
    expect(markSealed!.values[2]).toBe(deterministicId);
  });

  it('drives the full seal with no BEGIN/COMMIT/ROLLBACK/SAVEPOINT/SET ROLE', async () => {
    const claimed = claimedRow();
    const { client, calls } = makeFakeClient({
      responses: [
        { rows: [claimRowSqlShape(claimed)] },
        { rows: [{ v: claimed.orgId }] },
        empty,
        empty,
        empty,
        empty,
        empty,
      ],
    });
    await sealNextAuditCapture(client, {
      orgId: claimed.orgId,
      chainId: claimed.chainId,
      kms: fakeKms(),
    });
    const forbidden = /\b(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|SET\s+ROLE|RESET\s+ROLE)\b/i;
    for (const c of calls) expect(c.sql).not.toMatch(forbidden);
  });
});
