// EP-AI-CONVERSATION-CONTINUITY-V1 P0-A2 — migration 0032 against a POPULATED database.
//
// A dedicated container is migrated only through 0031 and seeded with a realistic multi-org,
// multi-owner conversation domain. ONLY THEN is 0032 applied, so the assertions are about what
// the trust/discovery migration does to data and privileges that already exist:
//
//  M1 every pre-existing row survives byte-identically (0032 is additive, not a rewrite)
//  M2 every P0-A1 constraint, trigger and guard still fires afterwards
//  M3 govai_app's grants and dual-predicate RLS are untouched — it gains nothing and loses
//     nothing, and it certainly gains no cross-owner visibility
//  M4 0032 is re-runnable (the house idempotency convention) and stays additive on re-run
//  M5 0032 FAILS LOUD if the worker role is absent (roles live in bootstrap, not migrations)
//  M6 the migration adds exactly the adjudicated policy/grant/function set — nothing else

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { applyPrivilegedRoleLifecycles } from '../../apps/api/src/db/migrate.js';
import {
  freshOwner,
  seedFullChain,
  seedConversation,
  seedTurn,
  seedAttempt,
  isCheckViolation,
  isPrivilegeViolation,
  type OwnerIds,
} from './helpers/ai-conversation-seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const BOOTSTRAP_PATH = join(ROOT, 'infra', 'postgres', 'bootstrap.sql');
const MIGRATIONS_DIR = join(ROOT, 'apps', 'api', 'src', 'db', 'migrations');
const MIGRATION_0032 = '0032_ai_conversation_worker_trust_discovery.sql';

let container: StartedPostgreSqlContainer;
let admin: Pool;
let sql0032: string;
let ownerA: OwnerIds;
let ownerB: OwnerIds;
let chainA: Awaited<ReturnType<typeof seedFullChain>>;
let chainB: Awaited<ReturnType<typeof seedFullChain>>;
let preDigest: string;
let preCounts: Record<string, string>;

const AI_TABLES = [
  'ai_conversations',
  'ai_conversation_branches',
  'ai_conversation_turns',
  'ai_conversation_attempts',
  'ai_conversation_items',
  'ai_conversation_content',
  'ai_conversation_provider_state',
  'ai_conversation_evidence_links',
] as const;

/** The house idiom for asserting a specific Postgres error CLASS (0031 migration suite). */
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

/** Whole-domain content digest: every column of every row of every ai_* table. */
async function domainDigest(pool: Pool): Promise<string> {
  const parts: string[] = [];
  for (const t of AI_TABLES) {
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
  for (const t of AI_TABLES) {
    const r = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM govai.${t}`);
    out[t] = r.rows[0]!.n;
  }
  return out;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('govai')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();
  admin = new Pool({ connectionString: container.getConnectionUri() });
  admin.on('error', () => undefined);

  await applyMigrationsUpTo(admin, '0031');
  sql0032 = await readFile(join(MIGRATIONS_DIR, MIGRATION_0032), 'utf8');

  // A populated domain BEFORE 0032: two orgs, two owners, several attempt states.
  ownerA = freshOwner();
  ownerB = freshOwner();
  chainA = await seedFullChain(admin, ownerA);
  chainB = await seedFullChain(admin, ownerB);
  const extra = await seedConversation(admin, ownerA);
  const t2 = await seedTurn(admin, ownerA, extra.conversationId, extra.branchId, 1);
  await seedAttempt(admin, ownerA, extra.conversationId, extra.branchId, t2.turnId, {
    state: 'completed',
  });

  preDigest = await domainDigest(admin);
  preCounts = await tableCounts(admin);
}, 300_000);

afterAll(async () => {
  await admin?.end().catch(() => undefined);
  await container?.stop().catch(() => undefined);
});

describe('P0-A2 — migration 0032 on a populated 0031 database', () => {
  it('M5 — 0032 FAILS LOUD when the worker role is absent (roles live in bootstrap)', async () => {
    const c = await admin.connect();
    try {
      // Prove the guard by removing the role for the duration of one attempt. 0032 has not run
      // yet, so bootstrap's schema USAGE is its ONLY dependency — revoke that and the DROP is
      // clean. The role is restored in the finally block whatever happens.
      await c.query(`REVOKE ALL ON SCHEMA govai FROM govai_conversation_worker`);
      await c.query(`DROP ROLE govai_conversation_worker`);
      await expect(c.query(sql0032)).rejects.toMatchObject({
        message: expect.stringContaining('govai_conversation_worker is absent'),
      });
    } finally {
      await c.query(`RESET ROLE`).catch(() => undefined);
      await c
        .query(
          `DO $$ BEGIN CREATE ROLE govai_conversation_worker NOINHERIT NOLOGIN;
             EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
        )
        .catch(() => undefined);
      await c
        .query(`GRANT USAGE ON SCHEMA govai TO govai_conversation_worker`)
        .catch(() => undefined);
      c.release();
    }
    // Nothing was written by the failed attempt.
    const fn = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'govai' AND p.proname = 'ai_turn_recovery_candidates'`,
    );
    expect(fn.rows[0]!.n).toBe('0');
    expect(await domainDigest(admin)).toBe(preDigest);
  });

  it('M1 — applying 0032 preserves every pre-existing row byte-identically', async () => {
    await admin.query(sql0032);
    expect(await domainDigest(admin)).toBe(preDigest);
    expect(await tableCounts(admin)).toEqual(preCounts);
  });

  it('M4 — 0032 is re-runnable and stays additive on re-run', async () => {
    await admin.query(sql0032);
    await admin.query(sql0032);
    expect(await domainDigest(admin)).toBe(preDigest);
    // No duplicate policies were created by the re-runs.
    const pol = await admin.query<{ policyname: string; n: string }>(
      `SELECT policyname, count(*)::text AS n FROM pg_policies
        WHERE schemaname = 'govai' AND tablename LIKE 'ai_conversation%'
          AND (policyname LIKE '%_recovery_select_writer' OR policyname LIKE '%_conversation_worker')
        GROUP BY policyname ORDER BY policyname`,
    );
    for (const p of pol.rows) expect(p.n).toBe('1');
  });

  it('M2 — every P0-A1 constraint and guard still fires after 0032', async () => {
    // Terminal FULL-ROW immutability (the 0031 ratchet).
    const completed = await admin.query<{ id: string }>(
      `SELECT id FROM govai.ai_conversation_attempts WHERE state = 'completed' LIMIT 1`,
    );
    const completedId = completed.rows[0]!.id;
    await expectError(
      () =>
        admin.query(
          `UPDATE govai.ai_conversation_attempts SET stop_requested = true WHERE id = $1::uuid`,
          [completedId],
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
              claim_token, claimant, claim_deadline_at)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,9,'accepted',$6::uuid,'x',now())`,
          [
            ownerA.orgId,
            ownerA.ownerUserId,
            chainA.conversationId,
            chainA.branchId,
            chainA.turnId,
            randomUUID(),
          ],
        ),
      isPrivilegeViolation,
      'attempt birth guard',
    );

    // The state × provenance CHECK matrix (accepted ⟹ ¬P is enforced by a CHECK).
    await expectError(
      () =>
        admin.query(
          `INSERT INTO govai.ai_conversation_attempts
             (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq, state,
              terminal_at, dispatch_boundary_committed_at)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,8,'outcome_unknown',now(),now())`,
          [
            ownerA.orgId,
            ownerA.ownerUserId,
            chainA.conversationId,
            chainA.branchId,
            chainA.turnId,
          ],
        ),
      (e) => isCheckViolation(e) || isPrivilegeViolation(e),
      'outcome_unknown provenance CHECK / birth guard',
    );

    // The conversation lifecycle ratchet has no reverse edge out of deleted_pending.
    await admin.query(
      `UPDATE govai.ai_conversations SET status = 'deleted_pending' WHERE id = $1::uuid`,
      [chainB.conversationId],
    );
    await expectError(
      () =>
        admin.query(`UPDATE govai.ai_conversations SET status = 'active' WHERE id = $1::uuid`, [
          chainB.conversationId,
        ]),
      isPrivilegeViolation,
      'lifecycle ratchet has no reverse edge',
    );
    await admin.query(
      `UPDATE govai.ai_conversations SET status = 'deleted_pending' WHERE id = $1::uuid`,
      [chainB.conversationId],
    );
  });

  it('M3 — govai_app gains nothing: same grants, same dual-predicate RLS, no cross-owner read', async () => {
    for (const t of AI_TABLES) {
      const r = await admin.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
        `SELECT has_table_privilege('govai_app', 'govai.' || $1, 'SELECT') AS sel,
                has_table_privilege('govai_app', 'govai.' || $1, 'INSERT') AS ins,
                has_table_privilege('govai_app', 'govai.' || $1, 'UPDATE') AS upd,
                has_table_privilege('govai_app', 'govai.' || $1, 'DELETE') AS del`,
        [t],
      );
      expect({ t, ...r.rows[0]! }).toEqual({ t, sel: true, ins: true, upd: false, del: false });
    }
    // Every 0031 govai_app policy still carries BOTH predicates.
    const pol = await admin.query<{ policyname: string; qual: string | null; wc: string | null }>(
      `SELECT policyname, qual, with_check AS wc FROM pg_policies
        WHERE schemaname = 'govai' AND policyname LIKE 'ai_conversation%_app'
           OR (schemaname = 'govai' AND policyname LIKE 'ai_conversations_%_app')
        ORDER BY policyname`,
    );
    expect(pol.rowCount).toBe(16); // 8 tables x {select, insert}
    for (const p of pol.rows) {
      const expr = `${p.qual ?? ''}${p.wc ?? ''}`;
      expect(expr).toContain('app.org_id');
      expect(expr).toContain('app.user_id');
    }
    // Still no cross-owner read on the live app path.
    const appPool = new Pool({
      connectionString: container
        .getConnectionUri()
        .replace('postgres:postgres@', 'govai_app:migration_probe_password@'),
    });
    appPool.on('error', () => undefined);
    try {
      const c = await appPool.connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT set_config('app.org_id', $1, true)", [ownerA.orgId]);
        await c.query("SELECT set_config('app.user_id', $1, true)", [ownerB.ownerUserId]);
        const cross = await c.query(`SELECT id FROM govai.ai_conversations`);
        expect(cross.rowCount).toBe(0);
        await c.query('COMMIT');
      } finally {
        c.release();
      }
    } finally {
      await appPool.end().catch(() => undefined);
    }
  });

  it('M6 — 0032 adds exactly the adjudicated policies, grants and function', async () => {
    const pol = await admin.query<{ tablename: string; policyname: string; roles: string }>(
      `SELECT tablename, policyname, roles::text AS roles FROM pg_policies
        WHERE schemaname = 'govai' AND tablename LIKE 'ai_conversation%'
          AND (policyname LIKE '%_recovery_select_writer' OR policyname LIKE '%_conversation_worker')
        ORDER BY policyname`,
    );
    expect(
      pol.rows.map((r) => `${r.tablename}:${r.policyname}`),
    ).toEqual([
      'ai_conversation_attempts:ai_conversation_attempts_recovery_select_writer',
      'ai_conversation_attempts:ai_conversation_attempts_select_conversation_worker',
      'ai_conversation_turns:ai_conversation_turns_recovery_select_writer',
      'ai_conversation_turns:ai_conversation_turns_select_conversation_worker',
      'ai_conversations:ai_conversations_recovery_select_writer',
      'ai_conversations:ai_conversations_select_conversation_worker',
    ]);
    // ai_conversation_branches deliberately received NEITHER a definer policy NOR a grant:
    // the discovery query never reads it (branch_id is denormalized onto the attempt).
    const branchPolicies = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_policies
        WHERE schemaname = 'govai' AND tablename = 'ai_conversation_branches'
          AND roles::text NOT LIKE '%govai_app%'`,
    );
    expect(branchPolicies.rows[0]!.n).toBe('0');

    // Column grants are exactly the adjudicated sets.
    const cols = await admin.query<{ table_name: string; c: string }>(
      `SELECT table_name, string_agg(column_name, ',' ORDER BY column_name) AS c
         FROM information_schema.column_privileges
        WHERE table_schema = 'govai' AND grantee = 'govai_conversation_worker'
        GROUP BY table_name ORDER BY table_name`,
    );
    expect(Object.fromEntries(cols.rows.map((r) => [r.table_name, r.c]))).toEqual({
      ai_conversation_attempts:
        'attempt_seq,branch_id,claim_deadline_at,claim_token,claimant,conversation_id,created_at,' +
        'dispatch_boundary_committed_at,heartbeat_at,id,org_id,owner_user_id,state,stop_requested,' +
        'turn_id,updated_at',
      ai_conversation_turns:
        'branch_id,client_turn_id,conversation_id,created_at,current_attempt_id,id,org_id,' +
        'owner_user_id,turn_seq',
      ai_conversations: 'id,org_id,owner_user_id,status',
    });

    // And exactly one new SECURITY DEFINER function in the ai_* domain.
    const fn = await admin.query<{ proname: string; owner: string; prosecdef: boolean }>(
      `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'govai' AND p.proname LIKE 'ai_%' AND p.prosecdef`,
    );
    expect(fn.rows).toEqual([
      { proname: 'ai_turn_recovery_candidates', owner: 'govai_audit_writer', prosecdef: true },
    ]);
  });
});
