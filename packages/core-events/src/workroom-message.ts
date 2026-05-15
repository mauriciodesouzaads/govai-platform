// WorkroomMessageSchema v1 — Workroom Phase 2 (issue #51). Emitted when a
// participant appends a ConversationMessage to a workroom transcript. The
// message content is envelope-encrypted at rest in govai.audit_event_payloads;
// this event carries only safe metadata — never plaintext. Routes onto the
// existing `run` ChainCategory. No new audit chain.

import { z } from 'zod';
import { WorkroomGovernanceMode } from './workroom-lifecycle.js';

export const WorkroomMessageRole = z.enum(['user', 'assistant', 'auditor_note']);
export type WorkroomMessageRole = z.infer<typeof WorkroomMessageRole>;

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

export const WorkroomMessageSchema = z.object({
  event_type: z.literal('workroom.message'),
  schema_version: z.literal(1),

  tenant_context: TenantContextSchema,

  workroom_id: z.string().uuid(),
  workroom_turn_id: z.string().uuid(),
  turn_number: z.number().int().positive(),
  message_id: z.string().uuid(),
  participant_id: z.string().uuid(),
  role: WorkroomMessageRole,
  workroom_governance_mode: WorkroomGovernanceMode,

  // content_ref points at the encrypted audit_event_payloads row; payload_hash
  // is the sha256 of the plaintext (hex). The plaintext itself never appears.
  content_ref: z.string().uuid(),
  payload_hash: z.string().min(1),

  occurred_at: z.string().datetime(),
  audit_event_id: z.string().uuid(),
  chain_category: z.literal('run'),
});

export type WorkroomMessage = z.infer<typeof WorkroomMessageSchema>;
