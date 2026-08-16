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

describe('decideOpenAITool — M1 (OD-1=A): tools classify risk; only computer use blocks', () => {
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

  it('tool_search → allowed, Risk B (no longer a stale capability_planned block)', () => {
    const r = decideOpenAITool({ type: 'tool_search' }, 'responses');
    expect(r.classification).toBe('openai_provider_hosted_tool_search');
    expect(r.decision).toBe('allowed');
    expect(r.block_reason).toBeUndefined();
    expect(r.contributed_risk_class).toBe('B');
  });

  it('code_interpreter → allowed, Risk C', () => {
    const r = decideOpenAITool({ type: 'code_interpreter' }, 'responses');
    expect(r.decision).toBe('allowed');
    expect(r.contributed_risk_class).toBe('C');
  });

  it('computer_use_preview → blocked_at_validation, reason=capability_blocked_via_token (Risk D) — the ONLY floor', () => {
    const r = decideOpenAITool({ type: 'computer_use_preview' }, 'responses');
    expect(r.decision).toBe('blocked_at_validation');
    expect(r.block_reason).toBe('capability_blocked_via_token');
    expect(r.contributed_risk_class).toBe('D');
  });

  it('hosted_shell / shell → allowed, Risk D (classified + escalated, forwarded)', () => {
    for (const t of ['hosted_shell', 'shell']) {
      const r = decideOpenAITool({ type: t }, 'responses');
      expect(r.classification).toBe('openai_provider_hosted_hosted_shell');
      expect(r.decision).toBe('allowed');
      expect(r.contributed_risk_class).toBe('D');
    }
  });

  it('apply_patch → allowed, Risk C', () => {
    const r = decideOpenAITool({ type: 'apply_patch' }, 'responses');
    expect(r.decision).toBe('allowed');
    expect(r.contributed_risk_class).toBe('C');
  });

  it('mcp → allowed, Risk D', () => {
    const r = decideOpenAITool({ type: 'mcp' }, 'responses');
    expect(r.decision).toBe('allowed');
    expect(r.contributed_risk_class).toBe('D');
  });

  it('typed_unknown (future / unknown type) → allowed, Risk C; unknown != unsafe', () => {
    for (const t of ['whatever_unknown', 'image_generation', 'local_shell', 'namespace', 'custom']) {
      const r = decideOpenAITool({ type: t }, 'responses');
      expect(r.classification).toBe('openai_typed_unknown');
      expect(r.decision).toBe('allowed');
      expect(r.block_reason).toBeUndefined();
      expect(r.contributed_risk_class).toBe('C');
    }
  });

  it('null / missing / non-string type → typed_unknown, allowed (provider owns tool-shape validity)', () => {
    for (const tool of [{ type: null }, {}, { type: 7 }, { type: '' }]) {
      const r = decideOpenAITool(tool, 'responses');
      expect(r.classification).toBe('openai_typed_unknown');
      expect(r.decision).toBe('allowed');
    }
  });

  it('non-function type on chat_completions → typed_unknown, allowed (surface rule unchanged; provider decides)', () => {
    const r = decideOpenAITool({ type: 'web_search' }, 'chat_completions');
    expect(r.classification).toBe('openai_typed_unknown');
    expect(r.decision).toBe('allowed');
  });

  it('NATIVE_HARD_DENY_EXPANDED=NO: exactly one classification blocks at validation', () => {
    const types = [
      'function', 'web_search', 'web_search_preview', 'file_search', 'tool_search',
      'code_interpreter', 'computer_use_preview', 'hosted_shell', 'shell', 'apply_patch',
      'mcp', 'something_new',
    ];
    const blocked = types
      .map((t) => decideOpenAITool({ type: t }, 'responses'))
      .filter((d) => d.decision === 'blocked_at_validation')
      .map((d) => d.classification);
    expect(blocked).toEqual(['openai_provider_hosted_computer_use']);
  });
});
