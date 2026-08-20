import { describe, expect, it } from 'vitest';
import {
  extractProviderError,
  isEmptyProviderError,
  providerErrorFromText,
  PROVIDER_ERROR_FIELD_MAX,
} from './errors.js';

// ★ The extraction is an ALLOWLIST. A provider error body is arbitrary JSON from outside the
// trust boundary, and it can echo request content back. Three named fields survive; everything
// else — nested objects, extra keys, the raw body itself — is discarded here and can therefore
// never reach the DOM, a log, or a diagnostic payload.

describe('the shapes both providers actually send', () => {
  it('reads the OpenAI shape', () => {
    expect(
      extractProviderError(
        { error: { message: 'The model does not exist', type: 'invalid_request_error', param: 'model', code: 'model_not_found' } },
        404,
      ),
    ).toEqual({
      type: 'invalid_request_error',
      code: 'model_not_found',
      message: 'The model does not exist',
      status: 404,
    });
  });

  it('reads the Anthropic shape', () => {
    expect(
      extractProviderError(
        { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
        401,
      ),
    ).toEqual({
      type: 'authentication_error',
      code: null,
      message: 'invalid x-api-key',
      status: 401,
    });
  });

  it('reads the Responses `response.failed` nesting', () => {
    expect(
      extractProviderError({
        type: 'response.failed',
        response: { error: { code: 'server_error', message: 'boom' } },
      }),
    ).toMatchObject({ code: 'server_error', message: 'boom' });
  });

  it('reads the GovAI envelope, whose `error` is a string code', () => {
    expect(
      extractProviderError({ error: 'governed_blocked', reason: 'x', message: 'blocked' }, 403),
    ).toEqual({ type: null, code: 'governed_blocked', message: 'blocked', status: 403 });
  });

  it('reads a top-level taxonomy with no nested object', () => {
    expect(extractProviderError({ type: 'overloaded_error', message: 'Overloaded' })).toMatchObject({
      type: 'overloaded_error',
      message: 'Overloaded',
    });
  });
});

describe('★ nothing outside the three named fields survives', () => {
  it('drops every unknown key, including one carrying prompt content', () => {
    const result = extractProviderError({
      error: {
        message: 'bad request',
        type: 'invalid_request_error',
        // A body that echoes the request back. None of this may become UI text.
        request: { messages: [{ role: 'user', content: 'MY CONFIDENTIAL PROMPT' }] },
        headers: { authorization: 'Bearer sk-SECRET' },
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('MY CONFIDENTIAL PROMPT');
    expect(serialized).not.toContain('sk-SECRET');
    expect(Object.keys(result).sort()).toEqual(['code', 'message', 'status', 'type']);
  });

  it('ignores non-string values in the named fields', () => {
    expect(
      extractProviderError({ error: { message: { nested: 'object' }, type: 42, code: ['a'] } }),
    ).toEqual({ type: null, code: null, message: null, status: null });
  });

  it('bounds a very long message', () => {
    const long = 'x'.repeat(PROVIDER_ERROR_FIELD_MAX * 3);
    const result = extractProviderError({ error: { message: long } });
    expect(result.message).toHaveLength(PROVIDER_ERROR_FIELD_MAX + 1); // + the ellipsis
    expect(result.message?.endsWith('…')).toBe(true);
  });

  it('treats whitespace-only strings as absent', () => {
    expect(extractProviderError({ error: { message: '   ', type: '' } })).toMatchObject({
      message: null,
      type: null,
    });
  });
});

describe('robustness', () => {
  it('returns empty fields for a non-object body, carrying only the status', () => {
    for (const body of [null, undefined, 'a string', 42, ['array']]) {
      expect(extractProviderError(body, 500)).toEqual({
        type: null,
        code: null,
        message: null,
        status: 500,
      });
    }
  });

  it('never throws on unparseable text', () => {
    expect(providerErrorFromText('<html>502 Bad Gateway</html>', 502)).toEqual({
      type: null,
      code: null,
      message: null,
      status: 502,
    });
  });

  it('discards the raw text when it cannot be parsed', () => {
    // A proxy error page must not be rendered verbatim.
    const result = providerErrorFromText('<html>SECRET INTERNAL HOSTNAME</html>', 502);
    expect(JSON.stringify(result)).not.toContain('SECRET INTERNAL HOSTNAME');
  });

  it('handles an empty body', () => {
    expect(providerErrorFromText('', 500)).toMatchObject({ status: 500 });
    expect(isEmptyProviderError(providerErrorFromText('', 500))).toBe(true);
  });

  it('reports a populated error as non-empty', () => {
    expect(isEmptyProviderError(providerErrorFromText('{"error":{"code":"x"}}', 400))).toBe(false);
  });
});
