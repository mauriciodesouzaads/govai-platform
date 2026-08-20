// The conversation model, and the facts a turn is allowed to claim.

import type { EnforcementDecision, BlockTrigger } from '../../../lib/honesty.js';
import type { SafeProviderError } from '../providers/errors.js';
import type { ConsoleMode, ContextMessage, ProviderId, SurfaceId } from '../providers/types.js';

/**
 * The turn state machine (mission §21).
 *
 * ★ SUCCESS IS A MARKER, NOT AN ABSENCE OF FAILURE. `completed` is reached only when the
 * provider stream carried its own terminal completion event. A stream that delivered text and
 * then stopped without one is `unknown_outcome`: the browser cannot tell a finished answer
 * from a cut connection, and the two must not render as the same thing.
 */
export type TurnState =
  /** The POST has left the browser; no response headers yet. */
  | 'submitting'
  /** Response headers received; the body is streaming. */
  | 'streaming'
  /** The provider's own terminal completion marker arrived. The ONLY state that commits context. */
  | 'completed'
  /** The reader pressed Stop. Partial text is kept and labelled. */
  | 'stopped'
  /** GovAI answered 403 before the provider ran, or the governed matrix blocked it. */
  | 'blocked'
  /** The provider answered with an error (its own 4xx/5xx, or a terminal error event). */
  | 'provider_error'
  /** 429 from GovAI's limiter or from the provider. Never retried automatically. */
  | 'rate_limited'
  /** 502 provider_credential_unresolvable — an operator/configuration condition. */
  | 'credential_unavailable'
  /** The request never produced a response. NOT proof the provider did not run it. */
  | 'network_error'
  /** The stream ended with no terminal marker. The outcome is not confirmed by this browser. */
  | 'unknown_outcome';

/** The states in which no further work is coming. */
export const TERMINAL_STATES: readonly TurnState[] = [
  'completed',
  'stopped',
  'blocked',
  'provider_error',
  'rate_limited',
  'credential_unavailable',
  'network_error',
  'unknown_outcome',
];

export function isTerminalState(state: TurnState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * ★ THE CONTEXT-COMMIT RULE, in one function (mission §22).
 *
 * Only a `completed` attempt may become automatic context for a later turn. A stopped,
 * failed, blocked or unconfirmed answer is shown to the reader and is NOT sent to the model
 * again — otherwise a half-finished or uncertain answer quietly becomes authoritative
 * conversation history, and every subsequent turn is grounded on it.
 */
export function commitsContext(state: TurnState): boolean {
  return state === 'completed';
}

/**
 * Governance facts, exactly as the response headers stated them — and only for the governed
 * route, which is the only surface that sets them
 * (packages/provider-{openai,anthropic}/src/governed/register-governed.ts).
 *
 * ★ RECOMMENDATION AND APPLIED ARE TWO FIELDS AND MUST STAY TWO FIELDS. `decision` is what the
 * enforcement matrix RECOMMENDED. `applied` is what the runtime ACTUALLY DID. At this base the
 * runtime forwards for every decision except a real 403, so `decision: 'ask'` /
 * `applied: 'forwarded'` is the normal case — nobody was asked, and the request reached the
 * provider. Collapsing the two into one "policy result" is the single most dangerous thing
 * this screen could do.
 */
export type GovernanceFacts = {
  /** `x-govai-capability-level`, verbatim. */
  capabilityLevel: string | null;
  /** `x-govai-effective-risk-class`, verbatim. */
  effectiveRiskClass: string | null;
  /** `x-govai-enforcement-decision`, verbatim — including a value this build does not know. */
  decisionRaw: string | null;
  /** The same value, validated against the normative vocabulary. Null when unrecognised. */
  decision: EnforcementDecision | null;
  /** `x-govai-enforcement-applied`, verbatim. */
  appliedRaw: string | null;
  /** The same value, narrowed. Null when unrecognised. */
  applied: 'forwarded' | 'blocked' | null;
  /** `block_trigger` from a 403 body: what actually applied the block. */
  blockTrigger: BlockTrigger | null;
};

/**
 * What the browser can prove about one provider call.
 *
 * Every field is something this browser observed: a value it sent, a status it received, a
 * header it read, or a clock it ran. There is deliberately no field for an audit event id, a
 * sealing confirmation or a backend latency — none of those is exposed to a browser by any
 * response on these routes at this base, and a receipt that carried them would be asserting
 * facts nobody handed it.
 */
export type InteractionReceipt = {
  provider: ProviderId;
  surface: SurfaceId;
  mode: ConsoleMode;
  /** The model id the console SENT. Not a provider echo — this is what we asked for. */
  model: string;
  /** The same-origin GovAI path this attempt POSTed to. */
  endpoint: string;
  /** HTTP status, when a response was received at all. */
  status: number | null;
  /** The provider's request id from its own response header, or null when none was returned. */
  providerRequestId: string | null;
  /** The provider's own id for the message/response, when the stream announced one. */
  providerMessageId: string | null;
  /** ★ CLIENT-OBSERVED. Wall time in this tab from send to terminal — not provider latency,
   *  not GovAI backend latency, neither of which any response exposes. */
  clientDurationMs: number | null;
  state: TurnState;
  /** The provider's own stop reason, when its terminal event carried one. */
  stopReason: string | null;
  /** Governed route only; null on the native/audited route, which returns no such headers. */
  governance: GovernanceFacts | null;
};

/** One attempt at answering a turn. A retry adds an attempt; it never edits one. */
export type Attempt = {
  id: string;
  state: TurnState;
  /** Visible answer text, as far as it streamed. */
  text: string;
  /** A model refusal the provider surfaced as its own field. */
  refusal: string | null;
  /** The stream carried output this console cannot render. */
  unsupportedOutput: boolean;
  error: SafeProviderError | null;
  /** Seconds the server asked us to wait, from `Retry-After`, on a 429. */
  retryAfterSeconds: number | null;
  receipt: InteractionReceipt | null;
};

export type Turn = {
  id: string;
  userText: string;
  /** Ordered oldest-first. The last one is the current answer. */
  attempts: Attempt[];
};

/** The transport identity a conversation is pinned to after its first send. */
export type ConversationConfig = {
  provider: ProviderId;
  surface: SurfaceId;
  mode: ConsoleMode;
  model: string;
  maxTokens: number;
};

export type ConversationState = {
  config: ConversationConfig;
  /** True once a turn has been sent: the transport identity is then fixed for this
   *  conversation and only "New conversation" can change it. */
  locked: boolean;
  turns: Turn[];
  /** The attempt currently in flight, as `{turnId, attemptId}`, or null. */
  inFlight: { turnId: string; attemptId: string } | null;
};

/** The last attempt of a turn, or null for a turn that has none. */
export function lastAttempt(turn: Turn): Attempt | null {
  return turn.attempts.length > 0 ? (turn.attempts[turn.attempts.length - 1] as Attempt) : null;
}

/**
 * The context a provider call carries, for the turn at `turnIndex`.
 *
 * Two rules, both load-bearing:
 *
 *   1. A turn contributes a (user, assistant) PAIR when its latest attempt completed, and
 *      nothing at all otherwise. Contributing the user message of a turn that was never
 *      answered would leave two consecutive user messages in the request — which the three
 *      surfaces treat differently from one another — and would quietly re-ask a question the
 *      reader may have abandoned. Pairing is the rule that holds identically everywhere and
 *      never over-sends.
 *
 *   2. ONLY TURNS BEFORE `turnIndex` COUNT. Retrying an earlier turn must reproduce the
 *      conversation as it stood when that turn was first asked (mission §25) — not as it
 *      stands now, with later turns already answered. Bounding by index is what makes an
 *      explicit retry a retry rather than a differently-grounded new question.
 */
export function contextForTurn(turns: readonly Turn[], turnIndex: number): ContextMessage[] {
  const out: ContextMessage[] = [];
  for (const turn of turns.slice(0, Math.max(0, turnIndex))) {
    const attempt = lastAttempt(turn);
    if (attempt === null || !commitsContext(attempt.state)) continue;
    // A completed attempt that produced no visible text (a stream whose only output was
    // unrenderable) has no assistant message to send. Dropping the pair keeps the request
    // well-formed; an empty assistant turn is rejected outright by at least one provider.
    if (attempt.text.length === 0) continue;
    out.push({ role: 'user', text: turn.userText });
    out.push({ role: 'assistant', text: attempt.text });
  }
  return out;
}
