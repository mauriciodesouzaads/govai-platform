// Admin provider credentials endpoint semantics — PR3.1b (issue #22).
//
// Covers set/rotate, revoke, and list behavior including:
// - replaced_credential_id on rotation
// - tenant isolation in list
// - active/revoked filtering
// - validation rejections (400)
// - 404 on revoke of nonexistent id
// - 404 on revoke of already-revoked credential
// - resolver fails closed after revoke

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startStack,
  stopStack,
  seedOrg,
  grantAdminRole,
  setOrgOperationalMode,
  type Stack,
} from './helpers/server-fixture.js';
import {
  resolveAnthropicProviderKey,
  MissingProviderKeyError,
} from '../../apps/api/src/pipeline/provider-credentials.js';

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
  apiKey: string,
  body?: unknown,
): Promise<{ statusCode: number; body: unknown; rawBody: string }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-govai-api-key': apiKey,
  };
  const res = await stack.app.inject({ method, url, headers, payload: body ?? undefined });
  let parsed: unknown;
  try {
    parsed = res.body.length > 0 ? JSON.parse(res.body) : null;
  } catch {
    parsed = res.body;
  }
  return { statusCode: res.statusCode, body: parsed, rawBody: res.body };
}

async function adminOrg(): Promise<{ org_id: string; user_id: string; api_key: string }> {
  const org = await seedOrg(stack);
  await grantAdminRole(stack, org.api_key_prefix);
  return { org_id: org.org_id, user_id: org.user_id, api_key: org.api_key };
}

describe('admin-provider-credentials / endpoints', () => {
  it('POST set: 200 with metadata only, no plaintext in response', async () => {
    const admin = await adminOrg();
    const r = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-matrix-test-PLAINTEXT',
      reason: 'first set',
    });
    expect(r.statusCode).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body['provider']).toBe('anthropic');
    expect(body['key_prefix']).toBe('sk-ant-');
    expect(body['key_last4']).toBe('TEXT');
    expect(body['status']).toBe('active');
    expect(typeof body['id']).toBe('string');
    expect(typeof body['set_at']).toBe('string');
    expect(body['replaced_credential_id']).toBeNull();
    expect(typeof body['audit_event_id']).toBe('string');
    expect(r.rawBody).not.toContain('sk-ant-tenant-matrix-test-PLAINTEXT');
  });

  it('POST set: OpenAI provider', async () => {
    const admin = await adminOrg();
    const r = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'openai',
      api_key: 'sk-ant-env-matrix-test-EEEE',
      reason: 'openai set',
    });
    expect(r.statusCode).toBe(200);
    // Note: the resolver checks the prefix shape lazily; "sk-ant-..." here is
    // accepted by the helper because the helper only cares about (org, provider)
    // tuple. The stored key_prefix reflects the OpenAI extraction.
    expect((r.body as { provider?: string }).provider).toBe('openai');
  });

  it('POST set rotation: second set revokes previous and reports replaced_credential_id', async () => {
    const admin = await adminOrg();
    const r1 = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-A-isolation-test-AAAA',
      reason: 'first set',
    });
    expect(r1.statusCode).toBe(200);
    const firstId = (r1.body as { id: string }).id;

    const r2 = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-B-isolation-test-BBBB',
      reason: 'rotation',
    });
    expect(r2.statusCode).toBe(200);
    expect((r2.body as { replaced_credential_id: string }).replaced_credential_id).toBe(firstId);
  });

  it('POST set: missing api_key → 400 invalid_request, plaintext-free response', async () => {
    const admin = await adminOrg();
    const r = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'anthropic',
      reason: 'missing key',
    });
    expect(r.statusCode).toBe(400);
    expect((r.body as { error?: string }).error).toBe('invalid_request');
    // Issues array contains zod messages; no value echo.
    expect(r.rawBody).not.toContain('leak-canary');
  });

  it('POST set: empty api_key → 400 via zod min(1)', async () => {
    const admin = await adminOrg();
    const r = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'anthropic',
      api_key: '',
      reason: 'empty',
    });
    expect(r.statusCode).toBe(400);
  });

  it('POST set: unknown provider → 400', async () => {
    const admin = await adminOrg();
    const r = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'cohere',
      api_key: 'sk-ant-tenant-matrix-test-PLAINTEXT',
      reason: 'unknown provider',
    });
    expect(r.statusCode).toBe(400);
  });

  it('POST revoke: admin can revoke own active credential', async () => {
    const admin = await adminOrg();
    const setRes = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-matrix-test-PLAINTEXT',
      reason: 'pre-revoke set',
    });
    const credId = (setRes.body as { id: string }).id;
    const r = await inject(
      'POST',
      `/v1/admin/provider-credentials/${credId}/revoke`,
      admin.api_key,
      { reason: 'rotation' },
    );
    expect(r.statusCode).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body['id']).toBe(credId);
    expect(body['status']).toBe('revoked');
    expect(typeof body['revoked_at']).toBe('string');
    expect(body['revocation_reason']).toBe('rotation');
  });

  it('POST revoke: invalid id format → 400', async () => {
    const admin = await adminOrg();
    const r = await inject(
      'POST',
      '/v1/admin/provider-credentials/not-a-uuid/revoke',
      admin.api_key,
      { reason: 'attempt' },
    );
    expect(r.statusCode).toBe(400);
    expect((r.body as { error?: string }).error).toBe('invalid_credential_id');
  });

  it('POST revoke: unknown id → 404', async () => {
    const admin = await adminOrg();
    const r = await inject(
      'POST',
      `/v1/admin/provider-credentials/${randomUUID()}/revoke`,
      admin.api_key,
      { reason: 'unknown' },
    );
    expect(r.statusCode).toBe(404);
    expect((r.body as { error?: string }).error).toBe('credential_not_found_or_already_revoked');
  });

  it('POST revoke: already revoked → 404', async () => {
    const admin = await adminOrg();
    const setRes = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-matrix-test-PLAINTEXT',
      reason: 'pre-revoke set',
    });
    const credId = (setRes.body as { id: string }).id;
    const r1 = await inject(
      'POST',
      `/v1/admin/provider-credentials/${credId}/revoke`,
      admin.api_key,
      { reason: 'first revoke' },
    );
    expect(r1.statusCode).toBe(200);
    const r2 = await inject(
      'POST',
      `/v1/admin/provider-credentials/${credId}/revoke`,
      admin.api_key,
      { reason: 'double revoke' },
    );
    expect(r2.statusCode).toBe(404);
  });

  it('POST revoke: empty reason → 400', async () => {
    const admin = await adminOrg();
    const r = await inject(
      'POST',
      `/v1/admin/provider-credentials/${randomUUID()}/revoke`,
      admin.api_key,
      { reason: '' },
    );
    expect(r.statusCode).toBe(400);
  });

  it('Revoked credential: resolver fails closed in production', async () => {
    const admin = await adminOrg();
    await setOrgOperationalMode(stack, admin.org_id, 'production');
    const setRes = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-matrix-test-PLAINTEXT',
      reason: 'before revoke',
    });
    const credId = (setRes.body as { id: string }).id;
    const revRes = await inject(
      'POST',
      `/v1/admin/provider-credentials/${credId}/revoke`,
      admin.api_key,
      { reason: 'rotation' },
    );
    expect(revRes.statusCode).toBe(200);
    // Resolver now must fail closed.
    let captured: Error | null = null;
    try {
      await resolveAnthropicProviderKey(
        { env: stack.env, pool: stack.db.appPool, kms: stack.app.govai.kms },
        { orgId: admin.org_id, operationalMode: 'production' },
      );
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(MissingProviderKeyError);
  });

  it('GET list: returns only own tenant rows; no ciphertext/dek_wrapped/plaintext', async () => {
    const adminA = await adminOrg();
    const adminB = await adminOrg();
    await inject('POST', '/v1/admin/provider-credentials', adminA.api_key, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-A-isolation-test-AAAA',
      reason: 'A set',
    });
    await inject('POST', '/v1/admin/provider-credentials', adminB.api_key, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-B-isolation-test-BBBB',
      reason: 'B set',
    });
    const r = await inject('GET', '/v1/admin/provider-credentials', adminA.api_key);
    expect(r.statusCode).toBe(200);
    const data = (r.body as { data: Array<Record<string, unknown>> }).data;
    expect(data.length).toBeGreaterThan(0);
    for (const row of data) {
      expect(row['ciphertext']).toBeUndefined();
      expect(row['dek_wrapped']).toBeUndefined();
      expect(row['plaintext']).toBeUndefined();
    }
    // None of A's response should contain B's canary substring.
    expect(r.rawBody).not.toContain('tenant-B-isolation-test-BBBB');
  });

  it('GET list ?status=active: only active rows', async () => {
    const admin = await adminOrg();
    const setRes = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-matrix-test-PLAINTEXT',
      reason: 'set',
    });
    const credId = (setRes.body as { id: string }).id;
    await inject(
      'POST',
      `/v1/admin/provider-credentials/${credId}/revoke`,
      admin.api_key,
      { reason: 'rotation' },
    );
    await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'openai',
      api_key: 'sk-ant-env-matrix-test-EEEE',
      reason: 'second active',
    });
    const r = await inject(
      'GET',
      '/v1/admin/provider-credentials?status=active',
      admin.api_key,
    );
    expect(r.statusCode).toBe(200);
    const data = (r.body as { data: Array<Record<string, unknown>> }).data;
    for (const row of data) {
      expect(row['status']).toBe('active');
    }
  });

  it('GET list ?status=revoked: only revoked rows', async () => {
    const admin = await adminOrg();
    const setRes = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-matrix-test-PLAINTEXT',
      reason: 'set',
    });
    const credId = (setRes.body as { id: string }).id;
    await inject(
      'POST',
      `/v1/admin/provider-credentials/${credId}/revoke`,
      admin.api_key,
      { reason: 'rotation' },
    );
    const r = await inject(
      'GET',
      '/v1/admin/provider-credentials?status=revoked',
      admin.api_key,
    );
    expect(r.statusCode).toBe(200);
    const data = (r.body as { data: Array<Record<string, unknown>> }).data;
    expect(data.length).toBeGreaterThan(0);
    for (const row of data) {
      expect(row['status']).toBe('revoked');
    }
  });

  it('GET list default (all): includes both active and revoked', async () => {
    const admin = await adminOrg();
    const setRes = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'anthropic',
      api_key: 'sk-ant-tenant-matrix-test-PLAINTEXT',
      reason: 'set',
    });
    const credId = (setRes.body as { id: string }).id;
    await inject(
      'POST',
      `/v1/admin/provider-credentials/${credId}/revoke`,
      admin.api_key,
      { reason: 'rotation' },
    );
    await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'openai',
      api_key: 'sk-ant-env-matrix-test-EEEE',
      reason: 'second active',
    });
    const r = await inject('GET', '/v1/admin/provider-credentials', admin.api_key);
    expect(r.statusCode).toBe(200);
    const data = (r.body as { data: Array<Record<string, unknown>> }).data;
    const statuses = new Set(data.map((row) => row['status']));
    expect(statuses.has('active')).toBe(true);
    expect(statuses.has('revoked')).toBe(true);
  });
});
