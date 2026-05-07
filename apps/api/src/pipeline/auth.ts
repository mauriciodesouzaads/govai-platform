// Auth pipeline step. API key path is the focus of runtime-patch-1.
// JWT path is wired but exercised via different middleware (out of scope here).

import type { PoolClient } from 'pg';
import { lookupPrefix, verifyApiKey } from '@govai/core-identity';

export type AuthIdentity = {
  org_id: string;
  user_id: string;
  api_key_prefix: string;
};

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function authenticateApiKey(
  client: PoolClient,
  rawKey: string | undefined,
): Promise<AuthIdentity> {
  if (!rawKey || rawKey.length < 16) {
    throw new AuthError('missing or malformed api key', 401);
  }
  const prefix = lookupPrefix(rawKey);
  const lookup = await client.query<{
    prefix: string;
    hash: string;
    org_id: string;
    user_id: string;
    status: string;
  }>('SELECT * FROM govai.api_key_lookup($1)', [prefix]);
  const row = lookup.rows[0];
  if (!row) {
    throw new AuthError('invalid api key', 401);
  }
  const ok = await verifyApiKey(rawKey, row.hash);
  if (!ok) {
    throw new AuthError('invalid api key', 401);
  }
  return { org_id: row.org_id, user_id: row.user_id, api_key_prefix: row.prefix };
}
