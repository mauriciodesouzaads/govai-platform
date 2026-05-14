import { describe, it, expect } from 'vitest';
import {
  AnthropicProvider,
  extractAnthropicUsage,
  classifyAnthropicError,
  rewritePassthroughHeaders,
  ANTHROPIC_BETA_ALLOWLIST,
} from './index.js';

describe('AnthropicProvider — constructor', () => {
  it('stores an Anthropic client built from the provided apiKey', () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' });
    expect(p.client).toBeDefined();
    expect(typeof p.client.messages).toBe('object');
  });
});

describe('extractAnthropicUsage', () => {
  it('returns null when usage is absent', () => {
    expect(extractAnthropicUsage({})).toBeNull();
  });

  it('returns null when usage.input_tokens is not a number', () => {
    expect(
      extractAnthropicUsage({ usage: { input_tokens: undefined, output_tokens: 5 } }),
    ).toBeNull();
  });

  it('returns null when usage.output_tokens is not a number', () => {
    expect(
      extractAnthropicUsage({ usage: { input_tokens: 5, output_tokens: undefined } }),
    ).toBeNull();
  });

  it('returns null when both token counts are non-numeric strings', () => {
    expect(
      extractAnthropicUsage({
        usage: {
          input_tokens: 'oops' as unknown as number,
          output_tokens: 'nope' as unknown as number,
        },
      }),
    ).toBeNull();
  });

  it('normalises input + output to total and tags source as provider_direct', () => {
    const r = extractAnthropicUsage({ usage: { input_tokens: 10, output_tokens: 4 } });
    expect(r).toEqual({
      normalized: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      source: 'provider_direct',
    });
  });
});

describe('classifyAnthropicError', () => {
  it('returns "unknown" for non-object input', () => {
    expect(classifyAnthropicError('boom')).toBe('unknown');
    expect(classifyAnthropicError(undefined)).toBe('unknown');
    expect(classifyAnthropicError(null)).toBe('unknown');
  });

  it('maps status 401/403 to "auth"', () => {
    expect(classifyAnthropicError({ status: 401 })).toBe('auth');
    expect(classifyAnthropicError({ status: 403 })).toBe('auth');
  });

  it('maps status 429 to "rate_limit"', () => {
    expect(classifyAnthropicError({ status: 429 })).toBe('rate_limit');
  });

  it('maps status 400/422 to "invalid_request"', () => {
    expect(classifyAnthropicError({ status: 400 })).toBe('invalid_request');
    expect(classifyAnthropicError({ status: 422 })).toBe('invalid_request');
  });

  it('maps status 529 to "overloaded"', () => {
    expect(classifyAnthropicError({ status: 529 })).toBe('overloaded');
  });

  it('maps any other 5xx to "server_error"', () => {
    expect(classifyAnthropicError({ status: 500 })).toBe('server_error');
    expect(classifyAnthropicError({ status: 503 })).toBe('server_error');
  });

  it('falls back to "unknown" when status is missing or unhandled', () => {
    expect(classifyAnthropicError({ status: 418 })).toBe('unknown');
    expect(classifyAnthropicError({ type: 'something' })).toBe('unknown');
    expect(classifyAnthropicError({})).toBe('unknown');
  });
});

describe('rewritePassthroughHeaders', () => {
  it('strips client auth + hop-by-hop headers and applies provider key', () => {
    const { outbound, deniedBetas } = rewritePassthroughHeaders(
      {
        authorization: 'Bearer client-token',
        'x-api-key': 'client-key',
        'x-govai-api-key': 'govai-key',
        host: 'example.com',
        connection: 'keep-alive',
        'content-length': '42',
        'user-agent': 'curl/8.0',
      },
      'provider-key-123',
    );
    expect(outbound['x-api-key']).toBe('provider-key-123');
    expect(outbound.authorization).toBeUndefined();
    expect(outbound['x-govai-api-key']).toBeUndefined();
    expect(outbound.host).toBeUndefined();
    expect(outbound.connection).toBeUndefined();
    expect(outbound['content-length']).toBeUndefined();
    expect(outbound['user-agent']).toBe('curl/8.0');
    expect(deniedBetas).toEqual([]);
  });

  it('injects anthropic-version default when not already present', () => {
    const { outbound } = rewritePassthroughHeaders({}, 'k');
    expect(outbound['anthropic-version']).toBe('2023-06-01');
  });

  it('preserves an existing anthropic-version header from the inbound request', () => {
    const { outbound } = rewritePassthroughHeaders(
      { 'anthropic-version': '2024-10-22' },
      'k',
    );
    expect(outbound['anthropic-version']).toBe('2024-10-22');
  });

  it('joins array-valued inbound header into a comma-separated string', () => {
    const { outbound } = rewritePassthroughHeaders(
      { 'x-multi': ['a', 'b', 'c'] },
      'k',
    );
    expect(outbound['x-multi']).toBe('a, b, c');
  });

  it('drops undefined header values without crashing', () => {
    const { outbound } = rewritePassthroughHeaders(
      { 'x-empty': undefined, 'x-present': 'v' },
      'k',
    );
    expect(outbound['x-empty']).toBeUndefined();
    expect(outbound['x-present']).toBe('v');
  });

  it('denies anthropic-beta tokens not in the allowlist and drops the header from outbound', () => {
    const { outbound, deniedBetas } = rewritePassthroughHeaders(
      { 'anthropic-beta': 'random-beta-2099-01-01' },
      'k',
    );
    expect(deniedBetas).toEqual(['random-beta-2099-01-01']);
    expect(outbound['anthropic-beta']).toBeUndefined();
  });

  it('passes anthropic-beta tokens listed in caller-provided allowlist', () => {
    const { outbound, deniedBetas } = rewritePassthroughHeaders(
      { 'anthropic-beta': 'allowed-token, blocked-token' },
      'k',
      { allowedBetas: ['allowed-token'] },
    );
    expect(deniedBetas).toEqual(['blocked-token']);
    expect(outbound['anthropic-beta']).toBeUndefined();
  });

  it('passes through when all anthropic-beta tokens are allowlisted', () => {
    const { outbound, deniedBetas } = rewritePassthroughHeaders(
      { 'anthropic-beta': 'tok-1, tok-2' },
      'k',
      { allowedBetas: ['tok-1', 'tok-2'] },
    );
    expect(deniedBetas).toEqual([]);
    expect(outbound['anthropic-beta']).toBe('tok-1,tok-2');
  });
});

describe('ANTHROPIC_BETA_ALLOWLIST', () => {
  it('is frozen and empty by default (baseline)', () => {
    expect(Object.isFrozen(ANTHROPIC_BETA_ALLOWLIST)).toBe(true);
    expect(ANTHROPIC_BETA_ALLOWLIST).toEqual([]);
  });
});
