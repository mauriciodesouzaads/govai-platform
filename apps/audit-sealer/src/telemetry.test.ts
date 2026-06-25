import { createHash } from 'node:crypto';

import { describe, it, expect, afterEach } from 'vitest';
import { metrics } from '@opentelemetry/api';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  InMemoryMetricExporter,
  AggregationTemporality,
} from '@opentelemetry/sdk-metrics';

import { startTelemetry } from './telemetry.js';
import { createOtelSealerMetrics, SEALER_METRIC_NAMES } from './metrics.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORG_HASH = createHash('sha256').update(ORG).digest('hex').slice(0, 16);
const ALLOWED = ['org_hash', 'tenant_tier', 'operational_mode', 'result', 'reason'];

// OTel's global MeterProvider is process-global; reset it between tests so they
// don't contaminate each other (STOP-cond 6 — verified cleanly resettable).
afterEach(() => {
  metrics.disable();
});

describe('startTelemetry (EP-008B-FOLLOWUP-SEALER OTel MeterProvider bootstrap)', () => {
  it('A — disabled (no endpoint): registers NO global provider; shutdown resolves', async () => {
    const before = metrics.getMeterProvider();
    const handle = startTelemetry({
      OTEL_SERVICE_NAME: 'govai-audit-sealer',
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    });
    expect(handle.enabled).toBe(false);
    expect(metrics.getMeterProvider()).toBe(before); // unchanged — today's behavior
    expect(metrics.getMeterProvider().constructor.name).not.toBe('MeterProvider');
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('B — enabled (endpoint set): registers a global MeterProvider; a fresh sealer OTel impl resolves a real meter; shutdown resolves', async () => {
    const handle = startTelemetry({
      OTEL_SERVICE_NAME: 'govai-audit-sealer',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    });
    expect(handle.enabled).toBe(true);
    expect(metrics.getMeterProvider().constructor.name).toBe('MeterProvider'); // not NoopMeterProvider
    expect(() => createOtelSealerMetrics()).not.toThrow();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('C — in-memory end-to-end: the DEFAULT createOtelSealerMetrics impl exports the sealer metrics with cardinality-safe labels (org_hash, never raw orgId)', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 2 ** 31 - 1 });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider); // BEFORE building metrics (ordering invariant §2)

    // drive the DEFAULT OTel impl directly (the sealer metrics are not dispatcher-wired
    // and the full claim loop needs a DB) — a counter and a histogram, with the orgId input.
    const m = createOtelSealerMetrics();
    m.sealedTotal({ orgId: ORG, result: 'normal' });
    m.sealLatencyMs(42, { orgId: ORG });

    await provider.forceFlush();

    const attrsByName: Record<string, Record<string, unknown>[]> = {};
    for (const rm of exporter.getMetrics()) {
      for (const sm of rm.scopeMetrics) {
        for (const md of sm.metrics) {
          for (const dp of md.dataPoints) {
            (attrsByName[md.descriptor.name] ??= []).push(dp.attributes as Record<string, unknown>);
          }
        }
      }
    }

    const sealed = attrsByName[SEALER_METRIC_NAMES.sealedTotal];
    const sealLat = attrsByName[SEALER_METRIC_NAMES.sealLatencyMs];
    expect(sealed, 'sealed_total exported').toBeDefined();
    expect(sealLat, 'seal_latency_ms exported').toBeDefined();
    // org_id mapped to org_hash; the bounded dimensions pass through.
    expect(sealed![0]).toEqual({ org_hash: ORG_HASH, result: 'normal' });
    expect(sealLat![0]).toEqual({ org_hash: ORG_HASH });

    // cardinality-safe: every key ∈ the allow-list; the raw orgId value never appears.
    for (const arr of Object.values(attrsByName)) {
      for (const a of arr) {
        for (const k of Object.keys(a)) expect(ALLOWED).toContain(k);
        expect(JSON.stringify(a)).not.toContain(ORG);
      }
    }

    await provider.shutdown();
  });

  it('D — an enabled handle shutdown() flushes/stops without throwing', async () => {
    const handle = startTelemetry({
      OTEL_SERVICE_NAME: 'svc',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    });
    expect(handle.enabled).toBe(true);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
