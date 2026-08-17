// M2A F5 — provider-native QUERY fidelity for the Anthropic passthrough.
//
// Real socket path (node:http fake provider + real Fastify + real fetch, NOT
// app.inject) so the fake provider records the EXACT request-target GovAI put
// on the wire. Contract: routing/capability matching is pathname-only, but the
// upstream forward preserves the raw query byte-semantics — key order,
// duplicates, empty values, percent escapes (`%2F`, `%252F`), `+` — with no
// decode/re-encode and no URLSearchParams reconstruction. The Claude CLI marker
// `?beta=true` is preserved like any other component (real Anthropic accepts
// `POST /v1/messages?beta=true` — M2A §6 direct probe, HTTP 200).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  registerAnthropicPassthrough,
  type AnthropicPassthroughDeps,
} from './register-passthrough.js';
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

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
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
      // Real Anthropic shape: ONLY `request-id`.
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_query_fidelity' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', () => resolve()));
  const fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

  const deps: AnthropicPassthroughDeps = {
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
    await registerAnthropicPassthrough(instance, deps);
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

describe('Anthropic passthrough — raw query fidelity (M2A F5, real socket)', () => {
  it('F5-T3 GET /v1/models?limit=1 → provider sees EXACTLY /v1/models?limit=1', async () => {
    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/models?limit=1`, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(lastCaptured().url).toBe('/v1/models?limit=1');
    // Registry/evidence: template + capability unaffected by the query.
    const ev = invokedEvents()[0]!;
    expect(ev['native_endpoint']).toBe('/v1/models');
    expect(ev['capability_id']).toBe('anthropic.models');
    expect(ev['provider_request_id']).toBe('req_query_fidelity');
  });

  it('F5-T4 duplicate keys, empty values, percent escapes, `+`, double-encoding preserved raw', async () => {
    const q = '?after=a%2Fb&x=&x=two+words&encoded=%252F&x=1&x=2&order=desc';
    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/models${q}`, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(lastCaptured().url).toBe(`/v1/models${q}`);
  });

  it('F5-T8 the Claude CLI marker POST /v1/messages?beta=true is PRESERVED (§6 CASE A: real Anthropic accepts it)', async () => {
    const body = Buffer.from('{"model":"claude-x","max_tokens":5,"messages":[{"role":"user","content":"hi"}]}', 'utf8');
    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/messages?beta=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(200);
    const cap = lastCaptured();
    expect(cap.url).toBe('/v1/messages?beta=true');
    // F5-T10 body fidelity unchanged: bytes + hash identical with a query present.
    expect(Buffer.compare(cap.rawBody, body)).toBe(0);
    const ev = invokedEvents()[0]!;
    expect(ev['native_request_hash']).toBe(sha256(body));
    // F5-T11 event schema unchanged: template endpoint, v4, no fabricated query field.
    expect(ev['schema_version']).toBe(4);
    expect(ev['native_endpoint']).toBe('/v1/messages');
    expect(ev['capability_id']).toBe('anthropic.messages.create');
    expect(Object.keys(ev).some((k) => /query/i.test(k))).toBe(false);
  });

  it('F5-T8b beta=true mixed with other components: everything preserved verbatim, nothing consumed', async () => {
    const q = '?beta=true&foo=a%2Fb&x=&x=two+words';
    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/messages${q}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"model":"claude-x","max_tokens":5,"messages":[]}',
    });
    expect(res.status).toBe(200);
    expect(lastCaptured().url).toBe(`/v1/messages${q}`);
  });

  it('F5-T5/T7/T9 the query never bypasses routing: 405 for an unsupported method, 404 for an unregistered path — no upstream request', async () => {
    const r405 = await fetch(`${govUrl}/passthrough/anthropic/v1/models?limit=1`, {
      method: 'DELETE',
    });
    expect(r405.status).toBe(405);
    const r404 = await fetch(`${govUrl}/passthrough/anthropic/v1/not-registered?limit=1`, { method: 'GET' });
    expect(r404.status).toBe(404);
    expect(capturedAll.length).toBe(0);
    expect(invokedEvents().length).toBe(0);
  });

  it('QUERY_STRIP_GENERAL_REGEX_REMOVED: no query is ever silently erased (control: path-only request forwards path-only)', async () => {
    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/models`, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(lastCaptured().url).toBe('/v1/models');
    // trailing '?' with an empty query is a byte of the request-target: preserved as-is.
    const res2 = await fetch(`${govUrl}/passthrough/anthropic/v1/models?`, { method: 'GET' });
    expect(res2.status).toBe(200);
    expect(lastCaptured().url).toBe('/v1/models?');
  });
});
