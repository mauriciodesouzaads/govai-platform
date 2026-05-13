import { describe, it, expect } from 'vitest';
import {
  ANTHROPIC_CAPABILITIES,
  ANTHROPIC_MESSAGES_CREATE,
  ANTHROPIC_MESSAGES_STREAM,
  ANTHROPIC_MESSAGES_META,
  ANTHROPIC_MODELS,
  ANTHROPIC_FILES,
  ANTHROPIC_WEB_SEARCH_TOOL,
  resolveAnthropicCapabilityForRequest,
  matchAnthropicPath,
} from './index.js';

describe('ANTHROPIC_CAPABILITIES registry', () => {
  it('exports a frozen, deduplicated list of 6 capabilities', () => {
    expect(ANTHROPIC_CAPABILITIES).toHaveLength(6);
    expect(Object.isFrozen(ANTHROPIC_CAPABILITIES)).toBe(true);
    const ids = ANTHROPIC_CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes every named export by id', () => {
    const ids = new Set(ANTHROPIC_CAPABILITIES.map((c) => c.id));
    for (const cap of [
      ANTHROPIC_MESSAGES_CREATE,
      ANTHROPIC_MESSAGES_STREAM,
      ANTHROPIC_MESSAGES_META,
      ANTHROPIC_MODELS,
      ANTHROPIC_FILES,
      ANTHROPIC_WEB_SEARCH_TOOL,
    ]) {
      expect(ids.has(cap.id)).toBe(true);
    }
  });
});

describe('resolveAnthropicCapabilityForRequest', () => {
  it('POST /v1/messages non-stream → anthropic.messages.create, canonical=policy_governed', () => {
    const r = resolveAnthropicCapabilityForRequest({
      method: 'POST',
      pathTemplate: '/v1/messages',
      isStream: false,
    });
    expect(r).toEqual({
      capability_id: 'anthropic.messages.create',
      canonical_level: 'policy_governed',
    });
  });

  it('POST /v1/messages stream:true → anthropic.messages.stream', () => {
    const r = resolveAnthropicCapabilityForRequest({
      method: 'POST',
      pathTemplate: '/v1/messages',
      isStream: true,
    });
    expect(r).toEqual({
      capability_id: 'anthropic.messages.stream',
      canonical_level: 'policy_governed',
    });
  });

  it('POST /v1/messages/count_tokens → anthropic.messages_meta', () => {
    const r = resolveAnthropicCapabilityForRequest({
      method: 'POST',
      pathTemplate: '/v1/messages/count_tokens',
      isStream: false,
    });
    expect(r.capability_id).toBe('anthropic.messages_meta');
    expect(r.canonical_level).toBe('passthrough_audited');
  });

  it('GET /v1/models → anthropic.models', () => {
    const r = resolveAnthropicCapabilityForRequest({
      method: 'GET',
      pathTemplate: '/v1/models',
      isStream: false,
    });
    expect(r.capability_id).toBe('anthropic.models');
  });

  it('GET /v1/models/{model_id} → anthropic.models (single capability for both list + get)', () => {
    const r = resolveAnthropicCapabilityForRequest({
      method: 'GET',
      pathTemplate: '/v1/models/{model_id}',
      isStream: false,
    });
    expect(r.capability_id).toBe('anthropic.models');
  });

  it('paths under /v1/files map to anthropic.files', () => {
    for (const path of [
      '/v1/files',
      '/v1/files/{file_id}',
      '/v1/files/{file_id}/content',
    ]) {
      const r = resolveAnthropicCapabilityForRequest({
        method: 'GET',
        pathTemplate: path,
        isStream: false,
      });
      expect(r.capability_id).toBe('anthropic.files');
    }
  });

  it('unknown path resolves to capability_id="unknown" + passthrough_audited', () => {
    const r = resolveAnthropicCapabilityForRequest({
      method: 'POST',
      pathTemplate: '/v1/unknown-thing',
      isStream: false,
    });
    expect(r.capability_id).toBe('unknown');
    expect(r.canonical_level).toBe('passthrough_audited');
  });

  it('lowercase method input is normalised by uppercase comparison', () => {
    const r = resolveAnthropicCapabilityForRequest({
      method: 'post',
      pathTemplate: '/v1/messages',
      isStream: false,
    });
    expect(r.capability_id).toBe('anthropic.messages.create');
  });
});

describe('matchAnthropicPath', () => {
  it('returns null for a path that is not a registered Anthropic endpoint', () => {
    expect(matchAnthropicPath('/v2/random')).toBeNull();
  });

  it('strips the /passthrough/anthropic prefix and trailing slashes', () => {
    expect(matchAnthropicPath('/passthrough/anthropic/v1/messages/')).toEqual({
      pathTemplate: '/v1/messages',
    });
  });

  it('drops query strings before matching', () => {
    expect(matchAnthropicPath('/v1/messages?foo=bar')).toEqual({
      pathTemplate: '/v1/messages',
    });
  });

  it('maps the bare root after stripping (input was just the prefix) to no match', () => {
    expect(matchAnthropicPath('/passthrough/anthropic')).toBeNull();
  });

  it('matches /v1/messages/count_tokens', () => {
    expect(matchAnthropicPath('/v1/messages/count_tokens')).toEqual({
      pathTemplate: '/v1/messages/count_tokens',
    });
  });

  it('matches /v1/models', () => {
    expect(matchAnthropicPath('/v1/models')).toEqual({ pathTemplate: '/v1/models' });
  });

  it('matches /v1/models/{model_id} by regex', () => {
    expect(matchAnthropicPath('/v1/models/claude-sonnet-4-5')).toEqual({
      pathTemplate: '/v1/models/{model_id}',
    });
  });

  it('matches /v1/files', () => {
    expect(matchAnthropicPath('/v1/files')).toEqual({ pathTemplate: '/v1/files' });
  });

  it('matches /v1/files/{file_id}/content (content endpoint takes precedence over {file_id})', () => {
    expect(matchAnthropicPath('/v1/files/file_abc123/content')).toEqual({
      pathTemplate: '/v1/files/{file_id}/content',
    });
  });

  it('matches /v1/files/{file_id} for plain file id paths', () => {
    expect(matchAnthropicPath('/v1/files/file_abc123')).toEqual({
      pathTemplate: '/v1/files/{file_id}',
    });
  });
});
