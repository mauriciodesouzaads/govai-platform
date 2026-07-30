// EP-P03A-A (F3) — T5: the approval row lock dies at TX-A COMMIT and the
// approval is ALREADY consumed while the provider call is still in flight.
//
// On the pre-F3 baseline the `FOR UPDATE` taken by assertApprovalConsumable
// lived in the SAME transaction as the provider forward, so a concurrent
// `FOR UPDATE NOWAIT` on the approval row failed with 55P03 until the provider
// answered. Here the upstream is PARKED and the second connection must both
// (a) acquire the row lock immediately and (b) observe consumed_at already set.

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

const INTENDED_RUN = {
  capability: 'anthropic.messages.create',
  model: 'claude-fixture-1',
  input: 'parked approval-lock probe',
};

async function createWorkroom(org: DevOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
    workspace_id: org.workspace_id,
    name: `room-${randomUUID().slice(0, 8)}`,
    governance_mode: 'governance_active',
  });
  expect(r.statusCode).toBe(201);
  return ((r.body as Record<string, unknown>)['workroom'] as Record<string, unknown>)['id'] as string;
}

async function grantedApproval(org: DevOrg, workroomId: string): Promise<string> {
  const approverUserId = randomUUID();
  const approver = await addApiKey(stack, org.org_id, approverUserId, ['developer']);
  const p = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, org.api_key, {
    kind: 'human',
    role: 'human_approver',
    user_id: approverUserId,
  });
  expect(p.statusCode).toBe(201);
  const a = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/approvals`, org.api_key, {
    subject_kind: 'passthrough_run',
    intended_run: INTENDED_RUN,
  });
  expect(a.statusCode).toBe(201);
  const approvalId = ((a.body as Record<string, unknown>)['approval_request'] as Record<
    string,
    unknown
  >)['id'] as string;
  const d = await inject(
    stack,
    'POST',
    `/v1/workrooms/${workroomId}/approvals/${approvalId}/decisions`,
    approver.api_key,
    { decision: 'granted' },
  );
  expect(d.statusCode).toBe(201);
  return approvalId;
}

describe('T5 — approval lock release + consumption at TX-A', () => {
  it('while the upstream is PARKED: FOR UPDATE NOWAIT succeeds and the approval is already consumed', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const approvalId = await grantedApproval(org, workroomId);

    const park = setParkOverride(org.workspace_id);
    const pending = inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, org.api_key, {
      capability: INTENDED_RUN.capability,
      model: INTENDED_RUN.model,
      input: INTENDED_RUN.input,
      mode: 'passthrough',
      approval_request_id: approvalId,
    });
    await park.parked; // the provider call is in flight NOW

    // Second connection: the approval row lock MUST be free (baseline: 55P03)
    // and consumption MUST already be durable (baseline: not yet committed).
    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);
      const locked = await c.query<{ consumed_at: Date | null; consumed_run_id: string | null }>(
        `SELECT consumed_at, consumed_run_id
           FROM govai.workroom_approval_requests
          WHERE id = $1::uuid
          FOR UPDATE NOWAIT`,
        [approvalId],
      );
      expect(locked.rows).toHaveLength(1);
      expect(locked.rows[0]!.consumed_at).not.toBeNull();
      expect(locked.rows[0]!.consumed_run_id).not.toBeNull();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }

    // No workroom-turn / audit-chain locks are held during the provider call
    // either: the run_event turn + terminal audit append happen only in TX-B
    // (T1 asserts zero advisory/row locks held by the API pool while parked).
    park.release();
    const res = await pending;
    expect(res.statusCode).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(body['status']).toBe('completed');
    expect(body['mode']).toBe('passthrough');
    expect(body['approval_request_id']).toBe(approvalId);

    // Exactly one run_event turn anchors the run (created at TX-B, not TX-A).
    const c2 = await stack.db.appPool.connect();
    try {
      await c2.query('BEGIN');
      await c2.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);
      const turns = await c2.query<{ n: string }>(
        "SELECT COUNT(*) AS n FROM govai.workroom_turns WHERE kind = 'run_event' AND payload_ref = $1::uuid",
        [body['run_id'] as string],
      );
      await c2.query('COMMIT');
      expect(Number(turns.rows[0]!.n)).toBe(1);
    } finally {
      c2.release();
    }
  });
});
