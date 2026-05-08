// Decisão 4 / HAE-002 — capability_canonical_level for openai.* events.
// HAE-003 — purpose_deprecated coherence (Rule 7) exercised via the emitter.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildPassthroughInvoked } from './audit-emit.js';
import { KNOWN_OPENAI_TAXONOMY_VERSION } from '../tool-taxonomy-version.js';

const HEX64 = 'a'.repeat(64);

function tenant() {
  return {
    org_id: randomUUID(),
    tier: 'enterprise' as const,
    operational_mode: 'test' as const,
  };
}

describe('Decisão 4 — passthrough.invoked v3 distinguishes operational from canonical (OpenAI)', () => {
  it('/v1/responses non-stream — openai.responses.create: operational=passthrough_audited, canonical=policy_governed', () => {
    const ev = buildPassthroughInvoked({
      tenant: tenant(),
      capability_id: 'openai.responses.create',
      capability_level: 'passthrough_audited',
      capability_canonical_level: 'policy_governed',
      native_endpoint: '/v1/responses',
      native_method: 'POST',
      is_stream: false,
      is_multipart: false,
      base_risk_class: 'A',
      effective_risk_class: 'A',
      enforcement_decision: 'observe',
      native_request_hash: HEX64,
      native_response_hash: HEX64,
      latency_ms: 90,
      status_code: 200,
      credential_source: 'tenant_provider_credential',
      allowlist_version: 'openai-beta-policy@2026-05-06',
      body_forward_mode: 'raw',
    });
    expect(ev.capability_level).toBe('passthrough_audited');
    expect(ev.capability_canonical_level).toBe('policy_governed');
    expect(ev.provider).toBe('openai');
  });

  it('/v1/responses stream — openai.responses.stream: same distinction with stream_final_hash', () => {
    const ev = buildPassthroughInvoked({
      tenant: tenant(),
      capability_id: 'openai.responses.stream',
      capability_level: 'passthrough_audited',
      capability_canonical_level: 'policy_governed',
      native_endpoint: '/v1/responses',
      native_method: 'POST',
      is_stream: true,
      is_multipart: false,
      base_risk_class: 'A',
      effective_risk_class: 'A',
      enforcement_decision: 'observe',
      native_request_hash: HEX64,
      stream_final_hash: HEX64,
      latency_ms: 200,
      status_code: 200,
      credential_source: 'tenant_provider_credential',
      allowlist_version: 'openai-beta-policy@2026-05-06',
      body_forward_mode: 'raw',
    });
    expect(ev.is_stream).toBe(true);
    expect(ev.stream_final_hash).toBe(HEX64);
    expect(ev.capability_canonical_level).toBe('policy_governed');
  });

  it('/v1/embeddings — openai.embeddings: BOTH levels passthrough_audited', () => {
    const ev = buildPassthroughInvoked({
      tenant: tenant(),
      capability_id: 'openai.embeddings',
      capability_level: 'passthrough_audited',
      capability_canonical_level: 'passthrough_audited',
      native_endpoint: '/v1/embeddings',
      native_method: 'POST',
      is_stream: false,
      is_multipart: false,
      base_risk_class: 'B',
      effective_risk_class: 'B',
      enforcement_decision: 'observe',
      native_request_hash: HEX64,
      native_response_hash: HEX64,
      latency_ms: 30,
      status_code: 200,
      credential_source: 'tenant_provider_credential',
      allowlist_version: 'openai-beta-policy@2026-05-06',
      body_forward_mode: 'raw',
    });
    expect(ev.capability_level).toBe('passthrough_audited');
    expect(ev.capability_canonical_level).toBe('passthrough_audited');
  });

  it('detected_tool_classifications populates tools_taxonomy_version automatically (OpenAI)', () => {
    const ev = buildPassthroughInvoked({
      tenant: tenant(),
      capability_id: 'openai.responses.create',
      capability_level: 'passthrough_audited',
      capability_canonical_level: 'policy_governed',
      native_endpoint: '/v1/responses',
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
      credential_source: 'tenant_provider_credential',
      allowlist_version: 'openai-beta-policy@2026-05-06',
      body_forward_mode: 'raw',
      detected_tool_classifications: [
        {
          tool_index: 0,
          tool_type: 'web_search',
          classification: 'openai_provider_hosted_web_search',
          contributed_risk_class: 'C',
          decision: 'allowed',
        },
      ],
    });
    expect(ev.tools_taxonomy_version).toBe(KNOWN_OPENAI_TAXONOMY_VERSION);
  });

  it('throws when caller would emit openai.* without canonical_level (HAE-002 Rule 6)', () => {
    expect(() =>
      buildPassthroughInvoked({
        tenant: tenant(),
        capability_id: 'openai.responses.create',
        capability_level: 'passthrough_audited',
        capability_canonical_level: undefined as unknown as 'policy_governed',
        native_endpoint: '/v1/responses',
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
        credential_source: 'tenant_provider_credential',
        allowlist_version: 'openai-beta-policy@2026-05-06',
        body_forward_mode: 'raw',
      }),
    ).toThrow(/capability_canonical_level required/);
  });
});

describe('HAE-003 — purpose_deprecated coherence on the emitter', () => {
  it('emit /v1/files with purpose=assistants pre-sunset → all 3 fields populated', () => {
    const ev = buildPassthroughInvoked({
      tenant: tenant(),
      capability_id: 'openai.files',
      capability_level: 'passthrough_audited',
      capability_canonical_level: 'passthrough_audited',
      native_endpoint: '/v1/files',
      native_method: 'POST',
      is_stream: false,
      is_multipart: true,
      base_risk_class: 'B',
      effective_risk_class: 'B',
      enforcement_decision: 'observe',
      native_request_hash: HEX64,
      native_response_hash: HEX64,
      latency_ms: 60,
      status_code: 200,
      credential_source: 'tenant_provider_credential',
      allowlist_version: 'openai-beta-policy@2026-05-06',
      body_forward_mode: 'raw',
      purpose_deprecated: true,
      purpose_deprecation_sunset_at: '2026-08-26T00:00:00.000Z',
      purpose_deprecation_migration_target: 'responses_api+conversations_api',
    });
    expect(ev.purpose_deprecated).toBe(true);
    expect(ev.purpose_deprecation_sunset_at).toBe('2026-08-26T00:00:00.000Z');
    expect(ev.purpose_deprecation_migration_target).toBe('responses_api+conversations_api');
  });

  it('emit /v1/files without purpose flag → no deprecation fields', () => {
    const ev = buildPassthroughInvoked({
      tenant: tenant(),
      capability_id: 'openai.files',
      capability_level: 'passthrough_audited',
      capability_canonical_level: 'passthrough_audited',
      native_endpoint: '/v1/files',
      native_method: 'GET',
      is_stream: false,
      is_multipart: false,
      base_risk_class: 'B',
      effective_risk_class: 'B',
      enforcement_decision: 'observe',
      native_request_hash: HEX64,
      native_response_hash: HEX64,
      latency_ms: 20,
      status_code: 200,
      credential_source: 'tenant_provider_credential',
      allowlist_version: 'openai-beta-policy@2026-05-06',
      body_forward_mode: 'raw',
    });
    expect(ev.purpose_deprecated).toBeUndefined();
    expect(ev.purpose_deprecation_sunset_at).toBeUndefined();
    expect(ev.purpose_deprecation_migration_target).toBeUndefined();
  });

  it('throws on inconsistent emit (purpose_deprecated=true without sunset_at)', () => {
    expect(() =>
      buildPassthroughInvoked({
        tenant: tenant(),
        capability_id: 'openai.files',
        capability_level: 'passthrough_audited',
        capability_canonical_level: 'passthrough_audited',
        native_endpoint: '/v1/files',
        native_method: 'POST',
        is_stream: false,
        is_multipart: true,
        base_risk_class: 'B',
        effective_risk_class: 'B',
        enforcement_decision: 'observe',
        native_request_hash: HEX64,
        native_response_hash: HEX64,
        latency_ms: 60,
        status_code: 200,
        credential_source: 'tenant_provider_credential',
        allowlist_version: 'openai-beta-policy@2026-05-06',
        body_forward_mode: 'raw',
        purpose_deprecated: true,
        purpose_deprecation_migration_target: 'responses_api',
      }),
    ).toThrow(/purpose_deprecation_sunset_at/);
  });
});
