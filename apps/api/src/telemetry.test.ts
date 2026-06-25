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

import { startTelemetry } from './telemetry.js';
import { makeAuditBridge } from './pipeline/audit-bridge.js';
import { createOtelAuditBridgeMetrics } from './pipeline/audit-bridge-metrics.js';
import type { AuditBridgeRequestIdentity } from './pipeline/request-identity.js';

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

// OTel's global MeterProvider is process-global; reset it between tests so they
// don't contaminate each other (STOP-cond 6 of the dispatch — verified resettable).
afterEach(() => {
  metrics.disable();
});

describe('startTelemetry (EP-008B-FOLLOWUP OTel MeterProvider bootstrap)', () => {
  it('A — disabled (no endpoint): registers NO global provider; shutdown resolves', async () => {
    const before = metrics.getMeterProvider();
    const handle = startTelemetry({ OTEL_SERVICE_NAME: 'govai-api', OTEL_EXPORTER_OTLP_ENDPOINT: undefined });
    expect(handle.enabled).toBe(false);
    // the global provider is unchanged (still the noop) — today's behavior preserved.
    expect(metrics.getMeterProvider()).toBe(before);
    expect(metrics.getMeterProvider().constructor.name).not.toBe('MeterProvider');
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('B — enabled (endpoint set): registers a global MeterProvider; a fresh OTel bridge-metrics resolves a real meter; shutdown resolves', async () => {
    const handle = startTelemetry({
      OTEL_SERVICE_NAME: 'govai-api',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    });
    expect(handle.enabled).toBe(true);
    expect(metrics.getMeterProvider().constructor.name).toBe('MeterProvider'); // not NoopMeterProvider
    // §2 guard: a freshly created default OTel impl resolves against the real provider.
    expect(() => createOtelAuditBridgeMetrics()).not.toThrow();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('C — in-memory end-to-end: the DEFAULT OTel impl exports drops_total + captures_total with exactly the cardinality-safe labels', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    // a far-future interval so no periodic export races the forceFlush; shutdown clears it.
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 2 ** 31 - 1 });
    const provider = new MeterProvider({ readers: [reader] });
    // register BEFORE building any bridge (the ordering invariant the spec §2 protects).
    metrics.setGlobalMeterProvider(provider);

    // one S5 drop (generic insert error) + one post-COMMIT success, via the DEFAULT OTel impl.
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

    // cardinality-safe: no key outside the allow-list; no raw id / no capability_id value.
    for (const p of [...drops!, ...captures!]) {
      for (const k of Object.keys(p.attributes)) expect(ALLOWED).toContain(k);
      const json = JSON.stringify(p.attributes);
      expect(json).not.toContain(ORG); // raw org_id
      expect(json).not.toContain('anthropic.messages.create'); // the free-form capability_id VALUE
      expect(json).not.toContain(REQ_IDENTITY.govaiRequestId);
    }

    await provider.shutdown();
  });

  it('D — an enabled handle shutdown() flushes/stops without throwing (and is safe to await)', async () => {
    const handle = startTelemetry({
      OTEL_SERVICE_NAME: 'svc',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    });
    expect(handle.enabled).toBe(true);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
