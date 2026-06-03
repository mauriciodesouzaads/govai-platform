// Unit tests for the Anthropic provider-native response hop-by-hop header filter.
//
// These exercise filterResponseHeaders directly — BEFORE Node/Fastify response
// normalization. That layer owns `connection` / `keep-alive` /
// `transfer-encoding` / `content-length` on the outgoing socket (it re-emits or
// recomputes them), which is exactly why those four cannot be asserted from a
// downstream HTTP response. register-passthrough.raw-body.test.ts can only
// prove the subset observable over the wire; this unit test closes the gap by
// proving the full HOP_BY_HOP policy is applied to the upstream response
// headers, including the runtime-managed ones.
import { describe, it, expect } from 'vitest';
import { filterResponseHeaders } from './register-passthrough.js';

// The full hop-by-hop set the Anthropic passthrough route strips from responses
// (mirrors the file-local HOP_BY_HOP in register-passthrough.ts).
const HOP_BY_HOP = [
  'host',
  'connection',
  'content-length',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailer',
];

describe('filterResponseHeaders (Anthropic provider-native response hop-by-hop policy)', () => {
  it('removes every hop-by-hop header, including the runtime-managed ones', () => {
    const input: Array<[string, string]> = [
      ['content-type', 'application/json'],
      ['x-request-id', 'req_abc123'],
      ['x-provider-custom', 'keep-me'],
      ...HOP_BY_HOP.map((h) => [h, `value-for-${h}`] as [string, string]),
    ];

    const out = filterResponseHeaders(input);

    for (const h of HOP_BY_HOP) {
      expect(out[h]).toBeUndefined();
    }
    // Explicitly the three that a downstream HTTP assertion cannot observe.
    expect(out['keep-alive']).toBeUndefined();
    expect(out['transfer-encoding']).toBeUndefined();
    expect(out['content-length']).toBeUndefined();

    // Allowed headers preserved with exact key + value, and nothing else leaks.
    expect(out['content-type']).toBe('application/json');
    expect(out['x-request-id']).toBe('req_abc123');
    expect(out['x-provider-custom']).toBe('keep-me');
    expect(Object.keys(out).sort()).toEqual(
      ['content-type', 'x-provider-custom', 'x-request-id'].sort(),
    );
  });

  it('detects hop-by-hop headers case-insensitively', () => {
    const out = filterResponseHeaders([
      ['Content-Type', 'text/event-stream'],
      ['Connection', 'keep-alive'],
      ['Keep-Alive', 'timeout=5'],
      ['TRANSFER-ENCODING', 'chunked'],
      ['Content-Length', '128'],
      ['Proxy-Authenticate', 'Basic'],
    ]);

    expect(out['Connection']).toBeUndefined();
    expect(out['Keep-Alive']).toBeUndefined();
    expect(out['TRANSFER-ENCODING']).toBeUndefined();
    expect(out['Content-Length']).toBeUndefined();
    expect(out['Proxy-Authenticate']).toBeUndefined();
    // Allowed header keeps its original casing and value.
    expect(out['Content-Type']).toBe('text/event-stream');
  });

  it('does not mutate its input', () => {
    const input: Array<[string, string]> = [
      ['connection', 'keep-alive'],
      ['content-type', 'application/json'],
    ];
    const snapshot = input.map(([k, v]) => [k, v] as [string, string]);

    filterResponseHeaders(input);

    expect(input).toEqual(snapshot);
  });

  it('returns an empty object when every header is hop-by-hop', () => {
    const out = filterResponseHeaders(
      HOP_BY_HOP.map((h) => [h, 'x'] as [string, string]),
    );
    expect(out).toEqual({});
  });
});
