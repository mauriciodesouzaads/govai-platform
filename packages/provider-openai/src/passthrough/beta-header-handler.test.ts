import { describe, it, expect } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type { BetaTokenPolicyEntry } from '@govai/core-types';
import { betaObservationMarker, handleOpenAIBetaHeader } from './beta-header-handler.js';

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

  it('allows when header_value is empty string', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: '   ',
      policy_table: policy([]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
  });

  it('allows a token resolved via global_allowlist', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'allow-tok',
      policy_table: policy([
        {
          beta_token: 'allow-tok',
          policy: 'global_allowlist',
          reason: 'test',
          pinned_at: '2026-05-13T00:00:00Z',
        },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    if (r.decision === 'allow') {
      expect(r.sources).toEqual([
        {
          beta_token: 'allow-tok',
          source: 'global_allowlist',
          policy_at_resolution: 'global_allowlist',
        },
      ]);
      expect(r.forward_header).toBe('allow-tok');
    }
  });

  it('allows a token resolved via org_override and surfaces override_id', async () => {
    const orgId = randomUUID();
    const overrideId = randomUUID();
    const r = await handleOpenAIBetaHeader({
      org_id: orgId,
      header_value: 'oa-tok',
      policy_table: policy([
        {
          beta_token: 'oa-tok',
          policy: 'org_override_allowed',
          reason: 'test',
          pinned_at: '2026-05-13T00:00:00Z',
        },
      ]),
      active_overrides_loader: async () => [{ beta_token: 'oa-tok', id: overrideId }],
    });
    expect(r.decision).toBe('allow');
    if (r.decision === 'allow') {
      expect(r.sources[0]?.source).toBe('org_override');
      expect(r.sources[0]?.override_id).toBe(overrideId);
      expect(r.sources[0]?.policy_at_resolution).toBe('org_override_allowed');
    }
  });

  it('allows a token resolved via legacy_no_longer_needed (removed_as_no_longer_needed)', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'legacy-tok',
      policy_table: policy([
        {
          beta_token: 'legacy-tok',
          policy: 'removed_as_no_longer_needed',
          reason: 'test',
          pinned_at: '2026-05-13T00:00:00Z',
        },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    if (r.decision === 'allow') {
      expect(r.sources[0]?.source).toBe('legacy_no_longer_needed');
      expect(r.sources[0]?.policy_at_resolution).toBe('removed_as_no_longer_needed');
      expect(r.sources[0]?.override_id).toBeUndefined();
    }
  });

  it('forwards joined header when multiple tokens all allow', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: ' a-tok , b-tok ',
      policy_table: policy([
        {
          beta_token: 'a-tok',
          policy: 'global_allowlist',
          reason: 't',
          pinned_at: '2026-05-13T00:00:00Z',
        },
        {
          beta_token: 'b-tok',
          policy: 'global_allowlist',
          reason: 't',
          pinned_at: '2026-05-13T00:00:00Z',
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

describe('handleOpenAIBetaHeader — Native forward + observe (OD-1=A, M1)', () => {
  const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

  it('BETA-01: unknown token → FORWARD; no fabricated source; hashed unknown_token marker', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'mystery',
      policy_table: policy([]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    if (r.decision === 'allow') {
      expect(r.sources).toEqual([]);
      expect(r.forward_header).toBe('mystery');
      expect(r.observations).toEqual([`beta:unknown_token:sha256:${sha('mystery')}`]);
    }
  });

  it('BETA-04: denied_until_decision → FORWARD + decision_pending marker', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'pending',
      policy_table: policy([
        { beta_token: 'pending', policy: 'denied_until_decision', reason: 't', pinned_at: '2026-05-13T00:00:00Z' },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    if (r.decision === 'allow') {
      expect(r.sources).toEqual([]);
      expect(r.observations).toEqual([`beta:decision_pending:sha256:${sha('pending')}`]);
    }
  });

  it('BETA-03: verification_required without override → FORWARD + verification_required marker', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'verify-me',
      policy_table: policy([
        { beta_token: 'verify-me', policy: 'verification_required', reason: 't', pinned_at: '2026-05-13T00:00:00Z' },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    if (r.decision === 'allow') {
      expect(r.sources).toEqual([]);
      expect(r.observations).toEqual([`beta:verification_required:sha256:${sha('verify-me')}`]);
    }
  });

  it('org_override_allowed without override → FORWARD on Native + override_absent marker', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'needs-override',
      policy_table: policy([
        { beta_token: 'needs-override', policy: 'org_override_allowed', reason: 't', pinned_at: '2026-05-13T00:00:00Z' },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    if (r.decision === 'allow') {
      expect(r.sources).toEqual([]);
      expect(r.observations).toEqual([
        `beta:override_absent_native_forward:sha256:${sha('needs-override')}`,
      ]);
    }
  });

  it('BETA-02: known + unknown tokens → forward preserved, truthful known source only, one marker', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'allow-tok, mystery',
      policy_table: policy([
        { beta_token: 'allow-tok', policy: 'global_allowlist', reason: 't', pinned_at: '2026-05-13T00:00:00Z' },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('allow');
    if (r.decision === 'allow') {
      expect(r.forward_header).toBe('allow-tok, mystery');
      expect(r.sources).toEqual([
        { beta_token: 'allow-tok', source: 'global_allowlist', policy_at_resolution: 'global_allowlist' },
      ]);
      expect(r.observations).toEqual([`beta:unknown_token:sha256:${sha('mystery')}`]);
    }
  });

  it('BETA-06: hard_denied (computer-use floor) → DENY with explicit machine reason + hashed deny marker', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'no-go',
      policy_table: policy([
        { beta_token: 'no-go', policy: 'hard_denied', reason: 't', pinned_at: '2026-05-13T00:00:00Z' },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    if (r.decision === 'deny') {
      expect(r.denied).toEqual([
        { beta_token: 'no-go', policy_at_resolution: 'hard_denied', reason_code: 'hard_denied' },
      ]);
      expect(r.observations).toEqual([`beta:hard_denied:sha256:${sha('no-go')}`]);
    }
  });

  it('hard_denied + unknown in one header → the request is denied ONLY for the hard_denied token', async () => {
    const r = await handleOpenAIBetaHeader({
      org_id: randomUUID(),
      header_value: 'mystery, no-go',
      policy_table: policy([
        { beta_token: 'no-go', policy: 'hard_denied', reason: 't', pinned_at: '2026-05-13T00:00:00Z' },
      ]),
      active_overrides_loader: noOverrides,
    });
    expect(r.decision).toBe('deny');
    if (r.decision === 'deny') {
      expect(r.denied).toHaveLength(1);
      expect(r.denied[0]?.beta_token).toBe('no-go');
      expect(r.denied[0]?.reason_code).toBe('hard_denied');
    }
  });

  describe('BETA-08: marker safety', () => {
    it('an arbitrary client token is NEVER stored raw; the marker is bounded, hex-only and deterministic', async () => {
      const nasty = 'x'.repeat(4096) + '\u0000\n<script>' + randomUUID();
      const r1 = await handleOpenAIBetaHeader({
        org_id: randomUUID(),
        header_value: nasty,
        policy_table: policy([]),
        active_overrides_loader: noOverrides,
      });
      const r2 = await handleOpenAIBetaHeader({
        org_id: randomUUID(),
        header_value: nasty,
        policy_table: policy([]),
        active_overrides_loader: noOverrides,
      });
      expect(r1.decision).toBe('allow');
      if (r1.decision === 'allow' && r2.decision === 'allow') {
        expect(r1.observations).toHaveLength(1);
        const m = r1.observations[0]!;
        expect(m).toMatch(/^beta:unknown_token:sha256:[0-9a-f]{64}$/);
        expect(m.length).toBe('beta:unknown_token:sha256:'.length + 64);
        expect(m).not.toContain('script');
        expect(m).not.toContain(nasty.trim());
        expect(r2.observations).toEqual(r1.observations);
        expect(m.endsWith(sha(nasty.trim()))).toBe(true);
      }
    });

    it('betaObservationMarker is SHA-256 over the exact normalized token, per state', () => {
      expect(betaObservationMarker('unknown_token', 'abc')).toBe(
        `beta:unknown_token:sha256:${sha('abc')}`,
      );
      expect(betaObservationMarker('hard_denied', 'some-hard-denied-token')).toBe(
        `beta:hard_denied:sha256:${sha('some-hard-denied-token')}`,
      );
    });
  });
});
