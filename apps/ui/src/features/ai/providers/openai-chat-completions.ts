// OpenAI Chat Completions — the compatibility surface.
//
// Request shape (provider-native):
//   POST /v1/chat/completions  { model, messages: [{role, content}…], stream: true }
//
// Kept because it is a registered GovAI capability and a great many integrations speak it. It
// is NOT described anywhere in this interface as deprecated: the provider does not describe it
// that way, and a UI that retires a surface the provider still supports is inventing product
// policy out of a style preference.
//
// Stream shape: `data:`-only frames with no `event:` line, terminated by the literal
// `data: [DONE]` sentinel. Each frame is a `chat.completion.chunk`:
//   { id, object, choices: [{ index, delta: { role?, content?, refusal? }, finish_reason }] }
//
// ★ ONLY `choices[0]` IS RENDERED, and a chunk for any other index raises the unsupported-output
// flag rather than being interleaved into the answer. The console never sends `n`, so a second
// choice cannot arise from anything this client asked for — and silently concatenating two
// alternative completions into one paragraph would produce text no model ever generated. The
// honest response to output we did not ask for is to say we cannot render it.

import { parseFrameJson, type SseFrame } from '../streaming/sse.js';
import { extractProviderError } from './errors.js';
import type {
  AccumulatorSnapshot,
  BuildBodyInput,
  ProviderAdapter,
  StreamAccumulator,
} from './types.js';

/** The literal sentinel that ends an OpenAI Chat Completions stream. */
export const CHAT_DONE_SENTINEL = '[DONE]';

function createChatCompletionsAccumulator(): StreamAccumulator {
  const state: AccumulatorSnapshot = {
    text: '',
    refusal: null,
    terminal: null,
    unsupportedOutput: false,
    providerMessageId: null,
  };
  let finishReason: string | null = null;

  return {
    accept(frame: SseFrame) {
      if (state.terminal !== null) return;

      if (frame.data.trim() === CHAT_DONE_SENTINEL) {
        state.terminal = { kind: 'completed', stopReason: finishReason };
        return;
      }

      const payload = parseFrameJson(frame.data);
      if (payload === null) return; // unreadable frame: not text, not a terminal, not a crash

      // An error object inside the stream is a provider failure mid-flight.
      if (payload['error'] !== undefined) {
        state.terminal = { kind: 'error', error: extractProviderError(payload, null) };
        return;
      }

      const id = payload['id'];
      if (typeof id === 'string' && id.length > 0) state.providerMessageId ??= id;

      const choices = payload['choices'];
      if (!Array.isArray(choices)) return;

      for (const raw of choices) {
        if (typeof raw !== 'object' || raw === null) continue;
        const choice = raw as Record<string, unknown>;
        const index = choice['index'];
        if (typeof index === 'number' && index !== 0) {
          // ★ See the header: an alternate completion is flagged, never merged.
          state.unsupportedOutput = true;
          continue;
        }

        const finish = choice['finish_reason'];
        if (typeof finish === 'string' && finish.length > 0) finishReason = finish;

        const delta = choice['delta'];
        if (typeof delta !== 'object' || delta === null) continue;
        const d = delta as Record<string, unknown>;

        const content = d['content'];
        if (typeof content === 'string') state.text += content;

        const refusal = d['refusal'];
        if (typeof refusal === 'string') state.refusal = (state.refusal ?? '') + refusal;
      }
    },
    snapshot: () => ({ ...state }),
  };
}

export const openaiChatCompletionsAdapter: ProviderAdapter = {
  provider: 'openai',
  surface: 'chat_completions',
  nativePath: '/v1/chat/completions',
  requestIdHeaders: ['openai-request-id', 'x-request-id'],
  buildBody: (input: BuildBodyInput) => ({
    model: input.model,
    messages: [
      ...input.history.map((m) => ({ role: m.role, content: m.text })),
      { role: 'user', content: input.prompt },
    ],
    stream: true,
  }),
  createAccumulator: createChatCompletionsAccumulator,
};
