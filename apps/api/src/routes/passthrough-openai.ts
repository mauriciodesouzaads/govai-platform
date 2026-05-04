import type { FastifyInstance } from 'fastify';

export async function passthroughOpenaiRoute(app: FastifyInstance): Promise<void> {
  app.all('/passthrough/openai/*', async (_req, reply) => {
    reply.code(503);
    return { error: 'pipeline_incomplete_in_baseline' };
  });
}
