// P0.3-C (EP-P03C) — cross-request run execution idempotency on the Workroom
// surface: POST /v1/workrooms/:id/runs. Covers §27 T20–T27 plus the §15 crux:
// a concurrent matching keyed retry must NEVER lose the race by first
// observing an already-consumed approval, and a matching replay of an
// approval-authorized run consumes NOTHING.
//
// Real Testcontainers Postgres + the hermetic provider upstream; provider-call
// assertions count ACTUAL upstream HTTP requests (recordedRequestHeaders).

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  inject,
  type Stack,
} from './helpers/server-fixture.js';
import {
  setParkOverride,
  clearParkOverrides,
} from './fixtures/provider-protocol-server.js';

const H = 'x-govai-run-idempotency-key';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});
afterEach(() => {
  clearParkOverrides();
});

const keyOf = () => `p03c-wr-key-${randomUUID()}`;

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

type Res = {
  statusCode: number;
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | number | undefined>;
};

async function post(
  url: string,
  apiKey: string,
  payload: unknown,
  extraHeaders: Record<string, string | string[]> = {},
): Promise<Res> {
  const headers: Record<string, string | string[]> = {
    'content-type': 'application/json',
    'x-govai-api-key': apiKey,
    ...extraHeaders,
  };
  const res = await stack.app.inject({
    method: 'POST',
    url,
    headers,
    payload: payload as Record<string, unknown>,
  });
  let body: unknown;
  try {
    body = res.body.length > 0 ? JSON.parse(res.body) : null;
  } catch {
    body = res.body;
  }
  return {
    statusCode: res.statusCode,
    body: body as Record<string, unknown>,
    headers: res.headers,
  };
}

function providerCalls(workspaceId: string): number {
  return stack.provider.recordedRequestHeaders.filter(
    (h) => h['x-test-workspace-id'] === workspaceId,
  ).length;
}

async function queryAsOrg<T = Record<string, unknown>>(
  orgId: string,
  sql: string,
  params: unknown[] = [],
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

const INTENDED_RUN = {
  capability: 'anthropic.messages.create',
  model: 'claude-fixture-1',
  input: 'workroom override input',
};

/** A granted approval for INTENDED_RUN in this workroom; returns its id. */
async function grantedApproval(org: DevOrg, workroomId: string): Promise<string> {
  const approverKey = await addApprover(org, workroomId);
  const created = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/approvals`, org.api_key, {
    subject_kind: 'passthrough_run',
    intended_run: INTENDED_RUN,
  });
  expect(created.statusCode).toBe(201);
  const id = ((created.body as Record<string, unknown>)['approval_request'] as Record<
    string,
    unknown
  >)['id'] as string;
  const decided = await inject(
    stack,
    'POST',
    `/v1/workrooms/${workroomId}/approvals/${id}/decisions`,
    approverKey,
    { decision: 'granted' },
  );
  expect(decided.statusCode).toBe(201);
  return id;
}

async function approvalState(
  org: DevOrg,
  approvalId: string,
): Promise<{ consumed_at: Date | null; consumed_run_id: string | null }> {
  const rows = await queryAsOrg<{ consumed_at: Date | null; consumed_run_id: string | null }>(
    org.org_id,
    'SELECT consumed_at, consumed_run_id FROM govai.workroom_approval_requests WHERE id = $1::uuid',
    [approvalId],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function runEventTurns(org: DevOrg, workroomId: string): Promise<number> {
  const rows = await queryAsOrg<{ n: string }>(
    org.org_id,
    "SELECT COUNT(*) AS n FROM govai.workroom_turns WHERE workroom_id = $1::uuid AND kind = 'run_event'",
    [workroomId],
  );
  return Number(rows[0]!.n);
}

async function orgRuns(org: DevOrg): Promise<number> {
  const rows = await queryAsOrg<{ n: string }>(
    org.org_id,
    'SELECT COUNT(*) AS n FROM govai.runs WHERE org_id = $1::uuid',
    [org.org_id],
  );
  return Number(rows[0]!.n);
}

function expectReplay(res: Res, runId?: string): void {
  expect(res.statusCode).toBe(200);
  expect(res.body['idempotent_replay']).toBe(true);
  expect(res.headers['x-govai-run-idempotent-replay']).toBe('true');
  expect(res.headers['location']).toBe(`/v1/runs/${res.body['run_id']}`);
  if (runId) expect(res.body['run_id']).toBe(runId);
}

const governedRun = () => ({
  capability: 'anthropic.messages.create',
  model: 'claude-fixture-1',
  input: 'workroom governed input',
});

// =============================================================================
// T20 / T21 — Workroom governed sequential + concurrent replay
// =============================================================================

describe('T20 — Workroom governed sequential replay', () => {
  it('same key × 2 → one run, one provider call, exactly ONE run_event turn', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const key = keyOf();

    const first = await post(`/v1/workrooms/${workroomId}/runs`, org.api_key, governedRun(), {
      [H]: key,
    });
    expect(first.statusCode).toBe(201);
    expect(first.body['status']).toBe('completed');
    const runId = first.body['run_id'] as string;

    const replay = await post(`/v1/workrooms/${workroomId}/runs`, org.api_key, governedRun(), {
      [H]: key,
    });
    expectReplay(replay, runId);
    expect(replay.body['workroom_id']).toBe(workroomId);
    expect(replay.body['status']).toBe('completed');

    expect(await orgRuns(org)).toBe(1);
    expect(await runEventTurns(org, workroomId)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(1);
  });
});

describe('T21 — Workroom governed concurrent replay', () => {
  it('3 concurrent keyed requests → one run, one provider call, one turn', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const key = keyOf();

    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        post(`/v1/workrooms/${workroomId}/runs`, org.api_key, governedRun(), { [H]: key }),
      ),
    );
    for (const r of results) {
      expect([200, 201]).toContain(r.statusCode);
    }
    expect(new Set(results.map((r) => r.body['run_id'])).size).toBe(1);
    expect(await orgRuns(org)).toBe(1);
    expect(await runEventTurns(org, workroomId)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(1);
  });
});

// =============================================================================
// T22 / T23 — approval consumed exactly once; matching replay consumes nothing
// =============================================================================

describe('T22/T23 — approval provenance replay', () => {
  it('first execution consumes the approval exactly once; the matching replay succeeds after consumption with zero new mutations', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'governance_active');
    const approvalId = await grantedApproval(org, workroomId);
    const key = keyOf();
    const body = { ...INTENDED_RUN, mode: 'passthrough', approval_request_id: approvalId };

    // T22 — first execution: override approved, approval consumed once.
    const first = await post(`/v1/workrooms/${workroomId}/runs`, org.api_key, body, { [H]: key });
    expect(first.statusCode).toBe(201);
    expect(first.body['mode_relation']).toBe('override_approved');
    const runId = first.body['run_id'] as string;
    const consumed = await approvalState(org, approvalId);
    expect(consumed.consumed_at).not.toBeNull();
    expect(consumed.consumed_run_id).toBe(runId);
    expect(providerCalls(org.workspace_id)).toBe(1);

    // T23 — matching replay: same approval provenance, ORIGINAL is already
    // consumed, and the replay must succeed WITHOUT any new consumption (no
    // workroom_approval_already_consumed, no fresh approval requirement).
    const replay = await post(`/v1/workrooms/${workroomId}/runs`, org.api_key, body, { [H]: key });
    expectReplay(replay, runId);
    const after = await approvalState(org, approvalId);
    expect(after.consumed_at?.toISOString()).toBe(consumed.consumed_at?.toISOString());
    expect(after.consumed_run_id).toBe(runId);
    expect(providerCalls(org.workspace_id)).toBe(1);
    expect(await orgRuns(org)).toBe(1);
    expect(await runEventTurns(org, workroomId)).toBe(1);
  });

  it('§15 crux — concurrent matching keyed requests: one consumption, one run, one provider call, and the loser replays instead of seeing already_consumed', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'governance_active');
    const approvalId = await grantedApproval(org, workroomId);
    const key = keyOf();
    const body = { ...INTENDED_RUN, mode: 'passthrough', approval_request_id: approvalId };

    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        post(`/v1/workrooms/${workroomId}/runs`, org.api_key, body, { [H]: key }),
      ),
    );
    for (const r of results) {
      expect([200, 201]).toContain(r.statusCode);
      expect(r.body['error']).toBeUndefined();
    }
    expect(new Set(results.map((r) => r.body['run_id'])).size).toBe(1);
    const state = await approvalState(org, approvalId);
    expect(state.consumed_at).not.toBeNull();
    expect(state.consumed_run_id).toBe(results[0]!.body['run_id']);
    expect(await orgRuns(org)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(1);
    expect(await runEventTurns(org, workroomId)).toBe(1);
  });
});

// =============================================================================
// T24 / T25 — divergent approval provenance
// =============================================================================

describe('T24 — same key + same action under a DIFFERENT approval → 409', () => {
  it('conflicts and leaves the new approval unconsumed', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'governance_active');
    const approval1 = await grantedApproval(org, workroomId);
    const approval2 = await grantedApproval(org, workroomId);
    const key = keyOf();

    const first = await post(
      `/v1/workrooms/${workroomId}/runs`,
      org.api_key,
      { ...INTENDED_RUN, mode: 'passthrough', approval_request_id: approval1 },
      { [H]: key },
    );
    expect(first.statusCode).toBe(201);

    const conflict = await post(
      `/v1/workrooms/${workroomId}/runs`,
      org.api_key,
      { ...INTENDED_RUN, mode: 'passthrough', approval_request_id: approval2 },
      { [H]: key },
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.body).toEqual({ error: 'idempotency_key_conflict' });

    const untouched = await approvalState(org, approval2);
    expect(untouched.consumed_at).toBeNull();
    expect(untouched.consumed_run_id).toBeNull();
    expect(await orgRuns(org)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(1);
  });
});

describe('T25 — same key with the approval OMITTED after the original used one → 409', () => {
  it('the binding wins over the mode-matrix 403: authorization provenance cannot be silently dropped', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'governance_active');
    const approvalId = await grantedApproval(org, workroomId);
    const key = keyOf();

    const first = await post(
      `/v1/workrooms/${workroomId}/runs`,
      org.api_key,
      { ...INTENDED_RUN, mode: 'passthrough', approval_request_id: approvalId },
      { [H]: key },
    );
    expect(first.statusCode).toBe(201);

    const omitted = await post(
      `/v1/workrooms/${workroomId}/runs`,
      org.api_key,
      { ...INTENDED_RUN, mode: 'passthrough' },
      { [H]: key },
    );
    expect(omitted.statusCode).toBe(409);
    expect(omitted.body).toEqual({ error: 'idempotency_key_conflict' });
    expect(await orgRuns(org)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(1);

    // Without a binding, the ordinary mode-matrix rejection still stands.
    const noBinding = await post(
      `/v1/workrooms/${workroomId}/runs`,
      org.api_key,
      { ...INTENDED_RUN, mode: 'passthrough' },
      { [H]: keyOf() },
    );
    expect(noBinding.statusCode).toBe(403);
    expect(noBinding.body['error']).toBe('workroom_run_mode_override_requires_approval');
  });
});

// =============================================================================
// T26 — in-progress Workroom replay (no run_event turn exists yet)
// =============================================================================

describe('T26 — replay of an in-progress Workroom run', () => {
  it('returns the running run with no invariant error, no synthesized turn', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const key = keyOf();
    const park = setParkOverride(org.workspace_id);

    const original = post(`/v1/workrooms/${workroomId}/runs`, org.api_key, governedRun(), {
      [H]: key,
    });
    await park.parked; // upstream call in flight; terminal turn NOT yet written

    expect(await runEventTurns(org, workroomId)).toBe(0);
    const replay = await post(`/v1/workrooms/${workroomId}/runs`, org.api_key, governedRun(), {
      [H]: key,
    });
    expectReplay(replay);
    expect(replay.body['status']).toBe('running');
    // No synthesized turn fields on an in-progress replay.
    expect(replay.body['workroom_turn_id']).toBeUndefined();
    expect(await runEventTurns(org, workroomId)).toBe(0);

    park.release();
    const first = await original;
    expect(first.statusCode).toBe(201);
    expect(first.body['status']).toBe('completed');
    expect(first.body['run_id']).toBe(replay.body['run_id']);
    expect(await runEventTurns(org, workroomId)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(1);
  });
});

// =============================================================================
// T27 — authorization is never bypassed by key knowledge
// =============================================================================

describe('T27 — Workroom authorization preserved', () => {
  it('a non-participant with the exact key cannot replay', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const key = keyOf();

    const first = await post(`/v1/workrooms/${workroomId}/runs`, org.api_key, governedRun(), {
      [H]: key,
    });
    expect(first.statusCode).toBe(201);

    // Same org, NOT a participant of the workroom.
    const outsider = await addApiKey(stack, org.org_id, randomUUID(), ['developer']);
    const denied = await post(
      `/v1/workrooms/${workroomId}/runs`,
      outsider.api_key,
      governedRun(),
      { [H]: key },
    );
    expect(denied.statusCode).toBe(403);
    expect(denied.body['error']).toBe('forbidden');
    expect(denied.body['idempotent_replay']).toBeUndefined();

    // A different org cannot even see the workroom.
    const otherOrg = await devOrg();
    const invisible = await post(
      `/v1/workrooms/${workroomId}/runs`,
      otherOrg.api_key,
      governedRun(),
      { [H]: key },
    );
    expect(invisible.statusCode).toBe(404);
    expect(providerCalls(org.workspace_id)).toBe(1);
    expect(await orgRuns(org)).toBe(1);
  });
});
