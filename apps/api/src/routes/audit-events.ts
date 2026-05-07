import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { authenticateApiKey, AuthError } from '../pipeline/auth.js';
import { chainIdFor } from '@govai/core-events';

const Query = z.object({
  chain_category: z.enum(['auth', 'run', 'policy', 'admin']),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before_seq: z.coerce.number().int().min(1).optional(),
});

export async function auditEventsRoute(app: FastifyInstance): Promise<void> {
  app.get('/v1/audit-events', async (req: FastifyRequest, reply: FastifyReply) => {
    const apiKey =
      (req.headers['x-govai-api-key'] as string | undefined) ??
      (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
        ? req.headers.authorization.slice('Bearer '.length)
        : undefined);

    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_query', issues: parsed.error.issues };
    }

    const client = await app.govai.pool.connect();
    try {
      let identity;
      try {
        identity = await authenticateApiKey(client, apiKey ?? '');
      } catch (err) {
        if (err instanceof AuthError) {
          reply.code(err.status);
          return { error: 'auth_error', message: err.message };
        }
        throw err;
      }

      await client.query('BEGIN');
      try {
        await setLocalAppOrgId(client, identity.org_id);
        const chainId = chainIdFor(identity.org_id, parsed.data.chain_category);
        const params: Array<unknown> = [chainId];
        let where = 'chain_id = $1';
        if (parsed.data.before_seq !== undefined) {
          params.push(parsed.data.before_seq);
          where += ` AND sequence_number < $${params.length}`;
        }
        params.push(parsed.data.limit);
        const r = await client.query<{
          id: string;
          chain_id: string;
          sequence_number: string;
          event_type: string;
          event_version: string;
          subject_type: string;
          subject_id: string;
          occurred_at: Date;
          payload_hash: Buffer;
          previous_hmac: Buffer | null;
          hmac: Buffer;
          canonical_hash: Buffer;
          evidence_strength: string;
          key_id: string;
          key_version: number;
        }>(
          `SELECT id, chain_id, sequence_number, event_type, event_version,
                  subject_type, subject_id, occurred_at,
                  payload_hash, previous_hmac, hmac, canonical_hash,
                  evidence_strength, key_id, key_version
             FROM govai.audit_events
            WHERE ${where}
            ORDER BY sequence_number DESC
            LIMIT $${params.length}`,
          params,
        );
        await client.query('COMMIT');
        return {
          chain_id: chainId,
          events: r.rows.map((row) => ({
            id: row.id,
            chain_id: row.chain_id,
            sequence_number: Number(row.sequence_number),
            event_type: row.event_type,
            event_version: row.event_version,
            subject_type: row.subject_type,
            subject_id: row.subject_id,
            occurred_at: row.occurred_at.toISOString(),
            payload_hash: row.payload_hash.toString('hex'),
            previous_hmac: row.previous_hmac ? row.previous_hmac.toString('hex') : null,
            hmac: row.hmac.toString('hex'),
            canonical_hash: row.canonical_hash.toString('hex'),
            evidence_strength: row.evidence_strength,
            key_id: row.key_id,
            key_version: row.key_version,
          })),
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    } finally {
      client.release();
    }
  });
}
