// EP-OBS-REFACTOR: the sealer metrics OTel-export end-to-end (migrated from the
// #110 telemetry.test.ts test C when the local telemetry module was replaced by
// @govai/observability). Registers an in-memory MeterProvider directly and drives
// the DEFAULT createOtelSealerMetrics impl, proving the real OTel path exports the
// ADR-025 metrics with the cardinality-safe labels (org_hash, never raw orgId).

import { createHash } from 'node:crypto';

import { describe, it, expect, afterEach } from 'vitest';
import { metrics } from '@opentelemetry/api';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  InMemoryMetricExporter,
  AggregationTemporality,
} from '@opentelemetry/sdk-metrics';

import { createOtelSealerMetrics, SEALER_METRIC_NAMES } from './metrics.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORG_HASH = createHash('sha256').update(ORG).digest('hex').slice(0, 16);
const ALLOWED = ['org_hash', 'tenant_tier', 'operational_mode', 'result', 'reason'];

afterEach(() => {
  metrics.disable(); // reset the process-global MeterProvider between tests
});

describe('sealer metrics OTel export (in-memory end-to-end, default OTel impl)', () => {
  it('exports SEALER_METRIC_NAMES with cardinality-safe labels (org_hash, never raw orgId)', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 2 ** 31 - 1 });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider); // BEFORE building metrics (ordering invariant)

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
    expect(sealed![0]).toEqual({ org_hash: ORG_HASH, result: 'normal' });
    expect(sealLat![0]).toEqual({ org_hash: ORG_HASH });

    for (const arr of Object.values(attrsByName)) {
      for (const a of arr) {
        for (const k of Object.keys(a)) expect(ALLOWED).toContain(k);
        expect(JSON.stringify(a)).not.toContain(ORG); // raw orgId never emitted
      }
    }

    await provider.shutdown();
  });
});
