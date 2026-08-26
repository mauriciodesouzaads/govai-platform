// Keyset pagination cursor for GET /v1/ai/conversations (spec §13: keyset-paged, page <= 50).
//
// PURE. No database, no crypto, no identity. The cursor is a POSITION in the list ordering and
// carries no authorization meaning whatsoever: every page is re-resolved under the caller's own
// dual-predicate FORCE RLS, so a forged or replayed cursor can only move the window inside the
// caller's own rows — never widen it. That is why the payload is plainly encoded rather than
// signed: signing it would imply an authority it must never carry.
//
// ORDERING KEY: `(updated_at DESC, id DESC)`, matching migration 0031's
// `ai_conversations_owner_list_idx (org_id, owner_user_id, status, updated_at DESC)` with the
// primary-key tie-breaker appended. `id` is a v4 uuid — not sequential, so it discloses nothing
// and never encodes creation order; it exists solely to make rows with an IDENTICAL
// `updated_at` (the same-transaction case: `now()` is the transaction timestamp) totally
// ordered, so a page boundary can neither repeat nor skip a row.
//
// ★ `updatedAt` is carried as the EXACT PostgreSQL text rendering of the timestamptz, not as a
// JavaScript `Date`. `timestamptz` holds MICROSECOND precision and `Date` holds milliseconds:
// round-tripping the key through `Date` would truncate it, and two rows whose `updated_at`
// differ only below the millisecond would then straddle the boundary — one silently skipped, or
// one returned twice. The store selects the key column with an explicit `::text` cast and binds
// it back as `$n::timestamptz`, so the comparison is byte-faithful.

/** The exact ordering position of the last row of a page. */
export type ConversationListCursor = {
  /** PostgreSQL text rendering of `updated_at` (microsecond-faithful). */
  updatedAt: string;
  /** Conversation id of that row. */
  id: string;
};

const CURSOR_VERSION = 1;
const MAX_CURSOR_LEN = 512;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `2026-08-25 19:49:46.123456+00` — the ISO rendering of `timestamptz::text`, which the
 *  CONVERSATION TRANSACTION BOUNDARY guarantees: `service.withConversationOwnerContext` pins
 *  `DateStyle` transaction-locally before any domain statement runs, so `store.listConversations`
 *  renders `updated_at::text` under ISO whatever the session was handed
 *  (P0B-P2-CURSOR-DATESTYLE-PIN-01, re-owned by P0B-P2-UNPINNED-TIMESTAMP-PROJECTION-01 when the
 *  same defect turned up on the create/get/patch/fork projections and proved the pin belongs to
 *  the transaction rather than to one statement). Without that pin the emission followed the
 *  session's own `DateStyle`, and a `German`/`SQL`/`Postgres` session made the server issue a
 *  cursor this expression rejects — a 400 on the server's own `next_cursor`. The two are ONE
 *  contract and must move together: this grammar is what the pinned cast produces.
 *  Rejecting anything else keeps a malformed cursor a 400 rather than a database parse error
 *  surfacing as a 500.
 *
 *  ★ SHAPE IS NOT MEANING. This expression pins the LAYOUT only; `isStoreEmittableTimestamptz`
 *  below pins the CALENDAR. `2026-13-01 00:00:00+00` and `2026-08-25 99:00:00+00` match it
 *  perfectly, and a decoder that stopped here returned them as positions — the store then bound
 *  them as `$n::timestamptz` and PostgreSQL raised 22008/22009. A database exception is not an
 *  InvalidCursorError, so the list route answered a client-controlled string with a 500 where
 *  §13 contracts a 400. Hence the groups: every component is range-checked before the value may
 *  become a cursor.
 *
 *  Groups: 1 year · 2 month · 3 day · 4 hour · 5 minute · 6 second · 7 offset hour ·
 *  8 offset minute (optional) · 9 offset second (optional). The offset really can carry seconds:
 *  `::text` renders pre-standard-time instants with their LMT displacement (America/Sao_Paulo
 *  prints `-03:06:28` before 1914), which is why the tail stays `(:dd){0,2}`. The FRACTION is
 *  deliberately not captured — `\.\d{1,6}` is already exactly what PostgreSQL accepts, and its
 *  bytes are carried through untouched rather than re-rendered. */
const PG_TIMESTAMPTZ_RE =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?[+-](\d{2})(?::(\d{2}))?(?::(\d{2}))?$/;

/** Length of `month` (1..12) in `year`, by the proleptic Gregorian rule PostgreSQL's own
 *  calendar uses. Arithmetic, never `Date`: nothing in this file may route the ordering key
 *  through a millisecond-precision type (see the header). */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Is `value` a timestamp the STORE could have RENDERED — and therefore one PostgreSQL will
 * certainly cast back?
 *
 * The bounds are PostgreSQL 16's, field by field: month 1..12, a leap-aware day, hour 0..23,
 * minute and second 0..59, and a UTC displacement inside ±15:59:59 (`+15:59:59` casts,
 * `+16:00:00` does not, and the per-field limits above are exactly that boundary). There is no
 * year zero, so the four-digit grammar means 0001..9999 AD — the whole span it can express, all
 * of it inside `timestamptz`'s range.
 *
 * Deliberately NARROWER than the parser on two points, because the accepted set is what
 * `updated_at::text` emits, not everything `timestamptz` tolerates:
 *   · hour 24 — PostgreSQL reads `24:00:00` as the next midnight, but never prints it;
 *   · second 60 — likewise rolled forward to the next minute, and never printed.
 * Both would cast without error, so neither can cause a 500; they are refused because a cursor
 * carrying one cannot have come from this server, and a position no page boundary can hold is
 * malformed by the same §13 rule as a month 13.
 *
 * Reads the components and returns a verdict. It does not rebuild the value: the caller keeps
 * the caller's own bytes.
 */
function isStoreEmittableTimestamptz(value: string): boolean {
  const m = PG_TIMESTAMPTZ_RE.exec(value);
  if (m === null) return false;
  const [, y, mo, d, hh, mi, ss, offHH, offMM = '00', offSS = '00'] = m;
  // The seven mandatory groups cannot be absent once the expression matched. Stating it keeps
  // the fact checked rather than assumed — and an unexpected absence fails CLOSED.
  if (y === undefined || mo === undefined || d === undefined || hh === undefined) return false;
  if (mi === undefined || ss === undefined || offHH === undefined) return false;

  const year = Number(y);
  const month = Number(mo);
  if (year < 1 || month < 1 || month > 12) return false;
  const day = Number(d);
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (Number(hh) > 23 || Number(mi) > 59 || Number(ss) > 59) return false;
  return Number(offHH) <= 15 && Number(offMM) <= 59 && Number(offSS) <= 59;
}

/** Opaque, URL-safe encoding of a list position. */
export function encodeConversationCursor(cursor: ConversationListCursor): string {
  return Buffer.from(
    JSON.stringify({ v: CURSOR_VERSION, u: cursor.updatedAt, i: cursor.id }),
    'utf8',
  ).toString('base64url');
}

/**
 * Decode a client-supplied cursor. Returns null for ANY malformed input — wrong version,
 * non-JSON, missing/!string fields, an over-long payload, a uuid that does not match its
 * grammar, or a timestamp outside the shape AND the field bounds the store can emit. The caller
 * maps null to HTTP 400; nothing here throws, and nothing here reaches SQL unvalidated.
 *
 * ★ `updatedAt` comes back as the ORIGINAL validated text, byte for byte. Validation READS the
 * components and never re-renders the value, so the microsecond tail survives untouched — the
 * one thing a `Date` round-trip would destroy.
 *
 * ★ `Buffer.from(raw, 'base64url')` is LENIENT: Node drops bytes outside the alphabet instead
 * of failing, so a cursor with stray characters decodes to the SAME payload rather than to null.
 * That is a tolerance, not a hole — the payload is then validated field by field, the position
 * such a cursor names is the identical one, and nothing unvalidated proceeds.
 */
export function decodeConversationCursor(raw: string): ConversationListCursor | null {
  if (raw.length === 0 || raw.length > MAX_CURSOR_LEN) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const { v, u, i } = parsed as { v?: unknown; u?: unknown; i?: unknown };
  if (v !== CURSOR_VERSION) return null;
  if (typeof u !== 'string' || !isStoreEmittableTimestamptz(u)) return null;
  if (typeof i !== 'string' || !UUID_RE.test(i)) return null;
  return { updatedAt: u, id: i };
}
