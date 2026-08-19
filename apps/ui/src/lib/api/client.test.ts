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
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Schema }),
    ).rejects.toThrow(DOMException);
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
    const fetchImpl = vi.fn(
      async () => new Response('{}', { status: 429, headers: { 'retry-after': '1' } }),
    );
    await expect(
      client(fetchImpl as unknown as typeof fetch).get('/v1/thing', { schema: Schema }),
    ).rejects.toMatchObject({ kind: 'rate_limited', status: 429, retryAfterSeconds: 1 });
    // 4 attempts total — never an unbounded retry against a shared 100/min budget.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('honours Retry-After over the exponential schedule, capped', () => {
    expect(rateLimitDelayMs(0, null)).toBe(500);
    expect(rateLimitDelayMs(1, null)).toBe(1_000);
    expect(rateLimitDelayMs(2, null)).toBe(2_000);
    expect(rateLimitDelayMs(9, null)).toBe(8_000);
    expect(rateLimitDelayMs(0, 3)).toBe(3_000);
    expect(rateLimitDelayMs(0, 3_600)).toBe(8_000);
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
