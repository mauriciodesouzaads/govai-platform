import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { loadEnv, originsFromCsv, assertCorsSafeForProd, BootError } from '@govai/config';
import { createKmsFromEnv } from '@govai/core-identity';
import { healthRoute } from './routes/health.js';
import { capabilitiesRoute } from './routes/capabilities.js';
import { runsRoute } from './routes/runs.js';
import { auditEventsRoute } from './routes/audit-events.js';
import { adminAuditShredRoute } from './routes/admin-audit-shred.js';
import { adminDlpRoute } from './routes/admin-dlp.js';
import { passthroughAnthropicRoute } from './routes/passthrough-anthropic.js';
import { passthroughOpenaiRoute } from './routes/passthrough-openai.js';

export async function buildServer() {
  const env = loadEnv(process.env);
  assertCorsSafeForProd(env);
  // KMS init valida fail-conditions em production.
  const kms = createKmsFromEnv(env);

  // Probe at boot — production KMS that is not implemented yet must fail-fast,
  // not on first use. This catches GOVAI_KMS_PROVIDER=aws|gcp|azure in production
  // before serving any request.
  if (env.NODE_ENV === 'production') {
    await kms.deriveKey({
      purpose: 'audit_hmac',
      orgId: '00000000-0000-0000-0000-000000000000',
      keyId: 'boot-probe',
      version: 1,
    });
  }

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
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  app.decorate('govai', { env, kms });

  await app.register(healthRoute);
  await app.register(capabilitiesRoute);
  await app.register(runsRoute);
  await app.register(auditEventsRoute);
  await app.register(adminAuditShredRoute);
  await app.register(adminDlpRoute);
  await app.register(passthroughAnthropicRoute);
  await app.register(passthroughOpenaiRoute);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    govai: { env: ReturnType<typeof loadEnv>; kms: ReturnType<typeof createKmsFromEnv> };
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
