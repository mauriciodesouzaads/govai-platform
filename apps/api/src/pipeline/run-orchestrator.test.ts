// Unit tests for run-orchestrator's provider base URL fallback (issue #31).
//
// The orchestrator's previous fallback was `env.GOVAI_PROVIDER_BASE_URL ?? ''`
// which caused the governed handler to attempt `fetch('' + '/v1/messages')`
// in live mode (when GOVAI_PROVIDER_BASE_URL is unset) and throw a URL
// parse error before any network call → fast pre-network 502 on /v1/runs.
//
// PR3.1e replaces that with `providerUpstreamBaseUrl(env, provider)` which
// mirrors the direct routes' canonical fallback. These tests pin the
// contract end-to-end without making any network calls.
//
// We import the helper indirectly by checking observable behavior via a
// re-export — the helper is intentionally a module-local function. To keep
// the test surface narrow, we re-export it from the module under a
// `__test` namespace marked with a JSDoc comment explaining its purpose.

import { describe, it, expect } from 'vitest';
import {
  __test_providerUpstreamBaseUrl,
  __test_remainingDispatchBudgetMs,
} from './run-orchestrator.js';
import type { GovAIEnv } from '@govai/config';

function envWith(overrides: Partial<GovAIEnv>): GovAIEnv {
  // Minimal GovAIEnv shape — the helper only reads GOVAI_PROVIDER_BASE_URL.
  return {
    NODE_ENV: 'test',
    GOVAI_KMS_PROVIDER: 'dev',
    KMS_DEV_SEED: undefined,
    DATABASE_URL: undefined,
    DATABASE_ADMIN_URL: undefined,
    REDIS_URL: undefined,
    API_PORT: 8080,
    API_HOST: '0.0.0.0',
    API_CORS_ORIGINS: '',
    API_CORS_CREDENTIALS: false,
    JWT_ISSUER: 'https://govai.local',
    JWT_AUDIENCE: 'govai-api',
    JWT_PUBLIC_KEY_PEM: undefined,
    ANTHROPIC_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    OTEL_SERVICE_NAME: 'govai-api-test',
    OTEL_TRACES_SAMPLER_ARG: 1.0,
    GOVAI_LIVE_TESTS: false,
    GOVAI_PROVIDER_BASE_URL: undefined,
    GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION: false,
    ...overrides,
  } as GovAIEnv;
}

describe('run-orchestrator / providerUpstreamBaseUrl', () => {
  it('Anthropic: defaults to canonical URL when GOVAI_PROVIDER_BASE_URL is unset', () => {
    const env = envWith({ GOVAI_PROVIDER_BASE_URL: undefined });
    expect(__test_providerUpstreamBaseUrl(env, 'anthropic')).toBe('https://api.anthropic.com');
  });

  it('OpenAI: defaults to canonical URL when GOVAI_PROVIDER_BASE_URL is unset', () => {
    const env = envWith({ GOVAI_PROVIDER_BASE_URL: undefined });
    expect(__test_providerUpstreamBaseUrl(env, 'openai')).toBe('https://api.openai.com');
  });

  it('Anthropic: defaults to canonical URL when GOVAI_PROVIDER_BASE_URL is empty string', () => {
    const env = envWith({ GOVAI_PROVIDER_BASE_URL: '' });
    expect(__test_providerUpstreamBaseUrl(env, 'anthropic')).toBe('https://api.anthropic.com');
  });

  it('OpenAI: defaults to canonical URL when GOVAI_PROVIDER_BASE_URL is empty string', () => {
    const env = envWith({ GOVAI_PROVIDER_BASE_URL: '' });
    expect(__test_providerUpstreamBaseUrl(env, 'openai')).toBe('https://api.openai.com');
  });

  it('Anthropic: explicit env override wins (preserves hermetic loopback test behavior)', () => {
    const env = envWith({ GOVAI_PROVIDER_BASE_URL: 'http://127.0.0.1:31415' });
    expect(__test_providerUpstreamBaseUrl(env, 'anthropic')).toBe('http://127.0.0.1:31415');
  });

  it('OpenAI: explicit env override wins (preserves hermetic loopback test behavior)', () => {
    const env = envWith({ GOVAI_PROVIDER_BASE_URL: 'http://127.0.0.1:31415' });
    expect(__test_providerUpstreamBaseUrl(env, 'openai')).toBe('http://127.0.0.1:31415');
  });

  it('Anthropic: never returns an OpenAI default (no provider cross-talk)', () => {
    const env = envWith({ GOVAI_PROVIDER_BASE_URL: undefined });
    expect(__test_providerUpstreamBaseUrl(env, 'anthropic')).not.toBe('https://api.openai.com');
  });

  it('OpenAI: never returns an Anthropic default (no provider cross-talk)', () => {
    const env = envWith({ GOVAI_PROVIDER_BASE_URL: undefined });
    expect(__test_providerUpstreamBaseUrl(env, 'openai')).not.toBe('https://api.anthropic.com');
  });

  it('never returns an empty string (regression guard for issue #31)', () => {
    for (const baseUrl of [undefined, '']) {
      const env = envWith({ GOVAI_PROVIDER_BASE_URL: baseUrl });
      expect(__test_providerUpstreamBaseUrl(env, 'anthropic').length).toBeGreaterThan(0);
      expect(__test_providerUpstreamBaseUrl(env, 'openai').length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// remainingDispatchBudgetMs — the AbortSignal budget is anchored to the
// DURABLE claim deadline via a MONOTONIC same-clock elapsed delta (Codex P2
// on 633e10b + P2 on 3774a79): the database fixes deadline = db_now +
// timeout at claim COMMIT, and the budget is timeout minus the
// performance.now() time already spent since just before the claim call. No
// cross-clock subtraction and no wall clock exist in the delta, so neither
// an app clock offset from PostgreSQL nor a backward wall-clock step can
// extend the budget past the durable deadline; a stalled executor must not
// start provider I/O the protocol already gave up on.
// =============================================================================

describe('remainingDispatchBudgetMs', () => {
  it('elapsed at least the configured budget → non-positive (the forward must be refused)', () => {
    expect(__test_remainingDispatchBudgetMs(300_000, 300_000)).toBe(0);
    expect(__test_remainingDispatchBudgetMs(300_000, 300_001)).toBeLessThanOrEqual(0);
    expect(__test_remainingDispatchBudgetMs(300_000, 999_000)).toBeLessThanOrEqual(0);
  });

  it('a post-claim stall consumes the budget one-for-one (conservative: includes the claim round trip)', () => {
    expect(__test_remainingDispatchBudgetMs(300_000, 295_000)).toBe(5_000);
    expect(__test_remainingDispatchBudgetMs(300_000, 1)).toBe(299_999);
  });

  it('a fractional monotonic elapsed floors to an INTEGER budget (AbortSignal.timeout contract; floor is the conservative direction)', () => {
    expect(__test_remainingDispatchBudgetMs(300_000, 0.4)).toBe(299_999);
    expect(Number.isInteger(__test_remainingDispatchBudgetMs(300_000, 123.456))).toBe(true);
  });

  it('never exceeds the configured budget, even for a non-positive elapsed input', () => {
    expect(__test_remainingDispatchBudgetMs(300_000, 0)).toBe(300_000);
    // Defensive: a negative elapsed (impossible from a same-clock delta save
    // for a local clock step) must not extend past the configured cap.
    expect(__test_remainingDispatchBudgetMs(300_000, -60_000)).toBe(300_000);
  });
});
