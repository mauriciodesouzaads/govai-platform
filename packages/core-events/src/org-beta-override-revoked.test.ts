// Smoke tests for OrgBetaOverrideRevokedSchema v1.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { OrgBetaOverrideRevokedSchema } from './org-beta-override-revoked.js';

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'org.beta_override_revoked',
    schema_version: 1,
    tenant_context: {
      org_id: randomUUID(),
      tier: 'enterprise',
      operational_mode: 'production',
    },
    provider: 'anthropic',
    override_id: randomUUID(),
    beta_token: 'message-batches-2024-09-24',
    revoked_at: new Date().toISOString(),
    revoked_by_user_id: randomUUID(),
    reason: 'no longer needed; batch pilot graduated',
    audit_event_id: randomUUID(),
    chain_id: 'admin',
    ...overrides,
  };
}

describe('OrgBetaOverrideRevokedSchema v1', () => {
  it('canonical event accepts', () => {
    expect(OrgBetaOverrideRevokedSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('event_type wrong → rejects', () => {
    expect(
      OrgBetaOverrideRevokedSchema.safeParse(baseEvent({ event_type: 'org.beta_override_set' }))
        .success,
    ).toBe(false);
  });

  it('schema_version other than 1 → rejects', () => {
    expect(
      OrgBetaOverrideRevokedSchema.safeParse(baseEvent({ schema_version: 0 })).success,
    ).toBe(false);
  });

  it('missing required field revoked_at → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['revoked_at'];
    expect(OrgBetaOverrideRevokedSchema.safeParse(ev).success).toBe(false);
  });

  it('missing required field revoked_by_user_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['revoked_by_user_id'];
    expect(OrgBetaOverrideRevokedSchema.safeParse(ev).success).toBe(false);
  });

  it('non-ISO revoked_at → rejects', () => {
    expect(
      OrgBetaOverrideRevokedSchema.safeParse(baseEvent({ revoked_at: 'last week' })).success,
    ).toBe(false);
  });

  it('chain_id locked to admin', () => {
    expect(
      OrgBetaOverrideRevokedSchema.safeParse(baseEvent({ chain_id: 'run' })).success,
    ).toBe(false);
  });

  it('provider outside enum → rejects', () => {
    expect(
      OrgBetaOverrideRevokedSchema.safeParse(baseEvent({ provider: 'cohere' })).success,
    ).toBe(false);
  });

  it('non-uuid revoked_by_user_id → rejects', () => {
    expect(
      OrgBetaOverrideRevokedSchema.safeParse(
        baseEvent({ revoked_by_user_id: 'not-a-uuid' }),
      ).success,
    ).toBe(false);
  });
});
