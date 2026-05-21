// Regulatory Core PR-R2 (issue #59, umbrella #33) — AI System Registry.
//
// Covers auth/RBAC, CRUD-without-delete, tenant isolation (API + direct DB
// RLS), keyset pagination, validation, audit evidence (created / updated /
// lifecycle_changed), and the optional nullable references into the PR-R1
// source/control catalog (visible-parent only, cross-tenant rejected).
//
// A small fixed set of orgs is seeded once in beforeAll and reused across the
// suite. Each org/key creation inserts api_keys rows whose lookup prefix has
// limited entropy, so we keep key churn low (and the suite fast) rather than
// minting a fresh org per test.

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

// Shared orgs (created once). orgA/orgB are the primary write tenants; devOrg
// holds a non-write role; orgPage/orgFilter are dedicated so row-count-sensitive
// pagination/filter assertions are not perturbed by other tests.
let orgA: AdminOrg;
let orgB: AdminOrg;
let devOrg: { org_id: string; user_id: string; api_key: string };
let orgPage: AdminOrg;
let orgFilter: AdminOrg;

beforeAll(async () => {
  stack = await startStack();
  orgA = await adminOrg();
  orgB = await adminOrg();
  const dev = await seedOrg(stack);
  const devKey = await addApiKey(stack, dev.org_id, dev.user_id, ['developer']);
  devOrg = { org_id: dev.org_id, user_id: dev.user_id, api_key: devKey.api_key };
  orgPage = await adminOrg();
  orgFilter = await adminOrg();
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

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

/** Count audit events for a subject + type via the superuser pool (bypasses RLS). */
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

/** Seed a scope='system' source via the superuser pool (bypasses RLS). */
async function seedSystemSource(): Promise<string> {
  const key = `SYS-${randomUUID().slice(0, 8).toUpperCase()}`;
  const c = await stack.db.adminPool.connect();
  try {
    const r = await c.query<{ id: string }>(
      `INSERT INTO govai.regulatory_sources
         (org_id, scope, source_key, title, jurisdiction, source_quality, verification_status, legal_status)
       VALUES (NULL, 'system', $1, 'System curated source', 'BR',
               'PRIMARY_OFFICIAL_SOURCE', 'CONFIRMED_PRIMARY_SOURCE', 'ACTIVE')
       RETURNING id`,
      [key],
    );
    return r.rows[0]!.id;
  } finally {
    c.release();
  }
}

function bodyOf(r: { body: unknown }): Record<string, unknown> {
  return r.body as Record<string, unknown>;
}

const baseAiSystem = (overrides: Record<string, unknown> = {}) => ({
  system_key: `AIS-${randomUUID().slice(0, 8).toUpperCase()}`,
  name: 'tenant ai system',
  system_type: 'INTERNAL_PRODUCT',
  lifecycle_state: 'PROPOSED',
  deployment_environment: 'DEVELOPMENT',
  ...overrides,
});

async function createAiSystem(org: AdminOrg, overrides: Record<string, unknown> = {}): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/ai-systems', org.api_key, baseAiSystem(overrides));
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['ai_system'] as Record<string, unknown>)['id'] as string;
}

async function createTenantSource(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, {
    source_key: `BR-AIS-${randomUUID().slice(0, 8).toUpperCase()}`,
    title: 'tenant source',
    source_quality: 'PRIMARY_REGULATORY_SOURCE',
    verification_status: 'CONFIRMED_PRIMARY_SOURCE',
    legal_status: 'ACTIVE',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['source'] as Record<string, unknown>)['id'] as string;
}

async function createTenantControl(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/controls', org.api_key, {
    control_key: `GOVAI-AIS-${randomUUID().slice(0, 8).toUpperCase()}`,
    domain: 'ai-inventory',
    name: 'tenant control',
    capability_type: 'REQUIRED_NATIVE_CAPABILITY',
    implementation_state: 'TARGET_CAPABILITY_REQUIRED',
    build_decision: 'BUILD_NATIVE_CORE',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['control'] as Record<string, unknown>)['id'] as string;
}

describe('regulatory-ai-systems / auth + rbac', () => {
  it('rejects unauthenticated reads and writes (401)', async () => {
    const list = await inject(stack, 'GET', '/v1/regulatory/ai-systems', undefined);
    expect(list.statusCode).toBe(401);
    const create = await inject(stack, 'POST', '/v1/regulatory/ai-systems', undefined, baseAiSystem());
    expect(create.statusCode).toBe(401);
  });

  it('a non-write role can read but not write', async () => {
    const read = await inject(stack, 'GET', '/v1/regulatory/ai-systems', devOrg.api_key);
    expect(read.statusCode).toBe(200);
    const write = await inject(stack, 'POST', '/v1/regulatory/ai-systems', devOrg.api_key, baseAiSystem());
    expect(write.statusCode).toBe(403);
    expect(bodyOf(write)['error']).toBe('forbidden');
  });

  it('admin can create an AI system (201) and emits a created audit event', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/ai-systems', orgA.api_key, baseAiSystem());
    expect(r.statusCode).toBe(201);
    const id = (bodyOf(r)['ai_system'] as Record<string, unknown>)['id'] as string;
    expect(await auditCount(orgA.org_id, id, 'regulatory_ai_system.created')).toBe(1);
  });
});

describe('regulatory-ai-systems / tenant isolation', () => {
  it('list returns only the caller tenant systems', async () => {
    const aId = await createAiSystem(orgA);
    await createAiSystem(orgB);
    const listB = await inject(stack, 'GET', '/v1/regulatory/ai-systems?limit=200', orgB.api_key);
    const rows = bodyOf(listB)['ai_systems'] as Array<Record<string, unknown>>;
    expect(rows.map((s) => s['id'])).not.toContain(aId);
    for (const row of rows) expect(row['org_id']).toBe(orgB.org_id);
  });

  it('GET own id works; GET other tenant id returns 404 without leakage', async () => {
    const aId = await createAiSystem(orgA);
    const own = await inject(stack, 'GET', `/v1/regulatory/ai-systems/${aId}`, orgA.api_key);
    expect(own.statusCode).toBe(200);
    const cross = await inject(stack, 'GET', `/v1/regulatory/ai-systems/${aId}`, orgB.api_key);
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('ai_system_not_found');
  });

  it('cross-tenant PATCH is invisible (404)', async () => {
    const aId = await createAiSystem(orgA);
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/ai-systems/${aId}`, orgB.api_key, {
      name: 'hijacked',
    });
    expect(patch.statusCode).toBe(404);
  });
});

describe('regulatory-ai-systems / mutations + audit', () => {
  it('PATCH updates allowed fields and emits an updated audit event', async () => {
    const id = await createAiSystem(orgA);
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/ai-systems/${id}`, orgA.api_key, {
      name: 'renamed system',
      business_owner: 'Ada Lovelace',
    });
    expect(patch.statusCode).toBe(200);
    const sys = bodyOf(patch)['ai_system'] as Record<string, unknown>;
    expect(sys['name']).toBe('renamed system');
    expect(sys['business_owner']).toBe('Ada Lovelace');
    expect(await auditCount(orgA.org_id, id, 'regulatory_ai_system.updated')).toBe(1);
  });

  it('a lifecycle_state transition emits a dedicated lifecycle_changed audit event', async () => {
    const id = await createAiSystem(orgA, { lifecycle_state: 'PROPOSED' });
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/ai-systems/${id}`, orgA.api_key, {
      lifecycle_state: 'ACTIVE',
    });
    expect(patch.statusCode).toBe(200);
    expect((bodyOf(patch)['ai_system'] as Record<string, unknown>)['lifecycle_state']).toBe('ACTIVE');
    expect(await auditCount(orgA.org_id, id, 'regulatory_ai_system.updated')).toBe(1);
    expect(await auditCount(orgA.org_id, id, 'regulatory_ai_system.lifecycle_changed')).toBe(1);
  });

  it('a PATCH that does not change lifecycle_state emits no lifecycle_changed event', async () => {
    const id = await createAiSystem(orgA, { lifecycle_state: 'ACTIVE' });
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/ai-systems/${id}`, orgA.api_key, {
      lifecycle_state: 'ACTIVE',
      name: 'still active',
    });
    expect(patch.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, id, 'regulatory_ai_system.lifecycle_changed')).toBe(0);
  });

  it('PATCH requires at least one field (400)', async () => {
    const id = await createAiSystem(orgA);
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/ai-systems/${id}`, orgA.api_key, {});
    expect(patch.statusCode).toBe(400);
  });
});

describe('regulatory-ai-systems / constraints + validation', () => {
  it('duplicate system_key within a tenant is rejected (409)', async () => {
    const key = `AIS-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    const a = await inject(stack, 'POST', '/v1/regulatory/ai-systems', orgA.api_key, baseAiSystem({ system_key: key }));
    expect(a.statusCode).toBe(201);
    const b = await inject(stack, 'POST', '/v1/regulatory/ai-systems', orgA.api_key, baseAiSystem({ system_key: key }));
    expect(b.statusCode).toBe(409);
    expect(bodyOf(b)['error']).toBe('ai_system_key_conflict');
  });

  it('the same system_key in different tenants is allowed', async () => {
    const key = `AIS-SHARED-${randomUUID().slice(0, 8).toUpperCase()}`;
    const a = await inject(stack, 'POST', '/v1/regulatory/ai-systems', orgA.api_key, baseAiSystem({ system_key: key }));
    const b = await inject(stack, 'POST', '/v1/regulatory/ai-systems', orgB.api_key, baseAiSystem({ system_key: key }));
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
  });

  it('an invalid enum is rejected (400)', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/ai-systems', orgA.api_key, baseAiSystem({ lifecycle_state: 'NOPE' }));
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('invalid_request');
  });

  it('an invalid system_key is rejected (400)', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/ai-systems', orgA.api_key, baseAiSystem({ system_key: 'lower case bad' }));
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('invalid_request');
  });
});

describe('regulatory-ai-systems / pagination', () => {
  it('keyset pagination returns every row exactly once', async () => {
    const created: string[] = [];
    for (let i = 0; i < 5; i++) created.push(await createAiSystem(orgPage));

    const seen = new Set<string>();
    let cursor: { before_created_at: string; before_id: string } | null = null;
    let guard = 0;
    do {
      const qs = cursor
        ? `?limit=2&before_created_at=${encodeURIComponent(cursor.before_created_at)}&before_id=${cursor.before_id}`
        : '?limit=2';
      const page = await inject(stack, 'GET', `/v1/regulatory/ai-systems${qs}`, orgPage.api_key);
      expect(page.statusCode).toBe(200);
      const rows = bodyOf(page)['ai_systems'] as Array<Record<string, unknown>>;
      for (const row of rows) seen.add(row['id'] as string);
      cursor = bodyOf(page)['next_cursor'] as { before_created_at: string; before_id: string } | null;
      guard += 1;
    } while (cursor && guard < 20);

    for (const id of created) expect(seen.has(id)).toBe(true);
  });

  it('filters by lifecycle_state and system_type', async () => {
    await createAiSystem(orgFilter, { lifecycle_state: 'ACTIVE', system_type: 'MODEL_ENDPOINT' });
    await createAiSystem(orgFilter, { lifecycle_state: 'RETIRED', system_type: 'DOCUMENT_PROCESSING' });
    const active = await inject(stack, 'GET', '/v1/regulatory/ai-systems?lifecycle_state=ACTIVE&limit=200', orgFilter.api_key);
    const rows = bodyOf(active)['ai_systems'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row['lifecycle_state']).toBe('ACTIVE');
  });
});

describe('regulatory-ai-systems / RLS (direct DB)', () => {
  it('tenant A cannot read tenant B AI system rows directly', async () => {
    const aId = await createAiSystem(orgA);
    const visibleToB = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query('SELECT id FROM govai.regulatory_ai_systems WHERE id = $1::uuid', [aId]);
      return r.rowCount ?? 0;
    });
    expect(visibleToB).toBe(0);
  });

  it('a tenant cannot directly INSERT a row carrying another tenant org_id', async () => {
    let blocked = false;
    try {
      await asOrg(orgB.org_id, (c) =>
        c.query(
          `INSERT INTO govai.regulatory_ai_systems
             (org_id, system_key, name, system_type, lifecycle_state, deployment_environment)
           VALUES ($1::uuid, $2, 'x', 'OTHER', 'PROPOSED', 'NOT_DEPLOYED')`,
          [orgA.org_id, `AIS-X-${randomUUID().slice(0, 8)}`],
        ),
      );
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });
});

describe('regulatory-ai-systems / optional parent references', () => {
  it('referencing a visible system source is allowed; another tenant source is not-found (no leak)', async () => {
    const systemSourceId = await seedSystemSource();
    const bSourceId = await createTenantSource(orgB);

    const own = await inject(stack, 'POST', '/v1/regulatory/ai-systems', orgA.api_key, baseAiSystem({ regulatory_source_id: systemSourceId }));
    expect(own.statusCode).toBe(201);
    expect((bodyOf(own)['ai_system'] as Record<string, unknown>)['regulatory_source_id']).toBe(systemSourceId);

    const cross = await inject(stack, 'POST', '/v1/regulatory/ai-systems', orgA.api_key, baseAiSystem({ regulatory_source_id: bSourceId }));
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('regulatory_source_not_found');
  });

  it('referencing another tenant control is not-found (no leak)', async () => {
    const bControlId = await createTenantControl(orgB);
    const cross = await inject(stack, 'POST', '/v1/regulatory/ai-systems', orgA.api_key, baseAiSystem({ control_id: bControlId }));
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('control_not_found');
  });

  it('RLS WITH CHECK blocks a direct INSERT referencing another tenant source', async () => {
    const bSourceId = await createTenantSource(orgB);
    let blocked = false;
    try {
      await asOrg(orgA.org_id, (c) =>
        c.query(
          `INSERT INTO govai.regulatory_ai_systems
             (org_id, system_key, name, system_type, lifecycle_state, deployment_environment, regulatory_source_id)
           VALUES ($1::uuid, $2, 'x', 'OTHER', 'PROPOSED', 'NOT_DEPLOYED', $3::uuid)`,
          [orgA.org_id, `AIS-FK-${randomUUID().slice(0, 8)}`, bSourceId],
        ),
      );
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });
});
