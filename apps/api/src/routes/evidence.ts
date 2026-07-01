// Evidence-completeness read API (EP-008D-1 / §3.3). Read-only, RLS-scoped, no
// payload bytes, paginated — the same per-org API-key/RLS path /v1/audit-events
// uses (authenticate → BEGIN → setLocalAppOrgId → query → COMMIT). The auditor
// IS the tenant: no new role, the caller sees only its own org.
//
//   GET /v1/evidence/summary?window=…            → per-invariant status + coverage_ratio
//   GET /v1/evidence/gaps?invariant=…&window=…&cursor=…  → a paginated gap list
//
// The /gaps enum ships ec1|ec2|ec3seal|ec3drop|ec4. EC-5 is deferred (no
// queryable source). EC-6 is deliberately NOT in the enum — it is
// status-via-summary (a per-org summary, not a gap list), surfaced only by
// /summary.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { authenticateApiKey, AuthError } from '../pipeline/auth.js';
import {
  ec1GapList,
  ec2Gaps,
  ec3SealList,
  ec4List,
  evidenceSummary,
  nativeDropEstimate,
  ZERO_DROP_SNAPSHOT,
  type ReportScope,
} from '../pipeline/evidence-reports.js';

const MAX_WINDOW_SECONDS = 31_536_000; // 1y — an upper bound on the scan window.
const MAX_LIMIT = 500;

const SummaryQuery = z.object({
  window: z.coerce.number().int().positive().max(MAX_WINDOW_SECONDS).optional(),
});

const GapsQuery = z.object({
  invariant: z.enum(['ec1', 'ec2', 'ec3seal', 'ec3drop', 'ec4']),
  window: z.coerce.number().int().positive().max(MAX_WINDOW_SECONDS).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(100),
  cursor: z.coerce.number().int().nonnegative().default(0),
});

function extractApiKey(req: FastifyRequest): string | undefined {
  return (
    (req.headers['x-govai-api-key'] as string | undefined) ??
    (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice('Bearer '.length)
      : undefined)
  );
}

export async function evidenceRoute(app: FastifyInstance): Promise<void> {
  const tSealSeconds = app.govai.env.EVIDENCE_T_SEAL_SECONDS;
  const defaultWindow = app.govai.env.EVIDENCE_DEFAULT_WINDOW_SECONDS;

  app.get('/v1/evidence/summary', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = SummaryQuery.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_query', issues: parsed.error.issues };
    }
    const scope: ReportScope = {
      windowSeconds: parsed.data.window ?? defaultWindow,
      tSealSeconds,
    };

    const client = await app.govai.pool.connect();
    try {
      let identity;
      try {
        identity = await authenticateApiKey(client, extractApiKey(req) ?? '');
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
        // ZERO_DROP_SNAPSHOT: the authoritative EC-3.drop aggregation is the OTLP
        // collector (the shipped govai_audit_bridge_drops_total). The in-process
        // read API reports a process-local term only (here: unobserved).
        const summary = await evidenceSummary(client, scope, ZERO_DROP_SNAPSHOT);
        await client.query('COMMIT');
        return { org_id: identity.org_id, ...summary };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    } finally {
      client.release();
    }
  });

  app.get('/v1/evidence/gaps', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = GapsQuery.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_query', issues: parsed.error.issues };
    }
    const { invariant, limit, cursor } = parsed.data;
    const scope: ReportScope = {
      windowSeconds: parsed.data.window ?? defaultWindow,
      tSealSeconds,
      sampleLimit: limit,
      offset: cursor,
    };

    const client = await app.govai.pool.connect();
    try {
      let identity;
      try {
        identity = await authenticateApiKey(client, extractApiKey(req) ?? '');
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
        let items: unknown[];
        switch (invariant) {
          case 'ec1':
            items = await ec1GapList(client, scope);
            break;
          case 'ec2':
            items = await ec2Gaps(client, scope);
            break;
          case 'ec3seal':
            items = await ec3SealList(client, scope);
            break;
          case 'ec3drop':
            // EC-3.drop is a SINGLETON aggregate (a rate/count, not a paginable
            // list); ZERO in-process (the OTLP collector is authoritative). Emit
            // it on page 0 only — a follow-up cursor returns an empty page.
            items = cursor === 0 ? [nativeDropEstimate(ZERO_DROP_SNAPSHOT)] : [];
            break;
          case 'ec4':
            items = await ec4List(client, scope);
            break;
        }
        await client.query('COMMIT');
        // next_cursor: present only when a full page came back (more may exist).
        // The ec3drop singleton is never paginable → always null (no infinite loop).
        const nextCursor =
          invariant === 'ec3drop' ? null : items.length === limit ? cursor + limit : null;
        return {
          org_id: identity.org_id,
          invariant,
          window_seconds: scope.windowSeconds,
          items,
          next_cursor: nextCursor,
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
