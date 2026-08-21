import { describe, expect, it } from 'vitest';
import {
  conversationReducer,
  currentAttempt,
  initialConversationState,
  isBusy,
  isRetryable,
  type ConversationAction,
} from './reducer.js';
import {
  commitsContext,
  contextForTurn,
  isTerminalState,
  lastAttempt,
  TERMINAL_STATES,
  type ConversationConfig,
  type ConversationState,
  type InteractionReceipt,
  type TurnState,
} from './types.js';

const CONFIG: ConversationConfig = {
  provider: 'openai',
  surface: 'responses',
  mode: 'native_audited',
  model: 'a-model',
  maxTokens: 2048,
};

function receipt(state: TurnState): InteractionReceipt {
  return {
    provider: 'openai',
    surface: 'responses',
    mode: 'native_audited',
    model: 'a-model',
    endpoint: '/passthrough/openai/v1/responses',
    status: 200,
    providerRequestId: null,
    providerMessageId: null,
    clientDurationMs: 12,
    state,
    stopReason: null,
    governance: null,
  };
}

function settle(
  turnId: string,
  attemptId: string,
  state: TurnState,
  text: string,
  refusal: string | null = null,
): ConversationAction {
  return {
    type: 'settle',
    turnId,
    attemptId,
    state,
    text,
    refusal,
    unsupportedOutput: false,
    error: null,
    retryAfterSeconds: null,
    receipt: receipt(state),
  };
}

function run(actions: readonly ConversationAction[]): ConversationState {
  return actions.reduce(conversationReducer, initialConversationState(CONFIG));
}

/** A conversation with one turn already settled in the given state. */
function oneTurn(state: TurnState, text = 'the answer'): ConversationState {
  return run([
    { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'the question' },
    { type: 'streaming', turnId: 't1', attemptId: 'a1' },
    { type: 'delta', turnId: 't1', attemptId: 'a1', text },
    settle('t1', 'a1', state, text),
  ]);
}

describe('the happy path', () => {
  it('walks idle → submitting → streaming → completed', () => {
    let state = initialConversationState(CONFIG);
    expect(state.turns).toEqual([]);
    expect(isBusy(state)).toBe(false);

    state = conversationReducer(state, {
      type: 'send',
      turnId: 't1',
      attemptId: 'a1',
      userText: 'hello',
    });
    expect(lastAttempt(state.turns[0]!)?.state).toBe('submitting');
    expect(isBusy(state)).toBe(true);
    expect(currentAttempt(state)?.id).toBe('a1');

    state = conversationReducer(state, { type: 'streaming', turnId: 't1', attemptId: 'a1' });
    expect(lastAttempt(state.turns[0]!)?.state).toBe('streaming');

    state = conversationReducer(state, { type: 'delta', turnId: 't1', attemptId: 'a1', text: 'hi' });
    expect(lastAttempt(state.turns[0]!)?.text).toBe('hi');

    state = conversationReducer(state, settle('t1', 'a1', 'completed', 'hi there'));
    expect(lastAttempt(state.turns[0]!)?.state).toBe('completed');
    expect(lastAttempt(state.turns[0]!)?.text).toBe('hi there');
    expect(isBusy(state)).toBe(false);
    expect(currentAttempt(state)).toBeNull();
  });

  it('reaches every terminal state from streaming', () => {
    for (const terminal of TERMINAL_STATES) {
      const state = oneTurn(terminal);
      expect(lastAttempt(state.turns[0]!)?.state).toBe(terminal);
      expect(isBusy(state)).toBe(false);
      expect(isTerminalState(terminal)).toBe(true);
    }
  });
});

describe('★ THE CONTEXT-COMMIT RULE', () => {
  it('commits ONLY a completed attempt', () => {
    expect(commitsContext('completed')).toBe(true);
    for (const state of TERMINAL_STATES.filter((s) => s !== 'completed')) {
      expect(commitsContext(state), state).toBe(false);
    }
  });

  it('sends a completed turn as a user/assistant pair', () => {
    const state = oneTurn('completed', 'the answer');
    expect(contextForTurn(state.turns, 1)).toEqual([
      { role: 'user', text: 'the question' },
      { role: 'assistant', text: 'the answer' },
    ]);
  });

  it.each(TERMINAL_STATES.filter((s) => s !== 'completed'))(
    'sends NOTHING from a turn that ended as %s, not even the question',
    (terminal) => {
      const state = oneTurn(terminal, 'a partial answer');
      expect(contextForTurn(state.turns, 1)).toEqual([]);
    },
  );

  it('★ carries a refusal-only turn as context — a refusal IS an answer', () => {
    // ★ REGRESSION. OpenAI reports a decline in its own `refusal` field and leaves the text
    // empty. Treating "no text" as "nothing to send" dropped BOTH the question and the
    // refusal, so a follow-up like "why not?" reached the model as though the exchange had
    // never happened.
    const state = run([
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'do something disallowed' },
      settle('t1', 'a1', 'completed', '', 'I cannot help with that.'),
    ]);
    expect(contextForTurn(state.turns, 1)).toEqual([
      { role: 'user', text: 'do something disallowed' },
      // Verbatim: it is what the model said, and paraphrasing it would put words in its mouth.
      { role: 'assistant', text: 'I cannot help with that.' },
    ]);
  });

  it('prefers the answer text when a turn has both', () => {
    const state = run([
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q' },
      settle('t1', 'a1', 'completed', 'the answer', 'a partial refusal'),
    ]);
    expect(contextForTurn(state.turns, 1)[1]).toEqual({ role: 'assistant', text: 'the answer' });
  });

  it('drops a completed turn that produced no visible text', () => {
    // A stream whose only output was unrenderable has no assistant message to send, and an
    // empty assistant turn is rejected outright by at least one provider.
    const state = oneTurn('completed', '');
    expect(contextForTurn(state.turns, 1)).toEqual([]);
  });

  it('excludes a partial answer from the NEXT turn’s request', () => {
    const state = run([
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q1' },
      settle('t1', 'a1', 'stopped', 'half an answer'),
      { type: 'send', turnId: 't2', attemptId: 'a2', userText: 'q2' },
    ]);
    expect(contextForTurn(state.turns, 1)).toEqual([]);
    // The stopped text is still VISIBLE to the reader — it is just not sent back.
    expect(lastAttempt(state.turns[0]!)?.text).toBe('half an answer');
  });
});

describe('★ a retry reproduces the conversation as it stood BEFORE that turn', () => {
  it('excludes turns that came after the one being retried', () => {
    const state = run([
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q1' },
      settle('t1', 'a1', 'completed', 'answer 1'),
      { type: 'send', turnId: 't2', attemptId: 'a2', userText: 'q2' },
      settle('t2', 'a2', 'network_error', ''),
      { type: 'send', turnId: 't3', attemptId: 'a3', userText: 'q3' },
      settle('t3', 'a3', 'completed', 'answer 3'),
    ]);
    // Retrying turn 2 must not be grounded on turn 3, which was asked afterwards.
    expect(contextForTurn(state.turns, 1)).toEqual([
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'answer 1' },
    ]);
    // Whereas a NEW fourth turn sees both completed turns.
    expect(contextForTurn(state.turns, 3)).toEqual([
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'answer 1' },
      { role: 'user', text: 'q3' },
      { role: 'assistant', text: 'answer 3' },
    ]);
  });

  it('appends an attempt instead of editing or deleting the failed one', () => {
    const state = run([
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q' },
      settle('t1', 'a1', 'provider_error', ''),
      { type: 'retry', turnId: 't1', attemptId: 'a2' },
    ]);
    const turn = state.turns[0]!;
    expect(turn.attempts.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(turn.attempts[0]?.state).toBe('provider_error');
    expect(turn.attempts[1]?.state).toBe('submitting');
    expect(currentAttempt(state)?.id).toBe('a2');
  });

  it('★ a retry of an EARLIER turn is shown but never becomes context', () => {
    // The branch that never existed. Turn 3 was answered WITHOUT turn 2's answer, so a later
    // request carrying all three would tell the model it once said things in an order it never
    // said them in. The retried answer stays on screen; it just does not travel.
    const state = run([
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q1' },
      settle('t1', 'a1', 'completed', 'answer 1'),
      { type: 'send', turnId: 't2', attemptId: 'a2', userText: 'q2' },
      settle('t2', 'a2', 'network_error', ''),
      { type: 'send', turnId: 't3', attemptId: 'a3', userText: 'q3' },
      settle('t3', 'a3', 'completed', 'answer 3'),
      // Now go back and retry turn 2 — successfully.
      { type: 'retry', turnId: 't2', attemptId: 'a2b' },
      settle('t2', 'a2b', 'completed', 'answer 2 at last'),
    ]);

    const retried = lastAttempt(state.turns[1]!);
    expect(retried?.state).toBe('completed');
    expect(retried?.text).toBe('answer 2 at last');
    // Visible to the reader…
    expect(retried?.eligibleForContext).toBe(false);
    // …and absent from what a fourth turn would send.
    expect(contextForTurn(state.turns, 3)).toEqual([
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'answer 1' },
      { role: 'user', text: 'q3' },
      { role: 'assistant', text: 'answer 3' },
    ]);
  });

  it('a retry of the LAST turn still becomes context, because nothing came after it', () => {
    const state = run([
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q1' },
      settle('t1', 'a1', 'provider_error', ''),
      { type: 'retry', turnId: 't1', attemptId: 'a1b' },
      settle('t1', 'a1b', 'completed', 'answer 1'),
    ]);
    expect(lastAttempt(state.turns[0]!)?.eligibleForContext).toBe(true);
    expect(contextForTurn(state.turns, 1)).toEqual([
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'answer 1' },
    ]);
  });

  it('never truncates the later turns to make room for an old retry', () => {
    // The other way to solve the branch problem is to delete what came after. This product does
    // not destroy what happened, so the count must not move.
    const state = run([
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q1' },
      settle('t1', 'a1', 'stopped', 'partial'),
      { type: 'send', turnId: 't2', attemptId: 'a2', userText: 'q2' },
      settle('t2', 'a2', 'completed', 'answer 2'),
      { type: 'retry', turnId: 't1', attemptId: 'a1b' },
      settle('t1', 'a1b', 'completed', 'answer 1 at last'),
    ]);
    expect(state.turns).toHaveLength(2);
    expect(lastAttempt(state.turns[1]!)?.text).toBe('answer 2');
    expect(state.turns[0]?.attempts).toHaveLength(2);
  });

  it('ignores a retry for a turn that does not exist', () => {
    const state = oneTurn('provider_error');
    expect(conversationReducer(state, { type: 'retry', turnId: 'nope', attemptId: 'x' })).toBe(
      state,
    );
  });

  it('offers retry only for a terminal, unsuccessful turn', () => {
    expect(isRetryable(oneTurn('completed').turns[0]!)).toBe(false);
    for (const terminal of TERMINAL_STATES.filter((s) => s !== 'completed')) {
      expect(isRetryable(oneTurn(terminal).turns[0]!), terminal).toBe(true);
    }
    const inFlight = run([{ type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q' }]);
    expect(isRetryable(inFlight.turns[0]!)).toBe(false);
  });
});

describe('★ the transport identity locks after the first send', () => {
  it('accepts configuration changes before any send', () => {
    const state = conversationReducer(initialConversationState(CONFIG), {
      type: 'configure',
      patch: { provider: 'anthropic', surface: 'messages', model: 'claude-x' },
    });
    expect(state.config).toMatchObject({ provider: 'anthropic', model: 'claude-x' });
    expect(state.locked).toBe(false);
  });

  it('refuses every configuration change once a turn has been sent', () => {
    const sent = run([{ type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q' }]);
    expect(sent.locked).toBe(true);
    for (const patch of [
      { provider: 'anthropic' as const },
      { surface: 'chat_completions' as const },
      { mode: 'governed' as const },
      { model: 'another-model' },
      { maxTokens: 10 },
    ]) {
      expect(conversationReducer(sent, { type: 'configure', patch })).toBe(sent);
    }
    expect(sent.config).toEqual(CONFIG);
  });

  it('unlocks on a new conversation, keeping the reader’s choices', () => {
    const state = conversationReducer(oneTurn('completed'), { type: 'newConversation' });
    expect(state.locked).toBe(false);
    expect(state.config).toEqual(CONFIG);
    expect(state.turns).toEqual([]);
    expect(state.inFlight).toBeNull();
  });
});

describe('stale messages from a superseded attempt are dropped', () => {
  it('ignores a delta addressed to an attempt that already settled', () => {
    const settled = oneTurn('stopped', 'partial');
    const after = conversationReducer(settled, {
      type: 'delta',
      turnId: 't1',
      attemptId: 'a1',
      text: 'LATE TEXT',
    });
    expect(lastAttempt(after.turns[0]!)?.text).toBe('partial');
  });

  it('ignores a delta for an unknown turn or attempt, returning the same state object', () => {
    const state = oneTurn('completed');
    expect(
      conversationReducer(state, { type: 'delta', turnId: 'nope', attemptId: 'a1', text: 'x' }),
    ).toBe(state);
    expect(
      conversationReducer(state, { type: 'delta', turnId: 't1', attemptId: 'nope', text: 'x' }),
    ).toBe(state);
  });

  it('does not clear the in-flight marker when a stale settle arrives for another attempt', () => {
    const busy = run([
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q' },
      settle('t1', 'a1', 'stopped', ''),
      { type: 'retry', turnId: 't1', attemptId: 'a2' },
    ]);
    expect(currentAttempt(busy)?.id).toBe('a2');
    const stale = conversationReducer(busy, settle('t1', 'a1', 'completed', 'late'));
    expect(stale.inFlight?.attemptId).toBe('a2');
  });

  it('keeps the streamed text when a settle carries none', () => {
    const state = run([
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q' },
      { type: 'delta', turnId: 't1', attemptId: 'a1', text: 'streamed so far' },
      settle('t1', 'a1', 'stopped', ''),
    ]);
    expect(lastAttempt(state.turns[0]!)?.text).toBe('streamed so far');
  });
});

describe('new conversation clears everything the provider produced', () => {
  it('drops the transcript, the receipts and the in-flight marker', () => {
    const busy = run([
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q1' },
      settle('t1', 'a1', 'completed', 'a1 text'),
      { type: 'send', turnId: 't2', attemptId: 'a2', userText: 'q2' },
    ]);
    expect(busy.turns).toHaveLength(2);
    const fresh = conversationReducer(busy, { type: 'newConversation' });
    expect(fresh.turns).toEqual([]);
    expect(fresh.inFlight).toBeNull();
    expect(JSON.stringify(fresh)).not.toContain('a1 text');
    expect(JSON.stringify(fresh)).not.toContain('q1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `lastSettled` exists so the live region can announce the outcome of the attempt that ACTUALLY
// settled — a retry targets any turn, so "the last turn's last attempt" is the wrong answer.
// It is an IDENTITY into `turns`, which makes it the kind of field that can go stale, so the
// invariant it must hold is asserted directly rather than inferred from the actions:
//
//   `lastSettled` is null, or it names an attempt that exists.
//
// A settle can arrive for an attempt this conversation no longer has: New conversation aborts an
// in-flight request and drops its turns, and the old `execute()` then dispatches `settle`
// anyway. Recording that identity would overwrite a live one, and the view — which resolves it
// against `turns` — would then find nothing and SILENCE a turn that really did settle.
describe('★ lastSettled always names an attempt that exists', () => {
  /** The invariant, as a predicate over any state. */
  function resolves(state: ConversationState): boolean {
    if (state.lastSettled === null) return true;
    const { turnId, attemptId } = state.lastSettled;
    return state.turns.some(
      (turn) => turn.id === turnId && turn.attempts.some((a) => a.id === attemptId),
    );
  }

  it('is null before anything settles', () => {
    expect(initialConversationState(CONFIG).lastSettled).toBeNull();
  });

  it('names the settled attempt, and names the RETRIED one after an out-of-order retry', () => {
    const state = run([
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'one' },
      settle('t1', 'a1', 'provider_error', ''),
      { type: 'send', turnId: 't2', attemptId: 'a2', userText: 'two' },
      settle('t2', 'a2', 'completed', 'ok'),
      // Retry the FIRST turn while the second is the chronological last.
      { type: 'retry', turnId: 't1', attemptId: 'a1b' },
      settle('t1', 'a1b', 'rate_limited', ''),
    ]);
    expect(state.lastSettled).toEqual({ turnId: 't1', attemptId: 'a1b' });
    expect(resolves(state)).toBe(true);
  });

  it('★ a settle for an attempt dropped by New conversation does NOT overwrite a live one', () => {
    const state = run([
      { type: 'send', turnId: 'old', attemptId: 'oldA', userText: 'before the reset' },
      { type: 'newConversation' },
      { type: 'send', turnId: 'new', attemptId: 'newA', userText: 'after the reset' },
      settle('new', 'newA', 'completed', 'fresh answer'),
      // The aborted request finally settles, for a turn this conversation no longer has.
      settle('old', 'oldA', 'stopped', 'stale'),
    ]);
    expect(state.lastSettled).toEqual({ turnId: 'new', attemptId: 'newA' });
    expect(resolves(state)).toBe(true);
  });

  it('a settle for an unknown attempt on an EMPTY conversation leaves it null', () => {
    const state = run([settle('ghost', 'ghostA', 'completed', 'nothing')]);
    expect(state.lastSettled).toBeNull();
    expect(resolves(state)).toBe(true);
  });

  it('New conversation clears it', () => {
    const state = run([
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q' },
      settle('t1', 'a1', 'completed', 'a'),
      { type: 'newConversation' },
    ]);
    expect(state.lastSettled).toBeNull();
    expect(resolves(state)).toBe(true);
  });

  it('the invariant survives every action in sequence', () => {
    const actions: ConversationAction[] = [
      { type: 'configure', patch: { model: 'm' } },
      { type: 'send', turnId: 't1', attemptId: 'a1', userText: 'q1' },
      { type: 'streaming', turnId: 't1', attemptId: 'a1' },
      { type: 'delta', turnId: 't1', attemptId: 'a1', text: 'partial' },
      settle('t1', 'a1', 'unknown_outcome', 'partial'),
      { type: 'retry', turnId: 't1', attemptId: 'a1b' },
      settle('t1', 'a1b', 'completed', 'done'),
      { type: 'send', turnId: 't2', attemptId: 'a2', userText: 'q2' },
      settle('ghost', 'ghostA', 'completed', 'stale'),
      settle('t2', 'a2', 'stopped', 'half'),
      { type: 'newConversation' },
      settle('t2', 'a2', 'completed', 'very stale'),
    ];
    let state = initialConversationState(CONFIG);
    for (const [i, action] of actions.entries()) {
      state = conversationReducer(state, action);
      expect(resolves(state), `after action ${String(i)} (${action.type})`).toBe(true);
    }
    expect(state.lastSettled).toBeNull();
  });
});
