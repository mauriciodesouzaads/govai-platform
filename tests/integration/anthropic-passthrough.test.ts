// Batch A integration: /passthrough/anthropic/* end-to-end against the hermetic
// provider-protocol-server fixture. Covers:
//   - /v1/messages non-stream → 200 + audit `passthrough.invoked v3` with both
//     `capability_level` (operational=passthrough_audited) and
//     `capability_canonical_level` (registry=policy_governed) — Decisão 4.
//   - /v1/messages/count_tokens → both levels passthrough_audited.
//   - hard_denied beta header → 403 + `passthrough.beta_denied`.
//   - tool classifier blocks computer_use tool → 403 + `tool.validation_blocked`
//     with reason enum `capability_blocked_via_token`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startStack, stopStack, seedOrg, inject, type Stack } from './helpers/server-fixture.js';

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
  });

  it('tool with type:null → 403 + tool.validation_blocked + reason=typed_unknown', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/passthrough/anthropic/v1/messages', org.api_key, {
      model: 'claude-fixture-1',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: null }],
    });
    expect(res.statusCode).toBe(403);
    const blocked = auditEvents.filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'tool.validation_blocked',
    );
    expect(blocked.length).toBe(1);
    expect(blocked[0]!['reason']).toBe('typed_unknown');
    expect(blocked[0]!['classification']).toBe('anthropic_typed_unknown');
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
