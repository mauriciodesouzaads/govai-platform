import { describe, expect, it, vi } from 'vitest';
import {
  classifyErrorStatus,
  isPreProviderBlockCode,
  runTurn,
  FASTIFY_BODY_TOO_LARGE_CODE,
} from './run-turn.js';
import { anthropicMessagesAdapter } from '../providers/anthropic-messages.js';
import { openaiChatCompletionsAdapter } from '../providers/openai-chat-completions.js';
import { openaiResponsesAdapter } from '../providers/openai-responses.js';
import { EMPTY_PROVIDER_ERROR, providerErrorFromText } from '../providers/errors.js';
import type { ApiClient } from '../../../lib/api/client.js';
import type { ConsoleMode, ProviderAdapter } from '../providers/types.js';

// The turn runner: one provider call, classified honestly.
//
// The client is a stub so the classification can be driven from an exact status/header/stream
// triple. The transport itself is tested in lib/api/client.stream.test.ts; what is under test
// here is the JUDGEMENT — which observation becomes which state, and which claims the receipt
// is allowed to carry.

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function bodyOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc(chunks[i] as string));
      i += 1;
    },
  });
}

type StubResponse = {
  status?: number;
  headers?: Record<string, string>;
  chunks?: readonly string[];
  errorBody?: unknown;
  /** Throw instead of answering (a request that produced no response). */
  throws?: unknown;
  /** A body stream that errors part-way. */
  faultAfter?: readonly string[];
};

function stubClient(response: StubResponse): { client: ApiClient; calls: number } {
  const state = { calls: 0 };
  const client: ApiClient = {
    baseUrl: '',
    get: async () => {
      throw new Error('not used');
    },
    stream: async () => {
      state.calls += 1;
      if (response.throws !== undefined) throw response.throws;
      const status = response.status ?? 200;
      const headers = new Headers(response.headers ?? {});
      const ok = status >= 200 && status < 300;
      // A stream that delivers its chunks and THEN dies. The chunks are enqueued one per
      // `pull` (not all in `start`) so the reader genuinely receives them before the error —
      // erroring a controller with items still queued discards them, which would test a
      // different thing entirely.
      const faultChunks = response.faultAfter;
      const body = faultChunks
        ? (() => {
            let i = 0;
            return new ReadableStream<Uint8Array>({
              pull(c) {
                if (i < faultChunks.length) {
                  c.enqueue(enc(faultChunks[i] as string));
                  i += 1;
                  return;
                }
                c.error(new Error('connection reset'));
              },
            });
          })()
        : bodyOf(response.chunks ?? []);
      return {
        status,
        ok,
        headers,
        body,
        readBoundedText: async () =>
          response.errorBody === undefined ? '' : JSON.stringify(response.errorBody),
      };
    },
  };
  return {
    client,
    get calls() {
      return state.calls;
    },
  } as { client: ApiClient; calls: number };
}

async function run(
  response: StubResponse,
  opts: {
    adapter?: ProviderAdapter;
    mode?: ConsoleMode;
    signal?: AbortSignal;
    onText?: (text: string) => void;
  } = {},
) {
  const stub = stubClient(response);
  const controller = new AbortController();
  const result = await runTurn({
    client: stub.client,
    adapter: opts.adapter ?? openaiResponsesAdapter,
    mode: opts.mode ?? 'native_audited',
    model: 'a-model',
    maxTokens: 2048,
    history: [],
    prompt: 'hello',
    signal: opts.signal ?? controller.signal,
    onText: opts.onText ?? (() => undefined),
    now: (() => {
      let t = 1000;
      return () => (t += 7);
    })(),
  });
  return { result, calls: stub.calls };
}

const RESPONSES_OK = [
  'data: {"type":"response.created","response":{"id":"resp_1"}}\n\n',
  'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
  'data: {"type":"response.completed","response":{"id":"resp_1"}}\n\n',
];

describe('a completed stream', () => {
  it('reports completed, with the text, and calls the transport exactly once', async () => {
    const { result, calls } = await run({
      chunks: RESPONSES_OK,
      headers: { 'openai-request-id': 'req_abc' },
    });
    expect(calls).toBe(1);
    expect(result.state).toBe('completed');
    expect(result.text).toBe('Hello');
    expect(result.receipt.status).toBe(200);
    expect(result.receipt.providerRequestId).toBe('req_abc');
    expect(result.receipt.providerMessageId).toBe('resp_1');
    expect(result.receipt.clientDurationMs).toBeGreaterThan(0);
  });

  it('streams incremental text to the caller', async () => {
    const seen: string[] = [];
    await run({ chunks: RESPONSES_OK }, { onText: (t) => seen.push(t) });
    expect(seen).toContain('Hello');
  });

  it('records no provider request id when the response carried none', async () => {
    const { result } = await run({ chunks: RESPONSES_OK });
    expect(result.receipt.providerRequestId).toBeNull();
  });
});

describe('★ a stream that ends without a terminal marker is NOT a success', () => {
  it('classifies text-without-terminal as an unconfirmed outcome', async () => {
    const { result } = await run({
      chunks: ['data: {"type":"response.output_text.delta","delta":"half"}\n\n'],
    });
    expect(result.state).toBe('unknown_outcome');
    expect(result.text).toBe('half');
  });

  it('classifies a mid-stream transport fault as an unconfirmed outcome, keeping the text', async () => {
    const { result } = await run({
      faultAfter: ['data: {"type":"response.output_text.delta","delta":"partial"}\n\n'],
    });
    expect(result.state).toBe('unknown_outcome');
    expect(result.text).toBe('partial');
  });

  it('still reports completed when the terminal arrived before the fault', async () => {
    // The marker is proof the provider finished; a socket dying afterwards does not undo it.
    const { result } = await run({ faultAfter: RESPONSES_OK });
    expect(result.state).toBe('completed');
  });

  it('classifies a 2xx with no body at all as unconfirmed', async () => {
    const stub = stubClient({});
    const patched: ApiClient = {
      ...stub.client,
      stream: async () => ({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: null,
        readBoundedText: async () => '',
      }),
    };
    const result = await runTurn({
      client: patched,
      adapter: openaiResponsesAdapter,
      mode: 'native_audited',
      model: 'm',
      maxTokens: 1,
      history: [],
      prompt: 'x',
      signal: new AbortController().signal,
      onText: () => undefined,
    });
    expect(result.state).toBe('unknown_outcome');
  });
});

describe('★ a turn settles at the provider’s terminal event, not at EOF', () => {
  it('stops reading once the terminal arrives, even on a connection held open', async () => {
    // ★ REGRESSION. A provider may send its terminal event and keep the socket open — the
    // acceptance stack does, for seconds. Draining to EOF anyway left the turn in `streaming`
    // with its duration climbing and its completed answer held out of later context, long
    // after the provider had finished. It is also what made a late Stop click possible at all.
    let pulls = 0;
    const stub = stubClient({});
    const patched: ApiClient = {
      ...stub.client,
      stream: async () => ({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: new ReadableStream<Uint8Array>({
          pull(c) {
            pulls += 1;
            if (pulls <= RESPONSES_OK.length) {
              c.enqueue(enc(RESPONSES_OK[pulls - 1] as string));
              return;
            }
            // Silence for ever. If the pump waited for EOF, this would never resolve.
            return new Promise<void>(() => undefined);
          },
        }),
        readBoundedText: async () => '',
      }),
    };
    const result = await Promise.race([
      runTurn({
        client: patched,
        adapter: openaiResponsesAdapter,
        mode: 'native_audited',
        model: 'm',
        maxTokens: 1,
        history: [],
        prompt: 'x',
        signal: new AbortController().signal,
        onText: () => undefined,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('runTurn waited for EOF after the terminal event')), 3000),
      ),
    ]);
    expect(result.state).toBe('completed');
    expect(result.text).toBe('Hello');
    // It read the three scripted chunks and stopped; it did not sit on the open connection.
    expect(pulls).toBeLessThanOrEqual(RESPONSES_OK.length + 1);
  });
});

describe('stop', () => {
  it('reports stopped and keeps the partial text', async () => {
    const controller = new AbortController();
    const { result } = await run(
      { chunks: RESPONSES_OK },
      {
        signal: controller.signal,
        onText: (text) => {
          if (text.length > 0) controller.abort();
        },
      },
    );
    expect(result.state).toBe('stopped');
    expect(result.text).toBe('Hello');
  });

  it('★ a terminal marker OUTRANKS a later abort: a finished answer is never relabelled stopped', async () => {
    // A provider can send its terminal event and hold the connection open afterwards, so Stop
    // is still on screen when the answer is visibly complete. Letting the abort win there would
    // relabel a completed, billed execution as "stopped by you" — a wrong receipt, and an answer
    // dropped from later context for a failure that did not happen.
    const controller = new AbortController();
    const { result } = await run(
      {
        // The terminal arrives, then more frames keep the stream alive.
        chunks: [
          ...RESPONSES_OK,
          'data: {"type":"response.output_item.done"}\n\n',
          'data: {"type":"response.output_item.done"}\n\n',
        ],
      },
      {
        signal: controller.signal,
        // ★ The abort has to land AFTER the terminal frame has been folded in — that is the
        // whole scenario. `onText` fires once per frame, so counting them puts the abort
        // exactly where a reader's late Stop click would land: on a stream whose answer is
        // already complete but whose socket is still open.
        onText: (() => {
          let frames = 0;
          return () => {
            frames += 1;
            if (frames >= 3) controller.abort(); // created, delta, completed
          };
        })(),
      },
    );
    expect(result.state).toBe('completed');
    expect(result.text).toBe('Hello');
    expect(result.receipt.state).toBe('completed');
  });

  it('★ a terminal ERROR also outranks a later abort', async () => {
    const controller = new AbortController();
    const { result } = await run(
      {
        chunks: [
          'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
          'data: {"type":"response.failed","response":{"error":{"code":"server_error"}}}\n\n',
          'data: {"type":"response.output_item.done"}\n\n',
        ],
      },
      {
        signal: controller.signal,
        onText: (() => {
          let frames = 0;
          return () => {
            frames += 1;
            if (frames >= 2) controller.abort(); // delta, failed
          };
        })(),
      },
    );
    expect(result.state).toBe('provider_error');
  });

  it('reports stopped when the abort lands before any response', async () => {
    const controller = new AbortController();
    controller.abort();
    const { result } = await run(
      { throws: new DOMException('aborted', 'AbortError') },
      { signal: controller.signal },
    );
    expect(result.state).toBe('stopped');
    expect(result.receipt.status).toBeNull();
  });
});

describe('★ a request that produced no response is UNCONFIRMED, not a failure', () => {
  it('classifies a transport failure as network_error with no provider detail invented', async () => {
    const { result, calls } = await run({
      throws: Object.assign(new Error('did not reach'), { kind: 'network', name: 'ApiError' }),
    });
    expect(result.state).toBe('network_error');
    expect(result.error).toEqual(EMPTY_PROVIDER_ERROR);
    expect(result.receipt.status).toBeNull();
    expect(calls).toBe(1);
  });
});

describe('error statuses map to distinct, honest states', () => {
  it('treats a GovAI pre-provider 403 as blocked', async () => {
    const { result } = await run({
      status: 403,
      errorBody: { error: 'governed_blocked', reason: 'enforcement_blocked:D', block_trigger: 'governance_enforcement' },
      headers: {
        'x-govai-enforcement-decision': 'blocked',
        'x-govai-enforcement-applied': 'blocked',
      },
      chunks: [],
    }, { mode: 'governed' });
    expect(result.state).toBe('blocked');
    expect(result.receipt.governance?.applied).toBe('blocked');
    expect(result.receipt.governance?.blockTrigger).toBe('governance_enforcement');
  });

  it('treats a beta_denied 403 as blocked', async () => {
    const { result } = await run({ status: 403, errorBody: { error: 'beta_denied', denied: [] } });
    expect(result.state).toBe('blocked');
  });

  it('treats a tool-floor 403 as blocked', async () => {
    const { result } = await run({
      status: 403,
      errorBody: { error: 'tool_blocked_until_governance_primitive', blocked: [] },
    });
    expect(result.state).toBe('blocked');
  });

  it('★ treats a PROVIDER 403 as a provider error, because the provider is who ran it', async () => {
    const { result } = await run({
      status: 403,
      errorBody: { error: { type: 'permission_error', message: 'not allowed' } },
    });
    expect(result.state).toBe('provider_error');
  });

  it('treats 429 as rate limited and carries the advertised wait', async () => {
    const { result } = await run({
      status: 429,
      headers: { 'retry-after': '30' },
      errorBody: { error: { type: 'rate_limit_error', message: 'slow down' } },
    });
    expect(result.state).toBe('rate_limited');
    expect(result.retryAfterSeconds).toBe(30);
  });

  it('treats the credential contract 502 as a configuration condition', async () => {
    const { result } = await run({
      status: 502,
      errorBody: {
        error: 'provider_credential_unresolvable',
        provider: 'openai',
        reason: 'no_active_credential',
      },
    });
    expect(result.state).toBe('credential_unavailable');
    // ★ Only the safe metadata reaches the UI — no KMS data, no key material, no stack.
    expect(result.error?.code).toBe('provider_credential_unresolvable');
    expect(JSON.stringify(result)).not.toContain('kms');
  });

  it('treats another 502 as an ordinary provider error', async () => {
    const { result } = await run({ status: 502, errorBody: { error: { type: 'gateway_error' } } });
    expect(result.state).toBe('provider_error');
  });

  it('treats 400 as a provider error and surfaces the provider’s own words', async () => {
    const { result } = await run({
      status: 400,
      errorBody: {
        error: { message: 'model does not exist', type: 'invalid_request_error', code: 'model_not_found' },
      },
    });
    expect(result.state).toBe('provider_error');
    expect(result.error).toMatchObject({ code: 'model_not_found', message: 'model does not exist' });
  });
});

describe('the classification table is pure and exhaustive', () => {
  it('names the three pre-provider block codes and nothing else', () => {
    for (const code of ['beta_denied', 'tool_blocked_until_governance_primitive', 'governed_blocked']) {
      expect(isPreProviderBlockCode(code)).toBe(true);
    }
    for (const code of [null, '', 'permission_error', 'invalid_request_error', 'blocked']) {
      expect(isPreProviderBlockCode(code), String(code)).toBe(false);
    }
  });

  it('maps statuses without consulting anything but the status and the code', () => {
    expect(classifyErrorStatus(403, { ...EMPTY_PROVIDER_ERROR, code: 'governed_blocked' })).toBe('blocked');
    expect(classifyErrorStatus(403, EMPTY_PROVIDER_ERROR)).toBe('provider_error');
    expect(classifyErrorStatus(429, EMPTY_PROVIDER_ERROR)).toBe('rate_limited');
    expect(classifyErrorStatus(500, EMPTY_PROVIDER_ERROR)).toBe('provider_error');
  });

  // GovAI configures no `bodyLimit`, so Fastify's default 1 MiB rejects an oversized body
  // BEFORE either provider route runs. Calling that `provider_error` prints "the provider
  // answered with an error" for a call the provider never received.
  it("a GovAI-local 413 is NOT attributed to the provider", () => {
    expect(
      classifyErrorStatus(413, { ...EMPTY_PROVIDER_ERROR, code: FASTIFY_BODY_TOO_LARGE_CODE }),
    ).toBe('request_too_large');
  });

  it("a provider's OWN 413 stays a provider error — the code, never the bare status, decides", () => {
    expect(classifyErrorStatus(413, EMPTY_PROVIDER_ERROR)).toBe('provider_error');
    expect(
      classifyErrorStatus(413, { ...EMPTY_PROVIDER_ERROR, code: 'request_too_large' }),
    ).toBe('provider_error');
    expect(
      classifyErrorStatus(413, { ...EMPTY_PROVIDER_ERROR, type: 'invalid_request_error' }),
    ).toBe('provider_error');
  });

  it("reads Fastify's real 413 envelope end to end: top-level code wins over the human phrase", () => {
    // The exact body Fastify 5 emits for a body over `bodyLimit`, verified against the
    // framework rather than assumed.
    const error = providerErrorFromText(
      '{"statusCode":413,"code":"FST_ERR_CTP_BODY_TOO_LARGE","error":"Payload Too Large","message":"Request body is too large"}',
      413,
    );
    expect(error.code).toBe(FASTIFY_BODY_TOO_LARGE_CODE);
    expect(classifyErrorStatus(413, error)).toBe('request_too_large');
  });

  it("the GovAI envelope is unchanged: with no top-level code, `error` is still the code", () => {
    const error = providerErrorFromText('{"error":"governed_blocked","message":"blocked"}', 403);
    expect(error.code).toBe('governed_blocked');
    expect(classifyErrorStatus(403, error)).toBe('blocked');
  });
});

describe('★ governance facts appear only where the route actually sets them', () => {
  it('is null on the native/audited route', async () => {
    const { result } = await run(
      {
        chunks: RESPONSES_OK,
        // Even if the headers were somehow present, the native surface must report nothing.
        headers: { 'x-govai-enforcement-decision': 'ask', 'x-govai-enforcement-applied': 'forwarded' },
      },
      { mode: 'native_audited' },
    );
    expect(result.receipt.governance).toBeNull();
    expect(result.receipt.mode).toBe('native_audited');
  });

  it('carries recommendation and applied SEPARATELY on the governed route', async () => {
    const { result } = await run(
      {
        chunks: RESPONSES_OK,
        headers: {
          'x-govai-capability-level': 'policy_governed',
          'x-govai-effective-risk-class': 'C',
          'x-govai-enforcement-decision': 'ask',
          'x-govai-enforcement-applied': 'forwarded',
        },
      },
      { mode: 'governed' },
    );
    expect(result.state).toBe('completed');
    expect(result.receipt.governance).toMatchObject({
      decision: 'ask',
      applied: 'forwarded',
      effectiveRiskClass: 'C',
    });
  });
});

describe('every adapter drives the same runner', () => {
  it('completes an Anthropic stream', async () => {
    const { result } = await run(
      {
        chunks: [
          'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Oi"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ],
        headers: { 'request-id': 'req_anthropic' },
      },
      { adapter: anthropicMessagesAdapter },
    );
    expect(result.state).toBe('completed');
    expect(result.text).toBe('Oi');
    expect(result.receipt.providerRequestId).toBe('req_anthropic');
    expect(result.receipt.endpoint).toBe('/passthrough/anthropic/v1/messages');
  });

  it('completes a Chat Completions stream', async () => {
    const { result } = await run(
      {
        chunks: [
          'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
          'data: [DONE]\n\n',
        ],
      },
      { adapter: openaiChatCompletionsAdapter },
    );
    expect(result.state).toBe('completed');
    expect(result.text).toBe('Hi');
    expect(result.receipt.endpoint).toBe('/passthrough/openai/v1/chat/completions');
  });

  it('routes to the governed prefix when the mode is governed', async () => {
    const { result } = await run(
      { chunks: RESPONSES_OK },
      { adapter: anthropicMessagesAdapter, mode: 'governed' },
    );
    expect(result.receipt.endpoint).toBe('/governed/anthropic/v1/messages');
  });
});

describe('the receipt reports only what the browser handled', () => {
  it('labels the duration as client-observed and never invents a backend latency', async () => {
    const { result } = await run({ chunks: RESPONSES_OK });
    const keys = Object.keys(result.receipt);
    expect(keys).toContain('clientDurationMs');
    // No field exists that could be read as provider or backend latency, or as an audit id.
    for (const forbidden of ['latencyMs', 'providerLatencyMs', 'auditEventId', 'evidenceId', 'captureId']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('records the model the console SENT, not one echoed back', async () => {
    const spy = vi.fn();
    const { result } = await run({ chunks: RESPONSES_OK }, { onText: spy });
    expect(result.receipt.model).toBe('a-model');
  });
});
