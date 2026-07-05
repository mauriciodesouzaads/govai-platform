// Common helper to spin up a Fastify app + provider-protocol server + Postgres
// Testcontainers stack for E2E tests.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../apps/api/src/server.js';
import { generateApiKey, DevKms } from '@govai/core-identity';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { createProviderCredential } from '@govai/core-governance';
import {
  startPostgres,
  stopPostgres,
  freshSeedHex,
  installPostgresPoolShutdownGuard,
  type TestDb,
} from '../setup.js';
import {
  startProviderProtocolServer,
  setErrorOverride,
  clearErrorOverrides,
  type ProviderProtocolServer,
} from '../fixtures/provider-protocol-server.js';
import type { GovAIEnv } from '@govai/config';

export async function configureProviderError(
  _stack: Stack,
  opts: { workspaceId: string; status: number; body?: Record<string, unknown> },
): Promise<void> {
  setErrorOverride(opts.workspaceId, { status: opts.status, body: opts.body });
}

export function clearProviderErrors(): void {
  clearErrorOverrides();
}

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
    // EP-008D: T_seal=0 so a freshly-seeded unsealed capture counts as past-SLO
    // deterministically in the evidence tests; window covers any recent seed.
    EVIDENCE_T_SEAL_SECONDS: 0,
    EVIDENCE_DEFAULT_WINDOW_SECONDS: 86_400,
    GOVAI_LIVE_TESTS: false,
    GOVAI_PROVIDER_BASE_URL: provider.baseUrl,
    GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION: false,
    ...envOverrides,
  } as GovAIEnv;

  // App owns the pool so we let buildServer create it from DATABASE_URL.
  const app = await buildServer({ env });

  // Issue #28: the Fastify app creates its own pg Pool (not the test setup
  // pools), and that pool participates in the same teardown race when
  // testcontainers stops Postgres. Install the same shutdown-scoped 57P01
  // guard on it so its idle clients don't surface unhandled errors during
  // Vitest's afterAll sequence. We share the TestDb shuttingDown flag so
  // all three pools (admin, app-test, app-fastify) flip together.
  installPostgresPoolShutdownGuard(app.govai.pool, db.shuttingDown, 'app-fastify');

  return { db, provider, app, env, seed };
}

export async function stopStack(stack: Stack): Promise<void> {
  // Flip the shutdown flag BEFORE we close anything — Fastify's onClose
  // hook will call app.govai.pool.end() inside stack.app.close(), and that
  // pool's shutdown guard needs to recognize the next 57P01 as expected.
  stack.db.shuttingDown.value = true;
  await stack.app.close().catch(() => undefined);
  await stack.provider.close().catch(() => undefined);
  await stopPostgres(stack.db);
}

/**
 * Seed an org + user + active API key into the test DB. Returns the plaintext key
 * (only available at creation time).
 *
 * The org is created with `operational_mode='test'` by default — this matches
 * NODE_ENV='test' usage in the integration suite and lets the PR3.1a tenant
 * provider credential resolver fall back to the hermetic placeholder when no
 * `provider_credentials` row is seeded. Tests that need a different mode call
 * `setOrgOperationalMode(stack, orgId, mode)` after seeding.
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
    await c.query(
      `INSERT INTO govai.orgs (id, name, operational_mode) VALUES ($1::uuid, $2::text, 'test')`,
      [orgId, name],
    );
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

/**
 * Add an additional API key for an existing org, with optional RBAC roles.
 * Useful for tests that need both an admin and a non-admin key on the same
 * tenant (e.g. negative-test the 403 path while keeping the org reusable).
 */
export async function addApiKey(
  stack: Stack,
  orgId: string,
  userId: string,
  roles: ReadonlyArray<
    'admin' | 'data_protection_officer' | 'dlp_admin' | 'developer' | 'auditor'
  > = [],
): Promise<{ api_key: string; api_key_prefix: string }> {
  const key = await generateApiKey();
  const c = await stack.db.adminPool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE govai_audit_writer');
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    await c.query(
      `INSERT INTO govai.api_keys (prefix, hash, org_id, user_id, status, roles)
       VALUES ($1, $2, $3::uuid, $4::uuid, 'active', $5::text[])`,
      [key.prefix, key.hash, orgId, userId, roles as string[]],
    );
    await c.query('COMMIT');
  } finally {
    c.release();
  }
  return { api_key: key.plaintext, api_key_prefix: key.prefix };
}

/**
 * Promote an existing seeded API key (by prefix) to the admin role. Convenient
 * for tests that already have an org from seedOrg and want to elevate its key.
 */
export async function grantAdminRole(stack: Stack, apiKeyPrefix: string): Promise<void> {
  const c = await stack.db.adminPool.connect();
  try {
    await c.query(
      `UPDATE govai.api_keys SET roles = ARRAY['admin']::text[] WHERE prefix = $1`,
      [apiKeyPrefix],
    );
  } finally {
    c.release();
  }
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
    // EP-GATE-MECHANIZATION D6: seed under govai_app, NOT govai_audit_writer. On dlp_baseline_config
    // the writer has dbc_insert_writer but NO UPDATE policy (0005), so a REPEAT seed of the same
    // (org, detector) — the ON CONFLICT DO UPDATE below — hits a missing RLS UPDATE policy and
    // intermittently fails ("new row violates row-level security policy"). govai_app has BOTH
    // dbc_insert_app and dbc_update_app, so both the INSERT and the DO UPDATE paths have a policy.
    // Those policies are PER-TENANT (org_id = current_setting('app.org_id')), so the app.org_id set
    // immediately below MUST equal the seeded row's org_id — it does ($1 for both). (Not a
    // production change: production never writes this table — dlp.ts only SELECTs it; adding a
    // writer UPDATE policy would be the wrong fix, a production privilege expansion to serve a test.)
    await c.query('SET LOCAL ROLE govai_app');
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

/**
 * Opt-in helper: seed an active provider_credentials row for the given org.
 * Uses the canonical setProviderCredential helper so the KMS envelope encryption
 * boundary is exercised. seedOrg() does NOT call this — tests that need
 * tenant-scoped credentials must invoke this explicitly.
 */
export async function seedProviderCredential(
  stack: Stack,
  opts: {
    orgId: string;
    provider: 'anthropic' | 'openai';
    plaintextKey: string;
    setByUserId: string;
  },
): Promise<{ id: string; key_prefix: string; key_last4: string }> {
  const kms = new DevKms(stack.seed);
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await setLocalAppOrgId(c, opts.orgId);
    const r = await createProviderCredential({
      db: c,
      kms,
      org_id: opts.orgId,
      provider: opts.provider,
      plaintext_key: opts.plaintextKey,
      set_by_user_id: opts.setByUserId,
    });
    await c.query('COMMIT');
    return { id: r.id, key_prefix: r.key_prefix, key_last4: r.key_last4 };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

/**
 * Opt-in helper: revoke the active credential for (orgId, provider) directly via SQL.
 * Mirrors what revokeProviderCredential() does but allows tests to set a custom reason.
 */
export async function revokeActiveProviderCredential(
  stack: Stack,
  opts: { orgId: string; provider: 'anthropic' | 'openai'; revokedByUserId: string; reason: string },
): Promise<void> {
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await setLocalAppOrgId(c, opts.orgId);
    await c.query(
      `UPDATE govai.provider_credentials
          SET status='revoked', revoked_at=now(), revoked_by_user_id=$3::uuid, revocation_reason=$4::text
        WHERE org_id=$1::uuid AND provider=$2::text AND status='active'`,
      [opts.orgId, opts.provider, opts.revokedByUserId, opts.reason],
    );
    await c.query('COMMIT');
  } finally {
    c.release();
  }
}

/**
 * Opt-in helper: tamper a credential row's dek_wrapped to force decrypt failure
 * (used by the plaintext-leak canary test to exercise the kms_decrypt_failed path).
 */
export async function tamperCredentialDekWrapped(
  stack: Stack,
  opts: { orgId: string; provider: 'anthropic' | 'openai' },
): Promise<void> {
  const c = await stack.db.adminPool.connect();
  try {
    // Run as superuser bypasses RLS + the no-revoke UPDATE policy so we can
    // mutate dek_wrapped directly for a fault-injection test.
    await c.query(
      `UPDATE govai.provider_credentials
          SET dek_wrapped = '\\x00000000000000000000000000000000'::bytea
        WHERE org_id=$1::uuid AND provider=$2::text AND status='active'`,
      [opts.orgId, opts.provider],
    );
  } finally {
    c.release();
  }
}

/**
 * Mutate the org's operational_mode for tests. The govai_app role does NOT
 * have UPDATE on govai.orgs.tier/operational_mode (PR3.1a deliberately did not
 * grant it); test runs go through adminPool's superuser to bypass RLS.
 */
export async function setOrgOperationalMode(
  stack: Stack,
  orgId: string,
  mode: 'production' | 'pilot' | 'dev' | 'test',
): Promise<void> {
  const c = await stack.db.adminPool.connect();
  try {
    await c.query(
      `UPDATE govai.orgs SET operational_mode = $2 WHERE id = $1::uuid`,
      [orgId, mode],
    );
  } finally {
    c.release();
  }
}

/**
 * Workroom Phase 1 (issue #49): flip the org-level audit-only admission gate.
 * govai_app has no UPDATE grant on govai.orgs, so this goes through the
 * superuser adminPool, mirroring setOrgOperationalMode.
 */
export async function setOrgWorkroomAuditOnlyDisallowed(
  stack: Stack,
  orgId: string,
  value: boolean,
): Promise<void> {
  const c = await stack.db.adminPool.connect();
  try {
    await c.query('UPDATE govai.orgs SET workroom_audit_only_disallowed = $2 WHERE id = $1::uuid', [
      orgId,
      value,
    ]);
  } finally {
    c.release();
  }
}

/**
 * Workroom Phase 1 (issue #49): seed an agent_profile row directly. Phase 1
 * ships no public CRUD for agent profiles, so tests that need an agent
 * participant insert the profile through this test-only helper. Uses the app
 * pool with tenant context so the govai_app INSERT policy is exercised.
 */
export async function seedAgentProfile(
  stack: Stack,
  opts: {
    orgId: string;
    name?: string;
    provider?: 'anthropic' | 'openai' | 'external';
    defaultRole?: string;
    isDisabled?: boolean;
  },
): Promise<{ id: string }> {
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await setLocalAppOrgId(c, opts.orgId);
    const r = await c.query<{ id: string }>(
      `INSERT INTO govai.agent_profiles (org_id, name, provider, default_role, is_disabled)
       VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::boolean)
       RETURNING id`,
      [
        opts.orgId,
        opts.name ?? `agent-${randomUUID().slice(0, 8)}`,
        opts.provider ?? 'anthropic',
        opts.defaultRole ?? 'executor_agent',
        opts.isDisabled ?? false,
      ],
    );
    await c.query('COMMIT');
    return { id: r.rows[0]!.id };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

export async function inject(
  stack: Stack,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  apiKey: string | undefined,
  payload?: unknown,
): Promise<{ statusCode: number; body: unknown; rawBody: string }> {
  const headers: Record<string, string> = {};
  // Only declare a JSON content-type when a body is actually sent. A
  // bodyless request (GET, or a DELETE) carrying `content-type: application/json`
  // trips Fastify's JSON body parser ("body cannot be empty") before the route
  // handler runs.
  if (payload !== undefined) headers['content-type'] = 'application/json';
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
