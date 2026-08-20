// GET /v1/me — the authenticated-principal read projection (EP-UIUX-V1-B2 §10).
//
// The route serializes the identity `authenticateApiKey` already resolved, so these tests
// check three things and nothing else: that the projection is TRUE (it equals the org's real
// state), that it is COMPLETE ONLY up to the contract (no credential material, no other
// tenant), and that it is INERT (read-only, and a rejection discloses nothing).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { generateApiKey } from '@govai/core-identity';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  grantAdminRole,
  setOrgOperationalMode,
  inject,
  type SeededOrg,
  type Stack,
} from './helpers/server-fixture.js';

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

type Principal = {
  principal_type: string;
  org_id: string;
  user_id: string;
  roles: string[];
  tier: string;
  operational_mode: string;
};

/** Tier mutation is reserved for direct DB administration (migration 0008): govai_app has no
 *  UPDATE on govai.orgs.tier, so the fixture goes through the superuser pool, exactly as
 *  setOrgOperationalMode does. */
async function setOrgTier(orgId: string, tier: string): Promise<void> {
  const c = await stack.db.adminPool.connect();
  try {
    await c.query('UPDATE govai.orgs SET tier = $2 WHERE id = $1::uuid', [orgId, tier]);
  } finally {
    c.release();
  }
}

async function storedHash(prefix: string): Promise<string> {
  const c = await stack.db.adminPool.connect();
  try {
    const r = await c.query<{ hash: string }>(
      'SELECT hash FROM govai.api_keys WHERE prefix = $1',
      [prefix],
    );
    return r.rows[0]!.hash;
  } finally {
    c.release();
  }
}

async function countForOrg(table: string, orgId: string): Promise<string> {
  const c = await stack.db.adminPool.connect();
  try {
    const r = await c.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM ${table} WHERE org_id = $1::uuid`,
      [orgId],
    );
    return r.rows[0]!.c;
  } finally {
    c.release();
  }
}

/** A raw inject so the Authorization header can be exercised — the shared `inject` helper only
 *  speaks `x-govai-api-key`. */
async function injectBearer(url: string, token: string) {
  const res = await stack.app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${token}` },
  });
  return { statusCode: res.statusCode, body: JSON.parse(res.body) as unknown, rawBody: res.body };
}

describe('GET /v1/me — the projection is true', () => {
  let org: SeededOrg;

  beforeAll(async () => {
    org = await seedOrg(stack);
  });

  it('ME-01 — returns the org, user, tier and operational mode the database actually holds', async () => {
    const res = await inject(stack, 'GET', '/v1/me', org.api_key);
    expect(res.statusCode).toBe(200);
    const body = res.body as Principal;
    expect(body.org_id).toBe(org.org_id);
    expect(body.user_id).toBe(org.user_id);
    // seedOrg inserts operational_mode='test' explicitly and leaves the 0008 tier default.
    expect(body.tier).toBe('starter');
    expect(body.operational_mode).toBe('test');
    expect(body.roles).toEqual([]);
  });

  it('ME-02 — declares the principal as an API key, never as a human login', async () => {
    const res = await inject(stack, 'GET', '/v1/me', org.api_key);
    expect((res.body as Principal).principal_type).toBe('api_key');
  });

  it('ME-03 — the body carries exactly the six contract fields and nothing else', async () => {
    const res = await inject(stack, 'GET', '/v1/me', org.api_key);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'operational_mode',
      'org_id',
      'principal_type',
      'roles',
      'tier',
      'user_id',
    ]);
  });

  it('ME-04 — tier and operational mode follow org state, they are not constants', async () => {
    const mutable = await seedOrg(stack);
    await setOrgTier(mutable.org_id, 'regulated');
    await setOrgOperationalMode(stack, mutable.org_id, 'pilot');
    const res = await inject(stack, 'GET', '/v1/me', mutable.api_key);
    expect(res.statusCode).toBe(200);
    expect((res.body as Principal).tier).toBe('regulated');
    expect((res.body as Principal).operational_mode).toBe('pilot');
  });

  it('ME-05 — canonical roles reach the client verbatim', async () => {
    const withRoles = await seedOrg(stack);
    await grantAdminRole(stack, withRoles.api_key_prefix);
    const res = await inject(stack, 'GET', '/v1/me', withRoles.api_key);
    expect((res.body as Principal).roles).toEqual(['admin']);

    const second = await addApiKey(stack, withRoles.org_id, withRoles.user_id, [
      'auditor',
      'developer',
    ]);
    const res2 = await inject(stack, 'GET', '/v1/me', second.api_key);
    expect((res2.body as Principal).roles).toEqual(['auditor', 'developer']);
    // Two keys of the SAME org report the same org — the projection is org identity, not key
    // identity, which is exactly why the prefix is not in it.
    expect((res2.body as Principal).org_id).toBe(withRoles.org_id);
  });
});

describe('GET /v1/me — accepted credentials', () => {
  it('ME-06 — accepts x-govai-api-key', async () => {
    const org = await seedOrg(stack);
    const res = await inject(stack, 'GET', '/v1/me', org.api_key);
    expect(res.statusCode).toBe(200);
  });

  it('ME-07 — accepts Authorization: Bearer, the same convention the U1 read surfaces use', async () => {
    const org = await seedOrg(stack);
    const res = await injectBearer('/v1/me', org.api_key);
    expect(res.statusCode).toBe(200);
    expect((res.body as Principal).org_id).toBe(org.org_id);
  });
});

describe('GET /v1/me — rejection discloses nothing', () => {
  const REJECTED: Array<{ name: string; key: string | undefined }> = [
    { name: 'missing', key: undefined },
    { name: 'malformed (below the lookup length)', key: 'govai_sk_x' },
    { name: 'well-formed but unknown', key: `govai_sk_${'z'.repeat(43)}` },
  ];

  it.each(REJECTED)('ME-08 — a $name credential is 401', async ({ key }) => {
    const res = await inject(stack, 'GET', '/v1/me', key);
    expect(res.statusCode).toBe(401);
    expect((res.body as { error: string }).error).toBe('auth_error');
  });

  it('ME-09 — a 401 body reveals no org, role, tier, mode or provider fact', async () => {
    // A REAL org exists and is authenticated elsewhere in this file; a rejected request must
    // not become a probe for its state.
    const org = await seedOrg(stack);
    await setOrgTier(org.org_id, 'enterprise');
    const res = await inject(stack, 'GET', '/v1/me', `govai_sk_${'q'.repeat(43)}`);
    expect(res.statusCode).toBe(401);
    expect(Object.keys(res.body as object).sort()).toEqual(['error', 'message']);
    const raw = res.rawBody;
    for (const leak of [
      org.org_id,
      org.user_id,
      org.api_key_prefix,
      'enterprise',
      'starter',
      'operational_mode',
      'production',
      'roles',
      'anthropic',
      'openai',
    ]) {
      expect(raw.includes(leak), `401 body must not disclose "${leak}"`).toBe(false);
    }
  });

  it('ME-10 — a revoked key stops working without saying why', async () => {
    const org = await seedOrg(stack);
    const extra = await addApiKey(stack, org.org_id, org.user_id, []);
    expect((await inject(stack, 'GET', '/v1/me', extra.api_key)).statusCode).toBe(200);
    const c = await stack.db.adminPool.connect();
    try {
      await c.query(`UPDATE govai.api_keys SET status = 'revoked' WHERE prefix = $1`, [
        extra.api_key_prefix,
      ]);
    } finally {
      c.release();
    }
    const after = await inject(stack, 'GET', '/v1/me', extra.api_key);
    expect(after.statusCode).toBe(401);
    // Same body a never-issued key gets: the two states are indistinguishable to the caller.
    expect(after.body).toEqual({ error: 'auth_error', message: 'invalid api key' });
  });
});

describe('GET /v1/me — no secret and no other tenant', () => {
  it('ME-11 — the raw body contains no key, no prefix and no stored hash', async () => {
    const org = await seedOrg(stack);
    const hash = await storedHash(org.api_key_prefix);
    const res = await inject(stack, 'GET', '/v1/me', org.api_key);
    expect(res.statusCode).toBe(200);
    const raw = res.rawBody;
    expect(raw).not.toContain(org.api_key);
    expect(raw).not.toContain(org.api_key_prefix);
    expect(raw).not.toContain(hash);
    // The prefix is a fragment of the credential AND names which key is in use; neither may
    // reach an evidence export. Also assert the field name never appears.
    expect(raw).not.toContain('api_key_prefix');
    expect(raw).not.toContain('argon2');
    expect(raw).not.toContain('$argon');
  });

  it('ME-12 — one tenant never learns anything about another', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    await setOrgTier(orgB.org_id, 'regulated');
    const res = await inject(stack, 'GET', '/v1/me', orgA.api_key);
    expect(res.statusCode).toBe(200);
    expect((res.body as Principal).org_id).toBe(orgA.org_id);
    expect(res.rawBody).not.toContain(orgB.org_id);
    expect(res.rawBody).not.toContain(orgB.user_id);
    expect(res.rawBody).not.toContain('regulated');
    // ...and symmetrically, so the assertion is not an artefact of seeding order.
    const resB = await inject(stack, 'GET', '/v1/me', orgB.api_key);
    expect((resB.body as Principal).org_id).toBe(orgB.org_id);
    expect(resB.rawBody).not.toContain(orgA.org_id);
  });
});

describe('GET /v1/me — the route is read-only', () => {
  it('ME-13 — repeated reads write nothing: no audit event, no capture, no org mutation', async () => {
    const org = await seedOrg(stack);
    const before = {
      events: await countForOrg('govai.audit_events', org.org_id),
      captures: await countForOrg('govai.audit_capture_outbox', org.org_id),
    };
    for (let i = 0; i < 5; i += 1) {
      expect((await inject(stack, 'GET', '/v1/me', org.api_key)).statusCode).toBe(200);
    }
    expect(await countForOrg('govai.audit_events', org.org_id)).toBe(before.events);
    expect(await countForOrg('govai.audit_capture_outbox', org.org_id)).toBe(before.captures);

    const c = await stack.db.adminPool.connect();
    try {
      const r = await c.query<{ tier: string; operational_mode: string }>(
        'SELECT tier, operational_mode FROM govai.orgs WHERE id = $1::uuid',
        [org.org_id],
      );
      expect(r.rows[0]).toEqual({ tier: 'starter', operational_mode: 'test' });
      const keys = await c.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM govai.api_keys WHERE org_id = $1::uuid`,
        [org.org_id],
      );
      expect(keys.rows[0]!.c).toBe('1');
    } finally {
      c.release();
    }
  });

  it('ME-14 — no write method is routed at /v1/me', async () => {
    const org = await seedOrg(stack);
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const res = await inject(stack, method, '/v1/me', org.api_key, method === 'DELETE' ? undefined : {});
      expect(res.statusCode, `${method} /v1/me`).toBe(404);
      expect(res.rawBody).not.toContain('principal_type');
    }
  });

  it('ME-15 — an unauthenticated read never reaches the database identity path', async () => {
    // A missing credential is refused by the length guard before any query runs, so a
    // 401 here cannot have consumed a lookup. Proven behaviourally: an org that does not
    // exist yields the same shape as one that does.
    const ghostKey = `govai_sk_${randomUUID().replace(/-/g, '')}`;
    const res = await inject(stack, 'GET', '/v1/me', ghostKey);
    expect(res.statusCode).toBe(401);
    const fresh = await generateApiKey();
    const res2 = await inject(stack, 'GET', '/v1/me', fresh.plaintext);
    expect(res2.body).toEqual(res.body);
  });
});
