// Migration runner — executa bootstrap.sql + 0001..NNNN em ordem.
// Idempotente: bootstrap usa DO blocks; migrations usam CREATE IF NOT EXISTS / DO duplicates.

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const BOOTSTRAP_PATH = join(__dirname, '..', '..', '..', '..', 'infra', 'postgres', 'bootstrap.sql');

export type MigrateOptions = {
  adminConnectionString: string;
  appConnectionString?: string;
  log?: (msg: string) => void;
};

export async function runBootstrap(adminConn: string, log: (msg: string) => void = () => {}): Promise<void> {
  const sql = await readFile(BOOTSTRAP_PATH, 'utf8');
  const pool = new Pool({ connectionString: adminConn });
  try {
    log(`[bootstrap] executando ${BOOTSTRAP_PATH}`);
    await pool.query(sql);
    log('[bootstrap] ok');
  } finally {
    await pool.end();
  }
}

export async function runMigrations(adminConn: string, log: (msg: string) => void = () => {}): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
  const pool = new Pool({ connectionString: adminConn });
  try {
    for (const f of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
      log(`[migrate] aplicando ${f}`);
      await pool.query(sql);
      log(`[migrate] ${f} ok`);
    }
  } finally {
    await pool.end();
  }
}

export async function migrate(opts: MigrateOptions): Promise<void> {
  const log = opts.log ?? ((m) => console.warn(m));
  await runBootstrap(opts.adminConnectionString, log);
  await runMigrations(opts.adminConnectionString, log);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const conn = process.env['DATABASE_ADMIN_URL'];
  if (!conn) {
    console.error('DATABASE_ADMIN_URL is required');
    process.exit(1);
  }
  migrate({ adminConnectionString: conn })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
