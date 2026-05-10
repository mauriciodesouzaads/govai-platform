// Unit tests for revokeProviderCredential.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { revokeProviderCredential } from './revoke-provider-credential.js';
import { ApiError } from './create-org-beta-override.js';

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

function makeStub(rows: Array<Record<string, unknown>>) {
  const captured: CapturedQuery[] = [];
  const client = {
    query: async (sql: string, params: unknown[]) => {
      captured.push({ sql, params });
      return { rows };
    },
  } as unknown as Parameters<typeof revokeProviderCredential>[0]['db'];
  return { client, captured };
}

describe('revokeProviderCredential', () => {
  it('by credential_id: returns metadata when row updated', async () => {
    const credentialId = randomUUID();
    const orgId = randomUUID();
    const userId = randomUUID();
    const now = new Date();
    const { client, captured } = makeStub([
      {
        id: credentialId,
        org_id: orgId,
        provider: 'anthropic',
        key_prefix: 'sk-ant-',
        key_last4: 'ab12',
        revoked_at: now,
      },
    ]);
    const result = await revokeProviderCredential({
      db: client,
      credential_id: credentialId,
      org_id: orgId,
      revoked_by_user_id: userId,
      revocation_reason: 'rotated',
    });
    expect(result.credential_id).toBe(credentialId);
    expect(result.org_id).toBe(orgId);
    expect(result.provider).toBe('anthropic');
    expect(result.key_prefix).toBe('sk-ant-');
    expect(result.key_last4).toBe('ab12');
    expect(result.revoked_at).toBe(now);
    expect(result.revoked_by_user_id).toBe(userId);
    expect(result.revocation_reason).toBe('rotated');
    expect(captured[0]!.sql).toContain('UPDATE govai.provider_credentials');
    expect(captured[0]!.sql).toContain("status              = 'revoked'");
    expect(captured[0]!.sql).toContain('id      = $1::uuid');
  });

  it('by (org_id, provider): targets active row', async () => {
    const credentialId = randomUUID();
    const orgId = randomUUID();
    const { client, captured } = makeStub([
      {
        id: credentialId,
        org_id: orgId,
        provider: 'openai',
        key_prefix: 'sk-',
        key_last4: 'wxyz',
        revoked_at: new Date(),
      },
    ]);
    await revokeProviderCredential({
      db: client,
      org_id: orgId,
      provider: 'openai',
      revoked_by_user_id: randomUUID(),
      revocation_reason: 'compromised',
    });
    expect(captured[0]!.sql).toContain('org_id   = $1::uuid');
    expect(captured[0]!.sql).toContain('provider = $2::text');
    expect(captured[0]!.sql).toContain("status   = 'active'");
  });

  it('no row updated → 404 credential_not_found_or_already_revoked', async () => {
    const { client } = makeStub([]);
    let captured: Error | null = null;
    try {
      await revokeProviderCredential({
        db: client,
        credential_id: randomUUID(),
        org_id: randomUUID(),
        revoked_by_user_id: randomUUID(),
        revocation_reason: 'rotated',
      });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).status).toBe(404);
    expect((captured as ApiError).code).toBe('credential_not_found_or_already_revoked');
  });

  it('empty revocation_reason → 400', async () => {
    const { client } = makeStub([]);
    let captured: Error | null = null;
    try {
      await revokeProviderCredential({
        db: client,
        credential_id: randomUUID(),
        org_id: randomUUID(),
        revoked_by_user_id: randomUUID(),
        revocation_reason: '',
      });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).status).toBe(400);
    expect((captured as ApiError).code).toBe('revocation_reason_required');
  });

  it('neither credential_id nor provider → 400', async () => {
    const { client } = makeStub([]);
    let captured: Error | null = null;
    try {
      await revokeProviderCredential({
        db: client,
        org_id: randomUUID(),
        revoked_by_user_id: randomUUID(),
        revocation_reason: 'rotated',
      });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).status).toBe(400);
    expect((captured as ApiError).code).toBe('credential_id_or_provider_required');
  });
});
