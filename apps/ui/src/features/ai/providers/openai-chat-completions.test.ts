import { describe, expect, it } from 'vitest';
import { openaiChatCompletionsAdapter, CHAT_DONE_SENTINEL } from './openai-chat-completions.js';
import type { SseFrame } from '../streaming/sse.js';
import type { AccumulatorSnapshot } from './types.js';

// OpenAI Chat Completions. This stream is `data:`-only — no `event:` line — and terminates on
// the literal `[DONE]` sentinel, so the frames below carry no event name.

function chunk(payload: Record<string, unknown>): SseFrame {
  return { event: undefined, data: JSON.stringify(payload) };
}

function delta(content: string, index = 0, extra: Record<string, unknown> = {}): SseFrame {
  return chunk({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    choices: [{ index, delta: { content, ...extra }, finish_reason: null }],
  });
}

const DONE: SseFrame = { event: undefined, data: CHAT_DONE_SENTINEL };

function fold(frames: readonly SseFrame[]): AccumulatorSnapshot {
  const acc = openaiChatCompletionsAdapter.createAccumulator();
  for (const f of frames) acc.accept(f);
  return acc.snapshot();
}

describe('request body', () => {
  it('sends provider-native messages[] with the committed history', () => {
    expect(
      openaiChatCompletionsAdapter.buildBody({
        model: 'm',
        history: [
          { role: 'user', text: 'a' },
          { role: 'assistant', text: 'b' },
        ],
        prompt: 'c',
        maxTokens: 2048,
      }),
    ).toEqual({
      model: 'm',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ],
      stream: true,
    });
  });

  it('sends no tools, no functions and no sampling controls', () => {
    const body = openaiChatCompletionsAdapter.buildBody({
      model: 'm',
      history: [],
      prompt: 'hi',
      maxTokens: 2048,
    });
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'stream']);
  });
});

describe('text accumulation', () => {
  it('concatenates choices[0].delta.content', () => {
    const snap = fold([delta('Hel'), delta('lo'), DONE]);
    expect(snap.text).toBe('Hello');
    expect(snap.terminal?.kind).toBe('completed');
  });

  it('terminates on the [DONE] sentinel and records the finish reason', () => {
    const snap = fold([
      delta('x'),
      chunk({
        choices: [{ index: 0, delta: {}, finish_reason: 'length' }],
      }),
      DONE,
    ]);
    expect(snap.terminal).toEqual({ kind: 'completed', stopReason: 'length' });
  });

  it('records the provider message id from the first chunk that carries one', () => {
    const snap = fold([delta('x'), DONE]);
    expect(snap.providerMessageId).toBe('chatcmpl-1');
  });

  it('tolerates a chunk carrying usage after the last content delta', () => {
    const snap = fold([
      delta('answer'),
      chunk({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }),
      DONE,
    ]);
    expect(snap.text).toBe('answer');
    expect(snap.terminal?.kind).toBe('completed');
  });
});

describe('★ a second choice is flagged, never interleaved', () => {
  it('renders only index 0 and marks the rest as output it cannot render', () => {
    // The console never sends `n`, so an alternate completion cannot come from anything this
    // client asked for — and concatenating two alternatives would produce text no model wrote.
    const snap = fold([delta('primary '), delta('ALTERNATE', 1), delta('answer'), DONE]);
    expect(snap.text).toBe('primary answer');
    expect(snap.unsupportedOutput).toBe(true);
  });

  it('does not flag a single-choice stream', () => {
    expect(fold([delta('one'), DONE]).unsupportedOutput).toBe(false);
  });
});

describe('refusal', () => {
  it('collects the refusal field separately from the answer', () => {
    const snap = fold([
      chunk({
        choices: [{ index: 0, delta: { refusal: 'I will not do that' }, finish_reason: null }],
      }),
      DONE,
    ]);
    expect(snap.refusal).toBe('I will not do that');
    expect(snap.text).toBe('');
  });
});

describe('errors', () => {
  it('terminates as an error when a frame carries an error object', () => {
    const snap = fold([
      delta('partial'),
      chunk({ error: { message: 'context length exceeded', type: 'invalid_request_error' } }),
    ]);
    expect(snap.terminal?.kind).toBe('error');
    expect(snap.terminal?.kind === 'error' && snap.terminal.error).toMatchObject({
      type: 'invalid_request_error',
      message: 'context length exceeded',
    });
    expect(snap.text).toBe('partial');
  });

  it('ignores a malformed frame without terminating or corrupting the answer', () => {
    const snap = fold([delta('a'), { event: undefined, data: '{broken' }, delta('b'), DONE]);
    expect(snap.text).toBe('ab');
    expect(snap.terminal?.kind).toBe('completed');
  });

  it('ignores a frame whose choices field is not an array', () => {
    const snap = fold([chunk({ choices: 'nope' }), delta('ok'), DONE]);
    expect(snap.text).toBe('ok');
  });
});

describe('a stream that ends without [DONE]', () => {
  it('leaves terminal null so the outcome cannot be read as confirmed', () => {
    const snap = fold([delta('half')]);
    expect(snap.text).toBe('half');
    expect(snap.terminal).toBeNull();
  });

  it('ignores frames after [DONE]', () => {
    const snap = fold([delta('done'), DONE, delta(' extra')]);
    expect(snap.text).toBe('done');
  });
});
