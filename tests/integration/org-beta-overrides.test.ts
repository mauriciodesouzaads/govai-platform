// Migration 0007 integration tests — Matrix §5.1 + §5.2 + §5.3.
// Covers: insert under tenant context, unique partial index on active rows,
// CHECK (expires_at > set_at), revoke via UPDATE, no DELETE/TRUNCATE, hard_denied
// is application-layer (DB allows insert; the app layer rejects via createOrgBetaOverride).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPostgres, stopPostgres, type TestDb } from './setup.js';
import { setLocalAppOrgId } from '@govai/core-tenant';

let db: TestDb;

beforeAll(async () => {
  db = await startPostgres();
}, 240_000);

afterAll(async () => {
  if (db) await stopPostgres(db);
});

async function insertOverride(orgId: string, betaToken: string, expiresInMs = 86_400_000) {
  const c = await db.appPool.connect();
  try {
    await c.query('BEGIN');
    await setLocalAppOrgId(c, orgId);
    try {
      const r = await c.query<{ id: string }>(
        `INSERT INTO govai.org_beta_overrides
           (org_id, provider, beta_token, reason, set_by_user_id, expires_at)
         VALUES ($1::uuid, 'anthropic', $2::text, 'test', $3::uuid, $4::timestamptz)
         RETURNING id`,
        [orgId, betaToken, randomUUID(), new Date(Date.now() + expiresInMs).toISOString()],
      );
      await c.query('COMMIT');
      return r.rows[0]!.id;
    } catch (err) {
      // Make sure the connection isn't returned to the pool in aborted state.
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } finally {
    c.release();
  }
}

describe('org_beta_overrides migration', () => {
  it('table exists with expected columns', async () => {
    const c = await db.adminPool.connect();
    try {
      const r = await c.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
           WHERE table_schema='govai' AND table_name='org_beta_overrides'
           ORDER BY ordinal_position`,
      );
      const cols = r.rows.map((row) => row.column_name);
      expect(cols).toContain('id');
      expect(cols).toContain('org_id');
      expect(cols).toContain('provider');
      expect(cols).toContain('beta_token');
      expect(cols).toContain('expires_at');
      expect(cols).toContain('revoked_at');
    } finally {
      c.release();
    }
  });

  it('insert under tenant context succeeds; SELECT under different org returns 0', async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    await insertOverride(orgA, 'token-x');

    const c = await db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, orgB);
      const r = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM govai.org_beta_overrides`,
      );
      await c.query('COMMIT');
      expect(r.rows[0]!.count).toBe('0');
    } finally {
      c.release();
    }
  });

  it('unique partial index: cannot have two ACTIVE overrides for same (org, provider, beta_token)', async () => {
    const orgId = randomUUID();
    await insertOverride(orgId, 'token-y');
    let captured: Error | null = null;
    try {
      await insertOverride(orgId, 'token-y');
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).not.toBeNull();
    expect(String(captured)).toMatch(/unique|duplicate|already exists/i);
  });

  it('CHECK (expires_at > set_at): retroactive expires_at fails', async () => {
    const orgId = randomUUID();
    let captured: Error | null = null;
    try {
      await insertOverride(orgId, 'token-z', -86_400_000);
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).not.toBeNull();
    expect(String(captured)).toMatch(/check|constraint|expires_at/i);
  });

  it('revoke via UPDATE revoked_at; afterwards re-insert same token is allowed', async () => {
    const orgId = randomUUID();
    const id = await insertOverride(orgId, 'token-w');

    const c = await db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, orgId);
      await c.query(
        `UPDATE govai.org_beta_overrides SET revoked_at = now() WHERE id = $1::uuid`,
        [id],
      );
      await c.query('COMMIT');
    } finally {
      c.release();
    }

    // Now re-insert same token — should succeed because previous is revoked.
    await expect(insertOverride(orgId, 'token-w')).resolves.toBeDefined();
  });

  it('UPDATE without setting revoked_at is rejected by RLS WITH CHECK', async () => {
    const orgId = randomUUID();
    const id = await insertOverride(orgId, 'token-u');

    const c = await db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, orgId);
      try {
        // Postgres throws on WITH CHECK violation (does not silently filter).
        await expect(
          c.query(
            `UPDATE govai.org_beta_overrides SET reason = 'tampered' WHERE id = $1::uuid`,
            [id],
          ),
        ).rejects.toThrow(/row-level security|policy/i);
      } finally {
        await c.query('ROLLBACK').catch(() => undefined);
      }
    } finally {
      c.release();
    }
  });

  it('DELETE under app role: permission denied (no GRANT DELETE on govai_app)', async () => {
    const orgId = randomUUID();
    const id = await insertOverride(orgId, 'token-v');

    const c = await db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, orgId);
      try {
        await expect(
          c.query(`DELETE FROM govai.org_beta_overrides WHERE id = $1::uuid`, [id]),
        ).rejects.toThrow(/permission denied|insufficient_privilege/i);
      } finally {
        await c.query('ROLLBACK').catch(() => undefined);
      }
    } finally {
      c.release();
    }
  });

  it('Trigger blocks DELETE when RLS is bypassed (superuser path)', async () => {
    const orgId = randomUUID();
    const id = await insertOverride(orgId, 'token-vx');

    const c = await db.adminPool.connect();
    try {
      await c.query('BEGIN');
      // Stay as the admin pool's superuser (postgres) — has BYPASSRLS, so the
      // row is visible and the BEFORE DELETE trigger fires.
      try {
        await expect(
          c.query(`DELETE FROM govai.org_beta_overrides WHERE id = $1::uuid`, [id]),
        ).rejects.toThrow(/delete blocked/i);
      } finally {
        await c.query('ROLLBACK').catch(() => undefined);
      }
    } finally {
      c.release();
    }
  });

  it('TRUNCATE is blocked', async () => {
    const c = await db.adminPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE govai_audit_writer');
      await expect(c.query(`TRUNCATE govai.org_beta_overrides`)).rejects.toThrow(
        /TRUNCATE blocked/i,
      );
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
