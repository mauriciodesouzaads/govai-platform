// EP-AI-CONVERSATION-CONTINUITY-V1 P0-D1 — MIGRATION 0036 CONTRACT
//
// 0036 grants exactly TWO column authorities and nothing else. This suite is the
// exact-privilege inventory of that claim, in both directions: what P0-D1 gained, and every
// authority the movement's adjudications say it must NOT have gained — most importantly, NO
// `ai_conversation_provider_state` privilege for anyone (P0-D1 creates no provider-held
// continuation state; the anchor derives from the durable projection).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { startPostgres, stopPostgres, migrate, type TestDb } from './setup.js';
import { freshOwner, seedFullChain, type OwnerIds } from './helpers/ai-conversation-seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(
  __dirname,
  '..',
  '..',
  'apps',
  'api',
  'src',
  'db',
  'migrations',
  '0036_ai_conversation_provider_continuation.sql',
);

const WORKER = 'govai_conversation_worker';
const MIGRATION_TEST_TIMEOUT_MS = 240_000;

let db: TestDb;
let worker: Pool;
let owner: OwnerIds;
let chain: Awaited<ReturnType<typeof seedFullChain>>;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.adminUrl, db.appPassword, undefined, undefined, db.conversationWorkerPassword);
  worker = new Pool({ connectionString: db.conversationWorkerUrl, max: 2 });
  worker.on('error', () => undefined);
  owner = freshOwner();
  chain = await seedFullChain(db.adminPool, owner);
}, 300_000);

afterAll(async () => {
  await worker?.end().catch(() => undefined);
  if (db) await stopPostgres(db);
});

async function colPriv(table: string, col: string, priv: 'SELECT' | 'UPDATE'): Promise<boolean> {
  const r = await db.adminPool.query<{ ok: boolean }>(
    `SELECT has_column_privilege($1, $2, $3, $4) AS ok`,
    [WORKER, `govai.${table}`, col, priv],
  );
  return r.rows[0]!.ok;
}

async function hasTablePriv(role: string, table: string, priv: string): Promise<boolean> {
  const r = await db.adminPool.query<{ ok: boolean }>(
    `SELECT has_table_privilege($1, $2, $3) AS ok`,
    [role, `govai.${table}`, priv],
  );
  return r.rows[0]!.ok;
}

describe('0036 — exactly two authorities, both column-scoped', () => {
  it('N1 — the branch FORK BOUNDARY is readable: the context walk can apply §3 boundary modes', async () => {
    for (const col of ['forked_from_turn_id', 'forked_from_attempt_id', 'boundary_mode']) {
      expect({ col, readable: await colPriv('ai_conversation_branches', col, 'SELECT') }).toEqual({
        col,
        readable: true,
      });
      // Read-only: fork pins are frozen by 0031's guard AND unreachable for writing.
      expect({ col, writable: await colPriv('ai_conversation_branches', col, 'UPDATE') }).toEqual({
        col,
        writable: false,
      });
    }
  });

  it('N2 — the continuation anchor is WRITE-ONLY: stampable at the boundary, never readable', async () => {
    for (const col of [
      'continuation_parent_ciphertext',
      'continuation_parent_dek_wrapped',
      'continuation_parent_kms_key_id',
      'continuation_parent_kms_key_version',
    ]) {
      expect({ col, writable: await colPriv('ai_conversation_attempts', col, 'UPDATE') }).toEqual({
        col,
        writable: true,
      });
      // The runtime derives every next anchor from the durable projection (spec §11), so read
      // authority would be authority without a code path — and it stays withheld.
      expect({ col, readable: await colPriv('ai_conversation_attempts', col, 'SELECT') }).toEqual({
        col,
        readable: false,
      });
    }
  });

  it('N3 — a worker session can actually EXERCISE the anchor write through the boundary edge', async () => {
    // The grant is real only together with 0034's UPDATE policy and 0031's guard: stamp the
    // anchor exactly as the boundary commit does — while OLD.state = 'accepted', in the same
    // UPDATE that crosses to `dispatching` — under the worker identity and the owner context.
    const c = await worker.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.org_id', $1, true)", [owner.orgId]);
      await c.query("SELECT set_config('app.user_id', $1, true)", [owner.ownerUserId]);
      // Claim first (0031: dispatching must be claimed + boundary-stamped).
      await c.query(
        `UPDATE govai.ai_conversation_attempts
            SET claim_token = gen_random_uuid(), claimant = 'n3', claim_deadline_at = now() + interval '60 seconds',
                heartbeat_at = now(), updated_at = now()
          WHERE id = $1::uuid`,
        [chain.attemptId],
      );
      const r = await c.query(
        `UPDATE govai.ai_conversation_attempts
            SET state = 'dispatching',
                dispatch_boundary_committed_at = now(),
                govai_request_id = gen_random_uuid(),
                causal_version_at_build = 0,
                continuation_parent_ciphertext = '\\x01'::bytea,
                continuation_parent_dek_wrapped = '\\x02'::bytea,
                continuation_parent_kms_key_id = 'k',
                continuation_parent_kms_key_version = 1,
                updated_at = now()
          WHERE id = $1::uuid AND state = 'accepted'`,
        [chain.attemptId],
      );
      expect(r.rowCount).toBe(1);
      await c.query('ROLLBACK');
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });

  it('N4 — NO provider_state privilege appeared, for the worker OR the request role', async () => {
    // The P0-D1 adjudication: no provider-held continuation state exists, so no new authority
    // over its table may exist either. govai_app keeps ONLY its inert 0031 SELECT/INSERT.
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      expect({ p, worker: await hasTablePriv(WORKER, 'ai_conversation_provider_state', p) }).toEqual(
        { p, worker: false },
      );
    }
    expect(await hasTablePriv('govai_app', 'ai_conversation_provider_state', 'UPDATE')).toBe(false);
    expect(await hasTablePriv('govai_app', 'ai_conversation_provider_state', 'DELETE')).toBe(false);
    // And the evidence-link wall (P0-F) still stands.
    for (const p of ['SELECT', 'INSERT', 'UPDATE']) {
      expect({ p, ok: await hasTablePriv(WORKER, 'ai_conversation_evidence_links', p) }).toEqual({
        p,
        ok: false,
      });
    }
  });

  it('N5 — the worker still cannot INSERT attempts, DELETE anything, or write a turn', async () => {
    expect(await hasTablePriv(WORKER, 'ai_conversation_attempts', 'INSERT')).toBe(false);
    expect(await hasTablePriv(WORKER, 'ai_conversation_turns', 'UPDATE')).toBe(false);
    expect(await hasTablePriv(WORKER, 'ai_conversation_turns', 'INSERT')).toBe(false);
    for (const t of [
      'ai_conversations',
      'ai_conversation_branches',
      'ai_conversation_turns',
      'ai_conversation_attempts',
      'ai_conversation_items',
      'ai_conversation_content',
    ]) {
      expect({ t, del: await hasTablePriv(WORKER, t, 'DELETE') }).toEqual({ t, del: false });
    }
  });
});

describe('0036 — the migration text itself', () => {
  it('N6 — grants to EXACTLY one role, no forbidden verb, no DDL beyond grants', async () => {
    const sql = (await readFile(MIGRATION, 'utf8')).replace(/^\s*--.*$/gm, ' ');
    const grantees = [...sql.matchAll(/\bTO\s+(govai_[a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());
    expect([...new Set(grantees)]).toEqual([WORKER]);
    expect(/GRANT[\s\S]{0,200}?\bDELETE\b/i.test(sql)).toBe(false);
    expect(/GRANT[\s\S]{0,200}?\bTRUNCATE\b/i.test(sql)).toBe(false);
    expect(/GRANT[\s\S]{0,200}?\bINSERT\b/i.test(sql)).toBe(false);
    expect(/BYPASSRLS|SUPERUSER|CREATEROLE|GRANT\s+ALL/i.test(sql)).toBe(false);
    expect(/TO\s+PUBLIC/i.test(sql)).toBe(false);
    expect(/GRANT\s+govai_\w+\s+TO/i.test(sql)).toBe(false);
    // Structural minimalism: no table, column, index, policy, trigger or function is created.
    expect(/CREATE\s+(TABLE|INDEX|POLICY|TRIGGER|FUNCTION)|ALTER\s+TABLE/i.test(sql)).toBe(false);
    // It never touches the tables the adjudications wall off.
    expect(/ai_conversation_provider_state|ai_conversation_evidence_links/.test(sql)).toBe(false);
    expect(sql).toContain('role govai_conversation_worker is absent');
  });

  it('N7 — RERUNNABLE: applying every migration twice is a no-op and widens nothing', async () => {
    await expect(
      migrate(db.adminUrl, db.appPassword, undefined, undefined, db.conversationWorkerPassword),
    ).resolves.toBeUndefined();
    expect(await colPriv('ai_conversation_attempts', 'continuation_parent_ciphertext', 'SELECT')).toBe(false);
    expect(await colPriv('ai_conversation_branches', 'boundary_mode', 'UPDATE')).toBe(false);
    expect(await hasTablePriv(WORKER, 'ai_conversation_provider_state', 'SELECT')).toBe(false);
  }, MIGRATION_TEST_TIMEOUT_MS);
});
