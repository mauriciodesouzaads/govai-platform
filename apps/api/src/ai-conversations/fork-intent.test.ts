// Fork intent canonicalization — pure (EP-AI-CONVERSATION-CONTINUITY-V1 P0-B; spec §13/§8).
//
// The hash decides replay-versus-409, so these tests pin BOTH directions: what must collide
// (the same intent spelled differently) and what must never collide (any semantic difference).

import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  FORK_INTENT_CONTRACT,
  FORK_INTENT_HASH_VERSION,
  buildForkIntent,
  forkIntentHash,
  stableCanonicalJson,
} from './fork-intent.js';
import { stableCanonicalJson as runStableCanonicalJson } from '../pipeline/run-idempotency.js';

const BASE = {
  conversationId: '3f8b1a52-2c4d-4e7a-9b10-6d5f2e8c1a44',
  parentBranchId: '9c1e7d30-51aa-4b62-8f03-2e4d6b8a0c71',
  forkedFromTurnId: 'b7d24f18-0e35-4a9c-bd61-7f0a2c53e9d8',
  forkedFromAttemptId: '5a0c93e7-8d21-4f56-a3b8-1c9e4d70f265',
  boundaryMode: 'after_attempt' as const,
  provider: 'anthropic' as const,
  surface: 'anthropic_api',
  model: 'claude-test',
};

type ForkInput = Parameters<typeof buildForkIntent>[0];
const hashOf = (o: Partial<ForkInput>): string =>
  forkIntentHash(buildForkIntent({ ...BASE, ...o })).toString('hex');

describe('fork intent canonicalization', () => {
  it('is deterministic and independent of JavaScript key insertion order', () => {
    expect(stableCanonicalJson({ b: 1, a: 2 })).toBe(stableCanonicalJson({ a: 2, b: 1 }));
    expect(stableCanonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableCanonicalJson([2, 1])).toBe('[2,1]'); // array ORDER is meaning, never sorted
    expect(stableCanonicalJson(undefined)).toBe('null');
  });

  it('names its contract and hash version explicitly', () => {
    const intent = buildForkIntent(BASE);
    expect(intent.contract).toBe(FORK_INTENT_CONTRACT);
    expect(FORK_INTENT_CONTRACT).toBe('govai.ai_conversation_fork_intent.v1');
    expect(FORK_INTENT_HASH_VERSION).toBe(1);
    expect(forkIntentHash(intent)).toHaveLength(32);
  });

  it('is a SEPARATE frozen contract from run idempotency, not a shared import', () => {
    // The two canonicalizers agree today by construction; the point is that they are distinct
    // functions, so a future change to one cannot silently move the other's committed hashes.
    expect(stableCanonicalJson).not.toBe(runStableCanonicalJson);
    // ...and the contract marker is what actually separates the hash domains: the identical
    // fields WITHOUT it hash differently, so no other projection can collide into this one.
    const withoutContract = createHash('sha256')
      .update(
        stableCanonicalJson({
          conversation_id: BASE.conversationId.toLowerCase(),
          parent_branch_id: BASE.parentBranchId.toLowerCase(),
          forked_from_turn_id: BASE.forkedFromTurnId.toLowerCase(),
          forked_from_attempt_id: BASE.forkedFromAttemptId.toLowerCase(),
          boundary_mode: BASE.boundaryMode,
          provider: BASE.provider,
          surface: BASE.surface,
          model: BASE.model,
        }),
        'utf8',
      )
      .digest('hex');
    expect(forkIntentHash(buildForkIntent(BASE)).toString('hex')).not.toBe(withoutContract);
  });

  it('treats uuid CASING as the same intent (a retry that recases is not a new fork)', () => {
    expect(hashOf({ conversationId: BASE.conversationId.toUpperCase() })).toBe(hashOf({}));
    expect(hashOf({ forkedFromAttemptId: BASE.forkedFromAttemptId.toUpperCase() })).toBe(
      hashOf({}),
    );
  });

  it('separates every semantic axis §13 names', () => {
    const base = hashOf({});
    const variants = {
      pinned_attempt: hashOf({ forkedFromAttemptId: '00000000-0000-4000-8000-000000000001' }),
      pinned_turn: hashOf({ forkedFromTurnId: '00000000-0000-4000-8000-000000000002' }),
      parent_branch: hashOf({ parentBranchId: '00000000-0000-4000-8000-000000000003' }),
      conversation: hashOf({ conversationId: '00000000-0000-4000-8000-000000000004' }),
      boundary_mode: hashOf({ boundaryMode: 'before_attempt_output' }),
      provider: hashOf({ provider: 'openai' }),
      surface: hashOf({ surface: 'openai_responses' }),
      model: hashOf({ model: 'other-model' }),
    };
    for (const [axis, h] of Object.entries(variants)) {
      expect({ axis, collides: h === base }).toEqual({ axis, collides: false });
    }
    // ...and every variant is distinct from every other variant too.
    expect(new Set(Object.values(variants)).size).toBe(Object.keys(variants).length);
  });
});
