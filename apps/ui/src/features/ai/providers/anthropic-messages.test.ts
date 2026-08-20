import { describe, expect, it } from 'vitest';
import {
  anthropicMessagesAdapter,
  ANTHROPIC_DEFAULT_MAX_TOKENS,
} from './anthropic-messages.js';
import type { SseFrame } from '../streaming/sse.js';
import type { AccumulatorSnapshot } from './types.js';

// Anthropic Messages. Every frame carries BOTH an `event:` name and a matching `"type"` in the
// payload, exactly as the provider documents, so both discriminators are present here.

function frame(type: string, payload: Record<string, unknown> = {}): SseFrame {
  return { event: type, data: JSON.stringify({ type, ...payload }) };
}

const START = frame('message_start', {
  message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'm', content: [] },
});
const TEXT_BLOCK_START = frame('content_block_start', {
  index: 0,
  content_block: { type: 'text', text: '' },
});
const textDelta = (text: string, index = 0): SseFrame =>
  frame('content_block_delta', { index, delta: { type: 'text_delta', text } });
const BLOCK_STOP = frame('content_block_stop', { index: 0 });
const STOP = frame('message_stop');

function fold(frames: readonly SseFrame[]): AccumulatorSnapshot {
  const acc = anthropicMessagesAdapter.createAccumulator();
  for (const f of frames) acc.accept(f);
  return acc.snapshot();
}

describe('request body', () => {
  it('sends provider-native messages[] with max_tokens, which this API requires', () => {
    expect(
      anthropicMessagesAdapter.buildBody({
        model: 'a-model',
        history: [
          { role: 'user', text: 'one' },
          { role: 'assistant', text: 'two' },
        ],
        prompt: 'three',
        maxTokens: 1234,
      }),
    ).toEqual({
      model: 'a-model',
      messages: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'two' },
        { role: 'user', content: 'three' },
      ],
      max_tokens: 1234,
      stream: true,
    });
  });

  it('enables no thinking, no tools and no beta features', () => {
    const body = anthropicMessagesAdapter.buildBody({
      model: 'm',
      history: [],
      prompt: 'hi',
      maxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
    });
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream']);
  });
});

describe('the documented event sequence', () => {
  it('accumulates a complete message', () => {
    const snap = fold([
      START,
      TEXT_BLOCK_START,
      frame('ping'),
      textDelta('Hello'),
      textDelta('!'),
      BLOCK_STOP,
      frame('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 15 } }),
      STOP,
    ]);
    expect(snap.text).toBe('Hello!');
    expect(snap.terminal).toEqual({ kind: 'completed', stopReason: 'end_turn' });
    expect(snap.providerMessageId).toBe('msg_1');
    expect(snap.unsupportedOutput).toBe(false);
  });

  it('takes the seed text a content_block_start may carry', () => {
    const snap = fold([
      START,
      frame('content_block_start', { index: 0, content_block: { type: 'text', text: 'Seed' } }),
      textDelta(' and more'),
      STOP,
    ]);
    expect(snap.text).toBe('Seed and more');
  });

  it('ignores ping and content_block_stop', () => {
    const snap = fold([START, TEXT_BLOCK_START, frame('ping'), BLOCK_STOP, STOP]);
    expect(snap.text).toBe('');
    expect(snap.terminal?.kind).toBe('completed');
  });

  it('ignores every frame after message_stop', () => {
    const snap = fold([START, TEXT_BLOCK_START, textDelta('done'), STOP, textDelta(' MORE')]);
    expect(snap.text).toBe('done');
  });
});

describe('★ thinking is never rendered', () => {
  it('drops thinking_delta entirely', () => {
    const snap = fold([
      START,
      frame('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }),
      frame('content_block_delta', {
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'SECRET REASONING' },
      }),
      frame('content_block_delta', {
        index: 0,
        delta: { type: 'signature_delta', signature: 'SIGNATURE' },
      }),
      BLOCK_STOP,
      frame('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }),
      textDelta('visible answer', 1),
      STOP,
    ]);
    expect(snap.text).toBe('visible answer');
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain('SECRET REASONING');
    expect(serialized).not.toContain('SIGNATURE');
  });

  it('does not flag a thinking block as unsupported output — it is known, and ignored', () => {
    const snap = fold([
      START,
      frame('content_block_start', { index: 0, content_block: { type: 'thinking' } }),
      STOP,
    ]);
    expect(snap.unsupportedOutput).toBe(false);
  });
});

describe('★ output this console cannot render is flagged, never faked as text', () => {
  it('flags a tool_use block', () => {
    const snap = fold([
      START,
      frame('content_block_start', { index: 0, content_block: { type: 'tool_use', name: 'x' } }),
      STOP,
    ]);
    expect(snap.unsupportedOutput).toBe(true);
    expect(snap.text).toBe('');
  });

  it('flags an input_json_delta', () => {
    const snap = fold([
      START,
      frame('content_block_start', { index: 0, content_block: { type: 'tool_use' } }),
      frame('content_block_delta', {
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"a":' },
      }),
      STOP,
    ]);
    expect(snap.unsupportedOutput).toBe(true);
    expect(snap.text).toBe('');
  });

  it('flags a text_delta for a block that was never announced as text', () => {
    const snap = fold([START, textDelta('unattributable', 7), STOP]);
    expect(snap.text).toBe('');
    expect(snap.unsupportedOutput).toBe(true);
  });

  it('flags an unknown content block type', () => {
    const snap = fold([
      START,
      frame('content_block_start', { index: 0, content_block: { type: 'something_new' } }),
      STOP,
    ]);
    expect(snap.unsupportedOutput).toBe(true);
  });
});

describe('errors', () => {
  it('terminates as an error on the documented error frame', () => {
    const snap = fold([
      START,
      TEXT_BLOCK_START,
      textDelta('partial'),
      frame('error', { error: { type: 'overloaded_error', message: 'Overloaded' } }),
    ]);
    expect(snap.terminal?.kind).toBe('error');
    expect(snap.terminal?.kind === 'error' && snap.terminal.error).toMatchObject({
      type: 'overloaded_error',
      message: 'Overloaded',
    });
    expect(snap.text).toBe('partial');
  });

  it('ignores a malformed frame without terminating', () => {
    const snap = fold([
      START,
      TEXT_BLOCK_START,
      { event: 'content_block_delta', data: '{oops' },
      textDelta('fine'),
      STOP,
    ]);
    expect(snap.text).toBe('fine');
    expect(snap.terminal?.kind).toBe('completed');
  });

  it('ignores an unknown event name', () => {
    const snap = fold([START, TEXT_BLOCK_START, frame('something_new'), textDelta('ok'), STOP]);
    expect(snap.text).toBe('ok');
  });
});

describe('a stream that ends without message_stop', () => {
  it('leaves terminal null', () => {
    const snap = fold([START, TEXT_BLOCK_START, textDelta('cut off')]);
    expect(snap.text).toBe('cut off');
    expect(snap.terminal).toBeNull();
  });
});

describe('the request-id header precedence is Anthropic’s own', () => {
  it('leads with the real header and keeps the fallbacks behind it', () => {
    expect(anthropicMessagesAdapter.requestIdHeaders).toEqual([
      'request-id',
      'anthropic-request-id',
      'x-request-id',
    ]);
  });
});
