// Anthropic provider request identifier extraction (M2A F1).
//
// The REAL Anthropic API returns its request identifier in the `request-id`
// response header (observed on every response during the M2 real-provider
// acceptance; the official SDK reads the same header). GovAI evidence
// (`provider_request_id` in v4 captures and provider_invocations) must carry
// that value, so `request-id` is the PRIMARY name. `anthropic-request-id` and
// `x-request-id` are compatibility fallbacks ONLY (older mocks / proxies) and
// must never mask the real header. Precedence:
//
//   request-id → anthropic-request-id → x-request-id → null
//
// Provider-specific by design: shared provider code must not apply this list
// to OpenAI (whose identifier is `x-request-id`).

export const ANTHROPIC_REQUEST_ID_HEADER = 'request-id';

export const ANTHROPIC_REQUEST_ID_HEADER_PRECEDENCE: ReadonlyArray<string> = Object.freeze([
  ANTHROPIC_REQUEST_ID_HEADER,
  'anthropic-request-id',
  'x-request-id',
]);

/** Header source: a lower-cased header record (forwarders) or a Fetch `Headers`. */
export type HeaderSource = Readonly<Record<string, string | undefined>> | Headers;

function readHeader(source: HeaderSource, name: string): string | null {
  if (typeof (source as Headers).get === 'function') {
    return (source as Headers).get(name);
  }
  const v = (source as Readonly<Record<string, string | undefined>>)[name];
  return v === undefined ? null : v;
}

/**
 * Extract the Anthropic provider request id from response headers using the
 * real-provider-first precedence above. Returns null when no supported header
 * is present (never fabricates a value). Empty header values count as absent.
 */
export function extractAnthropicRequestId(source: HeaderSource): string | null {
  for (const name of ANTHROPIC_REQUEST_ID_HEADER_PRECEDENCE) {
    const v = readHeader(source, name);
    if (v !== null && v !== '') return v;
  }
  return null;
}
