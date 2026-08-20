// Unit tests for authenticateApiKey — EP-UIUX-V1-B2 §10.7.
//
// `GET /v1/me` is the first surface that SERIALIZES `AuthIdentity.roles` to a client, so the
// defensive filter at auth.ts:68-71 stops being an internal safety net and becomes part of a
// published contract. That filter cannot be exercised end-to-end: migration 0010's
// `api_keys_roles_allowlist_chk` refuses to store a non-canonical role, and dropping the
// constraint inside a test would mutate the schema to prove a point. So the filter is proven
// HERE, at the only layer where a non-canonical value can actually be presented to it — a
// stubbed `PoolClient` standing in for a future migration that relaxed the CHECK.
//
// The real argon2 hash is used deliberately: a stub that also stubbed `verifyApiKey` would
// prove nothing about the path a request takes.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResult } from 'pg';
import { generateApiKey, ALL_ROLES } from '@govai/core-identity';
import { authenticateApiKey, AuthError } from './auth.js';

type LookupRow = {
  prefix: string;
  hash: string;
  org_id: string;
  user_id: string;
  status: string;
  roles: string[] | null;
};

/**
 * A two-query stand-in for the pooled client: `api_key_lookup_v2` first, then
 * `org_tier_lookup`. It answers by matching the SQL text the production code sends, so a
 * future reordering of those calls surfaces here rather than silently passing.
 */
function stubClient(opts: {
  lookup: LookupRow[];
  tier?: Array<{ tier: string; operational_mode: string }>;
}): PoolClient {
  const tier = opts.tier ?? [{ tier: 'starter', operational_mode: 'production' }];
  const client = {
    query(text: string): Promise<QueryResult> {
      const rows = text.includes('api_key_lookup_v2') ? opts.lookup : tier;
      return Promise.resolve({
        rows,
        rowCount: rows.length,
        command: 'SELECT',
        oid: 0,
        fields: [],
      } as unknown as QueryResult);
    },
  };
  return client as unknown as PoolClient;
}

async function activeRow(roles: string[] | null): Promise<{ key: string; row: LookupRow }> {
  const key = await generateApiKey();
  return {
    key: key.plaintext,
    row: {
      prefix: key.prefix,
      hash: key.hash,
      org_id: randomUUID(),
      user_id: randomUUID(),
      status: 'active',
      roles,
    },
  };
}

describe('authenticateApiKey — the defensive role filter', () => {
  it('drops a role that is not in the canonical enum, and keeps the ones that are', async () => {
    const { key, row } = await activeRow(['admin', 'root', 'auditor', 'superuser']);
    const identity = await authenticateApiKey(stubClient({ lookup: [row] }), key);
    expect(identity.roles).toEqual(['admin', 'auditor']);
  });

  it('never grants a privilege the caller did not have: an all-unknown array becomes empty', async () => {
    const { key, row } = await activeRow(['owner', 'ADMIN', 'admin ']);
    const identity = await authenticateApiKey(stubClient({ lookup: [row] }), key);
    // Case and whitespace are NOT normalized — a near-miss is an unknown role, not `admin`.
    expect(identity.roles).toEqual([]);
  });

  it('treats a null roles column (a pre-PR3.1b key) as no special grants', async () => {
    const { key, row } = await activeRow(null);
    const identity = await authenticateApiKey(stubClient({ lookup: [row] }), key);
    expect(identity.roles).toEqual([]);
  });

  it('accepts every canonical role, so the filter cannot silently narrow the enum', async () => {
    const { key, row } = await activeRow([...ALL_ROLES]);
    const identity = await authenticateApiKey(stubClient({ lookup: [row] }), key);
    expect(identity.roles).toEqual([...ALL_ROLES]);
  });
});

describe('authenticateApiKey — rejection paths', () => {
  it('rejects a missing key before it queries anything', async () => {
    await expect(authenticateApiKey(stubClient({ lookup: [] }), undefined)).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it('rejects a key shorter than the lookup prefix', async () => {
    await expect(authenticateApiKey(stubClient({ lookup: [] }), 'govai_sk_x')).rejects.toThrow(
      /missing or malformed api key/,
    );
  });

  it('rejects an unknown prefix', async () => {
    const { key } = await activeRow([]);
    await expect(authenticateApiKey(stubClient({ lookup: [] }), key)).rejects.toThrow(
      /invalid api key/,
    );
  });

  it('rejects a known prefix whose hash does not verify', async () => {
    const { row } = await activeRow([]);
    const other = await generateApiKey();
    // The stored row is looked up by prefix, but the presented secret is a different key.
    await expect(
      authenticateApiKey(stubClient({ lookup: [{ ...row, prefix: other.prefix }] }), other.plaintext),
    ).rejects.toThrow(/invalid api key/);
  });

  it('fails loudly (500) when the org row behind an authenticated key is missing', async () => {
    const { key, row } = await activeRow([]);
    const err = await authenticateApiKey(stubClient({ lookup: [row], tier: [] }), key).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).status).toBe(500);
  });
});

describe('authenticateApiKey — the projection /v1/me serializes', () => {
  it('carries org, user, tier and operational mode straight from the two lookups', async () => {
    const { key, row } = await activeRow(['developer']);
    const identity = await authenticateApiKey(
      stubClient({ lookup: [row], tier: [{ tier: 'enterprise', operational_mode: 'pilot' }] }),
      key,
    );
    expect(identity.org_id).toBe(row.org_id);
    expect(identity.user_id).toBe(row.user_id);
    expect(identity.tier).toBe('enterprise');
    expect(identity.operational_mode).toBe('pilot');
    expect(identity.roles).toEqual(['developer']);
    // The prefix IS on AuthIdentity — and is deliberately not projected by /v1/me.
    expect(identity.api_key_prefix).toBe(row.prefix);
  });
});
