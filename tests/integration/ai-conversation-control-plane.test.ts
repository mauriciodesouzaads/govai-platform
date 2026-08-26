// EP-AI-CONVERSATION-CONTINUITY-V1 P0-B — the conversation control plane over HTTP.
//
// Create / list / get / patch, proven end to end against a real Postgres under the real
// dual-predicate FORCE RLS and the real KMS envelope. Nothing here is mocked: RLS, grants,
// guard triggers, envelope encryption and keyed digests are all the shipped ones.
//
// Coverage map (movement dispatch §27):
//   B  create — atomicity, durable creation intent, rollback, immutability, isolation
//   C  list / get / cache — owner scoping, keyset pagination, tie-breaker, page cap, no-store
//   D  title — encryption at rest, keyed digest, round trip, cross-purpose fail-closed
//   E  patch — the two guarded fields, and everything §13 does NOT make mutable

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { DevKms } from '@govai/core-identity';
import { withOwnerContext } from '@govai/core-tenant';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  inject,
  type SeededOrg,
  type Stack,
} from './helpers/server-fixture.js';
import { installPostgresPoolShutdownGuard } from './setup.js';
import { buildServer } from '../../apps/api/src/server.js';
import { createConversation } from '../../apps/api/src/ai-conversations/service.js';
import {
  decodeConversationCursor,
  encodeConversationCursor,
} from '../../apps/api/src/ai-conversations/cursor.js';
import * as conversationStore from '../../apps/api/src/ai-conversations/store.js';

let stack: Stack;
/** Owner A — the principal under test. */
let orgA: SeededOrg;
/** Owner B — a DIFFERENT user inside the SAME org as A (the §21 same-org cross-user threat). */
let ownerBKey: string;
let ownerBUserId: string;
/** A different org entirely. */
let orgC: SeededOrg;

beforeAll(async () => {
  stack = await startStack();
  orgA = await seedOrg(stack);
  ownerBUserId = randomUUID();
  ownerBKey = (await addApiKey(stack, orgA.org_id, ownerBUserId)).api_key;
  orgC = await seedOrg(stack);
}, 300_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

const CREATE = {
  mode: 'governed' as const,
  provider: 'anthropic' as const,
  surface: 'anthropic_api',
  model: 'claude-test-model',
};

type ConversationBody = {
  id: string;
  mode: string;
  provider: string;
  surface: string;
  model: string;
  status: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  root_branch: { id: string; provider: string; surface: string; model: string };
};

async function createVia(apiKey: string, body: Record<string, unknown> = CREATE) {
  return inject(stack, 'POST', '/v1/ai/conversations', apiKey, body);
}

async function adminQuery<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const r = await stack.db.adminPool.query<T>(sql, params);
  return r.rows;
}

/** Run SQL through the APP pool with an explicit, possibly incomplete, owner context. */
async function asAppRole<T>(
  orgId: string | null,
  userId: string | null,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    if (orgId) await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    if (userId) await c.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

/**
 * Seed `n` conversations (each with its root branch) in ONE transaction: `now()` is the
 * transaction timestamp, so every `updated_at` is IDENTICAL and a page walk over them runs
 * entirely through the `id` tie-breaker.
 */
async function seedTiedConversations(owner: SeededOrg, n: number): Promise<string[]> {
  const c = await stack.db.adminPool.connect();
  const seeded: string[] = [];
  try {
    await c.query('BEGIN');
    for (let i = 0; i < n; i += 1) {
      const conv = await c.query<{ id: string }>(
        `INSERT INTO govai.ai_conversations (org_id, owner_user_id, mode, provider, surface, model)
         VALUES ($1::uuid, $2::uuid, 'governed', 'anthropic', 'anthropic_api', 'm')
         RETURNING id`,
        [owner.org_id, owner.user_id],
      );
      await c.query(
        `INSERT INTO govai.ai_conversation_branches
           (org_id, owner_user_id, conversation_id, provider, surface, model)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_api', 'm')`,
        [owner.org_id, owner.user_id, conv.rows[0]!.id],
      );
      seeded.push(conv.rows[0]!.id);
    }
    await c.query('COMMIT');
  } finally {
    c.release();
  }
  const stamps = await adminQuery<{ n: string }>(
    `SELECT count(DISTINCT updated_at)::text AS n FROM govai.ai_conversations
      WHERE owner_user_id = $1::uuid`,
    [owner.user_id],
  );
  expect(stamps[0]!.n).toBe('1'); // the tie-breaker really is being exercised
  return seeded;
}

/**
 * Walk the whole list following ONLY the server's own `next_cursor`, recording the SHAPE of
 * every page.
 *
 * The shapes are the evidence, not merely the concatenated ids: a cursor handed back on a final
 * page is invisible in the ids — the page it leads to is empty — and shows up only as an extra
 * round-trip. The 10-request ceiling keeps a cursor that never clears from hanging the suite.
 */
async function walkConversationPages(
  apiKey: string,
  limit: number,
): Promise<{ pages: Array<{ ids: string[]; next_cursor: string | null }>; ids: string[] }> {
  const pages: Array<{ ids: string[]; next_cursor: string | null }> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const url: string = `/v1/ai/conversations?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await inject(stack, 'GET', url, apiKey);
    expect(res.statusCode).toBe(200);
    const body = res.body as { conversations: Array<{ id: string }>; next_cursor: string | null };
    pages.push({ ids: body.conversations.map((x) => x.id), next_cursor: body.next_cursor });
    cursor = body.next_cursor;
    if (!cursor) break;
  }
  return { pages, ids: pages.flatMap((p) => p.ids) };
}

describe('P0-B B — create: conversation + root branch, atomically', () => {
  it('B1/B2 — one conversation and EXACTLY one root branch carrying the durable creation intent', async () => {
    const res = await createVia(orgA.api_key);
    expect(res.statusCode).toBe(201);
    const body = res.body as ConversationBody;
    expect(body.mode).toBe('governed');
    expect(body.provider).toBe('anthropic');
    expect(body.surface).toBe(CREATE.surface);
    expect(body.model).toBe(CREATE.model);
    expect(body.status).toBe('active');
    expect(body.title).toBeNull(); // §18: a title arrives with the first rename, never at create
    expect(body.archived_at).toBeNull();

    const branches = await adminQuery<{
      id: string;
      provider: string;
      surface: string;
      model: string;
      parent_branch_id: string | null;
      boundary_mode: string | null;
    }>(
      `SELECT id, provider, surface, model, parent_branch_id, boundary_mode
         FROM govai.ai_conversation_branches WHERE conversation_id = $1::uuid`,
      [body.id],
    );
    expect(branches).toHaveLength(1);
    // §3: the BRANCH owns the executing triple, and the root receives the creation defaults —
    // adapter selection reads the branch, never the conversation root.
    expect(branches[0]).toEqual({
      id: body.root_branch.id,
      provider: 'anthropic',
      surface: CREATE.surface,
      model: CREATE.model,
      parent_branch_id: null,
      boundary_mode: null,
    });
    // The response echoes the branch identity a later fork must name.
    expect(body.root_branch).toEqual({
      id: branches[0]!.id,
      provider: 'anthropic',
      surface: CREATE.surface,
      model: CREATE.model,
    });
    expect(res.rawBody).not.toContain('owner_user_id');
    expect(res.rawBody).not.toContain('org_id');
  });

  it('B1b — every provider and mode 0031 admits is creatable, and nothing else is', async () => {
    for (const provider of ['openai', 'anthropic', 'codex', 'claude_code']) {
      for (const mode of ['governed', 'passthrough']) {
        const res = await createVia(orgA.api_key, { ...CREATE, provider, mode });
        expect({ provider, mode, code: res.statusCode }).toEqual({ provider, mode, code: 201 });
      }
    }
    const bad = await createVia(orgA.api_key, { ...CREATE, provider: 'gemini' });
    expect(bad.statusCode).toBe(400);
    expect((bad.body as { error: string }).error).toBe('invalid_request');
  });

  it('B3 — a forced second-write failure rolls BOTH writes back (no rootless conversation)', async () => {
    // The atomicity claim is only worth making if the failure path is exercised. A pool proxy
    // fails the ROOT BRANCH insert specifically, after the conversation row already exists in
    // the open transaction.
    const before = await adminQuery<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversations WHERE org_id = $1::uuid`,
      [orgC.org_id],
    );
    const failingPool = {
      connect: async (): Promise<PoolClient> => {
        const real = await stack.db.appPool.connect();
        const original = real.query.bind(real);
        const patched = ((...args: Parameters<PoolClient['query']>) => {
          const text = typeof args[0] === 'string' ? args[0] : String((args[0] as { text?: string })?.text ?? '');
          if (text.includes('INSERT INTO govai.ai_conversation_branches')) {
            return Promise.reject(new Error('injected root-branch write failure'));
          }
          return original(...args);
        }) as PoolClient['query'];
        (real as { query: PoolClient['query'] }).query = patched;
        return real;
      },
    } as unknown as Pool;

    await expect(
      createConversation(
        { pool: failingPool, kms: stack.app.govai.kms },
        { orgId: orgC.org_id, ownerUserId: orgC.user_id },
        CREATE,
      ),
    ).rejects.toThrow('injected root-branch write failure');

    const after = await adminQuery<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversations WHERE org_id = $1::uuid`,
      [orgC.org_id],
    );
    expect(after[0]!.n).toBe(before[0]!.n);
    const orphans = await adminQuery<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversations c
        WHERE NOT EXISTS (SELECT 1 FROM govai.ai_conversation_branches b
                           WHERE b.conversation_id = c.id AND b.parent_branch_id IS NULL)`,
    );
    expect(orphans[0]!.n).toBe('0');
  });

  it('B5 — a SECOND root branch is structurally impossible', async () => {
    const res = await createVia(orgA.api_key);
    const { id } = res.body as ConversationBody;
    let blocked = false;
    try {
      await adminQuery(
        `INSERT INTO govai.ai_conversation_branches
           (org_id, owner_user_id, conversation_id, provider, surface, model)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_api', 'm')`,
        [orgA.org_id, orgA.user_id, id],
      );
    } catch (err) {
      blocked = (err as { code?: string }).code === '23505';
    }
    expect(blocked).toBe(true);
  });

  it('B4 — the execution mode is IMMUTABLE: no route accepts it, and the database refuses it', async () => {
    const res = await createVia(orgA.api_key);
    const { id } = res.body as ConversationBody;
    const patch = await inject(stack, 'PATCH', `/v1/ai/conversations/${id}`, orgA.api_key, {
      mode: 'passthrough',
    });
    expect(patch.statusCode).toBe(400);
    let dbBlocked = false;
    try {
      await adminQuery(
        `UPDATE govai.ai_conversations SET mode = 'passthrough' WHERE id = $1::uuid`,
        [id],
      );
    } catch (err) {
      dbBlocked = (err as { code?: string }).code === '42501';
    }
    expect(dbBlocked).toBe(true);
  });

  it('B6/B7 — another OWNER in the same org, and another ORG, cannot read it', async () => {
    const res = await createVia(orgA.api_key);
    const { id } = res.body as ConversationBody;

    for (const [label, key] of [
      ['same org, other owner', ownerBKey],
      ['other org', orgC.api_key],
    ] as const) {
      const get = await inject(stack, 'GET', `/v1/ai/conversations/${id}`, key);
      expect({ label, code: get.statusCode }).toEqual({ label, code: 404 });
      expect({ label, body: get.body }).toEqual({
        label,
        body: { error: 'conversation_not_found' },
      });
      const list = await inject(stack, 'GET', '/v1/ai/conversations?limit=50', key);
      const ids = (list.body as { conversations: Array<{ id: string }> }).conversations.map(
        (c) => c.id,
      );
      expect({ label, leaked: ids.includes(id) }).toEqual({ label, leaked: false });
    }
  });
});

describe('P0-B C — list, get and AUTH-READ-CACHE-01', () => {
  // The ten classes below are all produced BY the route handler or by a hook inside this
  // plugin. The two classes produced EARLIER — the rate limiter's 429 and an unexpected 500 —
  // are unreachable from this stack (NODE_ENV='test' raises the limit to 1,000,000), so they
  // are proven separately by C6b/C6c at the end of this file. This title claims only what it
  // asserts.
  it('C6 — Cache-Control: no-store on every handler-produced response class', async () => {
    const created = await createVia(orgA.api_key);
    const { id } = created.body as ConversationBody;
    const raw = async (
      method: 'GET' | 'POST' | 'PATCH',
      url: string,
      key: string | undefined,
      payload?: unknown,
    ) => {
      const headers: Record<string, string> = {};
      if (payload !== undefined) headers['content-type'] = 'application/json';
      if (key) headers['x-govai-api-key'] = key;
      return stack.app.inject({ method, url, headers, payload: payload ?? undefined });
    };

    const responses = {
      'get one (200)': await raw('GET', `/v1/ai/conversations/${id}`, orgA.api_key),
      'list (200)': await raw('GET', '/v1/ai/conversations', orgA.api_key),
      'create (201)': await raw('POST', '/v1/ai/conversations', orgA.api_key, CREATE),
      'authenticated not-found (404)': await raw(
        'GET',
        `/v1/ai/conversations/${randomUUID()}`,
        orgA.api_key,
      ),
      'validation error (400)': await raw('GET', '/v1/ai/conversations?limit=999', orgA.api_key),
      'invalid path id (400)': await raw('GET', '/v1/ai/conversations/not-a-uuid', orgA.api_key),
      'missing credential (401)': await raw('GET', `/v1/ai/conversations/${id}`, undefined),
      'invalid credential (401)': await raw(
        'GET',
        `/v1/ai/conversations/${id}`,
        'govai_sk_invalid_key_value_0000',
      ),
      'patch (200)': await raw('PATCH', `/v1/ai/conversations/${id}`, orgA.api_key, {
        title: 'cache header probe',
      }),
      'fork validation error (400)': await raw(
        'POST',
        `/v1/ai/conversations/${id}/branches`,
        orgA.api_key,
        { client_fork_id: 'nope' },
      ),
    };
    for (const [label, res] of Object.entries(responses)) {
      expect({ label, cache: res.headers['cache-control'] }).toEqual({ label, cache: 'no-store' });
    }
    // The 401s really are 401s (the header is not being asserted on a route that never ran).
    expect(responses['missing credential (401)'].statusCode).toBe(401);
    expect(responses['invalid credential (401)'].statusCode).toBe(401);
    expect(responses['authenticated not-found (404)'].statusCode).toBe(404);
  });

  it('C1/C2/C3 — the list is owner-scoped: neighbours and other orgs see zero', async () => {
    const owner = await seedOrg(stack);
    const other = await addApiKey(stack, owner.org_id, randomUUID());
    const mine: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await createVia(owner.api_key);
      mine.push((r.body as ConversationBody).id);
    }
    const own = await inject(stack, 'GET', '/v1/ai/conversations?limit=50', owner.api_key);
    const ownIds = (own.body as { conversations: Array<{ id: string }> }).conversations.map(
      (c) => c.id,
    );
    expect(ownIds.sort()).toEqual([...mine].sort());

    const neighbour = await inject(stack, 'GET', '/v1/ai/conversations?limit=50', other.api_key);
    expect((neighbour.body as { conversations: unknown[] }).conversations).toEqual([]);
    const foreignOrg = await inject(stack, 'GET', '/v1/ai/conversations?limit=50', orgC.api_key);
    const foreignIds = (
      foreignOrg.body as { conversations: Array<{ id: string }> }
    ).conversations.map((c) => c.id);
    for (const id of mine) expect(foreignIds).not.toContain(id);
  });

  it('C4 — the SAME sql with the SAME parameters returns ZERO rows without the owner context', async () => {
    // The route binds org/owner explicitly for index selectivity; RLS is the AUTHORITY. This
    // proves it: drop the transaction-local context and the identical query goes blind.
    const owner = await seedOrg(stack);
    const created = await createVia(owner.api_key);
    const { id } = created.body as ConversationBody;
    const sql = `SELECT id FROM govai.ai_conversations
                  WHERE org_id = $1::uuid AND owner_user_id = $2::uuid AND status = 'active'`;
    const params = [owner.org_id, owner.user_id];

    const withBoth = await asAppRole(owner.org_id, owner.user_id, (c) => c.query(sql, params));
    expect(withBoth.rows.map((r) => (r as { id: string }).id)).toContain(id);

    for (const [label, org, user] of [
      ['org only', owner.org_id, null],
      ['user only', null, owner.user_id],
      ['neither', null, null],
      ['wrong owner', owner.org_id, randomUUID()],
    ] as const) {
      const r = await asAppRole(org, user, (c) => c.query(sql, params));
      expect({ label, rows: r.rowCount }).toEqual({ label, rows: 0 });
    }
  });

  it('C5 — a foreign or absent id is a 404, and a malformed one is a 400', async () => {
    const absent = await inject(
      stack,
      'GET',
      `/v1/ai/conversations/${randomUUID()}`,
      orgA.api_key,
    );
    expect(absent.statusCode).toBe(404);
    expect(absent.body).toEqual({ error: 'conversation_not_found' });
    const malformed = await inject(stack, 'GET', '/v1/ai/conversations/12345', orgA.api_key);
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).toEqual({ error: 'invalid_conversation_id' });
  });

  it('C7/C8 — keyset pagination is deterministic and duplicate-free, tie-breaker included', async () => {
    const owner = await seedOrg(stack);
    const seeded = await seedTiedConversations(owner, 7);

    const { pages, ids: seen } = await walkConversationPages(owner.api_key, 3);
    // A total that is NOT a multiple of the page size: the last page is SHORT, which is by
    // itself proof that nothing follows it.
    expect(pages.map((p) => p.ids.length)).toEqual([3, 3, 1]);
    expect(pages[pages.length - 1]!.next_cursor).toBeNull();
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7); // no duplicates
    expect([...seen].sort()).toEqual([...seeded].sort()); // and nothing skipped
    // The walk is strictly descending by id within the tied timestamp — a total order.
    expect(seen).toEqual([...seen].sort().reverse());
  });

  it('C7b — an EXACT-MULTIPLE walk stops on the last FULL page, emitting no phantom cursor', async () => {
    // The regression this pins. A cursor used to be emitted for any page that came back FULL,
    // and `rows.length === limit` proves nothing about what follows the page: when the total is
    // an exact multiple of the page size, the LAST page is also full, so the client was handed a
    // cursor into an always-empty page — contrary to §13's null-on-last-page contract. Only
    // looking ONE ROW PAST the page can decide this, which is why the store now fetches
    // `limit + 1` and trims. C7/C8 above cannot catch it: its 7/3 walk ends on a SHORT page.
    const owner = await seedOrg(stack);
    const seeded = await seedTiedConversations(owner, 6);

    const { pages, ids } = await walkConversationPages(owner.api_key, 3);
    expect(pages.map((p) => p.ids.length)).toEqual([3, 3]); // two requests, not three
    expect(pages[0]!.next_cursor).not.toBeNull();
    expect(pages[1]!.next_cursor).toBeNull();
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6); // no duplicates
    expect([...ids].sort()).toEqual([...seeded].sort()); // and nothing skipped
    expect(ids).toEqual([...ids].sort().reverse()); // tie-break total order still holds

    // The same defect at n === limit: a page that is both the first and the last must not
    // advertise a successor.
    const single = await seedOrg(stack);
    const singleSeeded = await seedTiedConversations(single, 3);
    const singleWalk = await walkConversationPages(single.api_key, 3);
    expect(singleWalk.pages.map((p) => p.ids.length)).toEqual([3]);
    expect(singleWalk.pages[0]!.next_cursor).toBeNull();
    expect([...singleWalk.ids].sort()).toEqual([...singleSeeded].sort());

    // ★ THE SENTINEL NEVER ESCAPES. The store looks one row past the page to decide `hasMore`
    // and trims it before returning, so no response may ever exceed the requested limit — and
    // a row that is never returned is never projected and never has its title decrypted.
    for (const p of [...pages, ...singleWalk.pages]) expect(p.ids.length).toBeLessThanOrEqual(3);
  });

  it('C9 — the §13 page cap is enforced, and a malformed cursor is a 400 (never a 500)', async () => {
    const over = await inject(stack, 'GET', '/v1/ai/conversations?limit=51', orgA.api_key);
    expect(over.statusCode).toBe(400);
    const at = await inject(stack, 'GET', '/v1/ai/conversations?limit=50', orgA.api_key);
    expect(at.statusCode).toBe(200);
    for (const cursor of ['garbage', Buffer.from('{"v":9}').toString('base64url')]) {
      const res = await inject(
        stack,
        'GET',
        `/v1/ai/conversations?cursor=${encodeURIComponent(cursor)}`,
        orgA.api_key,
      );
      expect({ cursor, code: res.statusCode, body: res.body }).toEqual({
        cursor,
        code: 400,
        body: { error: 'invalid_cursor' },
      });
    }
  });

  it('C9b — a semantically IMPOSSIBLE cursor timestamp is a 400, never a database 500', async () => {
    // P0B-GPT-P2-CURSOR-VALIDATION-01. C9 above proves the cases the cursor's textual grammar
    // already caught. These do not: every value below matches that grammar EXACTLY. The decoder
    // therefore handed each one back as a position, the store bound it as `$n::timestamptz`, and
    // PostgreSQL raised 22008/22009 — which is not an InvalidCursorError, so the list route fell
    // through to its generic 500. A client-controlled string must never be able to reach a
    // database parse error: §13's contract for a malformed cursor is 400 `invalid_cursor`.
    const owner = await seedOrg(stack);
    await createVia(owner.api_key);

    // (1) These really are values THIS PostgreSQL refuses to cast — so the regression is not
    // tautological. Each one is a live 500 on any build without the semantic bounds.
    const pgRejected = [
      '2026-13-01 00:00:00+00', // month 13
      '2025-02-29 00:00:00+00', // february 29 of a common year
      '2026-08-25 99:00:00+00', // hour 99
      '2026-08-25 19:99:00+00', // minute 99
      '2026-08-25 19:49:99+00', // second 99
      '2026-08-25 19:49:46+16', // one hour past the +15:59:59 displacement limit
    ];
    for (const u of pgRejected) {
      await expect(stack.db.adminPool.query('SELECT $1::timestamptz', [u])).rejects.toThrow();
    }

    // (2) A second class: PostgreSQL PARSES these (it rolls both forward), but `::text` can
    // never RENDER them, so no cursor this server issued can carry one. The decoder accepts the
    // subset the STORE can emit, not everything the parser tolerates — proven here by the
    // round trip landing on a different string.
    const notEmittable = ['2026-08-25 24:00:00+00', '2026-08-25 19:49:60+00'];
    for (const u of notEmittable) {
      const r = await stack.db.adminPool.query<{ t: string }>(
        'SELECT ($1::timestamptz)::text AS t',
        [u],
      );
      expect({ u, roundTrip: r.rows[0]!.t }).not.toEqual({ u, roundTrip: u });
    }

    // (3) Both classes are rejected BEFORE any SQL runs: 400 `invalid_cursor`, and still
    // carrying AUTH-READ-CACHE-01's no-store.
    for (const u of [...pgRejected, ...notEmittable]) {
      const cursor = encodeConversationCursor({ updatedAt: u, id: randomUUID() });
      const res = await stack.app.inject({
        method: 'GET',
        url: `/v1/ai/conversations?cursor=${encodeURIComponent(cursor)}`,
        headers: { 'x-govai-api-key': owner.api_key },
      });
      expect({
        u,
        code: res.statusCode,
        body: JSON.parse(res.body) as unknown,
        cache: res.headers['cache-control'],
      }).toEqual({ u, code: 400, body: { error: 'invalid_cursor' }, cache: 'no-store' });
    }

    // (4) And the bounds do not over-reject: a cursor the SERVER itself issued is still
    // followed, so the real `updated_at::text` rendering stays inside the accepted subset.
    const paged = await seedOrg(stack);
    await seedTiedConversations(paged, 2);
    const walk = await walkConversationPages(paged.api_key, 1);
    expect(walk.pages.map((p) => p.ids.length)).toEqual([1, 1]);
    expect(walk.ids).toHaveLength(2);
  });

  it('C9c — the server can always FOLLOW ITS OWN cursor, whatever DateStyle the session carries', async () => {
    // P0B-P2-CURSOR-DATESTYLE-PIN-01. The keyset ordering key is rendered BY POSTGRESQL —
    // `updated_at::text` — and `timestamptz`'s textual form follows the session's `DateStyle`.
    // Nothing pinned it: not the bootstrap, not the role, not the pool. Under any non-ISO value
    // the store emitted a key OUTSIDE `cursor.ts`'s grammar, so the server handed the client a
    // `next_cursor` it then answered `400 invalid_cursor` on. A client cannot route around that:
    // the cursor is the server's own, and §13 defines it as opaque.
    //
    // The hostility below is AMBIENT and REAL, never simulated. A second app's pool sets
    // `DateStyle=German,DMY` in the CONNECTION STARTUP PACKET, so every connection it hands the
    // route is already non-ISO before the first statement runs — no global setting is touched,
    // and nothing depends on which pooled connection happens to be handed out.
    const hostileUrl = `${stack.db.appUrl}?options=${encodeURIComponent('-c DateStyle=German,DMY')}`;
    const app = await buildServer({ env: { ...stack.env, DATABASE_URL: hostileUrl } });
    installPostgresPoolShutdownGuard(app.govai.pool, stack.db.shuttingDown, 'app-datestyle-probe');
    try {
      // (1) THE BREAK, on the very pool the route uses. The ambient DateStyle really is non-ISO,
      // and the store's key EXPRESSION — absent its transaction-local pin — renders a value the
      // SHIPPED decoder refuses. Both halves matter: a test that only asserted the fix would pass
      // just as well on a server that never had the defect.
      const probe = await app.govai.pool.connect();
      try {
        const ambient = await probe.query<{ style: string; key: string }>(
          `SELECT current_setting('DateStyle') AS style,
                  ('2026-08-25 19:49:46.123456+00'::timestamptz)::text AS key`,
        );
        expect(ambient.rows[0]!.style).toBe('German, DMY');
        const unpinned = ambient.rows[0]!.key;
        expect(unpinned).toBe('25.08.2026 19:49:46.123456 UTC');
        expect(
          decodeConversationCursor(
            encodeConversationCursor({ updatedAt: unpinned, id: randomUUID() }),
          ),
        ).toBeNull();
      } finally {
        probe.release();
      }

      // (2) THE FIX, through the REAL route. Two conversations with DISTINCT microsecond-bearing
      // `updated_at`s, so the walk moves through the TIMESTAMP key and not only the id
      // tie-breaker, and the microsecond tail is load-bearing rather than incidental.
      const owner = await seedOrg(stack);
      const stamps = ['2026-08-25 19:49:46.123456+00', '2026-08-25 19:49:45.654321+00'];
      const seeded: string[] = [];
      for (const at of stamps) {
        const conv = await adminQuery<{ id: string }>(
          `INSERT INTO govai.ai_conversations
             (org_id, owner_user_id, mode, provider, surface, model, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, 'governed', 'anthropic', 'anthropic_api', 'm',
                   $3::timestamptz, $3::timestamptz)
           RETURNING id`,
          [owner.org_id, owner.user_id, at],
        );
        await adminQuery(
          `INSERT INTO govai.ai_conversation_branches
             (org_id, owner_user_id, conversation_id, provider, surface, model)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_api', 'm')`,
          [owner.org_id, owner.user_id, conv[0]!.id],
        );
        seeded.push(conv[0]!.id);
      }

      const pages: Array<{ ids: string[]; next_cursor: string | null; cache: unknown }> = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const url: string = `/v1/ai/conversations?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const res = await app.inject({
          method: 'GET',
          url,
          headers: { 'x-govai-api-key': owner.api_key },
        });
        // Pre-fix this is where the walk died: the FIRST page could not even be rendered, and the
        // page after it was a 400 on the server's own cursor. The body rides along so a failure
        // shows WHICH answer came back instead of a bare status code.
        expect({ page, code: res.statusCode, body: res.statusCode === 200 ? '' : res.body }).toEqual(
          { page, code: 200, body: '' },
        );
        const body = JSON.parse(res.body) as {
          conversations: Array<{ id: string; updated_at: string }>;
          next_cursor: string | null;
        };
        pages.push({
          ids: body.conversations.map((c) => c.id),
          next_cursor: body.next_cursor,
          cache: res.headers['cache-control'],
        });
        cursor = body.next_cursor;
        if (!cursor) break;
      }
      expect(pages.map((p) => p.ids.length)).toEqual([1, 1]);
      expect(pages[0]!.next_cursor).not.toBeNull();
      expect(pages[1]!.next_cursor).toBeNull();
      expect(pages.flatMap((p) => p.ids)).toEqual(seeded); // newest first, nothing skipped
      // (7) AUTH-READ-CACHE-01 is untouched by the pin.
      for (const p of pages) expect(p.cache).toBe('no-store');

      // (3) MICROSECOND FIDELITY. The cursor the server issued decodes to a key byte-identical to
      // PostgreSQL's OWN ISO rendering of that row's `updated_at` — the tail a `Date` round trip
      // or a `to_char` fraction-pad would have destroyed.
      const issued = decodeConversationCursor(pages[0]!.next_cursor!);
      expect(issued).not.toBeNull();
      expect(issued!.id).toBe(seeded[0]);
      expect(issued!.updatedAt).toBe('2026-08-25 19:49:46.123456+00');
      const canonical = await adminQuery<{ key: string }>(
        `SELECT updated_at::text AS key FROM govai.ai_conversations WHERE id = $1::uuid`,
        [seeded[0]],
      );
      expect(issued!.updatedAt).toBe(canonical[0]!.key);
    } finally {
      await app.close();
    }
  }, 180_000);

  it('C9d — the store pins the key under EVERY non-ISO style, and keeps OFFSET SECONDS', async () => {
    // The same guarantee as C9c, exercised directly on the shipped `store.listConversations`
    // across the whole hostile set rather than on one app, and on the connection state that
    // actually reaches it: a SESSION-level `SET DateStyle` on a checked-out client — which is
    // exactly what a pool hands out when the database, the role or the connection options carry a
    // non-ISO default. The client is DESTROYED afterwards (`release(true)`), so a session this
    // test dirtied is never handed to another test.
    const owner = await seedOrg(stack);
    const scope = { orgId: owner.org_id, ownerUserId: owner.user_id };
    // Two rows: an ordinary microsecond-bearing instant, and one from BEFORE São Paulo had a
    // whole-minute UTC offset — `::text` renders that one `-03:06:28`, seconds included. `to_char`
    // truncates that tail to `-03:06`, which is why the rendering stays PostgreSQL's own.
    const rows: Array<{ id: string; at: string }> = [];
    for (const at of ['2026-08-25 19:49:46.123456+00', '1900-06-01 12:00:00.000001-03:06:28']) {
      const conv = await adminQuery<{ id: string }>(
        `INSERT INTO govai.ai_conversations
           (org_id, owner_user_id, mode, provider, surface, model, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, 'governed', 'anthropic', 'anthropic_api', 'm',
                 $3::timestamptz, $3::timestamptz)
         RETURNING id`,
        [owner.org_id, owner.user_id, at],
      );
      rows.push({ id: conv[0]!.id, at });
    }

    for (const style of ['German, DMY', 'SQL, DMY', 'Postgres, MDY']) {
      const c = await stack.db.appPool.connect();
      try {
        // Ambient hostility for THIS session, established before the owner transaction opens —
        // and, for the second row, a zone whose historical offset carries SECONDS.
        await c.query(`SET DateStyle = '${style}'`);
        await c.query(`SET TimeZone = 'America/Sao_Paulo'`);
        const unpinned = await c.query<{ key: string }>(
          `SELECT ('2026-08-25 19:49:46.123456+00'::timestamptz)::text AS key`,
        );
        // The ambient really is hostile: this is what the store WOULD have emitted.
        expect({ style, iso: /^\d{4}-\d{2}-\d{2} /.test(unpinned.rows[0]!.key) }).toEqual({
          style,
          iso: false,
        });

        const page = await withOwnerContext(c, scope.orgId, scope.ownerUserId, (cc) =>
          conversationStore.listConversations(cc, scope, {
            status: 'active',
            limit: 50,
            cursor: null,
          }),
        );
        expect({ style, rows: page.rows.length }).toEqual({ style, rows: 2 });
        for (const row of page.rows) {
          // ISO-formed, and a cursor built from it is one the server's own decoder accepts,
          // byte for byte.
          const decoded = decodeConversationCursor(
            encodeConversationCursor({ updatedAt: row.updated_at_key, id: row.id }),
          );
          expect({ style, id: row.id, accepted: decoded !== null }).toEqual({
            style,
            id: row.id,
            accepted: true,
          });
          expect({ style, id: row.id, key: decoded!.updatedAt }).toEqual({
            style,
            id: row.id,
            key: row.updated_at_key,
          });
        }
        const byId = new Map(page.rows.map((r) => [r.id, r.updated_at_key]));
        expect({ style, key: byId.get(rows[0]!.id) }).toEqual({
          style,
          key: '2026-08-25 16:49:46.123456-03',
        });
        // OFFSET SECONDS survive: `-03:06:28`, not `-03:06` and not a UTC-normalised value.
        expect({ style, key: byId.get(rows[1]!.id) }).toEqual({
          style,
          key: '1900-06-01 12:00:00.000001-03:06:28',
        });

        // The pin is TRANSACTION-LOCAL: the session it borrowed is exactly as hostile afterwards,
        // so nothing it did can reach the next borrower of this connection.
        const after = await c.query<{ style: string }>(
          `SELECT current_setting('DateStyle') AS style`,
        );
        expect({ style, after: after.rows[0]!.style }).toEqual({ style, after: style });
      } finally {
        // DESTROY, never return to the pool: this connection carries a session-level
        // DateStyle/TimeZone this test set, and no other test may inherit it.
        c.release(true);
      }
    }
  }, 180_000);

  it('C10 — archived conversations leave the default list and are reachable only on request', async () => {
    const owner = await seedOrg(stack);
    const a = (await createVia(owner.api_key)).body as ConversationBody;
    const b = (await createVia(owner.api_key)).body as ConversationBody;
    await inject(stack, 'PATCH', `/v1/ai/conversations/${b.id}`, owner.api_key, {
      archived: true,
    });
    const active = await inject(stack, 'GET', '/v1/ai/conversations?limit=50', owner.api_key);
    expect(
      (active.body as { conversations: Array<{ id: string }> }).conversations.map((x) => x.id),
    ).toEqual([a.id]);
    const archived = await inject(
      stack,
      'GET',
      '/v1/ai/conversations?status=archived&limit=50',
      owner.api_key,
    );
    expect(
      (archived.body as { conversations: Array<{ id: string }> }).conversations.map((x) => x.id),
    ).toEqual([b.id]);
  });

  it('C11 — the projection carries no execution, evidence, provider or crypto material', async () => {
    const created = await createVia(orgA.api_key);
    const { id } = created.body as ConversationBody;
    await inject(stack, 'PATCH', `/v1/ai/conversations/${id}`, orgA.api_key, {
      title: 'projection probe',
    });
    const res = await inject(stack, 'GET', `/v1/ai/conversations/${id}`, orgA.api_key);
    const keys = Object.keys(res.body as Record<string, unknown>).sort();
    expect(keys).toEqual([
      'archived_at',
      'created_at',
      'id',
      'mode',
      'model',
      'provider',
      'root_branch',
      'status',
      'surface',
      'title',
      'updated_at',
    ]);
    for (const forbidden of [
      'title_ciphertext',
      'title_dek_wrapped',
      'title_hmac',
      'kms_key_id',
      'dek_wrapped',
      'claim_token',
      'govai_request_id',
      'capture_id',
      'provider_credential_id',
      'continuation_parent',
      'turns',
      'attempts',
      'retention_class',
      'owner_user_id',
    ]) {
      expect({ forbidden, present: res.rawBody.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });
});

describe('P0-B D — titles are encrypted at rest with a KEYED digest', () => {
  const TITLE = 'Board pack: LGPD incident postmortem';

  it('D1..D7 — no plaintext column, full envelope group present, digest is keyed, round trip works', async () => {
    const created = await createVia(orgA.api_key);
    const { id } = created.body as ConversationBody;
    const patched = await inject(stack, 'PATCH', `/v1/ai/conversations/${id}`, orgA.api_key, {
      title: TITLE,
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.body as ConversationBody).title).toBe(TITLE);

    const rows = await adminQuery<{
      title_ciphertext: Buffer | null;
      title_dek_wrapped: Buffer | null;
      title_kms_key_id: string | null;
      title_kms_key_version: number | null;
      title_hmac: Buffer | null;
      row_text: string;
    }>(
      `SELECT title_ciphertext, title_dek_wrapped, title_kms_key_id, title_kms_key_version,
              title_hmac, c::text AS row_text
         FROM govai.ai_conversations c WHERE id = $1::uuid`,
      [id],
    );
    const row = rows[0]!;
    // D2/D3/D4/D5 — the whole §6 group is present.
    expect(row.title_ciphertext).toBeInstanceOf(Buffer);
    expect(row.title_dek_wrapped).toBeInstanceOf(Buffer);
    expect(row.title_kms_key_id).toBe('ai-conversation-content-v1');
    expect(row.title_kms_key_version).toBe(1);
    expect(row.title_hmac).toHaveLength(32);
    // D1 — the plaintext is nowhere in the row, in any column, in any encoding.
    expect(row.row_text).not.toContain(TITLE);
    expect(row.row_text).not.toContain('LGPD incident');
    expect(row.title_ciphertext!.toString('utf8')).not.toContain('LGPD');
    // ...and nowhere else in the domain either.
    const anywhere = await adminQuery<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.ai_conversations
        WHERE position($1::bytea in coalesce(title_ciphertext, ''::bytea)) > 0`,
      [Buffer.from(TITLE, 'utf8')],
    );
    expect(anywhere[0]!.n).toBe('0');
    // D6 — the digest is a KEYED HMAC, provably not sha256(plaintext): an offline dictionary
    // attack on a database dump must not be able to confirm a guessed title.
    const rawSha = createHash('sha256').update(TITLE, 'utf8').digest();
    expect(row.title_hmac!.equals(rawSha)).toBe(false);
    // ...and it IS the value the shipped KMS derives under the integrity purpose.
    const kms = new DevKms(stack.seed);
    const expectedHmac = Buffer.from(
      await kms.hmacSha256({
        purpose: 'conversation_content_integrity',
        orgId: orgA.org_id,
        keyId: 'ai-conversation-content-v1',
        version: 1,
        message: new Uint8Array(Buffer.from(TITLE, 'utf8')),
      }),
    );
    expect(row.title_hmac!.equals(expectedHmac)).toBe(true);

    // D7 — rename again: the round trip holds and the ciphertext actually changes.
    const renamed = await inject(stack, 'PATCH', `/v1/ai/conversations/${id}`, orgA.api_key, {
      title: 'Renamed: quarterly review',
    });
    expect((renamed.body as ConversationBody).title).toBe('Renamed: quarterly review');
    const after = await adminQuery<{ title_ciphertext: Buffer }>(
      `SELECT title_ciphertext FROM govai.ai_conversations WHERE id = $1::uuid`,
      [id],
    );
    expect(after[0]!.title_ciphertext.equals(row.title_ciphertext!)).toBe(false);
    const reread = await inject(stack, 'GET', `/v1/ai/conversations/${id}`, orgA.api_key);
    expect((reread.body as ConversationBody).title).toBe('Renamed: quarterly review');
  });

  it('D8 — cross-purpose decryption fails closed (the conversation KEK is really isolated)', async () => {
    const created = await createVia(orgA.api_key);
    const { id } = created.body as ConversationBody;
    await inject(stack, 'PATCH', `/v1/ai/conversations/${id}`, orgA.api_key, {
      title: 'purpose isolation probe',
    });
    const row = (
      await adminQuery<{ title_ciphertext: Buffer; title_dek_wrapped: Buffer }>(
        `SELECT title_ciphertext, title_dek_wrapped FROM govai.ai_conversations WHERE id = $1::uuid`,
        [id],
      )
    )[0]!;
    const kms = new DevKms(stack.seed);
    const args = {
      orgId: orgA.org_id,
      keyId: 'ai-conversation-content-v1',
      version: 1,
      ciphertext: new Uint8Array(row.title_ciphertext),
      dekWrapped: new Uint8Array(row.title_dek_wrapped),
    };
    // The right purpose reads it...
    expect(
      Buffer.from(await kms.envelopeDecrypt({ ...args, purpose: 'conversation_content' })).toString(
        'utf8',
      ),
    ).toBe('purpose isolation probe');
    // ...and the audit/payload purpose (the default) cannot.
    await expect(kms.envelopeDecrypt({ ...args, purpose: 'payload_dek' })).rejects.toThrow();
    await expect(kms.envelopeDecrypt({ ...args })).rejects.toThrow();
    // A different ORG's derivation cannot either.
    await expect(
      kms.envelopeDecrypt({ ...args, orgId: orgC.org_id, purpose: 'conversation_content' }),
    ).rejects.toThrow();
  });

  it('D9 — an unauthorized principal can neither read nor decrypt the title through the route', async () => {
    const created = await createVia(orgA.api_key);
    const { id } = created.body as ConversationBody;
    await inject(stack, 'PATCH', `/v1/ai/conversations/${id}`, orgA.api_key, {
      title: 'confidential board title',
    });
    for (const key of [ownerBKey, orgC.api_key]) {
      const get = await inject(stack, 'GET', `/v1/ai/conversations/${id}`, key);
      expect(get.statusCode).toBe(404);
      expect(get.rawBody).not.toContain('confidential');
      const patch = await inject(stack, 'PATCH', `/v1/ai/conversations/${id}`, key, {
        title: 'hijacked',
      });
      expect(patch.statusCode).toBe(404);
    }
    // The title is unchanged after both attempts.
    const owner = await inject(stack, 'GET', `/v1/ai/conversations/${id}`, orgA.api_key);
    expect((owner.body as ConversationBody).title).toBe('confidential board title');
  });
});

describe('P0-B E — patch: only §13’s two guarded fields', () => {
  it('E1/E2/E3 — rename, archive and unarchive, each on the lawful lifecycle edge', async () => {
    const created = await createVia(orgA.api_key);
    const { id } = created.body as ConversationBody;

    const renamed = await inject(stack, 'PATCH', `/v1/ai/conversations/${id}`, orgA.api_key, {
      title: 'renamed only',
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.body as ConversationBody).status).toBe('active');
    expect((renamed.body as ConversationBody).archived_at).toBeNull();

    const archived = await inject(stack, 'PATCH', `/v1/ai/conversations/${id}`, orgA.api_key, {
      archived: true,
    });
    expect((archived.body as ConversationBody).status).toBe('archived');
    expect((archived.body as ConversationBody).archived_at).not.toBeNull();
    expect((archived.body as ConversationBody).title).toBe('renamed only'); // rename survives

    const restored = await inject(stack, 'PATCH', `/v1/ai/conversations/${id}`, orgA.api_key, {
      archived: false,
    });
    expect((restored.body as ConversationBody).status).toBe('active');
    // `archived_at` names the CURRENT state, so restoring clears it.
    expect((restored.body as ConversationBody).archived_at).toBeNull();
  });

  it('E4/E5/E6/E7 — every non-guarded field is refused at the contract edge', async () => {
    const created = await createVia(orgA.api_key);
    const { id } = created.body as ConversationBody;
    for (const patch of [
      { mode: 'passthrough' },
      { provider: 'openai' },
      { surface: 'openai_responses' },
      { model: 'gpt-test' },
      { org_id: randomUUID() },
      { owner_user_id: randomUUID() },
      { id: randomUUID() },
      { status: 'deleted' },
      { status: 'active' },
      { retention_class: 'legal_hold' },
      { created_at: new Date().toISOString() },
      {},
    ]) {
      const res = await inject(stack, 'PATCH', `/v1/ai/conversations/${id}`, orgA.api_key, patch);
      expect({ patch, code: res.statusCode }).toEqual({ patch, code: 400 });
    }
    // Nothing moved.
    const row = (
      await adminQuery<{ mode: string; provider: string; surface: string; model: string; status: string }>(
        `SELECT mode, provider, surface, model, status FROM govai.ai_conversations WHERE id = $1::uuid`,
        [id],
      )
    )[0]!;
    expect(row).toEqual({
      mode: 'governed',
      provider: 'anthropic',
      surface: CREATE.surface,
      model: CREATE.model,
      status: 'active',
    });
  });

  it('E6b — owner/org re-stamping is refused by the database too, not only by the schema', async () => {
    const created = await createVia(orgA.api_key);
    const { id } = created.body as ConversationBody;
    for (const [column, value] of [
      ['owner_user_id', randomUUID()],
      ['org_id', randomUUID()],
    ] as const) {
      // Even as SUPERUSER the guard trigger refuses: identity is frozen for every role.
      let blocked = false;
      try {
        await adminQuery(
          `UPDATE govai.ai_conversations SET ${column} = $1::uuid WHERE id = $2::uuid`,
          [value, id],
        );
      } catch (err) {
        blocked = (err as { code?: string }).code === '42501';
      }
      expect({ column, blocked }).toEqual({ column, blocked: true });
    }
    // ...and the request role holds no column privilege on them at all.
    const priv = await adminQuery<{ owner_col: boolean; org_col: boolean }>(
      `SELECT has_column_privilege('govai_app', 'govai.ai_conversations', 'owner_user_id', 'UPDATE') AS owner_col,
              has_column_privilege('govai_app', 'govai.ai_conversations', 'org_id', 'UPDATE') AS org_col`,
    );
    expect(priv[0]).toEqual({ owner_col: false, org_col: false });
  });

  it('E8 — a deleted_pending or deleted conversation is unaddressable and cannot be resurrected', async () => {
    for (const status of ['deleted_pending', 'deleted'] as const) {
      const created = await createVia(orgA.api_key);
      const { id } = created.body as ConversationBody;
      // P0-B implements no delete protocol, so the state is reached out-of-band for this proof.
      await adminQuery(
        `UPDATE govai.ai_conversations SET status = 'deleted_pending' WHERE id = $1::uuid`,
        [id],
      );
      if (status === 'deleted') {
        await adminQuery(
          `UPDATE govai.ai_conversations SET status = 'deleted' WHERE id = $1::uuid`,
          [id],
        );
      }
      for (const res of [
        await inject(stack, 'GET', `/v1/ai/conversations/${id}`, orgA.api_key),
        await inject(stack, 'PATCH', `/v1/ai/conversations/${id}`, orgA.api_key, {
          archived: false,
        }),
        await inject(stack, 'PATCH', `/v1/ai/conversations/${id}`, orgA.api_key, {
          title: 'resurrect me',
        }),
      ]) {
        expect({ status, code: res.statusCode }).toEqual({ status, code: 404 });
      }
      // It never appears in either list, and its durable status is untouched.
      for (const q of ['', '?status=archived']) {
        const list = await inject(stack, 'GET', `/v1/ai/conversations${q}`, orgA.api_key);
        const ids = (list.body as { conversations: Array<{ id: string }> }).conversations.map(
          (x) => x.id,
        );
        expect({ status, q, leaked: ids.includes(id) }).toEqual({ status, q, leaked: false });
      }
      const row = (
        await adminQuery<{ status: string }>(
          `SELECT status FROM govai.ai_conversations WHERE id = $1::uuid`,
          [id],
        )
      )[0]!;
      expect(row.status).toBe(status);
    }
  });

  it('E9 — a foreign or absent id patches nothing and answers 404', async () => {
    const absent = await inject(
      stack,
      'PATCH',
      `/v1/ai/conversations/${randomUUID()}`,
      orgA.api_key,
      { title: 'ghost' },
    );
    expect(absent.statusCode).toBe(404);
    expect(absent.body).toEqual({ error: 'conversation_not_found' });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// P0-B C6b/C6c — AUTH-READ-CACHE-01 on a response TERMINATED BEFORE THE ROUTE HANDLER.
//
// Adjudicated finding P0B-P2-MATERIAL-01 (AUTH_READ_CACHE_01_RATE_LIMIT_RESPONSE_GAP). C6 above
// proves the header on ten response classes, but every one of them is produced by the route
// handler or by a hook INSIDE this plugin — none of them proves what happens when the request is
// answered by something that runs earlier. The two classes that are answered earlier are the rate
// limiter's 429 and an unexpected 500, and neither was reachable from the movement's tests: the
// hermetic stack runs NODE_ENV='test', the branch of `server.ts:110-113` that raises the limit to
// 1_000_000 precisely so the suite is not throttled, so no 429 could ever be produced.
//
// These two tests remove that blind spot. They build a SECOND app against the SAME database on
// the NODE_ENV='development' branch — the one that keeps the real 100/minute limit — and drive it
// until the limiter genuinely engages, then assert the header on both P0-B conversation GET
// surfaces. The same throttled app also answers an unrelated authenticated read, which must stay
// UNCHANGED: a hook that had leaked to the root context would pass the conversation assertions
// and fail that one.
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('P0-B C6b/C6c — AUTH-READ-CACHE-01 on a pre-handler termination', () => {
  const rawGet = (app: FastifyInstance, url: string, key?: string) =>
    app.inject({ method: 'GET', url, headers: key ? { 'x-govai-api-key': key } : {} });

  it('C6b — a rate-limit 429 on a conversation GET carries no-store, and leaks to no other route', async () => {
    const created = await createVia(orgA.api_key);
    const { id } = created.body as ConversationBody;

    const app = await buildServer({ env: { ...stack.env, NODE_ENV: 'development' } });
    installPostgresPoolShutdownGuard(app.govai.pool, stack.db.shuttingDown, 'app-rate-limit-probe');
    try {
      // Exhaust the limiter on the cheapest request this surface has: a malformed path id is
      // rejected on syntax before any database work, yet the limiter still counts it.
      let requests = 1;
      let probe = await rawGet(app, '/v1/ai/conversations/not-a-uuid', orgA.api_key);
      while (probe.statusCode !== 429 && requests < 500) {
        probe = await rawGet(app, '/v1/ai/conversations/not-a-uuid', orgA.api_key);
        requests += 1;
      }
      // The limiter really engaged, within the bound — this is not an assertion on a 400.
      expect({ bounded: requests < 500, code: probe.statusCode }).toEqual({
        bounded: true,
        code: 429,
      });

      for (const [label, url] of [
        ['list (429)', '/v1/ai/conversations'],
        ['get one (429)', `/v1/ai/conversations/${id}`],
      ] as const) {
        const res = await rawGet(app, url, orgA.api_key);
        const body = JSON.parse(res.body) as { error?: string };
        // It is the LIMITER answering from before the route handler, not the route: its own
        // headers are present and the body is its error shape, never this API's `{ error: ... }`.
        expect({ label, code: res.statusCode, limit: res.headers['x-ratelimit-limit'] }).toEqual({
          label,
          code: 429,
          limit: '100',
        });
        expect({ label, err: body.error }).toEqual({ label, err: 'Too Many Requests' });
        expect({ label, cache: res.headers['cache-control'] }).toEqual({ label, cache: 'no-store' });
      }

      // ENCAPSULATION UNDER THE SAME TERMINATION. `/v1/capabilities` is throttled by the SAME
      // app-level limiter on the SAME app, and must be byte-identical to what it was before this
      // movement — AUTH-READ-CACHE-01 stays OPEN as a class and is not silently closed here.
      const other = await rawGet(app, '/v1/capabilities', orgA.api_key);
      expect({ code: other.statusCode, cache: other.headers['cache-control'] }).toEqual({
        code: 429,
        cache: undefined,
      });
    } finally {
      await app.close();
    }
  }, 180_000);

  it('C6c — an unexpected 500 on a conversation GET carries no-store', async () => {
    const created = await createVia(orgA.api_key);
    const { id } = created.body as ConversationBody;

    // A disposable app whose database has gone away. `authenticate()` opens its client BEFORE any
    // tenant state exists (`ai-conversations.ts:97`), so `pool.connect()` rejects deterministically
    // and the failure escapes as a generic 500. Nothing production is test-only for this: losing
    // the database is a real failure mode, reached here without touching shipped code.
    const app = await buildServer({ env: stack.env });
    try {
      await app.govai.pool.end();
      const res = await rawGet(app, `/v1/ai/conversations/${id}`, orgA.api_key);
      expect({ code: res.statusCode, cache: res.headers['cache-control'] }).toEqual({
        code: 500,
        cache: 'no-store',
      });
    } finally {
      await app.close();
    }
  }, 180_000);
});
