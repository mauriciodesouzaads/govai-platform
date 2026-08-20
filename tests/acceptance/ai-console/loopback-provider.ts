// A provider-realistic loopback upstream for the AI Console browser acceptance.
//
// The integration fixture (tests/integration/fixtures/provider-protocol-server.ts) answers
// with a single pre-built SSE string, which is exactly right for an assertion about the audit
// event and exactly wrong for exercising a BROWSER stream reader: one write means one chunk,
// and a reader that only ever sees whole frames proves nothing about fragmentation.
//
// This server therefore writes SSE the way a real provider does:
//   • many small writes, with frames deliberately SPLIT ACROSS chunk boundaries;
//   • multi-byte characters split mid-sequence;
//   • the real response-identifier headers (`request-id` for Anthropic, `x-request-id` +
//     `openai-request-id` for OpenAI);
//   • a slow mode that keeps a stream open so Stop has something to stop;
//   • injectable 429 / 4xx / 5xx and a mid-flight stream abort.
//
// Behaviour is selected per request by a marker in the PROMPT TEXT, so the whole matrix is
// drivable from the browser with nothing but typing — no side channel, no query parameter that
// GovAI would have to forward.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

export type LoopbackHandle = {
  port: number;
  baseUrl: string;
  /** Every upstream request this server received, in order. */
  requests: Array<{ method: string; url: string; body: string; at: number }>;
  close: () => Promise<void>;
};

/** Markers a prompt may carry to steer this server. */
const MARKERS = {
  slow: '#slow', // a long, slowly-emitted stream (Stop)
  rateLimit: '#429',
  badRequest: '#400',
  serverError: '#500',
  midFlight: '#cut', // deliver some text, then destroy the socket
  unicode: '#unicode', // emit multi-byte text split mid-character
} as const;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function promptOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    // Responses uses `input`, the other two use `messages`.
    const input = parsed['input'];
    if (Array.isArray(input)) {
      const last = input[input.length - 1] as { content?: unknown } | undefined;
      if (typeof last?.content === 'string') return last.content;
    }
    const messages = parsed['messages'];
    if (Array.isArray(messages)) {
      const last = messages[messages.length - 1] as { content?: unknown } | undefined;
      if (typeof last?.content === 'string') return last.content;
    }
  } catch {
    /* not JSON we can inspect */
  }
  return '';
}

function isStream(body: string): boolean {
  try {
    return (JSON.parse(body) as { stream?: unknown }).stream === true;
  } catch {
    return false;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Write a payload in SMALL, ARBITRARY byte slices so frames straddle chunk boundaries and
 * multi-byte characters are cut in half. This is the whole point of the fixture.
 */
async function writeFragmented(
  res: ServerResponse,
  payload: string,
  opts: { sliceBytes?: number; delayMs?: number } = {},
): Promise<void> {
  const bytes = Buffer.from(payload, 'utf8');
  const slice = opts.sliceBytes ?? 7;
  for (let i = 0; i < bytes.length; i += slice) {
    if (res.destroyed) return;
    res.write(bytes.subarray(i, i + slice));
    if (opts.delayMs) await sleep(opts.delayMs);
  }
}

const sse = (data: unknown, event?: string): string =>
  `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;

/** The three provider stream protocols, as the providers actually emit them. */
function buildStream(
  path: string,
  requestId: string,
  text: string,
): { frames: string; contentType: string } {
  if (path.startsWith('/v1/messages')) {
    return {
      contentType: 'text/event-stream',
      frames:
        sse({ type: 'message_start', message: { id: requestId, type: 'message', role: 'assistant', model: 'loopback', content: [], usage: { input_tokens: 1, output_tokens: 1 } } }, 'message_start') +
        sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'content_block_start') +
        sse({ type: 'ping' }, 'ping') +
        text
          .split(' ')
          .map((word, i) =>
            sse(
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: i === 0 ? word : ` ${word}` } },
              'content_block_delta',
            ),
          )
          .join('') +
        sse({ type: 'content_block_stop', index: 0 }, 'content_block_stop') +
        sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } }, 'message_delta') +
        sse({ type: 'message_stop' }, 'message_stop'),
    };
  }
  if (path.startsWith('/v1/chat/completions')) {
    return {
      contentType: 'text/event-stream',
      frames:
        text
          .split(' ')
          .map((word, i) =>
            sse({
              id: requestId,
              object: 'chat.completion.chunk',
              model: 'loopback',
              choices: [{ index: 0, delta: { content: i === 0 ? word : ` ${word}` }, finish_reason: null }],
            }),
          )
          .join('') +
        sse({ id: requestId, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
        'data: [DONE]\n\n',
    };
  }
  // /v1/responses
  return {
    contentType: 'text/event-stream',
    frames:
      sse({ type: 'response.created', response: { id: requestId, status: 'in_progress' } }, 'response.created') +
      text
        .split(' ')
        .map((word, i) =>
          sse({ type: 'response.output_text.delta', item_id: requestId, output_index: 0, content_index: 0, delta: i === 0 ? word : ` ${word}` }, 'response.output_text.delta'),
        )
        .join('') +
      sse({ type: 'response.completed', response: { id: requestId, status: 'completed', usage: { input_tokens: 1, output_tokens: 12 } } }, 'response.completed'),
  };
}

function nonStreamBody(path: string, requestId: string, text: string): unknown {
  if (path.startsWith('/v1/messages')) {
    return {
      id: requestId,
      type: 'message',
      role: 'assistant',
      model: 'loopback',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 12 },
    };
  }
  if (path.startsWith('/v1/chat/completions')) {
    return {
      id: requestId,
      object: 'chat.completion',
      model: 'loopback',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    };
  }
  return {
    id: requestId,
    object: 'response',
    model: 'loopback',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
  };
}

const OPENAI_MODELS = {
  object: 'list',
  data: [
    { id: 'loopback-openai-small', object: 'model', created: 1, owned_by: 'loopback' },
    { id: 'loopback-openai-large', object: 'model', created: 2, owned_by: 'loopback' },
    { id: 'loopback-embedding-only', object: 'model', created: 3, owned_by: 'loopback' },
  ],
};

const ANTHROPIC_MODELS = {
  data: [
    { type: 'model', id: 'loopback-anthropic-small', display_name: 'Loopback Small', created_at: '2026-01-01T00:00:00Z' },
    { type: 'model', id: 'loopback-anthropic-large', display_name: 'Loopback Large', created_at: '2026-01-02T00:00:00Z' },
  ],
  has_more: false,
  first_id: null,
  last_id: null,
};

const ANSWER = [
  'This answer comes from the **loopback** upstream, not from a real provider.',
  '',
  'It is Markdown on purpose:',
  '',
  '1. a numbered item',
  '2. another one',
  '',
  '```ts',
  'const x: number = 1 < 2 ? 1 : 2;',
  '```',
  '',
  '| column | value |',
  '| --- | --- |',
  '| streamed | yes |',
  '',
  'A raw tag that must NOT execute: <script>window.__pwned = true</script>',
].join('\n');

const UNICODE_ANSWER = 'Ação concluída: 漢字 e 🚀 atravessando fronteiras de chunk — ção, não, coração.';

export async function startLoopbackProvider(port = 8099): Promise<LoopbackHandle> {
  const requests: LoopbackHandle['requests'] = [];

  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '/';
      const body = await readBody(req);
      requests.push({ method: req.method ?? 'GET', url, body, at: Date.now() });

      // Model discovery.
      if (req.method === 'GET' && url.startsWith('/v1/models')) {
        const isAnthropic = (req.headers['x-api-key'] ?? req.headers['anthropic-version']) !== undefined;
        const payload = isAnthropic ? ANTHROPIC_MODELS : OPENAI_MODELS;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }

      const requestId = `loopback_${randomUUID()}`;
      const prompt = promptOf(body);
      // The two providers use different identifier headers; emit each provider's own.
      const idHeaders: Record<string, string> = url.startsWith('/v1/messages')
        ? { 'request-id': requestId }
        : { 'x-request-id': requestId, 'openai-request-id': requestId };

      // ── Injected failures ────────────────────────────────────────────────────────────────
      if (prompt.includes(MARKERS.rateLimit)) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '37', ...idHeaders });
        res.end(JSON.stringify({ error: { type: 'rate_limit_error', message: 'Loopback rate limit reached' } }));
        return;
      }
      if (prompt.includes(MARKERS.badRequest)) {
        res.writeHead(400, { 'content-type': 'application/json', ...idHeaders });
        res.end(
          JSON.stringify({
            error: {
              type: 'invalid_request_error',
              code: 'model_not_found',
              message: 'Loopback: the model does not exist or is not available on this surface',
            },
          }),
        );
        return;
      }
      if (prompt.includes(MARKERS.serverError)) {
        res.writeHead(500, { 'content-type': 'application/json', ...idHeaders });
        res.end(JSON.stringify({ error: { type: 'server_error', message: 'Loopback upstream failure' } }));
        return;
      }

      if (!isStream(body)) {
        res.writeHead(200, { 'content-type': 'application/json', ...idHeaders });
        res.end(JSON.stringify(nonStreamBody(url, requestId, 'Loopback non-stream answer.')));
        return;
      }

      const text = prompt.includes(MARKERS.unicode) ? UNICODE_ANSWER : ANSWER;
      const { frames, contentType } = buildStream(url, requestId, text);
      res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache', ...idHeaders });

      if (prompt.includes(MARKERS.midFlight)) {
        // Deliver a little, then kill the socket with no terminal event — the outcome the UI
        // must classify as UNCONFIRMED rather than as a finished answer.
        await writeFragmented(res, frames.slice(0, Math.floor(frames.length / 3)), { sliceBytes: 5 });
        res.destroy();
        return;
      }

      if (prompt.includes(MARKERS.slow)) {
        // A long, slow stream, so Stop has a live generation to interrupt.
        const long = `${frames.slice(0, frames.lastIndexOf('data:'))}`;
        await writeFragmented(res, long, { sliceBytes: 3, delayMs: 40 });
        // Keep the connection open indefinitely; the browser aborts.
        return;
      }

      await writeFragmented(res, frames, { sliceBytes: 11, delayMs: 8 });
      res.end();
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));

  return {
    port,
    baseUrl: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const LOOPBACK_MARKERS = MARKERS;
