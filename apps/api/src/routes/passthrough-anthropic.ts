import type { FastifyInstance } from 'fastify';

export async function passthroughAnthropicRoute(app: FastifyInstance): Promise<void> {
  app.all('/passthrough/anthropic/*', async (_req, reply) => {
    reply.code(503);
    return { error: 'pipeline_incomplete_in_baseline' };
  });
}
