import { describe, it, expect } from 'vitest';
import { classifyTools } from './tool-classifier-hook.js';

describe('classifyTools — allow paths', () => {
  it('returns allow with an empty classification list when tools array is empty', () => {
    const r = classifyTools([]);
    expect(r.decision).toBe('allow');
    expect(r.classifications).toEqual([]);
  });

  it('allows client_defined tools and tags decision as allowed', () => {
    const r = classifyTools([{ name: 'add', input_schema: {} }]);
    expect(r.decision).toBe('allow');
    expect(r.classifications).toEqual([
      {
        tool_index: 0,
        tool_type: undefined,
        classification: 'client_defined',
        contributed_risk_class: 'B',
        decision: 'allowed',
      },
    ]);
  });

  it('allows recognized provider-hosted web_search tools', () => {
    const r = classifyTools([{ type: 'web_search_20260101' }]);
    expect(r.decision).toBe('allow');
    expect(r.classifications[0]?.classification).toBe(
      'anthropic_provider_hosted_web_search',
    );
  });

  it('substitutes an empty object for a null/undefined entry in the tools array', () => {
    const r = classifyTools([null, undefined]);
    // Both substituted with {} → classification = client_defined (no `type` key).
    expect(r.decision).toBe('allow');
    expect(r.classifications).toHaveLength(2);
    expect(r.classifications[0]?.classification).toBe('client_defined');
    expect(r.classifications[1]?.classification).toBe('client_defined');
  });
});

describe('classifyTools — M1 (OD-1=A): non-computer tools forward, classification recorded', () => {
  it('typed_unknown (unknown string type) → allow, recorded as anthropic_typed_unknown / allowed (Risk C)', () => {
    const r = classifyTools([{ type: 'banana' }]);
    expect(r.decision).toBe('allow');
    expect(r.classifications[0]).toEqual({
      tool_index: 0,
      tool_type: 'banana',
      classification: 'anthropic_typed_unknown',
      contributed_risk_class: 'C',
      decision: 'allowed',
    });
  });

  it("type:'custom' (documented client-defined form) → allow as client_defined (Risk B)", () => {
    const r = classifyTools([{ type: 'custom', name: 'add', input_schema: {} }]);
    expect(r.decision).toBe('allow');
    expect(r.classifications[0]?.classification).toBe('client_defined');
    expect(r.classifications[0]?.tool_type).toBe('custom');
    expect(r.classifications[0]?.contributed_risk_class).toBe('B');
  });

  it('empty-string / null tool.type → allow, typed_unknown recorded (tool_type only when a string)', () => {
    for (const [tool, expectedType] of [
      [{ type: '' }, ''],
      [{ type: null }, undefined],
    ] as Array<[Record<string, unknown>, string | undefined]>) {
      const r = classifyTools([tool]);
      expect(r.decision).toBe('allow');
      expect(r.classifications[0]?.classification).toBe('anthropic_typed_unknown');
      expect(r.classifications[0]?.tool_type).toBe(expectedType);
    }
  });

  it('code_execution_* → allow with its dedicated classification (Risk C) — no stale planned block', () => {
    const r = classifyTools([{ type: 'code_execution_20251010' }]);
    expect(r.decision).toBe('allow');
    expect(r.classifications[0]?.classification).toBe('anthropic_provider_hosted_code_execution');
    expect(r.classifications[0]?.decision).toBe('allowed');
  });

  it('future provider types lacking a dedicated v4 enum (web_fetch_*, memory_*, tool_search_tool_*, mcp_toolset) → typed_unknown, allow', () => {
    const r = classifyTools([
      { type: 'web_fetch_20250910' },
      { type: 'memory_20250818' },
      { type: 'tool_search_tool_regex_20251119' },
      { type: 'mcp_toolset' },
    ]);
    expect(r.decision).toBe('allow');
    expect(r.classifications.every((c) => c.classification === 'anthropic_typed_unknown')).toBe(true);
    expect(r.classifications.every((c) => c.decision === 'allowed')).toBe(true);
  });

  it('computer_* → block (the ONLY floor) with reason=capability_blocked_via_token + explicit detail', () => {
    const r = classifyTools([{ type: 'computer_20250101' }]);
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      const b = r.blocked[0];
      expect(b?.reason).toBe('capability_blocked_via_token');
      expect(b?.tool_type_observed).toBe('other_typed_unknown');
      expect(b?.reason_detail).toMatch(/provider-hosted computer use — the explicit Native high-risk floor/);
      expect(r.classifications[0]?.decision).toBe('blocked_at_validation');
    }
  });

  it('mixed: only the computer-use tool blocks; every classification is still recorded', () => {
    const r = classifyTools([{ name: 'ok' }, { type: 'computer_20250124' }, { type: 'banana' }]);
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
