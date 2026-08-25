// EP-AI-CONVERSATION-CONTINUITY-V1 P0-B — P0A1-C5: `current_attempt_id` MONOTONIC HANDOFF.
//
// 0031's CURRENT_ATTEMPT_LINEAGE_BINDING already proves the pointer names an attempt of the
// SAME turn (and owner, org, conversation, branch). Lineage is not DIRECTION: it admits
// attempt 2 -> attempt 1, which would resurrect a SUPERSEDED attempt's output into the context
// domain and undo §7.6's atomic eligibility handoff. Migration 0033 closes that direction
// STRUCTURALLY, so the invariant holds before Retry exists to depend on it.
//
// Everything here runs on the ADMIN pool (superuser): RLS and grants are bypassed, so every
// rejection proven below is STRUCTURAL. If a superuser cannot do it, no application can.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPostgres, stopPostgres, type TestDb } from './setup.js';
import {
  freshOwner,
  isFkViolation,
  isPrivilegeViolation,
  seedAttempt,
  seedConversation,
  seedFullChain,
  seedTurn,
  type OwnerIds,
} from './helpers/ai-conversation-seed.js';

let db: TestDb;
beforeAll(async () => {
  db = await startPostgres();
}, 240_000);
afterAll(async () => {
  if (db) await stopPostgres(db);
});

const setPointer = (turnId: string, attemptId: string | null): Promise<unknown> =>
  db.adminPool.query(
    `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
    [attemptId, turnId],
  );

async function pointerOf(turnId: string): Promise<string | null> {
  const r = await db.adminPool.query<{ current_attempt_id: string | null }>(
    `SELECT current_attempt_id FROM govai.ai_conversation_turns WHERE id = $1::uuid`,
    [turnId],
  );
  return r.rows[0]!.current_attempt_id;
}

async function expectRejected(
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

/** A turn with attempts 1..n minted through the lawful §7.1b birth path. */
async function seedTurnWithAttempts(
  owner: OwnerIds,
  count: number,
): Promise<{ conversationId: string; branchId: string; turnId: string; attempts: string[] }> {
  const { conversationId, branchId } = await seedConversation(db.adminPool, owner);
  const { turnId } = await seedTurn(db.adminPool, owner, conversationId, branchId, 1);
  const attempts: string[] = [];
  for (let seq = 1; seq <= count; seq += 1) {
    attempts.push(
      await seedAttempt(db.adminPool, owner, conversationId, branchId, turnId, { attemptSeq: seq }),
    );
  }
  return { conversationId, branchId, turnId, attempts };
}

describe('P0A1-C5 — current_attempt_id monotonic handoff (structural)', () => {
  it('G1 — the INITIAL assignment from NULL is lawful (§9 step 1 reservation choreography)', async () => {
    const owner = freshOwner();
    const { turnId, attempts } = await seedTurnWithAttempts(owner, 1);
    expect(await pointerOf(turnId)).toBeNull();
    await setPointer(turnId, attempts[0]!);
    expect(await pointerOf(turnId)).toBe(attempts[0]);
  });

  it('G2 — a FORWARD handoff attempt 1 -> attempt 2 is lawful (§7.6 retry mint)', async () => {
    const owner = freshOwner();
    const { turnId, attempts } = await seedTurnWithAttempts(owner, 3);
    await setPointer(turnId, attempts[0]!);
    await setPointer(turnId, attempts[1]!);
    expect(await pointerOf(turnId)).toBe(attempts[1]);
    // ...and it may keep moving forward, including skipping a sequence.
    await setPointer(turnId, attempts[2]!);
    expect(await pointerOf(turnId)).toBe(attempts[2]);
  });

  it('G3 — a BACKWARD repoint attempt 2 -> attempt 1 is REJECTED', async () => {
    const owner = freshOwner();
    const { turnId, attempts } = await seedTurnWithAttempts(owner, 2);
    await setPointer(turnId, attempts[0]!);
    await setPointer(turnId, attempts[1]!);
    await expectRejected(
      () => setPointer(turnId, attempts[0]!),
      isPrivilegeViolation,
      'backward repoint',
    );
    // The pointer is untouched: a superseded attempt never re-enters the context domain.
    expect(await pointerOf(turnId)).toBe(attempts[1]);
  });

  it('G3b — the rejection is ordered by attempt_seq, never by uuid value', async () => {
    // Two attempts on one turn, then a repoint from the HIGHER seq to the LOWER one, whichever
    // way their uuids happen to sort. If the guard read uuids, one of the two orderings below
    // would slip through.
    for (let trial = 0; trial < 6; trial += 1) {
      const owner = freshOwner();
      const { turnId, attempts } = await seedTurnWithAttempts(owner, 2);
      await setPointer(turnId, attempts[1]!); // start at the HIGHER seq
      await expectRejected(
        () => setPointer(turnId, attempts[0]!),
        isPrivilegeViolation,
        `backward repoint (uuid order ${attempts[0]! < attempts[1]! ? 'asc' : 'desc'})`,
      );
    }
  });

  it('G4 — a handoff to ANOTHER TURN’s attempt is REJECTED', async () => {
    const owner = freshOwner();
    const { conversationId, branchId } = await seedConversation(db.adminPool, owner);
    const t1 = await seedTurn(db.adminPool, owner, conversationId, branchId, 1);
    const t2 = await seedTurn(db.adminPool, owner, conversationId, branchId, 2);
    const a1 = await seedAttempt(db.adminPool, owner, conversationId, branchId, t1.turnId);
    const foreign = await seedAttempt(db.adminPool, owner, conversationId, branchId, t2.turnId);
    await setPointer(t1.turnId, a1);
    await expectRejected(
      () => setPointer(t1.turnId, foreign),
      // The C5 guard refuses first (it cannot PROVE forward motion for an attempt outside this
      // turn); 0031's composite FK is the independent second answer for the same write.
      isPrivilegeViolation,
      'cross-turn handoff',
    );
    expect(await pointerOf(t1.turnId)).toBe(a1);
  });

  it('G5 — a handoff to another CONVERSATION’s attempt is REJECTED', async () => {
    const owner = freshOwner();
    const mine = await seedTurnWithAttempts(owner, 1);
    const other = await seedFullChain(db.adminPool, owner);
    await setPointer(mine.turnId, mine.attempts[0]!);
    await expectRejected(
      () => setPointer(mine.turnId, other.attemptId),
      isPrivilegeViolation,
      'cross-conversation handoff',
    );
    expect(await pointerOf(mine.turnId)).toBe(mine.attempts[0]);
  });

  it('G6 — a handoff to a DIFFERENT OWNER’s attempt is REJECTED (same org and across orgs)', async () => {
    const owner = freshOwner();
    const sameOrgOtherOwner: OwnerIds = { orgId: owner.orgId, ownerUserId: randomUUID() };
    const otherOrg = freshOwner();
    const mine = await seedTurnWithAttempts(owner, 1);
    await setPointer(mine.turnId, mine.attempts[0]!);
    for (const [label, foreignOwner] of [
      ['same org, other owner', sameOrgOtherOwner],
      ['other org', otherOrg],
    ] as const) {
      const foreign = await seedFullChain(db.adminPool, foreignOwner);
      await expectRejected(
        () => setPointer(mine.turnId, foreign.attemptId),
        isPrivilegeViolation,
        `${label} handoff`,
      );
      expect(await pointerOf(mine.turnId)).toBe(mine.attempts[0]);
    }
  });

  it('G7 — a VALUE-IDENTICAL assignment is a harmless no-op', async () => {
    const owner = freshOwner();
    const { turnId, attempts } = await seedTurnWithAttempts(owner, 1);
    await setPointer(turnId, attempts[0]!);
    // Idempotent retries of the same handoff must not fail.
    await setPointer(turnId, attempts[0]!);
    await setPointer(turnId, attempts[0]!);
    expect(await pointerOf(turnId)).toBe(attempts[0]);
    // ...and a NULL -> NULL update on an unpointed turn is equally harmless.
    const fresh = await seedTurnWithAttempts(owner, 1);
    await setPointer(fresh.turnId, null);
    expect(await pointerOf(fresh.turnId)).toBeNull();
  });

  it('G8 — CLEARING a set pointer is REJECTED (a reserved turn is never attempt-less)', async () => {
    const owner = freshOwner();
    const { turnId, attempts } = await seedTurnWithAttempts(owner, 1);
    await setPointer(turnId, attempts[0]!);
    await expectRejected(() => setPointer(turnId, null), isPrivilegeViolation, 'clear pointer');
    expect(await pointerOf(turnId)).toBe(attempts[0]);
  });

  it('G9 — 0031’s composite FK still answers the INITIAL-assignment lineage question', async () => {
    // The C5 guard deliberately does NOT read the target on the NULL -> attempt path: the
    // composite FK is the authority there, and pre-empting it would break the lawful
    // `SET CONSTRAINTS ... DEFERRED` mint of turn + attempt + pointer in one statement pair.
    // This proves the FK is genuinely still doing that job.
    const owner = freshOwner();
    const mine = await seedTurnWithAttempts(owner, 1);
    const other = await seedFullChain(db.adminPool, owner);
    expect(await pointerOf(mine.turnId)).toBeNull();
    await expectRejected(
      () => setPointer(mine.turnId, other.attemptId),
      isFkViolation,
      'initial assignment to a foreign attempt',
    );
  });

  it('G10 — the lawful DEFERRED mint of turn + attempt + pointer still works', async () => {
    // §3's sanctioned technique for the intentionally-circular relationship, and the exact
    // choreography the `before_attempt_output` fork uses so the control plane needs no UPDATE
    // authority on turns at all.
    const owner = freshOwner();
    const { conversationId, branchId } = await seedConversation(db.adminPool, owner);
    const content = await db.adminPool.query<{ id: string }>(
      `INSERT INTO govai.ai_conversation_content
         (org_id, owner_user_id, conversation_id, ciphertext, dek_wrapped,
          kms_key_id, kms_key_version, content_hmac)
       VALUES ($1::uuid, $2::uuid, $3::uuid, '\\x01'::bytea, '\\x02'::bytea, 'k', 1,
               decode(repeat('00', 32), 'hex'))
       RETURNING id`,
      [owner.orgId, owner.ownerUserId, conversationId],
    );
    const turnId = randomUUID();
    const attemptId = randomUUID();
    const c = await db.adminPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET CONSTRAINTS govai.ai_conversation_turns_current_attempt_fk DEFERRED');
      await c.query(
        `INSERT INTO govai.ai_conversation_turns
           (id, org_id, owner_user_id, conversation_id, branch_id, client_turn_id, turn_seq,
            current_attempt_id, native_request_config_content_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, gen_random_uuid(), 1,
                 $6::uuid, $7::uuid)`,
        [
          turnId,
          owner.orgId,
          owner.ownerUserId,
          conversationId,
          branchId,
          attemptId,
          content.rows[0]!.id,
        ],
      );
      await c.query(
        `INSERT INTO govai.ai_conversation_attempts
           (id, org_id, owner_user_id, conversation_id, branch_id, turn_id, attempt_seq)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 1)`,
        [attemptId, owner.orgId, owner.ownerUserId, conversationId, branchId, turnId],
      );
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
    expect(await pointerOf(turnId)).toBe(attemptId);
    // A turn NEVER exists without its attempt, not even for one statement, and the guard did
    // not have to be weakened to allow it.
    const attempt = await db.adminPool.query<{ state: string; claim_token: string | null }>(
      `SELECT state, claim_token FROM govai.ai_conversation_attempts WHERE id = $1::uuid`,
      [attemptId],
    );
    expect(attempt.rows[0]).toEqual({ state: 'accepted', claim_token: null });
  });
});
