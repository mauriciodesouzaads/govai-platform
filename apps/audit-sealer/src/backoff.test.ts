import { describe, it, expect } from 'vitest';
import { backoffBaseMs, jitter, backoffWithJitterMs } from './backoff.js';

const P = { minMs: 1000, maxMs: 30_000 };

describe('backoff', () => {
  it('is exponential and capped at maxMs', () => {
    expect(backoffBaseMs(0, P)).toBe(1000);
    expect(backoffBaseMs(1, P)).toBe(2000);
    expect(backoffBaseMs(2, P)).toBe(4000);
    expect(backoffBaseMs(4, P)).toBe(16_000);
    expect(backoffBaseMs(5, P)).toBe(30_000); // 32000 → capped
    expect(backoffBaseMs(100, P)).toBe(30_000); // no overflow at high attempts
  });

  it('treats a negative attempt as 0', () => {
    expect(backoffBaseMs(-3, P)).toBe(1000);
  });

  it('jitter stays within [base/2, base]', () => {
    expect(jitter(1000, () => 0)).toBe(500);
    expect(jitter(1000, () => 1)).toBe(1000);
    expect(jitter(1000, () => 0.5)).toBe(750);
  });

  it('backoffWithJitterMs composes base + jitter', () => {
    // attempt 1 → base 2000; rand 0 → half = 1000.
    expect(backoffWithJitterMs(1, P, () => 0)).toBe(1000);
    // rand 1 → full base.
    expect(backoffWithJitterMs(1, P, () => 1)).toBe(2000);
  });
});
