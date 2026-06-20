import { describe, it, expect } from 'vitest';
import {
  safeLabels,
  areLabelsSafe,
  SEALER_METRIC_NAMES,
  createRecordingSealerMetrics,
} from './metrics.js';

const ORG = '11111111-1111-4111-8111-111111111111';

describe('metrics labels (cardinality-safe)', () => {
  it('hashes org_id and never emits it raw', () => {
    const l = safeLabels({ orgId: ORG, tenantTier: 'starter', operationalMode: 'production', result: 'normal' });
    expect(l['org_hash']).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(l)).not.toContain(ORG);
    expect(l['tenant_tier']).toBe('starter');
    expect(l['operational_mode']).toBe('production');
    expect(l['result']).toBe('normal');
    expect(areLabelsSafe(l)).toBe(true);
  });

  it('rejects high-cardinality keys', () => {
    expect(areLabelsSafe({ capture_id: 'x' })).toBe(false);
    expect(areLabelsSafe({ provider_request_id: 'x' })).toBe(false);
    expect(areLabelsSafe({ org_hash: 'a', tenant_tier: 'b', result: 'c', reason: 'd', operational_mode: 'e' })).toBe(true);
  });
});

describe('metric names are exact (ADR-025)', () => {
  it('pins every name', () => {
    expect(SEALER_METRIC_NAMES).toEqual({
      claimTotal: 'govai_audit_sealer_claim_total',
      sealedTotal: 'govai_audit_sealer_sealed_total',
      failedTotal: 'govai_audit_sealer_failed_total',
      claimLatencyMs: 'govai_audit_sealer_claim_latency_ms',
      sealLatencyMs: 'govai_audit_sealer_seal_latency_ms',
      backlogDepth: 'govai_audit_sealer_backlog_depth',
      oldestPendingAgeSeconds: 'govai_audit_sealer_oldest_pending_age_seconds',
      staleCount: 'govai_audit_sealer_stale_count',
      retryTotal: 'govai_audit_sealer_retry_total',
      terminalFailureTotal: 'govai_audit_sealer_terminal_failure_total',
    });
  });
});

describe('recording metrics double', () => {
  it('captures emissions with safe labels', () => {
    const m = createRecordingSealerMetrics();
    m.sealedTotal({ orgId: ORG, result: 'normal' });
    m.terminalFailureTotal({ orgId: ORG });
    m.backlogDepth(42, { orgId: ORG });
    expect(m.records).toHaveLength(3);
    expect(m.records[0]!.name).toBe('govai_audit_sealer_sealed_total');
    expect(m.records[0]!.labels['org_hash']).toMatch(/^[0-9a-f]{16}$/);
    expect(m.records[1]!.name).toBe('govai_audit_sealer_terminal_failure_total');
    expect(m.records[2]!.value).toBe(42);
  });
});
