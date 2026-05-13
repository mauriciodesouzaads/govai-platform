// OrgBetaOverrideSetSchema v1 — Matrix §5.4. Emitted by the admin path that
// inserts an active override into govai.org_beta_overrides.

import { z } from 'zod';
import { BetaPolicyAtResolutionEnum } from './passthrough-invoked.js';

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

export const OrgBetaOverrideSetSchema = z.object({
  event_type: z.literal('org.beta_override_set'),
  schema_version: z.literal(1),

  tenant_context: TenantContextSchema,

  provider: z.enum(['anthropic', 'openai']),
  override_id: z.string().uuid(),
  beta_token: z.string().min(1),

  reason: z.string().min(1),
  set_by_user_id: z.string().uuid(),
  set_at: z.string().datetime(),
  expires_at: z.string().datetime(),

  policy_at_resolution: BetaPolicyAtResolutionEnum,

  audit_event_id: z.string().uuid(),
  chain_category: z.literal('admin'),
});

export type OrgBetaOverrideSet = z.infer<typeof OrgBetaOverrideSetSchema>;
