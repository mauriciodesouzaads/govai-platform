import { z } from 'zod';

export const RunMode = z.enum(['governed', 'passthrough', 'shadow']);
export type RunMode = z.infer<typeof RunMode>;

export const RunStatus = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'denied',
  'awaiting_approval',
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RiskLevel = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const Run = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  assistant_id: z.string().uuid().nullable().optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  mode: RunMode,
  status: RunStatus,
  risk_level: RiskLevel.default('low'),
  created_at: z.date(),
  started_at: z.date().nullable().optional(),
  completed_at: z.date().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type Run = z.infer<typeof Run>;

export const UsageSource = z.enum([
  'provider_direct',
  'estimated_from_chunks',
  'estimated_from_text',
]);
export type UsageSource = z.infer<typeof UsageSource>;

export const ProviderInvocation = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  org_id: z.string().uuid(),
  provider: z.string(),
  native_endpoint: z.string(),
  native_method: z.string(),
  native_request_hash: z.instanceof(Uint8Array),
  native_response_hash: z.instanceof(Uint8Array).nullable().optional(),
  streaming: z.boolean().default(false),
  usage_json: z.object({
    provider_native: z.unknown().optional(),
    normalized: z.object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    }).optional(),
    source: UsageSource,
    pricing_table_version: z.string().optional(),
  }),
  latency_ms: z.number().int().nullable().optional(),
  status_code: z.number().int().nullable().optional(),
  provider_request_id: z.string().nullable().optional(),
  error_class: z.string().nullable().optional(),
  created_at: z.date(),
});
export type ProviderInvocation = z.infer<typeof ProviderInvocation>;

export const EvidenceStrength = z.enum([
  'hmac_internal',
  'dev_signed',
  'external_anchor',
  'customer_signed',
  'icp_brasil_tsa',
]);
export type EvidenceStrength = z.infer<typeof EvidenceStrength>;

export const EvidenceRecord = z.object({
  audit_event_id: z.string().uuid(),
  chain_id: z.string(),
  evidence_strength: EvidenceStrength,
  framework_refs: z.array(z.string()).optional(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecord>;

export const ChainCategory = z.enum(['auth', 'run', 'policy', 'admin']);
export type ChainCategory = z.infer<typeof ChainCategory>;

export function chainIdFor(orgId: string, category: ChainCategory): string {
  return `${orgId}:${category}`;
}

// PR2 Batch F audit event schemas (Peça A v2 §6.2 / §13).
export * from './passthrough-invoked.js';
export * from './passthrough-beta-denied.js';
export * from './tool-validation-blocked.js';
export * from './org-beta-override-set.js';
export * from './org-beta-override-revoked.js';

// PR3.1a — tenant-scoped provider credentials (issue #13).
export * from './provider-credential-set.js';
export * from './provider-credential-revoked.js';

// PR3.x — Workroom Phase 1 domain skeleton (issue #49).
export * from './workroom-lifecycle.js';
export * from './workroom-participant.js';

// PR3.x — Workroom Phase 2 transcript + evidence (issue #51).
export * from './workroom-message.js';
export * from './workroom-task.js';
export * from './workroom-evidence.js';
