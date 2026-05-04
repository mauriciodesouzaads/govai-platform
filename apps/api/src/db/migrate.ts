// Migration runner — executa bootstrap.sql + 0001..NNNN em ordem.
// Idempotente: bootstrap usa DO blocks; migrations usam CREATE IF NOT EXISTS / DO duplicates.
//
// Bootstrap.sql exige que `govai.app_password` esteja setado na sessão antes de
// rodar (ver docs/runbooks/db-roles-production.md). Este runner lê de
// process.env.GOVAI_DB_APP_PASSWORD e injeta via SET na MESMA conexão.

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
  appPassword: string;
  log?: (msg: string) => void;
};

export async function migrate(opts: MigrateOptions): Promise<void> {
  if (!opts.appPassword || opts.appPassword.length < 8) {
    throw new Error('migrate: appPassword must be >= 8 chars (set GOVAI_DB_APP_PASSWORD).');
  }
  const log = opts.log ?? ((m) => console.warn(m));
  // Single client so the GUC stays in scope for the whole bootstrap.
  const pool = new Pool({ connectionString: opts.adminConnectionString, max: 1 });
  const c = await pool.connect();
  try {
    await c.query(`SET govai.app_password = '${opts.appPassword.replace(/'/g, "''")}'`);
    log(`[bootstrap] executando ${BOOTSTRAP_PATH}`);
    const bootstrap = await readFile(BOOTSTRAP_PATH, 'utf8');
    await c.query(bootstrap);
    log('[bootstrap] ok');

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));
    for (const f of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
      log(`[migrate] aplicando ${f}`);
      await c.query(sql);
      log(`[migrate] ${f} ok`);
    }
  } finally {
    c.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const conn = process.env['DATABASE_ADMIN_URL'];
  const appPassword = process.env['GOVAI_DB_APP_PASSWORD'];
  if (!conn) {
    console.error('DATABASE_ADMIN_URL is required');
    process.exit(1);
  }
  if (!appPassword) {
    console.error('GOVAI_DB_APP_PASSWORD is required (>= 8 chars). See docs/runbooks/db-roles-production.md.');
    process.exit(1);
  }
  migrate({ adminConnectionString: conn, appPassword })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
