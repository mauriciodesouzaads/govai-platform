// Operator/auditor evidence cockpit via PER-ORG ACCUMULATION (EP-008D-2 / §4).
//
// rev2's corrected mechanism (Opus FINDING 1): there is NO operator role and NO
// owner's-rights cross-org view. Because the capture base tables are FORCE ROW
// LEVEL SECURITY with an explicit org-scoped policy for the OWNER too (0025 §E),
// no SQL-level cross-org read is possible without a forbidden bypass. So the
// operator's cross-org view is built by accumulating N legitimate single-org
// RLS-scoped reads in the application layer:
//
//   1. Enumerate the authorized orgs from the org REGISTRY (govai.orgs) — NOT a
//      cross-org evidence read (see listOrgIds; runs under operator privilege).
//   2. For EACH org, in its own transaction, set app.org_id = that org via the
//      EXISTING per-tenant helper (withTenant) and read the per-org summary —
//      RLS-scoped to ONE org, exactly as a tenant would (as govai_app).
//   3. Aggregate the N per-org results in the app layer → the cross-org view
//      (org_id + aggregate columns only; NO payload, NO capture/run identifier).
//
// ★ Isolation-safe BY CONSTRUCTION: no single SQL statement ever sees more than
// one org's rows. NO new role, NO USING(true), NO BYPASSRLS, NO row_security=off.
// The cross-org capability lives in the operator's AUTHORIZATION (which orgs it
// may enumerate), never in a loosened evidence RLS. The auditor path is the
// per-tenant /v1/evidence/* API (the auditor IS the tenant).

import type { Pool, PoolClient } from 'pg';
import { withTenant } from '@govai/core-tenant';
import {
  evidenceSummary,
  ZERO_DROP_SNAPSHOT,
  type EvidenceSummary,
  type ReportScope,
  type DropMetricsSnapshot,
} from './evidence-reports.js';
import {
  summaryToGaugePoints,
  type EvidenceGaugePoint,
  type EvidenceGaugeSource,
} from './evidence-metrics.js';

/**
 * List the org ids the operator is authorized to see — the org REGISTRY read
 * (govai.orgs), NOT a cross-org evidence read. Must run on an operator-privileged
 * connection whose orgs RLS admits more than one org (e.g. govai_audit_writer,
 * whose orgs_select_writer policy is USING(true)); as govai_app it returns only
 * the session org. The cross-org capability is in WHICH orgs may be enumerated,
 * never in a loosened evidence-table RLS.
 */
export async function listOrgIds(client: PoolClient): Promise<string[]> {
  // ORDER BY id only (not created_at): the evidence enumerator holds a column grant on
  // `id` alone (migration 0028), so ordering must not reference any other column. Order is
  // not consumer-visible — accumulation is per-org and order-independent.
  const r = await client.query<{ id: string }>(`SELECT id::text FROM govai.orgs ORDER BY id`);
  return r.rows.map((row) => row.id);
}

/**
 * Pool-level enumeration wrapper (EP-EVIDENCE-GAUGE-WIRING): connect → listOrgIds →
 * release. Closes the Pool-vs-PoolClient mismatch so this can be passed directly as
 * the `enumerate` option. Runs on whichever pool is supplied — in the boot wiring
 * that is the operator-privileged enumerator pool (see createEvidenceGaugeSource's
 * enumeratePool); the per-org reads never use it.
 */
export async function enumerateAllOrgs(pool: Pool): Promise<readonly string[]> {
  const client = await pool.connect();
  try {
    return await listOrgIds(client);
  } finally {
    client.release();
  }
}

export interface OrgEvidence {
  org_id: string;
  summary: EvidenceSummary;
}

/**
 * The per-org accumulation mechanism (§4.1). For EACH org, in its own
 * transaction/connection, withTenant sets app.org_id and reads the per-org
 * summary RLS-scoped to that ONE org. The "cross-org" result is an app-layer
 * fold over N single-org reads — never a cross-org SQL statement.
 */
export async function accumulateEvidenceAcrossOrgs(
  pool: Pool,
  orgIds: readonly string[],
  scope: ReportScope,
  dropSnapshotFor: (orgId: string) => DropMetricsSnapshot = () => ZERO_DROP_SNAPSHOT,
): Promise<OrgEvidence[]> {
  const out: OrgEvidence[] = [];
  for (const orgId of orgIds) {
    const client = await pool.connect();
    try {
      const summary = await withTenant(client, orgId, (c) =>
        evidenceSummary(c, scope, dropSnapshotFor(orgId)),
      );
      out.push({ org_id: orgId, summary });
    } finally {
      client.release();
    }
  }
  return out;
}

export interface OperatorOrgRow {
  org_id: string;
  coverage_ratio: number;
  ec1_total: number;
  ec1_failed: number;
  ec1_stalled_past_slo: number;
  ec2_chains_with_gap: number;
  ec3seal_native_unsealed_past_slo: number;
  ec4_without_terminal: number;
  ec6_pending: number;
}

export interface OperatorCockpitView {
  orgs: OperatorOrgRow[];
  totals: {
    org_count: number;
    coverage_ratio_min: number | null;
    ec1_failed: number;
    ec4_without_terminal: number;
  };
}

/**
 * The operator cross-org view: AGGREGATE columns only (org_id + counts/ages/
 * rates) — NO payload, NO capture/run identifier. This is what the thin operator
 * cockpit renders; rendering itself is an implementation choice (§4.2).
 */
export function aggregateOperatorView(perOrg: readonly OrgEvidence[]): OperatorCockpitView {
  const orgs: OperatorOrgRow[] = perOrg.map(({ org_id, summary }) => ({
    org_id,
    coverage_ratio: summary.coverage_ratio.ratio,
    ec1_total: summary.counts.ec1.total,
    ec1_failed: summary.counts.ec1.failed,
    ec1_stalled_past_slo: summary.counts.ec1.stalled_past_slo,
    ec2_chains_with_gap: summary.counts.ec2.chains_with_gap,
    ec3seal_native_unsealed_past_slo: summary.counts.ec3seal.native_unsealed_past_slo,
    ec4_without_terminal: summary.counts.ec4.without_terminal,
    ec6_pending: summary.ec6.pending,
  }));
  return {
    orgs,
    totals: {
      org_count: orgs.length,
      coverage_ratio_min: orgs.length ? Math.min(...orgs.map((o) => o.coverage_ratio)) : null,
      ec1_failed: orgs.reduce((s, o) => s + o.ec1_failed, 0),
      ec4_without_terminal: orgs.reduce((s, o) => s + o.ec4_without_terminal, 0),
    },
  };
}

/**
 * The operator cockpit read path: accumulate per-org evidence over the
 * authorized org ids, then fold into the aggregate cross-org view. The org ids
 * come from the operator's grant scope / listOrgIds (a registry read), never a
 * cross-org evidence read; each per-org read is single-org RLS-scoped.
 */
export async function buildOperatorCockpit(opts: {
  pool: Pool;
  orgIds: readonly string[];
  scope: ReportScope;
}): Promise<OperatorCockpitView> {
  const perOrg = await accumulateEvidenceAcrossOrgs(opts.pool, opts.orgIds, opts.scope);
  return aggregateOperatorView(perOrg);
}

/**
 * The cross-org gauge EMISSION source (§3.2). On each collection it enumerates
 * the authorized orgs and accumulates per-org gauge points (per-org_hash) via
 * the SAME single-org accumulation path — never a cross-org SQL read. A global
 * meter callback cannot itself be RLS-scoped, hence the per-org loop.
 *
 * The first real export is the deferred OTLP-collector standup (§10); this ships
 * the loop as a reusable source. Enumeration runs under the operator's privilege
 * (see listOrgIds).
 */
export function createEvidenceGaugeSource(opts: {
  pool: Pool;
  scope: ReportScope;
  enumerate: (pool: Pool) => Promise<readonly string[]>;
  /** EP-EVIDENCE-GAUGE-WIRING (INV-1): when set, ENUMERATION runs on this
   *  operator-privileged pool while the per-org READS stay on `pool` (govai_app) —
   *  no single database identity holds both enumerate and read. Defaults to `pool`
   *  (backward-compatible: existing call sites keep one-pool behaviour). */
  enumeratePool?: Pool;
}): EvidenceGaugeSource {
  return async (): Promise<EvidenceGaugePoint[]> => {
    // Enumeration on the enumerator pool when provided; the per-org reads STAY on
    // opts.pool (govai_app under withTenant) — INV-1's code half.
    const orgIds = await opts.enumerate(opts.enumeratePool ?? opts.pool);
    const perOrg = await accumulateEvidenceAcrossOrgs(opts.pool, orgIds, opts.scope);
    return perOrg.flatMap(({ org_id, summary }) => summaryToGaugePoints(org_id, summary));
  };
}
