// F1 — the governed Anthropic producer records the REAL credential provenance
// on the emitted passthrough.invoked event, and does NOT resolve a credential
// when the request is blocked before the provider.
//
// Two proofs with an explicit spy on resolveProviderKey (never inferred from
// flow): (B) a forwarded request emits credential_source === the resolver's
// source; (C) a request blocked at tool validation emits
// credential_source === 'not_resolved_pre_provider_block' AND the resolver is
// called ZERO times.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../passthrough/forward.js', () => ({
  forwardRaw: async () => ({
    status: 200,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: Buffer.from('{"ok":true}'),
    native_request_hash: 'a'.repeat(64),
    native_response_hash: 'b'.repeat(64),
    provider_request_id: 'req-1',
    latency_ms: 1,
  }),
}));

import {
  registerAnthropicGoverned,
  type AnthropicGovernedDeps,
} from './register-governed.js';
import type { GovernedTenant } from './handle-messages.js';
import type { ResolvedProviderCredential } from '@govai/core-types';

const ORG = '00000000-0000-4000-8000-0000000000f1';
const tenant: GovernedTenant = { org_id: ORG, tier: 'starter', operational_mode: 'production' };

let app: FastifyInstance;
let govUrl: string;
let auditEvents: Record<string, unknown>[] = [];

// The spy: counts calls and returns a source that is DELIBERATELY not the old
// hardcoded literal, so a passing assertion proves the value flows from here.
const resolveSpy = vi.fn(
  async (): Promise<ResolvedProviderCredential> => ({ apiKey: 'k', source: 'platform_env' }),
);

function invoked(): Record<string, unknown> {
  const ev = auditEvents.find((e) => e['event_type'] === 'passthrough.invoked');
  if (!ev) throw new Error('no passthrough.invoked captured');
  return ev;
}

beforeAll(async () => {
  const deps: AnthropicGovernedDeps = {
    upstreamBaseUrl: 'http://upstream.invalid',
    resolveTenant: async () => tenant,
    resolveProviderKey: resolveSpy,
    dlpScan: async () => ({ findings: [] }),
    emitAuditEvent: (ev) => {
      auditEvents.push(ev as unknown as Record<string, unknown>);
    },
  };
  app = Fastify({ logger: false });
  await app.register(async (instance) => registerAnthropicGoverned(instance, deps));
  await app.listen({ port: 0, host: '127.0.0.1' });
  govUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  auditEvents = [];
  resolveSpy.mockClear();
});

async function post(body: unknown): Promise<Response> {
  return fetch(`${govUrl}/governed/anthropic/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('F1 — governed Anthropic credential_source', () => {
  it('B — a forwarded request emits credential_source === the resolver source (platform_env), resolver called once', async () => {
    const res = await post({
      model: 'claude-x',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.status).toBe(200);
    await res.text();
    expect(invoked()['credential_source']).toBe('platform_env');
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });

  it('C — a request blocked at tool validation emits not_resolved_pre_provider_block AND never calls the resolver', async () => {
    const res = await post({
      model: 'claude-x',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
      // computer_use → blocked_at_validation → 403 before any provider call.
      tools: [{ type: 'computer_20250124', name: 'computer' }],
    });
    expect(res.status).toBe(403);
    await res.text();
    const ev = invoked();
    expect(ev['credential_source']).toBe('not_resolved_pre_provider_block');
    expect(ev['body_forward_mode']).toBe('blocked');
    // The load-bearing anti-inference proof: the resolver was NEVER called.
    expect(resolveSpy).toHaveBeenCalledTimes(0);
  });
});
