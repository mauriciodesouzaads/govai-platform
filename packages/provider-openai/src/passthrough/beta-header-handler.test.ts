import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { BetaTokenPolicyEntry } from '@govai/core-types';
import { handleOpenAIBetaHeader } from './beta-header-handler.js';

const noOverrides = async () => [];
const policy = (entries: BetaTokenPolicyEntry[]) => Object.freeze(entries);

describe('handleOpenAIBetaHeader — allow paths', () => {
  it('allows when header_value is undefined (no beta requested)', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: undefined,
      policy_table: policy([]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    if (r.decision === 'allow') {
      expect(r.sources).toEqual([]);
      expect(r.forward_header).toBeUndefined();
    }
  });

  it('allows when header_value is whitespace-only', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: '   ',
      policy_table: policy([]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
  });

  it('allows a global_allowlist token', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'global-tok',
      policy_table: policy([
        {
          beta_token: 'global-tok',
          policy: 'global_allowlist',
          reason: 't',
          pinned_at: '2026-05-14T00:00:00Z',
        },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    if (r.decision === 'allow') {
      expect(r.sources[0]).toEqual({
        beta_token: 'global-tok',
        source: 'global_allowlist',
        policy_at_resolution: 'global_allowlist',
      });
      expect(r.forward_header).toBe('global-tok');
    }
  });

  it('allows an org_override_allowed token when an active override exists and surfaces override_id', async () => {
    const overrideId = randomUUID();
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'oa-tok',
      policy_table: policy([
        {
          beta_token: 'oa-tok',
          policy: 'org_override_allowed',
          reason: 't',
          pinned_at: '2026-05-14T00:00:00Z',
        },
      ]),
      active_overrides_loader: async () => [{ beta_token: 'oa-tok', id: overrideId }],
    });
    expect(r.decision).toBe('allow');
    if (r.decision === 'allow') {
      expect(r.sources[0]?.source).toBe('org_override');
      expect(r.sources[0]?.override_id).toBe(overrideId);
    }
  });

  it('allows a removed_as_no_longer_needed token under source=legacy_no_longer_needed', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'legacy-tok',
      policy_table: policy([
        {
          beta_token: 'legacy-tok',
          policy: 'removed_as_no_longer_needed',
          reason: 't',
          pinned_at: '2026-05-14T00:00:00Z',
        },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    if (r.decision === 'allow') {
      expect(r.sources[0]?.source).toBe('legacy_no_longer_needed');
      expect(r.sources[0]?.override_id).toBeUndefined();
    }
  });

  it('forwards a joined header when all of multiple tokens allow', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: ' a-tok , b-tok ',
      policy_table: policy([
        {
          beta_token: 'a-tok',
          policy: 'global_allowlist',
          reason: 't',
          pinned_at: '2026-05-14T00:00:00Z',
        },
        {
          beta_token: 'b-tok',
          policy: 'global_allowlist',
          reason: 't',
          pinned_at: '2026-05-14T00:00:00Z',
        },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    if (r.decision === 'allow') {
      expect(r.forward_header).toBe('a-tok, b-tok');
    }
  });
});

describe('handleOpenAIBetaHeader — deny reason_code derivation', () => {
  it('returns unknown_token when the token has no policy entry', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'mystery',
      policy_table: policy([]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    if (r.decision === 'deny') {
      expect(r.denied[0]?.reason_code).toBe('unknown_token');
      expect(r.denied[0]?.policy_at_resolution).toBe('unknown');
    }
  });

  it('returns hard_denied when policy=hard_denied', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'no-go',
      policy_table: policy([
        {
          beta_token: 'no-go',
          policy: 'hard_denied',
          reason: 't',
          pinned_at: '2026-05-14T00:00:00Z',
        },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    if (r.decision === 'deny') {
      expect(r.denied[0]?.reason_code).toBe('hard_denied');
    }
  });

  it('returns denied_until_decision when policy=denied_until_decision', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'pending',
      policy_table: policy([
        {
          beta_token: 'pending',
          policy: 'denied_until_decision',
          reason: 't',
          pinned_at: '2026-05-14T00:00:00Z',
        },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    if (r.decision === 'deny') {
      expect(r.denied[0]?.reason_code).toBe('denied_until_decision');
    }
  });

  it('returns verification_required_without_override for verification_required without an override', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'verify-me',
      policy_table: policy([
        {
          beta_token: 'verify-me',
          policy: 'verification_required',
          reason: 't',
          pinned_at: '2026-05-14T00:00:00Z',
        },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    if (r.decision === 'deny') {
      expect(r.denied[0]?.reason_code).toBe('verification_required_without_override');
    }
  });

  it('returns org_override_required_but_absent for org_override_allowed without an override', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'needs-override',
      policy_table: policy([
        {
          beta_token: 'needs-override',
          policy: 'org_override_allowed',
          reason: 't',
          pinned_at: '2026-05-14T00:00:00Z',
        },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    if (r.decision === 'deny') {
      expect(r.denied[0]?.reason_code).toBe('org_override_required_but_absent');
    }
  });

  it('returns ALL deniers when multiple tokens fail (any deny → request deny)', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'mystery, no-go',
      policy_table: policy([
        {
          beta_token: 'no-go',
          policy: 'hard_denied',
          reason: 't',
          pinned_at: '2026-05-14T00:00:00Z',
        },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    if (r.decision === 'deny') {
      expect(r.denied).toHaveLength(2);
      expect(r.denied.map((d) => d.reason_code).sort()).toEqual(
        ['hard_denied', 'unknown_token'].sort(),
      );
    }
  });
});
