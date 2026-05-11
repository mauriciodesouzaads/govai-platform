// RBAC gate for admin provider credentials endpoints — PR3.1b (issue #22).
//
// Verifies that:
// - Missing API key → 401.
// - Non-admin API key → 403 with `forbidden` error code.
// - Admin API key reaches the handler (smoke test only here — full set/revoke
//   semantics are covered in admin-provider-credentials-endpoints.test.ts).
// - Tenant A admin cannot revoke a credential owned by tenant B → 404 (RLS).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  grantAdminRole,
  seedProviderCredential,
  type Stack,
} from './helpers/server-fixture.js';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

async function inject(
  method: 'GET' | 'POST',
  url: string,
  apiKey: string | undefined,
  body?: unknown,
): Promise<{ statusCode: number; body: unknown; rawBody: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers['x-govai-api-key'] = apiKey;
  const res = await stack.app.inject({ method, url, headers, payload: body ?? undefined });
  let parsed: unknown;
  try {
    parsed = res.body.length > 0 ? JSON.parse(res.body) : null;
  } catch {
    parsed = res.body;
  }
  return { statusCode: res.statusCode, body: parsed, rawBody: res.body };
}

describe('admin-provider-credentials / RBAC', () => {
  it('POST set without API key → 401', async () => {
    const r = await inject('POST', '/v1/admin/provider-credentials', undefined, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-matrix-test-PLAINTEXT',
      reason: 'no auth',
    });
    expect(r.statusCode).toBe(401);
    expect((r.body as { error?: string }).error).toBe('auth_error');
  });

  it('POST set with non-admin key → 403 forbidden', async () => {
    const org = await seedOrg(stack);
    const r = await inject('POST', '/v1/admin/provider-credentials', org.api_key, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-matrix-test-PLAINTEXT',
      reason: 'non-admin attempt',
    });
    expect(r.statusCode).toBe(403);
    expect((r.body as { error?: string }).error).toBe('forbidden');
    expect((r.body as { required_role?: string }).required_role).toBe('admin');
  });

  it('POST revoke with non-admin key → 403', async () => {
    const org = await seedOrg(stack);
    const r = await inject(
      'POST',
      `/v1/admin/provider-credentials/${randomUUID()}/revoke`,
      org.api_key,
      { reason: 'non-admin attempt' },
    );
    expect(r.statusCode).toBe(403);
    expect((r.body as { error?: string }).error).toBe('forbidden');
  });

  it('GET list with non-admin key → 403', async () => {
    const org = await seedOrg(stack);
    const r = await inject('GET', '/v1/admin/provider-credentials', org.api_key);
    expect(r.statusCode).toBe(403);
  });

  it('GET list with no API key → 401', async () => {
    const r = await inject('GET', '/v1/admin/provider-credentials', undefined);
    expect(r.statusCode).toBe(401);
  });

  it('Promoted admin key reaches set handler (smoke)', async () => {
    const org = await seedOrg(stack);
    await grantAdminRole(stack, org.api_key_prefix);
    const r = await inject('POST', '/v1/admin/provider-credentials', org.api_key, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-matrix-test-PLAINTEXT',
      reason: 'admin smoke',
    });
    expect(r.statusCode).toBe(200);
    expect((r.body as { provider?: string }).provider).toBe('anthropic');
    expect((r.body as { key_prefix?: string }).key_prefix).toBe('sk-ant-');
  });

  it('admin in tenant A cannot revoke tenant B credential (404 via RLS)', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    await grantAdminRole(stack, orgA.api_key_prefix);
    const credB = await seedProviderCredential(stack, {
      orgId: orgB.org_id,
      provider: 'anthropic',
      plaintextKey: 'sk-ant-tenant-B-isolation-test-BBBB',
      setByUserId: orgB.user_id,
    });
    // Tenant A admin tries to revoke tenant B's credential id → must 404.
    const r = await inject(
      'POST',
      `/v1/admin/provider-credentials/${credB.id}/revoke`,
      orgA.api_key,
      { reason: 'cross-tenant attempt' },
    );
    expect(r.statusCode).toBe(404);
    expect((r.body as { error?: string }).error).toBe('credential_not_found_or_already_revoked');
  });

  it('non-admin key with developer role still fails (gate is explicit admin)', async () => {
    const org = await seedOrg(stack);
    const extra = await addApiKey(stack, org.org_id, org.user_id, ['developer']);
    const r = await inject('GET', '/v1/admin/provider-credentials', extra.api_key);
    expect(r.statusCode).toBe(403);
  });

  it('admin key with multiple roles works', async () => {
    const org = await seedOrg(stack);
    const extra = await addApiKey(stack, org.org_id, org.user_id, ['developer', 'admin']);
    const r = await inject('GET', '/v1/admin/provider-credentials', extra.api_key);
    expect(r.statusCode).toBe(200);
  });
});
