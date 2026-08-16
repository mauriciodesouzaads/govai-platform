// Unit contract of the Fetch-hop transport-encoding truth helpers (M1 FB-3).
// The mechanism itself is proven over real TCP in
// routes/register-passthrough.content-encoding.test.ts.
import { describe, it, expect } from 'vitest';
import * as zlib from 'node:zlib';
import {
  UPSTREAM_ACCEPT_ENCODING,
  fetchDecodedBody,
  normalizeFetchResponseHeaders,
  withIdentityAcceptEncoding,
} from './transport-encoding.js';

describe('withIdentityAcceptEncoding', () => {
  it('replaces any-cased accept-encoding with identity and never mutates the input', () => {
    const inp = { 'Accept-Encoding': 'gzip, br', 'content-type': 'application/json' };
    const out = withIdentityAcceptEncoding(inp);
    expect(out).toEqual({ 'content-type': 'application/json', 'accept-encoding': 'identity' });
    expect(inp).toEqual({ 'Accept-Encoding': 'gzip, br', 'content-type': 'application/json' });
    expect(UPSTREAM_ACCEPT_ENCODING).toBe('identity');
  });
  it('adds identity when the caller sent no accept-encoding at all', () => {
    expect(withIdentityAcceptEncoding({})).toEqual({ 'accept-encoding': 'identity' });
  });
});

describe('fetchDecodedBody — mirrors undici\'s decode rule', () => {
  it('known codings (any case, trimmed, multi) → decoded', () => {
    for (const ce of ['gzip', 'GZIP', ' gzip ', 'x-gzip', 'deflate', 'br', 'gzip, br', 'br,gzip']) {
      expect(fetchDecodedBody(200, ce)).toBe(true);
    }
  });
  it('zstd follows the runtime (undici only decodes it where zlib has createZstdDecompress)', () => {
    const hasZstd =
      typeof (zlib as { createZstdDecompress?: unknown }).createZstdDecompress === 'function';
    expect(fetchDecodedBody(200, 'zstd')).toBe(hasZstd);
  });
  it('unknown / identity / mixed-with-unknown / absent / empty → NOT decoded (bytes stay raw + header truthful)', () => {
    for (const ce of ['x-custom', 'identity', 'gzip, x-custom', '', ' , ']) {
      expect(fetchDecodedBody(200, ce)).toBe(false);
    }
    expect(fetchDecodedBody(200, undefined)).toBe(false);
  });
  it('null-body statuses are never decoded (101/204/205/304)', () => {
    for (const st of [101, 204, 205, 304]) expect(fetchDecodedBody(st, 'gzip')).toBe(false);
    expect(fetchDecodedBody(400, 'gzip')).toBe(true);
  });
});

describe('normalizeFetchResponseHeaders', () => {
  const base = {
    'content-type': 'application/json',
    'content-encoding': 'gzip',
    'content-length': '54',
    'x-request-id': 'r1',
  };
  it('drops stale content-encoding + content-length when Fetch decoded; keeps the rest; pure', () => {
    const out = normalizeFetchResponseHeaders(200, base);
    expect(out).toEqual({ 'content-type': 'application/json', 'x-request-id': 'r1' });
    expect(base['content-encoding']).toBe('gzip');
  });
  it('when decoded, also drops representation-bound validators/integrity headers (content-digest, repr-digest, digest, content-md5, content-range, STRONG etag) and keeps a weak etag', () => {
    const encoded = {
      ...base,
      'content-digest': 'sha-256=:abc:',
      'repr-digest': 'sha-256=:def:',
      digest: 'sha-256=xyz',
      'content-md5': 'Q2hlY2sgSW50ZWdyaXR5IQ==',
      'content-range': 'bytes 0-53/54',
      etag: '"strong-over-gzip"',
      'cache-control': 'no-store',
    };
    expect(normalizeFetchResponseHeaders(200, encoded)).toEqual({
      'content-type': 'application/json',
      'x-request-id': 'r1',
      'cache-control': 'no-store',
    });
    const weak = { ...base, etag: 'W/"weak-across-encodings"' };
    expect(normalizeFetchResponseHeaders(200, weak)['etag']).toBe('W/"weak-across-encodings"');
    // Not decoded → every one of them is left untouched (they are truthful for raw bytes).
    const raw = { ...encoded, 'content-encoding': 'x-custom' };
    expect(normalizeFetchResponseHeaders(200, raw)).toEqual(raw);
    const identity = { 'content-type': 'application/json', etag: '"strong-plain"', 'content-digest': 'sha-256=:p:' };
    expect(normalizeFetchResponseHeaders(200, identity)).toEqual(identity);
  });
  it('leaves everything untouched when Fetch did not decode', () => {
    const raw = { ...base, 'content-encoding': 'x-custom' };
    expect(normalizeFetchResponseHeaders(200, raw)).toEqual(raw);
    expect(normalizeFetchResponseHeaders(204, base)).toEqual(base);
    const noCe = { 'content-type': 'text/plain', 'content-length': '3' };
    expect(normalizeFetchResponseHeaders(200, noCe)).toEqual(noCe);
  });
});
