// Workroom Phase 1 (issue #49) — lifecycle / control-plane endpoint semantics.
//
// Covers POST /v1/workrooms (default + explicit modes, audit-only admission),
// GET /v1/workrooms/:id, GET /v1/workrooms list, validation/auth paths, and
// the workroom.lifecycle audit event + anchoring workroom_turns row.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
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
  base_api_key: string;
};

async function devOrg(): Promise<DevOrg> {
  const org = await seedOrg(stack);
  const dev = await addApiKey(stack, org.org_id, org.user_id, ['developer']);
  return {
    org_id: org.org_id,
    user_id: org.user_id,
    workspace_id: org.workspace_id,
    api_key: dev.api_key,
    base_api_key: org.api_key,
  };
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

describe('workroom-lifecycle / create', () => {
  it('POST: default governance_mode is governance_active', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'default-mode room',
    });
    expect(r.statusCode).toBe(201);
    const body = r.body as Record<string, unknown>;
    expect(body['governance_mode']).toBe('governance_active');
    const workroom = body['workroom'] as Record<string, unknown>;
    expect(workroom['governance_mode']).toBe('governance_active');
    expect(workroom['status']).toBe('open');
    expect(typeof body['audit_event_id']).toBe('string');
    const fp = body['first_participant'] as Record<string, unknown>;
    expect(fp['role']).toBe('human_owner');
    expect(fp['user_id']).toBe(org.user_id);
  });

  it('POST: explicit governance_active accepted', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'explicit governed room',
      governance_mode: 'governance_active',
    });
    expect(r.statusCode).toBe(201);
    expect((r.body as Record<string, unknown>)['governance_mode']).toBe('governance_active');
  });

  it('POST: explicit audit_only accepted when org allows it', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'audit only room',
      governance_mode: 'audit_only',
    });
    expect(r.statusCode).toBe(201);
    const body = r.body as Record<string, unknown>;
    expect(body['governance_mode']).toBe('audit_only');
    const pp = body['policy_profile'] as Record<string, unknown>;
    expect(pp['governance_mode']).toBe('audit_only');
    expect(pp['default_provider_surface']).toBe('passthrough');
  });

  it('POST: audit_only rejected with 403 when org policy disallows it', async () => {
    const org = await devOrg();
    await setOrgWorkroomAuditOnlyDisallowed(stack, org.org_id, true);
    const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'blocked audit only room',
      governance_mode: 'audit_only',
    });
    expect(r.statusCode).toBe(403);
    expect((r.body as { error?: string }).error).toBe('audit_only_disallowed');
    // governance_active is still allowed for the same org.
    const ok = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'still allowed governed room',
    });
    expect(ok.statusCode).toBe(201);
  });

  it('POST: missing name → 400 invalid_request', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
    });
    expect(r.statusCode).toBe(400);
    expect((r.body as { error?: string }).error).toBe('invalid_request');
  });

  it('POST: non-uuid workspace_id → 400', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: 'not-a-uuid',
      name: 'bad workspace',
    });
    expect(r.statusCode).toBe(400);
  });

  it('POST: unauthenticated → 401', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'POST', '/v1/workrooms', undefined, {
      workspace_id: org.workspace_id,
      name: 'no auth room',
    });
    expect(r.statusCode).toBe(401);
  });

  it('POST: key without developer/admin role → 403 forbidden', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'POST', '/v1/workrooms', org.base_api_key, {
      workspace_id: org.workspace_id,
      name: 'roleless room',
    });
    expect(r.statusCode).toBe(403);
    expect((r.body as { error?: string }).error).toBe('forbidden');
  });
});

describe('workroom-lifecycle / read', () => {
  it('GET by id: returns workroom with governance_mode and policy profile', async () => {
    const org = await devOrg();
    const created = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'readable room',
      governance_mode: 'audit_only',
    });
    const id = ((created.body as Record<string, unknown>)['workroom'] as Record<string, unknown>)[
      'id'
    ] as string;
    const r = await inject(stack, 'GET', `/v1/workrooms/${id}`, org.api_key);
    expect(r.statusCode).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body['governance_mode']).toBe('audit_only');
    expect((body['workroom'] as Record<string, unknown>)['id']).toBe(id);
    expect((body['policy_profile'] as Record<string, unknown>)['max_risk_without_approval']).toBe(
      'C',
    );
  });

  it('GET by id: unknown id → 404', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'GET', `/v1/workrooms/${randomUUID()}`, org.api_key);
    expect(r.statusCode).toBe(404);
    expect((r.body as { error?: string }).error).toBe('workroom_not_found');
  });

  it('GET by id: malformed id → 400', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'GET', '/v1/workrooms/not-a-uuid', org.api_key);
    expect(r.statusCode).toBe(400);
  });

  it('GET list: returns own org workrooms, filterable by status', async () => {
    const org = await devOrg();
    await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'list room one',
    });
    await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'list room two',
    });
    const all = await inject(stack, 'GET', '/v1/workrooms', org.api_key);
    expect(all.statusCode).toBe(200);
    const data = (all.body as { data: Array<Record<string, unknown>> }).data;
    expect(data.length).toBeGreaterThanOrEqual(2);
    for (const row of data) {
      expect(row['governance_mode']).toBeDefined();
    }
    const open = await inject(stack, 'GET', '/v1/workrooms?status=open', org.api_key);
    expect(open.statusCode).toBe(200);
    for (const row of (open.body as { data: Array<Record<string, unknown>> }).data) {
      expect(row['status']).toBe('open');
    }
    const archived = await inject(stack, 'GET', '/v1/workrooms?status=archived', org.api_key);
    expect((archived.body as { data: unknown[] }).data.length).toBe(0);
  });

  it('GET list: invalid status filter → 400', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'GET', '/v1/workrooms?status=bogus', org.api_key);
    expect(r.statusCode).toBe(400);
  });
});

describe('workroom-lifecycle / audit', () => {
  it('emits workroom.lifecycle on the run chain, anchored by workroom_turns #1', async () => {
    const org = await devOrg();
    const created = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: org.workspace_id,
      name: 'audited room',
    });
    const body = created.body as Record<string, unknown>;
    const workroomId = (body['workroom'] as Record<string, unknown>)['id'] as string;
    const auditEventId = body['audit_event_id'] as string;

    const events = await queryAsOrg<{
      chain_id: string;
      event_type: string;
      subject_id: string;
      redaction_metadata: { workroom_lifecycle?: { governance_mode?: string; transition?: string } };
    }>(
      org.org_id,
      `SELECT chain_id, event_type, subject_id, redaction_metadata
         FROM govai.audit_events WHERE id = $1::uuid`,
      [auditEventId],
    );
    expect(events.length).toBe(1);
    const ev = events[0]!;
    expect(ev.event_type).toBe('workroom.lifecycle');
    // No new audit chain: lifecycle routes onto the existing `run` category.
    expect(ev.chain_id).toBe(`${org.org_id}:run`);
    expect(ev.subject_id).toBe(workroomId);
    expect(ev.redaction_metadata.workroom_lifecycle?.governance_mode).toBe('governance_active');
    expect(ev.redaction_metadata.workroom_lifecycle?.transition).toBe('created');

    const turns = await queryAsOrg<{ turn_number: string; audit_event_id: string; kind: string }>(
      org.org_id,
      `SELECT turn_number, audit_event_id, kind
         FROM govai.workroom_turns WHERE workroom_id = $1::uuid ORDER BY turn_number`,
      [workroomId],
    );
    expect(turns.length).toBe(1);
    expect(Number(turns[0]!.turn_number)).toBe(1);
    expect(turns[0]!.kind).toBe('state_transition');
    expect(turns[0]!.audit_event_id).toBe(auditEventId);
  });
});
