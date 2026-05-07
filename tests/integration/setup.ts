import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
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
};

/**
 * Migrate runs bootstrap.sql + 0001..NNNN against the admin connection.
 * `appPassword` is injected via session GUC `govai.app_password` so the bootstrap
 * never relies on a hardcoded literal. Caller must use the same password when
 * connecting as the `govai_app` role afterward.
 */
export async function migrate(adminConn: string, appPassword: string): Promise<void> {
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
    await c.query(bootstrap);
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

  await migrate(adminUrl, appPassword);

  const adminPool = new Pool({ connectionString: adminUrl });
  const appPool = new Pool({ connectionString: appUrl });

  return { container, adminUrl, appUrl, adminPool, appPool, appPassword };
}

export async function stopPostgres(db: TestDb): Promise<void> {
  await db.adminPool.end().catch(() => undefined);
  await db.appPool.end().catch(() => undefined);
  await db.container.stop().catch(() => undefined);
}

export function freshSeedHex(): string {
  return randomBytes(32).toString('hex');
}
