// ProviderCredentialSetSchema v1 — PR3.1a (issue #13). Emitted by the admin
// path that inserts an active row into govai.provider_credentials. Carries
// only safe metadata (key_prefix + key_last4); plaintext is NEVER part of the
// payload.

import { z } from 'zod';

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

export const ProviderCredentialSetSchema = z.object({
  event_type: z.literal('provider_credential.set'),
  schema_version: z.literal(1),

  tenant_context: TenantContextSchema,

  provider: z.enum(['anthropic', 'openai']),
  credential_id: z.string().uuid(),

  // Safe metadata only. NEVER the plaintext or any portion that could
  // reconstruct it. Producers MUST refuse to populate fields with key bodies.
  key_prefix: z.string().min(1),
  key_last4: z.string().min(1),

  kms_key_id: z.string().min(1),
  kms_key_version: z.number().int().positive(),

  set_by_user_id: z.string().uuid(),
  set_at: z.string().datetime(),

  // If this set replaced a prior active credential atomically, the prior id
  // is included for audit traceability. null on first-set.
  replaced_credential_id: z.string().uuid().nullable(),

  audit_event_id: z.string().uuid(),
  chain_id: z.literal('admin'),
});

export type ProviderCredentialSet = z.infer<typeof ProviderCredentialSetSchema>;
