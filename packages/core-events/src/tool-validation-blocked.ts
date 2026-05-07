// ToolValidationBlockedSchema v1 — emitted when a tool fails pre-invoke validation.
// Drivers: typed_unknown classification (Matrix v2.0.1 P3: type:'' or type:null is NOT
// client_defined — it must be flagged as typed_unknown and blocked at validation).

import { z } from 'zod';
import { ToolClassificationEnum } from './passthrough-invoked.js';

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

export const ToolValidationBlockedSchema = z.object({
  event_type: z.literal('tool.validation_blocked'),
  schema_version: z.literal(1),

  tenant_context: TenantContextSchema,

  provider: z.enum(['anthropic', 'openai']),
  capability_id: z.string().min(1),

  tool_index: z.number().int().nonnegative(),
  tool_type: z.string().optional(),
  tool_type_observed: z
    .enum(['empty_string', 'null', 'missing', 'other_typed_unknown'])
    .optional(),
  classification: ToolClassificationEnum,
  reason: z.string().min(1),

  tools_taxonomy_version: z.string().min(1),

  audit_event_id: z.string().uuid(),
  chain_id: z.literal('run'),
});

export type ToolValidationBlocked = z.infer<typeof ToolValidationBlockedSchema>;
