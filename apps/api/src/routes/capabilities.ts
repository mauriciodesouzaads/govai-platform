import type { FastifyInstance } from 'fastify';
import { BASELINE_REGISTRY } from '@govai/core-governance';

export async function capabilitiesRoute(app: FastifyInstance): Promise<void> {
  app.get('/v1/capabilities', async () => {
    return {
      org_id: null,
      capabilities: BASELINE_REGISTRY.map((c) => ({
        id: c.id,
        provider: c.provider,
        status: c.status,
        facets: c.facets,
        override_applied: null,
      })),
    };
  });
}
