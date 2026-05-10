import { describe, it, expect } from 'vitest';
import { RISK_ORDER, type Capability, type RiskClass } from './capability.js';

describe('capability types', () => {
  it('RISK_ORDER monotonically increasing A→E', () => {
    const ordered: RiskClass[] = ['A', 'B', 'C', 'D', 'E'];
    for (let i = 1; i < ordered.length; i++) {
      expect(RISK_ORDER[ordered[i]!]).toBeGreaterThan(RISK_ORDER[ordered[i - 1]!]);
    }
  });

  it('compiles a representative supported capability shape', () => {
    const cap: Capability = {
      id: 'anthropic.messages.create',
      provider: 'anthropic',
      status: 'supported',
      level: 'policy_governed',
      base_risk_class: 'B',
      tier_availability: ['business', 'enterprise', 'regulated'],
      enforcement_default: 'observe',
      endpoint_coverage: [
        { method: 'POST', path: '/v1/messages', streams: false, multipart: false },
      ],
      beta_dependencies: [],
    };
    expect(cap.id).toBe('anthropic.messages.create');
  });

  it('compiles a representative blocked capability shape', () => {
    const cap: Capability = {
      id: 'anthropic.computer_use_tool',
      provider: 'anthropic',
      status: 'blocked',
      level: 'passthrough_audited',
      base_risk_class: 'D',
      tier_availability: [],
      enforcement_default: 'blocked',
      endpoint_coverage: [],
      beta_dependencies: [],
      blocked_reason: 'sandbox primitive missing',
    };
    expect(cap.status).toBe('blocked');
  });
});
