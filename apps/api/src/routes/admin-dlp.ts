import type { FastifyInstance } from 'fastify';
import { sendNotImplemented } from './_not-implemented.js';

export async function adminDlpRoute(app: FastifyInstance): Promise<void> {
  app.post('/v1/admin/dlp-detectors', async (_req, reply) =>
    sendNotImplemented(reply, 'admin.dlp_detectors.crud', 'PR3'),
  );
}
