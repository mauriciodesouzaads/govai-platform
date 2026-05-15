// WorkroomTaskCreatedSchema v1 — Workroom Phase 2 (issue #51). Emitted when a
// participant creates a WorkroomTask. Task title is plain work metadata (not
// sensitive transcript content), so no encrypted payload is involved.
// `requires_approval` is a persisted flag only — approval enforcement is a
// later phase. Routes onto the existing `run` ChainCategory.

import { z } from 'zod';
import { WorkroomGovernanceMode } from './workroom-lifecycle.js';

export const WorkroomTaskStatus = z.enum([
  'draft',
  'queued',
  'assigned',
  'running',
  'blocked_on_approval',
  'failed',
  'completed',
  'cancelled',
]);
export type WorkroomTaskStatus = z.infer<typeof WorkroomTaskStatus>;

export const WorkroomTaskRiskClass = z.enum(['A', 'B', 'C', 'D', 'E']);
export type WorkroomTaskRiskClass = z.infer<typeof WorkroomTaskRiskClass>;

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

export const WorkroomTaskCreatedSchema = z.object({
  event_type: z.literal('workroom.task.created'),
  schema_version: z.literal(1),

  tenant_context: TenantContextSchema,

  workroom_id: z.string().uuid(),
  workroom_turn_id: z.string().uuid(),
  turn_number: z.number().int().positive(),
  task_id: z.string().uuid(),
  created_by_participant_id: z.string().uuid(),
  assigned_participant_id: z.string().uuid().nullable(),

  title: z.string().min(1),
  risk_class: WorkroomTaskRiskClass,
  // Persisted flag only; Phase 2 does not enforce an approval workflow.
  requires_approval: z.boolean(),
  status: WorkroomTaskStatus,
  workroom_governance_mode: WorkroomGovernanceMode,

  occurred_at: z.string().datetime(),
  audit_event_id: z.string().uuid(),
  chain_category: z.literal('run'),
});

export type WorkroomTaskCreated = z.infer<typeof WorkroomTaskCreatedSchema>;
