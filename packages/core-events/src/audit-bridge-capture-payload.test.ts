import { describe, it, expect } from 'vitest';

import { projectCapturePayloadV1, AuditBridgeCapturePayloadV1Schema } from './audit-bridge-capture-payload.js';
import type { PassthroughInvoked } from './passthrough-invoked.js';

// B0+B1 banned redaction keys (capture.ts ALL_BANNED_REDACTION_KEYS) — hard-coded
// here because core-events does not depend on core-audit. The projection must
// never contain any of these at ANY depth (SPEC-01 §4 deep-leak law / U6).
const BANNED_KEYS = [
  'prompt',
  'response',
  'raw_input',
  'raw_output',
  'messages',
  'completion',
  'requestBody',
  'responseBody',
];

function baseEnvelope(): PassthroughInvoked {
  return {
    event_type: 'passthrough.invoked',
    schema_version: 4,
    tenant_context: {
      org_id: '11111111-1111-4111-8111-111111111111',
      tier: 'business',
      operational_mode: 'production',
    },
    provider: 'anthropic',
    capability_id: 'anthropic.messages.create',
    capability_level: 'passthrough_audited',
    capability_canonical_level: 'policy_governed',
    native_endpoint: '/passthrough/anthropic/v1/messages',
    native_method: 'POST',
    is_stream: false,
    is_multipart: false,
    base_risk_class: 'B',
    effective_risk_class: 'B',
    risk_escalation_reasons: [],
    enforcement_decision: 'observe',
    native_request_hash: 'a'.repeat(64),
    native_response_hash: 'b'.repeat(64),
    latency_ms: 42,
    status_code: 200,
    occurred_at: '2026-06-15T00:00:00.000Z',
    credential_source: 'tenant_db',
    allowlist_version: 'v1',
    provider_request_id: 'req_baseline',
    body_forward_mode: 'raw',
    dlp_decisions: [],
    beta_allowlist_sources: [],
    detected_tool_classifications: [],
    audit_event_id: '99999999-9999-4999-8999-999999999999',
    chain_category: 'run',
  };
}

function populatedEnvelope(): PassthroughInvoked {
  return {
    ...baseEnvelope(),
    risk_escalation_reasons: ['tool_escalation'],
    usage_json: {
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      cache_read_tokens: 1,
      cache_creation_tokens: 2,
    },
    dlp_decisions: [
      { phase: 'pre_request', findings_count: 1, finding_classes: ['cpf'], action: 'warn' },
    ],
    beta_allowlist_sources: [
      {
        beta_token: 'beta-x',
        source: 'global_allowlist',
        override_id: '22222222-2222-4222-8222-222222222222',
        policy_at_resolution: 'global_allowlist',
      },
    ],
    detected_tool_classifications: [
      {
        tool_index: 0,
        tool_type: 'web_search',
        classification: 'anthropic_provider_hosted_web_search',
        contributed_risk_class: 'C',
        decision: 'allowed',
      },
    ],
    tools_taxonomy_version: 'tax-v1',
  };
}

function assertNoBannedKeysDeep(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoBannedKeysDeep(v, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (BANNED_KEYS.includes(k)) {
        throw new Error(`banned key "${k}" leaked at ${path}`);
      }
      assertNoBannedKeysDeep(v, `${path}.${k}`);
    }
  }
}

describe('projectCapturePayloadV1', () => {
  it('produces a payload that validates against the V1 schema', () => {
    const parsed = AuditBridgeCapturePayloadV1Schema.safeParse(projectCapturePayloadV1(baseEnvelope()));
    expect(parsed.success).toBe(true);
  });

  it('projects populated arrays, usage, and tool classifications field-by-field', () => {
    const p = projectCapturePayloadV1(populatedEnvelope());
    expect(AuditBridgeCapturePayloadV1Schema.safeParse(p).success).toBe(true);
    expect(p.risk_escalation_reasons).toEqual(['tool_escalation']);
    expect(p.usage).toEqual({
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      cache_read_tokens: 1,
      cache_creation_tokens: 2,
    });
    expect(p.dlp_decisions).toEqual([
      { phase: 'pre_request', findings_count: 1, finding_classes: ['cpf'], action: 'warn' },
    ]);
    expect(p.beta_allowlist_sources).toEqual([
      {
        beta_token: 'beta-x',
        source: 'global_allowlist',
        override_id: '22222222-2222-4222-8222-222222222222',
        policy_at_resolution: 'global_allowlist',
      },
    ]);
    expect(p.detected_tool_classifications).toEqual([
      {
        tool_index: 0,
        tool_type: 'web_search',
        classification: 'anthropic_provider_hosted_web_search',
        contributed_risk_class: 'C',
        decision: 'allowed',
      },
    ]);
    expect(p.tools_taxonomy_version).toBe('tax-v1');
  });

  it('carries the closed projection constants', () => {
    const p = projectCapturePayloadV1(baseEnvelope());
    expect(p.schema).toBe('audit_bridge_capture_payload');
    expect(p.schema_version).toBe(1);
    expect(p.event_type).toBe('passthrough.invoked');
    expect(p.event_schema_version).toBe(4);
    expect(p.chain_category).toBe('run');
  });

  // U1 — stability law (projection level; the payloadHash proof is in the bridge test).
  it('U1: differing only in EXCLUDED per-attempt fields yields an identical projection', () => {
    const a = baseEnvelope();
    const b: PassthroughInvoked = {
      ...baseEnvelope(),
      latency_ms: 999999,
      provider_request_id: 'req_totally_different',
      audit_event_id: '00000000-0000-4000-8000-000000000000',
    };
    expect(projectCapturePayloadV1(a)).toEqual(projectCapturePayloadV1(b));
  });

  it('U1: changing an INCLUDED field changes the projection', () => {
    const a = baseEnvelope();
    const b: PassthroughInvoked = { ...baseEnvelope(), status_code: 503 };
    expect(projectCapturePayloadV1(a)).not.toEqual(projectCapturePayloadV1(b));
  });

  // EP-008C — the terminal stream outcome reaches the IMMUTABLE projection, so a clean vs broken
  // stream terminal with the SAME request+stream hashes produce DIFFERENT payloads (→ hashes).
  it('EP-008C: stream_outcome is projected — complete vs client_disconnect differ; absent is omitted', () => {
    const streamBase: PassthroughInvoked = {
      ...baseEnvelope(),
      is_stream: true,
      stream_final_hash: 'c'.repeat(64),
    };
    const complete = projectCapturePayloadV1({ ...streamBase, stream_outcome: 'complete' });
    const disconnect = projectCapturePayloadV1({ ...streamBase, stream_outcome: 'client_disconnect' });
    expect(complete.stream_outcome).toBe('complete');
    expect(disconnect.stream_outcome).toBe('client_disconnect');
    // identical request + stream hashes, differ ONLY in stream_outcome → DIFFERENT projection
    // (and therefore a different canonical payload hash — the whole point of EP-008C).
    expect(complete).not.toEqual(disconnect);
    expect(AuditBridgeCapturePayloadV1Schema.safeParse(complete).success).toBe(true);
    expect(AuditBridgeCapturePayloadV1Schema.safeParse(disconnect).success).toBe(true);
    // additive-optional: absent stream_outcome is omitted (legacy/non-stream captures hash unchanged).
    expect(projectCapturePayloadV1(streamBase).stream_outcome).toBeUndefined();
  });

  // R1 — the projector reads the REAL field `usage_json` and writes payload key `usage`.
  it('R1: usage_json present populates payload.usage; a change to usage_json changes the projection', () => {
    const withUsage: PassthroughInvoked = {
      ...baseEnvelope(),
      usage_json: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    };
    const p = projectCapturePayloadV1(withUsage);
    expect(p.usage).toEqual({ input_tokens: 10, output_tokens: 20, total_tokens: 30 });

    const mutated: PassthroughInvoked = {
      ...baseEnvelope(),
      usage_json: { input_tokens: 11, output_tokens: 20, total_tokens: 30 },
    };
    expect(projectCapturePayloadV1(mutated).usage).not.toEqual(p.usage);

    expect(projectCapturePayloadV1(baseEnvelope()).usage).toBeUndefined();
  });

  // U8 — purpose deprecation trio coherence-in-hash (R2).
  it('U8: purpose_deprecated=true projects all three coupled fields', () => {
    const e: PassthroughInvoked = {
      ...baseEnvelope(),
      purpose_deprecated: true,
      purpose_deprecation_sunset_at: '2026-12-31T00:00:00.000Z',
      purpose_deprecation_migration_target: 'responses_api+conversations_api',
    };
    const p = projectCapturePayloadV1(e);
    expect(p.purpose_deprecated).toBe(true);
    expect(p.purpose_deprecation_sunset_at).toBe('2026-12-31T00:00:00.000Z');
    expect(p.purpose_deprecation_migration_target).toBe('responses_api+conversations_api');
  });

  it('U8: mutating EITHER accompanying purpose field changes the projection', () => {
    const base: PassthroughInvoked = {
      ...baseEnvelope(),
      purpose_deprecated: true,
      purpose_deprecation_sunset_at: '2026-12-31T00:00:00.000Z',
      purpose_deprecation_migration_target: 'responses_api',
    };
    const diffSunset: PassthroughInvoked = {
      ...base,
      purpose_deprecation_sunset_at: '2027-01-01T00:00:00.000Z',
    };
    const diffTarget: PassthroughInvoked = { ...base, purpose_deprecation_migration_target: 'other' };
    expect(projectCapturePayloadV1(base)).not.toEqual(projectCapturePayloadV1(diffSunset));
    expect(projectCapturePayloadV1(base)).not.toEqual(projectCapturePayloadV1(diffTarget));
  });

  it('U8: purpose_deprecated absent carries none of the three (mirrors HAE-003)', () => {
    const p = projectCapturePayloadV1(baseEnvelope());
    expect(p.purpose_deprecated).toBeUndefined();
    expect(p.purpose_deprecation_sunset_at).toBeUndefined();
    expect(p.purpose_deprecation_migration_target).toBeUndefined();
  });

  // U6 — deep-leak: banned keys nested at >=3 depths (incl. usage_json passthrough)
  // never reach the projection, and no raw value survives.
  it('U6: nested banned keys and raw values never appear in the projection', () => {
    const RAW = 'RAW_SENSITIVE_DO_NOT_LEAK';
    const rawEnvelope = {
      ...baseEnvelope(),
      // depth 2: passthrough object keeps unknown keys after parse — must be dropped here.
      usage_json: { input_tokens: 1, prompt: RAW, messages: [{ requestBody: RAW }] },
      // depth 2: tenant_context unknown key.
      tenant_context: {
        org_id: '11111111-1111-4111-8111-111111111111',
        tier: 'business',
        operational_mode: 'production',
        response: RAW,
      },
      // depth 3: array-element unknown key.
      dlp_decisions: [
        {
          phase: 'pre_request',
          findings_count: 0,
          finding_classes: [],
          action: 'none',
          raw_output: { completion: RAW },
        },
      ],
      // top-level banned key.
      prompt: RAW,
    } as unknown as PassthroughInvoked;

    const p = projectCapturePayloadV1(rawEnvelope);
    assertNoBannedKeysDeep(p);
    expect(JSON.stringify(p)).not.toContain(RAW);
    // sanity: the legitimate numeric field still came through.
    expect(p.usage).toEqual({ input_tokens: 1 });
  });
});
