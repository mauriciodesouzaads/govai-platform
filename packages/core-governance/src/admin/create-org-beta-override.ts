// createOrgBetaOverride — Peça A v2 §6.3.6, Matrix §4.3 / §5.4.
// Refuses tokens with policy='hard_denied' before any DB INSERT. The DB has no
// such CHECK because the policy table is application-layer; the constraint must
// be enforced here. Other failures bubble up as ApiError 403/400.

import type { PoolClient } from 'pg';
import type { BetaTokenPolicyEntry } from '@govai/core-types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(`${code}${details ? ': ' + JSON.stringify(details) : ''}`);
    this.name = 'ApiError';
  }
}

export interface CreateOrgBetaOverrideInput {
  org_id: string;
  provider: 'anthropic' | 'openai';
  beta_token: string;
  reason: string;
  set_by_user_id: string;
  expires_at: Date;
  policy_table: ReadonlyArray<BetaTokenPolicyEntry>;
  db: PoolClient;
}

export async function createOrgBetaOverride(input: CreateOrgBetaOverrideInput): Promise<{
  id: string;
  set_at: Date;
}> {
  const entry = input.policy_table.find((e) => e.beta_token === input.beta_token);

  if (!entry) {
    throw new ApiError(403, 'unknown_beta_token', { beta_token: input.beta_token });
  }

  if (entry.policy === 'hard_denied') {
    throw new ApiError(403, 'beta_token_hard_denied', {
      message:
        'This beta token cannot be enabled by org override; requires PR + ADR.',
      beta_token: input.beta_token,
    });
  }

  // CHECK constraint impede expires_at retroativo no DB level. We also reject early
  // for clearer error path.
  if (input.expires_at.getTime() <= Date.now()) {
    throw new ApiError(400, 'expires_at_not_in_future', {
      expires_at: input.expires_at.toISOString(),
    });
  }

  const result = await input.db.query<{ id: string; set_at: Date }>(
    `INSERT INTO govai.org_beta_overrides
       (org_id, provider, beta_token, reason, set_by_user_id, expires_at)
     VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::uuid, $6::timestamptz)
     RETURNING id, set_at`,
    [
      input.org_id,
      input.provider,
      input.beta_token,
      input.reason,
      input.set_by_user_id,
      input.expires_at.toISOString(),
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(500, 'insert_returning_empty');
  }
  return { id: row.id, set_at: row.set_at };
}
