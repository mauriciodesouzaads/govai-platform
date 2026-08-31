// OpenAI Responses adapter — pure strategy/assembly proofs (P0-D1; spec §11 chaining +
// stateless replay, §24 LAW 4/17; O-matrix members O11–O15 at the unit level).

import { describe, it, expect } from 'vitest';
import { openaiResponsesAdapter } from './openai-responses.js';
import type { AssembledContextEntry } from '../durable-context.js';

const CRED = 'cred-active';
const NOW_MS = 1_800_000_000_000;
const FRESH_MS = NOW_MS - 60_000;

function entry(overrides: Partial<AssembledContextEntry>): AssembledContextEntry {
  return {
    turnId: 'turn-1',
    sourceProvider: 'openai',
    sourceModel: 'gpt-test',
    userNative: { model: 'gpt-test', input: 'u1' },
    assistant: null,
    ...overrides,
  };
}

function responseAssistant(
  body: Record<string, unknown>,
  credentialId: string = CRED,
  completedAtMs: number = FRESH_MS,
): AssembledContextEntry['assistant'] {
  return {
    attemptId: 'att-1',
    providerCredentialId: credentialId,
    completedAtMs,
    output: { kind: 'response', body },
  };
}

const RESP_1 = {
  id: 'resp_1',
  object: 'response',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A1' }] }],
};

function build(entries: AssembledContextEntry[], turnConfig: unknown) {
  return openaiResponsesAdapter.buildRequest({
    entries,
    turnConfig,
    branchModel: 'gpt-test',
    activeCredentialId: CRED,
    nowMs: NOW_MS,
  });
}

describe('openai adapter — strategy selection', () => {
  it('a turn with NO eligible history posts its stored config VERBATIM', () => {
    const config = { model: 'gpt-test', input: 'first', stream: true };
    const result = build([], config);
    expect(result).toEqual({ ok: true, body: config, continuation: { kind: 'stateless_replay' } });
    expect((result as unknown as { body: unknown }).body).toBe(config);
  });

  it('CHAINS from the last eligible completed response when every condition holds', () => {
    const config = { model: 'gpt-test', input: 'u2' };
    const result = build([entry({ assistant: responseAssistant(RESP_1) })], config);
    expect(result).toEqual({
      ok: true,
      body: { model: 'gpt-test', input: 'u2', previous_response_id: 'resp_1' },
      continuation: { kind: 'response_chain', parentResponseId: 'resp_1' },
    });
  });

  it('O13 — the anchor REWINDS past ineligible turns, whose user input rides along', () => {
    // Turn 2's attempt ended without eligible output (failed / outcome_unknown / superseded):
    // the anchor is turn 1's response and turn 2's INPUT is carried in the request.
    const result = build(
      [
        entry({ assistant: responseAssistant(RESP_1) }),
        entry({ turnId: 'turn-2', userNative: { model: 'gpt-test', input: 'u2-lost' }, assistant: null }),
      ],
      { model: 'gpt-test', input: 'u3' },
    );
    expect(result).toEqual({
      ok: true,
      body: {
        model: 'gpt-test',
        input: [{ role: 'user', content: 'u2-lost' }, { role: 'user', content: 'u3' }],
        previous_response_id: 'resp_1',
      },
      continuation: { kind: 'response_chain', parentResponseId: 'resp_1' },
    });
  });

  it('O10 — a CREDENTIAL-mismatched anchor is NEVER chained: stateless replay instead', () => {
    const result = build(
      [entry({ assistant: responseAssistant(RESP_1, 'cred-historical') })],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result.ok).toBe(true);
    const body = (result as unknown as { body: Record<string, unknown> }).body;
    expect('previous_response_id' in body).toBe(false);
    expect(body['input']).toEqual([
      { role: 'user', content: 'u1' },
      ...RESP_1.output,
      { role: 'user', content: 'u2' },
    ]);
    expect((result as unknown as { continuation: unknown }).continuation).toEqual({ kind: 'stateless_replay' });
  });

  it('an anchor whose own request set store:false is not retrievable — stateless replay', () => {
    const result = build(
      [entry({ userNative: { model: 'gpt-test', input: 'u1', store: false }, assistant: responseAssistant(RESP_1) })],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result.ok).toBe(true);
    expect('previous_response_id' in (result as unknown as { body: Record<string, unknown> }).body).toBe(false);
  });

  it('O14 — an explicit store:false on THIS turn is honored: stateless, never flipped to true', () => {
    const result = build([entry({ assistant: responseAssistant(RESP_1) })], {
      model: 'gpt-test',
      input: 'u2',
      store: false,
    });
    expect(result.ok).toBe(true);
    const body = (result as unknown as { body: Record<string, unknown> }).body;
    expect(body['store']).toBe(false);
    expect('previous_response_id' in body).toBe(false);
  });

  it('an EXPIRED anchor is never chained: a conversation resumed after the retention window replays statelessly', () => {
    const fifteenDaysAgo = NOW_MS - 15 * 24 * 60 * 60 * 1000;
    const result = build(
      [entry({ assistant: responseAssistant(RESP_1, CRED, fifteenDaysAgo) })],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result.ok).toBe(true);
    const body = (result as unknown as { body: Record<string, unknown> }).body;
    expect('previous_response_id' in body).toBe(false); // the dead parent is never selected
    expect(body['input']).toEqual([
      { role: 'user', content: 'u1' },
      ...RESP_1.output,
      { role: 'user', content: 'u2' },
    ]);
  });

  it('an anchor INSIDE the age bound still chains', () => {
    const thirteenDaysAgo = NOW_MS - 13 * 24 * 60 * 60 * 1000;
    const result = build(
      [entry({ assistant: responseAssistant(RESP_1, CRED, thirteenDaysAgo) })],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result).toEqual({
      ok: true,
      body: { model: 'gpt-test', input: 'u2', previous_response_id: 'resp_1' },
      continuation: { kind: 'response_chain', parentResponseId: 'resp_1' },
    });
  });

  it('O15 — a config carrying client-owned continuation is a CONFLICT on every turn, first included', () => {
    for (const field of ['previous_response_id', 'conversation']) {
      const result = build([], { model: 'gpt-test', input: 'u1', [field]: 'client-owned' });
      expect(result).toEqual({
        ok: false,
        reason: 'continuation_conflict',
        detail: `config_carries_${field}`,
      });
    }
  });

  it('background mode is refused explicitly: its polling lifecycle is not implemented', () => {
    const result = build([], { model: 'gpt-test', input: 'u1', background: true });
    expect(result).toEqual({
      ok: false,
      reason: 'continuation_conflict',
      detail: 'config_requests_background_mode',
    });
  });

  it('a NONTERMINAL stored response body never becomes context: chaining and replay both refuse', () => {
    // `background: true` answers HTTP 200 with status queued/in_progress; the executor
    // completes any 2xx attempt, so terminality must be validated at replay time.
    for (const status of ['queued', 'in_progress']) {
      const result = build(
        [entry({ assistant: responseAssistant({ ...RESP_1, status }) })],
        { model: 'gpt-test', input: 'u2' },
      );
      expect(result).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'anchor_response_not_terminal',
      });
    }
    // An explicit terminal status chains exactly like a status-less body.
    const terminal = build(
      [entry({ assistant: responseAssistant({ ...RESP_1, status: 'completed' }) })],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(terminal).toEqual({
      ok: true,
      body: { model: 'gpt-test', input: 'u2', previous_response_id: 'resp_1' },
      continuation: { kind: 'response_chain', parentResponseId: 'resp_1' },
    });
  });

  it('an INCOMPLETE response is honest terminal context: replayed statelessly, never a chaining anchor', () => {
    // A max_output_tokens/content-filter truncation is a legitimate terminal result whose
    // partial output IS the durable answer; refusing it would brick the branch behind one
    // truncated turn. Chaining from it is the part that stays off.
    const incomplete = { ...RESP_1, status: 'incomplete' };
    const result = build([entry({ assistant: responseAssistant(incomplete) })], {
      model: 'gpt-test',
      input: 'u2',
    });
    expect(result.ok).toBe(true);
    const body = (result as unknown as { body: Record<string, unknown> }).body;
    expect('previous_response_id' in body).toBe(false);
    expect(body['input']).toEqual([
      { role: 'user', content: 'u1' },
      ...RESP_1.output, // the truncated output replays as the turn's real answer
      { role: 'user', content: 'u2' },
    ]);
    expect((result as unknown as { continuation: unknown }).continuation).toEqual({
      kind: 'stateless_replay',
    });
  });

  it('a STREAM ending in response.incomplete carries its terminal response the same way', () => {
    const sse =
      `data: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_i' } })}\n\n` +
      `data: ${JSON.stringify({ type: 'response.incomplete', response: { id: 'resp_i', status: 'incomplete', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'trunc' }] }] } })}\n\n`;
    const result = build(
      [
        entry({
          assistant: { attemptId: 'att-i', providerCredentialId: CRED, completedAtMs: FRESH_MS, output: { kind: 'stream', sseText: sse } },
        }),
      ],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result.ok).toBe(true);
    const body = (result as unknown as { body: Record<string, unknown> }).body;
    expect('previous_response_id' in body).toBe(false);
    expect(body['input']).toEqual([
      { role: 'user', content: 'u1' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'trunc' }] },
      { role: 'user', content: 'u2' },
    ]);
  });

  it('a PROVIDER-FAILED response projects as INPUT-ONLY context: the branch continues honestly', () => {
    // status failed/cancelled, or a 2xx stream ending in response.failed: the provider's own
    // verdict that no answer exists. The question stays context; the non-answer never does;
    // the branch is not blocked.
    for (const failedAssistant of [
      responseAssistant({ id: 'resp_f', status: 'failed', output: [] }),
      responseAssistant({ id: 'resp_c', status: 'cancelled', output: [] }),
      {
        attemptId: 'att-fs',
        providerCredentialId: CRED,
        completedAtMs: FRESH_MS,
        output: {
          kind: 'stream' as const,
          sseText:
            `data: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_fs' } })}\n\n` +
            `data: ${JSON.stringify({ type: 'response.failed', response: { id: 'resp_fs', status: 'failed' } })}\n\n`,
        },
      },
    ]) {
      const result = build(
        [entry({ assistant: failedAssistant as AssembledContextEntry['assistant'] })],
        { model: 'gpt-test', input: 'u2' },
      );
      expect(result.ok).toBe(true);
      const body = (result as unknown as { body: Record<string, unknown> }).body;
      expect('previous_response_id' in body).toBe(false);
      expect(body['input']).toEqual([
        { role: 'user', content: 'u1' },
        { role: 'user', content: 'u2' },
      ]);
    }
  });

  it('CONFLICTING terminal verdicts refuse: a failed-and-completed capture cannot be trusted', () => {
    const sse =
      `data: ${JSON.stringify({ type: 'response.failed', response: { id: 'resp_x', status: 'failed' } })}\n\n` +
      `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_x', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ghost' }] }] } })}\n\n`;
    const result = build(
      [
        entry({
          assistant: { attemptId: 'att-x', providerCredentialId: CRED, completedAtMs: FRESH_MS, output: { kind: 'stream', sseText: sse } },
        }),
      ],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'conflicting_terminal_verdicts',
    });
  });

  it('DUPLICATE success terminals refuse: a twice-completed capture is ambiguous', () => {
    const sse =
      `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } })}\n\n` +
      `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_2', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'second' }] }] } })}\n\n`;
    const result = build(
      [
        entry({
          assistant: { attemptId: 'att-d', providerCredentialId: CRED, completedAtMs: FRESH_MS, output: { kind: 'stream', sseText: sse } },
        }),
      ],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'duplicate_terminal_verdicts',
    });
  });

  it('a HISTORICAL entry carrying client-owned continuation poisons the build: refusal, never a stripped replay', () => {
    // The poisoned turn's input was composed relative to external provider state; replaying it
    // without those fields would silently change its meaning. Recovery is an explicit fork
    // from before it.
    for (const field of ['previous_response_id', 'conversation']) {
      const result = build(
        [
          entry({ assistant: responseAssistant(RESP_1) }),
          entry({
            turnId: 'turn-poisoned',
            userNative: { model: 'gpt-test', input: 'u2', [field]: 'client-owned' },
            assistant: null,
          }),
        ],
        { model: 'gpt-test', input: 'u3' },
      );
      expect(result).toEqual({
        ok: false,
        reason: 'continuation_conflict',
        detail: 'history_carries_client_continuation',
      });
    }
  });
});

describe('openai adapter — cross-provider ancestry (§17 / LAW NX-16)', () => {
  it('a cross-provider fork ancestor refuses with the PRECISE reason, never a shape error', () => {
    const result = build(
      [
        entry({
          sourceProvider: 'anthropic',
          userNative: { model: 'claude-test', messages: [{ role: 'user', content: 'from-parent' }] },
        }),
      ],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'cross_provider_replay_not_implemented',
    });
  });
});

describe('openai adapter — stateless replay assembly', () => {
  it('replays [user items … output items …] in order, output arrays VERBATIM (reasoning included)', () => {
    const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'ENCB64==' };
    const fnCall = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'f', arguments: '{}' };
    const resp = { id: 'resp_r', output: [reasoning, fnCall] };
    const result = build(
      [
        entry({ assistant: responseAssistant(resp, 'cred-historical') }), // force stateless
        entry({
          turnId: 'turn-2',
          userNative: {
            model: 'gpt-test',
            input: [{ type: 'function_call_output', call_id: 'call_1', output: '42' }],
          },
          assistant: null,
        }),
      ],
      { model: 'gpt-test', input: 'u3' },
    );
    expect(result.ok).toBe(true);
    expect((result as unknown as { body: Record<string, unknown> }).body['input']).toEqual([
      { role: 'user', content: 'u1' },
      reasoning,
      fnCall,
      { type: 'function_call_output', call_id: 'call_1', output: '42' },
      { role: 'user', content: 'u3' },
    ]);
  });

  it('extracts the terminal response from durable STREAM bytes (response.completed)', () => {
    const sse =
      `data: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_s' } })}\n\n` +
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'A' })}\n\n` +
      `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_s', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A' }] }] } })}\n\n`;
    const result = build(
      [
        entry({
          assistant: { attemptId: 'att-s', providerCredentialId: CRED, completedAtMs: FRESH_MS, output: { kind: 'stream', sseText: sse } },
        }),
      ],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result).toEqual({
      ok: true,
      body: { model: 'gpt-test', input: 'u2', previous_response_id: 'resp_s' },
      continuation: { kind: 'response_chain', parentResponseId: 'resp_s' },
    });
  });

  it('a durable stream WITHOUT its terminal response refuses (§31)', () => {
    const sse = `data: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_x' } })}\n\n`;
    const result = build(
      [
        entry({
          assistant: { attemptId: 'att-s', providerCredentialId: CRED, completedAtMs: FRESH_MS, output: { kind: 'stream', sseText: sse } },
        }),
      ],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'stream_has_no_terminal_response',
    });
  });

  it('a history input with neither string nor array input refuses', () => {
    const result = build(
      [entry({ userNative: { model: 'gpt-test' }, assistant: responseAssistant(RESP_1, 'cred-x') })],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'history_input_shape_unknown',
    });
  });
});
