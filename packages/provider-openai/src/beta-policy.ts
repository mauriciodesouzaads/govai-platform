// OPENAI_BETA_POLICY — literal of Matrix v2 §22. 2 entries (both hard_denied),
// frozen at module load. Modifying this list requires PR + ADR.

import type { BetaTokenPolicyEntry } from '@govai/core-types';

export const OPENAI_BETA_POLICY: ReadonlyArray<BetaTokenPolicyEntry> = Object.freeze([
  {
    beta_token: 'assistants=v2',
    policy: 'hard_denied',
    reason:
      'OpenAI Assistants API was deprecated (sunset 2026-08-26). GovAI does not expose Assistants endpoints; the header itself is blocked.',
    source_doc: 'https://platform.openai.com/docs/deprecations',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'realtime=v1',
    policy: 'hard_denied',
    reason:
      'OpenAI Realtime Beta API was deprecated (sunset 2026-05-07). Realtime GA is a separate planned capability (PR6).',
    source_doc: 'https://platform.openai.com/docs/deprecations',
    pinned_at: '2026-05-06T00:00:00Z',
  },
]);

/** Versioned identifier of the policy snapshot — used in audit `allowlist_version`. */
export const OPENAI_BETA_POLICY_VERSION = 'openai-beta-policy@2026-05-06';

// Production readiness gate (deferred to Batch M, NOT enforced in Batch C):
// OPENAI_BETA_POLICY currently has zero verification_required entries — both
// known tokens resolved to hard_denied. If Batch D is ever promoted, the
// follow-up (anthropic message-batches) is the one that adds verification_required
// pending tokens; OpenAI itself stays clean for PR2 production.
