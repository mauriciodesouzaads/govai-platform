// Provider credential resolution — PR3.1a Checkpoint 2 (issue #13).
//
// Tenant-scoped resolver. Looks up an active credential row in
// govai.provider_credentials, decrypts via KMS envelope, and returns the
// plaintext only in memory. Falls back to the platform env key ONLY in
// `dev` operational mode, and to a hermetic placeholder ONLY in
// NODE_ENV='test' AND loopback baseUrl. In `production` and `pilot` the
// resolver fails closed when no tenant credential exists, regardless of
// whether platform env keys are set.
//
// Memory hygiene:
// - The plaintext is held only across the synchronous handoff to the caller.
// - No log path emits the plaintext.
// - The thrown MissingProviderKeyError carries only safe metadata
//   (provider, org id, reason); plaintext NEVER appears in the error message,
//   stack, or cause chain.
// - The DB row is never logged or stringified into errors.
//
// Fallback matrix (executable spec lives in
// tests/integration/provider-credentials-operational-mode-matrix.test.ts):
//
//   tenant credential present         → tenant credential (always wins)
//   production + no tenant            → THROW (no env fallback)
//   pilot + no tenant                 → THROW (no env fallback)
//   dev + no tenant + env present     → env key
//   dev + no tenant + no env          → THROW
//   test + loopback + no tenant + env → env key
//   test + loopback + no tenant + ø   → hermetic placeholder
//   test + non-loopback + no tenant + env → env key
//   test + non-loopback + no tenant + ø  → THROW

import type { Pool } from 'pg';
import type { GovAIEnv } from '@govai/config';
import type { Kms } from '@govai/core-identity';
import { setLocalAppOrgId } from '@govai/core-tenant';
import type { ResolvedProviderCredential } from '@govai/core-types';
import { isLoopbackUrl } from './capability-resolution.js';
import type { OperationalMode } from './auth.js';

export type ProviderName = 'anthropic' | 'openai';

export interface ProviderCredentialResolverDeps {
  env: GovAIEnv;
  pool: Pool;
  kms: Kms;
}

export interface ProviderCredentialResolverContext {
  orgId: string;
  operationalMode: OperationalMode;
}

export class MissingProviderKeyError extends Error {
  public readonly provider: ProviderName;
  public readonly org_id: string;
  public readonly reason: string;
  constructor(provider: ProviderName, orgId: string, reason: string) {
    // The message intentionally omits any credential body; only safe metadata.
    super(
      `provider credential not resolvable for provider=${provider} org_id=${orgId} reason=${reason}`,
    );
    this.name = 'MissingProviderKeyError';
    this.provider = provider;
    this.org_id = orgId;
    this.reason = reason;
  }
}

/**
 * Foundation V1 M1 (FB-4 §11.5): the stable HTTP contract for a DIRECT provider
 * route (/passthrough/*, /governed/*) whose tenant credential could not be
 * resolved (missing in production/pilot, revoked, KMS-undecryptable, lookup
 * failure). Mirrors the mapping /v1/runs already applies (routes/runs.ts):
 * 502 `provider_credential_unresolvable` with ONLY safe metadata — provider +
 * bounded reason code — never a secret, never an unshaped 500. Returns null for
 * any other error so the caller delegates to the default handler unchanged.
 * Zero provider calls happen on this path (the resolver runs before dispatch).
 */
export function providerCredentialUnresolvableHttp(err: unknown): {
  statusCode: 502;
  org_id: string;
  body: { error: 'provider_credential_unresolvable'; provider: ProviderName; reason: string };
} | null {
  if (!(err instanceof MissingProviderKeyError)) return null;
  return {
    statusCode: 502,
    org_id: err.org_id,
    body: { error: 'provider_credential_unresolvable', provider: err.provider, reason: err.reason },
  };
}

const HERMETIC_ANTHROPIC = 'sk-ant-test-hermetic';
const HERMETIC_OPENAI = 'sk-openai-test-hermetic';

function isHermetic(env: GovAIEnv): boolean {
  if (env.NODE_ENV !== 'test') return false;
  const baseUrl = env.GOVAI_PROVIDER_BASE_URL ?? '';
  return isLoopbackUrl(baseUrl);
}

interface CredentialRow {
  ciphertext: Buffer;
  dek_wrapped: Buffer;
  kms_key_id: string;
  kms_key_version: number;
}

/**
 * Look up the active provider credential for (orgId, provider). Returns null if
 * no active row exists. Decrypts and returns the plaintext otherwise.
 */
async function tryLoadTenantKey(
  deps: ProviderCredentialResolverDeps,
  orgId: string,
  provider: ProviderName,
): Promise<string | null> {
  const client = await deps.pool.connect();
  let row: CredentialRow | null = null;
  try {
    await client.query('BEGIN');
    await setLocalAppOrgId(client, orgId);
    const result = await client.query<CredentialRow>(
      `SELECT ciphertext, dek_wrapped, kms_key_id, kms_key_version
         FROM govai.provider_credentials
        WHERE org_id   = $1::uuid
          AND provider = $2::text
          AND status   = 'active'
        LIMIT 1`,
      [orgId, provider],
    );
    row = result.rows[0] ?? null;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    // Wrap with a safe-by-construction code; do not pass row content.
    throw new MissingProviderKeyError(
      provider,
      orgId,
      `db_lookup_failed:${err instanceof Error ? err.name : 'unknown'}`,
    );
  } finally {
    client.release();
  }
  if (!row) return null;
  try {
    const plaintextBytes = await deps.kms.envelopeDecrypt({
      orgId,
      keyId: row.kms_key_id,
      version: row.kms_key_version,
      ciphertext: new Uint8Array(row.ciphertext),
      dekWrapped: new Uint8Array(row.dek_wrapped),
    });
    return Buffer.from(plaintextBytes).toString('utf8');
  } catch (err) {
    throw new MissingProviderKeyError(
      provider,
      orgId,
      `kms_decrypt_failed:${err instanceof Error ? err.name : 'unknown'}`,
    );
  }
}

// F1: the resolver returns the resolved key PLUS the provenance of which path
// won (`source`). The source is tagged at the exact decision point that
// chooses the credential — never re-derived downstream. The precedence matrix
// itself is UNCHANGED (tenant always wins; production/pilot fail closed; dev
// env-only where it already was; test/hermetic per the existing matrix).
async function resolveProviderKey(
  deps: ProviderCredentialResolverDeps,
  ctx: ProviderCredentialResolverContext,
  provider: ProviderName,
  envKey: string | undefined,
  hermeticPlaceholder: string,
): Promise<ResolvedProviderCredential> {
  // Tenant credential always wins.
  const tenant = await tryLoadTenantKey(deps, ctx.orgId, provider);
  if (tenant) return { apiKey: tenant, source: 'tenant_provider_credential' };

  // No tenant credential — apply the operational-mode matrix.
  const mode = ctx.operationalMode;

  if (mode === 'production' || mode === 'pilot') {
    throw new MissingProviderKeyError(
      provider,
      ctx.orgId,
      `no_tenant_credential_in_${mode}_mode`,
    );
  }

  if (mode === 'dev') {
    if (envKey && envKey.length > 0) return { apiKey: envKey, source: 'platform_env' };
    throw new MissingProviderKeyError(
      provider,
      ctx.orgId,
      'no_tenant_credential_no_env_in_dev_mode',
    );
  }

  // mode === 'test'
  if (envKey && envKey.length > 0) return { apiKey: envKey, source: 'platform_env' };
  if (isHermetic(deps.env)) {
    return { apiKey: hermeticPlaceholder, source: 'hermetic_test_placeholder' };
  }
  throw new MissingProviderKeyError(
    provider,
    ctx.orgId,
    'no_tenant_credential_no_env_test_non_loopback',
  );
}

export async function resolveAnthropicProviderKey(
  deps: ProviderCredentialResolverDeps,
  ctx: ProviderCredentialResolverContext,
): Promise<ResolvedProviderCredential> {
  return resolveProviderKey(deps, ctx, 'anthropic', deps.env.ANTHROPIC_API_KEY, HERMETIC_ANTHROPIC);
}

export async function resolveOpenAIProviderKey(
  deps: ProviderCredentialResolverDeps,
  ctx: ProviderCredentialResolverContext,
): Promise<ResolvedProviderCredential> {
  return resolveProviderKey(deps, ctx, 'openai', deps.env.OPENAI_API_KEY, HERMETIC_OPENAI);
}
