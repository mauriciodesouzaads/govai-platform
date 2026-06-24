// OTel metrics for the AuditBridge dispatcher (EP-008B / EC-3b). Mirrors the
// AuditSealer ADR-025 pattern (apps/audit-sealer/src/metrics.ts): the EXACT
// metric names are pinned in AUDIT_BRIDGE_METRIC_NAMES (a contract); labels are
// cardinality-safe via safeLabels() + an ALLOWED_LABEL_KEYS allow-list
// (org_id → org_hash, never raw; no run/capture/request id, no payload, and NOT
// the free-form capability_id — the bounded capability_level enum instead).
// The dispatcher depends on the AuditBridgeMetrics INTERFACE so it can be unit-
// tested with a recording double; the OTel-backed impl is the injectable default.
//
// There is NO OTel MeterProvider in apps/api today (server.ts wires none), so
// metrics.getMeter() returns a no-op meter and the counters are correct-but-
// unexported until a provider is bootstrapped — the NAMED follow-up EP-008B-
// FOLLOWUP. EP-008B installs the instrumentation only.

import { createHash } from 'node:crypto';

import { metrics, type Counter } from '@opentelemetry/api';

/** The EXACT metric names (ADR-025 convention govai_<area>_<thing>_total). */
export const AUDIT_BRIDGE_METRIC_NAMES = Object.freeze({
  drops: 'govai_audit_bridge_drops_total',
  captures: 'govai_audit_bridge_captures_total',
} as const);

/**
 * org_id → a short SHA-256 prefix; never emitted raw (mirrors the sealer's
 * labels.ts `orgHash`). Re-implemented locally rather than imported across the
 * apps/api ↔ apps/audit-sealer boundary (monorepo apps do not depend on apps).
 */
function orgHash(orgId: string): string {
  return createHash('sha256').update(orgId).digest('hex').slice(0, 16);
}

/**
 * Raw label inputs. ONLY the cardinality-safe keys are ever emitted: `reason`
 * (≤ 5 values), `provider` (z.enum 2), `capability_level` (z.enum 3, REQUIRED —
 * the schema-bounded capability dimension) and `org_hash` (= orgHash(org_id)).
 * The free-form `capability_id` (z.string().min(1)) and every raw id are accepted
 * here so callers/tests may pass them, but are DROPPED by construction in
 * safeLabels() — there is no path by which they become a label (the C1 guard).
 */
export interface AuditBridgeRawLabels {
  reason?: string;
  provider?: string;
  capability_level?: string;
  org_id?: string;
  // Accepted-and-dropped (NEVER projected to a label):
  capability_id?: string;
  govai_request_id?: string;
  capture_id?: string;
  run_id?: string;
  provider_request_id?: string;
}

const ALLOWED_LABEL_KEYS = Object.freeze([
  'reason',
  'provider',
  'capability_level',
  'org_hash',
] as const);

/**
 * Project raw labels into a cardinality-safe attribute set: org_id → org_hash,
 * the bounded dimensions (reason, provider, capability_level) pass through, and
 * EVERYTHING else (the free-form capability_id, run/capture/request ids,
 * provider_request_id, payload) is dropped by construction — there is no path in.
 */
export function safeLabels(raw: AuditBridgeRawLabels): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw.reason !== undefined) out['reason'] = raw.reason;
  if (raw.provider !== undefined) out['provider'] = raw.provider;
  if (raw.capability_level !== undefined) out['capability_level'] = raw.capability_level;
  if (raw.org_id !== undefined) out['org_hash'] = orgHash(raw.org_id);
  return out;
}

/** True iff every key is in the cardinality-safe allow-list. */
export function areLabelsSafe(attrs: Record<string, unknown>): boolean {
  return Object.keys(attrs).every((k) => (ALLOWED_LABEL_KEYS as readonly string[]).includes(k));
}

export interface AuditBridgeMetrics {
  /** EC-3b: one best-effort drop at an active drop exit point (S1–S5). */
  dropTotal(labels: AuditBridgeRawLabels): void;
  /** The post-COMMIT success denominator (Step 7b) for the drop rate. */
  captureTotal(labels: AuditBridgeRawLabels): void;
}

/**
 * OTel-backed metrics with the exact names — the injectable default. Each
 * `.add()` is wrapped in a one-line swallow (P3): OTel `.add()` is already
 * contractually non-throwing and a no-op with no provider, so this is
 * belt-and-suspenders insurance that observe-only NEVER perturbs the
 * evidence-capture request path.
 */
export function createOtelAuditBridgeMetrics(meterName = 'govai.audit_bridge'): AuditBridgeMetrics {
  const meter = metrics.getMeter(meterName);
  const drops: Counter = meter.createCounter(AUDIT_BRIDGE_METRIC_NAMES.drops);
  const captures: Counter = meter.createCounter(AUDIT_BRIDGE_METRIC_NAMES.captures);
  return {
    dropTotal: (l) => {
      try {
        drops.add(1, safeLabels(l));
      } catch {
        /* swallow — observe-only must never affect the request path */
      }
    },
    captureTotal: (l) => {
      try {
        captures.add(1, safeLabels(l));
      } catch {
        /* swallow — observe-only must never affect the request path */
      }
    },
  };
}

export interface RecordedMetric {
  name: string;
  value: number;
  labels: Record<string, string>;
}

/** Recording metrics double for tests. */
export function createRecordingAuditBridgeMetrics(): AuditBridgeMetrics & {
  records: RecordedMetric[];
} {
  const records: RecordedMetric[] = [];
  return {
    records,
    dropTotal: (l) =>
      records.push({ name: AUDIT_BRIDGE_METRIC_NAMES.drops, value: 1, labels: safeLabels(l) }),
    captureTotal: (l) =>
      records.push({ name: AUDIT_BRIDGE_METRIC_NAMES.captures, value: 1, labels: safeLabels(l) }),
  };
}
