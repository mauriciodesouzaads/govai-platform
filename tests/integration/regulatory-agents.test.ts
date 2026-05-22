// Regulatory Core PR-R5 (issue #59, umbrella #33) — Agent Registry.
//
// Production-focused slice: agent identity, agent version/config provenance,
// and agent capability bindings (declared governance evidence, including the
// hard_deny_floor_expected expectation — registry evidence only, NOT runtime
// enforcement). Covers auth/RBAC, CRUD-without-delete, tenant isolation (API +
// direct DB RLS), keyset pagination, validation, audit evidence, the DB-enforced
// version-requires-model + version-belongs-to-model + agent-version-belongs-to-
// agent guards, and parent-visibility.
//
// Registry evidence / provenance only — no prompts, manifests, credentials, or
// secrets are stored or tested. A small fixed set of orgs + shared parent
// records is seeded once; agents/versions/bindings (which mint no api_keys) are
// created freely per test.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { startStack, stopStack, seedOrg, addApiKey, inject, type Stack } from './helpers/server-fixture.js';

let stack: Stack;

type AdminOrg = { org_id: string; user_id: string; api_key: string };

async function adminOrg(): Promise<AdminOrg> {
  const org = await seedOrg(stack);
  const admin = await addApiKey(stack, org.org_id, org.user_id, ['admin']);
  return { org_id: org.org_id, user_id: org.user_id, api_key: admin.api_key };
}

let orgA: AdminOrg;
let orgB: AdminOrg;
let devOrg: { org_id: string; user_id: string; api_key: string };
let orgPage: AdminOrg;
let orgFilter: AdminOrg;

// Shared parent records.
let provA: string;
let aiSysA: string;
let modelA: string;
let modelVersionA: string;
let provB: string;
let aiSysB: string;
let modelB: string;
let modelVersionB: string;
let agentB: string;
let agentVersionB: string;

function bodyOf(r: { body: unknown }): Record<string, unknown> {
  return r.body as Record<string, unknown>;
}

async function mkProvider(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/providers', org.api_key, {
    provider_key: `PRV-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: 'provider',
    provider_type: 'MODEL_PROVIDER',
    provider_status: 'APPROVED',
    deployment_model: 'API',
    data_processing_role: 'PROCESSOR',
    dpa_status: 'APPROVED',
    security_review_status: 'APPROVED',
    subprocessors_review_status: 'APPROVED',
    ai_terms_review_status: 'APPROVED',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['provider'] as Record<string, unknown>)['id'] as string;
}

async function mkAiSystem(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/ai-systems', org.api_key, {
    system_key: `AIS-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: 'ai system',
    system_type: 'INTERNAL_PRODUCT',
    lifecycle_state: 'ACTIVE',
    deployment_environment: 'PRODUCTION',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['ai_system'] as Record<string, unknown>)['id'] as string;
}

async function mkModel(org: AdminOrg, providerId: string): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/models', org.api_key, {
    model_key: `MDL-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: 'model',
    model_type: 'FOUNDATION_MODEL',
    model_status: 'ACTIVE',
    provider_id: providerId,
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['model'] as Record<string, unknown>)['id'] as string;
}

async function mkModelVersion(org: AdminOrg, modelId: string): Promise<string> {
  const r = await inject(stack, 'POST', `/v1/regulatory/models/${modelId}/versions`, org.api_key, {
    version_key: `VER-${randomUUID().slice(0, 8).toUpperCase()}`,
    version_label: 'v1',
    version_status: 'APPROVED',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['model_version'] as Record<string, unknown>)['id'] as string;
}

const baseAgent = (overrides: Record<string, unknown> = {}) => ({
  agent_key: `AGT-${randomUUID().slice(0, 8).toUpperCase()}`,
  name: 'tenant agent',
  agent_type: 'LLM_AGENT',
  agent_status: 'PROPOSED',
  autonomy_level: 'HUMAN_APPROVAL_REQUIRED',
  execution_boundary: 'GOVAI_WORKROOM',
  human_oversight_mode: 'HUMAN_IN_LOOP',
  ...overrides,
});

async function mkAgentResp(org: AdminOrg, overrides: Record<string, unknown> = {}) {
  const r = await inject(stack, 'POST', '/v1/regulatory/agents', org.api_key, baseAgent(overrides));
  return { status: r.statusCode, body: bodyOf(r) };
}

async function mkAgent(org: AdminOrg, overrides: Record<string, unknown> = {}): Promise<string> {
  const r = await mkAgentResp(org, overrides);
  expect(r.status).toBe(201);
  return (r.body['agent'] as Record<string, unknown>)['id'] as string;
}

const baseAgentVersion = (overrides: Record<string, unknown> = {}) => ({
  version_key: `AVER-${randomUUID().slice(0, 8).toUpperCase()}`,
  version_label: 'v1.0.0',
  version_status: 'DRAFT',
  ...overrides,
});

async function mkAgentVersion(org: AdminOrg, agentId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const r = await inject(stack, 'POST', `/v1/regulatory/agents/${agentId}/versions`, org.api_key, baseAgentVersion(overrides));
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['agent_version'] as Record<string, unknown>)['id'] as string;
}

const baseBinding = (overrides: Record<string, unknown> = {}) => ({
  capability_key: `CAP-${randomUUID().slice(0, 8).toUpperCase()}`,
  capability_name: 'network access',
  capability_category: 'NETWORK',
  capability_status: 'PROPOSED',
  risk_posture: 'MODERATE',
  ...overrides,
});

async function mkBinding(org: AdminOrg, body: Record<string, unknown>) {
  const r = await inject(stack, 'POST', '/v1/regulatory/agent-capability-bindings', org.api_key, baseBinding(body));
  return { status: r.statusCode, body: bodyOf(r) };
}

async function asOrg<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

async function insertBlocked(orgId: string, sql: string, params: unknown[]): Promise<boolean> {
  try {
    await asOrg(orgId, (c) => c.query(sql, params));
    return false;
  } catch {
    return true;
  }
}

async function auditCount(orgId: string, subjectId: string, eventType: string): Promise<number> {
  const c = await stack.db.adminPool.connect();
  try {
    const r = await c.query(
      `SELECT 1 FROM govai.audit_events
        WHERE org_id = $1::uuid AND subject_id = $2::uuid AND event_type = $3`,
      [orgId, subjectId, eventType],
    );
    return r.rowCount ?? 0;
  } finally {
    c.release();
  }
}

// Raw agent INSERT with the required NOT NULL columns plus caller-supplied
// extra columns/placeholders (used to exercise DB-level guards directly).
function agentInsert(extraCols: string, extraVals: string): string {
  return `INSERT INTO govai.regulatory_agents
     (org_id, agent_key, name, agent_type, agent_status, autonomy_level, execution_boundary,
      human_oversight_mode${extraCols})
   VALUES ($1::uuid, $2, 'x', 'OTHER', 'PROPOSED', 'AUDIT_ONLY', 'NOT_DEPLOYED', 'NOT_APPLICABLE'${extraVals})`;
}

beforeAll(async () => {
  stack = await startStack();
  orgA = await adminOrg();
  orgB = await adminOrg();
  const dev = await seedOrg(stack);
  const devKey = await addApiKey(stack, dev.org_id, dev.user_id, ['developer']);
  devOrg = { org_id: dev.org_id, user_id: dev.user_id, api_key: devKey.api_key };
  orgPage = await adminOrg();
  orgFilter = await adminOrg();

  provA = await mkProvider(orgA);
  aiSysA = await mkAiSystem(orgA);
  modelA = await mkModel(orgA, provA);
  modelVersionA = await mkModelVersion(orgA, modelA);
  provB = await mkProvider(orgB);
  aiSysB = await mkAiSystem(orgB);
  modelB = await mkModel(orgB, provB);
  modelVersionB = await mkModelVersion(orgB, modelB);
  agentB = await mkAgent(orgB);
  agentVersionB = await mkAgentVersion(orgB, agentB);
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

describe('regulatory-agents / auth + rbac', () => {
  it('rejects unauthenticated reads and writes (401)', async () => {
    expect((await inject(stack, 'GET', '/v1/regulatory/agents', undefined)).statusCode).toBe(401);
    expect((await inject(stack, 'POST', '/v1/regulatory/agents', undefined, baseAgent())).statusCode).toBe(401);
  });

  it('a non-write role can read but not write agents, versions, and bindings', async () => {
    expect((await inject(stack, 'GET', '/v1/regulatory/agents', devOrg.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'POST', '/v1/regulatory/agents', devOrg.api_key, baseAgent())).statusCode).toBe(403);
    expect((await inject(stack, 'GET', '/v1/regulatory/agent-capability-bindings', devOrg.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'POST', '/v1/regulatory/agent-capability-bindings', devOrg.api_key, baseBinding({ agent_id: randomUUID() }))).statusCode).toBe(403);
  });

  it('admin write role can create agent, version, and capability binding', async () => {
    const id = await mkAgent(orgA);
    const vId = await mkAgentVersion(orgA, id);
    const b = await mkBinding(orgA, { agent_id: id, agent_version_id: vId });
    expect(b.status).toBe(201);
  });
});

describe('regulatory-agents / agent API', () => {
  it('creates agent linked to own provider, AI system, model, and model version; created audit emitted', async () => {
    const r = await mkAgentResp(orgA, {
      provider_id: provA,
      primary_ai_system_id: aiSysA,
      primary_model_id: modelA,
      primary_model_version_id: modelVersionA,
    });
    expect(r.status).toBe(201);
    const a = r.body['agent'] as Record<string, unknown>;
    expect(a['primary_model_version_id']).toBe(modelVersionA);
    expect(await auditCount(orgA.org_id, a['id'] as string, 'regulatory_agent.created')).toBe(1);
  });

  it('list returns own tenant agents only; GET own works; GET cross-tenant 404', async () => {
    const aId = await mkAgent(orgA);
    const listB = await inject(stack, 'GET', '/v1/regulatory/agents?limit=200', orgB.api_key);
    expect((bodyOf(listB)['agents'] as Array<Record<string, unknown>>).map((x) => x['id'])).not.toContain(aId);
    expect((await inject(stack, 'GET', `/v1/regulatory/agents/${aId}`, orgA.api_key)).statusCode).toBe(200);
    const cross = await inject(stack, 'GET', `/v1/regulatory/agents/${aId}`, orgB.api_key);
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('agent_not_found');
  });

  it('PATCH updates allowed fields and emits updated audit', async () => {
    const id = await mkAgent(orgA);
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/agents/${id}`, orgA.api_key, { name: 'renamed', intended_purpose: 'support triage' });
    expect(patch.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, id, 'regulatory_agent.updated')).toBe(1);
  });

  it('agent_status transition emits status_changed audit', async () => {
    const id = await mkAgent(orgA, { agent_status: 'PROPOSED' });
    await inject(stack, 'PATCH', `/v1/regulatory/agents/${id}`, orgA.api_key, { agent_status: 'ACTIVE' });
    expect(await auditCount(orgA.org_id, id, 'regulatory_agent.status_changed')).toBe(1);
  });

  it('duplicate agent_key rejected (409); same key across tenants allowed', async () => {
    const key = `AGT-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await mkAgentResp(orgA, { agent_key: key })).status).toBe(201);
    const dup = await mkAgentResp(orgA, { agent_key: key });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('agent_key_conflict');
    expect((await mkAgentResp(orgB, { agent_key: key })).status).toBe(201);
  });

  it('invalid enum / invalid key rejected with 400', async () => {
    expect((await mkAgentResp(orgA, { agent_status: 'NOPE' })).status).toBe(400);
    expect((await mkAgentResp(orgA, { agent_key: 'bad key' })).status).toBe(400);
  });

  it('cross-tenant parent references return 404 without leakage', async () => {
    expect((await mkAgentResp(orgA, { provider_id: provB })).body['error']).toBe('provider_not_found');
    expect((await mkAgentResp(orgA, { primary_ai_system_id: aiSysB })).body['error']).toBe('ai_system_not_found');
    expect((await mkAgentResp(orgA, { primary_model_id: modelB })).body['error']).toBe('model_not_found');
    // A cross-tenant model version is invisible → reported as not-found (no leakage),
    // not as a mismatch (which would imply the version is visible).
    const crossVer = await mkAgentResp(orgA, { primary_model_id: modelA, primary_model_version_id: modelVersionB });
    expect(crossVer.status).toBe(404);
    expect(crossVer.body['error']).toBe('model_version_not_found');
  });

  it('mismatched own primary_model_id + primary_model_version_id rejected (400)', async () => {
    // modelVersionA belongs to modelA; pairing it with a different OWN model
    // (both visible) is a deterministic mismatch.
    const model2 = await mkModel(orgA, provA);
    const r = await mkAgentResp(orgA, { primary_model_id: model2, primary_model_version_id: modelVersionA });
    expect(r.status).toBe(400);
    expect(r.body['error']).toBe('model_version_model_mismatch');
  });

  it('creating agent with primary_model_version_id but no primary_model_id returns 400', async () => {
    const r = await mkAgentResp(orgA, { primary_model_version_id: modelVersionA });
    expect(r.status).toBe(400);
  });

  it('patching agent to set primary_model_version_id when primary_model_id is NULL returns 400', async () => {
    const id = await mkAgent(orgA); // no model set
    const r = await inject(stack, 'PATCH', `/v1/regulatory/agents/${id}`, orgA.api_key, { primary_model_version_id: modelVersionA });
    expect(r.statusCode).toBe(400);
  });

  it('patching agent to clear primary_model_id while primary_model_version_id remains set returns 400', async () => {
    const id = await mkAgent(orgA, { primary_model_id: modelA, primary_model_version_id: modelVersionA });
    const r = await inject(stack, 'PATCH', `/v1/regulatory/agents/${id}`, orgA.api_key, { primary_model_id: null });
    expect(r.statusCode).toBe(400);
  });
});

describe('regulatory-agents / agent version API', () => {
  it('creates a version under own agent; created audit emitted; lists own only', async () => {
    const id = await mkAgent(orgA);
    const vId = await mkAgentVersion(orgA, id);
    expect(await auditCount(orgA.org_id, vId, 'regulatory_agent_version.created')).toBe(1);
    const list = await inject(stack, 'GET', `/v1/regulatory/agents/${id}/versions?limit=200`, orgA.api_key);
    expect((bodyOf(list)['agent_versions'] as Array<Record<string, unknown>>).map((v) => v['id'])).toContain(vId);
  });

  it('GET own version works; GET cross-tenant version returns 404', async () => {
    const id = await mkAgent(orgA);
    const vId = await mkAgentVersion(orgA, id);
    expect((await inject(stack, 'GET', `/v1/regulatory/agent-versions/${vId}`, orgA.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', `/v1/regulatory/agent-versions/${vId}`, orgB.api_key)).statusCode).toBe(404);
  });

  it('PATCH version emits updated; status transition emits status_changed', async () => {
    const id = await mkAgent(orgA);
    const vId = await mkAgentVersion(orgA, id, { version_status: 'DRAFT' });
    await inject(stack, 'PATCH', `/v1/regulatory/agent-versions/${vId}`, orgA.api_key, { release_notes: 'notes' });
    expect(await auditCount(orgA.org_id, vId, 'regulatory_agent_version.updated')).toBe(1);
    await inject(stack, 'PATCH', `/v1/regulatory/agent-versions/${vId}`, orgA.api_key, { version_status: 'UNDER_EVALUATION' });
    expect(await auditCount(orgA.org_id, vId, 'regulatory_agent_version.status_changed')).toBe(1);
  });

  it('approval transition emits approved audit with approved_at/approved_by_user_id', async () => {
    const id = await mkAgent(orgA);
    const vId = await mkAgentVersion(orgA, id, { version_status: 'UNDER_EVALUATION' });
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/agent-versions/${vId}`, orgA.api_key, {
      version_status: 'APPROVED',
      approved_at: '2026-05-22T00:00:00.000Z',
      approved_by_user_id: orgA.user_id,
    });
    expect(patch.statusCode).toBe(200);
    expect((bodyOf(patch)['agent_version'] as Record<string, unknown>)['approved_by_user_id']).toBe(orgA.user_id);
    expect(await auditCount(orgA.org_id, vId, 'regulatory_agent_version.approved')).toBe(1);
  });

  it('retirement transition emits retired audit', async () => {
    const id = await mkAgent(orgA);
    const vId = await mkAgentVersion(orgA, id, { version_status: 'ACTIVE' });
    await inject(stack, 'PATCH', `/v1/regulatory/agent-versions/${vId}`, orgA.api_key, { version_status: 'RETIRED', retired_at: '2026-05-22T00:00:00.000Z' });
    expect(await auditCount(orgA.org_id, vId, 'regulatory_agent_version.retired')).toBe(1);
  });

  it('duplicate version_key for same agent rejected; same key under different agent allowed', async () => {
    const a1 = await mkAgent(orgA);
    const a2 = await mkAgent(orgA);
    const key = `AVER-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await inject(stack, 'POST', `/v1/regulatory/agents/${a1}/versions`, orgA.api_key, baseAgentVersion({ version_key: key }))).statusCode).toBe(201);
    const dup = await inject(stack, 'POST', `/v1/regulatory/agents/${a1}/versions`, orgA.api_key, baseAgentVersion({ version_key: key }));
    expect(dup.statusCode).toBe(409);
    expect(bodyOf(dup)['error']).toBe('agent_version_key_conflict');
    expect((await inject(stack, 'POST', `/v1/regulatory/agents/${a2}/versions`, orgA.api_key, baseAgentVersion({ version_key: key }))).statusCode).toBe(201);
  });

  it('PATCH version with empty body rejected (400)', async () => {
    const id = await mkAgent(orgA);
    const vId = await mkAgentVersion(orgA, id);
    expect((await inject(stack, 'PATCH', `/v1/regulatory/agent-versions/${vId}`, orgA.api_key, {})).statusCode).toBe(400);
  });
});

describe('regulatory-agents / capability binding API', () => {
  it('creates a binding for own agent + optional own version; created audit emitted; lists own only', async () => {
    const id = await mkAgent(orgA);
    const vId = await mkAgentVersion(orgA, id);
    const b = await mkBinding(orgA, { agent_id: id, agent_version_id: vId });
    expect(b.status).toBe(201);
    const bid = (b.body['agent_capability_binding'] as Record<string, unknown>)['id'] as string;
    expect(await auditCount(orgA.org_id, bid, 'regulatory_agent_capability_binding.created')).toBe(1);
    const list = await inject(stack, 'GET', '/v1/regulatory/agent-capability-bindings?limit=200', orgA.api_key);
    expect((bodyOf(list)['agent_capability_bindings'] as Array<Record<string, unknown>>).map((x) => x['id'])).toContain(bid);
    expect((await inject(stack, 'GET', `/v1/regulatory/agent-capability-bindings/${bid}`, orgA.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', `/v1/regulatory/agent-capability-bindings/${bid}`, orgB.api_key)).statusCode).toBe(404);
  });

  it('PATCH capability_status emits updated + status_changed', async () => {
    const id = await mkAgent(orgA);
    const b = await mkBinding(orgA, { agent_id: id, capability_status: 'PROPOSED' });
    const bid = (b.body['agent_capability_binding'] as Record<string, unknown>)['id'] as string;
    await inject(stack, 'PATCH', `/v1/regulatory/agent-capability-bindings/${bid}`, orgA.api_key, { capability_status: 'APPROVED' });
    expect(await auditCount(orgA.org_id, bid, 'regulatory_agent_capability_binding.updated')).toBe(1);
    expect(await auditCount(orgA.org_id, bid, 'regulatory_agent_capability_binding.status_changed')).toBe(1);
  });

  it('PATCH risk_posture emits updated + risk_posture_changed', async () => {
    const id = await mkAgent(orgA);
    const b = await mkBinding(orgA, { agent_id: id, risk_posture: 'LOW' });
    const bid = (b.body['agent_capability_binding'] as Record<string, unknown>)['id'] as string;
    await inject(stack, 'PATCH', `/v1/regulatory/agent-capability-bindings/${bid}`, orgA.api_key, { risk_posture: 'HIGH' });
    expect(await auditCount(orgA.org_id, bid, 'regulatory_agent_capability_binding.risk_posture_changed')).toBe(1);
  });

  it('duplicate capability binding tuple rejected (409)', async () => {
    const id = await mkAgent(orgA);
    const key = `CAP-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await mkBinding(orgA, { agent_id: id, capability_key: key })).status).toBe(201);
    const dup = await mkBinding(orgA, { agent_id: id, capability_key: key });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('agent_capability_binding_conflict');
  });

  it('binding with cross-tenant agent/version rejected without leakage', async () => {
    expect((await mkBinding(orgA, { agent_id: agentB })).status).toBe(404);
    const ownAgent = await mkAgent(orgA);
    const cross = await mkBinding(orgA, { agent_id: ownAgent, agent_version_id: agentVersionB });
    expect(cross.status).toBe(404);
  });

  it('binding with own agent but version from a different own agent rejected (400)', async () => {
    const a1 = await mkAgent(orgA);
    const a2 = await mkAgent(orgA);
    const v2 = await mkAgentVersion(orgA, a2);
    const r = await mkBinding(orgA, { agent_id: a1, agent_version_id: v2 });
    expect(r.status).toBe(400);
    expect(r.body['error']).toBe('agent_version_agent_mismatch');
  });

  it('hard_deny_floor_expected / approval_required / evidence_required filters work', async () => {
    const id = await mkAgent(orgA);
    const flagged = await mkBinding(orgA, { agent_id: id, hard_deny_floor_expected: true, approval_required: true, evidence_required: true, capability_category: 'CODE_EXECUTION' });
    const flaggedId = (flagged.body['agent_capability_binding'] as Record<string, unknown>)['id'] as string;
    await mkBinding(orgA, { agent_id: id, hard_deny_floor_expected: false, approval_required: false, evidence_required: false, capability_category: 'READ_ONLY' });

    const r = await inject(stack, 'GET', `/v1/regulatory/agent-capability-bindings?agent_id=${id}&hard_deny_floor_expected=true&approval_required=true&evidence_required=true&limit=200`, orgA.api_key);
    const rows = bodyOf(r)['agent_capability_bindings'] as Array<Record<string, unknown>>;
    expect(rows.map((x) => x['id'])).toContain(flaggedId);
    for (const row of rows) {
      expect(row['hard_deny_floor_expected']).toBe(true);
      expect(row['approval_required']).toBe(true);
      expect(row['evidence_required']).toBe(true);
    }

    const falseRows = bodyOf(await inject(stack, 'GET', `/v1/regulatory/agent-capability-bindings?agent_id=${id}&hard_deny_floor_expected=false&limit=200`, orgA.api_key))['agent_capability_bindings'] as Array<Record<string, unknown>>;
    for (const row of falseRows) expect(row['hard_deny_floor_expected']).toBe(false);
  });
});

describe('regulatory-agents / pagination + filters', () => {
  it('agent keyset pagination returns every agent exactly once', async () => {
    const created: string[] = [];
    for (let i = 0; i < 5; i++) created.push(await mkAgent(orgPage));
    const seen = new Set<string>();
    let cursor: { before_created_at: string; before_id: string } | null = null;
    let guard = 0;
    do {
      const qs = cursor
        ? `?limit=2&before_created_at=${encodeURIComponent(cursor.before_created_at)}&before_id=${cursor.before_id}`
        : '?limit=2';
      const page = await inject(stack, 'GET', `/v1/regulatory/agents${qs}`, orgPage.api_key);
      const rows = bodyOf(page)['agents'] as Array<Record<string, unknown>>;
      for (const row of rows) seen.add(row['id'] as string);
      cursor = bodyOf(page)['next_cursor'] as { before_created_at: string; before_id: string } | null;
      guard += 1;
    } while (cursor && guard < 20);
    for (const id of created) expect(seen.has(id)).toBe(true);
  });

  it('agent filters work for agent_status/agent_type/autonomy_level', async () => {
    await mkAgent(orgFilter, { agent_status: 'ACTIVE', agent_type: 'WORKFLOW_AGENT', autonomy_level: 'SUPERVISED_AUTONOMOUS' });
    await mkAgent(orgFilter, { agent_status: 'RETIRED', agent_type: 'RETRIEVAL_AGENT', autonomy_level: 'AUDIT_ONLY' });
    const active = await inject(stack, 'GET', '/v1/regulatory/agents?agent_status=ACTIVE&limit=200', orgFilter.api_key);
    for (const row of bodyOf(active)['agents'] as Array<Record<string, unknown>>) expect(row['agent_status']).toBe('ACTIVE');
    const byType = await inject(stack, 'GET', '/v1/regulatory/agents?agent_type=WORKFLOW_AGENT&limit=200', orgFilter.api_key);
    for (const row of bodyOf(byType)['agents'] as Array<Record<string, unknown>>) expect(row['agent_type']).toBe('WORKFLOW_AGENT');
  });

  it('version filters work for version_status; binding filters work for capability_category/risk_posture', async () => {
    const id = await mkAgent(orgFilter);
    await mkAgentVersion(orgFilter, id, { version_status: 'APPROVED' });
    await mkAgentVersion(orgFilter, id, { version_status: 'DRAFT' });
    const approved = await inject(stack, 'GET', `/v1/regulatory/agents/${id}/versions?version_status=APPROVED&limit=200`, orgFilter.api_key);
    const vrows = bodyOf(approved)['agent_versions'] as Array<Record<string, unknown>>;
    expect(vrows.length).toBeGreaterThan(0);
    for (const row of vrows) expect(row['version_status']).toBe('APPROVED');

    await mkBinding(orgFilter, { agent_id: id, capability_category: 'CODE_EXECUTION', risk_posture: 'HIGH' });
    const byCat = await inject(stack, 'GET', `/v1/regulatory/agent-capability-bindings?agent_id=${id}&capability_category=CODE_EXECUTION&risk_posture=HIGH&limit=200`, orgFilter.api_key);
    const brows = bodyOf(byCat)['agent_capability_bindings'] as Array<Record<string, unknown>>;
    expect(brows.length).toBeGreaterThan(0);
    for (const row of brows) {
      expect(row['capability_category']).toBe('CODE_EXECUTION');
      expect(row['risk_posture']).toBe('HIGH');
    }
  });
});

describe('regulatory-agents / RLS (direct DB) — agents', () => {
  it('tenant A cannot read tenant B agents directly', async () => {
    const aId = await mkAgent(orgA);
    const visibleToB = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query('SELECT id FROM govai.regulatory_agents WHERE id = $1::uuid', [aId]);
      return r.rowCount ?? 0;
    });
    expect(visibleToB).toBe(0);
  });

  it('tenant A cannot insert agent with org_id of tenant B', async () => {
    expect(await insertBlocked(orgA.org_id, agentInsert('', ''), [orgB.org_id, `AGT-${randomUUID().slice(0, 8)}`])).toBe(true);
  });

  it('tenant A cannot insert agent referencing tenant B provider/ai-system/model/version', async () => {
    expect(await insertBlocked(orgA.org_id, agentInsert(', provider_id', ', $3::uuid'), [orgA.org_id, `AGT-${randomUUID().slice(0, 8)}`, provB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, agentInsert(', primary_ai_system_id', ', $3::uuid'), [orgA.org_id, `AGT-${randomUUID().slice(0, 8)}`, aiSysB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, agentInsert(', primary_model_id', ', $3::uuid'), [orgA.org_id, `AGT-${randomUUID().slice(0, 8)}`, modelB])).toBe(true);
    // model own, version cross-tenant → version belongs-to-model EXISTS fails.
    expect(await insertBlocked(orgA.org_id, agentInsert(', primary_model_id, primary_model_version_id', ', $3::uuid, $4::uuid'), [orgA.org_id, `AGT-${randomUUID().slice(0, 8)}`, modelA, modelVersionB])).toBe(true);
  });

  it('tenant A cannot insert agent with primary_model_version_id set and primary_model_id NULL (DB CHECK)', async () => {
    expect(await insertBlocked(orgA.org_id, agentInsert(', primary_model_version_id', ', $3::uuid'), [orgA.org_id, `AGT-${randomUUID().slice(0, 8)}`, modelVersionA])).toBe(true);
  });

  it('tenant A cannot insert agent with own model but version from a different own model (RLS belongs-to)', async () => {
    const model2 = await mkModel(orgA, provA);
    expect(await insertBlocked(orgA.org_id, agentInsert(', primary_model_id, primary_model_version_id', ', $3::uuid, $4::uuid'), [orgA.org_id, `AGT-${randomUUID().slice(0, 8)}`, model2, modelVersionA])).toBe(true);
  });

  it('tenant A can insert agent referencing own provider + AI system + model + version', async () => {
    const inserted = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(
        `${agentInsert(', provider_id, primary_ai_system_id, primary_model_id, primary_model_version_id', ', $3::uuid, $4::uuid, $5::uuid, $6::uuid')} RETURNING id`,
        [orgA.org_id, `AGT-${randomUUID().slice(0, 8)}`, provA, aiSysA, modelA, modelVersionA],
      );
      return r.rowCount ?? 0;
    });
    expect(inserted).toBe(1);
  });

  it('tenant A cannot UPDATE own agent to tenant B provider/ai-system/model/version', async () => {
    const id = await mkAgent(orgA);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_agents SET provider_id = $2::uuid WHERE id = $1::uuid', [id, provB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_agents SET primary_ai_system_id = $2::uuid WHERE id = $1::uuid', [id, aiSysB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_agents SET primary_model_id = $2::uuid WHERE id = $1::uuid', [id, modelB])).toBe(true);
  });

  it('tenant A cannot UPDATE own agent to set version while model is NULL, nor clear model while version remains', async () => {
    const noModel = await mkAgent(orgA);
    // set version while model NULL → DB CHECK fails.
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_agents SET primary_model_version_id = $2::uuid WHERE id = $1::uuid', [noModel, modelVersionA])).toBe(true);
    // clear model while version remains non-NULL → DB CHECK fails.
    const withBoth = await mkAgent(orgA, { primary_model_id: modelA, primary_model_version_id: modelVersionA });
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_agents SET primary_model_id = NULL WHERE id = $1::uuid', [withBoth])).toBe(true);
  });

  it('tenant A cannot UPDATE own agent to a mismatched own model/version pairing', async () => {
    const model2 = await mkModel(orgA, provA);
    const id = await mkAgent(orgA, { primary_model_id: modelA, primary_model_version_id: modelVersionA });
    // point model_id at model2 while version still belongs to modelA → RLS belongs-to fails.
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_agents SET primary_model_id = $2::uuid WHERE id = $1::uuid', [id, model2])).toBe(true);
  });
});

describe('regulatory-agents / RLS (direct DB) — versions + bindings', () => {
  const insAgentVersion = `INSERT INTO govai.regulatory_agent_versions (org_id, agent_id, version_key, version_label, version_status)
                           VALUES ($1::uuid, $2::uuid, $3, 'v', 'DRAFT')`;
  const insBinding = `INSERT INTO govai.regulatory_agent_capability_bindings
       (org_id, agent_id, agent_version_id, capability_key, capability_name, capability_category, capability_status, risk_posture)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'c', 'NETWORK', 'PROPOSED', 'LOW')`;

  it('tenant A cannot insert agent version under tenant B agent, nor update own version to tenant B agent', async () => {
    expect(await insertBlocked(orgA.org_id, insAgentVersion, [orgA.org_id, agentB, `AVER-${randomUUID().slice(0, 8)}`])).toBe(true);
    const id = await mkAgent(orgA);
    const vId = await mkAgentVersion(orgA, id);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_agent_versions SET agent_id = $2::uuid WHERE id = $1::uuid', [vId, agentB])).toBe(true);
  });

  it('tenant A cannot insert capability binding referencing tenant B agent / agent version', async () => {
    const ownAgent = await mkAgent(orgA);
    expect(await insertBlocked(orgA.org_id, insBinding, [orgA.org_id, agentB, null, `CAP-${randomUUID().slice(0, 8)}`])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insBinding, [orgA.org_id, ownAgent, agentVersionB, `CAP-${randomUUID().slice(0, 8)}`])).toBe(true);
  });

  it('tenant A cannot insert binding with own agent but version from a different own agent', async () => {
    const a1 = await mkAgent(orgA);
    const a2 = await mkAgent(orgA);
    const v2 = await mkAgentVersion(orgA, a2);
    expect(await insertBlocked(orgA.org_id, insBinding, [orgA.org_id, a1, v2, `CAP-${randomUUID().slice(0, 8)}`])).toBe(true);
  });

  it('tenant A can insert a binding for own agent + own version directly', async () => {
    const id = await mkAgent(orgA);
    const vId = await mkAgentVersion(orgA, id);
    const inserted = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(`${insBinding} RETURNING id`, [orgA.org_id, id, vId, `CAP-${randomUUID().slice(0, 8)}`]);
      return r.rowCount ?? 0;
    });
    expect(inserted).toBe(1);
  });

  it('tenant A cannot UPDATE own binding to tenant B agent/version, nor to a mismatched own agent/version', async () => {
    const a1 = await mkAgent(orgA);
    const v1 = await mkAgentVersion(orgA, a1);
    const a2 = await mkAgent(orgA);
    const v2 = await mkAgentVersion(orgA, a2);
    const b = await mkBinding(orgA, { agent_id: a1, agent_version_id: v1 });
    const bid = (b.body['agent_capability_binding'] as Record<string, unknown>)['id'] as string;
    // cross-tenant agent
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_agent_capability_bindings SET agent_id = $2::uuid WHERE id = $1::uuid', [bid, agentB])).toBe(true);
    // cross-tenant version
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_agent_capability_bindings SET agent_version_id = $2::uuid WHERE id = $1::uuid', [bid, agentVersionB])).toBe(true);
    // mismatched own agent/version: point version at v2 (belongs to a2) while agent stays a1.
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_agent_capability_bindings SET agent_version_id = $2::uuid WHERE id = $1::uuid', [bid, v2])).toBe(true);
  });

  it('tenant A can UPDATE allowed mutable fields on own binding (no over-blocking)', async () => {
    const id = await mkAgent(orgA);
    const b = await mkBinding(orgA, { agent_id: id });
    const bid = (b.body['agent_capability_binding'] as Record<string, unknown>)['id'] as string;
    const affected = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(
        `UPDATE govai.regulatory_agent_capability_bindings
            SET capability_status = 'APPROVED', risk_posture = 'HIGH', hard_deny_floor_expected = false,
                rationale = 'reviewed'
          WHERE id = $1::uuid`,
        [bid],
      );
      return r.rowCount ?? 0;
    });
    expect(affected).toBe(1);
  });
});
