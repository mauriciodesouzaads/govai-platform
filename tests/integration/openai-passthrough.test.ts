// Batch C integration: /passthrough/openai/* end-to-end against the hermetic
// provider-protocol-server fixture. Covers:
//   - /v1/responses non-stream → 200 + audit `passthrough.invoked v3` with
//     capability_level=passthrough_audited (operational) AND
//     capability_canonical_level=policy_governed (registry) — Decisão 4 for OpenAI.
//   - /v1/chat/completions non-stream → analogous distinction.
//   - /v1/embeddings → both levels passthrough_audited.
//   - /v1/models GET → passthrough_audited.
//   - hard_denied OpenAI-Beta token → 403 + `passthrough.beta_denied`.
//   - tool classifier blocks computer_use_preview → 403 + `tool.validation_blocked`
//     with reason=capability_blocked_via_token.
//   - Chat Completions with web_search tool → 403 (Chat only accepts function).
//   - Files purpose=assistants → provider truth (ADR-032): forwarded normally,
//     provider accept AND provider reject both recorded as-is, no local warning,
//     no synthetic local 403, no runtime deprecation fields on new events.
//   - Files purpose=fine-tune → normal forwarding regression.
//   - vector_stores DELETE Starter tier path resolved.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startStack, stopStack, seedOrg, inject, type Stack } from './helpers/server-fixture.js';

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
      typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'passthrough.invoked',
  );
}
function takeDenied() {
  return auditEvents.filter(
    (e): e is Record<string, unknown> =>
      typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'passthrough.beta_denied',
  );
}
function takeBlocked() {
  return auditEvents.filter(
    (e): e is Record<string, unknown> =>
      typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'tool.validation_blocked',
  );
}

describe('Batch C — /passthrough/openai/*', () => {
  it('POST /v1/responses → 200 + Decisão 4 audit (canonical=policy_governed, operational=passthrough_audited)', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/passthrough/openai/v1/responses', org.api_key, {
      model: 'gpt-fixture-1',
      input: 'hello',
    });
    expect(res.statusCode).toBe(200);
    const ev = takeInvoked()[0]!;
    expect(ev['provider']).toBe('openai');
    expect(ev['capability_id']).toBe('openai.responses.create');
    expect(ev['capability_level']).toBe('passthrough_audited');
    expect(ev['capability_canonical_level']).toBe('policy_governed');
    expect(ev['body_forward_mode']).toBe('raw');
    expect(typeof ev['native_response_hash']).toBe('string');
  });

  it('POST /v1/chat/completions → 200 + Decisão 4 audit (canonical=policy_governed)', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/passthrough/openai/v1/chat/completions', org.api_key, {
      model: 'gpt-fixture-1',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.statusCode).toBe(200);
    const ev = takeInvoked()[0]!;
    expect(ev['capability_id']).toBe('openai.chat.completions.create');
    expect(ev['capability_canonical_level']).toBe('policy_governed');
  });

  it('POST /v1/embeddings → both levels passthrough_audited', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/passthrough/openai/v1/embeddings', org.api_key, {
      model: 'text-embedding-3-small',
      input: 'hello',
    });
    expect(res.statusCode).toBe(200);
    const ev = takeInvoked()[0]!;
    expect(ev['capability_id']).toBe('openai.embeddings');
    expect(ev['capability_level']).toBe('passthrough_audited');
    expect(ev['capability_canonical_level']).toBe('passthrough_audited');
  });

  it('GET /v1/models → both levels passthrough_audited', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(stack, 'GET', '/passthrough/openai/v1/models', org.api_key);
    expect(res.statusCode).toBe(200);
    const ev = takeInvoked()[0]!;
    expect(ev['capability_id']).toBe('openai.models');
    expect(ev['capability_canonical_level']).toBe('passthrough_audited');
  });

  it('POST /v1/responses with stream:true → 200 + Content-Type text/event-stream + is_stream audit (regression for #38)', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    // Stream requests go through the hijack/writeHead path. Pre-#38 the route
    // called reply.header() before reply.hijack() without ever flushing headers
    // to reply.raw, so the client received Node's defaults and the upstream
    // Content-Type was dropped. PR3.1j fixed this by mirroring the governed
    // pattern (reply.hijack() + reply.raw.writeHead(status, headers)).
    const res = await stack.app.inject({
      method: 'POST',
      url: '/passthrough/openai/v1/responses',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({ model: 'gpt-fixture-1', input: 'hi', stream: true }),
    });
    expect(res.statusCode).toBe(200);
    const contentType = (res.headers['content-type'] as string | undefined) ?? '';
    expect(contentType.toLowerCase()).toContain('text/event-stream');
    expect(res.body).toMatch(/data:\s*\{/);

    const invoked = takeInvoked();
    expect(invoked.length).toBe(1);
    const ev = invoked[0]!;
    expect(ev['capability_id']).toBe('openai.responses.stream');
    expect(ev['is_stream']).toBe(true);
    expect(ev['body_forward_mode']).toBe('raw');
    expect(ev['enforcement_decision']).toBe('observe');
    expect(typeof ev['stream_final_hash']).toBe('string');
  });

  it('OpenAI-Beta hard_denied (assistants=v2) → 403 + passthrough.beta_denied', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/passthrough/openai/v1/responses',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
        'openai-beta': 'assistants=v2',
      },
      payload: JSON.stringify({ model: 'gpt-fixture-1', input: 'x' }),
    });
    expect(res.statusCode).toBe(403);
    const denied = takeDenied();
    expect(denied.length).toBe(1);
    expect(denied[0]!['provider']).toBe('openai');
    expect(denied[0]!['beta_token']).toBe('assistants=v2');
    expect(denied[0]!['reason_code']).toBe('hard_denied');
  });

  it('tool computer_use_preview on /v1/responses → 403 + tool.validation_blocked, reason=capability_blocked_via_token', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/passthrough/openai/v1/responses', org.api_key, {
      model: 'gpt-fixture-1',
      input: 'x',
      tools: [{ type: 'computer_use_preview' }],
    });
    expect(res.statusCode).toBe(403);
    const blocked = takeBlocked();
    expect(blocked.length).toBe(1);
    expect(blocked[0]!['reason']).toBe('capability_blocked_via_token');
    expect(blocked[0]!['classification']).toBe('openai_provider_hosted_computer_use');
  });

  it('tool web_search on Chat Completions → 403 + reason=typed_unknown (Chat only accepts function)', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/passthrough/openai/v1/chat/completions', org.api_key, {
      model: 'gpt-fixture-1',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'web_search' }],
    });
    expect(res.statusCode).toBe(403);
    const blocked = takeBlocked();
    expect(blocked.length).toBe(1);
    expect(blocked[0]!['reason']).toBe('typed_unknown');
    expect(blocked[0]!['classification']).toBe('openai_typed_unknown');
  });

  it('tool type:null on /v1/responses → 403 + reason=typed_unknown', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/passthrough/openai/v1/responses', org.api_key, {
      model: 'gpt-fixture-1',
      input: 'x',
      tools: [{ type: null }],
    });
    expect(res.statusCode).toBe(403);
    const blocked = takeBlocked();
    expect(blocked.length).toBe(1);
    expect(blocked[0]!['reason']).toBe('typed_unknown');
  });

  it('POST /v1/files purpose=assistants, provider accepts → provider 200 recorded, no local warning, no runtime deprecation fields (ADR-032)', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/passthrough/openai/v1/files',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({ purpose: 'assistants' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-govai-deprecation-warning']).toBeUndefined();

    const invoked = takeInvoked();
    expect(invoked.length).toBe(1);
    const ev = invoked[0]!;
    expect(ev['provider']).toBe('openai');
    expect(ev['capability_id']).toBe('openai.files');
    expect(ev['status_code']).toBe(200);
    expect(ev['body_forward_mode']).toBe('raw');
    expect(ev['enforcement_decision']).toBe('observe');
    expect(ev['native_request_hash']).toMatch(/^[0-9a-f]{64}$/);
    expect(ev['native_response_hash']).toMatch(/^[0-9a-f]{64}$/);
    // The fixture supplies openai-request-id on /v1/files.
    expect(typeof ev['provider_request_id']).toBe('string');
    // ADR-032: new events carry NO runtime deprecation signal.
    expect(ev['purpose_deprecated']).toBeUndefined();
    expect(ev['purpose_deprecation_sunset_at']).toBeUndefined();
    expect(ev['purpose_deprecation_migration_target']).toBeUndefined();
  });

  it('POST /v1/files purpose=assistants, provider rejects (429) → provider 429 recorded as-is, no synthetic local 403 (ADR-032)', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/passthrough/openai/v1/files',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
        'x-test-error': '429',
      },
      payload: JSON.stringify({ purpose: 'assistants' }),
    });
    // The provider's actual rejection is the result truth — never a local 403.
    expect(res.statusCode).toBe(429);
    expect(res.body).not.toContain('purpose_deprecated_post_sunset');
    expect(res.headers['x-govai-deprecation-warning']).toBeUndefined();

    const invoked = takeInvoked();
    expect(invoked.length).toBe(1);
    const ev = invoked[0]!;
    expect(ev['provider']).toBe('openai');
    expect(ev['capability_id']).toBe('openai.files');
    expect(ev['status_code']).toBe(429);
    expect(ev['body_forward_mode']).toBe('raw');
    expect(ev['enforcement_decision']).toBe('observe');
    expect(ev['native_request_hash']).toMatch(/^[0-9a-f]{64}$/);
    expect(ev['native_response_hash']).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof ev['provider_request_id']).toBe('string');
    expect(ev['purpose_deprecated']).toBeUndefined();
    expect(ev['purpose_deprecation_sunset_at']).toBeUndefined();
    expect(ev['purpose_deprecation_migration_target']).toBeUndefined();
  });

  it('POST /v1/files purpose=fine-tune → normal forwarding regression', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/passthrough/openai/v1/files',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
      },
      payload: JSON.stringify({ purpose: 'fine-tune' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-govai-deprecation-warning']).toBeUndefined();

    const invoked = takeInvoked();
    expect(invoked.length).toBe(1);
    const ev = invoked[0]!;
    expect(ev['capability_id']).toBe('openai.files');
    expect(ev['status_code']).toBe(200);
    expect(ev['body_forward_mode']).toBe('raw');
  });

  it('DELETE /v1/vector_stores/{id} → 200, canonical_id=openai.vector_stores.delete (starter tier resolves)', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'DELETE',
      url: '/passthrough/openai/v1/vector_stores/vs-fixture',
      headers: { 'x-govai-api-key': org.api_key },
    });
    expect(res.statusCode).toBe(200);
    const invoked = takeInvoked();
    expect(invoked.length).toBe(1);
    expect(invoked[0]!['capability_id']).toBe('openai.vector_stores.delete');
    expect(invoked[0]!['capability_canonical_level']).toBe('passthrough_audited');
  });
});
