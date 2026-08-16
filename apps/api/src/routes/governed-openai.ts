// /governed/openai/* — primary governed-native OpenAI surface.
//
// PR3.1k (#25): the governed handler now passes `tenant.operational_mode`
// through `resolveProviderKey`, so this closure no longer re-queries
// `govai.org_tier_lookup`. The single authoritative lookup happens once in
// `authenticateApiKey` and the resolved mode is threaded down via the
// handler's tenant context.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { detectAllBaseline, mergeFindingSpans } from '@govai/dlp-br';
import {
  registerOpenAIGoverned,
  type OpenAIGovernedDeps,
  type OpenAIGovernedTenant,
} from '@govai/provider-openai';
import { authenticateApiKey } from '../pipeline/auth.js';
import {
  providerCredentialUnresolvableHttp,
  resolveOpenAIProviderKey,
} from '../pipeline/provider-credentials.js';
import { makeAuditBridge } from '../pipeline/audit-bridge.js';
import { requestIdentityAls } from '../pipeline/request-identity.js';

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

  const resolveProviderKey: OpenAIGovernedDeps['resolveProviderKey'] = async (
    orgId,
    operationalMode,
  ) =>
    resolveOpenAIProviderKey(
      { env, pool: app.govai.pool, kms: app.govai.kms },
      { orgId, operationalMode },
    );

  const dlpScan = async (
    text: string,
  ): Promise<{ findings: ReadonlyArray<{ detector: string; signal_class?: string }> }> => {
    // F6: spans fundidos, não matches brutos — um CPF nu (casa cpf+phone_br)
    // conta como UM achado; `findings_count`/`finding_classes` do evento
    // derivam daqui. Sem mudança de comportamento: detecta-e-escala, não
    // redige (a classe mais forte do span preserva a escalação).
    const findings = mergeFindingSpans(detectAllBaseline(text));
    return {
      findings: findings.map((f) => ({
        detector: f.detector,
        signal_class: f.signal_class,
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

  // Foundation V1 M1 (FB-4 §11.5): a missing/undecryptable tenant provider
  // credential on this DIRECT route is a stable 502 provider_credential_unresolvable
  // (safe metadata only, zero provider calls) — never an unshaped 500. Scoped to
  // this encapsulated plugin; every other error re-enters the parent chain via
  // reply.send(err). The v4 evidence schema cannot truthfully represent a
  // credential failure (it is neither a governance block nor a forwarded raw
  // response), so this path is evidenced by the structured log below (no
  // secret is ever logged: only provider / org_id / bounded reason code).
  app.setErrorHandler((err, req, reply) => {
    const mapped = providerCredentialUnresolvableHttp(err);
    if (mapped) {
      req.log.warn(
        { provider: mapped.body.provider, org_id: mapped.org_id, reason: mapped.body.reason },
        'provider credential unresolvable on direct provider route',
      );
      return reply.code(mapped.statusCode).send(mapped.body);
    }
    return reply.send(err);
  });

  const deps: OpenAIGovernedDeps = {
    upstreamBaseUrl,
    resolveTenant,
    resolveProviderKey,
    dlpScan,
    emitAuditEvent,
  };

  await registerOpenAIGoverned(app, deps);
}
