// Regulatory Core PR-R6 (issue #59, umbrella #33) — Use-case Registry.
//
// Production-focused slice: use-case identity + governance evidence, use-case ↔
// AI-system/model/agent asset links, and periodic review evidence. Covers
// auth/RBAC, CRUD-without-delete, tenant isolation (API + direct DB RLS), keyset
// pagination, validation, audit evidence, the DB-enforced version-requires-parent
// CHECKs, version-belongs-to-parent guards, and the partial unique indexes that
// keep NULL version columns from defeating uniqueness.
//
// Governance evidence only — no prompts, credentials, legal opinions, or raw
// sensitive data are stored or tested. A small fixed set of orgs + shared parent
// records is seeded once; use cases / links / reviews (which mint no api_keys)
// are created freely per test.

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
let aiSysA: string, provA: string, modelA: string, modelVerA: string, agentA: string, agentVerA: string;
let aiSysB: string, provB: string, modelB: string, modelVerB: string, agentB: string, agentVerB: string, useCaseB: string;

function bodyOf(r: { body: unknown }): Record<string, unknown> {
  return r.body as Record<string, unknown>;
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

async function mkAgent(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/agents', org.api_key, {
    agent_key: `AGT-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: 'agent',
    agent_type: 'LLM_AGENT',
    agent_status: 'ACTIVE',
    autonomy_level: 'HUMAN_APPROVAL_REQUIRED',
    execution_boundary: 'GOVAI_WORKROOM',
    human_oversight_mode: 'HUMAN_IN_LOOP',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['agent'] as Record<string, unknown>)['id'] as string;
}

async function mkAgentVersion(org: AdminOrg, agentId: string): Promise<string> {
  const r = await inject(stack, 'POST', `/v1/regulatory/agents/${agentId}/versions`, org.api_key, {
    version_key: `AVER-${randomUUID().slice(0, 8).toUpperCase()}`,
    version_label: 'v1',
    version_status: 'APPROVED',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['agent_version'] as Record<string, unknown>)['id'] as string;
}

const baseUseCase = (overrides: Record<string, unknown> = {}) => ({
  use_case_key: `UC-${randomUUID().slice(0, 8).toUpperCase()}`,
  name: 'tenant use case',
  use_case_status: 'PROPOSED',
  use_case_category: 'CUSTOMER_SUPPORT',
  business_criticality: 'MEDIUM',
  deployment_scope: 'INTERNAL_ONLY',
  ...overrides,
});

async function mkUseCaseResp(org: AdminOrg, overrides: Record<string, unknown> = {}) {
  const r = await inject(stack, 'POST', '/v1/regulatory/use-cases', org.api_key, baseUseCase(overrides));
  return { status: r.statusCode, body: bodyOf(r) };
}

async function mkUseCase(org: AdminOrg, overrides: Record<string, unknown> = {}): Promise<string> {
  const r = await mkUseCaseResp(org, overrides);
  expect(r.status).toBe(201);
  return (r.body['use_case'] as Record<string, unknown>)['id'] as string;
}

async function mkLink(org: AdminOrg, body: Record<string, unknown>) {
  const r = await inject(stack, 'POST', '/v1/regulatory/use-case-asset-links', org.api_key, {
    link_status: 'PROPOSED',
    usage_role: 'PRIMARY_SYSTEM',
    deployment_environment: 'PRODUCTION',
    ...body,
  });
  return { status: r.statusCode, body: bodyOf(r) };
}

const baseReview = (overrides: Record<string, unknown> = {}) => ({
  review_key: `RV-${randomUUID().slice(0, 8).toUpperCase()}`,
  review_type: 'PERIODIC_REVIEW',
  review_status: 'DRAFT',
  review_outcome: 'NO_DECISION',
  ...overrides,
});

async function mkReview(org: AdminOrg, useCaseId: string, overrides: Record<string, unknown> = {}) {
  const r = await inject(stack, 'POST', `/v1/regulatory/use-cases/${useCaseId}/reviews`, org.api_key, baseReview(overrides));
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
      `SELECT 1 FROM govai.audit_events WHERE org_id = $1::uuid AND subject_id = $2::uuid AND event_type = $3`,
      [orgId, subjectId, eventType],
    );
    return r.rowCount ?? 0;
  } finally {
    c.release();
  }
}

function ucInsert(extraCols: string, extraVals: string): string {
  return `INSERT INTO govai.regulatory_use_cases
     (org_id, use_case_key, name, use_case_status, use_case_category, business_criticality, deployment_scope${extraCols})
   VALUES ($1::uuid, $2, 'x', 'PROPOSED', 'OTHER', 'LOW', 'INTERNAL_ONLY'${extraVals})`;
}

function linkInsert(extraCols: string, extraVals: string): string {
  return `INSERT INTO govai.regulatory_use_case_asset_links
     (org_id, use_case_id, ai_system_id, link_status, usage_role, deployment_environment${extraCols})
   VALUES ($1::uuid, $2::uuid, $3::uuid, 'PROPOSED', 'PRIMARY_SYSTEM', 'PRODUCTION'${extraVals})`;
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

  aiSysA = await mkAiSystem(orgA);
  provA = await mkProvider(orgA);
  modelA = await mkModel(orgA, provA);
  modelVerA = await mkModelVersion(orgA, modelA);
  agentA = await mkAgent(orgA);
  agentVerA = await mkAgentVersion(orgA, agentA);

  aiSysB = await mkAiSystem(orgB);
  provB = await mkProvider(orgB);
  modelB = await mkModel(orgB, provB);
  modelVerB = await mkModelVersion(orgB, modelB);
  agentB = await mkAgent(orgB);
  agentVerB = await mkAgentVersion(orgB, agentB);
  useCaseB = await mkUseCase(orgB);
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

describe('regulatory-use-cases / auth + rbac', () => {
  it('rejects unauthenticated reads and writes (401)', async () => {
    expect((await inject(stack, 'GET', '/v1/regulatory/use-cases', undefined)).statusCode).toBe(401);
    expect((await inject(stack, 'POST', '/v1/regulatory/use-cases', undefined, baseUseCase())).statusCode).toBe(401);
  });

  it('a non-write role can read but not write', async () => {
    expect((await inject(stack, 'GET', '/v1/regulatory/use-cases', devOrg.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'POST', '/v1/regulatory/use-cases', devOrg.api_key, baseUseCase())).statusCode).toBe(403);
    expect((await inject(stack, 'GET', '/v1/regulatory/use-case-asset-links', devOrg.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'POST', '/v1/regulatory/use-case-asset-links', devOrg.api_key, { use_case_id: randomUUID(), ai_system_id: randomUUID(), link_status: 'PROPOSED', usage_role: 'PRIMARY_SYSTEM', deployment_environment: 'PRODUCTION' })).statusCode).toBe(403);
  });

  it('admin write role can create use case, asset link, and review', async () => {
    const uc = await mkUseCase(orgA, { primary_ai_system_id: aiSysA });
    const link = await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA });
    expect(link.status).toBe(201);
    const rev = await mkReview(orgA, uc);
    expect(rev.status).toBe(201);
  });
});

describe('regulatory-use-cases / use-case API', () => {
  it('creates use case linked to own AI system; created audit emitted; list own only; GET own/cross', async () => {
    const r = await mkUseCaseResp(orgA, { primary_ai_system_id: aiSysA });
    expect(r.status).toBe(201);
    const uc = r.body['use_case'] as Record<string, unknown>;
    expect(uc['primary_ai_system_id']).toBe(aiSysA);
    const id = uc['id'] as string;
    expect(await auditCount(orgA.org_id, id, 'regulatory_use_case.created')).toBe(1);
    const listB = await inject(stack, 'GET', '/v1/regulatory/use-cases?limit=200', orgB.api_key);
    expect((bodyOf(listB)['use_cases'] as Array<Record<string, unknown>>).map((x) => x['id'])).not.toContain(id);
    expect((await inject(stack, 'GET', `/v1/regulatory/use-cases/${id}`, orgA.api_key)).statusCode).toBe(200);
    const cross = await inject(stack, 'GET', `/v1/regulatory/use-cases/${id}`, orgB.api_key);
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('use_case_not_found');
  });

  it('PATCH updates fields and emits updated audit; status transition emits status_changed', async () => {
    const id = await mkUseCase(orgA, { use_case_status: 'PROPOSED' });
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/use-cases/${id}`, orgA.api_key, { name: 'renamed', legal_basis_summary: 'LGPD Art. 7' });
    expect(patch.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, id, 'regulatory_use_case.updated')).toBe(1);
    await inject(stack, 'PATCH', `/v1/regulatory/use-cases/${id}`, orgA.api_key, { use_case_status: 'ACTIVE' });
    expect(await auditCount(orgA.org_id, id, 'regulatory_use_case.status_changed')).toBe(1);
  });

  it('next_review_at change emits review_due_changed audit', async () => {
    const id = await mkUseCase(orgA);
    await inject(stack, 'PATCH', `/v1/regulatory/use-cases/${id}`, orgA.api_key, { next_review_at: '2026-12-31T00:00:00.000Z' });
    expect(await auditCount(orgA.org_id, id, 'regulatory_use_case.review_due_changed')).toBe(1);
  });

  it('duplicate use_case_key rejected (409); same key across tenants allowed', async () => {
    const key = `UC-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await mkUseCaseResp(orgA, { use_case_key: key })).status).toBe(201);
    const dup = await mkUseCaseResp(orgA, { use_case_key: key });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('use_case_key_conflict');
    expect((await mkUseCaseResp(orgB, { use_case_key: key })).status).toBe(201);
  });

  it('invalid enum/key rejected with 400; empty PATCH rejected with 400', async () => {
    expect((await mkUseCaseResp(orgA, { use_case_status: 'NOPE' })).status).toBe(400);
    expect((await mkUseCaseResp(orgA, { use_case_key: 'bad key' })).status).toBe(400);
    const id = await mkUseCase(orgA);
    expect((await inject(stack, 'PATCH', `/v1/regulatory/use-cases/${id}`, orgA.api_key, {})).statusCode).toBe(400);
  });

  it('cross-tenant primary_ai_system_id returns 404 without leakage', async () => {
    const r = await mkUseCaseResp(orgA, { primary_ai_system_id: aiSysB });
    expect(r.status).toBe(404);
    expect(r.body['error']).toBe('ai_system_not_found');
  });
});

describe('regulatory-use-cases / asset link API', () => {
  it('creates links with system, system+model+version, system+agent+version; created audit; list/GET own', async () => {
    const uc = await mkUseCase(orgA);
    const l1 = await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA });
    expect(l1.status).toBe(201);
    const lid = (l1.body['use_case_asset_link'] as Record<string, unknown>)['id'] as string;
    expect(await auditCount(orgA.org_id, lid, 'regulatory_use_case_asset_link.created')).toBe(1);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, model_id: modelA, model_version_id: modelVerA, usage_role: 'PRIMARY_MODEL' })).status).toBe(201);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, agent_id: agentA, agent_version_id: agentVerA, usage_role: 'PRIMARY_AGENT' })).status).toBe(201);
    const list = await inject(stack, 'GET', `/v1/regulatory/use-case-asset-links?use_case_id=${uc}&limit=200`, orgA.api_key);
    expect((bodyOf(list)['use_case_asset_links'] as Array<Record<string, unknown>>).map((x) => x['id'])).toContain(lid);
    expect((await inject(stack, 'GET', `/v1/regulatory/use-case-asset-links/${lid}`, orgA.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', `/v1/regulatory/use-case-asset-links/${lid}`, orgB.api_key)).statusCode).toBe(404);
  });

  it('PATCH mutable fields + status_changed; RETIRED/effective_to emits retired', async () => {
    const uc = await mkUseCase(orgA);
    const l = await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, link_status: 'PROPOSED' });
    const lid = (l.body['use_case_asset_link'] as Record<string, unknown>)['id'] as string;
    await inject(stack, 'PATCH', `/v1/regulatory/use-case-asset-links/${lid}`, orgA.api_key, { rationale: 'updated' });
    expect(await auditCount(orgA.org_id, lid, 'regulatory_use_case_asset_link.updated')).toBe(1);
    await inject(stack, 'PATCH', `/v1/regulatory/use-case-asset-links/${lid}`, orgA.api_key, { link_status: 'RETIRED' });
    expect(await auditCount(orgA.org_id, lid, 'regulatory_use_case_asset_link.status_changed')).toBe(1);
    expect(await auditCount(orgA.org_id, lid, 'regulatory_use_case_asset_link.retired')).toBe(1);
  });

  it('version-without-parent and mismatched version rejected (400); duplicate tuple rejected (409)', async () => {
    const uc = await mkUseCase(orgA);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, model_version_id: modelVerA })).status).toBe(400);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, agent_version_id: agentVerA })).status).toBe(400);
    const model2 = await mkModel(orgA, provA);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, model_id: model2, model_version_id: modelVerA })).body['error']).toBe('model_version_model_mismatch');
    const agent2 = await mkAgent(orgA);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, agent_id: agent2, agent_version_id: agentVerA })).body['error']).toBe('agent_version_agent_mismatch');
    const first = await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, usage_role: 'SUPPORTING_SYSTEM', deployment_environment: 'STAGING' });
    expect(first.status).toBe(201);
    const dup = await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, usage_role: 'SUPPORTING_SYSTEM', deployment_environment: 'STAGING' });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('use_case_asset_link_conflict');
  });

  it('cross-tenant parents rejected without leakage', async () => {
    const uc = await mkUseCase(orgA);
    expect((await mkLink(orgA, { use_case_id: useCaseB, ai_system_id: aiSysA })).status).toBe(404);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysB })).status).toBe(404);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, model_id: modelB })).status).toBe(404);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, model_id: modelA, model_version_id: modelVerB })).status).toBe(404);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, agent_id: agentB })).status).toBe(404);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, agent_id: agentA, agent_version_id: agentVerB })).status).toBe(404);
  });
});

describe('regulatory-use-cases / review API', () => {
  it('creates review under own use case; created audit; list/GET own; cross-tenant 404', async () => {
    const uc = await mkUseCase(orgA);
    const rev = await mkReview(orgA, uc);
    expect(rev.status).toBe(201);
    const rid = (rev.body['use_case_review'] as Record<string, unknown>)['id'] as string;
    expect(await auditCount(orgA.org_id, rid, 'regulatory_use_case_review.created')).toBe(1);
    const list = await inject(stack, 'GET', `/v1/regulatory/use-cases/${uc}/reviews?limit=200`, orgA.api_key);
    expect((bodyOf(list)['use_case_reviews'] as Array<Record<string, unknown>>).map((x) => x['id'])).toContain(rid);
    expect((await inject(stack, 'GET', `/v1/regulatory/use-case-reviews/${rid}`, orgA.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', `/v1/regulatory/use-case-reviews/${rid}`, orgB.api_key)).statusCode).toBe(404);
  });

  it('PATCH review: status_changed, completed, outcome_changed audits', async () => {
    const uc = await mkUseCase(orgA);
    const rev = await mkReview(orgA, uc, { review_status: 'IN_REVIEW', review_outcome: 'NO_DECISION' });
    const rid = (rev.body['use_case_review'] as Record<string, unknown>)['id'] as string;
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/use-case-reviews/${rid}`, orgA.api_key, {
      review_status: 'COMPLETED',
      review_outcome: 'APPROVED',
      reviewed_at: '2026-05-22T00:00:00.000Z',
    });
    expect(patch.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, rid, 'regulatory_use_case_review.updated')).toBe(1);
    expect(await auditCount(orgA.org_id, rid, 'regulatory_use_case_review.status_changed')).toBe(1);
    expect(await auditCount(orgA.org_id, rid, 'regulatory_use_case_review.completed')).toBe(1);
    expect(await auditCount(orgA.org_id, rid, 'regulatory_use_case_review.outcome_changed')).toBe(1);
  });

  it('duplicate review_key for same use case rejected; same key under different use case allowed; empty PATCH 400', async () => {
    const uc1 = await mkUseCase(orgA);
    const uc2 = await mkUseCase(orgA);
    const key = `RV-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await mkReview(orgA, uc1, { review_key: key })).status).toBe(201);
    const dup = await mkReview(orgA, uc1, { review_key: key });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('use_case_review_key_conflict');
    expect((await mkReview(orgA, uc2, { review_key: key })).status).toBe(201);
    const rev = await mkReview(orgA, uc1);
    const rid = (rev.body['use_case_review'] as Record<string, unknown>)['id'] as string;
    expect((await inject(stack, 'PATCH', `/v1/regulatory/use-case-reviews/${rid}`, orgA.api_key, {})).statusCode).toBe(400);
  });

  it('create review under cross-tenant use case returns 404 without leakage', async () => {
    const r = await mkReview(orgA, useCaseB);
    expect(r.status).toBe(404);
    expect(r.body['error']).toBe('use_case_not_found');
  });
});

describe('regulatory-use-cases / pagination + filters', () => {
  it('use-case keyset pagination returns every use case exactly once', async () => {
    const created: string[] = [];
    for (let i = 0; i < 5; i++) created.push(await mkUseCase(orgPage));
    const seen = new Set<string>();
    let cursor: { before_created_at: string; before_id: string } | null = null;
    let guard = 0;
    do {
      const qs = cursor
        ? `?limit=2&before_created_at=${encodeURIComponent(cursor.before_created_at)}&before_id=${cursor.before_id}`
        : '?limit=2';
      const page = await inject(stack, 'GET', `/v1/regulatory/use-cases${qs}`, orgPage.api_key);
      const rows = bodyOf(page)['use_cases'] as Array<Record<string, unknown>>;
      for (const row of rows) seen.add(row['id'] as string);
      cursor = bodyOf(page)['next_cursor'] as { before_created_at: string; before_id: string } | null;
      guard += 1;
    } while (cursor && guard < 20);
    for (const id of created) expect(seen.has(id)).toBe(true);
  });

  it('use-case filters (status/category/criticality/scope) and next_review_before work', async () => {
    await mkUseCase(orgFilter, { use_case_status: 'ACTIVE', use_case_category: 'LEGAL_SUPPORT', business_criticality: 'HIGH', deployment_scope: 'PUBLIC_FACING', next_review_at: '2026-01-01T00:00:00.000Z' });
    await mkUseCase(orgFilter, { use_case_status: 'RETIRED', use_case_category: 'HR_EMPLOYMENT', business_criticality: 'LOW', deployment_scope: 'INTERNAL_ONLY' });
    const active = await inject(stack, 'GET', '/v1/regulatory/use-cases?use_case_status=ACTIVE&business_criticality=HIGH&limit=200', orgFilter.api_key);
    const rows = bodyOf(active)['use_cases'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) { expect(row['use_case_status']).toBe('ACTIVE'); expect(row['business_criticality']).toBe('HIGH'); }
    const due = await inject(stack, 'GET', '/v1/regulatory/use-cases?next_review_before=2026-06-01T00:00:00.000Z&limit=200', orgFilter.api_key);
    for (const row of bodyOf(due)['use_cases'] as Array<Record<string, unknown>>) expect(row['next_review_at']).not.toBeNull();
  });

  it('asset link and review filters work', async () => {
    const uc = await mkUseCase(orgFilter);
    const aiF = await mkAiSystem(orgFilter);
    await mkLink(orgFilter, { use_case_id: uc, ai_system_id: aiF, link_status: 'ACTIVE', usage_role: 'SUPPORTING_SYSTEM' });
    const byStatus = await inject(stack, 'GET', `/v1/regulatory/use-case-asset-links?use_case_id=${uc}&link_status=ACTIVE&usage_role=SUPPORTING_SYSTEM&limit=200`, orgFilter.api_key);
    const lrows = bodyOf(byStatus)['use_case_asset_links'] as Array<Record<string, unknown>>;
    expect(lrows.length).toBeGreaterThan(0);
    for (const row of lrows) { expect(row['link_status']).toBe('ACTIVE'); expect(row['usage_role']).toBe('SUPPORTING_SYSTEM'); }
    await mkReview(orgFilter, uc, { review_status: 'COMPLETED', review_outcome: 'APPROVED', review_type: 'INITIAL_REVIEW' });
    const rv = await inject(stack, 'GET', `/v1/regulatory/use-cases/${uc}/reviews?review_status=COMPLETED&review_outcome=APPROVED&limit=200`, orgFilter.api_key);
    const rrows = bodyOf(rv)['use_case_reviews'] as Array<Record<string, unknown>>;
    expect(rrows.length).toBeGreaterThan(0);
    for (const row of rrows) { expect(row['review_status']).toBe('COMPLETED'); expect(row['review_outcome']).toBe('APPROVED'); }
  });
});

describe('regulatory-use-cases / RLS (direct DB) — use cases', () => {
  it('tenant A cannot read tenant B use cases directly', async () => {
    const id = await mkUseCase(orgA);
    const seen = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query('SELECT id FROM govai.regulatory_use_cases WHERE id = $1::uuid', [id]);
      return r.rowCount ?? 0;
    });
    expect(seen).toBe(0);
  });

  it('tenant A cannot insert use case with org_id of tenant B nor referencing tenant B AI system', async () => {
    expect(await insertBlocked(orgA.org_id, ucInsert('', ''), [orgB.org_id, `UC-${randomUUID().slice(0, 8)}`])).toBe(true);
    expect(await insertBlocked(orgA.org_id, ucInsert(', primary_ai_system_id', ', $3::uuid'), [orgA.org_id, `UC-${randomUUID().slice(0, 8)}`, aiSysB])).toBe(true);
  });

  it('tenant A can insert use case referencing own AI system; cannot UPDATE to tenant B AI system', async () => {
    const inserted = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(`${ucInsert(', primary_ai_system_id', ', $3::uuid')} RETURNING id`, [orgA.org_id, `UC-${randomUUID().slice(0, 8)}`, aiSysA]);
      return r.rowCount ?? 0;
    });
    expect(inserted).toBe(1);
    const id = await mkUseCase(orgA, { primary_ai_system_id: aiSysA });
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_use_cases SET primary_ai_system_id = $2::uuid WHERE id = $1::uuid', [id, aiSysB])).toBe(true);
  });
});

describe('regulatory-use-cases / RLS (direct DB) — asset links', () => {
  it('tenant A cannot insert asset link with org_id of B, or referencing tenant B use case / AI system / model / model version', async () => {
    const uc = await mkUseCase(orgA);
    expect(await insertBlocked(orgA.org_id, linkInsert('', ''), [orgB.org_id, uc, aiSysA])).toBe(true);
    expect(await insertBlocked(orgA.org_id, linkInsert('', ''), [orgA.org_id, useCaseB, aiSysA])).toBe(true);
    expect(await insertBlocked(orgA.org_id, linkInsert('', ''), [orgA.org_id, uc, aiSysB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, linkInsert(', model_id', ', $4::uuid'), [orgA.org_id, uc, aiSysA, modelB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, linkInsert(', model_id, model_version_id', ', $4::uuid, $5::uuid'), [orgA.org_id, uc, aiSysA, modelA, modelVerB])).toBe(true);
  });

  it('tenant A cannot insert asset link: model_version without model, own model + foreign-model version', async () => {
    const uc = await mkUseCase(orgA);
    // model_version_id set, model_id NULL → DB CHECK.
    expect(await insertBlocked(orgA.org_id, linkInsert(', model_version_id', ', $4::uuid'), [orgA.org_id, uc, aiSysA, modelVerA])).toBe(true);
    // own model2 + version of model1 → RLS belongs-to.
    const model2 = await mkModel(orgA, provA);
    expect(await insertBlocked(orgA.org_id, linkInsert(', model_id, model_version_id', ', $4::uuid, $5::uuid'), [orgA.org_id, uc, aiSysA, model2, modelVerA])).toBe(true);
  });

  it('tenant A cannot insert asset link: cross-tenant agent/version, agent_version without agent, own agent + foreign-agent version', async () => {
    const uc = await mkUseCase(orgA);
    expect(await insertBlocked(orgA.org_id, linkInsert(', agent_id', ', $4::uuid'), [orgA.org_id, uc, aiSysA, agentB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, linkInsert(', agent_id, agent_version_id', ', $4::uuid, $5::uuid'), [orgA.org_id, uc, aiSysA, agentA, agentVerB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, linkInsert(', agent_version_id', ', $4::uuid'), [orgA.org_id, uc, aiSysA, agentVerA])).toBe(true);
    const agent2 = await mkAgent(orgA);
    expect(await insertBlocked(orgA.org_id, linkInsert(', agent_id, agent_version_id', ', $4::uuid, $5::uuid'), [orgA.org_id, uc, aiSysA, agent2, agentVerA])).toBe(true);
  });

  it('tenant A can insert asset link referencing own use case + AI system + model/version + agent/version', async () => {
    const uc = await mkUseCase(orgA);
    const inserted = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(
        `${linkInsert(', model_id, model_version_id, agent_id, agent_version_id', ', $4::uuid, $5::uuid, $6::uuid, $7::uuid')} RETURNING id`,
        [orgA.org_id, uc, aiSysA, modelA, modelVerA, agentA, agentVerA],
      );
      return r.rowCount ?? 0;
    });
    expect(inserted).toBe(1);
  });

  it('tenant A cannot UPDATE own asset link to cross-tenant or mismatched references', async () => {
    const uc = await mkUseCase(orgA);
    const l = await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, model_id: modelA, model_version_id: modelVerA, agent_id: agentA, agent_version_id: agentVerA, usage_role: 'PRIMARY_MODEL' });
    const lid = (l.body['use_case_asset_link'] as Record<string, unknown>)['id'] as string;
    const model2 = await mkModel(orgA, provA);
    const agent2 = await mkAgent(orgA);
    const v2model = await mkModelVersion(orgA, model2);
    const v2agent = await mkAgentVersion(orgA, agent2);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_use_case_asset_links SET use_case_id = $2::uuid WHERE id = $1::uuid', [lid, useCaseB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_use_case_asset_links SET ai_system_id = $2::uuid WHERE id = $1::uuid', [lid, aiSysB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_use_case_asset_links SET model_id = $2::uuid WHERE id = $1::uuid', [lid, modelB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_use_case_asset_links SET model_version_id = $2::uuid WHERE id = $1::uuid', [lid, modelVerB])).toBe(true);
    // model_version with model NULL → CHECK.
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_use_case_asset_links SET model_id = NULL WHERE id = $1::uuid', [lid])).toBe(true);
    // mismatched own model/version (point version to v2model belonging to model2 while model stays modelA).
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_use_case_asset_links SET model_version_id = $2::uuid WHERE id = $1::uuid', [lid, v2model])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_use_case_asset_links SET agent_id = $2::uuid WHERE id = $1::uuid', [lid, agentB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_use_case_asset_links SET agent_version_id = $2::uuid WHERE id = $1::uuid', [lid, agentVerB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_use_case_asset_links SET agent_id = NULL WHERE id = $1::uuid', [lid])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_use_case_asset_links SET agent_version_id = $2::uuid WHERE id = $1::uuid', [lid, v2agent])).toBe(true);
  });

  it('tenant A can UPDATE allowed mutable fields on own asset link (no over-blocking)', async () => {
    const uc = await mkUseCase(orgA);
    const l = await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA });
    const lid = (l.body['use_case_asset_link'] as Record<string, unknown>)['id'] as string;
    const affected = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(
        `UPDATE govai.regulatory_use_case_asset_links SET link_status = 'ACTIVE', rationale = 'reviewed', evidence_reference = 'EVID-1' WHERE id = $1::uuid`,
        [lid],
      );
      return r.rowCount ?? 0;
    });
    expect(affected).toBe(1);
  });
});

describe('regulatory-use-cases / RLS (direct DB) — reviews', () => {
  const revInsert = `INSERT INTO govai.regulatory_use_case_reviews
       (org_id, use_case_id, review_key, review_type, review_status, review_outcome)
     VALUES ($1::uuid, $2::uuid, $3, 'PERIODIC_REVIEW', 'DRAFT', 'NO_DECISION')`;

  it('tenant A cannot insert review under tenant B use case, nor update own review to tenant B use case', async () => {
    expect(await insertBlocked(orgA.org_id, revInsert, [orgA.org_id, useCaseB, `RV-${randomUUID().slice(0, 8)}`])).toBe(true);
    const uc = await mkUseCase(orgA);
    const rev = await mkReview(orgA, uc);
    const rid = (rev.body['use_case_review'] as Record<string, unknown>)['id'] as string;
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_use_case_reviews SET use_case_id = $2::uuid WHERE id = $1::uuid', [rid, useCaseB])).toBe(true);
  });

  it('tenant A can insert review under own use case and update allowed mutable fields', async () => {
    const uc = await mkUseCase(orgA);
    const inserted = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(`${revInsert} RETURNING id`, [orgA.org_id, uc, `RV-${randomUUID().slice(0, 8)}`]);
      return r.rowCount ?? 0;
    });
    expect(inserted).toBe(1);
    const rev = await mkReview(orgA, uc);
    const rid = (rev.body['use_case_review'] as Record<string, unknown>)['id'] as string;
    const affected = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(`UPDATE govai.regulatory_use_case_reviews SET findings_summary = 'ok', review_status = 'IN_REVIEW' WHERE id = $1::uuid`, [rid]);
      return r.rowCount ?? 0;
    });
    expect(affected).toBe(1);
  });
});

describe('regulatory-use-cases / uniqueness + NULL correctness', () => {
  it('duplicate tuples are rejected across all version-presence combinations; same tuple cross-tenant allowed', async () => {
    const uc = await mkUseCase(orgA);
    // both version columns present
    const a = await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, model_id: modelA, model_version_id: modelVerA, agent_id: agentA, agent_version_id: agentVerA, usage_role: 'PRIMARY_MODEL', deployment_environment: 'PRODUCTION' });
    expect(a.status).toBe(201);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, model_id: modelA, model_version_id: modelVerA, agent_id: agentA, agent_version_id: agentVerA, usage_role: 'PRIMARY_MODEL', deployment_environment: 'PRODUCTION' })).status).toBe(409);
    // both NULL
    const b = await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, usage_role: 'MONITORING', deployment_environment: 'STAGING' });
    expect(b.status).toBe(201);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, usage_role: 'MONITORING', deployment_environment: 'STAGING' })).status).toBe(409);
    // model_version present, agent_version NULL
    const c = await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, model_id: modelA, model_version_id: modelVerA, usage_role: 'FALLBACK_MODEL', deployment_environment: 'PRODUCTION' });
    expect(c.status).toBe(201);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, model_id: modelA, model_version_id: modelVerA, usage_role: 'FALLBACK_MODEL', deployment_environment: 'PRODUCTION' })).status).toBe(409);
    // agent_version present, model_version NULL
    const d = await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, agent_id: agentA, agent_version_id: agentVerA, usage_role: 'SUPPORTING_AGENT', deployment_environment: 'PRODUCTION' });
    expect(d.status).toBe(201);
    expect((await mkLink(orgA, { use_case_id: uc, ai_system_id: aiSysA, agent_id: agentA, agent_version_id: agentVerA, usage_role: 'SUPPORTING_AGENT', deployment_environment: 'PRODUCTION' })).status).toBe(409);
    // same both-NULL tuple under a different tenant's own use case is allowed
    const ucB = await mkUseCase(orgB);
    expect((await mkLink(orgB, { use_case_id: ucB, ai_system_id: aiSysB, usage_role: 'MONITORING', deployment_environment: 'STAGING' })).status).toBe(201);
  });
});
