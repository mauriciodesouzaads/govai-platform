// Stream forward (SSE) for /v1/messages?stream=true.
// Computes stream_final_hash incrementally over the byte stream while pushing
// chunks to the caller. Aborts upstream when the caller signals abort.

import { createHash } from 'node:crypto';

export type StreamForwardInput = {
  baseUrl: string;
  concretePath: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Buffer;
  /** Caller-controlled abort signal — propagated to upstream fetch. */
  signal?: AbortSignal;
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

  const res = await fetch(url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
    ...(input.signal ? { signal: input.signal } : {}),
  });

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });
  const provider_request_id =
    responseHeaders['anthropic-request-id'] ?? responseHeaders['x-request-id'] ?? null;

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
