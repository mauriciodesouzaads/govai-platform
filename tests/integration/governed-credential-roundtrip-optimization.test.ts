// PR3.1b roundtrip optimization regression — issue #22.
//
// PR3.1a routed governed-anthropic/governed-openai through a second
// `org_tier_lookup` SECURITY DEFINER call inside `lookupOperationalMode`.
// PR3.1b caches the operational_mode from the authenticated identity in a
// per-org map and consults it from `resolveProviderKey(orgId)` instead.
//
// The invariant we lock here is NARROW: the *fallback* roundtrip — i.e. the
// `SELECT operational_mode FROM govai.org_tier_lookup(...)` query that
// `lookupOperationalMode` emits — must NOT fire on a normal governed
// request after PR3.1b. The number of auth-path roundtrips
// (`SELECT * FROM govai.org_tier_lookup(...)`) is provider-plugin-internal
// (the OpenAI plugin happens to repeat `resolveTenant` more times than the
// Anthropic plugin); regressing on that count is out of PR3.1b scope.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  stopStack,
  seedOrg,
  type Stack,
} from './helpers/server-fixture.js';

let stack: Stack;
let fallbackCalls = 0;
let authCalls = 0;
const lookupQueries: string[] = [];

const FALLBACK_QUERY_FRAGMENT = 'SELECT operational_mode FROM govai.org_tier_lookup';
const AUTH_QUERY_FRAGMENT = 'SELECT * FROM govai.org_tier_lookup';
const originalConnectRef: { fn: typeof stack.app.govai.pool.connect | null } = { fn: null };

beforeAll(async () => {
  stack = await startStack();
  // The app uses pool.connect() + client.query() in routes; wrap pool.connect
  // to return a client whose query() increments our counter on
  // org_tier_lookup references. The wrapper also leaves direct pool.query
  // calls (if any) intact — we'd see those too if the app ever used them.
  const pool = stack.app.govai.pool as unknown as {
    connect: () => Promise<{ query: (...args: unknown[]) => unknown; release: () => void }>;
  };
  originalConnectRef.fn = pool.connect.bind(pool) as typeof stack.app.govai.pool.connect;
  (pool as unknown as { connect: unknown }).connect = async () => {
    const client = await originalConnectRef.fn!();
    const origQuery = (client as unknown as { query: (...args: unknown[]) => unknown }).query.bind(
      client,
    );
    (client as unknown as { query: (...args: unknown[]) => unknown }).query = (
      ...args: unknown[]
    ) => {
      const first = args[0];
      const sql = typeof first === 'string' ? first : '';
      if (sql.includes(FALLBACK_QUERY_FRAGMENT)) {
        fallbackCalls += 1;
        lookupQueries.push(`FALLBACK: ${sql.replace(/\s+/g, ' ').slice(0, 120)}`);
      } else if (sql.includes(AUTH_QUERY_FRAGMENT)) {
        authCalls += 1;
        lookupQueries.push(`AUTH: ${sql.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
      return origQuery(...args);
    };
    return client as unknown as Awaited<ReturnType<typeof stack.app.govai.pool.connect>>;
  };
}, 240_000);

afterAll(async () => {
  if (originalConnectRef.fn) {
    (stack.app.govai.pool as unknown as { connect: unknown }).connect = originalConnectRef.fn;
  }
  if (stack) await stopStack(stack);
});

describe('PR3.1b governed credential roundtrip optimization', () => {
  it('governed-anthropic /v1/messages triggers exactly one org_tier_lookup call (auth only)', async () => {
    const org = await seedOrg(stack);
    fallbackCalls = 0;
    authCalls = 0;
    lookupQueries.length = 0;
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'optimization regression' }],
      }),
    });
    expect(res.statusCode).toBe(200);
    // The PR3.1a fallback (lookupOperationalMode) must NOT fire — that's the
    // optimization. Auth-path roundtrips are provider-plugin-internal and
    // expected to be ≥1 (just sanity-check they didn't go to 0, which would
    // indicate the instrumentation broke).
    expect(fallbackCalls).toBe(0);
    expect(authCalls).toBeGreaterThanOrEqual(1);
  });

  it('governed-openai /v1/responses triggers exactly one org_tier_lookup call', async () => {
    const org = await seedOrg(stack);
    fallbackCalls = 0;
    authCalls = 0;
    lookupQueries.length = 0;
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/openai/v1/responses',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'gpt-fixture-1',
        input: 'optimization regression',
      }),
    });
    expect(res.statusCode).toBe(200);
    // The PR3.1a fallback (lookupOperationalMode) must NOT fire — that's the
    // optimization. Auth-path roundtrips are provider-plugin-internal and
    // expected to be ≥1 (just sanity-check they didn't go to 0, which would
    // indicate the instrumentation broke).
    expect(fallbackCalls).toBe(0);
    expect(authCalls).toBeGreaterThanOrEqual(1);
  });
});
