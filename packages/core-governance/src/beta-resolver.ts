// Beta token resolver — Peça A v2 §6.3.4, Matrix §4.1.
// Pure function over (provider, org_id, beta_token, policy_table, active_overrides_loader).
// Deterministic: same inputs → same ResolutionResult.

import type { BetaTokenPolicy, BetaTokenPolicyEntry } from '@govai/core-types';

export interface ResolutionResult {
  decision: 'allow' | 'deny';
  source:
    | 'global_allowlist'
    | 'org_override'
    | 'legacy_no_longer_needed'
    | 'denied'
    | 'unknown_token';
  override_id?: string;
  policy_at_resolution: BetaTokenPolicy | 'unknown';
  audit_marker?: 'verification_pending' | 'decision_pending';
}

export interface ResolveBetaInput {
  provider: 'anthropic' | 'openai';
  org_id: string;
  beta_token: string;
  policy_table: ReadonlyArray<BetaTokenPolicyEntry>;
  active_overrides_loader: (
    org_id: string,
    provider: string,
  ) => Promise<Array<{ beta_token: string; id: string }>>;
}

export async function resolveBeta(args: ResolveBetaInput): Promise<ResolutionResult> {
  const entry = args.policy_table.find((e) => e.beta_token === args.beta_token);

  if (!entry) {
    return { decision: 'deny', source: 'unknown_token', policy_at_resolution: 'unknown' };
  }

  switch (entry.policy) {
    case 'global_allowlist':
      return {
        decision: 'allow',
        source: 'global_allowlist',
        policy_at_resolution: 'global_allowlist',
      };

    case 'org_override_allowed': {
      const overrides = await args.active_overrides_loader(args.org_id, args.provider);
      const ov = overrides.find((o) => o.beta_token === args.beta_token);
      if (ov) {
        return {
          decision: 'allow',
          source: 'org_override',
          override_id: ov.id,
          policy_at_resolution: 'org_override_allowed',
        };
      }
      return {
        decision: 'deny',
        source: 'denied',
        policy_at_resolution: 'org_override_allowed',
      };
    }

    case 'hard_denied':
      return { decision: 'deny', source: 'denied', policy_at_resolution: 'hard_denied' };

    case 'verification_required': {
      // Behaves like org_override_allowed until verified; audit marks verification_pending.
      const overrides = await args.active_overrides_loader(args.org_id, args.provider);
      const ov = overrides.find((o) => o.beta_token === args.beta_token);
      if (ov) {
        return {
          decision: 'allow',
          source: 'org_override',
          override_id: ov.id,
          policy_at_resolution: 'verification_required',
          audit_marker: 'verification_pending',
        };
      }
      return {
        decision: 'deny',
        source: 'denied',
        policy_at_resolution: 'verification_required',
        audit_marker: 'verification_pending',
      };
    }

    case 'denied_until_decision':
      return {
        decision: 'deny',
        source: 'denied',
        policy_at_resolution: 'denied_until_decision',
        audit_marker: 'decision_pending',
      };

    case 'removed_as_no_longer_needed':
      return {
        decision: 'allow',
        source: 'legacy_no_longer_needed',
        policy_at_resolution: 'removed_as_no_longer_needed',
      };
  }
}
