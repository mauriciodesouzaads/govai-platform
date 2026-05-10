// OPENAI_BETA_POLICY tests — 2 hard_denied entries (Matrix §22) + resolveBeta paths.

import { describe, it, expect } from 'vitest';
import { OPENAI_BETA_POLICY, OPENAI_BETA_POLICY_VERSION } from './beta-policy.js';
import { resolveBeta } from '@govai/core-governance';
import { randomUUID } from 'node:crypto';

describe('OPENAI_BETA_POLICY — 2 canonical entries', () => {
  it('total entries = 2', () => {
    expect(OPENAI_BETA_POLICY.length).toBe(2);
  });

  it('assistants=v2 → hard_denied', () => {
    const e = OPENAI_BETA_POLICY.find((p) => p.beta_token === 'assistants=v2');
    expect(e?.policy).toBe('hard_denied');
  });

  it('realtime=v1 → hard_denied', () => {
    const e = OPENAI_BETA_POLICY.find((p) => p.beta_token === 'realtime=v1');
    expect(e?.policy).toBe('hard_denied');
  });

  it('zero verification_required entries', () => {
    expect(OPENAI_BETA_POLICY.every((e) => e.policy !== 'verification_required')).toBe(true);
  });

  it('zero org_override_allowed entries (Issue #9 not a Batch C blocker)', () => {
    expect(OPENAI_BETA_POLICY.every((e) => e.policy !== 'org_override_allowed')).toBe(true);
  });

  it('snapshot version pinned', () => {
    expect(OPENAI_BETA_POLICY_VERSION).toMatch(/^openai-beta-policy@\d{4}-\d{2}-\d{2}/);
  });
});

describe('resolveBeta against OPENAI_BETA_POLICY', () => {
  const noOverrides = async () => [];

  it('assistants=v2 → deny (hard)', async () => {
    const r = await resolveBeta({
      provider: 'openai',
      org_id: randomUUID(),
      beta_token: 'assistants=v2',
      policy_table: OPENAI_BETA_POLICY,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    expect(r.policy_at_resolution).toBe('hard_denied');
  });

  it('realtime=v1 → deny (hard)', async () => {
    const r = await resolveBeta({
      provider: 'openai',
      org_id: randomUUID(),
      beta_token: 'realtime=v1',
      policy_table: OPENAI_BETA_POLICY,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    expect(r.policy_at_resolution).toBe('hard_denied');
  });

  it('unknown token → deny + source unknown_token', async () => {
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
