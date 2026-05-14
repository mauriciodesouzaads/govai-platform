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

describe('classifyOpenAITools — block paths and reason_detail variants', () => {
  it('blocks an unknown string type on responses with typed_unknown reason_detail', () => {
    const r = classifyOpenAITools([{ type: 'banana' }], 'responses');
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      const b = r.blocked[0];
      expect(b?.reason).toBe('typed_unknown');
      expect(b?.tool_type_observed).toBe('other_typed_unknown');
      expect(b?.reason_detail).toMatch(/^tool\.type "banana" is not classified/);
    }
  });

  it('blocks any non-function type on chat_completions with typed_unknown', () => {
    const r = classifyOpenAITools([{ type: 'web_search' }], 'chat_completions');
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      expect(r.blocked[0]?.reason).toBe('typed_unknown');
    }
  });

  it('flags an empty-string tool.type via observeToolType=empty_string', () => {
    const r = classifyOpenAITools([{ type: '' }], 'responses');
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      expect(r.blocked[0]?.tool_type_observed).toBe('empty_string');
    }
  });

  it('flags a null tool.type via observeToolType=null', () => {
    const r = classifyOpenAITools([{ type: null }], 'responses');
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      expect(r.blocked[0]?.tool_type_observed).toBe('null');
    }
  });

  it('flags a missing tool.type field via observeToolType=missing', () => {
    const r = classifyOpenAITools([{ name: 'no-type' }], 'responses');
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      expect(r.blocked[0]?.tool_type_observed).toBe('missing');
    }
  });

  it('blocks code_interpreter with the capability_planned reason_detail variant (target PR4+)', () => {
    const r = classifyOpenAITools([{ type: 'code_interpreter' }], 'responses');
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      expect(r.blocked[0]?.reason).toBe('capability_planned');
      expect(r.blocked[0]?.reason_detail).toMatch(/planned capability \(target PR4\+\)/);
    }
  });

  it('blocks computer_use_preview with the hard_denied-style reason_detail variant', () => {
    const r = classifyOpenAITools([{ type: 'computer_use_preview' }], 'responses');
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      expect(r.blocked[0]?.reason).toBe('capability_blocked_via_token');
      expect(r.blocked[0]?.reason_detail).toMatch(/hard_denied until governance primitive \(target PR8\+\)/);
    }
  });

  it('substitutes an empty object for a null/undefined entry in the tools array', () => {
    const r = classifyOpenAITools([null, undefined], 'responses');
    // Both substituted with {} → no `type` field → openai_typed_unknown → block
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      expect(r.blocked).toHaveLength(2);
      expect(r.blocked[0]?.tool_type_observed).toBe('missing');
    }
  });

  it('records every classification even when one tool blocks the request', () => {
    const r = classifyOpenAITools(
      [{ type: 'function' }, { type: 'banana' }, { type: 'web_search' }],
      'responses',
    );
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      expect(r.classifications).toHaveLength(3);
      expect(r.blocked).toHaveLength(1);
      expect(r.blocked[0]?.tool_index).toBe(1);
    }
  });
});
