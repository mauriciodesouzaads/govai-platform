// Unit tests for ADR-023 Option A(b) explicit-eventId behavior in auditAppend.
//
// No database: a fake PoolClient records SQL and returns scripted rows. The
// kms is faked to satisfy hmacSign on the new-append path. No provider traffic,
// no transaction control, no AuditBridge, no runner.

import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { Kms } from '@govai/core-identity';

import { auditAppend, type AuditAppendInput } from './append.js';

const ORG = '55555555-5555-4555-8555-555555555555';
const SUBJECT = '66666666-6666-4666-8666-666666666666';
const EVENT_ID = '77777777-7777-4777-8777-777777777777';
const CAP_A = '22222222-2222-4222-8222-222222222222';
const CAP_B = '33333333-3333-4333-8333-333333333333';

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
  const client = { query: queryFn } as unknown as PoolClient;
  return { client, calls };
}

function fakeKms(): Kms {
  return {
    hmacSha256: async () => new Uint8Array(32).fill(7),
  } as unknown as Kms;
}

function baseInput(overrides: Partial<AuditAppendInput> = {}): AuditAppendInput {
  return {
    orgId: ORG,
    chainId: `${ORG}:run`,
    eventType: 'passthrough.invoked',
    eventVersion: '3',
    subjectType: 'run',
    subjectId: SUBJECT,
    occurredAt: new Date('2026-05-27T12:00:00.000Z'),
    payloadHash: Buffer.from('00'.repeat(32), 'hex'),
    keyId: 'audit-1',
    keyVersion: 1,
    redactionMetadata: { surface: 'provider-native' },
    evidenceStrength: 'hmac_internal',
    ...overrides,
  };
}

function existingRowFor(
  input: AuditAppendInput,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: input.eventId,
    org_id: input.orgId,
    chain_id: input.chainId,
    sequence_number: '7',
    event_type: input.eventType,
    event_version: input.eventVersion,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    occurred_at: input.occurredAt.toISOString(),
    payload_hash: Buffer.from(input.payloadHash),
    payload_ref: null,
    redaction_metadata: input.redactionMetadata,
    hmac: Buffer.from('aa'.repeat(32), 'hex'),
    canonical_hash: Buffer.from('bb'.repeat(32), 'hex'),
    canonical_bytes: Buffer.from(`{"event_id":"${input.eventId}","seq":7}`, 'utf8'),
    key_id: input.keyId,
    key_version: input.keyVersion,
    evidence_strength: input.evidenceStrength ?? 'hmac_internal',
    ...overrides,
  };
}

function classify(sql: string): string {
  if (sql.includes("current_setting('app.org_id'")) return 'tenant';
  if (sql.includes('pg_advisory_xact_lock')) return 'lock';
  if (sql.includes('WHERE id = $1::uuid')) return 'lookup';
  if (sql.includes('ORDER BY sequence_number DESC')) return 'head';
  if (sql.includes('audit_append_locked')) return 'append';
  return 'other';
}

const tenantOk = { rows: [{ v: ORG }] };
const empty = { rows: [] };

describe('auditAppend explicit eventId — new-append path', () => {
  it('accepts an explicit eventId and threads it to the append SQL + canonical', async () => {
    const input = baseInput({ eventId: EVENT_ID });
    const { client, calls } = makeFakeClient({
      responses: [tenantOk, empty, empty /*lookup miss*/, empty /*head*/, empty /*append*/],
    });
    const out = await auditAppend(client, fakeKms(), input);

    expect(out.eventId).toBe(EVENT_ID);
    expect(out.canonical).toContain(EVENT_ID);
    const append = calls.find((c) => c.sql.includes('audit_append_locked'));
    expect(append).toBeTruthy();
    expect(append!.values[0]).toBe(EVENT_ID); // p_event_id is the first SQL arg
  });

  it('generates a random eventId and does NOT look up by id when eventId is absent', async () => {
    const input = baseInput(); // no eventId
    const { client, calls } = makeFakeClient({
      responses: [tenantOk, empty /*lock*/, empty /*head*/, empty /*append*/],
    });
    const out = await auditAppend(client, fakeKms(), input);

    expect(out.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(calls.some((c) => c.sql.includes('WHERE id = $1::uuid'))).toBe(false);
    const append = calls.find((c) => c.sql.includes('audit_append_locked'));
    expect(append!.values[0]).toBe(out.eventId);
  });

  it('looks up audit_events AFTER the advisory lock and BEFORE head/append', async () => {
    const input = baseInput({ eventId: EVENT_ID });
    const { client, calls } = makeFakeClient({
      responses: [tenantOk, empty, empty, empty, empty],
    });
    await auditAppend(client, fakeKms(), input);

    const order = calls.map((c) => classify(c.sql));
    expect(order).toEqual(['tenant', 'lock', 'lookup', 'head', 'append']);
    expect(order.indexOf('lookup')).toBeGreaterThan(order.indexOf('lock'));
    expect(order.indexOf('lookup')).toBeLessThan(order.indexOf('head'));
  });
});

describe('auditAppend explicit eventId — existing-event reuse', () => {
  it('returns the existing event without appending when the id already exists', async () => {
    const input = baseInput({ eventId: EVENT_ID });
    const { client, calls } = makeFakeClient({
      responses: [tenantOk, empty, { rows: [existingRowFor(input)] }],
    });
    const out = await auditAppend(client, fakeKms(), input);

    expect(out.eventId).toBe(EVENT_ID);
    expect(out.sequenceNumber).toBe(7n);
    // No head read, no append SQL, no payload insert.
    expect(calls.some((c) => c.sql.includes('ORDER BY sequence_number DESC'))).toBe(false);
    expect(calls.some((c) => c.sql.includes('audit_append_locked'))).toBe(false);
  });

  it('reuses an existing event even though audit_event_capture_refs is never consulted', async () => {
    // auditAppend only ever reads govai.audit_events by id; it never reads
    // audit_event_capture_refs. So a missing ref (the append-succeeded /
    // mark_sealed-failed case) cannot hide the orphan append.
    const input = baseInput({ eventId: EVENT_ID });
    const { client, calls } = makeFakeClient({
      responses: [tenantOk, empty, { rows: [existingRowFor(input)] }],
    });
    await auditAppend(client, fakeKms(), input);
    expect(calls.some((c) => c.sql.includes('audit_event_capture_refs'))).toBe(false);
    expect(calls.some((c) => c.sql.includes('audit_append_locked'))).toBe(false);
  });

  it('fails safe (no append) when an existing event diverges on payload_hash', async () => {
    const input = baseInput({ eventId: EVENT_ID });
    const existing = existingRowFor(input, {
      payload_hash: Buffer.from('ff'.repeat(32), 'hex'),
    });
    const { client, calls } = makeFakeClient({
      responses: [tenantOk, empty, { rows: [existing] }],
    });
    await expect(auditAppend(client, fakeKms(), input)).rejects.toThrow(
      /divergent immutable content \(mismatch: payload_hash\)/,
    );
    expect(calls.some((c) => c.sql.includes('audit_append_locked'))).toBe(false);
  });

  it('fails safe when the existing event audit_sealer.capture_id diverges', async () => {
    const input = baseInput({
      eventId: EVENT_ID,
      redactionMetadata: { audit_sealer: { capture_id: CAP_A } },
    });
    const existing = existingRowFor(input, {
      redaction_metadata: { audit_sealer: { capture_id: CAP_B } },
    });
    const { client, calls } = makeFakeClient({
      responses: [tenantOk, empty, { rows: [existing] }],
    });
    await expect(auditAppend(client, fakeKms(), input)).rejects.toThrow(
      /mismatch: redaction_metadata\.audit_sealer\.capture_id/,
    );
    expect(calls.some((c) => c.sql.includes('audit_append_locked'))).toBe(false);
  });
});

describe('auditAppend explicit eventId — serialized, no 23505 race', () => {
  it('serialized explicit event id lookup reuses existing event', async () => {
    const input = baseInput({ eventId: EVENT_ID });

    // Attempt 1: lookup misses → append happens.
    const first = makeFakeClient({ responses: [tenantOk, empty, empty, empty, empty] });
    const out1 = await auditAppend(first.client, fakeKms(), input);
    expect(first.calls.some((c) => c.sql.includes('audit_append_locked'))).toBe(true);

    // Attempt 2 (after attempt 1 committed): lookup hits → no append, no 23505.
    const second = makeFakeClient({
      responses: [tenantOk, empty, { rows: [existingRowFor(input)] }],
    });
    const out2 = await auditAppend(second.client, fakeKms(), input);
    expect(out2.eventId).toBe(out1.eventId);
    expect(second.calls.some((c) => c.sql.includes('audit_append_locked'))).toBe(false);
  });
});

describe('auditAppend explicit eventId — doctrine guards', () => {
  it('rejects a non-UUID explicit eventId before touching the chain', async () => {
    const input = baseInput({ eventId: 'not-a-uuid' });
    const { client, calls } = makeFakeClient({ responses: [tenantOk] });
    await expect(auditAppend(client, fakeKms(), input)).rejects.toThrow(
      /eventId, when provided, must be a UUID/,
    );
    expect(calls.some((c) => c.sql.includes('audit_append_locked'))).toBe(false);
  });

  it('emits no BEGIN/COMMIT/ROLLBACK/SAVEPOINT/SET ROLE on any explicit-eventId path', async () => {
    const input = baseInput({ eventId: EVENT_ID });
    const found = makeFakeClient({
      responses: [tenantOk, empty, { rows: [existingRowFor(input)] }],
    });
    await auditAppend(found.client, fakeKms(), input);
    const created = makeFakeClient({ responses: [tenantOk, empty, empty, empty, empty] });
    await auditAppend(created.client, fakeKms(), input);

    const forbidden = /\b(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|SET\s+ROLE|RESET\s+ROLE)\b/i;
    for (const c of [...found.calls, ...created.calls]) {
      expect(c.sql).not.toMatch(forbidden);
    }
  });
});
