// Smoke tests for WorkroomTaskCreatedSchema v1.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WorkroomTaskCreatedSchema } from './workroom-task.js';

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'workroom.task.created',
    schema_version: 1,
    tenant_context: {
      org_id: randomUUID(),
      user_id: randomUUID(),
      tier: 'enterprise',
      operational_mode: 'production',
    },
    workroom_id: randomUUID(),
    workroom_turn_id: randomUUID(),
    turn_number: 3,
    task_id: randomUUID(),
    created_by_participant_id: randomUUID(),
    assigned_participant_id: null,
    title: 'Draft the migration',
    risk_class: 'C',
    requires_approval: true,
    status: 'queued',
    workroom_governance_mode: 'governance_active',
    occurred_at: new Date().toISOString(),
    audit_event_id: randomUUID(),
    chain_category: 'run',
    ...overrides,
  };
}

describe('WorkroomTaskCreatedSchema v1', () => {
  it('canonical event accepts', () => {
    expect(WorkroomTaskCreatedSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('assigned_participant_id may be a uuid', () => {
    expect(
      WorkroomTaskCreatedSchema.safeParse(baseEvent({ assigned_participant_id: randomUUID() }))
        .success,
    ).toBe(true);
  });

  it('audit_only governance mode accepts', () => {
    expect(
      WorkroomTaskCreatedSchema.safeParse(baseEvent({ workroom_governance_mode: 'audit_only' }))
        .success,
    ).toBe(true);
  });

  it('event_type wrong → rejects', () => {
    expect(
      WorkroomTaskCreatedSchema.safeParse(baseEvent({ event_type: 'workroom.message' })).success,
    ).toBe(false);
  });

  it('schema_version other than 1 → rejects', () => {
    expect(WorkroomTaskCreatedSchema.safeParse(baseEvent({ schema_version: 2 })).success).toBe(
      false,
    );
  });

  it('invalid risk_class → rejects', () => {
    expect(WorkroomTaskCreatedSchema.safeParse(baseEvent({ risk_class: 'F' })).success).toBe(false);
  });

  it('invalid status → rejects', () => {
    expect(WorkroomTaskCreatedSchema.safeParse(baseEvent({ status: 'archived' })).success).toBe(
      false,
    );
  });

  it('invalid governance mode → rejects', () => {
    expect(
      WorkroomTaskCreatedSchema.safeParse(baseEvent({ workroom_governance_mode: 'ungoverned' }))
        .success,
    ).toBe(false);
  });

  it('requires_approval must be boolean', () => {
    expect(WorkroomTaskCreatedSchema.safeParse(baseEvent({ requires_approval: 'yes' })).success).toBe(
      false,
    );
  });

  it('missing required identifier task_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['task_id'];
    expect(WorkroomTaskCreatedSchema.safeParse(ev).success).toBe(false);
  });

  it('empty title → rejects', () => {
    expect(WorkroomTaskCreatedSchema.safeParse(baseEvent({ title: '' })).success).toBe(false);
  });

  it('turn_number must be a positive integer', () => {
    expect(WorkroomTaskCreatedSchema.safeParse(baseEvent({ turn_number: 0 })).success).toBe(false);
  });

  it('chain_category locked to run', () => {
    expect(
      WorkroomTaskCreatedSchema.safeParse(baseEvent({ chain_category: 'policy' })).success,
    ).toBe(false);
  });
});
