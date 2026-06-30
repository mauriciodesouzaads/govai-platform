// Evidence-completeness reports (EP-008D-1). Read-only, RLS-scoped query
// builders over the EXISTING evidence plane — the EP-008A views (migration
// 0027), the 0025 capture outbox/chain-state, 0002 provider_invocations, and
// 0001 audit_events. Every query runs under the caller's `app.org_id` (the same
// per-org RLS path /v1/audit-events uses); the operator cockpit (008D-2) reuses
// these same builders once per authorized org (per-org accumulation). NO write,
// NO new DB object, NO payload/PII column is ever selected (safe-field
// discipline — §3.1 / §5).
//
// The canonical EC mapping (spec §2) is NORMATIVE and baked into the labels
// below. In particular the view `govai.evidence_provider_without_audit` (labeled
// "EC-3a" in 0027) is surfaced under EC-4 (path-A run-lifecycle), NEVER under
// EC-3 — a report that puts it under EC-3 is a defect (the §6 label test pins
// this).
//
// EC-5 (stream-terminal) is DEFERRED at this base (192161dd): the capture's
// is_stream and stream_outcome are baked into the hashed projection (not
// queryable) and the outbox has no stream column — see the EC-5 reconcile
// (defer-entirely). No EC-5 report/enum/gauge/test ships here; the path-B
// stream-loss signal is carried in AGGREGATE by EC-3.drop (bounded — see
// nativeDropEstimate).

import type { PoolClient } from 'pg';

/** The canonical EC labels (spec §2 — normative). */
export const EC_LABELS = Object.freeze({
  ec1: 'EC-1 — terminal-state',
  ec2: 'EC-2 — seal coverage',
  ec3seal: 'EC-3 — native (seal)',
  ec3drop: 'EC-3 — native (drop)',
  ec4: 'EC-4 — run-lifecycle / path-A',
  ec6: 'EC-6 — chain integrity',
  coverage: 'coverage_ratio',
} as const);

/**
 * Native (path-B) captures carry chain_category='run' — hardcoded by the
 * AuditBridge dispatcher (apps/api/src/pipeline/audit-bridge.ts: chainCategory:
 * 'run', and AuditBridgeCapturePayloadV1 chain_category: z.literal('run')).
 * EC-3.seal filters the capture-completeness view to these native categories.
 */
export const NATIVE_CHAIN_CATEGORIES = Object.freeze(['run'] as const);

const DEFAULT_SAMPLE_LIMIT = 100;

export interface ReportScope {
  /** Bound row scans to rows at/after now() - windowSeconds. */
  windowSeconds: number;
  /** Seconds a capture may stay unsealed before it is "past SLO" (EC-1/EC-3.seal). */
  tSealSeconds: number;
  /** Max rows in any bounded sample / gap list. */
  sampleLimit?: number;
  /** Pagination offset for the gap lists (read-API /gaps). */
  offset?: number;
}

function sampleLimitOf(scope: ReportScope): number {
  return Math.min(scope.sampleLimit ?? DEFAULT_SAMPLE_LIMIT, 500);
}

// ===========================================================================
// Per-invariant COUNTS — the lightweight aggregates for /v1/evidence/summary,
// the gauges, and coverage_ratio. One pass per invariant, no payload.
// ===========================================================================

export interface EvidenceCounts {
  ec1: { total: number; sealed: number; failed: number; stalled_past_slo: number };
  ec2: { chains: number; chains_with_gap: number };
  ec3seal: { native_total: number; native_sealed: number; native_unsealed_past_slo: number };
  ec4: { provider_invocations: number; without_terminal: number };
  ec6: { chains: number; verified_ok: number; pending: number };
}

export async function evidenceCounts(client: PoolClient, scope: ReportScope): Promise<EvidenceCounts> {
  const tSeal = scope.tSealSeconds;
  const w = scope.windowSeconds;

  // EC-1 — capture terminal-state, per-row from the base outbox and WINDOWED on
  // captured_at (>= now() - W) so every /summary term shares the report window
  // (INVARIANT 1). stalled_past_slo additionally requires the row's OWN
  // captured_at to exceed T_seal (still captured/sealing) — counted per row, not
  // gated by the view's aggregate oldest_* MIN (1 old + N fresh → 1, not 1+N).
  const ec1 = await client.query<{
    total: string;
    sealed: string;
    failed: string;
    stalled_past_slo: string;
  }>(
    `SELECT
        count(*)::bigint                                    AS total,
        count(*) FILTER (WHERE status = 'sealed')::bigint   AS sealed,
        count(*) FILTER (WHERE status = 'failed')::bigint   AS failed,
        count(*) FILTER (
          WHERE status IN ('captured','sealing')
            AND captured_at <= now() - make_interval(secs => $2)
        )::bigint                                           AS stalled_past_slo
       FROM govai.audit_capture_outbox
      WHERE captured_at >= now() - make_interval(secs => $1)`,
    [w, tSeal],
  );

  // EC-2 — capture_seq contiguity judged WITHIN the in-window slice: a chain is
  // gapped iff its in-window row count <> (maxseq - minseq + 1). Shares the
  // window (INVARIANT 1) and AGREES with ec2Gaps() (INVARIANT 2): a long
  // contiguous chain with only its tail in-window is NOT gapped (minseq..maxseq
  // over in-window rows, not an absolute 1-origin).
  const ec2 = await client.query<{ chains: string; chains_with_gap: string }>(
    `WITH chain_stats AS (
        SELECT chain_id,
               count(*)         AS cnt,
               min(capture_seq) AS minseq,
               max(capture_seq) AS maxseq
          FROM govai.audit_capture_outbox
         WHERE captured_at >= now() - make_interval(secs => $1)
         GROUP BY chain_id
      )
      SELECT count(*)::bigint                                              AS chains,
             count(*) FILTER (WHERE cnt <> (maxseq - minseq + 1))::bigint  AS chains_with_gap
        FROM chain_stats`,
    [w],
  );

  // EC-3.seal — native (path-B, chain_category='run') captures not yet sealed,
  // per-row from the base outbox and WINDOWED on captured_at (INVARIANT 1); the
  // unsealed-past-SLO sub-count adds the per-row captured_at <= now() - T_seal.
  const ec3seal = await client.query<{
    native_total: string;
    native_sealed: string;
    native_unsealed_past_slo: string;
  }>(
    `SELECT
        count(*)::bigint                                    AS native_total,
        count(*) FILTER (WHERE status = 'sealed')::bigint   AS native_sealed,
        count(*) FILTER (
          WHERE status IN ('captured','sealing')
            AND captured_at <= now() - make_interval(secs => $2)
        )::bigint                                           AS native_unsealed_past_slo
       FROM govai.audit_capture_outbox
      WHERE captured_at >= now() - make_interval(secs => $1)
        AND chain_category = ANY($3::text[])`,
    [w, tSeal, [...NATIVE_CHAIN_CATEGORIES]],
  );

  // EC-4 — path-A provider invocations without a terminal run.* audit event.
  // The view is the umbrella's EC-4 detector (the 0027 "EC-3a" label is the
  // §2 relabel target — surfaced under EC-4 here, never EC-3).
  const ec4 = await client.query<{ provider_invocations: string; without_terminal: string }>(
    `SELECT
        (SELECT count(*) FROM govai.provider_invocations
          WHERE created_at >= now() - make_interval(secs => $1))::bigint AS provider_invocations,
        (SELECT count(*) FROM govai.evidence_provider_without_audit
          WHERE created_at >= now() - make_interval(secs => $1))::bigint AS without_terminal`,
    [w],
  );

  // EC-6 — chain-integrity status, SURFACE-ONLY. No persisted verification
  // status exists at 192161dd (verify.ts is on-demand, never persisted, and the
  // chain_state has no last_verified column), and EP-008D does not re-run the
  // KMS-keyed verification inline nor add a DB object. So every known chain is
  // surfaced as `pending` until a future verifier-persistence surface lands.
  const ec6 = await client.query<{ chains: string }>(
    `SELECT count(DISTINCT chain_id)::bigint AS chains
       FROM govai.audit_events
      WHERE occurred_at >= now() - make_interval(secs => $1)`,
    [w],
  );
  const ec6Chains = Number(ec6.rows[0]?.chains ?? 0);

  return {
    ec1: {
      total: Number(ec1.rows[0]?.total ?? 0),
      sealed: Number(ec1.rows[0]?.sealed ?? 0),
      failed: Number(ec1.rows[0]?.failed ?? 0),
      stalled_past_slo: Number(ec1.rows[0]?.stalled_past_slo ?? 0),
    },
    ec2: {
      chains: Number(ec2.rows[0]?.chains ?? 0),
      chains_with_gap: Number(ec2.rows[0]?.chains_with_gap ?? 0),
    },
    ec3seal: {
      native_total: Number(ec3seal.rows[0]?.native_total ?? 0),
      native_sealed: Number(ec3seal.rows[0]?.native_sealed ?? 0),
      native_unsealed_past_slo: Number(ec3seal.rows[0]?.native_unsealed_past_slo ?? 0),
    },
    ec4: {
      provider_invocations: Number(ec4.rows[0]?.provider_invocations ?? 0),
      without_terminal: Number(ec4.rows[0]?.without_terminal ?? 0),
    },
    ec6: { chains: ec6Chains, verified_ok: 0, pending: ec6Chains },
  };
}

// ===========================================================================
// Bounded gap lists — the /v1/evidence/gaps payloads. Safe fields only.
// ===========================================================================

export interface Ec1GapRow {
  capture_id: string;
  chain_id: string;
  chain_category: string;
  status: string;
  captured_at: string;
  attempts: number;
  last_error: string | null;
}

/**
 * EC-1 gap list — the SAME population /summary EC-1 counts as gaps: failed
 * captures AND captured/sealing rows past T_seal (stalled). Windowed on
 * captured_at to match the summary (INVARIANT 2 — summary↔list parity). Safe
 * fields only: `status` discriminates failed vs stalled; `last_error` is the
 * sanitized ≤200-char text (null for stalled) — never a payload.
 */
export async function ec1GapList(client: PoolClient, scope: ReportScope): Promise<Ec1GapRow[]> {
  const r = await client.query<{
    capture_id: string;
    chain_id: string;
    chain_category: string;
    status: string;
    captured_at: Date;
    attempts: number;
    last_error: string | null;
  }>(
    `SELECT capture_id::text, chain_id, chain_category, status, captured_at, attempts, last_error
       FROM govai.audit_capture_outbox
      WHERE captured_at >= now() - make_interval(secs => $1)
        AND (
          status = 'failed'
          OR (status IN ('captured','sealing') AND captured_at <= now() - make_interval(secs => $2))
        )
      ORDER BY captured_at DESC
      LIMIT $3 OFFSET $4`,
    [scope.windowSeconds, scope.tSealSeconds, sampleLimitOf(scope), scope.offset ?? 0],
  );
  return r.rows.map((row) => ({
    capture_id: row.capture_id,
    chain_id: row.chain_id,
    chain_category: row.chain_category,
    status: row.status,
    captured_at: row.captured_at.toISOString(),
    attempts: row.attempts,
    last_error: row.last_error,
  }));
}

export interface Ec2GapRow {
  chain_id: string;
  first_gap_seq: number;
  gap_count: number;
}

/**
 * EC-2 per-chain capture_seq contiguity gaps (chain_id, first_gap_seq,
 * gap_count). Derived from ADJACENT in-window rows via
 * lead(capture_seq) OVER (PARTITION BY chain_id ORDER BY capture_seq): a gap is
 * any place the next in-window seq jumps by > 1. Cost is O(in-window rows), NOT
 * O(span) — it never materializes the minseq..maxseq range, so a chain with a
 * huge gap (e.g. seq 1 then seq 1_000_000_000) is summarized in two-row time,
 * not billion-row time (the resource-exhaustion the prior generate_series had).
 * Same in-window basis as the EC-2 summary count, so it AGREES with it
 * (INVARIANT 2 — a chain is gapped here iff cnt <> maxseq-minseq+1 there) and
 * shares the window (INVARIANT 1); a tail-in-window slice of a long contiguous
 * chain is not falsely gapped. gap_count = total missing seqs (sum of each
 * jump's next_seq - capture_seq - 1), matching the prior count(*) semantics.
 */
export async function ec2Gaps(client: PoolClient, scope: ReportScope): Promise<Ec2GapRow[]> {
  const r = await client.query<{ chain_id: string; first_gap_seq: string; gap_count: string }>(
    `WITH adjacent AS (
        SELECT chain_id,
               capture_seq,
               lead(capture_seq) OVER (PARTITION BY chain_id ORDER BY capture_seq) AS next_seq
          FROM govai.audit_capture_outbox
         WHERE captured_at >= now() - make_interval(secs => $1)
      ),
      jumps AS (
        SELECT chain_id, capture_seq, next_seq
          FROM adjacent
         WHERE next_seq IS NOT NULL
           AND next_seq - capture_seq > 1
      )
      SELECT chain_id,
             (min(capture_seq) + 1)::bigint           AS first_gap_seq,
             sum(next_seq - capture_seq - 1)::bigint   AS gap_count
        FROM jumps
       GROUP BY chain_id
       ORDER BY chain_id
       LIMIT $2 OFFSET $3`,
    [scope.windowSeconds, sampleLimitOf(scope), scope.offset ?? 0],
  );
  return r.rows.map((row) => ({
    chain_id: row.chain_id,
    first_gap_seq: Number(row.first_gap_seq),
    gap_count: Number(row.gap_count),
  }));
}

export interface Ec3SealRow {
  capture_id: string;
  chain_id: string;
  chain_category: string;
  status: string;
  captured_at: string;
}

/**
 * EC-3.seal — the native captures ACTUALLY past T_seal, PER ROW from the base
 * outbox: WINDOWED on captured_at (matching the EC-3.seal count — INVARIANT 1/2)
 * and own captured_at past T_seal, still captured/sealing. NOT gated by the
 * view's aggregate oldest_*. Safe fields only (no payload).
 */
export async function ec3SealList(client: PoolClient, scope: ReportScope): Promise<Ec3SealRow[]> {
  const r = await client.query<{
    capture_id: string;
    chain_id: string;
    chain_category: string;
    status: string;
    captured_at: Date;
  }>(
    `SELECT capture_id::text, chain_id, chain_category, status, captured_at
       FROM govai.audit_capture_outbox
      WHERE chain_category = ANY($1::text[])
        AND captured_at >= now() - make_interval(secs => $2)
        AND status IN ('captured','sealing')
        AND captured_at <= now() - make_interval(secs => $3)
      ORDER BY captured_at ASC
      LIMIT $4 OFFSET $5`,
    [
      [...NATIVE_CHAIN_CATEGORIES],
      scope.windowSeconds,
      scope.tSealSeconds,
      sampleLimitOf(scope),
      scope.offset ?? 0,
    ],
  );
  return r.rows.map((row) => ({
    capture_id: row.capture_id,
    chain_id: row.chain_id,
    chain_category: row.chain_category,
    status: row.status,
    captured_at: row.captured_at.toISOString(),
  }));
}

export interface Ec4Row {
  run_id: string;
  provider_invocation_id: string;
  provider: string;
  native_endpoint: string;
  status_code: number | null;
  error_class: string | null;
  created_at: string;
}

/**
 * EC-4 — provider invocations WITHOUT a terminal run.* audit event (path-A
 * run-lifecycle gap; expected empty). Surfaced under EC-4, NEVER EC-3 (§2).
 */
export async function ec4List(client: PoolClient, scope: ReportScope): Promise<Ec4Row[]> {
  const r = await client.query<{
    run_id: string;
    provider_invocation_id: string;
    provider: string;
    native_endpoint: string;
    status_code: number | null;
    error_class: string | null;
    created_at: Date;
  }>(
    `SELECT run_id::text, provider_invocation_id::text, provider, native_endpoint,
            status_code, error_class, created_at
       FROM govai.evidence_provider_without_audit
      WHERE created_at >= now() - make_interval(secs => $1)
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [scope.windowSeconds, sampleLimitOf(scope), scope.offset ?? 0],
  );
  return r.rows.map((row) => ({
    run_id: row.run_id,
    provider_invocation_id: row.provider_invocation_id,
    provider: row.provider,
    native_endpoint: row.native_endpoint,
    status_code: row.status_code,
    error_class: row.error_class,
    created_at: row.created_at.toISOString(),
  }));
}

// ===========================================================================
// EC-3.drop — native capture-loss estimate (PATH-B PROXY).
// ===========================================================================

/**
 * The drop/capture snapshot the EC-3.drop estimate reads. The shipped EP-008B
 * counters (govai_audit_bridge_{drops,captures}_total) are write-only OTel
 * Counters; their authoritative aggregation/alerting is the OTLP collector
 * (§3.2 alerts are declared in collector config, not code). This injectable
 * snapshot lets the report compute a rate/count and lets the §6 test simulate
 * drops>0; a process-local accumulator can back it without touching the shipped
 * counters or the hot-path dispatcher seam.
 */
export interface DropMetricsSnapshot {
  drops: number;
  captures: number;
}

/** A zero snapshot — no in-process drop observations (collector is authoritative). */
export const ZERO_DROP_SNAPSHOT: DropMetricsSnapshot = Object.freeze({ drops: 0, captures: 0 });

export interface DropEstimate {
  invariant: 'ec3drop';
  label: string;
  drops: number;
  captures: number;
  /** drops / (drops + captures); null when nothing observed (the collector holds the truth). */
  drop_rate: number | null;
  observed: boolean;
  /**
   * The honest bounds the coverage_ratio narrative MUST carry (EC-5 reconcile
   * precisions i/ii): this is native capture loss IN AGGREGATE — it INCLUDES,
   * but does not ISOLATE, streams-without-terminal (drops_total has no
   * is_stream label), and it covers received-then-dropped captures, NOT a
   * stream that never emitted the PassthroughInvoked at all.
   */
  bound: string;
}

const EC3_DROP_BOUND =
  'native capture loss in aggregate — includes, does not isolate, streams-without-terminal; ' +
  'covers received-then-dropped, not never-emitted';

/** EC-3.drop — pure function over the injected snapshot (path-B loss proxy). */
export function nativeDropEstimate(snapshot: DropMetricsSnapshot = ZERO_DROP_SNAPSHOT): DropEstimate {
  const drops = Math.max(0, snapshot.drops);
  const captures = Math.max(0, snapshot.captures);
  const denom = drops + captures;
  return {
    invariant: 'ec3drop',
    label: EC_LABELS.ec3drop,
    drops,
    captures,
    drop_rate: denom > 0 ? drops / denom : null,
    observed: denom > 0,
    bound: EC3_DROP_BOUND,
  };
}

// ===========================================================================
// EC-6 — chain-verification status, SURFACE-ONLY (status-via-summary).
// ===========================================================================

export interface ChainVerificationStatus {
  invariant: 'ec6';
  label: string;
  total_chains: number;
  verified_ok: number;
  pending: number;
  last_verified_at: string | null;
  /** Why everything is pending at this base — surfaced honestly, not re-run. */
  note: string;
}

const EC6_NOTE =
  'no persisted chain-verification status at this build (192161dd): verify.ts runs on-demand ' +
  'and is not persisted, and EP-008D does not re-run the KMS-keyed verification inline nor add a ' +
  'DB object — chains are surfaced as pending until a verifier-persistence surface lands';

/**
 * EC-6 — surfaces chain-integrity status as a per-org SUMMARY (deliberately
 * omitted from the /gaps enum: it is status-via-summary, not a gap list). With
 * no persisted verification at this base, every known chain is `pending`.
 */
export async function chainVerificationStatus(
  client: PoolClient,
  scope: ReportScope,
): Promise<ChainVerificationStatus> {
  const r = await client.query<{ chains: string }>(
    `SELECT count(DISTINCT chain_id)::bigint AS chains
       FROM govai.audit_events
      WHERE occurred_at >= now() - make_interval(secs => $1)`,
    [scope.windowSeconds],
  );
  const total = Number(r.rows[0]?.chains ?? 0);
  return {
    invariant: 'ec6',
    label: EC_LABELS.ec6,
    total_chains: total,
    verified_ok: 0,
    pending: total,
    last_verified_at: null,
    note: EC6_NOTE,
  };
}

// ===========================================================================
// coverage_ratio — the headline conjunction (covered ÷ total).
// ===========================================================================

export interface CoverageTerm {
  invariant: string;
  covered: number;
  total: number;
}

export interface CoverageRatio {
  label: string;
  /** covered ÷ total over the included terms; 1.0 when no units are in scope. */
  ratio: number;
  covered: number;
  total: number;
  terms: CoverageTerm[];
  /** Invariants intentionally NOT folded into the ratio (with the reason). */
  excluded: Array<{ invariant: string; reason: string }>;
}

/**
 * coverage_ratio = Σcovered / Σtotal over the OBSERVABLE invariants, where each
 * term's UNCOVERED is exactly that invariant's GAP population (coverage↔gap
 * parity) — so an org with an empty /gaps?invariant=X cannot show term X below
 * full coverage:
 *   EC-1      uncovered = failed + stalled_past_slo (= ec1GapList). Healthy
 *             in-flight (unsealed but within T_seal) is COVERED, not a gap —
 *             NOT "unsealed", which would drag a no-gap org below 1.0.
 *   EC-2      uncovered = chains_with_gap (= ec2Gaps).
 *   EC-3.seal uncovered = native_unsealed_past_slo (= ec3SealList). A native
 *             FAILED capture is an EC-1 gap (counted once, under EC-1) — it is
 *             not an ec3SealList row, so counting it here too would break
 *             EC-3.seal↔/gaps parity and double-count it.
 *   EC-4      uncovered = without_terminal (= ec4List).
 * EC-6 is excluded (no persisted verification → pending, not "uncovered");
 * EC-3.drop is included only when observed (else excluded — never counted as
 * full coverage, which would over-claim — keeping the proxy conservative).
 */
export function coverageRatio(counts: EvidenceCounts, drop: DropEstimate): CoverageRatio {
  const terms: CoverageTerm[] = [
    {
      invariant: 'ec1',
      covered: counts.ec1.total - (counts.ec1.failed + counts.ec1.stalled_past_slo),
      total: counts.ec1.total,
    },
    {
      invariant: 'ec2',
      covered: counts.ec2.chains - counts.ec2.chains_with_gap,
      total: counts.ec2.chains,
    },
    {
      invariant: 'ec3seal',
      covered: counts.ec3seal.native_total - counts.ec3seal.native_unsealed_past_slo,
      total: counts.ec3seal.native_total,
    },
    {
      invariant: 'ec4',
      covered: counts.ec4.provider_invocations - counts.ec4.without_terminal,
      total: counts.ec4.provider_invocations,
    },
  ];
  const excluded: Array<{ invariant: string; reason: string }> = [
    { invariant: 'ec6', reason: 'no persisted verification at this base — pending, not uncovered' },
  ];

  if (drop.observed) {
    terms.push({ invariant: 'ec3drop', covered: drop.captures, total: drop.captures + drop.drops });
  } else {
    excluded.push({
      invariant: 'ec3drop',
      reason: 'no in-process drop observations (the OTLP collector holds the authoritative signal)',
    });
  }

  const covered = terms.reduce((s, t) => s + t.covered, 0);
  const total = terms.reduce((s, t) => s + t.total, 0);
  return {
    label: EC_LABELS.coverage,
    ratio: total > 0 ? covered / total : 1.0,
    covered,
    total,
    terms,
    excluded,
  };
}

// ===========================================================================
// Summary — the /v1/evidence/summary body for one org (RLS-scoped caller).
// ===========================================================================

export interface EvidenceSummary {
  window_seconds: number;
  t_seal_seconds: number;
  counts: EvidenceCounts;
  ec3drop: DropEstimate;
  ec6: ChainVerificationStatus;
  coverage_ratio: CoverageRatio;
}

export async function evidenceSummary(
  client: PoolClient,
  scope: ReportScope,
  dropSnapshot: DropMetricsSnapshot = ZERO_DROP_SNAPSHOT,
): Promise<EvidenceSummary> {
  const counts = await evidenceCounts(client, scope);
  const ec6 = await chainVerificationStatus(client, scope);
  const ec3drop = nativeDropEstimate(dropSnapshot);
  const coverage = coverageRatio(counts, ec3drop);
  return {
    window_seconds: scope.windowSeconds,
    t_seal_seconds: scope.tSealSeconds,
    counts,
    ec3drop,
    ec6,
    coverage_ratio: coverage,
  };
}
