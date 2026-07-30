// EP-P03A-A (F3) — T9: provider timeout → honest outcome_unknown over HTTP 202.
//
// This stack runs with GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS=1500 (the schema
// minimum is 1000) so a PARKED upstream deterministically trips the dispatch
// AbortSignal. The park barrier — not a sleep — proves the request reached the
// upstream exactly once; retry_safe=false and zero automatic retries are
// asserted from the upstream's own request record.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  inject,
  clearProviderErrors,
  type Stack,
  type SeededOrg,
} from './helpers/server-fixture.js';
import {
  setParkOverride,
  clearParkOverrides,
  setDestroyOverride,
  clearDestroyOverrides,
} from './fixtures/provider-protocol-server.js';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack({ GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS: 1_500 });
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});
afterEach(() => {
  clearParkOverrides();
  clearDestroyOverrides();
  clearProviderErrors();
});

async function queryAsOrg<T extends Record<string, unknown> = Record<string, unknown>>(
  orgId: string,
  sql: string,
  params: unknown[] = [],
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

async function auditEventTypes(orgId: string, runId: string): Promise<string[]> {
  const rows = await queryAsOrg<{ event_type: string }>(
    orgId,
    'SELECT event_type FROM govai.audit_events WHERE subject_id = $1::uuid ORDER BY sequence_number',
    [runId],
  );
  return rows.map((r) => r.event_type);
}

function governedBody(org: SeededOrg) {
  return {
    workspace_id: org.workspace_id,
    capability: 'anthropic.messages.create',
    model: 'claude-fixture-1',
    input: 'timeout probe input',
  };
}

describe('T9 — dispatch timeout → outcome_unknown (standalone /v1/runs)', () => {
  it('202 + Location + retry_safe=false; run/invocation/audit record the honest unknown; exactly ONE upstream call', async () => {
    const org = await seedOrg(stack);
    stack.provider.clearRecordedRequestHeaders();
    setParkOverride(org.workspace_id); // parked past the 1.5s timeout

    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, governedBody(org));
    expect(res.statusCode).toBe(202);
    const body = res.body as {
      run_id: string;
      status: string;
      retry_safe: boolean;
      error_class: string;
    };
    expect(body.status).toBe('outcome_unknown');
    expect(body.retry_safe).toBe(false);
    expect(body.error_class).toBe('dispatch_outcome_unknown');

    // Location header points at the status endpoint (§23.1). The probe runs
    // under its OWN org/workspace so the per-run upstream count below stays
    // individually attributable (one workspace id ⇔ one run ⇔ one call).
    const probeOrg = await seedOrg(stack);
    setParkOverride(probeOrg.workspace_id);
    const raw = await stack.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: { 'content-type': 'application/json', 'x-govai-api-key': probeOrg.api_key },
      payload: governedBody(probeOrg),
    });
    expect(raw.statusCode).toBe(202);
    expect(raw.headers['location']).toBe(`/v1/runs/${(JSON.parse(raw.body) as { run_id: string }).run_id}`);

    // Run row: honest unknown, never failed, never completed.
    const rows = await queryAsOrg<{
      status: string;
      dispatch_error_class: string | null;
      outcome_unknown_at: Date | null;
      completed_at: Date | null;
      dispatch_token: string | null;
    }>(
      org.org_id,
      `SELECT status, dispatch_error_class, outcome_unknown_at, completed_at, dispatch_token
         FROM govai.runs WHERE id = $1::uuid`,
      [body.run_id],
    );
    expect(rows[0]!.status).toBe('outcome_unknown');
    expect(rows[0]!.dispatch_error_class).toBe('provider_timeout');
    expect(rows[0]!.outcome_unknown_at).not.toBeNull();
    expect(rows[0]!.completed_at).toBeNull();

    // Invocation trace (§22): token-bound, NO invented response hash.
    const inv = await queryAsOrg<{
      dispatch_token: string | null;
      native_response_hash: Buffer | null;
      status_code: number | null;
      error_class: string | null;
      native_request_hash: Buffer;
    }>(
      org.org_id,
      `SELECT dispatch_token, native_response_hash, status_code, error_class, native_request_hash
         FROM govai.provider_invocations WHERE run_id = $1::uuid`,
      [body.run_id],
    );
    expect(inv).toHaveLength(1);
    expect(inv[0]!.dispatch_token).toBe(rows[0]!.dispatch_token);
    expect(inv[0]!.native_response_hash).toBeNull();
    expect(inv[0]!.status_code).toBeNull();
    expect(inv[0]!.error_class).toBe('dispatch_outcome_unknown');
    expect(inv[0]!.native_request_hash.length).toBe(32);

    // Audit: run.outcome_unknown, NOT run.failed. No automatic retry: each
    // parked run's OWN workspace id appears exactly once at the upstream.
    const types = await auditEventTypes(org.org_id, body.run_id);
    expect(types).toContain('run.outcome_unknown');
    expect(types).not.toContain('run.failed');
    expect(types).not.toContain('run.completed');
    const callsFor = (workspaceId: string) =>
      stack.provider.recordedRequestHeaders.filter(
        (h) => h['x-test-workspace-id'] === workspaceId,
      );
    expect(callsFor(org.workspace_id)).toHaveLength(1);
    expect(callsFor(probeOrg.workspace_id)).toHaveLength(1);
  });

  it('GET /v1/runs/:run_id reports the unknown state with retry_safe=false', async () => {
    const org = await seedOrg(stack);
    setParkOverride(org.workspace_id);
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, governedBody(org));
    expect(res.statusCode).toBe(202);
    const runId = (res.body as { run_id: string }).run_id;

    const status = await inject(stack, 'GET', `/v1/runs/${runId}`, org.api_key);
    expect(status.statusCode).toBe(200);
    const s = status.body as Record<string, unknown>;
    expect(s['status']).toBe('outcome_unknown');
    expect(s['retry_safe']).toBe(false);
    expect(s['dispatch_error_class']).toBe('provider_timeout');
    expect(s['outcome_unknown_at']).not.toBeNull();
    expect(s['completed_at']).toBeNull();
  });
});

describe('T9b — post-forward TRANSPORT error → outcome_unknown (§22, real socket destroy)', () => {
  it('upstream destroys the socket after receiving the request → 202, provider_io_unknown, NULL response hash, exactly one upstream call', async () => {
    const org = await seedOrg(stack);
    stack.provider.clearRecordedRequestHeaders();
    setDestroyOverride(org.workspace_id);

    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, governedBody(org));
    expect(res.statusCode).toBe(202);
    const body = res.body as {
      run_id: string;
      status: string;
      retry_safe: boolean;
      error_class: string;
    };
    expect(body.status).toBe('outcome_unknown');
    expect(body.retry_safe).toBe(false);
    expect(body.error_class).toBe('dispatch_outcome_unknown');

    // The forward provably STARTED (the upstream recorded the request) and the
    // failure is a transport error, not the dispatch timeout.
    const rows = await queryAsOrg<{
      status: string;
      dispatch_error_class: string | null;
      outcome_unknown_at: Date | null;
      completed_at: Date | null;
      dispatch_token: string | null;
    }>(
      org.org_id,
      `SELECT status, dispatch_error_class, outcome_unknown_at, completed_at, dispatch_token
         FROM govai.runs WHERE id = $1::uuid`,
      [body.run_id],
    );
    expect(rows[0]!.status).toBe('outcome_unknown');
    expect(rows[0]!.dispatch_error_class).toBe('provider_io_unknown');
    expect(rows[0]!.outcome_unknown_at).not.toBeNull();
    expect(rows[0]!.completed_at).toBeNull();

    // Invocation trace: token-bound, NO invented response hash / status code.
    const inv = await queryAsOrg<{
      dispatch_token: string | null;
      native_response_hash: Buffer | null;
      status_code: number | null;
      error_class: string | null;
    }>(
      org.org_id,
      `SELECT dispatch_token, native_response_hash, status_code, error_class
         FROM govai.provider_invocations WHERE run_id = $1::uuid`,
      [body.run_id],
    );
    expect(inv).toHaveLength(1);
    expect(inv[0]!.dispatch_token).toBe(rows[0]!.dispatch_token);
    expect(inv[0]!.native_response_hash).toBeNull();
    expect(inv[0]!.status_code).toBeNull();
    expect(inv[0]!.error_class).toBe('dispatch_outcome_unknown');

    // Honest unknown, zero automatic retries.
    const types = await auditEventTypes(org.org_id, body.run_id);
    expect(types).toContain('run.outcome_unknown');
    expect(types).not.toContain('run.failed');
    expect(types).not.toContain('run.completed');
    const calls = stack.provider.recordedRequestHeaders.filter(
      (h) => h['x-test-workspace-id'] === org.workspace_id,
    );
    expect(calls).toHaveLength(1);
  });
});

describe('T9 (workroom) — unknown outcome on a Workroom-owned governed run', () => {
  it('201 with status=outcome_unknown and EXACTLY one run_event turn', async () => {
    const org = await seedOrg(stack);
    const dev = await addApiKey(stack, org.org_id, org.user_id, ['developer']);
    const w = await inject(stack, 'POST', '/v1/workrooms', dev.api_key, {
      workspace_id: org.workspace_id,
      name: `room-${randomUUID().slice(0, 8)}`,
      governance_mode: 'governance_active',
    });
    expect(w.statusCode).toBe(201);
    const workroomId = ((w.body as Record<string, unknown>)['workroom'] as Record<string, unknown>)[
      'id'
    ] as string;

    setParkOverride(org.workspace_id);
    const r = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/runs`, dev.api_key, {
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'workroom timeout probe',
    });
    expect(r.statusCode).toBe(201);
    const body = r.body as Record<string, unknown>;
    expect(body['status']).toBe('outcome_unknown');
    expect(body['retry_safe']).toBe(false);
    expect(typeof body['workroom_turn_id']).toBe('string');

    const turns = await queryAsOrg<{ n: string }>(
      org.org_id,
      "SELECT COUNT(*) AS n FROM govai.workroom_turns WHERE kind = 'run_event' AND payload_ref = $1::uuid",
      [body['run_id'] as string],
    );
    expect(Number(turns[0]!.n)).toBe(1);
  });
});
