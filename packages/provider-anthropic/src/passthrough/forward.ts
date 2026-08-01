// Raw HTTP forward to Anthropic API (or a hermetic test server).
// Preserves request body byte-for-byte; computes native_request_hash + native_response_hash.
// Stream variant lives in stream-forward.ts.

import { createHash } from 'node:crypto';

export type ForwardInput = {
  baseUrl: string;
  pathTemplate: string; // logical template (e.g. /v1/messages); used to construct concrete URL
  concretePath: string; // actual path with concrete IDs filled in (used as URL)
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
    headers: input.headers,
  };
  if (input.method !== 'GET' && requestBody.length > 0) {
    init.body = requestBody;
  }
  if (input.signal) {
    init.signal = input.signal;
  }

  // REV4 §12.3 exact production ordering at the fetch boundary:
  //   request fully built → await the durable gate → recheck the abort
  //   signal → in-memory forward marker → fetch. A gate rejection or an
  //   already-expired signal makes the fetch structurally unreachable.
  if (input.beforeDispatch) await input.beforeDispatch();
  input.signal?.throwIfAborted();
  input.onDispatchStart?.();
  const t0 = Date.now();
  const res = await fetch(url, init);
  const latency_ms = Date.now() - t0;
  const responseBuf = Buffer.from(await res.arrayBuffer());
  const native_response_hash = sha256Hex(responseBuf);

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });

  const provider_request_id =
    responseHeaders['anthropic-request-id'] ?? responseHeaders['x-request-id'] ?? null;

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
