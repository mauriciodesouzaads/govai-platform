import type { FastifyInstance } from 'fastify';

export async function auditEventsRoute(app: FastifyInstance): Promise<void> {
  app.get('/v1/audit-events', async (_req, reply) => {
    reply.code(503);
    return { error: 'pipeline_incomplete_in_baseline' };
  });
}
