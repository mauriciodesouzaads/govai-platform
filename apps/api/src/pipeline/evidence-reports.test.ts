import { describe, it, expect } from 'vitest';

import {
  EC_LABELS,
  NATIVE_CHAIN_CATEGORIES,
  nativeDropEstimate,
  ZERO_DROP_SNAPSHOT,
  coverageRatio,
  type EvidenceCounts,
} from './evidence-reports.js';

const COUNTS: EvidenceCounts = {
  ec1: { total: 10, sealed: 8, failed: 1, stalled_past_slo: 1 },
  ec2: { chains: 4, chains_with_gap: 1 },
  ec3seal: { native_total: 6, native_sealed: 5, native_unsealed_past_slo: 1 },
  ec4: { provider_invocations: 5, without_terminal: 1 },
  ec6: { chains: 3, verified_ok: 0, pending: 3 },
};

describe('EC labels — the §2 canonical mapping (normative)', () => {
  it('surfaces the provider-without-audit view under EC-4, NEVER EC-3', () => {
    // ★ The §2 label discipline: evidence_provider_without_audit (labeled "EC-3a"
    // in 0027) is the umbrella's EC-4 path-A detector. Its label must be EC-4.
    expect(EC_LABELS.ec4.startsWith('EC-4')).toBe(true);
    expect(EC_LABELS.ec4).not.toContain('EC-3');
  });

  it('keeps the two native EC-3 facets under EC-3', () => {
    expect(EC_LABELS.ec3seal.startsWith('EC-3')).toBe(true);
    expect(EC_LABELS.ec3drop.startsWith('EC-3')).toBe(true);
  });

  it('does not define an EC-5 label (deferred at this base)', () => {
    expect(Object.keys(EC_LABELS)).not.toContain('ec5');
  });

  it('treats chain_category=run as the native path-B category', () => {
    expect([...NATIVE_CHAIN_CATEGORIES]).toEqual(['run']);
  });
});

describe('nativeDropEstimate — EC-3.drop path-B proxy', () => {
  it('reports unobserved (null rate) on the zero snapshot', () => {
    const est = nativeDropEstimate(ZERO_DROP_SNAPSHOT);
    expect(est.invariant).toBe('ec3drop');
    expect(est.observed).toBe(false);
    expect(est.drop_rate).toBeNull();
    // The bound MUST state the (i)/(ii) precisions so coverage_ratio never over-claims.
    expect(est.bound).toContain('includes, does not isolate, streams-without-terminal');
    expect(est.bound).toContain('received-then-dropped, not never-emitted');
  });

  it('computes the drop rate on a simulated snapshot (drops>0)', () => {
    const est = nativeDropEstimate({ drops: 3, captures: 7 });
    expect(est.observed).toBe(true);
    expect(est.drops).toBe(3);
    expect(est.captures).toBe(7);
    expect(est.drop_rate).toBeCloseTo(0.3, 10);
  });

  it('clamps negative inputs', () => {
    const est = nativeDropEstimate({ drops: -5, captures: -2 });
    expect(est.drops).toBe(0);
    expect(est.captures).toBe(0);
    expect(est.observed).toBe(false);
  });
});

describe('coverageRatio — the headline conjunction', () => {
  it('excludes EC-6 (no persisted verification) — pending is not uncovered', () => {
    const cov = coverageRatio(COUNTS, nativeDropEstimate(ZERO_DROP_SNAPSHOT));
    expect(cov.excluded.map((e) => e.invariant)).toContain('ec6');
    expect(cov.terms.map((t) => t.invariant)).not.toContain('ec6');
  });

  it('excludes EC-3.drop when unobserved (never counts it as full coverage)', () => {
    const cov = coverageRatio(COUNTS, nativeDropEstimate(ZERO_DROP_SNAPSHOT));
    expect(cov.excluded.map((e) => e.invariant)).toContain('ec3drop');
    // covered/total over ec1+ec2+ec3seal+ec4 only.
    expect(cov.covered).toBe(8 + (4 - 1) + 5 + (5 - 1)); // 20
    expect(cov.total).toBe(10 + 4 + 6 + 5); // 25
    expect(cov.ratio).toBeCloseTo(20 / 25, 10);
  });

  it('folds EC-3.drop into the ratio once drops are observed', () => {
    const cov = coverageRatio(COUNTS, nativeDropEstimate({ drops: 2, captures: 8 }));
    expect(cov.terms.map((t) => t.invariant)).toContain('ec3drop');
    expect(cov.covered).toBe(20 + 8); // captures
    expect(cov.total).toBe(25 + 10); // captures + drops
  });

  it('counts healthy in-flight (unsealed but within T_seal) as COVERED — not "unsealed"', () => {
    // 10 captures: 5 sealed, 1 failed, 1 stalled-past-SLO, 3 healthy in-flight.
    // The EC-1 gap population is failed + stalled = 2, so covered = 10 − 2 = 8
    // (the 3 healthy in-flight count as covered) — NOT sealed = 5.
    const counts: EvidenceCounts = {
      ec1: { total: 10, sealed: 5, failed: 1, stalled_past_slo: 1 },
      ec2: { chains: 0, chains_with_gap: 0 },
      ec3seal: { native_total: 4, native_sealed: 1, native_unsealed_past_slo: 1 },
      ec4: { provider_invocations: 0, without_terminal: 0 },
      ec6: { chains: 0, verified_ok: 0, pending: 0 },
    };
    const cov = coverageRatio(counts, nativeDropEstimate(ZERO_DROP_SNAPSHOT));
    const ec1 = cov.terms.find((t) => t.invariant === 'ec1')!;
    expect(ec1.covered).toBe(8); // 10 − (1 failed + 1 stalled), NOT 5 sealed
    expect(ec1.total).toBe(10);
    const ec3 = cov.terms.find((t) => t.invariant === 'ec3seal')!;
    expect(ec3.covered).toBe(3); // 4 native − 1 native past-SLO, NOT 1 sealed
    expect(ec3.total).toBe(4);
  });

  it('is 1.0 when there are no units in scope', () => {
    const empty: EvidenceCounts = {
      ec1: { total: 0, sealed: 0, failed: 0, stalled_past_slo: 0 },
      ec2: { chains: 0, chains_with_gap: 0 },
      ec3seal: { native_total: 0, native_sealed: 0, native_unsealed_past_slo: 0 },
      ec4: { provider_invocations: 0, without_terminal: 0 },
      ec6: { chains: 0, verified_ok: 0, pending: 0 },
    };
    expect(coverageRatio(empty, nativeDropEstimate(ZERO_DROP_SNAPSHOT)).ratio).toBe(1.0);
  });
});
