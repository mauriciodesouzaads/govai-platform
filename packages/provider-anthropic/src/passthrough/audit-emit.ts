// Audit event emit helpers for Anthropic passthrough — Decisão 4 / HAE-002 enforced.
// Every event for a provider-namespaced capability_id MUST set both:
//   - capability_level             (operational mode of the route)
//   - capability_canonical_level   (registry-canonical level — distinct concept)

import { randomUUID } from 'node:crypto';
import {
  PassthroughInvokedSchema,
  PassthroughBetaDeniedSchema,
  ToolValidationBlockedSchema,
  type PassthroughInvoked,
  type PassthroughBetaDenied,
  type ToolValidationBlocked,
} from '@govai/core-events';
import { KNOWN_ANTHROPIC_TAXONOMY_VERSION } from '../tool-taxonomy-version.js';

export type TenantContext = {
  org_id: string;
  tenant_id?: string;
  user_id?: string;
  tier: 'starter' | 'business' | 'enterprise' | 'regulated';
  operational_mode: 'production' | 'pilot' | 'dev' | 'test';
};

export type BuildPassthroughInvokedInput = {
  tenant: TenantContext;
  capability_id: string;
  /** Operational mode of the route (passthrough_audited for /passthrough/anthropic/*). */
  capability_level: 'passthrough_audited' | 'policy_governed' | 'evidence_grade';
  /** Registry-canonical level for the capability — REQUIRED for provider-namespaced ids. */
  capability_canonical_level: 'passthrough_audited' | 'policy_governed' | 'evidence_grade';
  native_endpoint: string;
  native_method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  is_stream: boolean;
  is_multipart: boolean;
  base_risk_class: 'A' | 'B' | 'C' | 'D' | 'E';
  effective_risk_class: 'A' | 'B' | 'C' | 'D' | 'E';
  risk_escalation_reasons?: string[];
  enforcement_decision:
    | 'observe'
    | 'warn'
    | 'ask'
    | 'enforce'
    | 'sandbox_required'
    | 'blocked';
  native_request_hash: string;
  native_response_hash?: string;
  stream_final_hash?: string;
  latency_ms: number;
  status_code: number;
  credential_source: string;
  allowlist_version: string;
  provider_request_id?: string;
  body_forward_mode: 'raw' | 'redacted' | 'blocked';
  beta_allowlist_sources?: PassthroughInvoked['beta_allowlist_sources'];
  detected_tool_classifications?: PassthroughInvoked['detected_tool_classifications'];
};

/**
 * Build (and validate) a `passthrough.invoked` v3 event. Throws if the schema
 * does not pass — this is intentional: the emitter is the last line of defense
 * and must never produce malformed events into the audit chain.
 */
export function buildPassthroughInvoked(
  input: BuildPassthroughInvokedInput,
): PassthroughInvoked {
  const ev = {
    event_type: 'passthrough.invoked',
    schema_version: 3,
    tenant_context: input.tenant,
    provider: 'anthropic' as const,
    capability_id: input.capability_id,
    capability_level: input.capability_level,
    capability_canonical_level: input.capability_canonical_level,
    native_endpoint: input.native_endpoint,
    native_method: input.native_method,
    is_stream: input.is_stream,
    is_multipart: input.is_multipart,
    base_risk_class: input.base_risk_class,
    effective_risk_class: input.effective_risk_class,
    risk_escalation_reasons: input.risk_escalation_reasons ?? [],
    enforcement_decision: input.enforcement_decision,
    native_request_hash: input.native_request_hash,
    native_response_hash: input.native_response_hash,
    stream_final_hash: input.stream_final_hash,
    latency_ms: input.latency_ms,
    status_code: input.status_code,
    credential_source: input.credential_source,
    allowlist_version: input.allowlist_version,
    provider_request_id: input.provider_request_id,
    body_forward_mode: input.body_forward_mode,
    dlp_decisions: [],
    beta_allowlist_sources: input.beta_allowlist_sources ?? [],
    detected_tool_classifications: input.detected_tool_classifications ?? [],
    tools_taxonomy_version:
      (input.detected_tool_classifications?.length ?? 0) > 0
        ? KNOWN_ANTHROPIC_TAXONOMY_VERSION
        : undefined,
    audit_event_id: randomUUID(),
    chain_id: 'run' as const,
  };
  return PassthroughInvokedSchema.parse(ev);
}

export type BuildPassthroughBetaDeniedInput = {
  tenant: TenantContext;
  capability_id: string;
  beta_token: string;
  policy_at_resolution: PassthroughBetaDenied['policy_at_resolution'];
  reason_code: PassthroughBetaDenied['reason_code'];
};

export function buildPassthroughBetaDenied(
  input: BuildPassthroughBetaDeniedInput,
): PassthroughBetaDenied {
  return PassthroughBetaDeniedSchema.parse({
    event_type: 'passthrough.beta_denied',
    schema_version: 1,
    tenant_context: input.tenant,
    provider: 'anthropic',
    capability_id: input.capability_id,
    beta_token: input.beta_token,
    policy_at_resolution: input.policy_at_resolution,
    reason_code: input.reason_code,
    audit_event_id: randomUUID(),
    chain_id: 'run',
  });
}

export type BuildToolValidationBlockedInput = {
  tenant: TenantContext;
  capability_id: string;
  tool_index: number;
  tool_type?: string | undefined;
  tool_type_observed?: ToolValidationBlocked['tool_type_observed'];
  classification: ToolValidationBlocked['classification'];
  reason: ToolValidationBlocked['reason'];
  reason_detail?: string;
};

export function buildToolValidationBlocked(
  input: BuildToolValidationBlockedInput,
): ToolValidationBlocked {
  return ToolValidationBlockedSchema.parse({
    event_type: 'tool.validation_blocked',
    schema_version: 1,
    tenant_context: input.tenant,
    provider: 'anthropic',
    capability_id: input.capability_id,
    tool_index: input.tool_index,
    tool_type: input.tool_type,
    tool_type_observed: input.tool_type_observed,
    classification: input.classification,
    reason: input.reason,
    reason_detail: input.reason_detail,
    tools_taxonomy_version: KNOWN_ANTHROPIC_TAXONOMY_VERSION,
    audit_event_id: randomUUID(),
    chain_id: 'run',
  });
}
