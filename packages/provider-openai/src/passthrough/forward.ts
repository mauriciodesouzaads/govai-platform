// Raw HTTP forward to OpenAI API (or a hermetic test server).
// Preserves request body byte-for-byte; computes native_request_hash + native_response_hash.
// Stream variant lives in stream-forward.ts.

import { createHash } from 'node:crypto';
import {
  normalizeFetchResponseHeaders,
  withIdentityAcceptEncoding,
} from './transport-encoding.js';

export type ForwardInput = {
  baseUrl: string;
  pathTemplate: string;
  concretePath: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers: Record<string, string>;
  body?: Buffer;
  /** EP-P03A-A (F3): bounds the upstream fetch (dispatch timeout). */
  signal?: AbortSignal;
  /**
   * EP-P03A-A (REV4 §12.1): OPTIONAL asynchronous durable dispatch gate,
   * awaited AFTER the request is fully built and IMMEDIATELY before the local
   * `fetch` invocation. Fail-closed: a rejection here prevents the fetch.
   * Supplied ONLY by protocol-v1 run execution (which persists its durable
   * boundary inside it); direct-provider callers omit it and keep their
   * existing behavior. This package stays storage-agnostic — it awaits the
   * callback without knowing what "durable" means for the caller. NOT a
   * provider-receipt claim.
   */
  beforeDispatch?: () => Promise<void>;
  /**
   * EP-P03A-A (REV4): the caller's dispatch deadline on the performance.now()
   * monotonic clock, checked SYNCHRONOUSLY after the durable-gate await —
   * AbortSignal.timeout is timer-callback-driven, so under an event-loop
   * stall a continuation can reach the fetch before the overdue timer marks
   * the signal aborted (Codex P2 on b80a457). Past the deadline the forward
   * throws a TimeoutError DOMException without invoking fetch. Supplied by
   * protocol-v1 run execution; direct routes omit it.
   */
  monotonicDeadlineMs?: number;
  /**
   * EP-P03A-A (F3 §19.1): synchronous, in-memory-only marker invoked
   * immediately before `fetch` (after `beforeDispatch` and after the abort
   * recheck). Lets the caller distinguish a known local error (before any
   * transmission attempt) from a post-invocation unknown outcome. If it
   * throws, the fetch is NOT invoked (known local pre-forward failure).
   * It is NOT proof the provider received bytes.
   */
  onDispatchStart?: () => void;
};

export type ForwardResult = {
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: Buffer;
  native_request_hash: string;
  native_response_hash: string;
  provider_request_id: string | null;
  latency_ms: number;
};

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export async function forwardRaw(input: ForwardInput): Promise<ForwardResult> {
  const url = `${input.baseUrl.replace(/\/$/, '')}${input.concretePath}`;
  const requestBody = input.body ?? Buffer.alloc(0);
  const native_request_hash = sha256Hex(requestBody);

  const init: RequestInit = {
    method: input.method,
    // FB-3 (M1): the caller's transport compression negotiation is NOT
    // propagated to the Fetch hop — GovAI asks for `identity` so the bytes it
    // hashes and relays are the wire bytes (see transport-encoding.ts).
    headers: withIdentityAcceptEncoding(input.headers),
  };
  if (input.method !== 'GET' && requestBody.length > 0) {
    init.body = requestBody;
  }
  if (input.signal) {
    init.signal = input.signal;
  }

  // Build + VALIDATE the Request object as part of request construction
  // (§12.3 step 1): Node validates the URL and header values HERE, so an
  // invalid header (e.g. a decrypted credential containing a newline)
  // rejects BEFORE the dispatch marker and classifies as a known local
  // pre-forward failure, never an unknown — Request construction opens no
  // connection (Codex P2 on cba2eec). duplex is required by undici when a
  // Request carries a body.
  if (input.method !== 'GET' && requestBody.length > 0) {
    (init as { duplex?: string }).duplex = 'half';
  }
  const request = new Request(url, init);

  // REV4 §12.3 exact production ordering at the fetch boundary:
  //   request fully built → await the durable gate → recheck the abort
  //   signal → SYNCHRONOUS monotonic-deadline recheck → in-memory forward
  //   marker → fetch. A gate rejection, an already-expired signal, or an
  //   elapsed monotonic deadline makes the fetch structurally unreachable —
  //   the deadline recheck does not depend on the abort timer's callback
  //   having run (Codex P2 on b80a457).
  if (input.beforeDispatch) await input.beforeDispatch();
  input.signal?.throwIfAborted();
  if (input.monotonicDeadlineMs !== undefined && performance.now() >= input.monotonicDeadlineMs) {
    throw new DOMException('dispatch deadline elapsed before fetch', 'TimeoutError');
  }
  input.onDispatchStart?.();
  const t0 = Date.now();
  const res = await fetch(request);
  const latency_ms = Date.now() - t0;
  const responseBuf = Buffer.from(await res.arrayBuffer());
  const native_response_hash = sha256Hex(responseBuf);

  const rawResponseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    rawResponseHeaders[key.toLowerCase()] = value;
  });
  // FB-3 (M1) defense in depth: if Fetch decoded a compressed body, drop the
  // stale content-encoding / content-length so downstream framing describes
  // `responseBuf` (the bytes GovAI hashed and delivers).
  const responseHeaders = normalizeFetchResponseHeaders(res.status, rawResponseHeaders);

  // OpenAI canonical request id header is `openai-request-id`; some endpoints
  // also surface `x-request-id`.
  const provider_request_id =
    responseHeaders['openai-request-id'] ?? responseHeaders['x-request-id'] ?? null;

  return {
    status: res.status,
    responseHeaders,
    responseBody: responseBuf,
    native_request_hash,
    native_response_hash,
    provider_request_id,
    latency_ms,
  };
}
