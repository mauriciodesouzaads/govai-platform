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

export type AttemptTargetState =
  | 'accepted'
  | 'dispatching'
  | 'streaming'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'rejected'
  | 'outcome_unknown';

export type AttemptAdvanceOverrides = {
  /** Target durable state, reached through LEGAL transitions only. */
  state?: AttemptTargetState;
  /** Claim token; post-boundary targets always claim (a fresh one if omitted). */
  claimToken?: string;
  /** Error taxonomy for `failed` (defaults to provider_error). */
  errorClass?: string;
  /**
   * Commit-4 provenance. Post-POST targets (streaming/completed/
   * outcome_unknown) REQUIRE it and auto-seed a credential when omitted;
   * `null` skips commit 4 (lawful only inside the dispatching window).
   */
  providerCredentialId?: string | null;
  /** Minted at the boundary commit (§14.1); post-boundary targets always
   *  carry one (a fresh mint if omitted). */
  govaiRequestId?: string;
  /** Derived identity (§14.2); written once post-boundary when provided. */
  captureId?: string;
  /** Record an encrypted continuation anchor at the boundary (§11). */
  continuationAnchor?: boolean;
  contextExcluded?: boolean;
  stopRequested?: boolean;
};

/**
 * Advance a BORN (accepted/unclaimed) attempt to the requested durable state
 * through the §7/§8 legal path only — claim commit, boundary commit (minting
 * govai_request_id), commit-4 provenance, stream start, finalize. The helper
 * never bypasses the birth guard, the transition graph or the CHECK matrix:
 * a fixture that needs an impossible shape does not belong here (§23 — write
 * that malformed SQL explicitly inside the negative test that needs it).
 */
export async function advanceSeededAttempt(
  admin: Pool,
  ids: OwnerIds,
  attemptId: string,
  overrides?: AttemptAdvanceOverrides,
): Promise<void> {
  const target = overrides?.state ?? 'accepted';
  const setFlags = async (): Promise<void> => {
    if (overrides?.stopRequested) {
      await admin.query(
        `UPDATE govai.ai_conversation_attempts SET stop_requested = true WHERE id = $1::uuid`,
        [attemptId],
      );
    }
    if (overrides?.contextExcluded) {
      await admin.query(
        `UPDATE govai.ai_conversation_attempts SET context_excluded = true WHERE id = $1::uuid`,
        [attemptId],
      );
    }
  };
  const claim = async (): Promise<void> => {
    await admin.query(
      `UPDATE govai.ai_conversation_attempts
          SET claim_token = $1::uuid, claimant = 'test-claimant',
              claim_deadline_at = now() + interval '5 minutes'
        WHERE id = $2::uuid`,
      [overrides?.claimToken ?? randomUUID(), attemptId],
    );
  };

  if (target === 'accepted') {
    if (overrides?.claimToken !== undefined) await claim();
    await setFlags();
    return;
  }

  if (target === 'stopped' || target === 'failed' || target === 'rejected') {
    // Pre-boundary terminal: queued discard (§8), pre-dispatch failure
    // (e.g. credential_unavailable) or governance/validation rejection (§7).
    if (overrides?.claimToken !== undefined) await claim();
    await setFlags();
    await admin.query(
      `UPDATE govai.ai_conversation_attempts
          SET state = $1::text, error_class = $2::text, terminal_at = now(), updated_at = now()
        WHERE id = $3::uuid`,
      [
        target,
        target === 'failed' ? (overrides?.errorClass ?? 'provider_error') : null,
        attemptId,
      ],
    );
    return;
  }

  // Post-boundary walk: claim commit → boundary commit → commit 4 → onward.
  await claim();
  await admin.query(
    `UPDATE govai.ai_conversation_attempts
        SET state = 'dispatching', dispatch_boundary_committed_at = now(),
            govai_request_id = $1::uuid, causal_version_at_build = 0,
            heartbeat_at = now(),
            continuation_parent_ciphertext = CASE WHEN $2::boolean THEN $3::bytea ELSE NULL END,
            continuation_parent_dek_wrapped = CASE WHEN $2::boolean THEN $4::bytea ELSE NULL END,
            continuation_parent_kms_key_id = CASE WHEN $2::boolean THEN 'k' ELSE NULL END,
            continuation_parent_kms_key_version = CASE WHEN $2::boolean THEN 1 ELSE NULL END,
            updated_at = now()
      WHERE id = $5::uuid`,
    [
      overrides?.govaiRequestId ?? randomUUID(),
      overrides?.continuationAnchor ?? false,
      randomBytes(32),
      randomBytes(64),
      attemptId,
    ],
  );
  const needsProvenance =
    target === 'streaming' || target === 'completed' || target === 'outcome_unknown';
  if (overrides?.providerCredentialId !== null && (needsProvenance || overrides?.providerCredentialId)) {
    // Reuse the org's active credential when one exists (0009 allows only one
    // active row per (org, provider)); otherwise seed it.
    const existing =
      overrides?.providerCredentialId === undefined
        ? await admin.query<{ id: string }>(
            `SELECT id FROM govai.provider_credentials
              WHERE org_id = $1::uuid AND provider = 'anthropic' AND status = 'active'`,
            [ids.orgId],
          )
        : null;
    const credId =
      overrides?.providerCredentialId ??
      existing?.rows[0]?.id ??
      (await seedProviderCredential(admin, ids.orgId));
    await admin.query(
      `UPDATE govai.ai_conversation_attempts SET provider_credential_id = $1::uuid
        WHERE id = $2::uuid`,
      [credId, attemptId],
    );
  }
  if (overrides?.captureId) {
    await admin.query(
      `UPDATE govai.ai_conversation_attempts SET capture_id = $1::uuid WHERE id = $2::uuid`,
      [overrides.captureId, attemptId],
    );
  }
  await setFlags();
  if (target === 'dispatching') return;
  if (target === 'outcome_unknown') {
    await admin.query(
      `UPDATE govai.ai_conversation_attempts
          SET state = 'outcome_unknown', terminal_at = now(), updated_at = now()
        WHERE id = $1::uuid`,
      [attemptId],
    );
    return;
  }
  await admin.query(
    `UPDATE govai.ai_conversation_attempts SET state = 'streaming', updated_at = now()
      WHERE id = $1::uuid`,
    [attemptId],
  );
  if (target === 'completed') {
    await admin.query(
      `UPDATE govai.ai_conversation_attempts
          SET state = 'completed', terminal_at = now(), updated_at = now()
        WHERE id = $1::uuid`,
      [attemptId],
    );
  }
}

/** Insert an attempt in the §7.1b BORN shape (accepted, unclaimed,
 *  pre-boundary), then advance it to the requested state through legal
 *  transitions only (see advanceSeededAttempt). */
export async function seedAttempt(
  admin: Pool,
  ids: OwnerIds,
  conversationId: string,
  branchId: string,
  turnId: string,
  overrides?: AttemptAdvanceOverrides & { attemptSeq?: number },
): Promise<string> {
  const r = await admin.query<{ id: string }>(
    `INSERT INTO govai.ai_conversation_attempts
       (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::int)
     RETURNING id`,
    [ids.orgId, ids.ownerUserId, conversationId, branchId, turnId, overrides?.attemptSeq ?? 1],
  );
  const attemptId = r.rows[0]!.id;
  await advanceSeededAttempt(admin, ids, attemptId, overrides);
  return attemptId;
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
