// Provider credential provenance — the single pinned vocabulary for
// `credential_source` on passthrough.invoked events (F1).
//
// A resolved provider credential carries BOTH the secret (apiKey, used only in
// memory to build outbound headers) AND the provenance of WHERE it came from
// (source, the only part that flows into evidence). The two must travel
// together so no producer re-derives the source from NODE_ENV / operational
// mode / env presence — only the resolver knows which path won.

// The three provenances a REALLY-resolved credential can carry. A
// ResolvedProviderCredential always has an apiKey, so its source can only be
// one of these — the non-resolution sentinel is deliberately excluded, making
// the contradictory state { apiKey, source: 'not_resolved…' } unrepresentable.
export type ResolvedProviderCredentialSource =
  | 'tenant_provider_credential' // an active govai.provider_credentials row (tenant-owned)
  | 'platform_env' // the platform env fallback (dev, or test+env)
  | 'hermetic_test_placeholder'; // the hermetic placeholder (test + loopback, no tenant, no env)

// The wider evidence vocabulary: the three resolvable sources PLUS the sentinel
// written directly on the governed block path (no credential was resolved —
// the request blocked before the provider, so the resolver was never called).
export type ProviderCredentialSource =
  | ResolvedProviderCredentialSource
  | 'not_resolved_pre_provider_block';

export type ResolvedProviderCredential = {
  /** The plaintext provider API key — in memory only; NEVER logged/persisted/serialized. */
  apiKey: string;
  /** The provenance of the resolved credential — the ONLY part that reaches evidence. */
  source: ResolvedProviderCredentialSource;
};
