// EP-AI-CONVERSATION-CONTINUITY-V1 — THE P0-D2 / P0-E / P0-F NEGATIVE BOUNDARY.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS FILE CHANGED AGAIN, AND WHY IT WAS NOT DELETED
//
// At P0-B this suite proved "no execution was implemented"; P0-C implemented execution and the
// suite was retargeted to the P0-D wall. P0-D1 now IMPLEMENTS the first slice of provider
// continuation — server-assembled durable context, Anthropic stateless replay and OpenAI
// `previous_response_id` chaining with the encrypted continuation-anchor write — so THOSE bans
// are no longer the wall. The wall moves one stage further along, and the discipline stays:
//
//   L1 ROUTE SURFACE   — retry / stop / delete / stream re-attach still do not exist
//   L2 PROVIDER        — the request plane still performs ZERO provider work
//   L3 DURABLE STATE   — the REQUEST plane writes no continuation state and no evidence link
//   L4 SOURCE          — no P0-D2/P0-E/P0-F construct entered the tree: no OpenAI conversation
//                        OBJECT, no Codex thread, no Claude Code session, no provider_state
//                        writer, no taint/rotation, no compaction, no retry mint, no delete,
//                        no shred, no disposal ledger, no evidence-link materialization
//   L5 API PROCESS     — the request-serving API is STILL not the execution authority
//
// L4 scans CODE, not prose: comments are stripped first, so a file that DISCUSSES the boundary
// (as these files do, at length) cannot accidentally satisfy — or violate — the scan. The scan
// now covers the P0-D1 adapters directory too — new worker-plane code does not get a quieter
// wall than old worker-plane code.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startStack,
  stopStack,
  seedOrg,
  seedProviderCredential,
  inject,
  type SeededOrg,
  type Stack,
} from './helpers/server-fixture.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const AI_DIR = join(ROOT, 'apps', 'api', 'src', 'ai-conversations');
const EXEC_DIR = join(AI_DIR, 'execution');
const ADAPTERS_DIR = join(EXEC_DIR, 'adapters');
const ROUTE_FILE = join(ROOT, 'apps', 'api', 'src', 'routes', 'ai-conversations.ts');
const MIGRATION_0034 = join(
  ROOT,
  'apps',
  'api',
  'src',
  'db',
  'migrations',
  '0034_ai_conversation_durable_execution.sql',
);

let stack: Stack;
let org: SeededOrg;

beforeAll(async () => {
  stack = await startStack();
  org = await seedOrg(stack);
  await seedProviderCredential(stack, {
    orgId: org.org_id,
    provider: 'anthropic',
    plaintextKey: 'sk-ant-boundary',
    setByUserId: org.user_id,
  });
}, 300_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

/** Remove `//` line comments and block comments so the scan sees CODE only. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function shippedConversationSources(): Promise<Array<{ path: string; code: string }>> {
  const files: string[] = [];
  for (const dir of [AI_DIR, EXEC_DIR, ADAPTERS_DIR]) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
        files.push(join(dir, e.name));
      }
    }
  }
  files.push(ROUTE_FILE);
  return Promise.all(
    files.map(async (path) => ({ path, code: stripComments(await readFile(path, 'utf8')) })),
  );
}

async function createConversation(): Promise<{ id: string; branchId: string }> {
  const res = await inject(stack, 'POST', '/v1/ai/conversations', org.api_key, {
    mode: 'governed',
    provider: 'anthropic',
    surface: 'anthropic_messages',
    model: 'claude-test',
  });
  const body = res.body as { id: string; root_branch: { id: string } };
  return { id: body.id, branchId: body.root_branch.id };
}

describe('P0-D1 L1 — the P0-D/P0-E/P0-F route surface does not exist', () => {
  it('no retry, stop, stream re-attach, delete or events endpoint is registered', async () => {
    const conv = await createConversation();
    const forbidden: Array<['GET' | 'POST' | 'PATCH' | 'DELETE', string]> = [
      ['POST', `/v1/ai/conversations/${conv.id}/turns/${randomUUID()}/retry`],
      ['POST', `/v1/ai/conversations/${conv.id}/turns/${randomUUID()}/attempts/${randomUUID()}/stop`],
      ['GET', `/v1/ai/conversations/${conv.id}/turns/${randomUUID()}/stream`],
      ['GET', `/v1/ai/conversations/${conv.id}/events`],
      ['DELETE', `/v1/ai/conversations/${conv.id}`],
      ['GET', `/v1/ai/conversations/${conv.id}/branches`],
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

  it('the registered conversation surface is EXACTLY the eight P0-B + P0-C endpoints', async () => {
    const hasRoute = (method: string, url: string): boolean =>
      stack.app.hasRoute({ method: method as 'GET', url });
    // P0-B's five...
    expect(hasRoute('POST', '/v1/ai/conversations')).toBe(true);
    expect(hasRoute('GET', '/v1/ai/conversations')).toBe(true);
    expect(hasRoute('GET', '/v1/ai/conversations/:id')).toBe(true);
    expect(hasRoute('PATCH', '/v1/ai/conversations/:id')).toBe(true);
    expect(hasRoute('POST', '/v1/ai/conversations/:id/branches')).toBe(true);
    // ...plus P0-C's three, and NOTHING else.
    expect(hasRoute('POST', '/v1/ai/conversations/:id/turns')).toBe(true);
    expect(hasRoute('GET', '/v1/ai/conversations/:id/turns')).toBe(true);
    expect(hasRoute('GET', '/v1/ai/conversations/:id/turns/:turnId')).toBe(true);
    expect(hasRoute('DELETE', '/v1/ai/conversations/:id')).toBe(false);

    const printed = stack.app.printRoutes({ commonPrefix: false });
    const lines = printed.split('\n').filter((l) => l.includes('/v1/ai/')).map((l) => l.trim());
    for (const banned of ['attempts', 'stream', 'stop', 'retry', 'events']) {
      expect({ banned, lines: lines.filter((l) => l.includes(banned)) }).toEqual({ banned, lines: [] });
    }
  });

  it('the AUTH-READ-CACHE-01 hook is STILL encapsulated: no other route’s behaviour changed', async () => {
    const me = await stack.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { 'x-govai-api-key': org.api_key },
    });
    expect(me.statusCode).toBe(200);
    expect(me.headers['cache-control']).toBe('no-store'); // me.ts:48-62, its own precedent
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
});

describe('P0-D1 L2 — the REQUEST plane still performs zero provider work', () => {
  it('a full control-plane + durable-send exercise produces no upstream request at all', async () => {
    stack.provider.clearRecordedRequests();
    stack.provider.clearRecordedRequestHeaders();

    const conv = await createConversation();
    await inject(stack, 'PATCH', `/v1/ai/conversations/${conv.id}`, org.api_key, { title: 'probe' });
    await inject(stack, 'PATCH', `/v1/ai/conversations/${conv.id}`, org.api_key, { archived: true });
    await inject(stack, 'PATCH', `/v1/ai/conversations/${conv.id}`, org.api_key, { archived: false });
    await inject(stack, 'GET', '/v1/ai/conversations', org.api_key);
    await inject(stack, 'GET', `/v1/ai/conversations/${conv.id}`, org.api_key);

    // ★ THE P0-C STATEMENT: a SEND is a durable RESERVATION, not a provider call. Reserve
    // several turns, hydrate them, replay a duplicate — the provider stays silent throughout,
    // because execution belongs to the detached worker, which this suite never starts.
    const clientTurnId = randomUUID();
    const body = {
      client_turn_id: clientTurnId,
      branch_id: conv.branchId,
      native_request: { model: 'claude-test', max_tokens: 8, messages: [{ role: 'user', content: 'silence' }] },
    };
    const first = await inject(stack, 'POST', `/v1/ai/conversations/${conv.id}/turns`, org.api_key, body);
    expect(first.statusCode).toBe(201);
    const replay = await inject(stack, 'POST', `/v1/ai/conversations/${conv.id}/turns`, org.api_key, body);
    expect(replay.statusCode).toBe(200);
    await inject(stack, 'POST', `/v1/ai/conversations/${conv.id}/turns`, org.api_key, {
      ...body,
      client_turn_id: randomUUID(),
    });
    await inject(stack, 'GET', `/v1/ai/conversations/${conv.id}/turns`, org.api_key);
    await inject(
      stack,
      'GET',
      `/v1/ai/conversations/${conv.id}/turns/${(first.body as { id: string }).id}`,
      org.api_key,
    );

    expect(stack.provider.recordedRequests).toEqual([]);
    expect(stack.provider.recordedRequestHeaders).toEqual([]);
  });
});

describe('P0-D1 L3 — the REQUEST plane writes no continuation state and no evidence link', () => {
  it('after a full request-plane exercise: zero provider-state rows, zero links, zero anchors', async () => {
    // This suite exercises the REQUEST plane only (no worker ever runs here). The reservation
    // path stores durable INPUT and lifecycle — it writes NO provider-state row (P0-D1 creates
    // none anywhere, by adjudication — the durable-context suite proves that for the WORKER
    // path too), NO continuation anchor (that is the boundary commit's write, worker-plane
    // only), and no §14 evidence link (P0-F's closeout).
    for (const table of ['ai_conversation_provider_state', 'ai_conversation_evidence_links'] as const) {
      const n = await stack.db.adminPool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM govai.${table}`,
      );
      expect({ table, n: n.rows[0]!.n }).toEqual({ table, n: '0' });
    }
    const anchored = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversation_attempts
        WHERE continuation_parent_ciphertext IS NOT NULL`,
    );
    expect(anchored.rows[0]!.n).toBe('0');
    // And no turn has more than ONE attempt: the public retry endpoint does not exist, so the
    // request plane can never mint attempt 2.
    const multi = await stack.db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT turn_id FROM govai.ai_conversation_attempts GROUP BY turn_id HAVING count(*) > 1
       ) t`,
    );
    expect(multi.rows[0]!.n).toBe('0');
  });

  it('every turn the REQUEST plane reserves is unclaimed and pre-boundary', async () => {
    const conv = await createConversation();
    const sent = await inject(stack, 'POST', `/v1/ai/conversations/${conv.id}/turns`, org.api_key, {
      client_turn_id: randomUUID(),
      branch_id: conv.branchId,
      native_request: { model: 'claude-test', max_tokens: 8, messages: [{ role: 'user', content: 'x' }] },
    });
    const attemptId = (sent.body as { current_attempt_id: string }).current_attempt_id;
    const row = await stack.db.adminPool.query<Record<string, unknown>>(
      `SELECT state, claim_token, claim_deadline_at, heartbeat_at, dispatch_boundary_committed_at,
              provider_credential_id, govai_request_id, capture_id, causal_version_at_build,
              stop_requested
         FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
      [attemptId],
    );
    expect(row.rows[0]).toEqual({
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
  });
});

describe('P0-D1 L4 — the shipped source contains no P0-D2/P0-E/P0-F construct', () => {
  it('no provider conversation OBJECT, thread or session continuation, provider-state writer or lifecycle op', async () => {
    const sources = await shippedConversationSources();
    expect(sources.length).toBeGreaterThan(8);
    const banned: Array<[string, RegExp]> = [
      // §11 strategies BEYOND P0-D1's two. (P0-D1 lawfully implements Anthropic stateless
      // replay and OpenAI `previous_response_id` chaining with the encrypted anchor write —
      // those bans were retired WITH the movement that implemented them, adapter tests and the
      // durable-context suite now own their correctness.)
      ['openai conversation object', /conversations?\.create|\/v1\/conversations/i],
      ['codex thread', /codex[_-]?thread|threadId|thread_id/i],
      ['claude code session', /claude[_-]?code[_-]?session|sessionId|session_id/i],
      ['provider state table', /ai_conversation_provider_state/],
      ['state taint / rotation', /\btainted\b|seeded_at_causal_version/],
      ['compaction', /compact(ion|Provider)/i],
      // P0-D2/P0-E/P0-F operations.
      ['retry / regenerate', /\bregenerate\b|attempt_seq\s*\+\s*1|retryAttempt/i],
      // ★ THESE BAN ACTIONS, NOT RECOGNITION. P0-C must be UNABLE to delete or shred — but it
      // MUST recognise those states: `service.ts` refuses to create a descendant of a
      // `deleted_pending` root (LAW 10), and `crypto.ts` reports a `crypto_shredded` content row
      // honestly instead of as a decrypt fault. An earlier revision of this scan banned the bare
      // status literals and flagged both of those correct behaviours.
      ['deletion write', /SET\s+status\s*=\s*'deleted/i],
      ['crypto-shred write', /SET\s+dek_wrapped\s*=\s*NULL|crypto_shred\s*\(/i],
      ['disposal ledger', /disposal_ledger/i],
      ['cleanup worker', /ai_cleanup_candidates|cleanupWorker/i],
      ['evidence link materialization', /ai_conversation_evidence_links/],
      ['attachments / projects', /attachment|\bprojects\b/i],
      // The workroom boundary (§4) is unchanged: a conversation is not a workroom.
      ['workroom', /workroom/i],
    ];
    for (const { path, code } of sources) {
      for (const [label, re] of banned) {
        expect({ path, label, hit: re.test(code) }).toEqual({ path, label, hit: false });
      }
    }
  });

  it('migration 0034 grants to exactly one role and no forbidden verb', async () => {
    const sql = stripComments(await readFile(MIGRATION_0034, 'utf8')).replace(/^\s*--.*$/gm, ' ');
    expect(/GRANT[\s\S]{0,200}?\bDELETE\b/i.test(sql)).toBe(false);
    expect(/GRANT[\s\S]{0,200}?\bTRUNCATE\b/i.test(sql)).toBe(false);
    const grantees = [...sql.matchAll(/\bTO\s+(govai_[a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());
    expect([...new Set(grantees)]).toEqual(['govai_conversation_worker']);
    // It touches NEITHER of the two tables P0-D/P0-F own.
    expect(/ai_conversation_provider_state|ai_conversation_evidence_links/.test(sql)).toBe(false);
  });
});

describe('P0-D1 L5 — the request-serving API is STILL not the execution authority', () => {
  it('server.ts constructs no worker capability and starts no conversation loop', async () => {
    const server = stripComments(
      await readFile(join(ROOT, 'apps', 'api', 'src', 'server.ts'), 'utf8'),
    );
    expect(server).toContain('aiConversationsRoute');
    // ★ THE LOAD-BEARING ASSERTION OF THIS WHOLE FILE. §9 requires the detached worker to be a
    // SEPARATE process: if the API built the worker capability or started the sweep loop,
    // execution would again live and die with whichever process happens to be serving HTTP, and
    // a browser-facing deploy unit would own provider calls for every tenant.
    expect(/createConversationWorkerDb|createConversationWorkerPool/.test(server)).toBe(false);
    expect(/startConversationWorker|runConversationSweepOnce/.test(server)).toBe(false);
    expect(/conversation-worker|conversationWorker/i.test(server)).toBe(false);
    // Still exactly ONE pre-existing setTimeout: the bounded owned-pool close in onClose.
    const timers = [...server.matchAll(/set(Interval|Timeout|Immediate)/g)].map((m) => m[0]);
    expect(timers).toEqual(['setTimeout']);
  });

  it('the REQUEST-plane conversation modules import no worker or provider machinery', async () => {
    // The request plane reserves and hydrates; it must not be able to dispatch. Scoped to the
    // request-plane files — `execution/` is the worker's, and legitimately imports both.
    const requestPlane = (await shippedConversationSources()).filter(
      (f) => !f.path.includes(`${join('ai-conversations', 'execution')}`),
    );
    expect(requestPlane.length).toBeGreaterThan(8);
    const banned: Array<[string, RegExp]> = [
      ['fetch call', /\bfetch\s*\(/],
      ['provider package', /@govai\/provider-(anthropic|openai|stream-http)/],
      // ★ NAMED PRECISELY. `withOwnerContext` alone would also match `@govai/core-tenant`'s
      // REQUEST-plane primitive, which the reservation legitimately uses; what must not appear
      // here is the WORKER capability.
      ['worker capability', /ConversationWorkerDb|createConversationWorkerDb|ai-conversation-worker/],
      ['recovery discovery', /ai_turn_recovery_candidates|discoverRecoveryCandidates/],
      ['claim mutation', /claim_token|claimToken|claimQueuedHead/],
      ['dispatch boundary', /dispatch_boundary_committed_at|commitDispatchBoundary/],
      ['heartbeat', /heartbeat/i],
      ['provider credential resolution', /provider_credentials|resolveProviderKey/],
      ['audit bridge', /auditBridge|captureAuditEvent/],
      ['timer', /setInterval|setTimeout|setImmediate/],
      ['listen/notify', /\bLISTEN\b|\bNOTIFY\b|pg_notify/],
    ];
    for (const { path, code } of requestPlane) {
      for (const [label, re] of banned) {
        expect({ path, label, hit: re.test(code) }).toEqual({ path, label, hit: false });
      }
    }
  });

  it('the worker entrypoint is NOT reachable from the API’s import graph', async () => {
    // A dedicated executable, started and stopped independently — never a side effect of
    // building the HTTP server.
    const main = stripComments(
      await readFile(join(ROOT, 'apps', 'api', 'src', 'conversation-worker', 'main.ts'), 'utf8'),
    );
    expect(main).toContain('startConversationWorker');
    expect(main).toContain('isMainModule');
    // It never imports the Fastify server, so requiring one can never start the other.
    expect(/from '\.\.\/server\.js'|buildServer/.test(main)).toBe(false);
    // And it fails CLOSED without its own credential (no fallback to DATABASE_URL).
    expect(main).toContain('loadConversationWorkerDbConfig');
  });
});
