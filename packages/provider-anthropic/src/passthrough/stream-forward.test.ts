import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
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

  it('forwards the request to baseUrl + concretePath, returns hashes + status, and surfaces anthropic-request-id', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(bodyFromString('event: a\ndata: 1\n\n'), {
        status: 200,
        headers: { 'anthropic-request-id': 'req-anthropic-1' },
      }),
    );
    const r = await forwardStream({
      baseUrl: 'https://api.anthropic.example/',
      concretePath: '/v1/messages',
      method: 'POST',
      headers: { 'x-api-key': 'k' },
      body: Buffer.from('{"stream":true}', 'utf8'),
    });
    expect(r.status).toBe(200);
    expect(r.provider_request_id).toBe('req-anthropic-1');
    expect(r.native_request_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await drain(r.body)).toBe('event: a\ndata: 1\n\n');
    const final = await r.finalize();
    expect(final.stream_final_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(final.bytes_streamed).toBeGreaterThan(0);
    expect(typeof final.latency_ms).toBe('number');

    expect(fetchSpy).toHaveBeenCalledOnce();
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
      baseUrl: 'https://api.anthropic.example',
      concretePath: '/v1/messages',
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

  it('M2A F1: surfaces the REAL Anthropic `request-id` FIRST, even when legacy names are also present', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(bodyFromString('event: a\ndata: 1\n\n'), {
        status: 200,
        headers: { 'request-id': 'req_real', 'anthropic-request-id': 'legacy', 'x-request-id': 'x' },
      }),
    );
    const r = await forwardStream({
      baseUrl: 'https://api.anthropic.example',
      concretePath: '/v1/messages',
      method: 'POST',
      headers: {},
      body: Buffer.from('{}', 'utf8'),
    });
    expect(r.provider_request_id).toBe('req_real');
    await drain(r.body);
    await r.finalize();
  });

  it('falls back to x-request-id when anthropic-request-id is absent', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(bodyFromString('x'), {
        status: 200,
        headers: { 'x-request-id': 'req-fallback' },
      }),
    );
    const r = await forwardStream({
      baseUrl: 'https://x',
      concretePath: '/v1/messages',
      method: 'POST',
      headers: {},
      body: Buffer.alloc(0),
    });
    expect(r.provider_request_id).toBe('req-fallback');
    await drain(r.body);
    await r.finalize();
  });

  it('returns null provider_request_id when neither anthropic-request-id nor x-request-id is present', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(bodyFromString('x'), { status: 200, headers: {} }),
    );
    const r = await forwardStream({
      baseUrl: 'https://x',
      concretePath: '/v1/messages',
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
      concretePath: '/v1/messages',
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

  it('strips a trailing slash from baseUrl when building the URL', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(bodyFromString(''), { status: 200, headers: {} }),
    );
    await forwardStream({
      baseUrl: 'https://api.anthropic.example/',
      concretePath: '/v1/messages',
      method: 'POST',
      headers: {},
      body: Buffer.alloc(0),
    });
    expect((fetchSpy.mock.calls[0]?.[0] as Request).url).toBe('https://api.anthropic.example/v1/messages');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// R16-2 — BACKPRESSURE WHILE DRAINING A PROVIDER STREAM
//
// ★ THE DEFECT THESE TESTS PIN. `forwardStream` used to pump the provider body in a
// `while (true)` loop inside `start()`, enqueuing every chunk without ever consulting
// `desiredSize`. WHATWG queues whatever a source enqueues past the high-water mark, so a
// consumer slower than the provider did not slow the PROVIDER down — it grew this wrapper's
// internal queue by the whole response. The shape is pre-Foundation-V1; P0-C is what made it
// material, because `recordStream` is the first consumer that is STRUCTURALLY slow (it pauses
// for a KMS encrypt plus a fenced database append on every flush) and it runs in a dedicated
// worker whose heap is the blast radius.
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * An upstream that yields `total` chunks ON DEMAND ONLY.
 *
 * `pull` is precisely the hook WHATWG invokes when a reader asks this stream for more, so
 * `reads()` counts what the FORWARDER actually took out of the provider body — not what the
 * provider was willing to send. An eager pump drives it to `total`; a demand-driven one leaves
 * it at the stream's bounded read-ahead, whatever `total` is.
 */
function demandCountingUpstream(
  total: number,
  chunkBytes: number,
): {
  stream: ReadableStream<Uint8Array>;
  reads: () => number;
  cancelled: () => boolean;
  expected: Buffer;
} {
  const chunks: Uint8Array[] = Array.from(
    { length: total },
    (_, i) => new Uint8Array(chunkBytes).fill((i + 1) % 251),
  );
  let produced = 0;
  let reads = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads += 1;
      if (produced >= total) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[produced]!);
      produced += 1;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    stream,
    reads: () => reads,
    cancelled: () => cancelled,
    expected: Buffer.concat(chunks.map((c) => Buffer.from(c))),
  };
}

/**
 * Yield the event loop a few times.
 *
 * ★ NOT A TIMING SLEEP, AND THE DIFFERENCE IS WHAT MAKES THE ASSERTION DETERMINISTIC. The eager
 * pump's `reader.read()` resolves from an ALREADY-QUEUED chunk, i.e. in a MICROTASK, so its
 * whole loop runs to completion inside one microtask drain — which is guaranteed to have
 * happened before the first `setImmediate` callback fires. The bound asserted below is
 * therefore a fact about the job queues, not about elapsed time.
 */
const settleEventLoop = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((r) => setImmediate(r));
};

describe('forwardStream — R16-2 backpressure', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const open = async (
    body: ReadableStream<Uint8Array>,
  ): Promise<Awaited<ReturnType<typeof forwardStream>>> => {
    fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200, headers: {} }));
    return forwardStream({
      baseUrl: 'https://api.anthropic.example',
      concretePath: '/v1/messages',
      method: 'POST',
      headers: {},
      body: Buffer.from('{"stream":true}', 'utf8'),
    });
  };

  it('R16-2 — a STALLED consumer stops the upstream: read-ahead is bounded and INDEPENDENT of response size', async () => {
    const stalledReads = async (total: number): Promise<number> => {
      const up = demandCountingUpstream(total, 64);
      const r = await open(up.stream);
      const reader = r.body.getReader();
      // Consume exactly ONE chunk, then stall — the shape of a durable consumer that has gone
      // off to encrypt and append what it just received.
      expect((await reader.read()).done).toBe(false);
      await settleEventLoop();
      const observed = up.reads();
      await reader.cancel();
      await r.finalize();
      return observed;
    };

    const small = await stalledReads(50);
    const large = await stalledReads(500);

    // THE PROPERTY: the wrapper's read-ahead does not grow with the response. The eager pump
    // made these `total + 1` (51 and 501); a demand-driven one leaves both at the same small
    // constant.
    expect(small).toBe(large);
    expect(small).toBeLessThanOrEqual(4);
    expect(small).toBeLessThan(50);
  });

  it('R16-2 — after the stall the stream RESUMES and relays every byte, in order, with the exact terminal evidence', async () => {
    const TOTAL = 200;
    const CHUNK = 64;
    const up = demandCountingUpstream(TOTAL, CHUNK);
    const r = await open(up.stream);
    const reader = r.body.getReader();

    const seen: Uint8Array[] = [];
    const first = await reader.read();
    expect(first.done).toBe(false);
    seen.push(first.value!);
    await settleEventLoop(); // stall
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      seen.push(value!);
    }

    const relayed = Buffer.concat(seen.map((c) => Buffer.from(c)));
    expect(relayed.equals(up.expected)).toBe(true);
    expect(up.reads()).toBe(TOTAL + 1); // every chunk, plus the close pull — nothing lost

    const final = await r.finalize();
    expect(final.bytes_streamed).toBe(TOTAL * CHUNK);
    expect(final.stream_final_hash).toBe(
      createHash('sha256').update(up.expected).digest('hex'),
    );
  });

  it('R16-2 — cancelling a STALLED consumer cancels the provider body and settles finalize() exactly once', async () => {
    const TOTAL = 300;
    const up = demandCountingUpstream(TOTAL, 64);
    const r = await open(up.stream);
    const reader = r.body.getReader();
    expect((await reader.read()).done).toBe(false);
    await settleEventLoop();
    const readsAtStall = up.reads();

    await reader.cancel('durable consumer abandoned the drain');
    expect(up.cancelled()).toBe(true);

    // `finalize()` must SETTLE — a pull-based pump parked on a demand that will never arrive
    // would otherwise hang its caller forever.
    const final = await r.finalize();
    expect(final.bytes_streamed).toBeLessThanOrEqual(readsAtStall * 64);
    expect(final.stream_final_hash).toMatch(/^[a-f0-9]{64}$/);

    // Idempotent: a second call returns the SAME terminal, never a second `hasher.digest()`.
    expect(await r.finalize()).toEqual(final);

    await settleEventLoop();
    expect(up.reads()).toBeLessThanOrEqual(readsAtStall + 1);
  });

  // ── THE ONE CALLER THAT DOES NOT DRAIN ───────────────────────────────────────────────────
  // `pumpStreamWithTerminalEmit` SKIPS the drain entirely when the client socket is already
  // closed (EP-008C P2#2) — it aborts the upstream and goes straight to `finalize()`. The eager
  // pump settled that caller as a side effect of always running to completion; a demand-driven
  // one must settle it deliberately, or the hijacked reply would await a promise forever. These
  // two cover both ways the body can end underneath a consumer that never asks for a byte.

  it('R16-2 — finalize() settles when the body ENDS and the consumer never reads', async () => {
    const payload = 'event: a\ndata: 1\n\nevent: b\ndata: 2\n\n';
    const enc = new TextEncoder();
    const r = await open(
      new ReadableStream<Uint8Array>({
        start(controller) {
          // A body whose source completes on its own — a fetch response that already arrived.
          controller.enqueue(enc.encode(payload));
          controller.close();
        },
      }),
    );
    // NOTHING reads `r.body`.
    const final = await r.finalize();
    // The terminal still describes the WHOLE provider response: after the body has ended, what
    // is left was already received, so reading it out costs no memory and keeps the evidence
    // byte-complete — the semantic the direct routes' `stream_final_hash` already had.
    expect(final.bytes_streamed).toBe(Buffer.byteLength(payload));
    expect(final.stream_final_hash).toBe(
      createHash('sha256').update(Buffer.from(payload, 'utf8')).digest('hex'),
    );
  });

  it('R16-2 — finalize() settles when the body FAILS and the consumer never reads', async () => {
    const boom = new Error('upstream aborted');
    const r = await open(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(boom);
        },
      }),
    );
    // NOTHING reads `r.body` — this is the aborted-fetch shape of the same caller.
    const final = await r.finalize();
    expect(final.bytes_streamed).toBe(0);
    expect(final.stream_final_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('R16-2 — an upstream failure propagates to the consumer and finalize() still reports the bytes actually relayed', async () => {
    const CHUNK = 32;
    const OK_CHUNKS = 3;
    const boom = new Error('provider connection reset');
    let produced = 0;
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= OK_CHUNKS) {
          controller.error(boom);
          return;
        }
        produced += 1;
        controller.enqueue(new Uint8Array(CHUNK).fill(produced));
      },
    });
    const expected = Buffer.concat(
      Array.from({ length: OK_CHUNKS }, (_, i) => Buffer.alloc(CHUNK, i + 1)),
    );

    const r = await open(upstream);
    const reader = r.body.getReader();
    const seen: Uint8Array[] = [];
    let caught: unknown = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        seen.push(value!);
      }
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(boom);
    expect(Buffer.concat(seen.map((c) => Buffer.from(c))).equals(expected)).toBe(true);

    const final = await r.finalize();
    expect(final.bytes_streamed).toBe(OK_CHUNKS * CHUNK);
    expect(final.stream_final_hash).toBe(createHash('sha256').update(expected).digest('hex'));
    expect(await r.finalize()).toEqual(final);
  });
});
