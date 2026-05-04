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
};

export async function migrate(adminConn: string): Promise<void> {
  const pool = new Pool({ connectionString: adminConn });
  try {
    const bootstrap = await readFile(BOOTSTRAP_PATH, 'utf8');
    await pool.query(bootstrap);
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));
    for (const f of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
      await pool.query(sql);
    }
  } finally {
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
  const appUrl = `postgres://govai_app:govai_app@${host}:${port}/govai`;

  await migrate(adminUrl);

  const adminPool = new Pool({ connectionString: adminUrl });
  const appPool = new Pool({ connectionString: appUrl });

  return { container, adminUrl, appUrl, adminPool, appPool };
}

export async function stopPostgres(db: TestDb): Promise<void> {
  await db.adminPool.end().catch(() => undefined);
  await db.appPool.end().catch(() => undefined);
  await db.container.stop().catch(() => undefined);
}

export function freshSeedHex(): string {
  return randomBytes(32).toString('hex');
}
