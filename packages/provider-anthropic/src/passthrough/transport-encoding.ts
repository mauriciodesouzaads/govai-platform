// Fetch-hop transport encoding truth — Foundation V1 M1 (FB-3).
//
// Both forwarders (`forwardRaw`, `forwardStream`) go through WHATWG/Node Fetch
// (undici). Undici transparently DECODES a compressed upstream body but leaves
// the upstream `content-encoding` (and the stale `content-length` of the
// encoded representation) in `res.headers`. Relaying decoded bytes together
// with those headers lies to every real HTTP client (an SDK honouring
// `content-encoding: gzip` would try to gunzip plain JSON).
//
// Two independent guards, both transport decisions (no provider-model
// semantics are touched):
//
//   1. Request side — the caller's transport negotiation is NOT propagated to
//      the upstream hop: `accept-encoding` is replaced by `identity`, so a
//      compliant provider sends the representation Fetch will not transform.
//      Bytes GovAI hashes = bytes on the wire = bytes delivered downstream.
//
//   2. Response side (defense in depth) — if the provider compresses anyway
//      with a coding Fetch decodes, every header that describes the ENCODED
//      representation is DROPPED — the stale `content-encoding` +
//      `content-length`, plus the representation validators / integrity fields
//      that are computed over the encoded bytes (`content-digest`,
//      `repr-digest`, legacy `digest` / `content-md5`, a STRONG `etag`,
//      `content-range`) — so downstream Node/Fastify framing describes the
//      bytes actually delivered and no client-side integrity check, cache or
//      range client associates decoded bytes with the wrong representation.
//      A weak `etag` (W/"…") asserts semantic equivalence across encodings and
//      is kept. Everything else (content-type, provider request ids,
//      rate-limit headers, ...) is preserved.
//
// "Was it decoded?" mirrors undici's own rule (lib/web/fetch/index.js): the
// body is decoded iff the response is not a null-body status (101/204/205/304)
// AND every listed coding is one undici knows (gzip / x-gzip / deflate / br,
// plus zstd where the runtime has `zlib.createZstdDecompress`). Any unknown
// coding in the list disables decoding entirely — those bytes reach the client
// raw with a truthful header, so nothing is dropped. Verified empirically on
// Node 24.15.0 (see M1 record).

import * as zlib from 'node:zlib';

/** Value GovAI sends upstream for `accept-encoding` on the Fetch hop. */
export const UPSTREAM_ACCEPT_ENCODING = 'identity';

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

const FETCH_DECODED_CODINGS = new Set(['gzip', 'x-gzip', 'deflate', 'br']);
// Runtime-conditional exactly like undici (namespace access so an older Node
// without zstd still loads this module).
if (typeof (zlib as { createZstdDecompress?: unknown }).createZstdDecompress === 'function') {
  FETCH_DECODED_CODINGS.add('zstd');
}

/**
 * Return a copy of `headers` whose `accept-encoding` (any casing) is replaced by
 * `identity`. Pure — never mutates the input.
 */
export function withIdentityAcceptEncoding(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'accept-encoding') continue;
    out[k] = v;
  }
  out['accept-encoding'] = UPSTREAM_ACCEPT_ENCODING;
  return out;
}

/**
 * True iff Fetch (undici) decoded the body described by these response headers,
 * i.e. the bytes exposed to GovAI are NOT the encoded representation the
 * `content-encoding` header describes.
 */
export function fetchDecodedBody(status: number, contentEncoding: string | undefined): boolean {
  if (NULL_BODY_STATUS.has(status)) return false;
  if (contentEncoding === undefined) return false;
  const codings = contentEncoding
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0);
  if (codings.length === 0) return false;
  return codings.every((c) => FETCH_DECODED_CODINGS.has(c));
}

/**
 * Headers that describe the ENCODED representation and become stale once Fetch
 * has decoded the body: framing (`content-encoding`, `content-length`) and the
 * integrity / validator fields computed over the encoded bytes (RFC 9530
 * `content-digest` / `repr-digest`, legacy RFC 3230 `digest`, RFC 2616
 * `content-md5`, RFC 9110 `content-range`). A strong `etag` is handled
 * separately (kept only when weak).
 */
const ENCODED_REPRESENTATION_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'content-digest',
  'repr-digest',
  'digest',
  'content-md5',
  'content-range',
]);

/**
 * Normalize lower-cased response headers captured from a Fetch response so they
 * describe the bytes GovAI actually holds: when Fetch decoded the body, drop the
 * stale `content-encoding` / `content-length` AND every representation-bound
 * validator / integrity header (see ENCODED_REPRESENTATION_HEADERS; a strong
 * `etag` is dropped, a weak `W/"…"` etag is kept). Pure — returns a new object;
 * all other headers pass through untouched; nothing is touched when Fetch did
 * not decode.
 */
export function normalizeFetchResponseHeaders(
  status: number,
  headers: Record<string, string>,
): Record<string, string> {
  if (!fetchDecodedBody(status, headers['content-encoding'])) return { ...headers };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (ENCODED_REPRESENTATION_HEADERS.has(k)) continue;
    if (k === 'etag' && !v.trim().startsWith('W/')) continue;
    out[k] = v;
  }
  return out;
}
