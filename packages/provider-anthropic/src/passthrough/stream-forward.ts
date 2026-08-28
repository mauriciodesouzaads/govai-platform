// Stream forward (SSE) for /v1/messages?stream=true.
// Computes stream_final_hash incrementally over the byte stream while pushing
// chunks to the caller. Aborts upstream when the caller signals abort.

import { createHash } from 'node:crypto';
import {
  normalizeFetchResponseHeaders,
  withIdentityAcceptEncoding,
} from './transport-encoding.js';
import { extractAnthropicRequestId } from './request-id.js';

export type StreamForwardInput = {
  baseUrl: string;
  concretePath: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Buffer;
  /** Caller-controlled abort signal — propagated to upstream fetch. */
  signal?: AbortSignal;
  /**
   * EP-AI-CONVERSATION-CONTINUITY-V1 P0-C: OPTIONAL asynchronous durable dispatch gate,
   * awaited AFTER the request is fully described and IMMEDIATELY before the local `fetch`.
   * Fail-closed: a rejection here makes the fetch structurally unreachable. Supplied ONLY by
   * the durable conversation executor (which persists its credential-provenance commit inside
   * it); direct-route callers omit it and keep their existing behavior byte-for-byte. This
   * package stays storage-agnostic — it awaits the callback without knowing what "durable"
   * means for the caller. NOT a provider-receipt claim. Mirrors `forwardRaw.beforeDispatch`.
   */
  beforeDispatch?: () => Promise<void>;
  /**
   * EP-AI-CONVERSATION-CONTINUITY-V1 P0-C: synchronous, in-memory-only marker invoked
   * immediately before `fetch` (after `beforeDispatch`). Lets the caller distinguish a KNOWN
   * LOCAL error — raised before any transmission attempt — from a POST-INVOCATION unknown
   * outcome. If it throws, the fetch is NOT invoked. It is NOT proof the provider received
   * bytes. Mirrors `forwardRaw.onDispatchStart`.
   */
  onDispatchStart?: () => void;
};

export type StreamForwardResult = {
  status: number;
  responseHeaders: Record<string, string>;
  /** Pull-style: caller iterates to get raw byte chunks preserved. */
  body: ReadableStream<Uint8Array>;
  native_request_hash: string;
  /**
   * Resolves the terminal stream facts (final hash, byte count, latency) exactly once; a
   * second call returns the same settled terminal.
   *
   * ★ THE LIFECYCLE CONTRACT (P0-C R17): the CALLER owns the body lifecycle. `finalize()`
   * is guaranteed to settle only after one of:
   *   (a) `body` was drained to EOF;
   *   (b) `body` (or an acquired reader on it) was CANCELLED;
   *   (c) the fetch `signal` ABORTED.
   * A body that is merely ABANDONED — no drain, no cancel, no abort — leaves this promise
   * pending, and that is a property of real fetch bodies, not an implementation choice: a
   * real response body reports graceful EOF only through a read, so no wake-up exists that
   * does not also move data. Every production caller already ends the body one of the three
   * lawful ways before awaiting this; new callers must too.
   */
  finalize: () => Promise<{
    stream_final_hash: string;
    bytes_streamed: number;
    latency_ms: number;
  }>;
  provider_request_id: string | null;
};

function sha256Hex(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(Buffer.from(buf)).digest('hex');
}

export async function forwardStream(input: StreamForwardInput): Promise<StreamForwardResult> {
  const url = `${input.baseUrl.replace(/\/$/, '')}${input.concretePath}`;
  const native_request_hash = sha256Hex(input.body);
  const t0 = Date.now();

  // ★ BUILD AND VALIDATE THE REQUEST BEFORE THE DISPATCH MARKER — the `forwardRaw` ordering,
  // and it is load-bearing for the caller's failure taxonomy. Node validates the URL and every
  // header value when the `Request` is CONSTRUCTED, and construction opens no connection. Passing
  // `(url, init)` straight to `fetch` instead would move that validation AFTER
  // `onDispatchStart()`, so a malformed base URL or a stored credential containing an invalid
  // header character — both provably local, with nothing transmitted — would be reported to the
  // caller as a POST-invocation failure and terminalized as `outcome_unknown` rather than
  // `failed`. duplex is required by undici when a Request carries a body.
  const init: RequestInit = {
    method: input.method,
    // FB-3 (M1): identity on the Fetch hop — see transport-encoding.ts.
    headers: withIdentityAcceptEncoding(input.headers),
    body: input.body,
    ...(input.signal ? { signal: input.signal } : {}),
  };
  (init as { duplex?: string }).duplex = 'half';
  const request = new Request(url, init);

  // P0-C §12.3 ordering, identical to `forwardRaw`: request fully built and VALIDATED -> await
  // the durable gate -> recheck the abort signal -> in-memory forward marker -> fetch. A gate
  // rejection or an already-aborted signal makes the fetch structurally unreachable.
  if (input.beforeDispatch) await input.beforeDispatch();
  input.signal?.throwIfAborted();
  input.onDispatchStart?.();

  const res = await fetch(request);

  const rawResponseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    rawResponseHeaders[key.toLowerCase()] = value;
  });
  // FB-3 (M1) defense in depth: the streamed chunks are the DECODED bytes when
  // Fetch decoded — drop the stale content-encoding / content-length so the
  // relayed stream headers describe the chunks actually written + hashed.
  const responseHeaders = normalizeFetchResponseHeaders(res.status, rawResponseHeaders);
  // M2A F1: real Anthropic header `request-id` first; legacy names are fallbacks only.
  const provider_request_id = extractAnthropicRequestId(responseHeaders);

  // Tee the stream: one branch goes to caller; other branch feeds the hasher.
  const upstream = res.body;
  const hasher = createHash('sha256');
  let bytes_streamed = 0;
  let resolveFinal: (v: { stream_final_hash: string; bytes_streamed: number; latency_ms: number }) => void;
  const finalPromise = new Promise<{
    stream_final_hash: string;
    bytes_streamed: number;
    latency_ms: number;
  }>((resolve) => {
    resolveFinal = resolve;
  });

  // ★ THE READER IS ACQUIRED OUTSIDE `start` SO `cancel` CAN REACH IT (P0-C). Without a `cancel`
  // handler this wrapper swallowed consumer cancellation: releasing or cancelling the OUTER
  // stream left the provider's body streaming, so a consumer that abandons the stream (the
  // durable executor does, when an append loses its fence) kept the upstream generating and
  // downloading for a response nobody could persist — until the dispatch timeout. Purely
  // additive: nothing previously called `out.cancel()`, so the direct routes are unaffected.
  const upstreamReader = upstream ? upstream.getReader() : null;

  // ── R16-2 (a): ONE TERMINAL SETTLEMENT, ONE DIGEST ───────────────────────────────────────
  // `hasher.digest()` may be called ONCE — a second call throws — and `finalize()` must report
  // the terminal truth exactly once. A demand-driven pump can be PARKED when the stream ends,
  // so EOF, an upstream failure and a consumer cancellation now race to terminalize instead of
  // all arriving through one loop's `finally`. Every path routes through this latch, which is
  // what makes double-digestion and a never-settling `finalize()` both impossible.
  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    resolveFinal({
      stream_final_hash: hasher.digest('hex'),
      bytes_streamed,
      latency_ms: Date.now() - t0,
    });
  };

  // ── R16-2 (b): THE DEMAND SIGNAL ─────────────────────────────────────────────────────────
  // WHATWG calls `pull` exactly when this stream has room for another chunk, so `pull` IS the
  // downstream demand. `pendingDemand` remembers a `pull` that arrived while the pump was busy,
  // so a signal is never dropped between iterations.
  let releaseDemand: (() => void) | null = null;
  let pendingDemand = false;
  const signalDemand = (): void => {
    const release = releaseDemand;
    releaseDemand = null;
    if (release) release();
    else pendingDemand = true;
  };
  const awaitDemand = (): Promise<void> => {
    if (pendingDemand) {
      pendingDemand = false;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      releaseDemand = resolve;
    });
  };
  let cancelled = false;

  /**
   * ONE upstream read per unit of downstream demand.
   *
   * ★ THE DEFECT THIS REPLACES. The previous pump looped on `reader.read()` and called
   * `controller.enqueue()` unconditionally, never consulting `desiredSize`. WHATWG queues
   * whatever a source enqueues past the high-water mark, so a consumer SLOWER than the provider
   * did not slow the provider down — it grew this wrapper's internal queue by the whole
   * response. P0-C is the first structurally slow consumer (`recordStream` pauses for a KMS
   * encrypt plus a fenced database append on every flush), and it runs in a dedicated worker
   * whose heap is the blast radius. Reading only on demand pushes the backpressure back onto the
   * provider socket, where undici can pause it.
   *
   * ★ A LOOP, NOT A `pull` HANDLER, AND THAT IS LOAD-BEARING. Every upstream read must be
   * SERIALIZED: the hash is order-sensitive, and two overlapping readers would interleave their
   * `hasher.update` calls and digest a permutation of the response. One loop makes that
   * impossible by construction and gives the terminal settlement exactly one owner.
   *
   * ★ THE DEMAND WAIT IS RACED AGAINST THE UPSTREAM'S OWN END — for the ways an end can WAKE a
   * parked pump, which are FEWER than "every way the body can end". `closed` REJECTS the
   * instant the body ERRORS or the fetch signal ABORTS, whatever is queued — that is what
   * settles `finalize()` for `pumpStreamWithTerminalEmit`, which on an already-closed client
   * ABORTS the upstream, skips the drain, and then awaits `finalize()`. A consumer CANCEL
   * settles the terminal latch directly in the `cancel` handler below. Graceful EOF is
   * different, and this race deliberately does not promise to observe it: a real fetch body
   * reports EOF only through a read, so close-requested data — or the EOF itself — parked
   * behind zero demand stays unobserved and `finalize()` stays pending. That is the documented
   * contract (`StreamForwardResult.finalize`): the caller owns the body lifecycle — drain to
   * EOF, cancel, or abort — and no production caller abandons a body without one of the three.
   * When `closed` does settle under the race, whatever remains is read out — bounded, because
   * after the body has ended everything left has already been received.
   */
  const pump = async (
    controller: ReadableStreamDefaultController<Uint8Array>,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    upstreamEnded: Promise<void>,
  ): Promise<void> => {
    try {
      for (;;) {
        await Promise.race([awaitDemand(), upstreamEnded]);
        const { value, done } = await reader.read();
        if (done) break;
        // ★ DEFENCE IN DEPTH, AND SAYING SO IS THE POINT. WHATWG resolves a pending read with
        // `done: true` once the body is cancelled and REJECTS it once the body errors, so
        // neither guard below is reachable today. They keep "never hash past the terminal" and
        // "never enqueue into a closed stream" LOCAL to this loop, instead of an emergent
        // consequence of spec ordering that a later edit could quietly break.
        /* c8 ignore next 2 */
        if (cancelled || settled) break;
        if (!value) continue;
        bytes_streamed += value.byteLength;
        hasher.update(Buffer.from(value));
        controller.enqueue(value);
      }
      // A cancelled stream is already closed; `close()` would throw on it.
      if (!cancelled) controller.close();
    } catch (err) {
      controller.error(err);
    } finally {
      settle();
    }
  };

  const out = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!upstreamReader) {
        controller.close();
        settle();
        return;
      }
      const reader = upstreamReader;
      // Settles on error and abort (rejection, immediate) and on cancellation (fulfilment);
      // for graceful EOF only once the end has been OBSERVED by reads — see the pump's
      // contract note above. Both arms are handled, so this never becomes an unhandled
      // rejection.
      const upstreamEnded = reader.closed.then(
        () => undefined,
        () => undefined,
      );
      // ★ STARTED, NOT RETURNED. WHATWG sets `[[started]]` — and therefore first calls `pull` —
      // only once the `start` result settles, so returning the pump would mean the demand signal
      // never arrives and the stream deadlocks before its first chunk.
      void pump(controller, reader, upstreamEnded);
    },
    pull() {
      signalDemand();
    },
    // Consumer cancellation PROPAGATES to the provider body, closing the connection rather than
    // merely detaching this wrapper from it.
    async cancel(reason?: unknown) {
      cancelled = true;
      await upstreamReader?.cancel(reason).catch(() => undefined);
      // Cancelling ends the body, which releases the pump — but settle here too, so `finalize()`
      // resolves even when the pump has already exited.
      settle();
    },
  });
  return {
    status: res.status,
    responseHeaders,
    body: out,
    native_request_hash,
    finalize: () => finalPromise,
    provider_request_id,
  };
}
