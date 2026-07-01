// Evidence-completeness OTel gauges (EP-008D-1 / §3.2). The §R4 two-namespace
// decision: keep govai_audit_bridge_* for the shipped EP-008B counters (no
// rename) and ADD a govai_evidence_* namespace for the derived gauges. Mirrors
// audit-bridge-metrics.ts: frozen names (a contract), a cardinality-safe label
// allow-list (org_id → org_hash, never raw; chain_category bounded), observe-
// only (every collection swallows). The gauges inherit the EP-008B-FOLLOWUP
// global MeterProvider (a no-op until OTEL_EXPORTER_OTLP_ENDPOINT is set).
//
// 008D-1 ships only the gauge DEFINITIONS + the registration plumbing. The
// cross-org EMISSION source (a per-org-accumulation loop over the authorized
// orgs) is 008D-2's operator surface — so 008D-1 carries NO multi-org
// iteration. EC-5's gauge (govai_evidence_streams_without_terminal_marker) is
// intentionally ABSENT: EC-5 is deferred (no queryable source); the path-B
// stream-loss signal is the existing govai_audit_bridge_drops_total (EC-3.drop).

import { createHash } from 'node:crypto';

import {
  metrics,
  type BatchObservableResult,
  type ObservableGauge,
} from '@opentelemetry/api';

import type { EvidenceSummary } from './evidence-reports.js';

/** The EXACT gauge names (govai_<area>_<thing> convention). EC-5 gauge absent. */
export const EVIDENCE_METRIC_NAMES = Object.freeze({
  capturesPastSlo: 'govai_evidence_captures_past_slo', // EC-1
  chainGapTotal: 'govai_evidence_chain_gap_total', // EC-2
  nativeCapturesUnsealed: 'govai_evidence_native_captures_unsealed', // EC-3.seal
  nativeDropEstimate: 'govai_evidence_native_drop_estimate', // EC-3.drop
  runsWithoutTerminalEvent: 'govai_evidence_runs_without_terminal_event', // EC-4
  chainVerificationOk: 'govai_evidence_chain_verification_ok', // EC-6
  chainLastVerifiedTimestamp: 'govai_evidence_chain_last_verified_timestamp', // EC-6
  coverageRatio: 'govai_evidence_coverage_ratio', // headline
} as const);

export type EvidenceMetricKey = keyof typeof EVIDENCE_METRIC_NAMES;

/** org_id → a short SHA-256 prefix; never emitted raw (mirrors the EP-008B orgHash). */
function orgHash(orgId: string): string {
  return createHash('sha256').update(orgId).digest('hex').slice(0, 16);
}

const ALLOWED_LABEL_KEYS = Object.freeze(['org_hash', 'chain_category'] as const);

export interface EvidenceRawLabels {
  org_id?: string;
  chain_category?: string;
}

/**
 * Project raw labels into a cardinality-safe attribute set: org_id → org_hash,
 * the bounded chain_category passes through, everything else is dropped by
 * construction (no path in). Mirrors audit-bridge-metrics safeLabels().
 */
export function safeEvidenceLabels(raw: EvidenceRawLabels): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw.org_id !== undefined) out['org_hash'] = orgHash(raw.org_id);
  if (raw.chain_category !== undefined) out['chain_category'] = raw.chain_category;
  return out;
}

/** True iff every key is in the cardinality-safe allow-list. */
export function areEvidenceLabelsSafe(attrs: Record<string, unknown>): boolean {
  return Object.keys(attrs).every((k) => (ALLOWED_LABEL_KEYS as readonly string[]).includes(k));
}

export interface EvidenceGaugePoint {
  metric: EvidenceMetricKey;
  value: number;
  labels?: EvidenceRawLabels;
}

/**
 * The source of gauge points. In the operator surface (008D-2) this iterates
 * the authorized orgs via per-org accumulation and yields per-org_hash points;
 * a global meter callback cannot itself be RLS-scoped, so the points are
 * produced by the same single-org reads the cockpit uses.
 */
export type EvidenceGaugeSource = () => Promise<EvidenceGaugePoint[]> | EvidenceGaugePoint[];

export interface EvidenceGaugesHandle {
  unregister(): void;
}

/**
 * Register the govai_evidence_* observable gauges against a (deferred) source.
 * One batch callback feeds every gauge from a single source() call; the callback
 * is observe-only (swallows) so a slow/failing source never perturbs collection.
 * NOT wired in 008D-1 (no source yet) — 008D-2 provides the per-org source.
 */
export function registerEvidenceGauges(
  source: EvidenceGaugeSource,
  meterName = 'govai.evidence',
): EvidenceGaugesHandle {
  const meter = metrics.getMeter(meterName);
  const gauges = {} as Record<EvidenceMetricKey, ObservableGauge>;
  for (const key of Object.keys(EVIDENCE_METRIC_NAMES) as EvidenceMetricKey[]) {
    gauges[key] = meter.createObservableGauge(EVIDENCE_METRIC_NAMES[key]);
  }
  const observables = Object.values(gauges);

  const callback = async (result: BatchObservableResult): Promise<void> => {
    try {
      const points = await source();
      for (const p of points) {
        const gauge = gauges[p.metric];
        if (gauge && Number.isFinite(p.value)) {
          result.observe(gauge, p.value, safeEvidenceLabels(p.labels ?? {}));
        }
      }
    } catch {
      /* swallow — observe-only must never throw during collection */
    }
  };

  meter.addBatchObservableCallback(callback, observables);
  return {
    unregister: () => meter.removeBatchObservableCallback(callback, observables),
  };
}

/**
 * Map a per-org evidence summary to gauge points (the bridge reports→metrics).
 * The 008D-2 source loop calls this once per authorized org. The EC-6
 * last-verified timestamp is omitted while no verification is persisted (null).
 */
export function summaryToGaugePoints(orgId: string, summary: EvidenceSummary): EvidenceGaugePoint[] {
  const labels: EvidenceRawLabels = { org_id: orgId };
  const points: EvidenceGaugePoint[] = [
    { metric: 'capturesPastSlo', value: summary.counts.ec1.stalled_past_slo, labels },
    { metric: 'chainGapTotal', value: summary.counts.ec2.chains_with_gap, labels },
    { metric: 'nativeCapturesUnsealed', value: summary.counts.ec3seal.native_unsealed_past_slo, labels },
    { metric: 'runsWithoutTerminalEvent', value: summary.counts.ec4.without_terminal, labels },
    { metric: 'chainVerificationOk', value: summary.ec6.verified_ok, labels },
    { metric: 'coverageRatio', value: summary.coverage_ratio.ratio, labels },
  ];
  if (summary.ec3drop.observed && summary.ec3drop.drop_rate !== null) {
    points.push({ metric: 'nativeDropEstimate', value: summary.ec3drop.drop_rate, labels });
  }
  return points;
}
