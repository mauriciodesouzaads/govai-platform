// EP-P03A-A (F3) — durable provider dispatch outside run database transactions.
//
// Load-bearing suite (dispatch §29): T1 (F3 falsification), T2 (pool max=1),
// T3 (credential/KMS ordering), T6 (claim race), T10 (known non-2xx), T11
// (late reconciliation), T12 (governed v4 capture, TX-B half), T13 (crash
// window B), T17 (concurrent reconciliation). Real Testcontainers Postgres +
// the hermetic provider-protocol upstream with a deterministic PARK barrier —
// no sleeps, no mocked transactions/locks/pools.

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
  finalizeKnownOutcome,
  markOutcomeUnknown,
  DispatchOutcomeConflictError,
  type RunDispatchContext,
} from '../../apps/api/src/pipeline/run-dispatch-state.js';
import { runDispatchRecoverySweepOnce } from '../../apps/api/src/pipeline/run-dispatch-recovery.js';
import { runDispatchConfigFromEnv } from '../../apps/api/src/pipeline/run-dispatch-config.js';
import { handleAnthropicGovernedMessages } from '../../packages/provider-anthropic/src/governed/handle-messages.js';
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

    // (a) durable + claimed run visible from a SECOND connection.
    const rows = await queryAsOrg<{
      status: string;
      dispatch_protocol_version: number;
      dispatch_token: string | null;
      dispatch_prepared_at: Date | null;
      dispatch_claimed_at: Date | null;
      started_at: Date | null;
    }>(
      org.org_id,
      `SELECT status, dispatch_protocol_version, dispatch_token,
              dispatch_prepared_at, dispatch_claimed_at, started_at
         FROM govai.runs WHERE workspace_id = $1::uuid`,
      [org.workspace_id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('running');
    expect(rows[0]!.dispatch_protocol_version).toBe(1);
    expect(rows[0]!.dispatch_token).not.toBeNull();
    expect(rows[0]!.dispatch_prepared_at).not.toBeNull();
    expect(rows[0]!.dispatch_claimed_at).not.toBeNull();
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

    const unknown = await markOutcomeUnknown(stack.db.appPool, kms, ctx, {
      token,
      errorClass: 'provider_io_unknown',
      forwardStarted: true,
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
    await markOutcomeUnknown(stack.db.appPool, kms, ctx, {
      token,
      errorClass: 'provider_io_unknown',
      forwardStarted: true,
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

    const first = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token,
      outcome: httpOutcome(200),
    });
    expect(first.finalStatus).toBe('completed');

    await expect(
      finalizeKnownOutcome(stack.db.appPool, kms, ctx, { token, outcome: httpOutcome(500) }),
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
