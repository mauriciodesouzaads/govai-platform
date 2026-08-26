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

  it('accepts the calendar and clock BOUNDARIES, so the bounds below cannot over-reject', () => {
    // Every value here is one PostgreSQL 16 really casts (verified against `postgres:16-alpine`
    // while this validation was written). They exist so a future tightening of the bounds has to
    // break a test rather than silently start 400-ing a cursor the store itself handed out.
    for (const u of [
      '2024-02-29 23:59:59.123456+00', // leap year, and the full microsecond tail
      '2000-02-29 00:00:00+00', // the 400-year rule: a century that IS a leap year
      '2026-12-31 23:59:59+00', // the last instant of a year
      '2026-08-25 16:49:46.5-03:30', // a half-hour zone
      '2026-08-25 19:49:46-03:06:28', // an LMT-era offset carrying SECONDS (`::text` emits these
      // for pre-standard-time instants: America/Sao_Paulo renders -03:06:28 before 1914)
      '2026-08-25 19:49:46+15:59:59', // PostgreSQL's exact outer displacement bound
      '0001-01-01 00:00:00+00', // the first four-digit AD year
      '9999-12-31 23:59:59+00', // the last one the four-digit grammar can express
    ]) {
      const decoded = decodeConversationCursor(encodeConversationCursor({ ...VALID, updatedAt: u }));
      expect({ u, ok: decoded !== null }).toEqual({ u, ok: true });
      // Byte-faithful: the decoder validates the text, it never re-renders it.
      expect(decoded?.updatedAt).toBe(u);
    }
  });

  it('rejects grammar-shaped timestamps whose calendar/clock fields are impossible', () => {
    // SHAPE IS NOT MEANING — the regression this pins (P0B-GPT-P2-CURSOR-VALIDATION-01). The
    // textual grammar alone admits a month 13 and an hour 99, and the store binds whatever
    // survives decoding as `$n::timestamptz`. PostgreSQL then raises 22008/22009, which is not
    // an InvalidCursorError, so the list route answered a client-controlled malformed cursor
    // with HTTP 500 instead of the contracted 400 `invalid_cursor`.
    const pgRejects: Array<[string, string]> = [
      ['month 13', '2026-13-01 00:00:00+00'],
      ['month 00', '2026-00-01 00:00:00+00'],
      ['february 31', '2026-02-31 00:00:00+00'],
      ['february 29 of a common year', '2025-02-29 00:00:00+00'],
      ['february 29 of a century that is NOT a leap year', '1900-02-29 00:00:00+00'],
      ['april 31', '2026-04-31 00:00:00+00'],
      ['day 00', '2026-08-00 00:00:00+00'],
      ['day 32', '2026-08-32 00:00:00+00'],
      ['year 0000 (there is no year zero)', '0000-01-01 00:00:00+00'],
      ['hour 99', '2026-08-25 99:00:00+00'],
      ['hour 25', '2026-08-25 25:00:00+00'],
      ['hour 24 with a non-zero clock', '2026-08-25 24:00:01+00'],
      ['minute 99', '2026-08-25 19:99:00+00'],
      ['minute 60', '2026-08-25 19:60:00+00'],
      ['second 99', '2026-08-25 19:49:99+00'],
      ['second 61', '2026-08-25 19:49:61+00'],
      ['offset +99', '2026-08-25 19:49:46+99'],
      ['offset +16, one second past the +15:59:59 limit', '2026-08-25 19:49:46+16:00:00'],
      ['offset +16', '2026-08-25 19:49:46+16'],
      ['offset -16', '2026-08-25 19:49:46-16'],
      ['offset +23', '2026-08-25 19:49:46+23'],
      ['offset minute 60', '2026-08-25 19:49:46+15:60'],
      ['offset minute 99', '2026-08-25 19:49:46+00:99'],
      ['offset second 60', '2026-08-25 19:49:46+15:00:60'],
    ];
    // PostgreSQL PARSES these two (it rolls both forward), but `timestamptz::text` can never
    // RENDER them, so they cannot have come from a cursor this server issued. The decoder
    // accepts the subset the store can emit, not everything the parser tolerates.
    const notEmittable: Array<[string, string]> = [
      ['hour 24 (postgres rolls it to the next midnight)', '2026-08-25 24:00:00+00'],
      ['second 60 (postgres rolls it to the next minute)', '2026-08-25 19:49:60+00'],
    ];
    for (const [label, u] of [...pgRejects, ...notEmittable]) {
      // The pinned SHAPE really does admit each one — otherwise this test would be proving
      // nothing about the new semantic bounds.
      expect({ label, shaped: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2}){0,2}$/.test(u) }).toEqual(
        { label, shaped: true },
      );
      const raw = encodeConversationCursor({ ...VALID, updatedAt: u });
      expect({ label, decoded: decodeConversationCursor(raw) }).toEqual({ label, decoded: null });
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
