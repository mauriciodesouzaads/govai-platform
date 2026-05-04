import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { authenticateApiKey, AuthError } from '../pipeline/auth.js';
import {
  listAllCapabilitiesWithOverrides,
  type CapabilityOverrideRow,
} from '../pipeline/capability-resolution.js';

export async function capabilitiesRoute(app: FastifyInstance): Promise<void> {
  app.get('/v1/capabilities', async (req: FastifyRequest, reply: FastifyReply) => {
    const apiKey =
      (req.headers['x-govai-api-key'] as string | undefined) ??
      (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
        ? req.headers.authorization.slice('Bearer '.length)
        : undefined);

    const client = await app.govai.pool.connect();
    try {
      let identity;
      try {
        identity = await authenticateApiKey(client, apiKey ?? '');
      } catch (err) {
        if (err instanceof AuthError) {
          reply.code(err.status);
          return { error: 'auth_error', message: err.message };
        }
        throw err;
      }

      await client.query('BEGIN');
      try {
        await setLocalAppOrgId(client, identity.org_id);
        const r = await client.query<CapabilityOverrideRow>(
          `SELECT capability_id, facet_id, level_override, status_override
             FROM govai.capability_overrides`,
        );
        const byCapability = new Map<string, CapabilityOverrideRow[]>();
        for (const row of r.rows) {
          const list = byCapability.get(row.capability_id) ?? [];
          list.push(row);
          byCapability.set(row.capability_id, list);
        }
        const resolved = listAllCapabilitiesWithOverrides(byCapability);
        await client.query('COMMIT');
        return {
          org_id: identity.org_id,
          capabilities: resolved.map((rc) => ({
            id: rc.capability.id,
            provider: rc.capability.provider,
            status: rc.effectiveStatus,
            baseline_status: rc.capability.status,
            facets: rc.effectiveFacets.map(
              ({ facet, effectiveLevel, effectiveStatus, appliedOverride }) => ({
                id: facet.id,
                level: effectiveLevel,
                status: effectiveStatus,
                baseline_status: facet.status,
                evidence_strength: facet.evidence_strength ?? null,
                reason: facet.reason ?? null,
                last_live_test_at: facet.last_live_test_at ?? null,
                docs_url: facet.docs_url ?? null,
                override_applied: appliedOverride,
              }),
            ),
          })),
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    } finally {
      client.release();
    }
  });
}
