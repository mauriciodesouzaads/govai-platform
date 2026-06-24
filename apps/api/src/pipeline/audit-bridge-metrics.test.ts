import { describe, it, expect } from 'vitest';
import {
  safeLabels,
  areLabelsSafe,
  AUDIT_BRIDGE_METRIC_NAMES,
  createRecordingAuditBridgeMetrics,
} from './audit-bridge-metrics.js';

const ORG = '11111111-1111-4111-8111-111111111111';

describe('audit-bridge metrics labels (cardinality-safe)', () => {
  it('maps org_id -> org_hash, keeps the bounded dimensions, never emits org_id raw', () => {
    const l = safeLabels({
      reason: 'capture_failed',
      provider: 'anthropic',
      capability_level: 'evidence_grade',
      org_id: ORG,
    });
    expect(l['org_hash']).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(l)).not.toContain(ORG); // raw org_id never present
    expect('org_id' in l).toBe(false);
    expect(l['reason']).toBe('capture_failed');
    expect(l['provider']).toBe('anthropic');
    expect(l['capability_level']).toBe('evidence_grade');
    expect(areLabelsSafe(l)).toBe(true);
  });

  it('drops every non-allow-listed key — capability_id and the raw ids never become a label', () => {
    const l = safeLabels({
      reason: 'evidence_idempotency_conflict',
      provider: 'openai',
      capability_level: 'policy_governed',
      org_id: ORG,
      // all of these must be dropped by construction:
      capability_id: 'openai.responses.create',
      govai_request_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      capture_id: 'cap_should_not_appear',
      run_id: 'run_should_not_appear',
      provider_request_id: 'req_should_not_appear',
    });
    // exactly the four allow-listed output keys
    expect(Object.keys(l).sort()).toEqual(['capability_level', 'org_hash', 'provider', 'reason']);
    // the C1 guard: the free-form capability_id is NOT a label; capability_level is.
    expect('capability_id' in l).toBe(false);
    expect(l['capability_level']).toBe('policy_governed');
    // no raw id value leaks anywhere into the projected labels
    const json = JSON.stringify(l);
    for (const raw of [
      ORG,
      'openai.responses.create',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'cap_should_not_appear',
      'run_should_not_appear',
      'req_should_not_appear',
    ]) {
      expect(json).not.toContain(raw);
    }
  });

  it('areLabelsSafe rejects any raw-id-bearing attr set and accepts the allow-list', () => {
    expect(areLabelsSafe({ org_id: ORG })).toBe(false); // raw org_id (not org_hash)
    expect(areLabelsSafe({ capability_id: 'x' })).toBe(false); // the C1 free-form id
    expect(areLabelsSafe({ govai_request_id: 'x' })).toBe(false);
    expect(areLabelsSafe({ capture_id: 'x' })).toBe(false);
    expect(areLabelsSafe({ run_id: 'x' })).toBe(false);
    expect(areLabelsSafe({ provider_request_id: 'x' })).toBe(false);
    expect(areLabelsSafe({ payload: 'x' })).toBe(false);
    expect(
      areLabelsSafe({
        reason: 'a',
        provider: 'anthropic',
        capability_level: 'evidence_grade',
        org_hash: 'a1b2c3d4e5f60718',
      }),
    ).toBe(true);
  });
});

describe('audit-bridge metric names are exact (ADR-025)', () => {
  it('pins every name', () => {
    expect(AUDIT_BRIDGE_METRIC_NAMES).toEqual({
      drops: 'govai_audit_bridge_drops_total',
      captures: 'govai_audit_bridge_captures_total',
    });
  });
});

describe('audit-bridge recording metrics double', () => {
  it('records the right { name, value, labels } with safe labels', () => {
    const m = createRecordingAuditBridgeMetrics();
    m.dropTotal({ reason: 'missing_request_identity' });
    m.dropTotal({
      reason: 'capture_failed',
      provider: 'anthropic',
      capability_level: 'evidence_grade',
      org_id: ORG,
    });
    m.captureTotal({ provider: 'openai', capability_level: 'policy_governed', org_id: ORG });

    expect(m.records).toHaveLength(3);

    expect(m.records[0]).toEqual({
      name: 'govai_audit_bridge_drops_total',
      value: 1,
      labels: { reason: 'missing_request_identity' },
    });

    expect(m.records[1]!.name).toBe('govai_audit_bridge_drops_total');
    expect(m.records[1]!.value).toBe(1);
    expect(m.records[1]!.labels['org_hash']).toMatch(/^[0-9a-f]{16}$/);
    expect(m.records[1]!.labels['capability_level']).toBe('evidence_grade');

    expect(m.records[2]!.name).toBe('govai_audit_bridge_captures_total');
    expect(m.records[2]!.labels['provider']).toBe('openai');
    expect(areLabelsSafe(m.records[2]!.labels)).toBe(true);
  });
});
