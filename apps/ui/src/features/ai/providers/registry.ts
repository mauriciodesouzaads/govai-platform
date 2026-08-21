// The adapter table. One entry per (provider, surface) pair the console supports, and no way
// to reach a provider surface that is not in it.

import { openaiResponsesAdapter } from './openai-responses.js';
import { openaiChatCompletionsAdapter } from './openai-chat-completions.js';
import { anthropicMessagesAdapter } from './anthropic-messages.js';
import { SURFACES_BY_PROVIDER, type ProviderAdapter, type ProviderId, type SurfaceId } from './types.js';

const ADAPTERS: readonly ProviderAdapter[] = [
  openaiResponsesAdapter,
  openaiChatCompletionsAdapter,
  anthropicMessagesAdapter,
];

/** Resolve the adapter for a pair, or null when the pair is not supported. */
export function findAdapter(provider: ProviderId, surface: SurfaceId): ProviderAdapter | null {
  return ADAPTERS.find((a) => a.provider === provider && a.surface === surface) ?? null;
}

/** The default surface for a provider — the first entry in its display order. */
export function defaultSurface(provider: ProviderId): SurfaceId {
  const surfaces = SURFACES_BY_PROVIDER[provider];
  const first = surfaces[0];
  /* c8 ignore next -- SURFACES_BY_PROVIDER is a non-empty literal for both providers */
  if (first === undefined) throw new Error(`no surface registered for ${provider}`);
  return first;
}

/** Every supported pair, for the tests that walk the whole matrix. */
export function allAdapters(): readonly ProviderAdapter[] {
  return ADAPTERS;
}
