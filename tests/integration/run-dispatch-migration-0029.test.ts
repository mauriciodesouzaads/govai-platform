// EP-P03A-A (F3) — T14: migration 0029 against a database WITH legacy rows.
//
// A dedicated container is migrated only through 0028, seeded with legacy runs
// in EVERY pre-F3 status plus a pre-existing DUPLICATE pair of run_event
// workroom turns, and only then 0029 is applied:
//   1. with the duplicate present → 0029 FAILS LOUD (no auto-merge/delete);
//   2. after removing one duplicate → 0029 succeeds;
//   3. legacy rows are byte-stable (status unchanged, protocol NULL) and the
//      v1 constraints accept/reject exactly the adjudicated combinations.
// The migration chain itself stays idempotent: 0029 is applied twice.
//
// RLS-M1..M9 (third container): the same guards under REALISTIC migrator
// identities — non-superuser logins that can SET ROLE govai_audit_writer —
// so a green result cannot come from the superuser's RLS bypass.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { applyEnumeratorLifecycle } from '../../apps/api/src/db/migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const BOOTSTRAP_PATH = join(ROOT, 'infra', 'postgres', 'bootstrap.sql');
const MIGRATIONS_DIR = join(ROOT, 'apps', 'api', 'src', 'db', 'migrations');

const LEGACY_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'denied',
  'awaiting_approval',
] as const;

let container: StartedPostgreSqlContainer;
let admin: Pool;
let sql0029: string;
const legacyRunIds = new Map<string, string>();
const ORG_ID = randomUUID();

async function applyMigrationsUpTo(pool: Pool, lastPrefix: string): Promise<void> {
  const c = await pool.connect();
  try {
    const appPassword = randomBytes(24).toString('hex');
    await c.query(`SET govai.app_password = '${appPassword}'`);
    const bootstrap = await readFile(BOOTSTRAP_PATH, 'utf8');
    await applyEnumeratorLifecycle(
      c,
      {},
      async () => {
        await c.query(bootstrap);
      },
      () => undefined,
    );
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql') && f.slice(0, 4) <= lastPrefix)
      .sort((a, b) => a.localeCompare(b));
    expect(files.at(-1)!.startsWith(lastPrefix)).toBe(true);
    for (const f of files) {
      await c.query(await readFile(join(MIGRATIONS_DIR, f), 'utf8'));
    }
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('govai')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();
  admin = new Pool({ connectionString: container.getConnectionUri() });
  admin.on('error', () => undefined);
  await applyMigrationsUpTo(admin, '0028');
  sql0029 = await readFile(join(MIGRATIONS_DIR, '0029_durable_provider_dispatch.sql'), 'utf8');

  // Legacy seed (superuser bypasses RLS): one run per pre-F3 status.
  await admin.query(`INSERT INTO govai.orgs (id, name) VALUES ($1::uuid, 'legacy-org')`, [ORG_ID]);
  for (const status of LEGACY_STATUSES) {
    const id = randomUUID();
    legacyRunIds.set(status, id);
    await admin.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          started_at, completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'legacy-model', 'governed',
          $5::text, '{}'::jsonb,
          CASE WHEN $5::text IN ('running','completed','failed') THEN now() ELSE NULL END,
          CASE WHEN $5::text IN ('completed','failed','denied') THEN now() ELSE NULL END)`,
      [id, ORG_ID, randomUUID(), randomUUID(), status],
    );
  }

  // Pre-existing DUPLICATE run_event turns for one run_id. FK enforcement is
  // suspended for the seed only (session_replication_role) — the migration
  // must still detect the duplicate through plain SQL.
  const dupRunId = randomUUID();
  await admin.query(`SET session_replication_role = replica`);
  for (let i = 0; i < 2; i += 1) {
    await admin.query(
      `INSERT INTO govai.workroom_turns
         (id, org_id, workroom_id, turn_number, kind, audit_event_id, payload_ref)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, 'run_event', $5::uuid, $6::uuid)`,
      [randomUUID(), ORG_ID, randomUUID(), i + 1, randomUUID(), dupRunId],
    );
  }
  await admin.query(`SET session_replication_role = origin`);
}, 240_000);

afterAll(async () => {
  await admin?.end().catch(() => undefined);
  await container?.stop().catch(() => undefined);
});

describe('T14 — migration 0029 with legacy rows', () => {
  it('fails LOUD while duplicate run_event turns exist, without deleting anything', async () => {
    await expect(admin.query(sql0029)).rejects.toThrow(/duplicate run_event/);
    const turns = await admin.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM govai.workroom_turns WHERE kind = 'run_event'",
    );
    expect(Number(turns.rows[0]!.n)).toBe(2); // nothing merged, nothing dropped
  });

  it('succeeds after the operator resolves the duplicate — and is idempotent', async () => {
    // Operator maintenance path: the append-only trigger guards runtime writes;
    // the manual fix runs with triggers suspended, exactly like the seed did.
    await admin.query(`SET session_replication_role = replica`);
    try {
      await admin.query(
        `DELETE FROM govai.workroom_turns
          WHERE ctid IN (
            SELECT ctid FROM govai.workroom_turns
             WHERE kind = 'run_event' ORDER BY turn_number DESC LIMIT 1)`,
      );
    } finally {
      await admin.query(`SET session_replication_role = origin`);
    }
    await admin.query(sql0029);
    await admin.query(sql0029); // idempotent re-run (bootstrap-idempotent contract)

    // M1 — the boundary-aware schema landed: column present, matrix constraint
    // present AND fully validated (never left NOT VALID).
    const col = await admin.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'govai' AND table_name = 'runs'
          AND column_name = 'dispatch_boundary_committed_at'`,
    );
    expect(col.rowCount).toBe(1);
    const con = await admin.query<{ convalidated: boolean }>(
      `SELECT convalidated FROM pg_constraint
        WHERE conrelid = 'govai.runs'::regclass AND conname = 'runs_dispatch_v1_state_check'`,
    );
    expect(con.rowCount).toBe(1);
    expect(con.rows[0]!.convalidated).toBe(true);
  });

  it('legacy rows are untouched: same status, dispatch_protocol_version NULL', async () => {
    for (const [status, id] of legacyRunIds) {
      const r = await admin.query<{
        status: string;
        dispatch_protocol_version: number | null;
        dispatch_token: string | null;
        outcome_unknown_at: Date | null;
      }>(
        `SELECT status, dispatch_protocol_version, dispatch_token, outcome_unknown_at
           FROM govai.runs WHERE id = $1::uuid`,
        [id],
      );
      expect(r.rows[0]!.status).toBe(status);
      expect(r.rows[0]!.dispatch_protocol_version).toBeNull();
      expect(r.rows[0]!.dispatch_token).toBeNull();
      expect(r.rows[0]!.outcome_unknown_at).toBeNull();
    }
  });

  it('admits outcome_unknown ONLY in a consistent v1 shape (boundary REQUIRED)', async () => {
    const ok = await admin.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
          dispatch_timeout_ms, dispatch_deadline_at, started_at, outcome_unknown_at,
          dispatch_error_class, dispatch_boundary_committed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed',
          'outcome_unknown', '{}'::jsonb, 1, now(), $5::uuid, now(), 60000,
          now() + interval '60 seconds', now(), now(), 'provider_timeout', now())
       RETURNING id`,
      [randomUUID(), ORG_ID, randomUUID(), randomUUID(), randomUUID()],
    );
    expect(ok.rowCount).toBe(1);

    // outcome_unknown WITHOUT protocol v1 → rejected by the state matrix.
    await expect(
      admin.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed',
            'outcome_unknown', '{}'::jsonb)`,
        [randomUUID(), ORG_ID, randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/runs_dispatch_v1_state_check|check constraint/);

    // A fully dispatch-SHAPED row with dispatch_protocol_version NULL →
    // rejected: the v1 arm requires protocol = 1, so a protocol-NULL row is
    // judged by the LEGACY arm (which forbids outcome_unknown and a boundary)
    // instead of slipping through the v1 arm while invisible to v1 recovery
    // discovery (Codex P2 on 3774a79).
    await expect(
      admin.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
            dispatch_timeout_ms, dispatch_deadline_at, started_at, outcome_unknown_at,
            dispatch_error_class, dispatch_boundary_committed_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed',
            'outcome_unknown', '{}'::jsonb, now(), $5::uuid, now(), 60000,
            now() + interval '60 seconds', now(), now(), 'provider_timeout', now())`,
        [randomUUID(), ORG_ID, randomUUID(), randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/runs_dispatch_v1_state_check/);

    // outcome_unknown WITHOUT a committed boundary → rejected: a boundary-null
    // stale claim is the KNOWN failure dispatch_never_started, never unknown.
    await expect(
      admin.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
            dispatch_timeout_ms, dispatch_deadline_at, started_at, outcome_unknown_at,
            dispatch_error_class)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed',
            'outcome_unknown', '{}'::jsonb, 1, now(), $5::uuid, now(), 60000,
            now() + interval '60 seconds', now(), now(), 'stale_dispatch_claim')`,
        [randomUUID(), ORG_ID, randomUUID(), randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/runs_dispatch_v1_state_check/);
  });

  it('boundary-aware matrix: completed requires a boundary; a boundary implies the claim quadruple; legacy rows never carry one', async () => {
    // v1 completed WITHOUT a boundary → invalid (a 2xx implies the gate).
    await expect(
      admin.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
            dispatch_timeout_ms, dispatch_deadline_at, started_at, completed_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'completed',
            '{}'::jsonb, 1, now(), $5::uuid, now(), 60000, now() + interval '60 seconds', now(), now())`,
        [randomUUID(), ORG_ID, randomUUID(), randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/runs_dispatch_v1_state_check/);

    // A boundary on a queued row (no token) → invalid (boundary ⇒ claim).
    await expect(
      admin.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            dispatch_protocol_version, dispatch_prepared_at, dispatch_boundary_committed_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'queued',
            '{}'::jsonb, 1, now(), now())`,
        [randomUUID(), ORG_ID, randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/runs_dispatch_v1_state_check/);

    // A boundary on a LEGACY row (protocol NULL) → invalid.
    await expect(
      admin.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            dispatch_boundary_committed_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'queued',
            '{}'::jsonb, now())`,
        [randomUUID(), ORG_ID, randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/runs_dispatch_v1_state_check/);

    // v1 running with a committed boundary (gate crossed, outcome pending) → VALID.
    const running = await admin.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
          dispatch_timeout_ms, dispatch_deadline_at, started_at, dispatch_boundary_committed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'running',
          '{}'::jsonb, 1, now(), $5::uuid, now(), 60000, now() + interval '60 seconds', now(), now())
       RETURNING id`,
      [randomUUID(), ORG_ID, randomUUID(), randomUUID(), randomUUID()],
    );
    expect(running.rowCount).toBe(1);

    // v1 failed post-claim with a boundary (known post-boundary failure) → VALID.
    const failedPost = await admin.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
          dispatch_timeout_ms, dispatch_deadline_at, started_at, completed_at,
          dispatch_error_class, dispatch_boundary_committed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'failed',
          '{}'::jsonb, 1, now(), $5::uuid, now(), 60000, now() + interval '60 seconds', now(), now(),
          'dispatch_pre_forward_failed', now())
       RETURNING id`,
      [randomUUID(), ORG_ID, randomUUID(), randomUUID(), randomUUID()],
    );
    expect(failedPost.rowCount).toBe(1);

    // v1 failed post-claim WITHOUT a boundary (dispatch_never_started /
    // dispatch_boundary_persist_failed) → VALID too.
    const failedNoBoundary = await admin.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
          dispatch_timeout_ms, dispatch_deadline_at, started_at, completed_at, dispatch_error_class)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'failed',
          '{}'::jsonb, 1, now(), $5::uuid, now(), 60000, now() + interval '60 seconds', now(), now(),
          'dispatch_never_started')
       RETURNING id`,
      [randomUUID(), ORG_ID, randomUUID(), randomUUID(), randomUUID()],
    );
    expect(failedNoBoundary.rowCount).toBe(1);
  });

  it('rejects the adjudicated-invalid v1 combinations', async () => {
    // v1 queued with a token → invalid.
    await expect(
      admin.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            dispatch_protocol_version, dispatch_prepared_at, dispatch_token)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'queued',
            '{}'::jsonb, 1, now(), $5::uuid)`,
        [randomUUID(), ORG_ID, randomUUID(), randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/runs_dispatch_v1_state_check/);

    // v1 running without a deadline → invalid.
    await expect(
      admin.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
            started_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'running',
            '{}'::jsonb, 1, now(), $5::uuid, now(), now())`,
        [randomUUID(), ORG_ID, randomUUID(), randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/runs_dispatch_v1_state_check/);

    // protocol version other than 1 → invalid.
    await expect(
      admin.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            dispatch_protocol_version, dispatch_prepared_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'queued',
            '{}'::jsonb, 2, now())`,
        [randomUUID(), ORG_ID, randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/runs_dispatch_protocol_version_check/);

    // dispatch_timeout_ms outside [1000, 900000] → invalid.
    await expect(
      admin.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            dispatch_timeout_ms)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'queued',
            '{}'::jsonb, 999)`,
        [randomUUID(), ORG_ID, randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/runs_dispatch_timeout_ms_check/);
  });

  it('enforces dispatch_token uniqueness and (run, token) invocation uniqueness', async () => {
    const token = randomUUID();
    const mkRun = async (): Promise<string> => {
      const id = randomUUID();
      await admin.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
            dispatch_timeout_ms, dispatch_deadline_at, started_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'running',
            '{}'::jsonb, 1, now(), $5::uuid, now(), 60000, now() + interval '60 seconds', now())`,
        [id, ORG_ID, randomUUID(), randomUUID(), token],
      );
      return id;
    };
    const runId = await mkRun();
    // Same token on a SECOND run → runs_dispatch_token_uniq.
    await expect(mkRun()).rejects.toThrow(/runs_dispatch_token_uniq/);

    const insertInvocation = () =>
      admin.query(
        `INSERT INTO govai.provider_invocations
           (id, run_id, org_id, provider, native_endpoint, native_method, native_request_hash,
            streaming, usage_json, dispatch_token)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', '/v1/messages', 'POST',
            '\\x00'::bytea, false, '{}'::jsonb, $4::uuid)`,
        [randomUUID(), runId, ORG_ID, token],
      );
    await insertInvocation();
    await expect(insertInvocation()).rejects.toThrow(
      /provider_invocations_run_dispatch_token_uniq/,
    );
  });

  it('enforces at most one run_event turn per run (partial unique index)', async () => {
    const runRef = randomUUID();
    await admin.query(`SET session_replication_role = replica`);
    try {
      const insertTurn = (n: number) =>
        admin.query(
          `INSERT INTO govai.workroom_turns
             (id, org_id, workroom_id, turn_number, kind, audit_event_id, payload_ref)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, 'run_event', $5::uuid, $6::uuid)`,
          [randomUUID(), ORG_ID, randomUUID(), 100 + n, randomUUID(), runRef],
        );
      await insertTurn(1);
      await expect(insertTurn(2)).rejects.toThrow(/workroom_turns_run_event_payload_ref_uniq/);
    } finally {
      await admin.query(`SET session_replication_role = origin`);
    }
  });

  it('recovery discovery function exists, is EXECUTE-gated, and validates bounds', async () => {
    const r = await admin.query(
      `SELECT org_id, run_id, reason FROM govai.run_dispatch_recovery_candidates(60000, 30000, 50)`,
    );
    expect(Array.isArray(r.rows)).toBe(true);
    await expect(
      admin.query(`SELECT * FROM govai.run_dispatch_recovery_candidates(1, 30000, 50)`),
    ).rejects.toThrow(/out of bounds/);
    await expect(
      admin.query(`SELECT * FROM govai.run_dispatch_recovery_candidates(60000, 30000, 0)`),
    ).rejects.toThrow(/out of bounds/);
    const grants = await admin.query<{ grantee: string }>(
      `SELECT grantee::text FROM information_schema.routine_privileges
        WHERE routine_schema = 'govai' AND routine_name = 'run_dispatch_recovery_candidates'
          AND privilege_type = 'EXECUTE'`,
    );
    const grantees = grants.rows.map((g) => g.grantee);
    expect(grantees).toContain('govai_app');
    expect(grantees).not.toContain('PUBLIC');
  });

  // ===========================================================================
  // M5 — boundary-aware rerun with valid boundary-aware v1 rows present:
  // idempotent success, no duplicate artifacts, no row mutation.
  // ===========================================================================
  it('M5 — rerun over valid boundary-aware rows is idempotent and mutates nothing', async () => {
    const before = await admin.query<{ snapshot: string }>(
      `SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)::text AS snapshot FROM govai.runs r`,
    );
    await admin.query(sql0029);
    const after = await admin.query<{ snapshot: string }>(
      `SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)::text AS snapshot FROM govai.runs r`,
    );
    expect(after.rows[0]!.snapshot).toBe(before.rows[0]!.snapshot);
    const cons = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_constraint
        WHERE conrelid = 'govai.runs'::regclass AND conname = 'runs_dispatch_v1_state_check'`,
    );
    expect(Number(cons.rows[0]!.n)).toBe(1); // no duplicate constraint artifacts
  });

  // ===========================================================================
  // M6 — boundary-aware schema whose ROWS are incompatible with the final
  // matrix (constructible only by dropping the constraint — operator
  // simulation): the compatibility audit fails with a COUNT ONLY, before the
  // constraint is re-added, and the constraint is never falsely reported
  // valid. No semantic mutation on the failure path.
  // ===========================================================================
  it('M6 — invalid boundary-aware rows: count-only audit failure, no mutation, constraint not falsely valid', async () => {
    await admin.query(
      `ALTER TABLE govai.runs DROP CONSTRAINT runs_dispatch_v1_state_check`,
    );
    const badId = randomUUID();
    // completed v1 WITHOUT a boundary — invalid under the final matrix.
    await admin.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
          dispatch_timeout_ms, dispatch_deadline_at, started_at, completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'completed',
          '{}'::jsonb, 1, now(), $5::uuid, now(), 60000, now() + interval '60 seconds', now(), now())`,
      [badId, ORG_ID, randomUUID(), randomUUID(), randomUUID()],
    );
    const before = await admin.query(`SELECT to_jsonb(r) AS row FROM govai.runs r WHERE id = $1::uuid`, [badId]);

    const err = await admin.query(sql0029).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/incompatible with the boundary-aware v1 state matrix/);
    expect(err!.message).toMatch(/1 run row/);
    expect(err!.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // no ids leaked

    // No mutation; the constraint was NOT re-added (never falsely valid) —
    // the whole file runs as one implicit transaction, and the audit fires
    // before the ADD CONSTRAINT statement regardless.
    const after = await admin.query(`SELECT to_jsonb(r) AS row FROM govai.runs r WHERE id = $1::uuid`, [badId]);
    expect(JSON.stringify(after.rows[0])).toBe(JSON.stringify(before.rows[0]));
    const cons = await admin.query(
      `SELECT convalidated FROM pg_constraint
        WHERE conrelid = 'govai.runs'::regclass AND conname = 'runs_dispatch_v1_state_check'`,
    );
    expect(cons.rowCount).toBe(0);

    // Operator resolves (deletes the impossible row) → the migration heals and
    // the constraint returns fully validated.
    await admin.query(`DELETE FROM govai.runs WHERE id = $1::uuid`, [badId]);
    await admin.query(sql0029);
    const healed = await admin.query<{ convalidated: boolean }>(
      `SELECT convalidated FROM pg_constraint
        WHERE conrelid = 'govai.runs'::regclass AND conname = 'runs_dispatch_v1_state_check'`,
    );
    expect(healed.rowCount).toBe(1);
    expect(healed.rows[0]!.convalidated).toBe(true);
  });

  // ===========================================================================
  // M7 — the migration text performs no automatic database destruction: the
  // static guarantee backing the dynamic byte-stability proofs above/below.
  // ===========================================================================
  it('M7 — no automatic DROP DATABASE / DROP SCHEMA / TRUNCATE / protocol-row DELETE in 0029', () => {
    const sql = sql0029.toUpperCase();
    expect(sql).not.toContain('DROP DATABASE');
    expect(sql).not.toContain('DROP SCHEMA');
    expect(sql).not.toContain('TRUNCATE');
    expect(sql).not.toMatch(/DELETE\s+FROM\s+GOVAI\.(RUNS|PROVIDER_INVOCATIONS|AUDIT_EVENTS|WORKROOM_TURNS)/);
  });
});

// =============================================================================
// M2/M3/M4 — pre-boundary → boundary-aware upgrade simulation on a DEDICATED
// container. The pre-boundary state is constructed deterministically per the
// permitted strategy: apply the revised migration, then remove ONLY the
// boundary-specific column + constraint and re-install the PRE-BOUNDARY
// constraint (embedded verbatim below), preserving every other 0029 artifact.
// =============================================================================

const PRE_BOUNDARY_V1_CONSTRAINT = `
ALTER TABLE govai.runs
  ADD CONSTRAINT runs_dispatch_v1_state_check
  CHECK (
    (dispatch_protocol_version IS NULL AND status <> 'outcome_unknown')
    OR (
      dispatch_prepared_at IS NOT NULL
      AND (
        (status = 'queued'
          AND dispatch_token IS NULL AND dispatch_claimed_at IS NULL
          AND dispatch_deadline_at IS NULL AND started_at IS NULL
          AND completed_at IS NULL AND outcome_unknown_at IS NULL)
        OR (status = 'running'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND dispatch_timeout_ms IS NOT NULL
          AND started_at IS NOT NULL AND completed_at IS NULL
          AND outcome_unknown_at IS NULL)
        OR (status = 'completed'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND completed_at IS NOT NULL)
        OR (status = 'outcome_unknown'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND outcome_unknown_at IS NOT NULL
          AND completed_at IS NULL AND dispatch_error_class IS NOT NULL)
        OR (status = 'failed'
          AND dispatch_token IS NULL AND dispatch_claimed_at IS NULL
          AND dispatch_deadline_at IS NULL AND completed_at IS NOT NULL
          AND dispatch_error_class IS NOT NULL)
        OR (status = 'failed'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND completed_at IS NOT NULL)
        OR (status = 'denied'
          AND dispatch_token IS NOT NULL AND dispatch_claimed_at IS NOT NULL
          AND dispatch_deadline_at IS NOT NULL AND completed_at IS NOT NULL)
      )
    )
  )`;

describe('M2/M3/M4 — pre-boundary schema upgrade compatibility', () => {
  let container2: StartedPostgreSqlContainer;
  let admin2: Pool;
  const ORG2 = randomUUID();

  async function simulatePreBoundarySchema(): Promise<void> {
    await admin2.query(`ALTER TABLE govai.runs DROP CONSTRAINT runs_dispatch_v1_state_check`);
    await admin2.query(`ALTER TABLE govai.runs DROP COLUMN dispatch_boundary_committed_at`);
    await admin2.query(PRE_BOUNDARY_V1_CONSTRAINT);
  }

  async function boundaryColumnExists(): Promise<boolean> {
    const r = await admin2.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'govai' AND table_name = 'runs'
          AND column_name = 'dispatch_boundary_committed_at'`,
    );
    return (r.rowCount ?? 0) === 1;
  }

  beforeAll(async () => {
    container2 = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('govai')
      .withUsername('postgres')
      .withPassword('postgres')
      .start();
    admin2 = new Pool({ connectionString: container2.getConnectionUri() });
    admin2.on('error', () => undefined);
    await applyMigrationsUpTo(admin2, '0029'); // fresh, fully boundary-aware
    await admin2.query(`INSERT INTO govai.orgs (id, name) VALUES ($1::uuid, 'preboundary-org')`, [
      ORG2,
    ]);
  }, 240_000);

  afterAll(async () => {
    await admin2?.end().catch(() => undefined);
    await container2?.stop().catch(() => undefined);
  });

  it('M2 — pre-boundary schema with ZERO protocol-v1 rows upgrades in place', async () => {
    await simulatePreBoundarySchema();
    expect(await boundaryColumnExists()).toBe(false);

    await admin2.query(sql0029); // the revised migration performs the upgrade

    expect(await boundaryColumnExists()).toBe(true);
    const con = await admin2.query<{ convalidated: boolean }>(
      `SELECT convalidated FROM pg_constraint
        WHERE conrelid = 'govai.runs'::regclass AND conname = 'runs_dispatch_v1_state_check'`,
    );
    expect(con.rowCount).toBe(1);
    expect(con.rows[0]!.convalidated).toBe(true);
    // The upgraded matrix is the boundary-aware one: unknown w/o boundary rejects.
    await expect(
      admin2.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
            dispatch_timeout_ms, dispatch_deadline_at, started_at, outcome_unknown_at,
            dispatch_error_class)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed',
            'outcome_unknown', '{}'::jsonb, 1, now(), $5::uuid, now(), 60000,
            now() + interval '60 seconds', now(), now(), 'stale_dispatch_claim')`,
        [randomUUID(), ORG2, randomUUID(), randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/runs_dispatch_v1_state_check/);
  });

  it('M3+M4 — pre-boundary schema WITH protocol-v1 rows fails LOUD before any schema mutation; rows byte-stable', async () => {
    await simulatePreBoundarySchema();
    expect(await boundaryColumnExists()).toBe(false);

    // A pre-boundary v1 row, valid under the PREVIOUS schema (completed,
    // claim quadruple, no boundary column at all).
    const v1Id = randomUUID();
    await admin2.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
          dispatch_timeout_ms, dispatch_deadline_at, started_at, completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'completed',
          '{}'::jsonb, 1, now(), $5::uuid, now(), 60000, now() + interval '60 seconds', now(), now())`,
      [v1Id, ORG2, randomUUID(), randomUUID(), randomUUID()],
    );
    const before = await admin2.query(
      `SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)::text AS snapshot FROM govai.runs r`,
    );
    const eventsBefore = await admin2.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.audit_events`,
    );
    const invBefore = await admin2.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.provider_invocations`,
    );

    // M3 — the boundary upgrade is BLOCKED, loudly, count-only.
    const err = await admin2.query(sql0029).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/migration 0029 boundary upgrade blocked: 1 protocol-v1 run/);
    expect(err!.message).toMatch(/No backfill, deletion or status mutation was performed/);
    expect(err!.message).toMatch(/explicitly disposable/);
    expect(err!.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/); // no ids

    // The failure happened BEFORE any boundary schema mutation.
    expect(await boundaryColumnExists()).toBe(false);

    // M4 — byte stability: rows, statuses, timestamps, events, invocations.
    const after = await admin2.query(
      `SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)::text AS snapshot FROM govai.runs r`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    const eventsAfter = await admin2.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.audit_events`,
    );
    const invAfter = await admin2.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.provider_invocations`,
    );
    expect(eventsAfter.rows[0]!.n).toBe(eventsBefore.rows[0]!.n);
    expect(invAfter.rows[0]!.n).toBe(invBefore.rows[0]!.n);

    // A second attempt fails identically (no creeping mutation between runs).
    const err2 = await admin2.query(sql0029).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err2!.message).toMatch(/boundary upgrade blocked: 1 protocol-v1 run/);
    expect(await boundaryColumnExists()).toBe(false);
  });
});

// =============================================================================
// RLS-M1..M9 — the 0029 guards under REALISTIC migrator identities.
//
// Production's documented migrator contract (bootstrap.sql) is "a role that can
// SET ROLE govai_audit_writer" — NOT necessarily a superuser. govai.runs is
// FORCE RLS with org-scoped policies, so before the owner-window fix the M-B
// count under such an identity was silently RLS-filtered: a pre-boundary v1
// row invisible to the runner was ADOPTED without the guard firing (and the
// NOINHERIT variant could not run 0029 at all — 42501 even on a fresh
// database). Every test here connects as a real non-superuser role with real
// RLS and real FORCE, proving the guard's property rather than the test
// environment's bypass.
// =============================================================================

describe('RLS-M1..M9 — 0029 guards under realistic migrator identities', () => {
  let container3: StartedPostgreSqlContainer;
  let admin3: Pool; // superuser control identity
  let minMigrator: Pool; // LOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT, member-with-SET of writer
  let inhMigrator: Pool; // same but INHERIT (the shape of a provider-managed admin login)
  let outsider: Pool; // LOGIN, NOSUPERUSER, NOBYPASSRLS, NOT a member of the writer
  let appUser: Pool; // govai_app tenant runtime role
  const ORG_A = randomUUID();
  const ORG_B = randomUUID();
  const ROLE_PW = 'rls-proof-role-pw';
  const M2_STATE = { before: '' };

  const poolFor = (user: string): Pool =>
    new Pool({
      host: container3.getHost(),
      port: container3.getPort(),
      database: container3.getDatabase(),
      user,
      password: ROLE_PW,
      max: 1,
    });

  async function toPreBoundary(): Promise<void> {
    await admin3.query(`ALTER TABLE govai.runs DROP CONSTRAINT runs_dispatch_v1_state_check`);
    await admin3.query(`ALTER TABLE govai.runs DROP COLUMN dispatch_boundary_committed_at`);
    await admin3.query(PRE_BOUNDARY_V1_CONSTRAINT);
  }

  async function boundaryColumnExists3(): Promise<boolean> {
    const r = await admin3.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'govai' AND table_name = 'runs'
          AND column_name = 'dispatch_boundary_committed_at'`,
    );
    return (r.rowCount ?? 0) === 1;
  }

  async function rlsPosture(): Promise<{ rls: boolean; force: boolean; owner: string }> {
    const r = await admin3.query<{ rls: boolean; force: boolean; owner: string }>(
      `SELECT relrowsecurity AS rls, relforcerowsecurity AS force,
              pg_get_userbyid(relowner) AS owner
         FROM pg_class WHERE oid = 'govai.runs'::regclass`,
    );
    return r.rows[0]!;
  }

  async function seedV1FailedPostClaim(orgId: string): Promise<string> {
    const id = randomUUID();
    // Provider-KNOWN error class: under boundary-aware semantics a silent
    // adoption of this row (boundary NULL) would falsely read as "the final
    // local gate was never crossed" — the forensic over-claim this guard
    // exists to block.
    await admin3.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
          dispatch_timeout_ms, dispatch_deadline_at, started_at, completed_at, dispatch_error_class)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'failed',
          '{}'::jsonb, 1, now(), $5::uuid, now(), 60000, now() + interval '60 seconds', now(), now(),
          'provider_http_500')`,
      [id, orgId, randomUUID(), randomUUID(), randomUUID()],
    );
    return id;
  }

  async function seedV1Running(orgId: string): Promise<string> {
    const id = randomUUID();
    await admin3.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
          dispatch_timeout_ms, dispatch_deadline_at, started_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'running',
          '{}'::jsonb, 1, now(), $5::uuid, now(), 60000, now() + interval '60 seconds', now())`,
      [id, orgId, randomUUID(), randomUUID(), randomUUID()],
    );
    return id;
  }

  const runsSnapshot = async (): Promise<string> =>
    (
      await admin3.query<{ snapshot: string | null }>(
        `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text, '[]') AS snapshot FROM govai.runs r`,
      )
    ).rows[0]!.snapshot!;

  const migrateAs = (pool: Pool): Promise<Error | null> =>
    pool.query(sql0029).then(
      () => null,
      (e: unknown) => e as Error,
    );

  beforeAll(async () => {
    container3 = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('govai')
      .withUsername('postgres')
      .withPassword('postgres')
      .start();
    admin3 = new Pool({ connectionString: container3.getConnectionUri(), max: 2 });
    admin3.on('error', () => undefined);
    await applyMigrationsUpTo(admin3, '0029'); // fresh, fully boundary-aware
    await admin3.query(`INSERT INTO govai.orgs (id, name) VALUES ($1::uuid, 'org-a'), ($2::uuid, 'org-b')`, [
      ORG_A,
      ORG_B,
    ]);
    // Real managed-migrator roles (per pg_roles proof below). PG16 grant-level
    // INHERIT options are set explicitly so each variant is deterministic.
    await admin3.query(`CREATE ROLE govai_migrator_min LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOBYPASSRLS NOINHERIT`);
    await admin3.query(`CREATE ROLE govai_migrator_inh LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOBYPASSRLS INHERIT`);
    await admin3.query(`CREATE ROLE govai_outsider LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOBYPASSRLS NOINHERIT`);
    await admin3.query(`GRANT govai_audit_writer TO govai_migrator_min WITH INHERIT FALSE, SET TRUE`);
    await admin3.query(`GRANT govai_audit_writer TO govai_migrator_inh WITH INHERIT TRUE, SET TRUE`);
    // Known tenant password for the C4-parity probe (operator ALTER, no bootstrap rerun).
    await admin3.query(`ALTER ROLE govai_app WITH LOGIN PASSWORD '${ROLE_PW}'`);
    minMigrator = poolFor('govai_migrator_min');
    inhMigrator = poolFor('govai_migrator_inh');
    outsider = poolFor('govai_outsider');
    appUser = poolFor('govai_app');
    for (const p of [minMigrator, inhMigrator, outsider, appUser]) p.on('error', () => undefined);
  }, 240_000);

  afterAll(async () => {
    for (const p of [minMigrator, inhMigrator, outsider, appUser, admin3]) {
      await p?.end().catch(() => undefined);
    }
    await container3?.stop().catch(() => undefined);
  });

  it('RLS-M0 — the tested identities are REAL: non-superuser, no BYPASSRLS, correct inheritance', async () => {
    const roles = await admin3.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolinherit: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls, rolinherit FROM pg_roles
        WHERE rolname IN ('govai_migrator_min','govai_migrator_inh','govai_outsider') ORDER BY rolname`,
    );
    expect(roles.rows).toEqual([
      { rolname: 'govai_migrator_inh', rolsuper: false, rolbypassrls: false, rolinherit: true },
      { rolname: 'govai_migrator_min', rolsuper: false, rolbypassrls: false, rolinherit: false },
      { rolname: 'govai_outsider', rolsuper: false, rolbypassrls: false, rolinherit: false },
    ]);
    const guc = await minMigrator.query<{ unset: boolean }>(
      `SELECT current_setting('app.org_id', true) IS NULL AS unset`,
    );
    expect(guc.rows[0]!.unset).toBe(true);
  });

  it('RLS-M1 — minimal NOINHERIT migrator upgrades a pre-boundary db with ZERO v1 rows (previously: 42501 even on empty)', async () => {
    await toPreBoundary();
    expect(await boundaryColumnExists3()).toBe(false);
    const err = await migrateAs(minMigrator);
    expect(err).toBeNull();
    expect(await boundaryColumnExists3()).toBe(true);
    const con = await admin3.query<{ convalidated: boolean }>(
      `SELECT convalidated FROM pg_constraint
        WHERE conrelid = 'govai.runs'::regclass AND conname = 'runs_dispatch_v1_state_check'`,
    );
    expect(con.rowCount).toBe(1);
    expect(con.rows[0]!.convalidated).toBe(true);
    expect(await rlsPosture()).toEqual({ rls: true, force: true, owner: 'govai_audit_writer' });
  });

  it('RLS-M2 — one HIDDEN pre-boundary v1 row blocks the INHERIT migrator with a count-only failure (previously: silent adoption)', async () => {
    await toPreBoundary();
    await seedV1FailedPostClaim(ORG_B); // invisible to org-scoped/recovery policies: failed is not queued/running
    M2_STATE.before = await runsSnapshot();
    const err = await migrateAs(inhMigrator);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/migration 0029 boundary upgrade blocked: 1 protocol-v1 run/);
    expect(err!.message).toMatch(/No backfill, deletion or status mutation was performed/);
    expect(err!.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // no identifiers leaked
  });

  it('RLS-M3 — the failed attempt was ATOMIC: rows byte-stable, schema untouched, RLS posture intact', async () => {
    expect(await runsSnapshot()).toBe(M2_STATE.before);
    expect(await boundaryColumnExists3()).toBe(false);
    const preCon = await admin3.query<{ convalidated: boolean }>(
      `SELECT convalidated FROM pg_constraint
        WHERE conrelid = 'govai.runs'::regclass AND conname = 'runs_dispatch_v1_state_check'`,
    );
    expect(preCon.rowCount).toBe(1); // the PRE-boundary constraint, still in place
    expect(preCon.rows[0]!.convalidated).toBe(true);
    expect(await rlsPosture()).toEqual({ rls: true, force: true, owner: 'govai_audit_writer' });
  });

  it('RLS-M4 — cross-org truth: rows in TWO orgs are ALL counted (previously: silent undercount)', async () => {
    await seedV1Running(ORG_A); // second row, different org, different status class
    const err = await migrateAs(inhMigrator);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/boundary upgrade blocked: 2 protocol-v1 run/);
  });

  it('RLS-M9 — the load-bearing forensic status: a pre-boundary RUNNING row blocks the upgrade (no dispatch_never_started over-claim)', async () => {
    await admin3.query(`DELETE FROM govai.runs WHERE dispatch_protocol_version = 1`); // operator adjudication
    await seedV1Running(ORG_A);
    const err = await migrateAs(minMigrator);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/boundary upgrade blocked: 1 protocol-v1 run/);
    expect(await boundaryColumnExists3()).toBe(false);
  });

  it('RLS-M6 — semantic parity: superuser and both managed migrators produce the same count, decision and data outcome', async () => {
    const before = await runsSnapshot();
    const results = await Promise.all([migrateAs(admin3), migrateAs(inhMigrator), migrateAs(minMigrator)]);
    const counts = results.map((e) => {
      expect(e).not.toBeNull();
      const m = /boundary upgrade blocked: (\d+) protocol-v1 run/.exec(e!.message);
      expect(m).not.toBeNull();
      return m![1];
    });
    expect(counts).toEqual(['1', '1', '1']);
    expect(await runsSnapshot()).toBe(before);
    expect(await boundaryColumnExists3()).toBe(false);
  });

  it('RLS-M5 — D0 stays a diagnostic: a row hidden from the runner is still rejected by the role-independent ADD CONSTRAINT backstop, atomically', async () => {
    await admin3.query(`DELETE FROM govai.runs WHERE dispatch_protocol_version = 1`);
    expect(await migrateAs(minMigrator)).toBeNull(); // heal back to boundary-aware
    // Operator simulation (M6 shape): constraint dropped, an invalid hidden row inserted.
    await admin3.query(`ALTER TABLE govai.runs DROP CONSTRAINT runs_dispatch_v1_state_check`);
    const badId = randomUUID();
    await admin3.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
          dispatch_timeout_ms, dispatch_deadline_at, started_at, completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'completed',
          '{}'::jsonb, 1, now(), $5::uuid, now(), 60000, now() + interval '60 seconds', now(), now())`,
      [badId, ORG_B, randomUUID(), randomUUID(), randomUUID()],
    );
    const before = await admin3.query(`SELECT to_jsonb(r) AS row FROM govai.runs r WHERE id = $1::uuid`, [badId]);
    const err = await migrateAs(inhMigrator);
    expect(err).not.toBeNull();
    // The hidden row is invisible to D0's best-effort count, so the failure is
    // the CONSTRAINT backstop (generic), not the count-only D0 message.
    expect(err!.message).toMatch(/runs_dispatch_v1_state_check/);
    const after = await admin3.query(`SELECT to_jsonb(r) AS row FROM govai.runs r WHERE id = $1::uuid`, [badId]);
    expect(JSON.stringify(after.rows[0])).toBe(JSON.stringify(before.rows[0]));
    const cons = await admin3.query(
      `SELECT 1 FROM pg_constraint
        WHERE conrelid = 'govai.runs'::regclass AND conname = 'runs_dispatch_v1_state_check'`,
    );
    expect(cons.rowCount).toBe(0); // never falsely re-added — whole file rolled back
    expect(await rlsPosture()).toEqual({ rls: true, force: true, owner: 'govai_audit_writer' });
    // Heal: operator removes the impossible row; the minimal migrator completes.
    await admin3.query(`DELETE FROM govai.runs WHERE id = $1::uuid`, [badId]);
    expect(await migrateAs(minMigrator)).toBeNull();
    const healed = await admin3.query<{ convalidated: boolean }>(
      `SELECT convalidated FROM pg_constraint
        WHERE conrelid = 'govai.runs'::regclass AND conname = 'runs_dispatch_v1_state_check'`,
    );
    expect(healed.rows[0]!.convalidated).toBe(true);
  });

  it('RLS-M7 — a login that CANNOT assume the writer fails loud before any semantic schema mutation', async () => {
    await toPreBoundary();
    await seedV1FailedPostClaim(ORG_B);
    const before = await runsSnapshot();
    const err = await migrateAs(outsider);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/permission denied/i);
    expect(await boundaryColumnExists3()).toBe(false);
    expect(await runsSnapshot()).toBe(before);
    // Restore: operator adjudicates the row away; the minimal migrator completes.
    await admin3.query(`DELETE FROM govai.runs WHERE dispatch_protocol_version = 1`);
    expect(await migrateAs(minMigrator)).toBeNull();
  });

  it('RLS-M8 — the NO FORCE window is unobservable: concurrent sessions never see FORCE=false, tenants gain nothing', async () => {
    // (a) Mechanism-equivalent open window held UNCOMMITTED in one session:
    // another session's catalog read sees FORCE=true throughout (MVCC), and
    // rollback restores the posture. The migration performs the same sequence
    // inside ONE atomic DO statement, so its window is strictly narrower.
    const holder = await admin3.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SET ROLE govai_audit_writer');
      await holder.query('ALTER TABLE govai.runs NO FORCE ROW LEVEL SECURITY');
      const observed = await inhMigrator.query<{ force: boolean }>(
        `SELECT relforcerowsecurity AS force FROM pg_class WHERE oid = 'govai.runs'::regclass`,
      );
      expect(observed.rows[0]!.force).toBe(true); // uncommitted window invisible
      await holder.query('ROLLBACK');
    } finally {
      holder.release();
    }
    expect(await rlsPosture()).toEqual({ rls: true, force: true, owner: 'govai_audit_writer' });
    // (b) Tenant runtime visibility is unchanged after all the guard activity:
    // org-scoped rows only, nothing cross-org leaked to govai_app.
    await admin3.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed', 'queued', '{}'::jsonb),
              ($5::uuid, $6::uuid, $7::uuid, $8::uuid, 'anthropic', 'm', 'governed', 'queued', '{}'::jsonb)`,
      [randomUUID(), ORG_A, randomUUID(), randomUUID(), randomUUID(), ORG_B, randomUUID(), randomUUID()],
    );
    const tenant = await appUser.connect();
    try {
      // Transaction-LOCAL GUC so the pooled session carries nothing into the
      // no-GUC probe below.
      await tenant.query('BEGIN');
      await tenant.query(`SELECT set_config('app.org_id', $1, true)`, [ORG_A]);
      const seen = await tenant.query<{ org_id: string }>(`SELECT DISTINCT org_id FROM govai.runs`);
      expect(seen.rows.map((r) => r.org_id)).toEqual([ORG_A]);
      await tenant.query('COMMIT');
    } finally {
      tenant.release();
    }
    const unset = await appUser.query<{ n: string }>(`SELECT count(*)::text AS n FROM govai.runs`);
    expect(Number(unset.rows[0]!.n)).toBe(0); // no GUC → no rows, never cross-org
  });
});
