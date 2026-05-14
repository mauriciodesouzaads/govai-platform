import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { forwardRaw } from './forward.js';

describe('forwardRaw', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the request body byte-for-byte and computes request + response hashes', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'openai-request-id': 'req-1', 'content-type': 'application/json' },
      }),
    );
    const r = await forwardRaw({
      baseUrl: 'https://api.openai.example/',
      pathTemplate: '/v1/chat/completions',
      concretePath: '/v1/chat/completions',
      method: 'POST',
      headers: { authorization: 'Bearer sk' },
      body: Buffer.from('{"model":"gpt-5"}', 'utf8'),
    });
    expect(r.status).toBe(200);
    expect(r.provider_request_id).toBe('req-1');
    expect(r.native_request_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.native_response_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.responseBody.toString('utf8')).toBe('{"ok":true}');
    expect(typeof r.latency_ms).toBe('number');
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://api.openai.example/v1/chat/completions',
    );
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeDefined();
  });

  it('omits init.body on GET requests (and when input.body is empty)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200, headers: {} }));
    await forwardRaw({
      baseUrl: 'https://x',
      pathTemplate: '/v1/models',
      concretePath: '/v1/models',
      method: 'GET',
      headers: {},
    });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('falls back to x-request-id when openai-request-id is absent, and to null when neither is present', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 200,
          headers: { 'x-request-id': 'req-fallback' },
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200, headers: {} }));

    const fallback = await forwardRaw({
      baseUrl: 'https://x',
      pathTemplate: '/v1/models',
      concretePath: '/v1/models',
      method: 'GET',
      headers: {},
    });
    expect(fallback.provider_request_id).toBe('req-fallback');

    const none = await forwardRaw({
      baseUrl: 'https://x',
      pathTemplate: '/v1/models',
      concretePath: '/v1/models',
      method: 'GET',
      headers: {},
    });
    expect(none.provider_request_id).toBeNull();
  });

  it('treats an undefined body as an empty Buffer for hashing purposes', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200, headers: {} }));
    const r = await forwardRaw({
      baseUrl: 'https://x',
      pathTemplate: '/v1/models',
      concretePath: '/v1/models',
      method: 'GET',
      headers: {},
    });
    // sha256 of empty buffer
    expect(r.native_request_hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
