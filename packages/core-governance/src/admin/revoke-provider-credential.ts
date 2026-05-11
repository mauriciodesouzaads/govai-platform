// revokeProviderCredential — PR3.1a (issue #13).
//
// UPDATE-only revocation (status='revoked'). The DB has no DELETE policy and a
// trigger blocks DELETE from any path. Returns metadata only; never plaintext.
//
// Resolution by id (preferred for HTTP admin path) OR by (org_id, provider)
// targeting the currently active row (used by the rotation path inside
// createProviderCredential when the caller wants explicit revocation without
// a known id). The id form is exposed; the (org_id, provider) form is the
// internal helper used by tests.

import type { PoolClient } from 'pg';
import { ApiError } from './create-org-beta-override.js';

export interface RevokeProviderCredentialInput {
  db: PoolClient;
  /** Either the credential id OR the (org_id, provider) pair targeting the active row. */
  credential_id?: string;
  org_id: string;
  provider?: 'anthropic' | 'openai';
  revoked_by_user_id: string;
  revocation_reason: string;
}

export interface RevokeProviderCredentialResult {
  credential_id: string;
  org_id: string;
  provider: 'anthropic' | 'openai';
  key_prefix: string;
  key_last4: string;
  revoked_at: Date;
  revoked_by_user_id: string;
  revocation_reason: string;
}

export async function revokeProviderCredential(
  input: RevokeProviderCredentialInput,
): Promise<RevokeProviderCredentialResult> {
  if (!input.revocation_reason || input.revocation_reason.length === 0) {
    throw new ApiError(400, 'revocation_reason_required', {});
  }

  let result;
  if (input.credential_id) {
    result = await input.db.query<{
      id: string;
      org_id: string;
      provider: 'anthropic' | 'openai';
      key_prefix: string;
      key_last4: string;
      revoked_at: Date;
    }>(
      `UPDATE govai.provider_credentials
          SET status              = 'revoked',
              revoked_at          = now(),
              revoked_by_user_id  = $3::uuid,
              revocation_reason   = $4::text
        WHERE id      = $1::uuid
          AND org_id  = $2::uuid
          AND status  = 'active'
        RETURNING id, org_id, provider, key_prefix, key_last4, revoked_at`,
      [input.credential_id, input.org_id, input.revoked_by_user_id, input.revocation_reason],
    );
  } else {
    if (!input.provider) {
      throw new ApiError(400, 'credential_id_or_provider_required', {});
    }
    result = await input.db.query<{
      id: string;
      org_id: string;
      provider: 'anthropic' | 'openai';
      key_prefix: string;
      key_last4: string;
      revoked_at: Date;
    }>(
      `UPDATE govai.provider_credentials
          SET status              = 'revoked',
              revoked_at          = now(),
              revoked_by_user_id  = $3::uuid,
              revocation_reason   = $4::text
        WHERE org_id   = $1::uuid
          AND provider = $2::text
          AND status   = 'active'
        RETURNING id, org_id, provider, key_prefix, key_last4, revoked_at`,
      [input.org_id, input.provider, input.revoked_by_user_id, input.revocation_reason],
    );
  }

  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, 'credential_not_found_or_already_revoked', {
      credential_id: input.credential_id ?? null,
      provider: input.provider ?? null,
    });
  }
  return {
    credential_id: row.id,
    org_id: row.org_id,
    provider: row.provider,
    key_prefix: row.key_prefix,
    key_last4: row.key_last4,
    revoked_at: row.revoked_at,
    revoked_by_user_id: input.revoked_by_user_id,
    revocation_reason: input.revocation_reason,
  };
}
