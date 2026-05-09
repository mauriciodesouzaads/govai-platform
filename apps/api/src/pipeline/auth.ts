// Auth pipeline step. API key path is the focus of runtime-patch-1.
// JWT path is wired but exercised via different middleware (out of scope here).
//
// HAE-004 / Batch G realignment: AuthIdentity now carries `tier` and
// `operational_mode` resolved from `govai.orgs`. These values flow into
// passthrough.invoked v3 audit events and into computeEnforcement so that
// no governance field is ever hardcoded at runtime.

import type { PoolClient } from 'pg';
import { lookupPrefix, verifyApiKey } from '@govai/core-identity';

export type Tier = 'starter' | 'business' | 'enterprise' | 'regulated';
export type OperationalMode = 'production' | 'pilot' | 'dev' | 'test';

export type AuthIdentity = {
  org_id: string;
  user_id: string;
  api_key_prefix: string;
  tier: Tier;
  operational_mode: OperationalMode;
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
  // HAE-004: resolve tier + operational_mode from govai.orgs (HAE-004 added
  // these columns with defaults `starter` / `pilot`). The lookup runs through
  // a SECURITY DEFINER helper so RLS does not require a tenant context yet —
  // we are still resolving identity at this point.
  const orgRow = await client.query<{ tier: Tier; operational_mode: OperationalMode }>(
    'SELECT * FROM govai.org_tier_lookup($1::uuid)',
    [row.org_id],
  );
  if (orgRow.rows.length !== 1) {
    throw new AuthError('org_tier_lookup returned no row for authenticated org', 500);
  }
  const orgTier = orgRow.rows[0]!;
  return {
    org_id: row.org_id,
    user_id: row.user_id,
    api_key_prefix: row.prefix,
    tier: orgTier.tier,
    operational_mode: orgTier.operational_mode,
  };
}
