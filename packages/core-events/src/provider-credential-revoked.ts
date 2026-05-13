// ProviderCredentialRevokedSchema v1 — PR3.1a (issue #13). Emitted when a
// provider credential is revoked via UPDATE setting status='revoked'. No
// plaintext is ever part of this payload.

import { z } from 'zod';

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

export const ProviderCredentialRevokedSchema = z.object({
  event_type: z.literal('provider_credential.revoked'),
  schema_version: z.literal(1),

  tenant_context: TenantContextSchema,

  provider: z.enum(['anthropic', 'openai']),
  credential_id: z.string().uuid(),

  key_prefix: z.string().min(1),
  key_last4: z.string().min(1),

  revoked_at: z.string().datetime(),
  revoked_by_user_id: z.string().uuid(),
  revocation_reason: z.string().min(1),

  audit_event_id: z.string().uuid(),
  chain_category: z.literal('admin'),
});

export type ProviderCredentialRevoked = z.infer<typeof ProviderCredentialRevokedSchema>;
