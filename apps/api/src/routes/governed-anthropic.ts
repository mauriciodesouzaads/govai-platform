// /governed/anthropic/* — primary governed-native Anthropic surface.
// Wires the per-org tenant resolution + DLP + provider key lookup into the
// reusable handler from @govai/provider-anthropic.
//
// PR3.1k (#25): the governed handler now passes `tenant.operational_mode`
// through `resolveProviderKey`, so this closure no longer re-queries
// `govai.org_tier_lookup`. The single authoritative lookup happens once in
// `authenticateApiKey` and the resolved mode is threaded down via the
// handler's tenant context.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { detectAllBaseline } from '@govai/dlp-br';
import {
  registerAnthropicGoverned,
  type AnthropicGovernedDeps,
  type AnthropicGovernedTenant,
} from '@govai/provider-anthropic';
import { authenticateApiKey } from '../pipeline/auth.js';
import { resolveAnthropicProviderKey } from '../pipeline/provider-credentials.js';
import { makeAuditBridge } from '../pipeline/audit-bridge.js';
import { requestIdentityAls } from '../pipeline/request-identity.js';

export async function governedAnthropicRoute(app: FastifyInstance): Promise<void> {
  const env = app.govai.env;
  const upstreamBaseUrl =
    env.GOVAI_PROVIDER_BASE_URL && env.GOVAI_PROVIDER_BASE_URL.length > 0
      ? env.GOVAI_PROVIDER_BASE_URL
      : 'https://api.anthropic.com';

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

  const resolveProviderKey: AnthropicGovernedDeps['resolveProviderKey'] = async (
    orgId,
    operationalMode,
  ) =>
    resolveAnthropicProviderKey(
      { env, pool: app.govai.pool, kms: app.govai.kms },
      { orgId, operationalMode },
    );

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

  const auditBridge = makeAuditBridge({ pool: app.govai.pool, log: app.log });
  const emitAuditEvent = async (event: unknown): Promise<void> => {
    app.log.info({ audit_event: event }, 'governed-native audit event');
    // Dispatch into the B0/B1 capture outbox (ADR-027/028). best_effort: the
    // bridge never throws on the request path; identity comes from the ALS store
    // the ingress hook populated for this request.
    await auditBridge(event, requestIdentityAls.getStore());
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
