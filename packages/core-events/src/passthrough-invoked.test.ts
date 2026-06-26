import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PassthroughInvokedSchema } from './passthrough-invoked.js';

const HEX64 = 'a'.repeat(64);

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'passthrough.invoked',
    schema_version: 4,
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
    occurred_at: '2026-06-15T00:00:00.000Z',
    credential_source: 'tenant_provider_credential',
    allowlist_version: 'allowlist@2026-05-07',
    body_forward_mode: 'raw',
    dlp_decisions: [],
    beta_allowlist_sources: [],
    detected_tool_classifications: [],
    audit_event_id: randomUUID(),
    chain_category: 'run',
    ...overrides,
  };
}

describe('PassthroughInvokedSchema v4 — superRefine rules', () => {
  it('schema_version=4 + raw + native_response_hash → accepts (canonical case)', () => {
    expect(PassthroughInvokedSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('rejects schema_version other than 4', () => {
    const r = PassthroughInvokedSchema.safeParse(baseEvent({ schema_version: 2 }));
    expect(r.success).toBe(false);
  });

  // EP-002 rev2 — the schema is now v4-only. A v3-shaped payload (schema_version: 3,
  // no occurred_at) is REJECTED, encoding the Codex-bot finding as a guard: the
  // version literal honestly reflects the shape (v4 carries occurred_at, v3 does not).
  it('v4-only: a v3-shaped object (schema_version: 3, no occurred_at) → rejects', () => {
    const ev = baseEvent({ schema_version: 3 });
    delete (ev as Record<string, unknown>)['occurred_at'];
    const r = PassthroughInvokedSchema.safeParse(ev);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('schema_version');
  });

  // EP-002 — occurred_at is a REQUIRED ISO-8601 field on v4.
  it('occurred_at: a v4 event WITHOUT occurred_at → rejects', () => {
    const ev = baseEvent();
    delete (ev as Record<string, unknown>)['occurred_at'];
    const r = PassthroughInvokedSchema.safeParse(ev);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('occurred_at');
  });

  it('occurred_at: a non-ISO-8601 value → rejects', () => {
    const r = PassthroughInvokedSchema.safeParse(baseEvent({ occurred_at: 'not-a-datetime' }));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('occurred_at');
  });

  it('occurred_at: a valid ISO-8601 UTC value → accepts', () => {
    expect(
      PassthroughInvokedSchema.safeParse(baseEvent({ occurred_at: '2026-06-15T12:34:56.000Z' }))
        .success,
    ).toBe(true);
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

  // HAE-003 Rule 7 — purpose_deprecated coherence (Batch C do PR2).

  it('rule 7 (HAE-003): legacy event without purpose_deprecated/sunset/migration_target → accepts', () => {
    // Equivalent to "evento antigo sem esses campos continua válido".
    expect(PassthroughInvokedSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('rule 7 (HAE-003): purpose_deprecated=true with sunset_at + migration_target → accepts', () => {
    expect(
      PassthroughInvokedSchema.safeParse(
        baseEvent({
          provider: 'openai',
          capability_id: 'openai.files',
          capability_level: 'passthrough_audited',
          capability_canonical_level: 'passthrough_audited',
          native_endpoint: '/v1/files',
          purpose_deprecated: true,
          purpose_deprecation_sunset_at: '2026-08-26T00:00:00.000Z',
          purpose_deprecation_migration_target: 'responses_api+conversations_api',
        }),
      ).success,
    ).toBe(true);
  });

  it('rule 7 (HAE-003): purpose_deprecation_sunset_at requires datetime format', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({
        provider: 'openai',
        capability_id: 'openai.files',
        capability_level: 'passthrough_audited',
        capability_canonical_level: 'passthrough_audited',
        native_endpoint: '/v1/files',
        purpose_deprecated: true,
        purpose_deprecation_sunset_at: 'not-a-datetime',
        purpose_deprecation_migration_target: 'responses_api',
      }),
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('purpose_deprecation_sunset_at');
  });

  it('rule 7 (HAE-003): purpose_deprecation_migration_target requires non-empty string', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({
        provider: 'openai',
        capability_id: 'openai.files',
        capability_level: 'passthrough_audited',
        capability_canonical_level: 'passthrough_audited',
        native_endpoint: '/v1/files',
        purpose_deprecated: true,
        purpose_deprecation_sunset_at: '2026-08-26T00:00:00.000Z',
        purpose_deprecation_migration_target: '',
      }),
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('purpose_deprecation_migration_target');
  });

  it('rule 7 (HAE-003): purpose_deprecated=true without sunset_at → rejects', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({
        provider: 'openai',
        capability_id: 'openai.files',
        capability_level: 'passthrough_audited',
        capability_canonical_level: 'passthrough_audited',
        native_endpoint: '/v1/files',
        purpose_deprecated: true,
        purpose_deprecation_migration_target: 'responses_api',
      }),
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('purpose_deprecation_sunset_at');
  });

  it('rule 7 (HAE-003): purpose_deprecated=true without migration_target → rejects', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({
        provider: 'openai',
        capability_id: 'openai.files',
        capability_level: 'passthrough_audited',
        capability_canonical_level: 'passthrough_audited',
        native_endpoint: '/v1/files',
        purpose_deprecated: true,
        purpose_deprecation_sunset_at: '2026-08-26T00:00:00.000Z',
      }),
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('purpose_deprecation_migration_target');
  });

  it('rule 7 (HAE-003): purpose_deprecated absent but sunset_at present → rejects', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({
        provider: 'openai',
        capability_id: 'openai.files',
        capability_level: 'passthrough_audited',
        capability_canonical_level: 'passthrough_audited',
        native_endpoint: '/v1/files',
        purpose_deprecation_sunset_at: '2026-08-26T00:00:00.000Z',
      }),
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('purpose_deprecation_sunset_at');
  });

  it('rule 7 (HAE-003): purpose_deprecated absent but migration_target present → rejects', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({
        provider: 'openai',
        capability_id: 'openai.files',
        capability_level: 'passthrough_audited',
        capability_canonical_level: 'passthrough_audited',
        native_endpoint: '/v1/files',
        purpose_deprecation_migration_target: 'responses_api',
      }),
    );
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('purpose_deprecation_migration_target');
  });

  it('rule 7 (HAE-003): purpose_deprecated=false explicit + other fields undefined → accepts', () => {
    expect(
      PassthroughInvokedSchema.safeParse(
        baseEvent({
          provider: 'openai',
          capability_id: 'openai.files',
          capability_level: 'passthrough_audited',
          capability_canonical_level: 'passthrough_audited',
          native_endpoint: '/v1/files',
          purpose_deprecated: false,
        }),
      ).success,
    ).toBe(true);
  });
});

describe('PassthroughInvokedSchema v4 — EP-008C stream_outcome (additive-optional + Rule 8)', () => {
  it('backward-compatible: a stream event WITHOUT stream_outcome still accepts (legacy / outcome-unknown)', () => {
    expect(
      PassthroughInvokedSchema.safeParse(baseEvent({ is_stream: true, stream_final_hash: HEX64 }))
        .success,
    ).toBe(true);
  });

  it('accepts stream_outcome=complete on a stream event', () => {
    expect(
      PassthroughInvokedSchema.safeParse(
        baseEvent({ is_stream: true, stream_final_hash: HEX64, stream_outcome: 'complete' }),
      ).success,
    ).toBe(true);
  });

  it('accepts stream_outcome=upstream_error / client_disconnect on a stream event (broken terminal still carries the partial hash)', () => {
    for (const outcome of ['upstream_error', 'client_disconnect'] as const) {
      expect(
        PassthroughInvokedSchema.safeParse(
          baseEvent({ is_stream: true, stream_final_hash: HEX64, stream_outcome: outcome }),
        ).success,
      ).toBe(true);
    }
  });

  it('Rule 8: a broken stream_outcome (upstream_error/client_disconnect) on a NON-stream event → rejects', () => {
    for (const outcome of ['upstream_error', 'client_disconnect'] as const) {
      const r = PassthroughInvokedSchema.safeParse(
        baseEvent({ is_stream: false, stream_outcome: outcome }),
      );
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error)).toContain('stream_outcome');
    }
  });

  it('rejects an out-of-enum stream_outcome value', () => {
    const r = PassthroughInvokedSchema.safeParse(
      baseEvent({ is_stream: true, stream_final_hash: HEX64, stream_outcome: 'truncated' }),
    );
    expect(r.success).toBe(false);
  });
});
