import { describe, expect, it } from 'vitest';
import {
  AnthropicModelList,
  filterModels,
  modelListSchema,
  modelsPath,
  OpenAIModelList,
  toProviderModels,
} from './models.js';
import { allAdapters, defaultSurface, findAdapter } from './registry.js';
import { routePrefix, turnPath, SURFACES_BY_PROVIDER } from './types.js';

describe('discovery goes to the provider’s own models endpoint', () => {
  it('uses the audited native route for both providers', () => {
    expect(modelsPath('openai')).toBe('/passthrough/openai/v1/models');
    expect(modelsPath('anthropic')).toBe('/passthrough/anthropic/v1/models');
  });

  it('binds each provider to its own response schema', () => {
    expect(modelListSchema('openai')).toBe(OpenAIModelList);
    expect(modelListSchema('anthropic')).toBe(AnthropicModelList);
  });
});

describe('normalizing a provider listing', () => {
  it('reads the OpenAI shape', () => {
    const parsed = OpenAIModelList.parse({
      object: 'list',
      data: [
        { id: 'gpt-b', object: 'model', created: 1, owned_by: 'openai' },
        { id: 'gpt-a', object: 'model', created: 2, owned_by: 'openai' },
      ],
    });
    expect(toProviderModels(parsed)).toEqual([
      { id: 'gpt-a', label: 'gpt-a' },
      { id: 'gpt-b', label: 'gpt-b' },
    ]);
  });

  it('reads the Anthropic shape and keeps the provider’s display name', () => {
    const parsed = AnthropicModelList.parse({
      data: [
        { type: 'model', id: 'claude-z', display_name: 'Claude Z', created_at: '2026-01-01T00:00:00Z' },
      ],
      has_more: false,
      first_id: null,
      last_id: null,
    });
    expect(toProviderModels(parsed)).toEqual([{ id: 'claude-z', label: 'Claude Z' }]);
  });

  it('accepts an empty listing without inventing entries', () => {
    expect(toProviderModels(OpenAIModelList.parse({ data: [] }))).toEqual([]);
  });

  it('carries additive provider fields through instead of failing on them', () => {
    // A provider is entitled to add fields; a strict schema would take the picker down.
    expect(() =>
      OpenAIModelList.parse({ data: [{ id: 'm', brand_new_field: true }], future: 'x' }),
    ).not.toThrow();
  });

  it('rejects a listing whose entries have no id, rather than rendering blanks', () => {
    expect(OpenAIModelList.safeParse({ data: [{ object: 'model' }] }).success).toBe(false);
  });

  it('de-duplicates and skips blank ids', () => {
    const parsed = OpenAIModelList.parse({ data: [{ id: 'a' }, { id: 'a' }, { id: '  ' }] });
    expect(toProviderModels(parsed)).toEqual([{ id: 'a', label: 'a' }]);
  });

  it('sorts by id, so the order does not shift with the provider’s pagination', () => {
    const parsed = OpenAIModelList.parse({ data: [{ id: 'c' }, { id: 'a' }, { id: 'b' }] });
    expect(toProviderModels(parsed).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('filtering suggestions', () => {
  const models = [
    { id: 'model-alpha', label: 'Alpha' },
    { id: 'model-beta', label: 'Beta' },
  ];

  it('returns everything for an empty query', () => {
    expect(filterModels(models, '   ')).toHaveLength(2);
  });

  it('matches id and label, case-insensitively', () => {
    expect(filterModels(models, 'ALPHA').map((m) => m.id)).toEqual(['model-alpha']);
    expect(filterModels(models, 'bet').map((m) => m.id)).toEqual(['model-beta']);
  });

  it('returns nothing rather than a nearest match', () => {
    // ★ No fuzzy matching anywhere: a typed id is sent verbatim, and the picker never
    // proposes a substitute the reader did not ask for.
    expect(filterModels(models, 'gamma')).toEqual([]);
  });
});

describe('the adapter registry covers exactly the promised matrix', () => {
  it('registers three (provider, surface) pairs', () => {
    expect(allAdapters().map((a) => `${a.provider}.${a.surface}`).sort()).toEqual([
      'anthropic.messages',
      'openai.chat_completions',
      'openai.responses',
    ]);
  });

  it('resolves each supported pair and refuses an unsupported one', () => {
    for (const provider of ['openai', 'anthropic'] as const) {
      for (const surface of SURFACES_BY_PROVIDER[provider]) {
        expect(findAdapter(provider, surface)).not.toBeNull();
      }
    }
    expect(findAdapter('anthropic', 'responses')).toBeNull();
    expect(findAdapter('openai', 'messages')).toBeNull();
  });

  it('defaults OpenAI to Responses and Anthropic to Messages', () => {
    expect(defaultSurface('openai')).toBe('responses');
    expect(defaultSurface('anthropic')).toBe('messages');
  });
});

describe('the six route/surface combinations resolve to the registered GovAI paths', () => {
  it('maps every mode × adapter to the path the backend actually registers', () => {
    const paths = allAdapters().flatMap((adapter) =>
      (['native_audited', 'governed'] as const).map((mode) => turnPath(mode, adapter)),
    );
    expect(paths.sort()).toEqual([
      '/governed/anthropic/v1/messages',
      '/governed/openai/v1/chat/completions',
      '/governed/openai/v1/responses',
      '/passthrough/anthropic/v1/messages',
      '/passthrough/openai/v1/chat/completions',
      '/passthrough/openai/v1/responses',
    ]);
  });

  it('uses /passthrough for native and /governed for governed', () => {
    expect(routePrefix('native_audited', 'openai')).toBe('/passthrough/openai');
    expect(routePrefix('governed', 'anthropic')).toBe('/governed/anthropic');
  });

  it('never routes a conversation anywhere but a same-origin GovAI path', () => {
    for (const adapter of allAdapters()) {
      for (const mode of ['native_audited', 'governed'] as const) {
        const path = turnPath(mode, adapter);
        expect(path.startsWith('/')).toBe(true);
        expect(path).not.toMatch(/^https?:/);
        expect(path).not.toContain('api.openai.com');
        expect(path).not.toContain('api.anthropic.com');
      }
    }
  });
});
