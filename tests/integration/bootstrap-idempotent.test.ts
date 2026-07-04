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

async function rolcanlogin(name: string): Promise<boolean> {
  const c = await db.adminPool.connect();
  try {
    const r = await c.query<{ rolcanlogin: boolean }>(
      `SELECT rolcanlogin FROM pg_roles WHERE rolname = $1`,
      [name],
    );
    return r.rows[0]?.rolcanlogin ?? false;
  } finally {
    c.release();
  }
}

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

  it('govai_evidence_enumerator LOGIN state tracks the GUC — provision + idempotent + deprovision-on-absent (I7 total, FIXUP4)', async () => {
    const ROLE = 'govai_evidence_enumerator';
    // startPostgres migrated WITHOUT the enumerator password ⇒ NOLOGIN (unprovisioned).
    expect(await rolcanlogin(ROLE)).toBe(false);
    // Absent GUC on a second run ⇒ stays NOLOGIN (absent×2 idempotent).
    await migrate(db.adminUrl, db.appPassword);
    expect(await rolcanlogin(ROLE)).toBe(false);
    // GUC present ⇒ provisioned LOGIN (absent→present transition).
    await migrate(db.adminUrl, db.appPassword, db.enumeratorPassword);
    expect(await rolcanlogin(ROLE)).toBe(true);
    // GUC present on a second run ⇒ stays LOGIN (present×2 idempotent).
    await migrate(db.adminUrl, db.appPassword, db.enumeratorPassword);
    expect(await rolcanlogin(ROLE)).toBe(true);
    // (d) present→absent (FIXUP4 deprovision-on-absent): a GUC-less re-run of a PROVISIONED
    // role NOLOGINs it and clears the password — the GUC is the single source of truth.
    await migrate(db.adminUrl, db.appPassword);
    expect(await rolcanlogin(ROLE)).toBe(false);
  });

  it('present-invalid (<8 chars) on a provisioned role fails loud with NO side effect (FIXUP6 6th cell)', async () => {
    const ROLE = 'govai_evidence_enumerator';
    // Provision (LOGIN).
    await migrate(db.adminUrl, db.appPassword, db.enumeratorPassword);
    expect(await rolcanlogin(ROLE)).toBe(true);
    // A present-but-invalid (<8) password ⇒ bootstrap RAISE EXCEPTION (migrate rejects) with
    // NO side effect: the role stays LOGIN — no NOLOGIN, no terminate, no password change.
    await expect(migrate(db.adminUrl, db.appPassword, 'short')).rejects.toThrow();
    expect(await rolcanlogin(ROLE)).toBe(true);
  });
});
