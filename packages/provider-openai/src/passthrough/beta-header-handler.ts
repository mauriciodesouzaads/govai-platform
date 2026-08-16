// Native/Audited application policy for the `OpenAI-Beta` request header.
//
// The reusable resolver (`resolveBeta`, @govai/core-governance) tells the TRUTH
// about the policy-table state of each token; THIS layer decides what the
// Native/Audited surface does with that truth (Foundation V1 M1, OD-1=A):
//
//   FORWARD by default. Provider-validity semantics belong to the provider —
//   an unknown, unresolved (verification_required / denied_until_decision /
//   org_override_allowed-without-override) or deprecation-only token is NOT
//   unsafe; GovAI observes it and lets the provider accept or reject it.
//
//   BLOCK only for the explicit high-risk floor: policy === 'hard_denied'
//   (reserved for provider-hosted computer use; the OpenAI table currently has
//   NO hard_denied entry — its historical deprecation-only entries were
//   re-adjudicated to a non-blocking state, see beta-policy.ts). No other
//   Native semantic hard-deny is authorized (NATIVE_HARD_DENY_EXPANSION=FORBIDDEN).
//
// `OpenAI-Beta` accepts a comma-separated list of tokens. Each token resolves
// independently; the request is denied only if ANY token is hard_denied.
//
// Evidence (schema-neutral): the v4 `beta_allowlist_sources` enum can only
// truthfully represent global_allowlist / org_override / legacy_no_longer_needed.
// Forwarded-but-unrepresentable states are recorded as bounded, hashed
// observation markers (`beta:<state>:sha256:<64hex>`) that the route appends to
// the free-form `risk_escalation_reasons`. Markers are evidence-only: they never
// raise the effective risk class, never change enforcement, never block, and
// never store the raw token.

import { createHash } from 'node:crypto';
import { resolveBeta, type ResolutionResult } from '@govai/core-governance';
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

/** Observation states that have NO truthful `beta_allowlist_sources` representation. */
export type BetaObservationState =
  | 'unknown_token'
  | 'verification_required'
  | 'decision_pending'
  | 'override_absent_native_forward'
  | 'hard_denied';

export type BetaHandlerResult =
  | {
      decision: 'allow';
      /** Only truthfully representable v4 sources (never a fabricated provenance). */
      sources: PassthroughInvoked['beta_allowlist_sources'];
      forward_header: string | undefined;
      /** Bounded hashed markers for forwarded tokens without a truthful v4 source. */
      observations: string[];
    }
  | {
      decision: 'deny';
      denied: Array<{
        beta_token: string;
        policy_at_resolution: 'hard_denied';
        reason_code: 'hard_denied';
      }>;
      /** Bounded hashed markers (`beta:hard_denied:sha256:…`) for the denied tokens. */
      observations: string[];
    };

/**
 * Bounded, deterministic evidence marker for a beta token in a given state.
 * Hash input = the exact normalized token used for the policy lookup. SHA-256,
 * unsalted: this is an evidence correlation identifier, not credential storage.
 * Length is fixed per state (state label + 71 chars); the raw token is never
 * emitted.
 */
export function betaObservationMarker(state: BetaObservationState, token: string): string {
  return `beta:${state}:sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

function observationStateFor(r: ResolutionResult): BetaObservationState | null {
  if (r.decision === 'allow') return null;
  if (r.source === 'unknown_token') return 'unknown_token';
  if (r.policy_at_resolution === 'hard_denied') return 'hard_denied';
  if (r.policy_at_resolution === 'verification_required') return 'verification_required';
  if (r.policy_at_resolution === 'denied_until_decision') return 'decision_pending';
  // org_override_allowed without an active override.
  return 'override_absent_native_forward';
}

export async function handleOpenAIBetaHeader(
  input: BetaHandlerInput,
): Promise<BetaHandlerResult> {
  if (!input.header_value || input.header_value.trim().length === 0) {
    return { decision: 'allow', sources: [], forward_header: undefined, observations: [] };
  }
  const tokens = input.header_value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const sources: PassthroughInvoked['beta_allowlist_sources'] = [];
  const denied: Extract<BetaHandlerResult, { decision: 'deny' }>['denied'] = [];
  const observations: string[] = [];
  const denyMarkers: string[] = [];

  for (const token of tokens) {
    const r = await resolveBeta({
      provider: 'openai',
      org_id: input.org_id,
      beta_token: token,
      policy_table: input.policy_table,
      active_overrides_loader: input.active_overrides_loader,
    });
    if (r.decision === 'allow') {
      /* c8 ignore next 5 -- structurally unreachable: the resolver allows only table-backed states; if it ever did allow an unknown token, observe it truthfully instead of fabricating a provenance */
      if (r.policy_at_resolution === 'unknown') {
        observations.push(betaObservationMarker('unknown_token', token));
        continue;
      }
      // Truthful v4 provenance only — never a fabricated source.
      sources.push({
        beta_token: token,
        source:
          r.source === 'global_allowlist'
            ? 'global_allowlist'
            : r.source === 'legacy_no_longer_needed'
              ? 'legacy_no_longer_needed'
              : 'org_override',
        ...(r.override_id ? { override_id: r.override_id } : {}),
        policy_at_resolution: r.policy_at_resolution,
      });
      continue;
    }
    const state = observationStateFor(r);
    /* c8 ignore next -- observationStateFor returns null only for allow, handled above */
    if (state === null) continue;
    if (state === 'hard_denied') {
      denied.push({ beta_token: token, policy_at_resolution: 'hard_denied', reason_code: 'hard_denied' });
      denyMarkers.push(betaObservationMarker(state, token));
      continue;
    }
    // Native forward + observe: unknown / unresolved / override-absent tokens.
    observations.push(betaObservationMarker(state, token));
  }

  if (denied.length > 0) {
    return { decision: 'deny', denied, observations: denyMarkers };
  }
  return {
    decision: 'allow',
    sources,
    forward_header: tokens.join(', '),
    observations,
  };
}
