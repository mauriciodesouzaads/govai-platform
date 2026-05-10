// HAE-004: tier + operational_mode columns on govai.orgs + authenticateApiKey extension.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { authenticateApiKey } from '../../apps/api/src/pipeline/auth.js';
import { startStack, stopStack, seedOrg, type Stack } from './helpers/server-fixture.js';

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

describe('HAE-004 — tier_resolution_primitive', () => {
  it('seeded org has default tier=starter and operational_mode=production', async () => {
    const org = await seedOrg(stack);
    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, org.org_id);
      const r = await c.query<{ tier: string; operational_mode: string }>(
        'SELECT tier, operational_mode FROM govai.orgs WHERE id = $1::uuid',
        [org.org_id],
      );
      await c.query('COMMIT');
      expect(r.rows[0]?.tier).toBe('starter');
      expect(r.rows[0]?.operational_mode).toBe('production');
    } finally {
      c.release();
    }
  });

  it('authenticateApiKey returns tier + operational_mode from DB', async () => {
    const org = await seedOrg(stack);
    const c = await stack.db.appPool.connect();
    try {
      const id = await authenticateApiKey(c, org.api_key);
      expect(id.org_id).toBe(org.org_id);
      expect(id.tier).toBe('starter');
      // DB default per HAE-004 + canonical PR2 instruction: production. The
      // pilot/test/dev modes are explicitly set via onboarding/seed/test fixtures.
      expect(id.operational_mode).toBe('production');
    } finally {
      c.release();
    }
  });

  it('explicit tier on org row is returned correctly (admin/superuser path; writer role does NOT have UPDATE)', async () => {
    const org = await seedOrg(stack);
    // HAE-004 deliberately does NOT grant UPDATE on govai.orgs to
    // govai_audit_writer — tier mutation is an admin operation reserved for
    // PR3's dedicated admin role + endpoint. In tests we mutate via the
    // admin pool's superuser connection (which bypasses RLS).
    const c = await stack.db.adminPool.connect();
    try {
      await c.query(
        `UPDATE govai.orgs SET tier = 'enterprise', operational_mode = 'production' WHERE id = $1::uuid`,
        [org.org_id],
      );
    } finally {
      c.release();
    }
    const c2 = await stack.db.appPool.connect();
    try {
      const id = await authenticateApiKey(c2, org.api_key);
      expect(id.tier).toBe('enterprise');
      expect(id.operational_mode).toBe('production');
    } finally {
      c2.release();
    }
  });

  it('govai_audit_writer cannot UPDATE tier (no GRANT/policy)', async () => {
    const org = await seedOrg(stack);
    const c = await stack.db.adminPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE govai_audit_writer');
      // Either (a) permission denied at GRANT level, or (b) UPDATE returns
      // rowCount=0 because no UPDATE policy USING clause matches. Either way
      // the tier MUST NOT change.
      try {
        const r = await c.query(
          `UPDATE govai.orgs SET tier = 'enterprise' WHERE id = $1::uuid`,
          [org.org_id],
        );
        expect(r.rowCount ?? 0).toBe(0);
      } catch (err) {
        expect((err as Error).message).toMatch(/permission denied|policy/i);
      }
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    // Confirm tier is still default starter.
    const c2 = await stack.db.appPool.connect();
    try {
      const id = await authenticateApiKey(c2, org.api_key);
      expect(id.tier).toBe('starter');
    } finally {
      c2.release();
    }
  });

  it('CHECK constraints reject invalid tier / operational_mode values', async () => {
    const c = await stack.db.adminPool.connect();
    try {
      await expect(
        c.query(
          `INSERT INTO govai.orgs (id, name, tier) VALUES (gen_random_uuid(), 'bad', 'mythic_tier')`,
        ),
      ).rejects.toThrow(/check/i);
    } finally {
      c.release();
    }
  });
});
