// OTel MeterProvider / OTLP-HTTP metrics bootstrap for apps/audit-sealer
// (EP-008B-FOLLOWUP-SEALER). Mirrors the apps/api telemetry bootstrap (#109).
//
// Gated on OTEL_EXPORTER_OTLP_ENDPOINT: when set, register a global MeterProvider
// with a periodic OTLP/HTTP reader so the sealer's ADR-025 counters/histograms
// (apps/audit-sealer/src/metrics.ts) actually export. When unset, register NO
// provider and return a no-op handle — the sealer runs byte-identical to today
// (metrics.getMeter() stays the NoopMeterProvider; the instruments stay no-op).
//
// Metrics ONLY (no tracing, no NodeSDK). Observe-only: a telemetry misconfig logs
// a warning and degrades to no-export — it NEVER throws into main() or perturbs the
// claim loop / seal path. Must run BEFORE createRunner() (which builds the default
// createOtelSealerMetrics() and caches its instruments at getMeter()-time).
//
// NB (EP-OBS-REFACTOR, tracked): this is a deliberate contained duplicate of
// apps/api/src/telemetry.ts; the two differ only in the service.name default and
// the logger type. A shared @govai/observability startTelemetry is the named DRY
// follow-up once both consumers are stable.

import { metrics } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

import type { SealerLogger } from './logging.js';

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
  logger?: Pick<SealerLogger, 'warn'>,
): TelemetryHandle {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return NOOP_HANDLE; // disabled by default (no collector in dev/test) — no provider.
  }
  try {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? 'govai-audit-sealer',
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
    // is left unregistered (instruments stay no-op).
    const detail = { err: err instanceof Error ? err.message : String(err) };
    const msg = 'telemetry: OTel MeterProvider bootstrap failed; metrics export disabled';
    if (logger) logger.warn(detail, msg);
    else console.warn(msg, detail);
    return NOOP_HANDLE;
  }
}
