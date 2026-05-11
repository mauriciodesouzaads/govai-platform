// /governed/anthropic/* — governed-native Anthropic surface.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  stopStack,
  seedOrg,
  seedProviderCredential,
  type Stack,
} from './helpers/server-fixture.js';

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

async function setOrgTier(stack: Stack, orgId: string, tier: string, mode: string): Promise<void> {
  // HAE-004: tier mutation is reserved for the (future PR3) admin role; tests
  // run the UPDATE via the admin pool's superuser connection so RLS is bypassed.
  const c = await stack.db.adminPool.connect();
  try {
    await c.query(
      `UPDATE govai.orgs SET tier = $2, operational_mode = $3 WHERE id = $1::uuid`,
      [orgId, tier, mode],
    );
  } finally {
    c.release();
  }
}

describe('Batch G — /governed/anthropic/v1/messages', () => {
  it('preserves native body (system + content blocks) and emits v3 with capability_level=policy_governed', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        system: 'You are helpful.',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'hello governed' }],
          },
        ],
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-govai-capability-level']).toBe('policy_governed');
    expect(res.headers['x-govai-effective-risk-class']).toBe('A');
    // operational_mode='pilot' (default) + risk A → relax-once-from-observe = observe.
    expect(res.headers['x-govai-enforcement-decision']).toBe('observe');

    const ev = takeInvoked()[0]!;
    expect(ev['provider']).toBe('anthropic');
    expect(ev['capability_id']).toBe('anthropic.messages.create');
    expect(ev['capability_level']).toBe('policy_governed');
    expect(ev['capability_canonical_level']).toBe('policy_governed');
    expect(ev['base_risk_class']).toBe('A');
    expect(ev['effective_risk_class']).toBe('A');
    expect(ev['enforcement_decision']).toBe('observe');
    expect(typeof ev['native_request_hash']).toBe('string');
    expect(typeof ev['native_response_hash']).toBe('string');
    expect(ev['body_forward_mode']).toBe('raw');
  });

  it('CPF in user content escalates effective_risk_class to C (DLP pre-scan inside handler)', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'meu CPF é 111.444.777-35' }],
      }),
    });
    expect(res.statusCode).toBe(200);
    const ev = takeInvoked()[0]!;
    expect(ev['effective_risk_class']).toBe('C');
    expect(ev['risk_escalation_reasons']).toContain('dlp:cpf:pii_strong');
    const dlp = ev['dlp_decisions'] as Array<Record<string, unknown>>;
    expect(dlp.length).toBe(1);
    expect((dlp[0]!['finding_classes'] as string[]).indexOf('cpf')).toBeGreaterThanOrEqual(0);
  });

  it('blocked tool (computer_use) on /v1/messages → 403 + dlp/tool emit + body_forward_mode=blocked', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'x' }],
        tools: [{ type: 'computer_20251124', name: 'puter' }],
      }),
    });
    expect(res.statusCode).toBe(403);
    const ev = takeInvoked()[0]!;
    expect(ev['enforcement_decision']).toBe('blocked');
    expect(ev['body_forward_mode']).toBe('blocked');
    expect(ev['native_response_hash']).toBeUndefined();
  });

  it('streaming: SSE response + stream_final_hash + capability_level=policy_governed in audit', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        stream: true,
        messages: [{ role: 'user', content: 'stream me' }],
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.rawPayload.length).toBeGreaterThan(0);

    const deadline = Date.now() + 5000;
    let invoked: Array<Record<string, unknown>> = [];
    while (Date.now() < deadline) {
      invoked = takeInvoked();
      if (invoked.length >= 1) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(invoked.length).toBe(1);
    const ev = invoked[0]!;
    expect(ev['is_stream']).toBe(true);
    expect(typeof ev['stream_final_hash']).toBe('string');
    expect(ev['capability_id']).toBe('anthropic.messages.stream');
    expect(ev['capability_level']).toBe('policy_governed');
  });

  it('regulated tier + risk D tool → enforce (not observe); starter would have been blocked', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    await setOrgTier(stack, org.org_id, 'regulated', 'production');
    // operational_mode='production' requires a tenant provider credential
    // (PR3.1a). Seed one so the resolver returns it instead of failing closed.
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      plaintextKey: 'sk-ant-prod-fixture-AAAA',
      setByUserId: org.user_id,
    });
    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'x' }],
        tools: [{ type: 'bash_20241022', name: 'sh' }],
      }),
    });
    expect(res.statusCode).toBe(200);
    const ev = takeInvoked()[0]!;
    expect(ev['effective_risk_class']).toBe('D');
    expect(ev['enforcement_decision']).toBe('enforce');
    expect(ev['risk_escalation_reasons']).toContain('tool:anthropic_defined_client_executed_bash:d');
  });
});
