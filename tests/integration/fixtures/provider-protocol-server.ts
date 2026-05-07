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

import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

export type ProviderProtocolServer = {
  app: FastifyInstance;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
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
      reply.header('x-request-id', requestId);
      reply.header('anthropic-request-id', requestId);

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
  };
}
