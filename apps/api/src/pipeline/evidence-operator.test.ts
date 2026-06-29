import { describe, it, expect } from 'vitest';

import { aggregateOperatorView, type OrgEvidence } from './evidence-operator.js';
import type { EvidenceSummary } from './evidence-reports.js';

function summaryWith(overrides: {
  coverage: number;
  ec1_total?: number;
  ec1_failed?: number;
  ec4_without_terminal?: number;
}): EvidenceSummary {
  return {
    window_seconds: 86_400,
    t_seal_seconds: 0,
    counts: {
      ec1: {
        total: overrides.ec1_total ?? 0,
        sealed: 0,
        failed: overrides.ec1_failed ?? 0,
        stalled_past_slo: 0,
      },
      ec2: { chains: 0, chains_with_gap: 0 },
      ec3seal: { native_total: 0, native_sealed: 0, native_unsealed_past_slo: 0 },
      ec4: { provider_invocations: 0, without_terminal: overrides.ec4_without_terminal ?? 0 },
      ec6: { chains: 0, verified_ok: 0, pending: 0 },
    },
    ec3drop: {
      invariant: 'ec3drop',
      label: 'EC-3 — native (drop)',
      drops: 0,
      captures: 0,
      drop_rate: null,
      observed: false,
      bound: 'native capture loss in aggregate',
    },
    ec6: {
      invariant: 'ec6',
      label: 'EC-6 — chain integrity',
      total_chains: 0,
      verified_ok: 0,
      pending: 0,
      last_verified_at: null,
      note: 'pending',
    },
    coverage_ratio: {
      label: 'coverage_ratio',
      ratio: overrides.coverage,
      covered: 0,
      total: 0,
      terms: [],
      excluded: [],
    },
  };
}

describe('aggregateOperatorView — cross-org fold (aggregate columns only)', () => {
  const perOrg: OrgEvidence[] = [
    { org_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', summary: summaryWith({ coverage: 0.4, ec1_failed: 2, ec4_without_terminal: 1 }) },
    { org_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', summary: summaryWith({ coverage: 0.9, ec1_failed: 0, ec4_without_terminal: 3 }) },
  ];

  it('returns one aggregate row per org and folds the totals', () => {
    const view = aggregateOperatorView(perOrg);
    expect(view.orgs.map((o) => o.org_id)).toEqual([
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ]);
    expect(view.totals.org_count).toBe(2);
    expect(view.totals.coverage_ratio_min).toBeCloseTo(0.4, 10);
    expect(view.totals.ec1_failed).toBe(2);
    expect(view.totals.ec4_without_terminal).toBe(4);
  });

  it('exposes ONLY aggregate columns — no payload or capture/run identifier', () => {
    const view = aggregateOperatorView(perOrg);
    const FORBIDDEN = [
      'payload_hash',
      'payload_encrypted',
      'canonical_bytes',
      'redaction_metadata',
      'capture_id',
      'run_id',
      'provider_invocation_id',
    ];
    for (const row of view.orgs) {
      for (const k of FORBIDDEN) expect(row).not.toHaveProperty(k);
      // every value on an operator row is a string org_id or a number aggregate.
      for (const [key, val] of Object.entries(row)) {
        expect(key === 'org_id' ? typeof val === 'string' : typeof val === 'number').toBe(true);
      }
    }
  });

  it('reports null coverage floor for an empty org set', () => {
    expect(aggregateOperatorView([]).totals.coverage_ratio_min).toBeNull();
  });
});
