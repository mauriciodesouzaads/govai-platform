// MIRROR of the GovAI error envelopes the U1 surfaces actually return.
// Authoritative sources (re-read at main 88191a6f):
//   apps/api/src/routes/evidence.ts:59-60,74-75    — 400 invalid_query / 401 auth_error
//   apps/api/src/routes/audit-events.ts:23-24,34-35
//   apps/api/src/routes/capabilities.ts:24-25
//   apps/api/src/server.ts:108-111                 — @fastify/rate-limit (100/min outside test)
//
// ★ SOURCE ADJUDICATION — the July plans describe a single uniform `{error, …}` envelope for
// every response. Two real responses do NOT carry a GovAI `error` code:
//   • 429 comes from @fastify/rate-limit as `{statusCode, error:'Too Many Requests', message}`
//   • an unknown path 404s with Fastify's default `{message, error:'Not Found', statusCode}`
// The client therefore normalizes BOTH shapes and never assumes a GovAI code is present; the
// 429 path keys off the HTTP status, not the body.

import { z } from 'zod';

/** The GovAI envelope: a machine code plus optional detail. `issues` is Zod's issue array,
 *  passed through verbatim by the 400 handlers. */
export const GovAIErrorBody = z.object({
  error: z.string(),
  message: z.string().optional(),
  issues: z.array(z.unknown()).optional(),
  required_role: z.string().optional(),
});
export type GovAIErrorBody = z.infer<typeof GovAIErrorBody>;

/** How the UI reacts, derived from the HTTP status and (when present) the GovAI code. */
export type ApiErrorKind =
  | 'auth' // 401 — the credential is absent, malformed or rejected
  | 'invalid_request' // 400 — the UI sent something the route refused
  | 'forbidden' // 403 — authenticated but not permitted
  | 'not_found' // 404 — absent, or outside this organization (RLS makes those identical)
  | 'conflict' // 409 — state changed under us
  | 'rate_limited' // 429 — the shared 100/min budget
  | 'server' // 5xx — retryable server/provider failure
  | 'network' // the request never produced a response
  | 'malformed_response' // 2xx whose body failed contract validation
  | 'unknown';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** The GovAI machine code when the body carried one (`auth_error`, `invalid_query`, …). */
  readonly code: string | null;
  readonly issues: unknown[] | null;
  /** Seconds from a `Retry-After` header, when the server sent a usable one. */
  readonly retryAfterSeconds: number | null;

  constructor(init: {
    kind: ApiErrorKind;
    status?: number | null;
    code?: string | null;
    issues?: unknown[] | null;
    retryAfterSeconds?: number | null;
    message?: string;
  }) {
    // The message is diagnostic only and is never surfaced raw to the user — every screen
    // renders a localized message chosen from `kind`. It deliberately carries no request
    // headers, no credential and no response body.
    super(init.message ?? `govai api error: ${init.kind}`);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.issues = init.issues ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** Map an HTTP status to the UI's reaction class. Kept pure and table-driven so the client
 *  and the tests agree by construction. */
export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 422) return 'invalid_request';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** Retry only what is genuinely transient. 429 is handled by the transport itself (bounded,
 *  Retry-After aware); 5xx and network faults are retried by the query layer with a bounded
 *  count. Everything else is a permanent answer and is never retried. */
export function isRetryableKind(kind: ApiErrorKind): boolean {
  return kind === 'server' || kind === 'network';
}
