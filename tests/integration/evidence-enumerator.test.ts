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
import { Client, Pool } from 'pg';
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
import { metrics } from '@opentelemetry/api';
import { buildServer } from '../../apps/api/src/server.js';

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

// The enumerator credential (stack.db.enumeratorUrl) provisioned with stack.db.enumeratorPassword.
async function enumeratorCanLogin(): Promise<boolean> {
  const r = await stack.db.adminPool.query<{ rolcanlogin: boolean }>(
    `SELECT rolcanlogin FROM pg_roles WHERE rolname = 'govai_evidence_enumerator'`,
  );
  return r.rows[0]?.rolcanlogin ?? false;
}
async function freshEnumeratorConnectSucceeds(): Promise<void> {
  const client = new Client({ connectionString: stack.db.enumeratorUrl });
  await client.connect();
  await client.query('SELECT 1');
  await client.end().catch(() => undefined);
}
async function freshEnumeratorConnectFails(): Promise<void> {
  const client = new Client({ connectionString: stack.db.enumeratorUrl });
  await expect(client.connect()).rejects.toThrow();
  await client.end().catch(() => undefined);
}

beforeAll(async () => {
  stack = await startStack();
  seed = createSeedHelpers(stack);
  // Provision the enumerator LOGIN (re-run migrate with its password — bootstrap's
  // conditional ALTER path), then connect a real least-privilege pool.
  await migrate(stack.db.adminUrl, stack.db.appPassword, stack.db.enumeratorPassword);
  enumPool = new Pool({ connectionString: stack.db.enumeratorUrl });
  // FIXUP5: the deprovision cell (last) runs pg_terminate_backend for ALL enumerator backends
  // — including this pool's idle connections. Swallow the resulting async pool error (the pool
  // is torn down in afterAll regardless); no assertion depends on it.
  enumPool.on('error', () => undefined);
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
      // Column-scope (FIXUP2): the enumerator holds SELECT on govai.orgs.id ONLY — any
      // other org column denies with permission denied (42501), so the blast radius is
      // literally "org UUIDs and nothing more".
      for (const col of ['name', 'tier', 'operational_mode']) {
        await expect(c.query(`SELECT ${col} FROM govai.orgs LIMIT 1`)).rejects.toMatchObject({
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

  // ── EP-EVIDENCE-GAUGE-WIRING CREDENTIAL-LIFECYCLE-RUNNER: the five-way machine, runner-side ──
  // Every cell below is self-contained (re-provisions at its start) since some deprovision the
  // shared role. The race #9 fix lives in the RUNNER: bootstrap commits NOLOGIN, then the runner
  // sweeps live sessions post-commit. NOTE: these are executable DOCUMENTATION — CI does not run
  // integration; the guarantee is source-verify + the bot + a local green run.

  // Cell A (race closure — the core of #9): once the runner RETURNS, NOLOGIN is COMMITTED, so a
  // FRESH connection on the revoked credential cannot authenticate. We deliberately do NOT assert
  // "zero sessions at the commit instant" (impossible + benign — a live session is reaped by the
  // post-commit sweep, Cell B); the load-bearing invariant is "no NEW auth once the runner returns".
  it('Cell A — after an explicit deprovision returns, a fresh connection on the old credential fails auth', async () => {
    await migrate(stack.db.adminUrl, stack.db.appPassword, stack.db.enumeratorPassword); // provision
    await freshEnumeratorConnectSucceeds(); // sanity: provisioned ⇒ auth works
    await migrate(stack.db.adminUrl, stack.db.appPassword, undefined, '1'); // explicit deprovision
    expect(await enumeratorCanLogin()).toBe(false); // NOLOGIN committed (visible to new sessions)
    await freshEnumeratorConnectFails(); // the race the fix closes: no new auth post-commit
  });

  // ★ Cell C (routine-migration footgun regression): a migrate with NEITHER a password NOR the
  // deprovision signal must LEAVE the role untouched — a schema migration must never drop the
  // gauges by omission (the pre-fix "absent password ⇒ deprovision" sentinel is gone).
  it('Cell C — a routine migration (no password, no deprovision) leaves a provisioned role LOGIN-capable', async () => {
    await migrate(stack.db.adminUrl, stack.db.appPassword, stack.db.enumeratorPassword); // provision
    expect(await enumeratorCanLogin()).toBe(true);
    await migrate(stack.db.adminUrl, stack.db.appPassword); // routine migration: no enumerator signal
    expect(await enumeratorCanLogin()).toBe(true); // still LOGIN — untouched
    await freshEnumeratorConnectSucceeds(); // and still reachable
  });

  // Cell D (conflicting intent fails loud, state unchanged): password + deprovision=1 together is
  // rejected BEFORE bootstrap runs, so a previously-provisioned role is left exactly as it was.
  it('Cell D — password AND deprovision=1 fails loud, leaving the existing state unchanged', async () => {
    await migrate(stack.db.adminUrl, stack.db.appPassword, stack.db.enumeratorPassword); // provision
    await expect(
      migrate(stack.db.adminUrl, stack.db.appPassword, stack.db.enumeratorPassword, '1'),
    ).rejects.toThrow();
    expect(await enumeratorCanLogin()).toBe(true); // unchanged — no bootstrap ran
  });

  // Cell E (invalid deprovision value fails loud, state unchanged): the sole accepted value is
  // '1'; anything else is rejected before bootstrap.
  it('Cell E — an invalid deprovision value fails loud, leaving the existing state unchanged', async () => {
    await migrate(stack.db.adminUrl, stack.db.appPassword, stack.db.enumeratorPassword); // provision
    await expect(
      migrate(stack.db.adminUrl, stack.db.appPassword, undefined, 'maybe'),
    ).rejects.toThrow();
    expect(await enumeratorCanLogin()).toBe(true); // unchanged
  });

  // Cell B (post-commit live-session sweep — the former FIXUP5 cell, now via the explicit signal):
  // the runner's post-commit bounded sweep terminates an already-live enumerator session, and the
  // committed NOLOGIN blocks any new auth. MUST run late — it leaves the role deprovisioned.
  it('Cell B — an explicit deprovision terminates a live session (runner sweep) AND blocks future auth', async () => {
    await migrate(stack.db.adminUrl, stack.db.appPassword, stack.db.enumeratorPassword); // provision
    // A LIVE enumerator connection, held open across the deprovision.
    const live = new Client({ connectionString: stack.db.enumeratorUrl });
    live.on('error', () => undefined); // swallow the async disconnect when the backend is killed
    await live.connect();
    await live.query('SELECT 1'); // succeeds while provisioned

    // Explicit deprovision: bootstrap commits NOLOGIN; the runner then sweeps live sessions.
    await migrate(stack.db.adminUrl, stack.db.appPassword, undefined, '1');

    // (1) the PRE-EXISTING connection's backend was terminated by the post-commit sweep.
    await expect(live.query('SELECT 1')).rejects.toThrow();
    await live.end().catch(() => undefined);
    // (2) rolcanlogin is now false (committed).
    expect(await enumeratorCanLogin()).toBe(false);
    // (3) the SAME connection string now fails NEW authentication.
    await freshEnumeratorConnectFails();
  });

  // FIXUP6 D-C.3 — the SHIPPED server survives a live deprovision: the enumerator pool's
  // 'error' listener (D-A) absorbs the runner-sweep-induced disconnect and the API stays up.
  // Self-contained (Cell B above left the role deprovisioned): re-provision first.
  it('the shipped server survives a live deprovision (enumerator pool error absorbed, API stays up)', async () => {
    await migrate(stack.db.adminUrl, stack.db.appPassword, stack.db.enumeratorPassword); // re-provision

    // A real server with the enumerator wired: OTEL set (a dead endpoint is fine) →
    // telemetry.enabled; enumerator URL set → the enumerator pool + its FIXUP6 error listener.
    const app = await buildServer({
      env: {
        ...stack.env,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:39996',
        GOVAI_EVIDENCE_ENUMERATOR_URL: stack.db.enumeratorUrl,
      },
    });
    try {
      // Force a gauge collection so the enumerator pool actually connects (enumerates orgs).
      const mp = metrics.getMeterProvider() as unknown as { forceFlush?: () => Promise<void> };
      await mp.forceFlush?.().catch(() => undefined);

      // Explicit deprovision → the runner's post-commit sweep kills the enumerator pool's
      // backend → the pool's 'error' listener absorbs it (warn). The server must NOT crash.
      await migrate(stack.db.adminUrl, stack.db.appPassword, undefined, '1');
      await new Promise((r) => setTimeout(r, 250)); // let the async pool 'error' fire + be absorbed

      // Survival proof: the server still responds.
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
