import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PassthroughInvokedSchema } from './passthrough-invoked.js';

const HEX64 = 'a'.repeat(64);

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'passthrough.invoked',
    schema_version: 3,
    tenant_context: {
      org_id: randomUUID(),
      tier: 'enterprise',
      operational_mode: 'production',
    },
    provider: 'anthropic',
    capability_id: 'anthropic.messages.create',
    capability_level: 'passthrough_audited',
    // HAE-002: provider-namespaced capability_id requires this field (Rule 6).
    capability_canonical_level: 'policy_governed',
    native_endpoint: '/v1/messages',
    native_method: 'POST',
    is_stream: false,
    is_multipart: false,
    base_risk_class: 'B',
    effective_risk_class: 'B',
    risk_escalation_reasons: [],
    enforcement_decision: 'observe',
    native_request_hash: HEX64,
    native_response_hash: HEX64,
    latency_ms: 100,
    status_code: 200,
    credential_source: 'tenant_provider_credential',
    allowlist_version: 'allowlist@2026-05-07',
    body_forward_mode: 'raw',
    dlp_decisions: [],
    beta_allowlist_sources: [],
    detected_tool_classifications: [],
    audit_event_id: randomUUID(),
    chain_id: 'run',
    ...overrides,
  };
}

describe('PassthroughInvokedSchema v3 — superRefine rules', () => {
  it('schema_version=3 + raw + native_response_hash → accepts (canonical case)', () => {
    expect(PassthroughInvokedSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('rejects schema_version other than 3', () => {
    const r = PassthroughInvokedSchema.safeParse(baseEvent({ schema_version: 2 }));
    expect(r.success).toBe(false);
  });

  it('rule 1a: is_stream=true without stream_final_hash → rejects', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({ is_stream: true, native_response_hash: undefined }),
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('stream_final_hash');
  });

  it('rule 1a: is_stream=true with stream_final_hash → accepts', () => {
    expect(
      PassthroughInvokedSchema.safeParse(
        baseEvent({
          is_stream: true,
          native_response_hash: undefined,
          stream_final_hash: HEX64,
        }),
      ).success,
    ).toBe(true);
  });

  it('rule 1b CRITICAL P2: non-stream raw 2xx without native_response_hash → rejects', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({ status_code: 200, native_response_hash: undefined }),
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('native_response_hash');
  });

  it('rule 1b CRITICAL P2: non-stream raw 4xx without native_response_hash → rejects', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({ status_code: 429, native_response_hash: undefined }),
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('native_response_hash');
  });

  it('rule 1b CRITICAL P2: non-stream raw 5xx without native_response_hash → rejects', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({ status_code: 503, native_response_hash: undefined }),
    );
    expect(r.success).toBe(false);
  });

  it('rule 1b: non-stream blocked without native_response_hash → ACCEPTS (no response body)', () => {
    expect(
      PassthroughInvokedSchema.safeParse(
        baseEvent({
          enforcement_decision: 'blocked',
          body_forward_mode: 'blocked',
          native_response_hash: undefined,
          status_code: 403,
        }),
      ).success,
    ).toBe(true);
  });

  it('rule 2: enforcement=blocked with body_forward_mode != blocked → rejects', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({ enforcement_decision: 'blocked', body_forward_mode: 'raw' }),
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('body_forward_mode');
  });

  it('rule 3: passthrough_audited with body_forward_mode=redacted → rejects', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({ capability_level: 'passthrough_audited', body_forward_mode: 'redacted' }),
    );
    expect(r.success).toBe(false);
  });

  it('rule 4: passthrough_audited 2xx with body_forward_mode=raw → accepts', () => {
    expect(
      PassthroughInvokedSchema.safeParse(
        baseEvent({ capability_level: 'passthrough_audited', body_forward_mode: 'raw' }),
      ).success,
    ).toBe(true);
  });

  it('rule 4: policy_governed 2xx with body_forward_mode=redacted → accepts', () => {
    expect(
      PassthroughInvokedSchema.safeParse(
        baseEvent({ capability_level: 'policy_governed', body_forward_mode: 'redacted' }),
      ).success,
    ).toBe(true);
  });

  it('rule 5: detected_tool_classifications without tools_taxonomy_version → rejects', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({
        detected_tool_classifications: [
          {
            tool_index: 0,
            tool_type: 'web_search',
            classification: 'anthropic_provider_hosted_web_search',
            contributed_risk_class: 'B',
            decision: 'allowed',
          },
        ],
      }),
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('tools_taxonomy_version');
  });

  it('rule 5: no tools, no tools_taxonomy_version → accepts', () => {
    expect(PassthroughInvokedSchema.safeParse(baseEvent()).success).toBe(true);
  });

  // HAE-002 Rule 6 — capability_canonical_level required for provider-namespaced ids.

  it('rule 6: anthropic.* without capability_canonical_level → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['capability_canonical_level'];
    const r = PassthroughInvokedSchema.safeParse(ev);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('capability_canonical_level');
  });

  it('rule 6: anthropic.* with capability_canonical_level=policy_governed → accepts', () => {
    expect(
      PassthroughInvokedSchema.safeParse(
        baseEvent({
          capability_id: 'anthropic.messages.create',
          capability_level: 'passthrough_audited',
          capability_canonical_level: 'policy_governed',
        }),
      ).success,
    ).toBe(true);
  });

  it('rule 6: legacy non-namespaced capability_id (e.g., test.placeholder) without canonical_level → accepts', () => {
    const ev = baseEvent({ capability_id: 'test.placeholder' });
    delete (ev as Record<string, unknown>)['capability_canonical_level'];
    expect(PassthroughInvokedSchema.safeParse(ev).success).toBe(true);
  });

  it('rule 6: /passthrough/anthropic/v1/messages — anthropic.messages.create operational=passthrough_audited canonical=policy_governed', () => {
    expect(
      PassthroughInvokedSchema.safeParse(
        baseEvent({
          provider: 'anthropic',
          capability_id: 'anthropic.messages.create',
          capability_level: 'passthrough_audited',
          capability_canonical_level: 'policy_governed',
          native_endpoint: '/v1/messages',
        }),
      ).success,
    ).toBe(true);
  });

  it('rule 6: /passthrough/anthropic/v1/messages/count_tokens — messages_meta both levels passthrough_audited', () => {
    expect(
      PassthroughInvokedSchema.safeParse(
        baseEvent({
          provider: 'anthropic',
          capability_id: 'anthropic.messages_meta',
          capability_level: 'passthrough_audited',
          capability_canonical_level: 'passthrough_audited',
          native_endpoint: '/v1/messages/count_tokens',
        }),
      ).success,
    ).toBe(true);
  });
});
