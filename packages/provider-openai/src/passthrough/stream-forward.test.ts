import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { forwardStream } from './stream-forward.js';

function bodyFromString(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(s));
      controller.close();
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

describe('forwardStream', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards to baseUrl + concretePath, returns status + hashes + drains body, surfaces openai-request-id', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(bodyFromString('event: a\ndata: 1\n\n'), {
        status: 200,
        headers: { 'openai-request-id': 'req-openai-1' },
      }),
    );
    const r = await forwardStream({
      baseUrl: 'https://api.openai.example/',
      concretePath: '/v1/chat/completions',
      method: 'POST',
      headers: { authorization: 'Bearer sk' },
      body: Buffer.from('{"stream":true}', 'utf8'),
    });
    expect(r.status).toBe(200);
    expect(r.provider_request_id).toBe('req-openai-1');
    expect(r.native_request_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await drain(r.body)).toBe('event: a\ndata: 1\n\n');
    const final = await r.finalize();
    expect(final.stream_final_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(final.bytes_streamed).toBeGreaterThan(0);
    expect(typeof final.latency_ms).toBe('number');
    // P0-C: the forward now builds and VALIDATES a `Request` before the dispatch marker (the
    // `forwardRaw` ordering), so `fetch` receives ONE argument. A `Request` always carries a
    // signal of its own, so the meaningful assertion is that nothing is aborted when the caller
    // supplied no signal.
    const sent = fetchSpy.mock.calls[0]?.[0] as Request;
    expect(sent).toBeInstanceOf(Request);
    expect(fetchSpy.mock.calls[0]?.[1]).toBeUndefined();
    expect(sent.signal.aborted).toBe(false);
  });

  it('passes the caller-supplied AbortSignal to fetch', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(bodyFromString('hi'), { status: 200, headers: {} }),
    );
    const ac = new AbortController();
    await forwardStream({
      baseUrl: 'https://api.openai.example',
      concretePath: '/v1/chat/completions',
      method: 'POST',
      headers: {},
      body: Buffer.alloc(0),
      signal: ac.signal,
    });
    // The caller's signal reaches the request through the `Request`, which links rather than
    // reuses it — so identity is the wrong assertion and PROPAGATION is the right one: aborting
    // the caller's controller must abort what fetch is watching.
    const sent = fetchSpy.mock.calls[0]?.[0] as Request;
    expect(sent).toBeInstanceOf(Request);
    expect(sent.signal.aborted).toBe(false);
    ac.abort();
    expect(sent.signal.aborted).toBe(true);
  });

  it('falls back to x-request-id when openai-request-id is absent', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(bodyFromString('x'), {
        status: 200,
        headers: { 'x-request-id': 'req-fallback' },
      }),
    );
    const r = await forwardStream({
      baseUrl: 'https://x',
      concretePath: '/v1/chat/completions',
      method: 'POST',
      headers: {},
      body: Buffer.alloc(0),
    });
    expect(r.provider_request_id).toBe('req-fallback');
    await drain(r.body);
    await r.finalize();
  });

  it('returns null provider_request_id when neither openai-request-id nor x-request-id is present', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(bodyFromString('x'), { status: 200, headers: {} }),
    );
    const r = await forwardStream({
      baseUrl: 'https://x',
      concretePath: '/v1/chat/completions',
      method: 'POST',
      headers: {},
      body: Buffer.alloc(0),
    });
    expect(r.provider_request_id).toBeNull();
    await drain(r.body);
    await r.finalize();
  });

  it('finalises cleanly when the upstream response has no body', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204, headers: {} }));
    const r = await forwardStream({
      baseUrl: 'https://x',
      concretePath: '/v1/chat/completions',
      method: 'POST',
      headers: {},
      body: Buffer.alloc(0),
    });
    expect(r.status).toBe(204);
    expect(await drain(r.body)).toBe('');
    const final = await r.finalize();
    expect(final.bytes_streamed).toBe(0);
    expect(final.stream_final_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('strips a trailing slash from baseUrl when constructing the URL', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(bodyFromString(''), { status: 200, headers: {} }),
    );
    await forwardStream({
      baseUrl: 'https://api.openai.example/',
      concretePath: '/v1/chat/completions',
      method: 'POST',
      headers: {},
      body: Buffer.alloc(0),
    });
    expect((fetchSpy.mock.calls[0]?.[0] as Request).url).toBe(
      'https://api.openai.example/v1/chat/completions',
    );
  });
});
