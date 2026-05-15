// Workroom Phase 1 (issue #49) — participant add/remove endpoint semantics.
//
// Covers POST /v1/workrooms/:id/participants and
// DELETE /v1/workrooms/:id/participants/:participant_id including RBAC
// (human_owner vs admin bootstrap vs non-owner), cross-column kind invariants,
// duplicate rejection, soft-remove, and the workroom.participant audit event.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  seedAgentProfile,
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

async function createWorkroom(org: DevOrg, mode?: 'governance_active' | 'audit_only'): Promise<string> {
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

describe('workroom-participants / add', () => {
  it('owner adds a human participant → 201', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, org.api_key, {
      kind: 'human',
      role: 'human_reviewer',
      user_id: randomUUID(),
    });
    expect(r.statusCode).toBe(201);
    const p = (r.body as Record<string, unknown>)['participant'] as Record<string, unknown>;
    expect(p['kind']).toBe('human');
    expect(p['role']).toBe('human_reviewer');
    expect(p['status']).toBe('active');
  });

  it('owner adds an agent participant referencing a seeded agent_profile → 201', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const profile = await seedAgentProfile(stack, { orgId: org.org_id });
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, org.api_key, {
      kind: 'agent',
      role: 'executor_agent',
      agent_profile_id: profile.id,
    });
    expect(r.statusCode).toBe(201);
    const p = (r.body as Record<string, unknown>)['participant'] as Record<string, unknown>;
    expect(p['kind']).toBe('agent');
    expect(p['agent_profile_id']).toBe(profile.id);
  });

  it('rejects missing user_id for a human participant → 400', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, org.api_key, {
      kind: 'human',
      role: 'human_reviewer',
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects missing agent_profile_id for an agent participant → 400', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, org.api_key, {
      kind: 'agent',
      role: 'executor_agent',
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects an agent participant for an unknown agent_profile → 404', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, org.api_key, {
      kind: 'agent',
      role: 'executor_agent',
      agent_profile_id: randomUUID(),
    });
    expect(r.statusCode).toBe(404);
    expect((r.body as { error?: string }).error).toBe('agent_profile_not_found');
  });

  it('rejects a disabled agent_profile → 400', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const profile = await seedAgentProfile(stack, { orgId: org.org_id, isDisabled: true });
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, org.api_key, {
      kind: 'agent',
      role: 'executor_agent',
      agent_profile_id: profile.id,
    });
    expect(r.statusCode).toBe(400);
    expect((r.body as { error?: string }).error).toBe('agent_profile_disabled');
  });

  it('rejects a duplicate active participant → 409', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const userId = randomUUID();
    const first = await inject(
      stack,
      'POST',
      `/v1/workrooms/${workroomId}/participants`,
      org.api_key,
      { kind: 'human', role: 'human_reviewer', user_id: userId },
    );
    expect(first.statusCode).toBe(201);
    const dup = await inject(
      stack,
      'POST',
      `/v1/workrooms/${workroomId}/participants`,
      org.api_key,
      { kind: 'human', role: 'human_reviewer', user_id: userId },
    );
    expect(dup.statusCode).toBe(409);
    expect((dup.body as { error?: string }).error).toBe('participant_already_active');
  });

  it('rejects a non-owner, non-admin key → 403', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    // A second developer key, bound to a different user — not the owner.
    const stranger = await addApiKey(stack, org.org_id, randomUUID(), ['developer']);
    const r = await inject(
      stack,
      'POST',
      `/v1/workrooms/${workroomId}/participants`,
      stranger.api_key,
      { kind: 'human', role: 'human_reviewer', user_id: randomUUID() },
    );
    expect(r.statusCode).toBe(403);
    expect((r.body as { error?: string }).error).toBe('forbidden');
  });

  it('admin bootstrap: an admin key may add a participant without being a participant', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const admin = await addApiKey(stack, org.org_id, randomUUID(), ['admin']);
    const r = await inject(
      stack,
      'POST',
      `/v1/workrooms/${workroomId}/participants`,
      admin.api_key,
      { kind: 'human', role: 'human_reviewer', user_id: randomUUID() },
    );
    expect(r.statusCode).toBe(201);
  });

  it('emits workroom.participant on the admin chain with workroom_governance_mode', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'audit_only');
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, org.api_key, {
      kind: 'human',
      role: 'human_reviewer',
      user_id: randomUUID(),
    });
    const auditEventId = (r.body as Record<string, unknown>)['audit_event_id'] as string;
    const events = await queryAsOrg<{
      chain_id: string;
      event_type: string;
      redaction_metadata: {
        workroom_participant?: { workroom_governance_mode?: string; transition?: string };
      };
    }>(
      org.org_id,
      'SELECT chain_id, event_type, redaction_metadata FROM govai.audit_events WHERE id = $1::uuid',
      [auditEventId],
    );
    expect(events.length).toBe(1);
    expect(events[0]!.event_type).toBe('workroom.participant');
    expect(events[0]!.chain_id).toBe(`${org.org_id}:admin`);
    expect(events[0]!.redaction_metadata.workroom_participant?.workroom_governance_mode).toBe(
      'audit_only',
    );
    expect(events[0]!.redaction_metadata.workroom_participant?.transition).toBe('added');
  });
});

describe('workroom-participants / remove', () => {
  it('owner removes a participant → 204 and the row is soft-removed', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const add = await inject(
      stack,
      'POST',
      `/v1/workrooms/${workroomId}/participants`,
      org.api_key,
      { kind: 'human', role: 'human_reviewer', user_id: randomUUID() },
    );
    const participantId = (
      (add.body as Record<string, unknown>)['participant'] as Record<string, unknown>
    )['id'] as string;
    const del = await inject(
      stack,
      'DELETE',
      `/v1/workrooms/${workroomId}/participants/${participantId}`,
      org.api_key,
    );
    expect(del.statusCode).toBe(204);

    const rows = await queryAsOrg<{ status: string; removed_at: Date | null }>(
      org.org_id,
      'SELECT status, removed_at FROM govai.workroom_participants WHERE id = $1::uuid',
      [participantId],
    );
    expect(rows[0]!.status).toBe('removed');
    expect(rows[0]!.removed_at).not.toBeNull();
  });

  it('rejects remove by a non-owner key → 403', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const add = await inject(
      stack,
      'POST',
      `/v1/workrooms/${workroomId}/participants`,
      org.api_key,
      { kind: 'human', role: 'human_reviewer', user_id: randomUUID() },
    );
    const participantId = (
      (add.body as Record<string, unknown>)['participant'] as Record<string, unknown>
    )['id'] as string;
    const stranger = await addApiKey(stack, org.org_id, randomUUID(), ['admin']);
    const del = await inject(
      stack,
      'DELETE',
      `/v1/workrooms/${workroomId}/participants/${participantId}`,
      stranger.api_key,
    );
    // No admin override for removal in Phase 1.
    expect(del.statusCode).toBe(403);
  });

  it('remove emits a workroom.participant removed audit event', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const add = await inject(
      stack,
      'POST',
      `/v1/workrooms/${workroomId}/participants`,
      org.api_key,
      { kind: 'human', role: 'human_reviewer', user_id: randomUUID() },
    );
    const participantId = (
      (add.body as Record<string, unknown>)['participant'] as Record<string, unknown>
    )['id'] as string;
    await inject(
      stack,
      'DELETE',
      `/v1/workrooms/${workroomId}/participants/${participantId}`,
      org.api_key,
    );
    const events = await queryAsOrg<{ transition: string }>(
      org.org_id,
      `SELECT (redaction_metadata->'workroom_participant'->>'transition') AS transition
         FROM govai.audit_events
        WHERE event_type = 'workroom.participant'
          AND subject_id = $1::uuid
        ORDER BY sequence_number`,
      [participantId],
    );
    const transitions = events.map((e) => e.transition);
    expect(transitions).toContain('added');
    expect(transitions).toContain('removed');
  });

  it('remove of an unknown participant → 404', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const del = await inject(
      stack,
      'DELETE',
      `/v1/workrooms/${workroomId}/participants/${randomUUID()}`,
      org.api_key,
    );
    expect(del.statusCode).toBe(404);
  });

  it('double remove → 409 participant_already_removed', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const add = await inject(
      stack,
      'POST',
      `/v1/workrooms/${workroomId}/participants`,
      org.api_key,
      { kind: 'human', role: 'human_reviewer', user_id: randomUUID() },
    );
    const participantId = (
      (add.body as Record<string, unknown>)['participant'] as Record<string, unknown>
    )['id'] as string;
    const first = await inject(
      stack,
      'DELETE',
      `/v1/workrooms/${workroomId}/participants/${participantId}`,
      org.api_key,
    );
    expect(first.statusCode).toBe(204);
    const second = await inject(
      stack,
      'DELETE',
      `/v1/workrooms/${workroomId}/participants/${participantId}`,
      org.api_key,
    );
    expect(second.statusCode).toBe(409);
  });
});
