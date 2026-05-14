import { describe, it, expect } from 'vitest';
import {
  extractOpenAIResponsesText,
  extractOpenAIChatCompletionsText,
} from './extract-text.js';

describe('extractOpenAIResponsesText — guards', () => {
  it('returns [] for non-object input', () => {
    expect(extractOpenAIResponsesText('hi')).toEqual([]);
    expect(extractOpenAIResponsesText(42)).toEqual([]);
    expect(extractOpenAIResponsesText(undefined)).toEqual([]);
  });

  it('returns [] for null body', () => {
    expect(extractOpenAIResponsesText(null)).toEqual([]);
  });

  it('returns [] when neither instructions nor input is present', () => {
    expect(extractOpenAIResponsesText({})).toEqual([]);
  });
});

describe('extractOpenAIResponsesText — instructions + input', () => {
  it('captures instructions when given as a string', () => {
    expect(extractOpenAIResponsesText({ instructions: 'system prompt' })).toEqual([
      { text: 'system prompt', path: 'instructions' },
    ]);
  });

  it('captures string input', () => {
    expect(extractOpenAIResponsesText({ input: 'hello' })).toEqual([
      { text: 'hello', path: 'input' },
    ]);
  });

  it('captures instructions + string input together', () => {
    const r = extractOpenAIResponsesText({ instructions: 'sys', input: 'usr' });
    expect(r).toEqual([
      { text: 'sys', path: 'instructions' },
      { text: 'usr', path: 'input' },
    ]);
  });

  it('captures input_text parts from an array input', () => {
    const r = extractOpenAIResponsesText({
      input: [
        { type: 'input_text', text: 'part-a' },
        { type: 'image_url', image_url: 'https://x' },
      ],
    });
    expect(r).toEqual([{ text: 'part-a', path: 'input[0].text' }]);
  });

  it('recurses into message.content arrays', () => {
    const r = extractOpenAIResponsesText({
      input: [
        {
          type: 'message',
          content: [
            { type: 'input_text', text: 'nested' },
            { type: 'text', text: 'also-nested' },
          ],
        },
      ],
    });
    expect(r).toEqual([
      { text: 'nested', path: 'input[0].content[0].text' },
      { text: 'also-nested', path: 'input[0].content[1].text' },
    ]);
  });

  it('ignores non-object items inside the input array', () => {
    const r = extractOpenAIResponsesText({
      input: [null, 'plain', 42, { type: 'input_text', text: 'keep' }],
    });
    expect(r).toEqual([{ text: 'keep', path: 'input[3].text' }]);
  });
});

describe('extractOpenAIChatCompletionsText — guards', () => {
  it('returns [] for non-object body', () => {
    expect(extractOpenAIChatCompletionsText('hi')).toEqual([]);
    expect(extractOpenAIChatCompletionsText(undefined)).toEqual([]);
  });

  it('returns [] for null body', () => {
    expect(extractOpenAIChatCompletionsText(null)).toEqual([]);
  });

  it('returns [] when messages is absent or not an array', () => {
    expect(extractOpenAIChatCompletionsText({})).toEqual([]);
    expect(extractOpenAIChatCompletionsText({ messages: 'not-an-array' })).toEqual([]);
  });
});

describe('extractOpenAIChatCompletionsText — messages', () => {
  it('captures string content', () => {
    const r = extractOpenAIChatCompletionsText({
      messages: [{ role: 'user', content: 'hello world' }],
    });
    expect(r).toEqual([{ text: 'hello world', path: 'messages[0].content' }]);
  });

  it('captures text parts from an array content', () => {
    const r = extractOpenAIChatCompletionsText({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'first' },
            { type: 'image_url', image_url: { url: 'https://x' } },
          ],
        },
      ],
    });
    expect(r).toEqual([{ text: 'first', path: 'messages[0].content[0].text' }]);
  });

  it('captures parts across multiple messages with correct paths', () => {
    const r = extractOpenAIChatCompletionsText({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ],
    });
    expect(r).toEqual([
      { text: 'sys', path: 'messages[0].content' },
      { text: 'usr', path: 'messages[1].content' },
    ]);
  });

  it('ignores message entries that are not objects', () => {
    expect(
      extractOpenAIChatCompletionsText({
        messages: [null, 'string-msg', 42, { role: 'user', content: 'keep' }],
      }),
    ).toEqual([{ text: 'keep', path: 'messages[3].content' }]);
  });

  it('ignores message content that is neither string nor array (e.g. number)', () => {
    expect(
      extractOpenAIChatCompletionsText({
        messages: [{ role: 'user', content: 42 }],
      }),
    ).toEqual([]);
  });
});
