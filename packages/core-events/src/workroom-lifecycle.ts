// WorkroomLifecycleSchema v1 — Workroom Phase 1 (issue #49). Emitted by the
// control-plane path that creates a workroom. Routes onto the existing `run`
// ChainCategory (workrooms are run containers — see workroom-governance-room.md
// §11). No new audit chain is introduced.

import { z } from 'zod';

export const WorkroomGovernanceMode = z.enum(['governance_active', 'audit_only']);
export type WorkroomGovernanceMode = z.infer<typeof WorkroomGovernanceMode>;

export const WorkroomStatus = z.enum([
  'draft',
  'open',
  'blocked_on_approval',
  'completed',
  'cancelled',
  'archived',
]);
export type WorkroomStatus = z.infer<typeof WorkroomStatus>;

// Phase 1 only emits the `created` transition. The mode-transition and
// close/archive transitions ship in later phases.
export const WorkroomLifecycleTransition = z.enum(['created']);
export type WorkroomLifecycleTransition = z.infer<typeof WorkroomLifecycleTransition>;

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

export const WorkroomLifecycleSchema = z.object({
  event_type: z.literal('workroom.lifecycle'),
  schema_version: z.literal(1),

  tenant_context: TenantContextSchema,

  workroom_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  governance_mode: WorkroomGovernanceMode,
  transition: WorkroomLifecycleTransition,
  status: WorkroomStatus,
  created_by_user_id: z.string().uuid(),
  policy_profile_id: z.string().uuid(),
  occurred_at: z.string().datetime(),

  audit_event_id: z.string().uuid(),
  chain_category: z.literal('run'),
});

export type WorkroomLifecycle = z.infer<typeof WorkroomLifecycleSchema>;
