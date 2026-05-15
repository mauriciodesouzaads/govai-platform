// Workroom Phase 1 (issue #49) — governance_mode behavior.
//
// governance_mode is real (persisted + surfaced), defaults to governance_active,
// is immutable at the DB layer, and is gated by the org-level audit-only
// admission setting. Confirms the workroom work did not regress /v1/runs and
// did not reintroduce lookupOperationalMode.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  setOrgWorkroomAuditOnlyDisallowed,
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

describe('workroom-governance-mode', () => {
  it('defaults to governance_active and persists it', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'default mode',
    });
    expect(r.statusCode).toBe(201);
    const id = ((r.body as Record<string, unknown>)['workroom'] as Record<string, unknown>)[
      'id'
    ] as string;
    const got = await inject(stack, 'GET', `/v1/workrooms/${id}`, org.api_key);
    expect((got.body as Record<string, unknown>)['governance_mode']).toBe('governance_active');
  });

  it('persists explicit audit_only and surfaces it on read', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'audit only mode',
      governance_mode: 'audit_only',
    });
    const id = ((r.body as Record<string, unknown>)['workroom'] as Record<string, unknown>)[
      'id'
    ] as string;
    const got = await inject(stack, 'GET', `/v1/workrooms/${id}`, org.api_key);
    expect((got.body as Record<string, unknown>)['governance_mode']).toBe('audit_only');
  });

  it('rejects a direct DB UPDATE of workrooms.governance_mode', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'immutable mode',
    });
    const id = ((r.body as Record<string, unknown>)['workroom'] as Record<string, unknown>)[
      'id'
    ] as string;
    let blocked = false;
    const c = await stack.db.adminPool.connect();
    try {
      await c.query("UPDATE govai.workrooms SET governance_mode = 'audit_only' WHERE id = $1::uuid", [
        id,
      ]);
    } catch {
      blocked = true;
    } finally {
      c.release();
    }
    expect(blocked).toBe(true);
    // The persisted mode is unchanged.
    const got = await inject(stack, 'GET', `/v1/workrooms/${id}`, org.api_key);
    expect((got.body as Record<string, unknown>)['governance_mode']).toBe('governance_active');
  });

  it('org-level audit_only disallow gate works', async () => {
    const org = await devOrg();
    // Allowed before the gate.
    const before = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'audit only allowed',
      governance_mode: 'audit_only',
    });
    expect(before.statusCode).toBe(201);
    // Disallowed after the gate flips.
    await setOrgWorkroomAuditOnlyDisallowed(stack, org.org_id, true);
    const after = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'audit only blocked',
      governance_mode: 'audit_only',
    });
    expect(after.statusCode).toBe(403);
    expect((after.body as { error?: string }).error).toBe('audit_only_disallowed');
  });

  it('participant event carries workroom_governance_mode from the persisted workroom', async () => {
    const org = await devOrg();
    const created = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'mode propagation',
      governance_mode: 'audit_only',
    });
    const id = (
      (created.body as Record<string, unknown>)['workroom'] as Record<string, unknown>
    )['id'] as string;
    const add = await inject(stack, 'POST', `/v1/workrooms/${id}/participants`, org.api_key, {
      kind: 'human',
      role: 'human_reviewer',
      user_id: randomUUID(),
    });
    const auditEventId = (add.body as Record<string, unknown>)['audit_event_id'] as string;
    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);
      const r = await c.query<{ mode: string }>(
        `SELECT (redaction_metadata->'workroom_participant'->>'workroom_governance_mode') AS mode
           FROM govai.audit_events WHERE id = $1::uuid`,
        [auditEventId],
      );
      await c.query('COMMIT');
      expect(r.rows[0]?.mode).toBe('audit_only');
    } finally {
      c.release();
    }
  });

  it('/v1/runs remains reachable and unchanged (cheap regression check)', async () => {
    const org = await devOrg();
    // Malformed body → 400 invalid_request from the runs route, proving the
    // route is still registered and behaves as before. No provider call.
    const r = await inject(stack, 'POST', '/v1/runs', org.api_key, {});
    expect(r.statusCode).toBe(400);
    expect((r.body as { error?: string }).error).toBe('invalid_request');
  });

  it('does not reintroduce lookupOperationalMode', async () => {
    const routePath = fileURLToPath(
      new URL('../../apps/api/src/routes/workrooms.ts', import.meta.url),
    );
    const source = await readFile(routePath, 'utf8');
    expect(source).not.toContain('lookupOperationalMode');
  });
});
