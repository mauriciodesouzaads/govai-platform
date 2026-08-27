// EP-AI-CONVERSATION-CONTINUITY-V1 P0-C — MIGRATION 0035 CONTRACT
//
// 0035 widens ONE CHECK constraint. That is a small change with a large obligation: the durable
// failure taxonomy is what §7.7's recovery arms read, so a value that means the wrong thing is
// worse than no value at all. This suite pins what the constraint now admits, what it still
// refuses, and — the part most likely to rot — that the two new values remain coupled to
// `failed` and cannot be attached to anything else.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPostgres, stopPostgres, migrate, type TestDb } from './setup.js';
import {
  freshOwner,
  seedConversation,
  seedTurn,
  seedAttempt,
  isCheckViolation,
  type OwnerIds,
} from './helpers/ai-conversation-seed.js';

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
  '0035_ai_conversation_local_failure_taxonomy.sql',
);

/** 0031's provider/transport vocabulary — unchanged by this migration. */
const PROVIDER_CLASSES = [
  'blocked',
  'auth_rejected',
  'request_too_large',
  'rate_limited',
  'credential_unavailable',
  'provider_error',
] as const;

/** P0-C's GovAI-local additions. */
const LOCAL_CLASSES = ['local_error', 'persistence_error'] as const;

let db: TestDb;
let owner: OwnerIds;
let conversationId: string;
let branchId: string;

/**
 * A fresh attempt driven to `dispatching`, ready to be terminalized.
 *
 * Each call takes the NEXT `turn_seq` on the branch — 0031's
 * `ai_conversation_turns_turn_seq_uniq` is per (org, owner, conversation, branch), so reusing 1
 * collides on the second call.
 */
let nextSeq = 0;
async function freshDispatchingAttempt(): Promise<string> {
  nextSeq += 1;
  const { turnId } = await seedTurn(db.adminPool, owner, conversationId, branchId, nextSeq);
  const attemptId = await seedAttempt(db.adminPool, owner, conversationId, branchId, turnId);
  await db.adminPool.query(
    `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
    [attemptId, turnId],
  );
  await db.adminPool.query(
    `UPDATE govai.ai_conversation_attempts
        SET claim_token = gen_random_uuid(), claimant = 'test',
            claim_deadline_at = now() + interval '5 minutes'
      WHERE id = $1::uuid`,
    [attemptId],
  );
  await db.adminPool.query(
    `UPDATE govai.ai_conversation_attempts
        SET state = 'dispatching', dispatch_boundary_committed_at = now(),
            govai_request_id = gen_random_uuid(), causal_version_at_build = 0
      WHERE id = $1::uuid`,
    [attemptId],
  );
  return attemptId;
}

beforeAll(async () => {
  db = await startPostgres();
  owner = freshOwner();
  const conv = await seedConversation(db.adminPool, owner);
  conversationId = conv.conversationId;
  branchId = conv.branchId;
}, 300_000);

afterAll(async () => {
  if (db) await stopPostgres(db);
});

describe('0035 — the error_class taxonomy admits exactly the intended set', () => {
  it('T1 — every 0031 provider/transport class is still accepted', async () => {
    for (const cls of PROVIDER_CLASSES) {
      const attemptId = await freshDispatchingAttempt();
      await db.adminPool.query(
        `UPDATE govai.ai_conversation_attempts
            SET state = 'failed', error_class = $2::text, terminal_at = now()
          WHERE id = $1::uuid`,
        [attemptId, cls],
      );
      const r = await db.adminPool.query<{ error_class: string }>(
        `SELECT error_class FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
        [attemptId],
      );
      expect({ cls, stored: r.rows[0]!.error_class }).toEqual({ cls, stored: cls });
    }
  });

  it('T2 — the two GovAI-local classes are accepted', async () => {
    for (const cls of LOCAL_CLASSES) {
      const attemptId = await freshDispatchingAttempt();
      await db.adminPool.query(
        `UPDATE govai.ai_conversation_attempts
            SET state = 'failed', error_class = $2::text, terminal_at = now()
          WHERE id = $1::uuid`,
        [attemptId, cls],
      );
      const r = await db.adminPool.query<{ error_class: string }>(
        `SELECT error_class FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
        [attemptId],
      );
      expect({ cls, stored: r.rows[0]!.error_class }).toEqual({ cls, stored: cls });
    }
  });

  it('T3 — an UNKNOWN class is still rejected: the set is widened, not opened', async () => {
    for (const bogus of ['local_failure', 'persistence_failed', 'unknown', 'LOCAL_ERROR', '']) {
      const attemptId = await freshDispatchingAttempt();
      await expect(
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts
              SET state = 'failed', error_class = $2::text, terminal_at = now()
            WHERE id = $1::uuid`,
          [attemptId, bogus],
        ),
      ).rejects.toSatisfy(isCheckViolation);
    }
  });

  it('T4 — ★ the new classes remain COUPLED to `failed`, in both directions', async () => {
    // 0031's `failed <=> error_class` pair is untouched by this migration, and that coupling is
    // what stops a "local failure" being pinned onto a completed or ambiguous attempt.
    const a = await freshDispatchingAttempt();
    // class without `failed` — refused.
    await expect(
      db.adminPool.query(
        `UPDATE govai.ai_conversation_attempts
            SET state = 'streaming', error_class = 'persistence_error'
          WHERE id = $1::uuid`,
        [a],
      ),
    ).rejects.toSatisfy(isCheckViolation);

    // `failed` without a class — still refused.
    const b = await freshDispatchingAttempt();
    await expect(
      db.adminPool.query(
        `UPDATE govai.ai_conversation_attempts
            SET state = 'failed', terminal_at = now()
          WHERE id = $1::uuid`,
        [b],
      ),
    ).rejects.toSatisfy(isCheckViolation);
  });

  it('T5 — ★ `outcome_unknown` still cannot carry ANY error_class', async () => {
    // The whole point of the new values is that they are NOT `outcome_unknown`. The schema keeps
    // that separation: an ambiguous attempt carries no taxonomy value at all, so nothing can
    // quietly record "unknown, and also a local failure".
    const attemptId = await freshDispatchingAttempt();
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET provider_credential_id = (SELECT id FROM govai.provider_credentials LIMIT 1)
        WHERE id = $1::uuid`,
      [attemptId],
    );
    for (const cls of [...LOCAL_CLASSES, 'provider_error']) {
      await expect(
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts
              SET state = 'outcome_unknown', error_class = $2::text, terminal_at = now()
            WHERE id = $1::uuid`,
          [attemptId, cls],
        ),
      ).rejects.toSatisfy(isCheckViolation);
    }
  });
});

describe('0035 — migration shape and safety', () => {
  it('T6 — exactly ONE enum CHECK exists on error_class after the migration', async () => {
    // The migration DROPS whatever enum CHECK it finds and ADDS one canonical, explicitly-named
    // constraint. Two would mean the drop loop missed one and the column carries a stale
    // narrower rule that silently forbids the new values.
    const r = await db.adminPool.query<{ conname: string; def: string }>(
      `SELECT con.conname, pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        WHERE ns.nspname = 'govai'
          AND rel.relname = 'ai_conversation_attempts'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) LIKE '%''provider_error''%'`,
    );
    expect(r.rowCount).toBe(1);
    expect(r.rows[0]!.conname).toBe('ai_conversation_attempts_error_class_check');
    for (const cls of [...PROVIDER_CLASSES, ...LOCAL_CLASSES]) {
      expect({ cls, present: r.rows[0]!.def.includes(`'${cls}'`) }).toEqual({ cls, present: true });
    }
  });

  it('T7 — the 0031 `failed <=> class` constraints were NOT dropped by the loop', async () => {
    // The drop loop keys on `'provider_error'` appearing in the definition precisely so these
    // two — which mention `error_class` but no enum member — are never matched.
    const r = await db.adminPool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        WHERE ns.nspname = 'govai' AND rel.relname = 'ai_conversation_attempts'
          AND conname IN ('ai_conversation_attempts_failed_class_check',
                          'ai_conversation_attempts_error_class_failed_check')
        ORDER BY conname`,
    );
    expect(r.rows.map((x) => x.conname)).toEqual([
      'ai_conversation_attempts_error_class_failed_check',
      'ai_conversation_attempts_failed_class_check',
    ]);
  });

  it('T8 — RERUNNABLE: applying every migration again converges, and widens nothing further', async () => {
    await expect(
      migrate(db.adminUrl, db.appPassword, undefined, undefined, db.conversationWorkerPassword),
    ).resolves.toBeUndefined();
    const r = await db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        WHERE ns.nspname = 'govai' AND rel.relname = 'ai_conversation_attempts'
          AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%''provider_error''%'`,
    );
    expect(r.rows[0]!.n).toBe('1');
    // Still exactly the intended set — a rerun must not add or lose a member.
    const attemptId = await freshDispatchingAttempt();
    await expect(
      db.adminPool.query(
        `UPDATE govai.ai_conversation_attempts
            SET state = 'failed', error_class = 'nonsense', terminal_at = now()
          WHERE id = $1::uuid`,
        [attemptId],
      ),
    ).rejects.toSatisfy(isCheckViolation);
  });

  it('T9 — PRE-EXISTING rows survive the widening untouched', async () => {
    // The change only WIDENS an accepted set, so every already-stored value still satisfies it
    // and no backfill is involved. Rows written under 0031's narrower rule are still readable
    // and still carry exactly what they carried.
    const attemptId = await freshDispatchingAttempt();
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET state = 'failed', error_class = 'rate_limited', terminal_at = now()
        WHERE id = $1::uuid`,
      [attemptId],
    );
    await migrate(db.adminUrl, db.appPassword, undefined, undefined, db.conversationWorkerPassword);
    const r = await db.adminPool.query<{ state: string; error_class: string }>(
      `SELECT state, error_class FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
      [attemptId],
    );
    expect(r.rows[0]).toEqual({ state: 'failed', error_class: 'rate_limited' });
  });

  it('T10 — the migration adds NO grant, policy, table, column, index or function', async () => {
    const sql = (await readFile(MIGRATION, 'utf8')).replace(/^\s*--.*$/gm, ' ');
    for (const forbidden of [
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
      /CREATE\s+POLICY/i,
      /CREATE\s+TABLE/i,
      /ADD\s+COLUMN/i,
      /CREATE\s+(UNIQUE\s+)?INDEX/i,
      /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i,
      /CREATE\s+TRIGGER/i,
      /\bDELETE\b/i,
      /\bTRUNCATE\b/i,
      /BYPASSRLS|SUPERUSER/i,
    ]) {
      expect({ pattern: String(forbidden), hit: forbidden.test(sql) }).toEqual({
        pattern: String(forbidden),
        hit: false,
      });
    }
    // It fails LOUD rather than leaving the column unconstrained if 0031's CHECK is absent.
    expect(sql).toContain('no error_class enum CHECK found to replace');
  });

  it('T11 — the WORKER can write the new classes with no new grant', async () => {
    // `error_class` is already inside 0034's column-scoped worker UPDATE, which is why 0035 needs
    // no privilege change at all. Asserted rather than assumed.
    const r = await db.adminPool.query<{ ok: boolean }>(
      `SELECT has_column_privilege('govai_conversation_worker',
                'govai.ai_conversation_attempts', 'error_class', 'UPDATE') AS ok`,
    );
    expect(r.rows[0]!.ok).toBe(true);
  });
});
