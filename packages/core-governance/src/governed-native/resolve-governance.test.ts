// resolve-governance — pure unit tests for the real governance resolver.

import { describe, it, expect } from 'vitest';
import { resolveGovernance } from './resolve-governance.js';
import type { Capability } from '@govai/core-types';

const POLICY_GOVERNED: Capability = {
  id: 'anthropic.messages.create',
  provider: 'anthropic',
  status: 'supported',
  level: 'policy_governed',
  base_risk_class: 'A',
  tier_availability: ['starter', 'business', 'enterprise', 'regulated'],
  enforcement_default: 'enforce',
  endpoint_coverage: [],
  beta_dependencies: [],
};

describe('resolveGovernance — real governance computation', () => {
  it('clean request, starter tier, dev mode → observe (no escalations)', () => {
    const r = resolveGovernance({
      capability: POLICY_GOVERNED,
      tenant_tier: 'starter',
      operational_mode: 'dev',
      tool_classifications: [],
      dlp_findings: [],
    });
    expect(r.base_risk_class).toBe('A');
    expect(r.effective_risk_class).toBe('A');
    expect(r.risk_escalation_reasons).toEqual([]);
    expect(r.enforcement_decision).toBe('observe');
  });

  it('CPF finding escalates A → C and adds reason; pilot → ask (relaxed enforce)', () => {
    const r = resolveGovernance({
      capability: POLICY_GOVERNED,
      tenant_tier: 'business',
      operational_mode: 'pilot',
      tool_classifications: [],
      dlp_findings: [{ detector: 'cpf' }],
    });
    expect(r.effective_risk_class).toBe('C');
    expect(r.risk_escalation_reasons).toContain('dlp:cpf:pii_strong');
    // production for business + C = enforce; pilot relaxes one notch → ask.
    expect(r.enforcement_decision).toBe('ask');
  });

  it('CPF finding in production at starter → ask', () => {
    const r = resolveGovernance({
      capability: POLICY_GOVERNED,
      tenant_tier: 'starter',
      operational_mode: 'production',
      tool_classifications: [],
      dlp_findings: [{ detector: 'cpf' }],
    });
    expect(r.effective_risk_class).toBe('C');
    expect(r.enforcement_decision).toBe('ask');
  });

  it('email finding (standard PII) escalates only A → B', () => {
    const r = resolveGovernance({
      capability: POLICY_GOVERNED,
      tenant_tier: 'starter',
      operational_mode: 'production',
      tool_classifications: [],
      dlp_findings: [{ detector: 'email' }],
    });
    expect(r.effective_risk_class).toBe('B');
    expect(r.risk_escalation_reasons).toContain('dlp:email:pii_standard');
    // B in any tier → warn.
    expect(r.enforcement_decision).toBe('warn');
  });

  it('tool with contributed_risk D escalates and lifts enforcement (regulated → enforce + sandbox precondition)', () => {
    const r = resolveGovernance({
      capability: POLICY_GOVERNED,
      tenant_tier: 'regulated',
      operational_mode: 'production',
      tool_classifications: [
        {
          tool_index: 0,
          classification: 'anthropic_defined_client_executed_bash',
          contributed_risk_class: 'D',
        },
      ],
      dlp_findings: [],
    });
    expect(r.effective_risk_class).toBe('D');
    expect(r.risk_escalation_reasons).toContain('tool:anthropic_defined_client_executed_bash:d');
    expect(r.enforcement_decision).toBe('enforce');
  });

  it('starter tier + tool risk D in production → blocked (not just warn/observe)', () => {
    const r = resolveGovernance({
      capability: POLICY_GOVERNED,
      tenant_tier: 'starter',
      operational_mode: 'production',
      tool_classifications: [
        {
          tool_index: 0,
          classification: 'anthropic_defined_client_executed_bash',
          contributed_risk_class: 'D',
        },
      ],
      dlp_findings: [],
    });
    expect(r.effective_risk_class).toBe('D');
    expect(r.enforcement_decision).toBe('blocked');
  });

  it('test operational_mode → observe even with strong escalations', () => {
    const r = resolveGovernance({
      capability: POLICY_GOVERNED,
      tenant_tier: 'starter',
      operational_mode: 'test',
      tool_classifications: [
        {
          tool_index: 0,
          classification: 'anthropic_defined_client_executed_bash',
          contributed_risk_class: 'D',
        },
      ],
      dlp_findings: [{ detector: 'cpf' }],
    });
    expect(r.enforcement_decision).toBe('observe');
  });

  it('multipart upload escalates B → C', () => {
    const PASSTHROUGH_B: Capability = {
      ...POLICY_GOVERNED,
      id: 'anthropic.files',
      base_risk_class: 'B',
      level: 'passthrough_audited',
    };
    const r = resolveGovernance({
      capability: PASSTHROUGH_B,
      tenant_tier: 'business',
      operational_mode: 'production',
      tool_classifications: [],
      dlp_findings: [],
      is_multipart: true,
    });
    expect(r.effective_risk_class).toBe('C');
    expect(r.risk_escalation_reasons).toContain('multipart_upload');
  });
});
