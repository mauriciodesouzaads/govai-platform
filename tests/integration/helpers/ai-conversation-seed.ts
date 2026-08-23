// EP-AI-CONVERSATION-CONTINUITY-V1 P0-A1 — seed helpers for the ai_* domain
// integration suites (migration falsification, RLS matrix, owner context).
//
// Seeds run on the ADMIN pool (superuser): RLS and grants are bypassed, but
// FKs, CHECKs and guard triggers still fire — exactly what the falsification
// tests need. RLS suites write through the app pool instead.

import type { Pool } from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';

export type OwnerIds = { orgId: string; ownerUserId: string };

export function freshOwner(): OwnerIds {
  return { orgId: randomUUID(), ownerUserId: randomUUID() };
}

/** Insert an active provider credential (0009 shape) and return its id. */
export async function seedProviderCredential(
  admin: Pool,
  orgId: string,
  provider: 'anthropic' | 'openai' = 'anthropic',
): Promise<string> {
  const r = await admin.query<{ id: string }>(
    `INSERT INTO govai.provider_credentials
       (org_id, provider, ciphertext, dek_wrapped, key_prefix, key_last4, set_by_user_id)
     VALUES ($1::uuid, $2::text, $3::bytea, $4::bytea, 'sk-test-', '0000', $5::uuid)
     RETURNING id`,
    [orgId, provider, randomBytes(48), randomBytes(64), randomUUID()],
  );
  return r.rows[0]!.id;
}

/** Insert an encrypted content row (fixture bytes, 32-byte digest). */
export async function seedContent(
  admin: Pool,
  ids: OwnerIds,
  conversationId: string,
  overrides?: { ciphertext?: Buffer; contentHmac?: Buffer },
): Promise<string> {
  const r = await admin.query<{ id: string }>(
    `INSERT INTO govai.ai_conversation_content
       (org_id, owner_user_id, conversation_id, ciphertext, dek_wrapped,
        kms_key_id, kms_key_version, content_hmac)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::bytea,
             'ai-conversation-content-v1', 1, $6::bytea)
     RETURNING id`,
    [
      ids.orgId,
      ids.ownerUserId,
      conversationId,
      overrides?.ciphertext ?? randomBytes(64),
      randomBytes(64),
      overrides?.contentHmac ?? randomBytes(32),
    ],
  );
  return r.rows[0]!.id;
}

/** Insert a conversation + its root branch; returns both ids. */
export async function seedConversation(
  admin: Pool,
  ids: OwnerIds,
  overrides?: { mode?: 'governed' | 'passthrough'; provider?: string },
): Promise<{ conversationId: string; branchId: string }> {
  const provider = overrides?.provider ?? 'anthropic';
  const conv = await admin.query<{ id: string }>(
    `INSERT INTO govai.ai_conversations
       (org_id, owner_user_id, mode, provider, surface, model)
     VALUES ($1::uuid, $2::uuid, $3::text, $4::text, 'anthropic_api', 'test-model')
     RETURNING id`,
    [ids.orgId, ids.ownerUserId, overrides?.mode ?? 'governed', provider],
  );
  const conversationId = conv.rows[0]!.id;
  const branch = await admin.query<{ id: string }>(
    `INSERT INTO govai.ai_conversation_branches
       (org_id, owner_user_id, conversation_id, provider, surface, model)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, 'anthropic_api', 'test-model')
     RETURNING id`,
    [ids.orgId, ids.ownerUserId, conversationId, provider],
  );
  return { conversationId, branchId: branch.rows[0]!.id };
}

/** Insert a turn (mints its native-request-config content row first). */
export async function seedTurn(
  admin: Pool,
  ids: OwnerIds,
  conversationId: string,
  branchId: string,
  turnSeq = 1,
): Promise<{ turnId: string; configContentId: string }> {
  const configContentId = await seedContent(admin, ids, conversationId);
  const r = await admin.query<{ id: string }>(
    `INSERT INTO govai.ai_conversation_turns
       (org_id, owner_user_id, conversation_id, branch_id, client_turn_id, turn_seq,
        native_request_config_content_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::bigint, $7::uuid)
     RETURNING id`,
    [ids.orgId, ids.ownerUserId, conversationId, branchId, randomUUID(), turnSeq, configContentId],
  );
  return { turnId: r.rows[0]!.id, configContentId };
}

/** Insert an attempt. Defaults to the born state: accepted, unclaimed. */
export async function seedAttempt(
  admin: Pool,
  ids: OwnerIds,
  conversationId: string,
  branchId: string,
  turnId: string,
  overrides?: {
    attemptSeq?: number;
    state?: string;
    claimToken?: string | null;
    terminalAt?: boolean;
    errorClass?: string | null;
    boundaryCommitted?: boolean;
    providerCredentialId?: string | null;
    govaiRequestId?: string | null;
    contextExcluded?: boolean;
    stopRequested?: boolean;
  },
): Promise<string> {
  const state = overrides?.state ?? 'accepted';
  const claimed =
    overrides?.claimToken !== undefined
      ? overrides.claimToken
      : state === 'dispatching' || state === 'streaming'
        ? randomUUID()
        : null;
  const terminal =
    overrides?.terminalAt ??
    ['completed', 'stopped', 'failed', 'rejected', 'outcome_unknown'].includes(state);
  const boundary =
    overrides?.boundaryCommitted ??
    (['dispatching', 'streaming', 'outcome_unknown'].includes(state) ||
      (overrides?.providerCredentialId !== null && overrides?.providerCredentialId !== undefined));
  const r = await admin.query<{ id: string }>(
    `INSERT INTO govai.ai_conversation_attempts
       (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq, state,
        claim_token, claimant, claim_deadline_at,
        terminal_at, error_class, dispatch_boundary_committed_at,
        provider_credential_id, govai_request_id, context_excluded, stop_requested)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::int, $7::text,
             $8::uuid, CASE WHEN $8::uuid IS NULL THEN NULL ELSE 'test-claimant' END,
             CASE WHEN $8::uuid IS NULL THEN NULL ELSE now() + interval '5 minutes' END,
             CASE WHEN $9::boolean THEN now() ELSE NULL END,
             $10::text,
             CASE WHEN $11::boolean THEN now() ELSE NULL END,
             $12::uuid, $13::uuid, $14::boolean, $15::boolean)
     RETURNING id`,
    [
      ids.orgId,
      ids.ownerUserId,
      conversationId,
      branchId,
      turnId,
      overrides?.attemptSeq ?? 1,
      state,
      claimed,
      terminal,
      overrides?.errorClass !== undefined
        ? overrides.errorClass
        : state === 'failed'
          ? 'provider_error'
          : null,
      boundary,
      overrides?.providerCredentialId ?? null,
      overrides?.govaiRequestId ?? null,
      overrides?.contextExcluded ?? false,
      overrides?.stopRequested ?? false,
    ],
  );
  return r.rows[0]!.id;
}

/** Full chain: conversation → root branch → turn 1 → attempt 1 (+ current_attempt_id). */
export async function seedFullChain(
  admin: Pool,
  ids: OwnerIds,
): Promise<{
  conversationId: string;
  branchId: string;
  turnId: string;
  attemptId: string;
  configContentId: string;
}> {
  const { conversationId, branchId } = await seedConversation(admin, ids);
  const { turnId, configContentId } = await seedTurn(admin, ids, conversationId, branchId);
  const attemptId = await seedAttempt(admin, ids, conversationId, branchId, turnId);
  await admin.query(
    `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
    [attemptId, turnId],
  );
  return { conversationId, branchId, turnId, attemptId, configContentId };
}

/** True when the error is a Postgres FK violation (23503). */
export function isFkViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23503';
}

/** True when the error is a Postgres CHECK violation (23514). */
export function isCheckViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23514';
}

/** True when the error is insufficient_privilege (42501) — guard triggers + RLS WITH CHECK. */
export function isPrivilegeViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '42501';
}
