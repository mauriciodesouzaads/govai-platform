// CAP.1-3: GET /v1/capabilities resolution + downgrade-only override.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  stopStack,
  seedOrg,
  insertCapabilityOverride,
  inject,
  type Stack,
} from './helpers/server-fixture.js';
import { resolveEffectiveLevel } from '@govai/core-governance';

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

describe('GET /v1/capabilities by-org resolution', () => {
  it('CAP.1 — baseline registry returned for org without overrides', async () => {
    const org = await seedOrg(stack);
    const r = await inject(stack, 'GET', '/v1/capabilities', org.api_key);
    expect(r.statusCode).toBe(200);
    const body = r.body as {
      org_id: string;
      capabilities: Array<{ id: string; status: string; facets: Array<{ override_applied: boolean }> }>;
    };
    expect(body.org_id).toBe(org.org_id);
    expect(body.capabilities.length).toBeGreaterThan(0);
    for (const c of body.capabilities) {
      for (const f of c.facets) {
        expect(f.override_applied).toBe(false);
      }
    }
  });

  it('CAP.2 — override level=0 + status=blocked surfaces effective status AND blocks execution', async () => {
    const org = await seedOrg(stack);
    await insertCapabilityOverride(
      stack,
      org.org_id,
      org.user_id,
      'anthropic.messages.create',
      'pre_dlp',
      0,
      'blocked',
    );
    const r = await inject(stack, 'GET', '/v1/capabilities', org.api_key);
    expect(r.statusCode).toBe(200);
    const body = r.body as {
      capabilities: Array<{
        id: string;
        status: string;
        baseline_status: string;
        facets: Array<{
          id: string;
          level: number;
          status: string;
          baseline_status: string;
          override_applied: boolean;
        }>;
      }>;
    };
    const cap = body.capabilities.find((c) => c.id === 'anthropic.messages.create');
    expect(cap).toBeDefined();
    const facet = cap!.facets.find((f) => f.id === 'pre_dlp');
    expect(facet?.level).toBe(0);
    expect(facet?.status).toBe('blocked');
    // Batch G: anthropic.messages.create baseline_status is now `supported`
    // (its governed-run pipeline is implemented). The org-level override
    // still surfaces effective status=blocked via downgrade.
    expect(facet?.baseline_status).toBe('supported');
    expect(facet?.override_applied).toBe(true);
    // capability-level effective status rolls up to blocked.
    expect(cap!.status).toBe('blocked');
    expect(cap!.baseline_status).toBe('supported');

    // Execution is blocked: POST /v1/runs returns 403 capability_not_supported.
    const run = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'hello',
    });
    expect(run.statusCode).toBe(403);
    const runBody = run.body as { error: string; status: string };
    expect(runBody.error).toBe('capability_not_supported');
    expect(runBody.status).toBe('blocked');
  });

  it('CAP.3 — upgrade attempt rejected (downgrade-only), unit-level guard', () => {
    expect(() => resolveEffectiveLevel(1, { level_override: 3 })).toThrow(/upgrade not allowed/);
  });
});
