// Raw HTTP forward to OpenAI API (or a hermetic test server).
// Preserves request body byte-for-byte; computes native_request_hash + native_response_hash.
// Stream variant lives in stream-forward.ts.

import { createHash } from 'node:crypto';

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
   * EP-P03A-A (F3 §19.1): synchronous, non-throwing, I/O-free marker invoked
   * immediately before `fetch`. Lets the caller distinguish a known local error
   * (before any transmission attempt) from a post-invocation unknown outcome.
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
  const t0 = Date.now();
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

  input.onDispatchStart?.();
  const res = await fetch(url, init);
  const latency_ms = Date.now() - t0;
  const responseBuf = Buffer.from(await res.arrayBuffer());
  const native_response_hash = sha256Hex(responseBuf);

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });

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
