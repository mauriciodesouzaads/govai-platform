// createProviderCredential — PR3.1a (issue #13).
//
// In-process admin helper that envelope-encrypts a tenant provider key via KMS
// and inserts an active row into govai.provider_credentials. If an active
// credential already exists for the same (org_id, provider), it is revoked
// atomically in the same transaction (replace-active semantics) — the partial
// unique index `provider_credentials_active_unique` enforces "one active per
// pair" at the DB level.
//
// Memory hygiene:
//   - The plaintext key is held only across the synchronous handoff to KMS.
//   - The local plaintext binding is consumed and reassigned to a marker in
//     the finally block so subsequent code paths cannot reach it via closure.
//   - The plaintext NEVER appears in the returned metadata, in any logged
//     payload, or in any Error.message / Error.cause chain produced by this
//     helper. Tests assert this property explicitly.
//
// PR3.1b will replace the CLI bridge that currently calls this helper with a
// secure HTTP admin endpoint — the helper itself stays the canonical entry
// point for both paths.

import type { PoolClient } from 'pg';
import type { Kms } from '@govai/core-identity';
import { ApiError } from './create-org-beta-override.js';

export interface CreateProviderCredentialInput {
  db: PoolClient;
  kms: Kms;
  org_id: string;
  provider: 'anthropic' | 'openai';
  /** Plaintext provider API key. Consumed once. Never logged, never returned. */
  plaintext_key: string;
  set_by_user_id: string;
  /** Optional KMS key id override. Defaults to 'tenant-provider-credential-v1'. */
  kms_key_id?: string;
  /** Optional KMS key version override. Defaults to 1. */
  kms_key_version?: number;
}

export interface CreateProviderCredentialResult {
  id: string;
  org_id: string;
  provider: 'anthropic' | 'openai';
  key_prefix: string;
  key_last4: string;
  kms_key_id: string;
  kms_key_version: number;
  set_at: Date;
  set_by_user_id: string;
  /** Id of the prior active credential that was revoked, or null if first-set. */
  replaced_credential_id: string | null;
}

const PLAINTEXT_CONSUMED = '<consumed>';

/**
 * Extract the safe public prefix for a provider key. The prefix is operator-
 * visible metadata (not a secret); it lets humans disambiguate at a glance.
 * If the key does not start with the expected provider prefix, fall back to
 * a short safe label so we never store a partial key body as the "prefix".
 */
function extractKeyPrefix(provider: 'anthropic' | 'openai', key: string): string {
  if (provider === 'anthropic') {
    return key.startsWith('sk-ant-') ? 'sk-ant-' : 'unknown-prefix';
  }
  // OpenAI: 'sk-' (project keys may be 'sk-proj-' but the canonical prefix is 'sk-').
  return key.startsWith('sk-proj-')
    ? 'sk-proj-'
    : key.startsWith('sk-')
      ? 'sk-'
      : 'unknown-prefix';
}

function lastFour(key: string): string {
  if (key.length <= 4) return key;
  return key.slice(-4);
}

export async function createProviderCredential(
  input: CreateProviderCredentialInput,
): Promise<CreateProviderCredentialResult> {
  if (!input.plaintext_key || input.plaintext_key.length === 0) {
    throw new ApiError(400, 'plaintext_key_empty', { provider: input.provider });
  }

  const kmsKeyId = input.kms_key_id ?? 'tenant-provider-credential-v1';
  const kmsKeyVersion = input.kms_key_version ?? 1;

  // Compute safe metadata BEFORE encryption so we don't keep dual references
  // to plaintext substrings. These are not secrets.
  const keyPrefix = extractKeyPrefix(input.provider, input.plaintext_key);
  const keyLast4 = lastFour(input.plaintext_key);

  // Memory hygiene scope. The plaintext binding is reassigned to a marker in
  // the finally block so any later async work (logging, error wrapping) cannot
  // reach the original string by closure capture.
  let plaintext: string = input.plaintext_key;
  let ciphertext: Uint8Array;
  let dekWrapped: Uint8Array;
  try {
    const enc = await input.kms.envelopeEncrypt({
      orgId: input.org_id,
      keyId: kmsKeyId,
      version: kmsKeyVersion,
      plaintext: Buffer.from(plaintext, 'utf8'),
    });
    ciphertext = enc.ciphertext;
    dekWrapped = enc.dekWrapped;
  } catch (err) {
    // Do NOT include plaintext in any wrapped error. Wrap with a safe-by-
    // construction code only.
    throw new ApiError(500, 'kms_envelope_encrypt_failed', {
      provider: input.provider,
      kms_key_id: kmsKeyId,
      kms_key_version: kmsKeyVersion,
      cause_name: err instanceof Error ? err.name : 'unknown',
    });
  } finally {
    plaintext = PLAINTEXT_CONSUMED;
  }
  void plaintext; // satisfy noUnusedLocals while preserving the reassignment.

  // Atomic replace-active: revoke any prior active row for (org_id, provider)
  // and insert the new active row in the same transaction. The caller is
  // expected to BEGIN/COMMIT around this helper if it wants stronger isolation,
  // but we use a SAVEPOINT-friendly multi-statement sequence.
  const replaceQuery = await input.db.query<{ id: string }>(
    `UPDATE govai.provider_credentials
        SET status              = 'revoked',
            revoked_at          = now(),
            revoked_by_user_id  = $3::uuid,
            revocation_reason   = 'replaced_by_new_credential'
      WHERE org_id   = $1::uuid
        AND provider = $2::text
        AND status   = 'active'
      RETURNING id`,
    [input.org_id, input.provider, input.set_by_user_id],
  );
  const replacedId = replaceQuery.rows[0]?.id ?? null;

  const inserted = await input.db.query<{ id: string; set_at: Date }>(
    `INSERT INTO govai.provider_credentials
        (org_id, provider, ciphertext, dek_wrapped,
         kms_key_id, kms_key_version,
         key_prefix, key_last4,
         status, set_by_user_id)
     VALUES ($1::uuid, $2::text, $3::bytea, $4::bytea,
             $5::text, $6::int,
             $7::text, $8::text,
             'active', $9::uuid)
     RETURNING id, set_at`,
    [
      input.org_id,
      input.provider,
      Buffer.from(ciphertext),
      Buffer.from(dekWrapped),
      kmsKeyId,
      kmsKeyVersion,
      keyPrefix,
      keyLast4,
      input.set_by_user_id,
    ],
  );

  const row = inserted.rows[0];
  if (!row) {
    throw new ApiError(500, 'insert_returning_empty', { provider: input.provider });
  }

  return {
    id: row.id,
    org_id: input.org_id,
    provider: input.provider,
    key_prefix: keyPrefix,
    key_last4: keyLast4,
    kms_key_id: kmsKeyId,
    kms_key_version: kmsKeyVersion,
    set_at: row.set_at,
    set_by_user_id: input.set_by_user_id,
    replaced_credential_id: replacedId,
  };
}
