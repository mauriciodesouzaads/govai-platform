// EP-P03A-A (F3) — T7 (stale queued), T8 (stale running), T16 (recovery
// idempotency) + the recovery worker lifecycle (start onReady / clean stop).
//
// The sweep function is driven directly (the fixture stack keeps the periodic
// worker DISABLED) so every transition is deterministic; the lifecycle test
// opts the worker in on a dedicated server and watches it recover a seeded
// stale run on database time — no provider is ever called by recovery.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DevKms } from '@govai/core-identity';
import { buildServer } from '../../apps/api/src/server.js';
import { runDispatchRecoverySweepOnce } from '../../apps/api/src/pipeline/run-dispatch-recovery.js';
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
  opts: { deadlineAgoMs?: number } = {},
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
          dispatch_timeout_ms, dispatch_deadline_at, started_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'claude-fixture-1',
          'governed', 'running', '{}'::jsonb, 1,
          now() - make_interval(secs => ($5::integer + 60000) / 1000.0),
          $6::uuid,
          now() - make_interval(secs => ($5::integer + 30000) / 1000.0),
          60000,
          now() - make_interval(secs => $5::integer / 1000.0),
          now() - make_interval(secs => ($5::integer + 30000) / 1000.0))`,
      [runId, org.org_id, org.workspace_id, org.user_id, ago, token],
    );
    await c.query('COMMIT');
  } finally {
    c.release();
  }
  return { runId, token };
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

describe('T8 — stale running recovery', () => {
  it('running past deadline+grace → outcome_unknown stale_dispatch_claim; NO redispatch', async () => {
    const org = await seedOrg(stack);
    const { runId, token } = await seedStaleRunning(org);
    stack.provider.clearRecordedRequestHeaders();

    const r = await runDispatchRecoverySweepOnce(sweepDeps());
    expect(r.runningUnknown).toBeGreaterThanOrEqual(1);

    const rows = await queryAsOrg<{
      status: string;
      dispatch_error_class: string | null;
      outcome_unknown_at: Date | null;
      completed_at: Date | null;
      dispatch_token: string | null;
    }>(
      org.org_id,
      `SELECT status, dispatch_error_class, outcome_unknown_at, completed_at, dispatch_token
         FROM govai.runs WHERE id = $1::uuid`,
      [runId],
    );
    expect(rows[0]!.status).toBe('outcome_unknown');
    expect(rows[0]!.dispatch_error_class).toBe('stale_dispatch_claim');
    expect(rows[0]!.outcome_unknown_at).not.toBeNull();
    expect(rows[0]!.completed_at).toBeNull();
    expect(rows[0]!.dispatch_token).toBe(token); // the claim token is preserved

    const types = await auditEventTypes(org.org_id, runId);
    expect(types.filter((t) => t === 'run.outcome_unknown')).toHaveLength(1);
    expect(types).not.toContain('run.failed');

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

describe('T16 — recovery idempotency', () => {
  it('repeated sweeps: single transition, single lifecycle event, zero provider calls', async () => {
    const org = await seedOrg(stack);
    const queuedId = await seedStaleQueued(org);
    const { runId: runningId } = await seedStaleRunning(org);
    stack.provider.clearRecordedRequestHeaders();

    await runDispatchRecoverySweepOnce(sweepDeps());
    await runDispatchRecoverySweepOnce(sweepDeps());
    const third = await runDispatchRecoverySweepOnce(sweepDeps());
    // After convergence nothing else transitions.
    expect(third.queuedFailed).toBe(0);
    expect(third.runningUnknown).toBe(0);

    const queuedTypes = await auditEventTypes(org.org_id, queuedId);
    expect(queuedTypes.filter((t) => t === 'run.failed')).toHaveLength(1);
    const runningTypes = await auditEventTypes(org.org_id, runningId);
    expect(runningTypes.filter((t) => t === 'run.outcome_unknown')).toHaveLength(1);

    expect(
      stack.provider.recordedRequestHeaders.filter(
        (h) => h['x-test-workspace-id'] === org.workspace_id,
      ),
    ).toHaveLength(0);
  });
});

describe('recovery worker lifecycle (§25)', () => {
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
