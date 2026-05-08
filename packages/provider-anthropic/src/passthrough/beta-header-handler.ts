// Resolve `anthropic-beta` request headers against ANTHROPIC_BETA_POLICY.
// Returns one of: { decision: 'allow', sources: [...] } | { decision: 'deny', denied: [...] }
//
// `anthropic-beta` accepts a comma-separated list of tokens. Each token resolves
// independently; the ENTIRE request is denied if ANY token resolves to deny.

import {
  resolveBeta,
  type ResolutionResult,
} from '@govai/core-governance';
import type { BetaTokenPolicyEntry } from '@govai/core-types';
import type { PassthroughInvoked } from '@govai/core-events';

export type BetaHandlerInput = {
  org_id: string;
  header_value: string | undefined;
  policy_table: ReadonlyArray<BetaTokenPolicyEntry>;
  active_overrides_loader: (
    org_id: string,
    provider: string,
  ) => Promise<Array<{ beta_token: string; id: string }>>;
};

export type BetaHandlerResult =
  | {
      decision: 'allow';
      sources: PassthroughInvoked['beta_allowlist_sources'];
      forward_header: string | undefined;
    }
  | {
      decision: 'deny';
      denied: Array<{
        beta_token: string;
        policy_at_resolution: ResolutionResult['policy_at_resolution'];
        reason_code:
          | 'unknown_token'
          | 'hard_denied'
          | 'denied_until_decision'
          | 'org_override_required_but_absent'
          | 'verification_required_without_override';
      }>;
    };

function deriveReasonCode(
  r: ResolutionResult,
): NonNullable<
  Extract<BetaHandlerResult, { decision: 'deny' }>['denied'][number]['reason_code']
> {
  if (r.source === 'unknown_token') return 'unknown_token';
  if (r.policy_at_resolution === 'hard_denied') return 'hard_denied';
  if (r.policy_at_resolution === 'denied_until_decision') return 'denied_until_decision';
  if (r.policy_at_resolution === 'verification_required') {
    return 'verification_required_without_override';
  }
  // org_override_allowed without an active override.
  return 'org_override_required_but_absent';
}

export async function handleAnthropicBetaHeader(
  input: BetaHandlerInput,
): Promise<BetaHandlerResult> {
  if (!input.header_value || input.header_value.trim().length === 0) {
    return { decision: 'allow', sources: [], forward_header: undefined };
  }
  const tokens = input.header_value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const sources: PassthroughInvoked['beta_allowlist_sources'] = [];
  const denied: Extract<BetaHandlerResult, { decision: 'deny' }>['denied'] = [];

  for (const token of tokens) {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: input.org_id,
      beta_token: token,
      policy_table: input.policy_table,
      active_overrides_loader: input.active_overrides_loader,
    });
    if (r.decision === 'allow') {
      sources.push({
        beta_token: token,
        source:
          r.source === 'global_allowlist'
            ? 'global_allowlist'
            : r.source === 'legacy_no_longer_needed'
              ? 'legacy_no_longer_needed'
              : 'org_override',
        ...(r.override_id ? { override_id: r.override_id } : {}),
        policy_at_resolution:
          r.policy_at_resolution === 'unknown' ? 'denied_until_decision' : r.policy_at_resolution,
      });
    } else {
      denied.push({
        beta_token: token,
        policy_at_resolution: r.policy_at_resolution,
        reason_code: deriveReasonCode(r),
      });
    }
  }

  if (denied.length > 0) {
    return { decision: 'deny', denied };
  }
  return {
    decision: 'allow',
    sources,
    forward_header: tokens.join(', '),
  };
}
