// Provider-Native Compatibility Harness — H1: Anthropic passthrough.
//
// Proves the /passthrough/anthropic/* surface preserves the native experience:
//   - request body forwarded BYTE-FOR-BYTE (canonical proof: Buffer.compare === 0);
//   - client max_tokens (777) preserved exactly — never rewritten to the /v1/runs
//     shortcut's hardcoded 1024;
//   - unknown/future fields preserved (auxiliary, only after byte equality);
//   - client anthropic-version header preserved; inbound GovAI auth stripped and
//     provider x-api-key injected; default anthropic-version injected ONLY when the
//     client omits it (a required provider header, not a hidden model/token cap);
//   - provider status / response body / headers / error shape preserved verbatim;
//   - passthrough is NOT remapped through /v1/runs.
//
// Hermetic: a loopback fake provider; no real Anthropic call; no .env; no secrets.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAnthropicPassthrough, type AnthropicPassthroughDeps } from '@govai/provider-anthropic';
import { startFakeProvider, type FakeProvider } from './fake-provider-transport.js';
import {
  ANTHROPIC_MESSAGES_REQUEST_RAW,
  ANTHROPIC_MESSAGES_SUCCESS_RAW,
  ANTHROPIC_ERROR_529_RAW,
  ANTHROPIC_SUCCESS_HEADERS,
  ANTHROPIC_ERROR_HEADERS,
} from './fixtures.js';

const MESSAGES_PATH = '/passthrough/anthropic/v1/messages';

let fake: FakeProvider;
let app: FastifyInstance;

beforeAll(async () => {
  fake = await startFakeProvider();
  app = Fastify({ logger: false });
  const deps: AnthropicPassthroughDeps = {
    upstreamBaseUrl: fake.url,
    resolveTenant: async () => ({
      org_id: '00000000-0000-0000-0000-000000000001',
      user_id: '00000000-0000-0000-0000-000000000002',
      tier: 'enterprise',
      operational_mode: 'production',
    }),
    resolveProviderKey: async () => 'sk-ant-fake-test-key-not-real',
    activeOverridesLoader: async () => [],
    emitAuditEvent: async () => {},
  };
  await registerAnthropicPassthrough(app, deps);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await fake.stop();
});

beforeEach(() => {
  fake.reset();
});

function injectMessages(sentRawBody: Buffer, extraHeaders: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: MESSAGES_PATH,
    headers: { 'content-type': 'application/json', 'x-govai-api-key': 'gk-fake', ...extraHeaders },
    payload: sentRawBody,
  });
}

describe('Anthropic passthrough — request body preservation', () => {
  it('forwards the request body byte-for-byte (hand-authored raw, not re-serialized)', async () => {
    fake.setResponse({ status: 200, headers: ANTHROPIC_SUCCESS_HEADERS, rawBody: ANTHROPIC_MESSAGES_SUCCESS_RAW });
    const sentRawBody = Buffer.from(ANTHROPIC_MESSAGES_REQUEST_RAW, 'utf8');

    const res = await injectMessages(sentRawBody);

    expect(res.statusCode).toBe(200);
    expect(fake.callCount).toBe(1);
    const captured = fake.lastRequest!;
    // CANONICAL PROOF — byte-for-byte.
    expect(Buffer.compare(captured.rawBody, sentRawBody)).toBe(0);

    // Auxiliary, only after byte equality.
    const parsed = JSON.parse(captured.rawBody.toString('utf8')) as Record<string, unknown>;
    expect(parsed['future_anthropic_field']).toBe('must-survive');
    expect(parsed['vendor_nested_object']).toEqual({ z_first: 1, a_second: [10, 20, 30] });
    expect(parsed['experimental_array']).toEqual([{ k: 'v' }, 'raw', 42]);
    expect(parsed['model']).toBe('claude-sonnet-4-5');
    expect(parsed['tool_choice']).toBe('auto');
  });

  it('preserves the client max_tokens exactly (777) and never rewrites it to 1024', async () => {
    fake.setResponse({ status: 200, headers: ANTHROPIC_SUCCESS_HEADERS, rawBody: ANTHROPIC_MESSAGES_SUCCESS_RAW });
    const sentRawBody = Buffer.from(ANTHROPIC_MESSAGES_REQUEST_RAW, 'utf8');

    await injectMessages(sentRawBody);

    const captured = fake.lastRequest!;
    expect(Buffer.compare(captured.rawBody, sentRawBody)).toBe(0);
    const parsed = JSON.parse(captured.rawBody.toString('utf8')) as Record<string, unknown>;
    expect(parsed['max_tokens']).toBe(777);
    expect(parsed['max_tokens']).not.toBe(1024);
    expect(parsed['model']).toBe('claude-sonnet-4-5');
  });
});

describe('Anthropic passthrough — header handling', () => {
  it('preserves a client-supplied anthropic-version, strips inbound GovAI auth, injects provider x-api-key', async () => {
    fake.setResponse({ status: 200, headers: ANTHROPIC_SUCCESS_HEADERS, rawBody: ANTHROPIC_MESSAGES_SUCCESS_RAW });

    await injectMessages(Buffer.from(ANTHROPIC_MESSAGES_REQUEST_RAW, 'utf8'), {
      'anthropic-version': '2026-01-01',
    });

    const captured = fake.lastRequest!;
    // Client's anthropic-version is preserved, NOT overwritten by the default.
    expect(captured.headers['anthropic-version']).toBe('2026-01-01');
    // Inbound GovAI auth is stripped; provider auth is injected.
    expect(captured.headers['x-govai-api-key']).toBeUndefined();
    expect(captured.headers['x-api-key']).toBe('sk-ant-fake-test-key-not-real');
  });

  it('injects the default anthropic-version only when the client omits it (required provider header)', async () => {
    fake.setResponse({ status: 200, headers: ANTHROPIC_SUCCESS_HEADERS, rawBody: ANTHROPIC_MESSAGES_SUCCESS_RAW });

    // No anthropic-version sent by the client.
    await injectMessages(Buffer.from(ANTHROPIC_MESSAGES_REQUEST_RAW, 'utf8'));

    const captured = fake.lastRequest!;
    // Documented behavior: this is a REQUIRED provider header for the Anthropic API,
    // not a hidden cap/default of model or tokens.
    expect(captured.headers['anthropic-version']).toBe('2023-06-01');
  });
});

describe('Anthropic passthrough — response fidelity', () => {
  it('preserves provider status code, response body bytes, and relevant headers', async () => {
    fake.setResponse({ status: 202, headers: ANTHROPIC_SUCCESS_HEADERS, rawBody: ANTHROPIC_MESSAGES_SUCCESS_RAW });

    const res = await injectMessages(Buffer.from(ANTHROPIC_MESSAGES_REQUEST_RAW, 'utf8'));

    expect(res.statusCode).toBe(202);
    expect(Buffer.compare(res.rawPayload, Buffer.from(ANTHROPIC_MESSAGES_SUCCESS_RAW, 'utf8'))).toBe(0);
    expect(res.headers['request-id']).toBe('req_FAKE_456');
    expect(res.headers['anthropic-ratelimit-requests-remaining']).toBe('49');
    expect(res.headers['anthropic-ratelimit-tokens-remaining']).toBe('99000');
    const parsed = JSON.parse(res.rawPayload.toString('utf8')) as Record<string, unknown>;
    expect(parsed['provider_unknown_future_field']).toBe('survive-response');
  });

  it('forwards provider error status + body verbatim (no GovAI error reshape)', async () => {
    fake.setResponse({ status: 529, headers: ANTHROPIC_ERROR_HEADERS, rawBody: ANTHROPIC_ERROR_529_RAW });

    const res = await injectMessages(Buffer.from(ANTHROPIC_MESSAGES_REQUEST_RAW, 'utf8'));

    expect(res.statusCode).toBe(529);
    expect(res.statusCode).not.toBe(500);
    expect(res.statusCode).not.toBe(200);
    expect(Buffer.compare(res.rawPayload, Buffer.from(ANTHROPIC_ERROR_529_RAW, 'utf8'))).toBe(0);
    // Provider-native error shape preserved (NOT normalized to a GovAI body).
    const parsed = JSON.parse(res.rawPayload.toString('utf8')) as { type?: string; error?: { type?: string } };
    expect(parsed.type).toBe('error');
    expect(parsed.error?.type).toBe('overloaded_error');
  });
});

describe('Anthropic passthrough — no /v1/runs remap, hermetic transport', () => {
  it('reaches the native endpoint with the client body, not the /v1/runs shortcut shape', async () => {
    fake.setResponse({ status: 200, headers: ANTHROPIC_SUCCESS_HEADERS, rawBody: ANTHROPIC_MESSAGES_SUCCESS_RAW });
    const sentRawBody = Buffer.from(ANTHROPIC_MESSAGES_REQUEST_RAW, 'utf8');

    await injectMessages(sentRawBody);

    const captured = fake.lastRequest!;
    expect(captured.path).toBe('/v1/messages');
    expect(Buffer.compare(captured.rawBody, sentRawBody)).toBe(0);
    const parsed = JSON.parse(captured.rawBody.toString('utf8')) as Record<string, unknown>;
    // The /v1/runs shortcut hardcodes max_tokens:1024 and builds its own envelope.
    expect(parsed['max_tokens']).toBe(777);
    expect('workspace_id' in parsed).toBe(false);
    expect('capability' in parsed).toBe(false);
  });

  it('routes only to the hermetic loopback transport (no real provider)', async () => {
    // The single-upstream-call guarantee is asserted in the clean-slot
    // body-preservation test above (fake.callCount === 1). Here we assert the
    // hermetic property deterministically: the upstream is loopback and it
    // received exactly this test's bytes — no external host is ever contacted.
    fake.setResponse({ status: 200, headers: ANTHROPIC_SUCCESS_HEADERS, rawBody: ANTHROPIC_MESSAGES_SUCCESS_RAW });
    const sentRawBody = Buffer.from(ANTHROPIC_MESSAGES_REQUEST_RAW, 'utf8');

    await injectMessages(sentRawBody);

    expect(fake.url.startsWith('http://127.0.0.1:')).toBe(true);
    const captured = fake.lastRequest!;
    expect(captured.path).toBe('/v1/messages');
    expect(Buffer.compare(captured.rawBody, sentRawBody)).toBe(0);
  });
});
