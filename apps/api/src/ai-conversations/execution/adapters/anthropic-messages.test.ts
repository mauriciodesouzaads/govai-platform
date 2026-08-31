// Anthropic Messages adapter — pure build/reassembly proofs (P0-D1; spec §11/§12/§17/§18).
//
// Everything here runs without a database, KMS or network: the adapter is pure by contract,
// and these tests are what make the §11 rules falsifiable one by one.

import { describe, it, expect } from 'vitest';
import { anthropicMessagesAdapter } from './anthropic-messages.js';
import type { AssembledContextEntry } from '../durable-context.js';

const MODEL = 'claude-test';
const CRED = 'cred-active';

const user = (text: string) => ({ role: 'user', content: text });

function entry(overrides: Partial<AssembledContextEntry>): AssembledContextEntry {
  return {
    turnId: 'turn-1',
    sourceProvider: 'anthropic',
    sourceModel: MODEL,
    selectedAttemptProviderFailed: false,
    userNative: { model: MODEL, max_tokens: 64, messages: [user('u1')] },
    assistant: null,
    ...overrides,
  };
}

function responseAssistant(
  content: unknown[],
  attemptId = 'att-1',
  bodyModel?: string,
): AssembledContextEntry['assistant'] {
  return {
    attemptId,
    providerCredentialId: CRED,
    completedAtMs: 1_800_000_000_000,
    output: {
      kind: 'response',
      body: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        ...(bodyModel === undefined ? {} : { model: bodyModel }),
        content,
      },
    },
  };
}

function build(entries: AssembledContextEntry[], turnConfig: unknown) {
  return anthropicMessagesAdapter.buildRequest({
    entries,
    turnConfig,
    branchModel: MODEL,
    activeCredentialId: CRED,
    nowMs: 1_800_000_060_000,
  });
}

const sse = (events: unknown[]): string => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

describe('anthropic adapter — history assembly', () => {
  it('a turn with NO eligible history posts its stored config VERBATIM (byte-identical to P0-C)', () => {
    const config = { model: MODEL, max_tokens: 8, messages: [user('first')], stream: true };
    const result = build([], config);
    expect(result).toEqual({ ok: true, body: config, continuation: { kind: 'stateless_replay' } });
    // Same reference: nothing was cloned, reordered or normalized.
    expect((result as unknown as { body: unknown }).body).toBe(config);
  });

  it('history splices as [prior user … prior assistant … own messages], controls preserved verbatim', () => {
    const config = {
      model: MODEL,
      max_tokens: 99,
      system: 'be terse',
      tools: [{ name: 't', input_schema: { type: 'object' } }],
      messages: [user('u2')],
    };
    const result = build(
      [entry({ assistant: responseAssistant([{ type: 'text', text: 'A1' }]) })],
      config,
    );
    expect(result.ok).toBe(true);
    const body = (result as unknown as { body: Record<string, unknown> }).body;
    expect(body['messages']).toEqual([
      user('u1'),
      { role: 'assistant', content: [{ type: 'text', text: 'A1' }] },
      user('u2'),
    ]);
    // Every non-context control passed through untouched (§30).
    expect(body['max_tokens']).toBe(99);
    expect(body['system']).toBe('be terse');
    expect(body['tools']).toEqual(config.tools);
  });

  it('a turn whose attempt produced NO eligible output contributes its user input ONLY', () => {
    // Consecutive user turns are legal Messages history (first-party: combined by the API).
    const result = build(
      [entry({ assistant: null }), entry({ userNative: { messages: [user('u2')] }, assistant: responseAssistant([{ type: 'text', text: 'A2' }]) })],
      { model: MODEL, messages: [user('u3')] },
    );
    expect(result.ok).toBe(true);
    expect((result as unknown as { body: Record<string, unknown> }).body['messages']).toEqual([
      user('u1'),
      user('u2'),
      { role: 'assistant', content: [{ type: 'text', text: 'A2' }] },
      user('u3'),
    ]);
  });

  it('tool_use and tool_result blocks replay with their provider shape intact (A8)', () => {
    const toolUse = { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'SP' } };
    const result = build(
      [entry({ assistant: responseAssistant([{ type: 'text', text: 'checking' }, toolUse]) })],
      {
        model: MODEL,
        messages: [
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '25C' }] },
        ],
      },
    );
    expect(result.ok).toBe(true);
    const messages = (result as unknown as { body: { messages: unknown[] } }).body.messages;
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'checking' }, toolUse],
    });
    expect(messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '25C' }],
    });
  });

  it('a stored response body with a NON-ASSISTANT role refuses, matching the stream rule', () => {
    const result = build(
      [
        entry({
          assistant: {
            attemptId: 'att-r',
            providerCredentialId: CRED,
            completedAtMs: 1_800_000_000_000,
            output: {
              kind: 'response',
              body: { id: 'msg_r', type: 'message', role: 'user', content: [{ type: 'text', text: 'A1' }] },
            },
          },
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'message_role_not_assistant',
    });
  });

  it('fails CLOSED when a history input is not message-shaped', () => {
    const result = build([entry({ userNative: { model: MODEL, prompt: 'not-messages' } })], {
      model: MODEL,
      messages: [user('u2')],
    });
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'history_input_shape_unknown',
    });
  });

  it('fails CLOSED when the own config has history to splice but no messages array', () => {
    const result = build([entry({})], { model: MODEL, input: 'wrong-provider-shape' });
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'config_messages_not_array',
    });
  });
});

describe('anthropic adapter — cross-provider ancestry (§17 / LAW NX-16)', () => {
  it('a cross-provider fork ancestor refuses with the PRECISE reason, never a shape error', () => {
    const result = build(
      [
        entry({
          sourceProvider: 'openai',
          userNative: { model: 'gpt-test', input: 'from-the-openai-parent' },
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'cross_provider_replay_not_implemented',
    });
  });
});

describe('anthropic adapter — thinking blocks and the model-switch rule (A9/§18)', () => {
  const thinking = {
    type: 'thinking',
    thinking: 'let me reason…',
    signature: 'EqQBCgIYAhIkSIGNATUREBYTES==',
  };

  it('same-model replay preserves thinking blocks and signatures BYTE-IDENTICALLY', () => {
    const result = build(
      [entry({ assistant: responseAssistant([thinking, { type: 'text', text: 'A1' }]) })],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result.ok).toBe(true);
    const messages = (result as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages;
    expect(messages[1]!.content[0]).toEqual(thinking);
    expect((messages[1]!.content[0] as { signature: string }).signature).toBe(thinking.signature);
  });

  it('a MODEL-SWITCHED entry strips thinking and redacted_thinking (the first-party rule)', () => {
    // The historical model comes from the provider's OWN response body — native truth.
    const result = build(
      [
        entry({
          assistant: responseAssistant(
            [thinking, { type: 'redacted_thinking', data: 'opaque' }, { type: 'text', text: 'A1' }],
            'att-1',
            'claude-other',
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result.ok).toBe(true);
    const messages = (result as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages;
    expect(messages[1]!.content).toEqual([{ type: 'text', text: 'A1' }]);
  });

  it('the comparison uses the models ACTUALLY IN PLAY, not branch metadata (either direction)', () => {
    // Branch metadata identical on both sides, but the provider says a DIFFERENT model
    // produced the answer -> strip (retaining a foreign signature would be rejected upstream).
    const nativeSwitch = build(
      [entry({ sourceModel: MODEL, assistant: responseAssistant([thinking, { type: 'text', text: 'A1' }], 'att-1', 'claude-other') })],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(nativeSwitch.ok).toBe(true);
    expect(
      (nativeSwitch as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages[1]!.content,
    ).toEqual([{ type: 'text', text: 'A1' }]);

    // Branch metadata DIFFERS (a metadata drift), but the native models match -> valid
    // thinking is NOT stripped.
    const metadataDrift = build(
      [entry({ sourceModel: 'claude-other', assistant: responseAssistant([thinking, { type: 'text', text: 'A1' }], 'att-1', MODEL) })],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(metadataDrift.ok).toBe(true);
    expect(
      (metadataDrift as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages[1]!.content,
    ).toEqual([thinking, { type: 'text', text: 'A1' }]);
  });

  it('refuses when a model switch would leave an EMPTY assistant message', () => {
    const result = build(
      [entry({ assistant: responseAssistant([thinking], 'att-1', 'claude-other') })],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'model_switch_leaves_empty_message',
    });
  });
});

describe('anthropic adapter — durable stream reassembly', () => {
  function streamAssistant(sseText: string): AssembledContextEntry['assistant'] {
    return {
      attemptId: 'att-s',
      providerCredentialId: CRED,
      completedAtMs: 1_800_000_000_000,
      output: { kind: 'stream', sseText },
    };
  }

  it('reassembles text blocks from deltas, in wire order', () => {
    const result = build(
      [
        entry({
          assistant: streamAssistant(
            sse([
              { type: 'message_start', message: { id: 'msg_s', role: 'assistant' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
              { type: 'message_stop' },
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result.ok).toBe(true);
    const messages = (result as unknown as { body: { messages: unknown[] } }).body.messages;
    expect(messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Hello' }] });
  });

  it('reassembles tool_use input from input_json_delta fragments', () => {
    const result = build(
      [
        entry({
          assistant: streamAssistant(
            sse([
              { type: 'message_start', message: { role: 'assistant' } },
              {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'tool_use', id: 'toolu_9', name: 'calc', input: {} },
              },
              { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a"' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ':1}' } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_stop' },
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result.ok).toBe(true);
    const messages = (result as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages;
    expect(messages[1]!.content[0]).toEqual({ type: 'tool_use', id: 'toolu_9', name: 'calc', input: { a: 1 } });
  });

  it('reassembles thinking + signature deltas, preserving the signature exactly (A9)', () => {
    const result = build(
      [
        entry({
          assistant: streamAssistant(
            sse([
              { type: 'message_start', message: { role: 'assistant' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm ' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'ok' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIGBYTES==' } },
              { type: 'content_block_stop', index: 0 },
              { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
              { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'A' } },
              { type: 'content_block_stop', index: 1 },
              { type: 'message_stop' },
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result.ok).toBe(true);
    const messages = (result as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages;
    expect(messages[1]!.content).toEqual([
      { type: 'thinking', thinking: 'hm ok', signature: 'SIGBYTES==' },
      { type: 'text', text: 'A' },
    ]);
  });

  it('an UNKNOWN delta type refuses rather than replaying a guess (§31)', () => {
    const result = build(
      [
        entry({
          assistant: streamAssistant(
            sse([
              { type: 'message_start', message: { role: 'assistant' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'future_delta', payload: 'x' } },
              { type: 'content_block_stop', index: 0 },
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'delta_type_unknown' });
  });

  it('a TRUNCATED stream — no message_stop — refuses: a partial answer is never replayed as final', () => {
    const result = build(
      [
        entry({
          assistant: streamAssistant(
            sse([
              { type: 'message_start', message: { role: 'assistant' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial ans' } },
              { type: 'content_block_stop', index: 0 },
              // stream ends here: EOF without message_stop (a clean proxy truncation)
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'stream_truncated' });
  });

  it('a stream whose block never STOPPED refuses too', () => {
    const result = build(
      [
        entry({
          assistant: streamAssistant(
            sse([
              { type: 'message_start', message: { role: 'assistant' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'cut mid-blo' } },
              { type: 'message_stop' },
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'stream_truncated' });
  });

  it('a stream carrying the provider ERROR verdict projects as INPUT-ONLY context', () => {
    // The provider itself said this request failed: the turn's question stays context, the
    // non-answer never does, and the branch is not blocked behind a provider failure.
    const result = build(
      [
        entry({
          assistant: streamAssistant(
            sse([
              { type: 'message_start', message: { role: 'assistant' } },
              { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result.ok).toBe(true);
    expect((result as unknown as { body: { messages: unknown[] } }).body.messages).toEqual([
      user('u1'),
      user('u2'),
    ]);
  });

  it('a KNOWN delta type with a MISSING or mistyped payload refuses: coercion would fabricate content', () => {
    // Each malformed delta is paired with a block of its COMPATIBLE type, so the refusal
    // exercised is the payload validation itself (type mismatches have their own proof).
    const cases: Array<{ block: Record<string, unknown>; delta: Record<string, unknown> }> = [
      { block: { type: 'text', text: '' }, delta: { type: 'text_delta' } },
      { block: { type: 'text', text: '' }, delta: { type: 'text_delta', text: 42 } },
      { block: { type: 'thinking', thinking: '' }, delta: { type: 'thinking_delta' } },
      { block: { type: 'thinking', thinking: '' }, delta: { type: 'signature_delta' } },
      { block: { type: 'tool_use', id: 't', name: 'f', input: {} }, delta: { type: 'input_json_delta' } },
      { block: { type: 'tool_use', id: 't', name: 'f', input: {} }, delta: { type: 'input_json_delta', partial_json: null } },
      { block: { type: 'text', text: '' }, delta: { type: 'citations_delta' } },
    ];
    for (const c of cases) {
      const result = build(
        [
          entry({
            assistant: streamAssistant(
              sse([
                { type: 'message_start', message: { role: 'assistant' } },
                { type: 'content_block_start', index: 0, content_block: c.block },
                { type: 'content_block_delta', index: 0, delta: c.delta },
                { type: 'content_block_stop', index: 0 },
                { type: 'message_stop' },
              ]),
            ),
          }),
        ],
        { model: MODEL, messages: [user('u2')] },
      );
      expect(result).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'delta_payload_invalid',
      });
    }
  });

  it('a REUSED content-block index refuses: a duplicated frame must not overwrite and double-replay', () => {
    const result = build(
      [
        entry({
          assistant: streamAssistant(
            sse([
              { type: 'message_start', message: { role: 'assistant' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'first' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'dup' } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_stop' },
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'block_index_reused' });
  });

  it('a delta or stop AFTER the block already stopped refuses: post-stop frames must not mutate replay', () => {
    const base = [
      { type: 'message_start', message: { role: 'assistant' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'real' } },
      { type: 'content_block_stop', index: 0 },
    ];
    const lateDelta = build(
      [
        entry({
          assistant: streamAssistant(
            sse([...base, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' injected' } }, { type: 'message_stop' }]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(lateDelta).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'delta_after_stop' });

    const doubleStop = build(
      [
        entry({
          assistant: streamAssistant(
            sse([...base, { type: 'content_block_stop', index: 0 }, { type: 'message_stop' }]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(doubleStop).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'block_already_stopped' });
  });

  it('a frame AFTER message_stop refuses: the terminal event is terminal', () => {
    const result = build(
      [
        entry({
          assistant: streamAssistant(
            sse([
              { type: 'message_start', message: { role: 'assistant' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A' } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_stop' },
              { type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'post-terminal' } },
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'frame_after_message_stop' });
  });

  it('a delta targeting the WRONG block type refuses: cross-type mutation is fabrication', () => {
    const cases: Array<{ block: Record<string, unknown>; delta: Record<string, unknown> }> = [
      { block: { type: 'text', text: '' }, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { block: { type: 'tool_use', id: 't', name: 'f', input: {} }, delta: { type: 'text_delta', text: 'x' } },
      { block: { type: 'text', text: '' }, delta: { type: 'thinking_delta', thinking: 'x' } },
      { block: { type: 'thinking', thinking: '' }, delta: { type: 'text_delta', text: 'x' } },
    ];
    for (const c of cases) {
      const result = build(
        [
          entry({
            assistant: streamAssistant(
              sse([
                { type: 'message_start', message: { role: 'assistant' } },
                { type: 'content_block_start', index: 0, content_block: c.block },
                { type: 'content_block_delta', index: 0, delta: c.delta },
                { type: 'content_block_stop', index: 0 },
                { type: 'message_stop' },
              ]),
            ),
          }),
        ],
        { model: MODEL, messages: [user('u2')] },
      );
      expect(result).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'delta_block_type_mismatch',
      });
    }
  });

  it('a thinking delta AFTER the signature refuses: the signature signs final content', () => {
    const result = build(
      [
        entry({
          assistant: streamAssistant(
            sse([
              { type: 'message_start', message: { role: 'assistant' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'signed' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG==' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: ' tampered' } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_stop' },
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'delta_after_signature' });
  });

  it('message_start is required first, unique, and assistant-role (strict when present)', () => {
    const textBlock = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ];
    const missing = build(
      [entry({ assistant: streamAssistant(sse(textBlock)) })],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(missing).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'content_before_message_start' });

    const duplicate = build(
      [
        entry({
          assistant: streamAssistant(
            sse([
              { type: 'message_start', message: { role: 'assistant' } },
              { type: 'message_start', message: { role: 'assistant', model: 'other' } },
              ...textBlock,
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(duplicate).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'duplicate_message_start' });

    const wrongRole = build(
      [
        entry({
          assistant: streamAssistant(
            sse([{ type: 'message_start', message: { role: 'user' } }, ...textBlock]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(wrongRole).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'message_role_not_assistant' });
  });

  it('a thinking block that never received its signature refuses to close', () => {
    const result = build(
      [
        entry({
          assistant: streamAssistant(
            sse([
              { type: 'message_start', message: { role: 'assistant' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'unsigned' } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_stop' },
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'thinking_block_unsigned' });
  });

  it('NON-CONTIGUOUS block indexes refuse: positions must arrive as 0,1,2,…', () => {
    for (const startIndexes of [[1], [0, 2], [1, 0]]) {
      const events: unknown[] = [{ type: 'message_start', message: { role: 'assistant' } }];
      for (const i of startIndexes) {
        events.push({ type: 'content_block_start', index: i, content_block: { type: 'text', text: 'x' } });
        events.push({ type: 'content_block_stop', index: i });
      }
      events.push({ type: 'message_stop' });
      const result = build(
        [entry({ assistant: streamAssistant(sse(events)) })],
        { model: MODEL, messages: [user('u2')] },
      );
      expect(result).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'block_index_not_contiguous',
      });
    }
  });

  it('a KNOWN block start with malformed required fields refuses', () => {
    const cases: Array<Record<string, unknown>> = [
      { type: 'text', text: 42 },
      { type: 'text' },
      { type: 'thinking' },
      { type: 'tool_use', name: 'f', input: {} }, // missing id
      { type: 'tool_use', id: 't', input: {} }, // missing name
      { type: 'tool_use', id: 't', name: 'f' }, // missing input
      { type: 'redacted_thinking' }, // missing data
    ];
    for (const block of cases) {
      const result = build(
        [
          entry({
            assistant: streamAssistant(
              sse([
                { type: 'message_start', message: { role: 'assistant' } },
                { type: 'content_block_start', index: 0, content_block: block },
                { type: 'content_block_stop', index: 0 },
                { type: 'message_stop' },
              ]),
            ),
          }),
        ],
        { model: MODEL, messages: [user('u2')] },
      );
      expect(result).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'block_start_payload_invalid',
      });
    }
  });

  it('accumulated tool input that parses to a NON-OBJECT refuses', () => {
    for (const fragment of ['[]', 'null', '42', '"str"']) {
      const result = build(
        [
          entry({
            assistant: streamAssistant(
              sse([
                { type: 'message_start', message: { role: 'assistant' } },
                { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'f', input: {} } },
                { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: fragment } },
                { type: 'content_block_stop', index: 0 },
                { type: 'message_stop' },
              ]),
            ),
          }),
        ],
        { model: MODEL, messages: [user('u2')] },
      );
      expect(result).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'tool_input_json_invalid',
      });
    }
  });

  it('a success sequence AFTER an error verdict refuses: conflicted captures never pick a side', () => {
    const result = build(
      [
        entry({
          assistant: streamAssistant(
            sse([
              { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
              { type: 'message_start', message: { role: 'assistant' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ghost' } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_stop' },
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'frame_after_error' });
  });

  it('an UNKNOWN event type refuses too', () => {
    const result = build(
      [entry({ assistant: streamAssistant(sse([{ type: 'future_event' }])) })],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'event_type_unknown' });
  });

  it('★ a COMPLETE stream with no content blocks is the provider NON-ANSWER (refusal), not a refusal to replay', () => {
    // First-party: a classifier refusal is "a normal response, not an error" — 2xx, with
    // `"content": []` and `stop_reason: "refusal"`. Refusing it would brick every later turn of
    // a branch that ever contained one, so it projects INPUT-ONLY.
    const result = build(
      [
        entry({
          userNative: { model: MODEL, messages: [user('u1')] },
          assistant: streamAssistant(
            sse([
              { type: 'message_start', message: { role: 'assistant', model: MODEL } },
              { type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 0 } },
              { type: 'message_stop' },
            ]),
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result.ok).toBe(true);
    expect((result as unknown as { body: Record<string, unknown> }).body['messages']).toEqual([
      user('u1'),
      user('u2'),
    ]);
  });

  it('a TRUNCATED empty stream still refuses: no terminal event means an ambiguous capture', () => {
    // The discrimination is the terminal proof, never the content count.
    const result = build(
      [entry({ assistant: streamAssistant(sse([{ type: 'message_start', message: {} }])) })],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'stream_truncated',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PROTOCOL-GRAMMAR CLOSURE SWEEP — the stream event flow as a state machine, and the ONE replay
// law both transports must satisfy. First-party event flow (reverified 2026-08-31, verbatim):
//   "1. `message_start` … 2. A series of content blocks … 3. One or more `message_delta`
//    events … 4. A final `message_stop` event."
// ─────────────────────────────────────────────────────────────────────────────────────────────

function streamed(sseText: string): AssembledContextEntry['assistant'] {
  return {
    attemptId: 'att-g',
    providerCredentialId: CRED,
    completedAtMs: 1_800_000_000_000,
    output: { kind: 'stream', sseText },
  };
}

const START = { type: 'message_start', message: { role: 'assistant' } };
const TEXT_BLOCK = [
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A' } },
  { type: 'content_block_stop', index: 0 },
];
const DELTA = { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } };

const grammar = (events: unknown[]) =>
  build([entry({ assistant: streamed(sse(events)) })], { model: MODEL, messages: [user('u2')] });

describe('anthropic adapter — message_delta joins the stream state machine', () => {
  it('the DOCUMENTED position replays normally: blocks … message_delta … message_stop', () => {
    const result = grammar([START, ...TEXT_BLOCK, DELTA, { type: 'message_stop' }]);
    expect(result.ok).toBe(true);
    const messages = (result as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages;
    expect(messages[1]!.content).toEqual([{ type: 'text', text: 'A' }]);
  });

  it('★ REPEATED message_delta is LEGAL: first-party says "One or more" — uniqueness is NOT enforced', () => {
    // A validator that rejects legitimate provider output is its own defect. This proof is what
    // keeps the ordering rule from being over-hardened into a cardinality rule.
    const result = grammar([START, ...TEXT_BLOCK, DELTA, DELTA, { type: 'message_stop' }]);
    expect(result.ok).toBe(true);
    expect(
      (result as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages[1]!.content,
    ).toEqual([{ type: 'text', text: 'A' }]);
  });

  it('every CONTENT frame after message_delta refuses: the message delta closes the content phase', () => {
    const after: Array<[string, unknown]> = [
      ['start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'late' } }],
      ['delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'late' } }],
      ['stop', { type: 'content_block_stop', index: 0 }],
    ];
    for (const [, frame] of after) {
      expect(grammar([START, ...TEXT_BLOCK, DELTA, frame, { type: 'message_stop' }])).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'content_after_message_delta',
      });
    }
  });

  it('message_delta INTERLEAVED into an open content block refuses: step 3 follows step 2 in full', () => {
    expect(
      grammar([
        START,
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A' } },
        DELTA,
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]),
    ).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'message_delta_before_block_stop',
    });
  });

  it('message_delta BEFORE message_start refuses', () => {
    expect(grammar([DELTA, START, ...TEXT_BLOCK, { type: 'message_stop' }])).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'message_delta_before_message_start',
    });
  });

  it('message_start without its Message object refuses: role/model metadata cannot be read', () => {
    expect(grammar([{ type: 'message_start' }, ...TEXT_BLOCK, { type: 'message_stop' }])).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'message_start_shape_unknown',
    });
  });

  it('★ ping stays legal EVERYWHERE a frame is legal — "any number of ping events", no position rule', () => {
    const ping = { type: 'ping' };
    const result = grammar([
      ping,
      START,
      ping,
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      ping,
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A' } },
      { type: 'content_block_stop', index: 0 },
      ping,
      DELTA,
      ping,
      { type: 'message_stop' },
    ]);
    expect(result.ok).toBe(true);
    expect(
      (result as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages[1]!.content,
    ).toEqual([{ type: 'text', text: 'A' }]);
  });
});

describe('anthropic adapter — ONE replay law, both transports (stream / non-stream parity)', () => {
  const stored = (content: unknown[]) =>
    build([entry({ assistant: responseAssistant(content) })], { model: MODEL, messages: [user('u2')] });

  it('★ a stored UNSIGNED thinking block refuses, exactly as the stream path refuses it', () => {
    // The provider ALWAYS signs a completed thinking block. Replaying an unsigned one would
    // make Anthropic reject every later turn of the branch.
    for (const block of [
      { type: 'thinking', thinking: 'reasoned' }, // signature missing
      { type: 'thinking', thinking: 'reasoned', signature: 42 }, // signature not a string
      { type: 'thinking', thinking: 'reasoned', signature: null },
    ]) {
      expect(stored([block, { type: 'text', text: 'A1' }])).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'content_block_payload_invalid',
      });
    }
  });

  it('a stored KNOWN block with malformed required fields refuses — the same set the stream enforces', () => {
    const cases: unknown[] = [
      { type: 'text', text: 42 },
      { type: 'text' },
      { type: 'thinking', signature: 'sig' }, // thinking not a string
      { type: 'redacted_thinking' }, // missing data
      { type: 'tool_use', name: 'f', input: {} }, // missing id
      { type: 'tool_use', id: 't', input: {} }, // missing name
      { type: 'tool_use', id: 't', name: 'f' }, // missing input
      { type: 'tool_use', id: 't', name: 'f', input: [] }, // input not an object
      { type: 'server_tool_use', id: 't', name: 'f' },
      { type: 'mcp_tool_use', id: 't', name: 'f' },
    ];
    for (const block of cases) {
      expect(stored([block])).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'content_block_payload_invalid',
      });
    }
  });

  it('a stored NON-OBJECT content element refuses: corruption is not a forward-compatible block', () => {
    for (const block of ['text', 42, null, ['nested']]) {
      expect(stored([block])).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'content_block_not_object',
      });
    }
  });

  it('a content block with NO type discriminator refuses on BOTH doors', () => {
    expect(stored([{ text: 'no type field' }])).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'content_block_type_invalid',
    });
    expect(
      grammar([
        START,
        { type: 'content_block_start', index: 0, content_block: { text: 'no type field' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]),
    ).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'block_start_payload_invalid',
    });
  });

  it('★ a stored EMPTY content array is a provider NON-ANSWER: input-only, never a branch-bricking refusal', () => {
    // The exact documented refusal body: 2xx, `"content": []`, `stop_reason: "refusal"`,
    // `output_tokens: 0`. Both doors must reach the same verdict as the streamed form.
    const result = build(
      [
        entry({
          userNative: { model: MODEL, messages: [user('u1')] },
          assistant: {
            attemptId: 'att-refusal',
            providerCredentialId: CRED,
            completedAtMs: 1_800_000_000_000,
            output: {
              kind: 'response',
              body: {
                id: 'msg_01XFUDYJgAACzvnptvVoYEL',
                type: 'message',
                role: 'assistant',
                model: MODEL,
                content: [],
                stop_reason: 'refusal',
                stop_details: { type: 'refusal', category: 'cyber' },
                usage: { input_tokens: 412, output_tokens: 0 },
              },
            },
          },
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result.ok).toBe(true);
    expect((result as unknown as { body: Record<string, unknown> }).body['messages']).toEqual([
      user('u1'),
      user('u2'),
    ]);
  });

  it('★ UNKNOWN block types still pass through VERBATIM on both doors (§31 forward compatibility)', () => {
    // A server-side-fallback `fallback` block arrives as a start/stop pair with no deltas and
    // "stays where it appeared" — the native-fidelity posture must not fail-close on it.
    const streamResult = grammar([
      START,
      { type: 'content_block_start', index: 0, content_block: { type: 'fallback' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'A' } },
      { type: 'content_block_stop', index: 1 },
      DELTA,
      { type: 'message_stop' },
    ]);
    expect(streamResult.ok).toBe(true);
    expect(
      (streamResult as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages[1]!.content,
    ).toEqual([{ type: 'fallback' }, { type: 'text', text: 'A' }]);

    const future = { type: 'future_block_2027', payload: { opaque: true } };
    const storedResult = stored([future, { type: 'text', text: 'A1' }]);
    expect(storedResult.ok).toBe(true);
    expect(
      (storedResult as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages[1]!.content,
    ).toEqual([future, { type: 'text', text: 'A1' }]);
  });

  it('a stored SIGNED thinking block still replays byte-identically: the law hardens, never strips', () => {
    const signed = { type: 'thinking', thinking: '', signature: 'EosnCkYICxIMMb3LzNrMu' };
    const result = stored([signed, { type: 'text', text: 'A1' }]);
    expect(result.ok).toBe(true);
    const content = (result as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages[1]!.content;
    expect(content).toEqual([signed, { type: 'text', text: 'A1' }]);
    expect((content[0] as { signature: string }).signature).toBe(signed.signature);
  });

  it('a streamed display:"omitted" thinking block — signature_delta only, no thinking_delta — replays', () => {
    // First-party: "the thinking block opens, a single `signature_delta` arrives, and the block
    // closes without any `thinking_delta` events".
    const result = grammar([
      START,
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'EosnCkYICxIM' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'The answer is 12,231.' } },
      { type: 'content_block_stop', index: 1 },
      DELTA,
      { type: 'message_stop' },
    ]);
    expect(result.ok).toBe(true);
    expect(
      (result as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages[1]!.content,
    ).toEqual([
      { type: 'thinking', thinking: '', signature: 'EosnCkYICxIM' },
      { type: 'text', text: 'The answer is 12,231.' },
    ]);
  });
});
