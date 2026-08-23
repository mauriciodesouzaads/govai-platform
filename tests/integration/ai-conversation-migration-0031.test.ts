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
  advanceSeededAttempt,
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

type RawAttemptRow = {
  attemptSeq?: number;
  state?: string;
  claimToken?: string | null;
  heartbeatAt?: boolean;
  causalVersionAtBuild?: number | null;
  govaiRequestId?: string | null;
  captureId?: string | null;
  providerCredentialId?: string | null;
  boundary?: boolean;
  terminalAt?: boolean;
  errorClass?: string | null;
  contextExcluded?: boolean;
  stopRequested?: boolean;
  continuationAnchor?: boolean;
};

/**
 * DELIBERATELY MALFORMED attempt INSERT for negative probes (§23: malformed
 * SQL lives inside the negative test, never in a general-purpose seed
 * helper). Runs in a transaction that ALWAYS rolls back, so a probe that
 * unexpectedly passes never pollutes the database. With `bypassTriggers`
 * (superuser `session_replication_role = replica`) the §7.1b birth-guard
 * trigger is disabled so the CHECK-constraint layer is proven INDEPENDENTLY
 * of the trigger layer (CHECKs are not triggers and still fire).
 */
async function rawInsertAttempt(
  owner: { orgId: string; ownerUserId: string },
  chain: { conversationId: string; branchId: string; turnId: string },
  row: RawAttemptRow,
  opts?: { bypassTriggers?: boolean },
): Promise<void> {
  const client = await db.adminPool.connect();
  try {
    await client.query('BEGIN');
    if (opts?.bypassTriggers) {
      await client.query(`SET LOCAL session_replication_role = replica`);
    }
    await client.query(
      `INSERT INTO govai.ai_conversation_attempts
         (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq, state,
          claim_token, claimant, claim_deadline_at, heartbeat_at,
          causal_version_at_build, govai_request_id, capture_id, provider_credential_id,
          dispatch_boundary_committed_at, context_excluded, stop_requested, error_class,
          terminal_at,
          continuation_parent_ciphertext, continuation_parent_dek_wrapped,
          continuation_parent_kms_key_id, continuation_parent_kms_key_version)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::int, $7::text,
               $8::uuid, CASE WHEN $8::uuid IS NULL THEN NULL ELSE 'test-claimant' END,
               CASE WHEN $8::uuid IS NULL THEN NULL ELSE now() + interval '5 minutes' END,
               CASE WHEN $9::boolean THEN now() ELSE NULL END,
               $10::bigint, $11::uuid, $12::uuid, $13::uuid,
               CASE WHEN $14::boolean THEN now() ELSE NULL END,
               $15::boolean, $16::boolean, $17::text,
               CASE WHEN $18::boolean THEN now() ELSE NULL END,
               CASE WHEN $19::boolean THEN $20::bytea ELSE NULL END,
               CASE WHEN $19::boolean THEN $21::bytea ELSE NULL END,
               CASE WHEN $19::boolean THEN 'k' ELSE NULL END,
               CASE WHEN $19::boolean THEN 1 ELSE NULL END)`,
      [
        owner.orgId,
        owner.ownerUserId,
        chain.conversationId,
        chain.branchId,
        chain.turnId,
        row.attemptSeq ?? 99,
        row.state ?? 'accepted',
        row.claimToken ?? null,
        row.heartbeatAt ?? false,
        row.causalVersionAtBuild ?? null,
        row.govaiRequestId ?? null,
        row.captureId ?? null,
        row.providerCredentialId ?? null,
        row.boundary ?? false,
        row.contextExcluded ?? false,
        row.stopRequested ?? false,
        row.errorClass ?? null,
        row.terminalAt ?? false,
        row.continuationAnchor ?? false,
        randomBytes(32),
        randomBytes(64),
      ],
    );
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
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
  // Every probe below bypasses the §7.1b birth-guard trigger (superuser
  // replica mode) so the rejection proven is the CHECK layer ITSELF —
  // independent defense-in-depth under the trigger. The trigger layer has
  // its own dedicated matrix further down.
  it('claim triple is all-or-none; dispatching requires claim + boundary', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    // Token without claimant/deadline (raw partial triple).
    await expectError(
      () =>
        (async () => {
          const client = await db.adminPool.connect();
          try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL session_replication_role = replica`);
            await client.query(
              `INSERT INTO govai.ai_conversation_attempts
                 (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq,
                  claim_token)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 99, $6::uuid)`,
              [
                owner.orgId,
                owner.ownerUserId,
                chain.conversationId,
                chain.branchId,
                chain.turnId,
                randomUUID(),
              ],
            );
          } finally {
            await client.query('ROLLBACK').catch(() => {});
            client.release();
          }
        })(),
      isCheckViolation,
      'claim token without deadline',
    );
    // dispatching unclaimed.
    await expectError(
      () =>
        rawInsertAttempt(owner, chain, { state: 'dispatching', boundary: true }, { bypassTriggers: true }),
      isCheckViolation,
      'dispatching without claim',
    );
    // dispatching without boundary.
    await expectError(
      () =>
        rawInsertAttempt(
          owner,
          chain,
          { state: 'dispatching', claimToken: randomUUID() },
          { bypassTriggers: true },
        ),
      isCheckViolation,
      'dispatching without boundary',
    );
  });

  it('failed requires error_class; outcome_unknown requires the boundary; provenance implies the boundary; ratchets carry terminal_at', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    await expectError(
      () =>
        rawInsertAttempt(
          owner,
          chain,
          { state: 'failed', terminalAt: true, errorClass: null },
          { bypassTriggers: true },
        ),
      isCheckViolation,
      'failed without error_class',
    );
    await expectError(
      () =>
        rawInsertAttempt(
          owner,
          chain,
          {
            state: 'outcome_unknown',
            terminalAt: true,
            boundary: false,
            providerCredentialId: null,
          },
          { bypassTriggers: true },
        ),
      isCheckViolation,
      'outcome_unknown without boundary',
    );
    const cred = await seedProviderCredential(db.adminPool, owner.orgId);
    await expectError(
      () =>
        rawInsertAttempt(
          owner,
          chain,
          { state: 'dispatching', claimToken: randomUUID(), providerCredentialId: cred, boundary: false },
          { bypassTriggers: true },
        ),
      isCheckViolation,
      'provenance without boundary',
    );
    await expectError(
      () =>
        rawInsertAttempt(
          owner,
          chain,
          { state: 'completed', boundary: true, providerCredentialId: cred, terminalAt: false },
          { bypassTriggers: true },
        ),
      isCheckViolation,
      'completed without terminal_at',
    );
    // 'draft' is not a durable attempt state (§7.1b adjudication).
    await expectError(
      () => rawInsertAttempt(owner, chain, { state: 'draft' }, { bypassTriggers: true }),
      isCheckViolation,
      'draft attempt state',
    );
  });

  it('the §3.3 implication matrix holds at the CHECK layer: B/P/identity coherence (P0A1-C2)', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const cred = await seedProviderCredential(db.adminPool, owner.orgId);
    // completed ⟹ B (P-B1: completed born with no boundary and no provenance).
    await expectError(
      () =>
        rawInsertAttempt(
          owner,
          chain,
          { state: 'completed', terminalAt: true },
          { bypassTriggers: true },
        ),
      isCheckViolation,
      'completed without boundary',
    );
    // streaming ⟹ P (P-B2).
    await expectError(
      () =>
        rawInsertAttempt(
          owner,
          chain,
          { state: 'streaming', claimToken: randomUUID(), boundary: true },
          { bypassTriggers: true },
        ),
      isCheckViolation,
      'streaming without provenance',
    );
    // completed ⟹ P (boundary present, provenance absent).
    await expectError(
      () =>
        rawInsertAttempt(
          owner,
          chain,
          { state: 'completed', boundary: true, terminalAt: true },
          { bypassTriggers: true },
        ),
      isCheckViolation,
      'completed without provenance',
    );
    // outcome_unknown ⟹ P (P-B3): provenance-absent ambiguity is provably
    // undispatched and never lands here (§7.7).
    await expectError(
      () =>
        rawInsertAttempt(
          owner,
          chain,
          { state: 'outcome_unknown', claimToken: randomUUID(), boundary: true, terminalAt: true },
          { bypassTriggers: true },
        ),
      isCheckViolation,
      'outcome_unknown without provenance',
    );
    // accepted ⟹ ¬P (P-B4): boundary set so ONLY the new implication fires.
    await expectError(
      () =>
        rawInsertAttempt(
          owner,
          chain,
          { state: 'accepted', boundary: true, providerCredentialId: cred },
          { bypassTriggers: true },
        ),
      isCheckViolation,
      'accepted with provenance',
    );
    // capture_id ⟹ govai_request_id (P-B5): boundary set to isolate the rule.
    await expectError(
      () =>
        rawInsertAttempt(
          owner,
          chain,
          { state: 'accepted', boundary: true, captureId: randomUUID() },
          { bypassTriggers: true },
        ),
      isCheckViolation,
      'capture_id without govai_request_id',
    );
    // govai_request_id ⟹ B (P-B6).
    await expectError(
      () =>
        rawInsertAttempt(
          owner,
          chain,
          { state: 'accepted', govaiRequestId: randomUUID() },
          { bypassTriggers: true },
        ),
      isCheckViolation,
      'govai_request_id without boundary',
    );
    // error_class ⟹ failed (P-A10 as a CHECK: error taxonomy on completed).
    await expectError(
      () =>
        rawInsertAttempt(
          owner,
          chain,
          {
            state: 'completed',
            boundary: true,
            providerCredentialId: cred,
            terminalAt: true,
            errorClass: 'blocked',
          },
          { bypassTriggers: true },
        ),
      isCheckViolation,
      'error_class on a non-failed state',
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

    // A valid link DERIVES its identities from the pinned attempt (§14.3):
    // progress the attempt through the legal path so it actually carries them.
    const reqId = randomUUID();
    const capId = randomUUID();
    await advanceSeededAttempt(db.adminPool, owner, chain.attemptId, {
      state: 'completed',
      govaiRequestId: reqId,
      captureId: capId,
    });
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
        reqId,
        capId,
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

describe('P0A1-C2 — §7.1b attempt birth guard (impossible births rejected)', () => {
  it('an attempt is born accepted, unclaimed and pre-boundary — every fabricated later shape is rejected', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const cred = await seedProviderCredential(db.adminPool, owner.orgId);
    const reqId = randomUUID();
    // P-B1: born terminal (even with a coherent-looking B/P/terminal shape).
    await expectError(
      () =>
        rawInsertAttempt(owner, chain, {
          state: 'completed',
          claimToken: randomUUID(),
          boundary: true,
          govaiRequestId: reqId,
          providerCredentialId: cred,
          terminalAt: true,
        }),
      isPrivilegeViolation,
      'born completed',
    );
    // P-B2: born streaming.
    await expectError(
      () =>
        rawInsertAttempt(owner, chain, {
          state: 'streaming',
          claimToken: randomUUID(),
          boundary: true,
          govaiRequestId: reqId,
          providerCredentialId: cred,
        }),
      isPrivilegeViolation,
      'born streaming',
    );
    // P-B3: born outcome_unknown.
    await expectError(
      () =>
        rawInsertAttempt(owner, chain, {
          state: 'outcome_unknown',
          claimToken: randomUUID(),
          boundary: true,
          govaiRequestId: reqId,
          providerCredentialId: cred,
          terminalAt: true,
        }),
      isPrivilegeViolation,
      'born outcome_unknown',
    );
    // P-B4: born accepted WITH credential provenance.
    await expectError(
      () =>
        rawInsertAttempt(owner, chain, { boundary: true, providerCredentialId: cred }),
      isPrivilegeViolation,
      'born accepted with provenance',
    );
    // P-B5: born with a capture identity.
    await expectError(
      () =>
        rawInsertAttempt(owner, chain, {
          boundary: true,
          govaiRequestId: reqId,
          captureId: randomUUID(),
        }),
      isPrivilegeViolation,
      'born with capture_id',
    );
    // P-B6: born with a request identity.
    await expectError(
      () => rawInsertAttempt(owner, chain, { boundary: true, govaiRequestId: reqId }),
      isPrivilegeViolation,
      'born with govai_request_id',
    );
    // P-B7: born terminal + claimed + flagged.
    await expectError(
      () =>
        rawInsertAttempt(owner, chain, {
          state: 'stopped',
          claimToken: randomUUID(),
          stopRequested: true,
          contextExcluded: true,
          terminalAt: true,
        }),
      isPrivilegeViolation,
      'born stopped/claimed/flagged',
    );
    // Born claimed (reservations are born UNCLAIMED — §8 claim lifecycle).
    await expectError(
      () => rawInsertAttempt(owner, chain, { claimToken: randomUUID() }),
      isPrivilegeViolation,
      'born claimed',
    );
    // Born with lease/causal/anchor authority it cannot yet have.
    await expectError(
      () => rawInsertAttempt(owner, chain, { heartbeatAt: true }),
      isPrivilegeViolation,
      'born with heartbeat',
    );
    await expectError(
      () => rawInsertAttempt(owner, chain, { causalVersionAtBuild: 3 }),
      isPrivilegeViolation,
      'born with causal_version_at_build',
    );
    await expectError(
      () => rawInsertAttempt(owner, chain, { continuationAnchor: true }),
      isPrivilegeViolation,
      'born with continuation anchor',
    );
    await expectError(
      () => rawInsertAttempt(owner, chain, { terminalAt: true }),
      isPrivilegeViolation,
      'born accepted with terminal_at',
    );
    // The genuine §7.1b birth shape still inserts.
    const born = await seedAttempt(
      db.adminPool,
      owner,
      chain.conversationId,
      chain.branchId,
      chain.turnId,
      { attemptSeq: 2 },
    );
    expect(born).toBeTruthy();
  });

  it('the §7.1b reservation still commits atomically under SET CONSTRAINTS DEFERRED', async () => {
    const owner = freshOwner();
    const { conversationId, branchId } = await seedConversation(db.adminPool, owner);
    const configContentId = await seedContent(db.adminPool, owner, conversationId);
    const turnId = randomUUID();
    const attemptId = randomUUID();
    const client = await db.adminPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SET CONSTRAINTS govai.ai_conversation_turns_current_attempt_fk DEFERRED`,
      );
      await client.query(
        `INSERT INTO govai.ai_conversation_turns
           (id, org_id, owner_user_id, conversation_id, branch_id, client_turn_id, turn_seq,
            current_attempt_id, native_request_config_content_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 1, $7::uuid,
                 $8::uuid)`,
        [
          turnId,
          owner.orgId,
          owner.ownerUserId,
          conversationId,
          branchId,
          randomUUID(),
          attemptId,
          configContentId,
        ],
      );
      await client.query(
        `INSERT INTO govai.ai_conversation_attempts
           (id, org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 1)`,
        [attemptId, owner.orgId, owner.ownerUserId, conversationId, branchId, turnId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      throw err;
    }
    client.release();
    const r = await db.adminPool.query<{ current_attempt_id: string }>(
      `SELECT current_attempt_id FROM govai.ai_conversation_turns WHERE id = $1::uuid`,
      [turnId],
    );
    expect(r.rows[0]!.current_attempt_id).toBe(attemptId);
  });
});

describe('P0A1-C2 — §7 forward transition graph', () => {
  it('the full five-commit lifecycle progresses: accepted → claim → dispatching → provenance → streaming → completed', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const cred = await seedProviderCredential(db.adminPool, owner.orgId);
    const id = chain.attemptId;
    const stateOf = async (): Promise<string> =>
      (
        await db.adminPool.query<{ state: string }>(
          `SELECT state FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
          [id],
        )
      ).rows[0]!.state;
    expect(await stateOf()).toBe('accepted');
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET claim_token = $1::uuid, claimant = 'runner', claim_deadline_at = now() + interval '5 minutes'
        WHERE id = $2::uuid`,
      [randomUUID(), id],
    );
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET state = 'dispatching', dispatch_boundary_committed_at = now(),
              govai_request_id = $1::uuid, causal_version_at_build = 0, heartbeat_at = now()
        WHERE id = $2::uuid`,
      [randomUUID(), id],
    );
    expect(await stateOf()).toBe('dispatching');
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET provider_credential_id = $1::uuid
        WHERE id = $2::uuid`,
      [cred, id],
    );
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET state = 'streaming' WHERE id = $1::uuid`,
      [id],
    );
    expect(await stateOf()).toBe('streaming');
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET state = 'completed', terminal_at = now()
        WHERE id = $1::uuid`,
      [id],
    );
    expect(await stateOf()).toBe('completed');
  });

  it('every pre-boundary and post-boundary lawful exit works: stopped/failed/rejected/outcome_unknown', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    // accepted → stopped (queued discard, §8).
    const stopped = await seedAttempt(
      db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
      { attemptSeq: 2, state: 'stopped' },
    );
    // accepted → failed (pre-boundary, credential_unavailable class).
    const failed = await seedAttempt(
      db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
      { attemptSeq: 3, state: 'failed', errorClass: 'credential_unavailable' },
    );
    // accepted → rejected (pre-boundary governance/validation denial).
    const rejected = await seedAttempt(
      db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
      { attemptSeq: 4, state: 'rejected' },
    );
    // dispatching → rejected (post-boundary 4xx before provider processing).
    const dispatched = await seedAttempt(
      db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
      { attemptSeq: 5, state: 'dispatching', providerCredentialId: null },
    );
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET state = 'rejected', terminal_at = now()
        WHERE id = $1::uuid`,
      [dispatched],
    );
    // dispatching → stopped (§19.2 deletion arm — provenance-absent).
    const dispatched2 = await seedAttempt(
      db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
      { attemptSeq: 6, state: 'dispatching', providerCredentialId: null },
    );
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET state = 'stopped', terminal_at = now()
        WHERE id = $1::uuid`,
      [dispatched2],
    );
    // dispatching → outcome_unknown (lease lapse WITH provenance, §7.7).
    const unknown = await seedAttempt(
      db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
      { attemptSeq: 7, state: 'outcome_unknown' },
    );
    // streaming → outcome_unknown (lapsed stream, §7.7).
    const streaming = await seedAttempt(
      db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
      { attemptSeq: 8, state: 'streaming' },
    );
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET state = 'outcome_unknown', terminal_at = now()
        WHERE id = $1::uuid`,
      [streaming],
    );
    expect([stopped, failed, rejected, unknown]).toHaveLength(4);
  });

  it('illegal transitions are structurally rejected (P-A13 skip, P-A14 un-dispatch, and every off-graph edge)', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    // P-A13: accepted → completed, skipping the boundary entirely.
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET state = 'completed', terminal_at = now()
            WHERE id = $1::uuid`,
          [chain.attemptId],
        ),
      isPrivilegeViolation,
      'accepted -> completed',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET state = 'streaming' WHERE id = $1::uuid`,
          [chain.attemptId],
        ),
      isPrivilegeViolation,
      'accepted -> streaming',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET state = 'outcome_unknown', terminal_at = now()
            WHERE id = $1::uuid`,
          [chain.attemptId],
        ),
      isPrivilegeViolation,
      'accepted -> outcome_unknown',
    );
    // P-A14: streaming → accepted is NEVER lawful (post-POST un-dispatch).
    const streaming = await seedAttempt(
      db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
      { attemptSeq: 2, state: 'streaming' },
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET state = 'accepted' WHERE id = $1::uuid`,
          [streaming],
        ),
      isPrivilegeViolation,
      'streaming -> accepted',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET state = 'dispatching' WHERE id = $1::uuid`,
          [streaming],
        ),
      isPrivilegeViolation,
      'streaming -> dispatching',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET state = 'rejected', terminal_at = now()
            WHERE id = $1::uuid`,
          [streaming],
        ),
      isPrivilegeViolation,
      'streaming -> rejected',
    );
    // dispatching → completed skips the stream/terminal-frame proof.
    const dispatched = await seedAttempt(
      db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
      { attemptSeq: 3, state: 'dispatching' },
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET state = 'completed', terminal_at = now()
            WHERE id = $1::uuid`,
          [dispatched],
        ),
      isPrivilegeViolation,
      'dispatching -> completed',
    );
  });

  it('CRITICAL: dispatching → accepted restore succeeds ONLY on the durable no-POST proof (provenance absent), retaining boundary + request id', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const reqId = randomUUID();
    // Provenance-ABSENT dispatching attempt (crashed inside the
    // boundary→commit-4 window): the sanctioned §9.4/§7.7 restore.
    const restorable = await seedAttempt(
      db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
      { attemptSeq: 2, state: 'dispatching', providerCredentialId: null, govaiRequestId: reqId },
    );
    const restore = await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET state = 'accepted', claim_token = $1::uuid, claimant = 'sweeper',
              claim_deadline_at = now() + interval '5 minutes', updated_at = now()
        WHERE id = $2::uuid AND provider_credential_id IS NULL`,
      [randomUUID(), restorable],
    );
    expect(restore.rowCount).toBe(1);
    const row = await db.adminPool.query<{
      state: string;
      govai_request_id: string;
      dispatch_boundary_committed_at: Date | null;
    }>(
      `SELECT state, govai_request_id, dispatch_boundary_committed_at
         FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
      [restorable],
    );
    expect(row.rows[0]!.state).toBe('accepted');
    // §14.1 mint-if-null: the restored attempt RETAINS its identity + boundary.
    expect(row.rows[0]!.govai_request_id).toBe(reqId);
    expect(row.rows[0]!.dispatch_boundary_committed_at).not.toBeNull();
    // ...and the restored attempt is re-dispatchable through the normal edge.
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET state = 'dispatching' WHERE id = $1::uuid`,
      [restorable],
    );

    // Provenance-PRESENT dispatching attempt: commit 4 ran, a POST may
    // already exist — the restore is structurally forbidden.
    const cred = await seedProviderCredential(db.adminPool, owner.orgId);
    const poisoned = await seedAttempt(
      db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
      { attemptSeq: 3, state: 'dispatching', providerCredentialId: cred },
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET state = 'accepted' WHERE id = $1::uuid`,
          [poisoned],
        ),
      isPrivilegeViolation,
      'dispatching -> accepted with provenance',
    );
  });
});

describe('P0A1-C1 — terminal attempts are FULL-ROW ratchets', () => {
  it('no column of a completed attempt may change (exhaustive over the whole stored row)', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const completed = await seedAttempt(
      db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
      {
        attemptSeq: 2,
        state: 'completed',
        govaiRequestId: randomUUID(),
        captureId: randomUUID(),
        continuationAnchor: true,
      },
    );
    const mutations: Array<{ label: string; set: string; param?: unknown; cast?: string }> = [
      { label: 'state un-ratchet', set: `state = 'accepted'` },
      { label: 'claim_token rotation', set: `claim_token = $2::uuid`, param: randomUUID() },
      { label: 'claimant takeover', set: `claimant = 'attacker'` },
      { label: 'claim_deadline extension', set: `claim_deadline_at = now() + interval '99 days'` },
      { label: 'heartbeat forgery', set: `heartbeat_at = now()` },
      { label: 'stop_requested set post-terminal', set: `stop_requested = true` },
      { label: 'causal_version_at_build rewrite', set: `causal_version_at_build = 999` },
      { label: 'govai_request_id rewrite', set: `govai_request_id = $2::uuid`, param: randomUUID() },
      { label: 'govai_request_id null-out', set: `govai_request_id = NULL, capture_id = NULL` },
      { label: 'capture_id rewrite (P-A2)', set: `capture_id = $2::uuid`, param: randomUUID() },
      { label: 'capture_id null-out (P-A3)', set: `capture_id = NULL` },
      { label: 'provenance null-out', set: `provider_credential_id = NULL` },
      { label: 'boundary rewrite', set: `dispatch_boundary_committed_at = now() + interval '10 years'` },
      { label: 'continuation ciphertext rewrite (P-A6)', set: `continuation_parent_ciphertext = $2::bytea`, param: randomBytes(32) },
      { label: 'continuation wrapped-key rewrite', set: `continuation_parent_dek_wrapped = $2::bytea`, param: randomBytes(64) },
      { label: 'continuation key-id rewrite', set: `continuation_parent_kms_key_id = 'other'` },
      { label: 'continuation key-version rewrite', set: `continuation_parent_kms_key_version = 2` },
      { label: 'context_excluded post hoc (P-A9)', set: `context_excluded = true` },
      { label: 'error_class on completed (P-A10)', set: `error_class = 'blocked'` },
      { label: 'terminal_at rewrite (P-A8)', set: `terminal_at = now() + interval '10 years'` },
      { label: 'updated_at drift', set: `updated_at = now() + interval '1 hour'` },
    ];
    for (const m of mutations) {
      await expectError(
        () =>
          db.adminPool.query(
            `UPDATE govai.ai_conversation_attempts SET ${m.set} WHERE id = $1::uuid`,
            m.param === undefined ? [completed] : [completed, m.param],
          ),
        isPrivilegeViolation,
        m.label,
      );
    }
    // A value-identical UPDATE is not a semantic change and may proceed.
    const noop = await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts SET state = 'completed' WHERE id = $1::uuid`,
      [completed],
    );
    expect(noop.rowCount).toBe(1);
  });

  it('stopped, failed and rejected rows are equally frozen', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    for (const [seq, state] of [
      [2, 'stopped'],
      [3, 'failed'],
      [4, 'rejected'],
    ] as const) {
      const id = await seedAttempt(
        db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
        { attemptSeq: seq, state },
      );
      await expectError(
        () =>
          db.adminPool.query(
            `UPDATE govai.ai_conversation_attempts SET claimant = 'attacker' WHERE id = $1::uuid`,
            [id],
          ),
        isPrivilegeViolation,
        `${state} claimant mutation`,
      );
      await expectError(
        () =>
          db.adminPool.query(
            `UPDATE govai.ai_conversation_attempts SET terminal_at = now() WHERE id = $1::uuid`,
            [id],
          ),
        isPrivilegeViolation,
        `${state} terminal_at rewrite`,
      );
    }
  });

  it('capture_id and the dispatch boundary are write-once on LIVE attempts too', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const capId = randomUUID();
    const live = await seedAttempt(
      db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId,
      { attemptSeq: 2, state: 'dispatching', govaiRequestId: randomUUID(), captureId: capId },
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET capture_id = $1::uuid WHERE id = $2::uuid`,
          [randomUUID(), live],
        ),
      isPrivilegeViolation,
      'live capture_id rewrite',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET capture_id = NULL WHERE id = $1::uuid`,
          [live],
        ),
      isPrivilegeViolation,
      'live capture_id null-out',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts
              SET dispatch_boundary_committed_at = now() + interval '1 hour' WHERE id = $1::uuid`,
          [live],
        ),
      isPrivilegeViolation,
      'live boundary rewrite',
    );
  });

  it('outcome_unknown resolves through the CLOSED column set only, then freezes (P-A11/P-A12 closed)', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const mk = async (seq: number): Promise<string> =>
      seedAttempt(db.adminPool, owner, chain.conversationId, chain.branchId, chain.turnId, {
        attemptSeq: seq,
        state: 'outcome_unknown',
        govaiRequestId: randomUUID(),
        captureId: randomUUID(),
      });
    // Resolution rewriting a frozen identity/causal/authority column: rejected.
    const a = await mk(2);
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts
              SET state = 'completed', capture_id = $1::uuid WHERE id = $2::uuid`,
          [randomUUID(), a],
        ),
      isPrivilegeViolation,
      'resolution rewriting capture_id',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts
              SET state = 'completed', causal_version_at_build = 999 WHERE id = $1::uuid`,
          [a],
        ),
      isPrivilegeViolation,
      'resolution rewriting causal_version_at_build',
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts
              SET state = 'completed', claim_token = $1::uuid, claimant = 'probe',
                  claim_deadline_at = now() WHERE id = $2::uuid`,
          [randomUUID(), a],
        ),
      isPrivilegeViolation,
      'resolution rotating the claim',
    );
    // Not resolving: the ratchet timestamp stays frozen.
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET terminal_at = now() WHERE id = $1::uuid`,
          [a],
        ),
      isPrivilegeViolation,
      'outcome_unknown terminal_at drift',
    );
    // Resolution to a non-terminal or wrong terminal: rejected.
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET state = 'stopped' WHERE id = $1::uuid`,
          [a],
        ),
      isPrivilegeViolation,
      'outcome_unknown -> stopped',
    );
    // The sanctioned completed resolution (allowed set only) — then frozen.
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET state = 'completed', context_excluded = true, updated_at = now()
        WHERE id = $1::uuid`,
      [a],
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET claimant = 'late-probe' WHERE id = $1::uuid`,
          [a],
        ),
      isPrivilegeViolation,
      'resolved row mutation (P-A12 closed)',
    );
    // The sanctioned failed resolution carries the error taxonomy.
    const b = await mk(3);
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_attempts
          SET state = 'failed', error_class = 'provider_error', updated_at = now()
        WHERE id = $1::uuid`,
      [b],
    );
    const st = await db.adminPool.query<{ state: string }>(
      `SELECT state FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
      [b],
    );
    expect(st.rows[0]!.state).toBe('failed');
  });
});

describe('P0A1-C1 — provider_state and conversation lifecycle ratchets', () => {
  it('taint never clears; status moves active → superseded only; superseded payload freezes (P-C1/P-C2 closed)', async () => {
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
        owner.orgId, owner.ownerUserId, chain.conversationId, chain.branchId,
        randomBytes(32), randomBytes(64), cred,
      ],
    );
    const id = ps.rows[0]!.id;
    // ACTIVE payload replacement is lawful (§11 captureProviderState delta).
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_provider_state
          SET state_ciphertext = $1::bytea, state_dek_wrapped = $2::bytea, updated_at = now()
        WHERE id = $3::uuid`,
      [randomBytes(32), randomBytes(64), id],
    );
    // Taint (forward) is lawful; clearing it is not — not by time, not by hand.
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_provider_state SET tainted = true WHERE id = $1::uuid`,
      [id],
    );
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_provider_state SET tainted = false WHERE id = $1::uuid`,
          [id],
        ),
      isPrivilegeViolation,
      'taint clear (P-C1)',
    );
    // active → superseded is lawful.
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_provider_state SET status = 'superseded', updated_at = now()
        WHERE id = $1::uuid`,
      [id],
    );
    // superseded → active is not.
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_provider_state SET status = 'active' WHERE id = $1::uuid`,
          [id],
        ),
      isPrivilegeViolation,
      'supersede reversal (P-C2)',
    );
    // A superseded row is historical cleanup state: payload frozen.
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_provider_state SET state_ciphertext = $1::bytea
            WHERE id = $2::uuid`,
          [randomBytes(32), id],
        ),
      isPrivilegeViolation,
      'superseded payload rewrite',
    );
  });

  it('conversation lifecycle: active ↔ archived; one-way through deleted_pending to deleted (P-L1/P-L2 closed)', async () => {
    const owner = freshOwner();
    const { conversationId } = await seedConversation(db.adminPool, owner);
    const setStatus = (status: string): Promise<unknown> =>
      db.adminPool.query(
        `UPDATE govai.ai_conversations SET status = $1::text, updated_at = now()
          WHERE id = $2::uuid`,
        [status, conversationId],
      );
    // active → archived → active (restore from explicit archive) is lawful.
    await setStatus('archived');
    await setStatus('active');
    // Skipping the §19 fencing phase is not.
    await expectError(() => setStatus('deleted'), isPrivilegeViolation, 'active -> deleted');
    // Enter the fencing phase.
    await setStatus('deleted_pending');
    await expectError(() => setStatus('active'), isPrivilegeViolation, 'deleted_pending -> active (P-L1)');
    await expectError(() => setStatus('archived'), isPrivilegeViolation, 'deleted_pending -> archived');
    // Complete the deletion.
    await setStatus('deleted');
    await expectError(() => setStatus('active'), isPrivilegeViolation, 'deleted -> active (P-L2)');
    await expectError(() => setStatus('archived'), isPrivilegeViolation, 'deleted -> archived');
    await expectError(
      () => setStatus('deleted_pending'),
      isPrivilegeViolation,
      'deleted -> deleted_pending',
    );
  });
});

describe('P0A1-C3 — evidence links are identity-bound to their attempt (P-D1/P-D2 closed)', () => {
  const insertLink = (
    owner: { orgId: string; ownerUserId: string },
    chain: { conversationId: string; branchId: string; turnId: string; attemptId: string },
    reqId: string,
    capId: string,
  ): Promise<unknown> =>
    db.adminPool.query(
      `INSERT INTO govai.ai_conversation_evidence_links
         (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_id,
          govai_request_id, capture_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid)`,
      [
        owner.orgId, owner.ownerUserId, chain.conversationId, chain.branchId,
        chain.turnId, chain.attemptId, reqId, capId,
      ],
    );

  it('a link must name the attempt’s OWN request/capture identity — mismatches are FK-rejected', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const reqId = randomUUID();
    const capId = randomUUID();
    await advanceSeededAttempt(db.adminPool, owner, chain.attemptId, {
      state: 'completed',
      govaiRequestId: reqId,
      captureId: capId,
    });
    // P-D1: a lineage-correct link naming ANOTHER invocation's identity.
    await expectError(
      () => insertLink(owner, chain, randomUUID(), capId),
      isFkViolation,
      'mismatched govai_request_id',
    );
    await expectError(
      () => insertLink(owner, chain, reqId, randomUUID()),
      isFkViolation,
      'mismatched capture_id',
    );
    // The truthful link binds.
    await insertLink(owner, chain, reqId, capId);
    // With a link standing, the attempt's capture identity is doubly frozen
    // (terminal freeze + NO ACTION composite FK).
    await expectError(
      () =>
        db.adminPool.query(
          `UPDATE govai.ai_conversation_attempts SET capture_id = $1::uuid WHERE id = $2::uuid`,
          [randomUUID(), chain.attemptId],
        ),
      isPrivilegeViolation,
      'linked attempt capture_id mutation',
    );
  });

  it('a link cannot exist BEFORE the identity assignment it asserts (P-D2)', async () => {
    const owner = freshOwner();
    // Attempt with NO identity at all (accepted, pre-boundary).
    const bare = await seedFullChain(db.adminPool, owner);
    await expectError(
      () => insertLink(owner, bare, randomUUID(), randomUUID()),
      isFkViolation,
      'link on an identity-less attempt',
    );
    // Attempt with a request identity but no capture identity yet.
    const partial = await seedFullChain(db.adminPool, owner);
    const reqId = randomUUID();
    await advanceSeededAttempt(db.adminPool, owner, partial.attemptId, {
      state: 'dispatching',
      govaiRequestId: reqId,
      providerCredentialId: null,
    });
    await expectError(
      () => insertLink(owner, partial, reqId, randomUUID()),
      isFkViolation,
      'link before capture assignment',
    );
  });
});

describe('migration 0031 — remediation safety re-checks', () => {
  it('every ai-conversation function pins search_path and none is SECURITY DEFINER', async () => {
    const r = await db.adminPool.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `SELECT p.proname, p.prosecdef, p.proconfig
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'govai' AND p.proname LIKE 'ai_conversation%'`,
    );
    expect(r.rowCount).toBeGreaterThanOrEqual(10);
    for (const fn of r.rows) {
      expect(fn.prosecdef, `${fn.proname} SECURITY DEFINER`).toBe(false);
      expect(
        (fn.proconfig ?? []).some((c) => c.startsWith('search_path=')),
        `${fn.proname} search_path pin`,
      ).toBe(true);
    }
  });

  it('re-applying 0031 on the POPULATED database preserves rows and keeps the constraint/policy/trigger surface stable', async () => {
    const counts = async (): Promise<{
      rows: number;
      constraints: number;
      policies: number;
      triggers: number;
    }> => {
      const rows = await db.adminPool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM govai.ai_conversation_attempts`,
      );
      const constraints = await db.adminPool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_constraint
          WHERE conrelid = 'govai.ai_conversation_attempts'::regclass`,
      );
      const policies = await db.adminPool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_policies
          WHERE schemaname = 'govai' AND tablename LIKE 'ai_conversation%'`,
      );
      const triggers = await db.adminPool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_trigger
          WHERE tgrelid = 'govai.ai_conversation_attempts'::regclass AND NOT tgisinternal`,
      );
      return {
        rows: Number(rows.rows[0]!.n),
        constraints: Number(constraints.rows[0]!.n),
        policies: Number(policies.rows[0]!.n),
        triggers: Number(triggers.rows[0]!.n),
      };
    };
    const before = await counts();
    expect(before.rows).toBeGreaterThan(0); // populated by the suites above
    expect(before.policies).toBe(16);
    const sql = await readFile(MIGRATION_0031, 'utf8');
    await db.adminPool.query(sql);
    const after = await counts();
    expect(after).toEqual(before);
  });
});
