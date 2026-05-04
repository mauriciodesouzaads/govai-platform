import type { FastifyInstance } from 'fastify';

export async function adminDlpRoute(app: FastifyInstance): Promise<void> {
  app.post('/v1/admin/dlp-detectors', async (_req, reply) => {
    reply.code(503);
    return { error: 'pipeline_incomplete_in_baseline' };
  });
}
