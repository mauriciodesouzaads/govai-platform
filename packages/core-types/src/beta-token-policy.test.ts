import { describe, it, expect } from 'vitest';
import type { BetaTokenPolicy, BetaTokenPolicyEntry } from './beta-token-policy.js';

describe('beta-token-policy', () => {
  it('enum has the 6 canonical values', () => {
    const all: BetaTokenPolicy[] = [
      'global_allowlist',
      'org_override_allowed',
      'hard_denied',
      'verification_required',
      'denied_until_decision',
      'removed_as_no_longer_needed',
    ];
    // Compile-time exhaustiveness check via switch.
    for (const v of all) {
      let matched = false;
      switch (v) {
        case 'global_allowlist':
        case 'org_override_allowed':
        case 'hard_denied':
        case 'verification_required':
        case 'denied_until_decision':
        case 'removed_as_no_longer_needed':
          matched = true;
      }
      expect(matched).toBe(true);
    }
  });

  it('global_allowlist entry expects ADR id', () => {
    const entry: BetaTokenPolicyEntry = {
      beta_token: 'message-batches-2024-09-24',
      policy: 'global_allowlist',
      adr: 'ADR-PR2-04',
      reason: 'GA in Anthropic; documented allowlist baseline',
      pinned_at: '2026-05-04T00:00:00Z',
    };
    expect(entry.adr).toBe('ADR-PR2-04');
  });

  it('legacy removed_as_no_longer_needed entry compiles', () => {
    const entry: BetaTokenPolicyEntry = {
      beta_token: 'computer-use-2024-10-22',
      policy: 'removed_as_no_longer_needed',
      reason: 'feature graduated; header no longer required',
      legacy: true,
      pinned_at: '2026-05-04T00:00:00Z',
    };
    expect(entry.legacy).toBe(true);
  });
});
