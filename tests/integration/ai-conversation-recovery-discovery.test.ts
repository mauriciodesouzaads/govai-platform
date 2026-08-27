// EP-AI-CONVERSATION-CONTINUITY-V1 P0-A2 — RECOVERY DISCOVERY, proven against a real Postgres.
//
// Spec: docs/architecture/ai-conversation-continuity-v1.md §7.7 (stranded-turn recovery arms),
// §8 (durable send, branch queue, head-of-queue pickup), §9 (detached discovery under FORCE RLS).
//
//  D1  cross-owner/cross-org discovery works WITHOUT BYPASSRLS and WITHOUT owner context
//  D2  the candidate predicate matrix — every §7.7/§8 class, discoverable or not, with its reason
//  D3  the result is CONTENT-FREE: the return shape is pinned, column by column
//  D4  discovery is SIDE-EFFECT-FREE: repeated calls mutate no attempt column
//  D5  keyset pagination: no duplicate, no skip, stable order, tie-breaker exercised
//  D6  bounds validation fails CLOSED (limit, grace, half-set cursor)
//  D7  the §8 head-of-queue rule: only the branch head is discoverable while unclaimed
//  D8  a drained (terminal) earlier sibling does NOT block the next turn from being head
//  D9  the owner-bound half: each candidate resolves under ITS OWN context and no other's
//  D10 no cleanup-candidate discovery function exists at this anchor (deferral, asserted)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { startPostgres, stopPostgres, migrate, type TestDb } from './setup.js';
import {
  freshOwner,
  seedConversation,
  seedTurn,
  seedAttempt,
  setConversationStatus,
  type OwnerIds,
} from './helpers/ai-conversation-seed.js';
import {
  createConversationWorkerDb,
  type ConversationWorkerDb,
} from '../../apps/api/src/pipeline/ai-conversation-worker.js';
import {
  discoverRecoveryCandidates,
  loadOwnedRecoveryCandidate,
  nextDiscoveryCursor,
  DISCOVERY_MAX_LIMIT,
  type RecoveryCandidate,
} from '../../apps/api/src/pipeline/ai-conversation-recovery-discovery.js';

const GRACE_MS = 30_000;
const EXPIRED = '-10 minutes'; // lease elapsed well past the grace
const LIVE = '5 minutes';

let db: TestDb;
let workerPool: Pool;
let workerDb: ConversationWorkerDb;

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Parameters<typeof createConversationWorkerDb>[0]['log'];

/** orgA/ownerA, orgA/ownerA2 (same org, other owner), orgB/ownerB. */
let ownerA: OwnerIds;
let ownerA2: OwnerIds;
let ownerB: OwnerIds;

/** Every seeded attempt, by the label its case is asserted under. */
const ids = new Map<string, string>();

/** Seed one conversation + root branch + one turn + one attempt in the given shape. */
async function seedCase(
  label: string,
  owner: OwnerIds,
  overrides: Parameters<typeof seedAttempt>[5],
  status: 'active' | 'archived' | 'deleted_pending' = 'active',
): Promise<{ conversationId: string; branchId: string; turnId: string; attemptId: string }> {
  const { conversationId, branchId } = await seedConversation(db.adminPool, owner);
  const { turnId } = await seedTurn(db.adminPool, owner, conversationId, branchId, 1);
  const attemptId = await seedAttempt(
    db.adminPool,
    owner,
    conversationId,
    branchId,
    turnId,
    overrides,
  );
  await db.adminPool.query(
    `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
    [attemptId, turnId],
  );
  if (status !== 'active') await setConversationStatus(db.adminPool, conversationId, status);
  ids.set(label, attemptId);
  return { conversationId, branchId, turnId, attemptId };
}

async function discoverAll(): Promise<RecoveryCandidate[]> {
  return discoverRecoveryCandidates(workerDb, { recoveryGraceMs: GRACE_MS, limit: 200 });
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.adminUrl, db.appPassword, undefined, undefined, db.conversationWorkerPassword);
  workerDb = createConversationWorkerDb({
    config: { connectionString: db.conversationWorkerUrl },
    log: silentLog,
  });
  // P0-C (P0A2-P3-A4): the module no longer exports a raw pool, so this suite opens its own for
  // the direct SQL probes below. The capability is what the production paths use.
  workerPool = new Pool({ connectionString: db.conversationWorkerUrl });
  workerPool.on('error', () => undefined);

  ownerA = freshOwner();
  ownerA2 = { orgId: ownerA.orgId, ownerUserId: freshOwner().ownerUserId };
  ownerB = freshOwner();

  // ---- DISCOVERABLE (one per §7.7/§8 arm, spread across owners and orgs) ------------------
  await seedCase('queued_head', ownerA, { state: 'accepted' });
  await seedCase('accepted_lease_expired', ownerA2, {
    state: 'accepted',
    claimDeadlineInterval: EXPIRED,
  });
  await seedCase('dispatching_lease_expired', ownerB, {
    state: 'dispatching',
    claimDeadlineInterval: EXPIRED,
    providerCredentialId: null, // provenance-absent: still just a candidate to LOCATE
  });
  await seedCase('streaming_lease_expired', ownerB, {
    state: 'streaming',
    claimDeadlineInterval: EXPIRED,
  });
  await seedCase('archived_root_head', ownerA, { state: 'accepted' }, 'archived');

  // ---- NOT DISCOVERABLE ------------------------------------------------------------------
  await seedCase('accepted_live_claim', ownerA, {
    state: 'accepted',
    claimDeadlineInterval: LIVE,
  });
  await seedCase('dispatching_live_lease', ownerA, {
    state: 'dispatching',
    claimDeadlineInterval: LIVE,
    providerCredentialId: null,
  });
  await seedCase('streaming_live_lease', ownerA, {
    state: 'streaming',
    claimDeadlineInterval: LIVE,
  });
  await seedCase('completed', ownerA, { state: 'completed' });
  await seedCase('stopped', ownerA, { state: 'stopped' });
  await seedCase('failed', ownerA, { state: 'failed' });
  await seedCase('rejected', ownerA, { state: 'rejected' });
  await seedCase('outcome_unknown', ownerA, {
    state: 'outcome_unknown',
    claimDeadlineInterval: EXPIRED,
  });
  await seedCase('deleted_pending_root', ownerA, { state: 'accepted' }, 'deleted_pending');
  await seedCase(
    'dispatching_expired_on_deleted_root',
    ownerA,
    { state: 'dispatching', claimDeadlineInterval: EXPIRED, providerCredentialId: null },
    'deleted_pending',
  );

  // ---- §8 branch queue: turn 1 unclaimed head, turn 2 queued behind it -------------------
  {
    const { conversationId, branchId, turnId } = await seedCase('queue_head_t1', ownerA, {
      state: 'accepted',
    });
    const t2 = await seedTurn(db.adminPool, ownerA, conversationId, branchId, 2);
    const a2 = await seedAttempt(db.adminPool, ownerA, conversationId, branchId, t2.turnId, {
      state: 'accepted',
    });
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
      [a2, t2.turnId],
    );
    ids.set('queue_behind_t2', a2);
    expect(turnId).toBeDefined();
  }

  // ---- §8 drained head: turn 1 COMPLETED, turn 2 becomes the head ------------------------
  {
    const { conversationId, branchId } = await seedConversation(db.adminPool, ownerA);
    const t1 = await seedTurn(db.adminPool, ownerA, conversationId, branchId, 1);
    const a1 = await seedAttempt(db.adminPool, ownerA, conversationId, branchId, t1.turnId, {
      state: 'completed',
    });
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
      [a1, t1.turnId],
    );
    const t2 = await seedTurn(db.adminPool, ownerA, conversationId, branchId, 2);
    const a2 = await seedAttempt(db.adminPool, ownerA, conversationId, branchId, t2.turnId, {
      state: 'accepted',
    });
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
      [a2, t2.turnId],
    );
    ids.set('drained_terminal_t1', a1);
    ids.set('drained_new_head_t2', a2);
  }

  // ---- torn reservation: an earlier turn with NO current attempt must BLOCK (fail-closed) --
  {
    const { conversationId, branchId } = await seedConversation(db.adminPool, ownerA);
    await seedTurn(db.adminPool, ownerA, conversationId, branchId, 1); // no current_attempt_id
    const t2 = await seedTurn(db.adminPool, ownerA, conversationId, branchId, 2);
    const a2 = await seedAttempt(db.adminPool, ownerA, conversationId, branchId, t2.turnId, {
      state: 'accepted',
    });
    await db.adminPool.query(
      `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
      [a2, t2.turnId],
    );
    ids.set('behind_torn_reservation', a2);
  }
}, 300_000);

afterAll(async () => {
  await workerDb?.close().catch(() => undefined);
  await workerPool?.end().catch(() => undefined);
  if (db) await stopPostgres(db);
});

describe('P0-A2 — detached recovery discovery', () => {
  it('D1 — discovers across owners AND orgs with no owner context and no BYPASSRLS', async () => {
    const rows = await discoverAll();
    expect(rows.length).toBeGreaterThan(0);
    // Cross-OWNER within one org, and cross-ORG: three distinct owners in one page.
    const owners = new Set(rows.map((r) => r.ownerUserId));
    expect(owners.has(ownerA.ownerUserId)).toBe(true);
    expect(owners.has(ownerA2.ownerUserId)).toBe(true);
    expect(owners.has(ownerB.ownerUserId)).toBe(true);
    expect(new Set(rows.map((r) => r.orgId)).size).toBe(2);
    // The identity that did this holds no RLS bypass.
    const cat = await db.adminPool.query<{ rolbypassrls: boolean }>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'govai_conversation_worker'`,
    );
    expect(cat.rows[0]!.rolbypassrls).toBe(false);
    // Ordinary reads on the SAME pool, without context, still see nothing.
    const c = await workerPool.connect();
    try {
      const none = await c.query(`SELECT id FROM govai.ai_conversation_attempts`);
      expect(none.rowCount).toBe(0);
    } finally {
      c.release();
    }
  });

  it('D2 — candidate predicate matrix: every §7.7/§8 class lands where it was adjudicated', async () => {
    const rows = await discoverAll();
    const byAttempt = new Map(rows.map((r) => [r.attemptId, r]));
    const reasonOf = (label: string): string | undefined =>
      byAttempt.get(ids.get(label)!)?.reason;

    // DISCOVERABLE, with the exact arm that qualified each one.
    expect(reasonOf('queued_head')).toBe('queued_head');
    expect(reasonOf('accepted_lease_expired')).toBe('accepted_lease_expired');
    expect(reasonOf('dispatching_lease_expired')).toBe('dispatching_lease_expired');
    expect(reasonOf('streaming_lease_expired')).toBe('streaming_lease_expired');
    expect(reasonOf('archived_root_head')).toBe('queued_head'); // archived IS execution-eligible

    // NOT DISCOVERABLE — each with the reason it is excluded.
    const excluded = [
      'accepted_live_claim', //          §7.7: deadline recovery applies only PAST the deadline
      'dispatching_live_lease', //       §7.7: a healthy post-boundary lease is not stranded
      'streaming_live_lease', //         §7.7: same
      'completed', //                    §7.6 terminal ratchet
      'stopped',
      'failed',
      'rejected',
      'outcome_unknown', //              probe-only class, deferred (needs credential + provider)
      'deleted_pending_root', //         §19.1 deletion fencing excludes every new claim
      'dispatching_expired_on_deleted_root',
      'queue_behind_t2', //              §8 branch-order predicate: queued, not stranded
      'drained_terminal_t1', //          terminal
      'behind_torn_reservation', //      an earlier turn with no current attempt blocks (closed)
    ];
    for (const label of excluded) {
      expect({ label, present: byAttempt.has(ids.get(label)!) }).toEqual({ label, present: false });
    }
    // Every returned state is non-terminal, always.
    for (const r of rows) {
      expect(['accepted', 'dispatching', 'streaming']).toContain(r.state);
    }
  });

  it('D3 — the discovery result is CONTENT-FREE (return shape pinned column by column)', async () => {
    const shape = await db.adminPool.query<{ parameter_name: string; data_type: string }>(
      `SELECT parameter_name, data_type
         FROM information_schema.parameters
        WHERE specific_schema = 'govai'
          AND specific_name IN (SELECT specific_name FROM information_schema.routines
                                 WHERE routine_schema = 'govai'
                                   AND routine_name = 'ai_turn_recovery_candidates')
          AND parameter_mode = 'OUT'
        ORDER BY ordinal_position`,
    );
    // ★ Pinned, not merely inspected: adding ANY column to the definer's output fails here.
    expect(shape.rows.map((r) => r.parameter_name)).toEqual([
      'org_id',
      'owner_user_id',
      'conversation_id',
      'turn_id',
      'attempt_id',
      'state',
      'reason',
      'claim_token',
      'claim_deadline_at',
      'is_branch_head',
      'attempt_created_at',
    ]);
    // Forbidden column families, named — a regression that starts returning any of them fails.
    const returned = new Set(shape.rows.map((r) => r.parameter_name));
    for (const forbidden of [
      'title',
      'title_ciphertext',
      'title_dek_wrapped',
      'title_hmac',
      'ciphertext',
      'dek_wrapped',
      'content_hmac',
      'content_id',
      'native_request_config_content_id',
      'provider_credential_id',
      'provider_object_id',
      'continuation_parent_ciphertext',
      'continuation_parent_dek_wrapped',
      'kms_key_id',
      'capture_id',
      'govai_request_id',
      'audit_event_id',
      'error_class',
    ]) {
      expect({ forbidden, returned: returned.has(forbidden) }).toEqual({ forbidden, returned: false });
    }
    // No returned VALUE looks like key material or ciphertext either.
    for (const r of await discoverAll()) {
      for (const v of Object.values(r)) {
        expect(v === null || typeof v === 'string' || typeof v === 'boolean').toBe(true);
        expect(Buffer.isBuffer(v)).toBe(false);
      }
    }
  });

  it('D4 — discovery is SIDE-EFFECT-FREE and deterministic on a static dataset', async () => {
    const snapshot = async (): Promise<string> => {
      const r = await db.adminPool.query<{ digest: string }>(
        `SELECT md5(string_agg(x.row_text, '|' ORDER BY x.id)) AS digest
           FROM (SELECT a.id, a::text AS row_text FROM govai.ai_conversation_attempts a) x`,
      );
      return r.rows[0]!.digest;
    };
    // The digest covers EVERY column of every attempt: state, claim_token, claimant,
    // claim_deadline_at, heartbeat_at, stop_requested, causal_version_at_build,
    // provider_credential_id, updated_at — nothing may move.
    const before = await snapshot();
    const p1 = await discoverAll();
    await discoverRecoveryCandidates(workerDb, { recoveryGraceMs: 0, limit: 1 });
    await discoverRecoveryCandidates(workerDb, {
      recoveryGraceMs: GRACE_MS,
      limit: DISCOVERY_MAX_LIMIT,
    });
    const p2 = await discoverAll();
    expect(await snapshot()).toBe(before); // ★ discovery never becomes an implicit claim

    // Same logical page, same order, on unchanged state.
    expect(p2.map((r) => r.attemptId)).toEqual(p1.map((r) => r.attemptId));
    expect(p2.map((r) => r.claimToken)).toEqual(p1.map((r) => r.claimToken));
  });

  it('D5 — keyset pagination: no duplicate, no skip, stable order, tie-breaker exercised', async () => {
    const all = await discoverAll();
    expect(all.length).toBeGreaterThanOrEqual(5);

    const page = async (
      limit: number,
      after: { createdAtText: string; attemptId: string } | null,
    ): Promise<RecoveryCandidate[]> =>
      discoverRecoveryCandidates(workerDb, { recoveryGraceMs: GRACE_MS, limit, after });

    const walk = async (limit: number): Promise<RecoveryCandidate[]> => {
      const seen: RecoveryCandidate[] = [];
      let cursor: { createdAtText: string; attemptId: string } | null = null;
      for (let i = 0; i < 50; i++) {
        const p: RecoveryCandidate[] = await page(limit, cursor);
        if (p.length === 0) break;
        seen.push(...p);
        cursor = nextDiscoveryCursor(p, limit);
        if (cursor === null) break; // short page ⇒ exhausted
      }
      return seen;
    };

    for (const limit of [1, 2, 3]) {
      const paged = await walk(limit);
      const pagedIds = paged.map((r) => r.attemptId);
      expect(new Set(pagedIds).size).toBe(pagedIds.length); // no duplicate
      expect(pagedIds).toEqual(all.map((r) => r.attemptId)); // no skip, same stable order
    }

    // ★ Tie-breaker: seed several attempts inside ONE transaction so now() — and therefore
    // created_at — is IDENTICAL for all of them. Ordering then rests entirely on the (…, id)
    // tie-breaker, and a cursor that ignored it would loop or skip forever.
    const tieOwner = freshOwner();
    const c = await db.adminPool.connect();
    const tied: string[] = [];
    try {
      await c.query('BEGIN');
      for (let i = 0; i < 4; i++) {
        const { conversationId, branchId } = await seedConversation(c, tieOwner);
        const { turnId } = await seedTurn(c, tieOwner, conversationId, branchId, 1);
        const attemptId = await seedAttempt(c, tieOwner, conversationId, branchId, turnId, {
          state: 'accepted',
        });
        await c.query(
          `UPDATE govai.ai_conversation_turns SET current_attempt_id = $1::uuid WHERE id = $2::uuid`,
          [attemptId, turnId],
        );
        tied.push(attemptId);
      }
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
    const stamps = await db.adminPool.query<{ n: string }>(
      `SELECT count(DISTINCT created_at)::text AS n FROM govai.ai_conversation_attempts
        WHERE id = ANY($1::uuid[])`,
      [tied],
    );
    expect(stamps.rows[0]!.n).toBe('1'); // the timestamps really are identical

    const allWithTies = await discoverAll();
    const pagedWithTies = await walk(2);
    expect(pagedWithTies.map((r) => r.attemptId)).toEqual(allWithTies.map((r) => r.attemptId));
    for (const t of tied) expect(pagedWithTies.some((r) => r.attemptId === t)).toBe(true);
  });

  it('D6 — bounds validation fails CLOSED', async () => {
    const call = (recoveryGraceMs: number, limit: number): Promise<unknown> =>
      discoverRecoveryCandidates(workerDb, { recoveryGraceMs, limit });
    await expect(call(GRACE_MS, 0)).rejects.toMatchObject({ code: '22023' });
    await expect(call(GRACE_MS, -1)).rejects.toMatchObject({ code: '22023' });
    await expect(call(GRACE_MS, DISCOVERY_MAX_LIMIT + 1)).rejects.toMatchObject({ code: '22023' });
    await expect(call(-1, 10)).rejects.toMatchObject({ code: '22023' });
    await expect(call(3_600_001, 10)).rejects.toMatchObject({ code: '22023' });
    // The documented ceiling is accepted, so the bound is exact rather than approximate.
    await expect(call(GRACE_MS, DISCOVERY_MAX_LIMIT)).resolves.toBeDefined();
    await expect(call(3_600_000, 1)).resolves.toBeDefined();
    // A HALF-SET cursor is rejected (it would silently degrade to an unbounded restart).
    await expect(
      workerPool.query(
        `SELECT * FROM govai.ai_turn_recovery_candidates($1::integer, $2::integer, now(), NULL)`,
        [GRACE_MS, 10],
      ),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('D7 — §8 head-of-queue: an unclaimed turn behind a non-terminal one is NOT a candidate', async () => {
    const rows = await discoverAll();
    const head = rows.find((r) => r.attemptId === ids.get('queue_head_t1'));
    expect(head?.reason).toBe('queued_head');
    expect(head?.isBranchHead).toBe(true);
    expect(rows.some((r) => r.attemptId === ids.get('queue_behind_t2'))).toBe(false);
    // Every returned unclaimed candidate is flagged head — the arm and the flag agree.
    for (const r of rows.filter((x) => x.reason === 'queued_head')) {
      expect(r.isBranchHead).toBe(true);
      expect(r.claimToken).toBeNull();
      expect(r.claimDeadlineAt).toBeNull();
    }
    // And every claimed candidate carries its fencing operand + lease.
    for (const r of rows.filter((x) => x.reason !== 'queued_head')) {
      expect(r.claimToken).not.toBeNull();
      expect(r.claimDeadlineAt).not.toBeNull();
    }
  });

  it('D8 — a drained (terminal) earlier sibling does not block the next turn from being head', async () => {
    const rows = await discoverAll();
    const newHead = rows.find((r) => r.attemptId === ids.get('drained_new_head_t2'));
    expect(newHead).toBeDefined();
    expect(newHead!.reason).toBe('queued_head');
    expect(newHead!.isBranchHead).toBe(true);
    // The completed turn-1 attempt is itself never a candidate.
    expect(rows.some((r) => r.attemptId === ids.get('drained_terminal_t1'))).toBe(false);
  });

  it('D9 — each candidate resolves under ITS OWN owner context, and under no other', async () => {
    const rows = await discoverAll();
    for (const candidate of rows) {
      const owned = await loadOwnedRecoveryCandidate(workerDb, candidate);
      expect(owned, `candidate ${candidate.attemptId} must resolve under its owner`).not.toBeNull();
      expect(owned!.attemptId).toBe(candidate.attemptId);
      expect(owned!.turnId).toBe(candidate.turnId);
      expect(owned!.conversationId).toBe(candidate.conversationId);
      expect(owned!.state).toBe(candidate.state);
      expect(owned!.claimToken).toBe(candidate.claimToken);
      expect(owned!.isCurrentAttempt).toBe(true);
      expect(['active', 'archived']).toContain(owned!.conversationStatus);
      // Post-boundary states really are post-boundary; the queued arm really is pre-boundary.
      expect(owned!.dispatchBoundaryCommitted).toBe(candidate.state !== 'accepted');
    }

    // Cross-owner: the SAME candidate under a DIFFERENT owner's context resolves to nothing.
    const victim = rows.find((r) => r.ownerUserId === ownerB.ownerUserId);
    expect(victim).toBeDefined();
    const stolen = await loadOwnedRecoveryCandidate(workerDb, {
      ...victim!,
      orgId: ownerA.orgId,
      ownerUserId: ownerA.ownerUserId,
    });
    expect(stolen).toBeNull();
    // Same org, wrong owner: also nothing.
    const sameOrgVictim = rows.find((r) => r.ownerUserId === ownerA2.ownerUserId);
    expect(sameOrgVictim).toBeDefined();
    const sameOrgStolen = await loadOwnedRecoveryCandidate(workerDb, {
      ...sameOrgVictim!,
      ownerUserId: ownerA.ownerUserId,
    });
    expect(sameOrgStolen).toBeNull();
    // A candidate id that does not exist resolves to null, not an error.
    expect(
      await loadOwnedRecoveryCandidate(workerDb, {
        orgId: ownerA.orgId,
        ownerUserId: ownerA.ownerUserId,
        conversationId: randomUUID(),
        attemptId: randomUUID(),
      }),
    ).toBeNull();
    // The owner-bound read leaves the domain untouched (it is SELECT-only by grant).
    const c = await workerPool.connect();
    try {
      await workerDb.withOwnerContext(
        { orgId: ownerA.orgId, ownerUserId: ownerA.ownerUserId },
        async (tx) => {
          await expect(
            tx.query(
              `UPDATE govai.ai_conversation_attempts SET stop_requested = true
                WHERE id = $1::uuid`,
              [ids.get('queued_head')],
            ),
          ).rejects.toMatchObject({ code: '42501' });
        },
      );
    } finally {
      c.release();
    }
  });

  it('D10 — no cleanup-candidate discovery exists at this anchor (deferral is source truth)', async () => {
    // AI_CLEANUP_CANDIDATE_DISCOVERY=DEFERRED_UNTIL_CLEANUP_SCHEMA_EXISTS. The spec's SECOND
    // sanctioned bypass reads a cleanup/disposal-ledger schema 0031 explicitly did not create,
    // so P0-A2 ships NO placeholder — an always-empty function would read as implemented.
    const fn = await db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'govai' AND p.proname = 'ai_cleanup_candidates'`,
    );
    expect(fn.rows[0]!.n).toBe('0');
    const tables = await db.adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'govai'
          AND (c.relname LIKE '%disposal%' OR c.relname LIKE '%cleanup%')`,
    );
    expect(tables.rows[0]!.n).toBe('0');
    // The sanctioned cross-owner claim-plane bypass in the ai_* domain remains exactly ONE.
    const defs = await db.adminPool.query<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'govai' AND p.prosecdef AND p.proname LIKE 'ai_%'
        ORDER BY p.proname`,
    );
    expect(defs.rows.map((r) => r.proname)).toEqual(['ai_turn_recovery_candidates']);
  });
});
