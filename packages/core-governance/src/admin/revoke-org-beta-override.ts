// revokeOrgBetaOverride — Matrix §5.4. UPDATE setting revoked_at. The RLS
// policy on UPDATE requires revoked_at IS NOT NULL; passing null here would be
// rejected by WITH CHECK at the DB level.

import type { PoolClient } from 'pg';
import { ApiError } from './create-org-beta-override.js';

export interface RevokeOrgBetaOverrideInput {
  override_id: string;
  org_id: string;
  revoked_by_user_id: string;
  db: PoolClient;
}

export async function revokeOrgBetaOverride(input: RevokeOrgBetaOverrideInput): Promise<{
  override_id: string;
  revoked_at: Date;
}> {
  const result = await input.db.query<{ id: string; revoked_at: Date }>(
    `UPDATE govai.org_beta_overrides
       SET revoked_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND revoked_at IS NULL
     RETURNING id, revoked_at`,
    [input.override_id, input.org_id],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, 'override_not_found_or_already_revoked', {
      override_id: input.override_id,
    });
  }
  return { override_id: row.id, revoked_at: row.revoked_at };
}
