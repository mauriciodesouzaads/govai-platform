// WorkroomEvidenceSchema v1 — Workroom Phase 2 (issue #51). Typed envelope for
// an entry in the workroom evidence index. Carries only safe metadata —
// payload bytes stay encrypted-at-rest in govai.audit_event_payloads.
//
// Phase 2 endpoints do NOT emit a standalone `workroom.evidence` event for
// message-derived evidence: a message append produces one `workroom.message`
// event and the derived evidence_artifacts row anchors to that same turn and
// audit event. This schema ships for future independent evidence artifacts
// (run refs, tool results) and types the GET /evidence response items.

import { z } from 'zod';
import { WorkroomGovernanceMode } from './workroom-lifecycle.js';

export const WorkroomEvidenceArtifactKind = z.enum([
  'prompt',
  'agent_response',
  'auditor_finding',
  'external_artifact',
  'human_approval',
  'merge_decision',
  'file_diff',
  'commit',
  'pr',
  'ci_run',
  'tool_invocation_result',
]);
export type WorkroomEvidenceArtifactKind = z.infer<typeof WorkroomEvidenceArtifactKind>;

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

export const WorkroomEvidenceSchema = z.object({
  event_type: z.literal('workroom.evidence'),
  schema_version: z.literal(1),

  tenant_context: TenantContextSchema,

  workroom_id: z.string().uuid(),
  workroom_turn_id: z.string().uuid(),
  turn_number: z.number().int().positive(),
  evidence_artifact_id: z.string().uuid(),
  artifact_kind: WorkroomEvidenceArtifactKind,

  // Anchors into the existing audit chain / payload store. No payload bytes.
  audit_event_id: z.string().uuid(),
  payload_ref: z.string().uuid(),
  payload_hash: z.string().min(1),
  redaction_metadata: z.record(z.string(), z.unknown()),

  workroom_governance_mode: WorkroomGovernanceMode,
  occurred_at: z.string().datetime(),
  chain_category: z.literal('run'),
});

export type WorkroomEvidence = z.infer<typeof WorkroomEvidenceSchema>;
