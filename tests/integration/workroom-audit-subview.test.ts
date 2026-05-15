// Workroom Phase 2 (issue #51) — workroom-scoped audit subview semantics.

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

async function createWorkroom(org: DevOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
    workspace_id: org.workspace_id,
    name: `room-${randomUUID().slice(0, 8)}`,
  });
  expect(r.statusCode).toBe(201);
  return ((r.body as Record<string, unknown>)['workroom'] as Record<string, unknown>)[
    'id'
  ] as string;
}

/** Drive a workroom through lifecycle + participant + message + task turns. */
async function populate(org: DevOrg, workroomId: string): Promise<void> {
  await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, org.api_key, {
    kind: 'human',
    role: 'human_reviewer',
    user_id: randomUUID(),
  });
  await inject(stack, 'POST', `/v1/workrooms/${workroomId}/messages`, org.api_key, {
    role: 'user',
    content: 'a message',
  });
  await inject(stack, 'POST', `/v1/workrooms/${workroomId}/tasks`, org.api_key, {
    title: 'a task',
    risk_class: 'A',
    requires_approval: false,
  });
}

describe('workroom-audit-subview', () => {
  it('auditor sees lifecycle, participant, message, and task anchors for the workroom', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    await populate(org, workroomId);
    const auditor = await addApiKey(stack, org.org_id, randomUUID(), ['auditor']);

    const r = await inject(stack, 'GET', `/v1/workrooms/${workroomId}/audit`, auditor.api_key);
    expect(r.statusCode).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body['workroom_governance_mode']).toBe('governance_active');
    const events = body['audit_events'] as Array<Record<string, unknown>>;
    const eventTypes = new Set(events.map((e) => e['event_type']));
    expect(eventTypes.has('workroom.lifecycle')).toBe(true);
    expect(eventTypes.has('workroom.participant')).toBe(true);
    expect(eventTypes.has('workroom.message')).toBe(true);
    expect(eventTypes.has('workroom.task.created')).toBe(true);

    const turnKinds = new Set(events.map((e) => e['turn_kind']));
    expect(turnKinds.has('message')).toBe(true);
    expect(turnKinds.has('task')).toBe(true);

    for (const e of events) {
      expect(typeof e['audit_event_id']).toBe('string');
      expect(typeof e['sequence_number']).toBe('number');
      expect(typeof e['payload_hash']).toBe('string');
      expect(e['workroom_governance_mode']).toBe('governance_active');
      // No encrypted payload bytes / DEKs.
      expect(e['encrypted_payload']).toBeUndefined();
      expect(e['dek_wrapped']).toBeUndefined();
    }
    // chain_category is derived from the existing chain — no new chain.
    for (const e of events) {
      expect(['run', 'admin', 'policy', 'auth']).toContain(e['chain_category']);
    }
  });

  it('admin role may also query the audit subview', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const admin = await addApiKey(stack, org.org_id, randomUUID(), ['admin']);
    const r = await inject(stack, 'GET', `/v1/workrooms/${workroomId}/audit`, admin.api_key);
    expect(r.statusCode).toBe(200);
  });

  it('a developer (non-auditor) is denied → 403', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'GET', `/v1/workrooms/${workroomId}/audit`, org.api_key);
    expect(r.statusCode).toBe(403);
    expect((r.body as { error?: string }).error).toBe('forbidden');
  });

  it('unauthenticated → 401', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'GET', `/v1/workrooms/${workroomId}/audit`, undefined);
    expect(r.statusCode).toBe(401);
  });

  it('audit subview excludes other workrooms and other orgs', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const roomA1 = await createWorkroom(orgA);
    const roomA2 = await createWorkroom(orgA);
    await populate(orgA, roomA1);
    await populate(orgA, roomA2);
    const auditorA = await addApiKey(stack, orgA.org_id, randomUUID(), ['auditor']);

    const r = await inject(stack, 'GET', `/v1/workrooms/${roomA1}/audit`, auditorA.api_key);
    const events = (r.body as { audit_events: Array<Record<string, unknown>> }).audit_events;
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e['workroom_turn_id']).toBeDefined();
    }
    // Cross-org auditor cannot see org A's workroom.
    const auditorB = await addApiKey(stack, orgB.org_id, randomUUID(), ['auditor']);
    const cross = await inject(stack, 'GET', `/v1/workrooms/${roomA1}/audit`, auditorB.api_key);
    expect(cross.statusCode).toBe(404);
  });

  it('supports limit pagination', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    await populate(org, workroomId);
    const auditor = await addApiKey(stack, org.org_id, randomUUID(), ['auditor']);
    const r = await inject(
      stack,
      'GET',
      `/v1/workrooms/${workroomId}/audit?limit=2`,
      auditor.api_key,
    );
    expect(r.statusCode).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect((body['audit_events'] as unknown[]).length).toBe(2);
    expect(typeof body['next_before_seq']).toBe('number');
  });
});
