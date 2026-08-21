// Anthropic Messages.
//
// Request shape (provider-native):
//   POST /v1/messages  { model, messages: [{role, content}…], max_tokens, stream: true }
//
// `max_tokens` is a REQUIRED body parameter on this API — unlike the two OpenAI surfaces,
// which have no equivalent requirement. The console supplies a conservative default and
// exposes it only behind an Advanced disclosure: a first-run experience that opens by asking
// the reader to pick a token ceiling is asking them to answer a question they have no basis
// to answer yet.
//
// ★ `anthropic-version` IS NOT SENT BY THE BROWSER. Both GovAI direct routes add
// `anthropic-version: 2023-06-01` when the inbound request does not carry one
// (packages/provider-anthropic/src/routes/register-passthrough.ts and
//  .../governed/handle-messages.ts, `buildOutboundHeaders`). Pinning a second copy of the
// provider protocol version in browser code would create two sources of truth for one
// provider contract, and the one in the browser is the one nobody would remember to update.
//
// Stream events (each frame carries BOTH an `event:` name and a matching `"type"`):
//   message_start        → the message id and model
//   content_block_start  → opens a block at an index; the block TYPE decides what follows
//   content_block_delta  → text_delta (rendered) | thinking_delta / signature_delta (IGNORED)
//                          | input_json_delta (flagged as unsupported)
//   content_block_stop / ping                → ignored
//   message_delta        → stop_reason
//   message_stop         → terminal, success
//   error                → terminal, provider error ({type:'error', error:{type, message}})
//
// ★ THINKING IS NEVER RENDERED. `thinking_delta` and `signature_delta` are dropped on the
// floor — not stored, not accumulated, not shown behind a disclosure. This console does not
// enable extended thinking, so they should not arrive at all; dropping them explicitly means
// that if one ever does, it cannot become visible text.

import { parseFrameJson, frameType, type SseFrame } from '../streaming/sse.js';
import { extractProviderError } from './errors.js';
import type {
  AccumulatorSnapshot,
  BuildBodyInput,
  ProviderAdapter,
  StreamAccumulator,
} from './types.js';

/** A conservative default ceiling: long enough for a substantial answer, small enough that a
 *  mistyped prompt cannot become an expensive one. Adjustable behind Advanced. */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 2048;
export const ANTHROPIC_MIN_MAX_TOKENS = 1;
export const ANTHROPIC_MAX_MAX_TOKENS = 64_000;

/** Content-block types the console renders. `thinking` is KNOWN (so it does not raise the
 *  unsupported flag) but deliberately never rendered. */
const TEXT_BLOCK = 'text';
const SILENT_BLOCK_TYPES = new Set(['thinking', 'redacted_thinking']);

function createMessagesAccumulator(): StreamAccumulator {
  const state: AccumulatorSnapshot = {
    text: '',
    refusal: null,
    terminal: null,
    unsupportedOutput: false,
    providerMessageId: null,
  };
  /** Block type by index, so a delta is only rendered when its block is a text block. */
  const blockTypes = new Map<number, string>();
  let stopReason: string | null = null;

  const indexOf = (payload: Record<string, unknown>): number | null => {
    const index = payload['index'];
    return typeof index === 'number' ? index : null;
  };

  return {
    accept(frame: SseFrame) {
      if (state.terminal !== null) return;

      const payload = parseFrameJson(frame.data);
      const type = frameType(frame, payload);
      if (type === null) return;

      switch (type) {
        case 'message_start': {
          const message = payload?.['message'];
          if (typeof message === 'object' && message !== null) {
            const id = (message as Record<string, unknown>)['id'];
            if (typeof id === 'string' && id.length > 0) state.providerMessageId ??= id;
          }
          return;
        }
        case 'content_block_start': {
          if (!payload) return;
          const index = indexOf(payload);
          const block = payload['content_block'];
          const blockType =
            typeof block === 'object' && block !== null
              ? (block as Record<string, unknown>)['type']
              : undefined;
          if (typeof blockType !== 'string') return;
          if (index !== null) blockTypes.set(index, blockType);
          if (blockType !== TEXT_BLOCK && !SILENT_BLOCK_TYPES.has(blockType)) {
            // A tool_use / server_tool_use / image block: real output this console does not
            // render. Say so rather than showing an empty answer.
            state.unsupportedOutput = true;
          }
          // A text block may open with a non-empty `text` seed.
          if (blockType === TEXT_BLOCK) {
            const seed = (block as Record<string, unknown>)['text'];
            if (typeof seed === 'string') state.text += seed;
          }
          return;
        }
        case 'content_block_delta': {
          if (!payload) return;
          const delta = payload['delta'];
          if (typeof delta !== 'object' || delta === null) return;
          const d = delta as Record<string, unknown>;
          const deltaType = d['type'];

          // ★ Hidden reasoning: dropped, unconditionally, before anything else can read it.
          if (deltaType === 'thinking_delta' || deltaType === 'signature_delta') return;

          if (deltaType === 'text_delta') {
            const index = indexOf(payload);
            // Only render a text delta whose block was announced as a text block. A delta for
            // an unannounced or non-text block is output we cannot attribute.
            if (index !== null && blockTypes.get(index) !== TEXT_BLOCK) {
              state.unsupportedOutput = true;
              return;
            }
            const text = d['text'];
            if (typeof text === 'string') state.text += text;
            return;
          }

          // input_json_delta and any future delta type: real output, not renderable here.
          state.unsupportedOutput = true;
          return;
        }
        case 'message_delta': {
          const delta = payload?.['delta'];
          if (typeof delta === 'object' && delta !== null) {
            const reason = (delta as Record<string, unknown>)['stop_reason'];
            if (typeof reason === 'string' && reason.length > 0) stopReason = reason;
          }
          return;
        }
        case 'message_stop': {
          state.terminal = { kind: 'completed', stopReason };
          return;
        }
        case 'error': {
          state.terminal = { kind: 'error', error: extractProviderError(payload, null) };
          return;
        }
        case 'ping':
        case 'content_block_stop':
        default:
          return;
      }
    },
    snapshot: () => ({ ...state }),
  };
}

export const anthropicMessagesAdapter: ProviderAdapter = {
  provider: 'anthropic',
  surface: 'messages',
  nativePath: '/v1/messages',
  // The REAL Anthropic identifier header is `request-id`; the other two are compatibility
  // fallbacks only and must never mask it (packages/provider-anthropic/src/passthrough/request-id.ts).
  requestIdHeaders: ['request-id', 'anthropic-request-id', 'x-request-id'],
  buildBody: (input: BuildBodyInput) => ({
    model: input.model,
    messages: [
      ...input.history.map((m) => ({ role: m.role, content: m.text })),
      { role: 'user', content: input.prompt },
    ],
    max_tokens: input.maxTokens,
    stream: true,
  }),
  createAccumulator: createMessagesAccumulator,
};
