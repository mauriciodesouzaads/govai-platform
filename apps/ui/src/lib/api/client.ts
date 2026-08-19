// The single browser API client. There is exactly one, and every request in the application
// goes through it.
//
// Design rules it enforces:
//   • same-origin by default (empty base URL) — the promulgated /app + /v1 proxy topology;
//   • the credential is injected at request time, as a header, and is never logged, never put
//     in a URL, and never stored;
//   • responses are validated against the mirrored contract before any screen sees them, so a
//     shape change surfaces as an explicit error rather than as blank cells;
//   • the GovAI envelope AND the two non-GovAI shapes (rate-limit 429, framework 404) are
//     normalized into one typed ApiError;
//   • 429 is retried here, bounded and Retry-After aware; 5xx/network retries are the query
//     layer's bounded responsibility (queryClient.ts) so the two never compound;
//   • no request is ever retried forever, and no failure is swallowed.
//
// This client makes no governance decision of its own. It maps transport facts to typed
// errors; every judgement about what those facts MEAN belongs to honesty.ts.

import type { z } from 'zod';
import { ApiError, GovAIErrorBody, kindForStatus } from '../contract/errors.js';

/**
 * Bounded 429 policy. At most four attempts; without a `Retry-After` the delay grows
 * 500ms → 1s → 2s, capped at 8s.
 *
 * `Retry-After` is an INSTRUCTION, not a hint to shorten. Capping it would retry inside the
 * window the server just told us to stay out of — three doomed requests against a limit that
 * is already saturated, and still an error at the end. So an advertised wait we can afford is
 * honoured exactly, and one we cannot is not retried at all: the 429 surfaces immediately,
 * carrying the advertised wait so the screen can state how long the reader must wait.
 */
const RATE_LIMIT_MAX_ATTEMPTS = 4;
const RATE_LIMIT_BASE_DELAY_MS = 500;
const RATE_LIMIT_MAX_DELAY_MS = 8_000;

export type QueryParams = Record<string, string | number | undefined>;

export type RequestOptions<T> = {
  query?: QueryParams;
  /** Contract schema. Always supplied by the resource hooks — a response nobody validated is
   *  a response nobody can vouch for. */
  schema: z.ZodType<T>;
  signal?: AbortSignal;
  /**
   * Use this credential instead of the stored one. The ONLY caller is the /enter probe, which
   * must validate a candidate key before the session accepts it. Passing it explicitly keeps
   * "the key is either a function argument or the one in-memory cell" literally true.
   */
  credential?: string;
};

export type ApiClient = {
  get<T>(path: string, options: RequestOptions<T>): Promise<T>;
  /** The resolved base URL, exported for the query-export context block. */
  readonly baseUrl: string;
};

export type ApiClientConfig = {
  /** '' means same-origin. Any trailing slash is normalized away. */
  baseUrl?: string;
  getCredential: () => string | null;
  /** Invoked on a 401 so the session can drop the credential and route to /enter. */
  onUnauthorized?: () => void;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests so the bounded 429 backoff does not sleep in a unit test. */
  sleep?: (ms: number) => Promise<void>;
};

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

function buildUrl(baseUrl: string, path: string, query?: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return `${baseUrl}${path}${qs ? `?${qs}` : ''}`;
}

/** `Retry-After` may be delta-seconds or an HTTP date. Anything else yields null. */
export function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

/**
 * How long to wait before the next 429 attempt, or `null` for "do not retry" — the server
 * asked for longer than this client is willing to block. Exported so the policy is testable
 * without driving a real request.
 */
export function rateLimitDelayMs(
  attempt: number,
  retryAfterSeconds: number | null,
): number | null {
  if (retryAfterSeconds !== null) {
    const advertisedMs = retryAfterSeconds * 1000;
    return advertisedMs > RATE_LIMIT_MAX_DELAY_MS ? null : advertisedMs;
  }
  return Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt, RATE_LIMIT_MAX_DELAY_MS);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? '');
  const doFetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sleep = config.sleep ?? defaultSleep;

  async function get<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const credential = options.credential ?? config.getCredential();
    if (credential === null || credential.length === 0) {
      // Never send an unauthenticated read: it would produce a 401 that looks like a rejected
      // key rather than "there is no session".
      throw new ApiError({ kind: 'auth', message: 'no credential in session' });
    }

    const url = buildUrl(baseUrl, path, options.query);

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await doFetch(url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            'x-govai-api-key': credential,
          },
          signal: options.signal ?? null,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
        });
      } catch (err) {
        // An aborted request is the caller's own cancellation, not a fault to report.
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        throw new ApiError({ kind: 'network', message: 'request did not reach the GovAI API' });
      }

      if (response.status === 429 && attempt < RATE_LIMIT_MAX_ATTEMPTS - 1) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'), Date.now());
        const delayMs = rateLimitDelayMs(attempt, retryAfter);
        if (delayMs !== null) {
          await sleep(delayMs);
          if (options.signal?.aborted) {
            throw new DOMException('aborted', 'AbortError');
          }
          continue;
        }
        // Advertised wait exceeds what we will block for: fall through and report the 429
        // with `retryAfterSeconds`, rather than retrying inside the blocked window.
      }

      if (!response.ok) {
        throw await toApiError(response, config.onUnauthorized);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ApiError({
          kind: 'malformed_response',
          status: response.status,
          message: 'response body was not JSON',
        });
      }

      const parsed = options.schema.safeParse(body);
      if (!parsed.success) {
        // Deliberately no body echo: a contract mismatch is diagnosed from the schema, and
        // echoing an unexpected payload into an error message is how data leaks into logs.
        throw new ApiError({
          kind: 'malformed_response',
          status: response.status,
          message: 'response did not match the mirrored contract',
        });
      }
      return parsed.data;
    }
  }

  return { get, baseUrl };
}

async function toApiError(
  response: Response,
  onUnauthorized: (() => void) | undefined,
): Promise<ApiError> {
  const kind = kindForStatus(response.status);
  let code: string | null = null;
  let issues: unknown[] | null = null;

  // The body is best-effort: 429 and the framework 404 do not carry a GovAI code, and a
  // proxy may return HTML. A missing code must never turn into a thrown parse error.
  try {
    const body: unknown = await response.json();
    const envelope = GovAIErrorBody.safeParse(body);
    if (envelope.success) {
      code = envelope.data.error;
      issues = envelope.data.issues ?? null;
    }
  } catch {
    code = null;
  }

  if (kind === 'auth') onUnauthorized?.();

  return new ApiError({
    kind,
    status: response.status,
    code,
    issues,
    retryAfterSeconds:
      kind === 'rate_limited'
        ? parseRetryAfter(response.headers.get('retry-after'), Date.now())
        : null,
    message: `govai api ${response.status}${code ? ` (${code})` : ''}`,
  });
}
