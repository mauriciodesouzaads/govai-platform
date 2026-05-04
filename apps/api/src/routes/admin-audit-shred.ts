import type { FastifyInstance } from 'fastify';

export async function adminAuditShredRoute(app: FastifyInstance): Promise<void> {
  app.post('/v1/admin/audit-events/:id/crypto-shred', async (_req, reply) => {
    reply.code(503);
    return { error: 'pipeline_incomplete_in_baseline' };
  });
}
