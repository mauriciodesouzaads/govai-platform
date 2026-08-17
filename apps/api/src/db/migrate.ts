// Migration runner — executa bootstrap.sql + 0001..NNNN em ordem.
// Idempotente: bootstrap usa DO blocks; migrations usam CREATE IF NOT EXISTS / DO duplicates.
//
// Bootstrap.sql exige que `govai.app_password` esteja setado na sessão antes de
// rodar (ver docs/runbooks/db-roles-production.md). Este runner lê de
// process.env.GOVAI_DB_APP_PASSWORD e injeta via SET na MESMA conexão.

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { isMainModule } from '../main-module.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const BOOTSTRAP_PATH = join(__dirname, '..', '..', '..', '..', 'infra', 'postgres', 'bootstrap.sql');

export type MigrateOptions = {
  adminConnectionString: string;
  appPassword: string;
  /** Optional (EP-EVIDENCE-GAUGE-WIRING). When present (>= 8 chars), injected as the
   *  `govai.evidence_enumerator_password` GUC so bootstrap provisions/rotates the
   *  govai_evidence_enumerator role LOGIN. Absent ⇒ the role is left UNTOUCHED (a routine
   *  migration must not drop the gauges); use enumeratorDeprovision to disable it. */
  enumeratorPassword?: string;
  /** Optional explicit DEPROVISION signal (EP-EVIDENCE-GAUGE-WIRING CREDENTIAL-LIFECYCLE-
   *  RUNNER) from GOVAI_DB_EVIDENCE_ENUMERATOR_DEPROVISION; the ONLY accepted value is '1'.
   *  Present with no password ⇒ the enumerator is set NOLOGIN (bootstrap) and its live
   *  sessions are reaped post-commit (runner). Mutually exclusive with enumeratorPassword —
   *  both set ⇒ fail loud. No magic password sentinel. */
  enumeratorDeprovision?: string;
  log?: (msg: string) => void;
};

export type EnumeratorSignals = {
  /** GOVAI_DB_EVIDENCE_ENUMERATOR_PASSWORD → GUC govai.evidence_enumerator_password. */
  password?: string;
  /** GOVAI_DB_EVIDENCE_ENUMERATOR_DEPROVISION → GUC govai.evidence_enumerator_deprovision;
   *  the sole accepted "on" value is '1'. An EXPLICIT signal — no password sentinel. */
  deprovision?: string;
};

export type EnumeratorMode = 'provision' | 'deprovision' | 'untouched';

/**
 * Resolve the two independent lifecycle signals into exactly one mode, or throw LOUD on a
 * contradictory / invalid combination (the five-way machine's cells 2 and 5). Pure — no side
 * effects — so a runner can (and the shared applier does) call it BEFORE any bootstrap write,
 * satisfying "fail loud before bootstrap" with the existing role state left untouched.
 */
export function resolveEnumeratorMode(signals: EnumeratorSignals): EnumeratorMode {
  const hasPassword = signals.password !== undefined && signals.password !== '';
  const rawDeprovision = signals.deprovision;
  const deprovisionSet = rawDeprovision !== undefined && rawDeprovision !== '';

  if (deprovisionSet && rawDeprovision !== '1') {
    // Cell 5: any deprovision value other than the sole accepted '1'.
    throw new Error(
      `GOVAI_DB_EVIDENCE_ENUMERATOR_DEPROVISION must be unset, empty, or '1' (got '${rawDeprovision}').`,
    );
  }
  if (hasPassword && deprovisionSet) {
    // Cell 2: provision and deprovision at once.
    throw new Error(
      'Conflicting enumerator lifecycle intent: GOVAI_DB_EVIDENCE_ENUMERATOR_PASSWORD and ' +
        'GOVAI_DB_EVIDENCE_ENUMERATOR_DEPROVISION=1 are both set. Provide exactly one.',
    );
  }
  if (deprovisionSet) return 'deprovision'; // Cell 4
  if (hasPassword) return 'provision'; // Cell 1 (bootstrap RAISEs if length < 8)
  return 'untouched'; // Cell 3 — routine migration must not drop the gauges by omission
}

/**
 * Post-commit bounded session sweep — reaps already-live enumerator sessions AFTER the NOLOGIN
 * has COMMITTED (so no fresh authentication can succeed on the revoked credential). Bounded and
 * it NEVER fails migrate: the role is already NOLOGIN-committed, so any survivor past the cap is
 * benign (it cannot re-authenticate). Idempotent/resumable — a crash before the sweep leaves
 * NOLOGIN committed (safe) and survivors are reaped on the next explicit deprovision run.
 */
export async function sweepEnumeratorSessions(
  c: PoolClient,
  log: (msg: string) => void,
): Promise<void> {
  const TERMINATE = `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE usename = 'govai_evidence_enumerator' AND pid <> pg_backend_pid()`;
  const COUNT = `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE usename = 'govai_evidence_enumerator' AND pid <> pg_backend_pid()`;
  const CAP = 3;
  for (let i = 0; i < CAP; i++) {
    const res = await c.query(TERMINATE);
    if ((res.rowCount ?? 0) === 0) return; // no live enumerator sessions remain — clean
    // Let the SIGTERM'd backends exit before re-checking on the next iteration.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const rem = await c.query<{ n: number }>(COUNT);
  const survivors = rem.rows[0]?.n ?? 0;
  if (survivors > 0) {
    log(
      `[deprovision] WARNING: ${survivors} enumerator session(s) still present after ${CAP} sweeps; ` +
        'the role is NOLOGIN (no new authentication possible). Re-run deprovision or restart the API to reap them.',
    );
  }
}

/**
 * The shared realization of the five-way lifecycle, called IDENTICALLY by both migration
 * runners (this file's `migrate` and tests/integration/setup.ts) so the gating + the
 * post-commit sweep CANNOT drift between them (the load-bearing anti-drift invariant).
 *   validate signals (throws loud on cells 2/5, before any write)
 *   → set the driving GUC (provision: password; deprovision: the flag; untouched: neither)
 *   → run bootstrap (the caller's single `c.query(bootstrap)`; COMMIT happens on its return)
 *   → on deprovision ONLY, run the post-commit bounded session sweep.
 */
export async function applyEnumeratorLifecycle(
  c: PoolClient,
  signals: EnumeratorSignals,
  runBootstrap: () => Promise<void>,
  log: (msg: string) => void,
): Promise<void> {
  const mode = resolveEnumeratorMode(signals); // fail-loud BEFORE bootstrap (cells 2 and 5)
  if (mode === 'provision') {
    await c.query(
      `SET govai.evidence_enumerator_password = '${signals.password!.replace(/'/g, "''")}'`,
    );
  } else if (mode === 'deprovision') {
    await c.query(`SET govai.evidence_enumerator_deprovision = '1'`);
  }
  // Cell 3 (untouched): set neither GUC — bootstrap leaves the role exactly as-is.
  await runBootstrap(); // COMMIT has happened server-side once this returns
  if (mode === 'deprovision') {
    await sweepEnumeratorSessions(c, log); // post-commit reap of already-live sessions
  }
}

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
    // EP-EVIDENCE-GAUGE-WIRING CREDENTIAL-LIFECYCLE-RUNNER: the enumerator's five-way lifecycle
    // (validate → set the driving GUC → run bootstrap → post-commit sweep on deprovision) is
    // realized HERE, at the commit boundary, via the shared applier — identical in the test
    // runner (tests/integration/setup.ts) so the two cannot drift.
    await applyEnumeratorLifecycle(
      c,
      { password: opts.enumeratorPassword, deprovision: opts.enumeratorDeprovision },
      async () => {
        await c.query(bootstrap);
      },
      log,
    );
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

// M2A F2: canonical-path entrypoint check (see ../main-module.ts).
if (isMainModule(import.meta.url)) {
  const conn = process.env['DATABASE_ADMIN_URL'];
  const appPassword = process.env['GOVAI_DB_APP_PASSWORD'];
  // Optional (EP-EVIDENCE-GAUGE-WIRING CREDENTIAL-LIFECYCLE-RUNNER): password absent AND
  // deprovision absent ⇒ the enumerator role is left untouched (no failure). Password present
  // ⇒ provision/rotate; DEPROVISION=1 with no password ⇒ disable + post-commit sweep. Both set,
  // or an invalid DEPROVISION value ⇒ fail loud. See applyEnumeratorLifecycle.
  const enumeratorPassword = process.env['GOVAI_DB_EVIDENCE_ENUMERATOR_PASSWORD'];
  const enumeratorDeprovision = process.env['GOVAI_DB_EVIDENCE_ENUMERATOR_DEPROVISION'];
  if (!conn) {
    console.error('DATABASE_ADMIN_URL is required');
    process.exit(1);
  }
  if (!appPassword) {
    console.error('GOVAI_DB_APP_PASSWORD is required (>= 8 chars). See docs/runbooks/db-roles-production.md.');
    process.exit(1);
  }
  migrate({ adminConnectionString: conn, appPassword, enumeratorPassword, enumeratorDeprovision })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
