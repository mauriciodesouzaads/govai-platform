import { describe, it, expect } from 'vitest';

import {
  EVIDENCE_METRIC_NAMES,
  safeEvidenceLabels,
  areEvidenceLabelsSafe,
  summaryToGaugePoints,
} from './evidence-metrics.js';
import type { EvidenceSummary } from './evidence-reports.js';

describe('EVIDENCE_METRIC_NAMES — the govai_evidence_* contract', () => {
  it('uses the govai_evidence_ namespace for every gauge (two-namespace §R4)', () => {
    for (const name of Object.values(EVIDENCE_METRIC_NAMES)) {
      expect(name.startsWith('govai_evidence_')).toBe(true);
    }
  });

  it('does NOT define the EC-5 streams-without-terminal gauge (deferred)', () => {
    const names = Object.values(EVIDENCE_METRIC_NAMES) as string[];
    expect(names).not.toContain('govai_evidence_streams_without_terminal_marker');
    expect(Object.keys(EVIDENCE_METRIC_NAMES)).not.toContain('streamsWithoutTerminalMarker');
  });

  it('keeps the EC-3.drop gauge separate from the shipped govai_audit_bridge_* counters', () => {
    // §R4: no rename of the shipped counters; the derived gauge is a new name.
    expect(EVIDENCE_METRIC_NAMES.nativeDropEstimate).toBe('govai_evidence_native_drop_estimate');
  });
});

describe('safeEvidenceLabels — cardinality-safe allow-list', () => {
  it('projects org_id → org_hash and never emits raw org_id', () => {
    const out = safeEvidenceLabels({ org_id: '11111111-1111-1111-1111-111111111111' });
    expect(out['org_hash']).toMatch(/^[0-9a-f]{16}$/);
    expect(out).not.toHaveProperty('org_id');
    expect(out['org_hash']).not.toBe('11111111-1111-1111-1111-111111111111');
  });

  it('passes the bounded chain_category through', () => {
    expect(safeEvidenceLabels({ chain_category: 'run' })).toEqual({ chain_category: 'run' });
  });

  it('drops any key outside the allow-list by construction', () => {
    const out = safeEvidenceLabels({ org_id: 'x', chain_category: 'run', run_id: 'leak' } as never);
    expect(areEvidenceLabelsSafe(out)).toBe(true);
    expect(out).not.toHaveProperty('run_id');
  });
});

describe('summaryToGaugePoints — reports → metrics bridge', () => {
  const summary: EvidenceSummary = {
    window_seconds: 86_400,
    t_seal_seconds: 0,
    counts: {
      ec1: { total: 3, sealed: 1, failed: 1, stalled_past_slo: 1 },
      ec2: { chains: 2, chains_with_gap: 1 },
      ec3seal: { native_total: 2, native_sealed: 1, native_unsealed_past_slo: 1 },
      ec4: { provider_invocations: 2, without_terminal: 1 },
      ec6: { chains: 1, verified_ok: 0, pending: 1 },
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
      total_chains: 1,
      verified_ok: 0,
      pending: 1,
      last_verified_at: null,
      note: 'pending',
    },
    coverage_ratio: {
      label: 'coverage_ratio',
      ratio: 0.5,
      covered: 5,
      total: 10,
      terms: [],
      excluded: [],
    },
  };

  it('labels every point with the org and emits only allow-listed labels', () => {
    const points = summaryToGaugePoints('22222222-2222-2222-2222-222222222222', summary);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.labels?.org_id).toBe('22222222-2222-2222-2222-222222222222');
      expect(areEvidenceLabelsSafe(safeEvidenceLabels(p.labels ?? {}))).toBe(true);
    }
  });

  it('omits the EC-3.drop point when unobserved and the last-verified gauge when null', () => {
    const points = summaryToGaugePoints('22222222-2222-2222-2222-222222222222', summary);
    const metrics = points.map((p) => p.metric);
    expect(metrics).not.toContain('nativeDropEstimate'); // unobserved → omitted
    expect(metrics).not.toContain('chainLastVerifiedTimestamp'); // null → omitted
    expect(metrics).toContain('coverageRatio');
    expect(metrics).toContain('runsWithoutTerminalEvent');
  });

  it('includes the EC-3.drop point once observed', () => {
    const observed: EvidenceSummary = {
      ...summary,
      ec3drop: { ...summary.ec3drop, drops: 1, captures: 9, drop_rate: 0.1, observed: true },
    };
    const metrics = summaryToGaugePoints('22222222-2222-2222-2222-222222222222', observed).map(
      (p) => p.metric,
    );
    expect(metrics).toContain('nativeDropEstimate');
  });
});
