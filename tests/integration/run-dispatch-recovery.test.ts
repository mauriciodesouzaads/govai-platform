// EP-P03A-A (F3) — T7 (stale queued), T8 (stale running), T16 (recovery
// idempotency) + the recovery worker lifecycle (start onReady / clean stop).
//
// The sweep function is driven directly (the fixture stack keeps the periodic
// worker DISABLED) so every transition is deterministic; the lifecycle test
// opts the worker in on a dedicated server and watches it recover a seeded
// stale run on database time — no provider is ever called by recovery.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { DevKms } from '@govai/core-identity';
import { buildServer } from '../../apps/api/src/server.js';
import {
  runDispatchRecoverySweepOnce,
  startRunDispatchRecoveryWorker,
} from '../../apps/api/src/pipeline/run-dispatch-recovery.js';
import { runDispatchConfigFromEnv } from '../../apps/api/src/pipeline/run-dispatch-config.js';
import type { GovAIEnv } from '@govai/config';
import {
  startStack,
  stopStack,
  seedOrg,
  type Stack,
  type SeededOrg,
} from './helpers/server-fixture.js';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

async function queryAsOrg<T extends Record<string, unknown> = Record<string, unknown>>(
  orgId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r.rows as T[];
  } finally {
    c.release();
  }
}

async function auditEventTypes(orgId: string, runId: string): Promise<string[]> {
  const rows = await queryAsOrg<{ event_type: string }>(
    orgId,
    'SELECT event_type FROM govai.audit_events WHERE subject_id = $1::uuid ORDER BY sequence_number',
    [runId],
  );
  return rows.map((r) => r.event_type);
}

async function seedStaleQueued(
  org: SeededOrg,
  ageMs = 600_000,
  opts: { createdAgoMs?: number } = {},
): Promise<string> {
  const runId = randomUUID();
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);
    await c.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'claude-fixture-1',
          'governed', 'queued', '{}'::jsonb, 1, now() - make_interval(secs => $5::integer / 1000.0),
          now() - make_interval(secs => $6::integer / 1000.0))`,
      [runId, org.org_id, org.workspace_id, org.user_id, ageMs, opts.createdAgoMs ?? 0],
    );
    await c.query('COMMIT');
  } finally {
    c.release();
  }
  return runId;
}

async function seedStaleRunning(
  org: SeededOrg,
  opts: { deadlineAgoMs?: number; boundaryCommitted?: boolean } = {},
): Promise<{ runId: string; token: string }> {
  const runId = randomUUID();
  const token = randomUUID();
  const ago = opts.deadlineAgoMs ?? 600_000;
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);
    await c.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
          dispatch_timeout_ms, dispatch_deadline_at, started_at, dispatch_boundary_committed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'claude-fixture-1',
          'governed', 'running', '{}'::jsonb, 1,
          now() - make_interval(secs => ($5::integer + 60000) / 1000.0),
          $6::uuid,
          now() - make_interval(secs => ($5::integer + 30000) / 1000.0),
          60000,
          now() - make_interval(secs => $5::integer / 1000.0),
          now() - make_interval(secs => ($5::integer + 30000) / 1000.0),
          CASE WHEN $7::boolean
               THEN now() - make_interval(secs => ($5::integer + 29000) / 1000.0)
               ELSE NULL END)`,
      [runId, org.org_id, org.workspace_id, org.user_id, ago, token, opts.boundaryCommitted === true],
    );
    await c.query('COMMIT');
  } finally {
    c.release();
  }
  return { runId, token };
}

async function eventMetadata(
  orgId: string,
  runId: string,
  eventType: string,
): Promise<Record<string, unknown> | null> {
  const rows = await queryAsOrg<{ redaction_metadata: Record<string, unknown> | null }>(
    orgId,
    `SELECT redaction_metadata FROM govai.audit_events
      WHERE subject_id = $1::uuid AND event_type = $2 ORDER BY sequence_number DESC LIMIT 1`,
    [runId, eventType],
  );
  return rows[0]?.redaction_metadata ?? null;
}

function sweepDeps() {
  return {
    pool: stack.db.appPool,
    kms: new DevKms(stack.seed),
    config: runDispatchConfigFromEnv(stack.env),
  };
}

describe('T7 — stale queued recovery', () => {
  it('queued past the prepared grace → known failed dispatch_never_claimed; zero provider calls', async () => {
    const org = await seedOrg(stack);
    const runId = await seedStaleQueued(org);
    stack.provider.clearRecordedRequestHeaders();

    const r = await runDispatchRecoverySweepOnce(sweepDeps());
    expect(r.queuedFailed).toBeGreaterThanOrEqual(1);

    const rows = await queryAsOrg<{
      status: string;
      dispatch_error_class: string | null;
      completed_at: Date | null;
      dispatch_token: string | null;
    }>(
      org.org_id,
      `SELECT status, dispatch_error_class, completed_at, dispatch_token
         FROM govai.runs WHERE id = $1::uuid`,
      [runId],
    );
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.dispatch_error_class).toBe('dispatch_never_claimed');
    expect(rows[0]!.completed_at).not.toBeNull();
    expect(rows[0]!.dispatch_token).toBeNull(); // recovery NEVER generates a token

    const types = await auditEventTypes(org.org_id, runId);
    expect(types.filter((t) => t === 'run.failed')).toHaveLength(1);

    // The provider was never called for this run.
    expect(
      stack.provider.recordedRequestHeaders.filter(
        (h) => h['x-test-workspace-id'] === org.workspace_id,
      ),
    ).toHaveLength(0);
    const inv = await queryAsOrg<{ id: string }>(
      org.org_id,
      'SELECT id FROM govai.provider_invocations WHERE run_id = $1::uuid',
      [runId],
    );
    expect(inv).toHaveLength(0);
  });

  it('a FRESH queued run (inside the grace) is NOT touched', async () => {
    const org = await seedOrg(stack);
    const runId = await seedStaleQueued(org, 1_000); // 1s old, grace is 60s
    const r = await runDispatchRecoverySweepOnce(sweepDeps());
    expect(r).toBeDefined();
    const rows = await queryAsOrg<{ status: string }>(
      org.org_id,
      'SELECT status FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(rows[0]!.status).toBe('queued');
  });
});

describe('T8 — stale running recovery (boundary-branched, REV4 §18)', () => {
  // CONTRACT CHANGE (REV4): pre-boundary, EVERY stale running claim went to
  // outcome_unknown ("nothing provable"). The durable boundary makes the
  // boundary-null case PROVABLE: the mandatory gate never committed, so the
  // provider was structurally never called → KNOWN failed
  // dispatch_never_started (CW1). Only a boundary-committed stale claim stays
  // an honest unknown (CW2). Independent property test: CW crash-window suite.
  it('§18.1 boundary ABSENT: running past deadline+grace → KNOWN failed dispatch_never_started; zero provider calls; NO unknown event', async () => {
    const org = await seedOrg(stack);
    const { runId, token } = await seedStaleRunning(org); // no boundary
    stack.provider.clearRecordedRequestHeaders();

    const r = await runDispatchRecoverySweepOnce(sweepDeps());
    expect(r.runningNeverStarted).toBeGreaterThanOrEqual(1);

    const rows = await queryAsOrg<{
      status: string;
      dispatch_error_class: string | null;
      outcome_unknown_at: Date | null;
      completed_at: Date | null;
      dispatch_token: string | null;
      dispatch_boundary_committed_at: Date | null;
    }>(
      org.org_id,
      `SELECT status, dispatch_error_class, outcome_unknown_at, completed_at, dispatch_token,
              dispatch_boundary_committed_at
         FROM govai.runs WHERE id = $1::uuid`,
      [runId],
    );
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.dispatch_error_class).toBe('dispatch_never_started');
    expect(rows[0]!.completed_at).not.toBeNull();
    expect(rows[0]!.outcome_unknown_at).toBeNull();
    expect(rows[0]!.dispatch_token).toBe(token); // the claim token is preserved
    expect(rows[0]!.dispatch_boundary_committed_at).toBeNull(); // never invented

    const types = await auditEventTypes(org.org_id, runId);
    expect(types.filter((t) => t === 'run.failed')).toHaveLength(1);
    expect(types).not.toContain('run.outcome_unknown');
    const meta = await eventMetadata(org.org_id, runId, 'run.failed');
    expect(meta?.['error_class']).toBe('dispatch_never_started');
    expect(meta?.['provider_call_count']).toBe(0);
    expect(meta?.['recovered_by']).toBe('run_dispatch_recovery');

    // Recovery NEVER calls a provider; no invocation row was invented.
    expect(
      stack.provider.recordedRequestHeaders.filter(
        (h) => h['x-test-workspace-id'] === org.workspace_id,
      ),
    ).toHaveLength(0);
    const inv = await queryAsOrg<{ id: string }>(
      org.org_id,
      'SELECT id FROM govai.provider_invocations WHERE run_id = $1::uuid',
      [runId],
    );
    expect(inv).toHaveLength(0);
  });

  it('§18.2 boundary PRESENT: running past deadline+grace → outcome_unknown stale_dispatch_claim, forward_observation=not_observed; NO redispatch', async () => {
    const org = await seedOrg(stack);
    const { runId, token } = await seedStaleRunning(org, { boundaryCommitted: true });
    stack.provider.clearRecordedRequestHeaders();

    const r = await runDispatchRecoverySweepOnce(sweepDeps());
    expect(r.runningUnknown).toBeGreaterThanOrEqual(1);

    const rows = await queryAsOrg<{
      status: string;
      dispatch_error_class: string | null;
      outcome_unknown_at: Date | null;
      completed_at: Date | null;
      dispatch_token: string | null;
      dispatch_boundary_committed_at: Date | null;
    }>(
      org.org_id,
      `SELECT status, dispatch_error_class, outcome_unknown_at, completed_at, dispatch_token,
              dispatch_boundary_committed_at
         FROM govai.runs WHERE id = $1::uuid`,
      [runId],
    );
    expect(rows[0]!.status).toBe('outcome_unknown');
    expect(rows[0]!.dispatch_error_class).toBe('stale_dispatch_claim');
    expect(rows[0]!.outcome_unknown_at).not.toBeNull();
    expect(rows[0]!.completed_at).toBeNull();
    expect(rows[0]!.dispatch_token).toBe(token); // the claim token is preserved
    expect(rows[0]!.dispatch_boundary_committed_at).not.toBeNull();

    const types = await auditEventTypes(org.org_id, runId);
    expect(types.filter((t) => t === 'run.outcome_unknown')).toHaveLength(1);
    expect(types).not.toContain('run.failed');
    // §14/§15 — the unknown evidence records the honest observation semantics
    // and is bound to the durable boundary commit it derives from.
    const meta = await eventMetadata(org.org_id, runId, 'run.outcome_unknown');
    expect(meta?.['forward_observation']).toBe('not_observed');
    expect(meta?.['dispatch_boundary_committed_at']).toBe(
      rows[0]!.dispatch_boundary_committed_at!.toISOString(),
    );

    // Recovery NEVER calls a provider.
    expect(
      stack.provider.recordedRequestHeaders.filter(
        (h) => h['x-test-workspace-id'] === org.workspace_id,
      ),
    ).toHaveLength(0);
  });

  it('a running run still inside its deadline is NOT touched', async () => {
    const org = await seedOrg(stack);
    const { runId } = await seedStaleRunning(org, { deadlineAgoMs: -600_000 }); // deadline in the future
    const r = await runDispatchRecoverySweepOnce(sweepDeps());
    expect(r).toBeDefined();
    const rows = await queryAsOrg<{ status: string }>(
      org.org_id,
      'SELECT status FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(rows[0]!.status).toBe('running');
  });
});

describe('T16 — recovery idempotency (CW8: both stale-running branches)', () => {
  it('repeated sweeps: single transition, single lifecycle event, zero provider calls', async () => {
    const org = await seedOrg(stack);
    const queuedId = await seedStaleQueued(org);
    const { runId: neverStartedId } = await seedStaleRunning(org); // boundary absent
    const { runId: unknownId } = await seedStaleRunning(org, { boundaryCommitted: true });
    stack.provider.clearRecordedRequestHeaders();

    await runDispatchRecoverySweepOnce(sweepDeps());
    await runDispatchRecoverySweepOnce(sweepDeps());
    const third = await runDispatchRecoverySweepOnce(sweepDeps());
    // After convergence nothing else transitions.
    expect(third.queuedFailed).toBe(0);
    expect(third.runningUnknown).toBe(0);
    expect(third.runningNeverStarted).toBe(0);

    const queuedTypes = await auditEventTypes(org.org_id, queuedId);
    expect(queuedTypes.filter((t) => t === 'run.failed')).toHaveLength(1);
    // §18.1 branch: exactly one run.failed, never an unknown event.
    const neverStartedTypes = await auditEventTypes(org.org_id, neverStartedId);
    expect(neverStartedTypes.filter((t) => t === 'run.failed')).toHaveLength(1);
    expect(neverStartedTypes).not.toContain('run.outcome_unknown');
    // §18.2 branch: exactly one run.outcome_unknown, never a terminal event.
    const unknownTypes = await auditEventTypes(org.org_id, unknownId);
    expect(unknownTypes.filter((t) => t === 'run.outcome_unknown')).toHaveLength(1);
    expect(unknownTypes).not.toContain('run.failed');

    expect(
      stack.provider.recordedRequestHeaders.filter(
        (h) => h['x-test-workspace-id'] === org.workspace_id,
      ),
    ).toHaveLength(0);
  });
});

describe('recovery worker lifecycle (§25)', () => {
  it('stop() is BOUNDED: a permanently STALLED in-flight sweep cannot hold shutdown hostage', async () => {
    // Codex P2 on 35953a6: without the bound, stop() awaits the stalled sweep
    // forever and this test fails by timeout. The stalled pool's discovery
    // query never settles (a partition hangs, it does not reject); the worker
    // must still shut down at the bound, with new ticks already prevented.
    let sweepStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      sweepStarted = resolve;
    });
    const stalledPool = {
      query: () => {
        sweepStarted();
        return new Promise(() => undefined); // never settles
      },
    } as unknown as Pool;
    const handle = startRunDispatchRecoveryWorker({
      pool: stalledPool,
      kms: new DevKms(stack.seed),
      config: { ...runDispatchConfigFromEnv(stack.env), recoveryIntervalMs: 1_000 },
      shutdownMaxWaitMs: 300,
    });
    await started; // the sweep is in flight and permanently stalled
    await handle.stop(); // must resolve at the bound, not hang
  }, 20_000);

  it('app close is BOUNDED even with a stalled borrowed client (owned-pool shutdown path)', async () => {
    // Codex P2 on 6362c47: pg pool.end() waits for borrowed clients, so a
    // client stalled on a partitioned database (the abandoned-sweep case)
    // used to move the hang from stop() to close(). Without the server-side
    // bound this close() never resolves and the test fails by timeout.
    const app2 = await buildServer({ env: stack.env }); // owns its pool (DATABASE_URL)
    await app2.ready();
    const hostage = await app2.govai.pool.connect(); // never released before close
    try {
      await app2.close(); // must complete at the bound, not hang on pool.end()
    } finally {
      hostage.release(); // lets the abandoned pool.end() settle for teardown hygiene
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 30_000);

  it('starts onReady, recovers a stale run on its own, and stops cleanly on close', async () => {
    const org = await seedOrg(stack);
    const runId = await seedStaleQueued(org);

    const env: GovAIEnv = {
      ...stack.env,
      RUN_DISPATCH_RECOVERY_ENABLED: true,
      RUN_DISPATCH_RECOVERY_INTERVAL_MS: 1_000,
    } as GovAIEnv;
    const app2 = await buildServer({ env });
    try {
      await app2.ready(); // onReady → worker starts
      const deadline = Date.now() + 20_000;
      let status = 'queued';
      while (Date.now() < deadline) {
        const rows = await queryAsOrg<{ status: string }>(
          org.org_id,
          'SELECT status FROM govai.runs WHERE id = $1::uuid',
          [runId],
        );
        status = rows[0]!.status;
        if (status !== 'queued') break;
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(status).toBe('failed');
    } finally {
      await app2.close(); // must not hang: interval cleared, in-flight awaited
    }
  }, 60_000);
});

// =============================================================================
// T21 — head-of-line liveness: a non-advancing oldest candidate (here: row-
// locked by another session, the SKIP LOCKED path; a persistently-failing
// transition behaves identically at the batch level) must not starve younger
// stale runs. With recoveryBatchSize=1 the pre-cursor sweep re-selected ONLY
// the oldest candidate forever; the keyset cursor pages past it.
// =============================================================================

describe('T21 — recovery sweep pages past a non-advancing head-of-line candidate', () => {
  it('batch size 1: locked oldest is skipped, younger stale run is still recovered in the SAME sweep', async () => {
    const org = await seedOrg(stack);
    const oldest = await seedStaleQueued(org, 600_000, { createdAgoMs: 120_000 });
    const younger = await seedStaleQueued(org, 600_000, { createdAgoMs: 60_000 });

    const deps = sweepDeps();
    const cfg = { ...deps.config, recoveryBatchSize: 1 };

    const locker = await stack.db.appPool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);
      await locker.query('SELECT 1 FROM govai.runs WHERE id = $1::uuid FOR UPDATE', [oldest]);

      const result = await runDispatchRecoverySweepOnce({ ...deps, config: cfg });
      // The locked oldest consumed a page (skipped); the younger run was still
      // reached and recovered within the SAME sweep.
      expect(result.skipped).toBeGreaterThanOrEqual(1);
      expect(result.queuedFailed).toBeGreaterThanOrEqual(1);
      await locker.query('ROLLBACK');
    } finally {
      locker.release();
    }

    const rows = await queryAsOrg<{ id: string; status: string; dispatch_error_class: string | null }>(
      org.org_id,
      'SELECT id, status, dispatch_error_class FROM govai.runs WHERE id = ANY($1::uuid[]) ORDER BY created_at',
      [[oldest, younger]],
    );
    expect(rows.find((r) => r.id === younger)!.status).toBe('failed');
    expect(rows.find((r) => r.id === younger)!.dispatch_error_class).toBe('dispatch_never_claimed');
    // The locked candidate was left untouched (never force-transitioned)…
    expect(rows.find((r) => r.id === oldest)!.status).toBe('queued');

    // …and is recovered normally on the NEXT sweep once the lock is gone.
    const second = await runDispatchRecoverySweepOnce({ ...deps, config: cfg });
    expect(second.queuedFailed).toBeGreaterThanOrEqual(1);
    const after = await queryAsOrg<{ status: string; dispatch_error_class: string | null }>(
      org.org_id,
      'SELECT status, dispatch_error_class FROM govai.runs WHERE id = $1::uuid',
      [oldest],
    );
    expect(after[0]!.status).toBe('failed');
    expect(after[0]!.dispatch_error_class).toBe('dispatch_never_claimed');
  });
});

// =============================================================================
// T22 — cap carry: when a non-advancing head-of-line group is DEEPER than the
// whole per-sweep page budget (cap × batch), the cap-ended sweep must hand its
// cursor to the next sweep — otherwise every later sweep restarts at the same
// group and younger candidates stay permanently unreachable.
// =============================================================================

describe('T22 — cap-ended sweep resumes from its cursor on the next sweep', () => {
  it('20 locked candidates ahead (cap×batch budget), batch size 1: sweep 1 caps with a cursor, sweep 2 resumes and recovers the younger run', async () => {
    const org = await seedOrg(stack);
    const blockers: string[] = [];
    for (let i = 0; i < 20; i++) {
      // Strictly older than everything else, deterministic order.
      blockers.push(await seedStaleQueued(org, 600_000, { createdAgoMs: 400_000 - i * 1_000 }));
    }
    const younger = await seedStaleQueued(org, 600_000, { createdAgoMs: 60_000 });

    const deps = sweepDeps();
    const cfg = { ...deps.config, recoveryBatchSize: 1 };

    const locker = await stack.db.appPool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);
      await locker.query('SELECT 1 FROM govai.runs WHERE id = ANY($1::uuid[]) FOR UPDATE', [
        blockers,
      ]);

      // Sweep 1: the entire page budget (20 pages × 1) is consumed by the
      // locked group — cap hit, cursor handed out, younger NOT reached yet.
      const first = await runDispatchRecoverySweepOnce({ ...deps, config: cfg });
      expect(first.skipped).toBeGreaterThanOrEqual(20);
      expect(first.queuedFailed).toBe(0);
      expect(first.nextCursor).not.toBeNull();

      // Sweep 2 resumes from the carried cursor (exactly what the worker does)
      // and reaches the younger run in its FIRST page.
      const second = await runDispatchRecoverySweepOnce({ ...deps, config: cfg }, first.nextCursor);
      expect(second.queuedFailed).toBeGreaterThanOrEqual(1);
      await locker.query('ROLLBACK');
    } finally {
      locker.release();
    }

    const rows = await queryAsOrg<{ status: string; dispatch_error_class: string | null }>(
      org.org_id,
      'SELECT status, dispatch_error_class FROM govai.runs WHERE id = $1::uuid',
      [younger],
    );
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.dispatch_error_class).toBe('dispatch_never_claimed');

    // An EXHAUSTED sweep hands out no cursor — the next one restarts from the
    // oldest (retry semantics for the previously locked group, now unlocked).
    const third = await runDispatchRecoverySweepOnce(sweepDeps());
    expect(third.queuedFailed).toBeGreaterThanOrEqual(20);
    expect(third.nextCursor).toBeNull();
  });
});
