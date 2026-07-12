// F1 — the governed OpenAI producer (responses) records the REAL credential
// provenance and does NOT resolve a credential when blocked before the provider.
// Same two proofs as the Anthropic counterpart, with an explicit resolver spy.

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

import { registerOpenAIGoverned, type OpenAIGovernedDeps } from './register-governed.js';
import type { GovernedTenant } from './handle-responses.js';
import type { ResolvedProviderCredential } from '@govai/core-types';

const ORG = '00000000-0000-4000-8000-0000000000f2';
const tenant: GovernedTenant = { org_id: ORG, tier: 'starter', operational_mode: 'production' };

let app: FastifyInstance;
let govUrl: string;
let auditEvents: Record<string, unknown>[] = [];

const resolveSpy = vi.fn(
  async (): Promise<ResolvedProviderCredential> => ({ apiKey: 'k', source: 'platform_env' }),
);

function invoked(): Record<string, unknown> {
  const ev = auditEvents.find((e) => e['event_type'] === 'passthrough.invoked');
  if (!ev) throw new Error('no passthrough.invoked captured');
  return ev;
}

beforeAll(async () => {
  const deps: OpenAIGovernedDeps = {
    upstreamBaseUrl: 'http://upstream.invalid',
    resolveTenant: async () => tenant,
    resolveProviderKey: resolveSpy,
    dlpScan: async () => ({ findings: [] }),
    emitAuditEvent: (ev) => {
      auditEvents.push(ev as unknown as Record<string, unknown>);
    },
  };
  app = Fastify({ logger: false });
  await app.register(async (instance) => registerOpenAIGoverned(instance, deps));
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

async function postResponses(body: unknown): Promise<Response> {
  return fetch(`${govUrl}/governed/openai/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postChatCompletions(body: unknown): Promise<Response> {
  return fetch(`${govUrl}/governed/openai/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('F1 — governed OpenAI credential_source', () => {
  it('B — a forwarded request emits credential_source === the resolver source (platform_env), resolver called once', async () => {
    const res = await postResponses({ model: 'gpt-x', input: 'hi' });
    expect(res.status).toBe(200);
    await res.text();
    expect(invoked()['credential_source']).toBe('platform_env');
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });

  it('C — a request blocked at tool validation emits not_resolved_pre_provider_block AND never calls the resolver', async () => {
    const res = await postResponses({
      model: 'gpt-x',
      input: 'hi',
      // computer_use_preview → blocked_at_validation → 403 before any provider call.
      tools: [{ type: 'computer_use_preview' }],
    });
    expect(res.status).toBe(403);
    await res.text();
    const ev = invoked();
    expect(ev['credential_source']).toBe('not_resolved_pre_provider_block');
    expect(ev['body_forward_mode']).toBe('blocked');
    expect(resolveSpy).toHaveBeenCalledTimes(0);
  });
});

// Point 2: Chat Completions is a SEPARATE governed producer (its own emit
// logic) and was modified independently by F1 — so it gets its own proof.
describe('F1 — governed OpenAI chat completions credential_source (Point 2)', () => {
  it('B — a forwarded chat-completions request emits credential_source=platform_env, resolver called once', async () => {
    const res = await postChatCompletions({
      model: 'gpt-x',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.status).toBe(200);
    await res.text();
    const ev = invoked();
    expect(ev['native_endpoint']).toBe('/v1/chat/completions');
    expect(ev['credential_source']).toBe('platform_env');
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });

  it('C — a blocked chat-completions request emits not_resolved_pre_provider_block AND never calls the resolver', async () => {
    const res = await postChatCompletions({
      model: 'gpt-x',
      messages: [{ role: 'user', content: 'hi' }],
      // computer_use_preview → blocked_at_validation → 403 before any provider call.
      tools: [{ type: 'computer_use_preview' }],
    });
    expect(res.status).toBe(403);
    await res.text();
    const ev = invoked();
    expect(ev['credential_source']).toBe('not_resolved_pre_provider_block');
    expect(ev['body_forward_mode']).toBe('blocked');
    expect(resolveSpy).toHaveBeenCalledTimes(0);
  });
});
