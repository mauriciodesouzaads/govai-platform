// Type-level proof (Point 3): a ResolvedProviderCredential cannot carry the
// non-resolution sentinel — the contradictory state { apiKey, source:
// 'not_resolved_pre_provider_block' } is unrepresentable. The wider
// ProviderCredentialSource vocabulary still includes the sentinel for evidence.

import { describe, it, expect } from 'vitest';
import type {
  ProviderCredentialSource,
  ResolvedProviderCredential,
  ResolvedProviderCredentialSource,
} from './provider-credential.js';

describe('provider-credential source types (Point 3)', () => {
  it('a resolved credential accepts each of the three resolvable sources', () => {
    const sources: ResolvedProviderCredentialSource[] = [
      'tenant_provider_credential',
      'platform_env',
      'hermetic_test_placeholder',
    ];
    for (const source of sources) {
      const cred: ResolvedProviderCredential = { apiKey: 'k', source };
      expect(cred.source).toBe(source);
    }
  });

  it('the sentinel is a valid evidence source but NOT a resolvable one', () => {
    const evidence: ProviderCredentialSource = 'not_resolved_pre_provider_block';
    expect(evidence).toBe('not_resolved_pre_provider_block');

    // The load-bearing proof is the @ts-expect-error: this file fails to compile
    // if the sentinel is ever accepted into ResolvedProviderCredential again.
    // Single-line so the directive sits directly above the offending assignment.
    // @ts-expect-error — a resolved credential cannot use the non-resolution sentinel
    const impossible: ResolvedProviderCredential = { apiKey: 'k', source: 'not_resolved_pre_provider_block' };
    expect(impossible.apiKey).toBe('k');
  });
});
