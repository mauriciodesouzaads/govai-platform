// B2 unit tests for AuditSealer core library.
//
// These tests do NOT touch a database. They lock down validation, the pure
// event-builder, error sanitization, and the no-transactional-side-effects
// guarantees of sealNextAuditCapture via a fake PoolClient.
//
// Integration coverage lives in tests/integration/audit-sealer-core.test.ts.

import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Kms } from '@govai/core-identity';

import {
  auditCategoryChainId,
  buildAuditCaptureSealingEvent,
  claimAuditCaptureForSeal,
  markAuditCaptureFailed,
  markAuditCaptureSealed,
  sanitizeSealerError,
  sealNextAuditCapture,
  __internal,
  type ClaimedAuditCapture,
  type AuditSealerPhase,
} from './sealer.js';

import * as Sealer from './sealer.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type RecordedCall = { sql: string; values: unknown[] };

function makeFakeClient(opts?: {
  /** Sequence of mock responses; one per query() call. Defaults to a
   *  single-row claim shape for the first call and an empty result after. */
  responses?: Array<{ rows: unknown[]; rowCount?: number }>;
  /** If set, the Nth query() throws this error. */
  throwOnCall?: { n: number; error: Error };
}): { client: PoolClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let n = 0;
  const queryFn = vi.fn(async (sql: string, values: unknown[]) => {
    calls.push({ sql, values });
    n += 1;
    if (opts?.throwOnCall && opts.throwOnCall.n === n) throw opts.throwOnCall.error;
    const resp = opts?.responses?.[n - 1];
    return resp ?? { rows: [], rowCount: 0 };
  });
  const client = { query: queryFn } as unknown as PoolClient;
  return { client, calls };
}

function fakeKms(): Kms {
  // The HMAC chain functions never run in unit tests because we mock
  // auditAppend separately. This object only needs to satisfy the typing
  // guard inside sealNextAuditCapture.
  return {} as unknown as Kms;
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

// SQL shape returned by `SELECT * FROM govai.audit_capture_claim_for_seal(...)`
// after our text-casting. Used to feed makeFakeClient.responses.
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
    payload_encrypted: c.hasPayloadEncrypted ? Buffer.from('ff', 'hex') : null,
    dek_wrapped: c.hasDekWrapped ? Buffer.from('ee', 'hex') : null,
    key_id: c.keyId,
    key_version: c.keyVersion,
    redaction_metadata: c.redactionMetadata,
    evidence_strength: c.evidenceStrength,
    capture_integrity_tag: c.hasCaptureIntegrityTag ? Buffer.from('aa', 'hex') : null,
    capture_integrity_alg: c.captureIntegrityAlg,
    posture: c.posture,
  };
}

// -----------------------------------------------------------------------------
// 1. sanitizeSealerError
// -----------------------------------------------------------------------------

describe('sanitizeSealerError', () => {
  it('extracts name + message from an Error and strips stack', () => {
    const err = new TypeError('boom');
    err.stack = 'TypeError: boom\n    at internalSecret /etc/secret.ts:1:1';
    const s = sanitizeSealerError(err);
    expect(s.errorClass).toBe('TypeError');
    expect(s.errorMessage).toBe('boom');
    expect(s.errorMessage).not.toContain('/etc/secret.ts');
    expect(s.errorMessage).not.toContain('stack');
  });

  it('hard-caps messages at 200 chars and ends with ellipsis', () => {
    const long = 'x'.repeat(500);
    const s = sanitizeSealerError(new Error(long));
    expect(s.errorMessage.length).toBeLessThanOrEqual(__internal.SEALER_ERROR_MESSAGE_MAX);
    expect(s.errorMessage.endsWith('…')).toBe(true);
  });

  it('collapses newlines and control chars to single spaces', () => {
    const s = sanitizeSealerError(new Error('a\nb\tc\r\nd\v\fe'));
    expect(s.errorMessage).toBe('a b c d e');
    expect(/[\n\r\t\v\f]/.test(s.errorMessage)).toBe(false);
  });

  it('returns <no_message> when the input has nothing', () => {
    expect(sanitizeSealerError(undefined).errorMessage).toBe('<no_message>');
    expect(sanitizeSealerError(null).errorMessage).toBe('<no_message>');
    expect(sanitizeSealerError(new Error('')).errorMessage).toBe('<no_message>');
  });

  it('accepts explicit errorClass + errorMessage object form and sanitizes', () => {
    const s = sanitizeSealerError({
      errorClass: 'KmsError!!!',
      errorMessage: 'derive failed\n\nstack: top_secret_xyz',
    });
    // errorClass is restricted to [A-Za-z0-9_.-]
    expect(s.errorClass).toBe('KmsError');
    // Newlines collapse to a single space; runs of whitespace collapse to one.
    expect(s.errorMessage).toBe('derive failed stack: top_secret_xyz');
    // The sanitizer is class+message-only; payload leakage is the caller's
    // contract upstream. We don't try to strip "stack:" tokens.
    expect(s.errorMessage.includes('top_secret_xyz')).toBe(true);
  });

  it('does not include payload content from non-Error objects', () => {
    const s = sanitizeSealerError({
      // not an Error, not the explicit-class form
      error: { prompt: 'leak-this', stack: 'sensitive' } as unknown,
    });
    expect(s.errorClass).toBe('unknown');
    expect(s.errorMessage).toBe('<non-error value>');
    expect(s.errorMessage).not.toContain('leak-this');
    expect(s.errorMessage).not.toContain('sensitive');
  });

  it('accepts a plain string', () => {
    const s = sanitizeSealerError('just a string');
    expect(s.errorClass).toBe('unknown');
    expect(s.errorMessage).toBe('just a string');
  });
});

// -----------------------------------------------------------------------------
// 2. buildAuditCaptureSealingEvent
// -----------------------------------------------------------------------------

describe('buildAuditCaptureSealingEvent', () => {
  it('translates the capture-chain id to the HMAC chain id (orgId:category)', () => {
    const c = claimedRow();
    const ev = buildAuditCaptureSealingEvent(c, { sealedAt: new Date('2026-05-27T12:00:00.000Z') });
    expect(ev.chainId).toBe(`${c.orgId}:run`);
    expect(ev.chainId).not.toBe(c.chainId);
  });

  it('preserves the captured event identity fields', () => {
    const c = claimedRow();
    const ev = buildAuditCaptureSealingEvent(c, { sealedAt: new Date('2026-05-27T12:00:00.000Z') });
    expect(ev.orgId).toBe(c.orgId);
    expect(ev.eventType).toBe(c.eventType);
    expect(ev.eventVersion).toBe(c.eventVersion);
    expect(ev.subjectType).toBe(c.subjectType);
    expect(ev.subjectId).toBe(c.subjectId);
    expect(ev.keyId).toBe(c.keyId);
    expect(ev.keyVersion).toBe(c.keyVersion);
    expect(ev.evidenceStrength).toBe('hmac_internal');
  });

  it('converts payloadHashHex to a 32-byte Buffer', () => {
    const c = claimedRow({ payloadHashHex: 'ab'.repeat(32) });
    const ev = buildAuditCaptureSealingEvent(c, { sealedAt: new Date(0) });
    expect(Buffer.isBuffer(ev.payloadHash)).toBe(true);
    expect((ev.payloadHash as Buffer).length).toBe(32);
    expect(Buffer.from(ev.payloadHash).toString('hex')).toBe('ab'.repeat(32));
  });

  it('does NOT include raw payload_encrypted / dek_wrapped / capture_integrity_tag', () => {
    const c = claimedRow({
      hasPayloadEncrypted: true,
      hasDekWrapped: true,
      hasCaptureIntegrityTag: true,
      captureIntegrityAlg: 'sha256_digest',
    });
    const ev = buildAuditCaptureSealingEvent(c, { sealedAt: new Date(0) });
    // The whole AuditAppendInput object should never contain those bytes.
    expect('payloadEncrypted' in ev).toBe(false);
    expect('dekWrapped' in ev).toBe(false);
    const dump = JSON.stringify(ev, (_k, v) => (Buffer.isBuffer(v) ? '[buffer]' : v));
    expect(dump).not.toContain('"payloadEncrypted"');
    expect(dump).not.toContain('"dekWrapped"');
    expect(dump).not.toContain('"captureIntegrityTag"');
    // Only the metadata flags + alg name carry through.
    const meta = ev.redactionMetadata['audit_sealer'] as Record<string, unknown>;
    expect(meta.has_payload_encrypted).toBe(true);
    expect(meta.has_dek_wrapped).toBe(true);
    expect(meta.has_capture_integrity_tag).toBe(true);
    expect(meta.capture_integrity_alg).toBe('sha256_digest');
  });

  it('writes a versioned audit_sealer block (version=1, sealed_by) and no legacy _b2_seal', () => {
    const c = claimedRow();
    const ev = buildAuditCaptureSealingEvent(c, { sealedAt: new Date('2026-05-27T12:00:00.000Z') });
    expect('_b2_seal' in ev.redactionMetadata).toBe(false);
    const meta = ev.redactionMetadata['audit_sealer'] as Record<string, unknown>;
    expect(meta.version).toBe(1);
    expect(meta.sealed_by).toBe('audit-sealer-core');
    expect(meta.capture_id).toBe(c.captureId);
    expect(meta.capture_seq).toBe(c.captureSeq);
    expect(meta.capture_chain_id).toBe(c.chainId);
    // The audit_sealer block must never contain any banned payload key.
    for (const banned of [
      'prompt',
      'response',
      'raw_input',
      'raw_output',
      'messages',
      'completion',
      'requestBody',
      'responseBody',
      'payload_encrypted',
      'dek_wrapped',
      'capture_integrity_tag',
    ]) {
      expect(banned in meta).toBe(false);
    }
  });

  it('writes audit_sealer metadata deterministically given sealedAt', () => {
    const c = claimedRow();
    const a = buildAuditCaptureSealingEvent(c, { sealedAt: new Date('2026-05-27T12:00:00.000Z') });
    const b = buildAuditCaptureSealingEvent(c, { sealedAt: new Date('2026-05-27T12:00:00.000Z') });
    expect(JSON.stringify(a.redactionMetadata)).toBe(JSON.stringify(b.redactionMetadata));
  });

  it('includes a sanitized workerId only when provided', () => {
    const c = claimedRow();
    const noW = buildAuditCaptureSealingEvent(c, { sealedAt: new Date(0) });
    expect((noW.redactionMetadata['audit_sealer'] as Record<string, unknown>).worker_id).toBeUndefined();

    const withW = buildAuditCaptureSealingEvent(c, {
      sealedAt: new Date(0),
      workerId: 'sealer-1; DROP TABLE x;',
    });
    expect((withW.redactionMetadata['audit_sealer'] as Record<string, unknown>).worker_id).toBe('sealer-1DROPTABLEx');
  });

  it('refuses to build if claimed.redactionMetadata carries a banned top-level key', () => {
    for (const key of [
      'prompt',
      'response',
      'raw_input',
      'raw_output',
      'messages',
      'completion',
      'requestBody',
      'responseBody',
    ]) {
      const c = claimedRow({ redactionMetadata: { [key]: 'leak' } });
      expect(() => buildAuditCaptureSealingEvent(c, { sealedAt: new Date(0) })).toThrow(
        new RegExp(`banned top-level key "${key}"`),
      );
    }
  });

  it('throws on an unparseable claimed.occurredAt', () => {
    const c = claimedRow({ occurredAt: 'not-an-iso' });
    expect(() => buildAuditCaptureSealingEvent(c, { sealedAt: new Date(0) })).toThrow(
      /cannot parse claimed.occurredAt/,
    );
  });

  it('preserves captureSeq as the lossless decimal string', () => {
    const c = claimedRow({ captureSeq: '9007199254740993' /* 2^53 + 1 */ });
    const ev = buildAuditCaptureSealingEvent(c, { sealedAt: new Date(0) });
    const meta = ev.redactionMetadata['audit_sealer'] as Record<string, unknown>;
    expect(meta.capture_seq).toBe('9007199254740993');
  });
});

// -----------------------------------------------------------------------------
// 2b. auditCategoryChainId helper
// -----------------------------------------------------------------------------

describe('auditCategoryChainId', () => {
  it('mirrors the auditAppend category-chain convention `${orgId}:${category}`', () => {
    expect(auditCategoryChainId('11111111-1111-1111-1111-111111111111', 'run')).toBe(
      '11111111-1111-1111-1111-111111111111:run',
    );
    expect(auditCategoryChainId('org', 'auth')).toBe('org:auth');
    expect(auditCategoryChainId('org', 'policy')).toBe('org:policy');
    expect(auditCategoryChainId('org', 'admin')).toBe('org:admin');
  });

  it('is what buildAuditCaptureSealingEvent uses for the HMAC chain id', () => {
    const c = claimedRow({ chainCategory: 'run' });
    const ev = buildAuditCaptureSealingEvent(c, { sealedAt: new Date(0) });
    expect(ev.chainId).toBe(auditCategoryChainId(c.orgId, 'run'));
  });
});

// -----------------------------------------------------------------------------
// 3. claimAuditCaptureForSeal
// -----------------------------------------------------------------------------

describe('claimAuditCaptureForSeal', () => {
  it('returns null when the SQL function returns no row', async () => {
    const { client } = makeFakeClient({ responses: [{ rows: [], rowCount: 0 }] });
    const r = await claimAuditCaptureForSeal(client, {
      orgId: randomUUID(),
      chainId: 'org:x:run:y',
    });
    expect(r).toBeNull();
  });

  it('maps the row to ClaimedAuditCapture with bytea→hex and presence flags', async () => {
    const sample = claimedRow({
      hasPayloadEncrypted: true,
      hasDekWrapped: true,
      hasCaptureIntegrityTag: true,
      captureIntegrityAlg: 'kms_hmac_sha256',
      payloadHashHex: 'aa'.repeat(32),
    });
    const { client } = makeFakeClient({
      responses: [{ rows: [claimRowSqlShape(sample)], rowCount: 1 }],
    });
    const r = await claimAuditCaptureForSeal(client, {
      orgId: sample.orgId,
      chainId: sample.chainId,
    });
    expect(r).not.toBeNull();
    expect(r!.captureId).toBe(sample.captureId);
    expect(r!.captureSeq).toBe('1');
    expect(r!.payloadHashHex).toBe('aa'.repeat(32));
    expect(r!.hasPayloadEncrypted).toBe(true);
    expect(r!.hasDekWrapped).toBe(true);
    expect(r!.hasCaptureIntegrityTag).toBe(true);
    expect(r!.captureIntegrityAlg).toBe('kms_hmac_sha256');
    // The mapped object exposes presence flags, NOT the bytea bytes themselves.
    const dump = JSON.stringify(r);
    expect(dump).not.toContain('"payload_encrypted"');
    expect(dump).not.toContain('"dek_wrapped"');
    expect(dump).not.toContain('"capture_integrity_tag"');
  });

  it('passes the canonical chainLockKey as the 3rd SQL parameter', async () => {
    const sample = claimedRow();
    const { client, calls } = makeFakeClient({
      responses: [{ rows: [claimRowSqlShape(sample)], rowCount: 1 }],
    });
    await claimAuditCaptureForSeal(client, {
      orgId: sample.orgId,
      chainId: sample.chainId,
    });
    expect(calls).toHaveLength(1);
    const values = calls[0]!.values;
    expect(values[0]).toBe(sample.orgId);
    expect(values[1]).toBe(sample.chainId);
    // 3rd param is the decimal-string form of chainLockKey(chainId).
    expect(typeof values[2]).toBe('string');
    expect(/^-?\d+$/.test(values[2] as string)).toBe(true);
  });

  it('rejects non-UUID orgId before any SQL', async () => {
    const { client, calls } = makeFakeClient();
    await expect(
      claimAuditCaptureForSeal(client, { orgId: 'not-uuid', chainId: 'x' }),
    ).rejects.toThrow(/orgId must be a UUID/);
    expect(calls).toHaveLength(0);
  });

  it('rejects empty chainId before any SQL', async () => {
    const { client, calls } = makeFakeClient();
    await expect(
      claimAuditCaptureForSeal(client, { orgId: randomUUID(), chainId: '' }),
    ).rejects.toThrow(/chainId must be a non-empty string/);
    expect(calls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// 4. markAuditCaptureSealed
// -----------------------------------------------------------------------------

describe('markAuditCaptureSealed', () => {
  it('calls govai.audit_capture_mark_sealed with positional params', async () => {
    const { client, calls } = makeFakeClient({
      responses: [{ rows: [], rowCount: 0 }],
    });
    const orgId = randomUUID();
    const captureId = randomUUID();
    const auditEventId = randomUUID();
    await markAuditCaptureSealed(client, {
      orgId,
      chainId: 'org:x:run:y',
      captureId,
      auditEventId,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/audit_capture_mark_sealed/);
    expect(calls[0]!.values[0]).toBe(orgId);
    expect(calls[0]!.values[1]).toBe(captureId);
    expect(calls[0]!.values[2]).toBe(auditEventId);
    expect(typeof calls[0]!.values[3]).toBe('string'); // chain_lock_key as bigint string
  });

  it('rejects bad UUIDs before SQL', async () => {
    const { client, calls } = makeFakeClient();
    await expect(
      markAuditCaptureSealed(client, {
        orgId: 'bad',
        chainId: 'c',
        captureId: randomUUID(),
        auditEventId: randomUUID(),
      }),
    ).rejects.toThrow(/orgId must be a UUID/);
    expect(calls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// 5. markAuditCaptureFailed
// -----------------------------------------------------------------------------

describe('markAuditCaptureFailed', () => {
  it('passes sanitized errorClass + errorMessage to SQL', async () => {
    const { client, calls } = makeFakeClient({ responses: [{ rows: [], rowCount: 0 }] });
    const orgId = randomUUID();
    const captureId = randomUUID();
    const huge = new Error('x'.repeat(500));
    huge.name = 'KmsErr!@#';
    await markAuditCaptureFailed(client, { orgId, captureId, error: huge });

    expect(calls).toHaveLength(1);
    const args = calls[0]!.values;
    expect(args[0]).toBe(orgId);
    expect(args[1]).toBe(captureId);
    expect(args[2]).toBe('KmsErr'); // sanitized class
    const msg = args[3] as string;
    expect(msg.length).toBeLessThanOrEqual(__internal.SEALER_ERROR_MESSAGE_MAX);
    expect(msg.endsWith('…')).toBe(true);
  });

  it('accepts explicit errorClass + errorMessage form', async () => {
    const { client, calls } = makeFakeClient({ responses: [{ rows: [], rowCount: 0 }] });
    const orgId = randomUUID();
    const captureId = randomUUID();
    await markAuditCaptureFailed(client, {
      orgId,
      captureId,
      errorClass: 'kms_error',
      errorMessage: 'derive failed',
    });
    const args = calls[0]!.values;
    expect(args[2]).toBe('kms_error');
    expect(args[3]).toBe('derive failed');
  });

  it('rejects bad UUIDs before SQL', async () => {
    const { client, calls } = makeFakeClient();
    await expect(
      markAuditCaptureFailed(client, {
        orgId: 'bad',
        captureId: randomUUID(),
        errorMessage: 'x',
      }),
    ).rejects.toThrow(/orgId must be a UUID/);
    expect(calls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// 6. sealNextAuditCapture — idle path + side-effect proofs
// -----------------------------------------------------------------------------

describe('sealNextAuditCapture', () => {
  it('returns { status: "idle" } when the claim returns no row', async () => {
    const { client, calls } = makeFakeClient({ responses: [{ rows: [], rowCount: 0 }] });
    const r = await sealNextAuditCapture(client, {
      orgId: randomUUID(),
      chainId: 'org:x:run:y',
      kms: fakeKms(),
    });
    expect(r.status).toBe('idle');
    expect(r.claimed).toBe(false);
    // Only the claim was called: no auditAppend, no mark_sealed, no mark_failed.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/audit_capture_claim_for_seal/);
    expect(calls.some((c) => /audit_capture_mark_sealed/.test(c.sql))).toBe(false);
    expect(calls.some((c) => /audit_capture_mark_failed/.test(c.sql))).toBe(false);
    expect(calls.some((c) => /audit_append_locked/.test(c.sql))).toBe(false);
  });

  it('invokes withSealerPhaseRole exactly once for the "claim" phase before the SQL call (idle path)', async () => {
    const { client } = makeFakeClient({ responses: [{ rows: [], rowCount: 0 }] });
    const switched: AuditSealerPhase[] = [];
    const orgId = randomUUID();
    await sealNextAuditCapture(client, {
      orgId,
      chainId: 'org:x:run:y',
      kms: fakeKms(),
      withSealerPhaseRole: async (phase) => {
        switched.push(phase);
      },
    });
    expect(switched).toEqual(['claim']);
  });

  it('never executes BEGIN/COMMIT/ROLLBACK/SAVEPOINT/SET ROLE/RESET ROLE/set_config', async () => {
    const { client, calls } = makeFakeClient({ responses: [{ rows: [], rowCount: 0 }] });
    await sealNextAuditCapture(client, {
      orgId: randomUUID(),
      chainId: 'org:x:run:y',
      kms: fakeKms(),
    });
    const forbidden = calls.filter((c) =>
      /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|SET\s+ROLE|RESET\s+ROLE|SET\s+LOCAL\s+ROLE|set_config\s*\()/i.test(
        c.sql,
      ),
    );
    expect(forbidden).toEqual([]);
  });

  it('does NOT call markAuditCaptureFailed automatically if the claim itself throws', async () => {
    const err = new Error('claim explode');
    const { client, calls } = makeFakeClient({ throwOnCall: { n: 1, error: err } });
    await expect(
      sealNextAuditCapture(client, {
        orgId: randomUUID(),
        chainId: 'c',
        kms: fakeKms(),
      }),
    ).rejects.toThrow(/claim explode/);
    // Only the claim attempt was made; no mark_failed automatically.
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => /audit_capture_mark_failed/.test(c.sql))).toBe(false);
  });

  it('validates inputs before any SQL', async () => {
    const { client, calls } = makeFakeClient();
    await expect(
      sealNextAuditCapture(client, {
        orgId: 'bad',
        chainId: 'c',
        kms: fakeKms(),
      }),
    ).rejects.toThrow(/orgId must be a UUID/);
    expect(calls).toHaveLength(0);

    await expect(
      sealNextAuditCapture(client, {
        orgId: randomUUID(),
        chainId: '',
        kms: fakeKms(),
      }),
    ).rejects.toThrow(/chainId must be a non-empty string/);

    await expect(
      sealNextAuditCapture(client, {
        orgId: randomUUID(),
        chainId: 'c',
        // @ts-expect-error intentionally bad kms
        kms: null,
      }),
    ).rejects.toThrow(/kms instance is required/);

    await expect(
      sealNextAuditCapture(client, {
        orgId: randomUUID(),
        chainId: 'c',
        kms: fakeKms(),
        // @ts-expect-error intentionally bad withSealerPhaseRole
        withSealerPhaseRole: 'not-a-fn',
      }),
    ).rejects.toThrow(/withSealerPhaseRole, when provided, must be a function/);
  });

  it('the sealer module exposes the same function via the @govai/core-audit barrel', () => {
    // Re-import as namespace to assert export wiring without a separate
    // workspace alias round-trip. The barrel export is also covered by
    // the integration test via the package name.
    expect(typeof Sealer.sealNextAuditCapture).toBe('function');
    expect(Sealer.sealNextAuditCapture).toBe(sealNextAuditCapture);
    expect(Sealer.claimAuditCaptureForSeal).toBe(claimAuditCaptureForSeal);
    expect(Sealer.markAuditCaptureSealed).toBe(markAuditCaptureSealed);
    expect(Sealer.markAuditCaptureFailed).toBe(markAuditCaptureFailed);
    expect(Sealer.buildAuditCaptureSealingEvent).toBe(buildAuditCaptureSealingEvent);
    expect(Sealer.sanitizeSealerError).toBe(sanitizeSealerError);
    expect(Sealer.auditCategoryChainId).toBe(auditCategoryChainId);
  });
});
