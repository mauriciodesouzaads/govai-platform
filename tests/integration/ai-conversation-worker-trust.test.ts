// EP-AI-CONVERSATION-CONTINUITY-V1 P0-A2 — the DETACHED WORKER TRUST BOUNDARY, proven against a
// real Postgres with three live database identities (admin, govai_app, govai_conversation_worker).
//
// Spec: docs/architecture/ai-conversation-continuity-v1.md §9 (worker identity separation,
// owner-discovery non-impersonation, worker least privilege under FORCE RLS), §24 LAW 11.
//
// The safety asserted here is largely the ABSENCE of authority (the INV-1 doctrine of
// evidence-enumerator.test.ts): a grant that was never made is invisible in a diff but decisive
// at runtime, so it is asserted IN THE DATABASE.
//
//  W1  worker role attributes (NOINHERIT, no LOGIN until provisioned, no superuser/BYPASSRLS)
//  W2  govai_app cannot EXECUTE recovery discovery
//  W3  govai_app cannot SET ROLE to the worker, by any membership path
//  W4  PUBLIC holds no EXECUTE on discovery
//  W5  the worker's ordinary reads return ZERO ROWS with no owner context (never an error)
//  W6  the owner dual-context matrix (positive + four negatives)
//  W7  no cross-candidate context leakage on ONE pooled physical connection
//  W8  the worker privilege matrix — every table, every verb
//  W9  the worker holds no EXECUTE on any other SECURITY DEFINER function
//  W10 column-scoped grants: ciphertext / wrapped DEK / continuation anchor / credential
//      provenance are unreachable, and `SELECT *` is denied
//  W11 the SECURITY DEFINER function is hardened (owner, search_path, volatility)
//  W12 govai_app's existing owner RLS is unchanged by this movement
//  W13 the pool factory fails closed with no worker URL — it never falls back to the app
//      credential
//  W14 the defensive checkout reset clears session-scope residue

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client, Pool } from 'pg';
import { startPostgres, stopPostgres, migrate, type TestDb } from './setup.js';
import {
  freshOwner,
  seedFullChain,
  seedConversation,
  type OwnerIds,
} from './helpers/ai-conversation-seed.js';
import {
  createConversationWorkerPool,
  loadConversationWorkerDbConfig,
  resetOwnerContext,
  withConversationWorkerOwnerContext,
  ConversationWorkerConfigError,
  CONVERSATION_WORKER_DATABASE_URL_ENV,
} from '../../apps/api/src/pipeline/ai-conversation-worker.js';

const WORKER_ROLE = 'govai_conversation_worker';
const DISCOVERY_FN = 'govai.ai_turn_recovery_candidates(integer,integer,timestamptz,uuid)';

/**
 * Every table in the worker's blast-radius question, with the P0-A2 expectation.
 * `select` here means COLUMN-level SELECT on at least one column: 0032 grants the worker
 * COLUMN-scoped SELECT (the 0028 precedent), so TABLE-level SELECT is false EVERYWHERE — which
 * the matrix asserts separately, and which is a strictly stronger statement of least privilege.
 */
const TABLE_MATRIX: ReadonlyArray<{ table: string; select: boolean }> = [
  { table: 'ai_conversations', select: true },
  { table: 'ai_conversation_turns', select: true },
  { table: 'ai_conversation_attempts', select: true },
  { table: 'ai_conversation_branches', select: false },
  { table: 'ai_conversation_items', select: false },
  { table: 'ai_conversation_content', select: false },
  { table: 'ai_conversation_provider_state', select: false },
  { table: 'ai_conversation_evidence_links', select: false },
  // Outside the conversation domain: the worker holds NOTHING in P0-A2.
  { table: 'provider_credentials', select: false },
  { table: 'audit_events', select: false },
  { table: 'audit_capture_outbox', select: false },
  { table: 'runs', select: false },
  { table: 'orgs', select: false },
];

let db: TestDb;
let workerPool: Pool;
let ownerA: OwnerIds;
let ownerB: OwnerIds; // same org as A, different owner
let ownerC: OwnerIds; // different org
let chainA: Awaited<ReturnType<typeof seedFullChain>>;

beforeAll(async () => {
  db = await startPostgres();
  // The role ships NOLOGIN (unprovisioned). Assert that BEFORE provisioning it — the
  // no-login-until-provisioned state is part of the contract, not an accident of ordering.
  const pre = await db.adminPool.query<{ rolcanlogin: boolean }>(
    `SELECT rolcanlogin FROM pg_roles WHERE rolname = $1`,
    [WORKER_ROLE],
  );
  expect(pre.rows[0]?.rolcanlogin).toBe(false);
  const preConnect = new Client({ connectionString: db.conversationWorkerUrl });
  await expect(preConnect.connect()).rejects.toThrow();
  await preConnect.end().catch(() => undefined);

  // Provision LOGIN through the SAME shared lifecycle the production runner uses.
  await migrate(
    db.adminUrl,
    db.appPassword,
    undefined,
    undefined,
    db.conversationWorkerPassword,
  );
  workerPool = createConversationWorkerPool({ connectionString: db.conversationWorkerUrl }, () => undefined);

  ownerA = freshOwner();
  ownerB = { orgId: ownerA.orgId, ownerUserId: freshOwner().ownerUserId };
  ownerC = freshOwner();
  chainA = await seedFullChain(db.adminPool, ownerA);
  await seedConversation(db.adminPool, ownerB);
  await seedConversation(db.adminPool, ownerC);
}, 300_000);

afterAll(async () => {
  await workerPool?.end().catch(() => undefined);
  if (db) await stopPostgres(db);
});

describe('P0-A2 — detached conversation worker trust boundary', () => {
  it('W1 — the worker role is NOINHERIT, not superuser, not BYPASSRLS, and owns nothing', async () => {
    const r = await db.adminPool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolinherit: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
    }>(
      `SELECT rolsuper, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole, rolreplication
         FROM pg_roles WHERE rolname = $1`,
      [WORKER_ROLE],
    );
    const role = r.rows[0];
    expect(role).toBeDefined();
    expect(role!.rolsuper).toBe(false);
    expect(role!.rolbypassrls).toBe(false); // ★ MISSION-CRITICAL: no RLS bypass on the identity
    expect(role!.rolinherit).toBe(false); // NOINHERIT, the house dedicated-role convention
    expect(role!.rolcreatedb).toBe(false);
    expect(role!.rolcreaterole).toBe(false);
    expect(role!.rolreplication).toBe(false);

    // Owns no relation and no routine in the govai schema.
    const owned = await db.adminPool.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'govai' AND pg_get_userbyid(c.relowner) = $1)
            + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'govai' AND pg_get_userbyid(p.proowner) = $1) AS n`,
      [WORKER_ROLE],
    );
    expect(owned.rows[0]!.n).toBe('0');

    // No CREATE on the schema — it cannot install objects, nor CREATE OR REPLACE the definer fn.
    const create = await db.adminPool.query<{ can_create: boolean }>(
      `SELECT has_schema_privilege($1, 'govai', 'CREATE') AS can_create`,
      [WORKER_ROLE],
    );
    expect(create.rows[0]!.can_create).toBe(false);
  });

  it('W2 — govai_app cannot EXECUTE the recovery discovery function', async () => {
    const c = await db.appPool.connect();
    try {
      await expect(
        c.query(`SELECT * FROM govai.ai_turn_recovery_candidates(30000, 10)`),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      c.release();
    }
    const cat = await db.adminPool.query<{ app_exec: boolean }>(
      `SELECT has_function_privilege('govai_app', $1, 'EXECUTE') AS app_exec`,
      [DISCOVERY_FN],
    );
    expect(cat.rows[0]!.app_exec).toBe(false);
  });

  it('W3 — govai_app cannot SET ROLE to the worker, by any membership path', async () => {
    const c = await db.appPool.connect();
    try {
      await expect(c.query(`SET ROLE ${WORKER_ROLE}`)).rejects.toMatchObject({ code: '42501' });
    } finally {
      c.release();
    }
    // Catalog proof, both privilege senses — pg_has_role follows the FULL (transitive) role
    // graph, so this also excludes indirect membership through any intermediate role.
    const r = await db.adminPool.query<{ usage: boolean; member: boolean; set_role: boolean }>(
      `SELECT pg_has_role('govai_app', $1, 'USAGE')  AS usage,
              pg_has_role('govai_app', $1, 'MEMBER') AS member,
              pg_has_role('govai_app', $1, 'SET')    AS set_role`,
      [WORKER_ROLE],
    );
    expect(r.rows[0]).toEqual({ usage: false, member: false, set_role: false });

    // And the reverse direction: the worker is not a member of govai_app either.
    const rev = await db.adminPool.query<{ member: boolean }>(
      `SELECT pg_has_role($1, 'govai_app', 'MEMBER') AS member`,
      [WORKER_ROLE],
    );
    expect(rev.rows[0]!.member).toBe(false);

    // No role anywhere in the cluster is a member of the worker.
    const members = await db.adminPool.query<{ member: string }>(
      `SELECT m.rolname AS member
         FROM pg_auth_members am
         JOIN pg_roles r ON r.oid = am.roleid
         JOIN pg_roles m ON m.oid = am.member
        WHERE r.rolname = $1`,
      [WORKER_ROLE],
    );
    expect(members.rows.map((x) => x.member)).toEqual([]);

    // ★ The OTHER door into cross-owner conversation rows: 0032 gives the SECURITY DEFINER's
    // owner (govai_audit_writer) three narrow SELECT policies, so "can any ordinary identity
    // become that role?" is now a load-bearing question. Neither the request role nor the
    // worker can.
    for (const from of ['govai_app', WORKER_ROLE]) {
      const reach = await db.adminPool.query<{ usage: boolean; member: boolean; set_role: boolean }>(
        `SELECT pg_has_role($1, 'govai_audit_writer', 'USAGE')  AS usage,
                pg_has_role($1, 'govai_audit_writer', 'MEMBER') AS member,
                pg_has_role($1, 'govai_audit_writer', 'SET')    AS set_role`,
        [from],
      );
      expect({ from, ...reach.rows[0]! }).toEqual({
        from,
        usage: false,
        member: false,
        set_role: false,
      });
    }
    const appToWriter = await db.appPool.connect();
    try {
      await expect(appToWriter.query(`SET ROLE govai_audit_writer`)).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      appToWriter.release();
    }
    const workerToWriter = await workerPool.connect();
    try {
      await expect(workerToWriter.query(`SET ROLE govai_audit_writer`)).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      workerToWriter.release();
    }
    // govai_audit_writer itself remains NOLOGIN: it is reachable only through a definer call.
    const writer = await db.adminPool.query<{ rolcanlogin: boolean; rolbypassrls: boolean }>(
      `SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'govai_audit_writer'`,
    );
    expect(writer.rows[0]).toEqual({ rolcanlogin: false, rolbypassrls: false });
  });

  it('W4 — PUBLIC holds no EXECUTE on the discovery function', async () => {
    const r = await db.adminPool.query<{ public_exec: boolean; grantees: string[] }>(
      `SELECT has_function_privilege('public', $1, 'EXECUTE') AS public_exec,
              ARRAY(SELECT DISTINCT grantee::text FROM information_schema.routine_privileges
                     WHERE routine_schema = 'govai'
                       AND routine_name = 'ai_turn_recovery_candidates'
                     ORDER BY grantee::text)::text[] AS grantees`,
      [DISCOVERY_FN],
    );
    expect(r.rows[0]!.public_exec).toBe(false);
    // Exactly two grantees: the definer's owner (implicit) and the worker. Nobody else, ever.
    expect(r.rows[0]!.grantees).toEqual(['govai_audit_writer', WORKER_ROLE]);
  });

  it('W5 — with NO owner context the worker reads ZERO ROWS (not an error)', async () => {
    const c = await workerPool.connect();
    try {
      await resetOwnerContext(c);
      for (const q of [
        'SELECT id FROM govai.ai_conversations',
        'SELECT id FROM govai.ai_conversation_turns',
        'SELECT id FROM govai.ai_conversation_attempts',
      ]) {
        const r = await c.query(q);
        expect(r.rowCount).toBe(0);
      }
    } finally {
      c.release();
    }
  });

  it('W6 — the owner dual-context matrix: only the exact (org, owner) pair resolves rows', async () => {
    const count = async (orgId: string, userId: string): Promise<number> =>
      withConversationWorkerOwnerContext(workerPool, { orgId, ownerUserId: userId }, async (tx) => {
        const r = await tx.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
          chainA.conversationId,
        ]);
        return r.rowCount ?? 0;
      });

    expect(await count(ownerA.orgId, ownerA.ownerUserId)).toBe(1); // correct pair
    expect(await count(ownerA.orgId, ownerB.ownerUserId)).toBe(0); // same org, wrong owner
    expect(await count(ownerC.orgId, ownerA.ownerUserId)).toBe(0); // wrong org, right owner
    expect(await count(ownerC.orgId, ownerC.ownerUserId)).toBe(0); // an unrelated owner

    // Partial context: org-only and user-only each yield zero rows, never an error.
    const partial = async (set: 'org' | 'user'): Promise<number> => {
      const c = await workerPool.connect();
      try {
        await resetOwnerContext(c);
        await c.query('BEGIN');
        await c.query(
          set === 'org'
            ? "SELECT set_config('app.org_id', $1, true)"
            : "SELECT set_config('app.user_id', $1, true)",
          [set === 'org' ? ownerA.orgId : ownerA.ownerUserId],
        );
        const r = await c.query(`SELECT id FROM govai.ai_conversations`);
        await c.query('COMMIT');
        return r.rowCount ?? 0;
      } finally {
        c.release();
      }
    };
    expect(await partial('org')).toBe(0);
    expect(await partial('user')).toBe(0);
  });

  it('W7 — no cross-candidate context leakage on ONE pooled physical connection', async () => {
    const chainC = await seedFullChain(db.adminPool, ownerC);
    // max: 1 forces every checkout onto the SAME physical connection.
    const single = createConversationWorkerPool(
      { connectionString: db.conversationWorkerUrl, max: 1 },
      () => undefined,
    );
    try {
      const pidOf = async (): Promise<number> => {
        const c = await single.connect();
        try {
          const r = await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          return r.rows[0]!.pid;
        } finally {
          c.release();
        }
      };
      const pid1 = await pidOf();

      // Candidate A: sees only A.
      const seenA = await withConversationWorkerOwnerContext(single, {
        orgId: ownerA.orgId,
        ownerUserId: ownerA.ownerUserId,
      }, async (tx) => {
        const mine = await tx.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
          chainA.conversationId,
        ]);
        const theirs = await tx.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
          chainC.conversationId,
        ]);
        return { mine: mine.rowCount ?? 0, theirs: theirs.rowCount ?? 0 };
      });
      expect(seenA).toEqual({ mine: 1, theirs: 0 });

      // Between candidates, on the SAME connection: context is gone and nothing is visible.
      const between = await single.connect();
      try {
        const gucs = await between.query<{ org: string | null; usr: string | null }>(
          `SELECT current_setting('app.org_id', true) AS org,
                  current_setting('app.user_id', true) AS usr`,
        );
        expect(gucs.rows[0]!.org === '' || gucs.rows[0]!.org === null).toBe(true);
        expect(gucs.rows[0]!.usr === '' || gucs.rows[0]!.usr === null).toBe(true);
        const rows = await between.query(`SELECT id FROM govai.ai_conversations`);
        expect(rows.rowCount).toBe(0);
      } finally {
        between.release();
      }

      // Candidate C on the SAME physical connection: sees only C.
      const seenC = await withConversationWorkerOwnerContext(single, {
        orgId: ownerC.orgId,
        ownerUserId: ownerC.ownerUserId,
      }, async (tx) => {
        const mine = await tx.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
          chainC.conversationId,
        ]);
        const theirs = await tx.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
          chainA.conversationId,
        ]);
        return { mine: mine.rowCount ?? 0, theirs: theirs.rowCount ?? 0 };
      });
      expect(seenC).toEqual({ mine: 1, theirs: 0 });

      // A ROLLBACK path clears the context just as a COMMIT does.
      await expect(
        withConversationWorkerOwnerContext(single, {
          orgId: ownerA.orgId,
          ownerUserId: ownerA.ownerUserId,
        }, async () => {
          throw new Error('forced rollback');
        }),
      ).rejects.toThrow('forced rollback');
      const after = await single.connect();
      try {
        const r = await after.query(`SELECT id FROM govai.ai_conversations`);
        expect(r.rowCount).toBe(0);
      } finally {
        after.release();
      }
      expect(await pidOf()).toBe(pid1); // it really was one physical connection throughout
    } finally {
      await single.end().catch(() => undefined);
    }
  });

  it('W8 — worker privilege matrix: column-scoped SELECT on exactly three tables, no write verb', async () => {
    for (const { table, select } of TABLE_MATRIX) {
      const r = await db.adminPool.query<{
        table_sel: boolean;
        col_sel: boolean;
        ins: boolean;
        col_ins: boolean;
        upd: boolean;
        col_upd: boolean;
        del: boolean;
        trunc: boolean;
      }>(
        `SELECT has_table_privilege($1, 'govai.' || $2, 'SELECT')            AS table_sel,
                has_any_column_privilege($1, 'govai.' || $2, 'SELECT')       AS col_sel,
                has_table_privilege($1, 'govai.' || $2, 'INSERT')            AS ins,
                has_any_column_privilege($1, 'govai.' || $2, 'INSERT')       AS col_ins,
                has_table_privilege($1, 'govai.' || $2, 'UPDATE')            AS upd,
                has_any_column_privilege($1, 'govai.' || $2, 'UPDATE')       AS col_upd,
                has_table_privilege($1, 'govai.' || $2, 'DELETE')            AS del,
                has_table_privilege($1, 'govai.' || $2, 'TRUNCATE')          AS trunc`,
        [WORKER_ROLE, table],
      );
      expect({ table, ...r.rows[0]! }).toEqual({
        table,
        // ★ TABLE-level SELECT is false even on the three granted tables: the grant is
        // COLUMN-scoped, so a column added later is not silently readable.
        table_sel: false,
        col_sel: select,
        ins: false,
        col_ins: false,
        upd: false,
        col_upd: false,
        del: false,
        trunc: false,
      });
    }
    // Nothing was pre-granted for a future movement: the worker holds no privilege — at table
    // OR column granularity — on ANY other relation in the govai schema.
    const stray = await db.adminPool.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'govai' AND c.relkind IN ('r','v','m','p')
          AND (has_any_column_privilege($1, c.oid, 'SELECT')
            OR has_any_column_privilege($1, c.oid, 'INSERT')
            OR has_any_column_privilege($1, c.oid, 'UPDATE')
            OR has_table_privilege($1, c.oid, 'DELETE')
            OR has_table_privilege($1, c.oid, 'TRUNCATE'))
        ORDER BY c.relname`,
      [WORKER_ROLE],
    );
    expect(stray.rows.map((r) => r.relname)).toEqual([
      'ai_conversation_attempts',
      'ai_conversation_turns',
      'ai_conversations',
    ]);
  });

  it('W9 — the worker holds EXECUTE on exactly ONE SECURITY DEFINER function', async () => {
    const r = await db.adminPool.query<{ proname: string }>(
      `SELECT p.proname
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'govai' AND p.prosecdef
          AND has_function_privilege($1, p.oid, 'EXECUTE')
        ORDER BY p.proname`,
      [WORKER_ROLE],
    );
    expect(r.rows.map((x) => x.proname)).toEqual(['ai_turn_recovery_candidates']);
    // Named negatives for the capabilities a later movement will need but must NOT hold yet.
    for (const fn of [
      'audit_capture_insert_locked',
      'audit_capture_claim_for_seal',
      'audit_append_locked',
      'org_tier_lookup',
      'run_dispatch_recovery_candidates',
      'audit_event_payload_crypto_shred',
    ]) {
      const one = await db.adminPool.query<{ can: boolean | null }>(
        `SELECT bool_or(has_function_privilege($1, p.oid, 'EXECUTE')) AS can
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'govai' AND p.proname = $2`,
        [WORKER_ROLE, fn],
      );
      expect({ fn, can: one.rows[0]?.can }).toEqual({ fn, can: false });
    }
  });

  it('W10 — column-scoped grants: content, anchors and provenance are unreachable', async () => {
    const c = await workerPool.connect();
    try {
      // `SELECT *` is denied on every granted table — the grant is column-scoped, so a column
      // added by a later migration is not silently readable.
      for (const t of [
        'govai.ai_conversations',
        'govai.ai_conversation_turns',
        'govai.ai_conversation_attempts',
      ]) {
        await expect(c.query(`SELECT * FROM ${t} LIMIT 1`)).rejects.toMatchObject({ code: '42501' });
      }
      // Named forbidden columns, one denial each.
      const denied: ReadonlyArray<[string, string]> = [
        ['govai.ai_conversations', 'title_ciphertext'],
        ['govai.ai_conversations', 'title_dek_wrapped'],
        ['govai.ai_conversations', 'title_hmac'],
        ['govai.ai_conversations', 'mode'],
        ['govai.ai_conversation_turns', 'native_request_config_content_id'],
        ['govai.ai_conversation_attempts', 'continuation_parent_ciphertext'],
        ['govai.ai_conversation_attempts', 'continuation_parent_dek_wrapped'],
        ['govai.ai_conversation_attempts', 'provider_credential_id'],
        ['govai.ai_conversation_attempts', 'govai_request_id'],
        ['govai.ai_conversation_attempts', 'capture_id'],
        ['govai.ai_conversation_attempts', 'causal_version_at_build'],
      ];
      for (const [table, col] of denied) {
        await expect(c.query(`SELECT ${col} FROM ${table} LIMIT 1`)).rejects.toMatchObject({
          code: '42501',
        });
      }
      // The claim plane the movement DOES need still reads (zero rows without context).
      const ok = await c.query(
        `SELECT a.id, a.state, a.claim_token, a.claim_deadline_at, a.stop_requested,
                a.dispatch_boundary_committed_at
           FROM govai.ai_conversation_attempts a`,
      );
      expect(ok.rowCount).toBe(0);
    } finally {
      c.release();
    }
  });

  it('W11 — the SECURITY DEFINER function is hardened', async () => {
    const r = await db.adminPool.query<{
      owner: string;
      prosecdef: boolean;
      provolatile: string;
      proconfig: string[] | null;
      prosrc: string;
    }>(
      `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.provolatile, p.proconfig, p.prosrc
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'govai' AND p.proname = 'ai_turn_recovery_candidates'`,
    );
    expect(r.rowCount).toBe(1);
    const fn = r.rows[0]!;
    expect(fn.prosecdef).toBe(true);
    expect(fn.provolatile).toBe('s'); // STABLE — it cannot write
    // Owned by the schema owner: NOT govai_app, NOT the worker (so neither can replace it).
    expect(fn.owner).toBe('govai_audit_writer');
    expect(fn.owner).not.toBe('govai_app');
    expect(fn.owner).not.toBe(WORKER_ROLE);
    // A FIXED search_path is mandatory on a definer function.
    expect(fn.proconfig).toContain('search_path=pg_catalog, pg_temp');
    // No dynamic SQL: a definer body must not build statements from strings.
    expect(fn.prosrc).not.toMatch(/\bEXECUTE\s+(format|'|")/i);
  });

  it('W12 — govai_app owner RLS is unchanged: still SELECT+INSERT, still dual-predicate', async () => {
    const r = await db.adminPool.query<{
      sel: boolean;
      ins: boolean;
      upd: boolean;
      del: boolean;
    }>(
      `SELECT has_table_privilege('govai_app', 'govai.ai_conversations', 'SELECT') AS sel,
              has_table_privilege('govai_app', 'govai.ai_conversations', 'INSERT') AS ins,
              has_table_privilege('govai_app', 'govai.ai_conversations', 'UPDATE') AS upd,
              has_table_privilege('govai_app', 'govai.ai_conversations', 'DELETE') AS del`,
    );
    expect(r.rows[0]).toEqual({ sel: true, ins: true, upd: false, del: false });

    // The app path still resolves only its own owner's rows, and no worker policy widened it.
    const c = await db.appPool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.org_id', $1, true)", [ownerA.orgId]);
      await c.query("SELECT set_config('app.user_id', $1, true)", [ownerB.ownerUserId]);
      const cross = await c.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
        chainA.conversationId,
      ]);
      expect(cross.rowCount).toBe(0); // same org, other owner — still invisible
      await c.query("SELECT set_config('app.user_id', $1, true)", [ownerA.ownerUserId]);
      const own = await c.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
        chainA.conversationId,
      ]);
      expect(own.rowCount).toBe(1);
      await c.query('COMMIT');
    } finally {
      c.release();
    }

    // Every P0-A2 policy added to the ai_* domain is a SELECT policy for one of exactly two
    // roles, and none of them is govai_app.
    const pol = await db.adminPool.query<{ policyname: string; cmd: string; roles: string }>(
      `SELECT policyname, cmd, roles::text AS roles
         FROM pg_policies
        WHERE schemaname = 'govai' AND tablename LIKE 'ai_conversation%'
          AND (policyname LIKE '%_recovery_select_writer' OR policyname LIKE '%_conversation_worker')
        ORDER BY policyname`,
    );
    expect(pol.rowCount).toBe(6);
    for (const p of pol.rows) {
      expect(p.cmd).toBe('SELECT');
      expect(p.roles).not.toContain('govai_app');
      expect(p.roles).not.toContain('public');
    }
  });

  it('W13 — the pool factory fails closed with no worker URL (never the app credential)', () => {
    expect(() => loadConversationWorkerDbConfig({})).toThrow(ConversationWorkerConfigError);
    expect(() =>
      loadConversationWorkerDbConfig({ [CONVERSATION_WORKER_DATABASE_URL_ENV]: '' }),
    ).toThrow(ConversationWorkerConfigError);
    // A DATABASE_URL in the environment is NOT a fallback.
    expect(() => loadConversationWorkerDbConfig({ DATABASE_URL: db.appUrl })).toThrow(
      ConversationWorkerConfigError,
    );
    const cfg = loadConversationWorkerDbConfig({
      [CONVERSATION_WORKER_DATABASE_URL_ENV]: db.conversationWorkerUrl,
      GOVAI_CONVERSATION_WORKER_POOL_MAX: '3',
      GOVAI_CONVERSATION_WORKER_ID: 'w-1',
    });
    expect(cfg).toEqual({
      connectionString: db.conversationWorkerUrl,
      max: 3,
      workerId: 'w-1',
    });
    expect(() =>
      loadConversationWorkerDbConfig({
        [CONVERSATION_WORKER_DATABASE_URL_ENV]: db.conversationWorkerUrl,
        GOVAI_CONVERSATION_WORKER_POOL_MAX: '0',
      }),
    ).toThrow(ConversationWorkerConfigError);
  });

  it('W14 — the defensive checkout reset clears SESSION-scope residue', async () => {
    const single = createConversationWorkerPool(
      { connectionString: db.conversationWorkerUrl, max: 1 },
      () => undefined,
    );
    try {
      // Simulate a leak: a previous user of this connection set the GUCs at SESSION scope
      // (is_local = false) outside any transaction, so no COMMIT/ROLLBACK will clear them.
      const dirty = await single.connect();
      try {
        await dirty.query("SELECT set_config('app.org_id', $1, false)", [ownerA.orgId]);
        await dirty.query("SELECT set_config('app.user_id', $1, false)", [ownerA.ownerUserId]);
        const leaked = await dirty.query(`SELECT id FROM govai.ai_conversations`);
        expect(leaked.rowCount).toBeGreaterThan(0); // the residue really is dangerous
      } finally {
        dirty.release();
      }
      // The next checkout resets before doing anything, so candidate B starts clean.
      const clean = await single.connect();
      try {
        await resetOwnerContext(clean);
        const r = await clean.query(`SELECT id FROM govai.ai_conversations`);
        expect(r.rowCount).toBe(0);
      } finally {
        clean.release();
      }
      // And the helper does it on every entry: an owner-context transaction never inherits.
      const dirty2 = await single.connect();
      try {
        await dirty2.query("SELECT set_config('app.org_id', $1, false)", [ownerA.orgId]);
        await dirty2.query("SELECT set_config('app.user_id', $1, false)", [ownerA.ownerUserId]);
      } finally {
        dirty2.release();
      }
      const seen = await withConversationWorkerOwnerContext(
        single,
        { orgId: ownerC.orgId, ownerUserId: ownerC.ownerUserId },
        async (tx) => {
          const r = await tx.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
            chainA.conversationId,
          ]);
          return r.rowCount ?? 0;
        },
      );
      expect(seen).toBe(0); // owner A's row is NOT visible under owner C's context
    } finally {
      await single.end().catch(() => undefined);
    }
  });
});
