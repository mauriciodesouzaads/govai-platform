// P0.3-C (EP-P03C) — cross-request run execution idempotency, standalone
// `/v1/runs` surface + PostgreSQL-level winner/RLS/immutability proofs.
//
// Covers §27: T01–T19, T28–T34 (the Workroom surface lives in
// workroom-run-idempotency.test.ts). Real Testcontainers Postgres + the
// hermetic provider-protocol upstream; every provider-call assertion counts
// ACTUAL upstream HTTP requests received by the fixture
// (recordedRequestHeaders keyed by x-test-workspace-id), never mock function
// invocations.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { DevKms } from '@govai/core-identity';
import { chainIdFor } from '@govai/core-events';
import { detectAllBaseline } from '@govai/dlp-br';
import { redactFindings } from '../../apps/api/src/pipeline/dlp.js';
import {
  executeGovernedRun,
  executePassthroughRun,
} from '../../apps/api/src/pipeline/run-orchestrator.js';
import { MissingProviderKeyError } from '../../apps/api/src/pipeline/provider-credentials.js';
import {
  buildStandaloneRunIntent,
  isRunIdempotentReplay,
  runIntentHash,
  RUN_INTENT_HASH_VERSION,
  type RunIdempotentReplay,
} from '../../apps/api/src/pipeline/run-idempotency.js';
import {
  finalizeKnownOutcome,
  type RunDispatchContext,
} from '../../apps/api/src/pipeline/run-dispatch-state.js';
import { runDispatchRecoverySweepOnce } from '../../apps/api/src/pipeline/run-dispatch-recovery.js';
import { runDispatchConfigFromEnv } from '../../apps/api/src/pipeline/run-dispatch-config.js';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  setBaselineDlpAction,
  setOrgOperationalMode,
  type Stack,
  type SeededOrg,
} from './helpers/server-fixture.js';
import {
  setParkOverride,
  clearParkOverrides,
  setDestroyOverride,
  clearDestroyOverrides,
} from './fixtures/provider-protocol-server.js';

const H = 'x-govai-run-idempotency-key';
const MIGRATION_0030 = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../apps/api/src/db/migrations/0030_run_idempotency.sql',
);

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});
afterEach(() => {
  clearParkOverrides();
  clearDestroyOverrides();
});

const keyOf = () => `p03c-key-${randomUUID()}`;

function governedBody(org: SeededOrg, extra: Record<string, unknown> = {}) {
  return {
    workspace_id: org.workspace_id,
    capability: 'anthropic.messages.create',
    model: 'claude-fixture-1',
    input: 'plain governed input',
    ...extra,
  };
}

type Res = {
  statusCode: number;
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | number | undefined>;
};

async function post(
  url: string,
  apiKey: string | undefined,
  payload: unknown,
  extraHeaders: Record<string, string | string[]> = {},
): Promise<Res> {
  const headers: Record<string, string | string[]> = { ...extraHeaders };
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (apiKey) headers['x-govai-api-key'] = apiKey;
  const res = await stack.app.inject({
    method: 'POST',
    url,
    headers,
    payload: payload as Record<string, unknown>,
  });
  let body: unknown;
  try {
    body = res.body.length > 0 ? JSON.parse(res.body) : null;
  } catch {
    body = res.body;
  }
  return {
    statusCode: res.statusCode,
    body: body as Record<string, unknown>,
    headers: res.headers,
  };
}

/** ACTUAL upstream HTTP requests for this workspace (hermetic fixture). */
function providerCalls(workspaceId: string): number {
  return stack.provider.recordedRequestHeaders.filter(
    (h) => h['x-test-workspace-id'] === workspaceId,
  ).length;
}

async function queryAsOrg<T = Record<string, unknown>>(
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

async function countRuns(org: SeededOrg): Promise<number> {
  const r = await queryAsOrg<{ n: string }>(
    org.org_id,
    'SELECT COUNT(*) AS n FROM govai.runs WHERE org_id = $1::uuid',
    [org.org_id],
  );
  return Number(r[0]!.n);
}

async function countBindings(org: SeededOrg): Promise<number> {
  const r = await queryAsOrg<{ n: string }>(
    org.org_id,
    'SELECT COUNT(*) AS n FROM govai.run_idempotency WHERE org_id = $1::uuid',
    [org.org_id],
  );
  return Number(r[0]!.n);
}

function expectReplay(res: Res, runId?: string): void {
  expect(res.statusCode).toBe(200);
  expect(res.body['idempotent_replay']).toBe(true);
  expect(res.headers['x-govai-run-idempotent-replay']).toBe('true');
  expect(res.headers['location']).toBe(`/v1/runs/${res.body['run_id']}`);
  expect(res.body['retry_safe']).toBe(false);
  if (runId) expect(res.body['run_id']).toBe(runId);
}

// =============================================================================
// T01 / T02 — no-key semantics + old AuditBridge header regression
// =============================================================================

describe('T01 — no X-GovAI-Run-Idempotency-Key → existing behavior unchanged', () => {
  it('two identical unkeyed requests are two deliberate executions', async () => {
    const org = await seedOrg(stack);
    const r1 = await post('/v1/runs', org.api_key, governedBody(org));
    const r2 = await post('/v1/runs', org.api_key, governedBody(org));
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.body['run_id']).not.toBe(r2.body['run_id']);
    expect(await countRuns(org)).toBe(2);
    expect(await countBindings(org)).toBe(0);
    expect(providerCalls(org.workspace_id)).toBe(2);
  });
});

describe('T02 — the AuditBridge X-GovAI-Idempotency-Key does NOT suppress /v1/runs', () => {
  it('two identical requests carrying the direct-route evidence header both execute', async () => {
    const org = await seedOrg(stack);
    const hdr = { 'x-govai-idempotency-key': 'same-evidence-key' };
    const r1 = await post('/v1/runs', org.api_key, governedBody(org), hdr);
    const r2 = await post('/v1/runs', org.api_key, governedBody(org), hdr);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.body['run_id']).not.toBe(r2.body['run_id']);
    expect(await countRuns(org)).toBe(2);
    expect(await countBindings(org)).toBe(0);
    expect(providerCalls(org.workspace_id)).toBe(2);
  });
});

// =============================================================================
// T03 — malformed keys
// =============================================================================

describe('T03 — malformed run idempotency key → 400, zero runs, zero provider calls', () => {
  it.each([
    ['empty after trim', '   '],
    ['over 256 chars', 'k'.repeat(257)],
    ['C0 control', 'a\u0001b'],
    ['DEL', 'a\u007fb'],
  ])('%s → 400 invalid_run_idempotency_key', async (_label, bad) => {
    const org = await seedOrg(stack);
    const res = await post('/v1/runs', org.api_key, governedBody(org), { [H]: bad });
    expect(res.statusCode).toBe(400);
    expect(res.body['error']).toBe('invalid_run_idempotency_key');
    expect(await countRuns(org)).toBe(0);
    expect(providerCalls(org.workspace_id)).toBe(0);
  });

  it('ambiguous multi-valued header (two physical header lines) → 400, no silent combining', async () => {
    // Over a REAL socket: Node joins repeated regular headers with ', ' in
    // req.headers, so only the raw header pairs expose the duplication — the
    // exact surface the parser inspects. (app.inject cannot simulate two
    // physical lines; light-my-request pre-joins arrays.)
    const org = await seedOrg(stack);
    await stack.app.listen({ host: '127.0.0.1', port: 0 });
    const address = stack.app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const payload = JSON.stringify(governedBody(org));
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/v1/runs',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
            'x-govai-api-key': org.api_key,
            [H]: ['dup-a', 'dup-b'],
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c: Buffer) => {
            data += c.toString('utf8');
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      req.on('error', reject);
      req.end(payload);
    });
    expect(result.status).toBe(400);
    expect((JSON.parse(result.body) as { error: string }).error).toBe(
      'invalid_run_idempotency_key',
    );
    expect(await countRuns(org)).toBe(0);
    expect(providerCalls(org.workspace_id)).toBe(0);
  });
});

// =============================================================================
// T04 / T05 — standalone governed sequential + concurrent
// =============================================================================

describe('T04 — governed sequential replay', () => {
  it('same key + same intent × 3 → one run, ONE actual provider call', async () => {
    const org = await seedOrg(stack);
    const key = keyOf();
    const first = await post('/v1/runs', org.api_key, governedBody(org), { [H]: key });
    expect(first.statusCode).toBe(200);
    expect(first.body['status']).toBe('completed');
    expect(first.body['idempotent_replay']).toBeUndefined();
    const runId = first.body['run_id'] as string;

    for (let i = 0; i < 2; i += 1) {
      const replay = await post('/v1/runs', org.api_key, governedBody(org), { [H]: key });
      expectReplay(replay, runId);
      expect(replay.body['status']).toBe('completed');
    }
    expect(await countRuns(org)).toBe(1);
    expect(await countBindings(org)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(1);
  });
});

describe('T05 — governed concurrent replay (true race through the API)', () => {
  it('4 concurrent keyed requests → one binding, one committed run, ONE provider call', async () => {
    const org = await seedOrg(stack);
    const key = keyOf();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        post('/v1/runs', org.api_key, governedBody(org), { [H]: key }),
      ),
    );
    for (const r of results) expect(r.statusCode).toBe(200);
    const runIds = new Set(results.map((r) => r.body['run_id']));
    expect(runIds.size).toBe(1);
    expect(await countRuns(org)).toBe(1);
    expect(await countBindings(org)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(1);
  });
});

// =============================================================================
// T06 / T07 — standalone passthrough sequential + concurrent
// =============================================================================

describe('T06 — passthrough sequential replay', () => {
  it('same key × 3 → one run, one provider call', async () => {
    const org = await seedOrg(stack);
    const key = keyOf();
    const body = governedBody(org, { mode: 'passthrough' });
    const first = await post('/v1/runs', org.api_key, body, { [H]: key });
    expect(first.statusCode).toBe(200);
    expect(first.body['status']).toBe('completed');
    const runId = first.body['run_id'] as string;

    for (let i = 0; i < 2; i += 1) {
      const replay = await post('/v1/runs', org.api_key, body, { [H]: key });
      expectReplay(replay, runId);
      expect(replay.body['mode']).toBe('passthrough');
    }
    expect(await countRuns(org)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(1);
  });
});

describe('T07 — passthrough concurrent replay', () => {
  it('4 concurrent keyed passthrough requests → one run, one provider call', async () => {
    const org = await seedOrg(stack);
    const key = keyOf();
    const body = governedBody(org, { mode: 'passthrough' });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => post('/v1/runs', org.api_key, body, { [H]: key })),
    );
    for (const r of results) expect(r.statusCode).toBe(200);
    expect(new Set(results.map((r) => r.body['run_id'])).size).toBe(1);
    expect(await countRuns(org)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(1);
  });
});

// =============================================================================
// T08–T11 — semantic divergence → 409
// =============================================================================

describe('T08–T11 — same key + divergent semantic intent → 409, no second execution', () => {
  it.each([
    ['changed input (T08)', { input: 'a different input' }],
    ['changed model (T09)', { model: 'claude-fixture-2' }],
    ['changed resolved mode (T10)', { mode: 'passthrough' as const }],
    ['changed metadata (T11) — provider-native body would be identical', { metadata: { note: 'divergent' } }],
  ])('%s', async (_label, patch) => {
    const org = await seedOrg(stack);
    const key = keyOf();
    const first = await post('/v1/runs', org.api_key, governedBody(org), { [H]: key });
    expect(first.statusCode).toBe(200);

    const conflict = await post('/v1/runs', org.api_key, governedBody(org, patch), { [H]: key });
    expect(conflict.statusCode).toBe(409);
    // Static body only: no key, no hashes, no stored request, no actor detail.
    expect(conflict.body).toEqual({ error: 'idempotency_key_conflict' });

    expect(await countRuns(org)).toBe(1);
    expect(await countBindings(org)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(1);
  });
});

// =============================================================================
// T12 / T13 — actor + tenant identity
// =============================================================================

describe('T12 — different actor, same org + key → 409 (never a cross-actor replay)', () => {
  it('the second actor gets a conflict and no access to the original run', async () => {
    const org = await seedOrg(stack);
    const actor2 = await addApiKey(stack, org.org_id, randomUUID(), ['developer']);
    const key = keyOf();
    const first = await post('/v1/runs', org.api_key, governedBody(org), { [H]: key });
    expect(first.statusCode).toBe(200);

    const other = await post('/v1/runs', actor2.api_key, governedBody(org), { [H]: key });
    expect(other.statusCode).toBe(409);
    expect(other.body).toEqual({ error: 'idempotency_key_conflict' });
    expect(await countRuns(org)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(1);
  });
});

describe('T13 — cross-org same raw key → independent bindings, no visibility/conflict', () => {
  it('both orgs execute with the same raw key', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    const key = keyOf();
    const a = await post('/v1/runs', orgA.api_key, governedBody(orgA), { [H]: key });
    const b = await post('/v1/runs', orgB.api_key, governedBody(orgB), { [H]: key });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.body['run_id']).not.toBe(b.body['run_id']);
    expect(await countRuns(orgA)).toBe(1);
    expect(await countRuns(orgB)).toBe(1);
    expect(providerCalls(orgA.workspace_id)).toBe(1);
    expect(providerCalls(orgB.workspace_id)).toBe(1);
  });
});

// =============================================================================
// T14 — the raw key never becomes durable
// =============================================================================

describe('T14 — raw-key absence from durable state and error surfaces', () => {
  it('only the sha256 exists; no table row and no response carries the raw key', async () => {
    const org = await seedOrg(stack);
    const canary = `raw-key-canary-${randomUUID()}`;
    const first = await post('/v1/runs', org.api_key, governedBody(org), { [H]: canary });
    expect(first.statusCode).toBe(200);
    expect(JSON.stringify(first.body)).not.toContain(canary);

    const replay = await post('/v1/runs', org.api_key, governedBody(org), { [H]: canary });
    expect(JSON.stringify(replay.body)).not.toContain(canary);
    const conflict = await post(
      '/v1/runs',
      org.api_key,
      governedBody(org, { input: 'divergent' }),
      { [H]: canary },
    );
    expect(conflict.statusCode).toBe(409);
    expect(JSON.stringify(conflict.body)).not.toContain(canary);

    const binding = await queryAsOrg<{
      len: number;
      is_sha: boolean;
      contains_raw: boolean;
      version: number;
    }>(
      org.org_id,
      `SELECT octet_length(idempotency_key_hash) AS len,
              idempotency_key_hash = $1::bytea AS is_sha,
              position(convert_to($2, 'UTF8') in idempotency_key_hash) > 0 AS contains_raw,
              request_hash_version AS version
         FROM govai.run_idempotency WHERE org_id = $3::uuid`,
      [createHash('sha256').update(canary, 'utf8').digest(), canary, org.org_id],
    );
    expect(binding).toHaveLength(1);
    expect(binding[0]!.len).toBe(32);
    expect(binding[0]!.is_sha).toBe(true);
    expect(binding[0]!.contains_raw).toBe(false);
    expect(binding[0]!.version).toBe(RUN_INTENT_HASH_VERSION);

    // Whole-row scans: the canary appears in NO durable run/audit surface.
    for (const table of ['govai.runs', 'govai.audit_events', 'govai.run_idempotency']) {
      const rows = await queryAsOrg<{ n: string }>(
        org.org_id,
        `SELECT COUNT(*) AS n FROM ${table} t WHERE t::text LIKE '%' || $1 || '%'`,
        [canary],
      );
      expect(Number(rows[0]!.n)).toBe(0);
    }

    // §6 — the header is never forwarded upstream: the ONE provider request
    // for this workspace carries neither the header nor the raw key anywhere.
    const upstream = stack.provider.recordedRequestHeaders.filter(
      (h) => h['x-test-workspace-id'] === org.workspace_id,
    );
    expect(upstream).toHaveLength(1);
    expect(upstream[0]!['x-govai-run-idempotency-key']).toBeUndefined();
    expect(JSON.stringify(upstream[0])).not.toContain(canary);
  });
});

// =============================================================================
// T15 — policy-deny idempotency (no provider invocation exists for the run)
// =============================================================================

describe('T15 — policy deny replay', () => {
  it('one denied run + one policy side-effect set; replay returns the same denied run', async () => {
    const org = await seedOrg(stack);
    await setBaselineDlpAction(stack, org.org_id, 'cpf', 'deny');
    const key = keyOf();
    const body = governedBody(org, { input: 'cliente cpf 111.444.777-35 fim' });

    const first = await post('/v1/runs', org.api_key, body, { [H]: key });
    expect(first.statusCode).toBe(403);
    expect(first.body['status']).toBe('denied');
    const runId = first.body['run_id'] as string;

    const decisionsBefore = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.policy_decisions WHERE run_id = $1::uuid',
      [runId],
    );
    const findingsBefore = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.dlp_findings WHERE run_id = $1::uuid',
      [runId],
    );

    const replay = await post('/v1/runs', org.api_key, body, { [H]: key });
    expectReplay(replay, runId);
    expect(replay.body['status']).toBe('denied');

    const decisionsAfter = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.policy_decisions WHERE run_id = $1::uuid',
      [runId],
    );
    const findingsAfter = await queryAsOrg<{ n: string }>(
      org.org_id,
      'SELECT COUNT(*) AS n FROM govai.dlp_findings WHERE run_id = $1::uuid',
      [runId],
    );
    expect(decisionsAfter[0]!.n).toBe(decisionsBefore[0]!.n);
    expect(Number(decisionsAfter[0]!.n)).toBe(1);
    expect(findingsAfter[0]!.n).toBe(findingsBefore[0]!.n);
    expect(await countRuns(org)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(0);
  });
});

// =============================================================================
// T16 — pre-forward durable keyed run (queued; no provider invocation yet)
// =============================================================================

describe('T16 — replay of a durable pre-forward run', () => {
  it('a queued protocol-v1 run with a binding replays without any dispatch', async () => {
    const org = await seedOrg(stack);
    const key = keyOf();
    const input = 'pre-forward durable input';
    const runId = randomUUID();
    const intentHash = runIntentHash(
      buildStandaloneRunIntent({
        actorUserId: org.user_id,
        workspaceId: org.workspace_id,
        capability: 'anthropic.messages.create',
        model: 'claude-fixture-1',
        input,
        resolvedMode: 'governed',
        metadata: undefined,
      }),
    );
    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);
      await c.query(
        `INSERT INTO govai.runs
           (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
            dispatch_protocol_version, dispatch_prepared_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'claude-fixture-1',
            'governed', 'queued', '{}'::jsonb, 1, now())`,
        [runId, org.org_id, org.workspace_id, org.user_id],
      );
      await c.query(
        `INSERT INTO govai.run_idempotency
           (org_id, idempotency_key_hash, request_canonical_hash, request_hash_version,
            route_scope, run_id)
         VALUES ($1::uuid, $2::bytea, $3::bytea, 1, 'standalone', $4::uuid)`,
        [org.org_id, createHash('sha256').update(key, 'utf8').digest(), intentHash, runId],
      );
      await c.query('COMMIT');
    } finally {
      c.release();
    }

    const replay = await post('/v1/runs', org.api_key, governedBody(org, { input }), {
      [H]: key,
    });
    expectReplay(replay, runId);
    expect(replay.body['status']).toBe('queued');
    expect(providerCalls(org.workspace_id)).toBe(0);
    expect(await countRuns(org)).toBe(1);
  });
});

// =============================================================================
// T17 — replay WHILE the original provider call is in flight (parked upstream)
// =============================================================================

describe('T17 — in-flight replay', () => {
  it('replay during the provider call returns the running run; provider count stays 1', async () => {
    const org = await seedOrg(stack);
    const key = keyOf();
    const park = setParkOverride(org.workspace_id);

    const original = post('/v1/runs', org.api_key, governedBody(org), { [H]: key });
    await park.parked; // the ONE upstream request is now provably in flight

    const replay = await post('/v1/runs', org.api_key, governedBody(org), { [H]: key });
    expectReplay(replay);
    expect(replay.body['status']).toBe('running');
    expect(providerCalls(org.workspace_id)).toBe(1);

    park.release();
    const first = await original;
    expect(first.statusCode).toBe(200);
    expect(first.body['status']).toBe('completed');
    expect(first.body['run_id']).toBe(replay.body['run_id']);
    expect(providerCalls(org.workspace_id)).toBe(1);
    expect(await countRuns(org)).toBe(1);
  });
});

// =============================================================================
// T18 / T19 / T34 — honest unknown, late reconciliation, recovery composition
// =============================================================================

describe('T18/T19/T34 — outcome_unknown replay, late reconciliation, recovery', () => {
  it('unknown replays honestly; a late known result reconciles; replay then shows terminal state; zero redispatch', async () => {
    const org = await seedOrg(stack);
    const key = keyOf();
    setDestroyOverride(org.workspace_id);

    const first = await post('/v1/runs', org.api_key, governedBody(org), { [H]: key });
    expect(first.statusCode).toBe(202);
    expect(first.body['status']).toBe('outcome_unknown');
    const runId = first.body['run_id'] as string;
    clearDestroyOverrides();
    expect(providerCalls(org.workspace_id)).toBe(1);

    // T18 — matching retry returns the SAME unknown run with zero redispatch.
    const replay = await post('/v1/runs', org.api_key, governedBody(org), { [H]: key });
    expectReplay(replay, runId);
    expect(replay.body['status']).toBe('outcome_unknown');
    expect(providerCalls(org.workspace_id)).toBe(1);

    // T34 — the recovery worker never calls the provider.
    const kms = new DevKms(stack.seed);
    await runDispatchRecoverySweepOnce({
      pool: stack.db.appPool,
      kms,
      config: runDispatchConfigFromEnv(stack.env),
    });
    expect(providerCalls(org.workspace_id)).toBe(1);

    // T19 — the late KNOWN result reaches the existing reconciliation path.
    const row = await queryAsOrg<{ dispatch_token: string }>(
      org.org_id,
      'SELECT dispatch_token FROM govai.runs WHERE id = $1::uuid',
      [runId],
    );
    const inv = await queryAsOrg<{ native_request_hash: Buffer }>(
      org.org_id,
      'SELECT native_request_hash FROM govai.provider_invocations WHERE run_id = $1::uuid',
      [runId],
    );
    expect(inv).toHaveLength(1);
    const ctx: RunDispatchContext = {
      orgId: org.org_id,
      runId,
      chainId: chainIdFor(org.org_id, 'run'),
      actorUserId: org.user_id,
      mode: 'governed',
      provider: 'anthropic',
      capabilityId: 'anthropic.messages.create',
      model: 'claude-fixture-1',
    };
    const fin = await finalizeKnownOutcome(stack.db.appPool, kms, ctx, {
      token: row[0]!.dispatch_token,
      outcome: {
        kind: 'http',
        statusCode: 200,
        nativeEndpoint: '/v1/messages',
        nativeRequestHashHex: inv[0]!.native_request_hash.toString('hex'),
        nativeResponseHashHex: 'ab'.repeat(32),
        latencyMs: 12,
        providerRequestId: 'late-reconciled-req',
        usageJson: { source: 'provider_direct' },
      },
    });
    expect(fin.reconciled).toBe(true);
    expect(fin.finalStatus).toBe('completed');

    // Replay AFTER reconciliation observes the terminal state; still no redispatch.
    const replay2 = await post('/v1/runs', org.api_key, governedBody(org), { [H]: key });
    expectReplay(replay2, runId);
    expect(replay2.body['status']).toBe('completed');
    expect(providerCalls(org.workspace_id)).toBe(1);
    expect(await countRuns(org)).toBe(1);
  });
});

// =============================================================================
// T28 / T29 — the PostgreSQL winner arbitration itself
// =============================================================================

async function beginAsOrg(orgId: string): Promise<PoolClient> {
  const c = await stack.db.appPool.connect();
  await c.query('BEGIN');
  await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
  return c;
}

async function insertCandidateRun(c: PoolClient, org: SeededOrg, runId: string): Promise<void> {
  await c.query(
    `INSERT INTO govai.runs
       (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'claude-fixture-1',
        'governed', 'queued', '{}'::jsonb)`,
    [runId, org.org_id, org.workspace_id, org.user_id],
  );
}

async function insertBinding(
  c: PoolClient,
  org: SeededOrg,
  keyHash: Buffer,
  runId: string,
): Promise<number> {
  const r = await c.query(
    `INSERT INTO govai.run_idempotency
       (org_id, idempotency_key_hash, request_canonical_hash, request_hash_version,
        route_scope, run_id)
     VALUES ($1::uuid, $2::bytea, $3::bytea, 1, 'standalone', $4::uuid)
     ON CONFLICT (org_id, idempotency_key_hash) DO NOTHING
     RETURNING run_id`,
    [org.org_id, keyHash, createHash('sha256').update(runId, 'utf8').digest(), runId],
  );
  return r.rows.length;
}

describe('T28 — true database race: competing transactions, one binding/run', () => {
  it('the contender blocks on the unique arbiter and loses only after the winner COMMITS', async () => {
    const org = await seedOrg(stack);
    const keyHash = createHash('sha256').update(keyOf(), 'utf8').digest();
    const runA = randomUUID();
    const runB = randomUUID();

    const a = await beginAsOrg(org.org_id);
    const b = await beginAsOrg(org.org_id);
    try {
      await insertCandidateRun(a, org, runA);
      expect(await insertBinding(a, org, keyHash, runA)).toBe(1);

      await insertCandidateRun(b, org, runB);
      const bInsert = insertBinding(b, org, keyHash, runB);
      // B is blocked on A's uncommitted speculative insert — it must not
      // resolve while A's transaction is open.
      const pending = await Promise.race([
        bInsert.then(() => 'resolved'),
        new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 150)),
      ]);
      expect(pending).toBe('pending');

      await a.query('COMMIT');
      expect(await bInsert).toBe(0); // loser
      await b.query('ROLLBACK');
    } finally {
      a.release();
      b.release();
    }

    const bindings = await queryAsOrg<{ run_id: string }>(
      org.org_id,
      'SELECT run_id FROM govai.run_idempotency WHERE org_id = $1::uuid AND idempotency_key_hash = $2::bytea',
      [org.org_id, keyHash],
    );
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.run_id).toBe(runA);
    // The loser's candidate run was rolled back — only the winner's exists.
    const runs = await queryAsOrg<{ id: string }>(
      org.org_id,
      'SELECT id FROM govai.runs WHERE id = ANY($1::uuid[])',
      [[runA, runB]],
    );
    expect(runs.map((r) => r.id)).toEqual([runA]);
  });
});

describe('T29 — winner rollback lets a surviving contender become the winner', () => {
  it('first contender ROLLBACK → second contender inserts and commits', async () => {
    const org = await seedOrg(stack);
    const keyHash = createHash('sha256').update(keyOf(), 'utf8').digest();
    const runA = randomUUID();
    const runB = randomUUID();

    const a = await beginAsOrg(org.org_id);
    const b = await beginAsOrg(org.org_id);
    try {
      await insertCandidateRun(a, org, runA);
      expect(await insertBinding(a, org, keyHash, runA)).toBe(1);

      await insertCandidateRun(b, org, runB);
      const bInsert = insertBinding(b, org, keyHash, runB);

      await a.query('ROLLBACK');
      expect(await bInsert).toBe(1); // the surviving contender becomes the winner
      await b.query('COMMIT');
    } finally {
      a.release();
      b.release();
    }

    const bindings = await queryAsOrg<{ run_id: string }>(
      org.org_id,
      'SELECT run_id FROM govai.run_idempotency WHERE org_id = $1::uuid AND idempotency_key_hash = $2::bytea',
      [org.org_id, keyHash],
    );
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.run_id).toBe(runB);
  });
});

// =============================================================================
// T30 / T31 — RLS + immutability privileges
// =============================================================================

describe('T30 — RLS: org A cannot see or reuse org B bindings', () => {
  it('cross-tenant SELECT is empty and a cross-tenant INSERT violates RLS', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    const key = keyOf();
    const res = await post('/v1/runs', orgB.api_key, governedBody(orgB), { [H]: key });
    expect(res.statusCode).toBe(200);

    // Under org A's tenant context, org B's binding is invisible.
    const visible = await queryAsOrg<{ n: string }>(
      orgA.org_id,
      'SELECT COUNT(*) AS n FROM govai.run_idempotency',
    );
    expect(Number(visible[0]!.n)).toBe(0);

    // A cross-tenant INSERT (org B's org_id under org A's context) is blocked.
    const c = await beginAsOrg(orgA.org_id);
    try {
      await expect(
        c.query(
          `INSERT INTO govai.run_idempotency
             (org_id, idempotency_key_hash, request_canonical_hash, request_hash_version,
              route_scope, run_id)
           VALUES ($1::uuid, $2::bytea, $3::bytea, 1, 'standalone', $4::uuid)`,
          [
            orgB.org_id,
            createHash('sha256').update('x', 'utf8').digest(),
            createHash('sha256').update('y', 'utf8').digest(),
            res.body['run_id'],
          ],
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });
});

describe('T31 — immutable binding: the app role cannot UPDATE or DELETE', () => {
  it('UPDATE and DELETE as govai_app are permission-denied even in-tenant', async () => {
    const org = await seedOrg(stack);
    const res = await post('/v1/runs', org.api_key, governedBody(org), { [H]: keyOf() });
    expect(res.statusCode).toBe(200);

    for (const sql of [
      "UPDATE govai.run_idempotency SET route_scope = 'workroom' WHERE org_id = $1::uuid",
      'DELETE FROM govai.run_idempotency WHERE org_id = $1::uuid',
    ]) {
      const c = await beginAsOrg(org.org_id);
      try {
        await expect(c.query(sql, [org.org_id])).rejects.toThrow(/permission denied/);
      } finally {
        await c.query('ROLLBACK').catch(() => undefined);
        c.release();
      }
    }
    expect(await countBindings(org)).toBe(1);
  });
});

// =============================================================================
// T32 — migration 0030 reapplication
// =============================================================================

describe('T32 — migration 0030 is idempotent', () => {
  it('re-running the migration twice leaves existing bindings intact', async () => {
    const org = await seedOrg(stack);
    const res = await post('/v1/runs', org.api_key, governedBody(org), { [H]: keyOf() });
    expect(res.statusCode).toBe(200);
    const before = await countBindings(org);

    const sql = await readFile(MIGRATION_0030, 'utf8');
    await stack.db.adminPool.query(sql);
    await stack.db.adminPool.query(sql);

    expect(await countBindings(org)).toBe(before);
    const replayable = await post('/v1/runs', org.api_key, governedBody(org), { [H]: keyOf() });
    expect(replayable.statusCode).toBe(200);
  });
});

// =============================================================================
// Pre-reservation failure window (Codex P2 on c909f72): setup fails AFTER the
// probe missed the winner's UNCOMMITTED binding, and the winner then commits.
// A matching keyed retry must observe the winner via the single recheck; a
// rolled-back winner must leave the ORIGINAL error untouched (no polling, no
// credential/provider retry).
// =============================================================================

/** A REAL pool whose clients fire `onFirstIdempotencyRead` exactly once,
 *  right after the FIRST govai.run_idempotency SELECT resolves — the
 *  deterministic hook that lands a concurrent winner's COMMIT/ROLLBACK inside
 *  the pre-reservation window (post-probe, pre-arbitration). The later
 *  recheck read does not re-fire. */
function probeTriggeredPool(
  connectionString: string,
  onFirstIdempotencyRead: () => Promise<void>,
): { pool: Pool; end: () => Promise<void>; didFire: () => boolean } {
  const basePool = new Pool({ connectionString });
  let fired = false;
  const ORIG = Symbol('origQuery');
  const pool = {
    connect: async () => {
      const c = (await basePool.connect()) as PoolClient & { [ORIG]?: PoolClient['query'] };
      c[ORIG] ??= c.query.bind(c) as PoolClient['query'];
      const orig = c[ORIG];
      (c as { query: unknown }).query = (async (...args: unknown[]) => {
        const first = args[0];
        const sql = typeof first === 'string' ? first : (first as { text?: string } | null)?.text;
        const result = await (orig as (...a: unknown[]) => Promise<unknown>)(...args);
        if (!fired && typeof sql === 'string' && sql.includes('FROM govai.run_idempotency')) {
          fired = true;
          await onFirstIdempotencyRead();
        }
        return result;
      }) as PoolClient['query'];
      return c;
    },
  } as unknown as Pool;
  return { pool, end: () => basePool.end(), didFire: () => fired };
}

describe('pre-reservation failure recheck', () => {
  const WINDOW_INPUT = 'pre-reservation window input';

  function windowIntentHash(org: SeededOrg, resolvedMode: 'governed' | 'passthrough'): Buffer {
    return runIntentHash(
      buildStandaloneRunIntent({
        actorUserId: org.user_id,
        workspaceId: org.workspace_id,
        capability: 'anthropic.messages.create',
        model: 'claude-fixture-1',
        input: WINDOW_INPUT,
        resolvedMode,
        metadata: undefined,
      }),
    );
  }

  async function seedOpenWinner(
    org: SeededOrg,
    key: string,
    mode: 'governed' | 'passthrough',
  ): Promise<{ winner: PoolClient; runW: string }> {
    const runW = randomUUID();
    const winner = await beginAsOrg(org.org_id);
    await winner.query(
      `INSERT INTO govai.runs
         (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata,
          dispatch_protocol_version, dispatch_prepared_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'anthropic', 'claude-fixture-1',
          $5::text, 'queued', '{}'::jsonb, 1, now())`,
      [runW, org.org_id, org.workspace_id, org.user_id, mode],
    );
    await winner.query(
      `INSERT INTO govai.run_idempotency
         (org_id, idempotency_key_hash, request_canonical_hash, request_hash_version,
          route_scope, run_id)
       VALUES ($1::uuid, $2::bytea, $3::bytea, 1, 'standalone', $4::uuid)`,
      [org.org_id, createHash('sha256').update(key, 'utf8').digest(), windowIntentHash(org, mode), runW],
    );
    return { winner, runW };
  }

  it('governed: credential failure inside the window → replay of the committed winner', async () => {
    const org = await seedOrg(stack);
    // production mode + no tenant credential ⇒ resolveCredentialForProvider FAILS.
    await setOrgOperationalMode(stack, org.org_id, 'production');
    const key = keyOf();
    const { winner, runW } = await seedOpenWinner(org, key, 'governed');
    const trig = probeTriggeredPool(stack.db.appUrl, async () => {
      await winner.query('COMMIT');
    });
    try {
      const result = await executeGovernedRun(
        { pool: trig.pool, kms: new DevKms(stack.seed), env: stack.env, policyCommitSha: 'p03c-w1' },
        org.api_key,
        {
          workspace_id: org.workspace_id,
          capability: 'anthropic.messages.create',
          model: 'claude-fixture-1',
          input: WINDOW_INPUT,
        },
        undefined,
        { keyHash: createHash('sha256').update(key, 'utf8').digest() },
      );
      expect(trig.didFire()).toBe(true);
      expect(isRunIdempotentReplay(result)).toBe(true);
      const replay = result as RunIdempotentReplay;
      expect(replay.run_id).toBe(runW);
      expect(replay.status).toBe('queued');
    } finally {
      winner.release();
      await trig.end();
    }
    expect(providerCalls(org.workspace_id)).toBe(0);
    expect(await countRuns(org)).toBe(1);
  });

  it('governed control: winner rolls back → the ORIGINAL credential error is preserved', async () => {
    const org = await seedOrg(stack);
    await setOrgOperationalMode(stack, org.org_id, 'production');
    const key = keyOf();
    const { winner } = await seedOpenWinner(org, key, 'governed');
    const trig = probeTriggeredPool(stack.db.appUrl, async () => {
      await winner.query('ROLLBACK');
    });
    try {
      await expect(
        executeGovernedRun(
          { pool: trig.pool, kms: new DevKms(stack.seed), env: stack.env, policyCommitSha: 'p03c-w2' },
          org.api_key,
          {
            workspace_id: org.workspace_id,
            capability: 'anthropic.messages.create',
            model: 'claude-fixture-1',
            input: WINDOW_INPUT,
          },
          undefined,
          { keyHash: createHash('sha256').update(key, 'utf8').digest() },
        ),
      ).rejects.toThrow(MissingProviderKeyError);
      expect(trig.didFire()).toBe(true);
    } finally {
      winner.release();
      await trig.end();
    }
    // Nothing committed, key not burned, no provider call.
    expect(await countRuns(org)).toBe(0);
    expect(await countBindings(org)).toBe(0);
    expect(providerCalls(org.workspace_id)).toBe(0);
  });

  it('passthrough: credential failure inside the window → replay of the committed winner', async () => {
    const org = await seedOrg(stack);
    await setOrgOperationalMode(stack, org.org_id, 'production');
    const key = keyOf();
    const { winner, runW } = await seedOpenWinner(org, key, 'passthrough');
    const trig = probeTriggeredPool(stack.db.appUrl, async () => {
      await winner.query('COMMIT');
    });
    try {
      const result = await executePassthroughRun(
        { pool: trig.pool, kms: new DevKms(stack.seed), env: stack.env, policyCommitSha: 'p03c-w3' },
        org.api_key,
        {
          workspace_id: org.workspace_id,
          capability: 'anthropic.messages.create',
          model: 'claude-fixture-1',
          input: WINDOW_INPUT,
          mode: 'passthrough',
        },
        undefined,
        undefined,
        { keyHash: createHash('sha256').update(key, 'utf8').digest() },
      );
      expect(trig.didFire()).toBe(true);
      expect(isRunIdempotentReplay(result)).toBe(true);
      const replay = result as RunIdempotentReplay;
      expect(replay.run_id).toBe(runW);
      expect(replay.mode).toBe('passthrough');
    } finally {
      winner.release();
      await trig.end();
    }
    expect(providerCalls(org.workspace_id)).toBe(0);
    expect(await countRuns(org)).toBe(1);
  });
});

// =============================================================================
// T33 — native_request_hash insufficiency (§8.3): DLP-redaction convergence
// =============================================================================

describe('T33 — provider-native equivalence is NOT intent equivalence', () => {
  it('two DIFFERENT original inputs that redact to the SAME provider body still conflict', async () => {
    const org = await seedOrg(stack);
    await setBaselineDlpAction(stack, org.org_id, 'cpf', 'redact');
    const key = keyOf();
    const input1 = 'cliente cpf 111.444.777-35 fim';
    const input2 = 'cliente cpf 529.982.247-25 fim';

    // Prove the provider-effective (post-redaction) representation is EQUAL:
    // the native request body derives from the redacted input only.
    const red1 = redactFindings(input1, detectAllBaseline(input1));
    const red2 = redactFindings(input2, detectAllBaseline(input2));
    expect(red1).toContain('[REDACTED:cpf]');
    expect(red1).toBe(red2);

    const first = await post('/v1/runs', org.api_key, governedBody(org, { input: input1 }), {
      [H]: key,
    });
    expect(first.statusCode).toBe(200);

    // Same key, semantically DIFFERENT original intent, identical provider
    // body: native_request_hash could never distinguish these — the canonical
    // intent hash must.
    const conflict = await post('/v1/runs', org.api_key, governedBody(org, { input: input2 }), {
      [H]: key,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.body).toEqual({ error: 'idempotency_key_conflict' });
    expect(await countRuns(org)).toBe(1);
    expect(providerCalls(org.workspace_id)).toBe(1);
  });
});
