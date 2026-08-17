// M2A F5 — provider-native QUERY fidelity for the OpenAI passthrough.
//
// Real socket path (node:http fake provider + real Fastify + real fetch, NOT
// app.inject) so the fake provider records the EXACT request-target GovAI put
// on the wire. Routing/capability matching is pathname-only; the upstream
// forward preserves the raw query byte-semantics (key order, duplicates, empty
// values, percent escapes, `+`, encoded delimiters) — no decode/re-encode, no
// URLSearchParams reconstruction.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerOpenAIPassthrough, type OpenAIPassthroughDeps } from './register-passthrough.js';
import type { TenantContext } from '../passthrough/audit-emit.js';

type Captured = { method: string; url: string; rawBody: Buffer };

let fake: http.Server;
let app: FastifyInstance;
let govUrl: string;
const capturedAll: Captured[] = [];
const auditEvents: unknown[] = [];

const tenant: TenantContext = {
  org_id: '00000000-0000-4000-8000-000000000001',
  user_id: '00000000-0000-4000-8000-000000000002',
  tier: 'enterprise',
  operational_mode: 'production',
};

function lastCaptured(): Captured {
  const c = capturedAll.at(-1);
  if (!c) throw new Error('fake provider captured no request');
  return c;
}
function invokedEvents(): Array<Record<string, unknown>> {
  return auditEvents.filter(
    (e): e is Record<string, unknown> =>
      typeof e === 'object' && e !== null && (e as Record<string, unknown>)['event_type'] === 'passthrough.invoked',
  );
}

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      capturedAll.push({ method: req.method ?? '', url: req.url ?? '', rawBody: Buffer.concat(chunks) });
      res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req_openai_query_fidelity' });
      res.end('{"object":"list","data":[]}');
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', () => resolve()));
  const fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

  const deps: OpenAIPassthroughDeps = {
    upstreamBaseUrl: fakeUrl,
    resolveTenant: async () => tenant,
    resolveProviderKey: async () => ({ apiKey: 'harness-fake-provider-key', source: 'platform_env' }),
    activeOverridesLoader: async () => [],
    emitAuditEvent: (ev: unknown) => {
      auditEvents.push(ev);
    },
  };
  app = Fastify({ logger: false });
  await app.register(async (instance) => {
    await registerOpenAIPassthrough(instance, deps);
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  govUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((resolve) => fake.close(() => resolve()));
});

beforeEach(() => {
  capturedAll.length = 0;
  auditEvents.length = 0;
});

describe('OpenAI passthrough — raw query fidelity (M2A F5, real socket)', () => {
  it('F5-T1 GET /v1/files?limit=1&order=desc → provider sees EXACTLY /v1/files?limit=1&order=desc (NOT /v1/files)', async () => {
    const res = await fetch(`${govUrl}/passthrough/openai/v1/files?limit=1&order=desc`, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(lastCaptured().url).toBe('/v1/files?limit=1&order=desc');
    // Registry/evidence unaffected by the query: template endpoint + capability.
    const ev = invokedEvents()[0]!;
    expect(ev['native_endpoint']).toBe('/v1/files');
    expect(ev['capability_id']).toBe('openai.files');
    expect(ev['provider_request_id']).toBe('req_openai_query_fidelity');
    expect(Object.keys(ev).some((k) => /query/i.test(k))).toBe(false);
  });

  it('F5-T2 raw serialization preserved: ?after=a%2Fb&x=&x=two+words (+ %252F, duplicates, order)', async () => {
    const q = '?after=a%2Fb&x=&x=two+words&encoded=%252F&x=1&x=2';
    const res = await fetch(`${govUrl}/passthrough/openai/v1/files${q}`, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(lastCaptured().url).toBe(`/v1/files${q}`);
    // The same on /v1/models
    const res2 = await fetch(`${govUrl}/passthrough/openai/v1/models?limit=1&after=m%2F1`, { method: 'GET' });
    expect(res2.status).toBe(200);
    expect(lastCaptured().url).toBe('/v1/models?limit=1&after=m%2F1');
  });

  it('F5-T5/T7/T9 the query never bypasses routing: 405 unsupported method, 404 unregistered path — no upstream request', async () => {
    const r405 = await fetch(`${govUrl}/passthrough/openai/v1/models?limit=1`, { method: 'PATCH' });
    expect(r405.status).toBe(405);
    const r404 = await fetch(`${govUrl}/passthrough/openai/v1/not-registered?limit=1`, { method: 'GET' });
    expect(r404.status).toBe(404);
    expect(capturedAll.length).toBe(0);
    expect(invokedEvents().length).toBe(0);
  });

  it('control: a path-only request forwards path-only (no query fabricated)', async () => {
    const res = await fetch(`${govUrl}/passthrough/openai/v1/files`, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(lastCaptured().url).toBe('/v1/files');
  });
});
