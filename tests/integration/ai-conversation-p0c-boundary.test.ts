// EP-AI-CONVERSATION-CONTINUITY-V1 P0-B — the P0-C NEGATIVE BOUNDARY.
//
// A movement that says "no execution was implemented" has to prove it, not assert it. This
// suite is that proof, from four independent directions:
//
//   L1 ROUTE SURFACE   — the forbidden endpoints do not exist (not even as a stub)
//   L2 PROVIDER        — a full control-plane exercise produces ZERO upstream requests
//   L3 DURABLE STATE   — every row the control plane writes is unclaimed and pre-boundary
//   L4 SOURCE          — the shipped P0-B code contains no dispatch, worker, claim, queue,
//                        timer or notification construct at all
//
// L4 scans CODE, not prose: comments are stripped first, so a file that DISCUSSES the boundary
// (as these files do, at length) cannot accidentally satisfy — or violate — the scan.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startStack,
  stopStack,
  seedOrg,
  inject,
  type SeededOrg,
  type Stack,
} from './helpers/server-fixture.js';
import {
  seedAttempt,
  seedConversation,
  seedTurn,
  type OwnerIds,
} from './helpers/ai-conversation-seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const AI_DIR = join(ROOT, 'apps', 'api', 'src', 'ai-conversations');
const ROUTE_FILE = join(ROOT, 'apps', 'api', 'src', 'routes', 'ai-conversations.ts');
const MIGRATION_0033 = join(
  ROOT,
  'apps',
  'api',
  'src',
  'db',
  'migrations',
  '0033_ai_conversation_control_plane.sql',
);

let stack: Stack;
let org: SeededOrg;
let owner: OwnerIds;

beforeAll(async () => {
  stack = await startStack();
  org = await seedOrg(stack);
  owner = { orgId: org.org_id, ownerUserId: org.user_id };
}, 300_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

/** Remove `//` line comments and `/* *\/` block comments so the scan sees CODE only. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function shippedTypeScriptSources(): Promise<Array<{ path: string; code: string }>> {
  const files = (await readdir(AI_DIR))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(AI_DIR, f));
  files.push(ROUTE_FILE);
  return Promise.all(
    files.map(async (path) => ({ path, code: stripComments(await readFile(path, 'utf8')) })),
  );
}

describe('P0-B L1 — the forbidden route surface does not exist', () => {
  it('no turn, retry, stop, re-attach or delete endpoint is registered', async () => {
    const created = await inject(stack, 'POST', '/v1/ai/conversations', org.api_key, {
      mode: 'governed',
      provider: 'anthropic',
      surface: 'anthropic_api',
      model: 'm',
    });
    const id = (created.body as { id: string }).id;

    const forbidden: Array<['GET' | 'POST' | 'PATCH' | 'DELETE', string]> = [
      ['POST', `/v1/ai/conversations/${id}/turns`],
      ['GET', `/v1/ai/conversations/${id}/turns`],
      ['GET', `/v1/ai/conversations/${id}/turns/${randomUUID()}`],
      ['POST', `/v1/ai/conversations/${id}/turns/${randomUUID()}/retry`],
      [
        'POST',
        `/v1/ai/conversations/${id}/turns/${randomUUID()}/attempts/${randomUUID()}/stop`,
      ],
      ['GET', `/v1/ai/conversations/${id}/turns/${randomUUID()}/stream`],
      ['GET', `/v1/ai/conversations/${id}/events`],
      ['DELETE', `/v1/ai/conversations/${id}`],
      ['GET', `/v1/ai/conversations/${id}/branches`],
    ];
    for (const [method, url] of forbidden) {
      const res = await inject(stack, method, url, org.api_key, method === 'POST' ? {} : undefined);
      // Fastify's OWN not-found — `error: 'Not Found'` — is the discriminator: a route-level
      // handler would answer with this API's `{ error: '...' }` shape instead. An unimplemented
      // future endpoint stays NONEXISTENT rather than returning a misleading placeholder.
      expect({ method, url, code: res.statusCode }).toEqual({ method, url, code: 404 });
      expect({ method, url, err: (res.body as { error?: string })?.error }).toEqual({
        method,
        url,
        err: 'Not Found',
      });
    }
  });

  it('the AUTH-READ-CACHE-01 hook is ENCAPSULATED: it changes no other route’s behaviour', async () => {
    // The `no-store` hook is registered INSIDE this plugin's context. If it had leaked to the
    // root, it would silently change four pre-existing authenticated read surfaces — a
    // behaviour change to routes this movement is not scoped to touch. `/v1/me` sets the header
    // itself (its own precedent) and must keep doing so; the other three must be UNCHANGED,
    // which is precisely why AUTH-READ-CACHE-01 remains OPEN as a class.
    const me = await stack.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { 'x-govai-api-key': org.api_key },
    });
    expect(me.statusCode).toBe(200);
    expect(me.headers['cache-control']).toBe('no-store'); // me.ts:48-62, unchanged
    for (const url of ['/v1/capabilities', '/v1/audit-events?chain_category=run']) {
      const res = await stack.app.inject({
        method: 'GET',
        url,
        headers: { 'x-govai-api-key': org.api_key },
      });
      expect({ url, code: res.statusCode }).toEqual({ url, code: 200 });
      expect({ url, cache: res.headers['cache-control'] }).toEqual({ url, cache: undefined });
    }
  });

  it('the registered conversation surface is EXACTLY the five §13 P0-B endpoints', async () => {
    const printed = stack.app.printRoutes({ commonPrefix: false });
    const lines = printed
      .split('\n')
      .filter((l) => l.includes('/v1/ai/'))
      .map((l) => l.trim());
    // The printed tree lists paths with their method sets; assert the method sets directly.
    const hasRoute = (method: string, url: string): boolean =>
      stack.app.hasRoute({ method: method as 'GET', url });
    expect(hasRoute('POST', '/v1/ai/conversations')).toBe(true);
    expect(hasRoute('GET', '/v1/ai/conversations')).toBe(true);
    expect(hasRoute('GET', '/v1/ai/conversations/:id')).toBe(true);
    expect(hasRoute('PATCH', '/v1/ai/conversations/:id')).toBe(true);
    expect(hasRoute('POST', '/v1/ai/conversations/:id/branches')).toBe(true);
    expect(hasRoute('DELETE', '/v1/ai/conversations/:id')).toBe(false);
    expect(hasRoute('POST', '/v1/ai/conversations/:id/turns')).toBe(false);
    // Nothing under /v1/ai/ mentions a turn, an attempt, a stream or a stop.
    for (const banned of ['turns', 'attempts', 'stream', 'stop', 'retry', 'events']) {
      expect({ banned, lines: lines.filter((l) => l.includes(banned)) }).toEqual({
        banned,
        lines: [],
      });
    }
  });
});

describe('P0-B L2 — zero provider requests', () => {
  it('a full control-plane exercise produces no upstream request at all', async () => {
    stack.provider.clearRecordedRequests();
    stack.provider.clearRecordedRequestHeaders();

    // Create, rename, archive, restore, list, get — and fork in BOTH boundary modes, including
    // the mode that mints a child turn and a fresh attempt.
    const created = await inject(stack, 'POST', '/v1/ai/conversations', org.api_key, {
      mode: 'governed',
      provider: 'anthropic',
      surface: 'anthropic_api',
      model: 'm',
    });
    const conversationId = (created.body as { id: string }).id;
    await inject(stack, 'PATCH', `/v1/ai/conversations/${conversationId}`, org.api_key, {
      title: 'provider silence probe',
    });
    await inject(stack, 'PATCH', `/v1/ai/conversations/${conversationId}`, org.api_key, {
      archived: true,
    });
    await inject(stack, 'PATCH', `/v1/ai/conversations/${conversationId}`, org.api_key, {
      archived: false,
    });
    await inject(stack, 'GET', '/v1/ai/conversations', org.api_key);
    await inject(stack, 'GET', `/v1/ai/conversations/${conversationId}`, org.api_key);

    const { conversationId: forkConv, branchId } = await seedConversation(
      stack.db.adminPool,
      owner,
    );
    const { turnId } = await seedTurn(stack.db.adminPool, owner, forkConv, branchId, 1);
    const attemptId = await seedAttempt(stack.db.adminPool, owner, forkConv, branchId, turnId, {
      state: 'completed',
    });
    await stack.db.adminPool.query(
      `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
      [attemptId, turnId],
    );
    for (const boundary_mode of ['after_attempt', 'before_attempt_output']) {
      const res = await inject(
        stack,
        'POST',
        `/v1/ai/conversations/${forkConv}/branches`,
        org.api_key,
        {
          client_fork_id: randomUUID(),
          parent_branch_id: branchId,
          forked_from_turn_id: turnId,
          forked_from_attempt_id: attemptId,
          boundary_mode,
        },
      );
      expect({ boundary_mode, code: res.statusCode }).toEqual({ boundary_mode, code: 201 });
    }

    expect(stack.provider.recordedRequests).toEqual([]);
    expect(stack.provider.recordedRequestHeaders).toEqual([]);
  });
});

describe('P0-B L3 — the durable state the control plane writes carries no execution authority', () => {
  it('every attempt it mints is unclaimed, pre-boundary and provenance-free', async () => {
    // Across the WHOLE database at this point: every attempt written by any P0-B code path is
    // in the §7.1b birth shape. (The suite's own seeds advance some attempts through the lawful
    // transitions, so this asserts over the branches the CONTROL PLANE created.)
    const rows = await stack.db.adminPool.query<{
      state: string;
      claim_token: string | null;
      claim_deadline_at: Date | null;
      heartbeat_at: Date | null;
      dispatch_boundary_committed_at: Date | null;
      provider_credential_id: string | null;
      govai_request_id: string | null;
      capture_id: string | null;
      causal_version_at_build: string | null;
      stop_requested: boolean;
    }>(
      `SELECT a.state, a.claim_token, a.claim_deadline_at, a.heartbeat_at,
              a.dispatch_boundary_committed_at, a.provider_credential_id,
              a.govai_request_id, a.capture_id, a.causal_version_at_build, a.stop_requested
         FROM govai.ai_conversation_attempts a
         JOIN govai.ai_conversation_branches b ON b.id = a.branch_id
        WHERE b.parent_branch_id IS NOT NULL`,
    );
    expect(rows.rowCount).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row).toEqual({
        state: 'accepted',
        claim_token: null,
        claim_deadline_at: null,
        heartbeat_at: null,
        dispatch_boundary_committed_at: null,
        provider_credential_id: null,
        govai_request_id: null,
        capture_id: null,
        causal_version_at_build: null,
        stop_requested: false,
      });
    }
    // No branch causal_version was bumped: eligibility is a P0-C/§7.8 concern and the control
    // plane changes none of it.
    const bumped = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_branches WHERE causal_version <> 0`,
    );
    expect(bumped.rows[0]!.n).toBe('0');
    // No provider state, no evidence link, no continuation anchor exists anywhere.
    for (const table of [
      'ai_conversation_provider_state',
      'ai_conversation_evidence_links',
    ] as const) {
      const n = await stack.db.adminPool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM govai.${table}`,
      );
      expect({ table, n: n.rows[0]!.n }).toEqual({ table, n: '0' });
    }
  });
});

describe('P0-B L4 — the shipped source contains no P0-C construct', () => {
  it('no provider call, worker activation, claim mutation, queue wake, timer or notification', async () => {
    const sources = await shippedTypeScriptSources();
    expect(sources.length).toBeGreaterThan(5);
    const banned: Array<[string, RegExp]> = [
      // Provider I/O of any kind.
      ['fetch call', /\bfetch\s*\(/],
      ['undici', /\bundici\b/],
      ['node:http client', /require\(['"]node:https?['"]\)|from\s+['"]node:https?['"]/],
      // ★ `passthrough` alone is NOT banned: it is one of 0031's two durable execution-lane
      // values (`mode`), so the conversation contract must name it. What is banned is a
      // reference to the passthrough/governed PIPELINE — a module, route or executor.
      [
        'provider pipeline',
        /invokeProvider|providerInvoke|executePassthrough|executeGoverned|passthrough[-/]|governed-(anthropic|openai)|routes\/(passthrough|governed)/i,
      ],
      ['provider credential resolution', /resolveProviderCredential|provider_credentials/],
      // Worker runtime activation.
      ['worker pool construction', /createConversationWorkerPool/],
      ['worker owner context', /withConversationWorkerOwnerContext/],
      ['recovery discovery', /ai_turn_recovery_candidates|recoveryCandidates/],
      // Claim / lease / dispatch mutation.
      ['claim token', /claim_token|claimToken/],
      ['claim deadline', /claim_deadline_at|claimDeadline/],
      ['heartbeat', /heartbeat/i],
      ['dispatch boundary', /dispatch_boundary_committed_at|dispatchBoundary/],
      ['stop request flag', /stop_requested|stopRequested/],
      ['request identity ALS', /requestIdentityAls|AuditBridgeRequestIdentity/],
      // Queue / scheduling / notification.
      ['timer', /setInterval|setTimeout|setImmediate/],
      ['listen/notify', /\bLISTEN\b|\bNOTIFY\b|pg_notify/],
      // Evidence and workroom coupling.
      ['audit bridge', /auditBridge|auditAppend|audit_events|capture_outbox/],
      ['workroom', /workroom/i],
    ];
    for (const { path, code } of sources) {
      for (const [label, re] of banned) {
        expect({ path, label, hit: re.test(code) }).toEqual({ path, label, hit: false });
      }
    }
  });

  it('the migration grants no DELETE, no TRUNCATE and no worker authority', async () => {
    const sql = stripComments(await readFile(MIGRATION_0033, 'utf8'))
      // SQL comments are `--`, which the TS stripper does not handle.
      .replace(/^\s*--.*$/gm, ' ');
    expect(/GRANT[\s\S]{0,200}?\bDELETE\b/i.test(sql)).toBe(false);
    expect(/GRANT[\s\S]{0,200}?\bTRUNCATE\b/i.test(sql)).toBe(false);
    expect(/govai_conversation_worker/.test(sql)).toBe(false);
    expect(/govai_evidence_enumerator|govai_audit_sealer/.test(sql)).toBe(false);
    // It grants to exactly one role.
    const grantees = [...sql.matchAll(/\bTO\s+(govai_[a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());
    expect([...new Set(grantees)]).toEqual(['govai_app']);
  });

  it('the API still constructs no conversation worker and starts no new background loop', async () => {
    const server = stripComments(
      await readFile(join(ROOT, 'apps', 'api', 'src', 'server.ts'), 'utf8'),
    );
    expect(server).toContain('aiConversationsRoute');
    // The conversation worker pool is still unreferenced at boot, and the only background
    // handle the server owns is the pre-existing P0.3-A run-dispatch recovery worker.
    expect(/createConversationWorkerPool/.test(server)).toBe(false);
    expect(/startConversation|conversationWorkerPool|conversationRecovery/i.test(server)).toBe(false);
    const timers = [...server.matchAll(/set(Interval|Timeout|Immediate)/g)].map((m) => m[0]);
    // One pre-existing setTimeout: the bounded owned-pool close in the onClose hook.
    expect(timers).toEqual(['setTimeout']);
  });
});
