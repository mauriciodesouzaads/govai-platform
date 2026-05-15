// Smoke tests for WorkroomMessageSchema v1.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WorkroomMessageSchema } from './workroom-message.js';

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'workroom.message',
    schema_version: 1,
    tenant_context: {
      org_id: randomUUID(),
      user_id: randomUUID(),
      tier: 'enterprise',
      operational_mode: 'production',
    },
    workroom_id: randomUUID(),
    workroom_turn_id: randomUUID(),
    turn_number: 2,
    message_id: randomUUID(),
    participant_id: randomUUID(),
    role: 'user',
    workroom_governance_mode: 'governance_active',
    content_ref: randomUUID(),
    payload_hash: 'a'.repeat(64),
    occurred_at: new Date().toISOString(),
    audit_event_id: randomUUID(),
    chain_category: 'run',
    ...overrides,
  };
}

describe('WorkroomMessageSchema v1', () => {
  it('canonical event accepts', () => {
    expect(WorkroomMessageSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('assistant and auditor_note roles accept', () => {
    expect(WorkroomMessageSchema.safeParse(baseEvent({ role: 'assistant' })).success).toBe(true);
    expect(WorkroomMessageSchema.safeParse(baseEvent({ role: 'auditor_note' })).success).toBe(true);
  });

  it('audit_only governance mode accepts', () => {
    expect(
      WorkroomMessageSchema.safeParse(baseEvent({ workroom_governance_mode: 'audit_only' })).success,
    ).toBe(true);
  });

  it('event_type wrong → rejects', () => {
    expect(
      WorkroomMessageSchema.safeParse(baseEvent({ event_type: 'workroom.task.created' })).success,
    ).toBe(false);
  });

  it('schema_version other than 1 → rejects', () => {
    expect(WorkroomMessageSchema.safeParse(baseEvent({ schema_version: 2 })).success).toBe(false);
  });

  it('role=system → rejects', () => {
    expect(WorkroomMessageSchema.safeParse(baseEvent({ role: 'system' })).success).toBe(false);
  });

  it('invalid governance mode → rejects', () => {
    expect(
      WorkroomMessageSchema.safeParse(baseEvent({ workroom_governance_mode: 'ungoverned' }))
        .success,
    ).toBe(false);
  });

  it('turn_number must be a positive integer', () => {
    expect(WorkroomMessageSchema.safeParse(baseEvent({ turn_number: 0 })).success).toBe(false);
    expect(WorkroomMessageSchema.safeParse(baseEvent({ turn_number: -1 })).success).toBe(false);
    expect(WorkroomMessageSchema.safeParse(baseEvent({ turn_number: 1.5 })).success).toBe(false);
  });

  it('missing required identifier message_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['message_id'];
    expect(WorkroomMessageSchema.safeParse(ev).success).toBe(false);
  });

  it('missing content_ref → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['content_ref'];
    expect(WorkroomMessageSchema.safeParse(ev).success).toBe(false);
  });

  it('non-uuid participant_id → rejects', () => {
    expect(
      WorkroomMessageSchema.safeParse(baseEvent({ participant_id: 'not-a-uuid' })).success,
    ).toBe(false);
  });

  it('does not carry a plaintext content field', () => {
    const parsed = WorkroomMessageSchema.parse(baseEvent());
    expect((parsed as Record<string, unknown>)['content']).toBeUndefined();
  });

  it('chain_category locked to run', () => {
    expect(WorkroomMessageSchema.safeParse(baseEvent({ chain_category: 'admin' })).success).toBe(
      false,
    );
  });
});
