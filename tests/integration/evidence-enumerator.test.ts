// EP-EVIDENCE-GAUGE-WIRING — integration: the enumerate-only role (INV-1) + the
// shipped two-pool gauge source, proven against a real Postgres.
//
// I1: the enumerator LOGIN pool lists ALL orgs (registry-wide USING(true)).
// I2: the enumerator has ZERO read privilege on the evidence set (permission denied)
//     and no EXECUTE on the capture fn — INV-1's DB half (the safety is the ABSENCE of
//     grants; this documents it).
// I3: createEvidenceGaugeSource enumerates on the enumerator pool and reads per-org on
//     the app pool, emitting safe-labelled points (org_hash, never raw org_id) per org.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { startStack, stopStack, seedOrg, type Stack } from './helpers/server-fixture.js';
import { createSeedHelpers, type SeedHelpers } from './helpers/evidence-seed.js';
import { migrate } from './setup.js';
import {
  listOrgIds,
  enumerateAllOrgs,
  createEvidenceGaugeSource,
} from '../../apps/api/src/pipeline/evidence-operator.js';
import { safeEvidenceLabels } from '../../apps/api/src/pipeline/evidence-metrics.js';
import type { ReportScope } from '../../apps/api/src/pipeline/evidence-reports.js';

let stack: Stack;
let seed: SeedHelpers;
let enumPool: Pool;
const SCOPE: ReportScope = { windowSeconds: 86_400, tSealSeconds: 0 };

// The evidence read-set the enumerator must NOT reach (F12 tables + F13 views). INV-1.
const READ_SET = [
  'govai.audit_capture_outbox',
  'govai.audit_events',
  'govai.provider_invocations',
  'govai.evidence_capture_completeness',
  'govai.evidence_chain_backlog',
  'govai.evidence_provider_without_audit',
] as const;

beforeAll(async () => {
  stack = await startStack();
  seed = createSeedHelpers(stack);
  // Provision the enumerator LOGIN (re-run migrate with its password — bootstrap's
  // conditional ALTER path), then connect a real least-privilege pool.
  await migrate(stack.db.adminUrl, stack.db.appPassword, stack.db.enumeratorPassword);
  enumPool = new Pool({ connectionString: stack.db.enumeratorUrl });
}, 240_000);

afterAll(async () => {
  await enumPool?.end().catch(() => undefined);
  if (stack) await stopStack(stack);
});

describe('EP-EVIDENCE-GAUGE-WIRING — enumerate-only role (INV-1) + two-pool gauge source', () => {
  it('I1 — the enumerator LOGIN pool lists ALL orgs (registry-wide USING(true))', async () => {
    const a = await seedOrg(stack);
    const b = await seedOrg(stack);
    const c = await enumPool.connect();
    try {
      const ids = await listOrgIds(c);
      expect(ids).toContain(a.org_id);
      expect(ids).toContain(b.org_id);
      expect(ids.length).toBeGreaterThanOrEqual(2);
    } finally {
      c.release();
    }
  });

  it('I2 — the enumerator has ZERO read privilege on the evidence set (permission denied)', async () => {
    const c = await enumPool.connect();
    try {
      // Each read-set object SELECT fails at the table GRANT check (before RLS) — the
      // enumerator holds no grant on any of them. Auto-commit mode: a failed query does
      // not poison the connection, so the loop continues on the same client.
      for (const obj of READ_SET) {
        await expect(c.query(`SELECT * FROM ${obj} LIMIT 1`)).rejects.toMatchObject({
          code: '42501',
        });
      }
      // No EXECUTE on the SECURITY DEFINER capture fn either (grant-absence, in-catalog).
      const r = await c.query<{ can_exec: boolean | null }>(
        `SELECT bool_or(has_function_privilege(p.oid, 'EXECUTE')) AS can_exec
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'govai' AND p.proname = 'audit_capture_insert_locked'`,
      );
      expect(r.rows[0]?.can_exec).toBe(false);
    } finally {
      c.release();
    }
  });

  it('I3 — source enumerates on the enumerator pool + reads per-org on the app pool; every point is safe-labelled', async () => {
    const a = await seedOrg(stack);
    const b = await seedOrg(stack);
    // A capture each, so evidenceSummary yields non-trivial points for both.
    await seed.seedCaptureInStatus(a.org_id, 'captured');
    await seed.seedCaptureInStatus(b.org_id, 'captured');

    const source = createEvidenceGaugeSource({
      pool: stack.db.appPool, // per-org reads: govai_app under withTenant
      scope: SCOPE,
      enumerate: enumerateAllOrgs, // enumeration...
      enumeratePool: enumPool, // ...on the enumerator pool (INV-1's two-pool split)
    });
    const points = await source();

    // Both orgs are present (enumerator saw them; app pool read each per-tenant).
    const orgIds = new Set(points.map((p) => p.labels?.org_id));
    expect(orgIds.has(a.org_id)).toBe(true);
    expect(orgIds.has(b.org_id)).toBe(true);

    // Every emitted attribute set is cardinality-safe: org_hash present, raw org_id absent.
    for (const p of points) {
      const attrs = safeEvidenceLabels(p.labels ?? {});
      expect(attrs).toHaveProperty('org_hash');
      expect(attrs).not.toHaveProperty('org_id');
    }
  });
});
