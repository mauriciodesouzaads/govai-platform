import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApiClient } from './client.js';

// The streaming POST half of the transport. Two properties here are P0-class product safety
// and are pinned exhaustively:
//
//   1. A PROVIDER POST IS ISSUED EXACTLY ONCE — never retried on 429, 5xx or a network fault.
//      The provider may have executed and billed a request whose result this browser never
//      saw; an automatic retry would ask it to do so again.
//   2. THE CREDENTIAL LEAVES THIS PROCESS ONLY AS ONE REQUEST HEADER — never a URL, never a
//      body, never a storage key, never a query parameter.

const KEY = 'govai_sk_AAAtest-key-value-0123456789';

function client(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createApiClient>[0]> = {},
) {
  return createApiClient({
    getCredential: () => KEY,
    fetchImpl,
    sleep: async () => undefined,
    ...overrides,
  });
}

function sseResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  });
}

async function drain(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

describe('★ a provider POST is issued exactly once, whatever comes back', () => {
  it.each([
    ['429 rate limit', 429],
    ['500 server error', 500],
    ['502 bad gateway', 502],
    ['503 unavailable', 503],
  ])('does not retry on %s', async (_label, status) => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { type: 'x' } }), {
        status,
        headers: { 'content-type': 'application/json', 'retry-after': '1' },
      }),
    );
    const result = await client(fetchImpl as unknown as typeof fetch).stream('/passthrough/openai/v1/responses', {
      body: { model: 'm' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(status);
    expect(result.ok).toBe(false);
  });

  it('does not retry when the request never produces a response', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down');
    });
    await expect(
      client(fetchImpl as unknown as typeof fetch).stream('/passthrough/openai/v1/responses', {
        body: {},
      }),
    ).rejects.toMatchObject({ kind: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry on a mid-stream failure — the bytes already left the provider', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode('data: partial\n\n'));
              c.error(new Error('reset'));
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const result = await client(fetchImpl as unknown as typeof fetch).stream('/x', { body: {} });
    await expect(drain(result.body)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rethrows an abort without retrying', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      client(fetchImpl as unknown as typeof fetch).stream('/x', {
        body: {},
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('★ the credential leaves as one header and nothing else', () => {
  it('puts the key in x-govai-api-key, never in the URL or the body', async () => {
    const fetchImpl = vi.fn(async () => sseResponse('data: [DONE]\n\n'));
    await client(fetchImpl as unknown as typeof fetch).stream('/passthrough/openai/v1/responses', {
      body: { model: 'm', input: [{ role: 'user', content: 'hi' }] },
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/passthrough/openai/v1/responses');
    expect(url).not.toContain(KEY);
    expect(String(init.body)).not.toContain(KEY);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-govai-api-key']).toBe(KEY);
    // Exactly one credential-bearing header. No Authorization, no cookie.
    expect(Object.keys(headers).filter((h) => headers[h] === KEY)).toEqual(['x-govai-api-key']);
    expect(headers['authorization']).toBeUndefined();
  });

  it('sets credentials:omit, redirect:error and cache:no-store', async () => {
    const fetchImpl = vi.fn(async () => sseResponse('data: [DONE]\n\n'));
    await client(fetchImpl as unknown as typeof fetch).stream('/x', { body: {} });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    // credentials:'omit' — no cookie ever rides along. redirect:'error' — a redirect cannot
    // silently move a credential-bearing POST to another origin. no-store — no shared cache
    // may keep one tenant's answer.
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
    expect(init.method).toBe('POST');
  });

  it('refuses to send anything when the session has no credential', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(''));
    const c = createApiClient({
      getCredential: () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(c.stream('/x', { body: {} })).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never lets a caller-supplied header displace the credential or the content type', async () => {
    const fetchImpl = vi.fn(async () => sseResponse('data: [DONE]\n\n'));
    await client(fetchImpl as unknown as typeof fetch).stream('/x', {
      body: {},
      headers: { 'x-govai-api-key': 'ATTACKER', 'content-type': 'text/plain' },
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-govai-api-key']).toBe(KEY);
    expect(headers['content-type']).toBe('application/json');
  });

  it('targets a same-origin GovAI path, never a provider domain', async () => {
    const fetchImpl = vi.fn(async () => sseResponse('data: [DONE]\n\n'));
    const c = client(fetchImpl as unknown as typeof fetch);
    for (const path of [
      '/passthrough/openai/v1/responses',
      '/governed/anthropic/v1/messages',
    ]) {
      await c.stream(path, { body: {} });
    }
    for (const call of fetchImpl.mock.calls) {
      const url = String((call as unknown[])[0]);
      expect(url.startsWith('/')).toBe(true);
      expect(url).not.toContain('api.openai.com');
      expect(url).not.toContain('api.anthropic.com');
    }
  });
});

describe('★ a relayed PROVIDER 401 does not end the GovAI session', () => {
  it('keeps the session when the 401 body is the provider’s own error shape', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { type: 'authentication_error', message: 'bad key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const result = await client(fetchImpl as unknown as typeof fetch, { onUnauthorized }).stream(
      '/passthrough/openai/v1/responses',
      { body: {}, authScope: 'provider-native' },
    );
    // The reader stays signed in: it is the PROVIDER credential that was rejected.
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(result.status).toBe(401);
  });

  it('ends the session when the 401 body carries GovAI’s own auth_error envelope', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'auth_error', message: 'invalid api key' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await client(fetchImpl as unknown as typeof fetch, { onUnauthorized }).stream('/x', {
      body: {},
      authScope: 'provider-native',
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('ends the session for a 401 on a GovAI-scoped path, as before', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    await client(fetchImpl as unknown as typeof fetch, { onUnauthorized }).stream('/x', {
      body: {},
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('applies the same rule to a provider-native GET', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { type: 'authentication_error' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(
      client(fetchImpl as unknown as typeof fetch, { onUnauthorized }).get(
        '/passthrough/openai/v1/models',
        { schema: z.object({}), authScope: 'provider-native' },
      ),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe('the response is handed over raw, so the console can render provider truth', () => {
  it('exposes status, headers and the byte stream without interpreting them', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse('data: {"a":1}\n\ndata: [DONE]\n\n', {
        headers: {
          'content-type': 'text/event-stream',
          'openai-request-id': 'req_123',
          'x-govai-enforcement-decision': 'ask',
        },
      }),
    );
    const result = await client(fetchImpl as unknown as typeof fetch).stream('/x', { body: {} });
    expect(result.ok).toBe(true);
    expect(result.headers.get('openai-request-id')).toBe('req_123');
    expect(result.headers.get('x-govai-enforcement-decision')).toBe('ask');
    expect(await drain(result.body)).toBe('data: {"a":1}\n\ndata: [DONE]\n\n');
  });

  it('bounds the text it reads back from an error body', async () => {
    const huge = JSON.stringify({ error: { message: 'x'.repeat(200_000) } });
    const fetchImpl = vi.fn(
      async () => new Response(huge, { status: 400, headers: { 'content-type': 'application/json' } }),
    );
    const result = await client(fetchImpl as unknown as typeof fetch).stream('/x', { body: {} });
    const text = await result.readBoundedText(1024);
    expect(text.length).toBeLessThanOrEqual(1024);
  });

  it('serializes the provider-native body it was given, unchanged', async () => {
    const fetchImpl = vi.fn(async () => sseResponse('data: [DONE]\n\n'));
    const body = { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true };
    await client(fetchImpl as unknown as typeof fetch).stream('/x', { body });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual(body);
  });
});
