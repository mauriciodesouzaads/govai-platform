// Smoke tests for ProviderCredentialSetSchema v1.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ProviderCredentialSetSchema } from './provider-credential-set.js';

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'provider_credential.set',
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
    kms_key_id: 'tenant-provider-credential-v1',
    kms_key_version: 1,
    set_by_user_id: randomUUID(),
    set_at: new Date().toISOString(),
    replaced_credential_id: null,
    audit_event_id: randomUUID(),
    chain_category: 'admin',
    ...overrides,
  };
}

describe('ProviderCredentialSetSchema v1', () => {
  it('canonical event accepts', () => {
    expect(ProviderCredentialSetSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('replaced_credential_id may be a uuid (rotation event)', () => {
    expect(
      ProviderCredentialSetSchema.safeParse(
        baseEvent({ replaced_credential_id: randomUUID() }),
      ).success,
    ).toBe(true);
  });

  it('event_type wrong → rejects', () => {
    expect(
      ProviderCredentialSetSchema.safeParse(
        baseEvent({ event_type: 'provider_credential.revoked' }),
      ).success,
    ).toBe(false);
  });

  it('schema_version other than 1 → rejects', () => {
    expect(
      ProviderCredentialSetSchema.safeParse(baseEvent({ schema_version: 2 })).success,
    ).toBe(false);
  });

  it('missing required field credential_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['credential_id'];
    expect(ProviderCredentialSetSchema.safeParse(ev).success).toBe(false);
  });

  it('missing required field key_prefix → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['key_prefix'];
    expect(ProviderCredentialSetSchema.safeParse(ev).success).toBe(false);
  });

  it('missing required field key_last4 → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['key_last4'];
    expect(ProviderCredentialSetSchema.safeParse(ev).success).toBe(false);
  });

  it('non-ISO datetime in set_at → rejects', () => {
    expect(
      ProviderCredentialSetSchema.safeParse(baseEvent({ set_at: 'yesterday' })).success,
    ).toBe(false);
  });

  it('chain_category locked to admin', () => {
    expect(
      ProviderCredentialSetSchema.safeParse(baseEvent({ chain_category: 'run' })).success,
    ).toBe(false);
  });

  it('provider outside enum → rejects', () => {
    expect(
      ProviderCredentialSetSchema.safeParse(baseEvent({ provider: 'cohere' })).success,
    ).toBe(false);
  });

  it('non-uuid credential_id → rejects', () => {
    expect(
      ProviderCredentialSetSchema.safeParse(
        baseEvent({ credential_id: 'not-a-uuid' }),
      ).success,
    ).toBe(false);
  });

  it('kms_key_version must be positive int', () => {
    expect(
      ProviderCredentialSetSchema.safeParse(baseEvent({ kms_key_version: 0 })).success,
    ).toBe(false);
    expect(
      ProviderCredentialSetSchema.safeParse(baseEvent({ kms_key_version: -1 })).success,
    ).toBe(false);
    expect(
      ProviderCredentialSetSchema.safeParse(baseEvent({ kms_key_version: 1.5 })).success,
    ).toBe(false);
  });

  it('replaced_credential_id non-uuid (and non-null) → rejects', () => {
    expect(
      ProviderCredentialSetSchema.safeParse(
        baseEvent({ replaced_credential_id: 'not-a-uuid' }),
      ).success,
    ).toBe(false);
  });
});
