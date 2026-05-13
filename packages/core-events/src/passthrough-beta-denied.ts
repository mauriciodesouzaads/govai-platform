// PassthroughBetaDeniedSchema v1 — emitted when a beta header token is denied.
// Reasons: hard_denied policy, unknown token, denied_until_decision,
// org_override_allowed without an active override, verification_required without override.

import { z } from 'zod';
import { BetaPolicyAtResolutionEnum } from './passthrough-invoked.js';

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

export const PassthroughBetaDeniedSchema = z.object({
  event_type: z.literal('passthrough.beta_denied'),
  schema_version: z.literal(1),

  tenant_context: TenantContextSchema,

  provider: z.enum(['anthropic', 'openai']),
  capability_id: z.string().min(1),

  beta_token: z.string().min(1),
  policy_at_resolution: z.union([BetaPolicyAtResolutionEnum, z.literal('unknown')]),
  reason_code: z.enum([
    'unknown_token',
    'hard_denied',
    'denied_until_decision',
    'org_override_required_but_absent',
    'verification_required_without_override',
  ]),

  audit_event_id: z.string().uuid(),
  chain_category: z.literal('run'),
});

export type PassthroughBetaDenied = z.infer<typeof PassthroughBetaDeniedSchema>;
