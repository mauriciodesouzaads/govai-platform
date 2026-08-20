// Authenticated-principal read projection (EP-UIUX-V1-B2).
//
//   GET /v1/me → the identity `authenticateApiKey` already resolved for THIS request
//
// ★ WHAT THIS IS. A projection of server-resolved identity, and nothing more. Every value in
// the response is a field of `AuthIdentity` (pipeline/auth.ts:15-28), which the four existing
// read surfaces already compute on every call — `org_id` and `user_id` from
// `govai.api_key_lookup_v2`, `roles` from the same row (defensively filtered against the
// canonical `ALL_ROLES` enum), `tier` and `operational_mode` from `govai.org_tier_lookup`
// over `govai.orgs` (migration 0008). This route therefore introduces NO new identity system,
// NO new query and NO new state: it serializes what the request already knew.
//
// ★ WHAT THIS IS NOT. It is NOT production human authentication. `principal_type` is the
// literal `'api_key'` because a controlled-pilot org credential must never be presented to a
// reader as a user login: there is no account, no password, no session and no key lifecycle
// (Foundation V1 residual R14). The field exists so a client cannot quietly imply otherwise.
//
// ★ WHAT IT MUST NEVER RETURN. No raw key, no `hash`, no `api_key_prefix`, no provider
// credential. The prefix is deliberately excluded: it is a fragment of the credential and it
// identifies WHICH key is in use, which no UI surface needs — the session shows one org, and
// an evidence export that carried a credential fragment would be a leak with a paper trail.
// An integration test scans the raw response body for all three.
//
// ★ NO TRANSACTION, NO TENANT CONTEXT. Both lookups behind `authenticateApiKey` are
// SECURITY DEFINER helpers that run before any tenant context exists (that is what resolves
// the tenant), so there is nothing here for `BEGIN` + `setLocalAppOrgId` to scope. Opening a
// transaction or an RLS-bound query merely to echo the already-authenticated identity would
// claim a tenant read this route does not make. The route is read-only.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateApiKey, AuthError } from '../pipeline/auth.js';

/** Same credential extraction the U1 read surfaces use (`x-govai-api-key`, else a Bearer
 *  token) — evidence.ts:43-50, audit-events.ts:15-19, capabilities.ts:11-15. Kept local
 *  rather than shared: hoisting it would touch three unrelated route files, and EP-B7
 *  (`@govai/api-contract`) is the movement that consolidates this surface. */
function extractApiKey(req: FastifyRequest): string | undefined {
  return (
    (req.headers['x-govai-api-key'] as string | undefined) ??
    (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice('Bearer '.length)
      : undefined)
  );
}

export async function meRoute(app: FastifyInstance): Promise<void> {
  app.get('/v1/me', async (req: FastifyRequest, reply: FastifyReply) => {
    const client = await app.govai.pool.connect();
    try {
      let identity;
      try {
        identity = await authenticateApiKey(client, extractApiKey(req) ?? '');
      } catch (err) {
        if (err instanceof AuthError) {
          // Byte-identical to the existing read surfaces: the 401 body distinguishes
          // missing/malformed from invalid ONLY by the message `authenticateApiKey` itself
          // chose, and discloses nothing about org existence, roles, tier, operational mode
          // or provider configuration.
          reply.code(err.status);
          return { error: 'auth_error', message: err.message };
        }
        throw err;
      }

      return {
        principal_type: 'api_key' as const,
        org_id: identity.org_id,
        user_id: identity.user_id,
        roles: identity.roles,
        tier: identity.tier,
        operational_mode: identity.operational_mode,
      };
    } finally {
      client.release();
    }
  });
}
