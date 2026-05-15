// Smoke tests for WorkroomEvidenceSchema v1.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WorkroomEvidenceSchema } from './workroom-evidence.js';

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'workroom.evidence',
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
    evidence_artifact_id: randomUUID(),
    artifact_kind: 'prompt',
    audit_event_id: randomUUID(),
    payload_ref: randomUUID(),
    payload_hash: 'b'.repeat(64),
    redaction_metadata: {},
    workroom_governance_mode: 'governance_active',
    occurred_at: new Date().toISOString(),
    chain_category: 'run',
    ...overrides,
  };
}

describe('WorkroomEvidenceSchema v1', () => {
  it('canonical event accepts', () => {
    expect(WorkroomEvidenceSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('agent_response and auditor_finding artifact kinds accept', () => {
    expect(
      WorkroomEvidenceSchema.safeParse(baseEvent({ artifact_kind: 'agent_response' })).success,
    ).toBe(true);
    expect(
      WorkroomEvidenceSchema.safeParse(baseEvent({ artifact_kind: 'auditor_finding' })).success,
    ).toBe(true);
  });

  it('audit_only governance mode accepts', () => {
    expect(
      WorkroomEvidenceSchema.safeParse(baseEvent({ workroom_governance_mode: 'audit_only' }))
        .success,
    ).toBe(true);
  });

  it('event_type wrong → rejects', () => {
    expect(
      WorkroomEvidenceSchema.safeParse(baseEvent({ event_type: 'workroom.message' })).success,
    ).toBe(false);
  });

  it('schema_version other than 1 → rejects', () => {
    expect(WorkroomEvidenceSchema.safeParse(baseEvent({ schema_version: 2 })).success).toBe(false);
  });

  it('invalid artifact_kind → rejects', () => {
    expect(
      WorkroomEvidenceSchema.safeParse(baseEvent({ artifact_kind: 'screenshot' })).success,
    ).toBe(false);
  });

  it('invalid governance mode → rejects', () => {
    expect(
      WorkroomEvidenceSchema.safeParse(baseEvent({ workroom_governance_mode: 'ungoverned' }))
        .success,
    ).toBe(false);
  });

  it('missing required identifier evidence_artifact_id → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['evidence_artifact_id'];
    expect(WorkroomEvidenceSchema.safeParse(ev).success).toBe(false);
  });

  it('missing payload_ref → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['payload_ref'];
    expect(WorkroomEvidenceSchema.safeParse(ev).success).toBe(false);
  });

  it('non-uuid audit_event_id → rejects', () => {
    expect(
      WorkroomEvidenceSchema.safeParse(baseEvent({ audit_event_id: 'not-a-uuid' })).success,
    ).toBe(false);
  });

  it('does not carry a plaintext content/payload field', () => {
    const parsed = WorkroomEvidenceSchema.parse(baseEvent());
    expect((parsed as Record<string, unknown>)['content']).toBeUndefined();
    expect((parsed as Record<string, unknown>)['payload']).toBeUndefined();
  });

  it('chain_category locked to run', () => {
    expect(WorkroomEvidenceSchema.safeParse(baseEvent({ chain_category: 'admin' })).success).toBe(
      false,
    );
  });
});
