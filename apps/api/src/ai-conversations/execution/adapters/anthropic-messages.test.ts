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
    userNative: { model: MODEL, max_tokens: 64, messages: [user('u1')] },
    assistant: null,
    ...overrides,
  };
}

function responseAssistant(content: unknown[], attemptId = 'att-1'): AssembledContextEntry['assistant'] {
  return {
    attemptId,
    providerCredentialId: CRED,
    output: { kind: 'response', body: { id: 'msg_1', type: 'message', role: 'assistant', content } },
  };
}

function build(entries: AssembledContextEntry[], turnConfig: unknown) {
  return anthropicMessagesAdapter.buildRequest({
    entries,
    turnConfig,
    branchModel: MODEL,
    activeCredentialId: CRED,
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
    const result = build(
      [
        entry({
          sourceModel: 'claude-other',
          assistant: responseAssistant([
            thinking,
            { type: 'redacted_thinking', data: 'opaque' },
            { type: 'text', text: 'A1' },
          ]),
        }),
      ],
      { model: MODEL, messages: [user('u2')] },
    );
    expect(result.ok).toBe(true);
    const messages = (result as unknown as { body: { messages: Array<{ content: unknown[] }> } }).body.messages;
    expect(messages[1]!.content).toEqual([{ type: 'text', text: 'A1' }]);
  });

  it('refuses when a model switch would leave an EMPTY assistant message', () => {
    const result = build(
      [entry({ sourceModel: 'claude-other', assistant: responseAssistant([thinking]) })],
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
    return { attemptId: 'att-s', providerCredentialId: CRED, output: { kind: 'stream', sseText } };
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
