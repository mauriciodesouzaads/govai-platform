import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApiClient, parseRetryAfter, rateLimitDelayMs } from './client.js';
import { isApiError } from '../contract/errors.js';

const Schema = z.object({ ok: z.literal(true) });
const KEY = 'govai_sk_AAAtest-key-value-0123456789';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function client(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createApiClient>[0]> = {},
) {
  return createApiClient({
    getCredential: () => KEY,
    fetchImpl,
    sleep: async () => undefined, // the bounded 429 backoff must not sleep in a unit test
    ...overrides,
  });
}

describe('credential handling', () => {
  it('sends the key as the x-govai-api-key header and nowhere else', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    await client(fetchImpl as unknown as typeof fetch).get('/v1/thing', {
      schema: Schema,
      query: { window: 86_400 },
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/v1/thing?window=86400');
    // ★ the credential must never reach the URL.
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)['x-govai-api-key']).toBe(KEY);
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
  });

  it('refuses to issue an unauthenticated read instead of provoking a confusing 401', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const c = createApiClient({
      getCredential: () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(c.get('/v1/thing', { schema: Schema })).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses an explicit credential for the sign-in probe, without touching the store', async () => {
    const getCredential = vi.fn(() => null);
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const c = createApiClient({
      getCredential,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await c.get('/v1/thing', { schema: Schema, credential: 'candidate-key' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-govai-api-key']).toBe('candidate-key');
  });
});

describe('error mapping', () => {
  it('401 → auth, and the session is dropped exactly once', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'auth_error', message: 'invalid api key' }, { status: 401 }),
    );
    const c = client(fetchImpl as unknown as typeof fetch, { onUnauthorized });
    await expect(c.get('/v1/thing', { schema: Schema })).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
      code: 'auth_error',
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('400 → invalid_request, carrying the Zod issues the route returned', async () => {
    const issues = [{ path: ['invariant'], message: 'Invalid enum value' }];
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'invalid_query', issues }, { status: 400 }),
    );
    try {
      await client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Schema });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(isApiError(err)).toBe(true);
      if (!isApiError(err)) return;
      expect(err.kind).toBe('invalid_request');
      expect(err.code).toBe('invalid_query');
      expect(err.issues).toEqual(issues);
    }
  });

  it('404 → not_found (RLS makes "absent" and "another tenant" indistinguishable)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: 'Route GET:/v1/nope not found', error: 'Not Found', statusCode: 404 }, { status: 404 }),
    );
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/v1/nope', { schema: Schema }),
    ).rejects.toMatchObject({ kind: 'not_found', status: 404 });
  });

  it('409 → conflict', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'conflict' }, { status: 409 }));
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Schema }),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('502 → a retryable server/provider error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'bad_gateway' }, { status: 502 }));
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Schema }),
    ).rejects.toMatchObject({ kind: 'server', status: 502 });
  });

  it('a transport failure → network, without leaking the underlying message', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    try {
      await client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Schema });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(isApiError(err)).toBe(true);
      if (!isApiError(err)) return;
      expect(err.kind).toBe('network');
      expect(err.message).not.toContain('Failed to fetch');
    }
  });

  it('an abort propagates as an abort, not as a fault to report', async () => {
    // The CALLER's cancellation, which is what this rule is about. The signal is what makes it
    // the caller's: since `get` now arms its own request deadline, an `AbortError` with no
    // caller signal can only be that deadline, and the next test asserts it reports as a
    // network condition instead — nobody cancelled it, so calling it "cancelled" would be a
    // lie in the reader's direction.
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/v1/thing', {
        schema: Schema,
        signal: controller.signal,
      }),
    ).rejects.toThrow(DOMException);
  });

  it('an AbortError with NO caller signal is our own deadline, and reports as network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Schema }),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('tolerates a non-JSON error body (a proxy HTML page) without masking the status', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
    );
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Schema }),
    ).rejects.toMatchObject({ kind: 'server', status: 502, code: null });
  });
});

describe('contract validation', () => {
  it('a 200 whose body violates the mirrored contract is an explicit error, not silent data', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: 'yes' }));
    try {
      await client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Schema });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(isApiError(err)).toBe(true);
      if (!isApiError(err)) return;
      expect(err.kind).toBe('malformed_response');
      // The body is never echoed: an unexpected payload in an error message is a leak.
      expect(err.message).not.toContain('yes');
    }
  });

  it('PRESERVES a field the contract does not know, instead of silently dropping it', async () => {
    // The export calls itself "serialized without post-processing". Zod's default object
    // behaviour would strip an additive backend field, quietly turning the artifact into a
    // projection; loose schemas keep it. Rejecting it instead would break the UI on a change
    // the backend is entitled to make.
    const Loose = z.looseObject({ ok: z.literal(true) });
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, brand_new_evidence_field: { nested: 42 } }),
    );
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Loose }),
    ).resolves.toEqual({ ok: true, brand_new_evidence_field: { nested: 42 } });
  });

  it('a 200 that is not JSON is a malformed response', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }));
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Schema }),
    ).rejects.toMatchObject({ kind: 'malformed_response' });
  });
});

describe('bounded 429 handling', () => {
  it('retries a rate-limited request and succeeds, without unbounded looping', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls < 3
        ? new Response('{}', { status: 429 })
        : jsonResponse({ ok: true });
    });
    const result = await client(fetchImpl as unknown as typeof fetch).get('/v1/thing', {
      schema: Schema,
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it('gives up after a bounded number of attempts and reports rate_limited', async () => {
    // retry-after 1s is within the patience bound, so this exercises the retry path itself.
    const fetchImpl = vi.fn(
      async () => new Response('{}', { status: 429, headers: { 'retry-after': '1' } }),
    );
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Schema }),
    ).rejects.toMatchObject({ kind: 'rate_limited', status: 429, retryAfterSeconds: 1 });
    // 4 attempts total — never an unbounded retry against a shared 100/min budget.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('grows the blind schedule and caps it, when the server advertised nothing', () => {
    expect(rateLimitDelayMs(0, null)).toBe(500);
    expect(rateLimitDelayMs(1, null)).toBe(1_000);
    expect(rateLimitDelayMs(2, null)).toBe(2_000);
    expect(rateLimitDelayMs(9, null)).toBe(8_000);
  });

  it('honours an advertised Retry-After EXACTLY, never shortening it', () => {
    // Shortening the server's instruction would retry inside the window it just closed.
    expect(rateLimitDelayMs(0, 3)).toBe(3_000);
    expect(rateLimitDelayMs(2, 5)).toBe(5_000);
    expect(rateLimitDelayMs(0, 8)).toBe(8_000);
  });

  it('refuses to retry when the advertised wait exceeds what this client will block for', () => {
    // null = do not retry. The alternative — three doomed 8s retries inside a 60s window —
    // burns the shared budget and still ends in an error.
    expect(rateLimitDelayMs(0, 60)).toBeNull();
    expect(rateLimitDelayMs(0, 3_600)).toBeNull();
  });

  it('surfaces a long Retry-After immediately, with the advertised wait and NO extra requests', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{}', { status: 429, headers: { 'retry-after': '60' } }),
    );
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Schema }),
    ).rejects.toMatchObject({ kind: 'rate_limited', status: 429, retryAfterSeconds: 60 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('still retries a short advertised wait, and succeeds', async () => {
    const slept: number[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response('{}', { status: 429, headers: { 'retry-after': '2' } })
        : jsonResponse({ ok: true });
    });
    const c = createApiClient({
      getCredential: () => KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    await expect(c.get('/v1/thing', { schema: Schema })).resolves.toEqual({ ok: true });
    expect(slept).toEqual([2_000]);
  });

  it('parses both Retry-After forms and rejects anything else', () => {
    const now = Date.parse('2026-08-19T12:00:00.000Z');
    expect(parseRetryAfter('30', now)).toBe(30);
    expect(parseRetryAfter('Wed, 19 Aug 2026 12:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
});

describe('URL building', () => {
  it('normalizes the base URL and omits undefined parameters', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    await client(fetchImpl as unknown as typeof fetch, {
      baseUrl: 'https://govai.example/',
    }).get('/v1/thing', { schema: Schema, query: { a: 1, b: undefined } });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://govai.example/v1/thing?a=1');
  });

  it('defaults to same-origin so nothing crosses an origin boundary', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    await client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Schema });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe('/v1/thing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A SIZE BOUND IS NOT A TIME BOUND.
//
// `readBoundedText` stopped at `maxBytes`, and only at `maxBytes`. A response that sends a few
// bytes UNDER the ceiling and then holds the connection open never reaches it, so the read
// waited on a `read()` that would not resolve and the caller — model discovery, an error-body
// parse — sat in `loading` until the reader navigated away. Both bounds are needed; whichever
// is reached first must stop the read, and the reader must be cancelled either way.
describe('bounded body reads have a deadline, not only a ceiling', () => {
  /** A body that emits `prefix`, then never completes and never closes. */
  function trickleThenHang(prefix: string): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(prefix));
        // Deliberately no close(), no further enqueue: the connection just stays open.
      },
    });
  }

  it('★ a body that stalls under the size ceiling still resolves, instead of hanging forever', async () => {
    vi.useFakeTimers();
    try {
      const stalling = new Response(trickleThenHang('{"error":{"type":"server_'), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
      const api = client(async () => stalling);
      const pending = api.get('/v1/models', { schema: Schema }).catch((err: unknown) => err);
      // Nothing can complete on its own: only the deadline can end this read.
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await pending;
      expect(isApiError(result)).toBe(true);
      expect((result as { status: number }).status).toBe(500);
    } finally {
      vi.useRealTimers();
    }
  });

  // ★ THE CLASS, stated as a test: a JSON read awaits a remote party TWICE — once for headers,
  // once for the body — and bounding only the second left the first unbounded. A server that
  // accepts the connection and never answers kept `/ai` in `loading` until the reader navigated
  // away. The deadline now sits on the REQUEST, so one clock covers both halves.
  it('★ a server that never sends response headers fails as network, not as a hang', async () => {
    vi.useFakeTimers();
    try {
      // A fetch that resolves only when its signal aborts — the pre-header stall, exactly.
      const stalling: typeof fetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      const api = client(stalling);
      const pending = api.get('/v1/models', { schema: Schema }).catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await pending;
      expect(isApiError(result)).toBe(true);
      expect((result as { kind: string }).kind).toBe('network');
      // It must NOT read as the reader's own cancellation: nobody cancelled this.
      expect(result).not.toBeInstanceOf(DOMException);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the CALLER's own abort is still re-thrown untouched, not relabelled as a network fault", async () => {
    const controller = new AbortController();
    const stalling: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const api = client(stalling);
    const pending = api
      .get('/v1/models', { schema: Schema, signal: controller.signal })
      .catch((err: unknown) => err);
    controller.abort();
    const result = await pending;
    expect(result).toBeInstanceOf(DOMException);
    expect((result as DOMException).name).toBe('AbortError');
    expect(isApiError(result)).toBe(false);
  });

  it('a body that CLOSES normally is unaffected by the deadline', async () => {
    const api = client(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(api.get('/v1/thing', { schema: Schema })).resolves.toEqual({ ok: true });
  });
});
