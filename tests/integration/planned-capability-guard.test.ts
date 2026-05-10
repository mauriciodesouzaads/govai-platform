// PCG.1-4: planned-capability hermetic guard.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadEnv, BootError } from '@govai/config';
import {
  assertCapabilityExecutable,
  CapabilityNotSupportedError,
} from '../../apps/api/src/pipeline/capability-resolution.js';
import { findCapability } from '@govai/core-governance';
import { startStack, stopStack, seedOrg, inject, type Stack } from './helpers/server-fixture.js';

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

describe('planned-capability guard', () => {
  it('PCG.1 — NODE_ENV=test + provider hermético → run executes', async () => {
    const org = await seedOrg(stack);
    const r = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'hello',
    });
    expect(r.statusCode).toBe(200);
  });

  // Batch G turned anthropic.messages.create into status=supported, so the guard
  // no longer applies there. PCG.2 and PCG.3 use `anthropic.messages.tools`,
  // which remains `planned` in BASELINE_REGISTRY (tool-only capability deferred
  // per the Provider Completion Backlog).
  it('PCG.2 — NODE_ENV=development without flag → CapabilityNotSupportedError', () => {
    const cap = findCapability('anthropic.messages.tools');
    expect(cap).toBeDefined();
    expect(() =>
      assertCapabilityExecutable(cap!, {
        ...stack.env,
        NODE_ENV: 'development',
        GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION: false,
      }),
    ).toThrow(CapabilityNotSupportedError);
  });

  it('PCG.3 — non-loopback GOVAI_PROVIDER_BASE_URL → CapabilityNotSupportedError', () => {
    const cap = findCapability('anthropic.messages.tools');
    expect(cap).toBeDefined();
    expect(() =>
      assertCapabilityExecutable(cap!, {
        ...stack.env,
        NODE_ENV: 'test',
        GOVAI_PROVIDER_BASE_URL: 'https://api.anthropic.com',
      }),
    ).toThrow(CapabilityNotSupportedError);
    // Reject DNS-tricks: localhost.attacker.com starts with "localhost" but is not loopback.
    expect(() =>
      assertCapabilityExecutable(cap!, {
        ...stack.env,
        NODE_ENV: 'test',
        GOVAI_PROVIDER_BASE_URL: 'http://localhost.attacker.com/',
      }),
    ).toThrow(CapabilityNotSupportedError);
    // Reject userinfo trick: http://127.0.0.1@evil.com — host portion is evil.com.
    expect(() =>
      assertCapabilityExecutable(cap!, {
        ...stack.env,
        NODE_ENV: 'test',
        GOVAI_PROVIDER_BASE_URL: 'http://127.0.0.1@evil.com/',
      }),
    ).toThrow(CapabilityNotSupportedError);
  });

  it('PCG.4 — NODE_ENV=production + GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION=1 → boot fail', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        GOVAI_KMS_PROVIDER: 'aws',
        GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION: '1',
      }),
    ).toThrow(BootError);
  });
});
