// Workroom Phase 4 (issue #57) — approval request / decision lifecycle: RBAC,
// RLS, separation of duties, append-only / immutability, deterministic
// pagination, encrypted-at-rest payloads, and audit-subview anchoring.

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

/** Add a human participant; returns { participantId, apiKey } for that user. */
async function addParticipant(
  org: DevOrg,
  workroomId: string,
  role: string,
): Promise<{ participantId: string; userId: string; apiKey: string }> {
  const userId = randomUUID();
  const key = await addApiKey(stack, org.org_id, userId, ['developer']);
  const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, org.api_key, {
    kind: 'human',
    role,
    user_id: userId,
  });
  expect(r.statusCode).toBe(201);
  const participantId = (
    (r.body as Record<string, unknown>)['participant'] as Record<string, unknown>
  )['id'] as string;
  return { participantId, userId, apiKey: key.api_key };
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

/** Run a statement as govai_app expecting it to be rejected (trigger / grant). */
async function expectRejected(orgId: string, sql: string, params: unknown[]): Promise<void> {
  const c = await stack.db.appPool.connect();
  let threw = false;
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    await c.query(sql, params);
    await c.query('COMMIT');
  } catch {
    threw = true;
    await c.query('ROLLBACK').catch(() => undefined);
  } finally {
    c.release();
  }
  expect(threw).toBe(true);
}

const INTENDED_RUN = {
  capability: 'anthropic.messages.create',
  model: 'claude-fixture-1',
  input: 'approval intended input',
};

async function createApproval(
  apiKey: string,
  workroomId: string,
  body: Record<string, unknown> = {},
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/approvals`, apiKey, {
    subject_kind: 'passthrough_run',
    intended_run: INTENDED_RUN,
    ...body,
  });
  return { statusCode: r.statusCode, body: r.body as Record<string, unknown> };
}

function approvalId(res: { body: Record<string, unknown> }): string {
  return (res.body['approval_request'] as Record<string, unknown>)['id'] as string;
}

async function decide(
  apiKey: string,
  workroomId: string,
  approvalReqId: string,
  decision: 'granted' | 'denied',
  reason?: string,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const r = await inject(
    stack,
    'POST',
    `/v1/workrooms/${workroomId}/approvals/${approvalReqId}/decisions`,
    apiKey,
    reason === undefined ? { decision } : { decision, reason },
  );
  return { statusCode: r.statusCode, body: r.body as Record<string, unknown> };
}

describe('workroom-approvals / request lifecycle', () => {
  it('create → 201 pending with binding hash + encrypted payload ref', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const res = await createApproval(org.api_key, wid, { risk_class: 'C' });
    expect(res.statusCode).toBe(201);
    const ar = res.body['approval_request'] as Record<string, unknown>;
    expect(ar['status']).toBe('pending');
    expect(ar['subject_kind']).toBe('passthrough_run');
    expect(ar['subject_ref_id']).toBeNull();
    expect(ar['risk_class']).toBe('C');
    expect(ar['required_approver_count']).toBe(1);
    expect(typeof ar['intended_action_hash']).toBe('string');
    expect((ar['intended_action_hash'] as string).length).toBe(64);
    expect(typeof ar['intended_action_payload_ref']).toBe('string');
    expect(typeof res.body['workroom_turn_id']).toBe('string');
    expect(typeof res.body['audit_event_id']).toBe('string');
  });

  it('intended run payload is encrypted at rest — no plaintext input', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const marker = `SENSITIVE-MARKER-${randomUUID()}`;
    const res = await createApproval(org.api_key, wid, {
      intended_run: { ...INTENDED_RUN, input: marker },
    });
    expect(res.statusCode).toBe(201);
    const payloadRef = (res.body['approval_request'] as Record<string, unknown>)[
      'intended_action_payload_ref'
    ] as string;
    const rows = await queryAsOrg<{ encrypted_payload: Buffer; dek_wrapped: Buffer | null }>(
      org.org_id,
      'SELECT encrypted_payload, dek_wrapped FROM govai.audit_event_payloads WHERE id = $1::uuid',
      [payloadRef],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.encrypted_payload.length).toBeGreaterThan(0);
    expect(rows[0]!.dek_wrapped).not.toBeNull();
    // The ciphertext must not leak the plaintext intended-run input.
    expect(rows[0]!.encrypted_payload.toString('utf8')).not.toContain(marker);
  });

  it('create anchors an approval_request turn to a real audit event', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const res = await createApproval(org.api_key, wid);
    const turnId = res.body['workroom_turn_id'] as string;
    const turns = await queryAsOrg<{ kind: string; audit_event_id: string; payload_ref: string }>(
      org.org_id,
      'SELECT kind, audit_event_id, payload_ref FROM govai.workroom_turns WHERE id = $1::uuid',
      [turnId],
    );
    expect(turns.length).toBe(1);
    expect(turns[0]!.kind).toBe('approval_request');
    expect(turns[0]!.payload_ref).toBe(approvalId(res));
    const events = await queryAsOrg<{ event_type: string }>(
      org.org_id,
      'SELECT event_type FROM govai.audit_events WHERE id = $1::uuid',
      [turns[0]!.audit_event_id],
    );
    expect(events[0]!.event_type).toBe('workroom.approval.requested');
  });

  it('GET list and GET single return the request', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const res = await createApproval(org.api_key, wid);
    const id = approvalId(res);

    const list = await inject(stack, 'GET', `/v1/workrooms/${wid}/approvals`, org.api_key);
    expect(list.statusCode).toBe(200);
    const approvals = (list.body as { approvals: Array<Record<string, unknown>> }).approvals;
    expect(approvals.some((a) => a['id'] === id)).toBe(true);

    const single = await inject(
      stack,
      'GET',
      `/v1/workrooms/${wid}/approvals/${id}`,
      org.api_key,
    );
    expect(single.statusCode).toBe(200);
    expect((single.body as Record<string, unknown>)['decision']).toBeNull();
  });

  it('non-participant cannot create → 403', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const stranger = await addApiKey(stack, org.org_id, randomUUID(), ['developer']);
    const res = await createApproval(stranger.api_key, wid);
    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${wid}/approvals`, undefined, {
      subject_kind: 'passthrough_run',
      intended_run: INTENDED_RUN,
    });
    expect(r.statusCode).toBe(401);
  });

  it('cross-org workroom is invisible → 404', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const wid = await createWorkroom(orgA);
    const res = await createApproval(orgB.api_key, wid);
    expect(res.statusCode).toBe(404);
  });

  it('removed participant can no longer create', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const member = await addParticipant(org, wid, 'human_reviewer');
    const ok = await createApproval(member.apiKey, wid);
    expect(ok.statusCode).toBe(201);
    const del = await inject(
      stack,
      'DELETE',
      `/v1/workrooms/${wid}/participants/${member.participantId}`,
      org.api_key,
    );
    expect(del.statusCode).toBe(204);
    const denied = await createApproval(member.apiKey, wid);
    expect(denied.statusCode).toBe(403);
  });
});

describe('workroom-approvals / decisions', () => {
  it('a human_approver grants a pending request', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const approver = await addParticipant(org, wid, 'human_approver');
    const res = await createApproval(org.api_key, wid);
    const id = approvalId(res);
    const dec = await decide(approver.apiKey, wid, id, 'granted');
    expect(dec.statusCode).toBe(201);
    expect((dec.body['approval_request'] as Record<string, unknown>)['status']).toBe('granted');
    expect((dec.body['decision'] as Record<string, unknown>)['decision']).toBe('granted');
  });

  it('a human_owner may decide a request raised by another participant', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const reviewer = await addParticipant(org, wid, 'human_reviewer');
    const res = await createApproval(reviewer.apiKey, wid);
    const dec = await decide(org.api_key, wid, approvalId(res), 'granted');
    expect(dec.statusCode).toBe(201);
  });

  it('deny carries a reason and sets status denied', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const approver = await addParticipant(org, wid, 'human_approver');
    const res = await createApproval(org.api_key, wid);
    const dec = await decide(approver.apiKey, wid, approvalId(res), 'denied', 'too risky');
    expect(dec.statusCode).toBe(201);
    expect((dec.body['approval_request'] as Record<string, unknown>)['status']).toBe('denied');
  });

  it('deny without a reason → 400', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const approver = await addParticipant(org, wid, 'human_approver');
    const res = await createApproval(org.api_key, wid);
    const dec = await decide(approver.apiKey, wid, approvalId(res), 'denied');
    expect(dec.statusCode).toBe(400);
  });

  it('the requester cannot decide their own request → 403 (SoD)', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    // The org owner is a human_owner participant — an otherwise-valid decider.
    const res = await createApproval(org.api_key, wid);
    const dec = await decide(org.api_key, wid, approvalId(res), 'granted');
    expect(dec.statusCode).toBe(403);
    expect(dec.body['error']).toBe('workroom_separation_of_duties');
  });

  it('a non-approver participant (human_reviewer) cannot decide → 403', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const reviewer = await addParticipant(org, wid, 'human_reviewer');
    const res = await createApproval(org.api_key, wid);
    const dec = await decide(reviewer.apiKey, wid, approvalId(res), 'granted');
    expect(dec.statusCode).toBe(403);
  });

  it('an auditor API key alone (non-participant) cannot decide → 403', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const res = await createApproval(org.api_key, wid);
    const auditor = await addApiKey(stack, org.org_id, randomUUID(), ['auditor']);
    const dec = await decide(auditor.api_key, wid, approvalId(res), 'granted');
    expect(dec.statusCode).toBe(403);
  });

  it('deciding an already-decided request → 409', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const approver = await addParticipant(org, wid, 'human_approver');
    const res = await createApproval(org.api_key, wid);
    const id = approvalId(res);
    expect((await decide(approver.apiKey, wid, id, 'granted')).statusCode).toBe(201);
    const second = await decide(approver.apiKey, wid, id, 'denied', 'changed mind');
    expect(second.statusCode).toBe(409);
  });

  it('concurrent decisions create exactly one decision row', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const approver = await addParticipant(org, wid, 'human_approver');
    const res = await createApproval(org.api_key, wid);
    const id = approvalId(res);
    const [a, b] = await Promise.all([
      decide(approver.apiKey, wid, id, 'granted'),
      decide(approver.apiKey, wid, id, 'granted'),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    const rows = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.workroom_approval_decisions WHERE approval_request_id = $1::uuid',
      [id],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it('a removed decider can no longer decide → 403', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const approver = await addParticipant(org, wid, 'human_approver');
    const res = await createApproval(org.api_key, wid);
    const del = await inject(
      stack,
      'DELETE',
      `/v1/workrooms/${wid}/participants/${approver.participantId}`,
      org.api_key,
    );
    expect(del.statusCode).toBe(204);
    const dec = await decide(approver.apiKey, wid, approvalId(res), 'granted');
    expect(dec.statusCode).toBe(403);
  });
});

describe('workroom-approvals / revoke + expiry', () => {
  it('the requester revokes a pending request', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const res = await createApproval(org.api_key, wid);
    const id = approvalId(res);
    const rev = await inject(
      stack,
      'POST',
      `/v1/workrooms/${wid}/approvals/${id}/revoke`,
      org.api_key,
      { reason: 'no longer needed' },
    );
    expect(rev.statusCode).toBe(200);
    expect((rev.body as Record<string, unknown>)['approval_request']).toMatchObject({
      status: 'revoked',
    });
  });

  it('a revoked request cannot be decided → 409', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const approver = await addParticipant(org, wid, 'human_approver');
    const res = await createApproval(org.api_key, wid);
    const id = approvalId(res);
    await inject(stack, 'POST', `/v1/workrooms/${wid}/approvals/${id}/revoke`, org.api_key, {});
    const dec = await decide(approver.apiKey, wid, id, 'granted');
    expect(dec.statusCode).toBe(409);
  });

  it('a non-owner non-requester cannot revoke → 403', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const reviewer = await addParticipant(org, wid, 'human_reviewer');
    const other = await addParticipant(org, wid, 'human_reviewer');
    const res = await createApproval(reviewer.apiKey, wid);
    const rev = await inject(
      stack,
      'POST',
      `/v1/workrooms/${wid}/approvals/${approvalId(res)}/revoke`,
      other.apiKey,
      {},
    );
    expect(rev.statusCode).toBe(403);
  });

  it('an expired pending request cannot be decided → 409', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const approver = await addParticipant(org, wid, 'human_approver');
    const res = await createApproval(org.api_key, wid, {
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const dec = await decide(approver.apiKey, wid, approvalId(res), 'granted');
    expect(dec.statusCode).toBe(409);
    expect(dec.body['error']).toBe('workroom_approval_expired');
  });

  it('GET renders an expired pending request as status=expired', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const res = await createApproval(org.api_key, wid, {
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const single = await inject(
      stack,
      'GET',
      `/v1/workrooms/${wid}/approvals/${approvalId(res)}`,
      org.api_key,
    );
    expect((single.body as Record<string, unknown>)['approval_request']).toMatchObject({
      status: 'expired',
    });
  });
});

describe('workroom-approvals / RLS + immutability', () => {
  it('cross-org cannot read a workroom approval → 404', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const wid = await createWorkroom(orgA);
    const res = await createApproval(orgA.api_key, wid);
    const cross = await inject(
      stack,
      'GET',
      `/v1/workrooms/${wid}/approvals/${approvalId(res)}`,
      orgB.api_key,
    );
    expect(cross.statusCode).toBe(404);
  });

  it('approval decisions are append-only — direct UPDATE/DELETE rejected', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const approver = await addParticipant(org, wid, 'human_approver');
    const res = await createApproval(org.api_key, wid);
    const id = approvalId(res);
    const dec = await decide(approver.apiKey, wid, id, 'granted');
    const decisionId = (dec.body['decision'] as Record<string, unknown>)['id'] as string;
    await expectRejected(
      org.org_id,
      `UPDATE govai.workroom_approval_decisions SET reason = 'tampered' WHERE id = $1::uuid`,
      [decisionId],
    );
    await expectRejected(
      org.org_id,
      'DELETE FROM govai.workroom_approval_decisions WHERE id = $1::uuid',
      [decisionId],
    );
  });

  it('a request immutable column (intended_action_hash) cannot be changed', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const res = await createApproval(org.api_key, wid);
    await expectRejected(
      org.org_id,
      `UPDATE govai.workroom_approval_requests
          SET intended_action_hash = '\\x00'::bytea WHERE id = $1::uuid`,
      [approvalId(res)],
    );
  });
});

describe('workroom-approvals / pagination + audit subview', () => {
  it('deterministic keyset pagination with before_created_at + before_id', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    for (let i = 0; i < 5; i += 1) await createApproval(org.api_key, wid);

    const page1 = await inject(
      stack,
      'GET',
      `/v1/workrooms/${wid}/approvals?limit=3`,
      org.api_key,
    );
    expect(page1.statusCode).toBe(200);
    const b1 = page1.body as { approvals: Array<Record<string, unknown>>; next_cursor: unknown };
    expect(b1.approvals.length).toBe(3);
    expect(b1.next_cursor).not.toBeNull();

    const cur = b1.next_cursor as { before_created_at: string; before_id: string };
    const page2 = await inject(
      stack,
      'GET',
      `/v1/workrooms/${wid}/approvals?limit=3&before_created_at=${encodeURIComponent(
        cur.before_created_at,
      )}&before_id=${cur.before_id}`,
      org.api_key,
    );
    const b2 = page2.body as { approvals: Array<Record<string, unknown>> };
    expect(b2.approvals.length).toBe(2);
    const ids1 = new Set(b1.approvals.map((a) => a['id']));
    for (const a of b2.approvals) expect(ids1.has(a['id'])).toBe(false);
  });

  it('approval request + decision events surface in the workroom audit subview', async () => {
    const org = await devOrg();
    const wid = await createWorkroom(org);
    const approver = await addParticipant(org, wid, 'human_approver');
    const res = await createApproval(org.api_key, wid);
    await decide(approver.apiKey, wid, approvalId(res), 'granted');

    const auditor = await addApiKey(stack, org.org_id, randomUUID(), ['auditor']);
    const audit = await inject(stack, 'GET', `/v1/workrooms/${wid}/audit`, auditor.api_key);
    expect(audit.statusCode).toBe(200);
    const events = (audit.body as { audit_events: Array<Record<string, unknown>> }).audit_events;
    const eventTypes = new Set(events.map((e) => e['event_type']));
    expect(eventTypes.has('workroom.approval.requested')).toBe(true);
    expect(eventTypes.has('workroom.approval.granted')).toBe(true);
    const turnKinds = new Set(events.map((e) => e['turn_kind']));
    expect(turnKinds.has('approval_request')).toBe(true);
    expect(turnKinds.has('approval_decision')).toBe(true);
    for (const e of events) {
      if (String(e['event_type']).startsWith('workroom.approval.')) {
        expect(e['chain_category']).toBe('policy');
      }
    }
  });
});
