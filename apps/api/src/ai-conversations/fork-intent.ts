// Fork execution-intent canonicalization (EP-AI-CONVERSATION-CONTINUITY-V1 P0-B; spec §13/§8).
//
// PURE. Same tenant + same `client_fork_id` + same canonical fork intent => ONE durable branch,
// and every matching replay returns THAT branch. Same key + a DIFFERENT canonical intent => 409,
// with no second branch, no second child turn and no second attempt committed.
//
// ★ DELIBERATELY LOCAL AND FROZEN. This canonicalization is a SEPARATE, INDEPENDENTLY FROZEN
// contract from `pipeline/run-idempotency.ts`'s `govai.run_execution_intent.v1`, even though
// the two functions are textually similar. They are not shared on purpose: a future change to
// either projection must be able to move ONE contract's committed hashes without silently
// invalidating the other's. It is likewise NEVER the evidence/core-audit canonicalization —
// the standing repository rule (`run-idempotency.ts:164-170`, spec §22 forbidden coupling 6).
//
// ★ NOT AN EXACTLY-ONCE CLAIM. A fork commits no provider work; P0-B performs no provider call
// at all. This is GovAI-local duplicate suppression for a durable control-plane object.
//
// ★ NO HEADER IS OVERLOADED. `client_fork_id` travels in the request BODY. The existing
// `X-GovAI-Idempotency-Key` (evidence-capture identity) and `X-GovAI-Run-Idempotency-Key` (run
// intent) are untouched, and `X-GovAI-Client-Turn-Id` (the §8 send reservation) is not minted
// by this movement.

import { createHash } from 'node:crypto';
import type { ConversationProvider, ForkBoundaryMode } from './contracts.js';

export const FORK_INTENT_CONTRACT = 'govai.ai_conversation_fork_intent.v1';
export const FORK_INTENT_HASH_VERSION = 1;

/**
 * The canonical semantic fork intent (§13: "same key + different fork intent — pinned attempt,
 * mode, triple, or replacement config — is a 409").
 *
 * ★ The triple recorded here is the RESOLVED one, after per-field inheritance from the parent
 * branch. Adjudication: "omit the triple" and "state the triple the parent already has" are the
 * SAME fork, and hashing the raw request would make a client that becomes more explicit on a
 * retry collide with itself. Resolution is stable because 0031's branches guard FREEZES a
 * branch's provider/surface/model for its whole lifetime, so the same request always resolves
 * to the same triple.
 *
 * ★ No replacement native config field exists, because P0-B accepts none: a
 * `before_attempt_output` fork that would change the triple is REJECTED (see service.ts).
 * Adding an always-null field now would freeze a placeholder into the hash domain.
 */
export type ForkIntentV1 = {
  contract: typeof FORK_INTENT_CONTRACT;
  conversation_id: string;
  parent_branch_id: string;
  forked_from_turn_id: string;
  forked_from_attempt_id: string;
  boundary_mode: ForkBoundaryMode;
  provider: ConversationProvider;
  surface: string;
  model: string;
};

/**
 * Deterministic canonical JSON: object keys recursively sorted, array order preserved,
 * `undefined` serialized as null, UTF-8, independent of JavaScript insertion order.
 * VERSION-FROZEN for `govai.ai_conversation_fork_intent.v1` — changing it changes every
 * committed `fork_intent_hash`.
 */
export function stableCanonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableCanonicalJson(obj[k])}`)
    .join(',')}}`;
}

/** UUID-valued intent fields are canonicalized to lowercase: the route accepts any hexadecimal
 *  casing and PostgreSQL compares `uuid` case-insensitively, so the client's spelling must never
 *  influence the semantic hash — a retry differing only in uuid casing is the SAME intent. */
const canonicalUuid = (v: string): string => v.toLowerCase();

/** Build the canonical intent from an already-RESOLVED fork. */
export function buildForkIntent(input: {
  conversationId: string;
  parentBranchId: string;
  forkedFromTurnId: string;
  forkedFromAttemptId: string;
  boundaryMode: ForkBoundaryMode;
  provider: ConversationProvider;
  surface: string;
  model: string;
}): ForkIntentV1 {
  return {
    contract: FORK_INTENT_CONTRACT,
    conversation_id: canonicalUuid(input.conversationId),
    parent_branch_id: canonicalUuid(input.parentBranchId),
    forked_from_turn_id: canonicalUuid(input.forkedFromTurnId),
    forked_from_attempt_id: canonicalUuid(input.forkedFromAttemptId),
    boundary_mode: input.boundaryMode,
    provider: input.provider,
    surface: input.surface,
    model: input.model,
  };
}

/** `fork_intent_hash` = SHA256(UTF8(stableCanonicalJson(intent))). */
export function forkIntentHash(intent: ForkIntentV1): Buffer {
  return createHash('sha256').update(stableCanonicalJson(intent), 'utf8').digest();
}
