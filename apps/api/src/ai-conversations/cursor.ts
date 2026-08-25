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
/** `2026-08-25 19:49:46.123456+00` — the shape `timestamptz::text` produces under any
 *  DateStyle the server may run with is not guaranteed, so the accepted grammar is pinned
 *  here and the store's cast is what produces it. Rejecting anything else keeps a malformed
 *  cursor a 400 rather than a database parse error surfacing as a 500. */
const PG_TIMESTAMPTZ_RE =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2}){0,2}$/;

/** Opaque, URL-safe encoding of a list position. */
export function encodeConversationCursor(cursor: ConversationListCursor): string {
  return Buffer.from(
    JSON.stringify({ v: CURSOR_VERSION, u: cursor.updatedAt, i: cursor.id }),
    'utf8',
  ).toString('base64url');
}

/**
 * Decode a client-supplied cursor. Returns null for ANY malformed input — wrong version,
 * non-base64url, non-JSON, missing/!string fields, a uuid or timestamp that does not match the
 * pinned grammar, or an over-long payload. The caller maps null to HTTP 400; nothing here
 * throws, and nothing here reaches SQL unvalidated.
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
  if (typeof u !== 'string' || !PG_TIMESTAMPTZ_RE.test(u)) return null;
  if (typeof i !== 'string' || !UUID_RE.test(i)) return null;
  return { updatedAt: u, id: i };
}
