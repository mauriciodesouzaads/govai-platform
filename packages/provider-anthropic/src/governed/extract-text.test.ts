import { describe, it, expect } from 'vitest';
import { extractAnthropicText } from './extract-text.js';

describe('extractAnthropicText — guards', () => {
  it('returns [] when body is not an object', () => {
    expect(extractAnthropicText('hi')).toEqual([]);
    expect(extractAnthropicText(42)).toEqual([]);
    expect(extractAnthropicText(undefined)).toEqual([]);
  });

  it('returns [] when body is null', () => {
    expect(extractAnthropicText(null)).toEqual([]);
  });

  it('returns [] when messages is absent and system absent', () => {
    expect(extractAnthropicText({})).toEqual([]);
  });

  it('ignores body.messages when it is not an array', () => {
    expect(extractAnthropicText({ messages: 'not-an-array' })).toEqual([]);
  });

  it('ignores message entries that are not objects', () => {
    expect(extractAnthropicText({ messages: ['hi', null, 7] })).toEqual([]);
  });
});

describe('extractAnthropicText — system field', () => {
  it('captures system when given as a plain string', () => {
    expect(extractAnthropicText({ system: 'role context' })).toEqual([
      { text: 'role context', path: 'system' },
    ]);
  });

  it('captures system when given as an array of text blocks', () => {
    expect(
      extractAnthropicText({
        system: [{ type: 'text', text: 'block-a' }, { type: 'text', text: 'block-b' }],
      }),
    ).toEqual([
      { text: 'block-a', path: 'system[0].text' },
      { text: 'block-b', path: 'system[1].text' },
    ]);
  });
});

describe('extractAnthropicText — messages[].content', () => {
  it('captures string content', () => {
    const r = extractAnthropicText({
      messages: [{ role: 'user', content: 'hello world' }],
    });
    expect(r).toEqual([{ text: 'hello world', path: 'messages[0].content' }]);
  });

  it('captures text blocks inside an array content', () => {
    const r = extractAnthropicText({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hi' },
            { type: 'image', source: { type: 'url', url: 'https://x' } },
          ],
        },
      ],
    });
    expect(r).toEqual([{ text: 'hi', path: 'messages[0].content[0].text' }]);
  });

  it('ignores text blocks whose text field is not a string', () => {
    const r = extractAnthropicText({
      messages: [{ role: 'user', content: [{ type: 'text', text: 42 }] }],
    });
    expect(r).toEqual([]);
  });

  it('captures tool_result content when it is a string', () => {
    const r = extractAnthropicText({
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_result', content: 'tool-output-string' }],
        },
      ],
    });
    expect(r).toEqual([
      { text: 'tool-output-string', path: 'messages[0].content[0].content' },
    ]);
  });

  it('recurses into tool_result content when it is an array of blocks', () => {
    const r = extractAnthropicText({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              content: [
                { type: 'text', text: 'nested' },
                { type: 'image', source: { type: 'url', url: 'https://x' } },
              ],
            },
          ],
        },
      ],
    });
    expect(r).toEqual([
      { text: 'nested', path: 'messages[0].content[0].content[0].text' },
    ]);
  });

  it('ignores non-object blocks inside the content array', () => {
    const r = extractAnthropicText({
      messages: [
        {
          role: 'user',
          content: [null, 'plain-string-block', 42, { type: 'text', text: 'keep' }],
        },
      ],
    });
    expect(r).toEqual([{ text: 'keep', path: 'messages[0].content[3].text' }]);
  });
});
