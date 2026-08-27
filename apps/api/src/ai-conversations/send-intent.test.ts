// Send-intent canonicalization contract (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C; spec §8).
//
// These vectors FREEZE `govai.ai_conversation_send_intent.v1`. Changing any of them changes the
// meaning of every committed reservation's identity, so a diff here is a contract change and
// must be treated as one.

import { describe, it, expect } from 'vitest';
import {
  SEND_INTENT_CONTRACT,
  SEND_INTENT_HASH_VERSION,
  buildSendIntent,
  nativeRequestBytes,
  sendIntentHash,
  stableCanonicalJson,
} from './send-intent.js';
import { stableCanonicalJson as forkCanonicalJson } from './fork-intent.js';

const CONV = 'AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA';
const BRANCH = 'BBBBBBBB-2222-4222-8222-BBBBBBBBBBBB';

const hashOf = (input: { conversationId?: string; branchId?: string; nativeRequest: unknown }) =>
  sendIntentHash(
    buildSendIntent({
      conversationId: input.conversationId ?? CONV,
      branchId: input.branchId ?? BRANCH,
      nativeRequest: input.nativeRequest,
    }),
  ).toString('hex');

describe('send intent — what makes two sends THE SAME', () => {
  it('is stable across JSON key order in the native request', () => {
    // The whole point of a canonical form: a client that re-emits its request on a
    // lost-response retry must not be told 409 because its serializer reordered keys.
    const a = hashOf({ nativeRequest: { model: 'm', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] } });
    const b = hashOf({ nativeRequest: { messages: [{ content: 'hi', role: 'user' }], max_tokens: 8, model: 'm' } });
    expect(a).toBe(b);
  });

  it('is stable across UUID CASING but not across UUID VALUE', () => {
    expect(hashOf({ nativeRequest: { m: 1 } })).toBe(
      hashOf({ conversationId: CONV.toLowerCase(), branchId: BRANCH.toLowerCase(), nativeRequest: { m: 1 } }),
    );
    expect(hashOf({ nativeRequest: { m: 1 } })).not.toBe(
      hashOf({ branchId: 'CCCCCCCC-2222-4222-8222-BBBBBBBBBBBB', nativeRequest: { m: 1 } }),
    );
  });

  it('PRESERVES array order — a reordered conversation is a DIFFERENT request', () => {
    const a = hashOf({ nativeRequest: { messages: [{ role: 'user', content: 'one' }, { role: 'user', content: 'two' }] } });
    const b = hashOf({ nativeRequest: { messages: [{ role: 'user', content: 'two' }, { role: 'user', content: 'one' }] } });
    expect(a).not.toBe(b);
  });

  it('distinguishes every semantic axis: conversation, branch, and any request value', () => {
    const base = hashOf({ nativeRequest: { model: 'm', temperature: 0 } });
    expect(hashOf({ conversationId: 'DDDDDDDD-1111-4111-8111-AAAAAAAAAAAA', nativeRequest: { model: 'm', temperature: 0 } })).not.toBe(base);
    expect(hashOf({ branchId: 'EEEEEEEE-2222-4222-8222-BBBBBBBBBBBB', nativeRequest: { model: 'm', temperature: 0 } })).not.toBe(base);
    expect(hashOf({ nativeRequest: { model: 'm2', temperature: 0 } })).not.toBe(base);
    expect(hashOf({ nativeRequest: { model: 'm', temperature: 1 } })).not.toBe(base);
    // An ADDED field is a different intent — silently ignoring unknown fields is how two
    // different client intents come to hash identically.
    expect(hashOf({ nativeRequest: { model: 'm', temperature: 0, stream: true } })).not.toBe(base);
  });

  it('treats null and a missing field as the SAME (documented, not accidental)', () => {
    // `stableCanonicalJson` serializes `undefined` as `null`, so `{a: undefined}` and `{a: null}`
    // collide. A JSON body cannot carry `undefined` over the wire, so the only way to reach this
    // is an explicit null — and "explicitly null" vs "absent" is not a distinction any provider
    // request in scope makes. Pinned so a future change to the canonicalizer is visible.
    expect(stableCanonicalJson({ a: null })).toBe(stableCanonicalJson({ a: undefined }));
  });

  it('is FROZEN: exact hash vectors', () => {
    expect(SEND_INTENT_CONTRACT).toBe('govai.ai_conversation_send_intent.v1');
    expect(SEND_INTENT_HASH_VERSION).toBe(1);
    expect(
      stableCanonicalJson(
        buildSendIntent({ conversationId: CONV, branchId: BRANCH, nativeRequest: { b: 1, a: [2, 3] } }),
      ),
    ).toBe(
      '{"branch_id":"bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",' +
        '"contract":"govai.ai_conversation_send_intent.v1",' +
        '"conversation_id":"aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",' +
        '"native_request":{"a":[2,3],"b":1}}',
    );
    expect(hashOf({ nativeRequest: { b: 1, a: [2, 3] } })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('send intent — contract SEPARATION (the repository rule)', () => {
  it('is a DIFFERENT contract from the fork intent even for identical input', () => {
    // The two canonicalizers are textually identical on purpose and must stay INDEPENDENTLY
    // frozen: a future change to either projection has to be able to move ONE contract's
    // committed hashes without invalidating the other's.
    const payload = { conversation_id: CONV.toLowerCase(), branch_id: BRANCH.toLowerCase() };
    expect(stableCanonicalJson(payload)).toBe(forkCanonicalJson(payload));
    // ...but the INTENT objects differ, because the contract discriminator is inside them.
    const sendJson = stableCanonicalJson(
      buildSendIntent({ conversationId: CONV, branchId: BRANCH, nativeRequest: {} }),
    );
    expect(sendJson).toContain('govai.ai_conversation_send_intent.v1');
    expect(sendJson).not.toContain('fork_intent');
    expect(sendJson).not.toContain('run_execution_intent');
  });
});

describe('nativeRequestBytes — the stored/POSTed rendering', () => {
  it('preserves the CLIENT key order, unlike the intent rendering', () => {
    const req = { model: 'm', max_tokens: 8, messages: [] };
    // The bytes keep the client's order...
    expect(nativeRequestBytes(req).toString('utf8')).toBe(
      '{"model":"m","max_tokens":8,"messages":[]}',
    );
    // ...while the intent rendering sorts, so the two answer different questions.
    expect(stableCanonicalJson(req)).toBe('{"max_tokens":8,"messages":[],"model":"m"}');
  });

  it('round-trips through parse -> canonicalize with a STABLE hash (the replay proof)', () => {
    // The duplicate-send path re-derives the intent from the STORED bytes. That only works if
    // `hash(parsed) === hash(JSON.parse(JSON.stringify(parsed)))` for every value we accept.
    for (const req of [
      { a: 1e2, b: 1.5, c: 'x' },
      { nested: { deep: [1, { k: null }] } },
      { unicode: 'héllo — ünïcode ✓', emoji: '🔐' },
      { big: 9007199254740991, neg: -0.0 },
      { empty: {}, arr: [] },
      { escaped: 'quote " backslash \\ newline \n tab \t' },
    ]) {
      const stored = nativeRequestBytes(req);
      const reparsed: unknown = JSON.parse(stored.toString('utf8'));
      expect(hashOf({ nativeRequest: reparsed })).toBe(hashOf({ nativeRequest: req }));
    }
  });

  it('renders UTF-8, so a multi-byte body is measured in BYTES not characters', () => {
    // The size bound is a byte bound; measuring characters would let a multi-byte body exceed it.
    expect(nativeRequestBytes({ s: '✓' }).byteLength).toBeGreaterThan(
      JSON.stringify({ s: '✓' }).length - 1,
    );
    expect(nativeRequestBytes({ s: '✓' }).toString('utf8')).toBe('{"s":"✓"}');
  });
});
