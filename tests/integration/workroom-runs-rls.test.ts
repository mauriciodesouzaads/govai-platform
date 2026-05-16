// Workroom Phase 3 (issue #53) — Workroom-owned run RLS / participant binding.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  inject,
  type Stack,
} from './helpers/server-fixture.js';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

type DevOrg = { org_id: string; user_id: string; workspace_id: string; api_key: string };

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

async function createWorkroom(org: DevOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
    workspace_id: org.workspace_id,
    name: `room-${randomUUID().slice(0, 8)}`,
    governance_mode: 'governance_active',
  });
  expect(r.statusCode).toBe(201);
  return ((r.body as Record<string, unknown>)['workroom'] as Record<string, unknown>)[
    'id'
  ] as string;
}

const ANTHROPIC_RUN = { capability: 'anthropic.messages.create', model: 'claude-fixture-1' };

async function createRun(org: DevOrg, workroomId: string): Promise<void> {
  const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
    ...ANTHROPIC_RUN,
    input: `run-${randomUUID().slice(0, 8)}`,
  });
  expect(r.statusCode).toBe(201);
}

describe('workroom-runs-rls / POST', () => {
  it('rejects a non-participant → 403', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const stranger = await addApiKey(stack, org.org_id, randomUUID(), ['developer']);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, stranger.api_key, {
      ...ANTHROPIC_RUN,
      input: 'not a participant',
    });
    expect(r.statusCode).toBe(403);
  });

  it('rejects a removed participant → 403', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const memberUserId = randomUUID();
    const member = await addApiKey(stack, org.org_id, memberUserId, ['developer']);
    const add = await inject(
      stack,
      'POST',
      `/v1/workrooms/${workroomId}/participants`,
      org.api_key,
      { kind: 'human', role: 'human_reviewer', user_id: memberUserId },
    );
    const participantId = (
      (add.body as Record<string, unknown>)['participant'] as Record<string, unknown>
    )['id'] as string;
    // Active member can create a run.
    const ok = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, member.api_key, {
      ...ANTHROPIC_RUN,
      input: 'while active',
    });
    expect(ok.statusCode).toBe(201);
    // Owner removes the member.
    const del = await inject(
      stack,
      'DELETE',
      `/v1/workrooms/${workroomId}/participants/${participantId}`,
      org.api_key,
    );
    expect(del.statusCode).toBe(204);
    // Removed participant can no longer create runs.
    const denied = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, member.api_key, {
      ...ANTHROPIC_RUN,
      input: 'after removal',
    });
    expect(denied.statusCode).toBe(403);
  });

  it('rejects unauthenticated → 401', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, undefined, {
      ...ANTHROPIC_RUN,
      input: 'no auth',
    });
    expect(r.statusCode).toBe(401);
  });

  it('cross-org workroom is invisible → 404', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const workroomId = await createWorkroom(orgA);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, orgB.api_key, {
      ...ANTHROPIC_RUN,
      input: 'cross tenant',
    });
    expect(r.statusCode).toBe(404);
    expect((r.body as { error?: string }).error).toBe('workroom_not_found');
  });

  it('rejects a cross-workroom task → 404', async () => {
    const org = await devOrg();
    const workroomA = await createWorkroom(org);
    const workroomB = await createWorkroom(org);
    const taskRes = await inject(stack, 'POST', `/v1/workrooms/${workroomB}/tasks`, org.api_key, {
      title: 'task in B',
      risk_class: 'A',
      requires_approval: false,
    });
    const taskId = ((taskRes.body as Record<string, unknown>)['task'] as Record<string, unknown>)[
      'id'
    ] as string;
    // Task from workroom B cannot be linked to a run in workroom A.
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomA}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'cross-workroom task',
      workroom_task_id: taskId,
    });
    expect(r.statusCode).toBe(404);
    expect((r.body as { error?: string }).error).toBe('workroom_task_not_found');
  });
});

describe('workroom-runs-rls / GET', () => {
  it('active participant can list', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    await createRun(org, workroomId);
    const r = await inject(stack, 'GET', `/v1/workrooms/${workroomId}/runs`, org.api_key);
    expect(r.statusCode).toBe(200);
    expect((r.body as { runs: unknown[] }).runs.length).toBe(1);
  });

  it('auditor key (non-participant) can list', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    await createRun(org, workroomId);
    const auditor = await addApiKey(stack, org.org_id, randomUUID(), ['auditor']);
    const r = await inject(stack, 'GET', `/v1/workrooms/${workroomId}/runs`, auditor.api_key);
    expect(r.statusCode).toBe(200);
    expect((r.body as { runs: unknown[] }).runs.length).toBe(1);
  });

  it('non-participant without auditor/admin is denied → 403', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const stranger = await addApiKey(stack, org.org_id, randomUUID(), ['developer']);
    const r = await inject(stack, 'GET', `/v1/workrooms/${workroomId}/runs`, stranger.api_key);
    expect(r.statusCode).toBe(403);
  });

  it('list excludes other workrooms and other orgs', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const roomA1 = await createWorkroom(orgA);
    const roomA2 = await createWorkroom(orgA);
    await createRun(orgA, roomA1);
    await createRun(orgA, roomA2);

    const listA1 = await inject(stack, 'GET', `/v1/workrooms/${roomA1}/runs`, orgA.api_key);
    const runsA1 = (listA1.body as { runs: Array<Record<string, unknown>> }).runs;
    expect(runsA1.length).toBe(1);
    expect(runsA1[0]!['workroom_id']).toBe(roomA1);

    // Cross-org access to A1 is invisible.
    const cross = await inject(stack, 'GET', `/v1/workrooms/${roomA1}/runs`, orgB.api_key);
    expect(cross.statusCode).toBe(404);
  });
});
