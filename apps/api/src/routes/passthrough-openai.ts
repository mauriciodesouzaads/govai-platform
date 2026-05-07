import type { FastifyInstance } from 'fastify';
import { sendNotImplemented } from './_not-implemented.js';

export async function passthroughOpenaiRoute(app: FastifyInstance): Promise<void> {
  app.all('/passthrough/openai/*', async (_req, reply) =>
    sendNotImplemented(reply, 'passthrough.openai', 'PR2'),
  );
}
