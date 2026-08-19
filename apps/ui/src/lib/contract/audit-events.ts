// MIRROR of GET /v1/audit-events. Authoritative source (re-read at main 88191a6f):
//   apps/api/src/routes/audit-events.ts
//
// This endpoint exposes chain METADATA and CRYPTOGRAPHIC HASHES only. It never returns the
// event payload: `canonical_bytes` exists in the table but is not selected (:68-71). Any UI
// built on it demonstrates integrity, not content.
//
// ★ Every object schema here is LOOSE (`z.looseObject`). Zod's default object behaviour strips
// unknown keys, so an additive backend field would silently disappear from a query export that
// calls itself "serialized without post-processing" — the export would be a projection while
// claiming to be the response. Strict schemas would fail the opposite way, breaking the UI on
// an additive change the backend is entitled to make. Loose validates what the UI depends on
// and carries everything else through unchanged.

import { z } from 'zod';

/** audit-events.ts:8 — required, no default. Four HMAC chains per org. */
export const CHAIN_CATEGORIES = ['auth', 'run', 'policy', 'admin'] as const;
export const ChainCategory = z.enum(CHAIN_CATEGORIES);
export type ChainCategory = z.infer<typeof ChainCategory>;

/** audit-events.ts:9 — limit ≤200, default 50. */
export const AUDIT_EVENTS_MAX_LIMIT = 200;
export const AUDIT_EVENTS_DEFAULT_LIMIT = 50;

/** audit-events.ts:81-97.
 *
 *  ★ `sequence_number` is a JS NUMBER here, not a decimal string: the route narrows it with
 *  Number() at :84. The repository's "bigint as a decimal string" convention applies to
 *  Ec2GapRow (evidence gaps), NOT to this route — the UI mirrors what each route actually
 *  returns rather than a blanket rule.
 *
 *  Every hash field arrives as lowercase hex; `previous_hmac` is null on the first event of
 *  a chain (a genesis link, not a break). */
export const AuditEvent = z.looseObject({
  id: z.string(),
  chain_id: z.string(),
  sequence_number: z.number(),
  event_type: z.string(),
  event_version: z.string(),
  subject_type: z.string(),
  subject_id: z.string(),
  occurred_at: z.string(),
  payload_hash: z.string(),
  previous_hmac: z.string().nullable(),
  hmac: z.string(),
  canonical_hash: z.string(),
  evidence_strength: z.string(),
  key_id: z.string(),
  key_version: z.number(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

/** audit-events.ts:79-98.
 *
 *  ★ There is NO server-side next cursor. Pagination is keyset on `before_seq` (strict `<`,
 *  ORDER BY sequence_number DESC), so the client derives the next page parameter from the
 *  LAST row of the current page and stops when a page comes back shorter than `limit`. */
export const AuditEventsResponse = z.looseObject({
  chain_id: z.string(),
  events: z.array(AuditEvent),
});
export type AuditEventsResponse = z.infer<typeof AuditEventsResponse>;
