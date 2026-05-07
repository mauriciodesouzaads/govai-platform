import type { FastifyInstance } from 'fastify';
import { sendNotImplemented } from './_not-implemented.js';

export async function adminAuditShredRoute(app: FastifyInstance): Promise<void> {
  app.post('/v1/admin/audit-events/:id/crypto-shred', async (_req, reply) =>
    sendNotImplemented(reply, 'admin.audit_event.crypto_shred', 'PR3'),
  );
}
