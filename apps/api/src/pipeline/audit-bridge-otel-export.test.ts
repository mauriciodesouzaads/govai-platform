// EP-OBS-REFACTOR: the AuditBridge OTel-export end-to-end (migrated from the #109
// apps/api telemetry.test.ts test C when that local module was replaced by
// @govai/observability). Registers an in-memory MeterProvider directly and drives
// the DEFAULT createOtelAuditBridgeMetrics impl through the bridge, proving the real
// OTel path exports govai_audit_bridge_{drops,captures}_total with the EC-3b
// cardinality-safe labels (no raw id / no capability_id).

import { createHash } from 'node:crypto';

import { describe, it, expect, afterEach, vi } from 'vitest';
import { metrics } from '@opentelemetry/api';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  InMemoryMetricExporter,
  AggregationTemporality,
  DataPointType,
} from '@opentelemetry/sdk-metrics';
import type { Pool, PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { PassthroughInvoked } from '@govai/core-events';

import { makeAuditBridge } from './audit-bridge.js';
import type { AuditBridgeRequestIdentity } from './request-identity.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORG_HASH = createHash('sha256').update(ORG).digest('hex').slice(0, 16);
const ALLOWED = ['reason', 'provider', 'capability_level', 'org_hash'];

const REQ_IDENTITY: AuditBridgeRequestIdentity = {
  govaiRequestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  identityScope: 'govai_request_id',
};

function baseEnvelope(): PassthroughInvoked {
  return {
    event_type: 'passthrough.invoked',
    schema_version: 4,
    tenant_context: { org_id: ORG, tier: 'business', operational_mode: 'production' },
    provider: 'anthropic',
    capability_id: 'anthropic.messages.create',
    capability_level: 'passthrough_audited',
    capability_canonical_level: 'policy_governed',
    native_endpoint: '/passthrough/anthropic/v1/messages',
    native_method: 'POST',
    is_stream: false,
    is_multipart: false,
    base_risk_class: 'B',
    effective_risk_class: 'B',
    risk_escalation_reasons: [],
    enforcement_decision: 'observe',
    native_request_hash: 'a'.repeat(64),
    native_response_hash: 'b'.repeat(64),
    latency_ms: 42,
    status_code: 200,
    occurred_at: '2026-06-15T00:00:00.000Z',
    credential_source: 'tenant_db',
    allowlist_version: 'v1',
    provider_request_id: 'req_baseline',
    body_forward_mode: 'raw',
    dlp_decisions: [],
    beta_allowlist_sources: [],
    detected_tool_classifications: [],
    audit_event_id: '99999999-9999-4999-8999-999999999999',
    chain_category: 'run',
  };
}

function makeStack(opts?: { insertError?: unknown }) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes('audit_capture_insert_locked')) {
      if (opts?.insertError !== undefined) throw opts.insertError;
      return { rows: [{ capture_id: (values ?? [])[0], capture_seq: '1' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const pool = { connect } as unknown as Pool;
  const log = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  } as unknown as FastifyBaseLogger;
  return { pool, log };
}

afterEach(() => {
  metrics.disable(); // reset the process-global MeterProvider between tests
});

describe('audit-bridge OTel export (in-memory end-to-end, default OTel impl)', () => {
  it('exports drops_total + captures_total with exactly the cardinality-safe labels', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 2 ** 31 - 1 });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider); // BEFORE building any bridge (ordering invariant)

    const dropStack = makeStack({ insertError: new Error('db down') });
    await makeAuditBridge({ pool: dropStack.pool, log: dropStack.log })(baseEnvelope(), REQ_IDENTITY);
    const okStack = makeStack();
    await makeAuditBridge({ pool: okStack.pool, log: okStack.log })(baseEnvelope(), REQ_IDENTITY);

    await provider.forceFlush();

    const points: Record<string, { value: number; attributes: Record<string, unknown> }[]> = {};
    for (const rm of exporter.getMetrics()) {
      for (const sm of rm.scopeMetrics) {
        for (const m of sm.metrics) {
          if (m.dataPointType !== DataPointType.SUM) continue; // counters are sums
          for (const dp of m.dataPoints) {
            (points[m.descriptor.name] ??= []).push({
              value: dp.value,
              attributes: dp.attributes as Record<string, unknown>,
            });
          }
        }
      }
    }

    const drops = points['govai_audit_bridge_drops_total'];
    const captures = points['govai_audit_bridge_captures_total'];
    expect(drops, 'drops_total exported').toBeDefined();
    expect(captures, 'captures_total exported').toBeDefined();

    const dropDp = drops!.find((p) => p.attributes['reason'] === 'capture_failed');
    expect(dropDp).toBeDefined();
    expect(dropDp!.attributes).toEqual({
      reason: 'capture_failed',
      provider: 'anthropic',
      capability_level: 'passthrough_audited',
      org_hash: ORG_HASH,
    });

    expect(captures!.length).toBeGreaterThanOrEqual(1);
    expect(captures![0]!.attributes).toEqual({
      provider: 'anthropic',
      capability_level: 'passthrough_audited',
      org_hash: ORG_HASH,
    });

    for (const p of [...drops!, ...captures!]) {
      for (const k of Object.keys(p.attributes)) expect(ALLOWED).toContain(k);
      const json = JSON.stringify(p.attributes);
      expect(json).not.toContain(ORG); // raw org_id
      expect(json).not.toContain('anthropic.messages.create'); // the free-form capability_id VALUE
      expect(json).not.toContain(REQ_IDENTITY.govaiRequestId);
    }

    await provider.shutdown();
  });
});
