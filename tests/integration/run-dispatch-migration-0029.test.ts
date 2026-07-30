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

  it('admits outcome_unknown ONLY in a consistent v1 shape', async () => {
    const ok = await admin.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
          dispatch_timeout_ms, dispatch_deadline_at, started_at, outcome_unknown_at,
          dispatch_error_class)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'm', 'governed',
          'outcome_unknown', '{}'::jsonb, 1, now(), $5::uuid, now(), 60000,
          now() + interval '60 seconds', now(), now(), 'provider_timeout')
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
});
