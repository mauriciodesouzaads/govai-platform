// /v1/admin/dlp-detectors — placeholder for PR3 admin DLP detector CRUD.
// Feature deferred (returns 501) but route MUST authenticate and require
// admin (issue #26) so the admin namespace is never reachable without RBAC.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendNotImplemented } from './_not-implemented.js';
import { authenticateApiKey, AuthError } from '../pipeline/auth.js';
import { requireAdmin, AdminAccessError } from '../pipeline/require-admin.js';

function extractApiKey(req: FastifyRequest): string {
  const header = req.headers['x-govai-api-key'];
  if (typeof header === 'string') return header;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length);
  }
  return '';
}

export async function adminDlpRoute(app: FastifyInstance): Promise<void> {
  app.post('/v1/admin/dlp-detectors', async (req: FastifyRequest, reply: FastifyReply) => {
    const apiKey = extractApiKey(req);
    const client = await app.govai.pool.connect();
    try {
      const identity = await authenticateApiKey(client, apiKey);
      requireAdmin(identity);
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(err.status);
        return { error: 'auth_error', message: err.message };
      }
      if (err instanceof AdminAccessError) {
        reply.code(err.status);
        return { error: err.code, required_role: err.required_role };
      }
      throw err;
    } finally {
      client.release();
    }
    return sendNotImplemented(reply, 'admin.dlp_detectors.crud', 'PR3');
  });
}
