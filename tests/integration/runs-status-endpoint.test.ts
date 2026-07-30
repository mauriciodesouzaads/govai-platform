// EP-P03A-A (F3) — T15: GET /v1/runs/:run_id — tenant-isolated, safe
// projection, correct states/timestamps, retry_safe=false for v1 runs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startStack,
  stopStack,
  seedOrg,
  inject,
  configureProviderError,
  clearProviderErrors,
  setBaselineDlpAction,
  type Stack,
  type SeededOrg,
} from './helpers/server-fixture.js';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

function governedBody(org: SeededOrg, input = 'status endpoint probe') {
  return {
    workspace_id: org.workspace_id,
    capability: 'anthropic.messages.create',
    model: 'claude-fixture-1',
    input,
  };
}

const SENSITIVE_KEYS = [
  'input',
  'output',
  'prompt',
  'metadata',
  'api_key',
  'credential',
  'stack',
  'message',
  'error_message',
  'native_request_hash',
  'native_response_hash',
];

describe('T15 — GET /v1/runs/:run_id', () => {
  it('the owning tenant sees the completed run with the dispatch timeline', async () => {
    const org = await seedOrg(stack);
    const created = await inject(stack, 'POST', '/v1/runs', org.api_key, governedBody(org));
    expect(created.statusCode).toBe(200);
    const runId = (created.body as { run_id: string }).run_id;

    const res = await inject(stack, 'GET', `/v1/runs/${runId}`, org.api_key);
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body['run_id']).toBe(runId);
    expect(body['mode']).toBe('governed');
    expect(body['provider']).toBe('anthropic');
    expect(body['model']).toBe('claude-fixture-1');
    expect(body['status']).toBe('completed');
    expect(body['retry_safe']).toBe(false);
    expect(body['created_at']).toBeTruthy();
    expect(body['started_at']).toBeTruthy();
    expect(body['completed_at']).toBeTruthy();
    expect(body['dispatch_prepared_at']).toBeTruthy();
    expect(body['dispatch_claimed_at']).toBeTruthy();
    expect(body['outcome_unknown_at']).toBeNull();
    expect(body['dispatch_error_class']).toBeNull();
    expect(typeof body['provider_invocation_id']).toBe('string');
    // Safe projection: no payloads, no credentials, no raw internals.
    for (const key of SENSITIVE_KEYS) {
      expect(body, `field "${key}" must not be exposed`).not.toHaveProperty(key);
    }
  });

  it('a failed run reports failed with its invocation', async () => {
    const org = await seedOrg(stack);
    await configureProviderError(stack, { workspaceId: org.workspace_id, status: 500 });
    const created = await inject(stack, 'POST', '/v1/runs', org.api_key, governedBody(org));
    expect(created.statusCode).toBe(502);
    clearProviderErrors();
    const runId = (created.body as { run_id: string }).run_id;
    const res = await inject(stack, 'GET', `/v1/runs/${runId}`, org.api_key);
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body['status']).toBe('failed');
    expect(body['retry_safe']).toBe(false);
  });

  it('a denied run reports denied', async () => {
    const org = await seedOrg(stack);
    await setBaselineDlpAction(stack, org.org_id, 'cpf', 'deny');
    const created = await inject(
      stack,
      'POST',
      '/v1/runs',
      org.api_key,
      governedBody(org, 'cpf 111.444.777-35 embedded'),
    );
    expect(created.statusCode).toBe(403);
    const runId = (created.body as { run_id: string }).run_id;
    const res = await inject(stack, 'GET', `/v1/runs/${runId}`, org.api_key);
    expect(res.statusCode).toBe(200);
    expect((res.body as Record<string, unknown>)['status']).toBe('denied');
  });

  it('another tenant gets 404 for the same run id', async () => {
    const org = await seedOrg(stack);
    const other = await seedOrg(stack);
    const created = await inject(stack, 'POST', '/v1/runs', org.api_key, governedBody(org));
    expect(created.statusCode).toBe(200);
    const runId = (created.body as { run_id: string }).run_id;
    const res = await inject(stack, 'GET', `/v1/runs/${runId}`, other.api_key);
    expect(res.statusCode).toBe(404);
    expect((res.body as Record<string, unknown>)['error']).toBe('run_not_found');
  });

  it('a nonexistent run gets 404; a malformed id gets 400; no auth gets 401', async () => {
    const org = await seedOrg(stack);
    const missing = await inject(stack, 'GET', `/v1/runs/${randomUUID()}`, org.api_key);
    expect(missing.statusCode).toBe(404);
    const malformed = await inject(stack, 'GET', '/v1/runs/not-a-uuid', org.api_key);
    expect(malformed.statusCode).toBe(400);
    const unauthenticated = await inject(stack, 'GET', `/v1/runs/${randomUUID()}`, undefined);
    expect(unauthenticated.statusCode).toBe(401);
  });
});
