import { describe, expect, it } from 'vitest';
import { openaiResponsesAdapter } from './openai-responses.js';
import type { SseFrame } from '../streaming/sse.js';
import type { AccumulatorSnapshot } from './types.js';

// OpenAI Responses. Frames are written the way the provider sends them — an `event:` name AND
// a matching `"type"` in the payload — so the tests exercise the same discriminator resolution
// the real stream does.

function frame(type: string, payload: Record<string, unknown> = {}): SseFrame {
  return { event: type, data: JSON.stringify({ type, ...payload }) };
}

function fold(frames: readonly SseFrame[]): AccumulatorSnapshot {
  const acc = openaiResponsesAdapter.createAccumulator();
  for (const f of frames) acc.accept(f);
  return acc.snapshot();
}

describe('request body', () => {
  it('carries the whole conversation in `input` and never asks the provider to store it', () => {
    const body = openaiResponsesAdapter.buildBody({
      model: 'a-model',
      history: [
        { role: 'user', text: 'first' },
        { role: 'assistant', text: 'answer' },
      ],
      prompt: 'second',
      maxTokens: 2048,
    });
    expect(body).toEqual({
      model: 'a-model',
      input: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'second' },
      ],
      stream: true,
      store: false,
    });
  });

  it('never requests encrypted reasoning content', () => {
    // ★ Not requesting it is what makes "hidden reasoning is never held in memory" structural
    // rather than a rule someone has to keep. There is no `include` at all.
    const body = openaiResponsesAdapter.buildBody({
      model: 'm',
      history: [],
      prompt: 'hi',
      maxTokens: 2048,
    });
    expect(body['include']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('reasoning');
  });

  it('sends no max_tokens: this surface does not require one', () => {
    const body = openaiResponsesAdapter.buildBody({
      model: 'm',
      history: [],
      prompt: 'hi',
      maxTokens: 999,
    });
    expect(body['max_tokens']).toBeUndefined();
    expect(body['max_output_tokens']).toBeUndefined();
  });
});

describe('text accumulation', () => {
  it('concatenates output_text deltas in order', () => {
    const snap = fold([
      frame('response.created', { response: { id: 'resp_1' } }),
      frame('response.output_text.delta', { delta: 'Hello' }),
      frame('response.output_text.delta', { delta: ', ' }),
      frame('response.output_text.delta', { delta: 'world' }),
      frame('response.completed', { response: { id: 'resp_1' } }),
    ]);
    expect(snap.text).toBe('Hello, world');
    expect(snap.terminal).toEqual({ kind: 'completed', stopReason: null });
    expect(snap.providerMessageId).toBe('resp_1');
  });

  it('terminates successfully on response.completed', () => {
    const snap = fold([frame('response.output_text.delta', { delta: 'x' }), frame('response.completed')]);
    expect(snap.terminal?.kind).toBe('completed');
  });

  it('treats response.incomplete as terminal and carries the provider’s reason', () => {
    const snap = fold([
      frame('response.output_text.delta', { delta: 'partial' }),
      frame('response.incomplete', {
        response: { id: 'r', incomplete_details: { reason: 'max_output_tokens' } },
      }),
    ]);
    expect(snap.terminal).toEqual({ kind: 'completed', stopReason: 'max_output_tokens' });
  });

  it('ignores every frame after a terminal marker', () => {
    const snap = fold([
      frame('response.output_text.delta', { delta: 'done' }),
      frame('response.completed'),
      frame('response.output_text.delta', { delta: ' MORE' }),
    ]);
    expect(snap.text).toBe('done');
  });
});

describe('errors', () => {
  it('terminates as an error on response.failed, keeping only safe fields', () => {
    const snap = fold([
      frame('response.failed', {
        response: { error: { code: 'server_error', message: 'upstream exploded' } },
      }),
    ]);
    expect(snap.terminal?.kind).toBe('error');
    expect(snap.terminal?.kind === 'error' && snap.terminal.error).toMatchObject({
      code: 'server_error',
      message: 'upstream exploded',
    });
  });

  it('terminates as an error on a bare `error` event', () => {
    const snap = fold([
      { event: 'error', data: JSON.stringify({ type: 'error', error: { type: 'rate_limit_error' } }) },
    ]);
    expect(snap.terminal?.kind).toBe('error');
  });

  it('does not terminate on a malformed frame', () => {
    const snap = fold([
      { event: undefined, data: '{not json' },
      frame('response.output_text.delta', { delta: 'still fine' }),
    ]);
    expect(snap.text).toBe('still fine');
    expect(snap.terminal).toBeNull();
  });
});

describe('★ what must never become visible text', () => {
  it('never renders reasoning deltas', () => {
    const snap = fold([
      frame('response.reasoning_text.delta', { delta: 'SECRET CHAIN OF THOUGHT' }),
      frame('response.reasoning_summary_text.delta', { delta: 'ALSO HIDDEN' }),
      frame('response.output_text.delta', { delta: 'visible' }),
      frame('response.completed'),
    ]);
    expect(snap.text).toBe('visible');
    expect(JSON.stringify(snap)).not.toContain('SECRET CHAIN OF THOUGHT');
    expect(JSON.stringify(snap)).not.toContain('ALSO HIDDEN');
  });

  it('ignores an unrecognised response.reasoning_* variant by prefix', () => {
    const snap = fold([
      frame('response.reasoning_something_new.delta', { delta: 'HIDDEN' }),
      frame('response.completed'),
    ]);
    expect(snap.text).toBe('');
    expect(snap.unsupportedOutput).toBe(false);
  });

  it('records a refusal as a refusal, never merged into the answer', () => {
    const snap = fold([
      frame('response.refusal.delta', { delta: 'I cannot help with that' }),
      frame('response.completed'),
    ]);
    expect(snap.text).toBe('');
    expect(snap.refusal).toBe('I cannot help with that');
  });

  it('flags a non-text output item instead of inventing text for it', () => {
    const snap = fold([
      frame('response.output_item.added', { item: { type: 'function_call', name: 'x' } }),
      frame('response.completed'),
    ]);
    expect(snap.unsupportedOutput).toBe(true);
    expect(snap.text).toBe('');
  });

  it('does not flag message or reasoning items as unsupported', () => {
    const snap = fold([
      frame('response.output_item.added', { item: { type: 'message' } }),
      frame('response.output_item.added', { item: { type: 'reasoning' } }),
      frame('response.completed'),
    ]);
    expect(snap.unsupportedOutput).toBe(false);
  });

  it('leaves unknown lifecycle events alone', () => {
    const snap = fold([
      frame('response.content_part.added', { part: { type: 'output_text' } }),
      frame('response.output_text.done', { text: 'WHOLE TEXT AGAIN' }),
      frame('response.output_text.delta', { delta: 'streamed' }),
      frame('response.completed'),
    ]);
    // `output_text.done` repeats the full text; folding it in would double the answer.
    expect(snap.text).toBe('streamed');
  });
});

describe('a stream that stops without a terminal marker', () => {
  it('leaves `terminal` null so the caller cannot read it as success', () => {
    const snap = fold([
      frame('response.created', { response: { id: 'r' } }),
      frame('response.output_text.delta', { delta: 'half an answer' }),
    ]);
    expect(snap.text).toBe('half an answer');
    expect(snap.terminal).toBeNull();
  });
});

describe('the request-id header precedence is OpenAI’s own', () => {
  it('prefers openai-request-id and falls back to x-request-id', () => {
    expect(openaiResponsesAdapter.requestIdHeaders).toEqual(['openai-request-id', 'x-request-id']);
  });
});
