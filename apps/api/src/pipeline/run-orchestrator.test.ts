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
import { __test_providerUpstreamBaseUrl } from './run-orchestrator.js';
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
