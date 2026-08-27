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
  /** Promise of the final hash + length once the stream fully drains. */
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

  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (!upstreamReader) {
        controller.close();
        resolveFinal({
          stream_final_hash: hasher.digest('hex'),
          bytes_streamed,
          latency_ms: Date.now() - t0,
        });
        return;
      }
      const reader = upstreamReader;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          /* c8 ignore next 4 -- WHATWG Streams: reader.read() with done:false always yields a value chunk; defensive guard */
          if (value) {
            bytes_streamed += value.byteLength;
            hasher.update(Buffer.from(value));
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        resolveFinal({
          stream_final_hash: hasher.digest('hex'),
          bytes_streamed,
          latency_ms: Date.now() - t0,
        });
      }
    },
    // Consumer cancellation PROPAGATES to the provider body, closing the connection rather than
    // merely detaching this wrapper from it.
    async cancel(reason?: unknown) {
      await upstreamReader?.cancel(reason).catch(() => undefined);
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
