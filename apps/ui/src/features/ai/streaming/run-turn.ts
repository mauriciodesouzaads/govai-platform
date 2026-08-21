// One provider call, start to terminal state.
//
// This is the ONLY function in the console that issues a provider request, and it is called
// exclusively from an explicit user action (send / retry). It is never called from a React
// effect: under StrictMode an effect runs twice in development, and a provider POST that runs
// twice is a duplicated provider execution, a duplicated bill and a duplicated audit event.
// Keeping provider dispatch out of effects is what makes that class of bug unreachable rather
// than merely untested.
//
// ★ ONE ATTEMPT. There is no retry anywhere in this file — not for 429, not for 5xx, not for a
// network fault. The provider may have executed a request whose result this browser never
// received; an automatic retry would ask it to do so again. Retry is a decision only the
// reader can make, and the UI labels the button as what it is: a NEW provider call.
//
// ★ A CLASSIFICATION IS NEVER MORE CONFIDENT THAN THE EVIDENCE. `completed` requires the
// provider's own terminal event. Text without one is `unknown_outcome`. A request that left
// the browser and produced no response is `network_error`, which the copy states as "outcome
// not confirmed" — never as "the provider did not run it", which this browser cannot know.

import type { ApiClient } from '../../../lib/api/client.js';
import {
  readGovernanceFacts,
  readProviderRequestId,
  readRetryAfterSeconds,
} from '../conversation/receipt.js';
import type { InteractionReceipt, TurnState } from '../conversation/types.js';
import {
  EMPTY_PROVIDER_ERROR,
  providerErrorFromText,
  type SafeProviderError,
} from '../providers/errors.js';
import { turnPath, type ConsoleMode, type ContextMessage, type ProviderAdapter } from '../providers/types.js';
import { pumpSse } from './sse.js';

export type RunTurnInput = {
  client: ApiClient;
  adapter: ProviderAdapter;
  mode: ConsoleMode;
  model: string;
  maxTokens: number;
  history: readonly ContextMessage[];
  prompt: string;
  signal: AbortSignal;
  /** Called with the accumulated answer so far, as it streams. */
  onText: (text: string) => void;
  /** Called once, when response headers arrive and the body starts streaming. */
  onStreamStart?: () => void;
  /** Injectable monotonic clock (tests). Defaults to performance.now(). */
  now?: () => number;
};

export type RunTurnResult = {
  state: TurnState;
  text: string;
  refusal: string | null;
  unsupportedOutput: boolean;
  error: SafeProviderError | null;
  retryAfterSeconds: number | null;
  receipt: InteractionReceipt;
};

/**
 * GovAI's own pre-provider denial codes, from the four direct routes. GovAI does not call the
 * provider for any of them — proven at source.
 *
 * ★ WHAT THIS DOES NOT ESTABLISH. The routes relay an upstream's status AND body verbatim, so
 * a 403 carrying one of these codes is *almost certainly* GovAI's but cannot be PROVEN to be:
 * an upstream emitting the same envelope would look identical, and no response header settles
 * it either (relayed headers pass through). The state and badge are still `blocked` — a 403 was
 * genuinely observed — but the accompanying copy states the rule and attributes the code to the
 * response, rather than asserting that this particular response originated at GovAI and that
 * the provider therefore never ran. Same provenance limit as the 401 rule in lib/api/client.ts;
 * closing it is EP-PROVIDER-RESPONSE-HEADER-PROVENANCE.
 */
const GOVAI_PRE_PROVIDER_BLOCK_CODES = new Set([
  'beta_denied', // packages/provider-{openai,anthropic}/src/routes/register-passthrough.ts
  'tool_blocked_until_governance_primitive', // idem
  'governed_blocked', // packages/provider-{openai,anthropic}/src/governed/register-governed.ts
]);

/** Fastify's machine code for a body over `bodyLimit`. GovAI sets no bodyLimit, so the
 *  framework default (1 MiB) is the real ceiling, and this code is the only thing that proves
 *  the rejection was GovAI-local rather than the provider's own size check. */
export const FASTIFY_BODY_TOO_LARGE_CODE = 'FST_ERR_CTP_BODY_TOO_LARGE';

export function isPreProviderBlockCode(code: string | null): boolean {
  return code !== null && GOVAI_PRE_PROVIDER_BLOCK_CODES.has(code);
}

const defaultNow = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const now = input.now ?? defaultNow;
  const startedAt = now();
  const endpoint = turnPath(input.mode, input.adapter);

  const baseReceipt = (): InteractionReceipt => ({
    provider: input.adapter.provider,
    surface: input.adapter.surface,
    mode: input.mode,
    model: input.model,
    endpoint,
    status: null,
    providerRequestId: null,
    providerMessageId: null,
    clientDurationMs: Math.round(now() - startedAt),
    state: 'network_error',
    stopReason: null,
    governance: null,
  });

  const body = input.adapter.buildBody({
    model: input.model,
    history: input.history,
    prompt: input.prompt,
    maxTokens: input.maxTokens,
  });

  let response: Awaited<ReturnType<ApiClient['stream']>>;
  try {
    response = await input.client.stream(endpoint, {
      body,
      signal: input.signal,
      // A relayed provider 401 must not end the GovAI session — see lib/api/client.ts.
      authScope: 'provider-native',
    });
  } catch (err) {
    if (isAbort(err)) {
      // Aborted before any response: nothing streamed, and the request may still have
      // reached the provider. Stopped is what the reader did; the receipt says no more.
      return earlyTermination('stopped', baseReceipt());
    }
    // Two causes, both reported as an unconfirmed outcome:
    //   • the request left the browser and produced no response — genuinely unconfirmed;
    //   • there is no credential in the session, so it never left at all (unreachable from
    //     the console, which only renders inside the authenticated route guard).
    // The second is a WEAKER claim than the truth, which is the safe direction: this screen
    // may under-state what it knows, never over-state it.
    return earlyTermination('network_error', baseReceipt());
  }

  const providerRequestId = readProviderRequestId(response.headers, input.adapter);

  // ── Non-2xx: the response IS the answer, and it is read once, bounded. ──────────────────
  if (!response.ok) {
    const text = await response.readBoundedText();
    const error = providerErrorFromText(text, response.status);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
    const governance = readGovernanceFacts(input.mode, response.headers, parsed);
    const state = classifyErrorStatus(response.status, error);
    return {
      state,
      text: '',
      refusal: null,
      unsupportedOutput: false,
      error,
      retryAfterSeconds:
        state === 'rate_limited' ? readRetryAfterSeconds(response.headers) : null,
      receipt: {
        ...baseReceipt(),
        status: response.status,
        providerRequestId,
        state,
        governance,
      },
    };
  }

  const governance = readGovernanceFacts(input.mode, response.headers, null);

  if (response.body === null) {
    // A 2xx with no body at all: nothing streamed and no terminal marker can ever arrive.
    return {
      state: 'unknown_outcome',
      text: '',
      refusal: null,
      unsupportedOutput: false,
      error: null,
      retryAfterSeconds: null,
      receipt: {
        ...baseReceipt(),
        status: response.status,
        providerRequestId,
        state: 'unknown_outcome',
        governance,
      },
    };
  }

  input.onStreamStart?.();

  const accumulator = input.adapter.createAccumulator();
  try {
    await pumpSse({
      body: response.body,
      signal: input.signal,
      onFrame: (frame) => {
        accumulator.accept(frame);
        input.onText(accumulator.snapshot().text);
      },
      // ★ Stop at the provider's terminal event, not at EOF. See PumpSseInput.stopWhen: a
      // connection held open after the answer is finished would otherwise keep the turn in
      // `streaming`, keep its duration climbing, and keep a completed answer out of context.
      stopWhen: () => accumulator.snapshot().terminal !== null,
    });
  } catch {
    // The stream itself errored mid-flight. Whatever arrived is KEPT and the classification
    // below decides: a terminal marker that already arrived is still proof the provider
    // finished, and its absence still means the outcome is unconfirmed. Nothing about the
    // fault itself is surfaced — a transport exception carries no provider semantics, and
    // rendering one would put an internal message where a provider's words belong.
  }

  const snapshot = accumulator.snapshot();
  const aborted = input.signal.aborted;

  // ★ THE TERMINAL MARKER OUTRANKS THE ABORT, and the order of this expression is the whole
  // point. A provider can send its terminal event and leave the connection open afterwards —
  // which the acceptance stack does for seconds at a time — so Stop is still on screen when the
  // answer is already visibly finished. Letting `aborted` win there would relabel a completed,
  // billed execution as "stopped by you": the receipt would be wrong, and the answer would be
  // dropped from later context for a failure that did not happen.
  //
  // A terminal marker is PROOF the provider finished. Nothing that happens to the socket
  // afterwards — an abort, a fault, a truncation — can retract it. The fault path below already
  // behaved this way; the abort path now agrees with it.
  const state: TurnState =
    snapshot.terminal?.kind === 'error'
      ? 'provider_error'
      : snapshot.terminal?.kind === 'completed'
        ? 'completed'
        : aborted
          ? 'stopped'
          : /* no terminal marker: the stream ended, but nothing confirmed it */ 'unknown_outcome';

  return {
    state,
    text: snapshot.text,
    refusal: snapshot.refusal,
    unsupportedOutput: snapshot.unsupportedOutput,
    error: snapshot.terminal?.kind === 'error' ? snapshot.terminal.error : null,
    retryAfterSeconds: null,
    receipt: {
      ...baseReceipt(),
      status: response.status,
      providerRequestId,
      providerMessageId: snapshot.providerMessageId,
      state,
      stopReason: snapshot.terminal?.kind === 'completed' ? snapshot.terminal.stopReason : null,
      governance,
    },
  };
}

/** A result for a turn that ended before any provider bytes were read. */
function earlyTermination(state: TurnState, receipt: InteractionReceipt): RunTurnResult {
  return {
    state,
    text: '',
    refusal: null,
    unsupportedOutput: false,
    error: state === 'network_error' ? { ...EMPTY_PROVIDER_ERROR } : null,
    retryAfterSeconds: null,
    receipt: { ...receipt, state },
  };
}

function isAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

/**
 * Map a non-2xx status to a turn state.
 *
 * `blocked` is reserved for a status the SOURCE proves happened before the provider ran: a
 * GovAI 403 carrying one of the three pre-provider denial codes. A provider's OWN 403 (a
 * content policy refusal, say) is a provider error, because the provider is exactly who ran
 * it — the distinction is the whole point of the code check.
 *
 * `request_too_large` applies the SAME rule to 413. GovAI configures no `bodyLimit`, so
 * Fastify's default 1 MiB applies and an oversized body is rejected by the framework before
 * either provider route runs — reachable, because the composer accepts an arbitrarily long
 * prompt and multi-turn history accumulates. Calling that `provider_error` would print "the
 * provider answered with an error" for a call the provider never received, which is exactly
 * the kind of thing this console exists not to say. It is keyed on Fastify's own machine code,
 * never on the bare status: a provider's own 413 stays a provider error.
 */
export function classifyErrorStatus(status: number, error: SafeProviderError): TurnState {
  if (status === 403 && isPreProviderBlockCode(error.code)) return 'blocked';
  if (status === 413 && error.code === FASTIFY_BODY_TOO_LARGE_CODE) return 'request_too_large';
  if (status === 429) return 'rate_limited';
  if (status === 502 && error.code === 'provider_credential_unresolvable') {
    return 'credential_unavailable';
  }
  return 'provider_error';
}
