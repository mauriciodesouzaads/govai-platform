// Regulatory Core PR-R1 (issue #59, umbrella #33) — RLS / tenant isolation and
// the system-vs-tenant scope model.
//
// Tenants read system rows (org_id IS NULL) plus their own; they never see or
// mutate another tenant's rows, and they never mutate system rows through the
// API. System rows are seeded out-of-band (here via the superuser admin pool,
// which bypasses RLS — mirroring a future migration/system seed path).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
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

type AdminOrg = { org_id: string; user_id: string; api_key: string };

async function adminOrg(): Promise<AdminOrg> {
  const org = await seedOrg(stack);
  const admin = await addApiKey(stack, org.org_id, org.user_id, ['admin']);
  return { org_id: org.org_id, user_id: org.user_id, api_key: admin.api_key };
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

const baseSource = (overrides: Record<string, unknown> = {}) => ({
  source_key: `BR-RLS-${randomUUID().slice(0, 8).toUpperCase()}`,
  title: 'tenant source',
  source_quality: 'PRIMARY_REGULATORY_SOURCE',
  verification_status: 'CONFIRMED_PRIMARY_SOURCE',
  legal_status: 'ACTIVE',
  ...overrides,
});

const baseControl = (overrides: Record<string, unknown> = {}) => ({
  control_key: `GOVAI-RLS-${randomUUID().slice(0, 8).toUpperCase()}`,
  domain: 'evidence',
  name: 'tenant control',
  capability_type: 'REQUIRED_NATIVE_CAPABILITY',
  implementation_state: 'TARGET_CAPABILITY_REQUIRED',
  build_decision: 'BUILD_NATIVE_CORE',
  ...overrides,
});

function bodyOf(r: { body: unknown }): Record<string, unknown> {
  return r.body as Record<string, unknown>;
}

async function createTenantSource(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, baseSource());
  return (bodyOf(r)['source'] as Record<string, unknown>)['id'] as string;
}

async function createTenantControl(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/controls', org.api_key, baseControl());
  return (bodyOf(r)['control'] as Record<string, unknown>)['id'] as string;
}

/** Run a direct INSERT as govai_app for `orgId`; resolve blocked=true if RLS rejects it. */
async function insertBlocked(orgId: string, sql: string, params: unknown[]): Promise<boolean> {
  try {
    await asOrg(orgId, (c) => c.query(sql, params));
    return false;
  } catch {
    return true;
  }
}

describe('regulatory-rls / system vs tenant scope', () => {
  it('a tenant can read a system source by id and in the list', async () => {
    const org = await adminOrg();
    const systemId = await seedSystemSource();
    const get = await inject(stack, 'GET', `/v1/regulatory/sources/${systemId}`, org.api_key);
    expect(get.statusCode).toBe(200);
    expect((bodyOf(get)['source'] as Record<string, unknown>)['scope']).toBe('system');

    const list = await inject(stack, 'GET', '/v1/regulatory/sources?scope=system&limit=200', org.api_key);
    const ids = (bodyOf(list)['sources'] as Array<Record<string, unknown>>).map((s) => s['id']);
    expect(ids).toContain(systemId);
  });

  it('a tenant cannot UPDATE a system source (403) or add a version to it (403)', async () => {
    const org = await adminOrg();
    const systemId = await seedSystemSource();
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/sources/${systemId}`, org.api_key, {
      legal_status: 'REVOKED',
    });
    expect(patch.statusCode).toBe(403);
    expect(bodyOf(patch)['error']).toBe('cannot_modify_non_tenant_source');

    const ver = await inject(stack, 'POST', `/v1/regulatory/sources/${systemId}/versions`, org.api_key, {
      verification_status: 'CONFIRMED_PRIMARY_SOURCE',
    });
    expect(ver.statusCode).toBe(403);
  });

  it('a tenant may link its own control to a visible system source', async () => {
    const org = await adminOrg();
    const systemId = await seedSystemSource();
    const ctrl = await inject(stack, 'POST', '/v1/regulatory/controls', org.api_key, baseControl());
    const controlId = (bodyOf(ctrl)['control'] as Record<string, unknown>)['id'] as string;
    const link = await inject(stack, 'POST', `/v1/regulatory/controls/${controlId}/source-links`, org.api_key, {
      source_id: systemId,
      link_type: 'LEGAL_DRIVER',
    });
    expect(link.statusCode).toBe(201);
  });

  it('a tenant cannot directly INSERT a system row through the app role', async () => {
    const org = await adminOrg();
    let blocked = false;
    try {
      await asOrg(org.org_id, (c) =>
        c.query(
          `INSERT INTO govai.regulatory_sources
             (org_id, scope, source_key, title, source_quality, verification_status, legal_status)
           VALUES (NULL, 'system', $1, 't', 'PRIMARY_OFFICIAL_SOURCE', 'CONFIRMED_PRIMARY_SOURCE', 'ACTIVE')`,
          [`SYS-APP-${randomUUID().slice(0, 8)}`],
        ),
      );
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });
});

describe('regulatory-rls / cross-tenant isolation', () => {
  it('cross-org GET source by id returns 404', async () => {
    const orgA = await adminOrg();
    const orgB = await adminOrg();
    const res = await inject(stack, 'POST', '/v1/regulatory/sources', orgA.api_key, baseSource());
    const id = (bodyOf(res)['source'] as Record<string, unknown>)['id'] as string;
    const cross = await inject(stack, 'GET', `/v1/regulatory/sources/${id}`, orgB.api_key);
    expect(cross.statusCode).toBe(404);
  });

  it('list is scoped to the caller org (plus system rows)', async () => {
    const orgA = await adminOrg();
    const orgB = await adminOrg();
    const a = await inject(stack, 'POST', '/v1/regulatory/sources', orgA.api_key, baseSource());
    const aId = (bodyOf(a)['source'] as Record<string, unknown>)['id'] as string;
    const listB = await inject(stack, 'GET', '/v1/regulatory/sources?limit=200', orgB.api_key);
    const rows = bodyOf(listB)['sources'] as Array<Record<string, unknown>>;
    expect(rows.map((s) => s['id'])).not.toContain(aId);
    for (const row of rows) {
      // B sees only its own tenant rows or system rows.
      expect(row['org_id'] === orgB.org_id || row['org_id'] === null).toBe(true);
    }
  });

  it('cross-org version creation is invisible (404 source_not_found)', async () => {
    const orgA = await adminOrg();
    const orgB = await adminOrg();
    const a = await inject(stack, 'POST', '/v1/regulatory/sources', orgA.api_key, baseSource());
    const aId = (bodyOf(a)['source'] as Record<string, unknown>)['id'] as string;
    const ver = await inject(stack, 'POST', `/v1/regulatory/sources/${aId}/versions`, orgB.api_key, {
      verification_status: 'CONFIRMED_PRIMARY_SOURCE',
    });
    expect(ver.statusCode).toBe(404);
    expect(bodyOf(ver)['error']).toBe('source_not_found');
  });

  it('cross-org control PATCH is invisible (404)', async () => {
    const orgA = await adminOrg();
    const orgB = await adminOrg();
    const a = await inject(stack, 'POST', '/v1/regulatory/controls', orgA.api_key, baseControl());
    const aId = (bodyOf(a)['control'] as Record<string, unknown>)['id'] as string;
    const patch = await inject(stack, 'PATCH', `/v1/regulatory/controls/${aId}`, orgB.api_key, {
      name: 'hijacked',
    });
    expect(patch.statusCode).toBe(404);
  });

  it('direct cross-org INSERT is blocked by RLS WITH CHECK', async () => {
    const orgA = await adminOrg();
    const orgB = await adminOrg();
    let blocked = false;
    try {
      await asOrg(orgB.org_id, (c) =>
        c.query(
          `INSERT INTO govai.regulatory_sources
             (org_id, scope, source_key, title, source_quality, verification_status, legal_status)
           VALUES ($1::uuid, 'tenant', $2, 't', 'PRIMARY_REGULATORY_SOURCE', 'CONFIRMED_PRIMARY_SOURCE', 'ACTIVE')`,
          [orgA.org_id, `BR-X-${randomUUID().slice(0, 8)}`],
        ),
      );
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it('direct cross-org UPDATE affects zero rows under RLS', async () => {
    const orgA = await adminOrg();
    const orgB = await adminOrg();
    const a = await inject(stack, 'POST', '/v1/regulatory/sources', orgA.api_key, baseSource());
    const aId = (bodyOf(a)['source'] as Record<string, unknown>)['id'] as string;
    const affected = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query(
        "UPDATE govai.regulatory_sources SET legal_status = 'REVOKED' WHERE id = $1::uuid",
        [aId],
      );
      return r.rowCount;
    });
    expect(affected).toBe(0);
  });

  it('cross-org audit_events for regulatory mutations are invisible', async () => {
    const orgA = await adminOrg();
    const orgB = await adminOrg();
    await inject(stack, 'POST', '/v1/regulatory/sources', orgA.api_key, baseSource());
    const visibleToB = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query(
        `SELECT id FROM govai.audit_events
          WHERE org_id = $1::uuid AND event_type = 'regulatory_source.created'`,
        [orgA.org_id],
      );
      return r.rowCount;
    });
    expect(visibleToB).toBe(0);
  });
});

// FK checks bypass RLS, so child INSERT policies must independently verify the
// referenced parent is visible (own-tenant or system). These tests drive the
// DB layer directly (as govai_app), bypassing the service layer, to prove the
// WITH CHECK policies — not just service-layer guards — block cross-tenant
// parent references and the resulting existence oracle.
describe('regulatory-rls / child parent-ownership (RLS WITH CHECK)', () => {
  it('a tenant cannot create a source version referencing another tenant\'s source', async () => {
    const orgA = await adminOrg();
    const orgB = await adminOrg();
    const aSourceId = await createTenantSource(orgA);
    const blocked = await insertBlocked(
      orgB.org_id,
      `INSERT INTO govai.regulatory_source_versions (org_id, source_id, version_number, verification_status)
       VALUES ($1::uuid, $2::uuid, 1, 'CONFIRMED_PRIMARY_SOURCE')`,
      [orgB.org_id, aSourceId],
    );
    expect(blocked).toBe(true);
  });

  it('a tenant cannot create a source relationship to or from another tenant\'s source', async () => {
    const orgA = await adminOrg();
    const orgB = await adminOrg();
    const aSourceId = await createTenantSource(orgA);
    const bSourceId = await createTenantSource(orgB);

    const blockedTo = await insertBlocked(
      orgB.org_id,
      `INSERT INTO govai.regulatory_source_relationships (org_id, from_source_id, to_source_id, relationship_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'RELATED')`,
      [orgB.org_id, bSourceId, aSourceId],
    );
    expect(blockedTo).toBe(true);

    const blockedFrom = await insertBlocked(
      orgB.org_id,
      `INSERT INTO govai.regulatory_source_relationships (org_id, from_source_id, to_source_id, relationship_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'RELATED')`,
      [orgB.org_id, aSourceId, bSourceId],
    );
    expect(blockedFrom).toBe(true);
  });

  it('a tenant cannot create a control-source link referencing another tenant\'s control or source', async () => {
    const orgA = await adminOrg();
    const orgB = await adminOrg();
    const aControlId = await createTenantControl(orgA);
    const aSourceId = await createTenantSource(orgA);
    const bControlId = await createTenantControl(orgB);
    const bSourceId = await createTenantSource(orgB);

    const blockedControl = await insertBlocked(
      orgB.org_id,
      `INSERT INTO govai.regulatory_control_source_links (org_id, control_id, source_id, link_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'LEGAL_DRIVER')`,
      [orgB.org_id, aControlId, bSourceId],
    );
    expect(blockedControl).toBe(true);

    const blockedSource = await insertBlocked(
      orgB.org_id,
      `INSERT INTO govai.regulatory_control_source_links (org_id, control_id, source_id, link_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'LEGAL_DRIVER')`,
      [orgB.org_id, bControlId, aSourceId],
    );
    expect(blockedSource).toBe(true);
  });

  it('a tenant cannot create a framework mapping referencing another tenant\'s control or source', async () => {
    const orgA = await adminOrg();
    const orgB = await adminOrg();
    const aControlId = await createTenantControl(orgA);
    const aSourceId = await createTenantSource(orgA);
    const bControlId = await createTenantControl(orgB);

    const blockedControl = await insertBlocked(
      orgB.org_id,
      `INSERT INTO govai.regulatory_control_framework_mappings (org_id, control_id, framework_key, mapping_status)
       VALUES ($1::uuid, $2::uuid, 'LGPD', 'PARTIAL')`,
      [orgB.org_id, aControlId],
    );
    expect(blockedControl).toBe(true);

    const blockedSource = await insertBlocked(
      orgB.org_id,
      `INSERT INTO govai.regulatory_control_framework_mappings (org_id, control_id, framework_key, mapping_status, source_id)
       VALUES ($1::uuid, $2::uuid, 'LGPD', 'PARTIAL', $3::uuid)`,
      [orgB.org_id, bControlId, aSourceId],
    );
    expect(blockedSource).toBe(true);
  });

  it('a tenant may reference a visible system source and its own rows (happy paths preserved)', async () => {
    const orgB = await adminOrg();
    const systemSourceId = await seedSystemSource();
    const bControlId = await createTenantControl(orgB);
    const bSourceId = await createTenantSource(orgB);

    // Own control linked to a visible system source → allowed.
    const linkSystem = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query(
        `INSERT INTO govai.regulatory_control_source_links (org_id, control_id, source_id, link_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'LEGAL_DRIVER') RETURNING id`,
        [orgB.org_id, bControlId, systemSourceId],
      );
      return r.rowCount;
    });
    expect(linkSystem).toBe(1);

    // Own control linked to own source → allowed.
    const linkOwn = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query(
        `INSERT INTO govai.regulatory_control_source_links (org_id, control_id, source_id, link_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'FRAMEWORK_DRIVER') RETURNING id`,
        [orgB.org_id, bControlId, bSourceId],
      );
      return r.rowCount;
    });
    expect(linkOwn).toBe(1);

    // Own version on own source → allowed.
    const ver = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query(
        `INSERT INTO govai.regulatory_source_versions (org_id, source_id, version_number, verification_status)
         VALUES ($1::uuid, $2::uuid, 1, 'CONFIRMED_PRIMARY_SOURCE') RETURNING id`,
        [orgB.org_id, bSourceId],
      );
      return r.rowCount;
    });
    expect(ver).toBe(1);
  });
});
