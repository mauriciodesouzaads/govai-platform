// The hermetic AI Console acceptance stack.
//
// Brings up everything the console actually talks to, with only the UPSTREAM PROVIDER replaced:
//
//   Postgres (testcontainers) + every migration
//   → the real Fastify GovAI app (apps/api/src/server.ts), listening on a fixed port
//   → real `authenticateApiKey`, real tenant RLS, real provider-credential resolution through
//     the KMS dev envelope, real /passthrough and /governed plugins, real AuditBridge capture
//   → a loopback upstream that speaks the three provider protocols
//
// The browser then runs the real Vite dev server against it, which is the same same-origin
// topology production uses. Nothing in the UI's own transport is mocked: this is the only way
// to find out whether the console works, as opposed to whether its unit tests agree with it.
//
// Run:  pnpm acceptance:ai-console
// Stop: Ctrl-C (the stack tears the container down).

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { GovAIEnv } from '@govai/config';
import { generateApiKey, DevKms } from '@govai/core-identity';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { createProviderCredential } from '@govai/core-governance';
import { buildServer } from '../../../apps/api/src/server.js';
import { freshSeedHex, startPostgres, stopPostgres, type TestDb } from '../../integration/setup.js';
import { startLoopbackProvider, type LoopbackHandle } from './loopback-provider.js';

export const API_PORT = 8080;

export type AcceptanceStack = {
  db: TestDb;
  provider: LoopbackHandle;
  app: FastifyInstance;
  env: GovAIEnv;
  org: {
    org_id: string;
    user_id: string;
    /** The BROWSER key: auditor + developer. Deliberately NOT admin. */
    operator_api_key: string;
    /** The provisioning key: admin only, never pasted into the browser. */
    admin_api_key: string;
  };
  close: () => Promise<void>;
};

/**
 * `tier` and `operational_mode` are chosen so the governed route can DEMONSTRATE the
 * recommendation-vs-applied distinction rather than only assert it:
 *
 *   business + production + risk class A (plain text)   → decision `observe`,  applied forwarded
 *   business + production + risk class C (CPF in text)  → decision `enforce`, applied forwarded
 *
 * The second is the case the receipt exists for: the matrix recommends enforcement, the runtime
 * forwards the request to the provider anyway, and the UI must say both things without letting
 * either be read as the other.
 */
const ORG_TIER = 'business';
const ORG_MODE = 'production';

export async function startAcceptanceStack(): Promise<AcceptanceStack> {
  const db = await startPostgres();
  const provider = await startLoopbackProvider();
  const seed = freshSeedHex();

  const env = {
    // `test` keeps the in-process rate limiter out of the way of a browser session; every
    // other behaviour under test (credential resolution, governance, capture) is driven by the
    // ORG's operational_mode, which is `production` below.
    NODE_ENV: 'test',
    KMS_DEV_SEED: seed,
    GOVAI_KMS_PROVIDER: 'dev',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    REDIS_URL: undefined,
    API_PORT,
    API_HOST: '127.0.0.1',
    API_CORS_ORIGINS: '',
    API_CORS_CREDENTIALS: false,
    JWT_ISSUER: 'https://govai.test',
    JWT_AUDIENCE: 'govai-api',
    JWT_PUBLIC_KEY_PEM: undefined,
    ANTHROPIC_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    OTEL_SERVICE_NAME: 'govai-api-acceptance',
    OTEL_TRACES_SAMPLER_ARG: 1.0,
    EVIDENCE_T_SEAL_SECONDS: 0,
    EVIDENCE_DEFAULT_WINDOW_SECONDS: 86_400,
    GOVAI_LIVE_TESTS: false,
    GOVAI_PROVIDER_BASE_URL: provider.baseUrl,
    GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION: false,
    GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS: 300_000,
    RUN_DISPATCH_RECOVERY_ENABLED: false,
    RUN_DISPATCH_RECOVERY_INTERVAL_MS: 30_000,
    RUN_DISPATCH_PREPARED_GRACE_MS: 60_000,
    RUN_DISPATCH_RECOVERY_GRACE_MS: 30_000,
    RUN_DISPATCH_RECOVERY_BATCH_SIZE: 50,
  } as GovAIEnv;

  const app = await buildServer({ env });
  const org = await seedAcceptanceOrg(db, seed);
  await app.listen({ host: env.API_HOST, port: API_PORT });

  return {
    db,
    provider,
    app,
    env,
    org,
    close: async () => {
      db.shuttingDown.value = true;
      await app.close().catch(() => undefined);
      await provider.close().catch(() => undefined);
      await stopPostgres(db);
    },
  };
}

/**
 * Seed one organization with TWO keys.
 *
 * ★ The browser gets the OPERATOR key (auditor + developer) and never the admin one. Provider
 * credentials are provisioned with the admin key, out of band; giving the browser admin merely
 * because it is convenient is exactly the shortcut that turns an acceptance topology into a
 * production habit.
 */
async function seedAcceptanceOrg(db: TestDb, seed: string): Promise<AcceptanceStack['org']> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const operator = await generateApiKey();
  const admin = await generateApiKey();

  const c = await db.adminPool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE govai_audit_writer');
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    await c.query(
      `INSERT INTO govai.orgs (id, name, tier, operational_mode) VALUES ($1::uuid, $2, $3, $4)`,
      [orgId, 'ai-console-acceptance', ORG_TIER, ORG_MODE],
    );
    await c.query(
      `INSERT INTO govai.api_keys (prefix, hash, org_id, user_id, status, roles)
       VALUES ($1, $2, $3::uuid, $4::uuid, 'active', $5::text[])`,
      [operator.prefix, operator.hash, orgId, userId, ['auditor', 'developer']],
    );
    await c.query(
      `INSERT INTO govai.api_keys (prefix, hash, org_id, user_id, status, roles)
       VALUES ($1, $2, $3::uuid, $4::uuid, 'active', $5::text[])`,
      [admin.prefix, admin.hash, orgId, userId, ['admin']],
    );
    await c.query('COMMIT');
  } finally {
    c.release();
  }

  // Real tenant provider credentials, through the real KMS envelope path. The plaintext is a
  // placeholder: the loopback upstream never checks it, and nothing real is ever stored here.
  const kms = new DevKms(seed);
  for (const provider of ['openai', 'anthropic'] as const) {
    const client = await db.appPool.connect();
    try {
      await client.query('BEGIN');
      await setLocalAppOrgId(client, orgId);
      await createProviderCredential({
        db: client,
        kms,
        org_id: orgId,
        provider,
        plaintext_key: `loopback-${provider}-not-a-real-key`,
        set_by_user_id: userId,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    org_id: orgId,
    user_id: userId,
    operator_api_key: operator.plaintext,
    admin_api_key: admin.plaintext,
  };
}
