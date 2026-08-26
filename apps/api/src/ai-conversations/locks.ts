// LAW 16 — the conversation domain's lock levels, named once (spec §24 LAW 16, §8, §19.1).
//
//   (1) CONVERSATION ROOT LIFECYCLE AUTHORITY — the `ai_conversations` row lock.
//   (2) BRANCH EXECUTION AUTHORITY          — the per-branch advisory xact lock.
//   (3) turn/attempt row mutation           — ordinary writes, taken last.
//
// No flow may acquire a higher level after holding a lower one. This module exists so that
// P0-C's runner, §7.8's recovery decision and §19's deletion protocol REUSE these exact
// primitives instead of minting a second, incompatible locking domain for the same objects —
// two domains would serialize nothing.
//
// ★ LEVEL (2) IS AN ADVISORY XACT LOCK, following the repository's proven per-entity
// serialization idiom (`workroom-transcript.ts:127-136`, `run-orchestrator.ts:182`,
// `regulatory/service.ts:533`): `pg_advisory_xact_lock(hashtext(<namespace> || id)::bigint)`.
// It is released by COMMIT or ROLLBACK — never leaked to a pooled connection — and it is the
// same primitive spec §8 names for `turn_seq` ordering, so the single-flight predicate P0-C
// adds later lands on the authority already held here.
//
// ★ THE NAMESPACE STRING IS PART OF THE CONTRACT. `hashtext` is a 32-bit hash: two different
// namespaces can collide, and a collision would make two unrelated entities serialize against
// each other (a liveness bug, never a safety one). It is exported as a constant so every future
// caller derives the identical key rather than retyping the literal.

import type { PoolClient } from 'pg';

/** Advisory-lock namespace for LAW 16 level (2). Never reuse it for another entity kind. */
export const BRANCH_EXECUTION_AUTHORITY_NAMESPACE = 'ai_conversation_branch:';

/** The exact `hashtext` input for a branch's execution authority. */
export function branchExecutionAuthorityKey(branchId: string): string {
  return `${BRANCH_EXECUTION_AUTHORITY_NAMESPACE}${branchId}`;
}

/**
 * LAW 16 level (1). Takes the conversation root row lock and returns the lifecycle state
 * observed UNDER that lock — the revalidation §8 requires ("REVALIDATE `status` under the lock,
 * then write"), so a caller can never run the forbidden check-then-write sequence.
 *
 * Returns null when the row is not reachable by this session (absent, or filtered by the
 * dual-predicate FORCE RLS: another owner, another org). Ownership is decided by the POLICY,
 * not by a WHERE clause added here.
 *
 * ★ `FOR UPDATE` (not `FOR KEY SHARE`): this is the level (1) EXCLUSIVE authority every
 * descendant-creating operation takes (§8), and it is exactly what §19.1's `deleted_pending`
 * transition will conflict with. `FOR KEY SHARE` is the weaker mode §7.7 reserves for the
 * dispatch-boundary commit, which is a P0-C path and deliberately not implemented here.
 */
export async function lockConversationRoot(
  client: PoolClient,
  conversationId: string,
): Promise<{ id: string; status: string; provider: string; surface: string; model: string } | null> {
  const r = await client.query<{
    id: string;
    status: string;
    provider: string;
    surface: string;
    model: string;
  }>(
    `SELECT id, status, provider, surface, model
       FROM govai.ai_conversations
      WHERE id = $1::uuid
      FOR UPDATE`,
    [conversationId],
  );
  return r.rows[0] ?? null;
}

/**
 * LAW 16 level (2). Acquire the branch execution authority for the remainder of the
 * transaction. MUST be called only while level (1) is already held.
 *
 * ★ Callers MUST validate that the branch belongs to the caller's conversation BEFORE calling
 * this — the key is derived from a client-supplied uuid, and locking an unvalidated id would
 * let a caller take the authority of a branch it cannot even read.
 */
export async function acquireBranchExecutionAuthority(
  client: PoolClient,
  branchId: string,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
    branchExecutionAuthorityKey(branchId),
  ]);
}
