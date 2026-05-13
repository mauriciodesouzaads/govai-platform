// Regression for PR3.1k / issue #25.
//
// Direct governed routes used to issue TWO `govai.org_tier_lookup` calls per
// request: one in `authenticateApiKey` and a second one inside the route's
// `resolveProviderKey` closure (via `lookupOperationalMode`). PR3.1k widened
// the governed `resolveProviderKey` contract to receive
// `(orgId, operationalMode)`, threading the operational mode already known at
// auth time through to the credential resolver and eliminating the second
// roundtrip.
//
// This test asserts EXACTLY ONE `govai.org_tier_lookup` per direct governed
// request — a strong signal, not an "≤ N" fallback. It does so by wrapping the
// Fastify app's pg Pool's `connect()` to intercept client `query()` calls and
// count those whose SQL contains the function name `govai.org_tier_lookup`.
// The function name is referenced literally in product code (auth.ts and the
// SECURITY DEFINER migration that defines it) and is the stable contract this
// test pins.
//
// No live providers. No process-global state across tests — the instrumentation
// is installed and torn down per test.

import type { Pool, PoolClient } from 'pg';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { startStack, stopStack, seedOrg, inject, type Stack } from './helpers/server-fixture.js';

let stack: Stack;

interface PoolInstrumentation {
  /** Reset the per-request counter. Call before each request to isolate counts. */
  reset(): void;
  /** Number of intercepted `client.query()` calls whose SQL matches the pattern. */
  count(pattern: RegExp): number;
  /** Restore the original `pool.connect`. Call in afterEach to avoid leakage. */
  restore(): void;
}

/**
 * Wrap a node-pg Pool so every `client.query()` from a pool checkout records
 * its SQL into a local list. Returns helpers to read and reset the list and to
 * restore the original `connect()`.
 *
 * Implementation notes:
 *   - We intercept at the `connect()` boundary because every route path
 *     borrows a client from the pool before issuing queries; this gives us a
 *     single chokepoint without touching product code.
 *   - We capture the SQL string from `client.query()`'s first argument, which
 *     is either a string or a config object with a `.text` field.
 *   - We do NOT alter the query result in any way — every call is passed
 *     through to the original method.
 *   - We do not record bound parameter values (no risk of capturing secrets).
 */
function instrumentPool(pool: Pool): PoolInstrumentation {
  const recordedSql: string[] = [];
  const originalConnect = pool.connect.bind(pool);

  // The Pool#connect overload returns either a Promise<PoolClient> or feeds a
  // callback; the entire codebase uses the Promise form, which is what we
  // intercept here.
  const wrappedConnect = async (): Promise<PoolClient> => {
    const client = await originalConnect();
    const originalQuery = client.query.bind(client) as PoolClient['query'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as unknown as { query: unknown }).query = ((...args: any[]) => {
      const first = args[0];
      const sql: string =
        typeof first === 'string'
          ? first
          : first && typeof first === 'object' && typeof first.text === 'string'
            ? first.text
            : '';
      if (sql.length > 0) recordedSql.push(sql);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalQuery as any)(...args);
    }) as PoolClient['query'];
    return client;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as unknown as { connect: any }).connect = wrappedConnect;

  return {
    reset() {
      recordedSql.length = 0;
    },
    count(pattern: RegExp) {
      return recordedSql.filter((sql) => pattern.test(sql)).length;
    },
    restore() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pool as unknown as { connect: any }).connect = originalConnect;
    },
  };
}

let instrumentation: PoolInstrumentation;

beforeAll(async () => {
  stack = await startStack();
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

beforeEach(() => {
  instrumentation = instrumentPool(stack.app.govai.pool);
});

afterEach(() => {
  if (instrumentation) instrumentation.restore();
});

const ORG_TIER_LOOKUP_RE = /govai\.org_tier_lookup/;

describe('PR3.1k (#25) — direct governed routes issue exactly one govai.org_tier_lookup per request', () => {
  it('/governed/anthropic/v1/messages → exactly 1 org_tier_lookup', async () => {
    const org = await seedOrg(stack);
    instrumentation.reset();
    const res = await inject(stack, 'POST', '/governed/anthropic/v1/messages', org.api_key, {
      model: 'claude-fixture-1',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.statusCode).toBe(200);
    expect(instrumentation.count(ORG_TIER_LOOKUP_RE)).toBe(1);
  });

  it('/governed/openai/v1/responses → exactly 1 org_tier_lookup', async () => {
    const org = await seedOrg(stack);
    instrumentation.reset();
    const res = await inject(stack, 'POST', '/governed/openai/v1/responses', org.api_key, {
      model: 'gpt-fixture-1',
      input: 'hi',
    });
    expect(res.statusCode).toBe(200);
    expect(instrumentation.count(ORG_TIER_LOOKUP_RE)).toBe(1);
  });

  it('/governed/openai/v1/chat/completions → exactly 1 org_tier_lookup', async () => {
    const org = await seedOrg(stack);
    instrumentation.reset();
    const res = await inject(stack, 'POST', '/governed/openai/v1/chat/completions', org.api_key, {
      model: 'gpt-fixture-1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.statusCode).toBe(200);
    expect(instrumentation.count(ORG_TIER_LOOKUP_RE)).toBe(1);
  });

  // Sibling-surface sanity: these were never broken by #25, but pinning them
  // here means a future regression that re-introduces a redundant lookup on
  // any of them fails this same test file instead of going unnoticed.

  it('/passthrough/anthropic/v1/messages → exactly 1 org_tier_lookup (unaffected by #25)', async () => {
    const org = await seedOrg(stack);
    instrumentation.reset();
    const res = await inject(stack, 'POST', '/passthrough/anthropic/v1/messages', org.api_key, {
      model: 'claude-fixture-1',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.statusCode).toBe(200);
    expect(instrumentation.count(ORG_TIER_LOOKUP_RE)).toBe(1);
  });

  it('/passthrough/openai/v1/responses → exactly 1 org_tier_lookup (unaffected by #25)', async () => {
    const org = await seedOrg(stack);
    instrumentation.reset();
    const res = await inject(stack, 'POST', '/passthrough/openai/v1/responses', org.api_key, {
      model: 'gpt-fixture-1',
      input: 'hi',
    });
    expect(res.statusCode).toBe(200);
    expect(instrumentation.count(ORG_TIER_LOOKUP_RE)).toBe(1);
  });
});
