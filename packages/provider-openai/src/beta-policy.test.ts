// OPENAI_BETA_POLICY tests — 2 historical entries (Matrix §22) re-adjudicated
// under Foundation V1 M1 (OD-1=A) + resolveBeta paths (the resolver still tells
// the truth about the table state; the Native application layer decides).

import { describe, it, expect } from 'vitest';
import { OPENAI_BETA_POLICY, OPENAI_BETA_POLICY_VERSION } from './beta-policy.js';
import { resolveBeta } from '@govai/core-governance';
import { randomUUID } from 'node:crypto';

describe('OPENAI_BETA_POLICY — 2 canonical entries (M1 re-adjudicated)', () => {
  it('total entries = 2', () => {
    expect(OPENAI_BETA_POLICY.length).toBe(2);
  });

  it('assistants=v2 → denied_until_decision (deprecation-only; no longer a Native hard deny)', () => {
    const e = OPENAI_BETA_POLICY.find((p) => p.beta_token === 'assistants=v2');
    expect(e?.policy).toBe('denied_until_decision');
  });

  it('realtime=v1 → denied_until_decision (deprecation-only; no longer a Native hard deny)', () => {
    const e = OPENAI_BETA_POLICY.find((p) => p.beta_token === 'realtime=v1');
    expect(e?.policy).toBe('denied_until_decision');
  });

  it('NATIVE_HARD_DENY_EXPANSION=FORBIDDEN: the OpenAI table carries NO hard_denied entry', () => {
    expect(OPENAI_BETA_POLICY.every((e) => e.policy !== 'hard_denied')).toBe(true);
  });

  it('zero verification_required entries', () => {
    expect(OPENAI_BETA_POLICY.every((e) => e.policy !== 'verification_required')).toBe(true);
  });

  it('zero org_override_allowed entries (Issue #9 not a Batch C blocker)', () => {
    expect(OPENAI_BETA_POLICY.every((e) => e.policy !== 'org_override_allowed')).toBe(true);
  });

  it('snapshot version pinned and bumped for the M1 re-adjudication', () => {
    expect(OPENAI_BETA_POLICY_VERSION).toMatch(/^openai-beta-policy@\d{4}-\d{2}-\d{2}/);
    expect(OPENAI_BETA_POLICY_VERSION).toBe('openai-beta-policy@2026-08-16');
  });
});

describe('resolveBeta against OPENAI_BETA_POLICY (resolver truth, unchanged semantics)', () => {
  const noOverrides = async () => [];

  it('assistants=v2 → resolver deny + policy denied_until_decision + audit_marker decision_pending', async () => {
    const r = await resolveBeta({
      provider: 'openai',
      org_id: randomUUID(),
      beta_token: 'assistants=v2',
      policy_table: OPENAI_BETA_POLICY,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    expect(r.policy_at_resolution).toBe('denied_until_decision');
    expect(r.audit_marker).toBe('decision_pending');
  });

  it('realtime=v1 → resolver deny + policy denied_until_decision', async () => {
    const r = await resolveBeta({
      provider: 'openai',
      org_id: randomUUID(),
      beta_token: 'realtime=v1',
      policy_table: OPENAI_BETA_POLICY,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    expect(r.policy_at_resolution).toBe('denied_until_decision');
  });

  it('unknown token → resolver deny + source unknown_token', async () => {
    const r = await resolveBeta({
      provider: 'openai',
      org_id: randomUUID(),
      beta_token: 'never-heard-of-2099-12-31',
      policy_table: OPENAI_BETA_POLICY,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    expect(r.source).toBe('unknown_token');
  });
});
