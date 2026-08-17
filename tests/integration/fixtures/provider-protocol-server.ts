// Hermetic provider-protocol test server.
// Mimics Anthropic + OpenAI shapes deterministically. Used by E2E tests
// to exercise provider-invoke without hitting real providers.
//
// Endpoints:
//   POST /v1/messages              — Anthropic shape
//   POST /v1/responses             — OpenAI Responses
//   POST /v1/chat/completions      — OpenAI Chat Completions
//
// Each accepts:
//   - Normal mode: returns a fixed shape.
//   - Streaming mode: when body.stream === true, emits SSE/chunks.
//   - Error simulation: header `x-test-error: 401|429|500|502` short-circuits.
//
// Response identifier headers (M2A F1 — anti-masking contract):
//   - Anthropic happy path emits ONLY the REAL provider header `request-id`
//     (never `x-request-id` / `anthropic-request-id` — those are compatibility
//     fallbacks the extraction code tolerates; emitting them here would let a
//     regression to legacy-only extraction pass hermetically, which is exactly
//     the blind spot M2 exposed against the real provider).
//   - OpenAI paths emit `x-request-id` (+ `openai-request-id` where OpenAI does).

import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

export type ProviderProtocolServer = {
  app: FastifyInstance;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
  /** Inbound headers of every request the upstream mock received, in order.
   *  Used by EP-005 to assert the consumed idempotency key is NOT forwarded. */
  recordedRequestHeaders: Array<Record<string, string | string[] | undefined>>;
  clearRecordedRequestHeaders: () => void;
  /** M2A: every request the upstream mock received — method + RAW request-target
   *  (path + query, byte-faithful, from req.raw.url) + the provider request id the
   *  mock issued for it (null when the reply never reached onSend). Used by F5
   *  (query fidelity) and F1 (provider_request_id == issued id). */
  recordedRequests: RecordedRequest[];
  clearRecordedRequests: () => void;
};

export type RecordedRequest = {
  method: string;
  /** Raw request-target exactly as received (path + '?' + query), e.g. `/v1/files?limit=1&order=desc`. */
  url: string;
  /** Provider request id issued by the mock for this reply (`request-id` for Anthropic paths,
   *  `x-request-id` for OpenAI paths, else `openai-request-id`), or null. */
  provider_request_id: string | null;
};

type ErrorPayload = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * Per-workspace error injection. Tests call setErrorOverride(workspaceId, ...)
 * before exercising the route; the handler matches on `x-test-workspace-id`
 * header (forwarded by provider-invoke ONLY in NODE_ENV=test + loopback URL).
 */
const errorOverrides = new Map<string, ErrorPayload>();

// =============================================================================
// EP-P03A-A (F3): per-workspace PARK barrier. A parked workspace's request
// blocks deterministically inside the upstream handler until the test releases
// it — the primitive behind the F3 falsification tests (run visible / locks
// free WHILE the provider call is in flight) and the timeout test. No sleeps:
// the test awaits `parked` (the request reached the upstream), then asserts,
// then calls `release()`.
// =============================================================================

type ParkController = {
  /** Resolves when a request for this workspace is parked inside the handler. */
  parked: Promise<void>;
  /** Releases the parked request; the handler then answers normally. */
  release: () => void;
};

type ParkState = {
  barrier: Promise<void>;
  release: () => void;
  signalParked: () => void;
};

const parkOverrides = new Map<string, ParkState>();

export function setParkOverride(workspaceId: string): ParkController {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signalParked!: () => void;
  const parked = new Promise<void>((resolve) => {
    signalParked = resolve;
  });
  parkOverrides.set(workspaceId, { barrier, release, signalParked });
  return { parked, release };
}

export function clearParkOverrides(): void {
  // Release anything still parked so no Fastify handler awaits forever and
  // the fixture can close cleanly in afterEach/afterAll.
  for (const p of parkOverrides.values()) p.release();
  parkOverrides.clear();
}

async function maybePark(req: { headers: Record<string, string | string[] | undefined> }): Promise<void> {
  const wsId = req.headers['x-test-workspace-id'];
  if (typeof wsId !== 'string') return;
  const park = parkOverrides.get(wsId);
  if (!park) return;
  park.signalParked();
  await park.barrier;
}

// =============================================================================
// EP-P03A-A (F3): per-workspace transport DESTROY. After the request reaches
// the upstream handler (i.e. provably AFTER the client's forward started), the
// raw socket is destroyed without writing any HTTP response — the client's
// fetch rejects with a transport error, the §22 post-forward-transport-error
// case. Distinct from the error overrides (which return well-formed HTTP).
// =============================================================================

const destroyOverrides = new Set<string>();

export function setDestroyOverride(workspaceId: string): void {
  destroyOverrides.add(workspaceId);
}

export function clearDestroyOverrides(): void {
  destroyOverrides.clear();
}

function maybeDestroy(
  req: { headers: Record<string, string | string[] | undefined>; raw: { socket: { destroy: () => void } } },
  reply: { hijack: () => void },
): boolean {
  const wsId = req.headers['x-test-workspace-id'];
  if (typeof wsId !== 'string' || !destroyOverrides.has(wsId)) return false;
  // Hijack so Fastify never writes a response, then kill the connection.
  reply.hijack();
  req.raw.socket.destroy();
  return true;
}

export function setErrorOverride(
  workspaceId: string,
  override: { status: number; body?: Record<string, unknown> },
): void {
  errorOverrides.set(workspaceId, {
    status: override.status,
    body:
      override.body ?? {
        error: { type: 'simulated', status: override.status },
      },
  });
}

export function clearErrorOverrides(): void {
  errorOverrides.clear();
}

function errorFor(code: string | undefined): ErrorPayload | null {
  if (!code) return null;
  switch (code) {
    case '401':
      return { status: 401, body: { error: { type: 'authentication_error', message: 'Invalid API Key' } } };
    case '429':
      return { status: 429, body: { error: { type: 'rate_limit_error', message: 'Slow down' } } };
    case '500':
      return { status: 500, body: { error: { type: 'server_error', message: 'Upstream error' } } };
    case '502':
      return { status: 502, body: { error: { type: 'gateway_error', message: 'Bad gateway' } } };
    default:
      return null;
  }
}

function workspaceErrorFor(req: { headers: Record<string, string | string[] | undefined> }): ErrorPayload | null {
  const wsId = req.headers['x-test-workspace-id'];
  if (typeof wsId !== 'string') return null;
  return errorOverrides.get(wsId) ?? null;
}

function sseChunk(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function startProviderProtocolServer(opts: { port?: number } = {}): Promise<ProviderProtocolServer> {
  const app = Fastify({ logger: false });

  // EP-005: record the inbound headers of every forwarded request so tests can
  // assert which headers the GovAI proxy did (not) forward upstream.
  const recordedRequestHeaders: Array<Record<string, string | string[] | undefined>> = [];
  // M2A: raw request-target + issued provider request id per request (see RecordedRequest).
  const recordedRequests: RecordedRequest[] = [];
  const recordedByReq = new WeakMap<object, RecordedRequest>();
  app.addHook('onRequest', async (req) => {
    recordedRequestHeaders.push({ ...req.headers });
    const entry: RecordedRequest = { method: req.method, url: req.raw.url ?? req.url, provider_request_id: null };
    recordedRequests.push(entry);
    recordedByReq.set(req, entry);
  });
  app.addHook('onSend', async (req, reply, payload) => {
    const entry = recordedByReq.get(req);
    if (entry) {
      const pick = (name: string): string | null => {
        const v = reply.getHeader(name);
        return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? null) : v === undefined ? null : String(v);
      };
      entry.provider_request_id = pick('request-id') ?? pick('x-request-id') ?? pick('openai-request-id');
    }
    return payload;
  });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const parsed = body.length === 0 ? {} : JSON.parse(body as string);
      done(null, parsed);
    } catch (err) {
      done(err as Error);
    }
  });

  // ============================================================================
  // Anthropic /v1/messages
  // ============================================================================
  app.post<{ Body: { stream?: boolean; messages?: Array<{ role: string; content: string }>; model?: string } }>(
    '/v1/messages',
    async (req, reply) => {
      const requestId = randomUUID();
      // M2A F1: the REAL Anthropic identifier header is `request-id` — and ONLY that on the
      // principal happy path (no `x-request-id`, no `anthropic-request-id`). See file header.
      reply.header('request-id', requestId);

      await maybePark(req);
      if (maybeDestroy(req, reply)) return reply;
      const wsErr = workspaceErrorFor(req);
      if (wsErr) {
        reply.code(wsErr.status);
        return wsErr.body;
      }
      const errCode = req.headers['x-test-error'] as string | undefined;
      const err = errorFor(errCode);
      if (err) {
        reply.code(err.status);
        return err.body;
      }

      const body = req.body ?? {};
      const userText = body.messages?.[body.messages.length - 1]?.content ?? '';
      const responseText = `echo: ${userText.slice(0, 200)}`;

      if (body.stream) {
        reply.header('content-type', 'text/event-stream');
        reply.header('cache-control', 'no-cache');
        const stream = sseChunk({ type: 'message_start', message: { id: requestId, model: body.model ?? 'unknown' } })
          + sseChunk({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
          + sseChunk({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: responseText } })
          + sseChunk({ type: 'content_block_stop', index: 0 })
          + sseChunk({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: { input_tokens: userText.length, output_tokens: responseText.length },
            })
          + sseChunk({ type: 'message_stop' });
        return stream;
      }

      return {
        id: requestId,
        type: 'message',
        role: 'assistant',
        model: body.model ?? 'unknown',
        content: [{ type: 'text', text: responseText }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: userText.length,
          output_tokens: responseText.length,
        },
      };
    },
  );

  // ============================================================================
  // OpenAI /v1/responses
  // ============================================================================
  app.post<{ Body: { stream?: boolean; input?: string; model?: string } }>(
    '/v1/responses',
    async (req, reply) => {
      const requestId = randomUUID();
      reply.header('x-request-id', requestId);
      reply.header('openai-request-id', requestId);

      await maybePark(req);
      if (maybeDestroy(req, reply)) return reply;
      const wsErr = workspaceErrorFor(req);
      if (wsErr) {
        reply.code(wsErr.status);
        return wsErr.body;
      }
      const errCode = req.headers['x-test-error'] as string | undefined;
      const err = errorFor(errCode);
      if (err) {
        reply.code(err.status);
        return err.body;
      }

      const body = req.body ?? {};
      const inputText = body.input ?? '';
      const responseText = `echo: ${inputText.slice(0, 200)}`;

      if (body.stream) {
        reply.header('content-type', 'text/event-stream');
        reply.header('cache-control', 'no-cache');
        const stream = sseChunk({ type: 'response.created', response: { id: requestId } })
          + sseChunk({ type: 'response.output_text.delta', delta: responseText })
          + sseChunk({
              type: 'response.completed',
              response: {
                id: requestId,
                usage: { input_tokens: inputText.length, output_tokens: responseText.length },
              },
            });
        return stream;
      }

      return {
        id: requestId,
        object: 'response',
        model: body.model ?? 'unknown',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: responseText }] }],
        usage: {
          input_tokens: inputText.length,
          output_tokens: responseText.length,
        },
      };
    },
  );

  // ============================================================================
  // OpenAI /v1/chat/completions
  // ============================================================================
  app.post<{ Body: { stream?: boolean; messages?: Array<{ role: string; content: string }>; model?: string } }>(
    '/v1/chat/completions',
    async (req, reply) => {
      const requestId = randomUUID();
      reply.header('x-request-id', requestId);

      await maybePark(req);
      if (maybeDestroy(req, reply)) return reply;
      const wsErr = workspaceErrorFor(req);
      if (wsErr) {
        reply.code(wsErr.status);
        return wsErr.body;
      }
      const errCode = req.headers['x-test-error'] as string | undefined;
      const err = errorFor(errCode);
      if (err) {
        reply.code(err.status);
        return err.body;
      }

      const body = req.body ?? {};
      const userText = body.messages?.[body.messages.length - 1]?.content ?? '';
      const responseText = `echo: ${userText.slice(0, 200)}`;

      if (body.stream) {
        reply.header('content-type', 'text/event-stream');
        reply.header('cache-control', 'no-cache');
        const chunk1 = sseChunk({
          id: requestId,
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { role: 'assistant', content: responseText }, finish_reason: null }],
        });
        const chunk2 = sseChunk({
          id: requestId,
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: userText.length, completion_tokens: responseText.length, total_tokens: userText.length + responseText.length },
        });
        return chunk1 + chunk2 + 'data: [DONE]\n\n';
      }

      return {
        id: requestId,
        object: 'chat.completion',
        model: body.model ?? 'unknown',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: responseText },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: userText.length,
          completion_tokens: responseText.length,
          total_tokens: userText.length + responseText.length,
        },
      };
    },
  );

  // ============================================================================
  // OpenAI Batch C — additional fixture endpoints for /passthrough/openai/* tests.
  // These shapes are minimal but deterministic; they are NOT exhaustive contracts.
  // ============================================================================

  // /v1/embeddings
  app.post<{ Body: { input?: string | string[]; model?: string } }>(
    '/v1/embeddings',
    async (req, reply) => {
      const wsErr = workspaceErrorFor(req);
      if (wsErr) {
        reply.code(wsErr.status);
        return wsErr.body;
      }
      reply.header('openai-request-id', randomUUID());
      const body = req.body ?? {};
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ''];
      return {
        object: 'list',
        model: body.model ?? 'text-embedding-3-small',
        data: inputs.map((_, i) => ({
          object: 'embedding',
          index: i,
          embedding: [0.1, 0.2, 0.3],
        })),
        usage: { prompt_tokens: 1, total_tokens: 1 },
      };
    },
  );

  // /v1/models (list + retrieve + delete)
  app.get('/v1/models', async (req, reply) => {
    const wsErr = workspaceErrorFor(req);
    if (wsErr) {
      reply.code(wsErr.status);
      return wsErr.body;
    }
    reply.header('openai-request-id', randomUUID());
    return {
      object: 'list',
      data: [
        { id: 'gpt-fixture-1', object: 'model', created: 0, owned_by: 'fixture' },
        { id: 'gpt-fixture-2', object: 'model', created: 0, owned_by: 'fixture' },
      ],
    };
  });
  app.get<{ Params: { model_id: string } }>('/v1/models/:model_id', async (req, reply) => {
    reply.header('openai-request-id', randomUUID());
    return { id: req.params.model_id, object: 'model', created: 0, owned_by: 'fixture' };
  });
  app.delete<{ Params: { model_id: string } }>('/v1/models/:model_id', async (req, reply) => {
    reply.header('openai-request-id', randomUUID());
    return { id: req.params.model_id, object: 'model', deleted: true };
  });

  // /v1/files — POST accepts multipart but we don't fully parse here; we just echo.
  app.post('/v1/files', async (req, reply) => {
    reply.header('openai-request-id', randomUUID());
    const errCode = req.headers['x-test-error'] as string | undefined;
    const err = errorFor(errCode);
    if (err) {
      reply.code(err.status);
      return err.body;
    }
    return {
      id: `file-${randomUUID()}`,
      object: 'file',
      purpose: 'fine-tune',
      filename: 'fixture.txt',
      bytes: 0,
      created_at: 0,
    };
  });
  app.get('/v1/files', async (_req, reply) => {
    reply.header('openai-request-id', randomUUID());
    return { object: 'list', data: [] };
  });
  app.get<{ Params: { file_id: string } }>('/v1/files/:file_id', async (req, reply) => {
    reply.header('openai-request-id', randomUUID());
    return { id: req.params.file_id, object: 'file', purpose: 'fine-tune', bytes: 0 };
  });
  app.delete<{ Params: { file_id: string } }>('/v1/files/:file_id', async (req, reply) => {
    reply.header('openai-request-id', randomUUID());
    return { id: req.params.file_id, object: 'file', deleted: true };
  });
  app.get<{ Params: { file_id: string } }>(
    '/v1/files/:file_id/content',
    async (_req, reply) => {
      reply.header('openai-request-id', randomUUID());
      reply.header('content-type', 'application/octet-stream');
      return Buffer.from('fixture-file-content');
    },
  );

  // /v1/vector_stores
  app.post('/v1/vector_stores', async (_req, reply) => {
    reply.header('openai-request-id', randomUUID());
    return { id: `vs-${randomUUID()}`, object: 'vector_store', name: 'fixture' };
  });
  app.get('/v1/vector_stores', async (_req, reply) => {
    reply.header('openai-request-id', randomUUID());
    return { object: 'list', data: [] };
  });
  app.get<{ Params: { vs_id: string } }>('/v1/vector_stores/:vs_id', async (req, reply) => {
    reply.header('openai-request-id', randomUUID());
    return { id: req.params.vs_id, object: 'vector_store' };
  });
  app.post<{ Params: { vs_id: string } }>(
    '/v1/vector_stores/:vs_id/files',
    async (req, reply) => {
      reply.header('openai-request-id', randomUUID());
      return { id: `vsf-${randomUUID()}`, object: 'vector_store.file', vector_store_id: req.params.vs_id };
    },
  );
  app.get<{ Params: { vs_id: string } }>(
    '/v1/vector_stores/:vs_id/files',
    async (_req, reply) => {
      reply.header('openai-request-id', randomUUID());
      return { object: 'list', data: [] };
    },
  );
  app.delete<{ Params: { vs_id: string } }>('/v1/vector_stores/:vs_id', async (req, reply) => {
    reply.header('openai-request-id', randomUUID());
    return { id: req.params.vs_id, object: 'vector_store', deleted: true };
  });
  app.delete<{ Params: { vs_id: string; file_id: string } }>(
    '/v1/vector_stores/:vs_id/files/:file_id',
    async (req, reply) => {
      reply.header('openai-request-id', randomUUID());
      return { id: req.params.file_id, object: 'vector_store.file', deleted: true };
    },
  );

  app.get('/health', async () => ({ status: 'ok', service: 'provider-protocol-test-server' }));

  const port = opts.port ?? 0;
  await app.listen({ host: '127.0.0.1', port });
  const address = app.server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const baseUrl = `http://127.0.0.1:${actualPort}`;

  return {
    app,
    port: actualPort,
    baseUrl,
    close: async () => {
      await app.close();
    },
    recordedRequestHeaders,
    clearRecordedRequestHeaders: () => {
      recordedRequestHeaders.length = 0;
    },
    recordedRequests,
    clearRecordedRequests: () => {
      recordedRequests.length = 0;
    },
  };
}
