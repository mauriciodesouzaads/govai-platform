// MIRROR of GET /v1/me — the authenticated-principal projection (EP-UIUX-V1-B2).
// Authoritative sources (re-read at this base, NOT copied from any plan document):
//   apps/api/src/routes/me.ts            — the response projection
//   apps/api/src/pipeline/auth.ts:15-28  — AuthIdentity, the thing being projected
//   apps/api/src/db/migrations/0008_orgs_tier.sql:21-27 — the tier / operational_mode CHECKs
//   packages/core-identity/src/rbac.ts:1-9              — the canonical Role enum
//
// Mirrored here and NOWHERE else in the UI. When `@govai/api-contract` (EP-B7) exists, this
// file becomes a re-export.
//
// ★ EVERY VALUE FIELD IS `z.string()`, NOT `z.enum(...)`, AND THAT IS DELIBERATE.
// `/v1/me` is the sign-in probe: a parse failure here does not degrade one screen, it locks
// the reader out of the whole application. A backend that legitimately adds a sixth role, a
// fifth tier or a new operational mode would therefore take the UI down — a self-inflicted
// outage in exchange for nothing, because this screen renders those values VERBATIM and
// invents no label for them. (The `z.enum` used in capabilities.ts is right there for the
// opposite reason: it guards ONE screen, whose vocabulary table must stay in step.)
//
// ★ `principal_type` IS DIFFERENT, and is handled by a table rather than by a schema.
// It is not decoration: the copy attached to it states what kind of authentication this is,
// and rendering the API-key wording for a principal that is NOT an API key would be a lie
// about the product's maturity. So it stays a plain string here, and `vocab.ts` resolves it
// through the same unknown-safe table every other status uses — an unrecognised value renders
// as an explicit unknown with the raw value visible, never as a recognised login.
//
// ★ Loose object, for the same reason as the other mirrors: an additive backend field must
// pass through rather than be silently stripped.

import { z } from 'zod';

/** The principal types this UI has copy for. `api_key` is the only one the backend can
 *  produce at this base (routes/me.ts) — there is no human session, no account and no key
 *  lifecycle (Foundation V1 residual R14). */
export const KNOWN_PRINCIPAL_TYPES = ['api_key'] as const;
export type KnownPrincipalType = (typeof KNOWN_PRINCIPAL_TYPES)[number];

/** routes/me.ts — the exact six-field projection. `roles` is `[]` for a key with no special
 *  grants, which is a FACT the backend asserts, not an absence of information. */
export const MeResponse = z.looseObject({
  principal_type: z.string(),
  org_id: z.string(),
  user_id: z.string(),
  roles: z.array(z.string()),
  tier: z.string(),
  operational_mode: z.string(),
});
export type MeResponse = z.infer<typeof MeResponse>;
