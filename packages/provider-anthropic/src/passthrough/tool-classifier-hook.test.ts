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

describe('classifyTools — block paths and reason_detail branches', () => {
  it('blocks typed_unknown and emits the typed_unknown reason_detail variant (with serialized tool.type)', () => {
    const r = classifyTools([{ type: 'banana' }]);
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      const b = r.blocked[0];
      expect(b?.reason).toBe('typed_unknown');
      expect(b?.tool_type_observed).toBe('other_typed_unknown');
      expect(b?.reason_detail).toMatch(/^tool\.type "banana" is not classified/);
    }
  });

  it('flags an empty-string tool.type via observeToolType=empty_string', () => {
    const r = classifyTools([{ type: '' }]);
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      expect(r.blocked[0]?.tool_type_observed).toBe('empty_string');
    }
  });

  it('flags a null tool.type via observeToolType=null', () => {
    const r = classifyTools([{ type: null }]);
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      expect(r.blocked[0]?.tool_type_observed).toBe('null');
    }
  });

  it('blocks code_execution_* with the capability_planned reason_detail variant (target PR4)', () => {
    const r = classifyTools([{ type: 'code_execution_20251010' }]);
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      const b = r.blocked[0];
      expect(b?.reason).toBe('capability_planned');
      expect(b?.reason_detail).toMatch(/planned capability \(target PR4\)/);
    }
  });

  it('blocks computer_* with the hard_denied-style reason_detail variant', () => {
    const r = classifyTools([{ type: 'computer_20250101' }]);
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      const b = r.blocked[0];
      expect(b?.reason).toBe('capability_blocked_via_token');
      expect(b?.reason_detail).toMatch(/hard_denied until governance primitive \(target PR8\+\)/);
    }
  });

  it('combines mixed allow/block: when any tool is blocked the request is blocked, with all classifications recorded', () => {
    const r = classifyTools([{ name: 'ok' }, { type: 'banana' }, { type: 'web_search_20260101' }]);
    expect(r.decision).toBe('block');
    if (r.decision === 'block') {
      expect(r.classifications).toHaveLength(3);
      expect(r.blocked).toHaveLength(1);
      expect(r.blocked[0]?.tool_index).toBe(1);
    }
  });
});
