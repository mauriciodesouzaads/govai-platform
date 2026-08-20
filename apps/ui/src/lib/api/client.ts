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
//   • 429 is retried here for READS ONLY, bounded and Retry-After aware; 5xx/network retries
//     are the query layer's bounded responsibility (queryClient.ts) so the two never compound;
//   • no request is ever retried forever, and no failure is swallowed.
//
// This client makes no governance decision of its own. It maps transport facts to typed
// errors; every judgement about what those facts MEAN belongs to honesty.ts.
//
// ── U1.5 (AI Console): ONE transport, three verbs ──────────────────────────────────────────
// The AI Console needs a provider-native POST and a streaming read. The architecture rule is
// that the UI has ONE credential-aware browser client, so this file grew two methods rather
// than the console growing a client of its own:
//
//   get(path, opts)          JSON read, schema-validated, bounded 429 retry   (unchanged)
//   stream(path, opts)       POST returning the RAW response + byte stream    (new)
//
// Two properties the new surface must never lose:
//
//   ★ 1. A PROVIDER POST IS NEVER RETRIED. Not on 429, not on 5xx, not on a network fault.
//      The provider may have executed and billed a request whose result this browser never
//      saw; retrying it automatically would duplicate provider execution, billing and audit
//      events. `stream()` therefore has NO retry loop at all — not a smaller one, none — and
//      a test pins the attempt count at exactly one. Retry is a user action, upstream of here.
//
//   ★ 2. A PROVIDER 401 IS NOT NECESSARILY A GOVAI 401. The direct provider routes relay the
//      upstream status verbatim (packages/provider-{openai,anthropic}/src/routes/register-passthrough.ts), so
//      a rejected PROVIDER key arrives as a 401 whose body is the provider's own error shape.
//      Ending the GovAI session on that would sign the reader out because someone else's
//      credential is wrong. `authScope: 'provider-native'` therefore ends the session only
//      when the body actually carries GovAI's own `auth_error` envelope — the code every
//      GovAI auth failure returns (routes/me.ts, evidence.ts, and both provider plugins'
//      `reply.code(401); return { error: 'auth_error', … }`). The default is unchanged.

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
 *
 * ★ READ-ONLY. This policy governs `get()` and nothing else. See the file header, rule 1.
 */
const RATE_LIMIT_MAX_ATTEMPTS = 4;
const RATE_LIMIT_BASE_DELAY_MS = 500;
const RATE_LIMIT_MAX_DELAY_MS = 8_000;

export type QueryParams = Record<string, string | number | undefined>;

/**
 * Which 401s end the session.
 *
 * `govai` (default) — every 401 on this path is GovAI rejecting the session credential.
 * `provider-native` — the route relays a provider status, so only GovAI's own `auth_error`
 * envelope ends the session; a provider-issued 401 is reported to the caller instead.
 */
export type AuthScope = 'govai' | 'provider-native';

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
  /** See {@link AuthScope}. Defaults to `govai`. */
  authScope?: AuthScope;
};

export type StreamOptions = {
  /** Provider-native request body. Serialized here; the caller never builds the string. */
  body: unknown;
  /** Extra provider-native request headers. MUST NOT carry any credential — the transport
   *  owns credentials and strips nothing, so a caller that passed one would be leaking it
   *  past the one place that is allowed to know about keys. A test pins that the only
   *  credential-bearing header the transport emits is `x-govai-api-key`. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  authScope?: AuthScope;
};

/**
 * The raw result of a streaming POST. Deliberately NOT normalized into success/failure: a
 * provider's own 400/429/500 is a fact the console must render, not an exception to swallow,
 * and the byte stream belongs to the caller's SSE reader.
 */
export type StreamResponse = {
  status: number;
  ok: boolean;
  /** The response headers, as received. Same-origin, so nothing is hidden from the browser. */
  headers: Headers;
  /** Present on any response that carried a body. Null when the response had none. */
  body: ReadableStream<Uint8Array> | null;
  /** Read the body as text, bounded. For an error response only — draining a stream here
   *  would consume the bytes the SSE reader needs. */
  readBoundedText: (maxBytes?: number) => Promise<string>;
};

export type ApiClient = {
  get<T>(path: string, options: RequestOptions<T>): Promise<T>;
  /** Provider-native streaming POST. NEVER retried. See the file header, rule 1. */
  stream(path: string, options: StreamOptions): Promise<StreamResponse>;
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

/** Default ceiling on an error body the UI reads back for diagnosis. A provider may answer
 *  with anything; the console renders bounded, whitelisted fields and never a raw dump. */
const DEFAULT_ERROR_BODY_MAX_BYTES = 16 * 1024;

export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? '');
  const doFetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sleep = config.sleep ?? defaultSleep;

  /** The one place a credential is read, and the one place it becomes a header. */
  function requireCredential(explicit?: string): string {
    const credential = explicit ?? config.getCredential();
    if (credential === null || credential.length === 0) {
      // Never send an unauthenticated read: it would produce a 401 that looks like a rejected
      // key rather than "there is no session".
      throw new ApiError({ kind: 'auth', message: 'no credential in session' });
    }
    return credential;
  }

  async function get<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const credential = requireCredential(options.credential);
    const url = buildUrl(baseUrl, path, options.query);
    const authScope = options.authScope ?? 'govai';

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
        throw await toApiError(response, config.onUnauthorized, authScope);
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

  async function stream(path: string, options: StreamOptions): Promise<StreamResponse> {
    const credential = requireCredential();
    const url = buildUrl(baseUrl, path);
    const authScope = options.authScope ?? 'govai';

    // ★ NO LOOP. One attempt, ever. See the file header, rule 1.
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          ...(options.headers ?? {}),
          // Set AFTER the caller's headers so a provider-native header can never displace
          // the credential header or the content type the body is actually serialized as.
          accept: 'text/event-stream, application/json',
          'content-type': 'application/json',
          'x-govai-api-key': credential,
        },
        body: JSON.stringify(options.body),
        signal: options.signal ?? null,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      // The request left this browser but produced no response. The caller MUST NOT report
      // this as "the provider did not run it" — see honesty in the turn state machine.
      throw new ApiError({ kind: 'network', message: 'request did not reach the GovAI API' });
    }

    // ── A non-2xx body is NEVER a stream ────────────────────────────────────────────────
    // It is a bounded error payload the caller renders, so it is read ONCE, here, under the
    // bound — and the caller is handed the text rather than a body.
    //
    // ★ WHY NOT `response.clone()`. Cloning TEES the body: draining one branch pulls from the
    // source and queues every chunk into the other, unread branch. Reading a clone with
    // `.json()` to decide whether a 401 is GovAI's own therefore buffers the WHOLE body, twice,
    // before this function returns — on precisely the provider-controlled error responses the
    // bounded reader exists to contain. A hostile or merely enormous 401 (an intermediary's
    // HTML error page, a proxy that never stops writing) would hang the console with the bound
    // sitting unused two lines below. One bounded read, no tee, no second copy.
    if (!response.ok) {
      const text = await readBoundedText(response, DEFAULT_ERROR_BODY_MAX_BYTES);
      if (response.status === 401) {
        notifyUnauthorizedFromText(text, config.onUnauthorized, authScope);
      }
      return {
        status: response.status,
        ok: false,
        headers: response.headers,
        // Already consumed, and consumed under the bound. Saying `null` is the truth.
        body: null,
        readBoundedText: async (maxBytes = DEFAULT_ERROR_BODY_MAX_BYTES) =>
          maxBytes < text.length ? text.slice(0, maxBytes) : text,
      };
    }

    return {
      status: response.status,
      ok: true,
      headers: response.headers,
      body: response.body,
      readBoundedText: (maxBytes = DEFAULT_ERROR_BODY_MAX_BYTES) =>
        readBoundedText(response, maxBytes),
    };
  }

  return { get, stream, baseUrl };
}

/**
 * Read at most `maxBytes` of a response body as UTF-8 text. A provider error body is
 * attacker-influenced input of unknown size; the console parses a fixed set of fields out of
 * it and must never buffer an unbounded response to do so.
 */
async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let out = '';
  let read = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      read += value.byteLength;
      // ★ `>=`, NOT `>`. A body that supplies exactly `maxBytes` and then holds the connection
      // open would leave a strict `>` false, and the next `read()` would wait forever — the
      // bound would be reached and never acted on. Reaching the limit is the stop condition;
      // exceeding it is just the common way of reaching it.
      if (read >= maxBytes) {
        const keep = Math.max(0, value.byteLength - (read - maxBytes));
        out += decoder.decode(value.subarray(0, keep));
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
  } catch {
    // A truncated error body is still worth what was read; it is never the primary signal.
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out;
}

/**
 * Decide, from ALREADY-BOUNDED text, whether a 401 is GovAI rejecting the session.
 *
 * Takes text rather than a Response on purpose: the caller has already read the body once,
 * under the bound, and there is no second read and no clone to be had. A body truncated at the
 * bound simply fails to parse, which resolves to "not a GovAI envelope" — the safe direction,
 * because it keeps the reader signed in rather than ending a session on an unreadable payload.
 */
function notifyUnauthorizedFromText(
  text: string,
  onUnauthorized: (() => void) | undefined,
  authScope: AuthScope,
): void {
  if (!onUnauthorized) return;
  if (authScope === 'govai') {
    onUnauthorized();
    return;
  }
  if (govaiErrorCodeFromText(text) === 'auth_error') onUnauthorized();
}

/** The GovAI machine code carried by a body, or null when it is not a GovAI envelope (a
 *  provider error object, HTML from a proxy, an empty or truncated body). */
function govaiErrorCodeFromText(text: string): string | null {
  try {
    const body: unknown = JSON.parse(text);
    const envelope = GovAIErrorBody.safeParse(body);
    return envelope.success ? envelope.data.error : null;
  } catch {
    return null;
  }
}

async function toApiError(
  response: Response,
  onUnauthorized: (() => void) | undefined,
  authScope: AuthScope,
): Promise<ApiError> {
  const kind = kindForStatus(response.status);
  let code: string | null = null;
  let issues: unknown[] | null = null;

  // The body is best-effort: 429 and the framework 404 do not carry a GovAI code, and a
  // proxy may return HTML. A missing code must never turn into a thrown parse error.
  //
  // ★ READ IT BOUNDED. `response.json()` reads to completion, and since model discovery
  // (`GET /passthrough/*/v1/models`) relays PROVIDER error bodies verbatim, that is an
  // unbounded, provider-controlled read on the path that runs when `/ai` opens: a huge or
  // never-ending provider error would hang the model query or exhaust memory. The same policy
  // the streaming path uses applies here — one bounded read, then parse. A body truncated at
  // the bound simply fails to parse, which yields `code: null`, which is exactly the
  // "no GovAI code present" case this block already handles.
  try {
    const envelope = GovAIErrorBody.safeParse(
      JSON.parse(await readBoundedText(response, DEFAULT_ERROR_BODY_MAX_BYTES)) as unknown,
    );
    if (envelope.success) {
      code = envelope.data.error;
      issues = envelope.data.issues ?? null;
    }
  } catch {
    code = null;
  }

  // `provider-native` ends the session only for GovAI's own auth envelope — a relayed
  // PROVIDER 401 means the provider credential is wrong, not the reader's session key.
  if (kind === 'auth' && (authScope === 'govai' || code === 'auth_error')) onUnauthorized?.();

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
