import { describe, it, expect } from 'vitest';
import { classifyOpenAITools } from './tool-classifier-hook.js';

describe('classifyOpenAITools — allow paths', () => {
  it('returns allow with empty classifications when tools array is empty', () => {
    const r = classifyOpenAITools([], 'responses');
    expect(r.decision).toBe('allow');
    expect(r.classifications).toEqual([]);
  });

  it('allows a function tool on the responses surface', () => {
    const r = classifyOpenAITools([{ type: 'function', name: 'do_x' }], 'responses');
    expect(r.decision).toBe('allow');
    expect(r.classifications[0]?.classification).toBe('function_responses');
    expect(r.classifications[0]?.decision).toBe('allowed');
  });

  it('allows a function tool on the chat_completions surface', () => {
    const r = classifyOpenAITools([{ type: 'function', name: 'do_x' }], 'chat_completions');
    expect(r.decision).toBe('allow');
    expect(r.classifications[0]?.classification).toBe('function_chat_completions');
  });

  it('allows a provider-hosted web_search on responses', () => {
    const r = classifyOpenAITools([{ type: 'web_search' }], 'responses');
    expect(r.decision).toBe('allow');
    expect(r.classifications[0]?.classification).toBe('openai_provider_hosted_web_search');
  });

  it('allows file_search on responses', () => {
    const r = classifyOpenAITools([{ type: 'file_search' }], 'responses');
    expect(r.decision).toBe('allow');
    expect(r.classifications[0]?.classification).toBe('openai_provider_hosted_file_search');
  });
});

describe('classifyOpenAITools — M1 (OD-1=A): non-computer tools forward, classification recorded', () => {
  it('an unknown string type on responses → allow, recorded as openai_typed_unknown / allowed (Risk C)', () => {
    const r = classifyOpenAITools([{ type: 'banana' }], 'responses');
    expect(r.decision).toBe('allow');
    expect(r.classifications[0]).toEqual({
      tool_index: 0,
      tool_type: 'banana',
      classification: 'openai_typed_unknown',
      contributed_risk_class: 'C',
      decision: 'allowed',
    });
  });

  it('a non-function type on chat_completions → allow (typed_unknown recorded; provider decides)', () => {
    const r = classifyOpenAITools([{ type: 'web_search' }], 'chat_completions');
    expect(r.decision).toBe('allow');
    expect(r.classifications[0]?.classification).toBe('openai_typed_unknown');
    expect(r.classifications[0]?.decision).toBe('allowed');
  });

  it('empty-string / null / missing tool.type → allow, typed_unknown recorded (tool_type only when a string)', () => {
    for (const [tool, expectedType] of [
      [{ type: '' }, ''],
      [{ type: null }, undefined],
      [{ name: 'no-type' }, undefined],
    ] as Array<[Record<string, unknown>, string | undefined]>) {
      const r = classifyOpenAITools([tool], 'responses');
      expect(r.decision).toBe('allow');
      expect(r.classifications[0]?.classification).toBe('openai_typed_unknown');
      expect(r.classifications[0]?.tool_type).toBe(expectedType);
    }
  });

  it('formerly "planned" hosted tools (code_interpreter, tool_search, shell, apply_patch, mcp) → allow with their dedicated classification + risk', () => {
    const r = classifyOpenAITools(
      [
        { type: 'code_interpreter' },
        { type: 'tool_search' },
        { type: 'shell' },
        { type: 'apply_patch' },
        { type: 'mcp' },
      ],
      'responses',
    );
    expect(r.decision).toBe('allow');
    expect(r.classifications.map((c) => [c.classification, c.contributed_risk_class, c.decision])).toEqual([
      ['openai_provider_hosted_code_interpreter', 'C', 'allowed'],
      ['openai_provider_hosted_tool_search', 'B', 'allowed'],
      ['openai_provider_hosted_hosted_shell', 'D', 'allowed'],
      ['openai_provider_hosted_apply_patch', 'C', 'allowed'],
      ['openai_provider_hosted_mcp', 'D', 'allowed'],
    ]);
  });

  it('computer_use_preview → block (the ONLY floor) with reason=capability_blocked_via_token + explicit detail', () => {
    const r = classifyOpenAITools([{ type: 'computer_use_preview' }], 'responses');
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      expect(r.blocked[0]?.reason).toBe('capability_blocked_via_token');
      expect(r.blocked[0]?.tool_type_observed).toBe('other_typed_unknown');
      expect(r.blocked[0]?.reason_detail).toMatch(/provider-hosted computer use — the explicit Native high-risk floor/);
      expect(r.classifications[0]?.decision).toBe('blocked_at_validation');
    }
  });

  it('substitutes an empty object for a null/undefined entry in the tools array (typed_unknown, allowed)', () => {
    const r = classifyOpenAITools([null, undefined], 'responses');
    expect(r.decision).toBe('allow');
    expect(r.classifications).toHaveLength(2);
    expect(r.classifications.every((c) => c.classification === 'openai_typed_unknown')).toBe(true);
  });

  it('records every classification even when one tool (computer use) blocks the request', () => {
    const r = classifyOpenAITools(
      [{ type: 'function' }, { type: 'computer_use_preview' }, { type: 'web_search' }],
      'responses',
    );
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      expect(r.classifications).toHaveLength(3);
      expect(r.blocked).toHaveLength(1);
      expect(r.blocked[0]?.tool_index).toBe(1);
      expect(r.classifications.map((c) => c.decision)).toEqual([
        'allowed',
        'blocked_at_validation',
        'allowed',
      ]);
    }
  });
});
