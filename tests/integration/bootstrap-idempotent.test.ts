// Bootstrap deve poder rodar 2x sem erro. Migrations idem.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPostgres, stopPostgres, migrate, type TestDb } from './setup.js';

let db: TestDb;

beforeAll(async () => {
  db = await startPostgres();
}, 240_000);

afterAll(async () => {
  if (db) await stopPostgres(db);
});

describe('bootstrap + migrations idempotency', () => {
  it('runs bootstrap.sql + migrations a second time without errors', async () => {
    await expect(migrate(db.adminUrl, db.appPassword)).resolves.toBeUndefined();
  });

  it('audit_events table exists and is empty after re-run', async () => {
    const c = await db.adminPool.connect();
    try {
      const r = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM govai.audit_events`,
      );
      expect(r.rows[0]?.count).toBe('0');
    } finally {
      c.release();
    }
  });
});
