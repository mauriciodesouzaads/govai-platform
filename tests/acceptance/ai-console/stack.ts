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

/**
 * `hermetic` points the provider routes at the local loopback upstream. `live` leaves
 * `GOVAI_PROVIDER_BASE_URL` UNSET, which is what makes each provider plugin fall back to its
 * own real base URL (`https://api.openai.com` / `https://api.anthropic.com`) — a single env var
 * cannot address two providers, and the absence of it is the only way to reach both.
 *
 * ★ Live mode COSTS REAL MONEY. It refuses to start without both provider keys, it never
 * prints them, and it provisions them through the canonical admin route rather than reaching
 * into the database.
 */
export type AcceptanceMode = 'hermetic' | 'live';

export type AcceptanceStack = {
  db: TestDb;
  mode: AcceptanceMode;
  /** Null in live mode: there is no loopback, the real providers answer. */
  provider: LoopbackHandle | null;
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

export async function startAcceptanceStack(
  mode: AcceptanceMode = 'hermetic',
): Promise<AcceptanceStack> {
  // Fail BEFORE spending a container on a run that cannot work.
  if (mode === 'live' && !(process.env['OPENAI_API_KEY'] && process.env['ANTHROPIC_API_KEY'])) {
    throw new Error(
      'live acceptance needs OPENAI_API_KEY and ANTHROPIC_API_KEY in the environment ' +
        '(they are never printed, never written to disk and never committed)',
    );
  }
  const db = await startPostgres();
  const provider = mode === 'hermetic' ? await startLoopbackProvider() : null;
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
    GOVAI_LIVE_TESTS: mode === 'live',
    // ★ UNSET in live mode. One env var cannot name two providers, and each plugin falls back
    // to its own real base URL exactly when this is absent.
    GOVAI_PROVIDER_BASE_URL: provider ? provider.baseUrl : undefined,
    GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION: false,
    GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS: 300_000,
    RUN_DISPATCH_RECOVERY_ENABLED: false,
    RUN_DISPATCH_RECOVERY_INTERVAL_MS: 30_000,
    RUN_DISPATCH_PREPARED_GRACE_MS: 60_000,
    RUN_DISPATCH_RECOVERY_GRACE_MS: 30_000,
    RUN_DISPATCH_RECOVERY_BATCH_SIZE: 50,
  } as GovAIEnv;

  const app = await buildServer({ env });
  const org = await seedAcceptanceOrg(db, seed, mode);
  await app.listen({ host: env.API_HOST, port: API_PORT });

  // ★ LIVE credentials go in through the CANONICAL ADMIN ROUTE, with the admin key, over HTTP
  // — the same path an operator uses. Seeding them straight into the table would skip the
  // route's RBAC, its audit event and its KMS envelope call, which is most of what makes the
  // credential path worth exercising at all.
  if (mode === 'live') {
    await provisionLiveCredentials(org.admin_api_key);
  }

  return {
    db,
    mode,
    provider,
    app,
    env,
    org,
    close: async () => {
      db.shuttingDown.value = true;
      await app.close().catch(() => undefined);
      await provider?.close().catch(() => undefined);
      await stopPostgres(db);
    },
  };
}

/**
 * Provision the real provider keys through `POST /v1/admin/provider-credentials`.
 *
 * The plaintext is read from the environment, handed to the route, and never logged, never
 * echoed and never returned — the route answers with prefix/last4 metadata only, and even that
 * is not printed here.
 */
async function provisionLiveCredentials(adminApiKey: string): Promise<void> {
  for (const [provider, envKey] of [
    ['openai', 'OPENAI_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'],
  ] as const) {
    const apiKey = process.env[envKey];
    /* c8 ignore next -- startAcceptanceStack already refused to start without both */
    if (!apiKey) throw new Error(`${envKey} is required for live acceptance`);
    const res = await fetch(`http://127.0.0.1:${String(API_PORT)}/v1/admin/provider-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-govai-api-key': adminApiKey },
      body: JSON.stringify({ provider, api_key: apiKey, reason: 'ai-console live acceptance' }),
    });
    if (!res.ok) {
      // Status only. The response body could echo request detail, and this is a credential path.
      throw new Error(`provisioning the ${provider} credential failed with HTTP ${String(res.status)}`);
    }
  }
}

/**
 * Seed one organization with TWO keys.
 *
 * ★ The browser gets the OPERATOR key (auditor + developer) and never the admin one. Provider
 * credentials are provisioned with the admin key, out of band; giving the browser admin merely
 * because it is convenient is exactly the shortcut that turns an acceptance topology into a
 * production habit.
 */
async function seedAcceptanceOrg(
  db: TestDb,
  seed: string,
  mode: AcceptanceMode,
): Promise<AcceptanceStack['org']> {
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

  // Hermetic mode seeds placeholder tenant credentials through the real KMS envelope path — the
  // loopback never checks them, and nothing real is ever stored. LIVE mode provisions the real
  // keys afterwards, through the admin ROUTE (see provisionLiveCredentials).
  if (mode === 'live') {
    return {
      org_id: orgId,
      user_id: userId,
      operator_api_key: operator.plaintext,
      admin_api_key: admin.plaintext,
    };
  }
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
