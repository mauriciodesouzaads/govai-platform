// EP-AI-CONVERSATION-CONTINUITY-V1 P0-C — MIGRATION 0034 CONTRACT
//
// 0034 grants AUTHORITY, and authority is the thing a movement is most likely to over-grant. This
// suite is the exact-privilege inventory: what the worker gained, what it did NOT gain, and the
// two structural facts that make the grants meaningful at all —
//
//   * a GRANT without a matching FORCE-RLS policy silently yields ZERO rows;
//   * a POLICY without a matching grant is dead text.
//
// Both directions are asserted, table by table, rather than assumed.

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
  '0034_ai_conversation_durable_execution.sql',
);

const WORKER = 'govai_conversation_worker';

/** See the note in the 0035 suite: `migrate()` replays every migration, so the 60s default is
 *  under-provisioned for it under full-suite load. Assertions unchanged; budget corrected. */
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

/** Column privileges the worker actually holds, straight from the catalog. */
async function columnPrivs(table: string, priv: 'SELECT' | 'UPDATE' | 'INSERT'): Promise<string[]> {
  const r = await db.adminPool.query<{ column_name: string }>(
    `SELECT a.attname AS column_name
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'govai' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege($2, c.oid, a.attname, $3)
      ORDER BY a.attname`,
    [table, WORKER, priv],
  );
  return r.rows.map((x) => x.column_name);
}

async function hasTablePriv(table: string, priv: string): Promise<boolean> {
  const r = await db.adminPool.query<{ ok: boolean }>(
    `SELECT has_table_privilege($1, $2, $3) AS ok`,
    [WORKER, `govai.${table}`, priv],
  );
  return r.rows[0]!.ok;
}

describe('0034 — the worker privilege matrix is EXACT', () => {
  it('M1 — the execution write surface is column-scoped to the five-commit protocol', async () => {
    // Every column here is written by a named commit; nothing is "while we are at it".
    expect(await columnPrivs('ai_conversation_attempts', 'UPDATE')).toEqual([
      'capture_id',
      'causal_version_at_build',
      'claim_deadline_at',
      'claim_token',
      'claimant',
      'context_excluded',
      'dispatch_boundary_committed_at',
      'error_class',
      'govai_request_id',
      'heartbeat_at',
      'provider_credential_id',
      'state',
      'terminal_at',
      'updated_at',
    ]);
    // ★ `stop_requested` is READABLE (it is a fence) but NOT WRITABLE: Stop is a REQUEST-plane
    // command, and P0-C ships none. Identity/lineage are unreachable by privilege as well as by
    // the 0031 guard trigger — belt AND braces.
    for (const col of [
      'stop_requested',
      'id',
      'org_id',
      'owner_user_id',
      'conversation_id',
      'branch_id',
      'turn_id',
      'attempt_seq',
      'created_at',
      'continuation_parent_ciphertext',
      'continuation_parent_dek_wrapped',
      'continuation_parent_kms_key_id',
      'continuation_parent_kms_key_version',
    ]) {
      const r = await db.adminPool.query<{ ok: boolean }>(
        `SELECT has_column_privilege($1, 'govai.ai_conversation_attempts', $2, 'UPDATE') AS ok`,
        [WORKER, col],
      );
      expect({ col, writable: r.rows[0]!.ok }).toEqual({ col, writable: false });
    }
  });

  it('M2 — the §11 continuation anchor stays UNREADABLE (P0-D is not pre-granted)', async () => {
    const selectable = await columnPrivs('ai_conversation_attempts', 'SELECT');
    for (const col of [
      'continuation_parent_ciphertext',
      'continuation_parent_dek_wrapped',
      'continuation_parent_kms_key_id',
      'continuation_parent_kms_key_version',
    ]) {
      expect({ col, readable: selectable.includes(col) }).toEqual({ col, readable: false });
    }
    // The columns P0-C DOES need are readable (0032 withheld them; 0034 adds exactly these).
    for (const col of ['provider_credential_id', 'govai_request_id', 'capture_id', 'causal_version_at_build']) {
      expect({ col, readable: selectable.includes(col) }).toEqual({ col, readable: true });
    }
  });

  it('M3 — ai_conversations: `mode` is readable, every TITLE column is not, and UPDATE is updated_at ONLY', async () => {
    const selectable = await columnPrivs('ai_conversations', 'SELECT');
    // `mode` is the IMMUTABLE execution lane a DETACHED dispatch must read from durable state.
    expect(selectable).toEqual(expect.arrayContaining(['id', 'org_id', 'owner_user_id', 'status', 'mode']));
    for (const col of [
      'title_ciphertext',
      'title_dek_wrapped',
      'title_kms_key_id',
      'title_kms_key_version',
      'title_hmac',
      'retention_class',
    ]) {
      expect({ col, readable: selectable.includes(col) }).toEqual({ col, readable: false });
    }
    // ★ The UPDATE grant exists ONLY so `FOR KEY SHARE` is legal (PostgreSQL raises
    // ACL_SELECT_FOR_UPDATE, defined as ACL_UPDATE, for any row-locking clause). Scoping it to
    // `updated_at` means the worker gains no lifecycle or title authority whatsoever.
    expect(await columnPrivs('ai_conversations', 'UPDATE')).toEqual(['updated_at']);
  });

  it('M4 — branches: read the execution triple, write ONLY the monotonic causal version', async () => {
    expect(await columnPrivs('ai_conversation_branches', 'UPDATE')).toEqual([
      'causal_version',
      'updated_at',
    ]);
    const selectable = await columnPrivs('ai_conversation_branches', 'SELECT');
    expect(selectable).toEqual(
      expect.arrayContaining(['provider', 'surface', 'model', 'causal_version']),
    );
    // The fork pins are read-only to the executor.
    for (const col of ['forked_from_turn_id', 'forked_from_attempt_id', 'boundary_mode']) {
      const r = await db.adminPool.query<{ ok: boolean }>(
        `SELECT has_column_privilege($1, 'govai.ai_conversation_branches', $2, 'UPDATE') AS ok`,
        [WORKER, col],
      );
      expect({ col, writable: r.rows[0]!.ok }).toEqual({ col, writable: false });
    }
  });

  it('M5 — turns: the config pointer is readable; the worker still cannot WRITE a turn at all', async () => {
    const selectable = await columnPrivs('ai_conversation_turns', 'SELECT');
    expect(selectable).toContain('native_request_config_content_id');
    expect(await hasTablePriv('ai_conversation_turns', 'UPDATE')).toBe(false);
    expect(await hasTablePriv('ai_conversation_turns', 'INSERT')).toBe(false);
  });

  it('M6 — NO DELETE, NO TRUNCATE, and NO attempt INSERT anywhere in the domain', async () => {
    for (const t of [
      'ai_conversations',
      'ai_conversation_branches',
      'ai_conversation_turns',
      'ai_conversation_attempts',
      'ai_conversation_items',
      'ai_conversation_content',
      'ai_conversation_provider_state',
      'ai_conversation_evidence_links',
      'provider_credentials',
      'orgs',
    ]) {
      expect({ t, del: await hasTablePriv(t, 'DELETE') }).toEqual({ t, del: false });
      expect({ t, trunc: await hasTablePriv(t, 'TRUNCATE') }).toEqual({ t, trunc: false });
    }
    // §9 is explicit: the worker holds SELECT/UPDATE on attempts and NOT INSERT — an attempt is
    // minted by the reservation or by retry, never by the executor.
    expect(await hasTablePriv('ai_conversation_attempts', 'INSERT')).toBe(false);
    // P0-C writes no continuation state (§23's P0-D wall).
    for (const p of ['SELECT', 'INSERT', 'UPDATE']) {
      expect({ p, ok: await hasTablePriv('ai_conversation_provider_state', p) }).toEqual({ p, ok: false });
    }
    // §14 link materialization is P0-F's closeout, not P0-C's.
    for (const p of ['SELECT', 'INSERT', 'UPDATE']) {
      expect({ p, ok: await hasTablePriv('ai_conversation_evidence_links', p) }).toEqual({ p, ok: false });
    }
  });

  it('M7 — credentials are SELECT-only and column-scoped; orgs is the tenant-facts pair only', async () => {
    expect(await hasTablePriv('provider_credentials', 'INSERT')).toBe(false);
    expect(await hasTablePriv('provider_credentials', 'UPDATE')).toBe(false);
    const credCols = await columnPrivs('provider_credentials', 'SELECT');
    expect(credCols.sort()).toEqual(
      ['ciphertext', 'dek_wrapped', 'id', 'kms_key_id', 'kms_key_version', 'org_id', 'provider', 'status'].sort(),
    );
    // Revocation metadata and the key fingerprint are NOT part of dispatch.
    for (const col of ['key_prefix', 'key_last4', 'revoked_at', 'revocation_reason']) {
      expect({ col, readable: credCols.includes(col) }).toEqual({ col, readable: false });
    }
    expect((await columnPrivs('orgs', 'SELECT')).sort()).toEqual(['id', 'operational_mode', 'tier']);
    expect(await hasTablePriv('orgs', 'UPDATE')).toBe(false);
  });

  it('M8 — the ONLY evidence-plane authority is EXECUTE on audit_capture_insert_locked', async () => {
    // ★ `has_function_privilege` is the WRONG probe here and an earlier revision of this test
    // used it: PostgreSQL grants EXECUTE to PUBLIC on every function by default, so it returns
    // true for all ~56 trigger functions in the schema and proves nothing about what THIS role
    // was granted. The ACL is the ground truth — an EXPLICIT grantee entry for the worker.
    const fns = await db.adminPool.query<{ fn: string }>(
      `SELECT DISTINCT p.proname AS fn
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN LATERAL aclexplode(p.proacl) a
         JOIN pg_roles r ON r.oid = a.grantee
        WHERE n.nspname = 'govai'
          AND r.rolname = $1
          AND a.privilege_type = 'EXECUTE'
        ORDER BY p.proname`,
      [WORKER],
    );
    // Exactly two: the discovery definer (0032) and the capture routine (0034). Nothing else —
    // no sealer claim/mark function, no shred, no org_tier_lookup.
    expect(fns.rows.map((r) => r.fn)).toEqual(['ai_turn_recovery_candidates', 'audit_capture_insert_locked']);
    // ★ NOT `org_tier_lookup`: that SECURITY DEFINER accepts ANY org id. The worker reads its
    // ENTERED org's tier through a column-scoped, org-scoped SELECT instead.
    expect(fns.rows.map((r) => r.fn)).not.toContain('org_tier_lookup');
    for (const t of ['audit_capture_outbox', 'audit_capture_chain_state', 'audit_events', 'audit_event_payloads']) {
      expect({ t, sel: await hasTablePriv(t, 'SELECT') }).toEqual({ t, sel: false });
    }
  });

  it('M9 — the role gained NO cluster-level attribute and owns NOTHING', async () => {
    const r = await db.adminPool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolinherit: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(
      `SELECT rolsuper, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole
         FROM pg_roles WHERE rolname = $1`,
      [WORKER],
    );
    expect(r.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
    const owns = await db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class c
         JOIN pg_roles r ON r.oid = c.relowner
        WHERE r.rolname = $1`,
      [WORKER],
    );
    expect(owns.rows[0]!.n).toBe('0');
    // And no membership path: govai_app must never be able to become the worker.
    const member = await db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_auth_members m
         JOIN pg_roles grantee ON grantee.oid = m.member
         JOIN pg_roles grole ON grole.oid = m.roleid
        WHERE grole.rolname = $1`,
      [WORKER],
    );
    expect(member.rows[0]!.n).toBe('0');
  });
});

describe('0034 — every grant has a POLICY, and every policy has a GRANT', () => {
  it('M10 — with an owner context the worker SEES rows; without one it sees ZERO', async () => {
    // A grant with no matching FORCE-RLS policy silently yields zero rows; a policy with no grant
    // is dead text. Only the pair is a capability, so both halves are exercised.
    const c = await worker.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.org_id', $1, true)", [owner.orgId]);
      await c.query("SELECT set_config('app.user_id', $1, true)", [owner.ownerUserId]);
      for (const [table, sql] of [
        ['attempts', `SELECT id FROM govai.ai_conversation_attempts WHERE id = $1::uuid`],
        ['branches', `SELECT id FROM govai.ai_conversation_branches WHERE conversation_id IS NOT NULL AND $1::uuid IS NOT NULL`],
      ] as const) {
        const r = await c.query(sql, [chain.attemptId]);
        expect({ table, seen: (r.rowCount ?? 0) > 0 }).toEqual({ table, seen: true });
      }
      // INSERT works under the owner context (content + items are the output write path).
      const ins = await c.query(
        `INSERT INTO govai.ai_conversation_content
           (org_id, owner_user_id, conversation_id, ciphertext, dek_wrapped, kms_key_id, kms_key_version, content_hmac)
         VALUES ($1::uuid, $2::uuid, $3::uuid, '\\x01'::bytea, '\\x02'::bytea, 'k', 1, decode(repeat('00',32),'hex'))
         RETURNING id`,
        [owner.orgId, owner.ownerUserId, chain.conversationId],
      );
      expect(ins.rowCount).toBe(1);
      await c.query('ROLLBACK');
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });

  it('M11 — a WRONG-OWNER context inside the SAME org writes and reads nothing', async () => {
    const c = await worker.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.org_id', $1, true)", [owner.orgId]);
      await c.query("SELECT set_config('app.user_id', $1, true)", [freshOwner().ownerUserId]);
      const seen = await c.query(`SELECT id FROM govai.ai_conversation_attempts WHERE id = $1::uuid`, [
        chain.attemptId,
      ]);
      expect(seen.rowCount).toBe(0); // dual-predicate: org alone is NOT enough
      const upd = await c.query(
        `UPDATE govai.ai_conversation_attempts SET updated_at = now() WHERE id = $1::uuid`,
        [chain.attemptId],
      );
      expect(upd.rowCount).toBe(0);
      // A WITH CHECK violation on INSERT, not a silent cross-owner write.
      await expect(
        c.query(
          `INSERT INTO govai.ai_conversation_content
             (org_id, owner_user_id, conversation_id, ciphertext, dek_wrapped, kms_key_id, kms_key_version, content_hmac)
           VALUES ($1::uuid, $2::uuid, $3::uuid, '\\x01'::bytea, '\\x02'::bytea, 'k', 1, decode(repeat('00',32),'hex'))`,
          [owner.orgId, owner.ownerUserId, chain.conversationId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK');
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });
});

describe('0034 — the migration text itself', () => {
  it('M12 — grants to EXACTLY one role, and never a forbidden verb', async () => {
    const sql = (await readFile(MIGRATION, 'utf8')).replace(/^\s*--.*$/gm, ' ');
    const grantees = [...sql.matchAll(/\bTO\s+(govai_[a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());
    expect([...new Set(grantees)]).toEqual([WORKER]);
    expect(/GRANT[\s\S]{0,200}?\bDELETE\b/i.test(sql)).toBe(false);
    expect(/GRANT[\s\S]{0,200}?\bTRUNCATE\b/i.test(sql)).toBe(false);
    expect(/BYPASSRLS|SUPERUSER|CREATEROLE|GRANT\s+ALL/i.test(sql)).toBe(false);
    // No PUBLIC anywhere, and no role membership.
    expect(/TO\s+PUBLIC/i.test(sql)).toBe(false);
    expect(/GRANT\s+govai_\w+\s+TO/i.test(sql)).toBe(false);
    // It fails LOUD if the role has not been created by bootstrap (the 0028/0032 shape).
    expect(sql).toContain('role govai_conversation_worker is absent');
  });

  it('M13 — it is RERUNNABLE: applying every migration twice is a no-op', async () => {
    // The repository applies ALL migrations on every `migrate()` run, so idempotency is not a
    // nicety — it is the contract. Re-running must not raise on a duplicate policy or grant.
    await expect(
      migrate(db.adminUrl, db.appPassword, undefined, undefined, db.conversationWorkerPassword),
    ).resolves.toBeUndefined();
    // ...and the privilege matrix is UNCHANGED afterwards (a re-run must not widen anything).
    expect(await columnPrivs('ai_conversations', 'UPDATE')).toEqual(['updated_at']);
    expect(await hasTablePriv('ai_conversation_attempts', 'INSERT')).toBe(false);
    expect(await hasTablePriv('ai_conversation_attempts', 'DELETE')).toBe(false);
  }, MIGRATION_TEST_TIMEOUT_MS);

  it('M14 — pre-existing P0-A1/P0-A2/P0-B rows survive the migration byte-identically', async () => {
    // The chain seeded BEFORE the re-run above is still intact and unmodified.
    const r = await db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
      [chain.attemptId],
    );
    expect(r.rows[0]!.n).toBe('1');
    // And govai_app's own matrix is untouched by 0034: still SELECT+INSERT on attempts, still no
    // UPDATE, still no DELETE.
    const app = await db.adminPool.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('govai_app','govai.ai_conversation_attempts','SELECT') AS sel,
              has_table_privilege('govai_app','govai.ai_conversation_attempts','INSERT') AS ins,
              has_table_privilege('govai_app','govai.ai_conversation_attempts','UPDATE') AS upd,
              has_table_privilege('govai_app','govai.ai_conversation_attempts','DELETE') AS del`,
    );
    expect(app.rows[0]).toEqual({ sel: true, ins: true, upd: false, del: false });
  });
});
