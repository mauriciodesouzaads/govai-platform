// PassthroughInvokedSchema v3 — Peça A v2 §13.1 + Matrix v2.0.1 P2.
// Mandatory rules:
//   1) is_stream=true → stream_final_hash; non-stream raw → native_response_hash
//      for ANY status code (2xx, 4xx, 5xx)  [P2 v2.0.1]
//   2) enforcement_decision='blocked' → body_forward_mode='blocked'
//   3) capability_level='passthrough_audited' → body_forward_mode != 'redacted'
//   4) capability_level='passthrough_audited' AND non-blocked forward → body_forward_mode='raw'
//   5) detected_tool_classifications.length > 0 → tools_taxonomy_version is set

import { z } from 'zod';

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

const UsageJsonSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
    cache_read_tokens: z.number().int().nonnegative().optional(),
    cache_creation_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const ToolClassificationEnum = z.enum([
  // Anthropic
  'client_defined',
  'anthropic_defined_client_executed_text_editor',
  'anthropic_defined_client_executed_bash',
  'anthropic_provider_hosted_web_search',
  'anthropic_provider_hosted_code_execution',
  'anthropic_provider_hosted_computer_use',
  'anthropic_typed_unknown',
  // OpenAI
  'function_chat_completions',
  'function_responses',
  'openai_provider_hosted_web_search',
  'openai_provider_hosted_file_search',
  'openai_provider_hosted_tool_search',
  'openai_provider_hosted_code_interpreter',
  'openai_provider_hosted_computer_use',
  'openai_provider_hosted_hosted_shell',
  'openai_provider_hosted_apply_patch',
  'openai_provider_hosted_mcp',
  'openai_typed_unknown',
]);

export const BetaPolicyAtResolutionEnum = z.enum([
  'global_allowlist',
  'org_override_allowed',
  'hard_denied',
  'verification_required',
  'denied_until_decision',
  'removed_as_no_longer_needed',
]);

export const PassthroughInvokedSchema = z
  .object({
    event_type: z.literal('passthrough.invoked'),
    schema_version: z.literal(3),

    tenant_context: TenantContextSchema,

    provider: z.enum(['anthropic', 'openai']),
    capability_id: z.string().min(1),
    capability_level: z.enum(['passthrough_audited', 'policy_governed', 'evidence_grade']),

    native_endpoint: z.string().min(1),
    native_method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
    is_stream: z.boolean(),
    is_multipart: z.boolean(),

    base_risk_class: z.enum(['A', 'B', 'C', 'D', 'E']),
    effective_risk_class: z.enum(['A', 'B', 'C', 'D', 'E']),
    risk_escalation_reasons: z.array(z.string()).default([]),
    enforcement_decision: z.enum([
      'observe',
      'warn',
      'ask',
      'enforce',
      'sandbox_required',
      'blocked',
    ]),

    native_request_hash: z.string().regex(/^[0-9a-f]{64}$/),
    native_response_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    stream_final_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),

    latency_ms: z.number().int().nonnegative(),
    status_code: z.number().int(),
    usage_json: UsageJsonSchema.optional(),
    credential_source: z.string().min(1),

    allowlist_version: z.string().min(1),
    provider_request_id: z.string().optional(),
    body_forward_mode: z.enum(['raw', 'redacted', 'blocked']),

    dlp_decisions: z
      .array(
        z.object({
          phase: z.enum([
            'pre_request',
            'post_response',
            'file_upload',
            'pre_response_content',
            'file_addition_to_vector_store',
          ]),
          findings_count: z.number().int().nonnegative(),
          finding_classes: z.array(z.string()).default([]),
          action: z.enum(['none', 'warn', 'redact', 'block', 'ask']),
        }),
      )
      .default([]),

    beta_allowlist_sources: z
      .array(
        z.object({
          beta_token: z.string().min(1),
          source: z.enum(['global_allowlist', 'org_override', 'legacy_no_longer_needed']),
          override_id: z.string().uuid().optional(),
          policy_at_resolution: BetaPolicyAtResolutionEnum,
        }),
      )
      .default([]),

    detected_tool_classifications: z
      .array(
        z.object({
          tool_index: z.number().int().nonnegative(),
          tool_type: z.string().optional(),
          classification: ToolClassificationEnum,
          contributed_risk_class: z.enum(['A', 'B', 'C', 'D', 'E']),
          decision: z.enum(['allowed', 'escalated', 'blocked_at_validation']),
        }),
      )
      .default([]),

    tools_taxonomy_version: z.string().optional(),

    /** OpenAI Files: legacy purpose=assistants signal — see Matrix §18.6. */
    purpose_deprecated: z.boolean().optional(),

    audit_event_id: z.string().uuid(),
    chain_id: z.literal('run'),
  })
  .superRefine((data, ctx) => {
    // Rule 1 (P2 v2.0.1): hash invariants for stream vs non-stream raw responses.
    if (data.is_stream && !data.stream_final_hash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'is_stream=true requires stream_final_hash',
        path: ['stream_final_hash'],
      });
    }
    if (
      !data.is_stream &&
      data.body_forward_mode === 'raw' &&
      !data.native_response_hash
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'non-stream raw provider response requires native_response_hash for any provider status (2xx, 4xx, 5xx)',
        path: ['native_response_hash'],
      });
    }

    // Rule 2: enforcement=blocked → body_forward_mode=blocked.
    if (data.enforcement_decision === 'blocked' && data.body_forward_mode !== 'blocked') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'enforcement=blocked requires body_forward_mode=blocked',
        path: ['body_forward_mode'],
      });
    }

    // Rule 3: passthrough_audited never allows redacted.
    if (
      data.capability_level === 'passthrough_audited' &&
      data.body_forward_mode === 'redacted'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'passthrough_audited capability_level does not allow redacted body_forward_mode',
        path: ['body_forward_mode'],
      });
    }

    // Rule 4: passthrough_audited forward (non-blocked) must be raw.
    if (
      data.capability_level === 'passthrough_audited' &&
      data.enforcement_decision !== 'blocked' &&
      data.body_forward_mode !== 'raw'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'passthrough_audited forward requires body_forward_mode=raw',
        path: ['body_forward_mode'],
      });
    }

    // Rule 5: tool classifications require taxonomy version.
    if (
      data.detected_tool_classifications.length > 0 &&
      (!data.tools_taxonomy_version || data.tools_taxonomy_version.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'detected_tool_classifications.length > 0 requires tools_taxonomy_version to be populated',
        path: ['tools_taxonomy_version'],
      });
    }
  });

export type PassthroughInvoked = z.infer<typeof PassthroughInvokedSchema>;
