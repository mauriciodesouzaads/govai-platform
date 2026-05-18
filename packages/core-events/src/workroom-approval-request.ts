// WorkroomApprovalRequestedSchema v1 — Workroom Phase 4 (issue #57). Emitted
// when a participant raises an approval request for a passthrough-mode run in a
// `governance_active` Workroom. The request is forward-looking: it is raised
// before the run exists, so it carries no subject row — it is bound to the
// exact intended run parameters via `intended_action_hash`. The intended run
// payload is envelope-encrypted at rest in govai.audit_event_payloads; this
// event carries only safe metadata — never plaintext run input. Routes onto the
// existing `policy` ChainCategory. No new audit chain.

import { z } from 'zod';
import { WorkroomGovernanceMode } from './workroom-lifecycle.js';

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

// First slice approves only a passthrough run; the enum is widened in a later
// phase as more approvable subjects land.
export const WorkroomApprovalSubjectKind = z.enum(['passthrough_run']);
export type WorkroomApprovalSubjectKind = z.infer<typeof WorkroomApprovalSubjectKind>;

export const WorkroomApprovalRiskClass = z.enum(['A', 'B', 'C', 'D', 'E']);
export type WorkroomApprovalRiskClass = z.infer<typeof WorkroomApprovalRiskClass>;

export const WorkroomApprovalRequestedSchema = z.object({
  event_type: z.literal('workroom.approval.requested'),
  schema_version: z.literal(1),

  tenant_context: TenantContextSchema,

  workroom_id: z.string().uuid(),
  workroom_turn_id: z.string().uuid(),
  turn_number: z.number().int().positive(),
  approval_request_id: z.string().uuid(),
  requested_by_participant_id: z.string().uuid(),

  subject_kind: WorkroomApprovalSubjectKind,
  // NULL for a passthrough_run — the run does not exist at request time.
  subject_ref_id: z.string().uuid().nullable(),
  risk_class: WorkroomApprovalRiskClass.nullable(),
  // A freshly raised request is always pending.
  status: z.literal('pending'),
  workroom_governance_mode: WorkroomGovernanceMode,

  // Hex sha256 of the canonical intended run action. The grant is bound to this
  // hash; the run is admitted only if its parameters reproduce it. Never the
  // plaintext run input.
  intended_action_hash: z.string().min(1),
  // Points at the encrypted audit_event_payloads row holding the intended run
  // request; the plaintext itself never appears in this event.
  intended_action_payload_ref: z.string().uuid().nullable(),
  expires_at: z.string().datetime().nullable(),

  occurred_at: z.string().datetime(),
  audit_event_id: z.string().uuid(),
  chain_category: z.literal('policy'),
});

export type WorkroomApprovalRequested = z.infer<typeof WorkroomApprovalRequestedSchema>;
