// Beta token policy enum (6 values) — Matrix §4 / Peça A v2 §6.3.2.
// One single source of truth; both Anthropic and OpenAI BETA_POLICY tables use it.

export type BetaTokenPolicy =
  | 'global_allowlist'
  | 'org_override_allowed'
  | 'hard_denied'
  | 'verification_required'
  | 'denied_until_decision'
  | 'removed_as_no_longer_needed';

export interface BetaTokenPolicyEntry {
  beta_token: string;
  policy: BetaTokenPolicy;
  /** ADR id; required by §4.2 pre-merge gate when policy === 'global_allowlist'. */
  adr?: string;
  reason: string;
  source_doc?: string;
  pinned_at: string;
  legacy?: boolean;
}
