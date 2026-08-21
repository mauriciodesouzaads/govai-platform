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

// ─────────────────────────────────────────────────────────────────────────────
// AI-CONSOLE-RESPONSES-DLP-GAP-01 (EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02 §4/§5).
//
// The five accepted spellings of one Responses message must extract the SAME text.
// `SENSITIVE` is a local synthetic marker — no real personal data is used to prove a
// DLP path, here or anywhere else in this suite (§10).
const SENSITIVE = 'GOVAI-TEST-CPF-000.000.000-00';

/** The same message, in every representation the current OpenAI Responses contract accepts. */
const EQUIVALENT_INPUTS: ReadonlyArray<{ name: string; input: unknown }> = [
  { name: '1. string input', input: SENSITIVE },
  {
    name: '2. typed message + string content',
    input: [{ type: 'message', role: 'user', content: SENSITIVE }],
  },
  {
    name: '3. typed message + input_text[]',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: SENSITIVE }] },
    ],
  },
  { name: '4. role-shaped message + string content', input: [{ role: 'user', content: SENSITIVE }] },
  {
    name: '5. role-shaped message + input_text[]',
    input: [{ role: 'user', content: [{ type: 'input_text', text: SENSITIVE }] }],
  },
];

describe('extractOpenAIResponsesText — semantic equivalence across accepted message shapes', () => {
  for (const shape of EQUIVALENT_INPUTS) {
    it(`extracts the text from ${shape.name}`, () => {
      const segments = extractOpenAIResponsesText({ model: 'gpt-x', input: shape.input });
      expect(segments.map((s) => s.text)).toEqual([SENSITIVE]);
    });
  }

  it('every accepted shape yields the SAME scan target (the concatenation DLP sees)', () => {
    const scanned = EQUIVALENT_INPUTS.map((shape) =>
      extractOpenAIResponsesText({ model: 'gpt-x', input: shape.input })
        .map((s) => s.text)
        .join('\n'),
    );
    expect(new Set(scanned)).toEqual(new Set([SENSITIVE]));
  });

  it('a mixed valid input array extracts every message, in order, with truthful paths', () => {
    const r = extractOpenAIResponsesText({
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'a' }] },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: [{ type: 'input_text', text: 'c' }] },
        { type: 'message', role: 'user', content: 'd' },
      ],
    });
    expect(r).toEqual([
      { text: 'a', path: 'input[0].content[0].text' },
      { text: 'b', path: 'input[1].content' },
      { text: 'c', path: 'input[2].content[0].text' },
      { text: 'd', path: 'input[3].content' },
    ]);
  });

  it('a replayed assistant turn carrying output_text is scanned too', () => {
    const r = extractOpenAIResponsesText({
      input: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: SENSITIVE }] },
      ],
    });
    expect(r).toEqual([{ text: SENSITIVE, path: 'input[0].content[0].text' }]);
  });
});

describe('extractOpenAIResponsesText — what is deliberately NOT extracted', () => {
  it('non-text content parts are ignored; an image is never fabricated into text', () => {
    const r = extractOpenAIResponsesText({
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: `https://example.invalid/${SENSITIVE}.png` },
            { type: 'input_file', file_id: `file_${SENSITIVE}` },
            { type: 'input_text', text: 'only this' },
          ],
        },
      ],
    });
    expect(r).toEqual([{ text: 'only this', path: 'input[0].content[2].text' }]);
  });

  it('metadata, ids, model names and tool identifiers never become prompt text', () => {
    const r = extractOpenAIResponsesText({
      model: `gpt-${SENSITIVE}`,
      previous_response_id: `resp_${SENSITIVE}`,
      metadata: { ticket: SENSITIVE },
      tools: [{ type: 'function', name: `fn_${SENSITIVE}` }],
      tool_choice: 'auto',
      input: [{ role: 'user', content: 'hello' }],
    });
    expect(r).toEqual([{ text: 'hello', path: 'input[0].content' }]);
  });

  it('a non-message input item keeps its own classifier responsibility, not DLP text', () => {
    const r = extractOpenAIResponsesText({
      input: [
        { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: `{"q":"${SENSITIVE}"}` },
        { type: 'item_reference', id: 'msg_1' },
        { type: 'reasoning', summary: [{ type: 'summary_text', text: SENSITIVE }] },
        { role: 'user', content: 'the only prompt text' },
      ],
    });
    expect(r).toEqual([{ text: 'the only prompt text', path: 'input[3].content' }]);
  });

  it('an item that names a different type is that type, even when it also carries a role', () => {
    const r = extractOpenAIResponsesText({
      input: [{ type: 'function_call_output', role: 'tool', output: SENSITIVE, content: SENSITIVE }],
    });
    expect(r).toEqual([]);
  });

  it('malformed items do not crash and do not invent text', () => {
    expect(() =>
      extractOpenAIResponsesText({
        input: [
          null,
          42,
          'bare-string',
          [],
          { role: 42, content: 'not-a-message' },
          { type: 'message' },
          { type: 'message', content: null },
          { type: 'message', content: 7 },
          { role: 'user', content: { nested: 'object' } },
          { role: 'user', content: [null, 3, { type: 'input_text' }, { type: 'input_text', text: 9 }] },
        ],
      }),
    ).not.toThrow();
    expect(
      extractOpenAIResponsesText({
        input: [
          null,
          'bare-string',
          { type: 'message' },
          { role: 'user', content: { nested: 'object' } },
          { role: 'user', content: 'kept' },
        ],
      }),
    ).toEqual([{ text: 'kept', path: 'input[4].content' }]);
  });
});

describe('extractOpenAIChatCompletionsText — unchanged by the Responses fix', () => {
  it('the same synthetic marker resolves identically through Chat Completions', () => {
    expect(
      extractOpenAIChatCompletionsText({ messages: [{ role: 'user', content: SENSITIVE }] }).map(
        (s) => s.text,
      ),
    ).toEqual([SENSITIVE]);
    expect(
      extractOpenAIChatCompletionsText({
        messages: [{ role: 'user', content: [{ type: 'text', text: SENSITIVE }] }],
      }).map((s) => s.text),
    ).toEqual([SENSITIVE]);
  });

  it('a refusal part and an image part are still ignored', () => {
    expect(
      extractOpenAIChatCompletionsText({
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'refusal', refusal: SENSITIVE },
              { type: 'image_url', image_url: { url: 'https://example.invalid/x.png' } },
              { type: 'text', text: 'kept' },
            ],
          },
        ],
      }),
    ).toEqual([{ text: 'kept', path: 'messages[0].content[2].text' }]);
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
