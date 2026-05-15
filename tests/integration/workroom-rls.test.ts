// Workroom Phase 1 (issue #49) — tenant isolation / RLS.
//
// Cross-org reads return 404 (invisible row, never a leak); cross-org writes
// are blocked by RLS WITH CHECK / USING. Covers workrooms, participants,
// workroom_turns, and the reused audit_events rows.

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

async function asOrg(
  orgId: string,
  fn: (c: import('pg').PoolClient) => Promise<void>,
): Promise<void> {
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    await fn(c);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

describe('workroom-rls / tenant isolation', () => {
  it('cross-org GET by id returns 404', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const workroomId = await createWorkroom(orgA);
    const r = await inject(stack, 'GET', `/v1/workrooms/${workroomId}`, orgB.api_key);
    expect(r.statusCode).toBe(404);
  });

  it('GET list is scoped to the caller org', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const aId = await createWorkroom(orgA);
    await createWorkroom(orgB);
    const listB = await inject(stack, 'GET', '/v1/workrooms', orgB.api_key);
    const ids = (listB.body as { data: Array<Record<string, unknown>> }).data.map((w) => w['id']);
    expect(ids).not.toContain(aId);
    for (const row of (listB.body as { data: Array<Record<string, unknown>> }).data) {
      expect(row['org_id']).toBe(orgB.org_id);
    }
  });

  it('cross-org participant add is invisible (404 workroom_not_found)', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const workroomId = await createWorkroom(orgA);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, orgB.api_key, {
      kind: 'human',
      role: 'human_reviewer',
      user_id: randomUUID(),
    });
    expect(r.statusCode).toBe(404);
    expect((r.body as { error?: string }).error).toBe('workroom_not_found');
  });

  it('cross-org participant delete is invisible (404 workroom_not_found)', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const workroomId = await createWorkroom(orgA);
    const r = await inject(
      stack,
      'DELETE',
      `/v1/workrooms/${workroomId}/participants/${randomUUID()}`,
      orgB.api_key,
    );
    expect(r.statusCode).toBe(404);
  });

  it('workroom_turns are invisible cross-org', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const workroomId = await createWorkroom(orgA);
    await asOrg(orgB.org_id, async (c) => {
      const r = await c.query(
        'SELECT id FROM govai.workroom_turns WHERE workroom_id = $1::uuid',
        [workroomId],
      );
      expect(r.rowCount).toBe(0);
    });
    // The owning org still sees its own turn.
    await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(
        'SELECT id FROM govai.workroom_turns WHERE workroom_id = $1::uuid',
        [workroomId],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it('reused audit_events rows are invisible cross-org', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    await createWorkroom(orgA);
    await asOrg(orgB.org_id, async (c) => {
      const r = await c.query(
        "SELECT id FROM govai.audit_events WHERE event_type = 'workroom.lifecycle' AND org_id = $1::uuid",
        [orgA.org_id],
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it('direct cross-org INSERT is blocked by RLS WITH CHECK', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    let blocked = false;
    try {
      await asOrg(orgB.org_id, async (c) => {
        await c.query(
          `INSERT INTO govai.workroom_policy_profiles
             (org_id, name, governance_mode, default_provider_surface, max_risk_without_approval)
           VALUES ($1::uuid, $2::text, 'governance_active', 'governed', 'C')`,
          [orgA.org_id, `cross-org-${randomUUID()}`],
        );
      });
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it('direct cross-org UPDATE affects zero rows under RLS', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const workroomId = await createWorkroom(orgA);
    const firstParticipant = await inject(
      stack,
      'POST',
      `/v1/workrooms/${workroomId}/participants`,
      orgA.api_key,
      { kind: 'human', role: 'human_reviewer', user_id: randomUUID() },
    );
    const participantId = (
      (firstParticipant.body as Record<string, unknown>)['participant'] as Record<string, unknown>
    )['id'] as string;
    await asOrg(orgB.org_id, async (c) => {
      const r = await c.query(
        "UPDATE govai.workroom_participants SET status = 'removed' WHERE id = $1::uuid",
        [participantId],
      );
      expect(r.rowCount).toBe(0);
    });
  });
});
