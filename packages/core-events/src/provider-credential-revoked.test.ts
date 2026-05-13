// Smoke tests for ProviderCredentialRevokedSchema v1.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ProviderCredentialRevokedSchema } from './provider-credential-revoked.js';

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'provider_credential.revoked',
    schema_version: 1,
    tenant_context: {
      org_id: randomUUID(),
      tier: 'enterprise',
      operational_mode: 'production',
    },
    provider: 'anthropic',
    credential_id: randomUUID(),
    key_prefix: 'sk-ant-',
    key_last4: 'ab12',
    revoked_at: new Date().toISOString(),
    revoked_by_user_id: randomUUID(),
    revocation_reason: 'rotated',
    audit_event_id: randomUUID(),
    chain_category: 'admin',
    ...overrides,
  };
}

describe('ProviderCredentialRevokedSchema v1', () => {
  it('canonical event accepts', () => {
    expect(ProviderCredentialRevokedSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('event_type wrong → rejects', () => {
    expect(
      ProviderCredentialRevokedSchema.safeParse(
        baseEvent({ event_type: 'provider_credential.set' }),
      ).success,
    ).toBe(false);
  });

  it('schema_version other than 1 → rejects', () => {
    expect(
      ProviderCredentialRevokedSchema.safeParse(baseEvent({ schema_version: 0 })).success,
    ).toBe(false);
  });

  it('missing required field revoked_at → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['revoked_at'];
    expect(ProviderCredentialRevokedSchema.safeParse(ev).success).toBe(false);
  });

  it('missing required field revoked_by_user_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['revoked_by_user_id'];
    expect(ProviderCredentialRevokedSchema.safeParse(ev).success).toBe(false);
  });

  it('missing required field revocation_reason → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['revocation_reason'];
    expect(ProviderCredentialRevokedSchema.safeParse(ev).success).toBe(false);
  });

  it('non-ISO revoked_at → rejects', () => {
    expect(
      ProviderCredentialRevokedSchema.safeParse(baseEvent({ revoked_at: 'last week' }))
        .success,
    ).toBe(false);
  });

  it('chain_category locked to admin', () => {
    expect(
      ProviderCredentialRevokedSchema.safeParse(baseEvent({ chain_category: 'run' })).success,
    ).toBe(false);
  });

  it('provider outside enum → rejects', () => {
    expect(
      ProviderCredentialRevokedSchema.safeParse(baseEvent({ provider: 'cohere' })).success,
    ).toBe(false);
  });

  it('non-uuid credential_id → rejects', () => {
    expect(
      ProviderCredentialRevokedSchema.safeParse(
        baseEvent({ credential_id: 'not-a-uuid' }),
      ).success,
    ).toBe(false);
  });

  it('non-uuid revoked_by_user_id → rejects', () => {
    expect(
      ProviderCredentialRevokedSchema.safeParse(
        baseEvent({ revoked_by_user_id: 'not-a-uuid' }),
      ).success,
    ).toBe(false);
  });
});
