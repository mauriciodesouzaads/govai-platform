// AI-CONSOLE-ORIGIN-RELAY-01 — OpenAI Native/Audited passthrough, server→provider
// request-header hygiene (EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02 §2/§3).
//
// Real socket on BOTH hops (fake loopback provider + app.listen + real fetch), so the
// assertion is about the bytes GovAI actually put on the wire, not about a helper's
// return value. Node's fetch forwards an explicitly-set `origin`, which is what lets a
// test reproduce the browser hop at all.
//
// Contract proven here, for the streaming AND non-streaming variants (one outbound
// header set serves both):
//   • `origin` — which describes the CLIENT→GovAI hop — never reaches the provider;
//   • every provider-native header the client sent still does (content-type, accept,
//     openai-beta, plus any unlisted header);
//   • the server-side `openai-organization` is still generated;
//   • inbound GovAI/provider auth is still replaced by the resolved credential;
//   • the DELIBERATE BOUNDARY holds — `user-agent`, `referer` and the `sec-fetch-*` /
//     `sec-ch-ua*` families are NOT stripped. Over-stripping is a regression too.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  registerOpenAIPassthrough,
  type OpenAIPassthroughDeps,
} from './register-passthrough.js';
import type { TenantContext } from '../passthrough/audit-emit.js';

type Captured = { headers: http.IncomingHttpHeaders };

let fake: http.Server;
let app: FastifyInstance;
let govUrl: string;
let captured: Captured | null = null;
let fakeMode: 'json' | 'sse' = 'json';
const auditEvents: Array<Record<string, unknown>> = [];

const tenant: TenantContext = {
  org_id: '00000000-0000-4000-8000-0000000000c1',
  user_id: '00000000-0000-4000-8000-0000000000c2',
  tier: 'enterprise',
  operational_mode: 'production',
};

const SSE = 'event: response.completed\ndata: {"type":"response.completed"}\n\n';

/** The header set a browser puts on a same-origin POST to GovAI, plus the
 *  provider-native and GovAI-auth headers a real console request carries. */
const BROWSER_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  accept: 'text/event-stream',
  'accept-language': 'pt-BR,pt;q=0.9',
  origin: 'http://localhost:5173',
  referer: 'http://localhost:5173/app/ai',
  'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/141 Safari/537.36',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-dest': 'empty',
  'sec-ch-ua': '"Chromium";v="141"',
  'openai-beta': 'assistants=v2',
  'x-govai-api-key': 'gk_operator_key_never_forwarded',
  'x-console-trace': 'unlisted-header-still-relayed',
};

function upstream(): http.IncomingHttpHeaders {
  if (!captured) throw new Error('fake provider captured no request');
  return captured.headers;
}

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      captured = { headers: req.headers };
      if (fakeMode === 'sse') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(SSE);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"id":"resp_1","ok":true}');
      }
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));

  const deps: OpenAIPassthroughDeps = {
    upstreamBaseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`,
    resolveTenant: async () => tenant,
    resolveProviderKey: async () => ({ apiKey: 'sk-harness-fake', source: 'platform_env' }),
    resolveProviderOrganization: async () => 'org-harness',
    activeOverridesLoader: async () => [],
    emitAuditEvent: (ev: unknown) => {
      auditEvents.push(ev as Record<string, unknown>);
    },
  };
  app = Fastify({ logger: false });
  await app.register(async (i) => {
    await registerOpenAIPassthrough(i, deps);
  });
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

async function post(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${govUrl}/passthrough/openai/v1/responses`, {
    method: 'POST',
    headers: BROWSER_HEADERS,
    body: JSON.stringify(body),
  });
}

describe('OpenAI passthrough (Native/Audited) — inbound-hop header hygiene', () => {
  it('NON-STREAM: the browser Origin never reaches the provider', async () => {
    const res = await post({ model: 'gpt-x', input: 'hi' });
    expect(res.status).toBe(200);
    expect(upstream()['origin']).toBeUndefined();
  });

  it('STREAM: the browser Origin never reaches the provider', async () => {
    fakeMode = 'sse';
    const res = await post({ model: 'gpt-x', input: 'hi', stream: true });
    expect(res.status).toBe(200);
    await res.text();
    expect(upstream()['origin']).toBeUndefined();
  });

  it('provider-native and unlisted client headers are PRESERVED (the strip is not a purge)', async () => {
    await post({ model: 'gpt-x', input: 'hi' });
    const h = upstream();
    expect(h['content-type']).toBe('application/json');
    expect(h['accept']).toBe('text/event-stream');
    expect(h['accept-language']).toBe('pt-BR,pt;q=0.9');
    expect(h['openai-beta']).toBe('assistants=v2');
    expect(h['x-console-trace']).toBe('unlisted-header-still-relayed');
  });

  it('DELIBERATE BOUNDARY: user-agent, referer and the sec-* families are NOT stripped', async () => {
    await post({ model: 'gpt-x', input: 'hi' });
    const h = upstream();
    expect(h['user-agent']).toBe(BROWSER_HEADERS['user-agent']);
    expect(h['referer']).toBe('http://localhost:5173/app/ai');
    expect(h['sec-fetch-mode']).toBe('cors');
    expect(h['sec-fetch-site']).toBe('same-origin');
    expect(h['sec-fetch-dest']).toBe('empty');
    expect(h['sec-ch-ua']).toBe('"Chromium";v="141"');
  });

  it('credential semantics are unchanged: GovAI auth stripped, provider auth + organization applied', async () => {
    await post({ model: 'gpt-x', input: 'hi' });
    const h = upstream();
    expect(h['x-govai-api-key']).toBeUndefined();
    expect(h['authorization']).toBe('Bearer sk-harness-fake');
    expect(h['openai-organization']).toBe('org-harness');
  });

  it('Origin is matched case-insensitively (a raw ORIGIN header is still not relayed)', async () => {
    // Set through raw node:http so the header keeps its uppercase spelling on the wire.
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(`${govUrl}/passthrough/openai/v1/responses`);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ORIGIN: 'http://localhost:5173' },
        },
        (res) => {
          res.on('data', () => undefined);
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ model: 'gpt-x', input: 'hi' }));
    });
    expect(status).toBe(200);
    expect(upstream()['origin']).toBeUndefined();
  });
});
