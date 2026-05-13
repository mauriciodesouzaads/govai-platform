// OrgBetaOverrideRevokedSchema v1 — Matrix §5.4. Emitted when an override is
// revoked via UPDATE setting revoked_at (no DELETE allowed).

import { z } from 'zod';

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

export const OrgBetaOverrideRevokedSchema = z.object({
  event_type: z.literal('org.beta_override_revoked'),
  schema_version: z.literal(1),

  tenant_context: TenantContextSchema,

  provider: z.enum(['anthropic', 'openai']),
  override_id: z.string().uuid(),
  beta_token: z.string().min(1),

  revoked_at: z.string().datetime(),
  revoked_by_user_id: z.string().uuid(),
  reason: z.string().min(1),

  audit_event_id: z.string().uuid(),
  chain_category: z.literal('admin'),
});

export type OrgBetaOverrideRevoked = z.infer<typeof OrgBetaOverrideRevokedSchema>;
