// Common helper to spin up a Fastify app + provider-protocol server + Postgres
// Testcontainers stack for E2E tests.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../apps/api/src/server.js';
import { generateApiKey } from '@govai/core-identity';
import { startPostgres, stopPostgres, freshSeedHex, type TestDb } from '../setup.js';
import {
  startProviderProtocolServer,
  type ProviderProtocolServer,
} from '../fixtures/provider-protocol-server.js';
import type { GovAIEnv } from '@govai/config';

export type SeededOrg = {
  org_id: string;
  user_id: string;
  workspace_id: string;
  api_key: string;
  api_key_prefix: string;
};

export type Stack = {
  db: TestDb;
  provider: ProviderProtocolServer;
  app: FastifyInstance;
  env: GovAIEnv;
  seed: string;
};

export async function startStack(envOverrides: Partial<GovAIEnv> = {}): Promise<Stack> {
  const db = await startPostgres();
  const provider = await startProviderProtocolServer();
  const seed = freshSeedHex();

  const env = {
    NODE_ENV: 'test',
    KMS_DEV_SEED: seed,
    GOVAI_KMS_PROVIDER: 'dev',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    REDIS_URL: undefined,
    API_PORT: 0,
    API_HOST: '127.0.0.1',
    API_CORS_ORIGINS: '',
    API_CORS_CREDENTIALS: false,
    JWT_ISSUER: 'https://govai.test',
    JWT_AUDIENCE: 'govai-api',
    JWT_PUBLIC_KEY_PEM: undefined,
    ANTHROPIC_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    OTEL_SERVICE_NAME: 'govai-api-test',
    OTEL_TRACES_SAMPLER_ARG: 1.0,
    GOVAI_LIVE_TESTS: false,
    GOVAI_PROVIDER_BASE_URL: provider.baseUrl,
    GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION: false,
    ...envOverrides,
  } as GovAIEnv;

  // App owns the pool so we let buildServer create it from DATABASE_URL.
  const app = await buildServer({ env });

  return { db, provider, app, env, seed };
}

export async function stopStack(stack: Stack): Promise<void> {
  await stack.app.close().catch(() => undefined);
  await stack.provider.close().catch(() => undefined);
  await stopPostgres(stack.db);
}

/**
 * Seed an org + user + active API key into the test DB. Returns the plaintext key
 * (only available at creation time).
 */
export async function seedOrg(stack: Stack, name = `org-${randomUUID().slice(0, 8)}`): Promise<SeededOrg> {
  const orgId = randomUUID();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const key = await generateApiKey();

  // Insert under writer role (admin pool) — bypasses tenant RLS for setup.
  const c = await stack.db.adminPool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE govai_audit_writer');
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    await c.query(`INSERT INTO govai.orgs (id, name) VALUES ($1::uuid, $2::text)`, [orgId, name]);
    await c.query(
      `INSERT INTO govai.api_keys (prefix, hash, org_id, user_id, status)
       VALUES ($1, $2, $3::uuid, $4::uuid, 'active')`,
      [key.prefix, key.hash, orgId, userId],
    );
    await c.query('COMMIT');
  } finally {
    c.release();
  }

  return {
    org_id: orgId,
    user_id: userId,
    workspace_id: workspaceId,
    api_key: key.plaintext,
    api_key_prefix: key.prefix,
  };
}

export async function setBaselineDlpAction(
  stack: Stack,
  orgId: string,
  detector: 'cpf' | 'cnpj' | 'email' | 'phone_br',
  action: 'detect' | 'redact' | 'deny',
): Promise<void> {
  const c = await stack.db.adminPool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE govai_audit_writer');
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    await c.query(
      `INSERT INTO govai.dlp_baseline_config (org_id, detector, action)
         VALUES ($1::uuid, $2, $3)
         ON CONFLICT (org_id, detector) DO UPDATE SET action = EXCLUDED.action`,
      [orgId, detector, action],
    );
    await c.query('COMMIT');
  } finally {
    c.release();
  }
}

export async function insertCapabilityOverride(
  stack: Stack,
  orgId: string,
  userId: string,
  capabilityId: string,
  facetId: string,
  levelOverride: number | null,
  statusOverride: 'blocked' | 'experimental' | null,
): Promise<void> {
  // capability_overrides INSERT policy targets govai_app, not the writer role.
  // We use the app pool with the tenant context set to the right org.
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    await c.query(
      `INSERT INTO govai.capability_overrides
         (org_id, capability_id, facet_id, level_override, status_override, reason, set_by_user_id)
         VALUES ($1::uuid, $2, $3, $4, $5, 'test fixture', $6::uuid)`,
      [orgId, capabilityId, facetId, levelOverride, statusOverride, userId],
    );
    await c.query('COMMIT');
  } finally {
    c.release();
  }
}

export async function inject(
  stack: Stack,
  method: 'GET' | 'POST',
  url: string,
  apiKey: string | undefined,
  payload?: unknown,
): Promise<{ statusCode: number; body: unknown; rawBody: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers['x-govai-api-key'] = apiKey;
  const res = await stack.app.inject({ method, url, headers, payload: payload ?? undefined });
  let body: unknown;
  try {
    body = res.body.length > 0 ? JSON.parse(res.body) : null;
  } catch {
    body = res.body;
  }
  return { statusCode: res.statusCode, body, rawBody: res.body };
}
