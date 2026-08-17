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

  it('M1 BETA-05: OpenAI-Beta deprecation-only token (assistants=v2) → FORWARDED (no Native hard deny), decision_pending marker, no beta_denied', async () => {
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
    expect(res.statusCode).toBe(200);
    expect(takeDenied().length).toBe(0);
    const ev = takeInvoked()[0]!;
    expect(ev['enforcement_decision']).toBe('observe');
    expect(ev['beta_allowlist_sources']).toEqual([]);
    const reasons = ev['risk_escalation_reasons'] as string[];
    expect(reasons.length).toBe(1);
    expect(reasons[0]).toMatch(/^beta:decision_pending:sha256:[0-9a-f]{64}$/);
    expect(ev['allowlist_version']).toBe('openai-beta-policy@2026-08-16');
  });

  it('M1 BETA-01: unknown OpenAI-Beta token → FORWARDED, hashed unknown_token marker, raw token not in evidence', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/passthrough/openai/v1/responses',
      headers: {
        'content-type': 'application/json',
        'x-govai-api-key': org.api_key,
        'openai-beta': 'responses=experimental-2099',
      },
      payload: JSON.stringify({ model: 'gpt-fixture-1', input: 'x' }),
    });
    expect(res.statusCode).toBe(200);
    const ev = takeInvoked()[0]!;
    const reasons = ev['risk_escalation_reasons'] as string[];
    expect(reasons.length).toBe(1);
    expect(reasons[0]).toMatch(/^beta:unknown_token:sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(ev)).not.toContain('experimental-2099');
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
    // M1 FB-4: durable blocked v4 (provider not called) with taxonomy v3.
    const inv = takeInvoked();
    expect(inv.length).toBe(1);
    expect(inv[0]!['enforcement_decision']).toBe('blocked');
    expect(inv[0]!['body_forward_mode']).toBe('blocked');
    expect(inv[0]!['status_code']).toBe(403);
    expect(inv[0]!['native_response_hash']).toBeUndefined();
    expect(inv[0]!['tools_taxonomy_version']).toBe(
      'openai.tools_taxonomy:schema_version=3:m1_noncomputer_forward_computer_use_floor',
    );
  });

  it('M1 FB-2: tool web_search on Chat Completions → typed_unknown, FORWARDED (provider decides), no stale 403', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/passthrough/openai/v1/chat/completions', org.api_key, {
      model: 'gpt-fixture-1',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'web_search' }],
    });
    expect(res.statusCode).toBe(200);
    expect(takeBlocked().length).toBe(0);
    const cls = takeInvoked()[0]!['detected_tool_classifications'] as Array<Record<string, unknown>>;
    expect(cls[0]!['classification']).toBe('openai_typed_unknown');
    expect(cls[0]!['decision']).toBe('allowed');
  });

  it('M1 FB-2: former planned/unknown tools on /v1/responses (type:null, code_interpreter, mcp, tool_search) → FORWARDED + classified', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/passthrough/openai/v1/responses', org.api_key, {
      model: 'gpt-fixture-1',
      input: 'x',
      tools: [{ type: null }, { type: 'code_interpreter' }, { type: 'mcp', server_label: 'x' }, { type: 'tool_search' }],
    });
    expect(res.statusCode).toBe(200);
    expect(takeBlocked().length).toBe(0);
    const cls = takeInvoked()[0]!['detected_tool_classifications'] as Array<Record<string, unknown>>;
    expect(cls.map((c) => c['classification'])).toEqual([
      'openai_typed_unknown',
      'openai_provider_hosted_code_interpreter',
      'openai_provider_hosted_mcp',
      'openai_provider_hosted_tool_search',
    ]);
    expect(cls.every((c) => c['decision'] === 'allowed')).toBe(true);
  });

  it('M1 CRED-02: production org WITHOUT a tenant credential → 502 provider_credential_unresolvable (stable, no secret, no 500)', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    await setOrgOperationalMode(stack, org.org_id, 'production');
    const res = await inject(stack, 'POST', '/passthrough/openai/v1/responses', org.api_key, {
      model: 'gpt-fixture-1',
      input: 'x',
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({
      error: 'provider_credential_unresolvable',
      provider: 'openai',
      reason: 'no_tenant_credential_in_production_mode',
    });
    expect(takeInvoked().length).toBe(0);
  });

  it('M1 ROUTE-01/02/03: auth before registry disclosure; authenticated unknown path → 404; method mismatch → 405 (never 500)', async () => {
    const org = await seedOrg(stack);
    const r1 = await stack.app.inject({
      method: 'POST',
      url: '/passthrough/openai/v1/batches',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(r1.statusCode).toBe(401);
    expect(r1.json().error).toBe('auth_error');
    const r2 = await inject(stack, 'POST', '/passthrough/openai/v1/batches', org.api_key, {});
    expect(r2.statusCode).toBe(404);
    expect((r2.body as { error: string }).error).toBe('capability_not_registered');
    const r3 = await stack.app.inject({
      method: 'GET',
      url: '/passthrough/openai/v1/responses',
      headers: { 'x-govai-api-key': org.api_key },
    });
    expect(r3.statusCode).toBe(405);
    expect(r3.headers['allow']).toBe('POST');
    expect(r3.json().error).toBe('method_not_allowed');
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

// M2A F1 regression guard — OpenAI keeps its own semantics: `x-request-id`.
describe('M2A F1 — OpenAI provider_request_id == fixture-issued `x-request-id`', () => {
  it('F1-T6 — /v1/responses non-stream capture carries the issued x-request-id', async () => {
    auditEvents.length = 0;
    stack.provider.clearRecordedRequests();
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'POST',
      url: '/passthrough/openai/v1/responses',
      headers: { 'content-type': 'application/json', 'x-govai-api-key': org.api_key },
      payload: JSON.stringify({ model: 'gpt-fixture-1', input: 'hi' }),
    });
    expect(res.statusCode).toBe(200);
    const issued = stack.provider.recordedRequests.at(-1)?.provider_request_id;
    expect(issued).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-request-id']).toBe(issued);
    const invoked = takeInvoked();
    expect(invoked.length).toBe(1);
    expect(invoked[0]!['capability_id']).toBe('openai.responses.create');
    expect(invoked[0]!['provider_request_id']).toBe(issued);
  });
});

// M2A F5 — provider-native query fidelity through the FULL stack (OpenAI).
describe('M2A F5 — /passthrough/openai query fidelity (full stack)', () => {
  it('F5-T1/T2 GET /v1/files?limit=1&order=desc → upstream sees EXACTLY that; raw serialization preserved', async () => {
    auditEvents.length = 0;
    stack.provider.clearRecordedRequests();
    const org = await seedOrg(stack);
    const res = await stack.app.inject({
      method: 'GET',
      url: '/passthrough/openai/v1/files?limit=1&order=desc',
      headers: { 'x-govai-api-key': org.api_key },
    });
    expect(res.statusCode).toBe(200);
    expect(stack.provider.recordedRequests.at(-1)!.url).toBe('/v1/files?limit=1&order=desc');
    const invoked = takeInvoked();
    expect(invoked.length).toBe(1);
    expect(invoked[0]!['capability_id']).toBe('openai.files');
    expect(invoked[0]!['native_endpoint']).toBe('/v1/files');
    const res2 = await stack.app.inject({
      method: 'GET',
      url: '/passthrough/openai/v1/files?after=a%2Fb&x=&x=two+words&encoded=%252F',
      headers: { 'x-govai-api-key': org.api_key },
    });
    expect(res2.statusCode).toBe(200);
    expect(stack.provider.recordedRequests.at(-1)!.url).toBe('/v1/files?after=a%2Fb&x=&x=two+words&encoded=%252F');
  });

  it('F5-T6 no credential + query → 401 and ZERO upstream requests', async () => {
    stack.provider.clearRecordedRequests();
    const r401 = await stack.app.inject({ method: 'GET', url: '/passthrough/openai/v1/files?limit=1' });
    expect(r401.statusCode).toBe(401);
    expect(stack.provider.recordedRequests.length).toBe(0);
  });
});
