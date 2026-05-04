import { describe, it, expect } from 'vitest';
import { Capability, resolveEffectiveLevel } from './capability.js';
import { BASELINE_REGISTRY, validateRegistry } from './registry.js';

describe('capability schema', () => {
  it('validates baseline registry', () => {
    expect(() => validateRegistry()).not.toThrow();
    expect(BASELINE_REGISTRY.length).toBeGreaterThan(0);
  });

  it('rejects level=3 facet without evidence_strength', () => {
    expect(() =>
      Capability.parse({
        id: 'x',
        provider: 'anthropic',
        status: 'supported',
        facets: [{ id: 'f', level: 3, status: 'supported' }],
      }),
    ).toThrow();
  });
});

describe('override resolver (downgrade-only)', () => {
  it('allows downgrade', () => {
    expect(resolveEffectiveLevel(3, { level_override: 1 }).level).toBe(1);
  });
  it('rejects upgrade', () => {
    expect(() => resolveEffectiveLevel(1, { level_override: 3 })).toThrow(/upgrade not allowed/);
  });
  it('blocked status forces level 0', () => {
    expect(resolveEffectiveLevel(2, { status_override: 'blocked' }).level).toBe(0);
  });
});
