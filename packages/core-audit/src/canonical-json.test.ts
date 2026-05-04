import { describe, it, expect } from 'vitest';
import { canonicalize } from './canonical-json.js';

describe('canonicalize', () => {
  it('orders object keys lexicographically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('handles nested objects deterministically', () => {
    const a = canonicalize({ z: { y: 1, x: 2 }, a: 3 });
    const b = canonicalize({ a: 3, z: { x: 2, y: 1 } });
    expect(a).toBe(b);
  });

  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('rejects undefined values at root', () => {
    expect(() => canonicalize(undefined)).toThrow();
  });

  it('skips undefined at object property', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('rejects NaN/Infinity', () => {
    expect(() => canonicalize(Number.NaN)).toThrow();
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('rejects bigint', () => {
    expect(() => canonicalize(1n)).toThrow();
  });

  it('escapes strings via JSON.stringify', () => {
    expect(canonicalize('a"b')).toBe('"a\\"b"');
    expect(canonicalize('é')).toBe('"é"');
  });

  it('null is serialized', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize({ a: null })).toBe('{"a":null}');
  });

  it('idempotent: canonicalize(parse(canonicalize(x))) === canonicalize(x)', () => {
    const x = { z: 1, a: [3, 2, 1], n: { b: true, a: false } };
    const c1 = canonicalize(x);
    const c2 = canonicalize(JSON.parse(c1));
    expect(c2).toBe(c1);
  });
});
