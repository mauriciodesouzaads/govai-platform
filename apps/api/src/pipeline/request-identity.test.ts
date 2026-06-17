import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import { buildRequestIdentity, InvalidIdempotencyKeyError } from './request-identity.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('buildRequestIdentity (SPEC-01 §2 / ADR-028 §3)', () => {
  it('no header => scope govai_request_id, fresh UUIDv4, no key hash', () => {
    const id = buildRequestIdentity();
    expect(id.identityScope).toBe('govai_request_id');
    expect(id.idempotencyKeyHash).toBeUndefined();
    expect(id.govaiRequestId).toMatch(UUID_V4);
  });

  it('generates a unique govaiRequestId on every call', () => {
    expect(buildRequestIdentity().govaiRequestId).not.toBe(buildRequestIdentity().govaiRequestId);
  });

  it('valid header => scope client_idempotency_key + sha256 lowercase hex; raw never retained', () => {
    const id = buildRequestIdentity('  My-Key-123  ');
    expect(id.identityScope).toBe('client_idempotency_key');
    expect(id.idempotencyKeyHash).toBe(
      createHash('sha256').update('My-Key-123', 'utf8').digest('hex'),
    );
    expect(JSON.stringify(id)).not.toContain('My-Key-123');
    expect(id.govaiRequestId).toMatch(UUID_V4);
  });

  it('trims before hashing (whitespace-only differences collapse)', () => {
    expect(buildRequestIdentity('k').idempotencyKeyHash).toBe(
      buildRequestIdentity('  k  ').idempotencyKeyHash,
    );
  });

  it('rejects empty-after-trim', () => {
    expect(() => buildRequestIdentity('   ')).toThrow(InvalidIdempotencyKeyError);
  });

  it('rejects keys longer than 256 chars; accepts exactly 256', () => {
    expect(() => buildRequestIdentity('x'.repeat(257))).toThrow(/256/);
    expect(buildRequestIdentity('x'.repeat(256)).identityScope).toBe('client_idempotency_key');
  });

  it('rejects control characters (NUL, US, DEL)', () => {
    const NUL = String.fromCharCode(0x00);
    const US = String.fromCharCode(0x1f);
    const DEL = String.fromCharCode(0x7f);
    expect(() => buildRequestIdentity(`a${NUL}b`)).toThrow(/control/);
    expect(() => buildRequestIdentity(`a${US}b`)).toThrow(InvalidIdempotencyKeyError);
    expect(() => buildRequestIdentity(`a${DEL}b`)).toThrow(/control/);
  });

  it('InvalidIdempotencyKeyError carries the HTTP-400 mapping code', () => {
    try {
      buildRequestIdentity('');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidIdempotencyKeyError);
      expect((e as InvalidIdempotencyKeyError).code).toBe('invalid_idempotency_key');
    }
  });
});
