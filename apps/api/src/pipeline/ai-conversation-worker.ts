// Detached conversation worker — DATABASE TRUST BOUNDARY (EP-AI-CONVERSATION-CONTINUITY-V1-01,
// movement P0-A2). Spec: docs/architecture/ai-conversation-continuity-v1.md §9
// ("Detached recovery discovery under FORCE RLS"), §24 LAW 11.
//
// This module is the worker's CONNECTION IDENTITY layer and nothing else. It starts no loop,
// registers no timer, opens no provider connection and is wired into no route: P0-A2 ships the
// trust foundation, not the runner. `createConversationWorkerPool` is INERT until a future
// worker process calls it.
//
// TRUST MODEL (LAW 11 — REQUEST IDENTITY != WORKER IDENTITY). The worker connects as
// `govai_conversation_worker`, a database identity distinct from the request pool's `govai_app`:
// NOINHERIT, no LOGIN until explicitly provisioned, never superuser, never BYPASSRLS, owner of
// nothing, and never granted to `govai_app` (which also cannot SET ROLE to it). Its whole
// capability is EXECUTE on `govai.ai_turn_recovery_candidates` plus column-scoped owner-scoped
// SELECT on three `ai_*` tables (migration 0032).
//
// ★ NO FALLBACK, EVER. If the worker connection string is absent the factory FAILS CLOSED. It
// must never silently degrade to the API's `DATABASE_URL`: running recovery on `govai_app`
// would erase the entire trust boundary this movement exists to create — and it would fail
// anyway (govai_app holds no EXECUTE on discovery), but loudly is better than subtly.

import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { setLocalAppOrgId, setLocalAppUserId } from '@govai/core-tenant';

/** Env var carrying the worker's OWN database URL. Never `DATABASE_URL`. */
export const CONVERSATION_WORKER_DATABASE_URL_ENV = 'GOVAI_CONVERSATION_WORKER_DATABASE_URL';

/** The ONLY database identity the detached worker may operate as. */
export const CONVERSATION_WORKER_ROLE = 'govai_conversation_worker';

export type ConversationWorkerDbConfig = {
  /** Connection string authenticating as `govai_conversation_worker`. */
  connectionString: string;
  /** Pool ceiling. Small by default — recovery throughput is bounded by the deploy unit
   *  (the audit-sealer's `AUDIT_SEALER_POOL_MAX = 2` precedent). */
  max?: number;
  /** Distinguishes worker backends in `pg_stat_activity` (and therefore in the deprovision
   *  session sweep). */
  workerId?: string;
};

/** Thrown when the worker's database configuration is absent or unusable. */
export class ConversationWorkerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversationWorkerConfigError';
  }
}

/**
 * Thrown when a worker connection did NOT authenticate as the least-privilege worker identity.
 * Carries role names and boolean role attributes only — never a connection string, password or
 * any other credential material.
 */
export class ConversationWorkerIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversationWorkerIdentityError';
  }
}

/**
 * Read the worker's database config from the environment. FAILS CLOSED when the dedicated URL is
 * missing — there is deliberately no fallback to the request pool's credential.
 */
export function loadConversationWorkerDbConfig(
  source: NodeJS.ProcessEnv = process.env,
): ConversationWorkerDbConfig {
  const connectionString = source[CONVERSATION_WORKER_DATABASE_URL_ENV];
  if (connectionString === undefined || connectionString === '') {
    throw new ConversationWorkerConfigError(
      `${CONVERSATION_WORKER_DATABASE_URL_ENV} is required for the detached conversation worker ` +
        'and has no fallback: the worker must authenticate as govai_conversation_worker, never ' +
        'as the API request role.',
    );
  }
  const rawMax = source['GOVAI_CONVERSATION_WORKER_POOL_MAX'];
  const max = rawMax === undefined || rawMax === '' ? undefined : Number(rawMax);
  if (max !== undefined && (!Number.isInteger(max) || max < 1)) {
    throw new ConversationWorkerConfigError(
      `GOVAI_CONVERSATION_WORKER_POOL_MAX must be a positive integer (got ${JSON.stringify(rawMax)}).`,
    );
  }
  const workerId = source['GOVAI_CONVERSATION_WORKER_ID'];
  return {
    connectionString,
    ...(max !== undefined ? { max } : {}),
    ...(workerId !== undefined && workerId !== '' ? { workerId } : {}),
  };
}

/**
 * The worker's DEDICATED pg.Pool. Never the apps/api request pool, and never built from the
 * request pool's credential.
 *
 * An `error` listener is installed at construction: an idle-client error on a long-lived pool is
 * emitted on the POOL, and an unhandled 'error' event terminates the process. Every long-lived
 * pool needs one.
 *
 * ★ The defensive context reset that spec §9 requires lives at CHECKOUT
 * (`withConversationWorkerOwnerContext` → `resetOwnerContext`), NOT on pg's `connect` event. pg
 * does not await a `connect` handler, so a reset issued there would race the caller's first
 * query and would guarantee nothing; and `connect` fires once per PHYSICAL connection while the
 * leak this defends against is per CHECKOUT of a reused one. The awaited checkout reset is the
 * real control.
 */
export function createConversationWorkerPool(
  config: ConversationWorkerDbConfig,
  onPoolError?: (err: Error) => void,
): Pool {
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    max: config.max ?? 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: `govai-conversation-worker:${config.workerId ?? 'default'}`,
  };
  const pool = new Pool(poolConfig);
  pool.on('error', (err) => {
    if (onPoolError) onPoolError(err);
  });
  return pool;
}

/**
 * LIVE DATABASE IDENTITY ATTESTATION (LAW 11) — the gate that makes the trust boundary real.
 *
 * Configuration alone proves NOTHING about what a connection authenticated as. A
 * `GOVAI_CONVERSATION_WORKER_DATABASE_URL` accidentally populated with `DATABASE_ADMIN_URL` (or
 * any other elevated credential) connects perfectly happily, and every subsequent discovery call
 * and owner-bound read would then execute under an identity that bypasses the FORCE RLS boundary
 * this module exists to establish — silently, with green tests, because RLS bypass produces MORE
 * rows rather than an error. So the check is not "is the env var set" and not "does the URL
 * contain the right username": it asks PostgreSQL itself, and it is asked BEFORE any use.
 *
 * Ground truth, all four from the server:
 *   - `session_user`  — the AUTHENTICATED login. Catches an admin credential that then did
 *                       `SET ROLE govai_conversation_worker`: the effective role would look
 *                       right while the session could reset back to superuser at will.
 *   - `current_user`  — the EFFECTIVE role. Catches a worker login that has assumed some other
 *                       role.
 *   - `rolsuper`      — a superuser is exempt from RLS entirely.
 *   - `rolbypassrls`  — the explicit RLS-bypass attribute.
 * `rolinherit` is asserted too: NOINHERIT is a declared property of this identity, and drift away
 * from it is drift in the trust contract, so it fails closed like the rest.
 *
 * Throws `ConversationWorkerIdentityError` on ANY mismatch. Every message names roles and boolean
 * attributes only — no connection string, no password.
 */
export async function assertConversationWorkerIdentity(client: PoolClient): Promise<void> {
  const r = await client.query<{
    current_role_name: string;
    session_role_name: string;
    rolsuper: boolean | null;
    rolbypassrls: boolean | null;
    rolinherit: boolean | null;
  }>(
    `SELECT current_user::text AS current_role_name,
            session_user::text AS session_role_name,
            r.rolsuper, r.rolbypassrls, r.rolinherit
       FROM pg_catalog.pg_roles r
      WHERE r.rolname = current_user`,
  );
  const row = r.rows[0];
  if (!row) {
    throw new ConversationWorkerIdentityError(
      'conversation worker identity attestation failed: the authenticated role has no pg_roles row.',
    );
  }
  if (row.session_role_name !== CONVERSATION_WORKER_ROLE) {
    throw new ConversationWorkerIdentityError(
      `conversation worker identity attestation failed: session_user is ` +
        `'${row.session_role_name}', expected '${CONVERSATION_WORKER_ROLE}'. The worker pool must ` +
        'authenticate as the least-privilege worker role, never as the API request role and never ' +
        'as an admin/superuser credential.',
    );
  }
  if (row.current_role_name !== CONVERSATION_WORKER_ROLE) {
    throw new ConversationWorkerIdentityError(
      `conversation worker identity attestation failed: current_user is ` +
        `'${row.current_role_name}', expected '${CONVERSATION_WORKER_ROLE}'.`,
    );
  }
  if (row.rolsuper !== false || row.rolbypassrls !== false) {
    throw new ConversationWorkerIdentityError(
      `conversation worker identity attestation failed: role '${CONVERSATION_WORKER_ROLE}' has ` +
        `rolsuper=${row.rolsuper} rolbypassrls=${row.rolbypassrls}; both MUST be false. An ` +
        'identity that can bypass row-level security cannot be used for owner-scoped work.',
    );
  }
  if (row.rolinherit !== false) {
    throw new ConversationWorkerIdentityError(
      `conversation worker identity attestation failed: role '${CONVERSATION_WORKER_ROLE}' has ` +
        `rolinherit=${row.rolinherit}; the worker identity is declared NOINHERIT.`,
    );
  }
}

/**
 * Check out a worker connection, ATTEST its database identity, then run `fn` on it.
 *
 * This is the single gate every worker use path goes through — both the SECURITY DEFINER
 * discovery call and owner-bound `ai_*` reads. The attestation is AWAITED and precedes `fn`, so a
 * misconfigured credential fails closed BEFORE `ai_turn_recovery_candidates` runs and BEFORE any
 * owner context is entered. It deliberately does NOT live on pg's `connect` event: pg does not
 * await connect handlers, so an assertion there could not gate anything.
 *
 * Attesting per CHECKOUT rather than once per pool is intentional — it costs one round trip on a
 * low-throughput background path, and it catches privilege DRIFT (a role later granted SUPERUSER
 * or BYPASSRLS) instead of trusting a verdict cached at construction time.
 */
export async function withAttestedConversationWorkerClient<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await assertConversationWorkerIdentity(client);
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Clear BOTH owner GUCs at SESSION scope on an already-checked-out client. Session scope (not
 * transaction-local) is the point: it erases any residue a previous user of this physical
 * connection could have left OUTSIDE a transaction. Transaction-local settings are already
 * cleared by their own COMMIT/ROLLBACK.
 */
export async function resetOwnerContext(client: PoolClient): Promise<void> {
  await client.query(
    "SELECT set_config('app.org_id', '', false), set_config('app.user_id', '', false)",
  );
}

/**
 * Enter a discovered candidate's owner context and run `fn` inside it.
 *
 *   checkout → IDENTITY ATTESTATION → defensive session-scope reset → BEGIN
 *   → set BOTH GUCs TRANSACTION-LOCALLY
 *   → fn (ordinary least-privilege SQL under FORCE RLS) → COMMIT / ROLLBACK → release
 *
 * The attestation comes FIRST, before the reset and before any owner GUC is set: a connection
 * that did not authenticate as the least-privilege worker role must not be touched at all, let
 * alone handed an owner's security context (LAW 11).
 *
 * COMMIT and ROLLBACK both clear a transaction-local `set_config`, so a pooled connection cannot
 * carry candidate A's identity into candidate B's work even when the same physical connection is
 * reused. The session-level GUC is NEVER used as the authorization mechanism.
 *
 * ★ OWNER IDENTITY PROVENANCE (spec §9 doctrine). `orgId`/`ownerUserId` are APPLICATION-
 * established database security context, and passing them here is equivalent to asserting
 * authority over that owner's entire conversation domain. In the worker plane they may come ONLY
 * from a `govai.ai_turn_recovery_candidates` row — a function `govai_app` cannot execute. They
 * must NEVER be taken from an HTTP request, a header, a query parameter or any other end-user
 * input. P0-A2 exposes no route, so there is no such path today; this comment is the invariant a
 * later movement must not break.
 */
export async function withConversationWorkerOwnerContext<T>(
  pool: Pool,
  owner: { orgId: string; ownerUserId: string },
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  // ★ A client whose ROLLBACK failed is DESTROYED rather than returned to the pool. Falsification
  // showed no exploitable cross-candidate read even in that state — the next entry's explicit
  // `set_config` overwrites the context before any query, so candidate B never sees candidate A's
  // rows — and in practice a failed ROLLBACK means a dead connection, which the pool discards
  // anyway. This is defense in depth, not a vulnerability fix: it makes "a pooled connection
  // cannot carry candidate A's transaction into candidate B's work" structural instead of argued,
  // and it costs one boolean on an already-failing path.
  let destroyOnRelease = false;
  try {
    await assertConversationWorkerIdentity(client);
    await resetOwnerContext(client);
    await client.query('BEGIN');
    try {
      await setLocalAppOrgId(client, owner.orgId);
      await setLocalAppUserId(client, owner.ownerUserId);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        destroyOnRelease = true;
      });
      throw err;
    }
  } finally {
    client.release(destroyOnRelease);
  }
}
