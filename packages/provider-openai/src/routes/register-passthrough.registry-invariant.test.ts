// ROUTE-04 (M1 §14.3): a GENUINE internal registry inconsistency — a mapped
// method whose capability id is missing from the registry — must remain
// detectable as a server defect (500 capability_registry_missing), i.e. the
// 405 method-mismatch fix must NOT mask real bugs. Reachable only by breaking
// the resolver, hence the module mock.
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('../capabilities/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../capabilities/index.js')>();
  return {
    ...actual,
    resolveOpenAICapabilityForRequest: (input: { method: string; pathTemplate: string; isStream: boolean }) => {
      const r = actual.resolveOpenAICapabilityForRequest(input);
      // Corrupt ONLY the mapped POST resolution: a non-'unknown' id that is not in the registry.
      return r.capability_id === 'unknown' ? r : { ...r, capability_id: 'openai.bogus.not_in_registry' };
    },
  };
});

import { registerOpenAIPassthrough, type OpenAIPassthroughDeps } from './register-passthrough.js';

describe('ROUTE-04 — genuine registry inconsistency stays a loud 500', () => {
  it('mapped method + capability id absent from the registry → 500 capability_registry_missing (NOT 404/405), after auth', async () => {
    const app = Fastify({ logger: false });
    const deps: OpenAIPassthroughDeps = {
      upstreamBaseUrl: 'http://127.0.0.1:1',
      resolveTenant: async () => ({
        org_id: '00000000-0000-4000-8000-0000000000f1',
        tier: 'enterprise',
        operational_mode: 'production',
      }),
      resolveProviderKey: async () => ({ apiKey: 'k', source: 'platform_env' }),
      activeOverridesLoader: async () => [],
      emitAuditEvent: () => undefined,
    };
    await app.register(async (i) => registerOpenAIPassthrough(i, deps));
    const res = await app.inject({
      method: 'POST',
      url: '/passthrough/openai/v1/responses',
      headers: { 'content-type': 'application/json' },
      payload: '{"model":"gpt-x","input":"hi"}',
    });
    expect(res.statusCode).toBe(500);
    expect((res.json() as Record<string, unknown>)['error']).toBe('capability_registry_missing');
    // and a caller method mismatch on the same path is still the 405 contract
    const res2 = await app.inject({ method: 'GET', url: '/passthrough/openai/v1/responses' });
    expect(res2.statusCode).toBe(405);
    await app.close();
  });
});
