// P0.3-C — unit tests for the pure run-idempotency helpers: header parsing /
// normalization / hashing, the frozen canonical JSON, and the
// RunExecutionIntentV1 correspondence hash (§6, §8).

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildStandaloneRunIntent,
  buildWorkroomRunIntent,
  parseRunIdempotencyKey,
  runIntentHash,
  stableCanonicalJson,
  InvalidRunIdempotencyKeyError,
  RUN_IDEMPOTENCY_HEADER,
  RUN_INTENT_CONTRACT,
} from './run-idempotency.js';

const NO_RAW: string[] = [];
const oneRaw = (value: string): string[] => ['X-GovAI-Run-Idempotency-Key', value];

describe('parseRunIdempotencyKey', () => {
  it('absent header → null (no key semantics)', () => {
    expect(parseRunIdempotencyKey(undefined, NO_RAW)).toBeNull();
  });

  it('valid key → 32-byte sha256 of the trimmed UTF-8 value, deterministic', () => {
    const h1 = parseRunIdempotencyKey('order-123', oneRaw('order-123'));
    const h2 = parseRunIdempotencyKey('order-123', oneRaw('order-123'));
    expect(h1).not.toBeNull();
    expect(h1!.length).toBe(32);
    expect(h1!.equals(h2!)).toBe(true);
    expect(h1!.equals(createHash('sha256').update('order-123', 'utf8').digest())).toBe(true);
  });

  it('leading/trailing whitespace is trimmed before hashing', () => {
    const trimmed = parseRunIdempotencyKey('key-a', oneRaw('key-a'));
    const padded = parseRunIdempotencyKey('  key-a\t ', oneRaw('  key-a\t '));
    expect(padded!.equals(trimmed!)).toBe(true);
  });

  it('a single value containing a comma is one legitimate key', () => {
    const h = parseRunIdempotencyKey('a, b', oneRaw('a, b'));
    expect(h!.length).toBe(32);
  });

  it('exactly 256 characters is accepted; 257 is rejected', () => {
    const max = 'k'.repeat(256);
    expect(parseRunIdempotencyKey(max, oneRaw(max))!.length).toBe(32);
    const over = 'k'.repeat(257);
    expect(() => parseRunIdempotencyKey(over, oneRaw(over))).toThrow(
      InvalidRunIdempotencyKeyError,
    );
  });

  it('empty-after-trim is rejected', () => {
    expect(() => parseRunIdempotencyKey('   ', oneRaw('   '))).toThrow(
      InvalidRunIdempotencyKeyError,
    );
  });

  it('C0 controls and DEL are rejected', () => {
    for (const bad of ['a\u0001b', 'a\nb', 'a\u001fb', 'a\u007fb']) {
      expect(() => parseRunIdempotencyKey(bad, oneRaw(bad))).toThrow(
        InvalidRunIdempotencyKeyError,
      );
    }
  });

  it('an array header value is ambiguous → rejected', () => {
    expect(() =>
      parseRunIdempotencyKey(['a', 'b'], [...oneRaw('a'), ...oneRaw('b')]),
    ).toThrow(InvalidRunIdempotencyKeyError);
  });

  it('a repeated raw header is ambiguous even after Node joins the values', () => {
    // Node joins repeated regular headers with ', ' before req.headers — the
    // raw pair list is the reliable duplicate-detection surface.
    expect(() =>
      parseRunIdempotencyKey('a, b', [...oneRaw('a'), ...oneRaw('b')]),
    ).toThrow(InvalidRunIdempotencyKeyError);
  });

  it('raw-header matching is case-insensitive on the header name', () => {
    expect(() =>
      parseRunIdempotencyKey('a, b', [
        'x-govai-run-idempotency-key',
        'a',
        'X-GOVAI-RUN-IDEMPOTENCY-KEY',
        'b',
      ]),
    ).toThrow(InvalidRunIdempotencyKeyError);
  });

  it('error messages never contain the key value', () => {
    const secret = 'super-secret-key-value';
    try {
      parseRunIdempotencyKey(secret, oneRaw(secret));
      expect.unreachable('must throw');
    } catch (err) {
      expect((err as Error).message).not.toContain('super-secret');
    }
  });

  it('exports the lowercase header name', () => {
    expect(RUN_IDEMPOTENCY_HEADER).toBe('x-govai-run-idempotency-key');
  });
});

describe('stableCanonicalJson', () => {
  it('is independent of object key insertion order, recursively', () => {
    const a = { b: 1, a: { d: [1, 2], c: 'x' } };
    const b = { a: { c: 'x', d: [1, 2] }, b: 1 };
    expect(stableCanonicalJson(a)).toBe(stableCanonicalJson(b));
    expect(stableCanonicalJson(a)).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
  });

  it('preserves array order', () => {
    expect(stableCanonicalJson([2, 1])).not.toBe(stableCanonicalJson([1, 2]));
  });

  it('serializes null and undefined as null', () => {
    expect(stableCanonicalJson(null)).toBe('null');
    expect(stableCanonicalJson(undefined)).toBe('null');
    expect(stableCanonicalJson({ a: undefined })).toBe('{"a":null}');
  });
});

const STANDALONE_BASE = {
  actorUserId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  capability: 'anthropic.messages.create',
  model: 'claude-fixture-1',
  input: 'hello',
  resolvedMode: 'governed' as const,
  metadata: undefined,
};

const WORKROOM_BASE = {
  ...STANDALONE_BASE,
  createdByParticipantId: '00000000-0000-4000-8000-000000000003',
  workroomId: '00000000-0000-4000-8000-000000000004',
  workroomTaskId: null,
  workroomGovernanceMode: 'governance_active' as const,
  effectiveApprovalRequestId: null,
};

describe('RunExecutionIntentV1 correspondence hash', () => {
  it('omitted metadata normalizes to {} — same hash as explicit {}', () => {
    const h1 = runIntentHash(buildStandaloneRunIntent(STANDALONE_BASE));
    const h2 = runIntentHash(buildStandaloneRunIntent({ ...STANDALONE_BASE, metadata: {} }));
    expect(h1.equals(h2)).toBe(true);
    expect(h1.length).toBe(32);
  });

  it('metadata key order does not change the hash; metadata VALUES do', () => {
    const h1 = runIntentHash(
      buildStandaloneRunIntent({ ...STANDALONE_BASE, metadata: { a: 1, b: 2 } }),
    );
    const h2 = runIntentHash(
      buildStandaloneRunIntent({ ...STANDALONE_BASE, metadata: { b: 2, a: 1 } }),
    );
    const h3 = runIntentHash(
      buildStandaloneRunIntent({ ...STANDALONE_BASE, metadata: { a: 1, b: 3 } }),
    );
    expect(h1.equals(h2)).toBe(true);
    expect(h1.equals(h3)).toBe(false);
  });

  it.each([
    ['input', { input: 'different' }],
    ['model', { model: 'claude-fixture-2' }],
    ['resolved_mode', { resolvedMode: 'passthrough' as const }],
    ['actor', { actorUserId: '00000000-0000-4000-8000-00000000ffff' }],
    ['workspace', { workspaceId: '00000000-0000-4000-8000-00000000fffe' }],
    ['capability', { capability: 'openai.responses.create' }],
  ])('standalone: a changed %s changes the hash', (_label, patch) => {
    const base = runIntentHash(buildStandaloneRunIntent(STANDALONE_BASE));
    const changed = runIntentHash(buildStandaloneRunIntent({ ...STANDALONE_BASE, ...patch }));
    expect(base.equals(changed)).toBe(false);
  });

  it('standalone and workroom intents never collide, even with identical core fields', () => {
    const s = runIntentHash(buildStandaloneRunIntent(STANDALONE_BASE));
    const w = runIntentHash(buildWorkroomRunIntent(WORKROOM_BASE));
    expect(s.equals(w)).toBe(false);
  });

  it.each([
    ['task', { workroomTaskId: '00000000-0000-4000-8000-00000000aaaa' }],
    ['participant', { createdByParticipantId: '00000000-0000-4000-8000-00000000bbbb' }],
    ['governance mode', { workroomGovernanceMode: 'audit_only' as const }],
    ['approval provenance', { effectiveApprovalRequestId: '00000000-0000-4000-8000-00000000cccc' }],
  ])('workroom: a changed %s changes the hash', (_label, patch) => {
    const base = runIntentHash(buildWorkroomRunIntent(WORKROOM_BASE));
    const changed = runIntentHash(buildWorkroomRunIntent({ ...WORKROOM_BASE, ...patch }));
    expect(base.equals(changed)).toBe(false);
  });

  it('the contract string is version-frozen', () => {
    expect(RUN_INTENT_CONTRACT).toBe('govai.run_execution_intent.v1');
    expect(buildStandaloneRunIntent(STANDALONE_BASE).contract).toBe(RUN_INTENT_CONTRACT);
    expect(buildWorkroomRunIntent(WORKROOM_BASE).contract).toBe(RUN_INTENT_CONTRACT);
  });

  it('uuid HEX CASING never changes the hash — routes accept either spelling', () => {
    const sBase = runIntentHash(buildStandaloneRunIntent(STANDALONE_BASE));
    const sUpper = runIntentHash(
      buildStandaloneRunIntent({
        ...STANDALONE_BASE,
        actorUserId: STANDALONE_BASE.actorUserId.toUpperCase(),
        workspaceId: STANDALONE_BASE.workspaceId.toUpperCase(),
      }),
    );
    expect(sUpper.equals(sBase)).toBe(true);

    const withIds = {
      ...WORKROOM_BASE,
      workroomTaskId: '00000000-0000-4000-8000-00000000aaaa',
      effectiveApprovalRequestId: '00000000-0000-4000-8000-00000000cccc',
    };
    const wBase = runIntentHash(buildWorkroomRunIntent(withIds));
    const wUpper = runIntentHash(
      buildWorkroomRunIntent({
        ...withIds,
        actorUserId: withIds.actorUserId.toUpperCase(),
        createdByParticipantId: withIds.createdByParticipantId.toUpperCase(),
        workroomId: withIds.workroomId.toUpperCase(),
        workroomTaskId: withIds.workroomTaskId.toUpperCase(),
        workspaceId: withIds.workspaceId.toUpperCase(),
        effectiveApprovalRequestId: withIds.effectiveApprovalRequestId.toUpperCase(),
      }),
    );
    expect(wUpper.equals(wBase)).toBe(true);
    // DIFFERENT uuids (not just casing) still diverge.
    const wOther = runIntentHash(
      buildWorkroomRunIntent({
        ...withIds,
        workroomTaskId: '00000000-0000-4000-8000-00000000aaab',
      }),
    );
    expect(wOther.equals(wBase)).toBe(false);
  });
});
