// Hermetic fake provider transport for the Provider-Native Compatibility Harness.
//
// A plain node:http server bound to loopback (127.0.0.1). It captures the EXACT
// raw request bytes that a GovAI passthrough route forwards upstream, and returns
// a caller-configured raw response. It NEVER calls a real provider, reads no
// .env, and uses no secrets.
//
// The captured `rawBody` is the source of truth for byte-for-byte assertions.
// JSON parsing is intentionally NOT performed here — callers parse only after a
// Buffer.compare equality check has already passed.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

export type CapturedRequest = {
  method: string;
  /** Full request target as received (path + query). */
  url: string;
  /** Path component only (no query string). */
  path: string;
  /** Raw query string without the leading '?', or '' when absent. */
  query: string;
  headers: Record<string, string | string[] | undefined>;
  /** Raw request body, byte-for-byte as received over the wire. */
  rawBody: Buffer;
};

export type FakeProviderResponse = {
  status: number;
  headers?: Record<string, string>;
  /** Raw response body, sent byte-for-byte. */
  rawBody: Buffer | string;
};

const DEFAULT_RESPONSE: FakeProviderResponse = {
  status: 200,
  headers: { 'content-type': 'application/json' },
  rawBody: '{}',
};

export type FakeProvider = {
  /** Loopback base URL, e.g. http://127.0.0.1:54321 (no trailing slash). */
  readonly url: string;
  /** Requests captured since the last reset, in arrival order. */
  readonly captured: ReadonlyArray<CapturedRequest>;
  /** Number of requests captured since the last reset. */
  readonly callCount: number;
  /** Most recent captured request, or undefined if none. */
  readonly lastRequest: CapturedRequest | undefined;
  /** Configure the response returned for subsequent requests. */
  setResponse(response: FakeProviderResponse): void;
  /** Clear captured requests and restore the default response. */
  reset(): void;
  /** Stop the server and release the port. */
  stop(): Promise<void>;
};

export async function startFakeProvider(): Promise<FakeProvider> {
  const captured: CapturedRequest[] = [];
  let nextResponse: FakeProviderResponse = DEFAULT_RESPONSE;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      const rawUrl = req.url ?? '';
      const qIndex = rawUrl.indexOf('?');
      const path = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex);
      const query = qIndex === -1 ? '' : rawUrl.slice(qIndex + 1);
      captured.push({
        method: req.method ?? '',
        url: rawUrl,
        path,
        query,
        headers: req.headers,
        rawBody: Buffer.concat(chunks),
      });
      const r = nextResponse;
      res.writeHead(r.status, r.headers ?? {});
      res.end(Buffer.isBuffer(r.rawBody) ? r.rawBody : Buffer.from(r.rawBody, 'utf8'));
    });
  });

  // Bind an ephemeral loopback port (no external dependency): listen(0) lets the
  // OS assign a free port, which we read back from address().
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('fake provider failed to bind a loopback TCP port');
  }
  const url = `http://127.0.0.1:${(addr as AddressInfo).port}`;

  return {
    url,
    get captured(): ReadonlyArray<CapturedRequest> {
      return captured;
    },
    get callCount(): number {
      return captured.length;
    },
    get lastRequest(): CapturedRequest | undefined {
      return captured[captured.length - 1];
    },
    setResponse(response: FakeProviderResponse): void {
      nextResponse = response;
    },
    reset(): void {
      captured.length = 0;
      nextResponse = DEFAULT_RESPONSE;
    },
    async stop(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
