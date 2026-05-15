import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  executeGovernedRun,
  executePassthroughRun,
  AuthError,
  CapabilityNotSupportedError,
  CapabilityNotRegisteredError,
  type RunRequest,
} from '../pipeline/run-orchestrator.js';

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

export async function runsRoute(app: FastifyInstance): Promise<void> {
  app.post('/v1/runs', async (req: FastifyRequest, reply: FastifyReply) => {
    const apiKey =
      (req.headers['x-govai-api-key'] as string | undefined) ??
      (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
        ? req.headers.authorization.slice('Bearer '.length)
        : undefined);

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
      req.log.error({ err }, 'unhandled error in /v1/runs');
      reply.code(500);
      return { error: 'internal_error' };
    }
  });
}
