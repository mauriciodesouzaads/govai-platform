// M1 (Codex P2 on dd5ad03): a provider-credential lookup whose POOL ACQUISITION
// fails (database unavailable / pool exhausted) must surface as the same
// safe-by-construction MissingProviderKeyError as any other lookup failure —
// so the direct routes' stable 502 `provider_credential_unresolvable` contract
// (providerCredentialUnresolvableHttp) covers it instead of a raw 500.
import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import type { GovAIEnv } from '@govai/config';
import type { Kms } from '@govai/core-identity';
import {
  MissingProviderKeyError,
  providerCredentialUnresolvableHttp,
  resolveAnthropicProviderKey,
  resolveOpenAIProviderKey,
} from './provider-credentials.js';

class PoolDown extends Error {
  constructor() {
    super('connect ECONNREFUSED 127.0.0.1:5432');
    this.name = 'PoolAcquireError';
  }
}

const deps = {
  env: { NODE_ENV: 'test', GOVAI_PROVIDER_BASE_URL: 'http://127.0.0.1:1' } as unknown as GovAIEnv,
  pool: {
    connect: async () => {
      throw new PoolDown();
    },
  } as unknown as Pool,
  kms: {} as Kms,
};

describe('provider-credentials — pool acquisition failure is a wrapped lookup failure', () => {
  it('anthropic: pool.connect() rejection → MissingProviderKeyError(db_lookup_failed:<name>) → stable 502 shape, no raw error', async () => {
    let caught: unknown;
    try {
      await resolveAnthropicProviderKey(deps, { orgId: '00000000-0000-4000-8000-000000000001', operationalMode: 'production' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MissingProviderKeyError);
    const e = caught as MissingProviderKeyError;
    expect(e.provider).toBe('anthropic');
    expect(e.reason).toBe('db_lookup_failed:PoolAcquireError');
    // The route mapper recognises it → 502 provider_credential_unresolvable.
    expect(providerCredentialUnresolvableHttp(caught)).toEqual({
      statusCode: 502,
      org_id: '00000000-0000-4000-8000-000000000001',
      body: { error: 'provider_credential_unresolvable', provider: 'anthropic', reason: 'db_lookup_failed:PoolAcquireError' },
    });
    // No secret / raw connection string in the safe message.
    expect(e.message).not.toContain('5432');
  });

  it('openai: same contract', async () => {
    await expect(
      resolveOpenAIProviderKey(deps, { orgId: '00000000-0000-4000-8000-000000000002', operationalMode: 'pilot' }),
    ).rejects.toMatchObject({ name: 'MissingProviderKeyError', provider: 'openai', reason: 'db_lookup_failed:PoolAcquireError' });
  });

  it('the mapper returns null for any other error (delegated to the default handler)', () => {
    expect(providerCredentialUnresolvableHttp(new Error('boom'))).toBeNull();
    expect(providerCredentialUnresolvableHttp(undefined)).toBeNull();
  });
});
