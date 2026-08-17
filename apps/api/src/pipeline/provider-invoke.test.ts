// Regression test: x-test-workspace-id is forwarded ONLY when NODE_ENV='test'
// AND baseUrl is loopback. Any other combination drops the header.

import { describe, it, expect } from 'vitest';
import { buildProviderHeaders } from './provider-invoke.js';

const WS = '00000000-0000-0000-0000-000000000abc';

describe('buildProviderHeaders — hermetic test discriminator', () => {
  it('forwards header only when testMode=true AND loopback baseUrl', () => {
    const h = buildProviderHeaders({
      baseUrl: 'http://127.0.0.1:5000',
      workspaceId: WS,
      testMode: true,
    });
    expect(h['x-test-workspace-id']).toBe(WS);
    expect(h['content-type']).toBe('application/json');
  });

  it('localhost:port also forwards', () => {
    const h = buildProviderHeaders({
      baseUrl: 'http://localhost:8080',
      workspaceId: WS,
      testMode: true,
    });
    expect(h['x-test-workspace-id']).toBe(WS);
  });

  it('drops header in production-like env (testMode=false)', () => {
    const h = buildProviderHeaders({
      baseUrl: 'http://127.0.0.1:5000',
      workspaceId: WS,
      testMode: false,
    });
    expect(h['x-test-workspace-id']).toBeUndefined();
  });

  it('drops header against non-loopback baseUrl even with testMode=true', () => {
    const h = buildProviderHeaders({
      baseUrl: 'https://api.anthropic.com',
      workspaceId: WS,
      testMode: true,
    });
    expect(h['x-test-workspace-id']).toBeUndefined();
  });

  it('drops header against URL-smuggling tricks even with testMode=true', () => {
    for (const url of [
      'http://127.0.0.1:80@evil.com',
      'http://localhost.attacker.com/',
      'http://127.0.0.1.evil/',
      'http://user:pass@127.0.0.1/',
    ]) {
      const h = buildProviderHeaders({ baseUrl: url, workspaceId: WS, testMode: true });
      expect(h['x-test-workspace-id'], `url=${url}`).toBeUndefined();
    }
  });

  it('drops header when workspaceId is missing', () => {
    const h = buildProviderHeaders({ baseUrl: 'http://127.0.0.1:5000', testMode: true });
    expect(h['x-test-workspace-id']).toBeUndefined();
  });

  it('preserves caller-provided baseHeaders', () => {
    const h = buildProviderHeaders({
      baseUrl: 'https://api.anthropic.com',
      testMode: false,
      baseHeaders: { 'x-api-key': 'sk-ant-test', authorization: 'Bearer x' },
    });
    expect(h['x-api-key']).toBe('sk-ant-test');
    expect(h['authorization']).toBe('Bearer x');
    expect(h['x-test-workspace-id']).toBeUndefined();
  });
});

// =============================================================================
// M2A F1 — provider-AWARE request id extraction in the shared dispatcher.
// =============================================================================
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll } from 'vitest';
import { extractProviderRequestId, invokeProvider } from './provider-invoke.js';

describe('extractProviderRequestId — provider-aware (M2A F1)', () => {
  it('anthropic.messages.create: REAL `request-id` first, then anthropic-request-id, then x-request-id, else null', () => {
    const cap = 'anthropic.messages.create' as const;
    expect(
      extractProviderRequestId(
        cap,
        new Headers({ 'x-request-id': 'x', 'anthropic-request-id': 'legacy', 'request-id': 'req_real' }),
      ),
    ).toBe('req_real');
    expect(extractProviderRequestId(cap, new Headers({ 'anthropic-request-id': 'legacy' }))).toBe('legacy');
    expect(extractProviderRequestId(cap, new Headers({ 'x-request-id': 'x' }))).toBe('x');
    expect(extractProviderRequestId(cap, new Headers({}))).toBeNull();
  });

  it('F1-T7 openai.*: x-request-id only — a synthetic request-id / anthropic-request-id must NOT override it', () => {
    for (const cap of ['openai.responses.create', 'openai.chat.completions.create'] as const) {
      expect(
        extractProviderRequestId(
          cap,
          new Headers({ 'request-id': 'wrong-generic-value', 'x-request-id': 'real-openai-value' }),
        ),
      ).toBe('real-openai-value');
      expect(
        extractProviderRequestId(
          cap,
          new Headers({ 'anthropic-request-id': 'wrong-anthropic-value', 'x-request-id': 'real-openai-value' }),
        ),
      ).toBe('real-openai-value');
      // OpenAI without x-request-id → null even if Anthropic-style names are present (no cross-provider leak).
      expect(
        extractProviderRequestId(cap, new Headers({ 'request-id': 'wrong', 'anthropic-request-id': 'wrong2' })),
      ).toBeNull();
      expect(extractProviderRequestId(cap, new Headers({ 'x-request-id': '' }))).toBeNull();
    }
  });
});

describe('invokeProvider — provider_request_id end-to-end over a local HTTP server (M2A F1)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (req.url === '/v1/messages') {
          // Real Anthropic shape: ONLY `request-id`.
          headers['request-id'] = 'req_anthropic_real';
          res.writeHead(200, headers);
          res.end(JSON.stringify({ id: 'msg_1', type: 'message', usage: { input_tokens: 1, output_tokens: 1 } }));
          return;
        }
        // Adversarial OpenAI shape: a decoy generic `request-id` next to the real `x-request-id`.
        headers['request-id'] = 'wrong-generic-value';
        headers['x-request-id'] = 'real-openai-value';
        res.writeHead(200, headers);
        res.end(JSON.stringify({ id: 'resp_1', usage: { input_tokens: 1, output_tokens: 1 } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('anthropic run captures the REAL `request-id`', async () => {
    const r = await invokeProvider({
      capability: 'anthropic.messages.create',
      model: 'm',
      inputText: 'hi',
      baseUrl,
    });
    expect(r.responseStatus).toBe(200);
    expect(r.providerRequestId).toBe('req_anthropic_real');
  });

  it('F1-T7 openai run keeps x-request-id and ignores the decoy request-id', async () => {
    for (const capability of ['openai.responses.create', 'openai.chat.completions.create'] as const) {
      const r = await invokeProvider({ capability, model: 'm', inputText: 'hi', baseUrl });
      expect(r.responseStatus).toBe(200);
      expect(r.providerRequestId).toBe('real-openai-value');
    }
  });
});
