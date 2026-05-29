// B1 unit tests for captureAuditEvent input validation.
//
// These tests do NOT touch a database. They lock down the synchronous
// validation surface so callers see sharp errors before any SQL round-trip.
// Integration tests (DB + idempotency + composability + tenant guard) live
// in tests/integration/audit-capture-bridge.test.ts.

import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  captureAuditEvent,
  type CaptureAuditEventInput,
  ALL_BANNED_REDACTION_KEYS,
  SQL_BANNED_REDACTION_KEYS,
  TS_BANNED_REDACTION_KEYS,
} from './capture.js';

function validBaseInput(): CaptureAuditEventInput {
  return {
    captureId: randomUUID(),
    orgId: randomUUID(),
    chainId: `org:${randomUUID()}:run:${randomUUID()}`,
    chainCategory: 'run',
    eventType: 'passthrough.invoked',
    eventVersion: '3',
    subjectType: 'run',
    subjectId: randomUUID(),
    occurredAt: new Date(),
    payloadHash: Buffer.from('00'.repeat(32), 'hex'),
    keyId: 'audit-1',
    keyVersion: 1,
  };
}

// A fake PoolClient that captures the query call so unit tests can assert
// validation runs BEFORE any SQL. Returns a single-row OK response for the
// few tests that exercise the success path through the adapter.
function makeFakeClient(): { client: PoolClient; calls: Array<{ sql: string; values: unknown[] }> } {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, values: unknown[]) => {
      calls.push({ sql, values });
      return {
        rows: [{ capture_id: String(values[0]), capture_seq: '1' }],
        rowCount: 1,
      };
    }),
  } as unknown as PoolClient;
  return { client, calls };
}

describe('captureAuditEvent / input validation', () => {
  it('rejects non-UUID captureId before any SQL', async () => {
    const { client, calls } = makeFakeClient();
    const input = { ...validBaseInput(), captureId: 'not-a-uuid' };
    await expect(captureAuditEvent(client, input)).rejects.toThrow(/captureId must be a UUID/);
    expect(calls).toHaveLength(0);
  });

  it('rejects non-UUID orgId before any SQL', async () => {
    const { client, calls } = makeFakeClient();
    const input = { ...validBaseInput(), orgId: '0001' };
    await expect(captureAuditEvent(client, input)).rejects.toThrow(/orgId must be a UUID/);
    expect(calls).toHaveLength(0);
  });

  it('rejects non-UUID subjectId before any SQL', async () => {
    const { client, calls } = makeFakeClient();
    const input = { ...validBaseInput(), subjectId: 'subject' };
    await expect(captureAuditEvent(client, input)).rejects.toThrow(/subjectId must be a UUID/);
    expect(calls).toHaveLength(0);
  });

  it('rejects empty chainId', async () => {
    const { client } = makeFakeClient();
    const input = { ...validBaseInput(), chainId: '' };
    await expect(captureAuditEvent(client, input)).rejects.toThrow(/chainId must be a non-empty string/);
  });

  it('rejects invalid chainCategory', async () => {
    const { client } = makeFakeClient();
    const input = { ...validBaseInput(), chainCategory: 'bogus' as 'run' };
    await expect(captureAuditEvent(client, input)).rejects.toThrow(/chainCategory must be one of/);
  });

  it('rejects empty eventType / eventVersion / subjectType / keyId', async () => {
    const { client } = makeFakeClient();
    for (const field of ['eventType', 'eventVersion', 'subjectType', 'keyId'] as const) {
      const input = { ...validBaseInput(), [field]: '' } as CaptureAuditEventInput;
      await expect(captureAuditEvent(client, input)).rejects.toThrow(
        new RegExp(`${field} must be a non-empty string`),
      );
    }
  });

  it('rejects negative or non-integer keyVersion', async () => {
    const { client } = makeFakeClient();
    for (const v of [-1, 1.5, Number.NaN, '1' as unknown as number]) {
      const input = { ...validBaseInput(), keyVersion: v as number };
      await expect(captureAuditEvent(client, input)).rejects.toThrow(/keyVersion must be a non-negative integer/);
    }
  });

  it('rejects missing payloadHash', async () => {
    const { client } = makeFakeClient();
    const input = { ...validBaseInput(), payloadHash: undefined as unknown as Buffer };
    await expect(captureAuditEvent(client, input)).rejects.toThrow(/payloadHash is required/);
  });

  it('rejects invalid posture', async () => {
    const { client } = makeFakeClient();
    const input = { ...validBaseInput(), posture: 'mild' as 'strict' };
    await expect(captureAuditEvent(client, input)).rejects.toThrow(/posture must be one of/);
  });

  it('rejects integrity tag without alg and vice-versa', async () => {
    const { client } = makeFakeClient();
    const tag = Buffer.from('aa'.repeat(32), 'hex');

    await expect(
      captureAuditEvent(client, { ...validBaseInput(), captureIntegrityTag: tag }),
    ).rejects.toThrow(/both set or both omitted/);

    await expect(
      captureAuditEvent(client, { ...validBaseInput(), captureIntegrityAlg: 'sha256_digest' }),
    ).rejects.toThrow(/both set or both omitted/);
  });

  it('rejects unknown captureIntegrityAlg even with tag set', async () => {
    const { client } = makeFakeClient();
    const tag = Buffer.from('aa'.repeat(32), 'hex');
    const input = {
      ...validBaseInput(),
      captureIntegrityTag: tag,
      captureIntegrityAlg: 'md5' as 'sha256_digest',
    };
    await expect(captureAuditEvent(client, input)).rejects.toThrow(/captureIntegrityAlg must be/);
  });

  it('accepts a valid (tag, alg) pair and forwards to SQL', async () => {
    const { client, calls } = makeFakeClient();
    const tag = Buffer.from('aa'.repeat(32), 'hex');
    const input: CaptureAuditEventInput = {
      ...validBaseInput(),
      captureIntegrityTag: tag,
      captureIntegrityAlg: 'sha256_digest',
    };
    const r = await captureAuditEvent(client, input);
    expect(r.captureSeq).toBe('1');
    expect(calls).toHaveLength(1);
    // $18 (capture_integrity_tag) carries the Buffer; $19 (alg) is the string.
    expect(calls[0]!.values[17]).toEqual(tag);
    expect(calls[0]!.values[18]).toBe('sha256_digest');
  });

  it('rejects redactionMetadata that is not a plain object', async () => {
    const { client } = makeFakeClient();
    for (const bad of [[1, 2, 3], 'str', 42, true]) {
      const input = {
        ...validBaseInput(),
        redactionMetadata: bad as unknown as Record<string, unknown>,
      };
      await expect(captureAuditEvent(client, input)).rejects.toThrow(/must be a plain object/);
    }
  });

  it('rejects each B0+B1 banned top-level redaction key', async () => {
    const { client } = makeFakeClient();
    for (const key of ALL_BANNED_REDACTION_KEYS) {
      const input = {
        ...validBaseInput(),
        redactionMetadata: { [key]: 'leak' } as Record<string, unknown>,
      };
      await expect(captureAuditEvent(client, input)).rejects.toThrow(
        new RegExp(`must not contain top-level "${key}"`),
      );
    }
  });

  it('exposes both the SQL-side and TS-only banned key sets', () => {
    expect(SQL_BANNED_REDACTION_KEYS).toEqual(['prompt', 'response', 'raw_input', 'raw_output']);
    expect(TS_BANNED_REDACTION_KEYS).toEqual([
      'messages',
      'completion',
      'requestBody',
      'responseBody',
    ]);
    // Sanity: union has no duplicates.
    expect(new Set(ALL_BANNED_REDACTION_KEYS).size).toBe(ALL_BANNED_REDACTION_KEYS.length);
  });

  it('allows nested occurrences of banned keys (B1 guard is top-level only)', async () => {
    const { client, calls } = makeFakeClient();
    const input: CaptureAuditEventInput = {
      ...validBaseInput(),
      redactionMetadata: {
        surface: 'provider-native',
        // Banned only at top level — nested usage stays allowed in B0/B1.
        // Deep-JSON redaction is a future AuditBridge capability.
        details: { prompt: '<sanitized-summary>', messages: { count: 3 } },
      },
    };
    const r = await captureAuditEvent(client, input);
    expect(r.captureSeq).toBe('1');
    expect(calls).toHaveLength(1);
    const jsonbParam = calls[0]!.values[15] as string;
    expect(jsonbParam).toContain('"details"');
    expect(jsonbParam).toContain('"prompt"');
  });

  it('rejects occurredAt of wrong type and Invalid Date', async () => {
    const { client } = makeFakeClient();
    await expect(
      captureAuditEvent(client, { ...validBaseInput(), occurredAt: 123 as unknown as Date }),
    ).rejects.toThrow(/occurredAt must be a Date or ISO-8601 string/);

    await expect(
      captureAuditEvent(client, { ...validBaseInput(), occurredAt: new Date('not-a-date') }),
    ).rejects.toThrow(/Invalid Date/);
  });

  it('marshals occurredAt Date to ISO string parameter', async () => {
    const { client, calls } = makeFakeClient();
    const d = new Date('2026-05-27T10:11:12.345Z');
    await captureAuditEvent(client, { ...validBaseInput(), occurredAt: d });
    expect(calls[0]!.values[9]).toBe('2026-05-27T10:11:12.345Z');
  });

  it('marshals Uint8Array payloadHash to Buffer for pg', async () => {
    const { client, calls } = makeFakeClient();
    const hash = new Uint8Array(32).fill(0x42);
    await captureAuditEvent(client, { ...validBaseInput(), payloadHash: hash });
    expect(Buffer.isBuffer(calls[0]!.values[10])).toBe(true);
    expect((calls[0]!.values[10] as Buffer).length).toBe(32);
  });

  it('defaults redactionMetadata to empty object jsonb', async () => {
    const { client, calls } = makeFakeClient();
    await captureAuditEvent(client, validBaseInput());
    expect(calls[0]!.values[15]).toBe('{}');
  });

  it('defaults posture to best_effort and evidenceStrength to hmac_internal', async () => {
    const { client, calls } = makeFakeClient();
    await captureAuditEvent(client, validBaseInput());
    expect(calls[0]!.values[16]).toBe('hmac_internal'); // p_evidence_strength
    expect(calls[0]!.values[19]).toBe('best_effort'); // p_posture
  });

  it('returns captureSeq as string (not number, not bigint)', async () => {
    const { client } = makeFakeClient();
    const r = await captureAuditEvent(client, validBaseInput());
    expect(typeof r.captureSeq).toBe('string');
    expect(r.captureSeq).toBe('1');
  });
});
