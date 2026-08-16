// Native/Audited contract of the OpenAI passthrough route — Foundation V1 M1
// (OD-1=A): BETA-01..08, TOOLS, DENY-01..03, ROUTE-01..03. Real socket
// (app.listen + fake loopback provider + real fetch), zero provider spend.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { PassthroughInvokedSchema } from '@govai/core-events';
import type { BetaTokenPolicyEntry } from '@govai/core-types';
import {
  registerOpenAIPassthrough,
  type OpenAIPassthroughDeps,
} from './register-passthrough.js';
import type { TenantContext } from '../passthrough/audit-emit.js';
import { SHA256_EMPTY } from '../passthrough/evidence-constants.js';
import { KNOWN_OPENAI_TAXONOMY_VERSION } from '../tool-taxonomy-version.js';
import { OPENAI_BETA_POLICY, OPENAI_BETA_POLICY_VERSION } from '../beta-policy.js';

type Captured = { method: string; url: string; headers: http.IncomingHttpHeaders; rawBody: Buffer };
type FakeResponse = { status: number; headers: Record<string, string>; body: Buffer };

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const okBody = Buffer.from('{"id":"resp_1","ok":true}', 'utf8');

/** A test-only table: the real entries + the states the real OpenAI table lacks
 *  (hard_denied floor mechanism, verification_required, org_override_allowed). */
const TEST_POLICY: ReadonlyArray<BetaTokenPolicyEntry> = Object.freeze([
  ...OPENAI_BETA_POLICY,
  { beta_token: 'test-computer-use-beta', policy: 'hard_denied', reason: 't', pinned_at: '2026-08-16T00:00:00Z' },
  { beta_token: 'test-verify-beta', policy: 'verification_required', reason: 't', pinned_at: '2026-08-16T00:00:00Z' },
  { beta_token: 'test-override-beta', policy: 'org_override_allowed', reason: 't', pinned_at: '2026-08-16T00:00:00Z' },
  { beta_token: 'test-global-beta', policy: 'global_allowlist', adr: 'ADR-T', reason: 't', pinned_at: '2026-08-16T00:00:00Z' },
]);

let fake: http.Server;
let app: FastifyInstance; // real OPENAI_BETA_POLICY
let appPolicy: FastifyInstance; // TEST_POLICY
let govUrl: string;
let govPolicyUrl: string;
let captured: Captured | null = null;
let providerCalls = 0;
let fakeResponse: FakeResponse = { status: 200, headers: { 'content-type': 'application/json' }, body: okBody };
const auditEvents: Array<Record<string, unknown>> = [];

const tenant: TenantContext = {
  org_id: '00000000-0000-4000-8000-0000000000b1',
  user_id: '00000000-0000-4000-8000-0000000000b2',
  tier: 'enterprise',
  operational_mode: 'production',
};

const evOfType = (t: string) => auditEvents.filter((e) => e['event_type'] === t);
function invoked(): Record<string, unknown> {
  const ev = evOfType('passthrough.invoked')[0];
  if (!ev) throw new Error('no passthrough.invoked');
  return ev;
}

const RESP = (extra: Record<string, unknown> = {}) =>
  Buffer.from(JSON.stringify({ model: 'gpt-x', input: 'hi', ...extra }), 'utf8');

async function post(
  base: string,
  path: string,
  body: Buffer,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${base}${path}`, {
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
  const mkDeps = (policyTable?: ReadonlyArray<BetaTokenPolicyEntry>): OpenAIPassthroughDeps => ({
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
    ...(policyTable ? { policyTable } : {}),
  });
  app = Fastify({ logger: false });
  await app.register(async (i) => registerOpenAIPassthrough(i, mkDeps()));
  await app.listen({ port: 0, host: '127.0.0.1' });
  govUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  appPolicy = Fastify({ logger: false });
  await appPolicy.register(async (i) => registerOpenAIPassthrough(i, mkDeps(TEST_POLICY)));
  await appPolicy.listen({ port: 0, host: '127.0.0.1' });
  govPolicyUrl = `http://127.0.0.1:${(appPolicy.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await appPolicy.close();
  await new Promise<void>((r) => fake.close(() => r()));
});

beforeEach(() => {
  captured = null;
  providerCalls = 0;
  auditEvents.length = 0;
  fakeResponse = { status: 200, headers: { 'content-type': 'application/json' }, body: okBody };
});

describe('BETA — Native beta contract', () => {
  it('BETA-01: unknown OpenAI-Beta token → forwarded byte-intact, no local 403, v4 emitted, NO fabricated source, hashed marker', async () => {
    const res = await post(govUrl, '/passthrough/openai/v1/responses', RESP(), { 'openai-beta': 'responses=experimental' });
    expect(res.status).toBe(200);
    expect(providerCalls).toBe(1);
    expect(captured?.headers['openai-beta']).toBe('responses=experimental');
    const ev = invoked();
    expect(ev['beta_allowlist_sources']).toEqual([]);
    expect(ev['risk_escalation_reasons']).toEqual([`beta:unknown_token:sha256:${sha('responses=experimental')}`]);
    expect(evOfType('passthrough.beta_denied')).toHaveLength(0);
  });

  it('BETA-05: deprecation-only historical tokens (assistants=v2, realtime=v1) → Native forward + decision_pending marker; provider fake decides (400 relayed)', async () => {
    fakeResponse = { status: 400, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"error":{"message":"deprecated"}}') };
    const hv = 'assistants=v2, realtime=v1';
    const res = await post(govUrl, '/passthrough/openai/v1/responses', RESP(), { 'openai-beta': hv });
    expect(res.status).toBe(400);
    expect(providerCalls).toBe(1);
    expect(captured?.headers['openai-beta']).toBe(hv);
    const ev = invoked();
    expect(ev['status_code']).toBe(400);
    expect(ev['beta_allowlist_sources']).toEqual([]);
    expect(ev['risk_escalation_reasons']).toEqual([
      `beta:decision_pending:sha256:${sha('assistants=v2')}`,
      `beta:decision_pending:sha256:${sha('realtime=v1')}`,
    ]);
    expect(ev['allowlist_version']).toBe(OPENAI_BETA_POLICY_VERSION);
  });

  it('BETA-02: known (global) + unknown tokens → forwarded intact; truthful known source only; one marker', async () => {
    const hv = 'test-global-beta, mystery=v9';
    const res = await post(govPolicyUrl, '/passthrough/openai/v1/responses', RESP(), { 'openai-beta': hv });
    expect(res.status).toBe(200);
    expect(captured?.headers['openai-beta']).toBe(hv);
    const ev = invoked();
    expect(ev['beta_allowlist_sources']).toEqual([
      { beta_token: 'test-global-beta', source: 'global_allowlist', policy_at_resolution: 'global_allowlist' },
    ]);
    expect(ev['risk_escalation_reasons']).toEqual([`beta:unknown_token:sha256:${sha('mystery=v9')}`]);
  });

  it('BETA-03/04: verification_required + org_override_allowed-without-override → Native forward + markers', async () => {
    const hv = 'test-verify-beta, test-override-beta';
    const res = await post(govPolicyUrl, '/passthrough/openai/v1/responses', RESP(), { 'openai-beta': hv });
    expect(res.status).toBe(200);
    expect(providerCalls).toBe(1);
    expect(invoked()['risk_escalation_reasons']).toEqual([
      `beta:verification_required:sha256:${sha('test-verify-beta')}`,
      `beta:override_absent_native_forward:sha256:${sha('test-override-beta')}`,
    ]);
  });

  it('BETA-06 / DENY-01: hard_denied floor → 403 explicit, provider NOT called, beta_denied diagnostic + durable blocked v4', async () => {
    const body = RESP();
    const res = await post(govPolicyUrl, '/passthrough/openai/v1/responses', body, { 'openai-beta': 'test-computer-use-beta' });
    expect(res.status).toBe(403);
    expect(providerCalls).toBe(0);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j['error']).toBe('beta_denied');
    expect(j['denied']).toEqual([
      { beta_token: 'test-computer-use-beta', policy_at_resolution: 'hard_denied', reason_code: 'hard_denied' },
    ]);
    expect(evOfType('passthrough.beta_denied')).toHaveLength(1);
    const ev = invoked();
    expect(PassthroughInvokedSchema.safeParse(ev).success).toBe(true);
    expect(ev).toMatchObject({
      capability_level: 'passthrough_audited',
      capability_id: 'openai.responses.create',
      enforcement_decision: 'blocked',
      body_forward_mode: 'blocked',
      status_code: 403,
      is_stream: false,
      native_request_hash: sha(body),
      credential_source: 'not_resolved_pre_provider_block',
      beta_allowlist_sources: [],
    });
    expect(ev['native_response_hash']).toBeUndefined();
    expect(ev['provider_request_id']).toBeUndefined();
    expect(ev['risk_escalation_reasons']).toEqual([`beta:hard_denied:sha256:${sha('test-computer-use-beta')}`]);
  });

  it('BETA-07: no header → unchanged behavior', async () => {
    const res = await post(govUrl, '/passthrough/openai/v1/responses', RESP());
    expect(res.status).toBe(200);
    expect(captured?.headers['openai-beta']).toBeUndefined();
    const ev = invoked();
    expect(ev['beta_allowlist_sources']).toEqual([]);
    expect(ev['risk_escalation_reasons']).toEqual([]);
  });

  it('BETA-08: an arbitrary client token is NOT stored raw in evidence; marker bounded and non-enforcing', async () => {
    const nasty = 'zz=' + 'q'.repeat(3000) + '<script>';
    const res = await post(govUrl, '/passthrough/openai/v1/responses', RESP(), { 'openai-beta': nasty });
    expect(res.status).toBe(200);
    const ev = invoked();
    const serialized = JSON.stringify(ev);
    expect(serialized).not.toContain('q'.repeat(100));
    expect(serialized).not.toContain('<script>');
    const reasons = ev['risk_escalation_reasons'] as string[];
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/^beta:unknown_token:sha256:[0-9a-f]{64}$/);
    expect(ev['effective_risk_class']).toBe(ev['base_risk_class']);
    expect(ev['enforcement_decision']).toBe('observe');
  });
});

describe('TOOLS — non-computer tools classify + forward; computer use is the only floor', () => {
  it('representative non-computer tools on /v1/responses → provider reached, classifications + risk preserved, taxonomy v3', async () => {
    const tools = [
      { type: 'function', name: 'get_weather', parameters: { type: 'object' } },
      { type: 'web_search' },
      { type: 'file_search', vector_store_ids: ['vs_1'] },
      { type: 'tool_search' },
      { type: 'code_interpreter', container: { type: 'auto' } },
      { type: 'shell' },
      { type: 'apply_patch' },
      { type: 'mcp', server_label: 'x', server_url: 'https://example.invalid' },
      { type: 'image_generation' }, // typed_unknown (no dedicated v4 enum)
      { type: null },
    ];
    const body = RESP({ tools });
    const res = await post(govUrl, '/passthrough/openai/v1/responses', body);
    expect(res.status).toBe(200);
    expect(providerCalls).toBe(1);
    expect(captured?.rawBody.equals(body)).toBe(true);
    expect(evOfType('tool.validation_blocked')).toHaveLength(0);
    const ev = invoked();
    expect(ev['tools_taxonomy_version']).toBe(KNOWN_OPENAI_TAXONOMY_VERSION);
    expect(ev['tools_taxonomy_version']).toBe(
      'openai.tools_taxonomy:schema_version=3:m1_noncomputer_forward_computer_use_floor',
    );
    const cls = ev['detected_tool_classifications'] as Array<Record<string, unknown>>;
    expect(cls.map((c) => [c['classification'], c['contributed_risk_class'], c['decision']])).toEqual([
      ['function_responses', 'C', 'allowed'],
      ['openai_provider_hosted_web_search', 'C', 'allowed'],
      ['openai_provider_hosted_file_search', 'B', 'allowed'],
      ['openai_provider_hosted_tool_search', 'B', 'allowed'],
      ['openai_provider_hosted_code_interpreter', 'C', 'allowed'],
      ['openai_provider_hosted_hosted_shell', 'D', 'allowed'],
      ['openai_provider_hosted_apply_patch', 'C', 'allowed'],
      ['openai_provider_hosted_mcp', 'D', 'allowed'],
      ['openai_typed_unknown', 'C', 'allowed'],
      ['openai_typed_unknown', 'C', 'allowed'],
    ]);
    expect(ev['effective_risk_class']).toBe('D');
    expect(ev['enforcement_decision']).toBe('observe');
  });

  it('DENY-02: computer_use_preview → 403 explicit, provider NOT called, tool.validation_blocked + durable blocked v4', async () => {
    const body = RESP({ tools: [{ type: 'computer_use_preview', display_width: 1, display_height: 1, environment: 'browser' }] });
    const res = await post(govUrl, '/passthrough/openai/v1/responses', body);
    expect(res.status).toBe(403);
    expect(providerCalls).toBe(0);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j['error']).toBe('tool_blocked_until_governance_primitive');
    expect((j['blocked'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      tool_index: 0,
      tool_type: 'computer_use_preview',
      classification: 'openai_provider_hosted_computer_use',
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
      tools_taxonomy_version: KNOWN_OPENAI_TAXONOMY_VERSION,
      credential_source: 'not_resolved_pre_provider_block',
    });
  });

  it('DENY-03: STREAMING computer-use block → 403 (not 500), v4 is_stream=true, stream_final_hash=SHA256(empty), no stream_outcome', async () => {
    const body = RESP({ stream: true, tools: [{ type: 'computer_use_preview' }] });
    const res = await post(govUrl, '/passthrough/openai/v1/responses', body);
    expect(res.status).toBe(403);
    expect(providerCalls).toBe(0);
    const ev = invoked();
    expect(PassthroughInvokedSchema.safeParse(ev).success).toBe(true);
    expect(ev['capability_id']).toBe('openai.responses.stream');
    expect(ev['is_stream']).toBe(true);
    expect(ev['stream_final_hash']).toBe(SHA256_EMPTY);
    expect(ev['stream_outcome']).toBeUndefined();
    expect(ev['enforcement_decision']).toBe('blocked');
  });
});

describe('ROUTE — auth before registry disclosure; method mismatch is a client contract error', () => {
  it('ROUTE-01: unauthenticated request to an UNKNOWN path → 401 auth_error (no registry disclosure)', async () => {
    const res = await post(govUrl, '/passthrough/openai/v1/batches', RESP(), { 'x-test-auth': 'fail' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('auth_error');
  });

  it('ROUTE-01b: unauthenticated request to a KNOWN path → identical 401', async () => {
    const res = await post(govUrl, '/passthrough/openai/v1/responses', RESP(), { 'x-test-auth': 'fail' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('auth_error');
  });

  it('ROUTE-02: authenticated unknown path → 404 capability_not_registered (no path expansion)', async () => {
    const res = await post(govUrl, '/passthrough/openai/v1/batches', RESP());
    expect(res.status).toBe(404);
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('capability_not_registered');
    expect(providerCalls).toBe(0);
  });

  it('ROUTE-03: known path + unsupported method → 405 method_not_allowed + truthful Allow, NEVER 500', async () => {
    const res = await fetch(`${govUrl}/passthrough/openai/v1/responses`, { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(((await res.json()) as Record<string, unknown>)['error']).toBe('method_not_allowed');

    const res2 = await fetch(`${govUrl}/passthrough/openai/v1/models/gpt-x`, { method: 'POST' });
    expect(res2.status).toBe(405);
    expect(res2.headers.get('allow')).toBe('GET, DELETE');
    expect(providerCalls).toBe(0);
    expect(auditEvents).toHaveLength(0);
  });
});
