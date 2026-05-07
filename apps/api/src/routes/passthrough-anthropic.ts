import type { FastifyInstance } from 'fastify';
import { sendNotImplemented } from './_not-implemented.js';

export async function passthroughAnthropicRoute(app: FastifyInstance): Promise<void> {
  app.all('/passthrough/anthropic/*', async (_req, reply) =>
    sendNotImplemented(reply, 'passthrough.anthropic', 'PR2'),
  );
}
