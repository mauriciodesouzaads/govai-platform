// Provider-Native Compatibility Harness — H1: OpenAI passthrough.
//
// Proves the /passthrough/openai/* surface preserves the native experience:
//   - request body forwarded BYTE-FOR-BYTE (canonical proof: Buffer.compare === 0);
//   - unknown/future fields preserved (auxiliary, only after byte equality);
//   - no hidden caps/defaults injected (no max_tokens / max_completion_tokens / temperature);
//   - provider status / response body / headers / error shape preserved verbatim;
//   - passthrough is NOT remapped through /v1/runs.
//
// Hermetic: a loopback fake provider; no real OpenAI call; no .env; no secrets.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerOpenAIPassthrough, type OpenAIPassthroughDeps } from '@govai/provider-openai';
import { startFakeProvider, type FakeProvider } from './fake-provider-transport.js';
import {
  OPENAI_CHAT_REQUEST_RAW,
  OPENAI_CHAT_SUCCESS_RAW,
  OPENAI_ERROR_429_RAW,
  OPENAI_SUCCESS_HEADERS,
  OPENAI_ERROR_HEADERS,
} from './fixtures.js';

const CHAT_PATH = '/passthrough/openai/v1/chat/completions';

let fake: FakeProvider;
let app: FastifyInstance;

beforeAll(async () => {
  fake = await startFakeProvider();
  app = Fastify({ logger: false });
  const deps: OpenAIPassthroughDeps = {
    upstreamBaseUrl: fake.url,
    resolveTenant: async () => ({
      org_id: '00000000-0000-0000-0000-000000000001',
      user_id: '00000000-0000-0000-0000-000000000002',
      tier: 'beta',
      operational_mode: 'pilot',
    }),
    resolveProviderKey: async () => 'sk-fake-test-key-not-real',
    activeOverridesLoader: async () => [],
    emitAuditEvent: async () => {},
  };
  await registerOpenAIPassthrough(app, deps);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await fake.stop();
});

beforeEach(() => {
  fake.reset();
});

function injectChat(sentRawBody: Buffer) {
  return app.inject({
    method: 'POST',
    url: CHAT_PATH,
    headers: { 'content-type': 'application/json', 'x-govai-api-key': 'gk-fake' },
    payload: sentRawBody,
  });
}

describe('OpenAI passthrough — request body preservation', () => {
  it('forwards the request body byte-for-byte (hand-authored raw, not re-serialized)', async () => {
    fake.setResponse({ status: 200, headers: OPENAI_SUCCESS_HEADERS, rawBody: OPENAI_CHAT_SUCCESS_RAW });
    const sentRawBody = Buffer.from(OPENAI_CHAT_REQUEST_RAW, 'utf8');

    const res = await injectChat(sentRawBody);

    expect(res.statusCode).toBe(200);
    expect(fake.callCount).toBe(1);
    const captured = fake.lastRequest!;
    // CANONICAL PROOF — byte-for-byte. Fails if the path re-serialized the JSON
    // (whitespace / key order would change) even if the parsed JSON deep-equals.
    expect(Buffer.compare(captured.rawBody, sentRawBody)).toBe(0);

    // Auxiliary, only meaningful AFTER byte equality: unknown/future fields intact.
    const parsed = JSON.parse(captured.rawBody.toString('utf8')) as Record<string, unknown>;
    expect(parsed['future_openai_field']).toBe('must-survive');
    expect(parsed['vendor_nested_object']).toEqual({ z_first: 1, a_second: [10, 20, 30] });
    expect(parsed['experimental_array']).toEqual([{ k: 'v' }, 'raw', 42]);
    expect(parsed['model']).toBe('gpt-4o-2024-11-20');
    expect(parsed['tool_choice']).toBe('auto');
  });

  it('injects no caps/defaults (no max_tokens, max_completion_tokens, temperature, or model default)', async () => {
    fake.setResponse({ status: 200, headers: OPENAI_SUCCESS_HEADERS, rawBody: OPENAI_CHAT_SUCCESS_RAW });
    const sentRawBody = Buffer.from(OPENAI_CHAT_REQUEST_RAW, 'utf8');

    await injectChat(sentRawBody);

    const captured = fake.lastRequest!;
    expect(Buffer.compare(captured.rawBody, sentRawBody)).toBe(0);
    const parsed = JSON.parse(captured.rawBody.toString('utf8')) as Record<string, unknown>;
    expect('max_tokens' in parsed).toBe(false);
    expect('max_completion_tokens' in parsed).toBe(false);
    expect('temperature' in parsed).toBe(false);
    // model is exactly the client's value — not a substituted default.
    expect(parsed['model']).toBe('gpt-4o-2024-11-20');
  });
});

describe('OpenAI passthrough — response fidelity', () => {
  it('preserves provider status code, response body bytes, and relevant headers', async () => {
    fake.setResponse({ status: 201, headers: OPENAI_SUCCESS_HEADERS, rawBody: OPENAI_CHAT_SUCCESS_RAW });

    const res = await injectChat(Buffer.from(OPENAI_CHAT_REQUEST_RAW, 'utf8'));

    expect(res.statusCode).toBe(201);
    expect(Buffer.compare(res.rawPayload, Buffer.from(OPENAI_CHAT_SUCCESS_RAW, 'utf8'))).toBe(0);
    expect(res.headers['x-request-id']).toBe('req_FAKE_123');
    expect(res.headers['openai-processing-ms']).toBe('42');
    expect(res.headers['x-ratelimit-remaining-requests']).toBe('4999');
    const parsed = JSON.parse(res.rawPayload.toString('utf8')) as Record<string, unknown>;
    expect(parsed['provider_unknown_future_field']).toBe('survive-response');
  });

  it('forwards provider error status + body verbatim (no GovAI error reshape)', async () => {
    fake.setResponse({ status: 429, headers: OPENAI_ERROR_HEADERS, rawBody: OPENAI_ERROR_429_RAW });

    const res = await injectChat(Buffer.from(OPENAI_CHAT_REQUEST_RAW, 'utf8'));

    expect(res.statusCode).toBe(429);
    expect(res.statusCode).not.toBe(500);
    expect(res.statusCode).not.toBe(200);
    expect(Buffer.compare(res.rawPayload, Buffer.from(OPENAI_ERROR_429_RAW, 'utf8'))).toBe(0);
    // Provider-native error shape preserved (NOT normalized to a GovAI {error:'...'} body).
    const parsed = JSON.parse(res.rawPayload.toString('utf8')) as { error?: { code?: string; type?: string } };
    expect(parsed.error?.code).toBe('rate_limit_exceeded');
    expect(parsed.error?.type).toBe('requests');
    expect(res.headers['x-request-id']).toBe('req_FAKE_err');
  });
});

describe('OpenAI passthrough — no /v1/runs remap, hermetic transport', () => {
  it('reaches the native endpoint with the client body, not the /v1/runs shortcut shape', async () => {
    fake.setResponse({ status: 200, headers: OPENAI_SUCCESS_HEADERS, rawBody: OPENAI_CHAT_SUCCESS_RAW });
    const sentRawBody = Buffer.from(OPENAI_CHAT_REQUEST_RAW, 'utf8');

    await injectChat(sentRawBody);

    const captured = fake.lastRequest!;
    // Native OpenAI endpoint — not /v1/runs.
    expect(captured.path).toBe('/v1/chat/completions');
    // Body is the client's exact bytes — a reconstructed run-shortcut body could not match.
    expect(Buffer.compare(captured.rawBody, sentRawBody)).toBe(0);
    const parsed = JSON.parse(captured.rawBody.toString('utf8')) as Record<string, unknown>;
    // The /v1/runs shortcut injects max_tokens / builds its own envelope; passthrough must not.
    expect('max_tokens' in parsed).toBe(false);
    expect('workspace_id' in parsed).toBe(false);
    expect('capability' in parsed).toBe(false);
  });

  it('routes only to the hermetic loopback transport (no real provider)', async () => {
    // The single-upstream-call guarantee is asserted in the clean-slot
    // body-preservation test above (fake.callCount === 1). Here we assert the
    // hermetic property deterministically: the upstream is loopback and it
    // received exactly this test's bytes — no external host is ever contacted.
    fake.setResponse({ status: 200, headers: OPENAI_SUCCESS_HEADERS, rawBody: OPENAI_CHAT_SUCCESS_RAW });
    const sentRawBody = Buffer.from(OPENAI_CHAT_REQUEST_RAW, 'utf8');

    await injectChat(sentRawBody);

    expect(fake.url.startsWith('http://127.0.0.1:')).toBe(true);
    const captured = fake.lastRequest!;
    expect(captured.path).toBe('/v1/chat/completions');
    expect(Buffer.compare(captured.rawBody, sentRawBody)).toBe(0);
  });
});
