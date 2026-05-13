// Smoke tests for PassthroughBetaDeniedSchema v1.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PassthroughBetaDeniedSchema } from './passthrough-beta-denied.js';

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'passthrough.beta_denied',
    schema_version: 1,
    tenant_context: {
      org_id: randomUUID(),
      tier: 'business',
      operational_mode: 'production',
    },
    provider: 'anthropic',
    capability_id: 'anthropic.messages.create',
    beta_token: 'computer-use-2024-10-22',
    policy_at_resolution: 'hard_denied',
    reason_code: 'hard_denied',
    audit_event_id: randomUUID(),
    chain_category: 'run',
    ...overrides,
  };
}

describe('PassthroughBetaDeniedSchema v1', () => {
  it('canonical hard_denied event accepts', () => {
    expect(PassthroughBetaDeniedSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('event_type wrong → rejects', () => {
    expect(
      PassthroughBetaDeniedSchema.safeParse(baseEvent({ event_type: 'passthrough.invoked' }))
        .success,
    ).toBe(false);
  });

  it('schema_version other than 1 → rejects', () => {
    expect(
      PassthroughBetaDeniedSchema.safeParse(baseEvent({ schema_version: 2 })).success,
    ).toBe(false);
  });

  it('missing required field beta_token → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['beta_token'];
    expect(PassthroughBetaDeniedSchema.safeParse(ev).success).toBe(false);
  });

  it('missing required field reason_code → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['reason_code'];
    expect(PassthroughBetaDeniedSchema.safeParse(ev).success).toBe(false);
  });

  it('reason_code outside allowlist → rejects', () => {
    expect(
      PassthroughBetaDeniedSchema.safeParse(baseEvent({ reason_code: 'because_i_said_so' }))
        .success,
    ).toBe(false);
  });

  it('chain_category locked to run', () => {
    expect(
      PassthroughBetaDeniedSchema.safeParse(baseEvent({ chain_category: 'admin' })).success,
    ).toBe(false);
  });

  it('provider outside enum → rejects', () => {
    expect(
      PassthroughBetaDeniedSchema.safeParse(baseEvent({ provider: 'mistral' })).success,
    ).toBe(false);
  });

  it('policy_at_resolution=unknown variant accepts (used for unknown_token reason)', () => {
    expect(
      PassthroughBetaDeniedSchema.safeParse(
        baseEvent({ policy_at_resolution: 'unknown', reason_code: 'unknown_token' }),
      ).success,
    ).toBe(true);
  });
});
