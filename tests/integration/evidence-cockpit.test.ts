// EP-008D-2 — operator/auditor cockpit via per-org accumulation: the §4.3
// isolation suite (THE ACCEPTANCE CRUX). Proves the rev2 mechanism is correct
// (≥2 orgs via the app loop) AND that the FORCE-RLS property rev1 missed
// actually holds (a raw cross-org SELECT returns one org), with the catalog
// guard verifying NOBYPASSRLS at source for the first time.
//
//   (a) positive cross-org read  — accumulation returns BOTH orgs
//   (b) no cross-org SQL leak     — a raw cross-org SELECT by ANY role → one org
//   (c) no content leakage        — operator view is aggregate columns only
//   (d) per-tenant path unchanged — govai_app still sees only its own org
//   (e) catalog guard + NOBYPASSRLS — rolbypassrls=false for all 3 roles; no
//                                     new role/grant/policy

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PoolClient } from 'pg';
import { startStack, stopStack, seedOrg, type Stack } from './helpers/server-fixture.js';
import { createSeedHelpers, type SeedHelpers } from './helpers/evidence-seed.js';
import {
  accumulateEvidenceAcrossOrgs,
  aggregateOperatorView,
  buildOperatorCockpit,
  createEvidenceGaugeSource,
  listOrgIds,
} from '../../apps/api/src/pipeline/evidence-operator.js';
import type { ReportScope } from '../../apps/api/src/pipeline/evidence-reports.js';

let stack: Stack;
let seed: SeedHelpers;

const SCOPE: ReportScope = { windowSeconds: 86_400, tSealSeconds: 0 };

// The three evidence-plane roles whose NOBYPASSRLS posture the catalog guard
// verifies (the attribute lives in the unread bootstrap.sql).
const EVIDENCE_PLANE_ROLES = [
  'govai_app',
  'govai_audit_writer',
  'govai_audit_sealer',
  // EP-EVIDENCE-GAUGE-WIRING (INV-1): the least-privilege enumerate-only role — covered by
  // the NOBYPASSRLS assertion below like every other evidence-plane role.
  'govai_evidence_enumerator',
] as const;
const CAPTURE_BASE_TABLES = [
  'audit_capture_outbox',
  'audit_capture_chain_state',
  'audit_event_capture_refs',
] as const;

beforeAll(async () => {
  stack = await startStack();
  seed = createSeedHelpers(stack);
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

describe('§4.3(a) — positive cross-org read via per-org accumulation', () => {
  it('returns aggregate rows for BOTH orgs (the cross-org capability works)', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    // Distinct holes per org so the summaries are non-trivial AND distinguishable.
    await seed.seedCaptureInStatus(orgA.org_id, 'failed');
    await seed.seedRunWithInvocation(orgA.org_id, { withAudit: false }); // EC-4 gap
    await seed.seedCaptureInStatus(orgB.org_id, 'captured'); // EC-3.seal native unsealed

    // The operator iterates BOTH orgs over the app pool (govai_app), each read
    // RLS-scoped to one org. ★ This is the exact test that FAILED under rev1's
    // owner's-rights mechanism (it would return 1 org) — it passes now.
    const view = await buildOperatorCockpit({
      pool: stack.db.appPool,
      orgIds: [orgA.org_id, orgB.org_id],
      scope: SCOPE,
    });

    expect(view.totals.org_count).toBe(2);
    const byOrg = new Map(view.orgs.map((o) => [o.org_id, o]));
    expect(byOrg.has(orgA.org_id)).toBe(true);
    expect(byOrg.has(orgB.org_id)).toBe(true);
    expect(byOrg.get(orgA.org_id)!.ec4_without_terminal).toBeGreaterThanOrEqual(1);
    expect(byOrg.get(orgA.org_id)!.ec1_failed).toBeGreaterThanOrEqual(1);
    expect(byOrg.get(orgB.org_id)!.ec3seal_native_unsealed_past_slo).toBeGreaterThanOrEqual(1);
  });

  it('the gauge emission source iterates the authorized orgs and emits per-org points', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    await seed.seedCaptureInStatus(orgA.org_id, 'captured');
    await seed.seedCaptureInStatus(orgB.org_id, 'captured');

    const source = createEvidenceGaugeSource({
      pool: stack.db.appPool,
      scope: SCOPE,
      enumerate: async () => [orgA.org_id, orgB.org_id],
    });
    const points = await source();
    // coverage_ratio is emitted for every authorized org (per-org accumulation).
    const coverageOrgs = points.filter((p) => p.metric === 'coverageRatio').length;
    expect(coverageOrgs).toBe(2);
    // Every point is labeled by org (projected to org_hash downstream), never raw payload.
    for (const p of points) expect(p.labels?.org_id).toBeDefined();
  });

  it('listOrgIds: a privileged role enumerates all orgs; govai_app sees only its own', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);

    // govai_audit_writer carries orgs_select_writer USING(true) → the registry.
    const asWriter = await seed.asRole('govai_audit_writer', orgA.org_id, (c) => listOrgIds(c));
    expect(asWriter).toEqual(expect.arrayContaining([orgA.org_id, orgB.org_id]));

    // govai_app's orgs RLS pins it to the session org — only its own.
    const asApp = await seed.asRole('govai_app', orgA.org_id, (c) => listOrgIds(c));
    expect(asApp).toEqual([orgA.org_id]);
  });
});

describe('§4.3(b) — no cross-org SQL leak (FORCE RLS holds for every role)', () => {
  it('a raw cross-org SELECT on the base tables returns only the session org', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    // Both orgs have outbox rows.
    await seed.seedCaptureInStatus(orgA.org_id, 'captured');
    await seed.seedCaptureInStatus(orgB.org_id, 'captured');

    // As org A, for BOTH the app role AND the OWNER role: a no-WHERE SELECT must
    // never span orgs (FORCE ROW LEVEL SECURITY subjects even the owner).
    for (const role of ['govai_app', 'govai_audit_writer'] as const) {
      const rows = await seed.asRole(role, orgA.org_id, async (c: PoolClient) =>
        (await c.query<{ org_id: string }>(`SELECT DISTINCT org_id::text FROM govai.audit_capture_outbox`))
          .rows,
      );
      expect(rows.map((r) => r.org_id)).toEqual([orgA.org_id]); // exactly one org — A
      expect(rows.some((r) => r.org_id === orgB.org_id)).toBe(false);
    }
  });
});

describe('§4.3(c) — no content leakage (aggregate columns only)', () => {
  it('the operator view carries no payload bytes and no capture/run identifiers', async () => {
    const orgA = await seedOrg(stack);
    await seed.seedCaptureInStatus(orgA.org_id, 'failed');
    await seed.seedRunWithInvocation(orgA.org_id, { withAudit: false });

    const perOrg = await accumulateEvidenceAcrossOrgs(stack.db.appPool, [orgA.org_id], SCOPE);
    const view = aggregateOperatorView(perOrg);
    const serialized = JSON.stringify(view);

    for (const forbidden of [
      'payload_hash',
      'payload_encrypted',
      'dek_wrapped',
      'canonical_bytes',
      'redaction_metadata',
      'capture_id',
      'provider_invocation_id',
      'last_error',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // Operator rows: org_id (string) + numeric aggregates only.
    for (const row of view.orgs) {
      for (const [key, val] of Object.entries(row)) {
        expect(key === 'org_id' ? typeof val === 'string' : typeof val === 'number').toBe(true);
      }
    }
  });
});

describe('§4.3(d) — per-tenant path unchanged', () => {
  it('govai_app still sees only its own org through the EP-008A views', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    await seed.seedCaptureInStatus(orgA.org_id, 'captured');
    await seed.seedCaptureInStatus(orgB.org_id, 'captured');

    const rows = await seed.asRole('govai_app', orgA.org_id, async (c) =>
      (
        await c.query<{ org_id: string }>(
          `SELECT org_id::text FROM govai.evidence_capture_completeness`,
        )
      ).rows,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.org_id).toBe(orgA.org_id);
  });
});

describe('§4.3(e) — catalog guard incl. the NOBYPASSRLS precondition', () => {
  it('rolbypassrls = false for ALL evidence-plane roles', async () => {
    const c = await stack.db.adminPool.connect();
    try {
      const r = await c.query<{ rolname: string; rolbypassrls: boolean }>(
        `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = ANY($1::text[])`,
        [[...EVIDENCE_PLANE_ROLES]],
      );
      expect(r.rows.map((x) => x.rolname).sort()).toEqual([...EVIDENCE_PLANE_ROLES].sort());
      for (const row of r.rows) {
        // ★ STOP condition if any is true — the security model would be violated.
        expect(row.rolbypassrls).toBe(false);
      }
    } finally {
      c.release();
    }
  });

  // INVARIANT TRANSITION: EP-008D shipped NO operator role (per-org accumulation).
  // EP-EVIDENCE-GAUGE-WIRING replaces that with INV-1 — EXACTLY ONE evidence-namespace
  // role, govai_evidence_enumerator, whose entire capability is enumerate-only (SELECT on
  // govai.orgs) and which holds NO privilege on the evidence read-set. (spec rev1 §2/§4.)
  it('EP-EVIDENCE-GAUGE-WIRING adds EXACTLY ONE evidence role — enumerate-only, no read privilege (INV-1)', async () => {
    const c = await stack.db.adminPool.connect();
    try {
      const roles = await c.query<{ rolname: string }>(
        `SELECT rolname FROM pg_roles
          WHERE rolname LIKE 'govai_evidence%' OR rolname ILIKE '%operator%'
          ORDER BY rolname`,
      );
      expect(roles.rows.map((r) => r.rolname)).toEqual(['govai_evidence_enumerator']);

      // INV-1 at the catalog level: no SELECT privilege on any evidence read-set object.
      const READ_SET = [
        'govai.audit_capture_outbox',
        'govai.audit_events',
        'govai.provider_invocations',
        'govai.evidence_capture_completeness',
        'govai.evidence_chain_backlog',
        'govai.evidence_provider_without_audit',
      ];
      for (const obj of READ_SET) {
        const p = await c.query<{ has: boolean }>(
          `SELECT has_table_privilege('govai_evidence_enumerator', $1, 'SELECT') AS has`,
          [obj],
        );
        expect(p.rows[0]?.has).toBe(false);
      }
    } finally {
      c.release();
    }
  });

  it('EP-008D added NO cross-org policy — every capture-table policy stays org-scoped', async () => {
    const c = await stack.db.adminPool.connect();
    try {
      const r = await c.query<{ tablename: string; policyname: string; qual: string | null }>(
        `SELECT tablename, policyname, qual FROM pg_policies
          WHERE schemaname = 'govai' AND tablename = ANY($1::text[])`,
        [[...CAPTURE_BASE_TABLES]],
      );
      expect(r.rows.length).toBeGreaterThan(0);
      for (const row of r.rows) {
        // No USING(true) bypass: every SELECT/ALL policy qual is org-scoped.
        if (row.qual !== null) {
          expect(row.qual).toContain("current_setting('app.org_id'");
          expect(row.qual.trim()).not.toBe('true');
        }
      }
    } finally {
      c.release();
    }
  });
});
