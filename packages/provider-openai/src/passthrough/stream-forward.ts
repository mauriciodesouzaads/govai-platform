// Stream forward (SSE) for /v1/responses?stream=true and /v1/chat/completions?stream=true.
// Computes stream_final_hash incrementally over the byte stream while pushing
// chunks to the caller. Aborts upstream when the caller signals abort.

import { createHash } from 'node:crypto';
import {
  normalizeFetchResponseHeaders,
  withIdentityAcceptEncoding,
} from './transport-encoding.js';

export type StreamForwardInput = {
  baseUrl: string;
  concretePath: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Buffer;
  signal?: AbortSignal;
};

export type StreamForwardResult = {
  status: number;
  responseHeaders: Record<string, string>;
  body: ReadableStream<Uint8Array>;
  native_request_hash: string;
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

  const res = await fetch(url, {
    method: input.method,
    // FB-3 (M1): identity on the Fetch hop — see transport-encoding.ts.
    headers: withIdentityAcceptEncoding(input.headers),
    body: input.body,
    ...(input.signal ? { signal: input.signal } : {}),
  });

  const rawResponseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    rawResponseHeaders[key.toLowerCase()] = value;
  });
  // FB-3 (M1) defense in depth: the streamed chunks are the DECODED bytes when
  // Fetch decoded — drop the stale content-encoding / content-length so the
  // relayed stream headers describe the chunks actually written + hashed.
  const responseHeaders = normalizeFetchResponseHeaders(res.status, rawResponseHeaders);
  const provider_request_id =
    responseHeaders['openai-request-id'] ?? responseHeaders['x-request-id'] ?? null;

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

  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (!upstream) {
        controller.close();
        resolveFinal({
          stream_final_hash: hasher.digest('hex'),
          bytes_streamed,
          latency_ms: Date.now() - t0,
        });
        return;
      }
      const reader = upstream.getReader();
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
