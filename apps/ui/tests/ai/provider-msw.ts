import { http, HttpResponse, type HttpHandler } from 'msw';
import { VALID_KEY } from '../msw/server.js';

// MSW handlers that behave like the GovAI direct provider routes.
//
// They model the real thing closely enough that a test passing here would pass against the
// running service: the same auth header, the same relayed provider status, the same
// `x-govai-*` governance headers on the governed route and none of them on the native one,
// and a genuinely CHUNKED SSE body rather than one string — a stream delivered in one piece
// would never exercise the reader's reassembly.

export type StreamScript = {
  /** SSE chunks, delivered one at a time. Split mid-frame freely: that is the point. */
  chunks: readonly string[];
  /** Response headers, e.g. a provider request id or the governed governance headers. */
  headers?: Record<string, string>;
  status?: number;
  /** Milliseconds between chunks. Used by the Stop test to keep a stream open. */
  delayMs?: number;
  /** Never close the stream — the caller aborts. */
  hang?: boolean;
};

/** A JSON body MSW can serialize. Deliberately not `unknown`: a handler that cannot be
 *  serialized is a test bug, and it should be a compile error rather than a runtime one. */
export type JsonBody = Record<string, unknown> | unknown[];

export type ErrorScript = {
  status: number;
  body: JsonBody;
  headers?: Record<string, string>;
};

/** Records every provider request a test caused, so "one Send = one POST" is checkable. */
export type ProviderCallLog = {
  calls: Array<{ path: string; body: unknown; apiKey: string | null }>;
};

export function newCallLog(): ProviderCallLog {
  return { calls: [] };
}

function unauthorized(request: Request): Response | null {
  const key = request.headers.get('x-govai-api-key');
  if (key === VALID_KEY) return null;
  return HttpResponse.json({ error: 'auth_error', message: 'invalid api key' }, { status: 401 });
}

function sseStream(script: StreamScript): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= script.chunks.length) {
        if (script.hang) {
          // Hold the stream open until the reader cancels. The `pull` contract lets us simply
          // not resolve; the abort path cancels the reader and unwinds it.
          await new Promise<void>(() => undefined);
          return;
        }
        controller.close();
        return;
      }
      if (script.delayMs) await new Promise((r) => setTimeout(r, script.delayMs));
      controller.enqueue(encoder.encode(script.chunks[i] as string));
      i += 1;
    },
    cancel() {
      i = script.chunks.length;
    },
  });
}

/** A handler for one provider conversation path that answers with a streamed script. */
export function streamHandler(path: string, script: StreamScript, log?: ProviderCallLog): HttpHandler {
  return http.post(`*${path}`, async ({ request }) => {
    const denied = unauthorized(request);
    if (denied) return denied;
    log?.calls.push({
      path,
      body: await request.clone().json(),
      apiKey: request.headers.get('x-govai-api-key'),
    });
    return new HttpResponse(sseStream(script), {
      status: script.status ?? 200,
      headers: { 'content-type': 'text/event-stream', ...(script.headers ?? {}) },
    });
  });
}

/** A handler that answers a conversation path with a non-2xx provider or GovAI error. */
export function errorHandler(path: string, script: ErrorScript, log?: ProviderCallLog): HttpHandler {
  return http.post(`*${path}`, async ({ request }) => {
    const denied = unauthorized(request);
    if (denied) return denied;
    log?.calls.push({
      path,
      body: await request.clone().json(),
      apiKey: request.headers.get('x-govai-api-key'),
    });
    return HttpResponse.json(script.body, {
      status: script.status,
      headers: script.headers ?? {},
    });
  });
}

/** Model discovery for a provider. */
export function modelsHandler(
  provider: 'openai' | 'anthropic',
  body: JsonBody,
  init: { status?: number } = {},
): HttpHandler {
  return http.get(`*/passthrough/${provider}/v1/models`, ({ request }) => {
    const denied = unauthorized(request);
    if (denied) return denied;
    return HttpResponse.json(body, { status: init.status ?? 200 });
  });
}

/** The default model listings, so a test that does not care about discovery still has one. */
export const OPENAI_MODELS = {
  object: 'list',
  data: [
    { id: 'test-openai-model', object: 'model', created: 1, owned_by: 'test' },
    { id: 'test-openai-other', object: 'model', created: 2, owned_by: 'test' },
  ],
};

export const ANTHROPIC_MODELS = {
  data: [
    {
      type: 'model',
      id: 'test-anthropic-model',
      display_name: 'Test Anthropic Model',
      created_at: '2026-01-01T00:00:00Z',
    },
  ],
  has_more: false,
  first_id: null,
  last_id: null,
};

export const defaultModelHandlers = (): HttpHandler[] => [
  modelsHandler('openai', OPENAI_MODELS),
  modelsHandler('anthropic', ANTHROPIC_MODELS),
];

// ── Ready-made provider scripts ────────────────────────────────────────────────────────────

/** An OpenAI Responses stream, deliberately fragmented across chunk boundaries. */
export function responsesScript(text: string): readonly string[] {
  const body = `data: {"type":"response.created","response":{"id":"resp_test"}}\n\ndata: {"type":"response.output_text.delta","delta":${JSON.stringify(text)}}\n\ndata: {"type":"response.completed","response":{"id":"resp_test"}}\n\n`;
  // Split at an awkward offset so a frame straddles two chunks.
  const cut = Math.floor(body.length / 3);
  return [body.slice(0, cut), body.slice(cut, cut * 2), body.slice(cut * 2)];
}

export function chatScript(text: string): readonly string[] {
  return [
    `data: {"id":"chatcmpl-test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":${JSON.stringify(text)}},"finish_reason":null}]}\n\n`,
    'data: {"id":"chatcmpl-test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ];
}

export function messagesScript(text: string): readonly string[] {
  return [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","model":"m","content":[]}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}\n\n`,
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
}

/** A stream that emits text and then never terminates — the Stop-generation fixture. */
export function openEndedScript(text: string): StreamScript {
  return {
    chunks: [
      'data: {"type":"response.created","response":{"id":"resp_open"}}\n\n',
      `data: {"type":"response.output_text.delta","delta":${JSON.stringify(text)}}\n\n`,
    ],
    hang: true,
  };
}

export const PATHS = {
  openaiResponsesNative: '/passthrough/openai/v1/responses',
  openaiResponsesGoverned: '/governed/openai/v1/responses',
  openaiChatNative: '/passthrough/openai/v1/chat/completions',
  openaiChatGoverned: '/governed/openai/v1/chat/completions',
  anthropicMessagesNative: '/passthrough/anthropic/v1/messages',
  anthropicMessagesGoverned: '/governed/anthropic/v1/messages',
} as const;
