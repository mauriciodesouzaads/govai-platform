// EP-P03A-A (F3) — durable provider dispatch outside run database transactions.
//
// Load-bearing suite (dispatch §29): T1 (F3 falsification), T2 (pool max=1),
// T3 (credential/KMS ordering), T6 (claim race), T6b (claim race observed at
// the FORWARDING boundary), T10 (known non-2xx), T11 (late reconciliation),
// T12 (governed v4 capture, TX-B half), T13 (crash window B), T17 (concurrent
// reconciliation), T18 (pre-claim + pre-forward known failures), T19 (wrong
// token + terminal re-entry), T20 (post-claim persistence failure keeps the
// durable run id). Real Testcontainers Postgres + the hermetic
// provider-protocol upstream with a deterministic PARK barrier — no sleeps,
// no mocked transactions/locks/pools (T20 injects a pool outage via a wrapper
// around a REAL pool).

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { DevKms, type Kms } from '@govai/core-identity';
import { chainIdFor } from '@govai/core-events';
import { buildServer } from '../../apps/api/src/server.js';
import {
  executeGovernedRun,
  createGovernedV4Capture,
} from '../../apps/api/src/pipeline/run-orchestrator.js';
import {
  claimDispatch,
  commitDispatchBoundary,
  failPreclaim,
  finalizeKnownOutcome,
  markOutcomeUnknown,
  DispatchOutcomeConflictError,
  DispatchTokenMismatchError,
  type RunDispatchContext,
} from '../../apps/api/src/pipeline/run-dispatch-state.js';
import { runDispatchRecoverySweepOnce } from '../../apps/api/src/pipeline/run-dispatch-recovery.js';
import { runDispatchConfigFromEnv } from '../../apps/api/src/pipeline/run-dispatch-config.js';
import { handleAnthropicGovernedMessages } from '../../packages/provider-anthropic/src/governed/handle-messages.js';
import { forwardRaw } from '../../packages/provider-anthropic/src/passthrough/forward.js';
import {
  startStack,
  stopStack,
  seedOrg,
  seedProviderCredential,
  configureProviderError,
  clearProviderErrors,
  inject,
  type Stack,
  type SeededOrg,
} from './helpers/server-fixture.js';
import {
  setParkOverride,
  clearParkOverrides,
} from './fixtures/provider-protocol-server.js';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});
afterEach(() => {
  clearParkOverrides();
  clearProviderErrors();
});

const GOVERNED_BODY = (org: SeededOrg, input = 'plain governed input') => ({
  workspace_id: org.workspace_id,
  capability: 'anthropic.messages.create',
  model: 'claude-fixture-1',
  input,
});

async function queryAsOrg<T extends Record<string, unknown> = Record<string, unknown>>(
  orgId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r.rows as T[];
  } finally {
    c.release();
  }
}

async function auditEventTypes(orgId: string, runId: string): Promise<string[]> {
  const rows = await queryAsOrg<{ event_type: string }>(
    orgId,
    `SELECT event_type FROM govai.audit_events
      WHERE subject_id = $1::uuid ORDER BY sequence_number`,
    [runId],
  );
  return rows.map((r) => r.event_type);
}

/** Seed a protocol-v1 'queued' run directly (the exact durable state TX-A
 *  commits), used by the function-level tests. */
async function seedPreparedRun(
  org: SeededOrg,
  opts: { preparedAgoMs?: number } = {},
): Promise<{ runId: string; ctx: RunDispatchContext }> {
  const runId = randomUUID();
  const ago = opts.preparedAgoMs ?? 0;
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);
    await c.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'claude-fixture-1',
          'governed', 'queued', '{}'::jsonb, 1,
          now() - make_interval(secs => $5::integer / 1000.0))`,
      [runId, org.org_id, org.workspace_id, org.user_id, ago],
    );
    await c.query('COMMIT');
  } finally {
    c.release();
  }
  const ctx: RunDispatchContext = {
    orgId: org.org_id,
    runId,
    chainId: chainIdFor(org.org_id, 'run'),
    actorUserId: org.user_id,
    mode: 'governed',
    provider: 'anthropic',
    capabilityId: 'anthropic.messages.create',
    model: 'claude-fixture-1',
    workroom: null,
  };
  return { runId, ctx };
}

function kmsOf(): Kms {
  return new DevKms(stack.seed);
}

/** REV4: cross the durable dispatch boundary for a claimed run — the exact
 *  production ordering (claim → boundary → forward). Function-level tests
 *  that offer an http outcome or mark an honest unknown must cross the gate
 *  first, exactly as production does (the boundary-aware state matrix and the
 *  markOutcomeUnknown guard both require it). */
async function commitBoundaryOf(ctx: RunDispatchContext, token: string): Promise<void> {
  const r = await commitDispatchBoundary(stack.db.appPool, ctx, { token });
  expect(r.committed).toBe(true);
}

const REQ_HASH = createHash('sha256').update('seeded-request-body').digest();
const REQ_HASH_HEX = REQ_HASH.toString('hex');
const RES_HASH_HEX = createHash('sha256').update('seeded-response-body').digest('hex');

function httpOutcome(statusCode: number) {
  return {
    kind: 'http' as const,
    statusCode,
    nativeEndpoint: '/v1/messages',
    nativeRequestHashHex: REQ_HASH_HEX,
    nativeResponseHashHex: RES_HASH_HEX,
    latencyMs: 12,
    providerRequestId: 'req-fixture',
    usageJson: { source: 'provider_direct' },
  };
}

// =============================================================================
// T1 — F3 falsification: WHILE the provider call is in flight, the run is
// durably visible from a second connection, no run transaction is open, no
// app-pool client is pinned, and no row/advisory locks are held. On the
// pre-F3 baseline every one of these assertions fails (the run row was an
// uncommitted insert inside the transaction that ALSO carried the fetch).
// =============================================================================

describe('T1 — F3 falsification (governed, parked upstream)', () => {
  it('run durable + zero open transactions + zero locks + pool live during provider I/O', async () => {
    const org = await seedOrg(stack);
    const park = setParkOverride(org.workspace_id);
    const pending = inject(stack, 'POST', '/v1/runs', org.api_key, GOVERNED_BODY(org));

    await park.parked; // the upstream HAS the request; the fetch is in flight

    // (a) durable + claimed run visible from a SECOND connection. REV4: the
    // durable boundary is ALREADY committed while the fetch is in flight —
    // the gate transaction commits (and releases its client) strictly before
    // any provider I/O begins. This is the production-wiring proof (§CW6b):
    // the real orchestrator supplied the database-backed beforeDispatch.
    const rows = await queryAsOrg<{
      status: string;
      dispatch_protocol_version: number;
      dispatch_token: string | null;
      dispatch_prepared_at: Date | null;
      dispatch_claimed_at: Date | null;
      dispatch_boundary_committed_at: Date | null;
      started_at: Date | null;
    }>(
      org.org_id,
      `SELECT status, dispatch_protocol_version, dispatch_token,
              dispatch_prepared_at, dispatch_claimed_at,
              dispatch_boundary_committed_at, started_at
         FROM govai.runs WHERE workspace_id = $1::uuid`,
      [org.workspace_id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('running');
    expect(rows[0]!.dispatch_protocol_version).toBe(1);
    expect(rows[0]!.dispatch_token).not.toBeNull();
    expect(rows[0]!.dispatch_prepared_at).not.toBeNull();
    expect(rows[0]!.dispatch_claimed_at).not.toBeNull();
    expect(rows[0]!.dispatch_boundary_committed_at).not.toBeNull();
    expect(rows[0]!.started_at).not.toBeNull();

    // (b) the API's pool holds NO open transaction while the fetch is in flight.
    const idleInTx = await stack.db.adminPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE application_name = 'govai-api' AND state LIKE 'idle in transaction%'`,
    );
    expect(idleInTx.rows[0]!.n).toBe(0);

    // (c) no granted row / advisory / relation locks held by any govai-api backend
    // (audit chain, workroom and approval locks all free — §7).
    const locks = await stack.db.adminPool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE a.application_name = 'govai-api' AND l.granted
          AND l.locktype IN ('relation', 'tuple', 'transactionid', 'advisory')`,
    );
    expect(locks.rows[0]!.n).toBe(0);

    // (d) the pool serves OTHER work while the first call is parked.
    const other = await seedOrg(stack);
    const r2 = await inject(stack, 'POST', '/v1/runs', other.api_key, GOVERNED_BODY(other));
    expect(r2.statusCode).toBe(200);

    // Release: the parked run completes normally, with the invocation bound
    // to the SINGLE dispatch token.
    park.release();
    const res = await pending;
    expect(res.statusCode).toBe(200);
    const body = res.body as { run_id: string; status: string };
    expect(body.status).toBe('completed');
    const inv = await queryAsOrg<{ dispatch_token: string | null }>(
      org.org_id,
      'SELECT dispatch_token FROM govai.provider_invocations WHERE run_id = $1::uuid',
      [body.run_id],
    );
    expect(inv).toHaveLength(1);
    expect(inv[0]!.dispatch_token).toBe(rows[0]!.dispatch_token);
  });
});

// =============================================================================
// T2 — pool max=1: the ENTIRE flow (auth → preflight → tenant credential
// lookup → KMS → TX-A → claim → provider → TX-B) completes on a single-client
// pool. On the baseline this deadlocks: the credential lookup inside the
// handler tried pool.connect() while the run transaction pinned the only client.
// =============================================================================

describe('T2 — single-client pool (no nested acquisition)', () => {
  it('governed run with a tenant credential completes on max=1', async () => {
    const org = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      plaintextKey: 'sk-ant-tenant-t2-key-000000',
      setByUserId: org.user_id,
    });
    const singlePool = new Pool({
      connectionString: stack.db.appUrl,
      max: 1,
      // A nested acquisition would wait forever; fail fast + loud instead.
      connectionTimeoutMillis: 8_000,
    });
    const app2 = await buildServer({ env: stack.env, pool: singlePool });
    try {
      const res = await app2.inject({
        method: 'POST',
        url: '/v1/runs',
        headers: { 'content-type': 'application/json', 'x-govai-api-key': org.api_key },
        payload: GOVERNED_BODY(org),
      });
      expect(res.statusCode).toBe(200);
      expect((JSON.parse(res.body) as { status: string }).status).toBe('completed');
    } finally {
      await app2.close();
      await singlePool.end();
    }
  });
});

// =============================================================================
// T3 — credential/KMS ordering: the credential lookup transaction COMMITS
// before the KMS decrypt starts, and the decrypt COMPLETES before TX-A's
// BEGIN. Observed by instrumenting the pool's clients and the KMS — the real
// DevKms still performs its real async work.
// =============================================================================

describe('T3 — credential lookup TX → KMS decrypt → TX-A ordering', () => {
  it('CREDENTIAL_LOOKUP_COMMITTED_BEFORE_KMS_DECRYPT and KMS_DECRYPT_COMPLETED_BEFORE_TX_A_BEGIN', async () => {
    const org = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      plaintextKey: 'sk-ant-tenant-t3-key-000000',
      setByUserId: org.user_id,
    });

    const events: string[] = [];
    const basePool = new Pool({ connectionString: stack.db.appUrl });
    const ORIG = Symbol('origQuery');
    const instrumentedPool = {
      connect: async () => {
        const c = (await basePool.connect()) as PoolClient & {
          [ORIG]?: PoolClient['query'];
        };
        c[ORIG] ??= c.query.bind(c) as PoolClient['query'];
        const orig = c[ORIG];
        (c as { query: unknown }).query = ((...args: unknown[]) => {
          const first = args[0];
          const sql =
            typeof first === 'string' ? first : (first as { text?: string } | null)?.text;
          if (typeof sql === 'string') events.push(`sql:${sql.replace(/\s+/g, ' ').slice(0, 200)}`);
          return (orig as (...a: unknown[]) => unknown)(...args);
        }) as PoolClient['query'];
        return c;
      },
    } as unknown as Pool;

    const inner = new DevKms(stack.seed);
    const kms: Kms = {
      providerName: inner.providerName,
      deriveKey: (i) => inner.deriveKey(i),
      hmacSha256: (i) => inner.hmacSha256(i),
      envelopeEncrypt: (i) => inner.envelopeEncrypt(i),
      envelopeDecrypt: async (i) => {
        events.push('kms_decrypt_start');
        try {
          return await inner.envelopeDecrypt(i);
        } finally {
          events.push('kms_decrypt_end');
        }
      },
    };

    try {
      const result = await executeGovernedRun(
        { pool: instrumentedPool, kms, env: stack.env, policyCommitSha: 'test-t3' },
        org.api_key,
        GOVERNED_BODY(org, 'ordering probe input'),
      );
      expect(result.status).toBe('completed');
    } finally {
      await basePool.end();
    }

    const idxCredSelect = events.findIndex((e) => e.includes('govai.provider_credentials'));
    expect(idxCredSelect).toBeGreaterThan(-1);
    const idxCredCommit = events.findIndex((e, i) => i > idxCredSelect && e === 'sql:COMMIT');
    const idxKmsStart = events.indexOf('kms_decrypt_start');
    const idxKmsEnd = events.indexOf('kms_decrypt_end');
    const idxRunInsert = events.findIndex((e) => e.includes('INSERT INTO govai.runs'));
    expect(idxRunInsert).toBeGreaterThan(-1);
    const idxTxaBegin = events.lastIndexOf('sql:BEGIN', idxRunInsert);

    // Lookup has its own committed transaction (it MAY exist — §12.3) …
    expect(idxCredCommit).toBeGreaterThan(idxCredSelect);
    // … committed BEFORE the decrypt starts …
    expect(idxKmsStart).toBeGreaterThan(idxCredCommit);
    // … and the decrypt fully completes BEFORE TX-A begins.
    expect(idxKmsEnd).toBeGreaterThan(idxKmsStart);
    expect(idxTxaBegin).toBeGreaterThan(idxKmsEnd);
  });
});

// =============================================================================
// T6 — claim race: two concurrent claimers, one CAS winner, one token, one
// run.dispatch_claimed event. The loser NEVER receives dispatch ownership.
// =============================================================================

describe('T6 — exclusive claim CAS', () => {
  it('two concurrent claims → exactly one winner, one token, one claimed event', async () => {
    const org = await seedOrg(stack);
    const { runId, ctx } = await seedPreparedRun(org);
    const kms = kmsOf();

    const [a, b] = await Promise.all([
      claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 }),
      claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 }),
    ]);
    const winners = [a, b].filter((r) => r.claimed);
    const losers = [a, b].filter((r) => !r.claimed);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const winner = winners[0]! as Extract<typeof a, { claimed: true }>;
    const rows = await queryAsOrg<{ status: string; dispatch_token: string }>(
      org.org_id,
      'SELECT status, dispatch_token FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(rows[0]!.status).toBe('running');
    expect(rows[0]!.dispatch_token).toBe(winner.token);

    const types = await auditEventTypes(org.org_id, runId);
    expect(types.filter((t) => t === 'run.dispatch_claimed')).toHaveLength(1);
  });
});

// =============================================================================
// T6b — the claim race observed at the FORWARDING boundary (§15). T6 proves
// the DB CAS; this test proves the guarantee that actually matters:
// AT_MOST_ONE_LOCAL_FORWARD_INVOCATION_PER_RUN_ID. Two synthetic concurrent
// executors run the orchestrator's exact gate — claim, and ONLY on a won claim
// call the real forwarder (with its onDispatchStart hook) against the hermetic
// upstream. Observed directly: one CAS winner, one forwarder invocation, one
// onDispatchStart, one upstream HTTP request, and a recovery sweep afterwards
// redispatches nothing. DB terminal-write uniqueness alone is NOT the proof.
// =============================================================================

describe('T6b — claim race at the forwarding boundary', () => {
  it('two racing claim+forward executors → one forwarder invocation, one onDispatchStart, one upstream request, zero recovery redispatches', async () => {
    const org = await seedOrg(stack);
    const { runId, ctx } = await seedPreparedRun(org);
    const kms = kmsOf();
    stack.provider.clearRecordedRequestHeaders();

    const bodyBuf = Buffer.from(
      JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'forwarding boundary race probe' }],
      }),
      'utf8',
    );
    const reqHashHex = createHash('sha256').update(bodyBuf).digest('hex');

    let forwarderInvocations = 0;
    let dispatchStarts = 0;

    // The orchestrator's gate, verbatim: only `claim.claimed === true` may
    // reach the forwarder, and the forwarder crosses the REAL durable
    // boundary via beforeDispatch immediately before its fetch (REV4 §12.3 —
    // the exact production ordering: claim → boundary → forward).
    const executor = async () => {
      const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
      if (!claim.claimed) return { claim, fwd: null };
      forwarderInvocations += 1;
      const fwd = await forwardRaw({
        baseUrl: stack.provider.baseUrl,
        pathTemplate: '/v1/messages',
        concretePath: '/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-workspace-id': org.workspace_id,
        },
        body: bodyBuf,
        signal: AbortSignal.timeout(60_000),
        beforeDispatch: async () => {
          const b = await commitDispatchBoundary(stack.db.appPool, ctx, { token: claim.token });
          if (!b.committed) throw new Error(`boundary gate lost: ${b.reason}`);
        },
        onDispatchStart: () => {
          dispatchStarts += 1;
        },
      });
      return { claim, fwd };
    };

    const [a, b] = await Promise.all([executor(), executor()]);
    const winners = [a, b].filter((r) => r.claim.claimed);
    expect(winners).toHaveLength(1);

    // The forwarding boundary itself: exactly one local forward invocation,
    // exactly one dispatch start, exactly one request at the hermetic upstream.
    expect(forwarderInvocations).toBe(1);
    expect(dispatchStarts).toBe(1);
    const upstreamCalls = () =>
      stack.provider.recordedRequestHeaders.filter(
        (h) => h['x-test-workspace-id'] === org.workspace_id,
      );
    expect(upstreamCalls()).toHaveLength(1);

    // Recovery never redispatches: a full sweep leaves the upstream count and
    // the dispatch token untouched.
    await runDispatchRecoverySweepOnce({
      pool: stack.db.appPool,
      kms,
      config: runDispatchConfigFromEnv(stack.env),
    });
    expect(upstreamCalls()).toHaveLength(1);
    const winner = winners[0]!;
    const token = (winner.claim as Extract<typeof winner.claim, { claimed: true }>).token;
    const rows = await queryAsOrg<{ status: string; dispatch_token: string }>(
      org.org_id,
      'SELECT status, dispatch_token FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(rows[0]!.status).toBe('running');
    expect(rows[0]!.dispatch_token).toBe(token);

    // Close the protocol honestly: the winner's REAL forward result finalizes,
    // and the single invocation row is bound to the single token.
    const fwd = winner.fwd!;
    const fin = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: {
        kind: 'http',
        statusCode: fwd.status,
        nativeEndpoint: '/v1/messages',
        nativeRequestHashHex: reqHashHex,
        nativeResponseHashHex: fwd.native_response_hash,
        latencyMs: fwd.latency_ms,
        providerRequestId: fwd.provider_request_id,
        usageJson: { source: 'provider_direct' },
      },
    });
    expect(fin.finalStatus).toBe('completed');
    const inv = await queryAsOrg<{ dispatch_token: string | null }>(
      org.org_id,
      'SELECT dispatch_token FROM govai.provider_invocations WHERE run_id = $1::uuid',
      [runId],
    );
    expect(inv).toHaveLength(1);
    expect(inv[0]!.dispatch_token).toBe(token);
    expect(upstreamCalls()).toHaveLength(1);
  });
});

// =============================================================================
// T10 — known non-2xx: failed + real hashes + status_code + invocation +
// run.failed, and the invocation is bound to the dispatch token.
// =============================================================================

describe('T10 — known non-2xx provider result', () => {
  it('HTTP 500 upstream → 502, status=failed, invocation with hashes + token, run.failed', async () => {
    const org = await seedOrg(stack);
    await configureProviderError(stack, { workspaceId: org.workspace_id, status: 500 });
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, GOVERNED_BODY(org));
    expect(res.statusCode).toBe(502);
    const body = res.body as { run_id: string; status: string; provider_invocation_id?: string };
    expect(body.status).toBe('failed');
    expect(body.provider_invocation_id).toBeDefined();

    const inv = await queryAsOrg<{
      status_code: number;
      native_request_hash: Buffer;
      native_response_hash: Buffer | null;
      dispatch_token: string | null;
      error_class: string | null;
    }>(
      org.org_id,
      `SELECT status_code, native_request_hash, native_response_hash, dispatch_token, error_class
         FROM govai.provider_invocations WHERE run_id = $1::uuid`,
      [body.run_id],
    );
    expect(inv).toHaveLength(1);
    expect(inv[0]!.status_code).toBe(500);
    expect(inv[0]!.native_request_hash.length).toBe(32);
    expect(inv[0]!.native_response_hash).not.toBeNull();
    expect(inv[0]!.native_response_hash!.length).toBe(32);
    expect(inv[0]!.dispatch_token).not.toBeNull();
    expect(inv[0]!.error_class).toBe('provider_error');

    const runRow = await queryAsOrg<{ status: string; dispatch_token: string }>(
      org.org_id,
      'SELECT status, dispatch_token FROM govai.runs WHERE id = $1::uuid',
      [body.run_id],
    );
    expect(runRow[0]!.status).toBe('failed');
    expect(runRow[0]!.dispatch_token).toBe(inv[0]!.dispatch_token);

    const types = await auditEventTypes(org.org_id, body.run_id);
    expect(types).toContain('run.dispatch_prepared');
    expect(types).toContain('run.dispatch_claimed');
    expect(types).toContain('run.failed');
    expect(types).not.toContain('run.completed');
  });
});

// =============================================================================
// T11 — late reconciliation: unknown → known result with the SAME token.
// =============================================================================

describe('T11 — late reconciliation', () => {
  it('outcome_unknown reconciles to completed: one reconciled event, one terminal event, one invocation per token', async () => {
    const org = await seedOrg(stack);
    const { runId, ctx } = await seedPreparedRun(org);
    const kms = kmsOf();

    const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    expect(claim.claimed).toBe(true);
    const token = (claim as Extract<typeof claim, { claimed: true }>).token;
    await commitBoundaryOf(ctx, token);

    const unknown = await markOutcomeUnknown(stack.db.appPool, kms, ctx, {
      token,
      errorClass: 'provider_io_unknown',
      forwardObservation: 'observed_local_forward_invocation',
      invocation: { nativeEndpoint: '/v1/messages', nativeRequestHash: REQ_HASH },
    });
    expect(unknown.transitioned).toBe(true);

    const fin = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: httpOutcome(200),
    });
    expect(fin.reconciled).toBe(true);
    expect(fin.finalStatus).toBe('completed');
    expect(fin.duplicate).toBe(false);

    const rows = await queryAsOrg<{
      status: string;
      outcome_unknown_at: Date | null;
      completed_at: Date | null;
    }>(
      org.org_id,
      'SELECT status, outcome_unknown_at, completed_at FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(rows[0]!.status).toBe('completed');
    // §26: outcome_unknown_at is PRESERVED after reconciliation.
    expect(rows[0]!.outcome_unknown_at).not.toBeNull();
    expect(rows[0]!.completed_at).not.toBeNull();

    const inv = await queryAsOrg<{ id: string }>(
      org.org_id,
      'SELECT id FROM govai.provider_invocations WHERE run_id = $1::uuid AND dispatch_token = $2::uuid',
      [runId, token],
    );
    expect(inv).toHaveLength(1);

    const types = await auditEventTypes(org.org_id, runId);
    expect(types.filter((t) => t === 'run.outcome_unknown')).toHaveLength(1);
    expect(types.filter((t) => t === 'run.outcome_reconciled')).toHaveLength(1);
    expect(types.filter((t) => t === 'run.completed')).toHaveLength(1);
    expect(types.filter((t) => t === 'run.failed')).toHaveLength(0);
  });
});

// =============================================================================
// T17 — concurrent reconciliation: two late finalizations, same token.
// =============================================================================

describe('T17 — concurrent reconciliation', () => {
  it('same token + same result: one invocation, one reconciliation, one terminal transition', async () => {
    const org = await seedOrg(stack);
    const { runId, ctx } = await seedPreparedRun(org);
    const kms = kmsOf();
    const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    expect(claim.claimed).toBe(true);
    const token = (claim as Extract<typeof claim, { claimed: true }>).token;
    await commitBoundaryOf(ctx, token);
    await markOutcomeUnknown(stack.db.appPool, kms, ctx, {
      token,
      errorClass: 'provider_io_unknown',
      forwardObservation: 'observed_local_forward_invocation',
      invocation: { nativeEndpoint: '/v1/messages', nativeRequestHash: REQ_HASH },
    });

    const [f1, f2] = await Promise.all([
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, { token, outcome: httpOutcome(200) }),
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, { token, outcome: httpOutcome(200) }),
    ]);
    const fresh = [f1, f2].filter((f) => !f.duplicate);
    const dup = [f1, f2].filter((f) => f.duplicate);
    expect(fresh).toHaveLength(1);
    expect(dup).toHaveLength(1);
    expect(fresh[0]!.reconciled).toBe(true);

    const inv = await queryAsOrg<{ id: string }>(
      org.org_id,
      'SELECT id FROM govai.provider_invocations WHERE run_id = $1::uuid',
      [runId],
    );
    expect(inv).toHaveLength(1);
    const types = await auditEventTypes(org.org_id, runId);
    expect(types.filter((t) => t === 'run.outcome_reconciled')).toHaveLength(1);
    expect(types.filter((t) => t === 'run.completed')).toHaveLength(1);
  });

  it('a DIVERGENT second finalization is refused, never silently accepted', async () => {
    const org = await seedOrg(stack);
    const { ctx } = await seedPreparedRun(org);
    const kms = kmsOf();
    const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    const token = (claim as Extract<typeof claim, { claimed: true }>).token;
    await commitBoundaryOf(ctx, token);

    const first = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: httpOutcome(200),
    });
    expect(first.finalStatus).toBe('completed');

    await expect(
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, { token, outcome: httpOutcome(500) }),
    ).rejects.toBeInstanceOf(DispatchOutcomeConflictError);
  });

  it('divergence against a RECONCILED run is detected via the terminal event record (NULL invocation trace is not a wildcard)', async () => {
    // The reconciled run's invocation row keeps the NULL unknown-trace fields
    // (evidence rows are never mutated); the known result lives on the terminal
    // lifecycle event. A same-terminal-class duplicate with a DIFFERENT status
    // or response hash must be refused against THAT record.
    const org = await seedOrg(stack);
    const { runId, ctx } = await seedPreparedRun(org);
    const kms = kmsOf();
    const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    expect(claim.claimed).toBe(true);
    const token = (claim as Extract<typeof claim, { claimed: true }>).token;
    await commitBoundaryOf(ctx, token);

    await markOutcomeUnknown(stack.db.appPool, kms, ctx, {
      token,
      errorClass: 'provider_io_unknown',
      forwardObservation: 'observed_local_forward_invocation',
      invocation: { nativeEndpoint: '/v1/messages', nativeRequestHash: REQ_HASH },
    });
    const first = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: httpOutcome(200),
    });
    expect(first.reconciled).toBe(true);
    expect(first.finalStatus).toBe('completed');

    // The invocation row really is the NULL unknown trace (the precondition
    // that made the old wildcard comparison unsound).
    const inv = await queryAsOrg<{ status_code: number | null; native_response_hash: Buffer | null }>(
      org.org_id,
      'SELECT status_code, native_response_hash FROM govai.provider_invocations WHERE run_id = $1::uuid',
      [runId],
    );
    expect(inv).toHaveLength(1);
    expect(inv[0]!.status_code).toBeNull();
    expect(inv[0]!.native_response_hash).toBeNull();

    // Divergent response hash, same completed-class status → refused.
    const divergentHash = {
      ...httpOutcome(200),
      nativeResponseHashHex: createHash('sha256').update('a-different-response-body').digest('hex'),
    };
    await expect(
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, { token, outcome: divergentHash }),
    ).rejects.toBeInstanceOf(DispatchOutcomeConflictError);

    // Divergent status inside the same terminal class (201 is also httpOk) → refused.
    await expect(
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, { token, outcome: httpOutcome(201) }),
    ).rejects.toBeInstanceOf(DispatchOutcomeConflictError);

    // The true duplicate (same status + same hash) stays idempotent.
    const dup = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: httpOutcome(200),
    });
    expect(dup.duplicate).toBe(true);
    expect(dup.finalStatus).toBe('completed');

    // Nothing was double-written by the refused attempts.
    const types = await auditEventTypes(org.org_id, runId);
    expect(types.filter((t) => t === 'run.completed')).toHaveLength(1);
    expect(types.filter((t) => t === 'run.outcome_reconciled')).toHaveLength(1);
  });

  it('reconciliation with a DIVERGENT request identity is refused (the immutable trace row is never silently reused)', async () => {
    // The unknown-trace invocation row recorded (endpoint, request hash); a
    // late "known result" for the same token must carry the SAME request
    // identity — otherwise the reconciled/terminal events would cite a request
    // the immutable invocation row contradicts.
    const org = await seedOrg(stack);
    const { runId, ctx } = await seedPreparedRun(org);
    const kms = kmsOf();
    const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    expect(claim.claimed).toBe(true);
    const token = (claim as Extract<typeof claim, { claimed: true }>).token;
    await commitBoundaryOf(ctx, token);

    await markOutcomeUnknown(stack.db.appPool, kms, ctx, {
      token,
      errorClass: 'provider_io_unknown',
      forwardObservation: 'observed_local_forward_invocation',
      invocation: { nativeEndpoint: '/v1/messages', nativeRequestHash: REQ_HASH },
    });

    // Divergent request hash → refused; run stays honestly unknown.
    const divergentRequest = {
      ...httpOutcome(200),
      nativeRequestHashHex: createHash('sha256').update('a-different-request-body').digest('hex'),
    };
    await expect(
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, { token, outcome: divergentRequest }),
    ).rejects.toBeInstanceOf(DispatchOutcomeConflictError);

    // Divergent endpoint → refused too.
    const divergentEndpoint = { ...httpOutcome(200), nativeEndpoint: '/v1/responses' };
    await expect(
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, { token, outcome: divergentEndpoint }),
    ).rejects.toBeInstanceOf(DispatchOutcomeConflictError);

    const still = await queryAsOrg<{ status: string }>(
      org.org_id,
      'SELECT status FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(still[0]!.status).toBe('outcome_unknown');

    // The TRUE result (matching identity) still reconciles afterwards.
    const fin = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: httpOutcome(200),
    });
    expect(fin.reconciled).toBe(true);
    expect(fin.finalStatus).toBe('completed');
  });

  it('a TERMINAL duplicate offering a divergent request identity is refused (fast path has the same guard)', async () => {
    // Same token, same status, same RESPONSE hash — but a different request
    // hash or endpoint. The already-terminal fast path must fail closed too,
    // not just the reconciliation reuse path.
    const org = await seedOrg(stack);
    const { ctx } = await seedPreparedRun(org);
    const kms = kmsOf();
    const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    expect(claim.claimed).toBe(true);
    const token = (claim as Extract<typeof claim, { claimed: true }>).token;
    await commitBoundaryOf(ctx, token);

    const first = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: httpOutcome(200),
    });
    expect(first.finalStatus).toBe('completed');
    expect(first.duplicate).toBe(false);

    const divergentRequest = {
      ...httpOutcome(200),
      nativeRequestHashHex: createHash('sha256').update('terminal-dup-other-request').digest('hex'),
    };
    await expect(
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, { token, outcome: divergentRequest }),
    ).rejects.toBeInstanceOf(DispatchOutcomeConflictError);

    const divergentEndpoint = { ...httpOutcome(200), nativeEndpoint: '/v1/responses' };
    await expect(
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, { token, outcome: divergentEndpoint }),
    ).rejects.toBeInstanceOf(DispatchOutcomeConflictError);

    // The true duplicate still succeeds idempotently.
    const dup = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: httpOutcome(200),
    });
    expect(dup.duplicate).toBe(true);
  });
});

// =============================================================================
// T23 — NON-HTTP duplicate validation: terminal-status equality alone is not
// equivalence. blocked and local_error duplicates are verified against the
// persisted terminal event; contradictory evidence is refused, fail closed.
// =============================================================================

describe('T23 — blocked / local_error duplicate finalizations are verified, never waved through', () => {
  it('an HTTP-500-failed run refuses a local_error "duplicate" (contradictory failure class)', async () => {
    const org = await seedOrg(stack);
    const { ctx } = await seedPreparedRun(org);
    const kms = kmsOf();
    const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    const token = (claim as Extract<typeof claim, { claimed: true }>).token;
    await commitBoundaryOf(ctx, token);
    const first = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: httpOutcome(500),
    });
    expect(first.finalStatus).toBe('failed');

    await expect(
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
        token,
        outcome: { kind: 'local_error', message: 'pretending this failed locally' },
      }),
    ).rejects.toBeInstanceOf(DispatchOutcomeConflictError);
  });

  it('local_error duplicates: same truncated message is idempotent, different message or an http offer is refused', async () => {
    const org = await seedOrg(stack);
    const { ctx } = await seedPreparedRun(org);
    const kms = kmsOf();
    const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    const token = (claim as Extract<typeof claim, { claimed: true }>).token;
    const message = 'header rewrite failed (synthetic pre-forward)';
    const first = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: { kind: 'local_error', message },
    });
    expect(first.finalStatus).toBe('failed');

    const dup = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: { kind: 'local_error', message },
    });
    expect(dup.duplicate).toBe(true);

    await expect(
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
        token,
        outcome: { kind: 'local_error', message: 'a different local failure story' },
      }),
    ).rejects.toBeInstanceOf(DispatchOutcomeConflictError);

    // An http "duplicate" on a local_error-failed run: same terminal status,
    // but there is no invocation for the token — refused.
    await expect(
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, { token, outcome: httpOutcome(500) }),
    ).rejects.toBeInstanceOf(DispatchOutcomeConflictError);
  });

  it('blocked duplicates: same reason is idempotent, a divergent reason is refused', async () => {
    const org = await seedOrg(stack);
    const { ctx } = await seedPreparedRun(org);
    const kms = kmsOf();
    const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    const token = (claim as Extract<typeof claim, { claimed: true }>).token;
    const first = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: { kind: 'blocked', reason: 'enforcement_blocked:D' },
    });
    expect(first.finalStatus).toBe('denied');

    const dup = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: { kind: 'blocked', reason: 'enforcement_blocked:D' },
    });
    expect(dup.duplicate).toBe(true);

    await expect(
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
        token,
        outcome: { kind: 'blocked', reason: 'a_totally_different_reason' },
      }),
    ).rejects.toBeInstanceOf(DispatchOutcomeConflictError);
  });
});

// =============================================================================
// T12 (TX-B half) — the captured governed v4 is persisted in TX-B exactly
// once; a blocked dispatch persists the v4, marks denied and creates NO
// provider invocation (§21.2).
// =============================================================================

describe('T12 — governed v4 capture persistence', () => {
  it('success: exactly one passthrough.invoked v4 per run, persisted after the fetch', async () => {
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, GOVERNED_BODY(org));
    expect(res.statusCode).toBe(200);
    const body = res.body as { run_id: string; passthrough_invoked_event_id?: string };
    expect(body.passthrough_invoked_event_id).toBeDefined();
    const types = await auditEventTypes(org.org_id, body.run_id);
    expect(types.filter((t) => t === 'passthrough.invoked')).toHaveLength(1);
  });

  it('non-2xx: exactly one v4 as well', async () => {
    const org = await seedOrg(stack);
    await configureProviderError(stack, { workspaceId: org.workspace_id, status: 429 });
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, GOVERNED_BODY(org));
    expect(res.statusCode).toBe(502);
    const body = res.body as { run_id: string };
    const types = await auditEventTypes(org.org_id, body.run_id);
    expect(types.filter((t) => t === 'passthrough.invoked')).toHaveLength(1);
  });

  it('blocked: v4 persisted, run denied, ZERO provider invocations', async () => {
    const org = await seedOrg(stack);
    const { runId, ctx } = await seedPreparedRun(org);
    const kms = kmsOf();
    const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    const token = (claim as Extract<typeof claim, { claimed: true }>).token;

    // A REAL blocked governed dispatch (code_execution tool → blocked before
    // any credential/fetch), captured in memory.
    const capture = createGovernedV4Capture();
    const blocked = await handleAnthropicGovernedMessages(
      {
        tenant: {
          org_id: org.org_id,
          user_id: org.user_id,
          tier: 'starter',
          operational_mode: 'test',
        },
        rawBody: Buffer.from(
          JSON.stringify({
            model: 'claude-fixture-1',
            max_tokens: 16,
            messages: [{ role: 'user', content: 'hi' }],
            tools: [{ type: 'code_execution_20241022', name: 'code_execution' }],
          }),
          'utf8',
        ),
        inboundHeaders: { 'content-type': 'application/json' },
        isStream: false,
      },
      {
        upstreamBaseUrl: stack.provider.baseUrl,
        resolveProviderKey: async () => {
          throw new Error('blocked path must not resolve a credential');
        },
        dlpScan: async () => ({ findings: [] }),
        emitAuditEvent: capture.capture,
      },
    );
    expect(blocked.kind).toBe('blocked');
    // Lazy caller (direct-route shape): the resolver never ran, so the v4
    // honestly records the non-resolution sentinel (F1 contract preserved).
    expect(capture.captured()!.credential_source).toBe('not_resolved_pre_provider_block');

    // Eager caller (F3 orchestrator shape): the credential WAS resolved before
    // the handler ran, so the blocked v4 must record that source — the
    // evidence never contradicts the actual credential access.
    const capture2 = createGovernedV4Capture();
    const blocked2 = await handleAnthropicGovernedMessages(
      {
        tenant: {
          org_id: org.org_id,
          user_id: org.user_id,
          tier: 'starter',
          operational_mode: 'test',
        },
        rawBody: Buffer.from(
          JSON.stringify({
            model: 'claude-fixture-1',
            max_tokens: 16,
            messages: [{ role: 'user', content: 'hi' }],
            tools: [{ type: 'code_execution_20241022', name: 'code_execution' }],
          }),
          'utf8',
        ),
        inboundHeaders: { 'content-type': 'application/json' },
        isStream: false,
      },
      {
        upstreamBaseUrl: stack.provider.baseUrl,
        resolveProviderKey: async () => {
          throw new Error('blocked path must not resolve a credential');
        },
        dlpScan: async () => ({ findings: [] }),
        emitAuditEvent: capture2.capture,
        preResolvedCredentialSource: 'hermetic_test_placeholder',
      },
    );
    expect(blocked2.kind).toBe('blocked');
    expect(capture2.captured()!.credential_source).toBe('hermetic_test_placeholder');

    const fin = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: {
        kind: 'blocked',
        reason: (blocked as { reason: string }).reason,
        capturedV4: capture.captured(),
      },
    });
    expect(fin.finalStatus).toBe('denied');
    expect(fin.v4EventId).toBeDefined();
    expect(fin.invocationId).toBeNull();

    const rows = await queryAsOrg<{ status: string }>(
      org.org_id,
      'SELECT status FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(rows[0]!.status).toBe('denied');
    const inv = await queryAsOrg<{ id: string }>(
      org.org_id,
      'SELECT id FROM govai.provider_invocations WHERE run_id = $1::uuid',
      [runId],
    );
    expect(inv).toHaveLength(0);
    const types = await auditEventTypes(org.org_id, runId);
    expect(types.filter((t) => t === 'passthrough.invoked')).toHaveLength(1);
    expect(types.filter((t) => t === 'run.denied')).toHaveLength(1);
  });
});

// =============================================================================
// T13 — crash window B (after TX-A commit, before any claim): the run is
// durable 'queued', the provider was provably never called, and recovery
// resolves it to a KNOWN failure.
// =============================================================================

describe('T13 — crash after TX-A, before claim', () => {
  it('recovery marks the prepared-but-never-claimed run failed; zero provider calls', async () => {
    const org = await seedOrg(stack);
    const { runId, ctx } = await seedPreparedRun(org, { preparedAgoMs: 600_000 });

    stack.provider.clearRecordedRequestHeaders();
    const result = await runDispatchRecoverySweepOnce({
      pool: stack.db.appPool,
      kms: kmsOf(),
      config: runDispatchConfigFromEnv(stack.env),
    });
    expect(result.queuedFailed).toBeGreaterThanOrEqual(1);

    const rows = await queryAsOrg<{ status: string; dispatch_error_class: string | null }>(
      org.org_id,
      'SELECT status, dispatch_error_class FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.dispatch_error_class).toBe('dispatch_never_claimed');

    // Provider provably not called: zero upstream requests for this workspace
    // and zero invocation rows.
    const calls = stack.provider.recordedRequestHeaders.filter(
      (h) => h['x-test-workspace-id'] === org.workspace_id,
    );
    expect(calls).toHaveLength(0);
    const inv = await queryAsOrg<{ id: string }>(
      ctx.orgId,
      'SELECT id FROM govai.provider_invocations WHERE run_id = $1::uuid',
      [runId],
    );
    expect(inv).toHaveLength(0);

    const types = await auditEventTypes(org.org_id, runId);
    expect(types.filter((t) => t === 'run.failed')).toHaveLength(1);
    expect(types).not.toContain('run.dispatch_claimed');
  });
});

// =============================================================================
// T20 — post-claim terminal persistence failure: the provider ANSWERED but
// TX-B could not persist (pool outage). The response must carry the durable
// run id + retry_safe=false + a Location to poll — never a bare 500 that
// invites re-executing the action under a new run. The run row stays
// 'running' with its token; recovery owns it from here.
// =============================================================================

describe('T20 — persistence failure after the provider answered', () => {
  it('TX-B pool outage → 500 dispatch_persistence_failed with run_id, retry_safe=false, Location; run stays running', async () => {
    const org = await seedOrg(stack);
    const poison = { active: false };
    const pool2 = new Pool({ connectionString: stack.db.appUrl, max: 5 });
    const realConnect = pool2.connect.bind(pool2);
    (pool2 as unknown as { connect: unknown }).connect = ((...args: unknown[]) => {
      if (poison.active) {
        const err = new Error('injected pool outage (T20)');
        if (typeof args[0] === 'function') {
          (args[0] as (e: Error) => void)(err);
          return undefined;
        }
        return Promise.reject(err);
      }
      return (realConnect as (...a: unknown[]) => unknown)(...args);
    }) as typeof pool2.connect;

    const app2 = await buildServer({ env: stack.env, pool: pool2 });
    try {
      const park = setParkOverride(org.workspace_id);
      const pending = app2.inject({
        method: 'POST',
        url: '/v1/runs',
        headers: { 'content-type': 'application/json', 'x-govai-api-key': org.api_key },
        payload: GOVERNED_BODY(org),
      });
      await park.parked; // auth/preflight/TX-A/claim all done; provider in flight
      poison.active = true; // every later pool acquisition (TX-B) fails
      park.release();
      const res = await pending;
      poison.active = false;

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body) as {
        error: string;
        run_id: string;
        audit_chain_id: string;
        retry_safe: boolean;
      };
      expect(body.error).toBe('dispatch_persistence_failed');
      expect(typeof body.run_id).toBe('string');
      expect(body.retry_safe).toBe(false);
      expect(res.headers['location']).toBe(`/v1/runs/${body.run_id}`);

      // Durable truth: the run is still 'running' under its single token —
      // no terminal write, no invented outcome; recovery owns it from here.
      const rows = await queryAsOrg<{ status: string; dispatch_token: string | null }>(
        org.org_id,
        'SELECT status, dispatch_token FROM govai.runs WHERE id = $1::uuid',
        [body.run_id],
      );
      expect(rows[0]!.status).toBe('running');
      expect(rows[0]!.dispatch_token).not.toBeNull();

      // The status endpoint (healthy pool) reports it honestly, poll-able.
      const status = await inject(stack, 'GET', `/v1/runs/${body.run_id}`, org.api_key);
      expect(status.statusCode).toBe(200);
      const s = status.body as Record<string, unknown>;
      expect(s['status']).toBe('running');
      expect(s['retry_safe']).toBe(false);
    } finally {
      await app2.close();
      await pool2.end();
    }
  });
});

// =============================================================================
// T18 — pre-claim and pre-forward KNOWN failures (§16 / §21.3): the two
// known-failure transitions where the provider was provably never reached.
// =============================================================================

describe('T18 — failPreclaim and local pre-forward failure', () => {
  it('failPreclaim: queued → failed with dispatch_preclaim_failed, no token, no invocation; repeat is a no-op; claimed runs are untouchable', async () => {
    const org = await seedOrg(stack);
    const { runId, ctx } = await seedPreparedRun(org);
    const kms = kmsOf();

    const first = await failPreclaim(stack.db.appPool, kms, ctx, {
      errorClass: 'dispatch_preclaim_failed',
      message: 'deterministic validation failed (synthetic)',
    });
    expect(first).toBe(true);

    const rows = await queryAsOrg<{
      status: string;
      dispatch_error_class: string | null;
      dispatch_token: string | null;
      completed_at: Date | null;
    }>(
      org.org_id,
      `SELECT status, dispatch_error_class, dispatch_token, completed_at
         FROM govai.runs WHERE id = $1::uuid`,
      [runId],
    );
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.dispatch_error_class).toBe('dispatch_preclaim_failed');
    expect(rows[0]!.dispatch_token).toBeNull();
    expect(rows[0]!.completed_at).not.toBeNull();

    const inv = await queryAsOrg<{ id: string }>(
      org.org_id,
      'SELECT id FROM govai.provider_invocations WHERE run_id = $1::uuid',
      [runId],
    );
    expect(inv).toHaveLength(0);
    const types = await auditEventTypes(org.org_id, runId);
    expect(types.filter((t) => t === 'run.failed')).toHaveLength(1);
    expect(types).not.toContain('run.dispatch_claimed');

    // Terminal re-entry: a second failPreclaim finds no 'queued' row → false,
    // and no second run.failed event is appended.
    const second = await failPreclaim(stack.db.appPool, kms, ctx, {
      errorClass: 'dispatch_preclaim_failed',
      message: 'repeat (must be a no-op)',
    });
    expect(second).toBe(false);
    expect(
      (await auditEventTypes(org.org_id, runId)).filter((t) => t === 'run.failed'),
    ).toHaveLength(1);

    // A CLAIMED run can never be preclaim-failed (guard: status='queued' AND
    // dispatch_token IS NULL).
    const other = await seedPreparedRun(org);
    const claim = await claimDispatch(stack.db.appPool, kms, other.ctx, { timeoutMs: 60_000 });
    expect(claim.claimed).toBe(true);
    const onClaimed = await failPreclaim(stack.db.appPool, kms, other.ctx, {
      errorClass: 'dispatch_preclaim_failed',
      message: 'must not apply to a claimed run',
    });
    expect(onClaimed).toBe(false);
    const claimedRow = await queryAsOrg<{ status: string }>(
      org.org_id,
      'SELECT status FROM govai.runs WHERE id = $1::uuid',
      [other.runId],
    );
    expect(claimedRow[0]!.status).toBe('running');
  });

  it('local_error after claim: running → failed with dispatch_pre_forward_failed, token retained, zero invocations', async () => {
    const org = await seedOrg(stack);
    const { runId, ctx } = await seedPreparedRun(org);
    const kms = kmsOf();

    const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    expect(claim.claimed).toBe(true);
    const token = (claim as Extract<typeof claim, { claimed: true }>).token;

    const fin = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: { kind: 'local_error', message: 'header rewrite failed (synthetic pre-forward)' },
    });
    expect(fin.finalStatus).toBe('failed');
    expect(fin.invocationId).toBeNull();
    expect(fin.duplicate).toBe(false);
    expect(fin.reconciled).toBe(false);

    const rows = await queryAsOrg<{
      status: string;
      dispatch_error_class: string | null;
      dispatch_token: string | null;
    }>(
      org.org_id,
      'SELECT status, dispatch_error_class, dispatch_token FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.dispatch_error_class).toBe('dispatch_pre_forward_failed');
    expect(rows[0]!.dispatch_token).toBe(token);

    const inv = await queryAsOrg<{ id: string }>(
      org.org_id,
      'SELECT id FROM govai.provider_invocations WHERE run_id = $1::uuid',
      [runId],
    );
    expect(inv).toHaveLength(0);
    const types = await auditEventTypes(org.org_id, runId);
    expect(types.filter((t) => t === 'run.failed')).toHaveLength(1);
    expect(types).not.toContain('run.outcome_unknown');
  });
});

// =============================================================================
// T19 — wrong token + terminal re-entry: a token that does not own the run's
// dispatch can neither finalize nor mark unknown, and a terminal run rejects
// every late transition attempt without emitting duplicate events.
// =============================================================================

describe('T19 — wrong token and terminal re-entry', () => {
  it('a wrong token can neither finalize (DispatchTokenMismatchError) nor mark unknown', async () => {
    const org = await seedOrg(stack);
    const { runId, ctx } = await seedPreparedRun(org);
    const kms = kmsOf();

    const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    expect(claim.claimed).toBe(true);
    const realToken = (claim as Extract<typeof claim, { claimed: true }>).token;
    const wrongToken = randomUUID();
    expect(wrongToken).not.toBe(realToken);

    await expect(
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
        token: wrongToken,
        outcome: httpOutcome(200),
      }),
    ).rejects.toBeInstanceOf(DispatchTokenMismatchError);

    const unknown = await markOutcomeUnknown(stack.db.appPool, kms, ctx, {
      token: wrongToken,
      errorClass: 'provider_io_unknown',
      forwardObservation: 'observed_local_forward_invocation',
      invocation: { nativeEndpoint: '/v1/messages', nativeRequestHash: REQ_HASH },
    });
    expect(unknown.transitioned).toBe(false);
    expect(unknown.status).toBe('running');
    expect(unknown.eventId).toBeNull();
    expect(unknown.invocationId).toBeNull();

    // The run is untouched: still running, still owned by the real token,
    // zero invocation rows, zero unknown/terminal events.
    const rows = await queryAsOrg<{ status: string; dispatch_token: string }>(
      org.org_id,
      'SELECT status, dispatch_token FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(rows[0]!.status).toBe('running');
    expect(rows[0]!.dispatch_token).toBe(realToken);
    const inv = await queryAsOrg<{ id: string }>(
      org.org_id,
      'SELECT id FROM govai.provider_invocations WHERE run_id = $1::uuid',
      [runId],
    );
    expect(inv).toHaveLength(0);
    const types = await auditEventTypes(org.org_id, runId);
    expect(types).not.toContain('run.outcome_unknown');
    expect(types).not.toContain('run.completed');
    expect(types).not.toContain('run.failed');
  });

  it('terminal re-entry: neither claimDispatch nor markOutcomeUnknown moves a completed run', async () => {
    const org = await seedOrg(stack);
    const { runId, ctx } = await seedPreparedRun(org);
    const kms = kmsOf();

    const claim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    expect(claim.claimed).toBe(true);
    const token = (claim as Extract<typeof claim, { claimed: true }>).token;
    await commitBoundaryOf(ctx, token);
    const fin = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: httpOutcome(200),
    });
    expect(fin.finalStatus).toBe('completed');

    // Claim re-entry on the terminal run loses the CAS and reads the state.
    const reclaim = await claimDispatch(stack.db.appPool, kms, ctx, { timeoutMs: 60_000 });
    expect(reclaim.claimed).toBe(false);
    expect((reclaim as Extract<typeof reclaim, { claimed: false }>).status).toBe('completed');

    // markOutcomeUnknown with the CORRECT token on a terminal run: refused,
    // no event, no state change.
    const unknown = await markOutcomeUnknown(stack.db.appPool, kms, ctx, {
      token,
      errorClass: 'provider_io_unknown',
      forwardObservation: 'observed_local_forward_invocation',
      invocation: { nativeEndpoint: '/v1/messages', nativeRequestHash: REQ_HASH },
    });
    expect(unknown.transitioned).toBe(false);
    expect(unknown.status).toBe('completed');
    expect(unknown.eventId).toBeNull();

    const rows = await queryAsOrg<{ status: string; dispatch_token: string }>(
      org.org_id,
      'SELECT status, dispatch_token FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(rows[0]!.status).toBe('completed');
    expect(rows[0]!.dispatch_token).toBe(token);
    const types = await auditEventTypes(org.org_id, runId);
    expect(types.filter((t) => t === 'run.completed')).toHaveLength(1);
    expect(types.filter((t) => t === 'run.dispatch_claimed')).toHaveLength(1);
    expect(types).not.toContain('run.outcome_unknown');
  });
});
