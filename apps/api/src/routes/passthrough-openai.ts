// /passthrough/openai/* — wired in PR2 Batch C (Native Provider Substrate).
// The plugin under `@govai/provider-openai` owns the entire route logic;
// this file remains in apps/api so the route surface lives where other routes do.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  registerOpenAIPassthrough,
  type OpenAIPassthroughDeps,
  type TenantContext,
} from '@govai/provider-openai';
import { authenticateApiKey } from '../pipeline/auth.js';
import { resolveOpenAIProviderKey } from '../pipeline/provider-credentials.js';
import type { OperationalMode } from '../pipeline/auth.js';

export async function passthroughOpenaiRoute(app: FastifyInstance): Promise<void> {
  const env = app.govai.env;
  const upstreamBaseUrl =
    env.GOVAI_PROVIDER_BASE_URL && env.GOVAI_PROVIDER_BASE_URL.length > 0
      ? env.GOVAI_PROVIDER_BASE_URL
      : 'https://api.openai.com';

  const requestIdentities = new WeakMap<
    FastifyRequest,
    { orgId: string; operationalMode: OperationalMode }
  >();
  app.addHook('onResponse', async (req) => {
    requestIdentities.delete(req);
  });

  const resolveTenant = async (req: FastifyRequest): Promise<TenantContext> => {
    const apiKey =
      (req.headers['x-govai-api-key'] as string | undefined) ??
      (typeof req.headers.authorization === 'string' &&
      req.headers.authorization.startsWith('Bearer ')
        ? req.headers.authorization.slice('Bearer '.length)
        : undefined);
    const client = await app.govai.pool.connect();
    try {
      const identity = await authenticateApiKey(client, apiKey ?? '');
      // Real values from HAE-004 (orgs.tier + orgs.operational_mode); no
      // hardcoded literals at runtime per the macro realignment directive.
      requestIdentities.set(req, {
        orgId: identity.org_id,
        operationalMode: identity.operational_mode,
      });
      return {
        org_id: identity.org_id,
        user_id: identity.user_id,
        tier: identity.tier,
        operational_mode: identity.operational_mode,
      };
    } finally {
      client.release();
    }
  };

  const resolveProviderKey = async (req: FastifyRequest): Promise<string> => {
    const cached = requestIdentities.get(req);
    if (!cached) {
      throw new Error('passthrough resolveProviderKey called before resolveTenant');
    }
    return resolveOpenAIProviderKey(
      { env, pool: app.govai.pool, kms: app.govai.kms },
      cached,
    );
  };

  const activeOverridesLoader = async (
    _orgId: string,
    _provider: string,
  ): Promise<Array<{ beta_token: string; id: string }>> => {
    // Real implementation queries govai.org_beta_overrides under tenant context.
    // For PR2 baseline, return empty: OPENAI_BETA_POLICY has zero org_override_allowed
    // entries (Matrix §22 — both tokens hard_denied), so the empty loader is correct
    // and Issue #9 (Anthropic-driven) does NOT block Batch C.
    return [];
  };

  const emitAuditEvent = async (event: unknown): Promise<void> => {
    // PR2 baseline: log to server logger. Wiring into audit chain (`run` chain)
    // happens once Governed Run pipeline absorbs passthrough audit (PR3+).
    app.log.info({ audit_event: event }, 'passthrough audit event');
  };

  const deps: OpenAIPassthroughDeps = {
    upstreamBaseUrl,
    resolveTenant,
    resolveProviderKey,
    activeOverridesLoader,
    emitAuditEvent,
  };

  await registerOpenAIPassthrough(app, deps);
}
