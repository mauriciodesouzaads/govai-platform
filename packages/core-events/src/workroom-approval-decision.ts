// WorkroomApprovalDecisionSchema v1 — Workroom Phase 4 (issue #57). Emitted
// when an approval request reaches a terminal outcome: `granted` / `denied` by
// an authorized human approver, or `revoked` by the requester / a human owner.
// `granted` and `denied` reference an append-only workroom_approval_decisions
// row; `revoked` creates no decision row, so approval_decision_id is null.
// Routes onto the existing `policy` ChainCategory. No new audit chain. This
// event carries only safe metadata — never plaintext run input.

import { z } from 'zod';
import { WorkroomGovernanceMode } from './workroom-lifecycle.js';

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

export const WorkroomApprovalOutcome = z.enum(['granted', 'denied', 'revoked']);
export type WorkroomApprovalOutcome = z.infer<typeof WorkroomApprovalOutcome>;

export const WorkroomApprovalDecisionSchema = z.object({
  event_type: z.enum([
    'workroom.approval.granted',
    'workroom.approval.denied',
    'workroom.approval.revoked',
  ]),
  schema_version: z.literal(1),

  tenant_context: TenantContextSchema,

  workroom_id: z.string().uuid(),
  workroom_turn_id: z.string().uuid(),
  turn_number: z.number().int().positive(),
  approval_request_id: z.string().uuid(),
  // Present for granted/denied (a decision row exists); null for revoked.
  approval_decision_id: z.string().uuid().nullable(),
  requested_by_participant_id: z.string().uuid(),
  // The participant who granted/denied, or who revoked, the request. Separation
  // of duties: for granted/denied this is never the requester.
  decided_by_participant_id: z.string().uuid(),

  outcome: WorkroomApprovalOutcome,
  // A denial carries a reason; a grant or revoke may omit it.
  reason: z.string().nullable(),

  subject_kind: z.literal('passthrough_run'),
  // The request's terminal status mirrors the outcome.
  status: WorkroomApprovalOutcome,
  workroom_governance_mode: WorkroomGovernanceMode,
  intended_action_hash: z.string().min(1),
  // A decision authorizes only; the consuming run id is recorded on the run's
  // own audit event and the approval row. Null at decision time.
  consumed_run_id: z.string().uuid().nullable(),

  occurred_at: z.string().datetime(),
  audit_event_id: z.string().uuid(),
  chain_category: z.literal('policy'),
});

export type WorkroomApprovalDecision = z.infer<typeof WorkroomApprovalDecisionSchema>;
