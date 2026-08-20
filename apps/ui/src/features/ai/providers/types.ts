// The provider-native surface matrix the AI Console drives, and the shape every adapter fills.
//
// ★ THERE IS NO GOVAI CHAT SCHEMA. The console does not normalize the three provider protocols
// into an invented GovAI message format and translate back. Each adapter builds the PROVIDER's
// own request body and reads the PROVIDER's own stream events; the only thing shared across
// them is this interface and the transcript of plain user/assistant text the reader typed and
// read. Anything that would require inventing a GovAI wire format belongs in a different
// product decision, not in a console.
//
// Routes are the ones the backend actually registers, verified at source at this base:
//   Native/Audited  /passthrough/openai/v1/responses            POST (stream + non-stream)
//                   /passthrough/openai/v1/chat/completions     POST
//                   /passthrough/anthropic/v1/messages          POST
//   Governed        /governed/openai/v1/responses               POST
//                   /governed/openai/v1/chat/completions        POST
//                   /governed/anthropic/v1/messages             POST
// (packages/provider-{openai,anthropic}/src/capabilities/index.ts for the registered path templates;
//  packages/provider-{openai,anthropic}/src/governed/register-governed.ts for the governed route table.)

import type { SafeProviderError } from './errors.js';

export type ProviderId = 'openai' | 'anthropic';

/** The provider-native API surface, named as the provider names it. */
export type SurfaceId = 'responses' | 'chat_completions' | 'messages';

/** The GovAI route family. `native_audited` is the passthrough_audited surface. */
export type ConsoleMode = 'native_audited' | 'governed';

export const PROVIDERS: readonly ProviderId[] = ['openai', 'anthropic'] as const;
export const MODES: readonly ConsoleMode[] = ['native_audited', 'governed'] as const;

/** The surfaces each provider exposes in this console, in display order. The first is the
 *  default: OpenAI leads with Responses, and Chat Completions is kept as a compatibility
 *  surface — NOT described as deprecated, because the provider does not describe it that way. */
export const SURFACES_BY_PROVIDER: Record<ProviderId, readonly SurfaceId[]> = {
  openai: ['responses', 'chat_completions'],
  anthropic: ['messages'],
};

/** One committed conversational exchange. Plain text only: this console sends no tools, no
 *  files, no images and no system prompt (all named non-goals of this delivery). */
export type ContextMessage = {
  role: 'user' | 'assistant';
  text: string;
};

export type BuildBodyInput = {
  model: string;
  /** Committed history — see the context-commit rule in ../conversation/reducer.ts. */
  history: readonly ContextMessage[];
  /** The message being sent now. */
  prompt: string;
  /** Anthropic requires it; the OpenAI surfaces do not send it. */
  maxTokens: number;
};

/**
 * What a stream accumulator knows once a frame has been folded in.
 *
 * `terminal` is the ONLY thing that may be read as "the provider finished". Text alone never
 * is: a stream can carry deltas and then fail, and a turn that shows words but never saw a
 * terminal marker is an unconfirmed outcome, not a success.
 */
export type StreamTerminal =
  | { kind: 'completed'; stopReason: string | null }
  | { kind: 'error'; error: SafeProviderError };

export type AccumulatorSnapshot = {
  /** The assistant's visible answer, as far as it has streamed. */
  text: string;
  /** A model refusal the provider surfaced as its own field. Rendered as a refusal, never
   *  merged into the answer text. */
  refusal: string | null;
  terminal: StreamTerminal | null;
  /**
   * True when the stream carried output this console cannot render (a tool call, an image, a
   * second choice, an unknown content block). The UI states that plainly instead of inventing
   * text for it.
   */
  unsupportedOutput: boolean;
  /** The provider's own id for the message/response, when the stream announced one. */
  providerMessageId: string | null;
};

export type StreamAccumulator = {
  /** Fold one frame in. Must never throw: an unreadable frame is data, not a crash. */
  accept: (frame: import('../streaming/sse.js').SseFrame) => void;
  snapshot: () => AccumulatorSnapshot;
};

export type ProviderAdapter = {
  provider: ProviderId;
  surface: SurfaceId;
  /** The provider-native path, WITHOUT the GovAI route prefix (e.g. `/v1/responses`). */
  nativePath: string;
  /** Build the provider-native streaming request body. */
  buildBody: (input: BuildBodyInput) => Record<string, unknown>;
  /** A fresh accumulator for one attempt. */
  createAccumulator: () => StreamAccumulator;
  /**
   * Response-header precedence for this provider's request identifier, most authoritative
   * first. Provider-specific by construction — applying one provider's list to the other is
   * how a compatibility fallback silently masks the real header.
   */
  requestIdHeaders: readonly string[];
};

/** The GovAI route prefix for a (mode, provider) pair. */
export function routePrefix(mode: ConsoleMode, provider: ProviderId): string {
  return mode === 'governed' ? `/governed/${provider}` : `/passthrough/${provider}`;
}

/** The full same-origin path a turn POSTs to. */
export function turnPath(mode: ConsoleMode, adapter: ProviderAdapter): string {
  return `${routePrefix(mode, adapter.provider)}${adapter.nativePath}`;
}
