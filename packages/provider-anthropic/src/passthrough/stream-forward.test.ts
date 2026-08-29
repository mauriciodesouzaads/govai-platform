import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
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

  // ── THE CALLER THAT DOES NOT DRAIN, AND WHAT ACTUALLY SETTLES IT (R17) ──────────────────
  // `pumpStreamWithTerminalEmit` SKIPS the drain entirely when the client socket is already
  // closed (EP-008C P2#2) — but it ABORTS the upstream first and only then awaits
  // `finalize()`. The abort is load-bearing: it REJECTS `reader.closed` immediately, whatever
  // is queued, and that rejection is what wakes the parked pump. Graceful EOF gives no such
  // wake-up — a real fetch body reports EOF only through a read — so a body that is merely
  // ABANDONED (no drain, no cancel, no abort) leaves `finalize()` pending BY CONTRACT
  // (`StreamForwardResult.finalize`). An earlier revision of these tests asserted the
  // stronger "settles with no consumer and no cancel" property; it held only for a
  // single-chunk synthetic body whose lone chunk the pump's one initial demand consumed, and
  // it is false for real bodies (R17). The tests below pin the TRUE contract: the three
  // lawful endings settle, abandonment does not.

  it('R17 — CANCEL with the body never read settles finalize() over the relayed prefix', async () => {
    // TWO chunks + close, the exact multi-chunk shape whose graceful EOF cannot wake a parked
    // pump on its own — with the lawful cancel, finalize() must settle anyway.
    const enc = new TextEncoder();
    const first = enc.encode('event: a\ndata: 1\n\n');
    const second = enc.encode('event: b\ndata: 2\n\n');
    const r = await open(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(first);
          controller.enqueue(second);
          controller.close();
        },
      }),
    );
    // NOTHING reads `r.body`. The pump's single initial demand deterministically takes and
    // hashes exactly the FIRST chunk (HWM 1, no further pull without a reader), so the
    // terminal truthfully describes a one-chunk relayed prefix — never the unread remainder.
    await settleEventLoop();
    await r.body.cancel('caller abandoned the stream');
    const final = await r.finalize();
    expect(final.bytes_streamed).toBe(first.byteLength);
    expect(final.stream_final_hash).toBe(
      createHash('sha256').update(Buffer.from(first)).digest('hex'),
    );
    // Idempotent: a second call returns the SAME terminal, never a second `hasher.digest()`.
    expect(await r.finalize()).toEqual(final);
  });

  it('R17 — an ABANDONED body (no drain, no cancel, no abort) leaves finalize() pending', async () => {
    // The negative space of the contract, pinned deliberately: if a later edit makes this
    // settle — an eager pump reading to EOF, or an unadjudicated auto-settle in finalize() —
    // this test fails, and that change must be a conscious contract revision, not a drive-by.
    const enc = new TextEncoder();
    const r = await open(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode('event: a\ndata: 1\n\n'));
          controller.enqueue(enc.encode('event: b\ndata: 2\n\n'));
          controller.close();
        },
      }),
    );
    let settled = false;
    const finalized = r.finalize().then((f) => {
      settled = true;
      return f;
    });
    // Deterministic job-queue bound, not a timing sleep (see `settleEventLoop`): every wake-up
    // the pump could receive from an already-arrived body has run by now.
    await settleEventLoop();
    expect(settled).toBe(false);
    // Cleanup IS the contract's remedy: the lawful cancel settles the same promise.
    await r.body.cancel('test cleanup');
    await finalized;
    expect(settled).toBe(true);
  });

  it('R17 — a FAILED body settles finalize() with no consumer (the aborted-fetch rejection shape)', async () => {
    // A fetch-signal abort ERRORS a real body — `reader.closed` rejects immediately, whatever
    // is queued. This synthetic body models exactly that rejection, which is why NO cancel is
    // needed here: failure is one of the three lawful endings.
    const boom = new Error('upstream aborted');
    const r = await open(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(boom);
        },
      }),
    );
    // NOTHING reads `r.body`.
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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// R17 — REAL-BODY LIFECYCLE, against a real `fetch` over loopback (NO fetch stub)
//
// ★ WHY SYNTHETIC BODIES ARE NOT ENOUGH HERE. The R17 adjudication turned on two facts of real
// undici response bodies that a hand-built `ReadableStream` cannot model: (1) graceful EOF is
// DISCOVERED ONLY BY A READ — even a fully-arrived, fully-buffered body never fulfils
// `reader.closed` behind zero demand, so an abandoned body leaves `finalize()` pending in every
// shape, single-chunk included; (2) aborting the fetch signal REJECTS the body — and must
// settle `finalize()` — even when the response has already been received in full, which is the
// exact condition `pumpStreamWithTerminalEmit`'s already-closed-client path depends on.
//
// Local loopback only; no public internet; no credentials; each test's own drain/cancel/abort
// is its bound; the server is torn down (connections included) in `finally`.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('forwardStream — R17 real-body lifecycle (loopback node:http, real fetch)', () => {
  const CHUNKS = ['data: one\n\n', 'data: two\n\n', 'data: three\n\n'];
  const EXPECTED = Buffer.from(CHUNKS.join(''), 'utf8');

  /**
   * Serve `CHUNKS` as an SSE-shaped 200 over a loopback server, run `fn`, tear down.
   *
   * The inter-chunk `setTimeout(2)` is NOT assertion synchronization — no assertion depends on
   * chunk boundaries — it only encourages the writes onto separate TCP segments so the wire
   * shape is realistically multi-frame rather than one coalesced buffer.
   */
  async function withSseServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
    const server: Server = createServer((req, res) => {
      req.on('data', () => undefined);
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        void (async () => {
          for (const chunk of CHUNKS) {
            res.write(chunk);
            await new Promise((r) => setTimeout(r, 2));
          }
          res.end();
        })();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      return await fn(`http://127.0.0.1:${port}`);
    } finally {
      server.close();
      // Undici keeps loopback connections alive; without this the suite's teardown would wait
      // on the keep-alive socket.
      server.closeAllConnections();
    }
  }

  const openReal = (baseUrl: string): ReturnType<typeof forwardStream> =>
    forwardStream({
      baseUrl,
      concretePath: '/v1/messages',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"stream":true}', 'utf8'),
    });

  it('R17 — drain to EOF relays every byte and settles finalize() with the exact terminal hash', async () => {
    await withSseServer(async (baseUrl) => {
      const r = await openReal(baseUrl);
      const reader = r.body.getReader();
      const seen: Uint8Array[] = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) seen.push(value);
      }
      expect(Buffer.concat(seen.map((c) => Buffer.from(c))).equals(EXPECTED)).toBe(true);
      const final = await r.finalize();
      expect(final.bytes_streamed).toBe(EXPECTED.byteLength);
      expect(final.stream_final_hash).toBe(createHash('sha256').update(EXPECTED).digest('hex'));
      expect(await r.finalize()).toEqual(final);
    });
  });

  it('R17 — ABORT with the body never read settles finalize() (the skip-drain caller shape)', async () => {
    await withSseServer(async (baseUrl) => {
      const ac = new AbortController();
      const r = await forwardStream({
        baseUrl,
        concretePath: '/v1/messages',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{"stream":true}', 'utf8'),
        signal: ac.signal,
      });
      // NOTHING reads `r.body` — this is `pumpStreamWithTerminalEmit` on an already-closed
      // client: abort first, drain skipped, finalize() awaited. The abort must settle it.
      ac.abort();
      const final = await r.finalize();
      expect(final.bytes_streamed).toBeLessThanOrEqual(EXPECTED.byteLength);
      expect(final.stream_final_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(await r.finalize()).toEqual(final);
    });
  });

  it('R17 — CANCEL with the body never read settles finalize() and closes the upstream', async () => {
    await withSseServer(async (baseUrl) => {
      const r = await openReal(baseUrl);
      // NOTHING reads `r.body` — the pre-drain abandonment shape (the P0-C executor's guard
      // cancels exactly like this before it finalizes).
      await r.body.cancel('consumer abandoned the stream before the drain');
      const final = await r.finalize();
      // Real-socket chunk boundaries are not deterministic, so the exact prefix is not; the
      // terminal's TRUTHFULNESS is: it never claims more than the whole response.
      expect(final.bytes_streamed).toBeLessThanOrEqual(EXPECTED.byteLength);
      expect(final.stream_final_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(await r.finalize()).toEqual(final);
    });
  });
});
