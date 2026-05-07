// computeEnforcement — Peça A v2 §6.2 (Tier × Risk × Mode policy matrix).
// Pure resolver: (tier, effective_risk_class, operational_mode, optional tool classification)
// → EnforcementResolution { mode, side_effects?, preconditions? }.
//
// PR2 baseline policy matrix (conservative starting point — can be expanded via
// data table in PR3+ without breaking signature):
//
//   tier × risk_class × mode → enforcement_mode
//
// Rules in this order:
//   1) operational_mode='dev' or 'test'  → 'observe' (low-friction).
//   2) operational_mode='pilot'          → relax one notch from production rule.
//   3) effective_risk_class='E'          → 'blocked' regardless of tier (catastrophic).
//   4) effective_risk_class='D' + tier='starter'         → 'blocked'.
//   5) effective_risk_class='D' + tier='business'        → 'sandbox_required'.
//   6) effective_risk_class='D' + tier in ['enterprise','regulated'] → 'enforce' + sandbox precondition.
//   7) effective_risk_class='C' + tier='starter'         → 'ask'.
//   8) effective_risk_class='C' + tier in ['business','enterprise','regulated'] → 'enforce'.
//   9) effective_risk_class='B'                          → 'warn'.
//  10) effective_risk_class='A'                          → 'observe'.
//
// Tool classification (when present) can lift the floor:
//   - 'anthropic_provider_hosted_computer_use' / 'openai_provider_hosted_computer_use'
//     → at least 'sandbox_required' (matches blocked-arch capabilities; surface here as
//     guard for any future relaxation).

import type {
  EnforcementMode,
  EnforcementResolution,
  OperationalMode,
  Precondition,
  RiskClass,
  SideEffect,
  Tier,
} from '@govai/core-types';

export interface ComputeEnforcementInput {
  tier: Tier;
  effective_risk_class: RiskClass;
  operational_mode: OperationalMode;
  tool_classification?: string;
}

const MODE_RANK: Record<EnforcementMode, number> = {
  observe: 0,
  warn: 1,
  ask: 2,
  enforce: 3,
  sandbox_required: 4,
  blocked: 5,
};

function relaxOneNotch(mode: EnforcementMode): EnforcementMode {
  if (mode === 'blocked') return 'sandbox_required';
  if (mode === 'sandbox_required') return 'enforce';
  if (mode === 'enforce') return 'ask';
  if (mode === 'ask') return 'warn';
  if (mode === 'warn') return 'observe';
  return 'observe';
}

function productionMode(input: ComputeEnforcementInput): EnforcementMode {
  const r = input.effective_risk_class;
  const t = input.tier;

  if (r === 'E') return 'blocked';

  if (r === 'D') {
    if (t === 'starter') return 'blocked';
    if (t === 'business') return 'sandbox_required';
    return 'enforce';
  }

  if (r === 'C') {
    if (t === 'starter') return 'ask';
    return 'enforce';
  }

  if (r === 'B') return 'warn';
  return 'observe';
}

export function computeEnforcement(input: ComputeEnforcementInput): EnforcementResolution {
  // Dev/test always 'observe' (engineering friction control).
  if (input.operational_mode === 'dev' || input.operational_mode === 'test') {
    return { mode: 'observe' };
  }

  let mode: EnforcementMode = productionMode(input);
  if (input.operational_mode === 'pilot') {
    mode = relaxOneNotch(mode);
  }

  // Floor: provider-hosted computer_use surfaces require sandbox even after pilot relaxation.
  if (
    input.tool_classification === 'anthropic_provider_hosted_computer_use' ||
    input.tool_classification === 'openai_provider_hosted_computer_use'
  ) {
    if (MODE_RANK[mode] < MODE_RANK['sandbox_required']) {
      mode = 'sandbox_required';
    }
  }

  const side_effects: SideEffect[] = [];
  const preconditions: Precondition[] = [];

  // High audit detail above ask.
  if (MODE_RANK[mode] >= MODE_RANK['ask']) {
    side_effects.push({ audit_detail_level: 'high' });
  }
  // DLP pre-scan obrigatório de 'enforce' para cima.
  if (MODE_RANK[mode] >= MODE_RANK['enforce']) {
    side_effects.push({ dlp_pre_scan_required: true });
  }
  // Sandbox precondition.
  if (mode === 'sandbox_required' || mode === 'enforce') {
    if (input.effective_risk_class === 'D') {
      preconditions.push({ sandbox_environment_required: true });
    }
  }

  const result: EnforcementResolution = { mode };
  if (side_effects.length > 0) result.side_effects = side_effects;
  if (preconditions.length > 0) result.preconditions = preconditions;
  return result;
}
