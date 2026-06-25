import { describe, it, expect, afterEach } from 'vitest';
import { metrics } from '@opentelemetry/api';

import { metricsUrl, resolveServiceName, startTelemetry } from './index.js';

// OTel's global MeterProvider is process-global; reset it between tests.
afterEach(() => {
  metrics.disable();
});

describe('metricsUrl (P2#1 — OTLP/HTTP signal path)', () => {
  it('appends /v1/metrics to a base endpoint', () => {
    expect(metricsUrl('http://collector:4318')).toBe('http://collector:4318/v1/metrics');
  });
  it('strips a trailing slash before appending', () => {
    expect(metricsUrl('http://collector:4318/')).toBe('http://collector:4318/v1/metrics');
    expect(metricsUrl('http://collector:4318///')).toBe('http://collector:4318/v1/metrics');
  });
  it('preserves a base path', () => {
    expect(metricsUrl('http://collector:4318/otlp')).toBe('http://collector:4318/otlp/v1/metrics');
  });
});

describe('resolveServiceName (P2#2 — per-app fallback, env override)', () => {
  it('returns the fallback when OTEL_SERVICE_NAME is unset', () => {
    expect(resolveServiceName({}, 'govai-audit-sealer')).toBe('govai-audit-sealer');
    expect(resolveServiceName({ OTEL_SERVICE_NAME: undefined }, 'govai-api')).toBe('govai-api');
  });
  it('returns an explicit OTEL_SERVICE_NAME override', () => {
    expect(resolveServiceName({ OTEL_SERVICE_NAME: 'override' }, 'govai-api')).toBe('override');
  });
});

describe('startTelemetry (shared OTel MeterProvider bootstrap)', () => {
  it('A — disabled (no endpoint): registers NO global provider; shutdown resolves', async () => {
    const before = metrics.getMeterProvider();
    const handle = startTelemetry(
      { OTEL_EXPORTER_OTLP_ENDPOINT: undefined },
      { serviceName: 'govai-api' },
    );
    expect(handle.enabled).toBe(false);
    expect(metrics.getMeterProvider()).toBe(before);
    expect(metrics.getMeterProvider().constructor.name).not.toBe('MeterProvider');
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('B — enabled (endpoint set): registers a global MeterProvider; shutdown resolves', async () => {
    const handle = startTelemetry(
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' },
      { serviceName: 'govai-audit-sealer' },
    );
    expect(handle.enabled).toBe(true);
    expect(metrics.getMeterProvider().constructor.name).toBe('MeterProvider'); // not NoopMeterProvider
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('D — an enabled handle shutdown() flushes/stops without throwing', async () => {
    const handle = startTelemetry(
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' },
      { serviceName: 'svc' },
    );
    expect(handle.enabled).toBe(true);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
