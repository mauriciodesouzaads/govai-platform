// Smoke tests for WorkroomParticipantSchema v1.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WorkroomParticipantSchema } from './workroom-participant.js';

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'workroom.participant',
    schema_version: 1,
    tenant_context: {
      org_id: randomUUID(),
      user_id: randomUUID(),
      tier: 'enterprise',
      operational_mode: 'production',
    },
    workroom_id: randomUUID(),
    workroom_governance_mode: 'governance_active',
    participant_id: randomUUID(),
    participant_kind: 'human',
    participant_role: 'human_owner',
    transition: 'added',
    actor_user_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    audit_event_id: randomUUID(),
    chain_category: 'admin',
    ...overrides,
  };
}

describe('WorkroomParticipantSchema v1', () => {
  it('canonical event accepts', () => {
    expect(WorkroomParticipantSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('agent participant with removed transition accepts', () => {
    expect(
      WorkroomParticipantSchema.safeParse(
        baseEvent({
          participant_kind: 'agent',
          participant_role: 'executor_agent',
          transition: 'removed',
        }),
      ).success,
    ).toBe(true);
  });

  it('audit_only governance mode accepts', () => {
    expect(
      WorkroomParticipantSchema.safeParse(
        baseEvent({ workroom_governance_mode: 'audit_only' }),
      ).success,
    ).toBe(true);
  });

  it('event_type wrong → rejects', () => {
    expect(
      WorkroomParticipantSchema.safeParse(baseEvent({ event_type: 'workroom.lifecycle' })).success,
    ).toBe(false);
  });

  it('schema_version other than 1 → rejects', () => {
    expect(WorkroomParticipantSchema.safeParse(baseEvent({ schema_version: 2 })).success).toBe(
      false,
    );
  });

  it('invalid workroom_governance_mode → rejects', () => {
    expect(
      WorkroomParticipantSchema.safeParse(
        baseEvent({ workroom_governance_mode: 'ungoverned' }),
      ).success,
    ).toBe(false);
  });

  it('invalid participant_kind → rejects', () => {
    expect(
      WorkroomParticipantSchema.safeParse(baseEvent({ participant_kind: 'bot' })).success,
    ).toBe(false);
  });

  it('invalid participant_role → rejects', () => {
    expect(
      WorkroomParticipantSchema.safeParse(baseEvent({ participant_role: 'superuser' })).success,
    ).toBe(false);
  });

  it('invalid transition → rejects', () => {
    expect(
      WorkroomParticipantSchema.safeParse(baseEvent({ transition: 'paused' })).success,
    ).toBe(false);
  });

  it('missing required identifier participant_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['participant_id'];
    expect(WorkroomParticipantSchema.safeParse(ev).success).toBe(false);
  });

  it('missing required identifier workroom_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['workroom_id'];
    expect(WorkroomParticipantSchema.safeParse(ev).success).toBe(false);
  });

  it('non-uuid actor_user_id → rejects', () => {
    expect(
      WorkroomParticipantSchema.safeParse(baseEvent({ actor_user_id: 'not-a-uuid' })).success,
    ).toBe(false);
  });

  it('chain_category locked to admin', () => {
    expect(
      WorkroomParticipantSchema.safeParse(baseEvent({ chain_category: 'run' })).success,
    ).toBe(false);
  });
});
