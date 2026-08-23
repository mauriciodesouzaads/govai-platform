// EP-AI-CONVERSATION-CONTINUITY-V1 P0-A1 — migration 0031 structural
// falsification. Deliberately-invalid writes (dispatch §29) must fail CLOSED
// at the schema layer: composite-lineage FKs, state CHECKs, guard triggers
// and the org-composite credential provenance. Runs on the ADMIN pool
// (superuser) so every rejection proven here is STRUCTURAL — RLS and grants
// are bypassed, triggers/FKs/CHECKs are not.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPostgres, stopPostgres, type TestDb } from './setup.js';
import {
  freshOwner,
  seedProviderCredential,
  seedConversation,
  seedContent,
  seedTurn,
  seedAttempt,
  seedFullChain,
  isFkViolation,
  isCheckViolation,
  isPrivilegeViolation,
} from './helpers/ai-conversation-seed.js';

const __filename = fileURLToPath(import.meta.url);
const MIGRATION_0031 = join(
  dirname(__filename),
  '..',
  '..',
  'apps',
  'api',
  'src',
  'db',
  'migrations',
  '0031_ai_conversation_storage_foundation.sql',
);

let db: TestDb;
beforeAll(async () => {
  db = await startPostgres();
}, 240_000);
afterAll(async () => {
  if (db) await stopPostgres(db);
});

async function expectError(
  fn: () => Promise<unknown>,
  classify: (err: unknown) => boolean,
  label: string,
): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught, `${label}: expected a rejection`).not.toBeNull();
  expect(classify(caught), `${label}: unexpected error class: ${(caught as Error)?.message}`).toBe(
    true,
  );
}

describe('migration 0031 — apply + idempotency', () => {
  it('is idempotent: re-applying the file succeeds without error', async () => {
    const sql = await readFile(MIGRATION_0031, 'utf8');
    await db.adminPool.query(sql);
    await db.adminPool.query(sql);
  });

  it('all eight ai_* tables exist with RLS ENABLE + FORCE', async () => {
    const tables = [
      'ai_conversations',
      'ai_conversation_branches',
      'ai_conversation_turns',
      'ai_conversation_attempts',
      'ai_conversation_items',
      'ai_conversation_content',
      'ai_conversation_provider_state',
      'ai_conversation_evidence_links',
    ];
    for (const t of tables) {
      const r = await db.adminPool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass`,
        [`govai.${t}`],
      );
      expect(r.rowCount, t).toBe(1);
      expect(r.rows[0]!.relrowsecurity, `${t} ENABLE RLS`).toBe(true);
      expect(r.rows[0]!.relforcerowsecurity, `${t} FORCE RLS`).toBe(true);
    }
  });

  it('provider_credentials gained the additive (org_id, id) unique key and 0009 behavior is intact', async () => {
    const r = await db.adminPool.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'govai.provider_credentials'::regclass
          AND conname = 'provider_credentials_org_id_id_uniq'`,
    );
    expect(r.rowCount).toBe(1);
    // 0009's no-delete trigger still fires.
    const owner = freshOwner();
    const credId = await seedProviderCredential(db.adminPool, owner.orgId);
    await expectError(
      () => db.adminPool.query(`DELETE FROM govai.provider_credentials WHERE id = $1::uuid`, [credId]),
      isPrivilegeViolation,
      'provider_credentials delete',
    );
  });
});

describe('migration 0031 — composite lineage falsification (dispatch §29)', () => {
  it('same-org wrong-owner branch is rejected', async () => {
    const owner = freshOwner();
    const { conversationId } = await seedConversation(db.adminPool, owner);
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversation_branches
             (org_id, owner_user_id, conversation_id, provider, surface, model)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_api', 'm')`,
          [owner.orgId, randomUUID(), conversationId],
        ),
      isFkViolation,
      'wrong-owner branch',
    );
  });

  it('cross-org branch under an existing conversation is rejected', async () => {
    const owner = freshOwner();
    const { conversationId } = await seedConversation(db.adminPool, owner);
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversation_branches
             (org_id, owner_user_id, conversation_id, provider, surface, model)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_api', 'm')`,
          [randomUUID(), owner.ownerUserId, conversationId],
        ),
      isFkViolation,
      'cross-org branch',
    );
  });

  it('turn with mismatched branch ancestry (conversation A over a branch of conversation B) is rejected', async () => {
    const owner = freshOwner();
    const a = await seedConversation(db.adminPool, owner);
    const b = await seedConversation(db.adminPool, owner);
    const config = await seedContent(db.adminPool, owner, a.conversationId);
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversation_turns
             (org_id, owner_user_id, conversation_id, branch_id, client_turn_id, turn_seq,
              native_request_config_content_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1, $6::uuid)`,
          [owner.orgId, owner.ownerUserId, a.conversationId, b.branchId, randomUUID(), config],
        ),
      isFkViolation,
      'cross-conversation turn graft',
    );
  });

  it('attempt with mismatched turn ancestry is rejected', async () => {
    const owner = freshOwner();
    const a = await seedConversation(db.adminPool, owner);
    const b = await seedConversation(db.adminPool, owner);
    const turnB = await seedTurn(db.adminPool, owner, b.conversationId, b.branchId);
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversation_attempts
             (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1)`,
          [owner.orgId, owner.ownerUserId, a.conversationId, a.branchId, turnB.turnId],
        ),
      isFkViolation,
      'cross-branch attempt graft',
    );
  });

  it('current_attempt_id cannot point at another turn attempt (CURRENT_ATTEMPT_LINEAGE_BINDING)', async () => {
    const owner = freshOwner();
    const { conversationId, branchId } = await seedConversation(db.adminPool, owner);
    const t1 = await seedTurn(db.adminPool, owner, conversationId, branchId, 1);
    const t2 = await seedTurn(db.adminPool, owner, conversationId, branchId, 2);
    const attemptOfT2 = await seedAttempt(
      db.adminPool,
      owner,
      conversationId,
      branchId,
      t2.turnId,
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
          [attemptOfT2, t1.turnId],
        ),
      isFkViolation,
      'cross-turn current_attempt_id',
    );
    // Same-turn handoff is valid.
    const attemptOfT1 = await seedAttempt(
      db.adminPool,
      owner,
      conversationId,
      branchId,
      t1.turnId,
    );
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
      [attemptOfT1, t1.turnId],
    );
  });

  it('fork pin must reference a real attempt of the declared parent branch (one composite FK)', async () => {
    const owner = freshOwner();
    const chainA = await seedFullChain(db.adminPool, owner);
    const chainB = await seedFullChain(db.adminPool, owner);
    // Pin names parent branch A but attempt from conversation B → rejected.
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversation_branches
             (org_id, owner_user_id, conversation_id, provider, surface, model,
              parent_branch_id, forked_from_turn_id, forked_from_attempt_id, boundary_mode)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_api', 'm',
                   $4::uuid, $5::uuid, $6::uuid, 'after_attempt')`,
          [
            owner.orgId,
            owner.ownerUserId,
            chainA.conversationId,
            chainA.branchId,
            chainB.turnId,
            chainB.attemptId,
          ],
        ),
      isFkViolation,
      'cross-conversation fork pin',
    );
    // A coherent pin succeeds.
    await db.adminPool.query(
      `INSERT INTO govai.ai_conversation_branches
         (org_id, owner_user_id, conversation_id, provider, surface, model,
          parent_branch_id, forked_from_turn_id, forked_from_attempt_id, boundary_mode)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_api', 'm',
               $4::uuid, $5::uuid, $6::uuid, 'after_attempt')`,
      [
        owner.orgId,
        owner.ownerUserId,
        chainA.conversationId,
        chainA.branchId,
        chainA.turnId,
        chainA.attemptId,
      ],
    );
  });

  it('partial fork columns are rejected; a second root branch is rejected', async () => {
    const owner = freshOwner();
    const { conversationId, branchId } = await seedConversation(db.adminPool, owner);
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversation_branches
             (org_id, owner_user_id, conversation_id, provider, surface, model, parent_branch_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_api', 'm', $4::uuid)`,
          [owner.orgId, owner.ownerUserId, conversationId, branchId],
        ),
      isCheckViolation,
      'partial fork columns',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversation_branches
             (org_id, owner_user_id, conversation_id, provider, surface, model)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_api', 'm')`,
          [owner.orgId, owner.ownerUserId, conversationId],
        ),
      (e) => (e as { code?: string }).code === '23505',
      'second root branch',
    );
  });

  it('item ownership must agree with its lineage (attempt of another turn rejected; content of another conversation rejected)', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const other = await seedFullChain(db.adminPool, owner);
    // Attempt from another turn.
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversation_items
             (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id,
              item_seq, item_type, content_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 1, 'text',
                   $7::uuid)`,
          [
            owner.orgId,
            owner.ownerUserId,
            chain.conversationId,
            chain.branchId,
            chain.turnId,
            other.attemptId,
            chain.configContentId,
          ],
        ),
      isFkViolation,
      'cross-turn item attempt',
    );
    // Content row of another conversation.
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversation_items
             (org_id, owner_user_id, conversation_id, branch_id, turn_id, item_seq, item_type,
              content_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1, 'text', $6::uuid)`,
          [
            owner.orgId,
            owner.ownerUserId,
            chain.conversationId,
            chain.branchId,
            chain.turnId,
            other.configContentId,
          ],
        ),
      isFkViolation,
      'cross-conversation item content',
    );
    // Coherent turn-owned item succeeds.
    await db.adminPool.query(
      `INSERT INTO govai.ai_conversation_items
         (org_id, owner_user_id, conversation_id, branch_id, turn_id, item_seq, item_type,
          content_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1, 'text', $6::uuid)`,
      [
        owner.orgId,
        owner.ownerUserId,
        chain.conversationId,
        chain.branchId,
        chain.turnId,
        chain.configContentId,
      ],
    );
  });

  it('content stamped under a different owner is rejected', async () => {
    const owner = freshOwner();
    const { conversationId } = await seedConversation(db.adminPool, owner);
    await expectError(
      () => seedContent(db.adminPool, { orgId: owner.orgId, ownerUserId: randomUUID() }, conversationId),
      isFkViolation,
      'wrong-owner content',
    );
  });

  it('provider credential provenance is org-composite: org A attempt/provider_state cannot reference org B credential', async () => {
    const ownerA = freshOwner();
    const ownerB = freshOwner();
    const chain = await seedFullChain(db.adminPool, ownerA);
    const credB = await seedProviderCredential(db.adminPool, ownerB.orgId);
    await expectError(
      () =>
        seedAttempt(db.adminPool, ownerA, chain.conversationId, chain.branchId, chain.turnId, {
          attemptSeq: 2,
          state: 'dispatching',
          providerCredentialId: credB,
        }),
      isFkViolation,
      'cross-org attempt credential',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversation_provider_state
             (org_id, owner_user_id, conversation_id, branch_id, state_ciphertext,
              state_dek_wrapped, kms_key_id, kms_key_version, seeded_at_causal_version,
              provider_credential_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bytea, $6::bytea, 'k', 1, 0,
                   $7::uuid)`,
          [
            ownerA.orgId,
            ownerA.ownerUserId,
            chain.conversationId,
            chain.branchId,
            randomBytes(32),
            randomBytes(64),
            credB,
          ],
        ),
      isFkViolation,
      'cross-org provider_state credential',
    );
    // Same-org provenance succeeds.
    const credA = await seedProviderCredential(db.adminPool, ownerA.orgId);
    await db.adminPool.query(
      `INSERT INTO govai.ai_conversation_provider_state
         (org_id, owner_user_id, conversation_id, branch_id, state_ciphertext,
          state_dek_wrapped, kms_key_id, kms_key_version, seeded_at_causal_version,
          provider_credential_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bytea, $6::bytea, 'k', 1, 0,
               $7::uuid)`,
      [
        ownerA.orgId,
        ownerA.ownerUserId,
        chain.conversationId,
        chain.branchId,
        randomBytes(32),
        randomBytes(64),
        credA,
      ],
    );
  });

  it('evidence link must bind a real attempt through its full lineage', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const other = await seedFullChain(db.adminPool, owner);
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversation_evidence_links
             (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id,
              govai_request_id, capture_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid)`,
          [
            owner.orgId,
            owner.ownerUserId,
            chain.conversationId,
            chain.branchId,
            chain.turnId,
            other.attemptId,
            randomUUID(),
            randomUUID(),
          ],
        ),
      isFkViolation,
      'cross-attempt evidence link',
    );
  });
});

describe('migration 0031 — state-machine CHECK falsification', () => {
  it('claim triple is all-or-none; dispatching requires claim + boundary', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    // Token without deadline.
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversation_attempts
             (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq, claim_token)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 2, $6::uuid)`,
          [
            owner.orgId,
            owner.ownerUserId,
            chain.conversationId,
            chain.branchId,
            chain.turnId,
            randomUUID(),
          ],
        ),
      isCheckViolation,
      'claim token without deadline',
    );
    // dispatching unclaimed.
    await expectError(
      () =>
        seedAttempt(db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId, {
          attemptSeq: 2,
          state: 'dispatching',
          claimToken: null,
        }),
      isCheckViolation,
      'dispatching without claim',
    );
    // dispatching without boundary.
    await expectError(
      () =>
        seedAttempt(db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId, {
          attemptSeq: 2,
          state: 'dispatching',
          boundaryCommitted: false,
        }),
      isCheckViolation,
      'dispatching without boundary',
    );
  });

  it('failed requires error_class; outcome_unknown requires the boundary; provenance implies the boundary; ratchets carry terminal_at', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    await expectError(
      () =>
        seedAttempt(db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId, {
          attemptSeq: 2,
          state: 'failed',
          errorClass: null,
        }),
      isCheckViolation,
      'failed without error_class',
    );
    await expectError(
      () =>
        seedAttempt(db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId, {
          attemptSeq: 2,
          state: 'outcome_unknown',
          boundaryCommitted: false,
        }),
      isCheckViolation,
      'outcome_unknown without boundary',
    );
    const cred = await seedProviderCredential(db.adminPool, owner.orgId);
    await expectError(
      () =>
        seedAttempt(db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId, {
          attemptSeq: 2,
          state: 'accepted',
          providerCredentialId: cred,
          boundaryCommitted: false,
        }),
      isCheckViolation,
      'provenance without boundary',
    );
    await expectError(
      () =>
        seedAttempt(db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId, {
          attemptSeq: 2,
          state: 'completed',
          terminalAt: false,
        }),
      isCheckViolation,
      'completed without terminal_at',
    );
    // 'draft' is not a durable attempt state (§7.1b adjudication).
    await expectError(
      () =>
        seedAttempt(db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId, {
          attemptSeq: 2,
          state: 'draft',
          terminalAt: false,
        }),
      isCheckViolation,
      'draft attempt state',
    );
  });

  it('content status machine mirrors 0001: shred nulls the DEK, digest is 32 bytes, title group is atomic', async () => {
    const owner = freshOwner();
    const { conversationId } = await seedConversation(db.adminPool, owner);
    // crypto_shredded with a surviving DEK is unrepresentable.
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversation_content
             (org_id, owner_user_id, conversation_id, ciphertext, dek_wrapped,
              kms_key_id, kms_key_version, content_hmac, status, shredded_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::bytea, 'k', 1, $6::bytea,
                   'crypto_shredded', now())`,
          [owner.orgId, owner.ownerUserId, conversationId, randomBytes(16), randomBytes(64), randomBytes(32)],
        ),
      isCheckViolation,
      'shredded with DEK',
    );
    // Digest must be exactly 32 bytes (an HMAC-SHA256, never free-form).
    await expectError(
      () => seedContent(db.adminPool, owner, conversationId, { contentHmac: randomBytes(20) }),
      isCheckViolation,
      'short digest',
    );
    // Title group all-or-none.
    await expectError(
      () =>
        db.adminPool.query(
          `INSERT INTO govai.ai_conversations
             (org_id, owner_user_id, mode, provider, surface, model, title_ciphertext)
           VALUES ($1::uuid, $2::uuid, 'governed', 'anthropic', 'anthropic_api', 'm', $3::bytea)`,
          [owner.orgId, owner.ownerUserId, randomBytes(16)],
        ),
      isCheckViolation,
      'partial title group',
    );
  });
});

describe('migration 0031 — guard triggers (immutability by structure)', () => {
  it('conversation identity and immutable mode are frozen; lifecycle columns mutate', async () => {
    const owner = freshOwner();
    const { conversationId } = await seedConversation(db.adminPool, owner);
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversations SET owner_user_id = $1::uuid WHERE id = $2::uuid`,
          [randomUUID(), conversationId],
        ),
      isPrivilegeViolation,
      'conversation owner rewrite',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversations SET mode = 'passthrough' WHERE id = $1::uuid`,
          [conversationId],
        ),
      isPrivilegeViolation,
      'mode rewrite',
    );
    const ok = await db.adminPool.query(
      `UPDATE govai.ai_conversations SET status = 'archived', archived_at = now(), updated_at = now()
        WHERE id = $1::uuid`,
      [conversationId],
    );
    expect(ok.rowCount).toBe(1);
  });

  it('branch causal_version only moves forward; execution identity is frozen', async () => {
    const owner = freshOwner();
    const { branchId } = await seedConversation(db.adminPool, owner);
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_branches SET causal_version = 5 WHERE id = $1::uuid`,
      [branchId],
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_branches SET causal_version = 4 WHERE id = $1::uuid`,
          [branchId],
        ),
      isPrivilegeViolation,
      'causal_version rollback',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_branches SET provider = 'openai' WHERE id = $1::uuid`,
          [branchId],
        ),
      isPrivilegeViolation,
      'branch provider rewrite',
    );
  });

  it('turn input identity is frozen; only current_attempt_id may change', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_turns SET turn_seq = 99 WHERE id = $1::uuid`,
          [chain.turnId],
        ),
      isPrivilegeViolation,
      'turn_seq rewrite',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_turns SET client_turn_id = $1::uuid WHERE id = $2::uuid`,
          [randomUUID(), chain.turnId],
        ),
      isPrivilegeViolation,
      'client_turn_id rewrite',
    );
  });

  it('attempt terminal states are ratchets; outcome_unknown resolves only to completed/failed', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const completed = await seedAttempt(
      db.adminPool,
      owner,
      chain.conversationId,
      chain.branchId,
      chain.turnId,
      { attemptSeq: 2, state: 'completed' },
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET state = 'accepted' WHERE id = $1::uuid`,
          [completed],
        ),
      isPrivilegeViolation,
      'completed un-ratchet',
    );
    const unknown = await seedAttempt(
      db.adminPool,
      owner,
      chain.conversationId,
      chain.branchId,
      chain.turnId,
      { attemptSeq: 3, state: 'outcome_unknown' },
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET state = 'accepted' WHERE id = $1::uuid`,
          [unknown],
        ),
      isPrivilegeViolation,
      'outcome_unknown to accepted',
    );
    // Probe upgrade to completed is the sanctioned resolution.
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET state = 'completed', context_excluded = true
        WHERE id = $1::uuid`,
      [unknown],
    );
  });

  it('attempt provenance and govai_request_id are write-once; one-way flags never clear', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const credA = await seedProviderCredential(db.adminPool, owner.orgId);
    const credB = await seedProviderCredential(db.adminPool, owner.orgId, 'openai');
    const reqId = randomUUID();
    const attempt = await seedAttempt(
      db.adminPool,
      owner,
      chain.conversationId,
      chain.branchId,
      chain.turnId,
      {
        attemptSeq: 2,
        state: 'dispatching',
        providerCredentialId: credA,
        govaiRequestId: reqId,
        stopRequested: true,
      },
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET provider_credential_id = $1::uuid
            WHERE id = $2::uuid`,
          [credB, attempt],
        ),
      isPrivilegeViolation,
      'provenance overwrite',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET govai_request_id = $1::uuid WHERE id = $2::uuid`,
          [randomUUID(), attempt],
        ),
      isPrivilegeViolation,
      'govai_request_id overwrite',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET stop_requested = false WHERE id = $1::uuid`,
          [attempt],
        ),
      isPrivilegeViolation,
      'stop_requested clear',
    );
  });

  it('items reject every in-place UPDATE', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    await db.adminPool.query(
      `INSERT INTO govai.ai_conversation_items
         (org_id, owner_user_id, conversation_id, branch_id, turn_id, item_seq, item_type,
          content_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1, 'text', $6::uuid)`,
      [
        owner.orgId,
        owner.ownerUserId,
        chain.conversationId,
        chain.branchId,
        chain.turnId,
        chain.configContentId,
      ],
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_items SET item_type = 'other' WHERE turn_id = $1::uuid`,
          [chain.turnId],
        ),
      isPrivilegeViolation,
      'item update',
    );
  });

  it('content allows the shred lifecycle only: ciphertext frozen, DEK destroyable but never replaceable', async () => {
    const owner = freshOwner();
    const { conversationId } = await seedConversation(db.adminPool, owner);
    const contentId = await seedContent(db.adminPool, owner, conversationId);
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_content SET ciphertext = $1::bytea WHERE id = $2::uuid`,
          [randomBytes(16), contentId],
        ),
      isPrivilegeViolation,
      'ciphertext rewrite',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_content SET dek_wrapped = $1::bytea WHERE id = $2::uuid`,
          [randomBytes(64), contentId],
        ),
      isPrivilegeViolation,
      'DEK replacement',
    );
    // The sanctioned crypto-shred transition.
    const ok = await db.adminPool.query(
      `UPDATE govai.ai_conversation_content
          SET status = 'crypto_shredded', shredded_at = now(), dek_wrapped = NULL
        WHERE id = $1::uuid`,
      [contentId],
    );
    expect(ok.rowCount).toBe(1);
  });

  it('provider_state provenance and seed version are frozen; evidence link allows only the one-way audit_event_id fill', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const cred = await seedProviderCredential(db.adminPool, owner.orgId);
    const ps = await db.adminPool.query<{ id: string }>(
      `INSERT INTO govai.ai_conversation_provider_state
         (org_id, owner_user_id, conversation_id, branch_id, state_ciphertext,
          state_dek_wrapped, kms_key_id, kms_key_version, seeded_at_causal_version,
          provider_credential_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bytea, $6::bytea, 'k', 1, 0, $7::uuid)
       RETURNING id`,
      [
        owner.orgId,
        owner.ownerUserId,
        chain.conversationId,
        chain.branchId,
        randomBytes(32),
        randomBytes(64),
        cred,
      ],
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_provider_state SET seeded_at_causal_version = 9
            WHERE id = $1::uuid`,
          [ps.rows[0]!.id],
        ),
      isPrivilegeViolation,
      'seed version rewrite',
    );
    // Taint + supersede are lawful lifecycle mutations.
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_provider_state
          SET tainted = true, status = 'superseded', updated_at = now()
        WHERE id = $1::uuid`,
      [ps.rows[0]!.id],
    );

    const link = await db.adminPool.query<{ id: string }>(
      `INSERT INTO govai.ai_conversation_evidence_links
         (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id,
          govai_request_id, capture_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid)
       RETURNING id`,
      [
        owner.orgId,
        owner.ownerUserId,
        chain.conversationId,
        chain.branchId,
        chain.turnId,
        chain.attemptId,
        randomUUID(),
        randomUUID(),
      ],
    );
    const linkId = link.rows[0]!.id;
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_evidence_links SET audit_event_id = $1::uuid WHERE id = $2::uuid`,
      [randomUUID(), linkId],
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_evidence_links SET audit_event_id = $1::uuid
            WHERE id = $2::uuid`,
          [randomUUID(), linkId],
        ),
      isPrivilegeViolation,
      'audit_event_id rewrite',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_evidence_links SET govai_request_id = $1::uuid
            WHERE id = $2::uuid`,
          [randomUUID(), linkId],
        ),
      isPrivilegeViolation,
      'govai_request_id rewrite on link',
    );
  });

  it('TRUNCATE is blocked across the domain', async () => {
    await expectError(
      () => db.adminPool.query(`TRUNCATE govai.ai_conversation_items`),
      isPrivilegeViolation,
      'truncate items',
    );
    await expectError(
      () => db.adminPool.query(`TRUNCATE govai.ai_conversations CASCADE`),
      isPrivilegeViolation,
      'truncate conversations',
    );
  });
});
