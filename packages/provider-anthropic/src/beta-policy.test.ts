// ANTHROPIC_BETA_POLICY tests — 9 entries (Matrix v2 §13) + boot guard scenarios.

import { describe, it, expect } from 'vitest';
import {
  ANTHROPIC_BETA_POLICY,
  ANTHROPIC_BETA_POLICY_VERSION,
} from './beta-policy.js';
import { resolveBeta } from '@govai/core-governance';
import type { BetaTokenPolicyEntry } from '@govai/core-types';
import { randomUUID } from 'node:crypto';

describe('ANTHROPIC_BETA_POLICY — 9 canonical entries', () => {
  it('total entries = 9', () => {
    expect(ANTHROPIC_BETA_POLICY.length).toBe(9);
  });

  it('files-api-2025-04-14 → global_allowlist + ADR-014', () => {
    const e = ANTHROPIC_BETA_POLICY.find((p) => p.beta_token === 'files-api-2025-04-14');
    expect(e?.policy).toBe('global_allowlist');
    expect(e?.adr).toBe('ADR-014');
  });

  it('prompt-caching-2024-07-31 → verification_required', () => {
    const e = ANTHROPIC_BETA_POLICY.find((p) => p.beta_token === 'prompt-caching-2024-07-31');
    expect(e?.policy).toBe('verification_required');
  });

  it('message-batches-2024-09-24 → verification_required', () => {
    const e = ANTHROPIC_BETA_POLICY.find((p) => p.beta_token === 'message-batches-2024-09-24');
    expect(e?.policy).toBe('verification_required');
  });

  it('output-300k-2026-03-24 → denied_until_decision', () => {
    const e = ANTHROPIC_BETA_POLICY.find((p) => p.beta_token === 'output-300k-2026-03-24');
    expect(e?.policy).toBe('denied_until_decision');
  });

  it('3 versões de computer-use → hard_denied', () => {
    const tokens = [
      'computer-use-2025-11-24',
      'computer-use-2025-01-24',
      'computer-use-2024-10-22',
    ];
    for (const t of tokens) {
      const e = ANTHROPIC_BETA_POLICY.find((p) => p.beta_token === t);
      expect(e?.policy, `${t}`).toBe('hard_denied');
    }
  });

  it('managed-agents-2026-04-01 → denied_until_decision', () => {
    const e = ANTHROPIC_BETA_POLICY.find(
      (p) => p.beta_token === 'managed-agents-2026-04-01',
    );
    expect(e?.policy).toBe('denied_until_decision');
  });

  it('skills-2025-10-02 → denied_until_decision', () => {
    const e = ANTHROPIC_BETA_POLICY.find((p) => p.beta_token === 'skills-2025-10-02');
    expect(e?.policy).toBe('denied_until_decision');
  });

  it('snapshot version pinned', () => {
    expect(ANTHROPIC_BETA_POLICY_VERSION).toMatch(/^anthropic-beta-policy@\d{4}-\d{2}-\d{2}/);
  });
});

describe('resolveBeta against ANTHROPIC_BETA_POLICY', () => {
  const noOverrides = async () => [];

  it('files-api-2025-04-14 → allow (global)', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: randomUUID(),
      beta_token: 'files-api-2025-04-14',
      policy_table: ANTHROPIC_BETA_POLICY,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    expect(r.source).toBe('global_allowlist');
  });

  it('computer-use-2024-10-22 → deny (hard)', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: randomUUID(),
      beta_token: 'computer-use-2024-10-22',
      policy_table: ANTHROPIC_BETA_POLICY,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    expect(r.policy_at_resolution).toBe('hard_denied');
  });

  it('output-300k-2026-03-24 → deny (denied_until_decision) + audit_marker', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: randomUUID(),
      beta_token: 'output-300k-2026-03-24',
      policy_table: ANTHROPIC_BETA_POLICY,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    expect(r.audit_marker).toBe('decision_pending');
  });

  it('prompt-caching-2024-07-31 → deny + verification_pending marker (no override)', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: randomUUID(),
      beta_token: 'prompt-caching-2024-07-31',
      policy_table: ANTHROPIC_BETA_POLICY,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    expect(r.audit_marker).toBe('verification_pending');
  });

  it('unknown token → deny + source unknown_token', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: randomUUID(),
      beta_token: 'never-heard-of-2099-12-31',
      policy_table: ANTHROPIC_BETA_POLICY,
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    expect(r.source).toBe('unknown_token');
  });
});

describe('Decisão 3 — synthetic org_override_allowed fixture (test-only)', () => {
  // Synthetic policy table — NOT added to ANTHROPIC_BETA_POLICY production.
  const SYNTHETIC: BetaTokenPolicyEntry[] = [
    {
      beta_token: 'test-org-override-allowed-2026-05-07',
      policy: 'org_override_allowed',
      reason: 'Synthetic test fixture only — never present in production policy',
      pinned_at: '2026-05-07T00:00:00Z',
    },
  ];

  it('1. org without active override → deny', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: randomUUID(),
      beta_token: 'test-org-override-allowed-2026-05-07',
      policy_table: SYNTHETIC,
      active_overrides_loader: async () => [],
    });
    expect(r.decision).toBe('deny');
    expect(r.policy_at_resolution).toBe('org_override_allowed');
  });

  it('2. org with active override → allow + override_id propagated', async () => {
    const overrideId = randomUUID();
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: randomUUID(),
      beta_token: 'test-org-override-allowed-2026-05-07',
      policy_table: SYNTHETIC,
      active_overrides_loader: async () => [
        { beta_token: 'test-org-override-allowed-2026-05-07', id: overrideId },
      ],
    });
    expect(r.decision).toBe('allow');
    expect(r.source).toBe('org_override');
    expect(r.override_id).toBe(overrideId);
  });

  it('3. revoked or expired override (loader returns empty) → deny', async () => {
    const r = await resolveBeta({
      provider: 'anthropic',
      org_id: randomUUID(),
      beta_token: 'test-org-override-allowed-2026-05-07',
      policy_table: SYNTHETIC,
      // The active_overrides_loader contract is "active overrides only" — revoked
      // or expired entries must not be returned. So an empty array represents
      // both the no-override and the revoked/expired states.
      active_overrides_loader: async () => [],
    });
    expect(r.decision).toBe('deny');
  });

  it('synthetic token is NOT in production ANTHROPIC_BETA_POLICY', () => {
    const found = ANTHROPIC_BETA_POLICY.find(
      (p) => p.beta_token === 'test-org-override-allowed-2026-05-07',
    );
    expect(found).toBeUndefined();
  });
});

describe('verification_required entries persist as resolution-pending state', () => {
  // Boot guard is intentionally NOT in Batch A (deferred to Batch M).
  // The policy table must continue to surface verification_required entries
  // so resolveBeta returns a clear deny + audit_marker — tested below — and
  // so Batch M has something concrete to resolve before production.
  it('prompt-caching-2024-07-31 still marked verification_required', () => {
    const e = ANTHROPIC_BETA_POLICY.find((p) => p.beta_token === 'prompt-caching-2024-07-31');
    expect(e?.policy).toBe('verification_required');
  });

  it('message-batches-2024-09-24 still marked verification_required', () => {
    const e = ANTHROPIC_BETA_POLICY.find((p) => p.beta_token === 'message-batches-2024-09-24');
    expect(e?.policy).toBe('verification_required');
  });
});
