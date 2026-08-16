// OPENAI_BETA_POLICY — literal of Matrix v2 §22, re-adjudicated under Foundation
// V1 M1 (OD-1=A). 2 entries, frozen at module load. Modifying this list requires
// PR + ADR.
//
// M1 re-adjudication: both historical entries were `hard_denied` solely because
// the provider DEPRECATED the underlying beta programs (an old compatibility
// snapshot), not because GovAI took an explicit high-risk decision. Under
// OD-1=A `hard_denied` is reserved for the explicit high-risk floor
// (provider-hosted computer use). Deprecation is the PROVIDER's semantic —
// Native forwards the token and the provider's actual accept/reject is the
// recorded result truth. GovAI has taken NO product decision on either token,
// so the truthful table state is `denied_until_decision`: the resolver still
// reports the pending state (audit_marker=decision_pending) and the Native
// application layer forwards + observes it (marker `beta:decision_pending:…`).
// No allowlist provenance is fabricated: neither token appears in
// `beta_allowlist_sources`.

import type { BetaTokenPolicyEntry } from '@govai/core-types';

export const OPENAI_BETA_POLICY: ReadonlyArray<BetaTokenPolicyEntry> = Object.freeze([
  {
    beta_token: 'assistants=v2',
    policy: 'denied_until_decision',
    reason:
      'OpenAI Assistants API deprecated (sunset 2026-08-26). Deprecation alone is a provider semantic, not a GovAI high-risk decision (M1/OD-1=A): Native forwards + observes; GovAI exposes no Assistants endpoints, so the provider decides. Historical: hard_denied in the 2026-05-06 snapshot.',
    source_doc: 'https://platform.openai.com/docs/deprecations',
    pinned_at: '2026-08-16T00:00:00Z',
  },
  {
    beta_token: 'realtime=v1',
    policy: 'denied_until_decision',
    reason:
      'OpenAI Realtime Beta API deprecated (sunset 2026-05-07). Deprecation alone is a provider semantic, not a GovAI high-risk decision (M1/OD-1=A): Native forwards + observes; the provider decides. Historical: hard_denied in the 2026-05-06 snapshot.',
    source_doc: 'https://platform.openai.com/docs/deprecations',
    pinned_at: '2026-08-16T00:00:00Z',
  },
]);

/** Versioned identifier of the policy snapshot — used in audit `allowlist_version`. */
export const OPENAI_BETA_POLICY_VERSION = 'openai-beta-policy@2026-08-16';

// Native high-risk floor (OD-1=A): the OpenAI table currently carries NO
// `hard_denied` entry. Provider-hosted computer use on OpenAI is gated by the
// TOOL classifier (`computer_use_preview` → blocked_at_validation), not by a
// beta token. Adding a `hard_denied` beta requires an explicit owner/security
// decision (NATIVE_HARD_DENY_EXPANSION=FORBIDDEN in M1).
