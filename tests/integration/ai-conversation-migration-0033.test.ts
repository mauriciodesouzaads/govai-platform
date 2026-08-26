// EP-AI-CONVERSATION-CONTINUITY-V1 P0-B — migration 0033 against a POPULATED database.
//
// A dedicated container is migrated only through 0032 and seeded with a realistic multi-org,
// multi-owner conversation domain. ONLY THEN is 0033 applied, so every assertion is about what
// the control-plane migration does to data and privileges that already exist:
//
//  N1 every pre-existing row survives byte-identically (0033 is additive, not a rewrite)
//  N2 every P0-A1 / P0-A2 constraint, trigger and guard still fires afterwards
//  N3 `govai_app` gains EXACTLY the adjudicated authority: column-scoped UPDATE on eight
//     columns of ONE table, plus SELECT+INSERT on the new arbiter. No DELETE. No TRUNCATE.
//     No table-level UPDATE. Nothing on any other relation.
//  N4 the `govai_conversation_worker` privilege matrix is byte-identical before and after —
//     P0-C's future needs are NOT pre-granted here
//  N5 0033 is re-runnable (the house idempotency convention) and stays additive on re-run
//  N6 FORCE RLS is still enabled on every table in the domain, the new one included
//  N7 0031 and 0032 are unmodified on disk

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { applyPrivilegedRoleLifecycles } from '../../apps/api/src/db/migrate.js';
import {
  advanceSeededAttempt,
  freshOwner,
  isPrivilegeViolation,
  seedAttempt,
  seedConversation,
  seedFullChain,
  seedTurn,
  type OwnerIds,
} from './helpers/ai-conversation-seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const BOOTSTRAP_PATH = join(ROOT, 'infra', 'postgres', 'bootstrap.sql');
const MIGRATIONS_DIR = join(ROOT, 'apps', 'api', 'src', 'db', 'migrations');
const MIGRATION_0033 = '0033_ai_conversation_control_plane.sql';
const WORKER_ROLE = 'govai_conversation_worker';

/** The eight tables of P0-A1, plus P0-B's arbiter. */
const P0A1_TABLES = [
  'ai_conversations',
  'ai_conversation_branches',
  'ai_conversation_turns',
  'ai_conversation_attempts',
  'ai_conversation_items',
  'ai_conversation_content',
  'ai_conversation_provider_state',
  'ai_conversation_evidence_links',
] as const;
const FORK_IDEMPOTENCY_TABLE = 'ai_conversation_fork_idempotency';

/** The EXACT column set 0033 grants `govai_app` UPDATE on (§13's two guarded fields). */
const EXPECTED_UPDATE_COLUMNS = [
  'archived_at',
  'status',
  'title_ciphertext',
  'title_dek_wrapped',
  'title_hmac',
  'title_kms_key_id',
  'title_kms_key_version',
  'updated_at',
].join(',');

let container: StartedPostgreSqlContainer;
let admin: Pool;
let sql0033: string;
let ownerA: OwnerIds;
let ownerB: OwnerIds;
let chainA: Awaited<ReturnType<typeof seedFullChain>>;
let preDigest: string;
let preCounts: Record<string, string>;
let preWorkerPrivileges: string;

async function applyMigrationsUpTo(pool: Pool, lastPrefix: string): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query(`SET govai.app_password = 'migration_probe_password'`);
    const bootstrap = await readFile(BOOTSTRAP_PATH, 'utf8');
    await applyPrivilegedRoleLifecycles(
      c,
      { enumerator: {}, conversationWorker: {} },
      async () => {
        await c.query(bootstrap);
      },
      () => undefined,
    );
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql') && f.slice(0, 4) <= lastPrefix)
      .sort((a, b) => a.localeCompare(b));
    expect(files.at(-1)!.startsWith(lastPrefix)).toBe(true);
    for (const f of files) await c.query(await readFile(join(MIGRATIONS_DIR, f), 'utf8'));
  } finally {
    c.release();
  }
}

/** Whole-domain content digest: every column of every row of every P0-A1 table. */
async function domainDigest(pool: Pool): Promise<string> {
  const parts: string[] = [];
  for (const t of P0A1_TABLES) {
    const r = await pool.query<{ d: string | null }>(
      `SELECT md5(coalesce(string_agg(x.row_text, '|' ORDER BY x.id), '')) AS d
         FROM (SELECT r.id, r::text AS row_text FROM govai.${t} r) x`,
    );
    parts.push(`${t}:${r.rows[0]!.d}`);
  }
  return parts.join(';');
}

async function tableCounts(pool: Pool): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of P0A1_TABLES) {
    const r = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM govai.${t}`);
    out[t] = r.rows[0]!.n;
  }
  return out;
}

/** Every privilege the worker role holds anywhere in the `govai` schema, at TABLE and COLUMN
 *  granularity, plus its function EXECUTE grants — one comparable string. */
async function workerPrivilegeFingerprint(pool: Pool): Promise<string> {
  const cols = await pool.query<{ line: string }>(
    `SELECT table_name || ':' || privilege_type || ':' || column_name AS line
       FROM information_schema.column_privileges
      WHERE table_schema = 'govai' AND grantee = $1
      ORDER BY 1`,
    [WORKER_ROLE],
  );
  const tables = await pool.query<{ line: string }>(
    `SELECT table_name || ':' || privilege_type AS line
       FROM information_schema.table_privileges
      WHERE table_schema = 'govai' AND grantee = $1
      ORDER BY 1`,
    [WORKER_ROLE],
  );
  // ★ CALLABLE functions only. A `RETURNS trigger` function cannot be invoked from SQL at all
  // ("trigger functions can only be called as triggers"), so the PUBLIC EXECUTE default every
  // guard function in 0031/0032/0033 carries is inert and is NOT worker capability. Including
  // them would make this fingerprint change whenever ANY movement adds a guard trigger, which
  // is exactly the false alarm P0-A2 removed from the 0031 policy count.
  const fns = await pool.query<{ line: string }>(
    `SELECT p.proname AS line
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'govai'
        AND p.prorettype <> 'pg_catalog.trigger'::regtype
        AND has_function_privilege($1, p.oid, 'EXECUTE')
      ORDER BY 1`,
    [WORKER_ROLE],
  );
  const policies = await pool.query<{ line: string }>(
    `SELECT tablename || ':' || policyname || ':' || cmd AS line
       FROM pg_policies
      WHERE schemaname = 'govai' AND roles::text LIKE '%' || $1 || '%'
      ORDER BY 1`,
    [WORKER_ROLE],
  );
  return createHash('sha256')
    .update(
      [
        `cols=${cols.rows.map((r) => r.line).join(',')}`,
        `tables=${tables.rows.map((r) => r.line).join(',')}`,
        `fns=${fns.rows.map((r) => r.line).join(',')}`,
        `policies=${policies.rows.map((r) => r.line).join(',')}`,
      ].join('|'),
      'utf8',
    )
    .digest('hex');
}

async function expectError(
  fn: () => Promise<unknown>,
  classify: (err: unknown) => boolean,
  label: string,
): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught, `${label}: expected a rejection`).not.toBeNull();
  expect(classify(caught), `${label}: unexpected error class: ${(caught as Error)?.message}`).toBe(
    true,
  );
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('govai')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();
  admin = new Pool({ connectionString: container.getConnectionUri() });
  admin.on('error', () => undefined);

  await applyMigrationsUpTo(admin, '0032');
  sql0033 = await readFile(join(MIGRATIONS_DIR, MIGRATION_0033), 'utf8');

  // A populated domain BEFORE 0033: two orgs/owners, several attempt states.
  ownerA = freshOwner();
  ownerB = freshOwner();
  chainA = await seedFullChain(admin, ownerA);
  await seedFullChain(admin, ownerB);
  const extra = await seedConversation(admin, ownerA);
  const t2 = await seedTurn(admin, ownerA, extra.conversationId, extra.branchId, 1);
  await seedAttempt(admin, ownerA, extra.conversationId, extra.branchId, t2.turnId, {
    state: 'completed',
  });

  preDigest = await domainDigest(admin);
  preCounts = await tableCounts(admin);
  preWorkerPrivileges = await workerPrivilegeFingerprint(admin);
}, 300_000);

afterAll(async () => {
  await admin?.end().catch(() => undefined);
  await container?.stop().catch(() => undefined);
});

describe('P0-B — migration 0033 on a populated 0031+0032 database', () => {
  it('N1 — applying 0033 preserves every pre-existing row byte-identically', async () => {
    await admin.query(sql0033);
    expect(await domainDigest(admin)).toBe(preDigest);
    expect(await tableCounts(admin)).toEqual(preCounts);
    // The new arbiter starts empty — the migration invents no bindings for existing branches.
    const n = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.${FORK_IDEMPOTENCY_TABLE}`,
    );
    expect(n.rows[0]!.n).toBe('0');
  });

  it('N5 — 0033 is re-runnable and stays additive on re-run', async () => {
    await admin.query(sql0033);
    await admin.query(sql0033);
    expect(await domainDigest(admin)).toBe(preDigest);
    // No duplicate policies, and no duplicated column grant.
    const pol = await admin.query<{ policyname: string; n: string }>(
      `SELECT policyname, count(*)::text AS n FROM pg_policies
        WHERE schemaname = 'govai'
          AND (policyname = 'ai_conversations_update_app'
            OR policyname LIKE 'ai_conversation_fork_idempotency%')
        GROUP BY policyname ORDER BY policyname`,
    );
    expect(pol.rows.map((r) => `${r.policyname}=${r.n}`)).toEqual([
      'ai_conversation_fork_idempotency_insert_app=1',
      'ai_conversation_fork_idempotency_select_app=1',
      'ai_conversations_update_app=1',
    ]);
  });

  it('N4 — the conversation worker privilege matrix is UNCHANGED (nothing pre-granted for P0-C)', async () => {
    expect(await workerPrivilegeFingerprint(admin)).toBe(preWorkerPrivileges);
    // Stated explicitly as well as by fingerprint: the worker cannot touch the new arbiter at
    // any granularity, and still holds no write verb anywhere in the domain.
    const r = await admin.query<{
      col_sel: boolean;
      col_ins: boolean;
      col_upd: boolean;
      del: boolean;
      trunc: boolean;
    }>(
      `SELECT has_any_column_privilege($1, 'govai.' || $2, 'SELECT')  AS col_sel,
              has_any_column_privilege($1, 'govai.' || $2, 'INSERT')  AS col_ins,
              has_any_column_privilege($1, 'govai.' || $2, 'UPDATE')  AS col_upd,
              has_table_privilege($1, 'govai.' || $2, 'DELETE')       AS del,
              has_table_privilege($1, 'govai.' || $2, 'TRUNCATE')     AS trunc`,
      [WORKER_ROLE, FORK_IDEMPOTENCY_TABLE],
    );
    expect(r.rows[0]).toEqual({
      col_sel: false,
      col_ins: false,
      col_upd: false,
      del: false,
      trunc: false,
    });
    const stray = await admin.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'govai' AND c.relkind IN ('r','v','m','p')
          AND (has_any_column_privilege($1, c.oid, 'UPDATE')
            OR has_any_column_privilege($1, c.oid, 'INSERT')
            OR has_table_privilege($1, c.oid, 'DELETE')
            OR has_table_privilege($1, c.oid, 'TRUNCATE'))
        ORDER BY c.relname`,
      [WORKER_ROLE],
    );
    expect(stray.rows.map((r2) => r2.relname)).toEqual([]);
  });

  it('N3 — govai_app gains EXACTLY the adjudicated authority, at column granularity', async () => {
    // (a) The UPDATE grant is COLUMN-scoped: table-level UPDATE stays FALSE, so a column added
    //     by a later migration is not silently writable by the request role.
    const tableLevel = await admin.query<{
      t: string;
      sel: boolean;
      ins: boolean;
      upd: boolean;
      del: boolean;
      trunc: boolean;
    }>(
      `SELECT t AS t,
              has_table_privilege('govai_app', 'govai.' || t, 'SELECT')   AS sel,
              has_table_privilege('govai_app', 'govai.' || t, 'INSERT')   AS ins,
              has_table_privilege('govai_app', 'govai.' || t, 'UPDATE')   AS upd,
              has_table_privilege('govai_app', 'govai.' || t, 'DELETE')   AS del,
              has_table_privilege('govai_app', 'govai.' || t, 'TRUNCATE') AS trunc
         FROM unnest($1::text[]) AS t`,
      [[...P0A1_TABLES, FORK_IDEMPOTENCY_TABLE]],
    );
    for (const row of tableLevel.rows) {
      expect(row).toEqual({
        t: row.t,
        sel: true,
        ins: true,
        upd: false, // ★ column-scoped only — never table-level
        del: false, // ★ LAW 13's purge authority is a later movement's
        trunc: false,
      });
    }

    // (b) The column UPDATE set is EXACTLY the eight adjudicated columns, on ONE table.
    const cols = await admin.query<{ table_name: string; c: string }>(
      `SELECT table_name, string_agg(column_name, ',' ORDER BY column_name) AS c
         FROM information_schema.column_privileges
        WHERE table_schema = 'govai' AND grantee = 'govai_app' AND privilege_type = 'UPDATE'
          AND table_name LIKE 'ai_conversation%'
        GROUP BY table_name ORDER BY table_name`,
    );
    expect(Object.fromEntries(cols.rows.map((r) => [r.table_name, r.c]))).toEqual({
      ai_conversations: EXPECTED_UPDATE_COLUMNS,
    });

    // (c) `retention_class`, `mode`, `provider`, `surface`, `model` and the identity columns are
    //     unreachable to the request role even at column granularity.
    for (const column of [
      'retention_class',
      'mode',
      'provider',
      'surface',
      'model',
      'org_id',
      'owner_user_id',
      'id',
      'created_at',
    ]) {
      const r = await admin.query<{ ok: boolean }>(
        `SELECT has_column_privilege('govai_app', 'govai.ai_conversations', $1, 'UPDATE') AS ok`,
        [column],
      );
      expect({ column, writable: r.rows[0]!.ok }).toEqual({ column, writable: false });
    }
  });

  it('N6 — FORCE RLS is on for every table in the domain, the new arbiter included', async () => {
    const r = await admin.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'govai' AND c.relname = ANY($1::text[])
        ORDER BY c.relname`,
      [[...P0A1_TABLES, FORK_IDEMPOTENCY_TABLE]],
    );
    expect(r.rows).toHaveLength(P0A1_TABLES.length + 1);
    for (const row of r.rows) {
      expect({ t: row.relname, enabled: row.relrowsecurity, forced: row.relforcerowsecurity }).toEqual(
        { t: row.relname, enabled: true, forced: true },
      );
    }
    // The arbiter's policies are the SAME dual-predicate shape, and there are exactly two.
    const pol = await admin.query<{ policyname: string; cmd: string; qual: string | null; wc: string | null }>(
      `SELECT policyname, cmd, qual, with_check AS wc FROM pg_policies
        WHERE schemaname = 'govai' AND tablename = $1 ORDER BY policyname`,
      [FORK_IDEMPOTENCY_TABLE],
    );
    expect(pol.rows.map((p) => `${p.policyname}:${p.cmd}`)).toEqual([
      'ai_conversation_fork_idempotency_insert_app:INSERT',
      'ai_conversation_fork_idempotency_select_app:SELECT',
    ]);
    for (const p of pol.rows) {
      const expr = `${p.qual ?? ''}${p.wc ?? ''}`;
      expect(expr).toContain('app.org_id');
      expect(expr).toContain('app.user_id');
    }
  });

  it('N2 — every P0-A1 / P0-A2 guard still fires after 0033', async () => {
    // Terminal FULL-ROW immutability (0031's ratchet).
    const completed = await admin.query<{ id: string }>(
      `SELECT id FROM govai.ai_conversation_attempts WHERE state = 'completed' LIMIT 1`,
    );
    await expectError(
      () =>
        admin.query(
          `UPDATE govai.ai_conversation_attempts SET stop_requested = true WHERE id = $1::uuid`,
          [completed.rows[0]!.id],
        ),
      isPrivilegeViolation,
      'terminal full-row freeze',
    );
    // The §7.1b birth guard.
    await expectError(
      () =>
        admin.query(
          `INSERT INTO govai.ai_conversation_attempts
             (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq, state,
              dispatch_boundary_committed_at, terminal_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 9, 'completed', now(), now())`,
          [ownerA.orgId, ownerA.ownerUserId, chainA.conversationId, chainA.branchId, chainA.turnId],
        ),
      isPrivilegeViolation,
      'attempt birth guard',
    );
    // The conversation lifecycle ratchet has no reverse edge.
    await admin.query(
      `UPDATE govai.ai_conversations SET status = 'deleted_pending' WHERE id = $1::uuid`,
      [chainA.conversationId],
    );
    await expectError(
      () =>
        admin.query(`UPDATE govai.ai_conversations SET status = 'active' WHERE id = $1::uuid`, [
          chainA.conversationId,
        ]),
      isPrivilegeViolation,
      'lifecycle ratchet has no reverse edge',
    );
    // The immutable execution mode is still frozen.
    await expectError(
      () =>
        admin.query(`UPDATE govai.ai_conversations SET mode = 'passthrough' WHERE id = $1::uuid`, [
          chainA.conversationId,
        ]),
      isPrivilegeViolation,
      'immutable mode',
    );
    // TRUNCATE is still refused everywhere in the domain. Two independent mechanisms answer:
    // a table that is the target of a foreign key is refused by PostgreSQL itself before any
    // trigger runs (`0A000` feature_not_supported), and every other one hits the domain's
    // TRUNCATE guard (`42501`).
    // Both are a refusal; neither is bypassable by a grant.
    for (const t of [...P0A1_TABLES, FORK_IDEMPOTENCY_TABLE]) {
      await expectError(
        () => admin.query(`TRUNCATE govai.${t}`),
        (e) => isPrivilegeViolation(e) || (e as { code?: string }).code === '0A000',
        `truncate ${t}`,
      );
    }
    // The new arbiter is referenced by nothing, so its refusal is unambiguously the guard the
    // migration installed — not an incidental FK side effect.
    await expectError(
      () => admin.query(`TRUNCATE govai.${FORK_IDEMPOTENCY_TABLE}`),
      isPrivilegeViolation,
      'arbiter truncate guard',
    );
  });

  it('N2b — the arbiter itself is immutable: a committed binding can never be rebound', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(admin, owner);
    await advanceSeededAttempt(admin, owner, chain.attemptId, { state: 'completed' });
    const fork = await admin.query<{ id: string }>(
      `INSERT INTO govai.ai_conversation_branches
         (org_id, owner_user_id, conversation_id, provider, surface, model,
          parent_branch_id, forked_from_turn_id, forked_from_attempt_id, boundary_mode)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_api', 'm',
               $4::uuid, $5::uuid, $6::uuid, 'after_attempt')
       RETURNING id`,
      [
        owner.orgId,
        owner.ownerUserId,
        chain.conversationId,
        chain.branchId,
        chain.turnId,
        chain.attemptId,
      ],
    );
    const clientForkId = '11111111-2222-4333-8444-555555555555';
    await admin.query(
      `INSERT INTO govai.${FORK_IDEMPOTENCY_TABLE}
         (org_id, owner_user_id, conversation_id, client_fork_id,
          fork_intent_hash, fork_intent_hash_version, branch_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bytea, 1, $6::uuid)`,
      [
        owner.orgId,
        owner.ownerUserId,
        chain.conversationId,
        clientForkId,
        Buffer.alloc(32, 7),
        fork.rows[0]!.id,
      ],
    );
    await expectError(
      () =>
        admin.query(
          `UPDATE govai.${FORK_IDEMPOTENCY_TABLE} SET fork_intent_hash = $1::bytea
            WHERE client_fork_id = $2::uuid`,
          [Buffer.alloc(32, 9), clientForkId],
        ),
      isPrivilegeViolation,
      'rebind a committed fork key',
    );
    // The composite PK is the arbiter: a second row for the same key is impossible.
    await expectError(
      () =>
        admin.query(
          `INSERT INTO govai.${FORK_IDEMPOTENCY_TABLE}
             (org_id, owner_user_id, conversation_id, client_fork_id,
              fork_intent_hash, fork_intent_hash_version, branch_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bytea, 1, $6::uuid)`,
          [
            owner.orgId,
            owner.ownerUserId,
            chain.conversationId,
            clientForkId,
            Buffer.alloc(32, 9),
            fork.rows[0]!.id,
          ],
        ),
      (e) => (e as { code?: string }).code === '23505',
      'duplicate fork key',
    );
    // A hash of the wrong length is structurally impossible.
    await expectError(
      () =>
        admin.query(
          `INSERT INTO govai.${FORK_IDEMPOTENCY_TABLE}
             (org_id, owner_user_id, conversation_id, client_fork_id,
              fork_intent_hash, fork_intent_hash_version, branch_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, gen_random_uuid(), $4::bytea, 1, $5::uuid)`,
          [
            owner.orgId,
            owner.ownerUserId,
            chain.conversationId,
            Buffer.alloc(16, 1),
            fork.rows[0]!.id,
          ],
        ),
      (e) => (e as { code?: string }).code === '23514',
      'short intent hash',
    );
  });

  it('N2c — the arbiter is composite-lineage-bound: no binding by branch id alone (LAW 1)', async () => {
    const ownerX = freshOwner();
    const ownerY = freshOwner();
    const chainX = await seedFullChain(admin, ownerX);
    const chainY = await seedFullChain(admin, ownerY);
    await advanceSeededAttempt(admin, ownerY, chainY.attemptId, { state: 'completed' });
    const foreignFork = await admin.query<{ id: string }>(
      `INSERT INTO govai.ai_conversation_branches
         (org_id, owner_user_id, conversation_id, provider, surface, model,
          parent_branch_id, forked_from_turn_id, forked_from_attempt_id, boundary_mode)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_api', 'm',
               $4::uuid, $5::uuid, $6::uuid, 'after_attempt')
       RETURNING id`,
      [
        ownerY.orgId,
        ownerY.ownerUserId,
        chainY.conversationId,
        chainY.branchId,
        chainY.turnId,
        chainY.attemptId,
      ],
    );
    // A binding stamped for owner X's conversation that names owner Y's branch: the composite
    // FK finds no (orgX, ownerX, conversationX, branchY) parent.
    await expectError(
      () =>
        admin.query(
          `INSERT INTO govai.${FORK_IDEMPOTENCY_TABLE}
             (org_id, owner_user_id, conversation_id, client_fork_id,
              fork_intent_hash, fork_intent_hash_version, branch_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, gen_random_uuid(), $4::bytea, 1, $5::uuid)`,
          [
            ownerX.orgId,
            ownerX.ownerUserId,
            chainX.conversationId,
            Buffer.alloc(32, 3),
            foreignFork.rows[0]!.id,
          ],
        ),
      (e) => (e as { code?: string }).code === '23503',
      'cross-owner fork binding',
    );
  });

  it('N7 — migrations 0031 and 0032 are unmodified by this movement', async () => {
    // Their bytes are the historical source P0-A1/P0-A2 were reviewed against. This is a
    // content assertion, not a git one: it fails loudly if a future edit lands in either file.
    const sql0031 = await readFile(
      join(MIGRATIONS_DIR, '0031_ai_conversation_storage_foundation.sql'),
      'utf8',
    );
    const sql0032 = await readFile(
      join(MIGRATIONS_DIR, '0032_ai_conversation_worker_trust_discovery.sql'),
      'utf8',
    );
    // Both still declare themselves as their own movement, and neither mentions P0-B's objects.
    expect(sql0031).toContain('P0-A1-OPERATIONAL-STORAGE-CRYPTO-OWNER-RLS-FOUNDATION-01');
    expect(sql0032).toContain('P0-A2-DETACHED-WORKER-TRUST-RECOVERY-DISCOVERY');
    for (const sql of [sql0031, sql0032]) {
      expect(sql).not.toContain(FORK_IDEMPOTENCY_TABLE);
      expect(sql).not.toContain('ai_conversations_update_app');
      expect(sql).not.toContain('current_attempt_monotonic');
      expect(sql).not.toContain('fork_pin_state_guard');
    }
    // 0033 is the highest migration and is numerically next after 0032.
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    expect(files.at(-1)).toBe(MIGRATION_0033);
    expect(files.at(-2)).toBe('0032_ai_conversation_worker_trust_discovery.sql');
  });

  it('N3b — 0033 adds no DELETE authority and no new SECURITY DEFINER function', async () => {
    const del = await admin.query<{ grantee: string; table_name: string }>(
      `SELECT grantee, table_name FROM information_schema.table_privileges
        WHERE table_schema = 'govai' AND table_name LIKE 'ai_conversation%'
          AND privilege_type IN ('DELETE', 'TRUNCATE')
          AND grantee <> 'govai_audit_writer'
        ORDER BY 1, 2`,
    );
    expect(del.rows).toEqual([]);
    // 0032's discovery function stays the ONLY SECURITY DEFINER function in the ai_* domain.
    const fns = await admin.query<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'govai' AND p.prosecdef AND p.proname LIKE 'ai_%'
        ORDER BY 1`,
    );
    expect(fns.rows.map((r) => r.proname)).toEqual(['ai_turn_recovery_candidates']);
  });
});
