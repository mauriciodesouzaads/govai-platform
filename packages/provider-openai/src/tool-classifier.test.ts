// OpenAI tool classifier — canonical cases (Matrix v2 §23.2 + Peça A v2 §8.4 + v2.0.1 P3).
// OpenAI has no client_defined fallback; absence/null/empty/unknown all map to openai_typed_unknown.

import { describe, it, expect } from 'vitest';
import { classifyOpenAITool, decideOpenAITool } from './tool-classifier.js';

describe('classifyOpenAITool — Responses surface', () => {
  it('1.  tool sem campo type → openai_typed_unknown (NO client_defined fallback)', () => {
    expect(classifyOpenAITool({}, 'responses')).toBe('openai_typed_unknown');
  });

  it('2.  type: undefined explicit → openai_typed_unknown', () => {
    expect(classifyOpenAITool({ type: undefined }, 'responses')).toBe('openai_typed_unknown');
  });

  it('3.  type: null → openai_typed_unknown', () => {
    expect(classifyOpenAITool({ type: null }, 'responses')).toBe('openai_typed_unknown');
  });

  it('4.  type: "" → openai_typed_unknown', () => {
    expect(classifyOpenAITool({ type: '' }, 'responses')).toBe('openai_typed_unknown');
  });

  it('5.  type: "   " (whitespace) → openai_typed_unknown', () => {
    expect(classifyOpenAITool({ type: '   ' }, 'responses')).toBe('openai_typed_unknown');
  });

  it('6.  type: 123 (non-string) → openai_typed_unknown', () => {
    expect(classifyOpenAITool({ type: 123 as unknown as string }, 'responses')).toBe(
      'openai_typed_unknown',
    );
  });

  it('7.  type: function → function_responses', () => {
    expect(classifyOpenAITool({ type: 'function' }, 'responses')).toBe('function_responses');
  });

  it('8.  type: web_search → openai_provider_hosted_web_search', () => {
    expect(classifyOpenAITool({ type: 'web_search' }, 'responses')).toBe(
      'openai_provider_hosted_web_search',
    );
  });

  it('9.  type: web_search_preview → openai_provider_hosted_web_search', () => {
    expect(classifyOpenAITool({ type: 'web_search_preview' }, 'responses')).toBe(
      'openai_provider_hosted_web_search',
    );
  });

  it('10. type: file_search → openai_provider_hosted_file_search', () => {
    expect(classifyOpenAITool({ type: 'file_search' }, 'responses')).toBe(
      'openai_provider_hosted_file_search',
    );
  });

  it('11. type: tool_search → openai_provider_hosted_tool_search (planned PR4)', () => {
    expect(classifyOpenAITool({ type: 'tool_search' }, 'responses')).toBe(
      'openai_provider_hosted_tool_search',
    );
  });

  it('12. type: code_interpreter → openai_provider_hosted_code_interpreter (planned PR4)', () => {
    expect(classifyOpenAITool({ type: 'code_interpreter' }, 'responses')).toBe(
      'openai_provider_hosted_code_interpreter',
    );
  });

  it('13. type: computer_use_preview → openai_provider_hosted_computer_use (blocked PR8+)', () => {
    expect(classifyOpenAITool({ type: 'computer_use_preview' }, 'responses')).toBe(
      'openai_provider_hosted_computer_use',
    );
  });

  it('14. type: hosted_shell → openai_provider_hosted_hosted_shell (planned)', () => {
    expect(classifyOpenAITool({ type: 'hosted_shell' }, 'responses')).toBe(
      'openai_provider_hosted_hosted_shell',
    );
  });

  it('15. type: shell → openai_provider_hosted_hosted_shell (alias)', () => {
    expect(classifyOpenAITool({ type: 'shell' }, 'responses')).toBe(
      'openai_provider_hosted_hosted_shell',
    );
  });

  it('16. type: apply_patch → openai_provider_hosted_apply_patch (planned)', () => {
    expect(classifyOpenAITool({ type: 'apply_patch' }, 'responses')).toBe(
      'openai_provider_hosted_apply_patch',
    );
  });

  it('17. type: mcp → openai_provider_hosted_mcp (planned PR7+)', () => {
    expect(classifyOpenAITool({ type: 'mcp' }, 'responses')).toBe('openai_provider_hosted_mcp');
  });

  it('18. type: never_heard_of → openai_typed_unknown', () => {
    expect(classifyOpenAITool({ type: 'never_heard_of' }, 'responses')).toBe(
      'openai_typed_unknown',
    );
  });
});

describe('classifyOpenAITool — Chat Completions surface (only function allowed)', () => {
  it('Chat Completions: function → function_chat_completions', () => {
    expect(classifyOpenAITool({ type: 'function' }, 'chat_completions')).toBe(
      'function_chat_completions',
    );
  });

  it('Chat Completions: web_search → openai_typed_unknown (Chat does not accept hosted tools)', () => {
    expect(classifyOpenAITool({ type: 'web_search' }, 'chat_completions')).toBe(
      'openai_typed_unknown',
    );
  });

  it('Chat Completions: file_search → openai_typed_unknown', () => {
    expect(classifyOpenAITool({ type: 'file_search' }, 'chat_completions')).toBe(
      'openai_typed_unknown',
    );
  });

  it('Chat Completions: type:null → openai_typed_unknown', () => {
    expect(classifyOpenAITool({ type: null }, 'chat_completions')).toBe('openai_typed_unknown');
  });

  it('Chat Completions: type missing → openai_typed_unknown', () => {
    expect(classifyOpenAITool({}, 'chat_completions')).toBe('openai_typed_unknown');
  });
});

describe('decideOpenAITool — block_reason mapping', () => {
  it('function (responses) → allowed, Risk C', () => {
    const r = decideOpenAITool({ type: 'function' }, 'responses');
    expect(r.decision).toBe('allowed');
    expect(r.contributed_risk_class).toBe('C');
  });

  it('function (chat_completions) → allowed, Risk C', () => {
    const r = decideOpenAITool({ type: 'function' }, 'chat_completions');
    expect(r.decision).toBe('allowed');
    expect(r.contributed_risk_class).toBe('C');
  });

  it('web_search → allowed, Risk C', () => {
    const r = decideOpenAITool({ type: 'web_search' }, 'responses');
    expect(r.decision).toBe('allowed');
    expect(r.contributed_risk_class).toBe('C');
  });

  it('file_search → allowed, Risk B', () => {
    const r = decideOpenAITool({ type: 'file_search' }, 'responses');
    expect(r.decision).toBe('allowed');
    expect(r.contributed_risk_class).toBe('B');
  });

  it('tool_search → blocked_at_validation, reason=capability_planned', () => {
    const r = decideOpenAITool({ type: 'tool_search' }, 'responses');
    expect(r.decision).toBe('blocked_at_validation');
    expect(r.block_reason).toBe('capability_planned');
  });

  it('code_interpreter → blocked_at_validation, reason=capability_planned', () => {
    const r = decideOpenAITool({ type: 'code_interpreter' }, 'responses');
    expect(r.decision).toBe('blocked_at_validation');
    expect(r.block_reason).toBe('capability_planned');
  });

  it('computer_use_preview → blocked_at_validation, reason=capability_blocked_via_token (Risk D)', () => {
    const r = decideOpenAITool({ type: 'computer_use_preview' }, 'responses');
    expect(r.decision).toBe('blocked_at_validation');
    expect(r.block_reason).toBe('capability_blocked_via_token');
    expect(r.contributed_risk_class).toBe('D');
  });

  it('hosted_shell → blocked_at_validation, reason=capability_planned (Risk D)', () => {
    const r = decideOpenAITool({ type: 'hosted_shell' }, 'responses');
    expect(r.decision).toBe('blocked_at_validation');
    expect(r.block_reason).toBe('capability_planned');
    expect(r.contributed_risk_class).toBe('D');
  });

  it('apply_patch → blocked_at_validation, reason=capability_planned (Risk C)', () => {
    const r = decideOpenAITool({ type: 'apply_patch' }, 'responses');
    expect(r.decision).toBe('blocked_at_validation');
    expect(r.block_reason).toBe('capability_planned');
  });

  it('mcp → blocked_at_validation, reason=capability_planned (Risk D)', () => {
    const r = decideOpenAITool({ type: 'mcp' }, 'responses');
    expect(r.decision).toBe('blocked_at_validation');
    expect(r.block_reason).toBe('capability_planned');
    expect(r.contributed_risk_class).toBe('D');
  });

  it('typed_unknown → blocked_at_validation, reason=typed_unknown', () => {
    const r = decideOpenAITool({ type: 'whatever_unknown' }, 'responses');
    expect(r.decision).toBe('blocked_at_validation');
    expect(r.block_reason).toBe('typed_unknown');
  });

  it('null type → blocked_at_validation, reason=typed_unknown (Matrix v2.0.1 P3)', () => {
    const r = decideOpenAITool({ type: null }, 'responses');
    expect(r.decision).toBe('blocked_at_validation');
    expect(r.block_reason).toBe('typed_unknown');
  });
});
