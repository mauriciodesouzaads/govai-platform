// Governed OpenAI surface — Foundation V1 M1 contract:
//   F2-01..03  recommendation vs APPLIED result over HTTP (OD-2=A, additive)
//   H-2        top-level stream detection only (no regex sniff, no Accept)
//   FB-2       non-computer tools reach governance (no stale pre-block)
//   §11.4      streaming pre-provider block is a truthful 403 (was a Rule-1 throw)
// Real socket on both hops (fake loopback provider + app.listen + fetch).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { PassthroughInvokedSchema } from '@govai/core-events';
import { registerOpenAIGoverned, type OpenAIGovernedDeps } from './register-governed.js';
import type { GovernedTenant } from './handle-responses.js';
import { SHA256_EMPTY } from '../passthrough/evidence-constants.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const OK = Buffer.from('{"id":"resp_1","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],"provider_field":"kept"}', 'utf8');
const SSE = Buffer.from('event: response.created\ndata: {"type":"response.created"}\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n', 'utf8');

let fake: http.Server;
let app: FastifyInstance;
let govUrl: string;
let providerCalls = 0;
let capturedBody: Buffer | null = null;
let fakeMode: 'json' | 'sse' = 'json';
const auditEvents: Array<Record<string, unknown>> = [];

function invoked(): Record<string, unknown> {
  const ev = auditEvents.find((e) => e['event_type'] === 'passthrough.invoked');
  if (!ev) throw new Error('no passthrough.invoked');
  return ev;
}
async function waitInvoked(): Promise<Record<string, unknown>> {
  for (let i = 0; i < 200; i++) {
    const ev = auditEvents.find((e) => e['event_type'] === 'passthrough.invoked');
    if (ev) return ev;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('no passthrough.invoked within 2s');
}

const MSG = (extra: Record<string, unknown> = {}) =>
  Buffer.from(JSON.stringify({ model: 'gpt-x', input: 'hi', ...extra }), 'utf8');

async function post(
  body: Buffer,
  tenantHdr: { tier: GovernedTenant['tier']; mode: GovernedTenant['operational_mode'] } = { tier: 'enterprise', mode: 'production' },
): Promise<Response> {
  return fetch(`${govUrl}/governed/openai/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-tier': tenantHdr.tier, 'x-test-mode': tenantHdr.mode },
    body,
  });
}

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      providerCalls++;
      capturedBody = Buffer.concat(chunks);
      if (fakeMode === 'sse') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'openai-request-id': 'req_s' });
        res.end(SSE);
      } else {
        res.writeHead(200, { 'content-type': 'application/json', 'openai-request-id': 'req_j' });
        res.end(OK);
      }
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  const deps: OpenAIGovernedDeps = {
    upstreamBaseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`,
    resolveTenant: async (req) => ({
      org_id: '00000000-0000-4000-8000-0000000000d2',
      tier: (req.headers['x-test-tier'] as GovernedTenant['tier']) ?? 'enterprise',
      operational_mode: (req.headers['x-test-mode'] as GovernedTenant['operational_mode']) ?? 'production',
    }),
    resolveProviderKey: async () => ({ apiKey: 'k', source: 'platform_env' }),
    dlpScan: async () => ({ findings: [] }),
    emitAuditEvent: (ev) => {
      auditEvents.push(ev as unknown as Record<string, unknown>);
    },
  };
  app = Fastify({ logger: false });
  await app.register(async (i) => registerOpenAIGoverned(i, deps));
  await app.listen({ port: 0, host: '127.0.0.1' });
  govUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((r) => fake.close(() => r()));
});

beforeEach(() => {
  providerCalls = 0;
  capturedBody = null;
  fakeMode = 'json';
  auditEvents.length = 0;
});

describe('F2 — recommendation vs applied (additive HTTP honesty)', () => {
  it('F2-01: a forwarded governed request keeps x-govai-enforcement-decision as the matrix RECOMMENDATION and adds x-govai-enforcement-applied=forwarded; provider body unchanged', async () => {
    // business + production + bash (D) → matrix says sandbox_required — a label
    // that is NOT executed today; the truth is exposed additively.
    const body = MSG({ tools: [{ type: 'mcp', server_label: 'x', server_url: 'https://example.invalid' }] });
    const res = await post(body, { tier: 'business', mode: 'production' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-govai-enforcement-decision')).toBe('sandbox_required');
    expect(res.headers.get('x-govai-enforcement-applied')).toBe('forwarded');
    expect(res.headers.get('x-govai-effective-risk-class')).toBe('D');
    expect(Buffer.from(await res.arrayBuffer()).equals(OK)).toBe(true);
    expect(providerCalls).toBe(1);
    expect(capturedBody?.equals(body)).toBe(true);
    const ev = invoked();
    expect(ev['enforcement_decision']).toBe('sandbox_required');
    expect(ev['body_forward_mode']).toBe('raw');
    // F2-04: the sealed v4 carries NO additive HTTP-only fields.
    expect(ev['enforcement_applied']).toBeUndefined();
    expect(ev['block_trigger']).toBeUndefined();
    expect(PassthroughInvokedSchema.safeParse(ev).success).toBe(true);
  });

  it('F2-02: a governance (matrix) block → 403 with enforcement_applied=blocked + block_trigger=governance_enforcement (+ headers)', async () => {
    // starter + production + bash (D) → blocked: a REAL matrix outcome.
    const body = MSG({ tools: [{ type: 'mcp', server_label: 'x', server_url: 'https://example.invalid' }] });
    const res = await post(body, { tier: 'starter', mode: 'production' });
    expect(res.status).toBe(403);
    expect(providerCalls).toBe(0);
    expect(res.headers.get('x-govai-enforcement-decision')).toBe('blocked');
    expect(res.headers.get('x-govai-enforcement-applied')).toBe('blocked');
    const j = (await res.json()) as Record<string, unknown>;
    expect(j).toMatchObject({
      error: 'governed_blocked',
      reason: 'enforcement_blocked:D',
      enforcement_applied: 'blocked',
      block_trigger: 'governance_enforcement',
    });
    const ev = invoked();
    expect(ev['enforcement_decision']).toBe('blocked');
    expect(ev['body_forward_mode']).toBe('blocked');
    expect(ev['block_trigger']).toBeUndefined();
  });

  it('F2-03: a computer-use tool block → 403 with block_trigger=tool_validation; the recommendation header stays the matrix label (not necessarily blocked)', async () => {
    const body = MSG({ tools: [{ type: 'computer_use_preview' }] });
    const res = await post(body, { tier: 'enterprise', mode: 'production' });
    expect(res.status).toBe(403);
    expect(providerCalls).toBe(0);
    // enterprise+production+D → enforce; computer-use floor lifts to sandbox_required.
    expect(res.headers.get('x-govai-enforcement-decision')).toBe('sandbox_required');
    expect(res.headers.get('x-govai-enforcement-applied')).toBe('blocked');
    const j = (await res.json()) as Record<string, unknown>;
    expect(j['block_trigger']).toBe('tool_validation');
    expect(j['enforcement_applied']).toBe('blocked');
    expect(j['reason']).toBe('tool_blocked:openai_provider_hosted_computer_use:capability_blocked_via_token');
    expect(invoked()['enforcement_decision']).toBe('blocked');
  });
});

describe('FB-2 governed — non-computer tools reach governance (no stale pre-block)', () => {
  it('code_interpreter + typed_unknown + function on enterprise/production → forwarded; matrix recommendation from real risk (enforce for C)', async () => {
    const body = MSG({
      tools: [
        { type: 'code_interpreter', container: { type: 'auto' } },
        { type: 'image_generation' },
        { type: 'function', name: 'my_tool', parameters: { type: 'object' } },
      ],
    });
    const res = await post(body, { tier: 'enterprise', mode: 'production' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-govai-enforcement-decision')).toBe('enforce');
    expect(res.headers.get('x-govai-enforcement-applied')).toBe('forwarded');
    expect(providerCalls).toBe(1);
    const cls = invoked()['detected_tool_classifications'] as Array<Record<string, unknown>>;
    expect(cls.map((c) => c['classification'])).toEqual([
      'openai_provider_hosted_code_interpreter',
      'openai_typed_unknown',
      'function_responses',
    ]);
    expect(cls.every((c) => c['decision'] === 'allowed')).toBe(true);
  });
});

describe('H-2 — governed stream detection is top-level only', () => {
  it('a NESTED "stream": true inside message content is NOT a streaming request (non-stream forward, is_stream=false)', async () => {
    const body = MSG({ input: 'please set "stream": true in your reply' });
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(Buffer.from(await res.arrayBuffer()).equals(OK)).toBe(true);
    expect(invoked()['is_stream']).toBe(false);
    expect(invoked()['capability_id']).toBe('openai.responses.create');
  });

  it('an Accept: text/event-stream header alone does NOT make it streaming', async () => {
    const res = await fetch(`${govUrl}/governed/openai/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: MSG(),
    });
    expect(res.status).toBe(200);
    expect(invoked()['is_stream']).toBe(false);
  });

  it('a top-level stream:true IS streaming (SSE relayed, is_stream=true, applied=forwarded header on the stream)', async () => {
    fakeMode = 'sse';
    const res = await post(MSG({ stream: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('x-govai-enforcement-applied')).toBe('forwarded');
    expect(Buffer.from(await res.arrayBuffer()).equals(SSE)).toBe(true);
    const ev = await waitInvoked();
    expect(ev['is_stream']).toBe(true);
    expect(ev['capability_id']).toBe('openai.responses.stream');
    expect(ev['stream_final_hash']).toBe(sha(SSE));
  });

  it('governed holds the ORIGINAL bytes: a whitespace/number-formatted body is forwarded byte-for-byte and native_request_hash attests the client bytes (no re-serialization)', async () => {
    const raw = Buffer.from(
      '{\n  "model" :  "gpt-x",\n  "max_output_tokens": 16.0,\n  "temperature": 1.50,\n  "input": "h\\u0069",\n  "z_future": {"nested": [1,  2]}\n}',
      'utf8',
    );
    const res = await post(raw);
    expect(res.status).toBe(200);
    expect(providerCalls).toBe(1);
    expect(capturedBody?.equals(raw)).toBe(true);
    expect(invoked()['native_request_hash']).toBe(sha(raw));
  });

  it('malformed JSON is NOT a new GovAI rejection — it is forwarded and the provider decides', async () => {
    const raw = Buffer.from('{"model":"gpt-x", not json', 'utf8');
    const res = await post(raw);
    expect(res.status).toBe(200);
    expect(providerCalls).toBe(1);
    expect(capturedBody?.equals(raw)).toBe(true);
    expect(invoked()['native_request_hash']).toBe(sha(raw));
  });
});

describe('§11.4 — streaming pre-provider governed block is truthful (was a schema throw → 500)', () => {
  it('stream:true + computer-use tool → 403 with a valid blocked v4: is_stream=true, stream_final_hash=SHA256(empty), no stream_outcome', async () => {
    const body = MSG({ stream: true, tools: [{ type: 'computer_use_preview' }] });
    const res = await post(body);
    expect(res.status).toBe(403);
    expect(providerCalls).toBe(0);
    expect(res.headers.get('x-govai-enforcement-applied')).toBe('blocked');
    const ev = invoked();
    expect(PassthroughInvokedSchema.safeParse(ev).success).toBe(true);
    expect(ev['capability_id']).toBe('openai.responses.stream');
    expect(ev['is_stream']).toBe(true);
    expect(ev['stream_final_hash']).toBe(SHA256_EMPTY);
    expect(ev['stream_outcome']).toBeUndefined();
    expect(ev['enforcement_decision']).toBe('blocked');
    expect(ev['body_forward_mode']).toBe('blocked');
  });
});
