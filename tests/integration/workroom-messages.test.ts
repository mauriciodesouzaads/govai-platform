// Workroom Phase 2 (issue #51) — message append endpoint semantics.
//
// Covers POST /v1/workrooms/{id}/messages: encrypted-at-rest content, turn +
// audit event + evidence artifact creation, participant binding, RLS.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sha256 } from '@govai/core-audit';
import { DevKms } from '@govai/core-identity';
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

async function createWorkroom(
  org: DevOrg,
  mode?: 'governance_active' | 'audit_only',
): Promise<string> {
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

describe('workroom-messages / append', () => {
  it('appends a message in a governance_active workroom → 201', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/messages`, org.api_key, {
      role: 'user',
      content: 'draft the phase 2 migration',
    });
    expect(r.statusCode).toBe(201);
    const body = r.body as Record<string, unknown>;
    expect(body['governance_mode']).toBe('governance_active');
    expect(typeof body['audit_event_id']).toBe('string');
    expect(typeof body['evidence_artifact_id']).toBe('string');
    const msg = body['message'] as Record<string, unknown>;
    expect(msg['role']).toBe('user');
    expect(typeof msg['content_ref']).toBe('string');
    expect(msg['content']).toBeUndefined();
  });

  it('appends a message in an audit_only workroom → 201', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org, 'audit_only');
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/messages`, org.api_key, {
      role: 'assistant',
      content: 'here is the plan',
    });
    expect(r.statusCode).toBe(201);
    expect((r.body as Record<string, unknown>)['governance_mode']).toBe('audit_only');
  });

  it('rejects unauthenticated → 401', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/messages`, undefined, {
      role: 'user',
      content: 'no auth',
    });
    expect(r.statusCode).toBe(401);
  });

  it('rejects a non-participant → 403', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const stranger = await addApiKey(stack, org.org_id, randomUUID(), ['developer']);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/messages`, stranger.api_key, {
      role: 'user',
      content: 'i am not a participant',
    });
    expect(r.statusCode).toBe(403);
  });

  it('rejects a removed participant → 403', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const memberUserId = randomUUID();
    const member = await addApiKey(stack, org.org_id, memberUserId, ['developer']);
    const add = await inject(
      stack,
      'POST',
      `/v1/workrooms/${workroomId}/participants`,
      org.api_key,
      { kind: 'human', role: 'human_reviewer', user_id: memberUserId },
    );
    expect(add.statusCode).toBe(201);
    const participantId = (
      (add.body as Record<string, unknown>)['participant'] as Record<string, unknown>
    )['id'] as string;
    // Active participant can post.
    const ok = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/messages`, member.api_key, {
      role: 'user',
      content: 'while active',
    });
    expect(ok.statusCode).toBe(201);
    // Owner removes the participant.
    const del = await inject(
      stack,
      'DELETE',
      `/v1/workrooms/${workroomId}/participants/${participantId}`,
      org.api_key,
    );
    expect(del.statusCode).toBe(204);
    // Removed participant can no longer post.
    const denied = await inject(
      stack,
      'POST',
      `/v1/workrooms/${workroomId}/messages`,
      member.api_key,
      { role: 'user', content: 'after removal' },
    );
    expect(denied.statusCode).toBe(403);
  });

  it("rejects role='system' → 400", async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/messages`, org.api_key, {
      role: 'system',
      content: 'platform only',
    });
    expect(r.statusCode).toBe(400);
  });

  it('rejects empty content → 400', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/messages`, org.api_key, {
      role: 'user',
      content: '',
    });
    expect(r.statusCode).toBe(400);
  });

  it('stores content encrypted-at-rest, never plaintext, decryptable, hash-matched', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const canary = `PLAINTEXT-CANARY-${randomUUID()}`;
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/messages`, org.api_key, {
      role: 'user',
      content: canary,
    });
    expect(r.statusCode).toBe(201);
    expect(r.rawBody).not.toContain(canary);
    const body = r.body as Record<string, unknown>;
    const msg = body['message'] as Record<string, unknown>;
    const messageId = msg['id'] as string;
    const contentRef = msg['content_ref'] as string;

    // workroom_messages stores no plaintext — only content_ref + payload_hash.
    const msgRows = await queryAsOrg<Record<string, unknown>>(
      org.org_id,
      'SELECT * FROM govai.workroom_messages WHERE id = $1::uuid',
      [messageId],
    );
    expect(msgRows.length).toBe(1);
    expect(JSON.stringify(msgRows[0])).not.toContain(canary);

    // audit_event_payloads row exists, ciphertext is not the plaintext.
    const payloadRows = await queryAsOrg<{
      encrypted_payload: Buffer;
      dek_wrapped: Buffer;
    }>(
      org.org_id,
      'SELECT encrypted_payload, dek_wrapped FROM govai.audit_event_payloads WHERE id = $1::uuid',
      [contentRef],
    );
    expect(payloadRows.length).toBe(1);
    expect(payloadRows[0]!.encrypted_payload.toString('utf8')).not.toContain(canary);

    // envelopeDecrypt round-trips to the original content.
    const kms = new DevKms(stack.seed);
    const decrypted = await kms.envelopeDecrypt({
      orgId: org.org_id,
      keyId: 'audit-1',
      version: 1,
      ciphertext: new Uint8Array(payloadRows[0]!.encrypted_payload),
      dekWrapped: new Uint8Array(payloadRows[0]!.dek_wrapped),
    });
    expect(Buffer.from(decrypted).toString('utf8')).toBe(canary);

    // payload_hash matches sha256(plaintext).
    expect(msg['payload_hash']).toBe(Buffer.from(sha256(Buffer.from(canary, 'utf8'))).toString('hex'));
  });

  it('creates a message turn, a workroom.message audit event, and an evidence artifact', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/messages`, org.api_key, {
      role: 'auditor_note',
      content: 'reviewed',
    });
    const body = r.body as Record<string, unknown>;
    const msg = body['message'] as Record<string, unknown>;
    const turnId = msg['workroom_turn_id'] as string;
    const auditEventId = body['audit_event_id'] as string;
    const evidenceId = body['evidence_artifact_id'] as string;

    const turns = await queryAsOrg<{ kind: string; audit_event_id: string; payload_ref: string }>(
      org.org_id,
      'SELECT kind, audit_event_id, payload_ref FROM govai.workroom_turns WHERE id = $1::uuid',
      [turnId],
    );
    expect(turns[0]!.kind).toBe('message');
    expect(turns[0]!.audit_event_id).toBe(auditEventId);

    const events = await queryAsOrg<{ event_type: string; chain_id: string }>(
      org.org_id,
      'SELECT event_type, chain_id FROM govai.audit_events WHERE id = $1::uuid',
      [auditEventId],
    );
    expect(events[0]!.event_type).toBe('workroom.message');
    expect(events[0]!.chain_id).toBe(`${org.org_id}:run`);

    // Evidence artifact anchors to the SAME turn and SAME audit event.
    const evidence = await queryAsOrg<{
      workroom_turn_id: string;
      audit_event_id: string;
      artifact_kind: string;
    }>(
      org.org_id,
      'SELECT workroom_turn_id, audit_event_id, artifact_kind FROM govai.workroom_evidence_artifacts WHERE id = $1::uuid',
      [evidenceId],
    );
    expect(evidence[0]!.workroom_turn_id).toBe(turnId);
    expect(evidence[0]!.audit_event_id).toBe(auditEventId);
    expect(evidence[0]!.artifact_kind).toBe('auditor_finding');

    // Exactly one workroom.message audit event for this message — no duplicate
    // standalone workroom.evidence event.
    const evidenceEvents = await queryAsOrg<{ n: string }>(
      org.org_id,
      "SELECT COUNT(*) AS n FROM govai.audit_events WHERE event_type = 'workroom.evidence' AND org_id = $1::uuid",
      [org.org_id],
    );
    expect(Number(evidenceEvents[0]!.n)).toBe(0);
  });

  it('cross-org message append returns 404 (no leak)', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const workroomId = await createWorkroom(orgA);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/messages`, orgB.api_key, {
      role: 'user',
      content: 'cross tenant',
    });
    expect(r.statusCode).toBe(404);
    expect((r.body as { error?: string }).error).toBe('workroom_not_found');
  });
});
