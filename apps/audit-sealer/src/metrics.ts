// OTel metrics for the AuditSealer runner (SPEC-B3 §5 / ADR-025). The EXACT
// metric names are pinned in SEALER_METRIC_NAMES; labels are cardinality-safe
// (org_id hashed, no raw capture/run/request ids, no payload). The loop/seal/
// recovery code depends on the `SealerMetrics` INTERFACE so it can be unit-tested
// with a recording double; the OTel-backed impl is wired in `runner.ts`.

import { metrics, type Counter, type Histogram } from '@opentelemetry/api';
import { orgHash } from './labels.js';

/** The EXACT metric names (ADR-025). Changing one is a contract change. */
export const SEALER_METRIC_NAMES = Object.freeze({
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
} as const);

/** Raw label inputs; only these cardinality-safe keys are ever emitted. */
export interface SealerLabels {
  orgId?: string;
  tenantTier?: string;
  operationalMode?: string;
  result?: string;
  reason?: string;
}

const ALLOWED_LABEL_KEYS = Object.freeze([
  'org_hash',
  'tenant_tier',
  'operational_mode',
  'result',
  'reason',
] as const);

/**
 * Project raw labels into a cardinality-safe attribute set: org_id → a short
 * SHA-256 prefix (`org_hash`), the low-cardinality dimensions pass through, and
 * EVERYTHING else (raw run_id/capture_id/provider_request_id/prompt/response/
 * email/secrets) is dropped by construction — there is no path for them in.
 */
export function safeLabels(raw: SealerLabels): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw.orgId !== undefined) {
    out['org_hash'] = orgHash(raw.orgId);
  }
  if (raw.tenantTier !== undefined) out['tenant_tier'] = raw.tenantTier;
  if (raw.operationalMode !== undefined) out['operational_mode'] = raw.operationalMode;
  if (raw.result !== undefined) out['result'] = raw.result;
  if (raw.reason !== undefined) out['reason'] = raw.reason;
  return out;
}

/** True iff every key is in the cardinality-safe allow-list. */
export function areLabelsSafe(attrs: Record<string, unknown>): boolean {
  return Object.keys(attrs).every((k) => (ALLOWED_LABEL_KEYS as readonly string[]).includes(k));
}

export interface SealerMetrics {
  claimTotal(labels?: SealerLabels): void;
  sealedTotal(labels?: SealerLabels): void;
  failedTotal(labels?: SealerLabels): void;
  retryTotal(labels?: SealerLabels): void;
  terminalFailureTotal(labels?: SealerLabels): void;
  claimLatencyMs(ms: number, labels?: SealerLabels): void;
  sealLatencyMs(ms: number, labels?: SealerLabels): void;
  backlogDepth(depth: number, labels?: SealerLabels): void;
  oldestPendingAgeSeconds(seconds: number, labels?: SealerLabels): void;
  staleCount(count: number, labels?: SealerLabels): void;
}

/** OTel-backed metrics with the exact names. Used in production. */
export function createOtelSealerMetrics(meterName = 'govai.audit_sealer'): SealerMetrics {
  const meter = metrics.getMeter(meterName);
  const claim: Counter = meter.createCounter(SEALER_METRIC_NAMES.claimTotal);
  const sealed: Counter = meter.createCounter(SEALER_METRIC_NAMES.sealedTotal);
  const failed: Counter = meter.createCounter(SEALER_METRIC_NAMES.failedTotal);
  const retry: Counter = meter.createCounter(SEALER_METRIC_NAMES.retryTotal);
  const terminal: Counter = meter.createCounter(SEALER_METRIC_NAMES.terminalFailureTotal);
  const claimLat: Histogram = meter.createHistogram(SEALER_METRIC_NAMES.claimLatencyMs);
  const sealLat: Histogram = meter.createHistogram(SEALER_METRIC_NAMES.sealLatencyMs);
  // Gauges are recorded as histogram observations so a 1.x-API meter without the
  // synchronous-gauge surface still carries the value; the name is what ADR-025 pins.
  const backlog: Histogram = meter.createHistogram(SEALER_METRIC_NAMES.backlogDepth);
  const oldest: Histogram = meter.createHistogram(SEALER_METRIC_NAMES.oldestPendingAgeSeconds);
  const stale: Histogram = meter.createHistogram(SEALER_METRIC_NAMES.staleCount);
  return {
    claimTotal: (l) => claim.add(1, safeLabels(l ?? {})),
    sealedTotal: (l) => sealed.add(1, safeLabels(l ?? {})),
    failedTotal: (l) => failed.add(1, safeLabels(l ?? {})),
    retryTotal: (l) => retry.add(1, safeLabels(l ?? {})),
    terminalFailureTotal: (l) => terminal.add(1, safeLabels(l ?? {})),
    claimLatencyMs: (ms, l) => claimLat.record(ms, safeLabels(l ?? {})),
    sealLatencyMs: (ms, l) => sealLat.record(ms, safeLabels(l ?? {})),
    backlogDepth: (d, l) => backlog.record(d, safeLabels(l ?? {})),
    oldestPendingAgeSeconds: (s, l) => oldest.record(s, safeLabels(l ?? {})),
    staleCount: (c, l) => stale.record(c, safeLabels(l ?? {})),
  };
}

export interface RecordedMetric {
  name: string;
  value: number;
  labels: Record<string, string>;
}

/** Recording metrics double for tests (and a safe no-exporter default). */
export function createRecordingSealerMetrics(): SealerMetrics & { records: RecordedMetric[] } {
  const records: RecordedMetric[] = [];
  const rec = (name: string, value: number, l?: SealerLabels) =>
    records.push({ name, value, labels: safeLabels(l ?? {}) });
  return {
    records,
    claimTotal: (l) => rec(SEALER_METRIC_NAMES.claimTotal, 1, l),
    sealedTotal: (l) => rec(SEALER_METRIC_NAMES.sealedTotal, 1, l),
    failedTotal: (l) => rec(SEALER_METRIC_NAMES.failedTotal, 1, l),
    retryTotal: (l) => rec(SEALER_METRIC_NAMES.retryTotal, 1, l),
    terminalFailureTotal: (l) => rec(SEALER_METRIC_NAMES.terminalFailureTotal, 1, l),
    claimLatencyMs: (ms, l) => rec(SEALER_METRIC_NAMES.claimLatencyMs, ms, l),
    sealLatencyMs: (ms, l) => rec(SEALER_METRIC_NAMES.sealLatencyMs, ms, l),
    backlogDepth: (d, l) => rec(SEALER_METRIC_NAMES.backlogDepth, d, l),
    oldestPendingAgeSeconds: (s, l) => rec(SEALER_METRIC_NAMES.oldestPendingAgeSeconds, s, l),
    staleCount: (c, l) => rec(SEALER_METRIC_NAMES.staleCount, c, l),
  };
}
