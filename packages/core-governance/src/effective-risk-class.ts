// computeEffectiveRiskClass — Peça A v2 §6.3.5.
// Takes a base risk class plus zero or more applicable escalations and returns
// the worst (max) effective class. Pure function, deterministic, no I/O.

import { RISK_ORDER, type RiskClass } from '@govai/core-types';

export interface EscalationApplied {
  reason: string;
  /** The escalation only applies if the base matches `from`. The applied target is `to`. */
  base_to_effective: { from: RiskClass; to: RiskClass };
}

export function computeEffectiveRiskClass(
  base: RiskClass,
  escalations: ReadonlyArray<EscalationApplied>,
): RiskClass {
  let max = base;
  for (const esc of escalations) {
    if (esc.base_to_effective.from === base) {
      const candidate = esc.base_to_effective.to;
      if (RISK_ORDER[candidate] > RISK_ORDER[max]) {
        max = candidate;
      }
    }
  }
  return max;
}
