// OpenAI Responses — the console's default OpenAI surface.
//
// Request shape (provider-native, verified against the current OpenAI API reference):
//   POST /v1/responses  { model, input: [{role, content}…], stream: true, store: false }
//
// ★ STATELESS BY CONSTRUCTION. `store` defaults to true on this API — the provider keeps the
// response object for 30 days and `previous_response_id` chains turns server-side. This
// console sends `store: false` and carries the whole conversation in `input` itself, which is
// the provider's own documented manual-conversation-state pattern. Two consequences, both
// deliberate:
//
//   • GovAI never depends on the provider persisting a transcript, and the console never
//     acquires a provider-side conversation id it would then have to explain, expose or
//     garbage-collect. Nothing here says "nothing is retained anywhere" — provider-side
//     handling still follows the provider/account configuration, and the UI copy says so.
//
//   • NO REASONING STATE IS CARRIED. A stateless chain over a reasoning model can preserve
//     reasoning across turns only by requesting `include: ["reasoning.encrypted_content"]`
//     and passing those opaque items back. This console does NOT request them, does not hold
//     them and does not send them. The conversation is plain user/assistant text, so there is
//     no encrypted reasoning in memory to leak, render, export or persist — the strongest
//     available form of "chain-of-thought is never exposed" is simply never to receive it.
//     Multi-turn still works: the model sees the full text history, which is what a stateless
//     client sends. Reasoning continuity across turns is a named non-goal of this delivery.
//
// Stream events consumed (the discriminator is the payload's `type`; see ../streaming/sse.ts):
//   response.output_text.delta   → visible answer text
//   response.refusal.delta       → a refusal, rendered as a refusal
//   response.completed           → terminal, success
//   response.incomplete          → terminal, success-but-truncated (carries its reason)
//   response.failed / error      → terminal, provider error
//   response.output_item.added   → non-text items are flagged, never invented as text
//   response.reasoning*          → IGNORED, never accumulated

import { parseFrameJson, frameType, type SseFrame } from '../streaming/sse.js';
import { extractProviderError } from './errors.js';
import type {
  AccumulatorSnapshot,
  BuildBodyInput,
  ProviderAdapter,
  StreamAccumulator,
} from './types.js';

/** Output item types this console can render. Anything else is flagged as unsupported rather
 *  than dropped silently — a tool call that produced no text must not look like an empty
 *  answer. `reasoning` is listed as KNOWN so it does not raise the unsupported flag; it is
 *  simply never rendered. */
const RENDERABLE_ITEM_TYPES = new Set(['message', 'reasoning']);

/** Event prefixes whose payloads are model reasoning. Matched by prefix so a future
 *  `response.reasoning_*` variant is ignored by default rather than rendered by accident. */
function isReasoningEvent(type: string): boolean {
  return type.startsWith('response.reasoning');
}

function createResponsesAccumulator(): StreamAccumulator {
  const state: AccumulatorSnapshot = {
    text: '',
    refusal: null,
    terminal: null,
    unsupportedOutput: false,
    providerMessageId: null,
  };

  const readDelta = (payload: Record<string, unknown>): string | null => {
    const delta = payload['delta'];
    return typeof delta === 'string' ? delta : null;
  };

  const readResponseId = (payload: Record<string, unknown>): string | null => {
    const response = payload['response'];
    if (typeof response !== 'object' || response === null) return null;
    const id = (response as Record<string, unknown>)['id'];
    return typeof id === 'string' && id.length > 0 ? id : null;
  };

  return {
    accept(frame: SseFrame) {
      // A terminal marker ends the turn: later frames cannot revise a decided outcome.
      if (state.terminal !== null) return;

      const payload = parseFrameJson(frame.data);
      const type = frameType(frame, payload);
      if (type === null) return; // unnamed frame — nothing to act on, nothing to invent

      if (isReasoningEvent(type)) return; // ★ hidden reasoning is never accumulated

      switch (type) {
        case 'response.created':
        case 'response.in_progress': {
          if (payload) state.providerMessageId ??= readResponseId(payload);
          return;
        }
        case 'response.output_text.delta': {
          const delta = payload ? readDelta(payload) : null;
          if (delta !== null) state.text += delta;
          return;
        }
        case 'response.refusal.delta': {
          const delta = payload ? readDelta(payload) : null;
          if (delta !== null) state.refusal = (state.refusal ?? '') + delta;
          return;
        }
        case 'response.output_item.added': {
          const item = payload?.['item'];
          const itemType =
            typeof item === 'object' && item !== null
              ? (item as Record<string, unknown>)['type']
              : undefined;
          if (typeof itemType === 'string' && !RENDERABLE_ITEM_TYPES.has(itemType)) {
            state.unsupportedOutput = true;
          }
          return;
        }
        case 'response.completed': {
          if (payload) state.providerMessageId ??= readResponseId(payload);
          state.terminal = { kind: 'completed', stopReason: null };
          return;
        }
        case 'response.incomplete': {
          if (payload) state.providerMessageId ??= readResponseId(payload);
          state.terminal = { kind: 'completed', stopReason: incompleteReason(payload) };
          return;
        }
        case 'response.failed':
        case 'error': {
          state.terminal = { kind: 'error', error: extractProviderError(payload, null) };
          return;
        }
        default:
          // Every other lifecycle event (item.done, content_part.*, output_text.done, …)
          // carries no text this console renders. Ignoring them cannot corrupt the answer.
          return;
      }
    },
    snapshot: () => ({ ...state }),
  };
}

/** `response.incomplete` names its reason under `response.incomplete_details.reason`. */
function incompleteReason(payload: Record<string, unknown> | null): string | null {
  const response = payload?.['response'];
  if (typeof response !== 'object' || response === null) return null;
  const details = (response as Record<string, unknown>)['incomplete_details'];
  if (typeof details !== 'object' || details === null) return null;
  const reason = (details as Record<string, unknown>)['reason'];
  return typeof reason === 'string' && reason.length > 0 ? reason : null;
}

/**
 * A USER turn, as a fully-qualified input message item.
 *
 * ★ WHY THE VERBOSE FORM. The API also accepts a shorthand — `{ role, content: "text" }` —
 * and that is what the provider's conversation-state guide shows. This console keeps the
 * fully-qualified typed item: it is the canonical provider form, it costs nothing, and it is
 * unambiguous about what each part of a turn is.
 *
 * It is NO LONGER a governance workaround. When this console was written,
 * `extractOpenAIResponsesText` (packages/provider-openai/src/governed/extract-text.ts)
 * descended only into `input[]` items carrying an explicit `type`, so an item identified by
 * `role` alone was never DLP-scanned and a governed Responses request built the shorthand way
 * was forwarded at base risk A with `enforcement_decision: observe`. That was reported as
 * `AI-CONSOLE-RESPONSES-DLP-GAP-01` rather than papered over here, and it was FIXED in the
 * extractor (EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02): all five accepted spellings — string
 * input, typed message with string or `input_text[]` content, and the role-shaped
 * `EasyInputMessage` in either content form — now extract identically, which
 * `register-governed.dlp-equivalence.test.ts` proves end to end.
 *
 * The typed form is therefore a preference, not a mitigation, and this console's governance
 * outcome no longer depends on which accepted spelling it picks. The shape stays
 * regression-tested all the same: changing a request body silently is exactly the kind of edit
 * that should have to face a test.
 */
function userItem(text: string): Record<string, unknown> {
  return { type: 'message', role: 'user', content: [{ type: 'input_text', text }] };
}

/**
 * An ASSISTANT turn from local history, in the shorthand form.
 *
 * Deliberately NOT the typed form: a typed assistant item must use `output_text` content parts
 * (an assistant message is not user input), and that adds a shape whose validity for a locally
 * reconstructed item this console cannot verify. The shorthand is documented and unambiguous.
 *
 * Since AI-CONSOLE-RESPONSES-DLP-GAP-01 was fixed, this shape is no longer a governance blind
 * spot: a role-shaped message with string content is DLP-scanned like any other, and so is an
 * `output_text` part, so replayed assistant history is covered whichever form a caller sends.
 */
function assistantItem(text: string): Record<string, unknown> {
  return { role: 'assistant', content: text };
}

export const openaiResponsesAdapter: ProviderAdapter = {
  provider: 'openai',
  surface: 'responses',
  nativePath: '/v1/responses',
  requestIdHeaders: ['openai-request-id', 'x-request-id'],
  buildBody: (input: BuildBodyInput) => ({
    model: input.model,
    input: [
      ...input.history.map((m) => (m.role === 'user' ? userItem(m.text) : assistantItem(m.text))),
      userItem(input.prompt),
    ],
    stream: true,
    // See the header: no provider-side response object, no reasoning items requested.
    store: false,
  }),
  createAccumulator: createResponsesAccumulator,
};
