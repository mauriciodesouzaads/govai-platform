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
import { resolveAnthropicProviderKey } from '../pipeline/provider-credentials.js';

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
      // Real values from HAE-004 (orgs.tier + orgs.operational_mode); no
      // hardcoded literals at runtime per the macro realignment directive.
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

  const resolveProviderKey = async (_req: FastifyRequest): Promise<string> => {
    // Real env key is required outside hermetic test (NODE_ENV=test + loopback).
    // Tenant-scoped credentials are PR3+ — for now ANTHROPIC_API_KEY at the
    // platform level is the source of truth.
    return resolveAnthropicProviderKey(env);
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
