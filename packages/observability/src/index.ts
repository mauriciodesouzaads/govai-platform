// Shared OTel MeterProvider / OTLP-HTTP metrics bootstrap (@govai/observability,
// EP-OBS-REFACTOR). One module used by both apps/api and apps/audit-sealer (it
// supersedes the two local telemetry.ts copies). It exports the surgical
// startTelemetry plus two pure, unit-tested helpers (metricsUrl, resolveServiceName)
// that fix the two PR #110 review findings:
//   - metricsUrl: a programmatic OTLP/HTTP exporter URL must carry the /v1/metrics
//     signal path (a bare base endpoint POSTs to "/"; the signal path is only
//     appended for an env-resolved endpoint, not a passed `url`).
//   - resolveServiceName: each app supplies its own service.name fallback; an
//     explicit OTEL_SERVICE_NAME env still overrides (config no longer defaults it).
//
// Gated on OTEL_EXPORTER_OTLP_ENDPOINT: unset => register NO provider, return a
// no-op handle (the app boots byte-identical to today; metrics stay no-op). Metrics
// ONLY (no tracing, no NodeSDK). Observe-only: a telemetry misconfig logs a warning
// and degrades to no-export — it NEVER throws into the caller's boot path. Must run
// before any meter is created (the metrics factories cache instruments at
// getMeter()-time).

import { metrics } from '@opentelemetry/api';
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

/** Structural logger — satisfied by Fastify `app.log` and the sealer's pino logger. */
export interface TelemetryLogger {
  warn(obj: unknown, msg: string): void;
}

export interface StartTelemetryOptions {
  /** The app's own service.name fallback when OTEL_SERVICE_NAME is unset. */
  serviceName: string;
  logger?: TelemetryLogger;
}

const NOOP_HANDLE: TelemetryHandle = { enabled: false, shutdown: async () => {} };

/**
 * Build the full OTLP/HTTP metrics URL from a base endpoint: strip trailing
 * slashes and append the `/v1/metrics` signal path. A programmatic exporter `url`
 * is used as-is, so the signal path must be explicit (the P2#1 fix).
 */
export function metricsUrl(base: string): string {
  return base.replace(/\/+$/, '') + '/v1/metrics';
}

/** The explicit OTEL_SERVICE_NAME if set, else the app's own fallback (the P2#2 fix). */
export function resolveServiceName(env: TelemetryEnv, fallback: string): string {
  return env.OTEL_SERVICE_NAME ?? fallback;
}

/**
 * Register a global OTel MeterProvider with an OTLP/HTTP periodic reader, gated on
 * `OTEL_EXPORTER_OTLP_ENDPOINT`. Returns a handle whose `shutdown()` flushes + stops
 * the reader. Falsy endpoint → register nothing, return the no-op handle (today's
 * behavior). Never throws: a construction failure logs and degrades to no-export.
 */
export function startTelemetry(env: TelemetryEnv, opts: StartTelemetryOptions): TelemetryHandle {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return NOOP_HANDLE; // disabled by default (no collector in dev/test) — no provider.
  }
  try {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: resolveServiceName(env, opts.serviceName),
    });
    const exporter = new OTLPMetricExporter({ url: metricsUrl(endpoint) });
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
    if (opts.logger) opts.logger.warn(detail, msg);
    else console.warn(msg, detail);
    return NOOP_HANDLE;
  }
}
