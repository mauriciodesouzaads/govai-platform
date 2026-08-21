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

/**
 * Ceiling on a SUCCESSFUL body whose content is provider-controlled (`authScope:
 * 'provider-native'` — today, model discovery).
 *
 * `response.json()` reads to completion, so an enormous or never-ending 2xx from a provider or
 * an intermediary would hang the screen that issues it — and model discovery runs the moment
 * `/ai` opens. GovAI's OWN reads are left unbounded on purpose: their size is governed by the
 * route's own `limit`, they are first-party, and imposing a ceiling there would risk truncating
 * a legitimate evidence page into a contract error.
 *
 * 2 MiB is roughly ten thousand model entries — far above any real listing (the live
 * acceptance saw 124 from OpenAI and 10 from Anthropic) and far below anything that could
 * exhaust a tab.
 */
const PROVIDER_NATIVE_BODY_MAX_BYTES = 2 * 1024 * 1024;

/** Sentinel for "the read deadline won the race". A unique object, so it can never collide with
 *  a legitimate `ReadableStreamReadResult`. */
const READ_DEADLINE = Symbol('bounded-read-deadline');

/**
 * Total wall-clock ceiling on ONE JSON read — the header wait AND the body read together.
 *
 * ★ THE CLASS: every await on a remote party needs a clock, and a JSON read has two of them.
 * Bounding the body alone left the earlier half unbounded: a server that accepts the connection
 * and never sends response headers leaves `fetch` pending forever, and `/ai` shows its model
 * listing as loading until the reader navigates away. Fixing one half and not the other is how
 * this defect survived its own fix, so the deadline is applied at the REQUEST, where it covers
 * both — the same signal aborts the fetch and stops the read.
 *
 * `stream()` is deliberately exempt and says so at its own call site: a long provider stream is
 * SUPPOSED to stay open, and its liveness is the caller's Stop button plus the terminal-marker
 * rule, not a timer.
 *
 * Generous enough that a slow but real response completes, short enough that a silent one does
 * not strand a screen.
 *
 * ★ WHAT AN INTERRUPTION IS REPORTED AS, everywhere in `get()` — one taxonomy, three answers:
 *
 *   the CALLER aborted        re-thrown untouched; it is their cancellation, not a fault
 *   OUR deadline fired        `network` — nobody cancelled it, so "cancelled" would be a lie,
 *                             and `network` is the kind the query layer may retry
 *   anything else             its own kind (`malformed_response`, the status-derived kinds…)
 *
 * The rule is to ask the SIGNAL, never to pattern-match the error: an abort surfaces as a fetch
 * rejection, as a `json()` rejection, and as a truncated body that fails to parse, and only the
 * first of those looks like an abort at all.
 */
const JSON_REQUEST_TIMEOUT_MS = 15_000;

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
      // ★ ONE DEADLINE PER ATTEMPT, COVERING BOTH HALVES OF THE READ.
      //
      // It is passed to `fetch`, so it bounds the header wait; and because aborting a fetch's
      // signal ERRORS the response body stream, the same abort also ends a body read already in
      // progress. That is what makes it one clock rather than two — bounding the body alone left
      // the header wait unbounded, which is how a server that accepts the connection and never
      // answers kept `/ai` in `loading` until the reader navigated away.
      //
      // Composed WITH the caller's signal so a lifecycle abort still wins immediately, and
      // released on every exit path — including the 429 `continue`, which arms a fresh one.
      const deadline = new AbortController();
      const timer = setTimeout(() => {
        deadline.abort(new DOMException('request deadline elapsed', 'TimeoutError'));
      }, JSON_REQUEST_TIMEOUT_MS);
      const onCallerAbort = (): void => {
        deadline.abort(options.signal?.reason);
      };
      if (options.signal) {
        if (options.signal.aborted) onCallerAbort();
        else options.signal.addEventListener('abort', onCallerAbort, { once: true });
      }
      const releaseDeadline = (): void => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onCallerAbort);
      };

      try {
        let response: Response;
        try {
          response = await doFetch(url, {
            method: 'GET',
            headers: {
              accept: 'application/json',
              'x-govai-api-key': credential,
            },
            signal: deadline.signal,
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
          });
        } catch (err) {
          // The CALLER's cancellation is theirs, and is re-thrown untouched. OUR deadline is not
          // the caller's abort: a stalled server is a network condition and must surface as one,
          // or the screen would render "cancelled" for something nobody cancelled.
          if (options.signal?.aborted) throw err;
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw new ApiError({
              kind: 'network',
              message: 'the GovAI API did not respond in time',
            });
          }
          throw new ApiError({ kind: 'network', message: 'request did not reach the GovAI API' });
        }

        if (response.status === 429 && attempt < RATE_LIMIT_MAX_ATTEMPTS - 1) {
          const retryAfter = parseRetryAfter(response.headers.get('retry-after'), Date.now());
          const delayMs = rateLimitDelayMs(attempt, retryAfter);
          if (delayMs !== null) {
            // ★ THE RETRY DISCARDS THIS RESPONSE, SO CLOSE IT. A 429 from a proxy or a provider
            // can arrive with its body still open, and nothing here will ever read it — the
            // retry is a NEW request. An abandoned body holds its connection until GC, up to
            // RATE_LIMIT_MAX_ATTEMPTS times per query and again on every refetch, which is how
            // a rate-limited model listing quietly strands connections. Every other path in
            // this client either consumes its body or cancels it; this was the one that did
            // neither.
            await response.body?.cancel().catch(() => undefined);
            // Release BEFORE sleeping: the backoff is deliberately outside the request deadline
            // (an advertised Retry-After may exceed it), and the next attempt arms its own.
            releaseDeadline();
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
          // A provider-controlled 2xx is read under a bound; GovAI's own is not. See
          // PROVIDER_NATIVE_BODY_MAX_BYTES.
          body =
            authScope === 'provider-native'
              ? JSON.parse(await readBoundedText(response, PROVIDER_NATIVE_BODY_MAX_BYTES))
              : await response.json();
        } catch (err) {
          // ★ AN INTERRUPTED READ IS NOT A SYNTAX ERROR, and the difference is not cosmetic.
          //
          // Both shapes arrive here looking identical to malformed JSON: `response.json()`
          // rejects with the abort, and `readBoundedText` swallows it and returns a truncated
          // body that then fails to parse. But `malformed_response` is a PERMANENT kind — the
          // query layer does not retry it — so labelling a transient stall that way tells the
          // reader the API returned an invalid contract, and denies it the bounded retry a
          // network condition would get. Ask the SIGNAL what happened rather than the error.
          if (options.signal?.aborted) throw err; // the caller's cancellation, untouched
          if (deadline.signal.aborted) {
            throw new ApiError({
              kind: 'network',
              message: 'the GovAI API did not respond in time',
            });
          }
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
      } finally {
        // Idempotent: the 429 path already released before sleeping.
        releaseDeadline();
      }
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
 *
 * ★ A SIZE BOUND IS NOT A TIME BOUND, and only one of the two was here. A response that sends
 * a few bytes under `maxBytes` and then simply holds the connection open never reaches the
 * ceiling, so the loop waited on a `read()` that would not resolve — model discovery sat in its
 * loading state until the reader navigated away. The two bounds are independent and the read
 * needs both: whichever is reached first stops it, and the `finally` cancels the reader either
 * way, which tears the connection down rather than leaking it.
 *
 * The deadline is TOTAL, not per-chunk. A per-chunk timer would let a body that trickles one
 * byte inside every interval hold the read open indefinitely, which is the same defect wearing
 * a different shape.
 *
 * A timed-out read returns what it has, exactly as a truncated one does: partial error detail is
 * still worth showing, and it is never the primary signal — the STATUS is.
 */
async function readBoundedText(
  response: Response,
  maxBytes: number,
  timeoutMs: number = JSON_REQUEST_TIMEOUT_MS,
): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let out = '';
  let read = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof READ_DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(READ_DEADLINE), timeoutMs);
  });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next === READ_DEADLINE) break;
      const { value, done } = next;
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
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
  return out;
}

/**
 * ★ ENDING A SESSION IS DESTRUCTIVE, SO ONLY GOVAI'S OWN ROUTES MAY CAUSE IT.
 *
 * On a `provider-native` path this NEVER fires, and the reason is provenance rather than
 * caution. A 401 there may have come from GovAI (which rejects before calling the provider) or
 * from the provider (whose status AND body are relayed verbatim), and nothing in the response
 * distinguishes them: `GovAIErrorBody` validates SHAPE, not origin, so an upstream that answers
 * `{"error":"auth_error"}` would look exactly like GovAI. Nor is there a header to fall back
 * on — the direct routes relay every upstream response header that is not hop-by-hop, so a
 * `x-govai-*` marker could be supplied by the upstream too.
 *
 * Trusting that body would let a third party sign the reader out and discard a conversation in
 * progress. So a relayed body may LABEL an error — the receipt shows the status and the code it
 * carried — and may never DESTROY a session.
 *
 * The cost is bounded and self-correcting: a GovAI key that really has expired still ends the
 * session at the next GovAI-scoped read, which is where that authority belongs. Closing the gap
 * properly needs a server-originated signal the upstream cannot forge — GovAI stripping inbound
 * `x-govai-*` from relayed provider responses before setting its own. That is a backend
 * contract, and it is named as a follow-up rather than guessed at from the client.
 */
function notifyUnauthorizedFromText(
  _text: string,
  onUnauthorized: (() => void) | undefined,
  authScope: AuthScope,
): void {
  if (!onUnauthorized) return;
  if (authScope === 'govai') onUnauthorized();
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

  // ★ Same provenance rule as the streaming path: a `provider-native` 401 never ends the
  // session, because the body that would justify it is relayed from an upstream and its shape
  // proves nothing about its origin. See notifyUnauthorizedFromText.
  if (kind === 'auth' && authScope === 'govai') onUnauthorized?.();

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
