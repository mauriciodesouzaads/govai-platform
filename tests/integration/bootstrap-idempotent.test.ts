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

  it('govai_evidence_enumerator LOGIN state — five-way signals: provision + idempotent + routine-untouched + explicit deprovision', async () => {
    const ROLE = 'govai_evidence_enumerator';
    // startPostgres migrated with NO enumerator signal ⇒ role CREATED NOLOGIN, then cell 3
    // (no signal) leaves it untouched ⇒ NOLOGIN.
    expect(await rolcanlogin(ROLE)).toBe(false);
    // No signal on a second run ⇒ still untouched (idempotent) ⇒ NOLOGIN.
    await migrate(db.adminUrl, db.appPassword);
    expect(await rolcanlogin(ROLE)).toBe(false);
    // Password present ⇒ provisioned LOGIN (provision transition).
    await migrate(db.adminUrl, db.appPassword, db.enumeratorPassword);
    expect(await rolcanlogin(ROLE)).toBe(true);
    // Password present on a second run ⇒ stays LOGIN (rotate / idempotent).
    await migrate(db.adminUrl, db.appPassword, db.enumeratorPassword);
    expect(await rolcanlogin(ROLE)).toBe(true);
    // ★ Cell 3 on a PROVISIONED role (the footgun fix): a routine migration with NO password and
    // NO deprovision signal LEAVES the role LOGIN — omission no longer deprovisions.
    await migrate(db.adminUrl, db.appPassword);
    expect(await rolcanlogin(ROLE)).toBe(true);
    // Cell 4 — an EXPLICIT deprovision (DEPROVISION=1, no password) NOLOGINs it. The password +
    // deprovision GUC pair is the single source of truth; disabling now requires the explicit signal.
    await migrate(db.adminUrl, db.appPassword, undefined, '1');
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
