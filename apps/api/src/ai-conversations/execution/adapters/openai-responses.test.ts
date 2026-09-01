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
    selectedAttemptProviderFailed: false,
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

  it('a streamed terminal whose nested status CONTRADICTS the event type refuses', () => {
    for (const [eventType, badStatus] of [
      ['response.completed', 'in_progress'],
      ['response.completed', 'incomplete'],
      ['response.incomplete', 'completed'],
    ] as const) {
      const sse = `data: ${JSON.stringify({ type: eventType, response: { id: 'resp_m', status: badStatus, output: [] } })}\n\n`;
      const result = build(
        [
          entry({
            assistant: { attemptId: 'att-m', providerCredentialId: CRED, completedAtMs: FRESH_MS, output: { kind: 'stream', sseText: sse } },
          }),
        ],
        { model: 'gpt-test', input: 'u2' },
      );
      expect(result).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'terminal_status_mismatch',
      });
    }
  });

  it('a PROVIDER failure after the anchor demotes to stateless replay: the deleted-anchor loop self-heals', () => {
    // Turn 2 chained from R1 and FAILED provider-side (e.g. the stored parent was deleted).
    // Re-selecting R1 would fail forever; the demotion replays statelessly instead, whose own
    // response becomes the next anchor.
    const result = build(
      [
        entry({ assistant: responseAssistant(RESP_1) }),
        entry({
          turnId: 'turn-failed',
          userNative: { model: 'gpt-test', input: 'u2-failed' },
          assistant: null,
          selectedAttemptProviderFailed: true,
        }),
      ],
      { model: 'gpt-test', input: 'u3' },
    );
    expect(result.ok).toBe(true);
    const body = (result as unknown as { body: Record<string, unknown> }).body;
    expect('previous_response_id' in body).toBe(false);
    expect(body['input']).toEqual([
      { role: 'user', content: 'u1' },
      ...RESP_1.output,
      { role: 'user', content: 'u2-failed' },
      { role: 'user', content: 'u3' },
    ]);
    // A LOCAL failure (provider never involved) does NOT demote — the anchor is not implicated.
    const localOnly = build(
      [
        entry({ assistant: responseAssistant(RESP_1) }),
        entry({
          turnId: 'turn-local',
          userNative: { model: 'gpt-test', input: 'u2-local' },
          assistant: null,
          selectedAttemptProviderFailed: false,
        }),
      ],
      { model: 'gpt-test', input: 'u3' },
    );
    expect(localOnly.ok).toBe(true);
    expect((localOnly as unknown as { body: Record<string, unknown> }).body['previous_response_id']).toBe('resp_1');
  });

  it('a PAYLOAD-level provider failure after the anchor demotes too (durably-completed response.failed)', () => {
    // A 2xx capture ending in response.failed is durably COMPLETED, so the state-derived flag
    // cannot see it — but the scan walks past it, and it must demote exactly like a durable
    // failure: re-chaining the older anchor could repeat a payload-reported deletion forever.
    const failedStream =
      `data: ${JSON.stringify({ type: 'response.failed', response: { id: 'resp_pf', status: 'failed' } })}\n\n`;
    const result = build(
      [
        entry({ assistant: responseAssistant(RESP_1) }),
        entry({
          turnId: 'turn-payload-failed',
          userNative: { model: 'gpt-test', input: 'u2-pf' },
          assistant: { attemptId: 'att-pf', providerCredentialId: CRED, completedAtMs: FRESH_MS, output: { kind: 'stream', sseText: failedStream } },
        }),
      ],
      { model: 'gpt-test', input: 'u3' },
    );
    expect(result.ok).toBe(true);
    const body = (result as unknown as { body: Record<string, unknown> }).body;
    expect('previous_response_id' in body).toBe(false);
    expect(body['input']).toEqual([
      { role: 'user', content: 'u1' },
      ...RESP_1.output,
      { role: 'user', content: 'u2-pf' },
      { role: 'user', content: 'u3' },
    ]);
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PROTOCOL-GRAMMAR CLOSURE SWEEP — bounded OpenAI sibling audit of the SAME families the
// Anthropic sweep closed (terminal cardinality/ordering, post-terminal frames, stream vs
// non-stream verdict parity). First-party (reverified 2026-08-31): the documented terminal
// stream events are `response.completed`, `response.incomplete`, `response.failed` and `error`
// — there is NO `response.cancelled` STREAM event, though `cancelled` IS a Response STATUS,
// which the non-streaming door already projects as a provider failure.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const sseOf = (events: unknown[]): string =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

function streamed(sseText: string): AssembledContextEntry['assistant'] {
  return { attemptId: 'att-g', providerCredentialId: CRED, completedAtMs: FRESH_MS, output: { kind: 'stream', sseText } };
}

const COMPLETED = {
  type: 'response.completed',
  response: {
    id: 'resp_t',
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A' }] }],
  },
};

describe('openai adapter — terminal grammar closure', () => {
  it('★ NON-TERMINAL frames AFTER the terminal event cannot inject content: reassembly is not incremental', () => {
    // Unlike the Anthropic reassembler, the terminal event carries the WHOLE response object,
    // so trailing frames contribute nothing by construction. This proves the asymmetry is safe
    // rather than merely unaudited.
    const result = build(
      [
        entry({
          assistant: streamed(
            sseOf([
              { type: 'response.created', response: { id: 'resp_t' } },
              COMPLETED,
              { type: 'response.output_text.delta', delta: 'INJECTED' },
              { type: 'response.output_item.added', item: { type: 'message', content: 'INJECTED' } },
            ]),
          ),
        }),
      ],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result).toEqual({
      ok: true,
      body: { model: 'gpt-test', input: 'u2', previous_response_id: 'resp_t' },
      continuation: { kind: 'response_chain', parentResponseId: 'resp_t' },
    });
  });

  it('a terminal event whose `response` is not an object never becomes a terminal verdict', () => {
    const result = build(
      [entry({ assistant: streamed(sseOf([{ type: 'response.completed', response: 'garbage' }])) })],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'stream_has_no_terminal_response',
    });
  });

  it('a bare `error` event is a provider failure verdict, exactly like response.failed', () => {
    const result = build(
      [
        entry({ userNative: { model: 'gpt-test', input: 'u1' }, assistant: streamed(sseOf([{ type: 'error', code: 'server_error' }])) }),
      ],
      { model: 'gpt-test', input: 'u2' },
    );
    // Input-only projection: the question stays context, the non-answer never does.
    expect(result).toEqual({
      ok: true,
      body: { model: 'gpt-test', input: [{ role: 'user', content: 'u1' }, { role: 'user', content: 'u2' }] },
      continuation: { kind: 'stateless_replay' },
    });
  });

  it('a REPEATED failure verdict is still just a failure — duplication is not a conflict', () => {
    const result = build(
      [
        entry({
          userNative: { model: 'gpt-test', input: 'u1' },
          assistant: streamed(sseOf([{ type: 'response.failed', response: { id: 'r' } }, { type: 'error', code: 'e' }])),
        }),
      ],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result).toEqual({
      ok: true,
      body: { model: 'gpt-test', input: [{ role: 'user', content: 'u1' }, { role: 'user', content: 'u2' }] },
      continuation: { kind: 'stateless_replay' },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// INDEPENDENT VALIDATOR AUDIT — ONE SEMANTIC REPLAYABILITY LAW, EVERY STRATEGY.
//
// The invariant these proofs defend is `chainable(r) ⇒ replayable(r)`, never the reverse. A
// response may legitimately be replayable and NOT chainable (aged anchor, rotated credential,
// `store: false`, `incomplete`, a provider failure that demotes the chain). It may NEVER be
// chainable without being replayable — that would be GovAI leaning on provider-held history to
// make a durable capture it cannot itself replay look usable.
//
// First-party (openai/openai-openapi, reverified 2026-08-31): `output` is a REQUIRED property of
// the Response object and is typed `array`, so a terminal body without one is out of grammar.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const AGED_MS = NOW_MS - 15 * 24 * 60 * 60 * 1000;
/** Every static chaining condition satisfied — id, terminal status, credential, age, store — and
 *  the ONE thing the chainable predicate never looked at is missing. */
const NO_OUTPUT = { id: 'resp_1', object: 'response', status: 'completed' };

/** The five reachable strategy states for ONE durable capture: chaining available, and the four
 *  documented demotions that fall back to stateless replay. */
const STRATEGY_STATES: Array<{
  name: string;
  assistant: (body: Record<string, unknown>) => AssembledContextEntry['assistant'];
  userNative?: Record<string, unknown>;
  turnConfig: Record<string, unknown>;
}> = [
  {
    name: 'chaining available',
    assistant: (b) => responseAssistant(b),
    turnConfig: { model: 'gpt-test', input: 'u2' },
  },
  {
    name: 'anchor aged out of the retention window',
    assistant: (b) => responseAssistant(b, CRED, AGED_MS),
    turnConfig: { model: 'gpt-test', input: 'u2' },
  },
  {
    name: 'credential rotated since the anchor',
    assistant: (b) => responseAssistant(b, 'cred-rotated'),
    turnConfig: { model: 'gpt-test', input: 'u2' },
  },
  {
    name: 'anchor was created with store:false',
    assistant: (b) => responseAssistant(b),
    userNative: { model: 'gpt-test', input: 'u1', store: false },
    turnConfig: { model: 'gpt-test', input: 'u2' },
  },
  {
    name: 'this turn sets store:false',
    assistant: (b) => responseAssistant(b),
    turnConfig: { model: 'gpt-test', input: 'u2', store: false },
  },
];

const underState = (state: (typeof STRATEGY_STATES)[number], body: Record<string, unknown>) =>
  build(
    [
      entry({
        ...(state.userNative === undefined ? {} : { userNative: state.userNative }),
        assistant: state.assistant(body),
      }),
    ],
    state.turnConfig,
  );

describe('openai adapter — chainable ⇒ replayable (RF-1 and its family)', () => {
  it('★ RF-1 — a terminal with NO `output` is NEVER a chaining anchor, however fresh and well-credentialed', () => {
    // Falsifies the defect exactly: on the pre-audit tree this capture satisfied every chaining
    // condition (valid id, `completed`, matching credential, fresh, store permitted) and was
    // POSTed as `previous_response_id` — while the IDENTICAL capture refused the moment any
    // demotion pushed it onto the stateless path. Two strategies, one durable truth, one answer.
    const result = build([entry({ assistant: responseAssistant(NO_OUTPUT) })], {
      model: 'gpt-test',
      input: 'u2',
    });
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'response_output_shape_unknown',
    });
  });

  it('★ a NON-ARRAY `output` is refused the same way — no strategy may guess the shape', () => {
    for (const output of [{}, 'text', null, 42, true]) {
      expect(
        build([entry({ assistant: responseAssistant({ ...NO_OUTPUT, output }) })], {
          model: 'gpt-test',
          input: 'u2',
        }),
      ).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'response_output_shape_unknown',
      });
    }
  });

  it('★ the verdict on ONE capture is IDENTICAL in every strategy state (the temporal form of RF-1)', () => {
    // A capture accepted while chaining is available must not turn out to have been unreplayable
    // all along once the anchor ages out, the credential rotates or `store:false` applies. The
    // system must never discover at fallback time what it could have known at build time.
    for (const state of STRATEGY_STATES) {
      expect(underState(state, NO_OUTPUT), state.name).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'response_output_shape_unknown',
      });
    }
  });

  it('★ and a REPLAYABLE capture still succeeds in every one of those states — strictness has a boundary', () => {
    // The mirror proof. `replayable ∧ ¬chainable` is a legitimate, common state: it must degrade
    // to stateless replay, never to a refusal. Without this guard the fix above would be
    // indistinguishable from simply refusing more often.
    for (const state of STRATEGY_STATES) {
      const result = underState(state, RESP_1);
      expect(result.ok, state.name).toBe(true);
      const chained =
        (result as unknown as { continuation: { kind: string } }).continuation.kind ===
        'response_chain';
      expect(chained, state.name).toBe(state.name === 'chaining available');
    }
  });

  it('a STREAMED terminal answers to the same law as a stored body (transport parity)', () => {
    const noOutput = sseOf([{ type: 'response.completed', response: NO_OUTPUT }]);
    expect(
      build([entry({ assistant: streamed(noOutput) })], { model: 'gpt-test', input: 'u2' }),
    ).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'response_output_shape_unknown',
    });
    // The equivalent VALID stream still chains — the parity is in the law, not in a blanket refusal.
    expect(build([entry({ assistant: streamed(sseOf([COMPLETED])) })], {
      model: 'gpt-test',
      input: 'u2',
    })).toEqual({
      ok: true,
      body: { model: 'gpt-test', input: 'u2', previous_response_id: 'resp_t' },
      continuation: { kind: 'response_chain', parentResponseId: 'resp_t' },
    });
  });

  it('a PROVIDER-FAILED capture is still input-only even with a malformed `output` — the verdict comes first', () => {
    // Ordering guard: a response the provider itself declared failed contributes no output at
    // all, so its output shape is irrelevant. Validating it there would brick a branch behind a
    // provider failure — the exact regression the closure sweep fixed for the Anthropic door.
    const result = build(
      [
        entry({
          userNative: { model: 'gpt-test', input: 'u1' },
          assistant: responseAssistant({ id: 'resp_f', status: 'failed', output: 'garbage' }),
        }),
      ],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(result).toEqual({
      ok: true,
      body: {
        model: 'gpt-test',
        input: [{ role: 'user', content: 'u1' }, { role: 'user', content: 'u2' }],
      },
      continuation: { kind: 'stateless_replay' },
    });
  });
});

describe('openai adapter — the dispatching turn is not durable history', () => {
  // First-party: `input` is OPTIONAL on the create request (a `prompt` template can supply the
  // content server-side), and GovAI's send contract validates only that the native request is a
  // JSON object. The turn's own config is POSTed as-is and GovAI reconstructs nothing from it, so
  // an absent `input` must not refuse — and must not refuse on ONE strategy while passing on
  // another, which is what the pre-audit tree did.

  const PROMPT_TURN = { model: 'gpt-test', prompt: { id: 'pmpt_1', version: '3' } };

  it('★ a config with NO `input` builds on EVERY strategy, not just the ones that never read it', () => {
    // chain, no trailing input: the config passes through verbatim (this already worked)
    expect(build([entry({ assistant: responseAssistant(RESP_1) })], PROMPT_TURN)).toEqual({
      ok: true,
      body: { ...PROMPT_TURN, previous_response_id: 'resp_1' },
      continuation: { kind: 'response_chain', parentResponseId: 'resp_1' },
    });
    // chain WITH trailing input: the merge no longer demands an `input` of its own
    expect(
      build(
        [
          entry({ assistant: responseAssistant(RESP_1) }),
          entry({ turnId: 'turn-2', userNative: { model: 'gpt-test', input: 'u2-lost' } }),
        ],
        PROMPT_TURN,
      ),
    ).toEqual({
      ok: true,
      body: {
        ...PROMPT_TURN,
        input: [{ role: 'user', content: 'u2-lost' }],
        previous_response_id: 'resp_1',
      },
      continuation: { kind: 'response_chain', parentResponseId: 'resp_1' },
    });
    // stateless replay: the durable history becomes the whole `input`
    expect(
      build([entry({ assistant: responseAssistant(RESP_1, 'cred-rotated') })], PROMPT_TURN),
    ).toEqual({
      ok: true,
      body: {
        ...PROMPT_TURN,
        input: [{ role: 'user', content: 'u1' }, ...RESP_1.output],
      },
      continuation: { kind: 'stateless_replay' },
    });
  });

  it('a PRESENT but malformed `input` on this turn still refuses, and says whose it is', () => {
    for (const badInput of [42, null, { role: 'user' }]) {
      expect(
        build([entry({ assistant: responseAssistant(RESP_1, 'cred-rotated') })], {
          model: 'gpt-test',
          input: badInput,
        }),
      ).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'config_input_shape_unknown',
      });
    }
  });

  it('a HISTORY entry with no `input` still refuses — replaying an ANSWER without its QUESTION is not fidelity', () => {
    // The deliberate asymmetry, pinned: GovAI cannot reconstruct a turn whose content came from a
    // server-side prompt template, and emitting its assistant output with no user turn in front
    // of it would silently change the context. The refusal names HISTORY, not the config.
    expect(
      build(
        [
          entry({ userNative: { model: 'gpt-test', prompt: { id: 'pmpt_1' } }, assistant: responseAssistant(RESP_1, 'cred-rotated') }),
        ],
        { model: 'gpt-test', input: 'u2' },
      ),
    ).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'history_input_shape_unknown',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RF-3 BOUNDED CROSS-CHECK — the same raw-evidence law, applied to the OpenAI terminal.
//
// FIRST-PARTY, REVERIFIED (OpenAI Node SDK `Response`):
//     id: string;                          // required
//     status?: ResponseStatus;             // OPTIONAL, and NOT nullable
//     output: Array<ResponseOutputItem>;   // required
//
// `status` being OPTIONAL is load-bearing and is deliberately NOT hardened: an ABSENT status must
// stay terminal AND chainable, or GovAI would refuse lawful captures. But "optional" is a
// statement about ABSENCE, not about corruption — a PRESENT non-string status has no first-party
// form, and reading it as "the provider did not tell us" is the same laundering RF-3 named on the
// Anthropic role: it can silently promote a provider-declared FAILURE into a replayed terminal.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const MALFORMED_PRESENT_STATUSES: Array<readonly [string, unknown]> = [
  ['JSON null', null],
  ['a number', 42],
  ['a boolean', true],
  ['an object', {}],
  ['an array', []],
  ['an array WRAPPING a real status', ['completed']],
];

describe('openai adapter — RF-3 cross-check: malformed presence is not absence', () => {
  it('★ a PRESENT non-string `status` refuses instead of being read as "no status"', () => {
    for (const [label, status] of MALFORMED_PRESENT_STATUSES) {
      expect(
        build([entry({ assistant: responseAssistant({ ...RESP_1, status }) })], {
          model: 'gpt-test',
          input: 'u2',
        }),
        label,
      ).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'response_status_shape_unknown',
      });
    }
  });

  it('★ the same law on the STREAMED terminal body: a malformed nested status refuses', () => {
    for (const [label, status] of MALFORMED_PRESENT_STATUSES) {
      const sseText = `data: ${JSON.stringify({
        type: 'response.completed',
        response: { ...RESP_1, status },
      })}\n\n`;
      expect(
        build(
          [
            entry({
              assistant: {
                attemptId: 'att-s',
                providerCredentialId: CRED,
                completedAtMs: FRESH_MS,
                output: { kind: 'stream', sseText },
              },
            }),
          ],
          { model: 'gpt-test', input: 'u2' },
        ),
        label,
      ).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'response_status_shape_unknown',
      });
    }
  });

  it('ANTI-OVER-HARDENING — an ABSENT status stays terminal AND chainable (it is OPTIONAL)', () => {
    // RESP_1 carries no `status` at all. First-party leaves it optional, so this capture is
    // lawful and must keep chaining — hardening absence here would refuse ordinary captures.
    expect(build([entry({ assistant: responseAssistant(RESP_1) })], {
      model: 'gpt-test',
      input: 'u2',
    })).toEqual({
      ok: true,
      body: { model: 'gpt-test', input: 'u2', previous_response_id: 'resp_1' },
      continuation: { kind: 'response_chain', parentResponseId: 'resp_1' },
    });
  });

  it('ANTI-OVER-HARDENING — `completed` chains and a provider FAILURE still projects input-only', () => {
    expect(
      build([entry({ assistant: responseAssistant({ ...RESP_1, status: 'completed' }) })], {
        model: 'gpt-test',
        input: 'u2',
      }),
    ).toEqual({
      ok: true,
      body: { model: 'gpt-test', input: 'u2', previous_response_id: 'resp_1' },
      continuation: { kind: 'response_chain', parentResponseId: 'resp_1' },
    });
    const failed = build(
      [entry({ assistant: responseAssistant({ ...RESP_1, status: 'failed' }) })],
      { model: 'gpt-test', input: 'u2' },
    );
    expect(failed).toEqual({
      ok: true,
      body: { model: 'gpt-test', input: [{ role: 'user', content: 'u1' }, { role: 'user', content: 'u2' }] },
      continuation: { kind: 'stateless_replay' },
    });
  });

  it('ANTI-OVER-HARDENING — an invalid/absent anchor `id` still DEGRADES to stateless replay', () => {
    // §14 of the closure dispatch, explicitly: safe degradation must NOT be converted into
    // fail-close for symmetry. Chainability is a strategy choice; replayability is the law, and
    // this capture is still fully replayable.
    for (const id of [undefined, '', 42, null]) {
      const body: Record<string, unknown> = { ...RESP_1 };
      if (id === undefined) delete body['id'];
      else body['id'] = id;
      expect(
        build([entry({ assistant: responseAssistant(body) })], { model: 'gpt-test', input: 'u2' }),
        JSON.stringify(id),
      ).toEqual({
        ok: true,
        body: {
          model: 'gpt-test',
          input: [{ role: 'user', content: 'u1' }, ...RESP_1.output, { role: 'user', content: 'u2' }],
        },
        continuation: { kind: 'stateless_replay' },
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RF-5 — STRUCTURAL ADMISSIBILITY OF CAPTURED OUTPUT ELEMENTS (review finding 3901193182).
//
// RF-1 closed the CONTAINER question — `output` must be an array, decided once, for every
// strategy. It did not ask the ELEMENT question, so `output: [null]` still satisfied the whole
// chaining predicate: a response GovAI cannot replay became a chain anchor, and the same capture
// on any stateless fallback injected the primitive straight into the next Responses `input`.
//
// FIRST-PARTY BASIS (openai@6.35.0, the installed generated client — machine-readable, not
// remembered): `Response.output` is `Array<ResponseOutputItem>`, and EVERY ONE of the 25 members
// of that union is an `interface` — an object type. There is no primitive, string-literal or
// array member. A primitive element therefore has NO representation in the provider's own
// contract, so refusing one cannot refuse legitimate provider output.
//
// ★ STRUCTURAL STRICTNESS != CLOSED TYPE ENUMERATION. The union is provider-EVOLVING (compaction,
// tool-search and apply-patch items are recent additions), so enumerating known `type` values
// would version-lock this adapter. The law is object-SHAPE only; unknown object types pass
// through verbatim, exactly as the Anthropic door's `content_block_not_object` rule does.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Every primitive JSON shape an `output` element could carry. None is a lawful ResponseOutputItem. */
const PRIMITIVE_OUTPUT_ITEMS: Array<readonly [string, unknown]> = [
  ['null', null],
  ['number', 42],
  ['string', 'x'],
  ['boolean', true],
  // An ARRAY is not an object either: no union member is an array, and `isObject` excludes them.
  ['array', ['nested']],
];

/** A future provider item type this adapter has never heard of. Object-shaped, so it MUST pass. */
const FUTURE_OUTPUT_ITEM = { type: 'future_provider_item', id: 'fut_1', opaque: 'preserve me' };

const storedOutput = (output: unknown) =>
  build([entry({ assistant: responseAssistant({ id: 'resp_1', status: 'completed', output }) })], {
    model: 'gpt-test',
    input: 'u2',
  });

const streamedOutput = (output: unknown) =>
  build(
    [
      entry({
        assistant: streamed(
          sseOf([{ type: 'response.completed', response: { id: 'resp_t', status: 'completed', output } }]),
        ),
      }),
    ],
    { model: 'gpt-test', input: 'u2' },
  );

const OUTPUT_DOORS = [
  ['stored response body', storedOutput],
  ['streamed terminal event', streamedOutput],
] as const;

describe('openai adapter — RF-5: a captured output ELEMENT must be object-shaped', () => {
  it('★ RF-5 — OPENAI-A1/A2/A3 — a primitive output element refuses on BOTH doors', () => {
    // OPENAI-A1 is the `[null]` case the finding names; A2 widens it to every primitive; A3 is
    // the same matrix through the streamed terminal.
    for (const [label, item] of PRIMITIVE_OUTPUT_ITEMS) {
      for (const [door, run] of OUTPUT_DOORS) {
        expect(run([item]), `${label} via ${door}`).toEqual({
          ok: false,
          reason: 'context_unreplayable',
          detail: 'response_output_item_not_object',
        });
      }
    }
  });

  it('★ OPENAI-A4 — stored and streamed give the SAME verdict for the same raw output', () => {
    // First-party makes this a REQUIREMENT, not a nicety: `ResponseCompletedEvent.response` and
    // `ResponseIncompleteEvent.response` are typed as the SAME `Response` object the stored door
    // holds. One grammar, one verdict — the transport cannot change the answer.
    const values: Array<readonly [string, unknown]> = [
      ...PRIMITIVE_OUTPUT_ITEMS.map(([l, v]) => [l, [v]] as const),
      ['empty array', []],
      ['known object item', [{ type: 'message', role: 'assistant', content: [] }]],
      ['future object item', [FUTURE_OUTPUT_ITEM]],
      ['a primitive AFTER a valid item', [{ type: 'message', role: 'assistant', content: [] }, 7]],
    ];
    for (const [label, output] of values) {
      const verdicts = OUTPUT_DOORS.map(([, run]) => {
        const r = run(output);
        return r.ok ? 'ACCEPT' : `REFUSE(${(r as unknown as { detail: string }).detail})`;
      });
      expect(new Set(verdicts).size, `${label} → ${JSON.stringify(verdicts)}`).toBe(1);
    }
  });

  it('★ OPENAI-A5 — an UNKNOWN object item is accepted and replayed BYTE-PRESERVED', () => {
    // The forward-compatibility boundary. The rule enumerates no `type`, so a provider item this
    // adapter has never seen rides through the STATELESS projection untouched — the path that
    // actually re-sends the captured output, and therefore the one where any reshaping would show.
    const statelessState = STRATEGY_STATES.find((s) => s.name === 'this turn sets store:false')!;
    const result = underState(statelessState, {
      id: 'resp_1',
      status: 'completed',
      output: [FUTURE_OUTPUT_ITEM],
    });
    expect(result).toEqual({
      ok: true,
      body: {
        model: 'gpt-test',
        store: false,
        input: [
          { role: 'user', content: 'u1' },
          FUTURE_OUTPUT_ITEM,
          { role: 'user', content: 'u2' },
        ],
      },
      continuation: { kind: 'stateless_replay' },
    });
    // Identity, not just deep equality: the element is the SAME object, never a reconstruction.
    const replayed = (result as unknown as { body: { input: unknown[] } }).body.input[1];
    expect(replayed).toBe(FUTURE_OUTPUT_ITEM);
  });

  it('★ OPENAI-A6 — an EMPTY output array stays lawful (first-party permits it)', () => {
    // `output` is `Array<ResponseOutputItem>`; the empty array is a valid array. A response that
    // produced no items is honest terminal context, and it still chains.
    expect(storedOutput([])).toEqual({
      ok: true,
      body: { model: 'gpt-test', input: 'u2', previous_response_id: 'resp_1' },
      continuation: { kind: 'response_chain', parentResponseId: 'resp_1' },
    });
  });

  it('★ OPENAI-A7 — a valid known object output is unchanged by the new rule', () => {
    expect(build([entry({ assistant: responseAssistant(RESP_1) })], {
      model: 'gpt-test',
      input: 'u2',
    })).toEqual({
      ok: true,
      body: { model: 'gpt-test', input: 'u2', previous_response_id: 'resp_1' },
      continuation: { kind: 'response_chain', parentResponseId: 'resp_1' },
    });
  });

  it('★ OPENAI-A8 — the malformed capture is unreplayable in EVERY strategy state', () => {
    // The temporal form, exactly as RF-1 pinned it: a replayability law must not depend on which
    // continuation strategy happens to be selected. Chaining must not admit what the stateless
    // fallback would refuse — that is how `chainable ⇒ replayable` is kept true by construction.
    for (const state of STRATEGY_STATES) {
      expect(
        underState(state, { id: 'resp_1', status: 'completed', output: [null] }),
        state.name,
      ).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'response_output_item_not_object',
      });
    }
  });

  it('★ OPENAI-A8 (mirror) — a capture with an UNKNOWN object item still succeeds in every state', () => {
    // Without this, "refuse more often" would be indistinguishable from the fix.
    for (const state of STRATEGY_STATES) {
      const result = underState(state, {
        id: 'resp_1',
        status: 'completed',
        output: [FUTURE_OUTPUT_ITEM],
      });
      expect(result.ok, state.name).toBe(true);
    }
  });

  it('★ OPENAI-A9 — a PROVIDER-FAILED capture never has its output structurally judged', () => {
    // Ordering guard. A response the provider itself declared failed contributes NO output to the
    // context, so its output shape is irrelevant — validating it would brick a branch behind a
    // provider failure. Both failure doors: the stored `status`, and the streamed `response.failed`.
    const expected = {
      ok: true,
      body: {
        model: 'gpt-test',
        input: [{ role: 'user', content: 'u1' }, { role: 'user', content: 'u2' }],
      },
      continuation: { kind: 'stateless_replay' },
    };
    for (const status of ['failed', 'cancelled']) {
      expect(
        build(
          [entry({ assistant: responseAssistant({ id: 'resp_f', status, output: [null, 42] }) })],
          { model: 'gpt-test', input: 'u2' },
        ),
        status,
      ).toEqual(expected);
    }
    expect(
      build(
        [
          entry({
            assistant: streamed(
              sseOf([{ type: 'response.failed', response: { id: 'resp_f', output: [null] } }]),
            ),
          }),
        ],
        { model: 'gpt-test', input: 'u2' },
      ),
    ).toEqual(expected);
  });
});
