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
    reason: 'tool.type was an empty string; classification typed_unknown blocks before invoke',
    tools_taxonomy_version: 'anthropic.tools_taxonomy@2026-05-04',
    audit_event_id: randomUUID(),
    chain_id: 'run',
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

  it('chain_id is locked to run', () => {
    expect(
      ToolValidationBlockedSchema.safeParse(baseEvent({ chain_id: 'admin' })).success,
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
});
