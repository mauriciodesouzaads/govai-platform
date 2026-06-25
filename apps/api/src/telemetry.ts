// OTel MeterProvider / OTLP-HTTP metrics bootstrap for apps/api (EP-008B-FOLLOWUP).
//
// Gated on OTEL_EXPORTER_OTLP_ENDPOINT: when set, register a global MeterProvider
// with a periodic OTLP/HTTP reader so the EP-008B EC-3b counters
// (govai_audit_bridge_drops_total / _captures_total) actually export. When unset,
// register NO provider and return a no-op handle — the server boots byte-identical
// to today (metrics.getMeter() stays the NoopMeterProvider; counters stay no-op).
//
// Metrics ONLY (no tracing, no NodeSDK). Observe-only: a telemetry misconfig logs a
// warning and degrades to no-export — it NEVER throws into buildServer or perturbs
// the request path. Must run BEFORE the metrics factory (route registration), since
// EP-008B caches its Counter at getMeter()-time and a meter obtained under the noop
// provider never upgrades (see server.ts placement + the spec §2 ordering invariant).

import { metrics } from '@opentelemetry/api';
import type { FastifyBaseLogger } from 'fastify';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export type TelemetryHandle = {
  /** true iff a global MeterProvider was registered (endpoint set + construction ok). */
  readonly enabled: boolean;
  /** Flush + stop the periodic reader. Resolves (and is safe) for the no-op handle too. */
  shutdown(): Promise<void>;
};

/** The only env this needs; structurally satisfied by `GovAIEnv`. */
export interface TelemetryEnv {
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_SERVICE_NAME?: string;
}

const NOOP_HANDLE: TelemetryHandle = { enabled: false, shutdown: async () => {} };

/**
 * Register a global OTel MeterProvider with an OTLP/HTTP periodic reader, gated on
 * `OTEL_EXPORTER_OTLP_ENDPOINT`. Returns a handle whose `shutdown()` flushes + stops
 * the reader. With the endpoint falsy → register nothing, return the no-op handle
 * (today's behavior). Never throws: a construction failure logs and degrades to
 * no-export, so a bad endpoint is never a boot failure.
 */
export function startTelemetry(
  env: TelemetryEnv,
  logger?: Pick<FastifyBaseLogger, 'warn'>,
): TelemetryHandle {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return NOOP_HANDLE; // disabled by default (no collector in dev/test) — no provider.
  }
  try {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? 'govai-api',
    });
    const exporter = new OTLPMetricExporter({ url: endpoint });
    const reader = new PeriodicExportingMetricReader({ exporter });
    const provider = new MeterProvider({ resource, readers: [reader] });
    metrics.setGlobalMeterProvider(provider);
    return {
      enabled: true,
      shutdown: () => provider.shutdown(),
    };
  } catch (err) {
    // Observe-only: degrade to no-export, never a boot failure. The global provider
    // is left unregistered (counters stay no-op).
    const detail = { err: err instanceof Error ? err.message : String(err) };
    const msg = 'telemetry: OTel MeterProvider bootstrap failed; metrics export disabled';
    if (logger) logger.warn(detail, msg);
    else console.warn(msg, detail);
    return NOOP_HANDLE;
  }
}
