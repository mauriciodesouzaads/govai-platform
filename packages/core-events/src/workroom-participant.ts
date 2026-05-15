// WorkroomParticipantSchema v1 — Workroom Phase 1 (issue #49). Emitted when a
// participant is added to or removed from a workroom. Participation is a
// permission grant, so the event routes onto the existing `admin`
// ChainCategory (see workroom-governance-room.md §11). No new audit chain.

import { z } from 'zod';
import { WorkroomGovernanceMode } from './workroom-lifecycle.js';

export const WorkroomParticipantKind = z.enum(['human', 'agent']);
export type WorkroomParticipantKind = z.infer<typeof WorkroomParticipantKind>;

export const WorkroomParticipantRole = z.enum([
  'human_owner',
  'human_approver',
  'human_reviewer',
  'dpo_reviewer',
  'architect_agent',
  'auditor_agent',
  'executor_agent',
  'observer_agent',
  'tool_agent',
  'external_agent',
]);
export type WorkroomParticipantRole = z.infer<typeof WorkroomParticipantRole>;

export const WorkroomParticipantTransition = z.enum(['added', 'removed']);
export type WorkroomParticipantTransition = z.infer<typeof WorkroomParticipantTransition>;

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

export const WorkroomParticipantSchema = z.object({
  event_type: z.literal('workroom.participant'),
  schema_version: z.literal(1),

  tenant_context: TenantContextSchema,

  workroom_id: z.string().uuid(),
  // Snapshotted from the persisted workroom at emission time.
  workroom_governance_mode: WorkroomGovernanceMode,

  participant_id: z.string().uuid(),
  participant_kind: WorkroomParticipantKind,
  participant_role: WorkroomParticipantRole,
  transition: WorkroomParticipantTransition,

  // The authenticated user that performed the add/remove.
  actor_user_id: z.string().uuid(),
  occurred_at: z.string().datetime(),

  audit_event_id: z.string().uuid(),
  chain_category: z.literal('admin'),
});

export type WorkroomParticipant = z.infer<typeof WorkroomParticipantSchema>;
