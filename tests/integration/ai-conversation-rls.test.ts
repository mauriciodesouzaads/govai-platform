// EP-AI-CONVERSATION-CONTINUITY-V1 P0-A1 — owner-scoped RLS matrix
// (dispatch §22 A–G). Every ai_* policy requires BOTH app.org_id AND
// app.user_id: the same org with a different owner is isolated, missing
// context yields nothing, and WITH CHECK rejects foreign stamping. All app
// access runs through govai_app (SELECT + INSERT grants only in P0-A1).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { startPostgres, stopPostgres, type TestDb } from './setup.js';
import {
  freshOwner,
  seedFullChain,
  isPrivilegeViolation,
  type OwnerIds,
} from './helpers/ai-conversation-seed.js';

let db: TestDb;
beforeAll(async () => {
  db = await startPostgres();
}, 240_000);
afterAll(async () => {
  if (db) await stopPostgres(db);
});

/** Run fn inside one govai_app transaction with the given (possibly partial) context. */
async function withCtx<T>(
  orgId: string | null,
  userId: string | null,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await db.appPool.connect();
  try {
    await c.query('BEGIN');
    if (orgId !== null) {
      await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    }
    if (userId !== null) {
      await c.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    }
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

async function countConversations(
  orgId: string | null,
  userId: string | null,
  conversationId: string,
): Promise<number> {
  return withCtx(orgId, userId, async (c) => {
    const r = await c.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
      conversationId,
    ]);
    return r.rowCount ?? 0;
  });
}

async function insertConversationAs(ctx: OwnerIds, rowOwner: OwnerIds): Promise<void> {
  await withCtx(ctx.orgId, ctx.ownerUserId, async (c) => {
    await c.query(
      `INSERT INTO govai.ai_conversations (org_id, owner_user_id, mode, provider, surface, model)
       VALUES ($1::uuid, $2::uuid, 'governed', 'anthropic', 'anthropic_api', 'm')`,
      [rowOwner.orgId, rowOwner.ownerUserId],
    );
  });
}

describe('ai-conversation RLS — dual-predicate owner scoping', () => {
  it('A: the owner (org + user context) reads and inserts their own rows', async () => {
    const owner = freshOwner();
    await insertConversationAs(owner, owner);
    const seen = await withCtx(owner.orgId, owner.ownerUserId, async (c) => {
      const r = await c.query(
        `SELECT org_id, owner_user_id FROM govai.ai_conversations
          WHERE org_id = $1::uuid AND owner_user_id = $2::uuid`,
        [owner.orgId, owner.ownerUserId],
      );
      return r.rowCount ?? 0;
    });
    expect(seen).toBe(1);
  });

  it('B: same org, different owner — U2 cannot read, update, or attach children to U1 rows', async () => {
    const u1 = freshOwner();
    const u2: OwnerIds = { orgId: u1.orgId, ownerUserId: randomUUID() };
    const chain = await seedFullChain(db.adminPool, u1);

    // Read: invisible across every table in the chain.
    expect(await countConversations(u2.orgId, u2.ownerUserId, chain.conversationId)).toBe(0);
    const childCounts = await withCtx(u2.orgId, u2.ownerUserId, async (c) => {
      const tables = [
        'ai_conversation_branches',
        'ai_conversation_turns',
        'ai_conversation_attempts',
        'ai_conversation_content',
      ];
      const counts: number[] = [];
      for (const t of tables) {
        const r = await c.query(`SELECT id FROM govai.${t} WHERE conversation_id = $1::uuid`, [
          chain.conversationId,
        ]);
        counts.push(r.rowCount ?? 0);
      }
      return counts;
    });
    expect(childCounts).toEqual([0, 0, 0, 0]);

    // Update: govai_app holds no UPDATE grant at all in P0-A1 (fails closed).
    let updateBlocked = false;
    try {
      await withCtx(u2.orgId, u2.ownerUserId, async (c) => {
        await c.query(`UPDATE govai.ai_conversations SET status = 'archived' WHERE id = $1::uuid`, [
          chain.conversationId,
        ]);
      });
    } catch (err) {
      updateBlocked = isPrivilegeViolation(err);
    }
    expect(updateBlocked).toBe(true);

    // Child insert under U1's conversation: stamped as U2 → the composite
    // lineage FK finds no (org, U2, conversation) parent → rejected.
    let childBlocked = false;
    try {
      await withCtx(u2.orgId, u2.ownerUserId, async (c) => {
        await c.query(
          `INSERT INTO govai.ai_conversation_branches
             (org_id, owner_user_id, conversation_id, provider, surface, model,
              parent_branch_id, forked_from_turn_id, forked_from_attempt_id, boundary_mode)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'anthropic', 'anthropic_api', 'm',
                   $4::uuid, $5::uuid, $6::uuid, 'after_attempt')`,
          [
            u2.orgId,
            u2.ownerUserId,
            chain.conversationId,
            chain.branchId,
            chain.turnId,
            chain.attemptId,
          ],
        );
      });
    } catch {
      childBlocked = true;
    }
    expect(childBlocked).toBe(true);
  });

  it('C: a different org cannot read or mutate', async () => {
    const owner = freshOwner();
    const foreign = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    expect(await countConversations(foreign.orgId, foreign.ownerUserId, chain.conversationId)).toBe(
      0,
    );
    // Cross-org stamped insert is rejected by WITH CHECK.
    let blocked = false;
    try {
      await insertConversationAs(foreign, { orgId: owner.orgId, ownerUserId: owner.ownerUserId });
    } catch (err) {
      blocked = isPrivilegeViolation(err);
    }
    expect(blocked).toBe(true);
  });

  it('D: org context without user context yields nothing (reads AND writes)', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    expect(await countConversations(owner.orgId, null, chain.conversationId)).toBe(0);
    let blocked = false;
    try {
      await withCtx(owner.orgId, null, async (c) => {
        await c.query(
          `INSERT INTO govai.ai_conversations (org_id, owner_user_id, mode, provider, surface, model)
           VALUES ($1::uuid, $2::uuid, 'governed', 'anthropic', 'anthropic_api', 'm')`,
          [owner.orgId, owner.ownerUserId],
        );
      });
    } catch (err) {
      blocked = isPrivilegeViolation(err);
    }
    expect(blocked).toBe(true);
  });

  it('E: user context without org context yields nothing', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    expect(await countConversations(null, owner.ownerUserId, chain.conversationId)).toBe(0);
  });

  it('F: no context yields nothing', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    expect(await countConversations(null, null, chain.conversationId)).toBe(0);
  });

  it('G: WITH CHECK rejects stamping a different owner or org on INSERT', async () => {
    const ctx = freshOwner();
    // Different owner, same org.
    let ownerBlocked = false;
    try {
      await insertConversationAs(ctx, { orgId: ctx.orgId, ownerUserId: randomUUID() });
    } catch (err) {
      ownerBlocked = isPrivilegeViolation(err);
    }
    expect(ownerBlocked).toBe(true);
    // Different org, same owner id.
    let orgBlocked = false;
    try {
      await insertConversationAs(ctx, { orgId: randomUUID(), ownerUserId: ctx.ownerUserId });
    } catch (err) {
      orgBlocked = isPrivilegeViolation(err);
    }
    expect(orgBlocked).toBe(true);
  });

  it('govai_app holds no DELETE grant on the domain (delete fails closed even for the owner)', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    let blocked = false;
    try {
      await withCtx(owner.orgId, owner.ownerUserId, async (c) => {
        await c.query(`DELETE FROM govai.ai_conversations WHERE id = $1::uuid`, [
          chain.conversationId,
        ]);
      });
    } catch (err) {
      blocked = isPrivilegeViolation(err);
    }
    expect(blocked).toBe(true);
  });

  it('the table owner (govai_audit_writer) has no policy: FORCE RLS yields zero rows', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    // Become the table owner on an admin connection with the OWNER's own
    // context set — FORCE RLS + no policy for the role must still yield 0.
    const c = await db.adminPool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE govai_audit_writer`);
      await c.query("SELECT set_config('app.org_id', $1, true)", [owner.orgId]);
      await c.query("SELECT set_config('app.user_id', $1, true)", [owner.ownerUserId]);
      const r = await c.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
        chain.conversationId,
      ]);
      expect(r.rowCount).toBe(0);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('the whole encrypted chain is readable ONLY under the exact owner context', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    // Positive: full hydration path under the owner context.
    const rows = await withCtx(owner.orgId, owner.ownerUserId, async (c) => {
      const r = await c.query(
        `SELECT t.id, a.state, ct.status
           FROM govai.ai_conversation_turns t
           JOIN govai.ai_conversation_attempts a ON a.id = t.current_attempt_id
             AND a.org_id = t.org_id AND a.owner_user_id = t.owner_user_id
             AND a.conversation_id = t.conversation_id AND a.branch_id = t.branch_id
             AND a.turn_id = t.id
           JOIN govai.ai_conversation_content ct ON ct.id = t.native_request_config_content_id
             AND ct.org_id = t.org_id AND ct.owner_user_id = t.owner_user_id
             AND ct.conversation_id = t.conversation_id
          WHERE t.conversation_id = $1::uuid`,
        [chain.conversationId],
      );
      return r.rows as Array<{ state: string; status: string }>;
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.state).toBe('accepted');
    expect(rows[0]!.status).toBe('active');
  });

  it('provider_state and evidence_links follow the same dual predicate', async () => {
    const owner = freshOwner();
    const stranger: OwnerIds = { orgId: owner.orgId, ownerUserId: randomUUID() };
    const chain = await seedFullChain(db.adminPool, owner);
    await db.adminPool.query(
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
        chain.attemptId,
        randomUUID(),
        randomUUID(),
      ],
    );
    const strangerSees = await withCtx(stranger.orgId, stranger.ownerUserId, async (c) => {
      const links = await c.query(
        `SELECT id FROM govai.ai_conversation_evidence_links WHERE conversation_id = $1::uuid`,
        [chain.conversationId],
      );
      const state = await c.query(
        `SELECT id FROM govai.ai_conversation_provider_state WHERE conversation_id = $1::uuid`,
        [chain.conversationId],
      );
      return (links.rowCount ?? 0) + (state.rowCount ?? 0);
    });
    expect(strangerSees).toBe(0);
    const ownerSees = await withCtx(owner.orgId, owner.ownerUserId, async (c) => {
      const links = await c.query(
        `SELECT id FROM govai.ai_conversation_evidence_links WHERE conversation_id = $1::uuid`,
        [chain.conversationId],
      );
      return links.rowCount ?? 0;
    });
    expect(ownerSees).toBe(1);
  });

  it('an owner-context INSERT of a full chain through govai_app succeeds end to end', async () => {
    const owner = freshOwner();
    await withCtx(owner.orgId, owner.ownerUserId, async (c) => {
      const conv = await c.query<{ id: string }>(
        `INSERT INTO govai.ai_conversations (org_id, owner_user_id, mode, provider, surface, model)
         VALUES ($1::uuid, $2::uuid, 'passthrough', 'openai', 'openai_api', 'm')
         RETURNING id`,
        [owner.orgId, owner.ownerUserId],
      );
      const conversationId = conv.rows[0]!.id;
      const branch = await c.query<{ id: string }>(
        `INSERT INTO govai.ai_conversation_branches
           (org_id, owner_user_id, conversation_id, provider, surface, model)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'openai', 'openai_api', 'm')
         RETURNING id`,
        [owner.orgId, owner.ownerUserId, conversationId],
      );
      const content = await c.query<{ id: string }>(
        `INSERT INTO govai.ai_conversation_content
           (org_id, owner_user_id, conversation_id, ciphertext, dek_wrapped, kms_key_id,
            kms_key_version, content_hmac)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::bytea, 'k', 1, $6::bytea)
         RETURNING id`,
        [owner.orgId, owner.ownerUserId, conversationId, randomBytes(48), randomBytes(64), randomBytes(32)],
      );
      const turn = await c.query<{ id: string }>(
        `INSERT INTO govai.ai_conversation_turns
           (org_id, owner_user_id, conversation_id, branch_id, client_turn_id, turn_seq,
            native_request_config_content_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1, $6::uuid)
         RETURNING id`,
        [
          owner.orgId,
          owner.ownerUserId,
          conversationId,
          branch.rows[0]!.id,
          randomUUID(),
          content.rows[0]!.id,
        ],
      );
      const attempt = await c.query<{ id: string }>(
        `INSERT INTO govai.ai_conversation_attempts
           (org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1)
         RETURNING id`,
        [owner.orgId, owner.ownerUserId, conversationId, branch.rows[0]!.id, turn.rows[0]!.id],
      );
      expect(attempt.rows[0]!.id).toBeTruthy();
    });
  });
});
