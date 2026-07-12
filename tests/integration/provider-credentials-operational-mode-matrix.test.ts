// Operational-mode fallback matrix for provider credential resolution —
// PR3.1a Checkpoint 2 (issue #13). This is the EXECUTABLE SPEC for the
// fallback rules. Any change to the resolver must keep this matrix green.
//
// Matrix (tenant credential always wins; rows below are the no-tenant case):
//
//   operational_mode | hermetic? | env present | tenant DB | resolver returns
//   -----------------+-----------+-------------+-----------+----------------------------
//   production       |   false   |   absent    |  absent   | THROW MissingProviderKey
//   production       |   false   |   present   |  absent   | THROW (no env fallback)
//   production       |   false   |   absent    |  present  | tenant plaintext
//   production       |   false   |   present   |  present  | tenant plaintext (env ignored)
//   pilot            |   false   |   absent    |  absent   | THROW
//   pilot            |   false   |   present   |  absent   | THROW (no env fallback)
//   pilot            |   false   |   present   |  present  | tenant plaintext
//   dev              |   false   |   absent    |  absent   | THROW
//   dev              |   false   |   present   |  absent   | env value
//   dev              |   false   |   absent    |  present  | tenant plaintext
//   dev              |   false   |   present   |  present  | tenant plaintext (env ignored)
//   test (loopback)  |   true    |   absent    |  absent   | hermetic placeholder
//   test (loopback)  |   true    |   present   |  absent   | env value
//   test (loopback)  |   true    |   absent    |  present  | tenant plaintext
//   test (loopback)  |   true    |   present   |  present  | tenant plaintext
//
// isHermetic NEGATIVE coverage:
//   - production + loopback baseUrl is NOT hermetic.
//   - pilot + loopback baseUrl is NOT hermetic.
//   - dev + loopback baseUrl is NOT hermetic.
//   - only NODE_ENV='test' + loopback baseUrl is hermetic.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  stopStack,
  seedOrg,
  seedProviderCredential,
  type Stack,
} from './helpers/server-fixture.js';
import {
  resolveAnthropicProviderKey,
  MissingProviderKeyError,
} from '../../apps/api/src/pipeline/provider-credentials.js';
import type { GovAIEnv } from '@govai/config';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

const TENANT_KEY = 'sk-ant-tenant-matrix-test-PLAINTEXT';
const ENV_KEY = 'sk-ant-env-matrix-test-EEEE';

function depsWithEnv(envOverrides: Partial<GovAIEnv>) {
  return {
    env: { ...stack.env, ...envOverrides } as GovAIEnv,
    pool: stack.db.appPool,
    kms: stack.app.govai.kms,
  };
}

async function expectThrow(p: Promise<unknown>): Promise<MissingProviderKeyError> {
  let captured: Error | null = null;
  try {
    await p;
  } catch (err) {
    captured = err as Error;
  }
  expect(captured).toBeInstanceOf(MissingProviderKeyError);
  return captured as MissingProviderKeyError;
}

describe('provider-credentials / operational-mode matrix', () => {
  // ---- production mode ----------------------------------------------------
  it('production + no env + no tenant => THROW', async () => {
    const org = await seedOrg(stack);
    const e = await expectThrow(
      resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: undefined }), {
        orgId: org.org_id,
        operationalMode: 'production',
      }),
    );
    expect(e.reason).toBe('no_tenant_credential_in_production_mode');
  });

  it('production + env present + no tenant => THROW (env is NOT a prod fallback)', async () => {
    const org = await seedOrg(stack);
    const e = await expectThrow(
      resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: ENV_KEY }), {
        orgId: org.org_id,
        operationalMode: 'production',
      }),
    );
    expect(e.reason).toBe('no_tenant_credential_in_production_mode');
  });

  it('production + no env + tenant present => tenant plaintext', async () => {
    const org = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      plaintextKey: TENANT_KEY,
      setByUserId: org.user_id,
    });
    const k = await resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: undefined }), {
      orgId: org.org_id,
      operationalMode: 'production',
    });
    expect(k.apiKey).toBe(TENANT_KEY);
    expect(k.source).toBe('tenant_provider_credential');
  });

  it('production + env present + tenant present => tenant plaintext (env ignored)', async () => {
    const org = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      plaintextKey: TENANT_KEY,
      setByUserId: org.user_id,
    });
    const k = await resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: ENV_KEY }), {
      orgId: org.org_id,
      operationalMode: 'production',
    });
    expect(k.apiKey).toBe(TENANT_KEY);
    expect(k.source).toBe('tenant_provider_credential');
    expect(k.apiKey).not.toBe(ENV_KEY);
  });

  // ---- pilot mode ---------------------------------------------------------
  it('pilot + no env + no tenant => THROW', async () => {
    const org = await seedOrg(stack);
    const e = await expectThrow(
      resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: undefined }), {
        orgId: org.org_id,
        operationalMode: 'pilot',
      }),
    );
    expect(e.reason).toBe('no_tenant_credential_in_pilot_mode');
  });

  it('pilot + env present + no tenant => THROW (env is NOT a pilot fallback)', async () => {
    const org = await seedOrg(stack);
    const e = await expectThrow(
      resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: ENV_KEY }), {
        orgId: org.org_id,
        operationalMode: 'pilot',
      }),
    );
    expect(e.reason).toBe('no_tenant_credential_in_pilot_mode');
  });

  it('pilot + tenant present => tenant plaintext', async () => {
    const org = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      plaintextKey: TENANT_KEY,
      setByUserId: org.user_id,
    });
    const k = await resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: undefined }), {
      orgId: org.org_id,
      operationalMode: 'pilot',
    });
    expect(k.apiKey).toBe(TENANT_KEY);
    expect(k.source).toBe('tenant_provider_credential');
  });

  // ---- dev mode -----------------------------------------------------------
  it('dev + no env + no tenant => THROW', async () => {
    const org = await seedOrg(stack);
    const e = await expectThrow(
      resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: undefined }), {
        orgId: org.org_id,
        operationalMode: 'dev',
      }),
    );
    expect(e.reason).toBe('no_tenant_credential_no_env_in_dev_mode');
  });

  it('dev + env + no tenant => env value', async () => {
    const org = await seedOrg(stack);
    const k = await resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: ENV_KEY }), {
      orgId: org.org_id,
      operationalMode: 'dev',
    });
    expect(k.apiKey).toBe(ENV_KEY);
    expect(k.source).toBe('platform_env');
  });

  it('dev + env + tenant present => tenant plaintext (env ignored)', async () => {
    const org = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      plaintextKey: TENANT_KEY,
      setByUserId: org.user_id,
    });
    const k = await resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: ENV_KEY }), {
      orgId: org.org_id,
      operationalMode: 'dev',
    });
    expect(k.apiKey).toBe(TENANT_KEY);
    expect(k.source).toBe('tenant_provider_credential');
  });

  // ---- test mode (loopback hermetic) -------------------------------------
  it('test + loopback + no env + no tenant => hermetic placeholder', async () => {
    const org = await seedOrg(stack);
    // stack env already has loopback baseUrl + NODE_ENV=test; no env key.
    const k = await resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: undefined }), {
      orgId: org.org_id,
      operationalMode: 'test',
    });
    expect(k.apiKey).toBe('sk-ant-test-hermetic');
    expect(k.source).toBe('hermetic_test_placeholder');
  });

  it('test + loopback + env + no tenant => env value', async () => {
    const org = await seedOrg(stack);
    const k = await resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: ENV_KEY }), {
      orgId: org.org_id,
      operationalMode: 'test',
    });
    expect(k.apiKey).toBe(ENV_KEY);
    expect(k.source).toBe('platform_env');
  });

  it('test + loopback + tenant present => tenant plaintext', async () => {
    const org = await seedOrg(stack);
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      plaintextKey: TENANT_KEY,
      setByUserId: org.user_id,
    });
    const k = await resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: undefined }), {
      orgId: org.org_id,
      operationalMode: 'test',
    });
    expect(k.apiKey).toBe(TENANT_KEY);
    expect(k.source).toBe('tenant_provider_credential');
  });

  // ---- test mode (non-loopback) ------------------------------------------
  it('test + non-loopback + no env + no tenant => THROW (no hermetic outside loopback)', async () => {
    const org = await seedOrg(stack);
    const e = await expectThrow(
      resolveAnthropicProviderKey(
        depsWithEnv({
          ANTHROPIC_API_KEY: undefined,
          GOVAI_PROVIDER_BASE_URL: 'https://api.anthropic.com',
        }),
        { orgId: org.org_id, operationalMode: 'test' },
      ),
    );
    expect(e.reason).toBe('no_tenant_credential_no_env_test_non_loopback');
  });

  it('test + non-loopback + env + no tenant => env value', async () => {
    const org = await seedOrg(stack);
    const k = await resolveAnthropicProviderKey(
      depsWithEnv({
        ANTHROPIC_API_KEY: ENV_KEY,
        GOVAI_PROVIDER_BASE_URL: 'https://api.anthropic.com',
      }),
      { orgId: org.org_id, operationalMode: 'test' },
    );
    expect(k.apiKey).toBe(ENV_KEY);
    expect(k.source).toBe('platform_env');
  });

  // ---- isHermetic NEGATIVE coverage --------------------------------------
  it('production + loopback baseUrl is NOT hermetic — fail closed even with loopback', async () => {
    const org = await seedOrg(stack);
    // stack baseUrl is loopback by default. operationalMode=production must reject.
    const e = await expectThrow(
      resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: undefined }), {
        orgId: org.org_id,
        operationalMode: 'production',
      }),
    );
    expect(e.reason).toBe('no_tenant_credential_in_production_mode');
  });

  it('pilot + loopback baseUrl is NOT hermetic — fail closed even with loopback', async () => {
    const org = await seedOrg(stack);
    const e = await expectThrow(
      resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: undefined }), {
        orgId: org.org_id,
        operationalMode: 'pilot',
      }),
    );
    expect(e.reason).toBe('no_tenant_credential_in_pilot_mode');
  });

  it('dev + loopback baseUrl is NOT hermetic — needs explicit env in dev', async () => {
    const org = await seedOrg(stack);
    const e = await expectThrow(
      resolveAnthropicProviderKey(depsWithEnv({ ANTHROPIC_API_KEY: undefined }), {
        orgId: org.org_id,
        operationalMode: 'dev',
      }),
    );
    expect(e.reason).toBe('no_tenant_credential_no_env_in_dev_mode');
  });

  it('test + non-loopback short-circuits hermetic (fails closed without env)', async () => {
    const org = await seedOrg(stack);
    const e = await expectThrow(
      resolveAnthropicProviderKey(
        depsWithEnv({
          ANTHROPIC_API_KEY: undefined,
          GOVAI_PROVIDER_BASE_URL: 'https://example.com',
        }),
        { orgId: org.org_id, operationalMode: 'test' },
      ),
    );
    expect(e.reason).toBe('no_tenant_credential_no_env_test_non_loopback');
  });
});
