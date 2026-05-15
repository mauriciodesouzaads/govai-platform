// Smoke tests for WorkroomLifecycleSchema v1.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WorkroomLifecycleSchema } from './workroom-lifecycle.js';

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'workroom.lifecycle',
    schema_version: 1,
    tenant_context: {
      org_id: randomUUID(),
      user_id: randomUUID(),
      tier: 'enterprise',
      operational_mode: 'production',
    },
    workroom_id: randomUUID(),
    workspace_id: randomUUID(),
    governance_mode: 'governance_active',
    transition: 'created',
    status: 'open',
    created_by_user_id: randomUUID(),
    policy_profile_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    audit_event_id: randomUUID(),
    chain_category: 'run',
    ...overrides,
  };
}

describe('WorkroomLifecycleSchema v1', () => {
  it('canonical event accepts', () => {
    expect(WorkroomLifecycleSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('governance_mode audit_only accepts', () => {
    expect(
      WorkroomLifecycleSchema.safeParse(baseEvent({ governance_mode: 'audit_only' })).success,
    ).toBe(true);
  });

  it('event_type wrong → rejects', () => {
    expect(
      WorkroomLifecycleSchema.safeParse(baseEvent({ event_type: 'workroom.participant' })).success,
    ).toBe(false);
  });

  it('schema_version other than 1 → rejects', () => {
    expect(WorkroomLifecycleSchema.safeParse(baseEvent({ schema_version: 2 })).success).toBe(false);
  });

  it('invalid governance_mode → rejects', () => {
    expect(
      WorkroomLifecycleSchema.safeParse(baseEvent({ governance_mode: 'ungoverned' })).success,
    ).toBe(false);
  });

  it('invalid status → rejects', () => {
    expect(WorkroomLifecycleSchema.safeParse(baseEvent({ status: 'paused' })).success).toBe(false);
  });

  it('invalid transition → rejects', () => {
    expect(
      WorkroomLifecycleSchema.safeParse(baseEvent({ transition: 'archived' })).success,
    ).toBe(false);
  });

  it('missing required identifier workroom_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['workroom_id'];
    expect(WorkroomLifecycleSchema.safeParse(ev).success).toBe(false);
  });

  it('missing required identifier policy_profile_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['policy_profile_id'];
    expect(WorkroomLifecycleSchema.safeParse(ev).success).toBe(false);
  });

  it('non-uuid workroom_id → rejects', () => {
    expect(
      WorkroomLifecycleSchema.safeParse(baseEvent({ workroom_id: 'not-a-uuid' })).success,
    ).toBe(false);
  });

  it('non-ISO occurred_at → rejects', () => {
    expect(
      WorkroomLifecycleSchema.safeParse(baseEvent({ occurred_at: 'yesterday' })).success,
    ).toBe(false);
  });

  it('chain_category locked to run', () => {
    expect(
      WorkroomLifecycleSchema.safeParse(baseEvent({ chain_category: 'admin' })).success,
    ).toBe(false);
  });
});
