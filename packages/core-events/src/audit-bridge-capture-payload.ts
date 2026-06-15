// AuditBridgeCapturePayloadV1 — the closed, immutable semantic-evidence
// projection of a validated `PassthroughInvoked v3` envelope (ADR-028 §7,
// SPEC-01 §4). The capture `payloadHash` is `sha256(canonicalize(projection))`
// — NOT the hash of the whole envelope, and NOT any single native_*_hash.
//
// Construction law (RR-000 A9, MANDATORY): the projection is built
// FIELD-BY-FIELD. Object spread from the envelope or any sub-object is
// FORBIDDEN, so unknown/future/banned keys can never flow into the hash. Every
// nested object below is re-projected explicitly. `usage_json` is
// `.passthrough()` in the v3 schema, so only its five documented numeric fields
// are read here (its arbitrary extra keys are intentionally dropped). The
// banned payload keys (prompt/response/raw_input/raw_output/messages/
// completion/requestBody/responseBody) can therefore never appear at any depth
// — guarded by the deep-leak test (U6). Optional fields left `undefined` are
// omitted by `canonicalize` and are therefore absent from the hash.

import { z } from 'zod';

import { BetaPolicyAtResolutionEnum, ToolClassificationEnum } from './passthrough-invoked.js';
import type { PassthroughInvoked } from './passthrough-invoked.js';

const RiskClassEnum = z.enum(['A', 'B', 'C', 'D', 'E']);
const CapabilityLevelEnum = z.enum(['passthrough_audited', 'policy_governed', 'evidence_grade']);

const UsageProjectionSchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
  cache_read_tokens: z.number().int().nonnegative().optional(),
  cache_creation_tokens: z.number().int().nonnegative().optional(),
});

const DlpDecisionProjectionSchema = z.object({
  phase: z.enum([
    'pre_request',
    'post_response',
    'file_upload',
    'pre_response_content',
    'file_addition_to_vector_store',
  ]),
  findings_count: z.number().int().nonnegative(),
  finding_classes: z.array(z.string()),
  action: z.enum(['none', 'warn', 'redact', 'block', 'ask']),
});

const BetaAllowlistSourceProjectionSchema = z.object({
  beta_token: z.string(),
  source: z.enum(['global_allowlist', 'org_override', 'legacy_no_longer_needed']),
  override_id: z.string().uuid().optional(),
  policy_at_resolution: BetaPolicyAtResolutionEnum,
});

const ToolClassificationProjectionSchema = z.object({
  tool_index: z.number().int().nonnegative(),
  tool_type: z.string().optional(),
  classification: ToolClassificationEnum,
  contributed_risk_class: RiskClassEnum,
  decision: z.enum(['allowed', 'escalated', 'blocked_at_validation']),
});

export const AuditBridgeCapturePayloadV1Schema = z.object({
  schema: z.literal('audit_bridge_capture_payload'),
  schema_version: z.literal(1),
  event_type: z.literal('passthrough.invoked'),
  event_schema_version: z.literal(3),
  chain_category: z.literal('run'),
  provider: z.enum(['anthropic', 'openai']),
  capability_id: z.string(),
  capability_level: CapabilityLevelEnum,
  capability_canonical_level: CapabilityLevelEnum.optional(),
  native_endpoint: z.string(),
  native_method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  is_stream: z.boolean(),
  is_multipart: z.boolean(),
  base_risk_class: RiskClassEnum,
  effective_risk_class: RiskClassEnum,
  risk_escalation_reasons: z.array(z.string()),
  enforcement_decision: z.enum([
    'observe',
    'warn',
    'ask',
    'enforce',
    'sandbox_required',
    'blocked',
  ]),
  native_request_hash: z.string(),
  native_response_hash: z.string().optional(),
  stream_final_hash: z.string().optional(),
  status_code: z.number().int(),
  usage: UsageProjectionSchema.optional(),
  credential_source: z.string(),
  allowlist_version: z.string(),
  body_forward_mode: z.enum(['raw', 'redacted', 'blocked']),
  dlp_decisions: z.array(DlpDecisionProjectionSchema),
  beta_allowlist_sources: z.array(BetaAllowlistSourceProjectionSchema),
  detected_tool_classifications: z.array(ToolClassificationProjectionSchema),
  tools_taxonomy_version: z.string().optional(),
  // R2 (HAE-003 coupled trio): all three travel together in the immutable hash.
  purpose_deprecated: z.boolean().optional(),
  purpose_deprecation_sunset_at: z.string().optional(),
  purpose_deprecation_migration_target: z.string().optional(),
  tenant: z.object({
    org_id: z.string().uuid(),
    tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
    operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
    // Deliberate privacy choice (SPEC-01 rev3): user_id is committed to the hash
    // when present (who-acted-at-event-time). Erasure is handled at the
    // chain/retention layer (B3-era), never by rewriting a historical capture.
    user_id: z.string().uuid().optional(),
  }),
});

export type AuditBridgeCapturePayloadV1 = z.infer<typeof AuditBridgeCapturePayloadV1Schema>;

/** Project the five documented numeric fields of `usage_json` (a `.passthrough()`
 *  object) into the closed `usage` projection — extra keys are dropped. */
function projectUsage(
  u: PassthroughInvoked['usage_json'],
): AuditBridgeCapturePayloadV1['usage'] {
  if (u === undefined) return undefined;
  return {
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    total_tokens: u.total_tokens,
    cache_read_tokens: u.cache_read_tokens,
    cache_creation_tokens: u.cache_creation_tokens,
  };
}

/**
 * Pure projection of a validated `PassthroughInvoked v3` envelope into the
 * immutable `AuditBridgeCapturePayloadV1`. Built field-by-field (no spread).
 * Per-attempt fields (`audit_event_id`, `latency_ms`, `provider_request_id`,
 * raw `govai_request_id`) are excluded here and travel in
 * `redactionMetadata.audit_bridge` (built by the dispatcher), never in the hash.
 */
export function projectCapturePayloadV1(e: PassthroughInvoked): AuditBridgeCapturePayloadV1 {
  return {
    schema: 'audit_bridge_capture_payload',
    schema_version: 1,
    event_type: e.event_type,
    event_schema_version: e.schema_version,
    chain_category: e.chain_category,
    provider: e.provider,
    capability_id: e.capability_id,
    capability_level: e.capability_level,
    capability_canonical_level: e.capability_canonical_level,
    native_endpoint: e.native_endpoint,
    native_method: e.native_method,
    is_stream: e.is_stream,
    is_multipart: e.is_multipart,
    base_risk_class: e.base_risk_class,
    effective_risk_class: e.effective_risk_class,
    risk_escalation_reasons: e.risk_escalation_reasons.map((r) => r),
    enforcement_decision: e.enforcement_decision,
    native_request_hash: e.native_request_hash,
    native_response_hash: e.native_response_hash,
    stream_final_hash: e.stream_final_hash,
    status_code: e.status_code,
    usage: projectUsage(e.usage_json),
    credential_source: e.credential_source,
    allowlist_version: e.allowlist_version,
    body_forward_mode: e.body_forward_mode,
    dlp_decisions: e.dlp_decisions.map((d) => ({
      phase: d.phase,
      findings_count: d.findings_count,
      finding_classes: d.finding_classes.map((f) => f),
      action: d.action,
    })),
    beta_allowlist_sources: e.beta_allowlist_sources.map((b) => ({
      beta_token: b.beta_token,
      source: b.source,
      override_id: b.override_id,
      policy_at_resolution: b.policy_at_resolution,
    })),
    detected_tool_classifications: e.detected_tool_classifications.map((t) => ({
      tool_index: t.tool_index,
      tool_type: t.tool_type,
      classification: t.classification,
      contributed_risk_class: t.contributed_risk_class,
      decision: t.decision,
    })),
    tools_taxonomy_version: e.tools_taxonomy_version,
    // R2: HAE-003 coupled trio, read explicitly. When `purpose_deprecated` is
    // absent the schema guarantees the other two are absent too, so all three
    // are omitted from the projection (and thus the hash) together.
    purpose_deprecated: e.purpose_deprecated,
    purpose_deprecation_sunset_at: e.purpose_deprecation_sunset_at,
    purpose_deprecation_migration_target: e.purpose_deprecation_migration_target,
    tenant: {
      org_id: e.tenant_context.org_id,
      tier: e.tenant_context.tier,
      operational_mode: e.tenant_context.operational_mode,
      user_id: e.tenant_context.user_id,
    },
  };
}
