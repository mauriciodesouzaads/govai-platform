// Batch A integration: /passthrough/anthropic/* end-to-end against the hermetic
// provider-protocol-server fixture. Covers:
//   - /v1/messages non-stream → 200 + audit `passthrough.invoked v3` with both
//     `capability_level` (operational=passthrough_audited) and
//     `capability_canonical_level` (registry=policy_governed) — Decisão 4.
//   - /v1/messages/count_tokens → both levels passthrough_audited.
//   - hard_denied beta header → 403 + `passthrough.beta_denied` + blocked v4.
//   - tool classifier blocks computer_use tool → 403 + `tool.validation_blocked`
//     with reason enum `capability_blocked_via_token` + blocked v4.
//   - Foundation V1 M1 (OD-1=A): unknown betas + non-computer tools FORWARD;
//     credential-unresolvable → 502; auth before registry disclosure; 405.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  stopStack,
  seedOrg,
  setOrgOperationalMode,
  inject,
  type Stack,
} from './helpers/server-fixture.js';

let stack: Stack;
const auditEvents: unknown[] = [];

beforeAll(async () => {
  stack = await startStack();
  // Hijack the logger to capture audit events emitted by the passthrough route.
  // The passthrough route logs each event via app.log.info({ audit_event: ... }).
  const orig = stack.app.log.info.bind(stack.app.log);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stack.app.log.info = ((arg: any, msg?: string) => {
    if (arg && typeof arg === 'object' && arg.audit_event) {
      auditEvents.push(arg.audit_event);
    }
    return orig(arg, msg);
  }) as typeof stack.app.log.info;
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

describe('Batch A — /passthrough/anthropic/*', () => {
  it('POST /v1/messages → 200 + audit with operational≠canonical levels (Decisão 4)', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/passthrough/anthropic/v1/messages', org.api_key, {
      model: 'claude-fixture-1',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(res.statusCode).toBe(200);

    const invokedEvents = auditEvents.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'passthrough.invoked',
    );
    expect(invokedEvents.length).toBe(1);
    const ev = invokedEvents[0]!;
    expect(ev['capability_id']).toBe('anthropic.messages.create');
    expect(ev['capability_level']).toBe('passthrough_audited');
    expect(ev['capability_canonical_level']).toBe('policy_governed');
    expect(ev['body_forward_mode']).toBe('raw');
    expect(typeof ev['native_response_hash']).toBe('string');
  });

  it('POST /v1/messages/count_tokens → both levels = passthrough_audited', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(
      stack,
      'POST',
      '/passthrough/anthropic/v1/messages/count_tokens',
      org.api_key,
      {
        model: 'claude-fixture-1',
        messages: [{ role: 'user', content: 'short' }],
      },
    );
    // Provider-protocol-server doesn't implement count_tokens — expect upstream 404.
    // What matters here is the audit event distinguishes capability correctly.
    expect([200, 404]).toContain(res.statusCode);
    const invokedEvents = auditEvents.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'passthrough.invoked',
    );
    expect(invokedEvents.length).toBe(1);
    const ev = invokedEvents[0]!;
    expect(ev['capability_id']).toBe('anthropic.messages_meta');
    expect(ev['capability_level']).toBe('passthrough_audited');
    expect(ev['capability_canonical_level']).toBe('passthrough_audited');
  });

  it('anthropic-beta hard_denied (computer-use-2024-10-22) → 403 + passthrough.beta_denied', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/passthrough/anthropic/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
        'anthropic-beta': 'computer-use-2024-10-22',
      },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'x' }],
      }),
    });
    expect(res.statusCode).toBe(403);
    const denied = auditEvents.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'passthrough.beta_denied',
    );
    expect(denied.length).toBe(1);
    expect(denied[0]!['reason_code']).toBe('hard_denied');
    expect(denied[0]!['policy_at_resolution']).toBe('hard_denied');
    // M1 FB-4: the Native deny is durably evidenced by a blocked v4 (provider not called).
    const invokedEvents = auditEvents.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'passthrough.invoked',
    );
    expect(invokedEvents.length).toBe(1);
    expect(invokedEvents[0]!['enforcement_decision']).toBe('blocked');
    expect(invokedEvents[0]!['body_forward_mode']).toBe('blocked');
    expect(invokedEvents[0]!['status_code']).toBe(403);
    expect(invokedEvents[0]!['native_response_hash']).toBeUndefined();
  });

  it('M1 BETA-01: unknown anthropic-beta token (claude-code-20250219) → FORWARDED (200), v4 with hashed marker, no fabricated source', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/passthrough/anthropic/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
        'anthropic-beta': 'claude-code-20250219, prompt-caching-2024-07-31',
      },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'x' }],
      }),
    });
    expect(res.statusCode).toBe(200);
    const invokedEvents = auditEvents.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'passthrough.invoked',
    );
    expect(invokedEvents.length).toBe(1);
    const ev = invokedEvents[0]!;
    expect(ev['enforcement_decision']).toBe('observe');
    expect(ev['beta_allowlist_sources']).toEqual([]);
    const reasons = ev['risk_escalation_reasons'] as string[];
    expect(reasons.length).toBe(2);
    expect(reasons[0]).toMatch(/^beta:unknown_token:sha256:[0-9a-f]{64}$/);
    expect(reasons[1]).toMatch(/^beta:verification_required:sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(ev)).not.toContain('claude-code-20250219');
  });

  it('tool with computer_<8d> → 403 + tool.validation_blocked + reason=capability_blocked_via_token', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/passthrough/anthropic/v1/messages', org.api_key, {
      model: 'claude-fixture-1',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'computer_20251124', name: 'puter' }],
    });
    expect(res.statusCode).toBe(403);
    const blocked = auditEvents.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'tool.validation_blocked',
    );
    expect(blocked.length).toBe(1);
    expect(blocked[0]!['reason']).toBe('capability_blocked_via_token');
    expect(blocked[0]!['classification']).toBe('anthropic_provider_hosted_computer_use');
    // M1 FB-4: durable blocked v4 with the classification + taxonomy v3.
    const invokedEvents = auditEvents.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'passthrough.invoked',
    );
    expect(invokedEvents.length).toBe(1);
    expect(invokedEvents[0]!['enforcement_decision']).toBe('blocked');
    expect(invokedEvents[0]!['tools_taxonomy_version']).toBe(
      'anthropic.tools_taxonomy:schema_version=3:m1_noncomputer_forward_computer_use_floor',
    );
  });

  it('M1 FB-2: tools with type:null / custom / code_execution / web_fetch → FORWARDED (200), classified, no stale 403', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/passthrough/anthropic/v1/messages', org.api_key, {
      model: 'claude-fixture-1',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        { type: null },
        { type: 'custom', name: 'lookup', input_schema: { type: 'object' } },
        { type: 'code_execution_20250522', name: 'code_execution' },
        { type: 'web_fetch_20250910', name: 'web_fetch' },
      ],
    });
    expect(res.statusCode).toBe(200);
    const blocked = auditEvents.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'tool.validation_blocked',
    );
    expect(blocked.length).toBe(0);
    const invokedEvents = auditEvents.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'passthrough.invoked',
    );
    expect(invokedEvents.length).toBe(1);
    const cls = invokedEvents[0]!['detected_tool_classifications'] as Array<Record<string, unknown>>;
    expect(cls.map((c) => c['classification'])).toEqual([
      'anthropic_typed_unknown',
      'client_defined',
      'anthropic_provider_hosted_code_execution',
      'anthropic_typed_unknown',
    ]);
    expect(cls.every((c) => c['decision'] === 'allowed')).toBe(true);
    expect(invokedEvents[0]!['body_forward_mode']).toBe('raw');
  });

  it('M1 CRED-01: production org WITHOUT a tenant credential → 502 provider_credential_unresolvable (stable, no secret, no 500)', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    await setOrgOperationalMode(stack, org.org_id, 'production');
    const res = await inject(stack, 'POST', '/passthrough/anthropic/v1/messages', org.api_key, {
      model: 'claude-fixture-1',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({
      error: 'provider_credential_unresolvable',
      provider: 'anthropic',
      reason: 'no_tenant_credential_in_production_mode',
    });
    // zero provider calls → no forwarded passthrough.invoked
    const invokedEvents = auditEvents.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'passthrough.invoked',
    );
    expect(invokedEvents.length).toBe(0);
  });

  it('M1 ROUTE-01/02/03: auth before registry disclosure; authenticated unknown path → 404; method mismatch → 405 (never 500)', async () => {
    const org = await seedOrg(stack);
    // unauthenticated + unknown path → 401 (no disclosure)
    const r1 = await stack.app.inject({
      method: 'POST',
      url: '/passthrough/anthropic/v1/messages/batches',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(r1.statusCode).toBe(401);
    expect(r1.json().error).toBe('auth_error');
    // authenticated + unknown path → 404 capability_not_registered
    const r2 = await inject(stack, 'POST', '/passthrough/anthropic/v1/messages/batches', org.api_key, {});
    expect(r2.statusCode).toBe(404);
    expect((r2.body as { error: string }).error).toBe('capability_not_registered');
    // known path + unsupported method → 405 + Allow
    const r3 = await stack.app.inject({
      method: 'GET',
      url: '/passthrough/anthropic/v1/messages',
      headers: { 'x-govai-api-key': org.api_key },
    });
    expect(r3.statusCode).toBe(405);
    expect(r3.headers['allow']).toBe('POST');
    expect(r3.json().error).toBe('method_not_allowed');
  });

  it('POST /v1/messages with stream:true → 200 + Content-Type text/event-stream + is_stream audit (regression for #38)', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    // Stream requests go through the hijack/writeHead path. Pre-#38 the route
    // called reply.header() before reply.hijack() without ever flushing headers
    // to reply.raw, so the client received Node's defaults and the upstream
    // Content-Type was dropped. PR3.1j fixed this by mirroring the governed
    // pattern (reply.hijack() + reply.raw.writeHead(status, headers)).
    const res = await stack.app.inject({
      method: 'POST',
      url: '/passthrough/anthropic/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.statusCode).toBe(200);
    const contentType = (res.headers['content-type'] as string | undefined) ?? '';
    expect(contentType.toLowerCase()).toContain('text/event-stream');
    expect(res.body).toMatch(/data:\s*\{/);

    const invokedEvents = auditEvents.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'passthrough.invoked',
    );
    expect(invokedEvents.length).toBe(1);
    const ev = invokedEvents[0]!;
    expect(ev['capability_id']).toBe('anthropic.messages.stream');
    expect(ev['is_stream']).toBe(true);
    expect(ev['body_forward_mode']).toBe('raw');
    expect(ev['enforcement_decision']).toBe('observe');
    expect(typeof ev['stream_final_hash']).toBe('string');
  });

  it('files-api-2025-04-14 → allow + invoked event sources global_allowlist', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    // /v1/files isn't implemented by the fixture either — expect upstream 404 from
    // the fixture but capture audit event nonetheless. The point is: the beta gate
    // says ALLOW for `files-api-2025-04-14` and we observe it in `beta_allowlist_sources`.
    await stack.app.inject({
      method: 'GET',
      url: '/passthrough/anthropic/v1/files',
      headers: {
        'x-govai-api-key': org.api_key,
        'anthropic-beta': 'files-api-2025-04-14',
      },
    });
    const invokedEvents = auditEvents.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'passthrough.invoked',
    );
    expect(invokedEvents.length).toBe(1);
    const sources = invokedEvents[0]!['beta_allowlist_sources'] as Array<Record<string, unknown>>;
    expect(sources.length).toBe(1);
    expect(sources[0]!['beta_token']).toBe('files-api-2025-04-14');
    expect(sources[0]!['source']).toBe('global_allowlist');
  });
});
