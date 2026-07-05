import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
// EP-EVIDENCE-GAUGE-WIRING CREDENTIAL-LIFECYCLE-RUNNER: the SAME shared applier the production
// runner uses (apps/api/src/db/migrate.ts) — imported, not re-implemented, so the two runners'
// enumerator lifecycle (five-way gating + post-commit sweep) cannot drift.
import { applyEnumeratorLifecycle } from '../../apps/api/src/db/migrate.js';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const BOOTSTRAP_PATH = join(ROOT, 'infra', 'postgres', 'bootstrap.sql');
const MIGRATIONS_DIR = join(ROOT, 'apps', 'api', 'src', 'db', 'migrations');

export type TestDb = {
  container: StartedPostgreSqlContainer;
  adminUrl: string;
  appUrl: string;
  adminPool: Pool;
  appPool: Pool;
  /** Per-container random password for govai_app — needed by tests that re-run migrate. */
  appPassword: string;
  /** Per-container random password + URL for govai_evidence_enumerator (EP-EVIDENCE-
   *  GAUGE-WIRING). The role is created NOLOGIN by default (unprovisioned); a test
   *  provisions LOGIN by re-running migrate(adminUrl, appPassword, enumeratorPassword),
   *  then connects via enumeratorUrl. */
  enumeratorPassword: string;
  enumeratorUrl: string;
  /**
   * Teardown coordination flag (issue #28). When true, expected Postgres
   * disconnect errors emitted by the pg client during testcontainer shutdown
   * are swallowed by the pool error handlers installed in startPostgres.
   * Set by stopPostgres before any pool.end()/container.stop() call.
   */
  shuttingDown: { value: boolean };
};

/**
 * Classifier for the expected Postgres teardown disconnect (issue #28).
 *
 * When Testcontainers stops the Postgres container, any pg client still
 * holding an open connection receives:
 *   - code: '57P01'
 *   - message: 'terminating connection due to administrator command'
 *
 * In a normal/healthy test run this error fires AFTER all tests complete,
 * during the afterAll teardown sequence. The error is then surfaced to
 * Vitest's unhandled-error reporter, which flips the suite to failed even
 * though every test passed.
 *
 * This classifier is INTENTIONALLY NARROW: it matches ONLY the exact code
 * + message pair emitted on container shutdown. Any other error — even
 * another fatal Postgres error — is left to propagate. Pool handlers must
 * also gate this swallow on `shuttingDown.value === true` so the same
 * disconnect during normal test execution would still surface.
 */
export function isExpectedPostgresTeardownError(error: unknown): boolean {
  if (error === null || error === undefined || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown };
  return (
    e.code === '57P01' &&
    typeof e.message === 'string' &&
    e.message.includes('terminating connection due to administrator command')
  );
}

/**
 * Install a pool-scoped error listener that swallows expected Postgres
 * teardown disconnects when the stack is in the shutdown phase. Errors
 * outside the shutdown phase, and any error that does not match the exact
 * 57P01 + message signature, are re-thrown so they remain visible.
 *
 * Called once per pool from startPostgres after pool creation so the
 * listener is installed before any teardown begins.
 */
export function installPostgresPoolShutdownGuard(
  pool: Pool,
  shuttingDown: { value: boolean },
  poolName: string,
): void {
  pool.on('error', (error) => {
    if (shuttingDown.value && isExpectedPostgresTeardownError(error)) {
      // Expected: Postgres container is being torn down. Swallowing this
      // exact error prevents Vitest from flipping the suite to failed.
      return;
    }
    // Anything else is a real error and must remain visible. We re-emit
    // synchronously as an uncaughtException so Vitest sees it the same way
    // it would if no handler had been attached.
    process.nextTick(() => {
      const wrapped = new Error(
        `[testcontainers] unexpected ${poolName} pool error during ${
          shuttingDown.value ? 'shutdown' : 'normal execution'
        }: ${(error as Error)?.message ?? String(error)}`,
      );
      (wrapped as Error & { cause?: unknown }).cause = error;
      throw wrapped;
    });
  });
}

/**
 * Migrate runs bootstrap.sql + 0001..NNNN against the admin connection.
 * `appPassword` is injected via session GUC `govai.app_password` so the bootstrap
 * never relies on a hardcoded literal. Caller must use the same password when
 * connecting as the `govai_app` role afterward.
 */
export async function migrate(
  adminConn: string,
  appPassword: string,
  enumeratorPassword?: string,
  enumeratorDeprovision?: string,
): Promise<void> {
  if (!appPassword || appPassword.length < 8) {
    throw new Error('migrate: appPassword must be >= 8 chars');
  }
  // Single client so the GUC stays in scope for the whole bootstrap.
  const pool = new Pool({ connectionString: adminConn, max: 1 });
  const c = await pool.connect();
  try {
    // Custom GUCs of the form `prefix.name` are session-scoped without prior config.
    await c.query(`SET govai.app_password = '${appPassword.replace(/'/g, "''")}'`);
    const bootstrap = await readFile(BOOTSTRAP_PATH, 'utf8');
    // EP-EVIDENCE-GAUGE-WIRING CREDENTIAL-LIFECYCLE-RUNNER: identical enumerator lifecycle to
    // the production runner — the SAME applyEnumeratorLifecycle (five-way gating + post-commit
    // sweep on deprovision). Mirrors migrate.ts by SHARING the function, not copying it.
    await applyEnumeratorLifecycle(
      c,
      { password: enumeratorPassword, deprovision: enumeratorDeprovision },
      async () => {
        await c.query(bootstrap);
      },
      (m) => console.warn(m),
    );
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));
    for (const f of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
      await c.query(sql);
    }
  } finally {
    c.release();
    await pool.end();
  }
}

export async function startPostgres(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('govai')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const adminUrl = container.getConnectionUri();
  const host = container.getHost();
  const port = container.getMappedPort(5432);

  // dev-only: per-container random password for govai_app. Production must
  // inject GOVAI_DB_APP_PASSWORD via env (see docs/runbooks/db-roles-production.md);
  // the production migrate runner reads that env and passes it to migrate() the
  // same way this fixture does.
  const appPassword = randomBytes(24).toString('hex');
  const appUrl = `postgres://govai_app:${encodeURIComponent(appPassword)}@${host}:${port}/govai`;
  // EP-EVIDENCE-GAUGE-WIRING: generate the enumerator credential + URL, but do NOT
  // provision LOGIN by default — the role stays NOLOGIN (production default + the I7
  // unprovisioned state). A test provisions it by re-running migrate with this password.
  const enumeratorPassword = randomBytes(24).toString('hex');
  const enumeratorUrl = `postgres://govai_evidence_enumerator:${encodeURIComponent(enumeratorPassword)}@${host}:${port}/govai`;

  await migrate(adminUrl, appPassword);

  const adminPool = new Pool({ connectionString: adminUrl });
  const appPool = new Pool({ connectionString: appUrl });

  // Issue #28: install shutdown-scoped error handlers on both setup pools.
  // The flag is a shared object so the same reference can be passed to other
  // pools (e.g. the Fastify app's pool) that the stack also tears down.
  const shuttingDown: { value: boolean } = { value: false };
  installPostgresPoolShutdownGuard(adminPool, shuttingDown, 'admin');
  installPostgresPoolShutdownGuard(appPool, shuttingDown, 'app');

  return {
    container,
    adminUrl,
    appUrl,
    adminPool,
    appPool,
    appPassword,
    enumeratorPassword,
    enumeratorUrl,
    shuttingDown,
  };
}

export async function stopPostgres(db: TestDb): Promise<void> {
  // Mark shutdown BEFORE any pool.end()/container.stop() so the pool error
  // guards (installed by startPostgres) recognize the next 57P01 as expected.
  db.shuttingDown.value = true;
  await db.adminPool.end().catch(() => undefined);
  await db.appPool.end().catch(() => undefined);
  await db.container.stop().catch(() => undefined);
}

export function freshSeedHex(): string {
  return randomBytes(32).toString('hex');
}
