// Detached conversation worker — DATABASE TRUST BOUNDARY + WORKER DB CAPABILITY
// (EP-AI-CONVERSATION-CONTINUITY-V1-01; movements P0-A2 + P0-C).
// Spec: docs/architecture/ai-conversation-continuity-v1.md §9 ("Detached recovery discovery
// under FORCE RLS"), §24 LAW 11.
//
// P0-A2 shipped this module as the worker's CONNECTION IDENTITY layer, exporting a bare
// `pg.Pool`. P0-C is the movement that ACTIVATES a real worker process, so it closes the two
// pre-activation gates that P0-A2 recorded and deliberately left open:
//
//   P0A2-P3-A1 — CHECKED-OUT CLIENTS CARRIED NO `error` LISTENER.
//     Measured, not assumed: `pg-pool` REMOVES its idle `error` listener the moment a client is
//     acquired (`pg-pool/index.js:344`) and only re-attaches it in `_release` (:385). For the
//     WHOLE checkout window the client therefore has ZERO listeners — and `pg`'s
//     `_handleErrorEvent` (`pg/lib/client.js:386-394`) marks the client unqueryable, fails every
//     in-flight query, and then emits `'error'` ON THE CLIENT. A Node EventEmitter with no
//     `error` listener THROWS, so an asynchronous connection loss while a worker client is
//     checked out is an `ERR_UNHANDLED_ERROR` process kill, not a rejected query. It was
//     harmless only because no real worker process ever constructed the pool. P0-C crosses that
//     boundary, so `withCheckedOutWorkerClient` below installs a listener for exactly the
//     checkout's duration, removes it before release (no cross-checkout leak), and DESTROYS a
//     client that experienced a connection-level failure instead of returning it to the pool.
//
//   P0A2-P3-A4 — THE MODULE EXPORTED A RAW `pg.Pool`.
//     A raw pool is a general-purpose `query()` surface: any future caller could bypass the
//     attestation and the owner-context entry that ARE the trust boundary. P0-C is precisely
//     that "future caller" boundary, so the raw pool is no longer exported. What is exported is
//     an OPAQUE CAPABILITY — `ConversationWorkerDb` — whose only members are the three named
//     operations the worker pipeline actually performs, plus lifecycle. The `pg.Pool` is a
//     module-private closure variable. A `PoolClient` is handed out ONLY inside
//     `withOwnerContext`, i.e. only after identity attestation and only inside an entered
//     owner security context — exactly where the spec permits ordinary SQL.
//
// TRUST MODEL (LAW 11 — REQUEST IDENTITY != WORKER IDENTITY). The worker connects as
// `govai_conversation_worker`, a database identity distinct from the request pool's `govai_app`:
// NOINHERIT, no LOGIN until explicitly provisioned, never superuser, never BYPASSRLS, owner of
// nothing, and never granted to `govai_app` (which also cannot SET ROLE to it).
//
// ★ NO FALLBACK, EVER. If the worker connection string is absent the factory FAILS CLOSED. It
// must never silently degrade to the API's `DATABASE_URL`: running the worker on `govai_app`
// would erase the entire trust boundary this module exists to create.

import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { setLocalAppOrgId, setLocalAppUserId } from '@govai/core-tenant';
import { makeAuditBridge } from './audit-bridge.js';
import type { AuditBridgeRequestIdentity } from './request-identity.js';

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
 * The SAFE projection of a worker database error (P0A2-P3-A1's sanitization obligation).
 *
 * ★ `message` is DELIBERATELY ABSENT. A `pg` connection failure can carry the connection target
 * — and, on some failure shapes, material derived from the connection string — inside its
 * message. The class name and the SQLSTATE/libpq code are enough to operate on and cannot
 * contain a secret, so nothing else is surfaced. This is stricter than
 * `sanitizeSealerError`, which normalizes a message rather than dropping it.
 */
export type SanitizedWorkerDbError = { errorClass: string; code: string | null };

export function sanitizeWorkerDbError(err: unknown): SanitizedWorkerDbError {
  const errorClass =
    (err instanceof Error && typeof err.name === 'string' && err.name.length > 0
      ? err.name
      : 'unknown'
    )
      .replace(/[^A-Za-z0-9_.-]/g, '')
      .slice(0, 64) || 'unknown';
  const raw = (err as { code?: unknown } | null)?.code;
  const code =
    typeof raw === 'string' && raw.length > 0 ? raw.replace(/[^A-Za-z0-9_]/g, '').slice(0, 32) : null;
  return { errorClass, code };
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
 *                       `SET ROLE govai_conversation_worker`.
 *   - `current_user`  — the EFFECTIVE role.
 *   - `rolsuper`      — a superuser is exempt from RLS entirely.
 *   - `rolbypassrls`  — the explicit RLS-bypass attribute.
 * `rolinherit` is asserted too: NOINHERIT is a declared property of this identity.
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

/** Owner security context. In the worker plane these values may originate ONLY from
 *  `govai.ai_turn_recovery_candidates` — never from HTTP input (spec §9). */
export type ConversationWorkerOwner = { orgId: string; ownerUserId: string };

/**
 * P0A2-P3-A1 — checkout with a per-checkout `error` listener.
 *
 * Lifecycle, in this exact order:
 *   connect → attach listener → (caller work) → DETACH listener → release/destroy
 *
 * Detaching BEFORE `release()` matters twice over: `pg-pool._release` re-attaches its OWN idle
 * listener, so leaving ours on would accumulate one listener per checkout on a long-lived
 * physical connection (a slow leak and an eventual MaxListenersExceededWarning); and a listener
 * that outlived its checkout would fire for a LATER borrower's error, attributing it to the
 * wrong operation.
 *
 * A client that emitted `error` is RELEASED WITH DESTRUCTION (`release(true)` → `pool._remove`),
 * so a connection-level failure never returns a poisoned client to the healthy pool. `pg` also
 * clears `_queryable` on that path, which would make `_release` remove it anyway — the explicit
 * destroy makes the guarantee structural rather than dependent on a `pg` internal.
 */
async function withCheckedOutWorkerClient<T>(
  pool: Pool,
  onClientError: ((e: SanitizedWorkerDbError) => void) | undefined,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let connectionFailed = false;
  const listener = (err: Error): void => {
    connectionFailed = true;
    // Absorbing the event is the WHOLE point: without a listener this emit is an unhandled
    // 'error' and the process dies. The in-flight query has already been rejected by pg's
    // `_errorAllQueries`, so the caller still observes the failure as a rejection.
    if (onClientError) onClientError(sanitizeWorkerDbError(err));
  };
  client.on('error', listener);
  try {
    return await fn(client);
  } finally {
    client.removeListener('error', listener);
    // `release(true)` destroys; `release()` returns to the pool.
    if (connectionFailed) client.release(true);
    else client.release();
  }
}

/**
 * The worker's DATABASE CAPABILITY (P0A2-P3-A4's closure).
 *
 * ★ THERE IS NO `pool` MEMBER, AND THAT IS THE POINT. Every member below is a NAMED worker
 * operation whose SQL, attestation and context entry are owned by this module. There is no
 * exported path on which arbitrary `query()` runs on an unattested, context-free worker
 * connection. A `PoolClient` reaches a caller only through `withOwnerContext`, i.e. only after
 * attestation and only inside an entered owner context — the one place the spec allows ordinary
 * SQL.
 */
export type ConversationWorkerDb = {
  /**
   * The ONE sanctioned cross-owner read (`govai.ai_turn_recovery_candidates`), executed on an
   * ATTESTED connection. `govai_app` holds no EXECUTE on the function, by design.
   */
  discoverRecoveryCandidates(
    input: DiscoverRecoveryCandidatesInput,
  ): Promise<RecoveryCandidateRow[]>;

  /**
   * Enter a discovered candidate's owner context and run `fn` inside it:
   *   checkout → IDENTITY ATTESTATION → defensive session-scope reset → BEGIN
   *   → set BOTH GUCs TRANSACTION-LOCALLY → fn → COMMIT / ROLLBACK → release.
   *
   * The attestation comes FIRST, before the reset and before any owner GUC is set: a connection
   * that did not authenticate as the least-privilege worker role must not be touched at all, let
   * alone handed an owner's security context (LAW 11).
   *
   * COMMIT and ROLLBACK both clear a transaction-local `set_config`, so a pooled connection
   * cannot carry candidate A's identity into candidate B's work.
   *
   * ★ OWNER IDENTITY PROVENANCE. `orgId`/`ownerUserId` ARE the credentials every `ai_*` policy
   * consumes. In the worker plane they may come ONLY from a recovery-candidate row. They must
   * NEVER be taken from an HTTP request, header or query parameter.
   */
  withOwnerContext<T>(
    owner: ConversationWorkerOwner,
    fn: (tx: PoolClient) => Promise<T>,
  ): Promise<T>;

  /**
   * The AuditBridge dispatcher bound to the WORKER's own connection identity, so a worker-driven
   * provider call produces evidence through the SAME capture contract as a request-driven one
   * (§14.1). Migration 0034 grants the worker EXECUTE on `govai.audit_capture_insert_locked` and
   * nothing else on the evidence plane.
   *
   * ★ The pool it dispatches on is the module-private one; no raw handle escapes.
   */
  captureAuditEvent(event: unknown, identity?: AuditBridgeRequestIdentity): Promise<void>;

  /** Bounded shutdown. Idempotent. */
  close(): Promise<void>;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Recovery discovery — the query lives HERE so no un-attested client is ever handed out for it.
// The row/parameter shapes are re-exported from the discovery module (which stays the home of
// the domain types and of the owner-scoped re-validation read).
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type DiscoverRecoveryCandidatesInput = {
  /** §7.7 rule (2) grace δ over the lease check, applied to the POST-BOUNDARY arms only. */
  recoveryGraceMs: number;
  /** Page size. The DB function rejects anything outside [1, 500]. */
  limit: number;
  /** Resume point from a previous page; omit/null to start at the oldest. */
  after?: { createdAtText: string; attemptId: string } | null;
};

export type RecoveryCandidateRow = {
  org_id: string;
  owner_user_id: string;
  conversation_id: string;
  turn_id: string;
  attempt_id: string;
  state: 'accepted' | 'dispatching' | 'streaming';
  reason: string;
  claim_token: string | null;
  claim_deadline_at_text: string | null;
  is_branch_head: boolean;
  attempt_created_at_text: string;
};

const DISCOVERY_SQL = `SELECT org_id, owner_user_id, conversation_id, turn_id, attempt_id, state, reason,
              claim_token, claim_deadline_at::text AS claim_deadline_at_text, is_branch_head,
              attempt_created_at::text AS attempt_created_at_text
         FROM govai.ai_turn_recovery_candidates($1::integer, $2::integer, $3::timestamptz, $4::uuid)`;

export type ConversationWorkerDbDeps = {
  config: ConversationWorkerDbConfig;
  log: FastifyBaseLogger;
  /** Observability hook for pool-level and checked-out-client errors. Receives a SANITIZED
   *  projection only. Defaults to a log line. */
  onDbError?: (e: SanitizedWorkerDbError, scope: 'pool' | 'checkout') => void;
  /**
   * TEST-ONLY pool construction seam.
   *
   * ★ IT DOES NOT WEAKEN P0A2-P3-A4. A4 is about what the capability HANDS BACK: whatever this
   * factory returns is still captured in the closure below and is still unreachable from the
   * returned object. What the seam buys is a DETERMINISTIC proof of P0A2-P3-A1 — a fake client
   * can be made to emit `'error'` at a precisely chosen instant during a checkout, which is the
   * only way to assert "this listener is load-bearing" without racing a real backend teardown.
   * Production callers omit it and get a real `pg.Pool`.
   */
  poolFactory?: (config: PoolConfig) => Pool;
};

/**
 * Build the worker's database capability. The `pg.Pool` it creates is captured in this closure
 * and is never returned, exported or reachable from the returned object (P0A2-P3-A4).
 *
 * A POOL-level `error` listener is installed at construction for IDLE-client errors; the
 * CHECKOUT-level listener that closes P0A2-P3-A1 is installed per checkout in
 * `withCheckedOutWorkerClient`. The two windows are disjoint and both are now covered.
 *
 * ★ The defensive owner-context reset that spec §9 requires lives at CHECKOUT, NOT on pg's
 * `connect` event: pg does not await a `connect` handler, so a reset issued there would race the
 * caller's first query; and `connect` fires once per PHYSICAL connection while the leak it
 * defends against is per CHECKOUT of a reused one.
 */
export function createConversationWorkerDb(deps: ConversationWorkerDbDeps): ConversationWorkerDb {
  const { config, log } = deps;
  const report =
    deps.onDbError ??
    ((e: SanitizedWorkerDbError, scope: 'pool' | 'checkout'): void => {
      log.error(
        { pool: 'conversation_worker', scope, err_class: e.errorClass, err_code: e.code },
        'conversation worker database error',
      );
    });

  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    max: config.max ?? 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: `govai-conversation-worker:${config.workerId ?? 'default'}`,
  };
  const pool = (deps.poolFactory ?? ((c: PoolConfig) => new Pool(c)))(poolConfig);
  // IDLE-client errors surface on the pool. Absorbing them keeps a transient backend loss from
  // killing the worker; the pool reconnects on the next checkout.
  pool.on('error', (err) => report(sanitizeWorkerDbError(err), 'pool'));

  const auditBridge = makeAuditBridge({ pool, log });
  let closed = false;

  return {
    async discoverRecoveryCandidates(
      input: DiscoverRecoveryCandidatesInput,
    ): Promise<RecoveryCandidateRow[]> {
      const params: [number, number, string | null, string | null] = [
        input.recoveryGraceMs,
        input.limit,
        input.after?.createdAtText ?? null,
        input.after?.attemptId ?? null,
      ];
      return withCheckedOutWorkerClient(pool, (e) => report(e, 'checkout'), async (client) => {
        await assertConversationWorkerIdentity(client);
        const res = await client.query<RecoveryCandidateRow>(DISCOVERY_SQL, params);
        return res.rows;
      });
    },

    async withOwnerContext<T>(
      owner: ConversationWorkerOwner,
      fn: (tx: PoolClient) => Promise<T>,
    ): Promise<T> {
      return withCheckedOutWorkerClient(pool, (e) => report(e, 'checkout'), async (client) => {
        await assertConversationWorkerIdentity(client);
        await resetOwnerContext(client);
        await client.query('BEGIN');
        try {
          await setLocalAppOrgId(client, owner.orgId);
          await setLocalAppUserId(client, owner.ownerUserId);
          // ★ ISO DateStyle pin, the `service.ts:withConversationOwnerContext` contract: a
          // `timestamptz` reaches this process as TEXT rendered under the SESSION's DateStyle,
          // and node-postgres returns `null` for `German`/`SQL`/`Postgres` renderings. Every
          // worker read of a deadline or a terminal timestamp is such a column.
          await client.query(`SET LOCAL DateStyle = 'ISO, MDY'`);
          const result = await fn(client);
          await client.query('COMMIT');
          return result;
        } catch (err) {
          // A client whose ROLLBACK failed is a dead connection; the checkout wrapper's
          // `connectionFailed` path or pg's own `_queryable=false` discards it. Swallowing the
          // ROLLBACK error here preserves the ORIGINAL failure as the thrown one.
          await client.query('ROLLBACK').catch(() => undefined);
          throw err;
        }
      });
    },

    async captureAuditEvent(
      event: unknown,
      identity?: AuditBridgeRequestIdentity,
    ): Promise<void> {
      await auditBridge(event, identity);
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
