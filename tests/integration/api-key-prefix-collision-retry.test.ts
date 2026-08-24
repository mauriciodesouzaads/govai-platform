// EP-AUTH-API-KEY-PREFIX-COLLISION-HARDENING / T1-TEST-ISSUANCE-BOUNDARY-RETRY-01.
//
// The API-key lookup prefix carries only three random base64url characters
// (`govai_sk_` = 9 of PREFIX_LOOKUP_LEN = 12; nominal domain 64³ = 262,144) and
// `govai.api_keys.prefix` is the PRIMARY KEY — so independently generated fixture keys
// can, and empirically did (twice in one CI day, `workroom-rls` + `workroom-run-idempotency`),
// collide with `23505 api_keys_pkey`. The DB constraint is correct and stays authoritative;
// what this suite proves is the bounded whole-transaction retry at the shared test issuance
// boundary (`seedOrg` / `addApiKey` / `withGeneratedApiKeyCollisionRetry`).
//
// Collisions are manufactured DETERMINISTICALLY: this file narrowly mocks
// `generateApiKey` from @govai/core-identity with a drain-first queue of forced candidates
// that falls through to the REAL generator when empty. A forced candidate carries a prefix
// that already exists in the table, so the INSERT hits the real PostgreSQL constraint —
// nothing about the database, argon2 verification, RLS or the HTTP auth path is mocked.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// vi.mock factories are hoisted above imports; the queue lives in vi.hoisted state so the
// factory can see it. `calls` counts every generator invocation, which is exactly the
// number of candidates a retrying boundary consumed (one fresh candidate per attempt).
const gen = vi.hoisted(() => ({
  forced: [] as Array<{ plaintext: string; prefix: string; hash: string }>,
  calls: 0,
}));

vi.mock('@govai/core-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@govai/core-identity')>();
  return {
    ...actual,
    generateApiKey: async () => {
      gen.calls += 1;
      return gen.forced.shift() ?? actual.generateApiKey();
    },
  };
});

import { verifyApiKey, type GeneratedApiKey } from '@govai/core-identity';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  inject,
  withGeneratedApiKeyCollisionRetry,
  API_KEY_COLLISION_RETRY_BOUND,
  type Stack,
} from './helpers/server-fixture.js';

// The unmocked module, for forging candidates and for contract assertions.
const identity = await vi.importActual<typeof import('@govai/core-identity')>(
  '@govai/core-identity',
);

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

beforeEach(() => {
  gen.forced.length = 0;
});

/**
 * Forge a candidate whose lookup prefix equals `targetPrefix` (12 chars). The hash comes
 * from a real generated key and does NOT match the forged plaintext — that is fine by
 * construction: a colliding candidate can never commit (the INSERT dies on the PK), so its
 * hash is never persisted or verified.
 */
async function forgeCollidingCandidate(targetPrefix: string): Promise<GeneratedApiKey> {
  const real = await identity.generateApiKey();
  return {
    plaintext: targetPrefix + real.plaintext.slice(targetPrefix.length),
    prefix: targetPrefix,
    hash: real.hash,
  };
}

type KeyRow = { prefix: string; hash: string; org_id: string; user_id: string; status: string; roles: string[] };

async function keyRow(prefix: string): Promise<KeyRow | undefined> {
  const c = await stack.db.adminPool.connect();
  try {
    const r = await c.query<KeyRow>(
      'SELECT prefix, hash, org_id, user_id, status, roles FROM govai.api_keys WHERE prefix = $1',
      [prefix],
    );
    return r.rows[0];
  } finally {
    c.release();
  }
}

async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const c = await stack.db.adminPool.connect();
  try {
    const r = await c.query<{ n: string }>(sql, params);
    return Number(r.rows[0]!.n);
  } finally {
    c.release();
  }
}

const countOrgs = () => countRows('SELECT count(*) AS n FROM govai.orgs');
const countKeys = () => countRows('SELECT count(*) AS n FROM govai.api_keys');
const countKeysForOrg = (orgId: string) =>
  countRows('SELECT count(*) AS n FROM govai.api_keys WHERE org_id = $1::uuid', [orgId]);

describe('T1 — seedOrg bounded api_keys_pkey collision retry', () => {
  it('A — one forced collision with a pre-existing prefix, then a fresh candidate commits', async () => {
    const victim = await seedOrg(stack);
    const victimBefore = await keyRow(victim.api_key_prefix);
    expect(victimBefore).toBeDefined();

    gen.forced.push(await forgeCollidingCandidate(victim.api_key_prefix));
    const callsBefore = gen.calls;
    const orgsBefore = await countOrgs();

    const seeded = await seedOrg(stack);

    // Two candidates consumed: the forced collider, then one fresh generated key.
    expect(gen.calls - callsBefore).toBe(2);
    expect(gen.forced).toHaveLength(0);
    expect(seeded.api_key_prefix).not.toBe(victim.api_key_prefix);

    // Exactly one new org, owning exactly one key — the first (aborted) transaction left
    // no partial org row behind.
    expect(await countOrgs()).toBe(orgsBefore + 1);
    expect(await countKeysForOrg(seeded.org_id)).toBe(1);

    // The returned plaintext authenticates end-to-end through the real HTTP auth path.
    const me = await inject(stack, 'GET', '/v1/me', seeded.api_key);
    expect(me.statusCode).toBe(200);
    expect((me.body as { org_id: string }).org_id).toBe(seeded.org_id);

    // The pre-existing key won the uniqueness race: byte-identical row, still authenticates.
    expect(await keyRow(victim.api_key_prefix)).toEqual(victimBefore);
    expect((await inject(stack, 'GET', '/v1/me', victim.api_key)).statusCode).toBe(200);
  });

  it('B — multiple consecutive forced collisions, then success', async () => {
    const victim = await seedOrg(stack);
    gen.forced.push(
      await forgeCollidingCandidate(victim.api_key_prefix),
      await forgeCollidingCandidate(victim.api_key_prefix),
    );
    const callsBefore = gen.calls;

    const seeded = await seedOrg(stack);

    expect(gen.calls - callsBefore).toBe(3);
    expect(gen.forced).toHaveLength(0);
    expect(await countKeysForOrg(seeded.org_id)).toBe(1);
    expect((await inject(stack, 'GET', '/v1/me', seeded.api_key)).statusCode).toBe(200);
  });

  it('C — exhaustion fails closed: deterministic error, no partial state, no secret material', async () => {
    const victim = await seedOrg(stack);
    const victimBefore = await keyRow(victim.api_key_prefix);
    for (let i = 0; i < API_KEY_COLLISION_RETRY_BOUND; i++) {
      gen.forced.push(await forgeCollidingCandidate(victim.api_key_prefix));
    }
    const callsBefore = gen.calls;
    const orgsBefore = await countOrgs();
    const keysBefore = await countKeys();

    const err = await seedOrg(stack).then(
      () => undefined,
      (e: unknown) => e as Error,
    );

    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(
      new RegExp(`retry exhausted after ${API_KEY_COLLISION_RETRY_BOUND} attempts`),
    );
    // Error hygiene: the deterministic error names the attempt count and constraint but
    // carries no plaintext, no prefix, no argon2 hash (the pg detail echoing the colliding
    // prefix is not chained).
    expect(err!.message).not.toContain('govai_sk_');
    expect(err!.message).not.toContain('$argon2');

    // The bound is exact — one fresh candidate per attempt, then stop.
    expect(gen.calls - callsBefore).toBe(API_KEY_COLLISION_RETRY_BOUND);
    expect(gen.forced).toHaveLength(0);

    // Every attempt rolled back whole: zero new orgs, zero new keys, victim untouched.
    expect(await countOrgs()).toBe(orgsBefore);
    expect(await countKeys()).toBe(keysBefore);
    expect(await keyRow(victim.api_key_prefix)).toEqual(victimBefore);
  });
});

describe('T1 — collision discrimination (only 23505/api_keys_pkey retries)', () => {
  it('D — a real 23505 on a DIFFERENT constraint is not retried: fails immediately', async () => {
    const existing = await seedOrg(stack);
    const callsBefore = gen.calls;
    let attempts = 0;

    const err = await withGeneratedApiKeyCollisionRetry(async () => {
      attempts += 1;
      const c = await stack.db.adminPool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE govai_audit_writer');
        await c.query("SELECT set_config('app.org_id', $1, true)", [existing.org_id]);
        await c.query(
          `INSERT INTO govai.orgs (id, name, operational_mode) VALUES ($1::uuid, 'dup', 'test')`,
          [existing.org_id],
        );
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toMatchObject({ code: '23505', constraint: 'orgs_pkey' });
    expect(attempts).toBe(1);
    expect(gen.calls - callsBefore).toBe(1);
  });

  it('E — a non-23505 database error is not retried: fails immediately', async () => {
    const callsBefore = gen.calls;
    let attempts = 0;

    const err = await withGeneratedApiKeyCollisionRetry(async () => {
      attempts += 1;
      const c = await stack.db.adminPool.connect();
      try {
        await c.query('SELECT * FROM govai.t1_definitely_missing_table');
      } finally {
        c.release();
      }
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toMatchObject({ code: '42P01' }); // undefined_table
    expect(attempts).toBe(1);
    expect(gen.calls - callsBefore).toBe(1);
  });
});

describe('T1 — addApiKey bounded collision retry', () => {
  it('F+G — forced collision, then the committed fresh candidate is returned with roles/user preserved', async () => {
    const org = await seedOrg(stack);
    gen.forced.push(await forgeCollidingCandidate(org.api_key_prefix));
    const callsBefore = gen.calls;
    const orgKeysBefore = await countKeysForOrg(org.org_id);

    const added = await addApiKey(stack, org.org_id, org.user_id, ['auditor']);

    expect(gen.calls - callsBefore).toBe(2);
    expect(gen.forced).toHaveLength(0);
    expect(added.api_key_prefix).not.toBe(org.api_key_prefix);

    // Exactly one new committed row; orgId/userId/roles preserved across the retry.
    expect(await countKeysForOrg(org.org_id)).toBe(orgKeysBefore + 1);
    const row = await keyRow(added.api_key_prefix);
    expect(row).toMatchObject({
      org_id: org.org_id,
      user_id: org.user_id,
      status: 'active',
      roles: ['auditor'],
    });

    // G — the returned plaintext corresponds to the persisted row: the stored argon2 hash
    // verifies the returned secret, so the caller holds the COMMITTED candidate, not a
    // discarded one.
    expect(await verifyApiKey(added.api_key, row!.hash)).toBe(true);
    const me = await inject(stack, 'GET', '/v1/me', added.api_key);
    expect(me.statusCode).toBe(200);
    expect((me.body as { org_id: string }).org_id).toBe(org.org_id);

    // The colliding pre-existing key still authenticates.
    expect((await inject(stack, 'GET', '/v1/me', org.api_key)).statusCode).toBe(200);
  });
});

describe('T1 — authentication contract unchanged', () => {
  it('H — the no-collision path consumes exactly one candidate and the key contract is untouched', async () => {
    const callsBefore = gen.calls;
    const seeded = await seedOrg(stack);
    expect(gen.calls - callsBefore).toBe(1);

    // Prefix/format contract: `govai_sk_` + 12-char lookup prefix, identical to what the
    // unmocked generator and lookupPrefix produce. No format, length or lookup change.
    expect(seeded.api_key.startsWith('govai_sk_')).toBe(true);
    expect(seeded.api_key_prefix).toHaveLength(12);
    expect(identity.lookupPrefix(seeded.api_key)).toBe(seeded.api_key_prefix);
    const reference = await identity.generateApiKey();
    expect(seeded.api_key).toHaveLength(reference.plaintext.length);

    const me = await inject(stack, 'GET', '/v1/me', seeded.api_key);
    expect(me.statusCode).toBe(200);
    expect((me.body as { org_id: string; user_id: string }).user_id).toBe(seeded.user_id);
  });
});
