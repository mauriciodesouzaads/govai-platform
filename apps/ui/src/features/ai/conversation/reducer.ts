// The conversation reducer — the whole state machine, as a pure function.
//
// Everything the console knows about a conversation lives in one object produced by this
// reducer. Two consequences that are the point of writing it this way:
//
//   • MEMORY ONLY, BY CONSTRUCTION. There is no storage adapter, no persistence hook and no
//     serialization here. The state exists in a React `useReducer` inside the /ai route
//     component; navigating away, reloading, or ending the session destroys it because there
//     is nowhere else for it to be. That is a structural guarantee, not a policy someone has
//     to remember. The UI states the consequence plainly rather than implying durability the
//     product does not offer.
//
//   • THE HONESTY RULES ARE TESTABLE WITHOUT A BROWSER. Which states commit context, what a
//     retry does to history, what "New conversation" clears — all of it is exercised by
//     calling this function.

import {
  commitsContext,
  lastAttempt,
  type Attempt,
  type ConversationConfig,
  type ConversationState,
  type InteractionReceipt,
  type Turn,
  type TurnState,
} from './types.js';
import type { SafeProviderError } from '../providers/errors.js';

export type ConversationAction =
  /** The reader changed a control before the first send. Rejected once locked. */
  | { type: 'configure'; patch: Partial<ConversationConfig> }
  /** A new turn is being sent. Locks the transport identity. */
  | { type: 'send'; turnId: string; attemptId: string; userText: string }
  /** An explicit retry of an existing turn: a NEW attempt, never an edit of the old one. */
  | { type: 'retry'; turnId: string; attemptId: string }
  /** Response headers arrived; the body is streaming. */
  | { type: 'streaming'; turnId: string; attemptId: string }
  /** Incremental answer text. */
  | { type: 'delta'; turnId: string; attemptId: string; text: string }
  /** The attempt reached a terminal state. */
  | {
      type: 'settle';
      turnId: string;
      attemptId: string;
      state: TurnState;
      text: string;
      refusal: string | null;
      unsupportedOutput: boolean;
      error: SafeProviderError | null;
      retryAfterSeconds: number | null;
      receipt: InteractionReceipt;
    }
  /** Everything goes except the reader's control choices. */
  | { type: 'newConversation' };

export function initialConversationState(config: ConversationConfig): ConversationState {
  return { config, locked: false, turns: [], inFlight: null, lastSettled: null };
}

function newAttempt(id: string, eligibleForContext: boolean): Attempt {
  return {
    id,
    eligibleForContext,
    state: 'submitting',
    text: '',
    refusal: null,
    unsupportedOutput: false,
    error: null,
    retryAfterSeconds: null,
    receipt: null,
  };
}

/** Apply a change to one attempt, addressed by (turnId, attemptId). A stale message — from an
 *  attempt that was superseded or from a conversation that has been reset — matches nothing
 *  and is dropped, which is what makes a late `delta` from an aborted stream harmless. */
function patchAttempt(
  state: ConversationState,
  turnId: string,
  attemptId: string,
  patch: (attempt: Attempt) => Attempt,
): ConversationState {
  let changedAny = false;
  const turns = state.turns.map((turn) => {
    if (turn.id !== turnId) return turn;
    let changedHere = false;
    const attempts = turn.attempts.map((attempt) => {
      if (attempt.id !== attemptId) return attempt;
      changedHere = true;
      return patch(attempt);
    });
    if (!changedHere) return turn;
    changedAny = true;
    return { ...turn, attempts };
  });
  return changedAny ? { ...state, turns } : state;
}

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case 'configure': {
      // ★ ONE CONVERSATION, ONE TRANSPORT IDENTITY. Once a turn has been sent, provider,
      // surface, mode and model are fixed. Switching provider mid-thread would send one
      // model's words to another as if it had produced them, and would make the receipt
      // history of the conversation unreadable. Changing them requires a new conversation,
      // which the UI offers directly.
      if (state.locked) return state;
      return { ...state, config: { ...state.config, ...action.patch } };
    }

    case 'send': {
      const turn: Turn = {
        id: action.turnId,
        userText: action.userText,
        // A new turn is always the latest one, so its answer can always join the history.
        attempts: [newAttempt(action.attemptId, true)],
      };
      return {
        ...state,
        locked: true,
        turns: [...state.turns, turn],
        inFlight: { turnId: action.turnId, attemptId: action.attemptId },
      };
    }

    case 'retry': {
      const index = state.turns.findIndex((t) => t.id === action.turnId);
      if (index === -1) return state;
      const turn = state.turns[index] as Turn;
      const turns = [...state.turns];
      // ★ A retry of the LAST turn can still join the history; a retry of an EARLIER one cannot,
      // because the turns after it were answered without it (see Attempt.eligibleForContext).
      const isLatestTurn = index === state.turns.length - 1;
      // A retry APPENDS an attempt. The failed one stays visible: the reader saw it, and
      // deleting the evidence of a failure the moment it is retried is how a product starts
      // looking more reliable than it is.
      turns[index] = {
        ...turn,
        attempts: [...turn.attempts, newAttempt(action.attemptId, isLatestTurn)],
      };
      return {
        ...state,
        turns,
        inFlight: { turnId: action.turnId, attemptId: action.attemptId },
      };
    }

    case 'streaming':
      return patchAttempt(state, action.turnId, action.attemptId, (attempt) =>
        attempt.state === 'submitting' ? { ...attempt, state: 'streaming' } : attempt,
      );

    case 'delta':
      return patchAttempt(state, action.turnId, action.attemptId, (attempt) =>
        // A delta for an attempt that has already settled is discarded: the terminal state
        // is the answer, and text arriving after it cannot revise the outcome.
        attempt.state === 'streaming' || attempt.state === 'submitting'
          ? { ...attempt, state: 'streaming', text: action.text }
          : attempt,
      );

    case 'settle': {
      const next = patchAttempt(state, action.turnId, action.attemptId, (attempt) => ({
        ...attempt,
        state: action.state,
        // The runner's text wins: it is the accumulator's final snapshot, and a `delta` may
        // have been dropped between the last frame and the terminal.
        text: action.text.length > 0 ? action.text : attempt.text,
        refusal: action.refusal,
        unsupportedOutput: action.unsupportedOutput,
        error: action.error,
        retryAfterSeconds: action.retryAfterSeconds,
        receipt: action.receipt,
      }));
      const stillInFlight =
        next.inFlight !== null &&
        next.inFlight.turnId === action.turnId &&
        next.inFlight.attemptId === action.attemptId
          ? null
          : next.inFlight;
      // Record WHICH attempt settled. A retry can target any turn, so the view cannot recover
      // this from `turns` — see ConversationState.lastSettled.
      //
      // ★ ONLY when the attempt is still HERE. `patchAttempt` returns the same object when it
      // matched nothing, which is exactly the late-settle case its own doc describes: New
      // conversation aborts an in-flight request and drops its turns, then the old `execute()`
      // dispatches `settle` for an attempt that no longer exists. Recording that identity
      // anyway would overwrite a live one — and since the view resolves `lastSettled` against
      // `turns`, the lookup would then fail and SILENCE the announcement of a turn that really
      // did settle. The invariant is: `lastSettled` is null, or it names an attempt that
      // exists. A late settle is dropped here for the same reason a late `delta` is dropped
      // there.
      const matched = next !== state;
      return {
        ...next,
        inFlight: stillInFlight,
        lastSettled: matched
          ? { turnId: action.turnId, attemptId: action.attemptId }
          : state.lastSettled,
      };
    }

    case 'newConversation':
      // The controls are kept (the reader just chose them) and unlocked; everything the
      // provider produced is dropped. There is nothing else to clear: no cache entry, no
      // storage key, no provider-side conversation id — the console never created one.
      return { config: state.config, locked: false, turns: [], inFlight: null, lastSettled: null };

    /* c8 ignore next 2 -- exhaustive switch over a closed union */
    default:
      return state;
  }
}

/** True while an attempt is in flight. */
export function isBusy(state: ConversationState): boolean {
  return state.inFlight !== null;
}

/** The attempt a receipt/controls should describe, or null. */
export function currentAttempt(state: ConversationState): Attempt | null {
  const inFlight = state.inFlight;
  if (inFlight === null) return null;
  const turn = state.turns.find((t) => t.id === inFlight.turnId);
  return turn ? (turn.attempts.find((a) => a.id === inFlight.attemptId) ?? null) : null;
}

/** Whether a turn's latest attempt is one the reader may retry: terminal and not successful.
 *  A completed turn is not retryable from the UI — re-asking is a new message. */
export function isRetryable(turn: Turn): boolean {
  const attempt = lastAttempt(turn);
  if (attempt === null) return false;
  if (attempt.state === 'submitting' || attempt.state === 'streaming') return false;
  return !commitsContext(attempt.state);
}
