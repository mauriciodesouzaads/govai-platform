// Safe extraction of a provider-native error.
//
// A provider error body is arbitrary JSON from outside the trust boundary. It is useful — the
// difference between "that model does not exist" and "you are over your quota" is exactly what
// a reader needs — but it must reach the screen as a small set of NAMED, BOUNDED fields, never
// as a serialized blob.
//
// Rules this module enforces:
//   • only `type`, `code` and `message` are ever extracted, and only when they are strings;
//   • every extracted string is length-bounded before it can reach the DOM;
//   • nothing else from the body survives — no nested objects, no arrays, no unknown keys;
//   • the raw body is never returned, never logged, never attached to an error, and never put
//     into telemetry. There is no telemetry in this application, and this module is written so
//     that adding some later cannot accidentally start exfiltrating response bodies.
//
// The last rule is not theoretical: a provider error body can echo request content back, and
// a "helpful" debug dump of an unknown response is how prompt text ends up somewhere it was
// never meant to be.

/** Hard ceiling on any single extracted field. Long enough for a real provider message,
 *  short enough that a hostile body cannot become a wall of text. */
export const PROVIDER_ERROR_FIELD_MAX = 400;

export type SafeProviderError = {
  /** The provider's error taxonomy value (`invalid_request_error`, `rate_limit_error`, …). */
  type: string | null;
  /** The provider's machine code (`model_not_found`, `insufficient_quota`, …). */
  code: string | null;
  /** The provider's human-readable message, bounded. */
  message: string | null;
  /** The HTTP status the browser actually received, when there was one. */
  status: number | null;
};

export const EMPTY_PROVIDER_ERROR: SafeProviderError = {
  type: null,
  code: null,
  message: null,
  status: null,
};

function boundedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > PROVIDER_ERROR_FIELD_MAX
    ? `${trimmed.slice(0, PROVIDER_ERROR_FIELD_MAX)}…`
    : trimmed;
}

/**
 * Extract the three safe fields from an already-parsed body.
 *
 * Handles the shapes both providers actually use:
 *   OpenAI      { error: { message, type, param, code } }
 *   Anthropic   { type: 'error', error: { type, message } }
 *   SSE error   { type: 'error', error: { type: 'overloaded_error', message } }
 *   Responses   { type: 'response.failed', response: { error: { code, message } } }
 * and returns empty fields for anything else, rather than guessing.
 */
export function extractProviderError(
  body: unknown,
  status: number | null = null,
): SafeProviderError {
  const base: SafeProviderError = { ...EMPTY_PROVIDER_ERROR, status };
  if (typeof body !== 'object' || body === null) return base;

  const record = body as Record<string, unknown>;

  // `response.failed` nests the error one level deeper than the rest.
  const responseField = record['response'];
  const nested =
    typeof responseField === 'object' && responseField !== null
      ? (responseField as Record<string, unknown>)['error']
      : undefined;

  const errorField = record['error'] ?? nested;

  if (typeof errorField === 'string') {
    // Two shapes reach here, and they disagree about where the machine code lives:
    //   GovAI envelope   { error: 'governed_blocked', message }          → the code IS `error`
    //   Fastify envelope { statusCode, code, error: 'Payload Too Large',
    //                      message }                                     → the code is `code`
    // Prefer a top-level string `code` when there is one. GovAI's envelope has none, so this is
    // additive there; without it a framework rejection surfaces as the human phrase ("Payload
    // Too Large") and no caller can key a decision off it.
    const topLevelCode = boundedString(record['code']);
    return {
      ...base,
      code: topLevelCode ?? boundedString(errorField),
      message: boundedString(record['message']),
    };
  }

  if (typeof errorField === 'object' && errorField !== null) {
    const err = errorField as Record<string, unknown>;
    return {
      ...base,
      type: boundedString(err['type']),
      code: boundedString(err['code']),
      message: boundedString(err['message']),
    };
  }

  // Some surfaces put the taxonomy at the top level with no nested object.
  return {
    ...base,
    type: boundedString(record['type']),
    code: boundedString(record['code']),
    message: boundedString(record['message']),
  };
}

/**
 * Parse a bounded response body text and extract the safe fields. Unparseable text yields
 * empty fields carrying only the status — the text itself is discarded, never rendered.
 */
export function providerErrorFromText(text: string, status: number | null): SafeProviderError {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ...EMPTY_PROVIDER_ERROR, status };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ...EMPTY_PROVIDER_ERROR, status };
  }
  return extractProviderError(parsed, status);
}

/** True when the extraction found nothing worth showing beyond the status. */
export function isEmptyProviderError(error: SafeProviderError): boolean {
  return error.type === null && error.code === null && error.message === null;
}
