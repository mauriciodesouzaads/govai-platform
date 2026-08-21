// AI-CONSOLE-ORIGIN-RELAY-01 — OpenAI GOVERNED surfaces, server→provider request-header
// hygiene (EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02 §2/§3).
//
// Governed is a second, independently-built outbound header set: Responses and Chat
// Completions each own a `buildOutboundHeaders`, so proving the Native route is not a
// proof about these. Both governed surfaces are covered here, streaming and
// non-streaming, on a real socket (fake loopback provider + app.listen + real fetch).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerOpenAIGoverned, type OpenAIGovernedDeps } from './register-governed.js';
import type { GovernedTenant } from './handle-responses.js';

let fake: http.Server;
let app: FastifyInstance;
let govUrl: string;
let captured: http.IncomingHttpHeaders | null = null;
let fakeMode: 'json' | 'sse' = 'json';
const auditEvents: Array<Record<string, unknown>> = [];

const SSE_RESP = 'event: response.completed\ndata: {"type":"response.completed"}\n\n';

const BROWSER_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  accept: 'text/event-stream',
  origin: 'http://localhost:5173',
  referer: 'http://localhost:5173/app/ai',
  'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/141 Safari/537.36',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'openai-beta': 'assistants=v2',
  'x-govai-api-key': 'gk_operator_key_never_forwarded',
  'x-console-trace': 'unlisted-header-still-relayed',
};

function upstream(): http.IncomingHttpHeaders {
  if (!captured) throw new Error('fake provider captured no request');
  return captured;
}

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      captured = req.headers;
      if (fakeMode === 'sse') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'openai-request-id': 'req_s' });
        res.end(SSE_RESP);
      } else {
        res.writeHead(200, { 'content-type': 'application/json', 'openai-request-id': 'req_j' });
        res.end('{"id":"resp_1","ok":true}');
      }
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));

  const deps: OpenAIGovernedDeps = {
    upstreamBaseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`,
    resolveTenant: async (): Promise<GovernedTenant> => ({
      org_id: '00000000-0000-4000-8000-0000000000c3',
      tier: 'enterprise',
      operational_mode: 'production',
    }),
    resolveProviderKey: async () => ({ apiKey: 'sk-harness-fake', source: 'platform_env' }),
    resolveProviderOrganization: async () => 'org-harness',
    dlpScan: async () => ({ findings: [] }),
    emitAuditEvent: (ev) => {
      auditEvents.push(ev as unknown as Record<string, unknown>);
    },
  };
  app = Fastify({ logger: false });
  await app.register(async (i) => registerOpenAIGoverned(i, deps));
  await app.listen({ port: 0, host: '127.0.0.1' });
  govUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((r) => fake.close(() => r()));
});

beforeEach(() => {
  captured = null;
  fakeMode = 'json';
  auditEvents.length = 0;
});

async function post(path: string, body: Record<string, unknown>): Promise<Response> {
  const res = await fetch(`${govUrl}${path}`, {
    method: 'POST',
    headers: BROWSER_HEADERS,
    body: JSON.stringify(body),
  });
  await res.text();
  return res;
}

describe('OpenAI governed Responses — inbound-hop header hygiene', () => {
  it('NON-STREAM: the browser Origin never reaches the provider', async () => {
    const res = await post('/governed/openai/v1/responses', { model: 'gpt-x', input: 'hi' });
    expect(res.status).toBe(200);
    expect(upstream()['origin']).toBeUndefined();
  });

  it('STREAM: the browser Origin never reaches the provider', async () => {
    fakeMode = 'sse';
    const res = await post('/governed/openai/v1/responses', {
      model: 'gpt-x',
      input: 'hi',
      stream: true,
    });
    expect(res.status).toBe(200);
    expect(upstream()['origin']).toBeUndefined();
  });

  it('preserves provider-native headers, applies provider auth + organization, strips GovAI auth', async () => {
    await post('/governed/openai/v1/responses', { model: 'gpt-x', input: 'hi' });
    const h = upstream();
    expect(h['content-type']).toBe('application/json');
    expect(h['accept']).toBe('text/event-stream');
    expect(h['openai-beta']).toBe('assistants=v2');
    expect(h['x-console-trace']).toBe('unlisted-header-still-relayed');
    expect(h['authorization']).toBe('Bearer sk-harness-fake');
    expect(h['openai-organization']).toBe('org-harness');
    expect(h['x-govai-api-key']).toBeUndefined();
  });

  it('DELIBERATE BOUNDARY: user-agent, referer and sec-fetch-* are NOT stripped', async () => {
    await post('/governed/openai/v1/responses', { model: 'gpt-x', input: 'hi' });
    const h = upstream();
    expect(h['user-agent']).toBe(BROWSER_HEADERS['user-agent']);
    expect(h['referer']).toBe('http://localhost:5173/app/ai');
    expect(h['sec-fetch-mode']).toBe('cors');
    expect(h['sec-fetch-site']).toBe('same-origin');
  });
});

describe('OpenAI governed Chat Completions — inbound-hop header hygiene', () => {
  const CHAT = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    model: 'gpt-x',
    messages: [{ role: 'user', content: 'hi' }],
    ...extra,
  });

  it('NON-STREAM: the browser Origin never reaches the provider', async () => {
    const res = await post('/governed/openai/v1/chat/completions', CHAT());
    expect(res.status).toBe(200);
    expect(upstream()['origin']).toBeUndefined();
  });

  it('STREAM: the browser Origin never reaches the provider', async () => {
    fakeMode = 'sse';
    const res = await post('/governed/openai/v1/chat/completions', CHAT({ stream: true }));
    expect(res.status).toBe(200);
    expect(upstream()['origin']).toBeUndefined();
  });

  it('preserves provider-native headers and the deliberate boundary', async () => {
    await post('/governed/openai/v1/chat/completions', CHAT());
    const h = upstream();
    expect(h['content-type']).toBe('application/json');
    expect(h['openai-beta']).toBe('assistants=v2');
    expect(h['authorization']).toBe('Bearer sk-harness-fake');
    expect(h['openai-organization']).toBe('org-harness');
    expect(h['x-govai-api-key']).toBeUndefined();
    expect(h['user-agent']).toBe(BROWSER_HEADERS['user-agent']);
    expect(h['referer']).toBe('http://localhost:5173/app/ai');
  });
});
