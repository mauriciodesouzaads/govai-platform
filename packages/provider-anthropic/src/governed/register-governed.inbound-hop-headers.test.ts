// AI-CONSOLE-ORIGIN-RELAY-01 — Anthropic GOVERNED surface, server→provider request-header
// hygiene (EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02 §2/§3).
//
// Governed builds its own outbound header set (handle-messages.ts), so the Native route's
// proof says nothing about this path. Streaming and non-streaming, real socket (fake
// loopback provider + app.listen + real fetch).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  registerAnthropicGoverned,
  type AnthropicGovernedDeps,
} from './register-governed.js';
import type { GovernedTenant } from './handle-messages.js';

let fake: http.Server;
let app: FastifyInstance;
let govUrl: string;
let captured: http.IncomingHttpHeaders | null = null;
let fakeMode: 'json' | 'sse' = 'json';
const auditEvents: Array<Record<string, unknown>> = [];

const SSE = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';

const BROWSER_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  accept: 'text/event-stream',
  origin: 'http://localhost:5173',
  referer: 'http://localhost:5173/app/ai',
  'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/141 Safari/537.36',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'files-api-2025-04-14',
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
        res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_s' });
        res.end(SSE);
      } else {
        res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_j' });
        res.end('{"id":"msg_1","ok":true}');
      }
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));

  const deps: AnthropicGovernedDeps = {
    upstreamBaseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`,
    resolveTenant: async (): Promise<GovernedTenant> => ({
      org_id: '00000000-0000-4000-8000-0000000000a3',
      tier: 'enterprise',
      operational_mode: 'production',
    }),
    resolveProviderKey: async () => ({ apiKey: 'sk-ant-harness-fake', source: 'platform_env' }),
    dlpScan: async () => ({ findings: [] }),
    emitAuditEvent: (ev) => {
      auditEvents.push(ev as unknown as Record<string, unknown>);
    },
  };
  app = Fastify({ logger: false });
  await app.register(async (i) => registerAnthropicGoverned(i, deps));
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

const MSG = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  model: 'claude-x',
  max_tokens: 16,
  messages: [{ role: 'user', content: 'hi' }],
  ...extra,
});

async function post(body: Record<string, unknown>): Promise<Response> {
  const res = await fetch(`${govUrl}/governed/anthropic/v1/messages`, {
    method: 'POST',
    headers: BROWSER_HEADERS,
    body: JSON.stringify(body),
  });
  await res.text();
  return res;
}

describe('Anthropic governed Messages — inbound-hop header hygiene', () => {
  it('NON-STREAM: the browser Origin never reaches the provider (the live 401 trigger)', async () => {
    const res = await post(MSG());
    expect(res.status).toBe(200);
    expect(upstream()['origin']).toBeUndefined();
  });

  it('STREAM: the browser Origin never reaches the provider', async () => {
    fakeMode = 'sse';
    const res = await post(MSG({ stream: true }));
    expect(res.status).toBe(200);
    expect(upstream()['origin']).toBeUndefined();
  });

  it('preserves provider-native headers, applies the provider key, strips GovAI auth', async () => {
    await post(MSG());
    const h = upstream();
    expect(h['content-type']).toBe('application/json');
    expect(h['accept']).toBe('text/event-stream');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h['anthropic-beta']).toBe('files-api-2025-04-14');
    expect(h['x-console-trace']).toBe('unlisted-header-still-relayed');
    expect(h['x-api-key']).toBe('sk-ant-harness-fake');
    expect(h['x-govai-api-key']).toBeUndefined();
  });

  it('DELIBERATE BOUNDARY: user-agent, referer and sec-fetch-* are NOT stripped', async () => {
    await post(MSG());
    const h = upstream();
    expect(h['user-agent']).toBe(BROWSER_HEADERS['user-agent']);
    expect(h['referer']).toBe('http://localhost:5173/app/ai');
    expect(h['sec-fetch-mode']).toBe('cors');
    expect(h['sec-fetch-site']).toBe('same-origin');
  });
});
