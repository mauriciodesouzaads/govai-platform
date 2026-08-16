// Native/Audited contract of the Anthropic passthrough route — Foundation V1
// M1 (OD-1=A): BETA-01..08, TOOLS, DENY-01..03, ROUTE-01..03. Real socket
// (app.listen + fake loopback provider + real fetch), zero provider spend.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { PassthroughInvokedSchema } from '@govai/core-events';
import {
  registerAnthropicPassthrough,
  type AnthropicPassthroughDeps,
} from './register-passthrough.js';
import type { TenantContext } from '../passthrough/audit-emit.js';
import { SHA256_EMPTY } from '../passthrough/evidence-constants.js';
import { KNOWN_ANTHROPIC_TAXONOMY_VERSION } from '../tool-taxonomy-version.js';
import { ANTHROPIC_BETA_POLICY_VERSION } from '../beta-policy.js';

type Captured = { method: string; url: string; headers: http.IncomingHttpHeaders; rawBody: Buffer };
type FakeResponse = { status: number; headers: Record<string, string>; body: Buffer };

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const okBody = Buffer.from('{"id":"msg_1","ok":true}', 'utf8');

let fake: http.Server;
let app: FastifyInstance;
let govUrl: string;
let captured: Captured | null = null;
let providerCalls = 0;
let fakeResponse: FakeResponse = { status: 200, headers: { 'content-type': 'application/json' }, body: okBody };
const auditEvents: Array<Record<string, unknown>> = [];

const tenant: TenantContext = {
  org_id: '00000000-0000-4000-8000-0000000000a1',
  user_id: '00000000-0000-4000-8000-0000000000a2',
  tier: 'enterprise',
  operational_mode: 'production',
};

const evOfType = (t: string) => auditEvents.filter((e) => e['event_type'] === t);
function invoked(): Record<string, unknown> {
  const ev = evOfType('passthrough.invoked')[0];
  if (!ev) throw new Error('no passthrough.invoked');
  return ev;
}

const MSG = (extra: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({ model: 'claude-x', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }], ...extra }),
    'utf8',
  );

async function post(
  path: string,
  body: Buffer,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${govUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      providerCalls++;
      captured = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, rawBody: Buffer.concat(chunks) };
      res.writeHead(fakeResponse.status, fakeResponse.headers);
      res.end(fakeResponse.body);
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  const deps: AnthropicPassthroughDeps = {
    upstreamBaseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`,
    resolveTenant: async (req) => {
      if (req.headers['x-test-auth'] === 'fail') throw new Error('invalid api key');
      return tenant;
    },
    resolveProviderKey: async () => ({ apiKey: 'k', source: 'platform_env' }),
    activeOverridesLoader: async () => [],
    emitAuditEvent: (ev: unknown) => {
      auditEvents.push(ev as Record<string, unknown>);
    },
  };
  app = Fastify({ logger: false });
  await app.register(async (i) => registerAnthropicPassthrough(i, deps));
  await app.listen({ port: 0, host: '127.0.0.1' });
  govUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((r) => fake.close(() => r()));
});

beforeEach(() => {
  captured = null;
  providerCalls = 0;
  auditEvents.length = 0;
  fakeResponse = { status: 200, headers: { 'content-type': 'application/json' }, body: okBody };
});

describe('BETA — Native beta contract (real ANTHROPIC_BETA_POLICY)', () => {
  it('BETA-01: unknown token → forwarded byte-intact, no local 403, v4 emitted, NO fabricated source, hashed marker', async () => {
    const res = await post('/passthrough/anthropic/v1/messages', MSG(), {
      'anthropic-beta': 'claude-code-20250219',
    });
    expect(res.status).toBe(200);
    expect(providerCalls).toBe(1);
    expect(captured?.headers['anthropic-beta']).toBe('claude-code-20250219');
    const ev = invoked();
    expect(ev['beta_allowlist_sources']).toEqual([]);
    expect(ev['enforcement_decision']).toBe('observe');
    expect(ev['risk_escalation_reasons']).toEqual([
      `beta:unknown_token:sha256:${sha('claude-code-20250219')}`,
    ]);
    expect(evOfType('passthrough.beta_denied')).toHaveLength(0);
  });

  it('BETA-02: known (files-api) + unknown tokens → forwarded intact; truthful known source only; one marker', async () => {
    const hv = 'files-api-2025-04-14, interleaved-thinking-2025-05-14';
    const res = await post('/passthrough/anthropic/v1/messages', MSG(), { 'anthropic-beta': hv });
    expect(res.status).toBe(200);
    expect(captured?.headers['anthropic-beta']).toBe(hv);
    const ev = invoked();
    expect(ev['beta_allowlist_sources']).toEqual([
      { beta_token: 'files-api-2025-04-14', source: 'global_allowlist', policy_at_resolution: 'global_allowlist' },
    ]);
    expect(ev['risk_escalation_reasons']).toEqual([
      `beta:unknown_token:sha256:${sha('interleaved-thinking-2025-05-14')}`,
    ]);
  });

  it('BETA-03: verification_required (prompt-caching-2024-07-31) → Native forward + marker, no deny', async () => {
    const res = await post('/passthrough/anthropic/v1/messages', MSG(), {
      'anthropic-beta': 'prompt-caching-2024-07-31',
    });
    expect(res.status).toBe(200);
    expect(providerCalls).toBe(1);
    expect(invoked()['risk_escalation_reasons']).toEqual([
      `beta:verification_required:sha256:${sha('prompt-caching-2024-07-31')}`,
    ]);
  });

  it('BETA-04: denied_until_decision (output-300k-2026-03-24) → Native forward + decision_pending marker', async () => {
    const res = await post('/passthrough/anthropic/v1/messages', MSG(), {
      'anthropic-beta': 'output-300k-2026-03-24',
    });
    expect(res.status).toBe(200);
    expect(invoked()['risk_escalation_reasons']).toEqual([
      `beta:decision_pending:sha256:${sha('output-300k-2026-03-24')}`,
    ]);
  });

  it('BETA-05: provider fake controls the resulting status of a forwarded unknown beta (400 relayed)', async () => {
    fakeResponse = {
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"type":"error","error":{"type":"invalid_request_error","message":"unknown beta"}}'),
    };
    const res = await post('/passthrough/anthropic/v1/messages', MSG(), { 'anthropic-beta': 'made-up-2099-01-01' });
    expect(res.status).toBe(400);
    expect(providerCalls).toBe(1);
    expect(invoked()['status_code']).toBe(400);
  });

  it('BETA-06 / DENY-01: computer-use beta (hard_denied) → 403 explicit, provider NOT called, beta_denied diagnostic + durable blocked v4', async () => {
    const body = MSG();
    const res = await post('/passthrough/anthropic/v1/messages', body, {
      'anthropic-beta': 'computer-use-2025-11-24',
    });
    expect(res.status).toBe(403);
    expect(providerCalls).toBe(0);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j['error']).toBe('beta_denied');
    expect(j['denied']).toEqual([
      { beta_token: 'computer-use-2025-11-24', policy_at_resolution: 'hard_denied', reason_code: 'hard_denied' },
    ]);
    expect(evOfType('passthrough.beta_denied')).toHaveLength(1);
    const ev = invoked();
    // Schema-valid v4 blocked event (re-validate independently).
    expect(PassthroughInvokedSchema.safeParse(ev).success).toBe(true);
    expect(ev).toMatchObject({
      capability_level: 'passthrough_audited',
      capability_id: 'anthropic.messages.create',
      enforcement_decision: 'blocked',
      body_forward_mode: 'blocked',
      status_code: 403,
      is_stream: false,
      native_request_hash: sha(body),
      credential_source: 'not_resolved_pre_provider_block',
      allowlist_version: ANTHROPIC_BETA_POLICY_VERSION,
      beta_allowlist_sources: [],
    });
    expect(ev['native_response_hash']).toBeUndefined();
    expect(ev['provider_request_id']).toBeUndefined();
    expect(ev['stream_final_hash']).toBeUndefined();
    expect(ev['risk_escalation_reasons']).toEqual([
      `beta:hard_denied:sha256:${sha('computer-use-2025-11-24')}`,
    ]);
  });

  it('BETA-07: no header → unchanged behavior (empty sources, no markers)', async () => {
    const res = await post('/passthrough/anthropic/v1/messages', MSG());
    expect(res.status).toBe(200);
    expect(captured?.headers['anthropic-beta']).toBeUndefined();
    const ev = invoked();
    expect(ev['beta_allowlist_sources']).toEqual([]);
    expect(ev['risk_escalation_reasons']).toEqual([]);
  });

  it('BETA-08: an arbitrary client token is NOT stored raw in evidence; the marker is bounded and non-enforcing', async () => {
    const nasty = 'zz-' + 'q'.repeat(3000) + '-<script>';
    const res = await post('/passthrough/anthropic/v1/messages', MSG(), { 'anthropic-beta': nasty });
    expect(res.status).toBe(200);
    const ev = invoked();
    const serialized = JSON.stringify(ev);
    expect(serialized).not.toContain('q'.repeat(100));
    expect(serialized).not.toContain('<script>');
    const reasons = ev['risk_escalation_reasons'] as string[];
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/^beta:unknown_token:sha256:[0-9a-f]{64}$/);
    // Non-enforcing: class untouched (base of messages.create), enforcement observe.
    expect(ev['effective_risk_class']).toBe(ev['base_risk_class']);
    expect(ev['enforcement_decision']).toBe('observe');
  });
});

describe('TOOLS — non-computer tools classify + forward; computer use is the only floor', () => {
  it('representative non-computer tools → provider reached, classifications + risk preserved, taxonomy v3', async () => {
    const tools = [
      { name: 'get_weather', input_schema: { type: 'object' } }, // client_defined (no type)
      { type: 'custom', name: 'lookup', input_schema: { type: 'object' } }, // client_defined (explicit)
      { type: 'text_editor_20250124', name: 'str_replace_editor' },
      { type: 'bash_20250124', name: 'bash' },
      { type: 'web_search_20250305', name: 'web_search' },
      { type: 'code_execution_20250522', name: 'code_execution' },
      { type: 'web_fetch_20250910', name: 'web_fetch' }, // no dedicated v4 enum → typed_unknown
      { type: null, name: 'weird' }, // typed_unknown
    ];
    const body = MSG({ tools });
    const res = await post('/passthrough/anthropic/v1/messages', body);
    expect(res.status).toBe(200);
    expect(providerCalls).toBe(1);
    expect(captured?.rawBody.equals(body)).toBe(true);
    expect(evOfType('tool.validation_blocked')).toHaveLength(0);
    const ev = invoked();
    expect(ev['tools_taxonomy_version']).toBe(KNOWN_ANTHROPIC_TAXONOMY_VERSION);
    expect(ev['tools_taxonomy_version']).toBe(
      'anthropic.tools_taxonomy:schema_version=3:m1_noncomputer_forward_computer_use_floor',
    );
    const cls = ev['detected_tool_classifications'] as Array<Record<string, unknown>>;
    expect(cls.map((c) => [c['classification'], c['contributed_risk_class'], c['decision']])).toEqual([
      ['client_defined', 'B', 'allowed'],
      ['client_defined', 'B', 'allowed'],
      ['anthropic_defined_client_executed_text_editor', 'C', 'allowed'],
      ['anthropic_defined_client_executed_bash', 'D', 'allowed'],
      ['anthropic_provider_hosted_web_search', 'C', 'allowed'],
      ['anthropic_provider_hosted_code_execution', 'C', 'allowed'],
      ['anthropic_typed_unknown', 'C', 'allowed'],
      ['anthropic_typed_unknown', 'C', 'allowed'],
    ]);
    // Risk contribution preserved in evidence (bash D lifts the class).
    expect(ev['effective_risk_class']).toBe('D');
    expect(ev['enforcement_decision']).toBe('observe');
  });

  it('DENY-02: computer-use tool → 403 explicit, provider NOT called, tool.validation_blocked + durable blocked v4 with classifications', async () => {
    const body = MSG({ tools: [{ type: 'computer_20250124', name: 'computer', display_width_px: 1, display_height_px: 1 }] });
    const res = await post('/passthrough/anthropic/v1/messages', body);
    expect(res.status).toBe(403);
    expect(providerCalls).toBe(0);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j['error']).toBe('tool_blocked_until_governance_primitive');
    expect((j['blocked'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      tool_index: 0,
      tool_type: 'computer_20250124',
      classification: 'anthropic_provider_hosted_computer_use',
      reason: 'capability_blocked_via_token',
    });
    expect(evOfType('tool.validation_blocked')).toHaveLength(1);
    const ev = invoked();
    expect(PassthroughInvokedSchema.safeParse(ev).success).toBe(true);
    expect(ev).toMatchObject({
      enforcement_decision: 'blocked',
      body_forward_mode: 'blocked',
      status_code: 403,
      native_request_hash: sha(body),
      tools_taxonomy_version: KNOWN_ANTHROPIC_TAXONOMY_VERSION,
      credential_source: 'not_resolved_pre_provider_block',
    });
    const cls = ev['detected_tool_classifications'] as Array<Record<string, unknown>>;
    expect(cls[0]).toMatchObject({
      classification: 'anthropic_provider_hosted_computer_use',
      decision: 'blocked_at_validation',
      contributed_risk_class: 'D',
    });
  });

  it('DENY-03: STREAMING computer-use block → 403 (not 500), v4 is_stream=true, stream_final_hash=SHA256(empty), no stream_outcome, provider NOT called', async () => {
    const body = MSG({ stream: true, tools: [{ type: 'computer_20250124', name: 'computer' }] });
    const res = await post('/passthrough/anthropic/v1/messages', body);
    expect(res.status).toBe(403);
    expect(providerCalls).toBe(0);
    const ev = invoked();
    expect(PassthroughInvokedSchema.safeParse(ev).success).toBe(true);
    expect(ev['capability_id']).toBe('anthropic.messages.stream');
    expect(ev['is_stream']).toBe(true);
    expect(ev['stream_final_hash']).toBe(SHA256_EMPTY);
    expect(ev['stream_final_hash']).toBe(sha(Buffer.alloc(0)));
    expect(ev['stream_outcome']).toBeUndefined();
    expect(ev['enforcement_decision']).toBe('blocked');
    expect(ev['body_forward_mode']).toBe('blocked');
  });
});

describe('ROUTE — auth before registry disclosure; method mismatch is a client contract error', () => {
  it('ROUTE-01: unauthenticated request to an UNKNOWN path → 401 auth_error (no registry disclosure)', async () => {
    const res = await post('/passthrough/anthropic/v1/messages/batches', MSG(), { 'x-test-auth': 'fail' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('auth_error');
  });

  it('ROUTE-01b: unauthenticated request to a KNOWN path → identical 401 (indistinguishable)', async () => {
    const res = await post('/passthrough/anthropic/v1/messages', MSG(), { 'x-test-auth': 'fail' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('auth_error');
  });

  it('ROUTE-02: authenticated unknown path → 404 capability_not_registered (no path expansion)', async () => {
    const res = await post('/passthrough/anthropic/v1/messages/batches', MSG());
    expect(res.status).toBe(404);
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('capability_not_registered');
    expect(providerCalls).toBe(0);
  });

  it('ROUTE-03: known path + unsupported method → 405 method_not_allowed + truthful Allow, NEVER 500', async () => {
    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/messages`, { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    const j = (await res.json()) as Record<string, unknown>;
    expect(j['error']).toBe('method_not_allowed');
    expect(j['allow']).toEqual(['POST']);
    expect(providerCalls).toBe(0);

    const res2 = await fetch(`${govUrl}/passthrough/anthropic/v1/models/claude-x`, { method: 'POST' });
    expect(res2.status).toBe(405);
    expect(res2.headers.get('allow')).toBe('GET');
    expect(auditEvents).toHaveLength(0);
  });
});
