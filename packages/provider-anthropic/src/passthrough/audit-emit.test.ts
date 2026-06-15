// Decisão 4 / HAE-002 — capability_canonical_level vs capability_level distinction.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildPassthroughInvoked } from './audit-emit.js';
import { KNOWN_ANTHROPIC_TAXONOMY_VERSION } from '../tool-taxonomy-version.js';

const HEX64 = 'a'.repeat(64);

function tenant() {
  return {
    org_id: randomUUID(),
    tier: 'enterprise' as const,
    operational_mode: 'test' as const,
  };
}

describe('Decisão 4 — passthrough.invoked v3 distinguishes operational mode from canonical level', () => {
  it('/passthrough/anthropic/v1/messages — anthropic.messages.create: operational=passthrough_audited, canonical=policy_governed', () => {
    const ev = buildPassthroughInvoked({
      tenant: tenant(),
      capability_id: 'anthropic.messages.create',
      capability_level: 'passthrough_audited',
      capability_canonical_level: 'policy_governed',
      native_endpoint: '/v1/messages',
      native_method: 'POST',
      is_stream: false,
      is_multipart: false,
      base_risk_class: 'A',
      effective_risk_class: 'A',
      enforcement_decision: 'observe',
      native_request_hash: HEX64,
      native_response_hash: HEX64,
      latency_ms: 100,
      status_code: 200,
      occurred_at: new Date('2026-06-15T00:00:00.000Z'),
      credential_source: 'tenant_provider_credential',
      allowlist_version: 'anthropic-beta-policy@2026-05-06',
      body_forward_mode: 'raw',
    });
    expect(ev.capability_level).toBe('passthrough_audited');
    expect(ev.capability_canonical_level).toBe('policy_governed');
  });

  it('/passthrough/anthropic/v1/messages stream — anthropic.messages.stream: same distinction with stream_final_hash', () => {
    const ev = buildPassthroughInvoked({
      tenant: tenant(),
      capability_id: 'anthropic.messages.stream',
      capability_level: 'passthrough_audited',
      capability_canonical_level: 'policy_governed',
      native_endpoint: '/v1/messages',
      native_method: 'POST',
      is_stream: true,
      is_multipart: false,
      base_risk_class: 'A',
      effective_risk_class: 'A',
      enforcement_decision: 'observe',
      native_request_hash: HEX64,
      stream_final_hash: HEX64,
      latency_ms: 100,
      status_code: 200,
      occurred_at: new Date('2026-06-15T00:00:00.000Z'),
      credential_source: 'tenant_provider_credential',
      allowlist_version: 'anthropic-beta-policy@2026-05-06',
      body_forward_mode: 'raw',
    });
    expect(ev.capability_canonical_level).toBe('policy_governed');
    expect(ev.is_stream).toBe(true);
    expect(ev.stream_final_hash).toBe(HEX64);
  });

  it('/passthrough/anthropic/v1/messages/count_tokens — anthropic.messages_meta: BOTH levels passthrough_audited (registry === operational)', () => {
    const ev = buildPassthroughInvoked({
      tenant: tenant(),
      capability_id: 'anthropic.messages_meta',
      capability_level: 'passthrough_audited',
      capability_canonical_level: 'passthrough_audited',
      native_endpoint: '/v1/messages/count_tokens',
      native_method: 'POST',
      is_stream: false,
      is_multipart: false,
      base_risk_class: 'A',
      effective_risk_class: 'A',
      enforcement_decision: 'observe',
      native_request_hash: HEX64,
      native_response_hash: HEX64,
      latency_ms: 50,
      status_code: 200,
      occurred_at: new Date('2026-06-15T00:00:00.000Z'),
      credential_source: 'tenant_provider_credential',
      allowlist_version: 'anthropic-beta-policy@2026-05-06',
      body_forward_mode: 'raw',
    });
    expect(ev.capability_level).toBe('passthrough_audited');
    expect(ev.capability_canonical_level).toBe('passthrough_audited');
  });

  it('detected_tool_classifications populates tools_taxonomy_version automatically', () => {
    const ev = buildPassthroughInvoked({
      tenant: tenant(),
      capability_id: 'anthropic.messages.create',
      capability_level: 'passthrough_audited',
      capability_canonical_level: 'policy_governed',
      native_endpoint: '/v1/messages',
      native_method: 'POST',
      is_stream: false,
      is_multipart: false,
      base_risk_class: 'A',
      effective_risk_class: 'C',
      enforcement_decision: 'observe',
      native_request_hash: HEX64,
      native_response_hash: HEX64,
      latency_ms: 100,
      status_code: 200,
      occurred_at: new Date('2026-06-15T00:00:00.000Z'),
      credential_source: 'tenant_provider_credential',
      allowlist_version: 'anthropic-beta-policy@2026-05-06',
      body_forward_mode: 'raw',
      detected_tool_classifications: [
        {
          tool_index: 0,
          tool_type: 'web_search_20260209',
          classification: 'anthropic_provider_hosted_web_search',
          contributed_risk_class: 'C',
          decision: 'allowed',
        },
      ],
    });
    expect(ev.tools_taxonomy_version).toBe(KNOWN_ANTHROPIC_TAXONOMY_VERSION);
  });

  it('throws when caller would emit a malformed event (e.g., missing canonical level for provider-namespaced id)', () => {
    expect(() =>
      buildPassthroughInvoked({
        tenant: tenant(),
        capability_id: 'anthropic.messages.create',
        capability_level: 'passthrough_audited',
        capability_canonical_level: undefined as unknown as 'policy_governed',
        native_endpoint: '/v1/messages',
        native_method: 'POST',
        is_stream: false,
        is_multipart: false,
        base_risk_class: 'A',
        effective_risk_class: 'A',
        enforcement_decision: 'observe',
        native_request_hash: HEX64,
        native_response_hash: HEX64,
        latency_ms: 100,
        status_code: 200,
        occurred_at: new Date('2026-06-15T00:00:00.000Z'),
        credential_source: 'tenant_provider_credential',
        allowlist_version: 'anthropic-beta-policy@2026-05-06',
        body_forward_mode: 'raw',
      }),
    ).toThrow(/capability_canonical_level required/);
  });
});
