// Smoke tests for WorkroomApprovalDecisionSchema v1.

import { describe, it, expect } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { WorkroomApprovalDecisionSchema } from './workroom-approval-decision.js';

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'workroom.approval.granted',
    schema_version: 1,
    tenant_context: {
      org_id: randomUUID(),
      user_id: randomUUID(),
      tier: 'regulated',
      operational_mode: 'production',
    },
    workroom_id: randomUUID(),
    workroom_turn_id: randomUUID(),
    turn_number: 7,
    approval_request_id: randomUUID(),
    approval_decision_id: randomUUID(),
    requested_by_participant_id: randomUUID(),
    decided_by_participant_id: randomUUID(),
    outcome: 'granted',
    reason: null,
    subject_kind: 'passthrough_run',
    status: 'granted',
    workroom_governance_mode: 'governance_active',
    intended_action_hash: createHash('sha256').update('canonical').digest('hex'),
    consumed_run_id: null,
    occurred_at: new Date().toISOString(),
    audit_event_id: randomUUID(),
    chain_category: 'policy',
    ...overrides,
  };
}

describe('WorkroomApprovalDecisionSchema v1', () => {
  it('canonical granted event accepts', () => {
    expect(WorkroomApprovalDecisionSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('denied event with a reason accepts', () => {
    expect(
      WorkroomApprovalDecisionSchema.safeParse(
        baseEvent({
          event_type: 'workroom.approval.denied',
          outcome: 'denied',
          status: 'denied',
          reason: 'risk too high for an unattended override',
        }),
      ).success,
    ).toBe(true);
  });

  it('revoked event with a null approval_decision_id accepts', () => {
    expect(
      WorkroomApprovalDecisionSchema.safeParse(
        baseEvent({
          event_type: 'workroom.approval.revoked',
          outcome: 'revoked',
          status: 'revoked',
          approval_decision_id: null,
        }),
      ).success,
    ).toBe(true);
  });

  it('reason may be a string', () => {
    expect(
      WorkroomApprovalDecisionSchema.safeParse(baseEvent({ reason: 'approved by owner' })).success,
    ).toBe(true);
  });

  it('consumed_run_id may be a uuid', () => {
    expect(
      WorkroomApprovalDecisionSchema.safeParse(baseEvent({ consumed_run_id: randomUUID() })).success,
    ).toBe(true);
  });

  it('audit_only governance mode accepts', () => {
    expect(
      WorkroomApprovalDecisionSchema.safeParse(baseEvent({ workroom_governance_mode: 'audit_only' }))
        .success,
    ).toBe(true);
  });

  it('invalid event_type → rejects', () => {
    expect(
      WorkroomApprovalDecisionSchema.safeParse(baseEvent({ event_type: 'workroom.approval.requested' }))
        .success,
    ).toBe(false);
  });

  it('invalid outcome → rejects', () => {
    expect(
      WorkroomApprovalDecisionSchema.safeParse(baseEvent({ outcome: 'request_changes' })).success,
    ).toBe(false);
  });

  it('invalid status → rejects', () => {
    expect(WorkroomApprovalDecisionSchema.safeParse(baseEvent({ status: 'pending' })).success).toBe(
      false,
    );
  });

  it('schema_version other than 1 → rejects', () => {
    expect(WorkroomApprovalDecisionSchema.safeParse(baseEvent({ schema_version: 2 })).success).toBe(
      false,
    );
  });

  it('subject_kind locked to passthrough_run', () => {
    expect(
      WorkroomApprovalDecisionSchema.safeParse(baseEvent({ subject_kind: 'run' })).success,
    ).toBe(false);
  });

  it('chain_category locked to policy', () => {
    expect(
      WorkroomApprovalDecisionSchema.safeParse(baseEvent({ chain_category: 'run' })).success,
    ).toBe(false);
  });

  it('empty intended_action_hash → rejects', () => {
    expect(
      WorkroomApprovalDecisionSchema.safeParse(baseEvent({ intended_action_hash: '' })).success,
    ).toBe(false);
  });

  it('turn_number must be a positive integer', () => {
    expect(WorkroomApprovalDecisionSchema.safeParse(baseEvent({ turn_number: -1 })).success).toBe(
      false,
    );
  });

  it('missing decided_by_participant_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['decided_by_participant_id'];
    expect(WorkroomApprovalDecisionSchema.safeParse(ev).success).toBe(false);
  });

  it('missing approval_request_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['approval_request_id'];
    expect(WorkroomApprovalDecisionSchema.safeParse(ev).success).toBe(false);
  });

  it('tenant_context missing operational_mode → rejects', () => {
    const ev = baseEvent();
    delete ((ev as Record<string, unknown>)['tenant_context'] as Record<string, unknown>)[
      'operational_mode'
    ];
    expect(WorkroomApprovalDecisionSchema.safeParse(ev).success).toBe(false);
  });
});
