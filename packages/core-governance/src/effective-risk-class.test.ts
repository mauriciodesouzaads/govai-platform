import { describe, it, expect } from 'vitest';
import { computeEffectiveRiskClass } from './effective-risk-class.js';
import type { RiskClass } from '@govai/core-types';

describe('computeEffectiveRiskClass', () => {
  it('returns base when there are no escalations', () => {
    expect(computeEffectiveRiskClass('A', [])).toBe('A');
    expect(computeEffectiveRiskClass('C', [])).toBe('C');
  });

  it('skips escalations whose `from` does not match base', () => {
    expect(
      computeEffectiveRiskClass('A', [
        { reason: 'irrelevant', base_to_effective: { from: 'B', to: 'D' } },
      ]),
    ).toBe('A');
  });

  it('applies a single matching escalation', () => {
    expect(
      computeEffectiveRiskClass('B', [
        { reason: 'tool_provider_hosted', base_to_effective: { from: 'B', to: 'D' } },
      ]),
    ).toBe('D');
  });

  it('applies max across multiple matching escalations', () => {
    const r = computeEffectiveRiskClass('B', [
      { reason: 'r1', base_to_effective: { from: 'B', to: 'C' } },
      { reason: 'r2', base_to_effective: { from: 'B', to: 'E' } },
      { reason: 'r3', base_to_effective: { from: 'B', to: 'D' } },
    ]);
    expect(r).toBe('E');
  });

  it('escalation that targets a lower class is ignored', () => {
    expect(
      computeEffectiveRiskClass('D', [
        { reason: 'soft', base_to_effective: { from: 'D', to: 'B' } },
      ]),
    ).toBe('D');
  });

  it('handles every level pair without throwing', () => {
    const all: RiskClass[] = ['A', 'B', 'C', 'D', 'E'];
    for (const a of all) {
      for (const b of all) {
        expect(() =>
          computeEffectiveRiskClass(a, [
            { reason: 'x', base_to_effective: { from: a, to: b } },
          ]),
        ).not.toThrow();
      }
    }
  });
});
