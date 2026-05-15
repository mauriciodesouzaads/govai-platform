// Workroom Phase 2 (issue #51) — evidence index query semantics.

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

async function postMessage(
  org: DevOrg,
  workroomId: string,
  role: 'user' | 'assistant' | 'auditor_note',
  content: string,
): Promise<void> {
  const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/messages`, org.api_key, {
    role,
    content,
  });
  expect(r.statusCode).toBe(201);
}

describe('workroom-evidence / query', () => {
  it('returns message-derived evidence rows linked to real audit anchors', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    await postMessage(org, workroomId, 'user', 'prompt one');
    await postMessage(org, workroomId, 'assistant', 'response one');

    const r = await inject(stack, 'GET', `/v1/workrooms/${workroomId}/evidence`, org.api_key);
    expect(r.statusCode).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body['workroom_governance_mode']).toBe('governance_active');
    const evidence = body['evidence'] as Array<Record<string, unknown>>;
    expect(evidence.length).toBe(2);
    for (const row of evidence) {
      expect(typeof row['evidence_artifact_id']).toBe('string');
      expect(typeof row['audit_event_id']).toBe('string');
      expect(typeof row['payload_ref']).toBe('string');
      expect(typeof row['payload_hash']).toBe('string');
      expect(typeof row['audit_sequence_number']).toBe('number');
      expect(row['workroom_governance_mode']).toBe('governance_active');
      expect(row['status']).toBe('active');
      // No payload bytes / DEK ever leave the evidence endpoint.
      expect(row['encrypted_payload']).toBeUndefined();
      expect(row['dek_wrapped']).toBeUndefined();
      expect(row['content']).toBeUndefined();
    }
    const kinds = new Set(evidence.map((row) => row['artifact_kind']));
    expect(kinds.has('prompt')).toBe(true);
    expect(kinds.has('agent_response')).toBe(true);
  });

  it('supports artifact_kind filtering', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    await postMessage(org, workroomId, 'user', 'a prompt');
    await postMessage(org, workroomId, 'assistant', 'a response');

    const r = await inject(
      stack,
      'GET',
      `/v1/workrooms/${workroomId}/evidence?artifact_kind=prompt`,
      org.api_key,
    );
    expect(r.statusCode).toBe(200);
    const evidence = (r.body as { evidence: Array<Record<string, unknown>> }).evidence;
    expect(evidence.length).toBe(1);
    expect(evidence[0]!['artifact_kind']).toBe('prompt');
  });

  it('supports limit/before_seq pagination', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    for (let i = 0; i < 3; i++) {
      await postMessage(org, workroomId, 'user', `prompt ${i}`);
    }
    const page1 = await inject(
      stack,
      'GET',
      `/v1/workrooms/${workroomId}/evidence?limit=2`,
      org.api_key,
    );
    expect(page1.statusCode).toBe(200);
    const b1 = page1.body as Record<string, unknown>;
    expect((b1['evidence'] as unknown[]).length).toBe(2);
    expect(typeof b1['next_before_seq']).toBe('number');

    const page2 = await inject(
      stack,
      'GET',
      `/v1/workrooms/${workroomId}/evidence?limit=2&before_seq=${b1['next_before_seq']}`,
      org.api_key,
    );
    expect(page2.statusCode).toBe(200);
    expect((page2.body as { evidence: unknown[] }).evidence.length).toBe(1);
  });

  it('an auditor key (non-participant) may query evidence', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    await postMessage(org, workroomId, 'user', 'audited prompt');
    const auditor = await addApiKey(stack, org.org_id, randomUUID(), ['auditor']);
    const r = await inject(stack, 'GET', `/v1/workrooms/${workroomId}/evidence`, auditor.api_key);
    expect(r.statusCode).toBe(200);
    expect((r.body as { evidence: unknown[] }).evidence.length).toBe(1);
  });

  it('a non-participant without auditor/admin is denied → 403', async () => {
    const org = await devOrg();
    const workroomId = await createWorkroom(org);
    const stranger = await addApiKey(stack, org.org_id, randomUUID(), ['developer']);
    const r = await inject(stack, 'GET', `/v1/workrooms/${workroomId}/evidence`, stranger.api_key);
    expect(r.statusCode).toBe(403);
  });

  it('evidence query excludes other workrooms and other orgs', async () => {
    const orgA = await devOrg();
    const orgB = await devOrg();
    const roomA1 = await createWorkroom(orgA);
    const roomA2 = await createWorkroom(orgA);
    await postMessage(orgA, roomA1, 'user', 'room one prompt');
    await postMessage(orgA, roomA2, 'user', 'room two prompt');

    // Evidence of room A1 does not include room A2 entries.
    const a1 = await inject(stack, 'GET', `/v1/workrooms/${roomA1}/evidence`, orgA.api_key);
    const a1Rows = (a1.body as { evidence: Array<Record<string, unknown>> }).evidence;
    expect(a1Rows.length).toBe(1);
    for (const row of a1Rows) {
      expect(row['workroom_id']).toBe(roomA1);
    }
    // Cross-org access to A1 is invisible.
    const b = await inject(stack, 'GET', `/v1/workrooms/${roomA1}/evidence`, orgB.api_key);
    expect(b.statusCode).toBe(404);
  });
});
