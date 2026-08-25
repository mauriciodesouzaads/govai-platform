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
  /** Optional (EP-AI-CONVERSATION-CONTINUITY-V1 P0-A2). When present (>= 8 chars), injected as
   *  the `govai.conversation_worker_password` GUC so bootstrap provisions/rotates the
   *  govai_conversation_worker role LOGIN. Absent ⇒ the role is left UNTOUCHED (it stays
   *  NOLOGIN-until-provisioned; a routine migration must not disable conversation recovery);
   *  use conversationWorkerDeprovision to disable it. */
  conversationWorkerPassword?: string;
  /** Optional explicit DEPROVISION signal from GOVAI_DB_CONVERSATION_WORKER_DEPROVISION; the
   *  ONLY accepted value is '1'. Present with no password ⇒ the worker is set NOLOGIN
   *  (bootstrap) and its live sessions are reaped post-commit (runner). Mutually exclusive with
   *  conversationWorkerPassword — both set ⇒ fail loud. No magic password sentinel. */
  conversationWorkerDeprovision?: string;
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

/** Sanitized error label — SQLSTATE when pg supplies one, else the error NAME. Never a raw
 *  driver/server message body, and never anything carrying connection material (the
 *  run-dispatch-recovery.ts logging convention). */
function errorLabel(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code !== '') return code;
  return err instanceof Error ? err.name : 'unknown';
}

/**
 * Post-commit bounded session sweep — reaps already-live sessions of `roleName` AFTER the NOLOGIN
 * has COMMITTED (so no fresh authentication can succeed on the revoked credential). Bounded and
 * it NEVER fails migrate: the role is already NOLOGIN-committed, so any survivor past the cap is
 * benign (it cannot re-authenticate). Idempotent/resumable — a crash before the sweep leaves
 * NOLOGIN committed (safe) and survivors are reaped on the next explicit deprovision run.
 *
 * ★ THE NEVER-FAIL CONTRACT IS ENFORCED, NOT MERELY DECLARED. `pg_terminate_backend` RAISES
 * `42501 insufficient_privilege` when the migrator can ALTER the role but is not a member of
 * `pg_signal_backend` (or of the target role) — the ordinary shape of a managed/production
 * migrator. Left uncaught, that exception escapes `applyPrivilegedRoleLifecycles` and
 * `migrate()`, so a run that had ALREADY committed the NOLOGIN would report failure and SKIP
 * every remaining schema migration. Session reaping is best-effort OPERATIONAL cleanup, never a
 * schema-migration success condition, so every failure of the signalling/counting layer is
 * caught, logged with a sanitized label and swallowed. The client stays usable afterwards: each
 * statement here runs in its own implicit transaction, so a failed one rolls back only itself.
 *
 * ★ SCOPE OF THE SWALLOW — deliberately narrow. Bootstrap, the role deprovision DDL itself,
 * signal validation and the migration SQL all keep propagating; only this post-commit reaping
 * layer is best-effort.
 *
 * `roleName` is a fixed in-repo constant, never caller/user input: it is interpolated into the
 * pg_stat_activity predicate as a literal, so it must stay a compile-time constant.
 */
export async function sweepRoleSessions(
  c: PoolClient,
  roleName: 'govai_evidence_enumerator' | 'govai_conversation_worker',
  log: (msg: string) => void,
): Promise<void> {
  const TERMINATE = `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE usename = '${roleName}' AND pid <> pg_backend_pid()`;
  const COUNT = `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE usename = '${roleName}' AND pid <> pg_backend_pid()`;
  const CAP = 3;
  for (let i = 0; i < CAP; i++) {
    let res: { rowCount: number | null };
    try {
      res = await c.query(TERMINATE);
    } catch (err) {
      log(
        `[deprovision] WARNING: could not signal ${roleName} session(s) (${errorLabel(err)}); ` +
          'the role is already NOLOGIN-committed, so no new authentication can succeed. ' +
          'Reap survivors by restarting the holder, or re-run deprovision from an identity with ' +
          'pg_signal_backend. Migration continues.',
      );
      return; // best-effort: a signalling failure is never a migration failure
    }
    if ((res.rowCount ?? 0) === 0) return; // no live sessions remain — clean
    // Let the SIGTERM'd backends exit before re-checking on the next iteration.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  let survivors: number;
  try {
    const rem = await c.query<{ n: number }>(COUNT);
    survivors = rem.rows[0]?.n ?? 0;
  } catch (err) {
    // The survivor COUNT must not contradict the same never-fail contract either.
    log(
      `[deprovision] WARNING: could not count surviving ${roleName} session(s) ` +
        `(${errorLabel(err)}); the role is NOLOGIN (no new authentication possible). ` +
        'Migration continues.',
    );
    return;
  }
  if (survivors > 0) {
    log(
      `[deprovision] WARNING: ${survivors} ${roleName} session(s) still present after ${CAP} sweeps; ` +
        'the role is NOLOGIN (no new authentication possible). Re-run deprovision or restart the API to reap them.',
    );
  }
}

/** Back-compat alias for the enumerator's sweep (see sweepRoleSessions). */
export async function sweepEnumeratorSessions(
  c: PoolClient,
  log: (msg: string) => void,
): Promise<void> {
  return sweepRoleSessions(c, 'govai_evidence_enumerator', log);
}

/**
 * EP-AI-CONVERSATION-CONTINUITY-V1 P0-A2 — the detached conversation worker's credential
 * signals. Same two-INDEPENDENT-signal shape as the enumerator's, and for the same reason:
 * an ABSENT password must never mean "deprovision", or a routine schema migration would
 * silently disable conversation recovery by omission.
 */
export type ConversationWorkerSignals = {
  /** GOVAI_DB_CONVERSATION_WORKER_PASSWORD → GUC govai.conversation_worker_password. */
  password?: string;
  /** GOVAI_DB_CONVERSATION_WORKER_DEPROVISION → GUC govai.conversation_worker_deprovision;
   *  the sole accepted "on" value is '1'. An EXPLICIT signal — no password sentinel. */
  deprovision?: string;
};

/**
 * Resolve the conversation worker's two lifecycle signals into exactly one mode, or throw LOUD
 * on a contradictory / invalid combination (cells 2 and 5). Pure — no side effects — so the
 * shared applier calls it BEFORE any bootstrap write, leaving the existing role state untouched.
 */
export function resolveConversationWorkerMode(signals: ConversationWorkerSignals): EnumeratorMode {
  const hasPassword = signals.password !== undefined && signals.password !== '';
  const rawDeprovision = signals.deprovision;
  const deprovisionSet = rawDeprovision !== undefined && rawDeprovision !== '';

  if (deprovisionSet && rawDeprovision !== '1') {
    // Cell 5: any deprovision value other than the sole accepted '1'.
    throw new Error(
      `GOVAI_DB_CONVERSATION_WORKER_DEPROVISION must be unset, empty, or '1' (got '${rawDeprovision}').`,
    );
  }
  if (hasPassword && deprovisionSet) {
    // Cell 2: provision and deprovision at once.
    throw new Error(
      'Conflicting conversation-worker lifecycle intent: GOVAI_DB_CONVERSATION_WORKER_PASSWORD ' +
        'and GOVAI_DB_CONVERSATION_WORKER_DEPROVISION=1 are both set. Provide exactly one.',
    );
  }
  if (deprovisionSet) return 'deprovision'; // Cell 4
  if (hasPassword) return 'provision'; // Cell 1 (bootstrap RAISEs if length < 8)
  return 'untouched'; // Cell 3 — a routine migration must not disable the worker by omission
};

/** Every privileged role whose LOGIN credential the bootstrap lifecycle manages. */
export type PrivilegedRoleSignals = {
  enumerator: EnumeratorSignals;
  conversationWorker: ConversationWorkerSignals;
};

/**
 * The shared realization of the five-way lifecycle for EVERY optional privileged role, called
 * IDENTICALLY by both migration runners (this file's `migrate` and tests/integration/setup.ts)
 * so the gating + the post-commit sweeps CANNOT drift between them (the load-bearing anti-drift
 * invariant). Bootstrap runs exactly ONCE, with every driving GUC already set:
 *   validate ALL signals (throws loud on cells 2/5, before any write)
 *   → set each role's driving GUC (provision: password; deprovision: the flag; untouched: none)
 *   → run bootstrap (the caller's single `c.query(bootstrap)`; COMMIT happens on its return)
 *   → for each role being deprovisioned, run the post-commit bounded session sweep.
 */
export async function applyPrivilegedRoleLifecycles(
  c: PoolClient,
  signals: PrivilegedRoleSignals,
  runBootstrap: () => Promise<void>,
  log: (msg: string) => void,
): Promise<void> {
  // Fail-loud BEFORE bootstrap (cells 2 and 5), for BOTH roles, so a contradictory signal on
  // either one leaves every role state untouched.
  const enumeratorMode = resolveEnumeratorMode(signals.enumerator);
  const workerMode = resolveConversationWorkerMode(signals.conversationWorker);

  if (enumeratorMode === 'provision') {
    await c.query(
      `SET govai.evidence_enumerator_password = '${signals.enumerator.password!.replace(/'/g, "''")}'`,
    );
  } else if (enumeratorMode === 'deprovision') {
    await c.query(`SET govai.evidence_enumerator_deprovision = '1'`);
  }
  if (workerMode === 'provision') {
    await c.query(
      `SET govai.conversation_worker_password = '${signals.conversationWorker.password!.replace(/'/g, "''")}'`,
    );
  } else if (workerMode === 'deprovision') {
    await c.query(`SET govai.conversation_worker_deprovision = '1'`);
  }
  // Cell 3 (untouched): set neither GUC — bootstrap leaves that role exactly as-is.
  await runBootstrap(); // COMMIT has happened server-side once this returns
  if (enumeratorMode === 'deprovision') {
    await sweepRoleSessions(c, 'govai_evidence_enumerator', log);
  }
  if (workerMode === 'deprovision') {
    await sweepRoleSessions(c, 'govai_conversation_worker', log);
  }
}

/**
 * Enumerator-only entry point, preserved for existing callers. It DELEGATES to the composed
 * applier above (there is exactly one implementation of the lifecycle — no second code path to
 * drift), passing an empty conversation-worker signal set, i.e. cell 3 / untouched.
 */
export async function applyEnumeratorLifecycle(
  c: PoolClient,
  signals: EnumeratorSignals,
  runBootstrap: () => Promise<void>,
  log: (msg: string) => void,
): Promise<void> {
  return applyPrivilegedRoleLifecycles(
    c,
    { enumerator: signals, conversationWorker: {} },
    runBootstrap,
    log,
  );
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
    await applyPrivilegedRoleLifecycles(
      c,
      {
        enumerator: { password: opts.enumeratorPassword, deprovision: opts.enumeratorDeprovision },
        conversationWorker: {
          password: opts.conversationWorkerPassword,
          deprovision: opts.conversationWorkerDeprovision,
        },
      },
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
  // Optional (EP-AI-CONVERSATION-CONTINUITY-V1 P0-A2), same five-way gating as above: the
  // detached conversation worker stays NOLOGIN-until-provisioned; absent signals leave it
  // exactly as-is. This manages the CREDENTIAL only — no worker process is started here.
  const conversationWorkerPassword = process.env['GOVAI_DB_CONVERSATION_WORKER_PASSWORD'];
  const conversationWorkerDeprovision = process.env['GOVAI_DB_CONVERSATION_WORKER_DEPROVISION'];
  if (!conn) {
    console.error('DATABASE_ADMIN_URL is required');
    process.exit(1);
  }
  if (!appPassword) {
    console.error('GOVAI_DB_APP_PASSWORD is required (>= 8 chars). See docs/runbooks/db-roles-production.md.');
    process.exit(1);
  }
  migrate({
    adminConnectionString: conn,
    appPassword,
    enumeratorPassword,
    enumeratorDeprovision,
    conversationWorkerPassword,
    conversationWorkerDeprovision,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
