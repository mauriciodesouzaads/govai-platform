// Tenant isolation for provider credentials — PR3.1a Checkpoint 2 (issue #13).
//
// Verifies:
// - Tenant A and Tenant B credentials decrypt to their own plaintext.
// - Tenant A cannot SELECT Tenant B's credential row under RLS.
// - Production / pilot mode fails closed when no tenant credential exists,
//   even with a platform env key set.
// - Revoked credential fails closed.
// - Hermetic test+loopback continues to work with no DB row.
// - Production + non-loopback rejects the hermetic placeholder.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  stopStack,
  seedOrg,
  seedProviderCredential,
  revokeActiveProviderCredential,
  setOrgOperationalMode,
  type Stack,
} from './helpers/server-fixture.js';
import { setLocalAppOrgId } from '@govai/core-tenant';
import {
  resolveAnthropicProviderKey,
  resolveOpenAIProviderKey,
  MissingProviderKeyError,
} from '../../apps/api/src/pipeline/provider-credentials.js';

const KEY_A_ANTHROPIC = 'sk-ant-tenant-A-isolation-test-AAAA';
const KEY_B_ANTHROPIC = 'sk-ant-tenant-B-isolation-test-BBBB';
const KEY_A_OPENAI = 'sk-tenant-A-isolation-test-AAAA';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

function deps() {
  return { env: stack.env, pool: stack.db.appPool, kms: stack.app.govai.kms };
}

describe('provider-credentials / tenant isolation', () => {
  it('two tenants with different credentials each decrypt to their own plaintext', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: orgA.org_id,
      provider: 'anthropic',
      plaintextKey: KEY_A_ANTHROPIC,
      setByUserId: orgA.user_id,
    });
    await seedProviderCredential(stack, {
      orgId: orgB.org_id,
      provider: 'anthropic',
      plaintextKey: KEY_B_ANTHROPIC,
      setByUserId: orgB.user_id,
    });

    const a = await resolveAnthropicProviderKey(deps(), {
      orgId: orgA.org_id,
      operationalMode: 'production',
    });
    const b = await resolveAnthropicProviderKey(deps(), {
      orgId: orgB.org_id,
      operationalMode: 'production',
    });
    expect(a).toBe(KEY_A_ANTHROPIC);
    expect(b).toBe(KEY_B_ANTHROPIC);
    expect(a).not.toBe(b);
  });

  it('tenant A cannot SELECT tenant B credential row under RLS', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: orgA.org_id,
      provider: 'anthropic',
      plaintextKey: KEY_A_ANTHROPIC,
      setByUserId: orgA.user_id,
    });
    await seedProviderCredential(stack, {
      orgId: orgB.org_id,
      provider: 'anthropic',
      plaintextKey: KEY_B_ANTHROPIC,
      setByUserId: orgB.user_id,
    });

    // Session as tenant A.
    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, orgA.org_id);
      const all = await c.query<{ org_id: string }>(
        `SELECT org_id FROM govai.provider_credentials WHERE provider = 'anthropic'`,
      );
      expect(all.rows.length).toBeGreaterThan(0);
      for (const r of all.rows) {
        expect(r.org_id).toBe(orgA.org_id);
      }
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('production + no tenant credential => MissingProviderKeyError (no env fallback)', async () => {
    const org = await seedOrg(stack);
    await setOrgOperationalMode(stack, org.org_id, 'production');
    let captured: Error | null = null;
    try {
      await resolveAnthropicProviderKey(deps(), {
        orgId: org.org_id,
        operationalMode: 'production',
      });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(MissingProviderKeyError);
    expect((captured as MissingProviderKeyError).reason).toBe(
      'no_tenant_credential_in_production_mode',
    );
  });

  it('pilot + no tenant credential => MissingProviderKeyError', async () => {
    const org = await seedOrg(stack);
    let captured: Error | null = null;
    try {
      await resolveAnthropicProviderKey(deps(), {
        orgId: org.org_id,
        operationalMode: 'pilot',
      });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(MissingProviderKeyError);
    expect((captured as MissingProviderKeyError).reason).toBe(
      'no_tenant_credential_in_pilot_mode',
    );
  });

  it('revoked credential fails closed in production', async () => {
    const org = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      plaintextKey: KEY_A_ANTHROPIC,
      setByUserId: org.user_id,
    });
    await revokeActiveProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      revokedByUserId: org.user_id,
      reason: 'test rotation',
    });
    let captured: Error | null = null;
    try {
      await resolveAnthropicProviderKey(deps(), {
        orgId: org.org_id,
        operationalMode: 'production',
      });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(MissingProviderKeyError);
    expect((captured as MissingProviderKeyError).reason).toBe(
      'no_tenant_credential_in_production_mode',
    );
  });

  it('hermetic test+loopback works with no tenant credential', async () => {
    const org = await seedOrg(stack);
    // env.NODE_ENV='test' + GOVAI_PROVIDER_BASE_URL=loopback (the test fixture).
    const k = await resolveAnthropicProviderKey(deps(), {
      orgId: org.org_id,
      operationalMode: 'test',
    });
    expect(k).toBe('sk-ant-test-hermetic');
  });

  it('hermetic placeholder is NOT returned in production mode even on loopback', async () => {
    const org = await seedOrg(stack);
    // Same loopback baseUrl, but operationalMode='production' must reject.
    let captured: Error | null = null;
    try {
      await resolveAnthropicProviderKey(deps(), {
        orgId: org.org_id,
        operationalMode: 'production',
      });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(MissingProviderKeyError);
    expect((captured as MissingProviderKeyError).reason).toBe(
      'no_tenant_credential_in_production_mode',
    );
  });

  it('OpenAI tenant credential is isolated and decrypts correctly', async () => {
    const org = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'openai',
      plaintextKey: KEY_A_OPENAI,
      setByUserId: org.user_id,
    });
    const k = await resolveOpenAIProviderKey(deps(), {
      orgId: org.org_id,
      operationalMode: 'production',
    });
    expect(k).toBe(KEY_A_OPENAI);
  });

  it('credential for one provider does not leak to the other provider', async () => {
    const org = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      plaintextKey: KEY_A_ANTHROPIC,
      setByUserId: org.user_id,
    });
    // Anthropic resolver returns the seeded key; OpenAI resolver in production
    // mode (no row for 'openai') must throw.
    const a = await resolveAnthropicProviderKey(deps(), {
      orgId: org.org_id,
      operationalMode: 'production',
    });
    expect(a).toBe(KEY_A_ANTHROPIC);

    let captured: Error | null = null;
    try {
      await resolveOpenAIProviderKey(deps(), {
        orgId: org.org_id,
        operationalMode: 'production',
      });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(MissingProviderKeyError);
    expect((captured as MissingProviderKeyError).provider).toBe('openai');
  });
});
