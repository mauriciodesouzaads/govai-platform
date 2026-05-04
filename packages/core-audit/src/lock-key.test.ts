import { describe, it, expect } from 'vitest';
import { chainLockKey } from './lock-key.js';

describe('chainLockKey', () => {
  it('returns deterministic value', () => {
    const a = chainLockKey('org-1:run');
    const b = chainLockKey('org-1:run');
    expect(a).toBe(b);
  });

  it('different inputs yield different bigint (smoke)', () => {
    expect(chainLockKey('a')).not.toBe(chainLockKey('b'));
  });

  it('returns BigInt within signed bigint64 range', () => {
    const v = chainLockKey('test');
    expect(typeof v).toBe('bigint');
    expect(v).toBeGreaterThanOrEqual(-(2n ** 63n));
    expect(v).toBeLessThan(2n ** 63n);
  });

  it('50000 deterministic chain_ids: zero collisions', () => {
    // Gera 50000 chain_ids deterministicamente: org-NNNN:category
    const cats = ['auth', 'run', 'policy', 'admin'];
    const set = new Set<bigint>();
    for (let i = 0; i < 12500; i++) {
      const org = `00000000-0000-0000-0000-${i.toString(16).padStart(12, '0')}`;
      for (const c of cats) {
        set.add(chainLockKey(`${org}:${c}`));
      }
    }
    expect(set.size).toBe(50000);
  });
});
