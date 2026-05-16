// Workroom Phase 3 (issue #53) — Workroom-owned run creation, listing, and
// cross-link consistency between API response, govai.runs, govai.workroom_turns,
// and govai.audit_events.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sha256 } from '@govai/core-audit';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  inject,
  type Stack,
} from './helpers/server-fixture.js';
import { executeGovernedRun } from '../../apps/api/src/pipeline/run-orchestrator.js';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

type DevOrg = {
  org_id: string;
  user_id: string;
  workspace_id: string;
  api_key: string;
};

async function devOrg(): Promise<DevOrg> {
  const org = await seedOrg(stack);
  const dev = await addApiKey(stack, org.org_id, org.user_id, ['developer']);
  return {
    org_id: org.org_id,
    user_id: org.user_id,
    workspace_id: org.workspace_id,
    api_key: dev.api_key,
  };
}

async function createWorkroom(
  org: DevOrg,
  mode: 'governance_active' | 'audit_only',
): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
    workspace_id: org.workspace_id,
    name: `room-${randomUUID().slice(0, 8)}`,
    governance_mode: mode,
  });
  expect(r.statusCode).toBe(201);
  return ((r.body as Record<string, unknown>)['workroom'] as Record<string, unknown>)[
    'id'
  ] as string;
}

async function queryAsOrg<T = Record<string, unknown>>(
  orgId: string,
  sql: string,
  params: unknown[],
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

const ANTHROPIC_RUN = { capability: 'anthropic.messages.create', model: 'claude-fixture-1' };

describe('workroom-runs / governed creation', () => {
  it('governance_active workroom: omitted mode creates a governed Workroom-owned run', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'governance_active');
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'governed workroom run',
    });
    expect(r.statusCode).toBe(201);
    const body = r.body as Record<string, unknown>;
    expect(body['mode']).toBe('governed');
    expect(body['mode_relation']).toBe('defaulted');
    expect(body['status']).toBe('completed');
    expect(body['workroom_id']).toBe(workroomId);
    expect(body['workroom_governance_mode']).toBe('governance_active');
    expect(typeof body['workroom_turn_id']).toBe('string');
    expect(typeof body['turn_number']).toBe('number');
    expect(typeof body['audit_event_id']).toBe('string');
    expect(body['policy_decision']).toBeDefined();

    // govai.runs row carries the Workroom linkage.
    const runRows = await queryAsOrg<{
      mode: string;
      workroom_id: string;
      created_by_participant_id: string;
      workroom_governance_mode: string;
      status: string;
    }>(
      org.org_id,
      `SELECT mode, workroom_id, created_by_participant_id, workroom_governance_mode, status
         FROM govai.runs WHERE id = $1::uuid`,
      [body['run_id'] as string],
    );
    expect(runRows[0]!.mode).toBe('governed');
    expect(runRows[0]!.workroom_id).toBe(workroomId);
    expect(runRows[0]!.created_by_participant_id).toBe(body['created_by_participant_id']);
    expect(runRows[0]!.workroom_governance_mode).toBe('governance_active');
    expect(runRows[0]!.status).toBe(body['status']);

    // Exactly one run_event turn anchored to the run's real audit event.
    const turns = await queryAsOrg<{
      id: string;
      kind: string;
      payload_ref: string;
      audit_event_id: string;
      turn_number: string;
      workroom_id: string;
    }>(
      org.org_id,
      `SELECT id, kind, payload_ref, audit_event_id, turn_number, workroom_id
         FROM govai.workroom_turns WHERE payload_ref = $1::uuid AND kind = 'run_event'`,
      [body['run_id'] as string],
    );
    expect(turns.length).toBe(1);
    expect(turns[0]!.id).toBe(body['workroom_turn_id']);
    expect(turns[0]!.payload_ref).toBe(body['run_id']);
    expect(turns[0]!.workroom_id).toBe(workroomId);
    expect(turns[0]!.audit_event_id).toBe(body['audit_event_id']);
    expect(Number(turns[0]!.turn_number)).toBe(body['turn_number']);

    // The anchored audit event is a real run lifecycle event on the run chain.
    const events = await queryAsOrg<{ event_type: string; chain_id: string }>(
      org.org_id,
      'SELECT event_type, chain_id FROM govai.audit_events WHERE id = $1::uuid',
      [body['audit_event_id'] as string],
    );
    expect(['run.completed', 'run.failed', 'run.denied']).toContain(events[0]!.event_type);
    expect(events[0]!.chain_id).toBe(`${org.org_id}:run`);
  });

  it('governance_active workroom: explicit mode=governed → mode_relation explicit', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'governance_active');
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'explicit governed',
      mode: 'governed',
    });
    expect(r.statusCode).toBe(201);
    expect((r.body as Record<string, unknown>)['mode']).toBe('governed');
    expect((r.body as Record<string, unknown>)['mode_relation']).toBe('explicit');
  });

  it('links a same-workroom task to the run', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'governance_active');
    const taskRes = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/tasks`, org.api_key, {
      title: 'run task',
      risk_class: 'B',
      requires_approval: false,
    });
    const taskId = ((taskRes.body as Record<string, unknown>)['task'] as Record<string, unknown>)[
      'id'
    ] as string;
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'task linked run',
      workroom_task_id: taskId,
    });
    expect(r.statusCode).toBe(201);
    expect((r.body as Record<string, unknown>)['workroom_task_id']).toBe(taskId);
    const runRows = await queryAsOrg<{ workroom_task_id: string }>(
      org.org_id,
      'SELECT workroom_task_id FROM govai.runs WHERE id = $1::uuid',
      [(r.body as Record<string, unknown>)['run_id'] as string],
    );
    expect(runRows[0]!.workroom_task_id).toBe(taskId);
    // Task status is not mutated in Phase 3.
    const taskRows = await queryAsOrg<{ status: string }>(
      org.org_id,
      'SELECT status FROM govai.workroom_tasks WHERE id = $1::uuid',
      [taskId],
    );
    expect(taskRows[0]!.status).toBe('queued');
  });

  it('rejects an unknown workroom_task_id → 404', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'governance_active');
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'bad task',
      workroom_task_id: randomUUID(),
    });
    expect(r.statusCode).toBe(404);
    expect((r.body as { error?: string }).error).toBe('workroom_task_not_found');
  });
});

describe('workroom-runs / passthrough creation', () => {
  it('audit_only workroom: omitted mode creates a passthrough Workroom-owned run', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'audit_only');
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'passthrough workroom run',
    });
    expect(r.statusCode).toBe(201);
    const body = r.body as Record<string, unknown>;
    expect(body['mode']).toBe('passthrough');
    expect(body['mode_relation']).toBe('defaulted');
    expect(body['workroom_governance_mode']).toBe('audit_only');
    // Passthrough runs are observe-only — no governed policy_decision.
    expect(body['policy_decision']).toBeUndefined();
    expect(typeof body['provider_invocation_id']).toBe('string');

    const runRows = await queryAsOrg<{ mode: string; workroom_governance_mode: string }>(
      org.org_id,
      'SELECT mode, workroom_governance_mode FROM govai.runs WHERE id = $1::uuid',
      [body['run_id'] as string],
    );
    expect(runRows[0]!.mode).toBe('passthrough');
    expect(runRows[0]!.workroom_governance_mode).toBe('audit_only');

    const turns = await queryAsOrg<{ kind: string }>(
      org.org_id,
      `SELECT kind FROM govai.workroom_turns WHERE payload_ref = $1::uuid AND kind = 'run_event'`,
      [body['run_id'] as string],
    );
    expect(turns.length).toBe(1);

    const invRows = await queryAsOrg<{ id: string }>(
      org.org_id,
      'SELECT id FROM govai.provider_invocations WHERE id = $1::uuid AND run_id = $2::uuid',
      [body['provider_invocation_id'] as string, body['run_id'] as string],
    );
    expect(invRows.length).toBe(1);
  });

  it('audit_only workroom: explicit mode=passthrough → mode_relation explicit', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'audit_only');
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'explicit passthrough',
      mode: 'passthrough',
    });
    expect(r.statusCode).toBe(201);
    expect((r.body as Record<string, unknown>)['mode']).toBe('passthrough');
    expect((r.body as Record<string, unknown>)['mode_relation']).toBe('explicit');
  });

  it('audit_only workroom: explicit mode=governed → mode_relation upgrade', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'audit_only');
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'stricter governed upgrade',
      mode: 'governed',
    });
    expect(r.statusCode).toBe(201);
    const body = r.body as Record<string, unknown>;
    expect(body['mode']).toBe('governed');
    expect(body['mode_relation']).toBe('upgrade');
    const runRows = await queryAsOrg<{ mode: string; workroom_governance_mode: string }>(
      org.org_id,
      'SELECT mode, workroom_governance_mode FROM govai.runs WHERE id = $1::uuid',
      [body['run_id'] as string],
    );
    expect(runRows[0]!.mode).toBe('governed');
    expect(runRows[0]!.workroom_governance_mode).toBe('audit_only');
  });
});

describe('workroom-runs / listing', () => {
  it('lists governed and passthrough Workroom-owned runs, excluding standalone runs', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'audit_only');
    await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'wr run one',
    });
    await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'wr run two',
      mode: 'governed',
    });
    // A standalone /v1/runs run — must NOT appear in the workroom listing.
    const standalone = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      ...ANTHROPIC_RUN,
      input: 'standalone run',
    });
    expect(standalone.statusCode).toBe(200);
    const standaloneRunId = (standalone.body as Record<string, unknown>)['run_id'];

    const list = await inject(stack, 'GET', `/v1/workrooms/${workroomId}/runs`, org.api_key);
    expect(list.statusCode).toBe(200);
    const runs = (list.body as { runs: Array<Record<string, unknown>> }).runs;
    expect(runs.length).toBe(2);
    for (const run of runs) {
      expect(run['workroom_id']).toBe(workroomId);
      expect(typeof run['workroom_turn_id']).toBe('string');
      expect(typeof run['turn_number']).toBe('number');
      expect(typeof run['audit_event_id']).toBe('string');
    }
    expect(runs.map((r) => r['run_id'])).not.toContain(standaloneRunId);
  });

  it('GET supports mode filtering', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'audit_only');
    await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'pt run',
    });
    await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'gov run',
      mode: 'governed',
    });
    const r = await inject(
      stack,
      'GET',
      `/v1/workrooms/${workroomId}/runs?mode=governed`,
      org.api_key,
    );
    expect(r.statusCode).toBe(200);
    const runs = (r.body as { runs: Array<Record<string, unknown>> }).runs;
    expect(runs.length).toBe(1);
    expect(runs[0]!['mode']).toBe('governed');
  });
});

describe('workroom-runs / cross-link + standalone consistency', () => {
  it('standalone /v1/runs has all Workroom columns NULL', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      ...ANTHROPIC_RUN,
      input: 'plain standalone run',
    });
    expect(r.statusCode).toBe(200);
    const rows = await queryAsOrg<{
      workroom_id: string | null;
      workroom_task_id: string | null;
      created_by_participant_id: string | null;
      approval_policy_id: string | null;
      workroom_governance_mode: string | null;
    }>(
      org.org_id,
      `SELECT workroom_id, workroom_task_id, created_by_participant_id,
              approval_policy_id, workroom_governance_mode
         FROM govai.runs WHERE id = $1::uuid`,
      [(r.body as Record<string, unknown>)['run_id'] as string],
    );
    expect(rows[0]!.workroom_id).toBeNull();
    expect(rows[0]!.workroom_task_id).toBeNull();
    expect(rows[0]!.created_by_participant_id).toBeNull();
    expect(rows[0]!.approval_policy_id).toBeNull();
    expect(rows[0]!.workroom_governance_mode).toBeNull();
    // Standalone runs create no workroom_turns.
    const turns = await queryAsOrg<{ id: string }>(
      org.org_id,
      `SELECT id FROM govai.workroom_turns WHERE payload_ref = $1::uuid AND kind = 'run_event'`,
      [(r.body as Record<string, unknown>)['run_id'] as string],
    );
    expect(turns.length).toBe(0);
  });

  it('atomicity: a failed Workroom attachment commits no run and no turn', async () => {
    // Calling the orchestrator directly with a WorkroomRunContext whose
    // workroom_id does not exist forces the govai.runs FK to fail inside the
    // run transaction. The whole transaction must roll back: no run row, no
    // turn — proving a Workroom-owned run is never half-committed.
    const org = await devOrg();
    const deps = {
      pool: stack.app.govai.pool,
      kms: stack.app.govai.kms,
      env: stack.app.govai.env,
      policyCommitSha: stack.app.govai.policyCommitSha,
    };
    const bogusWorkroomId = randomUUID();
    let threw = false;
    try {
      await executeGovernedRun(
        deps,
        org.api_key,
        { workspace_id: org.workspace_id, ...ANTHROPIC_RUN, input: 'atomicity probe' },
        {
          workroom_id: bogusWorkroomId,
          workroom_task_id: null,
          created_by_participant_id: randomUUID(),
          workroom_governance_mode: 'governance_active',
          approval_policy_id: null,
        },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // No run row references the bogus workroom; no run_event turn exists for it.
    const runRows = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.runs WHERE workroom_id = $1::uuid',
      [bogusWorkroomId],
    );
    expect(Number(runRows[0]!.n)).toBe(0);
    const turnRows = await queryAsOrg<{ n: string }>(
      org.org_id,
      "SELECT COUNT(*) AS n FROM govai.workroom_turns WHERE workroom_id = $1::uuid AND kind = 'run_event'",
      [bogusWorkroomId],
    );
    expect(Number(turnRows[0]!.n)).toBe(0);
  });
});

describe('workroom-runs / TOCTOU revalidation (Codex P1)', () => {
  it('a participant removed after preflight is rejected at run write time — no run/turn', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'governance_active');
    // Add then remove a participant; its id is now stale (status='removed').
    const memberUserId = randomUUID();
    await addApiKey(stack, org.org_id, memberUserId, ['developer']);
    const add = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, org.api_key, {
      kind: 'human',
      role: 'human_reviewer',
      user_id: memberUserId,
    });
    const staleParticipantId = (
      (add.body as Record<string, unknown>)['participant'] as Record<string, unknown>
    )['id'] as string;
    const del = await inject(
      stack,
      'DELETE',
      `/v1/workrooms/${workroomId}/participants/${staleParticipantId}`,
      org.api_key,
    );
    expect(del.statusCode).toBe(204);

    // Direct orchestrator call with the now-removed participant in the context —
    // the transaction-local revalidation must reject it.
    const deps = {
      pool: stack.app.govai.pool,
      kms: stack.app.govai.kms,
      env: stack.app.govai.env,
      policyCommitSha: stack.app.govai.policyCommitSha,
    };
    let caught: { code?: string } | null = null;
    try {
      await executeGovernedRun(
        deps,
        org.api_key,
        { workspace_id: org.workspace_id, ...ANTHROPIC_RUN, input: 'toctou participant probe' },
        {
          workroom_id: workroomId,
          workroom_task_id: null,
          created_by_participant_id: staleParticipantId,
          workroom_governance_mode: 'governance_active',
          approval_policy_id: null,
        },
      );
    } catch (err) {
      caught = err as { code?: string };
    }
    expect(caught).not.toBeNull();
    expect(caught!.code).toBe('workroom_participant_not_active');
    // No run row with the stale participant, no run_event turn.
    const runRows = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.runs WHERE workroom_id = $1::uuid AND created_by_participant_id = $2::uuid',
      [workroomId, staleParticipantId],
    );
    expect(Number(runRows[0]!.n)).toBe(0);
    const turnRows = await queryAsOrg<{ n: string }>(
      org.org_id,
      "SELECT COUNT(*) AS n FROM govai.workroom_turns WHERE workroom_id = $1::uuid AND kind = 'run_event'",
      [workroomId],
    );
    expect(Number(turnRows[0]!.n)).toBe(0);
  });

  it('a cross-workroom task is rejected at run write time — no run/turn', async () => {
    const org = await devOrg();
    const workroomA = await createWorkroom(org, 'governance_active');
    const workroomB = await createWorkroom(org, 'governance_active');
    // A real task, but in workroom B.
    const taskRes = await inject(stack, 'POST', `/v1/workrooms/${workroomB}/tasks`, org.api_key, {
      title: 'task in B',
      risk_class: 'A',
      requires_approval: false,
    });
    const taskBId = ((taskRes.body as Record<string, unknown>)['task'] as Record<string, unknown>)[
      'id'
    ] as string;
    // workroom A's active human_owner participant (valid participant, stale task).
    const ownerRows = await queryAsOrg<{ id: string }>(
      org.org_id,
      `SELECT id FROM govai.workroom_participants
        WHERE workroom_id = $1::uuid AND role = 'human_owner' AND status = 'active'`,
      [workroomA],
    );
    const ownerParticipantId = ownerRows[0]!.id;

    const deps = {
      pool: stack.app.govai.pool,
      kms: stack.app.govai.kms,
      env: stack.app.govai.env,
      policyCommitSha: stack.app.govai.policyCommitSha,
    };
    let caught: { code?: string } | null = null;
    try {
      await executeGovernedRun(
        deps,
        org.api_key,
        { workspace_id: org.workspace_id, ...ANTHROPIC_RUN, input: 'toctou task probe' },
        {
          workroom_id: workroomA,
          workroom_task_id: taskBId,
          created_by_participant_id: ownerParticipantId,
          workroom_governance_mode: 'governance_active',
          approval_policy_id: null,
        },
      );
    } catch (err) {
      caught = err as { code?: string };
    }
    expect(caught).not.toBeNull();
    expect(caught!.code).toBe('workroom_task_not_found');
    const runRows = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.runs WHERE workroom_id = $1::uuid',
      [workroomA],
    );
    expect(Number(runRows[0]!.n)).toBe(0);
    const turnRows = await queryAsOrg<{ n: string }>(
      org.org_id,
      "SELECT COUNT(*) AS n FROM govai.workroom_turns WHERE workroom_id = $1::uuid AND kind = 'run_event'",
      [workroomA],
    );
    expect(Number(turnRows[0]!.n)).toBe(0);
  });
});

describe('workroom-runs / deterministic pagination (Codex P2)', () => {
  it('pages through identical-created_at runs with no loss and no duplicates', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'audit_only');
    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
        ...ANTHROPIC_RUN,
        input: `paginated run ${i}`,
      });
      expect(r.statusCode).toBe(201);
      created.push((r.body as Record<string, unknown>)['run_id'] as string);
    }
    // Force an identical created_at across all three so created_at alone is an
    // ambiguous cursor — the (created_at, id) tiebreaker must keep them stable.
    const adminC = await stack.db.adminPool.connect();
    try {
      await adminC.query(
        "UPDATE govai.runs SET created_at = '2026-01-01T00:00:00Z' WHERE id = ANY($1::uuid[])",
        [created],
      );
    } finally {
      adminC.release();
    }

    const page1 = await inject(stack, 'GET', `/v1/workrooms/${workroomId}/runs?limit=2`, org.api_key);
    expect(page1.statusCode).toBe(200);
    const b1 = page1.body as Record<string, unknown>;
    const runs1 = b1['runs'] as Array<Record<string, unknown>>;
    expect(runs1.length).toBe(2);
    const cursor = b1['next_cursor'] as { before_created_at: string; before_id: string } | null;
    expect(cursor).not.toBeNull();
    expect(typeof cursor!.before_created_at).toBe('string');
    expect(typeof cursor!.before_id).toBe('string');

    const page2 = await inject(
      stack,
      'GET',
      `/v1/workrooms/${workroomId}/runs?limit=2&before_created_at=${encodeURIComponent(cursor!.before_created_at)}&before_id=${cursor!.before_id}`,
      org.api_key,
    );
    expect(page2.statusCode).toBe(200);
    const runs2 = (page2.body as { runs: Array<Record<string, unknown>> }).runs;
    expect(runs2.length).toBe(1);
    expect((page2.body as Record<string, unknown>)['next_cursor']).toBeNull();

    // All three runs reachable exactly once across the two pages.
    const seen = [...runs1, ...runs2].map((r) => r['run_id'] as string);
    expect(new Set(seen).size).toBe(3);
    expect(seen.slice().sort()).toEqual(created.slice().sort());
  });

  it('before_created_at without before_id → 400', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'audit_only');
    const r = await inject(
      stack,
      'GET',
      `/v1/workrooms/${workroomId}/runs?before_created_at=${encodeURIComponent('2026-01-01T00:00:00Z')}`,
      org.api_key,
    );
    expect(r.statusCode).toBe(400);
    expect((r.body as { error?: string }).error).toBe('invalid_query');
  });

  it('before_id without before_created_at → 400', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'audit_only');
    const r = await inject(
      stack,
      'GET',
      `/v1/workrooms/${workroomId}/runs?before_id=${randomUUID()}`,
      org.api_key,
    );
    expect(r.statusCode).toBe(400);
    expect((r.body as { error?: string }).error).toBe('invalid_query');
  });
});

describe('workroom-runs / governed network failure hash', () => {
  it('a Workroom-owned governed run that fails on network persists a real native_request_hash', async () => {
    // A fresh stack pointed at a closed loopback port: the governed handler's
    // fetch fails, exercising the governed network/fetch failure path.
    const failStack = await startStack({
      GOVAI_PROVIDER_BASE_URL: 'http://127.0.0.1:1' as unknown as string,
    });
    try {
      const org = await seedOrg(failStack);
      const dev = await addApiKey(failStack, org.org_id, org.user_id, ['developer']);
      const wr = await inject(failStack, 'POST', '/v1/workrooms', dev.api_key, {
        workspace_id: org.workspace_id,
        name: `room-${randomUUID().slice(0, 8)}`,
        governance_mode: 'governance_active',
      });
      const workroomId = ((wr.body as Record<string, unknown>)['workroom'] as Record<
        string,
        unknown
      >)['id'] as string;

      const input = 'governed workroom run hitting an unreachable upstream';
      const expectedBody = JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 1024,
        messages: [{ role: 'user', content: input }],
      });
      const expectedHash = Buffer.from(sha256(Buffer.from(expectedBody, 'utf8'))).toString('hex');

      const r = await inject(failStack, 'POST', `/v1/workrooms/${workroomId}/runs`, dev.api_key, {
        ...ANTHROPIC_RUN,
        input,
      });
      expect(r.statusCode).toBe(201);
      const body = r.body as Record<string, unknown>;
      expect(body['mode']).toBe('governed');
      expect(body['status']).toBe('failed');
      const runId = body['run_id'] as string;

      const c = await failStack.db.appPool.connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);

        // provider_invocations.native_request_hash is the real sha256 — never '\x00'.
        const inv = await c.query<{ native_request_hash: Buffer; error_class: string }>(
          'SELECT native_request_hash, error_class FROM govai.provider_invocations WHERE run_id = $1::uuid',
          [runId],
        );
        expect(inv.rows.length).toBe(1);
        expect(inv.rows[0]!.error_class).toBe('network_error');
        const dbHashHex = inv.rows[0]!.native_request_hash.toString('hex');
        expect(dbHashHex).toBe(expectedHash);
        expect(dbHashHex).not.toBe('00');
        expect(dbHashHex.length).toBe(64);

        // The run_event turn anchors to a real run.failed audit event.
        const turn = await c.query<{ audit_event_id: string }>(
          `SELECT audit_event_id FROM govai.workroom_turns
            WHERE payload_ref = $1::uuid AND kind = 'run_event'`,
          [runId],
        );
        expect(turn.rows.length).toBe(1);
        expect(turn.rows[0]!.audit_event_id).toBe(body['audit_event_id']);
        const ev = await c.query<{ event_type: string }>(
          'SELECT event_type FROM govai.audit_events WHERE id = $1::uuid',
          [turn.rows[0]!.audit_event_id],
        );
        expect(ev.rows[0]!.event_type).toBe('run.failed');

        await c.query('COMMIT');
      } finally {
        c.release();
      }
    } finally {
      await stopStack(failStack);
    }
  }, 240_000);
});
