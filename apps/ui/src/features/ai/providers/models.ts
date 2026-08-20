// Model discovery — through the providers' OWN models endpoints, via GovAI.
//
//   GET /passthrough/openai/v1/models      (capability `openai.models`)
//   GET /passthrough/anthropic/v1/models   (capability `anthropic.models`)
//
// ★ THIS IS DISCOVERY, NOT A REGISTRY. GovAI does not curate a model catalogue here and this
// console does not ship a hardcoded list of production model ids. The provider is the
// authority on what exists; the reader may also type an id the listing does not contain,
// because a provider can serve a model it does not enumerate (private previews, fine-tunes,
// regional availability). The typed id is sent VERBATIM — never rewritten, never "corrected",
// never silently swapped for a nearest match.
//
// ★ LISTED ≠ USABLE ON THIS SURFACE. Presence in a provider's model list does not mean the
// model accepts the endpoint the reader selected: an embedding model appears in
// `GET /v1/models` and will refuse `/v1/responses`. The UI says so in one line, and when the
// provider refuses, the provider's own error is what the reader sees. Inventing a
// compatibility matrix here would mean maintaining a second, always-stale copy of the
// provider's routing rules and turning a precise provider error into a GovAI guess.
//
// These are PROVIDER contracts, not GovAI contracts, so the mirrors live with the feature
// rather than in lib/contract (which mirrors GovAI routes) — and stay out of the initial
// bundle with the rest of the console.

import { z } from 'zod';
import type { ProviderId } from './types.js';

/** OpenAI: `{ object: 'list', data: [{ id, object, created, owned_by }] }`. */
export const OpenAIModelList = z.looseObject({
  data: z.array(z.looseObject({ id: z.string() })),
});

/** Anthropic: `{ data: [{ type:'model', id, display_name, created_at }], has_more, … }`. */
export const AnthropicModelList = z.looseObject({
  data: z.array(z.looseObject({ id: z.string(), display_name: z.string().optional() })),
});

/** What the picker renders. `label` is the provider's own display name when it published one. */
export type ProviderModel = {
  id: string;
  label: string;
};

export type ModelListResponse = z.infer<typeof OpenAIModelList> | z.infer<typeof AnthropicModelList>;

/** The provider-native discovery path for a provider, under the audited native route. Model
 *  discovery always uses the native route: it is a read, and the governed route registers no
 *  models endpoint at all (see packages/provider-{openai,anthropic}/src/governed/register-governed.ts). */
export function modelsPath(provider: ProviderId): string {
  return `/passthrough/${provider}/v1/models`;
}

export function modelListSchema(provider: ProviderId): z.ZodType<ModelListResponse> {
  return provider === 'openai' ? OpenAIModelList : AnthropicModelList;
}

/**
 * Normalize a provider list into the picker's shape, sorted by id so the order is stable and
 * does not depend on a provider's pagination order changing under the reader.
 */
export function toProviderModels(response: ModelListResponse): ProviderModel[] {
  const seen = new Set<string>();
  const out: ProviderModel[] = [];
  for (const entry of response.data) {
    const id = entry.id.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    const displayName = (entry as { display_name?: unknown }).display_name;
    out.push({
      id,
      label: typeof displayName === 'string' && displayName.length > 0 ? displayName : id,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** Case-insensitive substring match over id and label. Returns everything for an empty query. */
export function filterModels(models: readonly ProviderModel[], query: string): ProviderModel[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...models];
  return models.filter(
    (m) => m.id.toLowerCase().includes(needle) || m.label.toLowerCase().includes(needle),
  );
}
