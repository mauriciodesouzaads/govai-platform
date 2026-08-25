// Keyset cursor — pure encode/decode (EP-AI-CONVERSATION-CONTINUITY-V1 P0-B).
//
// The cursor is client-supplied input that reaches a SQL comparison, so the decode side is
// tested as a REJECTION surface first and a round-trip second.

import { describe, it, expect } from 'vitest';
import { decodeConversationCursor, encodeConversationCursor } from './cursor.js';

const VALID = {
  updatedAt: '2026-08-25 19:49:46.123456+00',
  id: '3f8b1a52-2c4d-4e7a-9b10-6d5f2e8c1a44',
};

describe('conversation list cursor', () => {
  it('round-trips a position byte-faithfully, microseconds included', () => {
    const decoded = decodeConversationCursor(encodeConversationCursor(VALID));
    expect(decoded).toEqual(VALID);
    // The microsecond tail is the whole point: a Date round-trip would truncate it to
    // `.123`, and two rows differing below the millisecond would straddle a page boundary.
    expect(decoded?.updatedAt.endsWith('.123456+00')).toBe(true);
  });

  it('accepts the timestamptz shapes PostgreSQL actually emits', () => {
    for (const u of [
      '2026-08-25 19:49:46+00',
      '2026-08-25 19:49:46.1+00',
      '2026-08-25 19:49:46.123456+00',
      '2026-08-25 16:49:46-03',
      '2026-08-25 16:49:46.5-03:30',
    ]) {
      const decoded = decodeConversationCursor(encodeConversationCursor({ ...VALID, updatedAt: u }));
      expect({ u, ok: decoded !== null }).toEqual({ u, ok: true });
    }
  });

  it('is opaque: the encoding is URL-safe and carries no separators that need escaping', () => {
    const encoded = encodeConversationCursor(VALID);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(encoded)).toBe(encoded);
  });

  it('rejects every malformed cursor shape instead of throwing', () => {
    const cases: Array<[string, string]> = [
      ['empty', ''],
      ['not base64url json', 'not-a-cursor'],
      ['json but not an object', Buffer.from('42', 'utf8').toString('base64url')],
      ['json array', Buffer.from('[1,2]', 'utf8').toString('base64url')],
      ['null', Buffer.from('null', 'utf8').toString('base64url')],
      [
        'wrong version',
        Buffer.from(JSON.stringify({ v: 2, u: VALID.updatedAt, i: VALID.id }), 'utf8').toString(
          'base64url',
        ),
      ],
      [
        'missing fields',
        Buffer.from(JSON.stringify({ v: 1 }), 'utf8').toString('base64url'),
      ],
      [
        'non-string id',
        Buffer.from(JSON.stringify({ v: 1, u: VALID.updatedAt, i: 7 }), 'utf8').toString(
          'base64url',
        ),
      ],
      [
        'id is not a uuid',
        Buffer.from(JSON.stringify({ v: 1, u: VALID.updatedAt, i: 'not-a-uuid' }), 'utf8').toString(
          'base64url',
        ),
      ],
      [
        'iso-8601 timestamp (not the pg rendering)',
        Buffer.from(
          JSON.stringify({ v: 1, u: '2026-08-25T19:49:46.123Z', i: VALID.id }),
          'utf8',
        ).toString('base64url'),
      ],
      [
        'sql fragment in the timestamp',
        Buffer.from(
          JSON.stringify({ v: 1, u: "2026-08-25 19:49:46+00'); DROP TABLE x --", i: VALID.id }),
          'utf8',
        ).toString('base64url'),
      ],
      ['over-long payload', 'A'.repeat(513)],
    ];
    for (const [label, raw] of cases) {
      expect({ label, decoded: decodeConversationCursor(raw) }).toEqual({ label, decoded: null });
    }
  });
});
