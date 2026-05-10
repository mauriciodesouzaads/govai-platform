// /governed/openai/* — primary governed-native OpenAI surface.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { detectAllBaseline } from '@govai/dlp-br';
import {
  registerOpenAIGoverned,
  type OpenAIGovernedDeps,
  type OpenAIGovernedTenant,
} from '@govai/provider-openai';
import { authenticateApiKey } from '../pipeline/auth.js';
import { resolveOpenAIProviderKey } from '../pipeline/provider-credentials.js';

export async function governedOpenaiRoute(app: FastifyInstance): Promise<void> {
  const env = app.govai.env;
  const upstreamBaseUrl =
    env.GOVAI_PROVIDER_BASE_URL && env.GOVAI_PROVIDER_BASE_URL.length > 0
      ? env.GOVAI_PROVIDER_BASE_URL
      : 'https://api.openai.com';

  const resolveTenant = async (req: FastifyRequest): Promise<OpenAIGovernedTenant> => {
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

  const resolveProviderKey = async (_orgId: string): Promise<string> => {
    return resolveOpenAIProviderKey(env);
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

  const deps: OpenAIGovernedDeps = {
    upstreamBaseUrl,
    resolveTenant,
    resolveProviderKey,
    dlpScan,
    emitAuditEvent,
  };

  await registerOpenAIGoverned(app, deps);
}
