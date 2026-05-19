// Smoke tests for WorkroomApprovalRequestedSchema v1.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { WorkroomApprovalRequestedSchema } from './workroom-approval-request.js';

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'workroom.approval.requested',
    schema_version: 1,
    tenant_context: {
      org_id: randomUUID(),
      user_id: randomUUID(),
      tier: 'enterprise',
      operational_mode: 'production',
    },
    workroom_id: randomUUID(),
    workroom_turn_id: randomUUID(),
    turn_number: 4,
    approval_request_id: randomUUID(),
    requested_by_participant_id: randomUUID(),
    subject_kind: 'passthrough_run',
    subject_ref_id: null,
    risk_class: 'C',
    status: 'pending',
    workroom_governance_mode: 'governance_active',
    intended_action_hash: createHash('sha256').update('canonical').digest('hex'),
    intended_action_payload_ref: randomUUID(),
    expires_at: null,
    occurred_at: new Date().toISOString(),
    audit_event_id: randomUUID(),
    chain_category: 'policy',
    ...overrides,
  };
}

describe('WorkroomApprovalRequestedSchema v1', () => {
  it('canonical event accepts', () => {
    expect(WorkroomApprovalRequestedSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('risk_class may be null', () => {
    expect(WorkroomApprovalRequestedSchema.safeParse(baseEvent({ risk_class: null })).success).toBe(
      true,
    );
  });

  it('each risk_class letter accepts', () => {
    for (const rc of ['A', 'B', 'C', 'D', 'E']) {
      expect(WorkroomApprovalRequestedSchema.safeParse(baseEvent({ risk_class: rc })).success).toBe(
        true,
      );
    }
  });

  it('invalid risk_class → rejects', () => {
    expect(WorkroomApprovalRequestedSchema.safeParse(baseEvent({ risk_class: 'F' })).success).toBe(
      false,
    );
  });

  it('expires_at may be an ISO datetime', () => {
    expect(
      WorkroomApprovalRequestedSchema.safeParse(
        baseEvent({ expires_at: new Date().toISOString() }),
      ).success,
    ).toBe(true);
  });

  it('expires_at non-datetime → rejects', () => {
    expect(
      WorkroomApprovalRequestedSchema.safeParse(baseEvent({ expires_at: 'tomorrow' })).success,
    ).toBe(false);
  });

  it('intended_action_payload_ref may be null', () => {
    expect(
      WorkroomApprovalRequestedSchema.safeParse(baseEvent({ intended_action_payload_ref: null }))
        .success,
    ).toBe(true);
  });

  it('audit_only governance mode accepts', () => {
    expect(
      WorkroomApprovalRequestedSchema.safeParse(
        baseEvent({ workroom_governance_mode: 'audit_only' }),
      ).success,
    ).toBe(true);
  });

  it('event_type wrong → rejects', () => {
    expect(
      WorkroomApprovalRequestedSchema.safeParse(baseEvent({ event_type: 'workroom.approval.granted' }))
        .success,
    ).toBe(false);
  });

  it('schema_version other than 1 → rejects', () => {
    expect(
      WorkroomApprovalRequestedSchema.safeParse(baseEvent({ schema_version: 2 })).success,
    ).toBe(false);
  });

  it('invalid subject_kind → rejects', () => {
    expect(
      WorkroomApprovalRequestedSchema.safeParse(baseEvent({ subject_kind: 'run' })).success,
    ).toBe(false);
  });

  it('status other than pending → rejects', () => {
    expect(
      WorkroomApprovalRequestedSchema.safeParse(baseEvent({ status: 'granted' })).success,
    ).toBe(false);
  });

  it('invalid governance mode → rejects', () => {
    expect(
      WorkroomApprovalRequestedSchema.safeParse(
        baseEvent({ workroom_governance_mode: 'ungoverned' }),
      ).success,
    ).toBe(false);
  });

  it('chain_category locked to policy', () => {
    expect(
      WorkroomApprovalRequestedSchema.safeParse(baseEvent({ chain_category: 'run' })).success,
    ).toBe(false);
    expect(
      WorkroomApprovalRequestedSchema.safeParse(baseEvent({ chain_category: 'admin' })).success,
    ).toBe(false);
  });

  it('empty intended_action_hash → rejects', () => {
    expect(
      WorkroomApprovalRequestedSchema.safeParse(baseEvent({ intended_action_hash: '' })).success,
    ).toBe(false);
  });

  it('turn_number must be a positive integer', () => {
    expect(WorkroomApprovalRequestedSchema.safeParse(baseEvent({ turn_number: 0 })).success).toBe(
      false,
    );
  });

  it('missing required identifier approval_request_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['approval_request_id'];
    expect(WorkroomApprovalRequestedSchema.safeParse(ev).success).toBe(false);
  });

  it('tenant_context missing tier → rejects', () => {
    const ev = baseEvent();
    delete ((ev as Record<string, unknown>)['tenant_context'] as Record<string, unknown>)['tier'];
    expect(WorkroomApprovalRequestedSchema.safeParse(ev).success).toBe(false);
  });

  it('subject_ref_id may be a uuid', () => {
    expect(
      WorkroomApprovalRequestedSchema.safeParse(baseEvent({ subject_ref_id: randomUUID() })).success,
    ).toBe(true);
  });
});
