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

describe('classifyAnthropicTool — M1 rule 5b: explicit documented client-defined form', () => {
  it("type: 'custom' → client_defined (same thing as the absent-type form; no new enum)", () => {
    expect(classifyAnthropicTool({ type: 'custom', name: 'my_tool' })).toBe('client_defined');
  });
  it("type: 'Custom' (case-sensitive mismatch) → anthropic_typed_unknown (rule 7)", () => {
    expect(classifyAnthropicTool({ type: 'Custom' })).toBe('anthropic_typed_unknown');
  });
});

describe('decideAnthropicTool — M1 (OD-1=A): tools classify risk; only computer use blocks', () => {
  it('client_defined → allowed (risk B)', () => {
    const r = decideAnthropicTool({});
    expect(r.decision).toBe('allowed');
    expect(r.contributed_risk_class).toBe('B');
  });

  it("type:'custom' → allowed as client_defined (risk B)", () => {
    const r = decideAnthropicTool({ type: 'custom' });
    expect(r.classification).toBe('client_defined');
    expect(r.decision).toBe('allowed');
    expect(r.contributed_risk_class).toBe('B');
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

  it('code_execution → allowed (risk C) — no longer a stale capability_planned block', () => {
    const r = decideAnthropicTool({ type: 'code_execution_20250522' });
    expect(r.classification).toBe('anthropic_provider_hosted_code_execution');
    expect(r.decision).toBe('allowed');
    expect(r.block_reason).toBeUndefined();
    expect(r.contributed_risk_class).toBe('C');
  });

  it('computer_use → blocked_at_validation, reason=capability_blocked_via_token (the ONLY floor)', () => {
    for (const t of ['computer_20241022', 'computer_20250124', 'computer_20251124']) {
      const r = decideAnthropicTool({ type: t });
      expect(r.decision).toBe('blocked_at_validation');
      expect(r.block_reason).toBe('capability_blocked_via_token');
      expect(r.contributed_risk_class).toBe('D');
    }
  });

  it('typed_unknown (future provider type, e.g. web_fetch_*) → allowed (risk C); unknown != unsafe', () => {
    for (const t of ['web_fetch_20260101', 'memory_20250818', 'tool_search_tool_regex_20251119', 'mcp_toolset']) {
      const r = decideAnthropicTool({ type: t });
      expect(r.classification).toBe('anthropic_typed_unknown');
      expect(r.decision).toBe('allowed');
      expect(r.block_reason).toBeUndefined();
      expect(r.contributed_risk_class).toBe('C');
    }
  });

  it('null / non-string / empty type → typed_unknown, allowed (provider owns tool-shape validity)', () => {
    for (const t of [null, 42, '', '   ']) {
      const r = decideAnthropicTool({ type: t });
      expect(r.classification).toBe('anthropic_typed_unknown');
      expect(r.decision).toBe('allowed');
    }
  });

  it('NATIVE_HARD_DENY_EXPANDED=NO: exactly one classification blocks at validation', () => {
    const samples: Array<Record<string, unknown>> = [
      {},
      { type: 'custom' },
      { type: 'text_editor_20241029' },
      { type: 'bash_20241022' },
      { type: 'web_search_20260209' },
      { type: 'code_execution_20250522' },
      { type: 'computer_20250124' },
      { type: 'anything_else' },
      { type: null },
    ];
    const blocked = samples
      .map((t) => decideAnthropicTool(t))
      .filter((d) => d.decision === 'blocked_at_validation')
      .map((d) => d.classification);
    expect(blocked).toEqual(['anthropic_provider_hosted_computer_use']);
  });
});
