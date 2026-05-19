import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Pool } from 'pg';
import { loadEnv, originsFromCsv, assertCorsSafeForProd, BootError, type GovAIEnv } from '@govai/config';
import { createKmsFromEnv, type Kms } from '@govai/core-identity';
import { createPool } from './db/client.js';
import { healthRoute } from './routes/health.js';
import { capabilitiesRoute } from './routes/capabilities.js';
import { runsRoute } from './routes/runs.js';
import { auditEventsRoute } from './routes/audit-events.js';
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

export type ServerDeps = {
  env: GovAIEnv;
  kms: Kms;
  pool: Pool;
  policyCommitSha: string;
};

export type ServerOverrides = Partial<{
  pool: Pool;
  env: GovAIEnv;
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

  app.decorate('govai', { env, kms, pool, policyCommitSha });

  await app.register(healthRoute);
  await app.register(capabilitiesRoute);
  await app.register(runsRoute);
  await app.register(auditEventsRoute);
  await app.register(adminAuditShredRoute);
  await app.register(adminDlpRoute);
  await app.register(passthroughAnthropicRoute);
  await app.register(passthroughOpenaiRoute);
  await app.register(governedAnthropicRoute);
  await app.register(governedOpenaiRoute);
  await app.register(adminProviderCredentialsRoute);
  await app.register(workroomsRoute);
  await app.register(workroomTranscriptRoute);
  await app.register(workroomRunsRoute);
  await app.register(workroomApprovalsRoute);

  app.addHook('onClose', async () => {
    if (!overrides.pool) {
      await pool.end().catch(() => undefined);
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
