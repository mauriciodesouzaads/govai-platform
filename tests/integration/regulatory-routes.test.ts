// Regulatory Core PR-R1 (issue #59, umbrella #33) — route auth, RBAC,
// pagination, and filters.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startStack, stopStack, seedOrg, addApiKey, inject, type Stack } from './helpers/server-fixture.js';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

function bodyOf(r: { body: unknown }): Record<string, unknown> {
  return r.body as Record<string, unknown>;
}

const baseSource = (overrides: Record<string, unknown> = {}) => ({
  source_key: `BR-RT-${randomUUID().slice(0, 8).toUpperCase()}`,
  title: 'route test source',
  source_quality: 'PRIMARY_REGULATORY_SOURCE',
  verification_status: 'CONFIRMED_PRIMARY_SOURCE',
  legal_status: 'ACTIVE',
  ...overrides,
});

const baseControl = (overrides: Record<string, unknown> = {}) => ({
  control_key: `GOVAI-RT-${randomUUID().slice(0, 8).toUpperCase()}`,
  domain: 'governance',
  name: 'route test control',
  capability_type: 'REQUIRED_NATIVE_CAPABILITY',
  implementation_state: 'TARGET_CAPABILITY_REQUIRED',
  build_decision: 'BUILD_NATIVE_CORE',
  ...overrides,
});

describe('regulatory-routes / auth + rbac', () => {
  it('rejects unauthenticated reads and writes (401)', async () => {
    const list = await inject(stack, 'GET', '/v1/regulatory/sources', undefined);
    expect(list.statusCode).toBe(401);
    const create = await inject(stack, 'POST', '/v1/regulatory/sources', undefined, baseSource());
    expect(create.statusCode).toBe(401);
  });

  it('a non-write role can read but not write', async () => {
    const org = await seedOrg(stack);
    const dev = await addApiKey(stack, org.org_id, org.user_id, ['developer']);
    const read = await inject(stack, 'GET', '/v1/regulatory/sources', dev.api_key);
    expect(read.statusCode).toBe(200);
    const write = await inject(stack, 'POST', '/v1/regulatory/sources', dev.api_key, baseSource());
    expect(write.statusCode).toBe(403);
    expect(bodyOf(write)['error']).toBe('forbidden');
  });

  it('admin and data_protection_officer roles can write', async () => {
    const org = await seedOrg(stack);
    const admin = await addApiKey(stack, org.org_id, org.user_id, ['admin']);
    const dpo = await addApiKey(stack, org.org_id, org.user_id, ['data_protection_officer']);
    const a = await inject(stack, 'POST', '/v1/regulatory/sources', admin.api_key, baseSource());
    expect(a.statusCode).toBe(201);
    const d = await inject(stack, 'POST', '/v1/regulatory/controls', dpo.api_key, baseControl());
    expect(d.statusCode).toBe(201);
  });

  it('a key with no roles can read but not write', async () => {
    const org = await seedOrg(stack); // seedOrg key carries no roles
    const read = await inject(stack, 'GET', '/v1/regulatory/controls', org.api_key);
    expect(read.statusCode).toBe(200);
    const write = await inject(stack, 'POST', '/v1/regulatory/controls', org.api_key, baseControl());
    expect(write.statusCode).toBe(403);
  });
});

describe('regulatory-routes / pagination', () => {
  it('keyset pagination returns every row exactly once', async () => {
    const org = await seedOrg(stack);
    const admin = await addApiKey(stack, org.org_id, org.user_id, ['admin']);
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await inject(stack, 'POST', '/v1/regulatory/sources', admin.api_key, baseSource());
      created.push((bodyOf(r)['source'] as Record<string, unknown>)['id'] as string);
    }

    const seen = new Set<string>();
    let cursor: { before_created_at: string; before_id: string } | null = null;
    let guard = 0;
    do {
      const qs = cursor
        ? `?limit=2&before_created_at=${encodeURIComponent(cursor.before_created_at)}&before_id=${cursor.before_id}`
        : '?limit=2';
      const page = await inject(stack, 'GET', `/v1/regulatory/sources${qs}`, admin.api_key);
      expect(page.statusCode).toBe(200);
      const rows = bodyOf(page)['sources'] as Array<Record<string, unknown>>;
      for (const row of rows) seen.add(row['id'] as string);
      cursor = bodyOf(page)['next_cursor'] as { before_created_at: string; before_id: string } | null;
      guard += 1;
    } while (cursor && guard < 20);

    for (const id of created) expect(seen.has(id)).toBe(true);
  });

  it('rejects a half-specified cursor (400)', async () => {
    const org = await seedOrg(stack);
    const r = await inject(stack, 'GET', '/v1/regulatory/sources?before_id=' + randomUUID(), org.api_key);
    expect(r.statusCode).toBe(400);
  });
});

describe('regulatory-routes / filters', () => {
  it('filters sources by source_quality and legal_status', async () => {
    const org = await seedOrg(stack);
    const admin = await addApiKey(stack, org.org_id, org.user_id, ['admin']);
    await inject(stack, 'POST', '/v1/regulatory/sources', admin.api_key, baseSource({ source_quality: 'PRIMARY_REGULATORY_SOURCE', legal_status: 'ACTIVE' }));
    await inject(stack, 'POST', '/v1/regulatory/sources', admin.api_key, baseSource({ source_quality: 'ANALYST_REPORT', legal_status: 'REFERENCE_ONLY' }));

    const onlyAnalyst = await inject(stack, 'GET', '/v1/regulatory/sources?source_quality=ANALYST_REPORT&limit=200', admin.api_key);
    const rows = bodyOf(onlyAnalyst)['sources'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row['source_quality']).toBe('ANALYST_REPORT');
  });

  it('filters controls by capability_type and by framework_key', async () => {
    const org = await seedOrg(stack);
    const admin = await addApiKey(stack, org.org_id, org.user_id, ['admin']);
    const native = await inject(stack, 'POST', '/v1/regulatory/controls', admin.api_key, baseControl({ capability_type: 'IMPLEMENTED_FOUNDATIONAL_CONTROL', implementation_state: 'IMPLEMENTED_FOUNDATIONAL_CONTROL' }));
    const nativeId = (bodyOf(native)['control'] as Record<string, unknown>)['id'] as string;
    await inject(stack, 'POST', '/v1/regulatory/controls', admin.api_key, baseControl({ capability_type: 'CONNECTOR_ENRICHMENT', build_decision: 'CONNECTOR_ENRICHMENT' }));
    await inject(stack, 'POST', `/v1/regulatory/controls/${nativeId}/framework-mappings`, admin.api_key, {
      framework_key: 'ISO_42001',
      mapping_status: 'PARTIAL',
    });

    const byCapability = await inject(stack, 'GET', '/v1/regulatory/controls?capability_type=IMPLEMENTED_FOUNDATIONAL_CONTROL&limit=200', admin.api_key);
    const capRows = bodyOf(byCapability)['controls'] as Array<Record<string, unknown>>;
    expect(capRows.length).toBeGreaterThan(0);
    for (const row of capRows) expect(row['capability_type']).toBe('IMPLEMENTED_FOUNDATIONAL_CONTROL');

    const byFramework = await inject(stack, 'GET', '/v1/regulatory/controls?framework_key=ISO_42001&limit=200', admin.api_key);
    const fwIds = (bodyOf(byFramework)['controls'] as Array<Record<string, unknown>>).map((c) => c['id']);
    expect(fwIds).toContain(nativeId);
  });
});
