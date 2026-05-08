// /passthrough/anthropic/* — wired in PR2 Batch A (Native Provider Substrate).
// The plugin under `@govai/provider-anthropic` owns the entire route logic;
// this file remains in apps/api so the route surface lives where other routes do.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  registerAnthropicPassthrough,
  type AnthropicPassthroughDeps,
  type TenantContext,
} from '@govai/provider-anthropic';
import { authenticateApiKey } from '../pipeline/auth.js';

export async function passthroughAnthropicRoute(app: FastifyInstance): Promise<void> {
  const env = app.govai.env;
  const upstreamBaseUrl =
    env.GOVAI_PROVIDER_BASE_URL && env.GOVAI_PROVIDER_BASE_URL.length > 0
      ? env.GOVAI_PROVIDER_BASE_URL
      : 'https://api.anthropic.com';

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
      return {
        org_id: identity.org_id,
        user_id: identity.user_id,
        tier: 'enterprise',
        operational_mode:
          env.NODE_ENV === 'production'
            ? 'production'
            : env.NODE_ENV === 'test'
              ? 'test'
              : 'dev',
      };
    } finally {
      client.release();
    }
  };

  const resolveProviderKey = async (_req: FastifyRequest): Promise<string> => {
    // Tenant-resolved provider credentials are PR3+. For PR2 hermetic, use a
    // deterministic placeholder; the test fixture accepts any string.
    return env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.length > 0
      ? env.ANTHROPIC_API_KEY
      : 'sk-ant-test-hermetic';
  };

  const activeOverridesLoader = async (
    _orgId: string,
    _provider: string,
  ): Promise<Array<{ beta_token: string; id: string }>> => {
    // Real implementation queries govai.org_beta_overrides under tenant context.
    // For PR2 baseline, return empty: only tokens with policy='global_allowlist' or
    // 'removed_as_no_longer_needed' resolve to allow without an override.
    return [];
  };

  const emitAuditEvent = async (event: unknown): Promise<void> => {
    // PR2 baseline: log to server logger. Wiring into audit chain (`run` chain)
    // happens once Governed Run pipeline absorbs passthrough audit (PR3+).
    app.log.info({ audit_event: event }, 'passthrough audit event');
  };

  const deps: AnthropicPassthroughDeps = {
    upstreamBaseUrl,
    resolveTenant,
    resolveProviderKey,
    activeOverridesLoader,
    emitAuditEvent,
  };

  await registerAnthropicPassthrough(app, deps);
}
