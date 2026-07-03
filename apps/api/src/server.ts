import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Pool } from 'pg';
import { loadEnv, originsFromCsv, assertCorsSafeForProd, BootError, type GovAIEnv } from '@govai/config';
import { createKmsFromEnv, type Kms } from '@govai/core-identity';
import { startTelemetry } from '@govai/observability';
import { createPool } from './db/client.js';
import { healthRoute } from './routes/health.js';
import { capabilitiesRoute } from './routes/capabilities.js';
import { runsRoute } from './routes/runs.js';
import { auditEventsRoute } from './routes/audit-events.js';
import { evidenceRoute } from './routes/evidence.js';
import { adminAuditShredRoute } from './routes/admin-audit-shred.js';
import { adminDlpRoute } from './routes/admin-dlp.js';
import { passthroughAnthropicRoute } from './routes/passthrough-anthropic.js';
import { passthroughOpenaiRoute } from './routes/passthrough-openai.js';
import { governedAnthropicRoute } from './routes/governed-anthropic.js';
import { governedOpenaiRoute } from './routes/governed-openai.js';
import { adminProviderCredentialsRoute } from './routes/admin-provider-credentials.js';
import { workroomsRoute } from './routes/workrooms.js';
import { workroomTranscriptRoute } from './routes/workroom-transcript.js';
import { workroomRunsRoute } from './routes/workroom-runs.js';
import { workroomApprovalsRoute } from './routes/workroom-approvals.js';
import { regulatoryRoute } from './routes/regulatory.js';
import { registerRequestIdentityHook } from './pipeline/request-identity-hook.js';
import { createEvidenceGaugeSource, enumerateAllOrgs } from './pipeline/evidence-operator.js';
import { registerEvidenceGauges } from './pipeline/evidence-metrics.js';

export type ServerDeps = {
  env: GovAIEnv;
  kms: Kms;
  pool: Pool;
  policyCommitSha: string;
  /** Injectable clock for the direct-route producers (tests only; production
   *  omits it → real `new Date()`). Threaded to the passthrough deps so an
   *  integration replay can hold `occurred_at` stable across attempts. */
  now?: () => Date;
};

export type ServerOverrides = Partial<{
  pool: Pool;
  env: GovAIEnv;
  now: () => Date;
}>;

export async function buildServer(overrides: ServerOverrides = {}): Promise<FastifyInstance> {
  const env = overrides.env ?? loadEnv(process.env);
  assertCorsSafeForProd(env);
  const kms = createKmsFromEnv(env);

  if (env.NODE_ENV === 'production') {
    await kms.deriveKey({
      purpose: 'audit_hmac',
      orgId: '00000000-0000-0000-0000-000000000000',
      keyId: 'boot-probe',
      version: 1,
    });
  }

  const pool =
    overrides.pool ??
    createPool({ connectionString: env.DATABASE_URL ?? '' });

  const app = Fastify({
    logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    disableRequestLogging: false,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  const origins = originsFromCsv(env.API_CORS_ORIGINS);
  await app.register(cors, {
    origin: origins.length === 0 ? false : origins,
    credentials: env.API_CORS_CREDENTIALS,
  });
  // The integration suite drives many requests per process; the in-memory
  // limiter would otherwise throttle a test file. Production is unaffected —
  // it keeps the 100/min limit.
  await app.register(rateLimit, {
    max: env.NODE_ENV === 'test' ? 1_000_000 : 100,
    timeWindow: '1 minute',
  });

  const policyCommitSha = process.env['GOVAI_POLICY_COMMIT_SHA'] ?? 'runtime-patch-1';

  app.decorate('govai', { env, kms, pool, policyCommitSha, now: overrides.now });

  // EP-008B-FOLLOWUP: register the global OTel MeterProvider BEFORE the route
  // registers (the EP-008B metrics factory runs at route-registration time and
  // caches its Counter at getMeter()-time). Placed after the KMS boot-probe so a
  // prod BootError->exit(1) never orphans a periodic reader. Gated on
  // OTEL_EXPORTER_OTLP_ENDPOINT: a no-op with the endpoint unset. Observe-only.
  const telemetry = startTelemetry(env, { serviceName: 'govai-api', logger: app.log });

  // EP-EVIDENCE-GAUGE-WIRING: wire the govai_evidence_* gauges (EP-008D) into boot —
  // gated identically to startTelemetry (OTEL endpoint) PLUS the enumerator URL, so with
  // either unset boot is byte-identical. Must run AFTER startTelemetry (getMeter needs the
  // global MeterProvider). INV-1: enumeration runs on a least-privilege enumerator pool;
  // the per-org reads stay on the app `pool` under withTenant. Observe-only (the shipped
  // batch callback try/catches). Handles are closed in onClose below.
  let evidenceGauges: { unregister(): void } | null = null;
  let enumeratorPool: Pool | null = null;
  if (telemetry.enabled && env.GOVAI_EVIDENCE_ENUMERATOR_URL) {
    enumeratorPool = createPool({ connectionString: env.GOVAI_EVIDENCE_ENUMERATOR_URL, max: 2 });
    const scope = {
      windowSeconds: env.EVIDENCE_DEFAULT_WINDOW_SECONDS,
      tSealSeconds: env.EVIDENCE_T_SEAL_SECONDS,
    };
    const source = createEvidenceGaugeSource({
      pool,
      scope,
      enumerate: enumerateAllOrgs,
      enumeratePool: enumeratorPool,
    });
    evidenceGauges = registerEvidenceGauges(source);
    app.log.info({ evidence_gauges: 'registered' });
  } else {
    app.log.info({
      evidence_gauges: 'disabled',
      reason: !telemetry.enabled ? 'otel_endpoint_unset' : 'enumerator_url_unset',
    });
  }

  await app.register(healthRoute);
  await app.register(capabilitiesRoute);
  await app.register(runsRoute);
  await app.register(auditEventsRoute);
  await app.register(evidenceRoute);
  await app.register(adminAuditShredRoute);
  await app.register(adminDlpRoute);
  await app.register(passthroughAnthropicRoute);
  await app.register(passthroughOpenaiRoute);
  await app.register(governedAnthropicRoute);
  await app.register(governedOpenaiRoute);
  // AuditBridge ingress: one prefix-scoped onRequest hook that builds the
  // per-request identity for the four direct-provider routes and enters it into
  // the ALS store the wired dispatcher reads (ADR-028 §2). No-op elsewhere.
  registerRequestIdentityHook(app);
  await app.register(adminProviderCredentialsRoute);
  await app.register(workroomsRoute);
  await app.register(workroomTranscriptRoute);
  await app.register(workroomRunsRoute);
  await app.register(workroomApprovalsRoute);
  await app.register(regulatoryRoute);

  app.addHook('onClose', async () => {
    evidenceGauges?.unregister(); // (1) remove the batch callback before provider shutdown (sync)
    await telemetry.shutdown().catch(() => undefined); // (2) existing, unchanged
    await enumeratorPool?.end().catch(() => undefined); // (3) created locally ⇒ no overrides guard
    if (!overrides.pool) {
      await pool.end().catch(() => undefined); // (4) existing guarded close, unchanged
    }
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    govai: ServerDeps;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildServer()
    .then(async (app) => {
      try {
        await app.listen({ host: app.govai.env.API_HOST, port: app.govai.env.API_PORT });
      } catch (err) {
        app.log.error(err);
        process.exit(1);
      }
    })
    .catch((err) => {
      if (err instanceof BootError) {
        console.error(`[boot-fail] ${err.message}`);
      } else {
        console.error(err);
      }
      process.exit(1);
    });
}
