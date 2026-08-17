// M2A F1 — Anthropic request id extraction: REAL `request-id` first, legacy
// names as isolated fallbacks, null when nothing supported is present.
import { describe, it, expect } from 'vitest';
import {
  ANTHROPIC_REQUEST_ID_HEADER,
  ANTHROPIC_REQUEST_ID_HEADER_PRECEDENCE,
  extractAnthropicRequestId,
} from './request-id.js';

describe('extractAnthropicRequestId (M2A F1)', () => {
  it('primary: the REAL provider header `request-id` is read first', () => {
    expect(ANTHROPIC_REQUEST_ID_HEADER).toBe('request-id');
    expect(ANTHROPIC_REQUEST_ID_HEADER_PRECEDENCE).toEqual([
      'request-id',
      'anthropic-request-id',
      'x-request-id',
    ]);
    expect(extractAnthropicRequestId({ 'request-id': 'req_real' })).toBe('req_real');
    expect(extractAnthropicRequestId(new Headers({ 'request-id': 'req_real' }))).toBe('req_real');
  });

  it('request-id wins even when the legacy names are also present (anti-masking)', () => {
    expect(
      extractAnthropicRequestId({
        'x-request-id': 'legacy-x',
        'anthropic-request-id': 'legacy-anthropic',
        'request-id': 'req_real',
      }),
    ).toBe('req_real');
  });

  it('F1-T8 fallback 1: request-id absent, anthropic-request-id present → used', () => {
    expect(extractAnthropicRequestId({ 'anthropic-request-id': 'req_fallback_1', 'x-request-id': 'x' })).toBe(
      'req_fallback_1',
    );
  });

  it('F1-T9 fallback 2: request-id + anthropic-request-id absent, x-request-id present → used', () => {
    expect(extractAnthropicRequestId({ 'x-request-id': 'req_fallback_2' })).toBe('req_fallback_2');
    expect(extractAnthropicRequestId(new Headers({ 'x-request-id': 'req_fallback_2' }))).toBe('req_fallback_2');
  });

  it('F1-T10 no supported header → null (no fabrication); empty values count as absent', () => {
    expect(extractAnthropicRequestId({})).toBeNull();
    expect(extractAnthropicRequestId({ 'content-type': 'application/json' })).toBeNull();
    expect(extractAnthropicRequestId(new Headers())).toBeNull();
    expect(extractAnthropicRequestId({ 'request-id': '', 'anthropic-request-id': '' })).toBeNull();
    expect(extractAnthropicRequestId({ 'request-id': '', 'x-request-id': 'req_x' })).toBe('req_x');
  });
});
