// Workroom Phase 3 (issue #53) — run mode matrix and mode_relation.
//
// governance_active: omitted/governed allowed; passthrough rejected (approvals
// are Phase 4). audit_only: omitted/passthrough allowed; governed allowed as a
// stricter upgrade. shadow is out of scope for Workroom-owned runs. Rejected
// modes create no run row and no workroom_turns row.

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

describe('workroom-runs-mode / matrix', () => {
  it('governance_active + omitted → governed / defaulted', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org, 'governance_active');
    const r = await inject(stack, 'POST', `/v1/workrooms/${wid}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'a',
    });
    expect(r.statusCode).toBe(201);
    expect((r.body as Record<string, unknown>)['mode']).toBe('governed');
    expect((r.body as Record<string, unknown>)['mode_relation']).toBe('defaulted');
  });

  it('governance_active + explicit governed → governed / explicit', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org, 'governance_active');
    const r = await inject(stack, 'POST', `/v1/workrooms/${wid}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'a',
      mode: 'governed',
    });
    expect(r.statusCode).toBe(201);
    expect((r.body as Record<string, unknown>)['mode_relation']).toBe('explicit');
  });

  it('audit_only + omitted → passthrough / defaulted', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org, 'audit_only');
    const r = await inject(stack, 'POST', `/v1/workrooms/${wid}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'a',
    });
    expect(r.statusCode).toBe(201);
    expect((r.body as Record<string, unknown>)['mode']).toBe('passthrough');
    expect((r.body as Record<string, unknown>)['mode_relation']).toBe('defaulted');
  });

  it('audit_only + explicit passthrough → passthrough / explicit', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org, 'audit_only');
    const r = await inject(stack, 'POST', `/v1/workrooms/${wid}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'a',
      mode: 'passthrough',
    });
    expect(r.statusCode).toBe(201);
    expect((r.body as Record<string, unknown>)['mode_relation']).toBe('explicit');
  });

  it('audit_only + explicit governed → governed / upgrade', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org, 'audit_only');
    const r = await inject(stack, 'POST', `/v1/workrooms/${wid}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'a',
      mode: 'governed',
    });
    expect(r.statusCode).toBe(201);
    expect((r.body as Record<string, unknown>)['mode']).toBe('governed');
    expect((r.body as Record<string, unknown>)['mode_relation']).toBe('upgrade');
  });
});

describe('workroom-runs-mode / rejected overrides create nothing', () => {
  it('governance_active + explicit passthrough → 403, override_denied, no run/turn', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org, 'governance_active');
    const before = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.runs WHERE workroom_id = $1::uuid',
      [wid],
    );
    const r = await inject(stack, 'POST', `/v1/workrooms/${wid}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'a',
      mode: 'passthrough',
    });
    expect(r.statusCode).toBe(403);
    expect((r.body as { error?: string }).error).toBe('workroom_run_mode_override_requires_approval');
    expect((r.body as Record<string, unknown>)['mode_relation']).toBe('override_denied');
    // No run row, no turn created for the rejected override.
    const afterRuns = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.runs WHERE workroom_id = $1::uuid',
      [wid],
    );
    expect(Number(afterRuns[0]!.n)).toBe(Number(before[0]!.n));
    const turns = await queryAsOrg<{ n: string }>(
      org.org_id,
      "SELECT COUNT(*) AS n FROM govai.workroom_turns WHERE workroom_id = $1::uuid AND kind = 'run_event'",
      [wid],
    );
    expect(Number(turns[0]!.n)).toBe(0);
  });

  it('governance_active + shadow → 403, override_denied, no run/turn', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org, 'governance_active');
    const r = await inject(stack, 'POST', `/v1/workrooms/${wid}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'a',
      mode: 'shadow',
    });
    expect(r.statusCode).toBe(403);
    expect((r.body as { error?: string }).error).toBe('workroom_run_shadow_mode_out_of_scope');
    expect((r.body as Record<string, unknown>)['mode_relation']).toBe('override_denied');
    const runs = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.runs WHERE workroom_id = $1::uuid',
      [wid],
    );
    expect(Number(runs[0]!.n)).toBe(0);
  });

  it('audit_only + shadow → 403, override_denied, no run/turn', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org, 'audit_only');
    const r = await inject(stack, 'POST', `/v1/workrooms/${wid}/runs`, org.api_key, {
      ...ANTHROPIC_RUN,
      input: 'a',
      mode: 'shadow',
    });
    expect(r.statusCode).toBe(403);
    expect((r.body as { error?: string }).error).toBe('workroom_run_shadow_mode_out_of_scope');
    expect((r.body as Record<string, unknown>)['mode_relation']).toBe('override_denied');
    const runs = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.runs WHERE workroom_id = $1::uuid',
      [wid],
    );
    expect(Number(runs[0]!.n)).toBe(0);
  });

  it('standalone /v1/runs mode=shadow is unaffected (still 400 run_mode_not_supported)', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      ...ANTHROPIC_RUN,
      input: 'a',
      mode: 'shadow',
    });
    expect(r.statusCode).toBe(400);
    expect((r.body as { error?: string }).error).toBe('run_mode_not_supported');
  });
});
