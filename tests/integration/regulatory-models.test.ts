// Regulatory Core PR-R4 (issue #59, umbrella #33) — Model Registry.
//
// Production-focused slice: model identity, version provenance, and
// AI-system/model-version bindings. Covers auth/RBAC, CRUD-without-delete,
// tenant isolation (API + direct DB RLS), keyset pagination, validation, audit
// evidence (created/updated/status_changed/approved/retired), and the
// DB-enforced parent-visibility + version-belongs-to-model guards.
//
// Provenance/metadata only — no artifacts, training data, datasets, or
// credentials are stored or tested. A small fixed set of orgs + shared parent
// records is seeded once; models/versions/links (which mint no api_keys) are
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
let provB: string;
let aiSysB: string;
let modelB: string;
let versionB: string;
let provPage: string;
let provFilter: string;

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

const baseModel = (providerId: string, overrides: Record<string, unknown> = {}) => ({
  model_key: `MDL-${randomUUID().slice(0, 8).toUpperCase()}`,
  name: 'tenant model',
  model_type: 'FOUNDATION_MODEL',
  model_status: 'PROPOSED',
  provider_id: providerId,
  ...overrides,
});

async function mkModel(org: AdminOrg, providerId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/models', org.api_key, baseModel(providerId, overrides));
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['model'] as Record<string, unknown>)['id'] as string;
}

const baseVersion = (overrides: Record<string, unknown> = {}) => ({
  version_key: `VER-${randomUUID().slice(0, 8).toUpperCase()}`,
  version_label: 'v1.0.0',
  version_status: 'DRAFT',
  ...overrides,
});

async function mkVersion(org: AdminOrg, modelId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const r = await inject(stack, 'POST', `/v1/regulatory/models/${modelId}/versions`, org.api_key, baseVersion(overrides));
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['model_version'] as Record<string, unknown>)['id'] as string;
}

async function mkLink(org: AdminOrg, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await inject(stack, 'POST', '/v1/regulatory/ai-system-model-links', org.api_key, {
    link_status: 'PROPOSED',
    usage_role: 'PRIMARY_MODEL',
    deployment_environment: 'PRODUCTION',
    ...body,
  });
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
  provB = await mkProvider(orgB);
  aiSysB = await mkAiSystem(orgB);
  modelB = await mkModel(orgB, provB);
  versionB = await mkVersion(orgB, modelB);
  provPage = await mkProvider(orgPage);
  provFilter = await mkProvider(orgFilter);
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

const MODEL_COLS = '(org_id, model_key, name, model_type, model_status, provider_id, primary_ai_system_id, regulatory_source_id, control_id)';
const insModel = `INSERT INTO govai.regulatory_models ${MODEL_COLS}
   VALUES ($1::uuid, $2, 'x', 'OTHER', 'PROPOSED', $3::uuid, $4::uuid, NULL, NULL)`;

describe('regulatory-models / auth + rbac', () => {
  it('rejects unauthenticated reads and writes (401)', async () => {
    expect((await inject(stack, 'GET', '/v1/regulatory/models', undefined)).statusCode).toBe(401);
    expect((await inject(stack, 'POST', '/v1/regulatory/models', undefined, baseModel(provA))).statusCode).toBe(401);
  });

  it('a non-write role can read but not write models, versions, and links', async () => {
    expect((await inject(stack, 'GET', '/v1/regulatory/models', devOrg.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'POST', '/v1/regulatory/models', devOrg.api_key, baseModel(provA))).statusCode).toBe(403);
    expect((await inject(stack, 'GET', '/v1/regulatory/ai-system-model-links', devOrg.api_key)).statusCode).toBe(200);
    // Shape-valid body so the request reaches the write-role gate (403) rather
    // than failing validation (400) first.
    const linkBody = {
      ai_system_id: randomUUID(),
      model_id: randomUUID(),
      model_version_id: randomUUID(),
      link_status: 'PROPOSED',
      usage_role: 'PRIMARY_MODEL',
      deployment_environment: 'PRODUCTION',
    };
    expect((await inject(stack, 'POST', '/v1/regulatory/ai-system-model-links', devOrg.api_key, linkBody)).statusCode).toBe(403);
  });

  it('admin write role can create model, version, and link', async () => {
    const mId = await mkModel(orgA, provA, { primary_ai_system_id: aiSysA });
    const vId = await mkVersion(orgA, mId);
    const link = await mkLink(orgA, { ai_system_id: aiSysA, model_id: mId, model_version_id: vId });
    expect(link.status).toBe(201);
  });
});

describe('regulatory-models / model API', () => {
  it('admin creates a model linked to own provider and optional own AI system; created audit emitted', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/models', orgA.api_key, baseModel(provA, { primary_ai_system_id: aiSysA }));
    expect(r.statusCode).toBe(201);
    const m = bodyOf(r)['model'] as Record<string, unknown>;
    expect(m['provider_id']).toBe(provA);
    expect(m['primary_ai_system_id']).toBe(aiSysA);
    expect(await auditCount(orgA.org_id, m['id'] as string, 'regulatory_model.created')).toBe(1);
  });

  it('list returns own tenant models only', async () => {
    const aId = await mkModel(orgA, provA);
    const listB = await inject(stack, 'GET', '/v1/regulatory/models?limit=200', orgB.api_key);
    const rows = bodyOf(listB)['models'] as Array<Record<string, unknown>>;
    expect(rows.map((m) => m['id'])).not.toContain(aId);
    for (const row of rows) expect(row['org_id']).toBe(orgB.org_id);
  });

  it('GET own id works; GET other tenant id returns 404 without leakage', async () => {
    const aId = await mkModel(orgA, provA);
    expect((await inject(stack, 'GET', `/v1/regulatory/models/${aId}`, orgA.api_key)).statusCode).toBe(200);
    const cross = await inject(stack, 'GET', `/v1/regulatory/models/${aId}`, orgB.api_key);
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('model_not_found');
  });

  it('PATCH updates allowed fields and emits updated audit', async () => {
    const id = await mkModel(orgA, provA);
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/models/${id}`, orgA.api_key, { name: 'renamed', intended_use: 'summarization' });
    expect(patch.statusCode).toBe(200);
    expect((bodyOf(patch)['model'] as Record<string, unknown>)['name']).toBe('renamed');
    expect(await auditCount(orgA.org_id, id, 'regulatory_model.updated')).toBe(1);
  });

  it('model_status transition emits status_changed audit', async () => {
    const id = await mkModel(orgA, provA, { model_status: 'PROPOSED' });
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/models/${id}`, orgA.api_key, { model_status: 'ACTIVE' });
    expect(patch.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, id, 'regulatory_model.status_changed')).toBe(1);
  });

  it('duplicate model_key in same tenant rejected (409); same key across tenants allowed', async () => {
    const key = `MDL-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await inject(stack, 'POST', '/v1/regulatory/models', orgA.api_key, baseModel(provA, { model_key: key }))).statusCode).toBe(201);
    const dup = await inject(stack, 'POST', '/v1/regulatory/models', orgA.api_key, baseModel(provA, { model_key: key }));
    expect(dup.statusCode).toBe(409);
    expect(bodyOf(dup)['error']).toBe('model_key_conflict');
    expect((await inject(stack, 'POST', '/v1/regulatory/models', orgB.api_key, baseModel(provB, { model_key: key }))).statusCode).toBe(201);
  });

  it('invalid enum / invalid key rejected with 400', async () => {
    expect((await inject(stack, 'POST', '/v1/regulatory/models', orgA.api_key, baseModel(provA, { model_status: 'NOPE' }))).statusCode).toBe(400);
    expect((await inject(stack, 'POST', '/v1/regulatory/models', orgA.api_key, baseModel(provA, { model_key: 'bad key' }))).statusCode).toBe(400);
  });

  it('missing provider returns provider_not_found (404)', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/models', orgA.api_key, baseModel(randomUUID()));
    expect(r.statusCode).toBe(404);
    expect(bodyOf(r)['error']).toBe('provider_not_found');
  });

  it('cross-tenant provider_id returns 404 without leakage', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/models', orgA.api_key, baseModel(provB));
    expect(r.statusCode).toBe(404);
    expect(bodyOf(r)['error']).toBe('provider_not_found');
  });

  it('cross-tenant primary_ai_system_id returns 404 without leakage', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/models', orgA.api_key, baseModel(provA, { primary_ai_system_id: aiSysB }));
    expect(r.statusCode).toBe(404);
    expect(bodyOf(r)['error']).toBe('ai_system_not_found');
  });
});

describe('regulatory-models / model version API', () => {
  it('creates a version under own model; created audit emitted', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId);
    expect(await auditCount(orgA.org_id, vId, 'regulatory_model_version.created')).toBe(1);
  });

  it('lists versions under own model only', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId);
    const list = await inject(stack, 'GET', `/v1/regulatory/models/${mId}/versions?limit=200`, orgA.api_key);
    expect(list.statusCode).toBe(200);
    const rows = bodyOf(list)['model_versions'] as Array<Record<string, unknown>>;
    expect(rows.map((v) => v['id'])).toContain(vId);
  });

  it('GET own version works; GET cross-tenant version returns 404', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId);
    expect((await inject(stack, 'GET', `/v1/regulatory/model-versions/${vId}`, orgA.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', `/v1/regulatory/model-versions/${vId}`, orgB.api_key)).statusCode).toBe(404);
  });

  it('PATCH version updates fields and emits updated audit', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId);
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/model-versions/${vId}`, orgA.api_key, { release_notes: 'notes' });
    expect(patch.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, vId, 'regulatory_model_version.updated')).toBe(1);
  });

  it('version_status transition emits status_changed audit', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId, { version_status: 'DRAFT' });
    await inject(stack, 'PATCH', `/v1/regulatory/model-versions/${vId}`, orgA.api_key, { version_status: 'UNDER_EVALUATION' });
    expect(await auditCount(orgA.org_id, vId, 'regulatory_model_version.status_changed')).toBe(1);
  });

  it('approval transition emits approved audit with approved_at/approved_by_user_id', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId, { version_status: 'UNDER_EVALUATION' });
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/model-versions/${vId}`, orgA.api_key, {
      version_status: 'APPROVED',
      approved_at: '2026-05-22T00:00:00.000Z',
      approved_by_user_id: orgA.user_id,
      approval_reference: 'CHANGE-123',
    });
    expect(patch.statusCode).toBe(200);
    const v = bodyOf(patch)['model_version'] as Record<string, unknown>;
    expect(v['approved_at']).toBe('2026-05-22T00:00:00.000Z');
    expect(v['approved_by_user_id']).toBe(orgA.user_id);
    expect(await auditCount(orgA.org_id, vId, 'regulatory_model_version.approved')).toBe(1);
  });

  it('retirement transition emits retired audit', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId, { version_status: 'ACTIVE' });
    await inject(stack, 'PATCH', `/v1/regulatory/model-versions/${vId}`, orgA.api_key, {
      version_status: 'RETIRED',
      retired_at: '2026-05-22T00:00:00.000Z',
    });
    expect(await auditCount(orgA.org_id, vId, 'regulatory_model_version.retired')).toBe(1);
  });

  it('duplicate version_key for same model rejected; same key under a different model allowed', async () => {
    const m1 = await mkModel(orgA, provA);
    const m2 = await mkModel(orgA, provA);
    const key = `VER-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await inject(stack, 'POST', `/v1/regulatory/models/${m1}/versions`, orgA.api_key, baseVersion({ version_key: key }))).statusCode).toBe(201);
    const dup = await inject(stack, 'POST', `/v1/regulatory/models/${m1}/versions`, orgA.api_key, baseVersion({ version_key: key }));
    expect(dup.statusCode).toBe(409);
    expect(bodyOf(dup)['error']).toBe('model_version_key_conflict');
    expect((await inject(stack, 'POST', `/v1/regulatory/models/${m2}/versions`, orgA.api_key, baseVersion({ version_key: key }))).statusCode).toBe(201);
  });

  it('PATCH version with empty body rejected (400)', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId);
    expect((await inject(stack, 'PATCH', `/v1/regulatory/model-versions/${vId}`, orgA.api_key, {})).statusCode).toBe(400);
  });
});

describe('regulatory-models / ai-system-model-link API', () => {
  it('creates a link among own AI system + own model + own version; created audit emitted', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId);
    const link = await mkLink(orgA, { ai_system_id: aiSysA, model_id: mId, model_version_id: vId });
    expect(link.status).toBe(201);
    const id = (link.body['ai_system_model_link'] as Record<string, unknown>)['id'] as string;
    expect(await auditCount(orgA.org_id, id, 'regulatory_ai_system_model_link.created')).toBe(1);
  });

  it('list returns own links only; GET own works; GET cross-tenant returns 404', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId);
    const link = await mkLink(orgA, { ai_system_id: aiSysA, model_id: mId, model_version_id: vId });
    const id = (link.body['ai_system_model_link'] as Record<string, unknown>)['id'] as string;
    const listA = await inject(stack, 'GET', '/v1/regulatory/ai-system-model-links?limit=200', orgA.api_key);
    expect((bodyOf(listA)['ai_system_model_links'] as Array<Record<string, unknown>>).map((l) => l['id'])).toContain(id);
    expect((await inject(stack, 'GET', `/v1/regulatory/ai-system-model-links/${id}`, orgA.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', `/v1/regulatory/ai-system-model-links/${id}`, orgB.api_key)).statusCode).toBe(404);
  });

  it('PATCH link status emits updated + status_changed', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId);
    const link = await mkLink(orgA, { ai_system_id: aiSysA, model_id: mId, model_version_id: vId, link_status: 'PROPOSED' });
    const id = (link.body['ai_system_model_link'] as Record<string, unknown>)['id'] as string;
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/ai-system-model-links/${id}`, orgA.api_key, { link_status: 'ACTIVE' });
    expect(patch.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, id, 'regulatory_ai_system_model_link.updated')).toBe(1);
    expect(await auditCount(orgA.org_id, id, 'regulatory_ai_system_model_link.status_changed')).toBe(1);
  });

  it('duplicate link tuple rejected (409)', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId);
    const first = await mkLink(orgA, { ai_system_id: aiSysA, model_id: mId, model_version_id: vId, usage_role: 'PRIMARY_MODEL', deployment_environment: 'PRODUCTION' });
    expect(first.status).toBe(201);
    const dup = await mkLink(orgA, { ai_system_id: aiSysA, model_id: mId, model_version_id: vId, usage_role: 'PRIMARY_MODEL', deployment_environment: 'PRODUCTION' });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('ai_system_model_link_conflict');
  });

  it('link with mismatched model_id/model_version_id rejected (400)', async () => {
    const m1 = await mkModel(orgA, provA);
    const v1 = await mkVersion(orgA, m1);
    const m2 = await mkModel(orgA, provA);
    const link = await mkLink(orgA, { ai_system_id: aiSysA, model_id: m2, model_version_id: v1 });
    expect(link.status).toBe(400);
    expect(link.body['error']).toBe('model_version_model_mismatch');
  });

  it('link with cross-tenant ai_system/model/version rejected without leakage', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId);
    expect((await mkLink(orgA, { ai_system_id: aiSysB, model_id: mId, model_version_id: vId })).status).toBe(404);
    expect((await mkLink(orgA, { ai_system_id: aiSysA, model_id: modelB, model_version_id: vId })).status).toBe(404);
    expect((await mkLink(orgA, { ai_system_id: aiSysA, model_id: mId, model_version_id: versionB })).status).toBe(404);
  });
});

describe('regulatory-models / pagination + filters', () => {
  it('model keyset pagination returns every model exactly once', async () => {
    const created: string[] = [];
    for (let i = 0; i < 5; i++) created.push(await mkModel(orgPage, provPage));
    const seen = new Set<string>();
    let cursor: { before_created_at: string; before_id: string } | null = null;
    let guard = 0;
    do {
      const qs = cursor
        ? `?limit=2&before_created_at=${encodeURIComponent(cursor.before_created_at)}&before_id=${cursor.before_id}`
        : '?limit=2';
      const page = await inject(stack, 'GET', `/v1/regulatory/models${qs}`, orgPage.api_key);
      const rows = bodyOf(page)['models'] as Array<Record<string, unknown>>;
      for (const row of rows) seen.add(row['id'] as string);
      cursor = bodyOf(page)['next_cursor'] as { before_created_at: string; before_id: string } | null;
      guard += 1;
    } while (cursor && guard < 20);
    for (const id of created) expect(seen.has(id)).toBe(true);
  });

  it('model filters work for model_status/model_type/provider_id', async () => {
    await mkModel(orgFilter, provFilter, { model_status: 'ACTIVE', model_type: 'EMBEDDING_MODEL' });
    await mkModel(orgFilter, provFilter, { model_status: 'RETIRED', model_type: 'CLASSIFIER' });
    const active = await inject(stack, 'GET', '/v1/regulatory/models?model_status=ACTIVE&limit=200', orgFilter.api_key);
    for (const row of bodyOf(active)['models'] as Array<Record<string, unknown>>) expect(row['model_status']).toBe('ACTIVE');
    const byProvider = await inject(stack, 'GET', `/v1/regulatory/models?provider_id=${provFilter}&limit=200`, orgFilter.api_key);
    for (const row of bodyOf(byProvider)['models'] as Array<Record<string, unknown>>) expect(row['provider_id']).toBe(provFilter);
  });

  it('version filters work for version_status/model_id', async () => {
    const mId = await mkModel(orgFilter, provFilter);
    await mkVersion(orgFilter, mId, { version_status: 'APPROVED' });
    await mkVersion(orgFilter, mId, { version_status: 'DRAFT' });
    const approved = await inject(stack, 'GET', `/v1/regulatory/models/${mId}/versions?version_status=APPROVED&limit=200`, orgFilter.api_key);
    const rows = bodyOf(approved)['model_versions'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row['version_status']).toBe('APPROVED');
  });

  it('link filters work for ai_system_id/link_status/usage_role', async () => {
    const mId = await mkModel(orgFilter, provFilter);
    const vId = await mkVersion(orgFilter, mId);
    const aiSysF = await mkAiSystem(orgFilter);
    await mkLink(orgFilter, { ai_system_id: aiSysF, model_id: mId, model_version_id: vId, link_status: 'ACTIVE', usage_role: 'PRIMARY_MODEL', deployment_environment: 'PRODUCTION' });
    const byStatus = await inject(stack, 'GET', `/v1/regulatory/ai-system-model-links?ai_system_id=${aiSysF}&link_status=ACTIVE&limit=200`, orgFilter.api_key);
    const rows = bodyOf(byStatus)['ai_system_model_links'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row['ai_system_id']).toBe(aiSysF);
      expect(row['link_status']).toBe('ACTIVE');
    }
  });
});

describe('regulatory-models / RLS (direct DB)', () => {
  it('tenant A cannot read tenant B models directly', async () => {
    const aId = await mkModel(orgA, provA);
    const visibleToB = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query('SELECT id FROM govai.regulatory_models WHERE id = $1::uuid', [aId]);
      return r.rowCount ?? 0;
    });
    expect(visibleToB).toBe(0);
  });

  it('tenant A cannot insert a model with org_id of tenant B', async () => {
    expect(await insertBlocked(orgA.org_id, insModel, [orgB.org_id, `MDL-${randomUUID().slice(0, 8)}`, provA, null])).toBe(true);
  });

  it('tenant A cannot insert a model referencing tenant B provider', async () => {
    expect(await insertBlocked(orgA.org_id, insModel, [orgA.org_id, `MDL-${randomUUID().slice(0, 8)}`, provB, null])).toBe(true);
  });

  it('tenant A cannot insert a model referencing tenant B AI system', async () => {
    expect(await insertBlocked(orgA.org_id, insModel, [orgA.org_id, `MDL-${randomUUID().slice(0, 8)}`, provA, aiSysB])).toBe(true);
  });

  it('tenant A can insert a model referencing own provider and own AI system', async () => {
    const inserted = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(`${insModel} RETURNING id`, [orgA.org_id, `MDL-${randomUUID().slice(0, 8)}`, provA, aiSysA]);
      return r.rowCount ?? 0;
    });
    expect(inserted).toBe(1);
  });

  it('tenant A cannot update own model to tenant B provider or AI system', async () => {
    const mId = await mkModel(orgA, provA, { primary_ai_system_id: aiSysA });
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_models SET provider_id = $2::uuid WHERE id = $1::uuid', [mId, provB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_models SET primary_ai_system_id = $2::uuid WHERE id = $1::uuid', [mId, aiSysB])).toBe(true);
  });

  it('tenant A cannot insert a version under tenant B model, nor update own version to tenant B model', async () => {
    const insVer = `INSERT INTO govai.regulatory_model_versions (org_id, model_id, version_key, version_label, version_status)
                    VALUES ($1::uuid, $2::uuid, $3, 'v', 'DRAFT')`;
    expect(await insertBlocked(orgA.org_id, insVer, [orgA.org_id, modelB, `VER-${randomUUID().slice(0, 8)}`])).toBe(true);

    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_model_versions SET model_id = $2::uuid WHERE id = $1::uuid', [vId, modelB])).toBe(true);
  });

  it('tenant A cannot insert a link referencing tenant B ai_system/model/version', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId);
    const insLink = `INSERT INTO govai.regulatory_ai_system_model_links
        (org_id, ai_system_id, model_id, model_version_id, link_status, usage_role, deployment_environment)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'PROPOSED', 'PRIMARY_MODEL', 'PRODUCTION')`;
    expect(await insertBlocked(orgA.org_id, insLink, [orgA.org_id, aiSysB, mId, vId])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insLink, [orgA.org_id, aiSysA, modelB, vId])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insLink, [orgA.org_id, aiSysA, mId, versionB])).toBe(true);
  });

  it('tenant A cannot insert a link with own model but a version from a different model', async () => {
    const m1 = await mkModel(orgA, provA);
    const v1 = await mkVersion(orgA, m1);
    const m2 = await mkModel(orgA, provA);
    const insLink = `INSERT INTO govai.regulatory_ai_system_model_links
        (org_id, ai_system_id, model_id, model_version_id, link_status, usage_role, deployment_environment)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'PROPOSED', 'PRIMARY_MODEL', 'PRODUCTION')`;
    // model_id = m2 but version v1 belongs to m1 → WITH CHECK (v.model_id = model_id) fails.
    expect(await insertBlocked(orgA.org_id, insLink, [orgA.org_id, aiSysA, m2, v1])).toBe(true);
  });

  it('tenant A can insert a valid own link directly', async () => {
    const mId = await mkModel(orgA, provA);
    const vId = await mkVersion(orgA, mId);
    const inserted = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(
        `INSERT INTO govai.regulatory_ai_system_model_links
           (org_id, ai_system_id, model_id, model_version_id, link_status, usage_role, deployment_environment)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'PROPOSED', 'FALLBACK_MODEL', 'STAGING') RETURNING id`,
        [orgA.org_id, aiSysA, mId, vId],
      );
      return r.rowCount ?? 0;
    });
    expect(inserted).toBe(1);
  });

  it('tenant A cannot update own link to a mismatched model/version pairing', async () => {
    const m1 = await mkModel(orgA, provA);
    const v1 = await mkVersion(orgA, m1);
    const m2 = await mkModel(orgA, provA);
    const v2 = await mkVersion(orgA, m2);
    const link = await mkLink(orgA, { ai_system_id: aiSysA, model_id: m1, model_version_id: v1, usage_role: 'SAFETY_MODEL', deployment_environment: 'PRODUCTION' });
    const id = (link.body['ai_system_model_link'] as Record<string, unknown>)['id'] as string;
    // Try to point this link's model_version_id at v2 (belongs to m2, not m1) via direct UPDATE.
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_ai_system_model_links SET model_version_id = $2::uuid WHERE id = $1::uuid', [id, v2])).toBe(true);
  });
});
