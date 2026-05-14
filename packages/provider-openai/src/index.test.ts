import { describe, it, expect } from 'vitest';
import {
  OpenAIProvider,
  extractOpenAIUsage,
  classifyOpenAIError,
  rewritePassthroughHeaders,
} from './index.js';

describe('OpenAIProvider — constructor', () => {
  it('stores an OpenAI client built from the provided apiKey + organization', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test', organization: 'org-1' });
    expect(p.client).toBeDefined();
    expect(typeof p.client.chat).toBe('object');
    expect(typeof p.client.responses).toBe('object');
  });

  it('accepts apiKey without organization', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test' });
    expect(p.client).toBeDefined();
  });
});

describe('extractOpenAIUsage', () => {
  it('returns null when usage is absent', () => {
    expect(extractOpenAIUsage({})).toBeNull();
  });

  it('returns null when usage is null', () => {
    expect(extractOpenAIUsage({ usage: null })).toBeNull();
  });

  it('normalises Responses API shape (input_tokens / output_tokens)', () => {
    const r = extractOpenAIUsage({ usage: { input_tokens: 10, output_tokens: 4 } });
    expect(r).toEqual({
      normalized: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      source: 'provider_direct',
    });
  });

  it('normalises Chat Completions shape (prompt_tokens / completion_tokens)', () => {
    const r = extractOpenAIUsage({ usage: { prompt_tokens: 7, completion_tokens: 5 } });
    expect(r).toEqual({
      normalized: { input_tokens: 7, output_tokens: 5, total_tokens: 12 },
      source: 'provider_direct',
    });
  });

  it('treats missing output_tokens as 0 in Responses shape', () => {
    const r = extractOpenAIUsage({ usage: { input_tokens: 11 } });
    expect(r?.normalized).toEqual({ input_tokens: 11, output_tokens: 0, total_tokens: 11 });
  });

  it('treats missing completion_tokens as 0 in Chat Completions shape', () => {
    const r = extractOpenAIUsage({ usage: { prompt_tokens: 9 } });
    expect(r?.normalized).toEqual({ input_tokens: 9, output_tokens: 0, total_tokens: 9 });
  });

  it('returns null when neither shape has a numeric primary field', () => {
    expect(
      extractOpenAIUsage({
        usage: {
          input_tokens: 'not-a-number' as unknown as number,
          output_tokens: 5,
        },
      }),
    ).toBeNull();
  });

  it('returns null when usage has neither input_tokens nor prompt_tokens', () => {
    expect(extractOpenAIUsage({ usage: { total_tokens: 100 } })).toBeNull();
  });
});

describe('classifyOpenAIError', () => {
  it('returns "unknown" for non-object input', () => {
    expect(classifyOpenAIError('boom')).toBe('unknown');
    expect(classifyOpenAIError(undefined)).toBe('unknown');
    expect(classifyOpenAIError(null)).toBe('unknown');
  });

  it('maps 401/403 to "auth"', () => {
    expect(classifyOpenAIError({ status: 401 })).toBe('auth');
    expect(classifyOpenAIError({ status: 403 })).toBe('auth');
  });

  it('maps 429 to "rate_limit"', () => {
    expect(classifyOpenAIError({ status: 429 })).toBe('rate_limit');
  });

  it('maps 400/422 to "invalid_request"', () => {
    expect(classifyOpenAIError({ status: 400 })).toBe('invalid_request');
    expect(classifyOpenAIError({ status: 422 })).toBe('invalid_request');
  });

  it('maps 503 to "overloaded"', () => {
    expect(classifyOpenAIError({ status: 503 })).toBe('overloaded');
  });

  it('maps other 5xx to "server_error"', () => {
    expect(classifyOpenAIError({ status: 500 })).toBe('server_error');
    expect(classifyOpenAIError({ status: 502 })).toBe('server_error');
  });

  it('falls back to "unknown" for unhandled or missing status', () => {
    expect(classifyOpenAIError({ status: 418 })).toBe('unknown');
    expect(classifyOpenAIError({})).toBe('unknown');
  });
});

describe('rewritePassthroughHeaders', () => {
  it('strips client authorization and x-govai-api-key and applies provider key as Bearer token', () => {
    const { outbound } = rewritePassthroughHeaders(
      {
        authorization: 'Bearer client-token',
        'x-govai-api-key': 'govai-internal',
        'user-agent': 'curl/8.0',
      },
      'sk-provider',
    );
    expect(outbound['authorization']).toBe('Bearer sk-provider');
    expect(outbound['x-govai-api-key']).toBeUndefined();
    expect(outbound['user-agent']).toBe('curl/8.0');
  });

  it('strips hop-by-hop headers (host/connection/content-length)', () => {
    const { outbound } = rewritePassthroughHeaders(
      {
        host: 'example.com',
        connection: 'keep-alive',
        'content-length': '42',
        'content-type': 'application/json',
      },
      'sk-provider',
    );
    expect(outbound.host).toBeUndefined();
    expect(outbound.connection).toBeUndefined();
    expect(outbound['content-length']).toBeUndefined();
    expect(outbound['content-type']).toBe('application/json');
  });

  it('adds openai-organization header when organization is provided', () => {
    const { outbound } = rewritePassthroughHeaders({}, 'sk-provider', 'org-1');
    expect(outbound['openai-organization']).toBe('org-1');
  });

  it('omits openai-organization when organization is not provided', () => {
    const { outbound } = rewritePassthroughHeaders({}, 'sk-provider');
    expect(outbound['openai-organization']).toBeUndefined();
  });

  it('joins array-valued inbound header into a comma-separated string', () => {
    const { outbound } = rewritePassthroughHeaders(
      { 'x-multi': ['a', 'b', 'c'] },
      'sk-provider',
    );
    expect(outbound['x-multi']).toBe('a, b, c');
  });

  it('drops undefined header values without crashing', () => {
    const { outbound } = rewritePassthroughHeaders(
      { 'x-empty': undefined, 'x-present': 'v' },
      'sk-provider',
    );
    expect(outbound['x-empty']).toBeUndefined();
    expect(outbound['x-present']).toBe('v');
  });
});
