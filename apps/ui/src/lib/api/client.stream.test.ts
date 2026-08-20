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

  it('★ keeps the session even when a RELAYED body claims to be GovAI’s auth_error', async () => {
    // ★ REGRESSION, and a correction of this suite's own earlier assumption. `GovAIErrorBody`
    // validates SHAPE, not origin. The direct routes relay the upstream's status AND body
    // verbatim, so an upstream answering `{"error":"auth_error"}` is indistinguishable from
    // GovAI answering it — and there is no header to fall back on either, because relayed
    // response headers pass through too. Acting on that body would let a third party sign the
    // reader out and discard a conversation in progress.
    //
    // A relayed body may LABEL an error; it may never DESTROY a session. The authority to end
    // one stays with GovAI-scoped reads.
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'auth_error', message: 'invalid api key' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const result = await client(fetchImpl as unknown as typeof fetch, { onUnauthorized }).stream(
      '/x',
      { body: {}, authScope: 'provider-native' },
    );
    expect(onUnauthorized).not.toHaveBeenCalled();
    // The status and the code are still reported, so the screen can say what happened.
    expect(result.status).toBe(401);
    expect(JSON.parse(await result.readBoundedText())).toMatchObject({ error: 'auth_error' });
  });

  it('★ the same on the GET path: a relayed auth_error body never ends the session', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'auth_error' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(
      client(fetchImpl as unknown as typeof fetch, { onUnauthorized }).get(
        '/passthrough/openai/v1/models',
        { schema: z.object({}), authScope: 'provider-native' },
      ),
    ).rejects.toMatchObject({ kind: 'auth', code: 'auth_error' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('ends the session for a 401 on a GovAI-scoped path, as before', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    await client(fetchImpl as unknown as typeof fetch, { onUnauthorized }).stream('/x', {
      body: {},
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('★ bounds a provider-relayed error body on the GET path too', async () => {
    // ★ REGRESSION. Model discovery runs the moment `/ai` opens and relays PROVIDER error
    // bodies verbatim, so `toApiError` reading with `response.json()` was an unbounded,
    // provider-controlled read on the path that greets the reader. A never-ending error body
    // would hang the model query with the streaming side already bounded.
    let pulls = 0;
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              pulls += 1;
              if (pulls > 5_000) return void c.close(); // test-only runaway guard
              c.enqueue(new TextEncoder().encode('x'.repeat(1024)));
            },
          }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        ),
    );
    await expect(
      Promise.race([
        client(fetchImpl as unknown as typeof fetch).get('/passthrough/openai/v1/models', {
          schema: z.object({}),
          authScope: 'provider-native',
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('get() hung on an unbounded provider error body')), 3000),
        ),
      ]),
    ).rejects.toMatchObject({ kind: 'server' });
    // It stopped at the bound rather than draining the endless stream.
    expect(pulls).toBeLessThan(64);
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

describe('★ a provider-controlled error body cannot exhaust this browser', () => {
  /** A body that never ends, counting how many chunks were actually pulled. */
  function endlessBody(counter: { pulled: number }, headers: Record<string, string> = {}) {
    const chunk = new TextEncoder().encode('x'.repeat(1024));
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          counter.pulled += 1;
          // A runaway guard for the TEST itself: if the bound were broken this would spin
          // forever, and a hung suite is a worse signal than a failed assertion.
          if (counter.pulled > 5_000) return void c.close();
          c.enqueue(chunk);
        },
      }),
      { status: 401, headers: { 'content-type': 'application/json', ...headers } },
    );
  }

  it('does not read an unbounded 401 body while deciding whether the session ended', async () => {
    // ★ REGRESSION. Deciding this with `response.clone().json()` TEES the body: draining the
    // clone queues every chunk into the unread original too, so the whole payload is buffered
    // twice before `stream()` returns — with the 16 KiB bound sitting unused. A hostile or
    // merely enormous 401 would hang the console on exactly the provider-controlled response
    // the bounded reader exists to contain.
    const counter = { pulled: 0 };
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async () => endlessBody(counter));
    const result = await client(fetchImpl as unknown as typeof fetch, { onUnauthorized }).stream(
      '/passthrough/openai/v1/responses',
      { body: {}, authScope: 'provider-native' },
    );
    // It RETURNS — that is half the assertion.
    expect(result.status).toBe(401);
    // And it read only enough to reach the bound, not the whole never-ending stream.
    expect(counter.pulled).toBeLessThan(64); // 16 KiB / 1 KiB chunks, plus slack
    // A body that could not be parsed is not a GovAI envelope, so the session survives.
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('still ends the session for a 401 on a GOVAI-scoped path, where the body is GovAI’s', async () => {
    // The authority to end a session lives here — on routes whose response GovAI authored.
    // (The provider-native counterpart, where the body is relayed and proves nothing about its
    // origin, is asserted the other way round below.)
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
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('reports a non-2xx body as consumed rather than handing over a half-read stream', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { type: 'invalid_request_error' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const result = await client(fetchImpl as unknown as typeof fetch).stream('/x', { body: {} });
    expect(result.ok).toBe(false);
    expect(result.body).toBeNull();
    // The text the caller renders is the one already read — no second pass over the body.
    expect(JSON.parse(await result.readBoundedText())).toEqual({
      error: { type: 'invalid_request_error' },
    });
  });

  it('★ returns when the body lands EXACTLY on the bound and then goes quiet', async () => {
    // ★ REGRESSION, and a lesson about how the previous test was too kind. It fed 1 KiB chunks
    // that sailed PAST 16 KiB, so a strict `read > maxBytes` was reached and the loop broke.
    // A body that supplies exactly the bound and then holds the connection open leaves `>`
    // false, and the next `read()` never resolves: the limit is reached and never acted on.
    const BOUND = 16 * 1024;
    let pulls = 0;
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              pulls += 1;
              if (pulls === 1) {
                c.enqueue(new TextEncoder().encode('x'.repeat(BOUND)));
                return;
              }
              // Silence: never enqueue, never close. Exactly what an open connection does.
              return new Promise<void>(() => undefined);
            },
          }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        ),
    );
    const result = await Promise.race([
      client(fetchImpl as unknown as typeof fetch).stream('/x', { body: {} }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('stream() hung on a body that landed on the bound')), 3000),
      ),
    ]);
    expect(result.status).toBe(500);
    expect(await result.readBoundedText()).toHaveLength(BOUND);
  });

  it('★ bounds a SUCCESSFUL provider-controlled body too', async () => {
    // ★ REGRESSION. The error paths were bounded first, which left the 2xx read — the one that
    // actually runs when /ai opens — as the last unbounded provider-controlled body. A
    // never-ending 200 model list would hang the screen before it rendered.
    let pulls = 0;
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              pulls += 1;
              if (pulls > 20_000) return void c.close(); // test-only runaway guard
              c.enqueue(new TextEncoder().encode('x'.repeat(1024)));
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    await expect(
      Promise.race([
        client(fetchImpl as unknown as typeof fetch).get('/passthrough/anthropic/v1/models', {
          schema: z.object({}),
          authScope: 'provider-native',
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('get() hung on an unbounded 2xx provider body')), 5000),
        ),
      ]),
      // Truncated at the bound, so it is no longer valid JSON — reported as a contract
      // mismatch rather than as a hung tab.
    ).rejects.toMatchObject({ kind: 'malformed_response' });
    // 2 MiB of 1 KiB chunks, and not one byte more.
    expect(pulls).toBeLessThanOrEqual(2 * 1024 + 2);
  });

  it('leaves a GovAI-scoped 2xx read unbounded, so a legitimate page is never truncated', async () => {
    // GovAI's own responses are first-party and sized by the route's own `limit`; imposing a
    // ceiling there would turn a large but legitimate evidence page into a contract error.
    const big = JSON.stringify({ ok: true, filler: 'x'.repeat(3 * 1024 * 1024) });
    const fetchImpl = vi.fn(
      async () => new Response(big, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const parsed = await client(fetchImpl as unknown as typeof fetch).get('/v1/evidence/gaps', {
      schema: z.looseObject({ ok: z.boolean() }),
    });
    expect(parsed.ok).toBe(true);
  });

  it('honours a caller-supplied bound smaller than what was read', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('x'.repeat(500), { status: 500 }),
    );
    const result = await client(fetchImpl as unknown as typeof fetch).stream('/x', { body: {} });
    expect(await result.readBoundedText(10)).toHaveLength(10);
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
    // The 200 kB payload never reached memory whole: the non-2xx path already stopped at the
    // default bound before this call narrowed it further.
    expect(text.length).toBeLessThan(huge.length);
  });

  it('serializes the provider-native body it was given, unchanged', async () => {
    const fetchImpl = vi.fn(async () => sseResponse('data: [DONE]\n\n'));
    const body = { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true };
    await client(fetchImpl as unknown as typeof fetch).stream('/x', { body });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual(body);
  });
});
