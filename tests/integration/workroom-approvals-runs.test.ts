// Workroom Phase 4 (issue #57) — approval enforcement on the Workroom-owned run
// admission path: the `governance_active` passthrough override. Covers one-time
// consumption, replay / parameter-mismatch rejection, hard-deny preservation,
// and the unchanged standalone / audit_only behavior.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  inject,
  insertCapabilityOverride,
  configureProviderError,
  clearProviderErrors,
  type Stack,
} from './helpers/server-fixture.js';
import {
  canonicalizeIntendedAction,
  intendedActionHash,
} from '../../apps/api/src/pipeline/run-orchestrator.js';

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
  mode: 'governance_active' | 'audit_only' = 'governance_active',
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

async function addApprover(org: DevOrg, workroomId: string): Promise<string> {
  const userId = randomUUID();
  const key = await addApiKey(stack, org.org_id, userId, ['developer']);
  const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, org.api_key, {
    kind: 'human',
    role: 'human_approver',
    user_id: userId,
  });
  expect(r.statusCode).toBe(201);
  return key.api_key;
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

const INTENDED_RUN = {
  capability: 'anthropic.messages.create',
  model: 'claude-fixture-1',
  input: 'workroom override input',
};

async function createApproval(
  apiKey: string,
  workroomId: string,
  intendedRun: Record<string, unknown> = INTENDED_RUN,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/approvals`, apiKey, {
    subject_kind: 'passthrough_run',
    intended_run: intendedRun,
    ...extra,
  });
  expect(r.statusCode).toBe(201);
  return ((r.body as Record<string, unknown>)['approval_request'] as Record<string, unknown>)[
    'id'
  ] as string;
}

async function decide(
  apiKey: string,
  workroomId: string,
  approvalReqId: string,
  decision: 'granted' | 'denied',
  reason?: string,
): Promise<number> {
  const r = await inject(
    stack,
    'POST',
    `/v1/workrooms/${workroomId}/approvals/${approvalReqId}/decisions`,
    apiKey,
    reason === undefined ? { decision } : { decision, reason },
  );
  return r.statusCode;
}

/** A workroom with one granted approval; returns its id + the approver key. */
async function grantedApproval(
  org: DevOrg,
  workroomId: string,
  intendedRun: Record<string, unknown> = INTENDED_RUN,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const approverKey = await addApprover(org, workroomId);
  const id = await createApproval(org.api_key, workroomId, intendedRun, extra);
  expect(await decide(approverKey, workroomId, id, 'granted')).toBe(201);
  return id;
}

function passthroughRun(approvalRequestId?: string, input = INTENDED_RUN.input) {
  return {
    capability: INTENDED_RUN.capability,
    model: INTENDED_RUN.model,
    input,
    mode: 'passthrough' as const,
    ...(approvalRequestId ? { approval_request_id: approvalRequestId } : {}),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('workroom-approvals-runs / approved override', () => {
  it('a granted, matched approval authorizes a passthrough override run', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const approvalReqId = await grantedApproval(org, wid);

    const r = await inject(
      stack,
      'POST',
      `/v1/workrooms/${wid}/runs`,
      org.api_key,
      passthroughRun(approvalReqId),
    );
    expect(r.statusCode).toBe(201);
    const body = r.body as Record<string, unknown>;
    expect(body['mode']).toBe('passthrough');
    expect(body['mode_relation']).toBe('override_approved');
    expect(body['approval_request_id']).toBe(approvalReqId);
    expect(typeof body['workroom_turn_id']).toBe('string');

    // The run row exists with the Phase 3 Workroom columns.
    const runRows = await queryAsOrg<{ mode: string; workroom_id: string }>(
      org.org_id,
      'SELECT mode, workroom_id FROM govai.runs WHERE id = $1::uuid',
      [body['run_id'] as string],
    );
    expect(runRows[0]).toMatchObject({ mode: 'passthrough', workroom_id: wid });

    // The approval is consumed — bound one-time to this run.
    const appr = await queryAsOrg<{ consumed_run_id: string | null; consumed_at: Date | null }>(
      org.org_id,
      'SELECT consumed_run_id, consumed_at FROM govai.workroom_approval_requests WHERE id = $1::uuid',
      [approvalReqId],
    );
    expect(appr[0]!.consumed_run_id).toBe(body['run_id']);
    expect(appr[0]!.consumed_at).not.toBeNull();

    // Exactly one run_event turn anchors the run.
    const turns = await queryAsOrg<{ n: string }>(
      org.org_id,
      "SELECT COUNT(*) AS n FROM govai.workroom_turns WHERE kind = 'run_event' AND payload_ref = $1::uuid",
      [body['run_id'] as string],
    );
    expect(Number(turns[0]!.n)).toBe(1);
  });

  it('a consumed approval cannot authorize a second run → 403', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const approvalReqId = await grantedApproval(org, wid);
    const first = await inject(
      stack,
      'POST',
      `/v1/workrooms/${wid}/runs`,
      org.api_key,
      passthroughRun(approvalReqId),
    );
    expect(first.statusCode).toBe(201);
    const second = await inject(
      stack,
      'POST',
      `/v1/workrooms/${wid}/runs`,
      org.api_key,
      passthroughRun(approvalReqId),
    );
    expect(second.statusCode).toBe(403);
    expect((second.body as Record<string, unknown>)['error']).toBe(
      'workroom_approval_already_consumed',
    );
    expect((second.body as Record<string, unknown>)['mode_relation']).toBe('override_denied');
  });

  it('passthrough override without an approval_request_id stays rejected → 403', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const before = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.runs WHERE workroom_id = $1::uuid',
      [wid],
    );
    const r = await inject(stack, 'POST', `/v1/workrooms/${wid}/runs`, org.api_key, passthroughRun());
    expect(r.statusCode).toBe(403);
    expect((r.body as Record<string, unknown>)['error']).toBe(
      'workroom_run_mode_override_requires_approval',
    );
    expect((r.body as Record<string, unknown>)['mode_relation']).toBe('override_denied');
    const after = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.runs WHERE workroom_id = $1::uuid',
      [wid],
    );
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n));
  });

  it('a pending (ungranted) approval cannot authorize → 403', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const id = await createApproval(org.api_key, wid);
    const r = await inject(
      stack,
      'POST',
      `/v1/workrooms/${wid}/runs`,
      org.api_key,
      passthroughRun(id),
    );
    expect(r.statusCode).toBe(403);
    expect((r.body as Record<string, unknown>)['error']).toBe('workroom_approval_not_granted');
  });

  it('a denied approval cannot authorize → 403', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const approverKey = await addApprover(org, wid);
    const id = await createApproval(org.api_key, wid);
    expect(await decide(approverKey, wid, id, 'denied', 'rejected')).toBe(201);
    const r = await inject(
      stack,
      'POST',
      `/v1/workrooms/${wid}/runs`,
      org.api_key,
      passthroughRun(id),
    );
    expect(r.statusCode).toBe(403);
    expect((r.body as Record<string, unknown>)['error']).toBe('workroom_approval_denied');
  });

  it('a revoked approval cannot authorize → 403', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const id = await createApproval(org.api_key, wid);
    await inject(stack, 'POST', `/v1/workrooms/${wid}/approvals/${id}/revoke`, org.api_key, {});
    const r = await inject(
      stack,
      'POST',
      `/v1/workrooms/${wid}/runs`,
      org.api_key,
      passthroughRun(id),
    );
    expect(r.statusCode).toBe(403);
    expect((r.body as Record<string, unknown>)['error']).toBe('workroom_approval_revoked');
  });

  it('a granted but time-expired approval cannot authorize → 403', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    // Grant while still fresh, then let the short expiry window elapse.
    const id = await grantedApproval(org, wid, INTENDED_RUN, {
      expires_at: new Date(Date.now() + 4000).toISOString(),
    });
    await sleep(4300);
    const r = await inject(
      stack,
      'POST',
      `/v1/workrooms/${wid}/runs`,
      org.api_key,
      passthroughRun(id),
    );
    expect(r.statusCode).toBe(403);
    expect((r.body as Record<string, unknown>)['error']).toBe('workroom_approval_expired');
  });

  it('a parameter-mismatched run cannot use the approval → 403', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const id = await grantedApproval(org, wid);
    const r = await inject(
      stack,
      'POST',
      `/v1/workrooms/${wid}/runs`,
      org.api_key,
      passthroughRun(id, 'a completely different input'),
    );
    expect(r.statusCode).toBe(403);
    expect((r.body as Record<string, unknown>)['error']).toBe('workroom_approval_subject_mismatch');
  });

  it('an approval from a different workroom cannot authorize → 403', async () => {
    const org = await devOrg();
    const widA = await createWorkroom(org);
    const widB = await createWorkroom(org);
    const id = await grantedApproval(org, widA);
    const r = await inject(
      stack,
      'POST',
      `/v1/workrooms/${widB}/runs`,
      org.api_key,
      passthroughRun(id),
    );
    expect(r.statusCode).toBe(403);
    expect((r.body as Record<string, unknown>)['error']).toBe('workroom_approval_wrong_workroom');
  });

  it('a nonexistent approval_request_id → 404', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const r = await inject(
      stack,
      'POST',
      `/v1/workrooms/${wid}/runs`,
      org.api_key,
      passthroughRun(randomUUID()),
    );
    expect(r.statusCode).toBe(404);
    expect((r.body as Record<string, unknown>)['error']).toBe('workroom_approval_not_found');
  });

  it('a failed provider run still consumes the approval (no replay)', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const id = await grantedApproval(org, wid);
    await configureProviderError(stack, { workspaceId: org.workspace_id, status: 500 });
    try {
      const r = await inject(
        stack,
        'POST',
        `/v1/workrooms/${wid}/runs`,
        org.api_key,
        passthroughRun(id),
      );
      expect(r.statusCode).toBe(201);
      expect((r.body as Record<string, unknown>)['status']).toBe('failed');
      const appr = await queryAsOrg<{ consumed_at: Date | null }>(
        org.org_id,
        'SELECT consumed_at FROM govai.workroom_approval_requests WHERE id = $1::uuid',
        [id],
      );
      expect(appr[0]!.consumed_at).not.toBeNull();
    } finally {
      clearProviderErrors();
    }
  });
});

describe('workroom-approvals-runs / hard-deny floor', () => {
  it('a granted approval cannot authorize a hard-denied capability', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const id = await grantedApproval(org, wid);
    // Hard-deny the capability via an org capability override (status=blocked).
    await insertCapabilityOverride(
      stack,
      org.org_id,
      org.user_id,
      'anthropic.messages.create',
      'pre_dlp',
      0,
      'blocked',
    );
    const r = await inject(
      stack,
      'POST',
      `/v1/workrooms/${wid}/runs`,
      org.api_key,
      passthroughRun(id),
    );
    expect(r.statusCode).toBe(403);
    expect((r.body as Record<string, unknown>)['error']).toBe('capability_not_supported');

    // No run row, and the approval is NOT consumed — an approval authorizes the
    // mode override only, never a capability/policy bypass.
    const runs = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.runs WHERE workroom_id = $1::uuid',
      [wid],
    );
    expect(Number(runs[0]!.n)).toBe(0);
    const appr = await queryAsOrg<{ consumed_at: Date | null; status: string }>(
      org.org_id,
      'SELECT consumed_at, status FROM govai.workroom_approval_requests WHERE id = $1::uuid',
      [id],
    );
    expect(appr[0]!.consumed_at).toBeNull();
    expect(appr[0]!.status).toBe('granted');
  });
});

describe('workroom-approvals-runs / unchanged surfaces', () => {
  it('standalone /v1/runs passthrough is unaffected by Phase 4', async () => {
    const org = await devOrg();
    const r = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: INTENDED_RUN.capability,
      model: INTENDED_RUN.model,
      input: 'standalone passthrough',
      mode: 'passthrough',
    });
    expect(r.statusCode).toBe(200);
    expect((r.body as Record<string, unknown>)['mode']).toBe('passthrough');
  });

  it('audit_only Workroom passthrough still needs no approval', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org, 'audit_only');
    const r = await inject(stack, 'POST', `/v1/workrooms/${wid}/runs`, org.api_key, {
      capability: INTENDED_RUN.capability,
      model: INTENDED_RUN.model,
      input: 'audit only passthrough',
      mode: 'passthrough',
    });
    expect(r.statusCode).toBe(201);
    expect((r.body as Record<string, unknown>)['mode']).toBe('passthrough');
    expect((r.body as Record<string, unknown>)['mode_relation']).toBe('explicit');
  });
});

describe('workroom-approvals-runs / canonical intended-action hash', () => {
  const base = {
    mode: 'passthrough' as const,
    capability: 'anthropic.messages.create',
    model: 'claude-fixture-1',
    input: 'hello',
    workspace_id: '11111111-1111-1111-1111-111111111111',
  };

  it('reordered keys hash identically', () => {
    const a = intendedActionHash({
      mode: 'passthrough',
      capability: 'c',
      model: 'm',
      input: 'i',
      workspace_id: 'w',
    });
    const b = intendedActionHash({
      workspace_id: 'w',
      input: 'i',
      model: 'm',
      capability: 'c',
      mode: 'passthrough',
    });
    expect(a.equals(b)).toBe(true);
  });

  it('changing input / model / capability changes the hash', () => {
    const h0 = intendedActionHash(base);
    expect(intendedActionHash({ ...base, input: 'world' }).equals(h0)).toBe(false);
    expect(intendedActionHash({ ...base, model: 'other' }).equals(h0)).toBe(false);
    expect(
      intendedActionHash({ ...base, capability: 'openai.responses.create' }).equals(h0),
    ).toBe(false);
  });

  it('canonicalization sorts keys and covers only the semantic action fields', () => {
    expect(canonicalizeIntendedAction(base)).toBe(
      JSON.stringify({
        capability: base.capability,
        input: base.input,
        mode: base.mode,
        model: base.model,
        workspace_id: base.workspace_id,
      }),
    );
    expect(canonicalizeIntendedAction(base)).not.toContain('approval_request_id');
  });
});
