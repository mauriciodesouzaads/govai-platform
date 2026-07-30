import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { setLocalAppOrgId } from '@govai/core-tenant';
import {
  executeGovernedRun,
  executePassthroughRun,
  AuthError,
  CapabilityNotSupportedError,
  CapabilityNotRegisteredError,
  type RunRequest,
} from '../pipeline/run-orchestrator.js';
import { authenticateApiKey } from '../pipeline/auth.js';
import { MissingProviderKeyError } from '../pipeline/provider-credentials.js';

// Accept any non-empty capability string and let resolveCapability map unknown ids
// to CapabilityNotRegisteredError → 404. Zod enum would short-circuit to 400.
//
// `mode` is optional: omitted or 'governed' → the enforcement-active governed
// path; 'passthrough' → the observe-only provider-native forward path. 'shadow'
// is admitted by the Zod enum so the route can return a specific
// `run_mode_not_supported` error rather than a generic validation failure.
const RunBody = z.object({
  workspace_id: z.string().uuid(),
  capability: z.string().min(1).max(200),
  model: z.string().min(1),
  input: z.string().min(1).max(50_000),
  mode: z.enum(['governed', 'passthrough', 'shadow']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const RunIdParam = z.string().uuid();

function extractApiKey(req: FastifyRequest): string | undefined {
  return (
    (req.headers['x-govai-api-key'] as string | undefined) ??
    (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice('Bearer '.length)
      : undefined)
  );
}

export async function runsRoute(app: FastifyInstance): Promise<void> {
  app.post('/v1/runs', async (req: FastifyRequest, reply: FastifyReply) => {
    const apiKey = extractApiKey(req);

    const parsed = RunBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }

    // Omitted mode defaults to governed — the existing /v1/runs behavior.
    const mode = parsed.data.mode ?? 'governed';
    if (mode === 'shadow') {
      reply.code(400);
      return {
        error: 'run_mode_not_supported',
        mode: 'shadow',
        supported_modes: ['governed', 'passthrough'],
      };
    }

    const deps = {
      pool: app.govai.pool,
      kms: app.govai.kms,
      env: app.govai.env,
      policyCommitSha: app.govai.policyCommitSha,
    };

    try {
      const result =
        mode === 'passthrough'
          ? await executePassthroughRun(deps, apiKey ?? '', parsed.data as RunRequest)
          : await executeGovernedRun(deps, apiKey ?? '', parsed.data as RunRequest);

      // §23.1 — synchronous unknown: 202 Accepted + Location for status polling.
      // Retry-After orients ONLY a new status consultation — NEVER a repeat of
      // the provider request (retry_safe is false).
      if (result.status === 'outcome_unknown') {
        reply.code(202);
        reply.header('location', `/v1/runs/${result.run_id}`);
        reply.header('retry-after', '5');
        return {
          run_id: result.run_id,
          status: 'outcome_unknown',
          retry_safe: false,
          error_class: result.error_class ?? 'dispatch_outcome_unknown',
        };
      }
      if (result.status === 'denied') {
        reply.code(403);
        return result;
      }
      if (result.status === 'failed') {
        reply.code(502);
        return result;
      }
      reply.code(200);
      return result;
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(err.status);
        return { error: 'auth_error', message: err.message };
      }
      if (err instanceof CapabilityNotSupportedError) {
        reply.code(403);
        return {
          error: 'capability_not_supported',
          capability: err.capabilityId,
          status: err.status,
          reason:
            'Planned capabilities cannot execute outside hermetic test environment. See docs/architecture/baseline-decisions.md#runtime-roadmap.',
          planned_phase: 'PR2',
        };
      }
      if (err instanceof CapabilityNotRegisteredError) {
        reply.code(404);
        return { error: 'capability_not_registered', capability: err.capabilityId };
      }
      // F3: the credential now resolves BEFORE any run row exists (§12.3), so a
      // missing/undecryptable credential is a clean pre-run 502 — no run, no
      // provider call, no audit noise. Only safe metadata is returned.
      if (err instanceof MissingProviderKeyError) {
        reply.code(502);
        return {
          error: 'provider_credential_unresolvable',
          provider: err.provider,
          reason: err.reason,
        };
      }
      req.log.error({ err }, 'unhandled error in /v1/runs');
      reply.code(500);
      return { error: 'internal_error' };
    }
  });

  // ==========================================================================
  // §23.2 — run status endpoint. Tenant-isolated (RLS + explicit org filter),
  // safe projection only: no payloads, no credentials, no raw errors.
  // ==========================================================================
  app.get('/v1/runs/:run_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const apiKey = extractApiKey(req);
    const params = req.params as { run_id?: string };
    const runIdParsed = RunIdParam.safeParse(params.run_id);
    if (!runIdParsed.success) {
      reply.code(400);
      return { error: 'invalid_request', message: 'run_id must be a UUID' };
    }

    const pool = app.govai.pool;
    let orgId: string;
    {
      const client = await pool.connect();
      try {
        const identity = await authenticateApiKey(client, apiKey);
        orgId = identity.org_id;
      } catch (err) {
        if (err instanceof AuthError) {
          reply.code(err.status);
          return { error: 'auth_error', message: err.message };
        }
        throw err;
      } finally {
        client.release();
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setLocalAppOrgId(client, orgId);
      const r = await client.query<{
        id: string;
        mode: string;
        provider: string;
        model: string;
        status: string;
        created_at: Date;
        started_at: Date | null;
        completed_at: Date | null;
        dispatch_prepared_at: Date | null;
        dispatch_claimed_at: Date | null;
        outcome_unknown_at: Date | null;
        dispatch_error_class: string | null;
        provider_invocation_id: string | null;
      }>(
        `SELECT r.id, r.mode, r.provider, r.model, r.status,
                r.created_at, r.started_at, r.completed_at,
                r.dispatch_prepared_at, r.dispatch_claimed_at, r.outcome_unknown_at,
                r.dispatch_error_class,
                (SELECT pi.id FROM govai.provider_invocations pi
                  WHERE pi.run_id = r.id
                  ORDER BY pi.created_at DESC LIMIT 1) AS provider_invocation_id
           FROM govai.runs r
          WHERE r.id = $1::uuid AND r.org_id = $2::uuid`,
        [runIdParsed.data, orgId],
      );
      await client.query('COMMIT');
      const row = r.rows[0];
      if (!row) {
        reply.code(404);
        return { error: 'run_not_found', run_id: runIdParsed.data };
      }
      reply.code(200);
      return {
        run_id: row.id,
        mode: row.mode,
        provider: row.provider,
        model: row.model,
        status: row.status,
        created_at: row.created_at.toISOString(),
        started_at: row.started_at?.toISOString() ?? null,
        completed_at: row.completed_at?.toISOString() ?? null,
        dispatch_prepared_at: row.dispatch_prepared_at?.toISOString() ?? null,
        dispatch_claimed_at: row.dispatch_claimed_at?.toISOString() ?? null,
        outcome_unknown_at: row.outcome_unknown_at?.toISOString() ?? null,
        dispatch_error_class: row.dispatch_error_class,
        // Protocol v1 never authorizes a client-side repeat of the provider
        // request; legacy rows share the conservative answer.
        retry_safe: false,
        ...(row.provider_invocation_id
          ? { provider_invocation_id: row.provider_invocation_id }
          : {}),
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      req.log.error({ err }, 'unhandled error in GET /v1/runs/:run_id');
      reply.code(500);
      return { error: 'internal_error' };
    } finally {
      client.release();
    }
  });
}
