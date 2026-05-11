// /governed/anthropic/* — primary governed-native Anthropic surface.
// Wires the per-org tenant resolution + DLP + provider key lookup into the
// reusable handler from @govai/provider-anthropic.
//
// PR3.1b optimization (issue #22): resolveProviderKey(orgId) used to call
// lookupOperationalMode for a SECURITY DEFINER roundtrip on every governed
// request, in addition to the authentication roundtrip in resolveTenant.
// resolveTenant now populates a per-(orgId) operational_mode cache from the
// authenticated identity; resolveProviderKey reads it without a second DB
// call. The cache is best-effort: admin mutations to orgs.operational_mode
// (a rare operation reserved for the admin path) will become visible on the
// next authenticated request because authenticateApiKey re-reads
// govai.org_tier_lookup and overwrites the cache entry. A full invalidation
// hook on operational_mode change is PR3.x territory.
//
// Behavior unchanged: production/pilot still fail closed when no tenant
// credential exists; hermetic test+loopback still returns the placeholder.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { detectAllBaseline } from '@govai/dlp-br';
import {
  registerAnthropicGoverned,
  type AnthropicGovernedDeps,
  type AnthropicGovernedTenant,
} from '@govai/provider-anthropic';
import { authenticateApiKey } from '../pipeline/auth.js';
import {
  resolveAnthropicProviderKey,
  lookupOperationalMode,
} from '../pipeline/provider-credentials.js';
import type { OperationalMode } from '../pipeline/auth.js';

export async function governedAnthropicRoute(app: FastifyInstance): Promise<void> {
  const env = app.govai.env;
  const upstreamBaseUrl =
    env.GOVAI_PROVIDER_BASE_URL && env.GOVAI_PROVIDER_BASE_URL.length > 0
      ? env.GOVAI_PROVIDER_BASE_URL
      : 'https://api.anthropic.com';

  // Per-process cache of {orgId → operationalMode} populated by resolveTenant
  // and consumed by resolveProviderKey. Each authenticated request refreshes
  // its own entry, so stale values self-correct on the next auth roundtrip.
  const operationalModeByOrg = new Map<string, OperationalMode>();

  const resolveTenant = async (req: FastifyRequest): Promise<AnthropicGovernedTenant> => {
    const apiKey =
      (req.headers['x-govai-api-key'] as string | undefined) ??
      (typeof req.headers.authorization === 'string' &&
      req.headers.authorization.startsWith('Bearer ')
        ? req.headers.authorization.slice('Bearer '.length)
        : undefined);
    const client = await app.govai.pool.connect();
    try {
      const identity = await authenticateApiKey(client, apiKey ?? '');
      operationalModeByOrg.set(identity.org_id, identity.operational_mode);
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

  const resolveProviderKey = async (orgId: string): Promise<string> => {
    const cached = operationalModeByOrg.get(orgId);
    const operationalMode =
      cached ??
      // Defensive fallback: if resolveTenant has not run for this org yet in
      // the current process, pay the original SECURITY DEFINER roundtrip.
      // The normal flow always calls resolveTenant before resolveProviderKey,
      // so this path is exercised only on edge cases (cold cache + handler
      // call-order change).
      (await lookupOperationalMode(app.govai.pool, orgId));
    return resolveAnthropicProviderKey(
      { env, pool: app.govai.pool, kms: app.govai.kms },
      { orgId, operationalMode },
    );
  };

  const dlpScan = async (
    text: string,
  ): Promise<{ findings: ReadonlyArray<{ detector: string; signal_class?: string }> }> => {
    const findings = detectAllBaseline(text);
    return {
      findings: findings.map((f) => ({
        detector: f.detector,
        signal_class:
          f.detector === 'cpf' || f.detector === 'cnpj' ? 'pii_strong' : 'pii_standard',
      })),
    };
  };

  const emitAuditEvent = async (event: unknown): Promise<void> => {
    app.log.info({ audit_event: event }, 'governed-native audit event');
  };

  const deps: AnthropicGovernedDeps = {
    upstreamBaseUrl,
    resolveTenant,
    resolveProviderKey,
    dlpScan,
    emitAuditEvent,
  };

  await registerAnthropicGoverned(app, deps);
}
