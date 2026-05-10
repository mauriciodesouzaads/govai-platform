import { describe, it, expect } from 'vitest';
import { computeEnforcement } from './enforcement.js';

describe('computeEnforcement — Tier × Risk × Mode policy matrix', () => {
  it('dev mode → observe regardless of tier/risk', () => {
    expect(computeEnforcement({ tier: 'starter', effective_risk_class: 'E', operational_mode: 'dev' }).mode).toBe('observe');
    expect(computeEnforcement({ tier: 'regulated', effective_risk_class: 'A', operational_mode: 'dev' }).mode).toBe('observe');
  });

  it('test mode → observe regardless of tier/risk', () => {
    expect(computeEnforcement({ tier: 'business', effective_risk_class: 'D', operational_mode: 'test' }).mode).toBe('observe');
  });

  it('production + risk=E → blocked regardless of tier', () => {
    for (const tier of ['starter', 'business', 'enterprise', 'regulated'] as const) {
      const r = computeEnforcement({ tier, effective_risk_class: 'E', operational_mode: 'production' });
      expect(r.mode).toBe('blocked');
    }
  });

  it('production + risk=D + starter → blocked', () => {
    expect(
      computeEnforcement({ tier: 'starter', effective_risk_class: 'D', operational_mode: 'production' }).mode,
    ).toBe('blocked');
  });

  it('production + risk=D + business → sandbox_required', () => {
    const r = computeEnforcement({ tier: 'business', effective_risk_class: 'D', operational_mode: 'production' });
    expect(r.mode).toBe('sandbox_required');
    expect(r.preconditions?.some((p) => 'sandbox_environment_required' in p)).toBe(true);
  });

  it('production + risk=D + enterprise → enforce + sandbox precondition', () => {
    const r = computeEnforcement({ tier: 'enterprise', effective_risk_class: 'D', operational_mode: 'production' });
    expect(r.mode).toBe('enforce');
    expect(r.preconditions?.some((p) => 'sandbox_environment_required' in p)).toBe(true);
  });

  it('production + risk=C + starter → ask', () => {
    const r = computeEnforcement({ tier: 'starter', effective_risk_class: 'C', operational_mode: 'production' });
    expect(r.mode).toBe('ask');
    expect(r.side_effects?.some((s) => 'audit_detail_level' in s)).toBe(true);
  });

  it('production + risk=C + business → enforce + dlp pre-scan', () => {
    const r = computeEnforcement({ tier: 'business', effective_risk_class: 'C', operational_mode: 'production' });
    expect(r.mode).toBe('enforce');
    expect(
      r.side_effects?.some((s) => 'dlp_pre_scan_required' in s && s.dlp_pre_scan_required),
    ).toBe(true);
  });

  it('production + risk=B → warn (any tier)', () => {
    expect(
      computeEnforcement({ tier: 'enterprise', effective_risk_class: 'B', operational_mode: 'production' }).mode,
    ).toBe('warn');
  });

  it('production + risk=A → observe (any tier)', () => {
    expect(
      computeEnforcement({ tier: 'starter', effective_risk_class: 'A', operational_mode: 'production' }).mode,
    ).toBe('observe');
  });

  it('pilot relaxes one notch from production: starter+D blocked → sandbox_required', () => {
    const r = computeEnforcement({ tier: 'starter', effective_risk_class: 'D', operational_mode: 'pilot' });
    expect(r.mode).toBe('sandbox_required');
  });

  it('pilot relaxes business+C enforce → ask', () => {
    const r = computeEnforcement({ tier: 'business', effective_risk_class: 'C', operational_mode: 'pilot' });
    expect(r.mode).toBe('ask');
  });

  it('floor: anthropic_provider_hosted_computer_use → at least sandbox_required', () => {
    // Even if pilot would relax to a lower mode, computer_use floors at sandbox_required.
    const r = computeEnforcement({
      tier: 'enterprise',
      effective_risk_class: 'A',
      operational_mode: 'pilot',
      tool_classification: 'anthropic_provider_hosted_computer_use',
    });
    expect(r.mode).toBe('sandbox_required');
  });

  it('floor: openai_provider_hosted_computer_use under starter+B → sandbox_required', () => {
    const r = computeEnforcement({
      tier: 'starter',
      effective_risk_class: 'B',
      operational_mode: 'production',
      tool_classification: 'openai_provider_hosted_computer_use',
    });
    expect(r.mode).toBe('sandbox_required');
  });

  it('non-computer_use tool classification does not raise floor', () => {
    const r = computeEnforcement({
      tier: 'enterprise',
      effective_risk_class: 'A',
      operational_mode: 'production',
      tool_classification: 'anthropic_provider_hosted_web_search',
    });
    expect(r.mode).toBe('observe');
  });
});
