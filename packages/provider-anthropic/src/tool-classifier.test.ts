// 16 canonical cases — Peça A v2 §7.6 (com Matrix v2.0.1 P3 ajustes type:null vs type:undefined).

import { describe, it, expect } from 'vitest';
import { classifyAnthropicTool, decideAnthropicTool } from './tool-classifier.js';

describe('classifyAnthropicTool — 16 canonical cases', () => {
  it('1.  tool sem campo type → client_defined', () => {
    expect(classifyAnthropicTool({})).toBe('client_defined');
  });

  it('2.  type: undefined explicit → client_defined', () => {
    expect(classifyAnthropicTool({ type: undefined })).toBe('client_defined');
  });

  it('3.  type: null → anthropic_typed_unknown (DISTINCT from undefined)', () => {
    expect(classifyAnthropicTool({ type: null })).toBe('anthropic_typed_unknown');
  });

  it('4.  type: "" → anthropic_typed_unknown', () => {
    expect(classifyAnthropicTool({ type: '' })).toBe('anthropic_typed_unknown');
  });

  it('5.  type: "   " (whitespace) → anthropic_typed_unknown', () => {
    expect(classifyAnthropicTool({ type: '   ' })).toBe('anthropic_typed_unknown');
  });

  it('6.  type: 123 (non-string) → anthropic_typed_unknown', () => {
    expect(classifyAnthropicTool({ type: 123 as unknown as string })).toBe(
      'anthropic_typed_unknown',
    );
  });

  it('7.  type: { foo: "bar" } (object) → anthropic_typed_unknown', () => {
    expect(classifyAnthropicTool({ type: { foo: 'bar' } as unknown as string })).toBe(
      'anthropic_typed_unknown',
    );
  });

  it('8.  type: text_editor_20241029 → anthropic_defined_client_executed_text_editor', () => {
    expect(classifyAnthropicTool({ type: 'text_editor_20241029' })).toBe(
      'anthropic_defined_client_executed_text_editor',
    );
  });

  it('9.  type: bash_20241022 → anthropic_defined_client_executed_bash', () => {
    expect(classifyAnthropicTool({ type: 'bash_20241022' })).toBe(
      'anthropic_defined_client_executed_bash',
    );
  });

  it('10. type: web_search_20260209 → anthropic_provider_hosted_web_search', () => {
    expect(classifyAnthropicTool({ type: 'web_search_20260209' })).toBe(
      'anthropic_provider_hosted_web_search',
    );
  });

  it('11. type: code_execution_20250522 → anthropic_provider_hosted_code_execution', () => {
    expect(classifyAnthropicTool({ type: 'code_execution_20250522' })).toBe(
      'anthropic_provider_hosted_code_execution',
    );
  });

  it('12. type: computer_20241022 → anthropic_provider_hosted_computer_use', () => {
    expect(classifyAnthropicTool({ type: 'computer_20241022' })).toBe(
      'anthropic_provider_hosted_computer_use',
    );
  });

  it('13. type: computer_20251124 (forward-compat) → anthropic_provider_hosted_computer_use', () => {
    expect(classifyAnthropicTool({ type: 'computer_20251124' })).toBe(
      'anthropic_provider_hosted_computer_use',
    );
  });

  it('14. type: web_fetch_20260101 → anthropic_typed_unknown (NOT client_defined)', () => {
    expect(classifyAnthropicTool({ type: 'web_fetch_20260101' })).toBe(
      'anthropic_typed_unknown',
    );
  });

  it('15. type: tool_search_20260101 → anthropic_typed_unknown', () => {
    expect(classifyAnthropicTool({ type: 'tool_search_20260101' })).toBe(
      'anthropic_typed_unknown',
    );
  });

  it('16. type: text_editor (sem data; regex falha) → anthropic_typed_unknown', () => {
    expect(classifyAnthropicTool({ type: 'text_editor' })).toBe('anthropic_typed_unknown');
  });
});

describe('decideAnthropicTool — block_reason mapping', () => {
  it('client_defined → allowed', () => {
    expect(decideAnthropicTool({}).decision).toBe('allowed');
  });

  it('text_editor → allowed (risk C)', () => {
    const r = decideAnthropicTool({ type: 'text_editor_20241029' });
    expect(r.decision).toBe('allowed');
    expect(r.contributed_risk_class).toBe('C');
  });

  it('bash → allowed (risk D)', () => {
    expect(decideAnthropicTool({ type: 'bash_20241022' }).contributed_risk_class).toBe('D');
  });

  it('web_search → allowed (risk C)', () => {
    expect(decideAnthropicTool({ type: 'web_search_20260209' }).decision).toBe('allowed');
  });

  it('code_execution → blocked_at_validation, reason=capability_planned', () => {
    const r = decideAnthropicTool({ type: 'code_execution_20250522' });
    expect(r.decision).toBe('blocked_at_validation');
    expect(r.block_reason).toBe('capability_planned');
  });

  it('computer_use → blocked_at_validation, reason=capability_blocked_via_token', () => {
    const r = decideAnthropicTool({ type: 'computer_20241022' });
    expect(r.decision).toBe('blocked_at_validation');
    expect(r.block_reason).toBe('capability_blocked_via_token');
  });

  it('typed_unknown → blocked_at_validation, reason=typed_unknown', () => {
    const r = decideAnthropicTool({ type: 'web_fetch_20260101' });
    expect(r.decision).toBe('blocked_at_validation');
    expect(r.block_reason).toBe('typed_unknown');
  });

  it('null type → blocked_at_validation, reason=typed_unknown (Matrix v2.0.1 P3)', () => {
    const r = decideAnthropicTool({ type: null });
    expect(r.decision).toBe('blocked_at_validation');
    expect(r.block_reason).toBe('typed_unknown');
  });
});
