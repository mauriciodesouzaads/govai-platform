// /governed/openai/* — governed-native OpenAI surface.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startStack, stopStack, seedOrg, setOrgOperationalMode, type Stack } from './helpers/server-fixture.js';

let stack: Stack;
const auditEvents: unknown[] = [];

beforeAll(async () => {
  stack = await startStack();
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

function takeInvoked() {
  return auditEvents.filter(
    (e): e is Record<string, unknown> =>
      typeof e === 'object' &&
      e !== null &&
      (e as Record<string, unknown>).event_type === 'passthrough.invoked',
  );
}

describe('Batch G — /governed/openai/v1/responses', () => {
  it('preserves native input + emits v3 with capability_level=policy_governed', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/openai/v1/responses',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'gpt-fixture-1',
        input: 'hello governed',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-govai-capability-level']).toBe('policy_governed');
    const ev = takeInvoked()[0]!;
    expect(ev['provider']).toBe('openai');
    expect(ev['capability_id']).toBe('openai.responses.create');
    expect(ev['capability_canonical_level']).toBe('policy_governed');
    expect(ev['base_risk_class']).toBe('A');
    expect(typeof ev['native_response_hash']).toBe('string');
  });

  it('M1 CRED: governed credential-unresolvable (production org, no tenant credential) → 502 stable, zero provider calls', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    await setOrgOperationalMode(stack, org.org_id, 'production');
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/openai/v1/responses',
      headers: { 'content-type': 'application/json', 'x-govai-api-key': org.api_key },
      payload: JSON.stringify({ model: 'gpt-fixture-1', input: 'x' }),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: 'provider_credential_unresolvable',
      provider: 'openai',
      reason: 'no_tenant_credential_in_production_mode',
    });
    expect(takeInvoked().length).toBe(0);
  });

  it('blocked computer_use_preview tool → 403 + body_forward_mode=blocked', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/openai/v1/responses',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'gpt-fixture-1',
        input: 'x',
        tools: [{ type: 'computer_use_preview' }],
      }),
    });
    expect(res.statusCode).toBe(403);
    // M1 F2-03: applied vs recommendation + block trigger (additive HTTP contract).
    expect(res.headers['x-govai-enforcement-applied']).toBe('blocked');
    expect(res.json()).toMatchObject({
      error: 'governed_blocked',
      enforcement_applied: 'blocked',
      block_trigger: 'tool_validation',
    });
    const ev = takeInvoked()[0]!;
    expect(ev['enforcement_decision']).toBe('blocked');
    expect(ev['body_forward_mode']).toBe('blocked');
  });

  it('streaming responses: SSE + stream_final_hash + policy_governed', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/openai/v1/responses',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'gpt-fixture-1',
        input: 'stream me',
        stream: true,
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const deadline = Date.now() + 5000;
    let invoked: Array<Record<string, unknown>> = [];
    while (Date.now() < deadline) {
      invoked = takeInvoked();
      if (invoked.length >= 1) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(invoked.length).toBe(1);
    expect(invoked[0]!['is_stream']).toBe(true);
    expect(typeof invoked[0]!['stream_final_hash']).toBe('string');
    expect(invoked[0]!['capability_id']).toBe('openai.responses.stream');
  });
});

describe('Batch G — /governed/openai/v1/chat/completions', () => {
  it('preserves native messages[] + tool_choice + emits v3 with policy_governed', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/openai/v1/chat/completions',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'gpt-fixture-1',
        messages: [{ role: 'user', content: 'hi' }],
        tool_choice: 'auto',
      }),
    });
    expect(res.statusCode).toBe(200);
    const ev = takeInvoked()[0]!;
    expect(ev['capability_id']).toBe('openai.chat.completions.create');
    expect(ev['capability_canonical_level']).toBe('policy_governed');
  });

  it('M1 FB-2: Chat Completions with a web_search tool → typed_unknown reaches governance and is FORWARDED (no stale pre-block); F2 headers present', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/openai/v1/chat/completions',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'gpt-fixture-1',
        messages: [{ role: 'user', content: 'x' }],
        tools: [{ type: 'web_search' }],
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-govai-enforcement-applied']).toBe('forwarded');
    expect(typeof res.headers['x-govai-enforcement-decision']).toBe('string');
    const ev = takeInvoked()[0]!;
    expect(ev['body_forward_mode']).toBe('raw');
    const cls = ev['detected_tool_classifications'] as Array<Record<string, unknown>>;
    expect(cls[0]!['classification']).toBe('openai_typed_unknown');
    expect(cls[0]!['decision']).toBe('allowed');
  });

  it('streaming chat: SSE + stream_final_hash + policy_governed', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/openai/v1/chat/completions',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'gpt-fixture-1',
        messages: [{ role: 'user', content: 'stream me' }],
        stream: true,
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const deadline = Date.now() + 5000;
    let invoked: Array<Record<string, unknown>> = [];
    while (Date.now() < deadline) {
      invoked = takeInvoked();
      if (invoked.length >= 1) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(invoked.length).toBe(1);
    expect(invoked[0]!['is_stream']).toBe(true);
    expect(typeof invoked[0]!['stream_final_hash']).toBe('string');
    expect(invoked[0]!['capability_id']).toBe('openai.chat.completions.stream');
  });
});
