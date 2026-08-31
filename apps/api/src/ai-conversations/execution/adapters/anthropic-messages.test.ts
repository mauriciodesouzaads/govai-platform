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

  it('an UNKNOWN event type refuses too', () => {
    const result = build(
      [entry({ assistant: streamAssistant(sse([{ type: 'future_event' }])) })],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({ ok: false, reason: 'context_unreplayable', detail: 'event_type_unknown' });
  });

  it('a stream with no content blocks at all refuses', () => {
    const result = build(
      [entry({ assistant: streamAssistant(sse([{ type: 'message_start', message: {} }, { type: 'message_stop' }])) })],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'stream_has_no_content_blocks',
    });
  });
});
