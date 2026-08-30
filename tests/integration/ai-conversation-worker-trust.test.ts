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
//
// REMEDIATION of the two Codex P2 findings on head a837ce5a:
//  W15 the live identity attestation PASSES on a correctly wired worker pool
//  W16 a govai_app credential wired as the worker URL is REJECTED before discovery
//  W17 an admin/superuser credential wired as the worker URL is REJECTED — with the
//      counterfactual proving the gate is load-bearing, not decorative
//  W18 privilege DRIFT (BYPASSRLS / SUPERUSER granted after the fact) is rejected
//  W19 an identity failure leaks no credential material
//  W20 a REAL 42501 from pg_terminate_backend does not abort the migration run
//  W21 falsification of the owner-context ROLLBACK-failure disposition

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client, Pool, type PoolClient } from 'pg';
import { startPostgres, stopPostgres, migrate, type TestDb } from './setup.js';
import {
  freshOwner,
  seedFullChain,
  seedConversation,
  type OwnerIds,
} from './helpers/ai-conversation-seed.js';
import {
  createConversationWorkerDb,
  loadConversationWorkerDbConfig,
  resetOwnerContext,
  assertConversationWorkerIdentity,
  ConversationWorkerConfigError,
  ConversationWorkerIdentityError,
  CONVERSATION_WORKER_DATABASE_URL_ENV,
  CONVERSATION_WORKER_ROLE,
  type ConversationWorkerDb,
} from '../../apps/api/src/pipeline/ai-conversation-worker.js';
import {
  discoverRecoveryCandidates,
  loadOwnedRecoveryCandidate,
} from '../../apps/api/src/pipeline/ai-conversation-recovery-discovery.js';
import { sweepRoleSessions } from '../../apps/api/src/db/migrate.js';

const WORKER_ROLE = 'govai_conversation_worker';

/**
 * P0-C (P0A2-P3-A4): the production module no longer exports a `pg.Pool`, so this suite builds
 * its own probe pool ALONGSIDE the capability.
 *
 * ★ THAT IS NOT A HOLE IN THE CLOSURE — IT IS THE POINT OF IT. A4 is about what the RUNTIME API
 * hands to a caller: no production code path can now obtain a worker connection without passing
 * through attestation and owner-context entry. A test may of course open its own connection with
 * `pg` directly (any process holding the credential can), and it MUST be able to, because the
 * privilege-matrix assertions below (W5/W8/W10/W14) work by issuing raw SQL as the worker role
 * and proving what it CANNOT do. The probe pool is the microscope, never a supported entry point.
 */
type WorkerPair = { pool: Pool; db: ConversationWorkerDb; close(): Promise<void> };

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
} as unknown as Parameters<typeof createConversationWorkerDb>[0]['log'];

function mkWorker(connectionString: string, max = 2): WorkerPair {
  const capability = createConversationWorkerDb({
    config: { connectionString, max },
    log: silentLog,
  });
  const pool = new Pool({ connectionString, max });
  // The probe pool is a bare pg.Pool, so it needs its own idle-error absorber like any
  // long-lived pool (the very class of bug P0A2-P3-A1 is about).
  pool.on('error', () => undefined);
  return {
    pool,
    db: capability,
    async close() {
      await capability.close().catch(() => undefined);
      await pool.end().catch(() => undefined);
    },
  };
}
const DISCOVERY_FN = 'govai.ai_turn_recovery_candidates(integer,integer,timestamptz,uuid)';

/**
 * Every table in the worker's blast-radius question, with the P0-A2 expectation.
 * `select` here means COLUMN-level SELECT on at least one column: 0032 grants the worker
 * COLUMN-scoped SELECT (the 0028 precedent), so TABLE-level SELECT is false EVERYWHERE — which
 * the matrix asserts separately, and which is a strictly stronger statement of least privilege.
 */
/**
 * The worker's privilege matrix, AT P0-C.
 *
 * ★ THIS TABLE WIDENED IN P0-C, AND THAT IS THE POINT OF RESTATING IT EXHAUSTIVELY. P0-A2
 * granted column-scoped SELECT on three tables and nothing else, because it shipped discovery
 * with no execution. P0-C ACTIVATES execution, so migration 0034 adds exactly the authority the
 * §8 five-commit protocol needs — and this matrix is where "exactly" is checked, verb by verb,
 * table by table. Every `true` below traces to a named commit or read in that protocol; every
 * `false` is a capability a later movement will need and must NOT hold yet.
 *
 * `tableSel`/`tableUpd` are TABLE-level: they stay false wherever the grant is COLUMN-scoped, so
 * a column added by a future migration is never silently reachable.
 */
type WorkerTablePrivs = {
  table: string;
  tableSel: boolean;
  colSel: boolean;
  ins: boolean;
  tableUpd: boolean;
  colUpd: boolean;
};

const NOTHING = { tableSel: false, colSel: false, ins: false, tableUpd: false, colUpd: false };

const TABLE_MATRIX: ReadonlyArray<WorkerTablePrivs> = [
  // Root: reads the lifecycle predicate + the immutable `mode` lane; the `updated_at` UPDATE
  // exists ONLY so the §9 boundary may take `FOR KEY SHARE` (ACL_SELECT_FOR_UPDATE = ACL_UPDATE).
  { table: 'ai_conversations', tableSel: false, colSel: true, ins: false, tableUpd: false, colUpd: true },
  // Turns stay READ-ONLY to the executor: a turn is minted by the reservation, never by it.
  { table: 'ai_conversation_turns', tableSel: false, colSel: true, ins: false, tableUpd: false, colUpd: false },
  // Attempts: the claim/lease/boundary/provenance/finalize plane. NO INSERT (§9 is explicit).
  { table: 'ai_conversation_attempts', tableSel: false, colSel: true, ins: false, tableUpd: false, colUpd: true },
  // Branches: read the execution triple, write ONLY the monotonic §7.8 causal version.
  { table: 'ai_conversation_branches', tableSel: false, colSel: true, ins: false, tableUpd: false, colUpd: true },
  // Items + content: read the durable input, write the durable output. Table-level SELECT/INSERT
  // (there is no subset of an envelope group the worker can do without), and NO UPDATE — both
  // are append-only in place.
  { table: 'ai_conversation_items', tableSel: true, colSel: true, ins: true, tableUpd: false, colUpd: false },
  { table: 'ai_conversation_content', tableSel: true, colSel: true, ins: true, tableUpd: false, colUpd: false },
  // §11 continuation state is P0-D's, and §14 link materialization is P0-F's: still NOTHING.
  { table: 'ai_conversation_provider_state', ...NOTHING },
  { table: 'ai_conversation_evidence_links', ...NOTHING },
  // Outside the conversation domain: SELECT-only, column-scoped, and only what evidence and
  // §8 commit 4 actually require.
  { table: 'provider_credentials', tableSel: false, colSel: true, ins: false, tableUpd: false, colUpd: false },
  { table: 'orgs', tableSel: false, colSel: true, ins: false, tableUpd: false, colUpd: false },
  // The evidence PLANE stays closed: the worker's only evidence authority is EXECUTE on ONE
  // capture function (see W9), never a table.
  { table: 'audit_events', ...NOTHING },
  { table: 'audit_capture_outbox', ...NOTHING },
  { table: 'runs', ...NOTHING },
];

let db: TestDb;
let worker: WorkerPair;
let workerPool: Pool;
let workerDb: ConversationWorkerDb;
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
  worker = mkWorker(db.conversationWorkerUrl);
  workerPool = worker.pool;
  workerDb = worker.db;

  ownerA = freshOwner();
  ownerB = { orgId: ownerA.orgId, ownerUserId: freshOwner().ownerUserId };
  ownerC = freshOwner();
  chainA = await seedFullChain(db.adminPool, ownerA);
  await seedConversation(db.adminPool, ownerB);
  await seedConversation(db.adminPool, ownerC);
}, 300_000);

afterAll(async () => {
  await worker?.close().catch(() => undefined);
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
      workerDb.withOwnerContext({ orgId, ownerUserId: userId }, async (tx: PoolClient) => {
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
    const singleW = mkWorker(db.conversationWorkerUrl, 1);
    const single = singleW.pool;
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
      const seenA = await singleW.db.withOwnerContext({
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
      const seenC = await singleW.db.withOwnerContext({
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
        singleW.db.withOwnerContext({
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
      await singleW.close();
    }
  });

  it('W8 — worker privilege matrix: EXACTLY the P0-C execution authority, and no more', async () => {
    for (const { table, tableSel, colSel, ins, tableUpd, colUpd } of TABLE_MATRIX) {
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
        // ★ TABLE-level SELECT stays false wherever the grant is COLUMN-scoped, so a column
        // added by a later migration is never silently readable.
        table_sel: tableSel,
        col_sel: colSel,
        ins,
        col_ins: ins,
        upd: tableUpd,
        col_upd: colUpd,
        // ★ NO DELETE AND NO TRUNCATE ANYWHERE — unchanged from P0-A2. LAW 13's purge is a
        // later movement's authority and P0-C does not touch it.
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
    // The relations the worker can touch AT ALL, in full. Anything appearing here that is not
    // in TABLE_MATRIX would be an un-inventoried grant.
    expect(stray.rows.map((r) => r.relname)).toEqual([
      'ai_conversation_attempts',
      'ai_conversation_branches',
      'ai_conversation_content',
      'ai_conversation_items',
      'ai_conversation_turns',
      'ai_conversations',
      'orgs',
      'provider_credentials',
    ]);
  });

  it('W9 — the worker holds EXECUTE on exactly TWO SECURITY DEFINER functions', async () => {
    const r = await db.adminPool.query<{ proname: string }>(
      `SELECT p.proname
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'govai' AND p.prosecdef
          AND has_function_privilege($1, p.oid, 'EXECUTE')
        ORDER BY p.proname`,
      [WORKER_ROLE],
    );
    // ★ P0-C ADDS EXACTLY ONE. `audit_capture_insert_locked` is the SINGLE statement
    // `captureAuditEvent` issues, and granting it is what keeps worker-driven dispatch on the
    // SAME evidence contract as request-driven dispatch instead of being a silent capture gap.
    expect(r.rows.map((x) => x.proname)).toEqual([
      'ai_turn_recovery_candidates',
      'audit_capture_insert_locked',
    ]);
    // Named negatives for the capabilities a later movement will need but must NOT hold yet.
    // ★ `org_tier_lookup` stays DENIED even though the worker now needs tier/operational_mode:
    // that definer accepts ANY org id, so the worker reads its ENTERED org through a
    // column-scoped, org-scoped SELECT on `govai.orgs` instead (0034 §F2).
    for (const fn of [
      'audit_capture_claim_for_seal',
      'audit_capture_mark_sealed',
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
      // ★ THE MECHANISM, NOT THE SIDE EFFECT. P0-A2 asserted "`SELECT *` is denied on all three
      // granted tables", which was true while at least one column was withheld on each. P0-C
      // needs the 10th and LAST column of `ai_conversation_turns`
      // (`native_request_config_content_id`), so `SELECT *` now succeeds there — and an
      // assertion phrased as the side effect would read that as a privilege leak.
      //
      // It is not one. What actually protects a FUTURE column is that the grant is ENUMERATED
      // per column, so a column added by migration 0035 is not granted to anyone. That is what
      // is asserted here — exhaustively, per table — and it is strictly stronger than the
      // `SELECT *` probe it replaces.
      const granted = async (table: string): Promise<string[]> => {
        const r = await db.adminPool.query<{ column_name: string }>(
          `SELECT a.attname AS column_name
             FROM pg_attribute a
             JOIN pg_class cl ON cl.oid = a.attrelid
             JOIN pg_namespace n ON n.oid = cl.relnamespace
            WHERE n.nspname = 'govai' AND cl.relname = $1
              AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege($2, cl.oid, a.attname, 'SELECT')
            ORDER BY a.attname`,
          [table, WORKER_ROLE],
        );
        return r.rows.map((x) => x.column_name);
      };
      expect(await granted('ai_conversations')).toEqual([
        'id',
        'mode',
        'org_id',
        'owner_user_id',
        'status',
      ]);
      expect(await granted('ai_conversation_turns')).toEqual([
        'branch_id',
        'client_turn_id',
        'conversation_id',
        'created_at',
        'current_attempt_id',
        'id',
        'native_request_config_content_id',
        'org_id',
        'owner_user_id',
        'turn_seq',
      ]);
      // Attempts keeps 4 columns withheld, so `SELECT *` there is still denied — retained as a
      // live demonstration that the column scoping is real and not merely declared.
      await expect(
        c.query(`SELECT * FROM govai.ai_conversation_attempts LIMIT 1`),
      ).rejects.toMatchObject({ code: '42501' });
      // Named forbidden columns, one denial each.
      // ★ WHAT MOVED IN P0-C, AND WHY — the six columns that left this list are exactly the
      // ones the §8 protocol reads, each for a named reason:
      //   mode                              selects the governed/passthrough lane for a
      //                                     DETACHED dispatch (§9: read at EVERY dispatch)
      //   native_request_config_content_id  the immutable request the claimant reconstructs
      //   provider_credential_id            the durable `¬P` no-POST proof (§7.7)
      //   govai_request_id / capture_id     §14 evidence identity
      //   causal_version_at_build           §7.8 staleness binding
      // What did NOT move is what matters: every TITLE column and every CONTINUATION ANCHOR
      // column is still unreachable — the worker cannot read a conversation title in any form,
      // and P0-D's provider continuation state is not pre-granted.
      const denied: ReadonlyArray<[string, string]> = [
        ['govai.ai_conversations', 'title_ciphertext'],
        ['govai.ai_conversations', 'title_dek_wrapped'],
        ['govai.ai_conversations', 'title_kms_key_id'],
        ['govai.ai_conversations', 'title_kms_key_version'],
        ['govai.ai_conversations', 'title_hmac'],
        ['govai.ai_conversations', 'retention_class'],
        ['govai.ai_conversation_attempts', 'continuation_parent_ciphertext'],
        ['govai.ai_conversation_attempts', 'continuation_parent_dek_wrapped'],
        ['govai.ai_conversation_attempts', 'continuation_parent_kms_key_id'],
        ['govai.ai_conversation_attempts', 'continuation_parent_kms_key_version'],
      ];
      for (const [table, col] of denied) {
        await expect(c.query(`SELECT ${col} FROM ${table} LIMIT 1`)).rejects.toMatchObject({
          code: '42501',
        });
      }
      // The plane the movement DOES need still reads (zero rows without an owner context).
      const ok = await c.query(
        `SELECT a.id, a.state, a.claim_token, a.claim_deadline_at, a.stop_requested,
                a.dispatch_boundary_committed_at, a.provider_credential_id, a.govai_request_id,
                a.capture_id, a.causal_version_at_build
           FROM govai.ai_conversation_attempts a`,
      );
      expect(ok.rowCount).toBe(0);
      for (const sql of [
        `SELECT id, mode, status FROM govai.ai_conversations`,
        `SELECT id, native_request_config_content_id FROM govai.ai_conversation_turns`,
        `SELECT id, provider, surface, model, causal_version, forked_from_turn_id,
                forked_from_attempt_id, boundary_mode FROM govai.ai_conversation_branches`,
        `SELECT id, provider, status FROM govai.provider_credentials`,
        `SELECT id, tier, operational_mode FROM govai.orgs`,
      ]) {
        const r = await c.query(sql);
        expect({ sql, rows: r.rowCount }).toEqual({ sql, rows: 0 });
      }
      // ★ `SELECT *` is STILL denied wherever any column remains withheld — attempts (the four
      // continuation-anchor columns — 0036 made them WRITABLE at the boundary but never
      // readable), credentials (the key fingerprint and revocation metadata) and orgs
      // (everything but the tenant-facts pair). Branches LEFT this list with 0036: the fork
      // pins and boundary_mode became readable (the P0-D1 context walk needs them), which
      // completes the column set — `SELECT *` on branches now lawfully succeeds and is covered
      // by the zero-rows read above plus the 0036 contract suite.
      for (const t of [
        'govai.ai_conversation_attempts',
        'govai.provider_credentials',
        'govai.orgs',
      ]) {
        await expect(c.query(`SELECT * FROM ${t} LIMIT 1`)).rejects.toMatchObject({ code: '42501' });
      }
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

    // ★ THE CLAIM THIS TEST DEFENDS IS UNCHANGED BY P0-C: no worker/definer policy is a
    // govai_app policy, and none is granted to PUBLIC. What CHANGED is the count — P0-C's 0034
    // adds the worker's execution surface — so the inventory is restated exhaustively rather
    // than loosened to "at least".
    const pol = await db.adminPool.query<{ policyname: string; cmd: string; roles: string }>(
      `SELECT policyname, cmd, roles::text AS roles
         FROM pg_policies
        WHERE schemaname = 'govai' AND tablename LIKE 'ai_conversation%'
          AND (policyname LIKE '%_recovery_select_writer' OR policyname LIKE '%_conversation_worker')
        ORDER BY policyname`,
    );
    expect(pol.rows.map((p) => `${p.policyname}:${p.cmd}`)).toEqual([
      // P0-A2's three definer-visibility SELECT policies (the narrow claim-plane bypass).
      'ai_conversation_attempts_recovery_select_writer:SELECT',
      // P0-C's worker execution surface.
      'ai_conversation_attempts_select_conversation_worker:SELECT',
      'ai_conversation_attempts_update_conversation_worker:UPDATE',
      'ai_conversation_branches_select_conversation_worker:SELECT',
      'ai_conversation_branches_update_conversation_worker:UPDATE',
      'ai_conversation_content_insert_conversation_worker:INSERT',
      'ai_conversation_content_select_conversation_worker:SELECT',
      'ai_conversation_items_insert_conversation_worker:INSERT',
      'ai_conversation_items_select_conversation_worker:SELECT',
      'ai_conversation_turns_recovery_select_writer:SELECT',
      'ai_conversation_turns_select_conversation_worker:SELECT',
      'ai_conversations_recovery_select_writer:SELECT',
      'ai_conversations_select_conversation_worker:SELECT',
      'ai_conversations_update_conversation_worker:UPDATE',
    ]);
    for (const p of pol.rows) {
      // ★ UNCHANGED AND LOAD-BEARING: not one of them admits govai_app or PUBLIC.
      expect({ p: p.policyname, roles: p.roles }).toEqual({ p: p.policyname, roles: p.roles });
      expect(p.roles).not.toContain('govai_app');
      expect(p.roles).not.toContain('public');
      // Every worker policy is dual-predicate (org AND owner); the definer ones are the
      // content-free claim-plane bypass and are role-scoped to the NOLOGIN writer.
      expect(p.roles).toMatch(/govai_conversation_worker|govai_audit_writer/);
    }
    // No DELETE policy exists for either role, anywhere in the domain.
    expect(pol.rows.filter((p) => p.cmd === 'DELETE' || p.cmd === 'ALL')).toEqual([]);
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
    const singleW = mkWorker(db.conversationWorkerUrl, 1);
    const single = singleW.pool;
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
      const seen = await singleW.db.withOwnerContext(
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
      await singleW.close();
    }
  });

  // ── REMEDIATION: W1 — live database identity attestation ───────────────────────────────

  it('W15 — the attestation PASSES on a correctly wired worker pool, and gates both entry points', async () => {
    const c = await workerPool.connect();
    try {
      await expect(assertConversationWorkerIdentity(c)).resolves.toBeUndefined();
      const seen = await c.query<{ cur: string; sess: string }>(
        `SELECT current_user::text AS cur, session_user::text AS sess`,
      );
      expect(seen.rows[0]).toEqual({
        cur: CONVERSATION_WORKER_ROLE,
        sess: CONVERSATION_WORKER_ROLE,
      });
    } finally {
      c.release();
    }
    // Both real entry points of the CAPABILITY work through the gate. (P0-C: the second one is
    // `withOwnerContext`, because the raw attested-checkout export is gone — see P0A2-P3-A4.)
    await expect(
      discoverRecoveryCandidates(workerDb, { recoveryGraceMs: 30_000, limit: 10 }),
    ).resolves.toBeDefined();
    await expect(
      workerDb.withOwnerContext(
        { orgId: ownerA.orgId, ownerUserId: ownerA.ownerUserId },
        async (tx: PoolClient) => (await tx.query('SELECT 1 AS ok')).rows[0],
      ),
    ).resolves.toEqual({ ok: 1 });
  });

  it('W16 — a govai_app credential wired as the worker URL is REJECTED before discovery', async () => {
    // The misconfiguration Codex named: the factory accepts any URL, so only a LIVE identity
    // assertion can catch it. `db.appUrl` authenticates fine — that is the whole problem.
    const wrongW = mkWorker(db.appUrl, 1);
    try {
      await expect(
        discoverRecoveryCandidates(wrongW.db, { recoveryGraceMs: 30_000, limit: 10 }),
      ).rejects.toBeInstanceOf(ConversationWorkerIdentityError);
      // ★ It must fail on IDENTITY, not on the definer's EXECUTE grant: the gate has to run
      // BEFORE ai_turn_recovery_candidates, or a credential that DOES hold EXECUTE would sail
      // straight through.
      await expect(
        discoverRecoveryCandidates(wrongW.db, { recoveryGraceMs: 30_000, limit: 10 }),
      ).rejects.toThrow(/session_user is 'govai_app'/);
      // Owner-bound reads are gated too, and the failure precedes any owner context.
      await expect(
        wrongW.db.withOwnerContext(
          { orgId: ownerA.orgId, ownerUserId: ownerA.ownerUserId },
          async () => 'must not run',
        ),
      ).rejects.toBeInstanceOf(ConversationWorkerIdentityError);
      await expect(
        loadOwnedRecoveryCandidate(wrongW.db, {
          orgId: ownerA.orgId,
          ownerUserId: ownerA.ownerUserId,
          conversationId: chainA.conversationId,
          attemptId: chainA.attemptId,
        }),
      ).rejects.toBeInstanceOf(ConversationWorkerIdentityError);
    } finally {
      await wrongW.close();
    }
  });

  it('W17 — an admin/superuser credential wired as the worker URL is REJECTED (gate is load-bearing)', async () => {
    // COUNTERFACTUAL FIRST: without the gate, this credential really would work — a superuser
    // bypasses both the EXECUTE check and RLS, so discovery would return cross-owner rows and
    // every owner-bound read would silently see everything. This is what the attestation stops.
    const raw = await db.adminPool.query(
      `SELECT org_id, owner_user_id FROM govai.ai_turn_recovery_candidates(30000, 50)`,
    );
    expect(raw.rowCount ?? 0).toBeGreaterThan(0);
    const rawRows = await db.adminPool.query(`SELECT id FROM govai.ai_conversations`);
    expect(rawRows.rowCount ?? 0).toBeGreaterThan(0); // cross-owner, no context, no policy

    const elevatedW = mkWorker(db.adminUrl, 1);
    try {
      await expect(
        discoverRecoveryCandidates(elevatedW.db, { recoveryGraceMs: 30_000, limit: 10 }),
      ).rejects.toBeInstanceOf(ConversationWorkerIdentityError);
      await expect(
        elevatedW.db.withOwnerContext(
          { orgId: ownerA.orgId, ownerUserId: ownerA.ownerUserId },
          async () => 'must not run',
        ),
      ).rejects.toBeInstanceOf(ConversationWorkerIdentityError);
    } finally {
      await elevatedW.close();
    }
  });

  it('W18 — privilege DRIFT after provisioning is rejected (BYPASSRLS and SUPERUSER)', async () => {
    for (const attr of ['BYPASSRLS', 'SUPERUSER'] as const) {
      const undo = attr === 'BYPASSRLS' ? 'NOBYPASSRLS' : 'NOSUPERUSER';
      await db.adminPool.query(`ALTER ROLE ${CONVERSATION_WORKER_ROLE} WITH ${attr}`);
      try {
        // The role NAME is still right; only its attributes drifted. Name checks alone would
        // pass here, which is why the attestation reads rolsuper/rolbypassrls from the catalog.
        await expect(
          discoverRecoveryCandidates(workerDb, { recoveryGraceMs: 30_000, limit: 10 }),
        ).rejects.toBeInstanceOf(ConversationWorkerIdentityError);
        await expect(
          discoverRecoveryCandidates(workerDb, { recoveryGraceMs: 30_000, limit: 10 }),
        ).rejects.toThrow(/rolsuper=|rolbypassrls=/);
      } finally {
        await db.adminPool.query(`ALTER ROLE ${CONVERSATION_WORKER_ROLE} WITH ${undo}`);
      }
      // Restored: the same pool is usable again, so the check is live per checkout rather than
      // a verdict cached at pool construction.
      await expect(
        discoverRecoveryCandidates(workerDb, { recoveryGraceMs: 30_000, limit: 10 }),
      ).resolves.toBeDefined();
    }

    // NOINHERIT is part of the declared contract too.
    await db.adminPool.query(`ALTER ROLE ${CONVERSATION_WORKER_ROLE} WITH INHERIT`);
    try {
      await expect(
        discoverRecoveryCandidates(workerDb, { recoveryGraceMs: 30_000, limit: 10 }),
      ).rejects.toThrow(/rolinherit=true/);
    } finally {
      await db.adminPool.query(`ALTER ROLE ${CONVERSATION_WORKER_ROLE} WITH NOINHERIT`);
    }
    await expect(
      discoverRecoveryCandidates(workerDb, { recoveryGraceMs: 30_000, limit: 10 }),
    ).resolves.toBeDefined();
  });

  it('W19 — an identity failure leaks no credential material', async () => {
    const wrongW = mkWorker(db.appUrl, 1);
    try {
      let caught: unknown = null;
      try {
        await discoverRecoveryCandidates(wrongW.db, { recoveryGraceMs: 30_000, limit: 10 });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConversationWorkerIdentityError);
      const text = `${(caught as Error).message}\n${(caught as Error).stack ?? ''}`;
      expect(text).not.toContain(db.appPassword);
      expect(text).not.toContain(db.conversationWorkerPassword);
      expect(text).not.toContain('postgres://');
      expect(text).not.toContain('postgresql://');
      // It DOES name the observed and expected roles — the diagnostic an operator needs.
      expect((caught as Error).message).toContain('govai_app');
      expect((caught as Error).message).toContain(CONVERSATION_WORKER_ROLE);
    } finally {
      await wrongW.close();
    }
  });

  // ── REMEDIATION: W2 — a REAL insufficient-privilege sweep must not abort migration ────────

  it('W20 — a real 42501 from pg_terminate_backend is survivable: the run continues', async () => {
    // A faithful reproduction of the production shape Codex described: a migrator that can ALTER
    // roles but is not a member of pg_signal_backend or of the target role. Empirically such a
    // role DOES see the target's pg_stat_activity rows (so the sweep finds work) and CANNOT
    // signal them (so pg_terminate_backend raises 42501).
    const limitedPassword = 'p0a2_limited_migrator_pw_1234';
    await db.adminPool.query(
      `DO $$ BEGIN CREATE ROLE p0a2_limited_migrator LOGIN PASSWORD '${limitedPassword}';
         EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
    // Hold a LIVE worker backend open, so there is a real session to fail to terminate.
    const victim = await workerPool.connect();
    const limitedUrl = db.adminUrl.replace(
      /\/\/[^@]+@/,
      `//p0a2_limited_migrator:${limitedPassword}@`,
    );
    const limited = new Pool({ connectionString: limitedUrl, max: 1 });
    limited.on('error', () => undefined);
    try {
      const c = await limited.connect();
      try {
        const visible = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_stat_activity
            WHERE usename = $1 AND pid <> pg_backend_pid()`,
          [CONVERSATION_WORKER_ROLE],
        );
        expect(Number(visible.rows[0]!.n)).toBeGreaterThan(0); // the sweep will find work
        // And it genuinely lacks the privilege to signal it.
        await expect(
          c.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
              WHERE usename = $1 AND pid <> pg_backend_pid()`,
            [CONVERSATION_WORKER_ROLE],
          ),
        ).rejects.toMatchObject({ code: '42501' });

        // ★ THE FINDING: the shared sweep must absorb that error. Before the fix it propagated
        // out of applyPrivilegedRoleLifecycles and migrate(), skipping every remaining migration
        // after a NOLOGIN that had ALREADY committed.
        const logs: string[] = [];
        await expect(
          sweepRoleSessions(c, CONVERSATION_WORKER_ROLE, (m) => logs.push(m)),
        ).resolves.toBeUndefined();
        expect(logs.join('\n')).toContain('42501');
        expect(logs.join('\n')).toContain('Migration continues.');

        // The client is still usable, so the runner's remaining migration SQL would still run.
        const after = await c.query<{ ok: number }>(`SELECT 1 AS ok`);
        expect(after.rows[0]!.ok).toBe(1);
      } finally {
        c.release();
      }
      // Termination really did fail — the victim backend is alive and still serving.
      const alive = await victim.query<{ ok: number }>(`SELECT 1 AS ok`);
      expect(alive.rows[0]!.ok).toBe(1);
    } finally {
      victim.release();
      await limited.end().catch(() => undefined);
    }
  });

  // ── Owner-context ROLLBACK-failure disposition (falsified, then hardened) ─────────────────

  it('W21 — a client left mid-transaction cannot leak candidate A into candidate B', async () => {
    // Falsification of the residual behind `client.release(destroyOnRelease)`. Manufacture the
    // worst case directly: return a client to the pool while it is STILL inside a transaction
    // that has owner A's context set, then let candidate B use that same physical connection.
    const singleW = mkWorker(db.conversationWorkerUrl, 1);
    const single = singleW.pool;
    try {
      const dirty = await single.connect();
      try {
        await dirty.query('BEGIN');
        await dirty.query("SELECT set_config('app.org_id', $1, true)", [ownerA.orgId]);
        await dirty.query("SELECT set_config('app.user_id', $1, true)", [ownerA.ownerUserId]);
        const leaked = await dirty.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
          chainA.conversationId,
        ]);
        expect(leaked.rowCount).toBe(1); // inside the stale transaction A really is visible
      } finally {
        dirty.release(); // deliberately WITHOUT rollback — the state a failed ROLLBACK could leave
      }
      // Candidate C now reuses that same physical connection through the real helper.
      const seen = await singleW.db.withOwnerContext(
        { orgId: ownerC.orgId, ownerUserId: ownerC.ownerUserId },
        async (tx) => {
          const theirs = await tx.query(
            `SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`,
            [chainA.conversationId],
          );
          return theirs.rowCount ?? 0;
        },
      );
      // NO LEAK: the helper's explicit set_config overwrites the context before any read, so
      // owner A's row is invisible to candidate C even on a connection left mid-transaction.
      // That is why the release(true) hardening is defense in depth rather than a fix for an
      // exploitable hole — recorded here as evidence, not as narrative.
      expect(seen).toBe(0);
    } finally {
      await singleW.close();
    }
  });
});
