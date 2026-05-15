// /v1/runs passthrough execution mode (issue #54) — prerequisite for Workroom
// Phase 3. Proves: governed behavior is unchanged when `mode` is omitted or
// 'governed'; `mode='passthrough'` creates a real `mode='passthrough'` run that
// executes a real provider forward and emits a real audit event; unsupported
// modes are rejected. No live providers — hermetic stack only.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sha256 } from '@govai/core-audit';
import {
  startStack,
  stopStack,
  seedOrg,
  inject,
  configureProviderError,
  clearProviderErrors,
  type Stack,
} from './helpers/server-fixture.js';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

async function queryAsOrg<T = Record<string, unknown>>(
  orgId: string,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r.rows as T[];
  } finally {
    c.release();
  }
}

describe('runs-passthrough-mode / governed compatibility', () => {
  it('omitted mode behaves like governed and persists mode=governed', async () => {
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'hello governed default',
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body['status']).toBe('completed');
    // Governed response shape is unchanged — policy_decision still present.
    expect((body['policy_decision'] as Record<string, unknown>)['kind']).toBe('allow');
    const rows = await queryAsOrg<{ mode: string }>(
      org.org_id,
      'SELECT mode FROM govai.runs WHERE id = $1::uuid',
      [body['run_id'] as string],
    );
    expect(rows[0]!.mode).toBe('governed');
  });

  it("explicit mode='governed' behaves like omitted and persists mode=governed", async () => {
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'hello explicit governed',
      mode: 'governed',
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body['status']).toBe('completed');
    expect((body['policy_decision'] as Record<string, unknown>)['kind']).toBe('allow');
    const rows = await queryAsOrg<{ mode: string }>(
      org.org_id,
      'SELECT mode FROM govai.runs WHERE id = $1::uuid',
      [body['run_id'] as string],
    );
    expect(rows[0]!.mode).toBe('governed');
  });
});

describe('runs-passthrough-mode / passthrough execution', () => {
  it("mode='passthrough' (anthropic) creates a real passthrough run and executes", async () => {
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'hello passthrough run',
    mode: 'passthrough',
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body['mode']).toBe('passthrough');
    expect(body['status']).toBe('completed');
    expect(typeof body['run_id']).toBe('string');
    expect(typeof body['audit_event_id']).toBe('string');
    expect(typeof body['provider_invocation_id']).toBe('string');
    expect(typeof body['native_request_hash']).toBe('string');
    expect(body['output']).toBeDefined();
    // No governed enforcement field on a passthrough run.
    expect(body['policy_decision']).toBeUndefined();
    // No provider credential leaked into the response.
    expect(res.rawBody).not.toContain('x-api-key');
    expect(res.rawBody).not.toContain('authorization');

    const runRows = await queryAsOrg<{ mode: string; status: string; provider: string }>(
      org.org_id,
      'SELECT mode, status, provider FROM govai.runs WHERE id = $1::uuid',
      [body['run_id'] as string],
    );
    expect(runRows[0]!.mode).toBe('passthrough');
    expect(runRows[0]!.status).toBe('completed');
    expect(runRows[0]!.provider).toBe('anthropic');

    // Real provider_invocations row anchored to the run.
    const invRows = await queryAsOrg<{ status_code: number }>(
      org.org_id,
      'SELECT status_code FROM govai.provider_invocations WHERE id = $1::uuid AND run_id = $2::uuid',
      [body['provider_invocation_id'] as string, body['run_id'] as string],
    );
    expect(invRows.length).toBe(1);
    expect(invRows[0]!.status_code).toBe(200);

    // Real audit event on the existing `run` chain — no new chain.
    const auditRows = await queryAsOrg<{
      event_type: string;
      chain_id: string;
      redaction_metadata: { run_mode?: string; enforcement?: string };
    }>(
      org.org_id,
      'SELECT event_type, chain_id, redaction_metadata FROM govai.audit_events WHERE id = $1::uuid',
      [body['audit_event_id'] as string],
    );
    expect(auditRows[0]!.event_type).toBe('run.completed');
    expect(auditRows[0]!.chain_id).toBe(`${org.org_id}:run`);
    expect(auditRows[0]!.redaction_metadata.run_mode).toBe('passthrough');
    expect(auditRows[0]!.redaction_metadata.enforcement).toBe('observe');
  });

  it("mode='passthrough' (openai) creates a real passthrough run and executes", async () => {
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'openai.responses.create',
      model: 'gpt-fixture-1',
      input: 'hello openai passthrough',
      mode: 'passthrough',
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body['mode']).toBe('passthrough');
    expect(body['status']).toBe('completed');
    const runRows = await queryAsOrg<{ mode: string; provider: string }>(
      org.org_id,
      'SELECT mode, provider FROM govai.runs WHERE id = $1::uuid',
      [body['run_id'] as string],
    );
    expect(runRows[0]!.mode).toBe('passthrough');
    expect(runRows[0]!.provider).toBe('openai');
  });

  it("mode='passthrough' provider non-2xx → run failed, 502, run row persists", async () => {
    const org = await seedOrg(stack);
    const failWorkspace = randomUUID();
    configureProviderError(stack, { workspaceId: failWorkspace, status: 500 });
    try {
      const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
        workspace_id: failWorkspace,
        capability: 'anthropic.messages.create',
        model: 'claude-fixture-1',
        input: 'this run will fail upstream',
        mode: 'passthrough',
      });
      expect(res.statusCode).toBe(502);
      const body = res.body as Record<string, unknown>;
      expect(body['mode']).toBe('passthrough');
      expect(body['status']).toBe('failed');
      // The provider call WAS attempted, so the run row persists.
      const runRows = await queryAsOrg<{ mode: string; status: string }>(
        org.org_id,
        'SELECT mode, status FROM govai.runs WHERE id = $1::uuid',
        [body['run_id'] as string],
      );
      expect(runRows[0]!.mode).toBe('passthrough');
      expect(runRows[0]!.status).toBe('failed');
    } finally {
      clearProviderErrors();
    }
  });

  it("mode='passthrough' does not run governed policy enforcement", async () => {
    // Input that the governed path treats as a policy 'mutate' (DLP). In
    // passthrough mode the run is observe-only: it completes without a
    // policy_decision in the response.
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'meu CPF é 123.456.789-09',
      mode: 'passthrough',
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body['mode']).toBe('passthrough');
    expect(body['status']).toBe('completed');
    expect(body['policy_decision']).toBeUndefined();
  });
});

describe('runs-passthrough-mode / unsupported modes', () => {
  it("mode='shadow' → 400 run_mode_not_supported", async () => {
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'shadow mode attempt',
      mode: 'shadow',
    });
    expect(res.statusCode).toBe(400);
    expect((res.body as { error?: string }).error).toBe('run_mode_not_supported');
  });

  it('invalid mode value → 400 invalid_request', async () => {
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'bogus mode attempt',
      mode: 'turbo',
    });
    expect(res.statusCode).toBe(400);
    expect((res.body as { error?: string }).error).toBe('invalid_request');
  });

  it("mode='passthrough' unknown capability → 404 capability_not_registered", async () => {
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'cohere.chat.create',
      model: 'whatever',
      input: 'unknown capability',
      mode: 'passthrough',
    });
    expect(res.statusCode).toBe(404);
    expect((res.body as { error?: string }).error).toBe('capability_not_registered');
  });

  it("mode='passthrough' unauthenticated → 401", async () => {
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/v1/runs', undefined, {
      workspace_id: org.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'no auth passthrough',
      mode: 'passthrough',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('runs-passthrough-mode / network failure hash consistency', () => {
  it("mode='passthrough' network/fetch failure persists the real request hash everywhere", async () => {
    // A fresh stack pointed at a closed loopback port: forwardRaw's fetch
    // throws a connection error (a true network/fetch failure, not a provider
    // HTTP non-2xx response).
    const failStack = await startStack({
      GOVAI_PROVIDER_BASE_URL: 'http://127.0.0.1:1' as unknown as string,
    });
    try {
      const org = await seedOrg(failStack);
      const input = 'this passthrough run reaches an unreachable upstream';
      // The Anthropic provider-native body the orchestrator forwards for this
      // capability — its sha256 is the expected native_request_hash.
      const expectedBody = JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 1024,
        messages: [{ role: 'user', content: input }],
      });
      const expectedHash = Buffer.from(sha256(Buffer.from(expectedBody, 'utf8'))).toString('hex');

      const res = await inject(failStack, 'POST', '/v1/runs', org.api_key, {
        workspace_id: org.workspace_id,
        capability: 'anthropic.messages.create',
        model: 'claude-fixture-1',
        input,
        mode: 'passthrough',
      });
      expect(res.statusCode).toBe(502);
      const body = res.body as Record<string, unknown>;
      expect(body['mode']).toBe('passthrough');
      expect(body['status']).toBe('failed');
      // API response carries the real request hash, not a placeholder.
      expect(body['native_request_hash']).toBe(expectedHash);

      const runId = body['run_id'] as string;
      const provInvId = body['provider_invocation_id'] as string;
      const auditEventId = body['audit_event_id'] as string;

      const c = await failStack.db.appPool.connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT set_config('app.org_id', $1, true)", [org.org_id]);

        // The provider call was attempted → the run row persists, failed.
        const runRows = await c.query<{ mode: string; status: string }>(
          'SELECT mode, status FROM govai.runs WHERE id = $1::uuid',
          [runId],
        );
        expect(runRows.rows[0]!.mode).toBe('passthrough');
        expect(runRows.rows[0]!.status).toBe('failed');

        // provider_invocations.native_request_hash is the real sha256 — never
        // the old '\x00' placeholder.
        const invRows = await c.query<{ native_request_hash: Buffer; error_class: string }>(
          `SELECT native_request_hash, error_class FROM govai.provider_invocations
            WHERE id = $1::uuid AND run_id = $2::uuid`,
          [provInvId, runId],
        );
        expect(invRows.rows.length).toBe(1);
        expect(invRows.rows[0]!.error_class).toBe('network_error');
        const dbHashHex = invRows.rows[0]!.native_request_hash.toString('hex');
        expect(dbHashHex).toBe(expectedHash);
        expect(dbHashHex.length).toBe(64);
        expect(dbHashHex).not.toBe('00');

        // run.failed audit metadata carries the same real hash.
        const auditRows = await c.query<{
          event_type: string;
          redaction_metadata: { native_request_hash?: string };
        }>(
          'SELECT event_type, redaction_metadata FROM govai.audit_events WHERE id = $1::uuid',
          [auditEventId],
        );
        expect(auditRows.rows[0]!.event_type).toBe('run.failed');
        expect(auditRows.rows[0]!.redaction_metadata.native_request_hash).toBe(expectedHash);

        await c.query('COMMIT');
      } finally {
        c.release();
      }
    } finally {
      await stopStack(failStack);
    }
  }, 240_000);
});
