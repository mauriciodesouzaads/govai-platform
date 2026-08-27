// Durable-send execution-intent canonicalization (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C;
// spec §8/§13).
//
// PURE. Same tenant + same conversation + same `client_turn_id` + same canonical send intent =>
// ONE durable turn, and every matching replay returns THAT turn. Same key + a DIFFERENT
// canonical intent => 409, with no second turn, no second attempt and no provider dispatch.
//
// ★ DELIBERATELY LOCAL AND FROZEN. This canonicalization is a SEPARATE, INDEPENDENTLY FROZEN
// contract from `pipeline/run-idempotency.ts`'s `govai.run_execution_intent.v1` and from
// `ai-conversations/fork-intent.ts`'s `govai.ai_conversation_fork_intent.v1`, even though all
// three functions are textually identical. They are not shared on purpose: a future change to
// any one projection must be able to move THAT contract's committed hashes without silently
// invalidating the others'. It is likewise NEVER the evidence/core-audit canonicalization —
// the standing repository rule (`run-idempotency.ts:164-170`, spec §22 forbidden coupling 6).
//
// ★ NOT AN EXACTLY-ONCE CLAIM. This is GovAI-local duplicate suppression for a durable
// reservation. It guarantees that one Send produces at most one logical turn and at most one
// INTENTIONAL provider execution. It says nothing about whether a provider that already
// received bytes processed them — that ambiguity is `outcome_unknown` (§7.7), and no
// provider-side exactly-once is claimed anywhere in this movement.
//
// ★ NO HEADER IS OVERLOADED. `client_turn_id` travels in the request BODY, exactly as
// `client_fork_id` does. The existing `X-GovAI-Idempotency-Key` (evidence-capture identity,
// stripped at ingress) and `X-GovAI-Run-Idempotency-Key` (run intent) are untouched: reusing
// either would make two unrelated de-duplication domains share a key space.

import { createHash } from 'node:crypto';

export const SEND_INTENT_CONTRACT = 'govai.ai_conversation_send_intent.v1';
export const SEND_INTENT_HASH_VERSION = 1;

/**
 * The canonical semantic send intent.
 *
 * ★ WHAT MAKES TWO SENDS "THE SAME". The reservation is a promise to execute ONE provider
 * request against ONE branch of ONE conversation. Its semantic identity is therefore exactly:
 * where it runs (`conversation_id`, `branch_id`) and what it runs (`native_request`). Nothing
 * else is admitted — not a timestamp, not a client-supplied label, not the turn's eventual
 * `turn_seq` (which the SERVER allocates and which a legitimate retry of a lost response must
 * not perturb).
 *
 * ★ `native_request` IS THE PROVIDER'S OWN BODY, VERBATIM. No lowest-common-denominator schema
 * is invented (§12/§13): the client sends the provider-native request fragment and GovAI hashes
 * a canonical rendering of it. Two requests that differ only in JSON key order or in
 * insignificant whitespace are the SAME intent; two that differ in any value are not.
 */
export type SendIntentV1 = {
  contract: typeof SEND_INTENT_CONTRACT;
  conversation_id: string;
  branch_id: string;
  native_request: unknown;
};

/**
 * Deterministic canonical JSON: object keys recursively sorted, array order preserved,
 * `undefined` serialized as null, UTF-8, independent of JavaScript insertion order.
 * VERSION-FROZEN for `govai.ai_conversation_send_intent.v1` — changing it changes every
 * committed send-intent hash.
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

export function buildSendIntent(input: {
  conversationId: string;
  branchId: string;
  nativeRequest: unknown;
}): SendIntentV1 {
  return {
    contract: SEND_INTENT_CONTRACT,
    conversation_id: canonicalUuid(input.conversationId),
    branch_id: canonicalUuid(input.branchId),
    native_request: input.nativeRequest,
  };
}

/** `send_intent_hash` = SHA256(UTF8(stableCanonicalJson(intent))). */
export function sendIntentHash(intent: SendIntentV1): Buffer {
  return createHash('sha256').update(stableCanonicalJson(intent), 'utf8').digest();
}

/**
 * The bytes persisted as the turn's immutable native request config — and the SAME bytes the
 * detached claimant later POSTs to the provider.
 *
 * ★ THE FIDELITY BOUNDARY, STATED HONESTLY RATHER THAN OVERCLAIMED. `native_request` reaches
 * this process as an ALREADY-PARSED JSON value: it is a member of the GovAI send envelope, so
 * Fastify parsed the whole body before any GovAI code ran. There is therefore no
 * byte-for-byte original to preserve, and claiming one would be false. What IS preserved is
 * everything semantically meaningful to a provider: every key, every value, every array order,
 * and — because V8 preserves string-key insertion order and `JSON.stringify` walks keys in that
 * order — the client's own key ordering. What is NOT preserved is insignificant whitespace
 * between tokens. No key is added, removed, renamed, reordered, coerced or defaulted: this is
 * NOT the lowest-common-denominator normalization §12 forbids.
 *   (The direct `/passthrough/*` routes DO forward raw client bytes, because there the body IS
 *   the request. That surface is untouched by this movement.)
 *
 * ★ WHY THIS IS NOT THE INTENT RENDERING. The intent hash uses `stableCanonicalJson` (keys
 * SORTED) so that a client which re-emits the same request with a different key order on a
 * lost-response retry is recognised as the SAME send. The stored/POSTed bytes use
 * `JSON.stringify` (keys in the CLIENT's order) so the provider sees the request as the client
 * wrote it. The two renderings answer different questions and must not be conflated: sorting
 * the bytes we send would silently reorder the client's request, and sending the hash rendering
 * would make key order semantically significant to de-duplication.
 */
export function nativeRequestBytes(nativeRequest: unknown): Buffer {
  return Buffer.from(JSON.stringify(nativeRequest), 'utf8');
}
