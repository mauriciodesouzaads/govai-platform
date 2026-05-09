// Real governance resolver for /governed/{provider}/* and /v1/runs.
//
// Composes:
//   base_risk_class           ← capability registry (provider-anthropic/openai capabilities)
//   risk_escalation_reasons[] ← derived from DLP findings + tool classifications + flags
//   effective_risk_class      ← computeEffectiveRiskClass(base, escalations)
//   enforcement_decision      ← computeEnforcement(tier, effective_risk_class, operational_mode)
//
// No hardcoded literals. If a caller passes hand-crafted values they MUST come
// from `*.test.ts` / `*.fixture.ts` files (allowed only there per the macro
// realignment directive).

import type { Capability, RiskClass, Tier, OperationalMode } from '@govai/core-types';
import {
  computeEffectiveRiskClass,
  type EscalationApplied,
} from '../effective-risk-class.js';
import { computeEnforcement } from '../enforcement.js';

export type ToolClassificationLite = {
  tool_index: number;
  classification: string;
  contributed_risk_class: RiskClass;
};

export type DlpFindingLite = {
  detector: string;
  /** Signal class: 'pii_strong' for CPF/CNPJ, 'pii_standard' for email/phone. */
  signal_class?: string;
};

export type ResolveGovernanceInput = {
  capability: Capability;
  tenant_tier: Tier;
  operational_mode: OperationalMode;
  /** Tool classifications from provider classifier (may be empty). */
  tool_classifications: ToolClassificationLite[];
  /** DLP findings from pre-scan (may be empty). */
  dlp_findings: DlpFindingLite[];
  /** True when the request is multipart upload (escalation hint). */
  is_multipart?: boolean;
};

export type ResolvedGovernance = {
  base_risk_class: RiskClass;
  effective_risk_class: RiskClass;
  risk_escalation_reasons: string[];
  enforcement_decision:
    | 'observe'
    | 'warn'
    | 'ask'
    | 'enforce'
    | 'sandbox_required'
    | 'blocked';
};

function ddpClassifyDetector(detector: string, signalClass?: string): 'strong' | 'standard' {
  if (signalClass === 'pii_strong') return 'strong';
  if (signalClass === 'pii_standard') return 'standard';
  return detector === 'cpf' || detector === 'cnpj' ? 'strong' : 'standard';
}

/** Compute the worst risk class among a set, ranked A<B<C<D<E. */
function maxRisk(a: RiskClass, b: RiskClass): RiskClass {
  const order: Record<RiskClass, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
  return order[b] > order[a] ? b : a;
}

/**
 * Compute real governance for one request. Pure function over its inputs.
 */
export function resolveGovernance(input: ResolveGovernanceInput): ResolvedGovernance {
  const base_risk_class = input.capability.base_risk_class;
  const escalations: EscalationApplied[] = [];
  const reasons: string[] = [];

  // DLP escalations: strong PII (CPF/CNPJ) lifts A→C / B→C / C→D; standard PII
  // lifts A→B / B→B (no-op above B).
  for (const f of input.dlp_findings) {
    const strength = ddpClassifyDetector(f.detector, f.signal_class);
    const reasonTag = `dlp:${f.detector}:${strength === 'strong' ? 'pii_strong' : 'pii_standard'}`;
    if (strength === 'strong') {
      escalations.push({
        reason: reasonTag,
        base_to_effective: { from: 'A', to: 'C' },
      });
      escalations.push({
        reason: reasonTag,
        base_to_effective: { from: 'B', to: 'C' },
      });
      escalations.push({
        reason: reasonTag,
        base_to_effective: { from: 'C', to: 'D' },
      });
    } else {
      escalations.push({
        reason: reasonTag,
        base_to_effective: { from: 'A', to: 'B' },
      });
    }
    reasons.push(reasonTag);
  }

  // Tool escalations: lift base up to the tool's contributed_risk_class. Each
  // tool injects an escalation rule whose `from` matches the current base; the
  // computeEffectiveRiskClass max-rollup picks the worst applicable one.
  for (const t of input.tool_classifications) {
    const reasonTag = `tool:${t.classification}:${t.contributed_risk_class.toLowerCase()}`;
    // Apply to every base that is below the contributed class.
    const order: RiskClass[] = ['A', 'B', 'C', 'D', 'E'];
    for (const from of order) {
      const lifted = maxRisk(from, t.contributed_risk_class);
      if (lifted !== from) {
        escalations.push({
          reason: reasonTag,
          base_to_effective: { from, to: lifted },
        });
      }
    }
    reasons.push(reasonTag);
  }

  if (input.is_multipart === true) {
    // Multipart upload pushes B → C as an evidence-strength signal.
    escalations.push({
      reason: 'multipart_upload',
      base_to_effective: { from: 'B', to: 'C' },
    });
    reasons.push('multipart_upload');
  }

  const effective_risk_class = computeEffectiveRiskClass(base_risk_class, escalations);

  // Pick the highest-risk tool classification (if any) so the enforcement floor
  // for hosted computer_use surfaces stays canonical.
  const dominantTool =
    input.tool_classifications.length > 0
      ? input.tool_classifications.reduce((acc, t) =>
          maxRisk(acc.contributed_risk_class, t.contributed_risk_class) ===
          t.contributed_risk_class
            ? t
            : acc,
        )
      : null;

  const enf = computeEnforcement({
    tier: input.tenant_tier,
    effective_risk_class,
    operational_mode: input.operational_mode,
    ...(dominantTool ? { tool_classification: dominantTool.classification } : {}),
  });

  return {
    base_risk_class,
    effective_risk_class,
    risk_escalation_reasons: reasons,
    enforcement_decision: enf.mode,
  };
}
