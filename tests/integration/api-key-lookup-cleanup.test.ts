// PR3.1g (issue #29) — legacy api_key_lookup cleanup regression.
//
// Validates that after migrations run:
//   1. govai.api_key_lookup_v2(text) — the RBAC-aware lookup — EXISTS.
//   2. govai.api_key_lookup(text)    — the legacy lookup       — DOES NOT EXIST.
//   3. authenticateApiKey() returns the AuthIdentity with `roles` populated
//      for an admin-promoted API key (i.e. the v2 lookup is wired and roles
//      propagate end-to-end).
//   4. authenticateApiKey() returns roles=[] for an API key with no role
//      grant (default seedOrg case).
//
// These assertions together prove:
//   * the cleanup migration did not break the auth path;
//   * the auth path uses the RBAC-aware function exclusively;
//   * removing the legacy function does not regress on existing API keys.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  stopStack,
  seedOrg,
  grantAdminRole,
  type Stack,
} from './helpers/server-fixture.js';
import { authenticateApiKey } from '../../apps/api/src/pipeline/auth.js';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

describe('api_key_lookup cleanup (issue #29)', () => {
  it('govai.api_key_lookup_v2(text) exists in the migrated schema', async () => {
    const c = await stack.db.adminPool.connect();
    try {
      const r = await c.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'govai'
              AND p.proname = 'api_key_lookup_v2'
              AND pg_get_function_arguments(p.oid) = 'p_prefix text'
         ) AS exists`,
      );
      expect(r.rows[0]?.exists).toBe(true);
    } finally {
      c.release();
    }
  });

  it('govai.api_key_lookup(text) DOES NOT exist (legacy removed by migration 0011)', async () => {
    const c = await stack.db.adminPool.connect();
    try {
      const r = await c.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'govai'
              AND p.proname = 'api_key_lookup'
              AND pg_get_function_arguments(p.oid) = 'p_prefix text'
         ) AS exists`,
      );
      expect(r.rows[0]?.exists).toBe(false);
    } finally {
      c.release();
    }
  });

  it('authenticateApiKey returns roles=[] for a non-admin API key', async () => {
    const org = await seedOrg(stack);
    const c = await stack.db.appPool.connect();
    try {
      const id = await authenticateApiKey(c, org.api_key);
      expect(id.org_id).toBe(org.org_id);
      expect(id.roles).toEqual([]);
    } finally {
      c.release();
    }
  });

  it('authenticateApiKey returns roles=["admin"] for an admin-promoted API key', async () => {
    const org = await seedOrg(stack);
    await grantAdminRole(stack, org.api_key_prefix);
    const c = await stack.db.appPool.connect();
    try {
      const id = await authenticateApiKey(c, org.api_key);
      expect(id.org_id).toBe(org.org_id);
      expect(id.roles).toEqual(['admin']);
    } finally {
      c.release();
    }
  });

  it('admin endpoint still gates correctly after the legacy function removal (sanity)', async () => {
    const org = await seedOrg(stack);
    // Non-admin → 403
    const res1 = await stack.app.inject({
      method: 'GET',
      url: '/v1/admin/provider-credentials',
      headers: { 'x-govai-api-key': org.api_key },
    });
    expect(res1.statusCode).toBe(403);

    // Promote to admin → 200
    await grantAdminRole(stack, org.api_key_prefix);
    const res2 = await stack.app.inject({
      method: 'GET',
      url: '/v1/admin/provider-credentials',
      headers: { 'x-govai-api-key': org.api_key },
    });
    expect(res2.statusCode).toBe(200);
  });

  it('auth.ts SELECTs from api_key_lookup_v2 (literal regression guard)', async () => {
    // Defensive: read the auth pipeline source and assert the SQL still
    // targets the v2 function. This catches an accidental revert of the
    // PR3.1b auth wiring even if all behavioural tests were stubbed.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const url = await import('node:url');
    const __filename = url.fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const authTs = await fs.readFile(
      path.join(__dirname, '..', '..', 'apps', 'api', 'src', 'pipeline', 'auth.ts'),
      'utf8',
    );
    expect(authTs).toContain('govai.api_key_lookup_v2');
    expect(authTs).not.toContain('govai.api_key_lookup(');
  });
});
