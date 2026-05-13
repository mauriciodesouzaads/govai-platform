import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ToolValidationBlockedSchema } from './tool-validation-blocked.js';

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'tool.validation_blocked',
    schema_version: 1,
    tenant_context: {
      org_id: randomUUID(),
      tier: 'enterprise',
      operational_mode: 'production',
    },
    provider: 'anthropic',
    capability_id: 'anthropic.messages.create',
    tool_index: 0,
    tool_type: '',
    tool_type_observed: 'empty_string',
    classification: 'anthropic_typed_unknown',
    reason: 'typed_unknown',
    reason_detail:
      'tool.type was an empty string; classification typed_unknown blocks before invoke',
    tools_taxonomy_version: 'anthropic.tools_taxonomy@2026-05-04',
    audit_event_id: randomUUID(),
    chain_category: 'run',
    ...overrides,
  };
}

describe('ToolValidationBlockedSchema v1', () => {
  it('canonical typed_unknown event accepts', () => {
    expect(ToolValidationBlockedSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('rejects if classification is missing from enum', () => {
    expect(
      ToolValidationBlockedSchema.safeParse(
        baseEvent({ classification: 'completely_invalid_classification' }),
      ).success,
    ).toBe(false);
  });

  it('requires tools_taxonomy_version (non-empty)', () => {
    expect(
      ToolValidationBlockedSchema.safeParse(baseEvent({ tools_taxonomy_version: '' }))
        .success,
    ).toBe(false);
  });

  it('chain_category is locked to run', () => {
    expect(
      ToolValidationBlockedSchema.safeParse(baseEvent({ chain_category: 'admin' })).success,
    ).toBe(false);
  });

  it('OpenAI typed_unknown variant accepts', () => {
    expect(
      ToolValidationBlockedSchema.safeParse(
        baseEvent({
          provider: 'openai',
          capability_id: 'openai.responses.create',
          classification: 'openai_typed_unknown',
        }),
      ).success,
    ).toBe(true);
  });

  // HAE-001 — reason enum hardening (Batch A do PR2).
  it('rejects free-text reason outside the 4-value enum', () => {
    expect(
      ToolValidationBlockedSchema.safeParse(
        baseEvent({ reason: 'because_the_emitter_decided' }),
      ).success,
    ).toBe(false);
  });

  it('accepts reason=capability_planned', () => {
    expect(
      ToolValidationBlockedSchema.safeParse(
        baseEvent({
          classification: 'anthropic_provider_hosted_code_execution',
          reason: 'capability_planned',
        }),
      ).success,
    ).toBe(true);
  });

  it('accepts reason=capability_blocked_via_token', () => {
    expect(
      ToolValidationBlockedSchema.safeParse(
        baseEvent({
          classification: 'anthropic_provider_hosted_computer_use',
          reason: 'capability_blocked_via_token',
        }),
      ).success,
    ).toBe(true);
  });

  it('accepts reason=hard_denied_beta', () => {
    expect(
      ToolValidationBlockedSchema.safeParse(
        baseEvent({
          classification: 'anthropic_provider_hosted_computer_use',
          reason: 'hard_denied_beta',
        }),
      ).success,
    ).toBe(true);
  });

  it('reason_detail is optional', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['reason_detail'];
    expect(ToolValidationBlockedSchema.safeParse(ev).success).toBe(true);
  });
});
