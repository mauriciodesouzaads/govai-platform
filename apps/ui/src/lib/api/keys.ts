// Canonical React Query keys.
//
// ★ NO KEY MAY CONTAIN A CREDENTIAL, and none does: every key is built from the resource name
// and the query parameters the user chose (window, invariant, chain category). The cache is
// therefore scoped by what the user is looking at, never by who is looking.
//
// Because a key carries no identity, a change of session MUST clear the cache — otherwise one
// organization's rows could be served to the next credential from cache. `signOut()` and the
// 401 handler both call queryClient.clear(); a test pins that behaviour.

import type { EvidenceInvariant } from '../contract/evidence.js';
import type { ChainCategory } from '../contract/audit-events.js';

export const queryKeys = {
  evidenceSummary: (windowSeconds: number) =>
    ['evidence', 'summary', { windowSeconds }] as const,

  evidenceGaps: (invariant: EvidenceInvariant, windowSeconds: number, limit: number) =>
    ['evidence', 'gaps', { invariant, windowSeconds, limit }] as const,

  auditEvents: (chainCategory: ChainCategory, limit: number) =>
    ['audit-events', { chainCategory, limit }] as const,

  capabilities: () => ['capabilities'] as const,
} as const;
