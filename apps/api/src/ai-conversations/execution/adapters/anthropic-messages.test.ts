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

describe('anthropic adapter — no zero-block stream completes without a message that began', () => {
  // The sibling family of the fd2df776 review finding: once a COMPLETE zero-block stream is
  // read as the provider's own non-answer, EVERY path that can reach that verdict must first
  // prove the message actually began — otherwise a malformed capture is laundered into a
  // silent input-only projection.

  it('★ a bare message_stop refuses: an unanchored terminal is not a refusal', () => {
    expect(grammar([{ type: 'message_stop' }])).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'message_stop_before_message_start',
    });
  });

  it('pings before an unanchored message_stop do not make it legal', () => {
    expect(grammar([{ type: 'ping' }, { type: 'ping' }, { type: 'message_stop' }])).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'message_stop_before_message_start',
    });
  });

  it('a stream of pings alone is TRUNCATED, not a non-answer', () => {
    expect(grammar([{ type: 'ping' }])).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'stream_truncated',
    });
  });

  it('an EMPTY capture is truncated too', () => {
    expect(grammar([])).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'stream_truncated',
    });
  });

  it('★ but a bare provider ERROR verdict STILL projects input-only: it may precede message_start', () => {
    // First-party: the API "may occasionally send errors in the event stream", e.g. an
    // overloaded_error before the message begins. That is a real provider verdict, not a
    // malformed capture, so the start-flag requirement must NOT be extended to it.
    const result = build(
      [
        entry({
          userNative: { model: MODEL, messages: [user('u1')] },
          assistant: streamed(
            sse([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]),
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

  it('the documented refusal shape is the ONLY zero-block stream that projects input-only', () => {
    const result = build(
      [
        entry({
          userNative: { model: MODEL, messages: [user('u1')] },
          assistant: streamed(
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
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// INDEPENDENT VALIDATOR AUDIT — `message_start` CARRIES NO CONTENT (RF-2), and the two doors
// converge on ONE semantic message law while keeping their own transport grammars.
//
// First-party, verbatim (reverified 2026-08-31): "1. `message_start`: contains a `Message` object
// with empty `content`." Every documented example is `"content": []`. The reassembler builds the
// final content from the content-block events alone, so anything sitting in the start message
// would be silently dropped — and GovAI would replay a message the provider never sent.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('anthropic adapter — message_start carries no content (RF-2)', () => {
  it('★ RF-2 — a message_start whose `content` is NONEMPTY refuses instead of silently dropping it', () => {
    const result = grammar([
      {
        type: 'message_start',
        message: { role: 'assistant', model: MODEL, content: [{ type: 'text', text: 'dropped' }] },
      },
      ...TEXT_BLOCK,
      DELTA,
      { type: 'message_stop' },
    ]);
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'message_start_content_not_empty',
    });
  });

  it('★ the wire law runs BEFORE the non-answer classification: start content is never laundered', () => {
    // The documented refusal shape (message_start → message_delta → message_stop, zero blocks)
    // projects INPUT-ONLY. A start message carrying content is not that shape: it is a malformed
    // capture, and admitting it as a "provider non-answer" would drop real content in silence —
    // the same laundering the closure sweep had to close for the unanchored `message_stop`.
    const result = grammar([
      {
        type: 'message_start',
        message: { role: 'assistant', content: [{ type: 'text', text: 'dropped' }] },
      },
      { type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 0 } },
      { type: 'message_stop' },
    ]);
    expect(result).toEqual({
      ok: false,
      reason: 'context_unreplayable',
      detail: 'message_start_content_not_empty',
    });
  });

  it('a `content` that is present but NOT an array refuses — it could carry anything', () => {
    for (const content of ['text', 42, {}, true]) {
      expect(
        grammar([
          { type: 'message_start', message: { role: 'assistant', content } },
          ...TEXT_BLOCK,
          { type: 'message_stop' },
        ]),
      ).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        detail: 'message_start_content_not_empty',
      });
    }
  });

  it('the DOCUMENTED shape replays normally: `content: []` is what every example sends', () => {
    const result = grammar([
      { type: 'message_start', message: { role: 'assistant', model: MODEL, content: [] } },
      ...TEXT_BLOCK,
      DELTA,
      { type: 'message_stop' },
    ]);
    expect(result.ok).toBe(true);
    const messages = (result as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages;
    expect(messages[1]!.content).toEqual([{ type: 'text', text: 'A' }]);
  });

  it('an ABSENT `content` is NOT hardened into a version lock: nothing can be lost, so nothing refuses', () => {
    // §21 — validate what replay correctness actually depends on. A start message with no
    // `content` key drops nothing, so requiring its presence would refuse captures for a reason
    // that has no consumer. START itself is this shape, which is why the whole suite uses it.
    const result = grammar([START, ...TEXT_BLOCK, DELTA, { type: 'message_stop' }]);
    expect(result.ok).toBe(true);
  });

  it('★ the rule is WIRE GRAMMAR ONLY: a stored body with NONEMPTY content is the normal case', () => {
    // §15 — a stored non-streaming response HAS no `message_start`, and its `content` is the
    // FINAL message, not an initial state. Forcing the transport fact onto it would refuse every
    // ordinary non-streaming answer in the product.
    const result = build([entry({ assistant: responseAssistant([{ type: 'text', text: 'A1' }]) })], {
      model: MODEL,
      messages: [user('u2')],
    });
    expect(result.ok).toBe(true);
    const messages = (result as unknown as { body: { messages: unknown[] } }).body.messages;
    expect(messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'A1' }] });
  });
});

describe('anthropic adapter — one semantic message law, two transports (§22 convergence)', () => {
  const contentOf = (result: ReturnType<typeof build>) =>
    (result as unknown as { body: { messages: Array<{ role: string; content: unknown }> } }).body
      .messages[1];

  it('★ equivalent valid representations produce the SAME durable assistant message', () => {
    const stored = build(
      [entry({ assistant: responseAssistant([{ type: 'text', text: 'Hello' }], 'att-1', MODEL) })],
      { model: MODEL, messages: [user('u2')] },
    );
    const streamedIn = grammar([
      { type: 'message_start', message: { role: 'assistant', model: MODEL, content: [] } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
      { type: 'content_block_stop', index: 0 },
      DELTA,
      { type: 'message_stop' },
    ]);
    expect(stored.ok).toBe(true);
    expect(streamedIn.ok).toBe(true);
    expect(contentOf(stored)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Hello' }] });
    expect(contentOf(streamedIn)).toEqual(contentOf(stored));
  });

  it('★ signed thinking converges identically through both doors, byte-preserved', () => {
    const SIG = 'EqQBCgIYAhIM1gbcDa9GJwZA2b3h';
    const stored = build(
      [
        entry({
          assistant: responseAssistant(
            [{ type: 'thinking', thinking: 'reasoned', signature: SIG }, { type: 'text', text: 'A' }],
            'att-1',
            MODEL,
          ),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    const streamedIn = grammar([
      { type: 'message_start', message: { role: 'assistant', model: MODEL, content: [] } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reasoned' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: SIG } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'A' } },
      { type: 'content_block_stop', index: 1 },
      DELTA,
      { type: 'message_stop' },
    ]);
    expect(contentOf(stored)).toEqual({
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'reasoned', signature: SIG }, { type: 'text', text: 'A' }],
    });
    expect(contentOf(streamedIn)).toEqual(contentOf(stored));
  });

  it('★ the ROLE law is ONE law with two enforcement points, not two rules that must agree', () => {
    // Pinned because it already drifted once: review finding 3891516882 was this exact rule
    // present on the stream door and missing on the stored-response door. Both doors now call
    // the same predicate, so the two answers below cannot diverge again.
    const storedWrongRole = build(
      [
        entry({
          assistant: {
            attemptId: 'att-1',
            providerCredentialId: CRED,
            completedAtMs: 1_800_000_000_000,
            output: { kind: 'response', body: { role: 'user', content: [{ type: 'text', text: 'A' }] } },
          },
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    const streamedWrongRole = grammar([
      { type: 'message_start', message: { role: 'user' } },
      ...TEXT_BLOCK,
      { type: 'message_stop' },
    ]);
    const refusal = {
      ok: false,
      reason: 'context_unreplayable',
      detail: 'message_role_not_assistant',
    };
    expect(storedWrongRole).toEqual(refusal);
    expect(streamedWrongRole).toEqual(refusal);
  });

  it('an ABSENT role still defaults to assistant on BOTH doors — leniency is shared too', () => {
    // The predicate is `strict when present`, so the two doors must be equally lenient as well as
    // equally strict; a one-sided default would be the same drift in the other direction.
    const stored = build(
      [
        entry({
          assistant: {
            attemptId: 'att-1',
            providerCredentialId: CRED,
            completedAtMs: 1_800_000_000_000,
            output: { kind: 'response', body: { content: [{ type: 'text', text: 'A' }] } },
          },
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    const streamedIn = grammar([
      { type: 'message_start', message: { model: MODEL } },
      ...TEXT_BLOCK,
      { type: 'message_stop' },
    ]);
    expect(contentOf(stored)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'A' }] });
    expect(contentOf(streamedIn)).toEqual(contentOf(stored));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RF-3 — RAW PROVIDER EVIDENCE REACHES ITS LAW UNNORMALIZED
// (prevalidation-normalization closure; review finding 3899816809 "Reject non-string Anthropic
// roles", plus the sibling family the finding's SHAPE exposes).
//
// FIRST-PARTY, REVERIFIED (Anthropic TypeScript SDK `Message`, the authoritative schema for both
// doors — `RawMessageStartEvent.message` IS a `Message`):
//     role: 'assistant';   // required, NOT optional, single literal value
//     model: Model;        // required
//     content: Array<ContentBlock>;
// and, verbatim JSDoc on `role`: "Conversational role of the generated message. This will always
// be `\"assistant\"`." All four documented `message_start` examples carry `"role": "assistant"`.
// A PRESENT non-`assistant` role therefore has NO first-party representation at all, so refusing
// one cannot refuse legitimate provider output.
//
// ★ THE INVARIANT THESE TESTS PIN — and why a predicate-only repair was not enough:
//     MALFORMED PRESENT VALUE  ≠  ABSENT VALUE.
// Absence may default (the value is a constant, so the default reconstructs the provider's own
// value and loses nothing). A malformed PRESENT value is contradictory evidence, and turning it
// into a valid synthetic one makes GovAI replay a message the provider never sent. Defaulting is
// therefore only ever allowed AFTER the raw value has been proven legitimately absent.
//
// The stored door used to NORMALIZE before the law (`typeof role === 'string' ? role : 'assistant'`)
// while the stream door passed the RAW value, so tightening the shared predicate ALONE would have
// made the two doors disagree again — exactly the drift finding 3891516882 was. Every matrix
// below is asserted on BOTH doors from ONE table, so that drift cannot hide.
// ─────────────────────────────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

/** A stored non-streaming capture with a caller-chosen raw body. */
const storedBody = (body: Json) =>
  build(
    [
      entry({
        assistant: {
          attemptId: 'att-1',
          providerCredentialId: CRED,
          completedAtMs: 1_800_000_000_000,
          output: { kind: 'response', body },
        },
      }),
    ],
    { model: MODEL, messages: [user('u2')] },
  );

/** The same capture arriving through the stream door: the caller chooses the raw `message`. */
const streamedStart = (message: Json) =>
  grammar([{ type: 'message_start', message }, ...TEXT_BLOCK, DELTA, { type: 'message_stop' }]);

const TEXT_A = [{ type: 'text', text: 'A' }];
const REFUSED_ROLE = {
  ok: false,
  reason: 'context_unreplayable',
  detail: 'message_role_not_assistant',
};

/** Every PRESENT value that is not the literal `"assistant"`. `null` is PRESENT (JSON null), which
 *  is exactly why `undefined` — a key that is not there at all — is the only absence. */
const MALFORMED_PRESENT_ROLES: Array<readonly [string, unknown]> = [
  ['a different speaker', 'user'],
  ['the empty string', ''],
  ['JSON null', null],
  ['a number', 42],
  ['a boolean', true],
  ['an object', {}],
  ['an empty array', []],
  ['an array WRAPPING the right value', ['assistant']],
  ['a case variant', 'Assistant'],
];

describe('anthropic adapter — RF-3 role law: malformed presence is not absence', () => {
  it('★ RF-3 — a PRESENT non-assistant role refuses on the STORED door, whatever its type', () => {
    for (const [label, role] of MALFORMED_PRESENT_ROLES) {
      expect(storedBody({ id: 'msg_r', type: 'message', role, content: TEXT_A }), label).toEqual(
        REFUSED_ROLE,
      );
    }
  });

  it('★ RF-3 — a PRESENT non-assistant role refuses on the STREAM door, whatever its type', () => {
    for (const [label, role] of MALFORMED_PRESENT_ROLES) {
      expect(streamedStart({ role, model: MODEL }), label).toEqual(REFUSED_ROLE);
    }
  });

  it('★ RF-3 TRANSPORT PARITY — the SAME raw role value gets the SAME verdict through both doors', () => {
    // This is the test that makes drift visible in ONE place. It compares the two doors against
    // EACH OTHER, so it fails if either one is tightened or loosened alone — which is precisely
    // how the stored door lost this law once before (finding 3891516882) and how a predicate-only
    // RF-3 repair would have lost it again in the opposite direction.
    for (const [label, role] of MALFORMED_PRESENT_ROLES) {
      const stored = storedBody({ role, content: TEXT_A });
      const streamedIn = streamedStart({ role });
      expect(stored, `stored: ${label}`).toEqual(REFUSED_ROLE);
      expect(streamedIn, `streamed: ${label}`).toEqual(stored);
    }
  });

  it('ANTI-OVER-HARDENING — `assistant` and an ABSENT role BOTH replay, identically on both doors', () => {
    // The documented value, and the one legitimate absence. Absence keeps its default because the
    // field's ONLY lawful value is a constant: reconstructing it cannot alter the replayed
    // message, whereas refusing it would brick a branch forever for zero fidelity gain.
    const expected = { role: 'assistant', content: TEXT_A };
    const messagesOf = (r: ReturnType<typeof build>) =>
      (r as unknown as { body: { messages: unknown[] } }).body.messages[1];

    expect(messagesOf(storedBody({ role: 'assistant', content: TEXT_A }))).toEqual(expected);
    expect(messagesOf(streamedStart({ role: 'assistant', model: MODEL }))).toEqual(expected);
    expect(messagesOf(storedBody({ content: TEXT_A }))).toEqual(expected);
    expect(messagesOf(streamedStart({ model: MODEL }))).toEqual(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RF-3 SIBLING — PROVIDER MODEL PROVENANCE (the closest sibling of the role field).
//
// `model` is REQUIRED on `Message` too, and GovAI SEMANTICALLY CONSUMES it: it is the historical
// side of the model-switch comparison that decides whether signed `thinking` is passed back or
// stripped. A malformed PRESENT model used to collapse into `null` — indistinguishable from "the
// provider did not tell us" — and the fallback chain then answered with the REQUEST's model. That
// is the RF-3 shape exactly: corrupt provenance laundered into a confident same-model verdict,
// which PRESERVES signed thinking under provenance the capture itself contradicts.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const SIG = 'EqQBCgIYAhIM1gbcDa9GJwZA2b3h';
const SIGNED_THINKING = [
  { type: 'thinking', thinking: 'reasoned', signature: SIG },
  { type: 'text', text: 'A' },
];
const REFUSED_MODEL = {
  ok: false,
  reason: 'context_unreplayable',
  detail: 'message_model_not_string',
};
const MALFORMED_PRESENT_MODELS: Array<readonly [string, unknown]> = [
  ['JSON null', null],
  ['a number', 42],
  ['a boolean', true],
  ['an object', {}],
  ['an array', []],
  ['an array WRAPPING a model id', [MODEL]],
];

describe('anthropic adapter — RF-3 sibling: provider model provenance', () => {
  it('★ a PRESENT non-string `model` refuses on the STORED door instead of degrading to "unknown"', () => {
    for (const [label, model] of MALFORMED_PRESENT_MODELS) {
      expect(storedBody({ role: 'assistant', model, content: TEXT_A }), label).toEqual(
        REFUSED_MODEL,
      );
    }
  });

  it('★ a PRESENT non-string `model` refuses on the STREAM door, with the same verdict', () => {
    for (const [label, model] of MALFORMED_PRESENT_MODELS) {
      expect(streamedStart({ role: 'assistant', model }), label).toEqual(REFUSED_MODEL);
    }
  });

  it('★ THE LAUNDERING PROOF — corrupt provenance must NOT justify preserving signed thinking', () => {
    // The capture's own `model` is corrupt, but the REQUEST that produced it names the model the
    // branch is still on. Before RF-3 the corrupt value collapsed to `null`, the fallback chain
    // answered with the request model, the comparison said "same model", and the signed thinking
    // was passed back as if its provenance were known. It is not known: the one field that would
    // have told us is the field that is corrupt.
    expect(
      storedBody({ role: 'assistant', model: 42, content: SIGNED_THINKING }),
    ).toEqual(REFUSED_MODEL);
  });

  it('ANTI-OVER-HARDENING — an ABSENT `model` keeps the documented fallback chain', () => {
    // Absence is the case the fallback chain exists FOR (response model → the request that
    // produced it → branch metadata). Hardening it would refuse ordinary captures and would also
    // strip lawful thinking, which is a silent quality loss in the other direction.
    const stored = storedBody({ role: 'assistant', content: SIGNED_THINKING });
    expect(stored.ok).toBe(true);
    expect(
      (stored as unknown as { body: { messages: Array<{ content: unknown }> } }).body.messages[1]!
        .content,
    ).toEqual(SIGNED_THINKING);
    expect(streamedStart({ role: 'assistant' }).ok).toBe(true);
  });

  it('ANTI-OVER-HARDENING — model-ID AGNOSTICISM: any string model id is accepted, no allowlist', () => {
    // GovAI must never gate on model identity. A model id it has never seen is provider truth,
    // not a validation failure — it simply compares unequal and strips foreign thinking.
    const stored = storedBody({
      role: 'assistant',
      model: 'a-model-that-does-not-exist-yet-2099',
      content: SIGNED_THINKING,
    });
    expect(stored.ok).toBe(true);
    expect(
      (stored as unknown as { body: { messages: Array<{ content: unknown }> } }).body.messages[1]!
        .content,
    ).toEqual([{ type: 'text', text: 'A' }]); // foreign thinking stripped, text kept
  });

  it('ANTI-OVER-HARDENING — a VALID matching provider model still preserves signed thinking', () => {
    const stored = storedBody({ role: 'assistant', model: MODEL, content: SIGNED_THINKING });
    expect(stored.ok).toBe(true);
    expect(
      (stored as unknown as { body: { messages: Array<{ content: unknown }> } }).body.messages[1]!
        .content,
    ).toEqual(SIGNED_THINKING);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RF-3 SIBLING — `citations` MUST NOT BE DISCARDED TO MAKE ROOM FOR A DELTA.
//
// First-party: `TextBlock.citations` is `Array<TextCitation> | null` — `null` is a LAWFUL value.
// The accumulator used `Array.isArray(block.citations) ? block.citations : []`, which treats a
// lawful `null` and a MALFORMED value identically: the malformed one was silently thrown away and
// replaced with a fabricated array. That alters the content GovAI claims to replay.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const CITATION = { type: 'char_location', cited_text: 'c', document_index: 0 };
const citationStream = (citations: unknown, present: boolean) =>
  grammar([
    START,
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '', ...(present ? { citations } : {}) },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'citations_delta', citation: CITATION } },
    { type: 'content_block_stop', index: 0 },
    DELTA,
    { type: 'message_stop' },
  ]);

describe('anthropic adapter — RF-3 sibling: citations are never silently discarded', () => {
  it('★ a MALFORMED present `citations` refuses instead of being replaced by a fabricated array', () => {
    for (const citations of [42, 'cited', {}, true]) {
      expect(citationStream(citations, true), JSON.stringify(citations)).toEqual({
        ok: false,
        reason: 'context_unreplayable',
        // RF-4 MOVED THE REFUSAL POINT EARLIER, AND DELIBERATELY. The RF-3 guarantee asserted
        // here — a malformed container is never discarded and replaced by a fabricated array — is
        // unchanged and now holds on ALL THREE paths rather than only this one. What changed is
        // WHERE it is caught: the container rule moved into the shared block law, which runs at
        // `content_block_start`, so the stream refuses before the delta is ever applied and names
        // the block-start site instead of the accumulator. The delta-site guard still exists as a
        // second enforcement point of the same predicate; it is simply no longer the first one
        // reached. See the RF-4 section at the end of this file for the three-path proof.
        detail: 'block_start_payload_invalid',
      });
    }
  });

  it('ANTI-OVER-HARDENING — the LAWFUL `null`, an absent key, and an existing array all accumulate', () => {
    const contentOf = (r: ReturnType<typeof build>) =>
      (r as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages[1]!
        .content;
    // `citations: null` is first-party-lawful and must behave exactly like "no citations yet".
    expect(contentOf(citationStream(null, true))).toEqual([
      { type: 'text', text: '', citations: [CITATION] },
    ]);
    expect(contentOf(citationStream(undefined, false))).toEqual([
      { type: 'text', text: '', citations: [CITATION] },
    ]);
    const existing = { type: 'char_location', cited_text: 'first', document_index: 0 };
    expect(contentOf(citationStream([existing], true))).toEqual([
      { type: 'text', text: '', citations: [existing, CITATION] },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RF-4 — ONE CONTAINER LAW FOR A FINALIZED `text` BLOCK, WHATEVER PATH DELIVERED IT.
//
// The RF-3 sibling above stopped `citations` from being LAUNDERED into a fabricated array, but it
// placed the container rule at the `citations_delta` ACCUMULATION SITE rather than in the shared
// block law. So the rule only fired when a delta happened to arrive: one raw value, three paths,
// two different verdicts. These tests are the falsification of that asymmetry — they run the SAME
// raw `citations` value down all three and demand ONE verdict.
//
// First-party (`@anthropic-ai/sdk`, reverified): response `TextBlock.citations` is
// `Array<TextCitation> | null`, and request `TextBlockParam.citations` is OPTIONAL and
// `Array<TextCitationParam> | null`. Absent, `null` and array are therefore ALL lawful containers
// on the wire GovAI replays onto; a PRESENT non-array has no representation on either side.
//
// The ELEMENT union is deliberately NOT validated: `TextCitation` is provider-evolving (it has
// already grown `web_search_result_location` and `search_result_location`), so a closed element
// check would refuse FUTURE legitimate provider output — the §31 forward-compatible posture.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** PRESENT values with no lawful first-party representation — neither array nor `null`. */
const MALFORMED_CITATIONS: Array<readonly [string, unknown]> = [
  ['a number', 42],
  ['an object', {}],
  ['a string', 'x'],
  ['a boolean', true],
];

/** Deliberately opaque elements. They are NOT claimed to be current citation variants — that is
 *  the point: they stand in for whatever Anthropic adds next, and they must survive verbatim. */
const OPAQUE_ELEMENT = { type: 'future_location_kind', cited_text: 'c', unknown_field: 1 };

/** PATH A — the stored non-streaming body. */
const citationsStored = (citations: unknown, present: boolean) =>
  storedBody({
    role: 'assistant',
    model: MODEL,
    content: [{ type: 'text', text: 'A', ...(present ? { citations } : {}) }],
  });

const citationsBlockStart = (citations: unknown, present: boolean) => ({
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'text', text: '', ...(present ? { citations } : {}) },
});
const TEXT_DELTA_A = { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A' } };

/** PATH B — a streamed text block that never receives a `citations_delta`. */
const citationsStreamNoDelta = (citations: unknown, present: boolean) =>
  grammar([
    START,
    citationsBlockStart(citations, present),
    TEXT_DELTA_A,
    { type: 'content_block_stop', index: 0 },
    DELTA,
    { type: 'message_stop' },
  ]);

/** PATH C — a streamed text block that DOES receive a `citations_delta`. */
const citationsStreamWithDelta = (citations: unknown, present: boolean) =>
  grammar([
    START,
    citationsBlockStart(citations, present),
    TEXT_DELTA_A,
    { type: 'content_block_delta', index: 0, delta: { type: 'citations_delta', citation: CITATION } },
    { type: 'content_block_stop', index: 0 },
    DELTA,
    { type: 'message_stop' },
  ]);

const CITATION_PATHS = [
  ['stored', citationsStored],
  ['stream without citations_delta', citationsStreamNoDelta],
  ['stream WITH citations_delta', citationsStreamWithDelta],
] as const;

/** The SEMANTIC verdict — accept, or refuse-as-unreplayable. Deliberately NOT the `detail`: the
 *  parity law is about the verdict, and each path may name its own (earlier or later) refusal
 *  point without the verdict differing. */
const verdictOf = (r: ReturnType<typeof build>) => {
  const v = r as unknown as { ok: boolean; reason?: string };
  return v.ok ? 'ACCEPT' : `REFUSE(${v.reason})`;
};
const detailOf = (r: ReturnType<typeof build>) => (r as unknown as { detail?: string }).detail;
const replayedBlocks = (r: ReturnType<typeof build>) =>
  (r as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages[1]!.content;

describe('anthropic adapter — RF-4: the citations CONTAINER law is shared by every path', () => {
  it('★ RF-4 — a MALFORMED container refuses on ALL THREE paths, not only where a delta arrived', () => {
    for (const [valueLabel, citations] of MALFORMED_CITATIONS) {
      for (const [pathLabel, run] of CITATION_PATHS) {
        expect(verdictOf(run(citations, true)), `${valueLabel} via ${pathLabel}`).toBe(
          'REFUSE(context_unreplayable)',
        );
      }
    }
  });

  it('★ RF-4 — the three paths agree on EVERY value: one raw value, one semantic verdict', () => {
    const cases: Array<readonly [string, unknown, boolean]> = [
      ['absent', undefined, false],
      ['null', null, true],
      ['empty array', [], true],
      ['array of opaque elements', [OPAQUE_ELEMENT], true],
      // RF-5 moved this value's verdict from ACCEPT to REFUSE (see the RF-5 block below). The
      // PARITY assertion this test makes is unchanged and still holds: all three paths agree.
      ['array of an opaque STRING', ['future-opaque-value'], true],
      ...MALFORMED_CITATIONS.map(([l, v]) => [l, v, true] as const),
    ];
    for (const [label, citations, present] of cases) {
      const verdicts = CITATION_PATHS.map(([, run]) => verdictOf(run(citations, present)));
      expect(new Set(verdicts).size, `${label} → ${JSON.stringify(verdicts)}`).toBe(1);
    }
  });

  it('names the refusal point each path reaches first (precision, not a verdict difference)', () => {
    // The stored door has no wire grammar, so the shared law refuses it at FINAL validation.
    expect(detailOf(citationsStored(42, true))).toBe('content_block_payload_invalid');
    // Both stream paths carry the malformed container on `content_block_start`, so the SAME shared
    // predicate refuses there — before any delta is even considered.
    expect(detailOf(citationsStreamNoDelta(42, true))).toBe('block_start_payload_invalid');
    expect(detailOf(citationsStreamWithDelta(42, true))).toBe('block_start_payload_invalid');
  });

  it('ANTI-OVER-HARDENING — absent, null, [] and opaque OBJECT arrays all replay, byte-for-byte', () => {
    // ★ CHANGED BY RF-5, WITH THE REASON RECORDED RATHER THAN THE EXPECTATION SWAPPED. This list
    // used to include `['future-opaque-value']` — an opaque STRING element — as a value that
    // replays. RF-5 refuses it, and the RF-4 guarantee is unchanged and strengthened rather than
    // reversed: RF-4's boundary was that the element TYPE UNION must not be version-locked, and
    // it is not — the opaque OBJECT below is still never inspected, on any path. What RF-5 adds
    // is that an element must be an OBJECT at all, which first-party requires on both wires (all
    // five `TextCitation` and all five `TextCitationParam` members are object types) and which
    // the `citations_delta` site had ALREADY been enforcing since c8cc5bb — so the old ACCEPT
    // here was one half of a two-verdict disagreement, not a forward-compatibility guarantee.
    // The string case is retained as a REFUSAL proof in the RF-5 block below.
    for (const [label, citations, present] of [
      ['absent', undefined, false],
      ['null', null, true],
      ['empty array', [], true],
      ['array of opaque elements', [OPAQUE_ELEMENT], true],
    ] as Array<readonly [string, unknown, boolean]>) {
      const expected = [{ type: 'text', text: 'A', ...(present ? { citations } : {}) }];
      // The stored door replays the capture verbatim …
      expect(replayedBlocks(citationsStored(citations, present)), `${label} stored`).toEqual(expected);
      // … and the stream door REASSEMBLES to the identical message. Same law, same result.
      expect(replayedBlocks(citationsStreamNoDelta(citations, present)), `${label} stream`).toEqual(
        expected,
      );
    }
  });

  it('ANTI-OVER-HARDENING — a valid citations_delta still accumulates onto every lawful container', () => {
    for (const [label, citations, present, expected] of [
      ['absent', undefined, false, [CITATION]],
      ['null', null, true, [CITATION]],
      ['empty array', [], true, [CITATION]],
      // The opaque element is APPENDED TO, never inspected — proof the union is not version-locked.
      ['opaque array', [OPAQUE_ELEMENT], true, [OPAQUE_ELEMENT, CITATION]],
    ] as Array<readonly [string, unknown, boolean, unknown[]]>) {
      expect(replayedBlocks(citationsStreamWithDelta(citations, present)), label).toEqual([
        { type: 'text', text: 'A', citations: expected },
      ]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RF-5 — EVIDENCE PRESERVATION DURING ACCUMULATION (review finding 3901193188 + its signature
// sibling, found by the same sweep).
//
// RF-3 and RF-4 asked VERDICT-PARITY questions: can one raw value receive two verdicts? This
// family asks a different one — when both paths ACCEPT, is the REPLAYED CONTENT still what was
// captured? A parity-shaped lens cannot see a fidelity loss that is symmetric across transports,
// which is exactly why the RF-4 sibling audit did not surface this.
//
// Of the five fields the reassembler mutates, three ACCUMULATE (`text`, `thinking`, `citations`)
// and two REPLACE (`signature`, tool `input`). Only the replacing pair can destroy evidence, and
// first-party defines that replacement against a documented EMPTY opening:
//
//   content_block_start  tool_use / server_tool_use   →  "input": {}
//   content_block_start  thinking                     →  "thinking": "", "signature": ""
//   input_json_delta     "the deltas are partial JSON strings, whereas the final
//                         tool_use.input is always an object" — accumulate, then parse at
//                         content_block_stop. The accumulated value is the COMPLETE input.
//
// So the accumulated value REPLACES the seed rather than extending it, and that is lossless only
// while the seed is the documented placeholder. No merge semantics exist first-party, so an
// out-of-grammar capture gets a precise refusal instead of an invented reconstruction.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A streamed tool-use-family block: chosen seed, then an `input_json_delta` accumulation. */
const toolStream = (type: string, input: unknown, fragments: string[]) =>
  grammar([
    START,
    { type: 'content_block_start', index: 0, content_block: { type, id: 'tu_1', name: 'get_weather', input } },
    ...fragments.map((partial_json) => ({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json },
    })),
    { type: 'content_block_stop', index: 0 },
    DELTA,
    { type: 'message_stop' },
  ]);

/** A streamed thinking block: chosen signature seed, then the real value as a `signature_delta`. */
const thinkingStream = (signature: unknown, present: boolean) =>
  grammar([
    START,
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', ...(present ? { signature } : {}) },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'T' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'REAL' } },
    { type: 'content_block_stop', index: 0 },
    DELTA,
    { type: 'message_stop' },
  ]);

/** The three block types this adapter treats as the tool-use family (its `input_json_delta`
 *  compatibility map). `mcp_tool_use` is included because the map already routes deltas to it. */
const TOOL_FAMILY = ['tool_use', 'server_tool_use', 'mcp_tool_use'] as const;

describe('anthropic adapter — RF-5: a replacing delta may not discard the seed it replaces', () => {
  it('★ ANTHROPIC-B1 — a NON-EMPTY seeded tool input + a later delta REFUSES, never silently drops', () => {
    // The finding verbatim: start `{a: 1}`, delta `{"b":2}`. Before RF-5 this replayed as
    // `{b: 2}` — the durable assistant tool call differed from the stream it claims to reproduce,
    // with no refusal anywhere. Proven for EVERY member of the family the delta map routes to.
    for (const type of TOOL_FAMILY) {
      expect(detailOf(toolStream(type, { a: 1 }, ['{"b":2}'])), type).toBe(
        'tool_input_seed_not_empty',
      );
      expect(verdictOf(toolStream(type, { a: 1 }, ['{"b":2}'])), type).toBe(
        'REFUSE(context_unreplayable)',
      );
    }
  });

  it('★ ANTHROPIC-B1 — an EMPTY-FRAGMENT accumulation cannot fabricate `{}` over a seed either', () => {
    // The same defect with the opposite payload: `partial_json: ""` reconstructs `{}`, which
    // before RF-5 REPLACED `{a: 1}` with a fabricated empty object. Same law, same refusal.
    expect(detailOf(toolStream('tool_use', { a: 1 }, ['']))).toBe('tool_input_seed_not_empty');
  });

  it('★ ANTHROPIC-B2 — the EXACT documented start shape + chunked deltas reconstructs correctly', () => {
    // First-party's own example stream, fragment for fragment: `"input": {}` opened, then
    // `""`, `{"location":`, ` "San`, ` Francisc`, `o,`, ` CA"}`.
    const result = toolStream('tool_use', {}, ['', '{"location":', ' "San', ' Francisc', 'o,', ' CA"}']);
    expect(replayedBlocks(result)).toEqual([
      { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { location: 'San Francisco, CA' } },
    ]);
  });

  it('★ ANTHROPIC-B3 — a STORED final tool block with a populated input stays lawful', () => {
    // The rule must NOT leak from the wire onto the final message. First-party documents the
    // final `mcp_tool_use` block with a populated `input` — refusing that would brick every
    // branch that ever called a tool.
    for (const type of TOOL_FAMILY) {
      const block = { type, id: 'tu_1', name: 'echo', input: { param1: 'value1' } };
      expect(
        replayedBlocks(storedBody({ role: 'assistant', model: MODEL, content: [block] })),
        type,
      ).toEqual([block]);
    }
  });

  it('★ ANTHROPIC-B4 — stream and stored differ ONLY where the wire grammar differs', () => {
    // A populated tool input is REFUSED as a streamed seed that a delta will overwrite, and
    // ACCEPTED as a final message — not an inconsistency but the two grammars first-party
    // actually publishes. The proof that it is scoped to the overwrite and not to the transport:
    // the SAME populated seed on a stream with NO delta replays verbatim.
    const seeded = { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { a: 1 } };
    expect(verdictOf(toolStream('tool_use', { a: 1 }, ['{"b":2}']))).toBe(
      'REFUSE(context_unreplayable)',
    );
    expect(
      replayedBlocks(storedBody({ role: 'assistant', model: MODEL, content: [seeded] })),
    ).toEqual([seeded]);
    expect(replayedBlocks(toolStream('tool_use', { a: 1 }, []))).toEqual([seeded]);
  });

  it('★ ANTHROPIC-B5 — a `text` start value is PRESERVED across text_delta (append, not replace)', () => {
    const result = grammar([
      START,
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'SEED' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '-tail' } },
      { type: 'content_block_stop', index: 0 },
      DELTA,
      { type: 'message_stop' },
    ]);
    expect(replayedBlocks(result)).toEqual([{ type: 'text', text: 'SEED-tail' }]);
  });

  it('★ ANTHROPIC-B6 — a `thinking` start value is PRESERVED across thinking_delta', () => {
    const result = grammar([
      START,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: 'SEED', signature: '' },
      },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '-tail' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'S' } },
      { type: 'content_block_stop', index: 0 },
      DELTA,
      { type: 'message_stop' },
    ]);
    expect(replayedBlocks(result)).toEqual([
      { type: 'thinking', thinking: 'SEED-tail', signature: 'S' },
    ]);
  });

  it('★ ANTHROPIC-B7 — the SIGNATURE sibling: replacement is lawful only over the empty placeholder', () => {
    // Found by this sweep, not by the review: `signature` is the OTHER replacing delta, and it
    // carries the more sensitive evidence — §18 forbids synthesizing or modifying signatures, and
    // overwriting a captured one IS a modification. First-party opens the block with
    // `"signature": ""`, so that placeholder (and a lawful absence) may be replaced, and nothing
    // else may. Before RF-5, `"FORGED"` was silently overwritten by `"REAL"`.
    expect(detailOf(thinkingStream('FORGED', true))).toBe('thinking_signature_seed_not_empty');
    for (const seed of [42, null, [], {}]) {
      expect(detailOf(thinkingStream(seed, true)), JSON.stringify(seed)).toBe(
        'thinking_signature_seed_not_empty',
      );
    }
    // ANTI-OVER-HARDENING: the documented placeholder and a lawful absence both still replace.
    for (const [label, signature, present] of [
      ['documented ""', '', true],
      ['absent', undefined, false],
    ] as Array<readonly [string, unknown, boolean]>) {
      expect(replayedBlocks(thinkingStream(signature, present)), label).toEqual([
        { type: 'thinking', thinking: 'T', signature: 'REAL' },
      ]);
    }
  });

  it('★ ANTHROPIC-B8 — existing `citations` are still PRESERVED across citations_delta', () => {
    // RF-3/RF-4 unchanged: the accumulator appends, and the opaque element it appends to is never
    // inspected. Re-pinned here because RF-5 touched the citations predicate.
    expect(replayedBlocks(citationsStreamWithDelta([OPAQUE_ELEMENT], true))).toEqual([
      { type: 'text', text: 'A', citations: [OPAQUE_ELEMENT, CITATION] },
    ]);
  });

  it('★ ANTHROPIC-B9 — a reconstructed tool input must still be an OBJECT', () => {
    // Unchanged by RF-5 and re-pinned: valid-but-non-object accumulated JSON refuses rather than
    // overwriting the block with a shape the provider rejects on replay.
    for (const fragment of ['[]', 'null', '7', '"s"', 'true']) {
      expect(detailOf(toolStream('tool_use', {}, [fragment])), fragment).toBe(
        'tool_input_json_invalid',
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RF-5 — STRUCTURAL ADMISSIBILITY OF CAPTURED `citations` ELEMENTS.
//
// The Anthropic sibling of the OpenAI `output`-element finding, and the one that made the two
// paths already disagree: `citations_delta` has required `isObject(delta['citation'])` since
// c8cc5bb, so `citations: ['x']` REFUSED when the element arrived as a delta and was ACCEPTED
// when the identical element arrived inside the container. One raw value, two verdicts.
//
// First-party: all five members of `TextCitation` (response) and all five of `TextCitationParam`
// (request) are object types. A primitive element has no representation on either wire.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const PRIMITIVE_CITATION_ELEMENTS: Array<readonly [string, unknown]> = [
  ['null', null],
  ['string', 'future-opaque-value'],
  ['number', 7],
  ['boolean', true],
  ['nested array', ['x']],
];

describe('anthropic adapter — RF-5: a captured citation ELEMENT must be object-shaped', () => {
  it('★ a primitive element refuses on ALL THREE paths — the delta path no longer stands alone', () => {
    for (const [label, element] of PRIMITIVE_CITATION_ELEMENTS) {
      for (const [pathLabel, run] of CITATION_PATHS) {
        expect(verdictOf(run([element], true)), `${label} via ${pathLabel}`).toBe(
          'REFUSE(context_unreplayable)',
        );
      }
    }
  });

  it('★ the SAME element refuses whether it arrives in the container or as a delta', () => {
    // The asymmetry this closes, stated as an executable claim.
    for (const [label, element] of PRIMITIVE_CITATION_ELEMENTS) {
      const viaContainer = verdictOf(citationsStreamNoDelta([element], true));
      const viaDelta = verdictOf(
        grammar([
          START,
          citationsBlockStart([], true),
          TEXT_DELTA_A,
          { type: 'content_block_delta', index: 0, delta: { type: 'citations_delta', citation: element } },
          { type: 'content_block_stop', index: 0 },
          DELTA,
          { type: 'message_stop' },
        ]),
      );
      expect(viaDelta, `${label} delta`).toBe('REFUSE(context_unreplayable)');
      expect(viaContainer, `${label} container`).toBe(viaDelta);
    }
  });

  it('★ ANTI-OVER-HARDENING — the element TYPE UNION is still not version-locked', () => {
    // The boundary RF-4 drew and RF-5 keeps: an OBJECT element of a kind this adapter has never
    // heard of passes through every path, is replayed verbatim, and is appended to without ever
    // being inspected. Only the SHAPE is judged; the `type` value never is.
    const expected = [{ type: 'text', text: 'A', citations: [OPAQUE_ELEMENT] }];
    expect(replayedBlocks(citationsStored([OPAQUE_ELEMENT], true))).toEqual(expected);
    expect(replayedBlocks(citationsStreamNoDelta([OPAQUE_ELEMENT], true))).toEqual(expected);
    expect(replayedBlocks(citationsStreamWithDelta([OPAQUE_ELEMENT], true))).toEqual([
      { type: 'text', text: 'A', citations: [OPAQUE_ELEMENT, CITATION] },
    ]);
    // …and an element that is an object with NO recognisable fields at all still passes.
    expect(replayedBlocks(citationsStreamNoDelta([{}], true))).toEqual([
      { type: 'text', text: 'A', citations: [{}] },
    ]);
  });

  it('★ ANTI-OVER-HARDENING — absent, null and [] remain lawful containers', () => {
    for (const [label, citations, present] of [
      ['absent', undefined, false],
      ['null', null, true],
      ['empty array', [], true],
    ] as Array<readonly [string, unknown, boolean]>) {
      const expected = [{ type: 'text', text: 'A', ...(present ? { citations } : {}) }];
      expect(replayedBlocks(citationsStored(citations, present)), `${label} stored`).toEqual(expected);
      expect(replayedBlocks(citationsStreamNoDelta(citations, present)), `${label} stream`).toEqual(
        expected,
      );
    }
  });
});
