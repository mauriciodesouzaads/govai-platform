import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolveBeta } from './beta-resolver.js';
import type { BetaTokenPolicyEntry } from '@govai/core-types';

const ORG = randomUUID();

const TABLE: BetaTokenPolicyEntry[] = [
  { beta_token: 'global-token',  policy: 'global_allowlist',          adr: 'ADR-PR2-04', reason: 'GA',         pinned_at: '2026-05-04T00:00:00Z' },
  { beta_token: 'org-token',     policy: 'org_override_allowed',                       reason: 'opt-in',     pinned_at: '2026-05-04T00:00:00Z' },
  { beta_token: 'hard-token',    policy: 'hard_denied',                                reason: 'unsafe',     pinned_at: '2026-05-04T00:00:00Z' },
  { beta_token: 'pending-token', policy: 'verification_required',                      reason: 'pending',    pinned_at: '2026-05-04T00:00:00Z' },
  { beta_token: 'paused-token',  policy: 'denied_until_decision',                      reason: 'review',     pinned_at: '2026-05-04T00:00:00Z' },
  { beta_token: 'legacy-token',  policy: 'removed_as_no_longer_needed', legacy: true, reason: 'graduated', pinned_at: '2026-05-04T00:00:00Z' },
];

const noOverrides = async () => [];
const orgWithOverride = async () => [{ beta_token: 'org-token', id: 'override-1' }];
const orgWithVerificationOverride = async () => [
  { beta_token: 'pending-token', id: 'override-2' },
];

describe('resolveBeta', () => {
  it('unknown_token → deny', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: ORG,
      beta_token: 'never-heard-of',
      policy_table: TABLE,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    expect(r.source).toBe('unknown_token');
    expect(r.policy_at_resolution).toBe('unknown');
  });

  it('global_allowlist → allow', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: ORG,
      beta_token: 'global-token',
      policy_table: TABLE,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    expect(r.source).toBe('global_allowlist');
  });

  it('org_override_allowed without active override → deny', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: ORG,
      beta_token: 'org-token',
      policy_table: TABLE,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    expect(r.policy_at_resolution).toBe('org_override_allowed');
  });

  it('org_override_allowed with active override → allow + override_id', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: ORG,
      beta_token: 'org-token',
      policy_table: TABLE,
      active_overrides_loader: orgWithOverride,
    });
    expect(r.decision).toBe('allow');
    expect(r.source).toBe('org_override');
    expect(r.override_id).toBe('override-1');
  });

  it('hard_denied → deny (regardless of overrides)', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: ORG,
      beta_token: 'hard-token',
      policy_table: TABLE,
      active_overrides_loader: orgWithOverride,
    });
    expect(r.decision).toBe('deny');
    expect(r.policy_at_resolution).toBe('hard_denied');
  });

  it('verification_required without override → deny + verification_pending marker', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: ORG,
      beta_token: 'pending-token',
      policy_table: TABLE,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    expect(r.audit_marker).toBe('verification_pending');
  });

  it('verification_required with override → allow + verification_pending marker', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: ORG,
      beta_token: 'pending-token',
      policy_table: TABLE,
      active_overrides_loader: orgWithVerificationOverride,
    });
    expect(r.decision).toBe('allow');
    expect(r.source).toBe('org_override');
    expect(r.override_id).toBe('override-2');
    expect(r.audit_marker).toBe('verification_pending');
  });

  it('denied_until_decision → deny + decision_pending marker', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: ORG,
      beta_token: 'paused-token',
      policy_table: TABLE,
      active_overrides_loader: orgWithOverride,
    });
    expect(r.decision).toBe('deny');
    expect(r.audit_marker).toBe('decision_pending');
  });

  it('removed_as_no_longer_needed → allow with legacy source', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: ORG,
      beta_token: 'legacy-token',
      policy_table: TABLE,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    expect(r.source).toBe('legacy_no_longer_needed');
  });
});
