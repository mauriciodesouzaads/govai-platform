import { describe, it, expect } from 'vitest';
import {
  OPENAI_CAPABILITIES,
  OPENAI_RESPONSES_CREATE,
  OPENAI_RESPONSES_STREAM,
  OPENAI_CHAT_COMPLETIONS_CREATE,
  OPENAI_CHAT_COMPLETIONS_STREAM,
  OPENAI_MODELS,
  OPENAI_MODELS_DELETE,
  OPENAI_EMBEDDINGS,
  OPENAI_FILES,
  OPENAI_VECTOR_STORES,
  OPENAI_VECTOR_STORES_DELETE,
  OPENAI_VECTOR_STORES_FILES_DELETE,
  OPENAI_WEB_SEARCH_TOOL,
  OPENAI_FILE_SEARCH_TOOL,
  resolveOpenAICapabilityForRequest,
  matchOpenAIPath,
} from './index.js';

describe('OPENAI_CAPABILITIES registry', () => {
  it('exports a frozen, deduplicated list of 13 capabilities', () => {
    expect(OPENAI_CAPABILITIES).toHaveLength(13);
    expect(Object.isFrozen(OPENAI_CAPABILITIES)).toBe(true);
    const ids = OPENAI_CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes every named export by id', () => {
    const ids = new Set(OPENAI_CAPABILITIES.map((c) => c.id));
    for (const cap of [
      OPENAI_RESPONSES_CREATE,
      OPENAI_RESPONSES_STREAM,
      OPENAI_CHAT_COMPLETIONS_CREATE,
      OPENAI_CHAT_COMPLETIONS_STREAM,
      OPENAI_MODELS,
      OPENAI_MODELS_DELETE,
      OPENAI_EMBEDDINGS,
      OPENAI_FILES,
      OPENAI_VECTOR_STORES,
      OPENAI_VECTOR_STORES_DELETE,
      OPENAI_VECTOR_STORES_FILES_DELETE,
      OPENAI_WEB_SEARCH_TOOL,
      OPENAI_FILE_SEARCH_TOOL,
    ]) {
      expect(ids.has(cap.id)).toBe(true);
    }
  });
});

describe('resolveOpenAICapabilityForRequest', () => {
  it('POST /v1/responses non-stream → openai.responses.create / policy_governed', () => {
    expect(
      resolveOpenAICapabilityForRequest({
        method: 'POST',
        pathTemplate: '/v1/responses',
        isStream: false,
      }),
    ).toEqual({ capability_id: 'openai.responses.create', canonical_level: 'policy_governed' });
  });

  it('POST /v1/responses stream:true → openai.responses.stream', () => {
    expect(
      resolveOpenAICapabilityForRequest({
        method: 'POST',
        pathTemplate: '/v1/responses',
        isStream: true,
      }),
    ).toEqual({ capability_id: 'openai.responses.stream', canonical_level: 'policy_governed' });
  });

  it('POST /v1/chat/completions non-stream → openai.chat.completions.create', () => {
    expect(
      resolveOpenAICapabilityForRequest({
        method: 'POST',
        pathTemplate: '/v1/chat/completions',
        isStream: false,
      }),
    ).toEqual({
      capability_id: 'openai.chat.completions.create',
      canonical_level: 'policy_governed',
    });
  });

  it('POST /v1/chat/completions stream:true → openai.chat.completions.stream', () => {
    expect(
      resolveOpenAICapabilityForRequest({
        method: 'POST',
        pathTemplate: '/v1/chat/completions',
        isStream: true,
      }),
    ).toEqual({
      capability_id: 'openai.chat.completions.stream',
      canonical_level: 'policy_governed',
    });
  });

  it('POST /v1/embeddings → openai.embeddings / passthrough_audited', () => {
    expect(
      resolveOpenAICapabilityForRequest({
        method: 'POST',
        pathTemplate: '/v1/embeddings',
        isStream: false,
      }),
    ).toEqual({ capability_id: 'openai.embeddings', canonical_level: 'passthrough_audited' });
  });

  it('GET /v1/models and GET /v1/models/{model_id} → openai.models', () => {
    for (const p of ['/v1/models', '/v1/models/{model_id}']) {
      const r = resolveOpenAICapabilityForRequest({
        method: 'GET',
        pathTemplate: p,
        isStream: false,
      });
      expect(r.capability_id).toBe('openai.models');
      expect(r.canonical_level).toBe('passthrough_audited');
    }
  });

  it('DELETE /v1/models/{model_id} → openai.models.delete (distinct from GET)', () => {
    expect(
      resolveOpenAICapabilityForRequest({
        method: 'DELETE',
        pathTemplate: '/v1/models/{model_id}',
        isStream: false,
      }).capability_id,
    ).toBe('openai.models.delete');
  });

  it('all /v1/files paths map to openai.files', () => {
    for (const p of ['/v1/files', '/v1/files/{file_id}', '/v1/files/{file_id}/content']) {
      expect(
        resolveOpenAICapabilityForRequest({
          method: 'GET',
          pathTemplate: p,
          isStream: false,
        }).capability_id,
      ).toBe('openai.files');
    }
  });

  it('DELETE /v1/vector_stores/{id} → openai.vector_stores.delete', () => {
    expect(
      resolveOpenAICapabilityForRequest({
        method: 'DELETE',
        pathTemplate: '/v1/vector_stores/{vector_store_id}',
        isStream: false,
      }).capability_id,
    ).toBe('openai.vector_stores.delete');
  });

  it('DELETE /v1/vector_stores/{id}/files/{file_id} → openai.vector_stores.files.delete', () => {
    expect(
      resolveOpenAICapabilityForRequest({
        method: 'DELETE',
        pathTemplate: '/v1/vector_stores/{vector_store_id}/files/{file_id}',
        isStream: false,
      }).capability_id,
    ).toBe('openai.vector_stores.files.delete');
  });

  it('non-DELETE /v1/vector_stores paths → openai.vector_stores', () => {
    for (const p of [
      '/v1/vector_stores',
      '/v1/vector_stores/{vector_store_id}',
      '/v1/vector_stores/{vector_store_id}/files',
    ]) {
      expect(
        resolveOpenAICapabilityForRequest({
          method: 'GET',
          pathTemplate: p,
          isStream: false,
        }).capability_id,
      ).toBe('openai.vector_stores');
    }
  });

  it('unknown path resolves to capability_id="unknown" + passthrough_audited', () => {
    const r = resolveOpenAICapabilityForRequest({
      method: 'POST',
      pathTemplate: '/v1/unknown-thing',
      isStream: false,
    });
    expect(r.capability_id).toBe('unknown');
    expect(r.canonical_level).toBe('passthrough_audited');
  });

  it('lowercase method is normalised by uppercase comparison', () => {
    expect(
      resolveOpenAICapabilityForRequest({
        method: 'post',
        pathTemplate: '/v1/responses',
        isStream: false,
      }).capability_id,
    ).toBe('openai.responses.create');
  });
});

describe('matchOpenAIPath', () => {
  it('returns null for a path that is not a registered OpenAI endpoint', () => {
    expect(matchOpenAIPath('/v2/random')).toBeNull();
  });

  it('strips the /passthrough/openai prefix and trailing slashes', () => {
    expect(matchOpenAIPath('/passthrough/openai/v1/responses/')).toEqual({
      pathTemplate: '/v1/responses',
    });
  });

  it('drops query strings before matching', () => {
    expect(matchOpenAIPath('/v1/chat/completions?stream=true')).toEqual({
      pathTemplate: '/v1/chat/completions',
    });
  });

  it('returns null when the path is the bare prefix only', () => {
    expect(matchOpenAIPath('/passthrough/openai')).toBeNull();
  });

  it('matches /v1/embeddings', () => {
    expect(matchOpenAIPath('/v1/embeddings')).toEqual({ pathTemplate: '/v1/embeddings' });
  });

  it('matches /v1/models', () => {
    expect(matchOpenAIPath('/v1/models')).toEqual({ pathTemplate: '/v1/models' });
  });

  it('matches /v1/models/{model_id} by regex', () => {
    expect(matchOpenAIPath('/v1/models/gpt-5')).toEqual({
      pathTemplate: '/v1/models/{model_id}',
    });
  });

  it('matches /v1/files', () => {
    expect(matchOpenAIPath('/v1/files')).toEqual({ pathTemplate: '/v1/files' });
  });

  it('prefers files/{id}/content over files/{id} when both could match', () => {
    expect(matchOpenAIPath('/v1/files/file_abc/content')).toEqual({
      pathTemplate: '/v1/files/{file_id}/content',
    });
  });

  it('matches /v1/files/{file_id} for plain ids', () => {
    expect(matchOpenAIPath('/v1/files/file_abc')).toEqual({
      pathTemplate: '/v1/files/{file_id}',
    });
  });

  it('matches /v1/vector_stores and dynamic-id variants', () => {
    expect(matchOpenAIPath('/v1/vector_stores')).toEqual({
      pathTemplate: '/v1/vector_stores',
    });
    expect(matchOpenAIPath('/v1/vector_stores/vs-1')).toEqual({
      pathTemplate: '/v1/vector_stores/{vector_store_id}',
    });
    expect(matchOpenAIPath('/v1/vector_stores/vs-1/files')).toEqual({
      pathTemplate: '/v1/vector_stores/{vector_store_id}/files',
    });
    expect(matchOpenAIPath('/v1/vector_stores/vs-1/files/file_abc')).toEqual({
      pathTemplate: '/v1/vector_stores/{vector_store_id}/files/{file_id}',
    });
  });
});
