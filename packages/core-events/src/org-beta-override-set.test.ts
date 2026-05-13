// Smoke tests for OrgBetaOverrideSetSchema v1.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { OrgBetaOverrideSetSchema } from './org-beta-override-set.js';

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  const future = new Date(now.getTime() + 86_400_000);
  return {
    event_type: 'org.beta_override_set',
    schema_version: 1,
    tenant_context: {
      org_id: randomUUID(),
      tier: 'enterprise',
      operational_mode: 'production',
    },
    provider: 'anthropic',
    override_id: randomUUID(),
    beta_token: 'message-batches-2024-09-24',
    reason: 'opt-in for batch ingest pilot',
    set_by_user_id: randomUUID(),
    set_at: now.toISOString(),
    expires_at: future.toISOString(),
    policy_at_resolution: 'org_override_allowed',
    audit_event_id: randomUUID(),
    chain_category: 'admin',
    ...overrides,
  };
}

describe('OrgBetaOverrideSetSchema v1', () => {
  it('canonical event accepts', () => {
    expect(OrgBetaOverrideSetSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('event_type wrong → rejects', () => {
    expect(
      OrgBetaOverrideSetSchema.safeParse(baseEvent({ event_type: 'org.beta_override_revoked' }))
        .success,
    ).toBe(false);
  });

  it('schema_version other than 1 → rejects', () => {
    expect(
      OrgBetaOverrideSetSchema.safeParse(baseEvent({ schema_version: 2 })).success,
    ).toBe(false);
  });

  it('missing required field override_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['override_id'];
    expect(OrgBetaOverrideSetSchema.safeParse(ev).success).toBe(false);
  });

  it('missing required field expires_at → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['expires_at'];
    expect(OrgBetaOverrideSetSchema.safeParse(ev).success).toBe(false);
  });

  it('non-ISO datetime in set_at → rejects', () => {
    expect(
      OrgBetaOverrideSetSchema.safeParse(baseEvent({ set_at: 'yesterday' })).success,
    ).toBe(false);
  });

  it('chain_category locked to admin', () => {
    expect(
      OrgBetaOverrideSetSchema.safeParse(baseEvent({ chain_category: 'run' })).success,
    ).toBe(false);
  });

  it('policy_at_resolution outside allowlist → rejects', () => {
    expect(
      OrgBetaOverrideSetSchema.safeParse(
        baseEvent({ policy_at_resolution: 'magical_thinking' }),
      ).success,
    ).toBe(false);
  });

  it('non-uuid override_id → rejects', () => {
    expect(
      OrgBetaOverrideSetSchema.safeParse(baseEvent({ override_id: 'not-a-uuid' })).success,
    ).toBe(false);
  });
});
