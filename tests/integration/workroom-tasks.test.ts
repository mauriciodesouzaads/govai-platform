// Workroom Phase 2 (issue #51) — task creation endpoint semantics.

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
  mode?: 'governance_active' | 'audit_only',
): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
    workspace_id: org.workspace_id,
    name: `room-${randomUUID().slice(0, 8)}`,
    ...(mode ? { governance_mode: mode } : {}),
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

describe('workroom-tasks / create', () => {
  it('creates a task for an active participant → 201, persists plain metadata + flags', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'audit_only');
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/tasks`, org.api_key, {
      title: 'Implement migration 0013',
      description: 'add the three Phase 2 tables',
      risk_class: 'C',
      requires_approval: true,
    });
    expect(r.statusCode).toBe(201);
    const task = (r.body as Record<string, unknown>)['task'] as Record<string, unknown>;
    expect(task['title']).toBe('Implement migration 0013');
    expect(task['description']).toBe('add the three Phase 2 tables');
    expect(task['risk_class']).toBe('C');
    expect(task['requires_approval']).toBe(true);
    expect(task['status']).toBe('queued');
    expect((r.body as Record<string, unknown>)['governance_mode']).toBe('audit_only');

    const rows = await queryAsOrg<{
      title: string;
      risk_class: string;
      requires_approval: boolean;
      status: string;
    }>(
      org.org_id,
      'SELECT title, risk_class, requires_approval, status FROM govai.workroom_tasks WHERE id = $1::uuid',
      [task['id'] as string],
    );
    expect(rows[0]!.title).toBe('Implement migration 0013');
    expect(rows[0]!.risk_class).toBe('C');
    expect(rows[0]!.requires_approval).toBe(true);
    expect(rows[0]!.status).toBe('queued');
  });

  it('creates a task turn and a workroom.task.created audit event', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/tasks`, org.api_key, {
      title: 'Write tests',
      risk_class: 'A',
      requires_approval: false,
    });
    const body = r.body as Record<string, unknown>;
    const task = body['task'] as Record<string, unknown>;
    const turnId = task['workroom_turn_id'] as string;
    const auditEventId = body['audit_event_id'] as string;

    const turns = await queryAsOrg<{ kind: string; audit_event_id: string; payload_ref: string }>(
      org.org_id,
      'SELECT kind, audit_event_id, payload_ref FROM govai.workroom_turns WHERE id = $1::uuid',
      [turnId],
    );
    expect(turns[0]!.kind).toBe('task');
    expect(turns[0]!.audit_event_id).toBe(auditEventId);
    expect(turns[0]!.payload_ref).toBe(task['id']);

    const events = await queryAsOrg<{
      event_type: string;
      chain_id: string;
      redaction_metadata: { workroom_task_created?: { workroom_governance_mode?: string } };
    }>(
      org.org_id,
      'SELECT event_type, chain_id, redaction_metadata FROM govai.audit_events WHERE id = $1::uuid',
      [auditEventId],
    );
    expect(events[0]!.event_type).toBe('workroom.task.created');
    expect(events[0]!.chain_id).toBe(`${org.org_id}:run`);
    expect(events[0]!.redaction_metadata.workroom_task_created?.workroom_governance_mode).toBe(
      'governance_active',
    );
  });

  it('accepts an active same-workroom assigned_participant_id', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const assigneeUserId = randomUUID();
    const add = await inject(
      stack,
      'POST',
      `/v1/workrooms/${workroomId}/participants`,
      org.api_key,
      { kind: 'human', role: 'human_reviewer', user_id: assigneeUserId },
    );
    const assigneeParticipantId = (
      (add.body as Record<string, unknown>)['participant'] as Record<string, unknown>
    )['id'] as string;
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/tasks`, org.api_key, {
      title: 'Assigned task',
      risk_class: 'B',
      requires_approval: false,
      assigned_participant_id: assigneeParticipantId,
    });
    expect(r.statusCode).toBe(201);
    expect(
      ((r.body as Record<string, unknown>)['task'] as Record<string, unknown>)[
        'assigned_participant_id'
      ],
    ).toBe(assigneeParticipantId);
  });

  it('rejects an unknown assigned_participant_id → 404', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/tasks`, org.api_key, {
      title: 'Bad assignee',
      risk_class: 'A',
      requires_approval: false,
      assigned_participant_id: randomUUID(),
    });
    expect(r.statusCode).toBe(404);
    expect((r.body as { error?: string }).error).toBe('assigned_participant_not_found');
  });

  it('rejects an invalid risk_class → 400', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/tasks`, org.api_key, {
      title: 'Bad risk',
      risk_class: 'Z',
      requires_approval: false,
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects a non-participant → 403', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const stranger = await addApiKey(stack, org.org_id, randomUUID(), ['developer']);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/tasks`, stranger.api_key, {
      title: 'Not a member',
      risk_class: 'A',
      requires_approval: false,
    });
    expect(r.statusCode).toBe(403);
  });

  it('cross-org task creation returns 404', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const workroomId = await createWorkroom(orgA);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/tasks`, orgB.api_key, {
      title: 'cross tenant',
      risk_class: 'A',
      requires_approval: false,
    });
    expect(r.statusCode).toBe(404);
  });
});
