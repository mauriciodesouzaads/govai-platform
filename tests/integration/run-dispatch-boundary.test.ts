// EP-P03A-A REV4 — forensic dispatch-boundary crash windows (CW suite).
//
// Coverage map (dispatch §20): CW1 + CW2 + CW8 live in
// run-dispatch-recovery.test.ts (T8 §18.1/§18.2, T16); CW3 lives in
// run-dispatch-unknown.test.ts (T9/T9b); CW9 and the production-wiring half of
// CW6 live in run-dispatch-durability.test.ts (T1, parked in-flight). This
// file proves the rest: boundary wiring on EVERY protocol-v1 non-stream path,
// CW4 (boundary persistence failure), CW5 (deadline loses the boundary CAS on
// database time), CW6 (exact production ordering: built request → durable gate
// → signal recheck → marker → fetch), CW7 (competing boundary commits), CW10
// (evidence completeness positive control) and CW11 (direct-route
// non-regression). Real Testcontainers Postgres + the hermetic upstream with
// deterministic Promise barriers — no sleeps, no mocked transactions/locks.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { DevKms, type Kms } from '@govai/core-identity';
import { chainIdFor } from '@govai/core-events';
import {
  executeGovernedRun,
  DispatchPersistenceError,
} from '../../apps/api/src/pipeline/run-orchestrator.js';
import {
  commitDispatchBoundary,
  failBoundaryNotEstablished,
  finalizeKnownOutcome,
  type RunDispatchContext,
} from '../../apps/api/src/pipeline/run-dispatch-state.js';
import { forwardRaw } from '../../packages/provider-anthropic/src/passthrough/forward.js';
import { handleAnthropicGovernedMessages } from '../../packages/provider-anthropic/src/governed/handle-messages.js';
import { handleOpenAIGovernedResponses } from '../../packages/provider-openai/src/governed/handle-responses.js';
import { handleOpenAIGovernedChatCompletions } from '../../packages/provider-openai/src/governed/handle-chat-completions.js';
import {
  startStack,
  stopStack,
  seedOrg,
  inject,
  clearProviderErrors,
  type Stack,
  type SeededOrg,
} from './helpers/server-fixture.js';
import { clearParkOverrides } from './fixtures/provider-protocol-server.js';

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

const GOVERNED_BODY = (org: SeededOrg, capability = 'anthropic.messages.create') => ({
  workspace_id: org.workspace_id,
  capability,
  model: capability.startsWith('anthropic') ? 'claude-fixture-1' : 'gpt-fixture-1',
  input: 'boundary suite input',
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
    'SELECT event_type FROM govai.audit_events WHERE subject_id = $1::uuid ORDER BY sequence_number',
    [runId],
  );
  return rows.map((r) => r.event_type);
}

async function eventMetadata(
  orgId: string,
  runId: string,
  eventType: string,
): Promise<Record<string, unknown> | null> {
  const rows = await queryAsOrg<{ redaction_metadata: Record<string, unknown> | null }>(
    orgId,
    `SELECT redaction_metadata FROM govai.audit_events
      WHERE subject_id = $1::uuid AND event_type = $2 ORDER BY sequence_number DESC LIMIT 1`,
    [runId, eventType],
  );
  return rows[0]?.redaction_metadata ?? null;
}

function kmsOf(): Kms {
  return new DevKms(stack.seed);
}

function ctxFor(org: SeededOrg, runId: string): RunDispatchContext {
  return {
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
}

/** Seed a CLAIMED protocol-v1 run directly (running + token + live or expired
 *  deadline, boundary NOT committed) — the exact durable state between the
 *  claim COMMIT and the boundary gate. */
async function seedClaimedRun(
  org: SeededOrg,
  opts: { deadlineInMs?: number } = {},
): Promise<{ runId: string; token: string; ctx: RunDispatchContext }> {
  const runId = randomUUID();
  const token = randomUUID();
  const deadlineIn = opts.deadlineInMs ?? 60_000;
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);
    await c.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at, dispatch_token, dispatch_claimed_at,
          dispatch_timeout_ms, dispatch_deadline_at, started_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'claude-fixture-1',
          'governed', 'running', '{}'::jsonb, 1, now(), $5::uuid, now(), 60000,
          now() + make_interval(secs => $6::integer / 1000.0), now())`,
      [runId, org.org_id, org.workspace_id, org.user_id, token, deadlineIn],
    );
    await c.query('COMMIT');
  } finally {
    c.release();
  }
  return { runId, token, ctx: ctxFor(org, runId) };
}

function upstreamCallsFor(workspaceId: string) {
  return stack.provider.recordedRequestHeaders.filter(
    (h) => h['x-test-workspace-id'] === workspaceId,
  );
}

// =============================================================================
// CW-wiring — the REAL run orchestrator supplies the production boundary gate
// on EVERY protocol-v1 non-stream path (a test-supplied callback proves
// ordering, not wiring — this proves the wiring). For each path: the run
// completes, the durable boundary is committed, and the terminal evidence is
// cryptographically bound to it (§15).
// =============================================================================

describe('CW-wiring — all protocol-v1 non-stream paths cross the durable boundary', () => {
  const PATHS: Array<{ label: string; capability: string; mode?: 'passthrough' }> = [
    { label: 'governed anthropic.messages.create', capability: 'anthropic.messages.create' },
    { label: 'governed openai.responses.create', capability: 'openai.responses.create' },
    {
      label: 'governed openai.chat.completions.create',
      capability: 'openai.chat.completions.create',
    },
    {
      label: 'passthrough anthropic.messages.create',
      capability: 'anthropic.messages.create',
      mode: 'passthrough',
    },
    {
      label: 'passthrough openai.responses.create',
      capability: 'openai.responses.create',
      mode: 'passthrough',
    },
  ];

  for (const p of PATHS) {
    it(`${p.label}: completed run has a committed boundary bound into run.completed`, async () => {
      const org = await seedOrg(stack);
      const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
        ...GOVERNED_BODY(org, p.capability),
        ...(p.mode ? { mode: p.mode } : {}),
      });
      expect(res.statusCode).toBe(200);
      const body = res.body as { run_id: string; status: string };
      expect(body.status).toBe('completed');

      const rows = await queryAsOrg<{
        dispatch_boundary_committed_at: Date | null;
        dispatch_claimed_at: Date | null;
      }>(
        org.org_id,
        `SELECT dispatch_boundary_committed_at, dispatch_claimed_at
           FROM govai.runs WHERE id = $1::uuid`,
        [body.run_id],
      );
      expect(rows[0]!.dispatch_boundary_committed_at).not.toBeNull();
      // Database-time ordering: the boundary commits at/after the claim.
      expect(rows[0]!.dispatch_boundary_committed_at!.getTime()).toBeGreaterThanOrEqual(
        rows[0]!.dispatch_claimed_at!.getTime(),
      );

      const meta = await eventMetadata(org.org_id, body.run_id, 'run.completed');
      expect(meta?.['dispatch_boundary_committed_at']).toBe(
        rows[0]!.dispatch_boundary_committed_at!.toISOString(),
      );
    });
  }
});

// =============================================================================
// CW4 — boundary persistence failure: the short boundary transaction cannot
// reach the database. Fail closed: zero upstream requests, zero forward
// invocations, the KNOWN failure dispatch_boundary_persist_failed is
// persisted, and the safe response still carries the durable run id with
// retry_safe=false. Injection: a wrapper around a REAL pool that rejects
// pool.connect() calls after the claim transaction COMMITs — first exactly
// once (the boundary tx; known-failure persistence then succeeds), then
// permanently (both persistences fail ⇒ DispatchPersistenceError).
// =============================================================================

type PoisonedPool = { pool: Pool; state: { armed: boolean; failuresLeft: number } };

function makeClaimArmedPoisonPool(connectionString: string): PoisonedPool {
  const base = new Pool({ connectionString });
  base.on('error', () => undefined);
  const state = { armed: false, failuresLeft: 0 };
  const realConnect = base.connect.bind(base);
  const wrapped = {
    connect: async (): Promise<PoolClient> => {
      if (state.armed && state.failuresLeft !== 0) {
        if (state.failuresLeft > 0) state.failuresLeft -= 1;
        throw new Error('injected boundary-transaction outage (CW4)');
      }
      const c = (await realConnect()) as PoolClient & { __wrapped?: boolean };
      if (!c.__wrapped) {
        c.__wrapped = true;
        const origQuery = c.query.bind(c) as PoolClient['query'];
        let sawClaimCas = false;
        (c as { query: unknown }).query = ((...args: unknown[]) => {
          const first = args[0];
          const sql =
            typeof first === 'string' ? first : (first as { text?: string } | null)?.text;
          if (typeof sql === 'string') {
            const flat = sql.replace(/\s+/g, ' ');
            if (flat.includes("SET status = 'running'") && flat.includes('dispatch_token = $2')) {
              sawClaimCas = true;
            }
            if (sawClaimCas && flat === 'COMMIT') {
              state.armed = true; // the NEXT pool.connect() is the boundary tx
              sawClaimCas = false;
            }
          }
          return (origQuery as (...a: unknown[]) => unknown)(...args);
        }) as PoolClient['query'];
      }
      return c;
    },
    end: () => base.end(),
  } as unknown as Pool;
  return { pool: wrapped, state };
}

describe('CW4 — boundary persistence failure fails closed with zero provider calls', () => {
  it('boundary tx fails ONCE → known failed dispatch_boundary_persist_failed, run_id + retry_safe=false, upstream untouched', async () => {
    const org = await seedOrg(stack);
    const poisoned = makeClaimArmedPoisonPool(stack.db.appUrl);
    poisoned.state.failuresLeft = 1; // exactly the boundary transaction
    stack.provider.clearRecordedRequestHeaders();
    try {
      const result = await executeGovernedRun(
        { pool: poisoned.pool, kms: kmsOf(), env: stack.env, policyCommitSha: 'test-cw4' },
        org.api_key,
        GOVERNED_BODY(org),
      );
      expect(result.status).toBe('failed');
      expect(result.error_class).toBe('dispatch_boundary_persist_failed');
      expect(result.retry_safe).toBe(false);
      expect(typeof result.run_id).toBe('string');

      // Fail closed: the fetch was never invoked.
      expect(upstreamCallsFor(org.workspace_id)).toHaveLength(0);

      const rows = await queryAsOrg<{
        status: string;
        dispatch_error_class: string | null;
        dispatch_boundary_committed_at: Date | null;
        dispatch_token: string | null;
        completed_at: Date | null;
      }>(
        org.org_id,
        `SELECT status, dispatch_error_class, dispatch_boundary_committed_at,
                dispatch_token, completed_at
           FROM govai.runs WHERE id = $1::uuid`,
        [result.run_id],
      );
      expect(rows[0]!.status).toBe('failed');
      expect(rows[0]!.dispatch_error_class).toBe('dispatch_boundary_persist_failed');
      expect(rows[0]!.dispatch_boundary_committed_at).toBeNull(); // never invented
      expect(rows[0]!.dispatch_token).not.toBeNull();
      expect(rows[0]!.completed_at).not.toBeNull();

      const types = await auditEventTypes(org.org_id, result.run_id);
      expect(types.filter((t) => t === 'run.failed')).toHaveLength(1);
      expect(types).not.toContain('run.outcome_unknown');
      const meta = await eventMetadata(org.org_id, result.run_id, 'run.failed');
      expect(meta?.['error_class']).toBe('dispatch_boundary_persist_failed');
      expect(meta?.['provider_call_count']).toBe(0);

      const inv = await queryAsOrg<{ id: string }>(
        org.org_id,
        'SELECT id FROM govai.provider_invocations WHERE run_id = $1::uuid',
        [result.run_id],
      );
      expect(inv).toHaveLength(0);
    } finally {
      await poisoned.pool.end();
    }
  });

  it('boundary tx AND known-failure persistence both fail → DispatchPersistenceError still carries the durable run id; run stays running; upstream untouched', async () => {
    const org = await seedOrg(stack);
    const poisoned = makeClaimArmedPoisonPool(stack.db.appUrl);
    poisoned.state.failuresLeft = -1; // permanent outage after the claim COMMIT
    stack.provider.clearRecordedRequestHeaders();
    try {
      const err = await executeGovernedRun(
        { pool: poisoned.pool, kms: kmsOf(), env: stack.env, policyCommitSha: 'test-cw4b' },
        org.api_key,
        GOVERNED_BODY(org),
      ).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(DispatchPersistenceError);
      const runId = (err as DispatchPersistenceError).runId;
      expect(typeof runId).toBe('string');
      expect(upstreamCallsFor(org.workspace_id)).toHaveLength(0);

      // Durable truth: still 'running' under its token, boundary NULL —
      // recovery classifies it later as dispatch_never_started from the
      // absent boundary (proven in T8 §18.1).
      const rows = await queryAsOrg<{
        status: string;
        dispatch_boundary_committed_at: Date | null;
      }>(
        org.org_id,
        'SELECT status, dispatch_boundary_committed_at FROM govai.runs WHERE id = $1::uuid',
        [runId],
      );
      expect(rows[0]!.status).toBe('running');
      expect(rows[0]!.dispatch_boundary_committed_at).toBeNull();
    } finally {
      await poisoned.pool.end();
    }
  });
});

// =============================================================================
// CW5 — the deadline expires BEFORE the boundary: the CAS loses on DATABASE
// time, the closed reason is deadline_expired, and a forward gated on it
// never invokes fetch. Known failure, zero provider calls.
// =============================================================================

describe('CW5 — deadline expiry defeats the boundary CAS on database time', () => {
  it('expired claim: CAS refuses (deadline_expired), gated forward never fetches, known failure persists', async () => {
    const org = await seedOrg(stack);
    const { runId, token, ctx } = await seedClaimedRun(org, { deadlineInMs: -5_000 });
    stack.provider.clearRecordedRequestHeaders();

    const cas = await commitDispatchBoundary(stack.db.appPool, ctx, { token });
    expect(cas).toEqual({ committed: false, reason: 'deadline_expired' });

    // The production gate contract: a non-success MUST throw, so forwardRaw
    // never reaches its fetch.
    let dispatchStarts = 0;
    const attempt = forwardRaw({
      baseUrl: stack.provider.baseUrl,
      pathTemplate: '/v1/messages',
      concretePath: '/v1/messages',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-workspace-id': org.workspace_id },
      body: Buffer.from('{"model":"claude-fixture-1"}', 'utf8'),
      signal: AbortSignal.timeout(30_000),
      beforeDispatch: async () => {
        const b = await commitDispatchBoundary(stack.db.appPool, ctx, { token });
        if (!b.committed) throw new Error(`boundary gate refused: ${b.reason}`);
      },
      onDispatchStart: () => {
        dispatchStarts += 1;
      },
    });
    await expect(attempt).rejects.toThrow(/boundary gate refused: deadline_expired/);
    expect(dispatchStarts).toBe(0);
    expect(upstreamCallsFor(org.workspace_id)).toHaveLength(0);

    // §17 — known-failure persistence succeeds (run-aware, count zero).
    const fb = await failBoundaryNotEstablished(stack.db.appPool, kmsOf(), ctx, { token });
    expect(fb.transitioned).toBe(true);
    const rows = await queryAsOrg<{
      status: string;
      dispatch_error_class: string | null;
      dispatch_boundary_committed_at: Date | null;
    }>(
      org.org_id,
      `SELECT status, dispatch_error_class, dispatch_boundary_committed_at
         FROM govai.runs WHERE id = $1::uuid`,
      [runId],
    );
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.dispatch_error_class).toBe('dispatch_boundary_persist_failed');
    expect(rows[0]!.dispatch_boundary_committed_at).toBeNull();
  });

  it('a second boundary commit NEVER re-authorizes a forward (closed already-committed result)', async () => {
    const org = await seedOrg(stack);
    const { token, ctx } = await seedClaimedRun(org);
    const first = await commitDispatchBoundary(stack.db.appPool, ctx, { token });
    expect(first.committed).toBe(true);
    const second = await commitDispatchBoundary(stack.db.appPool, ctx, { token });
    expect(second).toEqual({ committed: false, reason: 'boundary_already_committed' });
    const wrong = await commitDispatchBoundary(stack.db.appPool, ctx, { token: randomUUID() });
    expect(wrong).toEqual({ committed: false, reason: 'wrong_token' });
  });
});

// =============================================================================
// CW6 — exact production ordering, deterministically: the test supplies the
// production callback contract (a REAL PostgreSQL boundary commit, then a
// test-controlled Promise barrier), expires the AbortSignal while parked,
// releases, and the production code's post-callback signal recheck prevents
// the fetch. Boundary committed + signal expired before fetch + zero fetch
// invocations + zero upstream requests + a KNOWN local failure. The
// production-WIRING half (the real orchestrator supplies the gate) is proven
// by CW-wiring above and T1's parked in-flight boundary assertion.
// =============================================================================

describe('CW6 — signal expires between the boundary commit and the fetch', () => {
  it('boundary committed, abort while parked in beforeDispatch → no fetch, known local failure persists with the boundary intact', async () => {
    const org = await seedOrg(stack);
    const { runId, token, ctx } = await seedClaimedRun(org);
    stack.provider.clearRecordedRequestHeaders();

    const ac = new AbortController();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let parkedResolve!: () => void;
    const parked = new Promise<void>((resolve) => {
      parkedResolve = resolve;
    });

    let dispatchStarts = 0;
    let boundaryCommittedAt: Date | null = null;
    const attempt = forwardRaw({
      baseUrl: stack.provider.baseUrl,
      pathTemplate: '/v1/messages',
      concretePath: '/v1/messages',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-workspace-id': org.workspace_id },
      body: Buffer.from('{"model":"claude-fixture-1"}', 'utf8'),
      signal: ac.signal,
      beforeDispatch: async () => {
        const b = await commitDispatchBoundary(stack.db.appPool, ctx, { token });
        if (!b.committed) throw new Error(`boundary gate refused: ${b.reason}`);
        boundaryCommittedAt = b.committedAt;
        parkedResolve();
        await barrier; // deterministic park AFTER the durable commit
      },
      onDispatchStart: () => {
        dispatchStarts += 1;
      },
    });

    await parked; // the boundary is durably committed and the callback parked
    ac.abort(); // the signal expires BEFORE the fetch
    release();

    await expect(attempt).rejects.toMatchObject({ name: 'AbortError' });
    expect(dispatchStarts).toBe(0); // the marker never ran
    expect(upstreamCallsFor(org.workspace_id)).toHaveLength(0); // no fetch
    expect(boundaryCommittedAt).not.toBeNull();

    // The boundary remains historical protocol evidence…
    const rows = await queryAsOrg<{ dispatch_boundary_committed_at: Date | null }>(
      org.org_id,
      'SELECT dispatch_boundary_committed_at FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(rows[0]!.dispatch_boundary_committed_at).not.toBeNull();

    // …and §19.2: the live process KNOWS no fetch happened — a KNOWN local
    // failure (never a provider unknown), valid post-boundary in the matrix.
    const fin = await finalizeKnownOutcome(stack.db.appPool, kmsOf(), ctx, {
      token,
      outcome: { kind: 'local_error', message: 'dispatch aborted after boundary, before fetch' },
    });
    expect(fin.finalStatus).toBe('failed');
    const after = await queryAsOrg<{ status: string; dispatch_error_class: string | null }>(
      org.org_id,
      'SELECT status, dispatch_error_class FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(after[0]!.status).toBe('failed');
    expect(after[0]!.dispatch_error_class).toBe('dispatch_pre_forward_failed');
    const types = await auditEventTypes(org.org_id, runId);
    expect(types).not.toContain('run.outcome_unknown');
    // §15 — the post-boundary failed evidence is bound to the boundary.
    const meta = await eventMetadata(org.org_id, runId, 'run.failed');
    expect(meta?.['dispatch_boundary_committed_at']).toBe(
      rows[0]!.dispatch_boundary_committed_at!.toISOString(),
    );
  });
});

// =============================================================================
// CW7 — competing boundary commits: two concurrent gated forwards on the SAME
// (run, token). Exactly one boundary CAS winner, at most one local forward
// invocation, at most one upstream request; the loser fails closed.
// =============================================================================

describe('CW7 — competing boundary commits', () => {
  it('two concurrent gated forwards → one CAS winner, one fetch, one upstream request; loser fails closed', async () => {
    const org = await seedOrg(stack);
    const { runId, token, ctx } = await seedClaimedRun(org);
    stack.provider.clearRecordedRequestHeaders();

    let dispatchStarts = 0;
    const gatedForward = () =>
      forwardRaw({
        baseUrl: stack.provider.baseUrl,
        pathTemplate: '/v1/messages',
        concretePath: '/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-workspace-id': org.workspace_id,
        },
        body: Buffer.from(
          JSON.stringify({
            model: 'claude-fixture-1',
            max_tokens: 16,
            messages: [{ role: 'user', content: 'cw7 probe' }],
          }),
          'utf8',
        ),
        signal: AbortSignal.timeout(30_000),
        beforeDispatch: async () => {
          const b = await commitDispatchBoundary(stack.db.appPool, ctx, { token });
          if (!b.committed) throw new Error(`boundary gate refused: ${b.reason}`);
        },
        onDispatchStart: () => {
          dispatchStarts += 1;
        },
      });

    const settled = await Promise.allSettled([gatedForward(), gatedForward()]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(
      /boundary gate refused: boundary_already_committed/,
    );
    expect(dispatchStarts).toBe(1);
    expect(upstreamCallsFor(org.workspace_id)).toHaveLength(1);

    const rows = await queryAsOrg<{ dispatch_boundary_committed_at: Date | null }>(
      org.org_id,
      'SELECT dispatch_boundary_committed_at FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    expect(rows[0]!.dispatch_boundary_committed_at).not.toBeNull();
  });
});

// =============================================================================
// CW10 — evidence completeness, positive control: a provider invocation whose
// run has NO lifecycle event at all IS still detected as a gap (the honest-
// unknown exclusions in EC-3a must not blind the detector). The negative
// halves (unknown traces are NOT gaps; late reconciliation stays valid) are
// proven in run-dispatch-unknown.test.ts and T11.
// =============================================================================

describe('CW10 — real provider-without-audit gaps remain detectable', () => {
  it('an invocation row with zero lifecycle events is reported by evidence_provider_without_audit', async () => {
    const org = await seedOrg(stack);
    const { runId, token } = await seedClaimedRun(org);
    // Commit the boundary so the seeded state is protocol-consistent.
    const b = await commitDispatchBoundary(stack.db.appPool, ctxFor(org, runId), { token });
    expect(b.committed).toBe(true);

    const reqHash = createHash('sha256').update('cw10-request').digest();
    const c = await stack.db.adminPool.connect();
    try {
      await c.query(
        `INSERT INTO govai.provider_invocations
           (id, run_id, org_id, provider, native_endpoint, native_method, native_request_hash,
            streaming, usage_json, dispatch_token)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', '/v1/messages', 'POST',
            $4::bytea, false, '{}'::jsonb, $5::uuid)`,
        [randomUUID(), runId, org.org_id, reqHash, token],
      );
    } finally {
      c.release();
    }

    const gaps = await queryAsOrg<{ run_id: string }>(
      org.org_id,
      'SELECT run_id FROM govai.evidence_provider_without_audit WHERE run_id = $1::uuid',
      [runId],
    );
    expect(gaps).toHaveLength(1);
  });
});

// =============================================================================
// CW11 — direct-route non-regression: routes OUTSIDE protocol v1 create no
// run row, receive no boundary hook, perform no boundary write, and keep
// their response contract. (No run row ⇒ no govai.runs write of any kind for
// the request, which subsumes "no boundary write".)
// =============================================================================

describe('CW11 — direct-provider routes remain outside protocol v1', () => {
  it('direct governed route: provider called once, NO govai.runs row, response contract unchanged', async () => {
    const org = await seedOrg(stack);
    stack.provider.clearRecordedRequestHeaders();
    const before = stack.provider.recordedRequestHeaders.length;
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: { 'content-type': 'application/json', 'x-govai-api-key': org.api_key },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 32,
        messages: [{ role: 'user', content: 'direct governed probe' }],
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-govai-capability-level']).toBe('policy_governed');
    const parsed = JSON.parse(res.body) as { type: string; content: unknown[] };
    expect(parsed.type).toBe('message');

    // Exactly one upstream call for this request; direct routes do not carry
    // the test workspace discriminator (that is a /v1/runs plan header).
    expect(stack.provider.recordedRequestHeaders.length).toBe(before + 1);

    // NO protocol-v1 run row (and therefore no boundary write) for this org.
    const runs = await queryAsOrg<{ id: string }>(
      org.org_id,
      'SELECT id FROM govai.runs WHERE org_id = $1::uuid',
      [org.org_id],
    );
    expect(runs).toHaveLength(0);
  });

  it('direct passthrough route: provider called once, NO govai.runs row, native response preserved', async () => {
    const org = await seedOrg(stack);
    stack.provider.clearRecordedRequestHeaders();
    const before = stack.provider.recordedRequestHeaders.length;
    const res = await inject(stack, 'POST', '/passthrough/anthropic/v1/messages', org.api_key, {
      model: 'claude-fixture-1',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'direct passthrough probe' }],
    });
    expect(res.statusCode).toBe(200);
    expect((res.body as { type: string }).type).toBe('message');
    expect(stack.provider.recordedRequestHeaders.length).toBe(before + 1);

    const runs = await queryAsOrg<{ id: string }>(
      org.org_id,
      'SELECT id FROM govai.runs WHERE org_id = $1::uuid',
      [org.org_id],
    );
    expect(runs).toHaveLength(0);
  });
});

// =============================================================================
// CW11b — client-disconnect signals never cancel the non-stream direct
// forward (Codex P1 on a3d2103): the direct routes' EP-008C disconnect
// AbortController is threaded into the governed handlers as `signal`, which
// is STREAM-ONLY; the non-stream forward is bounded only by `dispatchSignal`
// (protocol-v1 orchestrator). An already-aborted disconnect signal therefore
// must NOT abort the non-stream provider call — the call completes and its
// passthrough.invoked evidence is emitted, exactly as before F3 threaded any
// signal into the non-stream forward. All three governed handlers proven.
// =============================================================================

describe('CW11b — a disconnect signal does not cancel the non-stream direct forward', () => {
  const tenantOf = (org: SeededOrg) => ({
    org_id: org.org_id,
    user_id: org.user_id,
    tier: 'starter' as const,
    operational_mode: 'test' as const,
  });
  const depsOf = (events: unknown[]) => ({
    upstreamBaseUrl: stack.provider.baseUrl,
    resolveProviderKey: async () => ({
      apiKey: 'hermetic-placeholder-key',
      source: 'hermetic_test_placeholder' as const,
    }),
    dlpScan: async () => ({ findings: [] }),
    emitAuditEvent: (e: unknown) => {
      events.push(e);
    },
  });

  it('anthropic messages: aborted disconnect signal → provider call completes, evidence emitted', async () => {
    const org = await seedOrg(stack);
    const gone = new AbortController();
    gone.abort(); // the client is already gone (worst case of the race)
    const events: unknown[] = [];
    stack.provider.clearRecordedRequestHeaders();
    const result = await handleAnthropicGovernedMessages(
      {
        tenant: tenantOf(org),
        rawBody: Buffer.from(
          JSON.stringify({
            model: 'claude-fixture-1',
            max_tokens: 16,
            messages: [{ role: 'user', content: 'cw11b anthropic' }],
          }),
          'utf8',
        ),
        inboundHeaders: { 'content-type': 'application/json' },
        isStream: false,
        signal: gone.signal,
      },
      depsOf(events),
    );
    expect(result.kind).toBe('non_stream');
    expect((result as { status_code: number }).status_code).toBe(200);
    expect(events).toHaveLength(1);
    expect(stack.provider.recordedRequestHeaders.length).toBe(1);
  });

  it('openai responses: aborted disconnect signal → provider call completes, evidence emitted', async () => {
    const org = await seedOrg(stack);
    const gone = new AbortController();
    gone.abort();
    const events: unknown[] = [];
    stack.provider.clearRecordedRequestHeaders();
    const result = await handleOpenAIGovernedResponses(
      {
        tenant: tenantOf(org),
        rawBody: Buffer.from(
          JSON.stringify({ model: 'gpt-fixture-1', input: 'cw11b responses' }),
          'utf8',
        ),
        inboundHeaders: { 'content-type': 'application/json' },
        isStream: false,
        signal: gone.signal,
      },
      depsOf(events),
    );
    expect(result.kind).toBe('non_stream');
    expect((result as { status_code: number }).status_code).toBe(200);
    expect(events).toHaveLength(1);
    expect(stack.provider.recordedRequestHeaders.length).toBe(1);
  });

  it('openai chat completions: aborted disconnect signal → provider call completes, evidence emitted', async () => {
    const org = await seedOrg(stack);
    const gone = new AbortController();
    gone.abort();
    const events: unknown[] = [];
    stack.provider.clearRecordedRequestHeaders();
    const result = await handleOpenAIGovernedChatCompletions(
      {
        tenant: tenantOf(org),
        rawBody: Buffer.from(
          JSON.stringify({
            model: 'gpt-fixture-1',
            messages: [{ role: 'user', content: 'cw11b chat' }],
          }),
          'utf8',
        ),
        inboundHeaders: { 'content-type': 'application/json' },
        isStream: false,
        signal: gone.signal,
      },
      depsOf(events),
    );
    expect(result.kind).toBe('non_stream');
    expect((result as { status_code: number }).status_code).toBe(200);
    expect(events).toHaveLength(1);
    expect(stack.provider.recordedRequestHeaders.length).toBe(1);
  });
});
