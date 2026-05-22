// Regulatory Core PR-R3 (issue #59, umbrella #33) — Provider Registry.
//
// Covers auth/RBAC, CRUD-without-delete, tenant isolation (API + direct DB
// RLS), keyset pagination, validation, audit evidence (created / updated /
// status_changed / review_status_changed), and the optional nullable
// references into the PR-R1 source/control catalog (visible-parent only,
// cross-tenant rejected for both INSERT and UPDATE).
//
// Posture/inventory only: no credentials are stored or tested. A small fixed
// set of orgs is seeded once in beforeAll and reused, to keep api_keys lookup
// prefix churn low (mirrors the PR-R2 AI-system suite).

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

const baseProvider = (overrides: Record<string, unknown> = {}) => ({
  provider_key: `PRV-${randomUUID().slice(0, 8).toUpperCase()}`,
  name: 'tenant provider',
  provider_type: 'MODEL_PROVIDER',
  provider_status: 'PROPOSED',
  deployment_model: 'API',
  data_processing_role: 'PROCESSOR',
  dpa_status: 'NOT_STARTED',
  security_review_status: 'NOT_STARTED',
  subprocessors_review_status: 'NOT_STARTED',
  ai_terms_review_status: 'NOT_STARTED',
  ...overrides,
});

async function createProvider(org: AdminOrg, overrides: Record<string, unknown> = {}): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/providers', org.api_key, baseProvider(overrides));
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['provider'] as Record<string, unknown>)['id'] as string;
}

async function createTenantSource(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, {
    source_key: `BR-PRV-${randomUUID().slice(0, 8).toUpperCase()}`,
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
    control_key: `GOVAI-PRV-${randomUUID().slice(0, 8).toUpperCase()}`,
    domain: 'vendor',
    name: 'tenant control',
    capability_type: 'REQUIRED_NATIVE_CAPABILITY',
    implementation_state: 'TARGET_CAPABILITY_REQUIRED',
    build_decision: 'BUILD_NATIVE_CORE',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['control'] as Record<string, unknown>)['id'] as string;
}

describe('regulatory-providers / auth + rbac', () => {
  it('rejects unauthenticated reads and writes (401)', async () => {
    const list = await inject(stack, 'GET', '/v1/regulatory/providers', undefined);
    expect(list.statusCode).toBe(401);
    const create = await inject(stack, 'POST', '/v1/regulatory/providers', undefined, baseProvider());
    expect(create.statusCode).toBe(401);
  });

  it('a non-write role can read but not write', async () => {
    const read = await inject(stack, 'GET', '/v1/regulatory/providers', devOrg.api_key);
    expect(read.statusCode).toBe(200);
    const write = await inject(stack, 'POST', '/v1/regulatory/providers', devOrg.api_key, baseProvider());
    expect(write.statusCode).toBe(403);
    expect(bodyOf(write)['error']).toBe('forbidden');
  });

  it('admin can create a provider (201) and emits a created audit event', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/providers', orgA.api_key, baseProvider());
    expect(r.statusCode).toBe(201);
    const id = (bodyOf(r)['provider'] as Record<string, unknown>)['id'] as string;
    expect(await auditCount(orgA.org_id, id, 'regulatory_provider.created')).toBe(1);
  });
});

describe('regulatory-providers / tenant isolation', () => {
  it('list returns only the caller tenant providers', async () => {
    const aId = await createProvider(orgA);
    await createProvider(orgB);
    const listB = await inject(stack, 'GET', '/v1/regulatory/providers?limit=200', orgB.api_key);
    const rows = bodyOf(listB)['providers'] as Array<Record<string, unknown>>;
    expect(rows.map((s) => s['id'])).not.toContain(aId);
    for (const row of rows) expect(row['org_id']).toBe(orgB.org_id);
  });

  it('GET own id works; GET other tenant id returns 404 without leakage', async () => {
    const aId = await createProvider(orgA);
    const own = await inject(stack, 'GET', `/v1/regulatory/providers/${aId}`, orgA.api_key);
    expect(own.statusCode).toBe(200);
    const cross = await inject(stack, 'GET', `/v1/regulatory/providers/${aId}`, orgB.api_key);
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('provider_not_found');
  });
});

describe('regulatory-providers / mutations + audit', () => {
  it('PATCH updates allowed fields and emits an updated audit event', async () => {
    const id = await createProvider(orgA);
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/providers/${id}`, orgA.api_key, {
      name: 'renamed provider',
      contact_email: 'dpo@example.com',
    });
    expect(patch.statusCode).toBe(200);
    const p = bodyOf(patch)['provider'] as Record<string, unknown>;
    expect(p['name']).toBe('renamed provider');
    expect(p['contact_email']).toBe('dpo@example.com');
    expect(await auditCount(orgA.org_id, id, 'regulatory_provider.updated')).toBe(1);
  });

  it('a provider_status transition emits a dedicated status_changed audit event', async () => {
    const id = await createProvider(orgA, { provider_status: 'PROPOSED' });
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/providers/${id}`, orgA.api_key, {
      provider_status: 'APPROVED',
    });
    expect(patch.statusCode).toBe(200);
    expect((bodyOf(patch)['provider'] as Record<string, unknown>)['provider_status']).toBe('APPROVED');
    expect(await auditCount(orgA.org_id, id, 'regulatory_provider.updated')).toBe(1);
    expect(await auditCount(orgA.org_id, id, 'regulatory_provider.status_changed')).toBe(1);
  });

  it('a review-status transition emits a dedicated review_status_changed audit event', async () => {
    const id = await createProvider(orgA, { dpa_status: 'NOT_STARTED' });
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/providers/${id}`, orgA.api_key, {
      dpa_status: 'APPROVED',
      security_review_status: 'UNDER_REVIEW',
    });
    expect(patch.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, id, 'regulatory_provider.review_status_changed')).toBe(1);
  });

  it('a PATCH that changes neither status nor review fields emits only updated', async () => {
    const id = await createProvider(orgA, { provider_status: 'APPROVED', dpa_status: 'APPROVED' });
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/providers/${id}`, orgA.api_key, {
      name: 'just a rename',
    });
    expect(patch.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, id, 'regulatory_provider.status_changed')).toBe(0);
    expect(await auditCount(orgA.org_id, id, 'regulatory_provider.review_status_changed')).toBe(0);
  });

  it('PATCH requires at least one field (400)', async () => {
    const id = await createProvider(orgA);
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/providers/${id}`, orgA.api_key, {});
    expect(patch.statusCode).toBe(400);
  });
});

describe('regulatory-providers / constraints + validation', () => {
  it('duplicate provider_key within a tenant is rejected (409)', async () => {
    const key = `PRV-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    const a = await inject(stack, 'POST', '/v1/regulatory/providers', orgA.api_key, baseProvider({ provider_key: key }));
    expect(a.statusCode).toBe(201);
    const b = await inject(stack, 'POST', '/v1/regulatory/providers', orgA.api_key, baseProvider({ provider_key: key }));
    expect(b.statusCode).toBe(409);
    expect(bodyOf(b)['error']).toBe('provider_key_conflict');
  });

  it('the same provider_key in different tenants is allowed', async () => {
    const key = `PRV-SHARED-${randomUUID().slice(0, 8).toUpperCase()}`;
    const a = await inject(stack, 'POST', '/v1/regulatory/providers', orgA.api_key, baseProvider({ provider_key: key }));
    const b = await inject(stack, 'POST', '/v1/regulatory/providers', orgB.api_key, baseProvider({ provider_key: key }));
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
  });

  it('an invalid enum is rejected (400)', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/providers', orgA.api_key, baseProvider({ provider_status: 'NOPE' }));
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('invalid_request');
  });

  it('an invalid provider_key is rejected (400)', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/providers', orgA.api_key, baseProvider({ provider_key: 'lower case bad' }));
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('invalid_request');
  });

  it('an invalid email is rejected (400)', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/providers', orgA.api_key, baseProvider({ contact_email: 'not-an-email' }));
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('invalid_request');
  });

  it('an invalid website_url is rejected (400)', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/providers', orgA.api_key, baseProvider({ website_url: 'not a url' }));
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('invalid_request');
  });
});

describe('regulatory-providers / pagination + filters', () => {
  it('keyset pagination returns every row exactly once', async () => {
    const created: string[] = [];
    for (let i = 0; i < 5; i++) created.push(await createProvider(orgPage));

    const seen = new Set<string>();
    let cursor: { before_created_at: string; before_id: string } | null = null;
    let guard = 0;
    do {
      const qs = cursor
        ? `?limit=2&before_created_at=${encodeURIComponent(cursor.before_created_at)}&before_id=${cursor.before_id}`
        : '?limit=2';
      const page = await inject(stack, 'GET', `/v1/regulatory/providers${qs}`, orgPage.api_key);
      expect(page.statusCode).toBe(200);
      const rows = bodyOf(page)['providers'] as Array<Record<string, unknown>>;
      for (const row of rows) seen.add(row['id'] as string);
      cursor = bodyOf(page)['next_cursor'] as { before_created_at: string; before_id: string } | null;
      guard += 1;
    } while (cursor && guard < 20);

    for (const id of created) expect(seen.has(id)).toBe(true);
  });

  it('filters by provider_status and provider_type', async () => {
    await createProvider(orgFilter, { provider_status: 'APPROVED', provider_type: 'CLOUD_PROVIDER' });
    await createProvider(orgFilter, { provider_status: 'REJECTED', provider_type: 'VECTOR_DATABASE' });
    const approved = await inject(stack, 'GET', '/v1/regulatory/providers?provider_status=APPROVED&limit=200', orgFilter.api_key);
    const rows = bodyOf(approved)['providers'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row['provider_status']).toBe('APPROVED');

    const byType = await inject(stack, 'GET', '/v1/regulatory/providers?provider_type=CLOUD_PROVIDER&limit=200', orgFilter.api_key);
    const typeRows = bodyOf(byType)['providers'] as Array<Record<string, unknown>>;
    for (const row of typeRows) expect(row['provider_type']).toBe('CLOUD_PROVIDER');
  });
});

describe('regulatory-providers / RLS (direct DB)', () => {
  it('tenant A cannot read tenant B provider rows directly', async () => {
    const aId = await createProvider(orgA);
    const visibleToB = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query('SELECT id FROM govai.regulatory_providers WHERE id = $1::uuid', [aId]);
      return r.rowCount ?? 0;
    });
    expect(visibleToB).toBe(0);
  });

  it('a tenant cannot directly INSERT a row carrying another tenant org_id', async () => {
    let blocked = false;
    try {
      await asOrg(orgB.org_id, (c) =>
        c.query(
          `INSERT INTO govai.regulatory_providers
             (org_id, provider_key, name, provider_type, provider_status, deployment_model,
              data_processing_role, dpa_status, security_review_status, subprocessors_review_status,
              ai_terms_review_status)
           VALUES ($1::uuid, $2, 'x', 'OTHER', 'PROPOSED', 'API', 'PROCESSOR',
                   'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED')`,
          [orgA.org_id, `PRV-X-${randomUUID().slice(0, 8)}`],
        ),
      );
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });
});

describe('regulatory-providers / optional parent references', () => {
  const INSERT_WITH_SOURCE = `INSERT INTO govai.regulatory_providers
       (org_id, provider_key, name, provider_type, provider_status, deployment_model,
        data_processing_role, dpa_status, security_review_status, subprocessors_review_status,
        ai_terms_review_status, regulatory_source_id)
     VALUES ($1::uuid, $2, 'x', 'OTHER', 'PROPOSED', 'API', 'PROCESSOR',
             'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', $3::uuid)`;
  const INSERT_WITH_CONTROL = `INSERT INTO govai.regulatory_providers
       (org_id, provider_key, name, provider_type, provider_status, deployment_model,
        data_processing_role, dpa_status, security_review_status, subprocessors_review_status,
        ai_terms_review_status, control_id)
     VALUES ($1::uuid, $2, 'x', 'OTHER', 'PROPOSED', 'API', 'PROCESSOR',
             'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', $3::uuid)`;

  it('API: referencing a visible system source is allowed; another tenant source is not-found', async () => {
    const systemSourceId = await seedSystemSource();
    const bSourceId = await createTenantSource(orgB);

    const own = await inject(stack, 'POST', '/v1/regulatory/providers', orgA.api_key, baseProvider({ regulatory_source_id: systemSourceId }));
    expect(own.statusCode).toBe(201);
    expect((bodyOf(own)['provider'] as Record<string, unknown>)['regulatory_source_id']).toBe(systemSourceId);

    const cross = await inject(stack, 'POST', '/v1/regulatory/providers', orgA.api_key, baseProvider({ regulatory_source_id: bSourceId }));
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('regulatory_source_not_found');
  });

  it('API: referencing another tenant control is not-found (no leak)', async () => {
    const bControlId = await createTenantControl(orgB);
    const cross = await inject(stack, 'POST', '/v1/regulatory/providers', orgA.api_key, baseProvider({ control_id: bControlId }));
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('control_not_found');
  });

  it('RLS WITH CHECK blocks a direct INSERT referencing another tenant source', async () => {
    const bSourceId = await createTenantSource(orgB);
    let blocked = false;
    try {
      await asOrg(orgA.org_id, (c) =>
        c.query(INSERT_WITH_SOURCE, [orgA.org_id, `PRV-FKS-${randomUUID().slice(0, 8)}`, bSourceId]),
      );
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it('RLS WITH CHECK blocks a direct INSERT referencing another tenant control', async () => {
    const bControlId = await createTenantControl(orgB);
    let blocked = false;
    try {
      await asOrg(orgA.org_id, (c) =>
        c.query(INSERT_WITH_CONTROL, [orgA.org_id, `PRV-FKC-${randomUUID().slice(0, 8)}`, bControlId]),
      );
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it('a direct INSERT referencing own-tenant source and control is allowed', async () => {
    const ownSourceId = await createTenantSource(orgA);
    const ownControlId = await createTenantControl(orgA);
    const inserted = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(
        `INSERT INTO govai.regulatory_providers
           (org_id, provider_key, name, provider_type, provider_status, deployment_model,
            data_processing_role, dpa_status, security_review_status, subprocessors_review_status,
            ai_terms_review_status, regulatory_source_id, control_id)
         VALUES ($1::uuid, $2, 'x', 'OTHER', 'PROPOSED', 'API', 'PROCESSOR',
                 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', $3::uuid, $4::uuid)
         RETURNING id`,
        [orgA.org_id, `PRV-OWN-${randomUUID().slice(0, 8)}`, ownSourceId, ownControlId],
      );
      return r.rowCount ?? 0;
    });
    expect(inserted).toBe(1);
  });

  it('RLS WITH CHECK blocks a direct UPDATE setting regulatory_source_id to another tenant source', async () => {
    const aId = await createProvider(orgA);
    const bSourceId = await createTenantSource(orgB);
    let blocked = false;
    try {
      await asOrg(orgA.org_id, (c) =>
        c.query('UPDATE govai.regulatory_providers SET regulatory_source_id = $2::uuid WHERE id = $1::uuid', [aId, bSourceId]),
      );
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it('RLS WITH CHECK blocks a direct UPDATE setting control_id to another tenant control', async () => {
    const aId = await createProvider(orgA);
    const bControlId = await createTenantControl(orgB);
    let blocked = false;
    try {
      await asOrg(orgA.org_id, (c) =>
        c.query('UPDATE govai.regulatory_providers SET control_id = $2::uuid WHERE id = $1::uuid', [aId, bControlId]),
      );
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });
});
