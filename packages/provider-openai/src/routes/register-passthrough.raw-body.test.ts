// Raw-body preservation regression tests for the OpenAI passthrough route.
//
// These tests exercise the REAL socket path: a node:http fake provider on
// loopback + a real Fastify instance with registerOpenAIPassthrough, driven by
// real `fetch` (NOT app.inject). They prove that for `application/json` the
// client's exact bytes are forwarded byte-for-byte and that
// `native_request_hash` attests those original bytes (not a re-serialized body).
//
// Scope: non-compressed JSON. `Content-Encoding` (gzip/deflate/br, non-stream +
// stream) is covered by register-passthrough.content-encoding.test.ts (M1 FB-3,
// closes the CT-005 gap).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerOpenAIPassthrough, type OpenAIPassthroughDeps } from './register-passthrough.js';
import type { TenantContext } from '../passthrough/audit-emit.js';

type Captured = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  rawBody: Buffer;
};
type FakeResponse = { status: number; headers: Record<string, string>; body: Buffer };

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
function defaultResponse(): FakeResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json', 'openai-request-id': 'req_fake_1' },
    body: Buffer.from('{"id":"resp_fixture","ok":true,"extra_provider_field":"kept"}', 'utf8'),
  };
}

let fake: http.Server;
let app: FastifyInstance;
let govUrl: string;
let captured: Captured | null = null;
let fakeResponse: FakeResponse = defaultResponse();
const auditEvents: unknown[] = [];

const tenant: TenantContext = {
  org_id: '00000000-0000-4000-8000-000000000001',
  user_id: '00000000-0000-4000-8000-000000000002',
  tier: 'enterprise',
  operational_mode: 'production',
};

function invokedEvent(): Record<string, unknown> {
  const ev = auditEvents.find(
    (e): e is Record<string, unknown> =>
      typeof e === 'object' && e !== null && 'native_request_hash' in e,
  );
  if (!ev) throw new Error('no passthrough.invoked audit event captured');
  return ev;
}
function requireCaptured(): Captured {
  if (!captured) throw new Error('fake provider captured no request');
  return captured;
}
function eventOfType(type: string): Record<string, unknown> | undefined {
  return auditEvents.find(
    (e): e is Record<string, unknown> =>
      typeof e === 'object' && e !== null && (e as Record<string, unknown>)['event_type'] === type,
  );
}

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    req.on('end', () => {
      captured = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        rawBody: Buffer.concat(chunks),
      };
      res.writeHead(fakeResponse.status, fakeResponse.headers);
      res.end(fakeResponse.body);
    });
    req.on('error', () => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', () => resolve()));
  const fakeAddr = fake.address() as AddressInfo;
  const fakeUrl = `http://127.0.0.1:${fakeAddr.port}`;

  const deps: OpenAIPassthroughDeps = {
    upstreamBaseUrl: fakeUrl,
    resolveTenant: async () => tenant,
    resolveProviderKey: async () => ({ apiKey: 'harness-fake-provider-key', source: 'platform_env' }),  // Point 4: non-coincidental source (fails vs the old hardcode)
    activeOverridesLoader: async () => [],
    emitAuditEvent: (ev: unknown) => {
      auditEvents.push(ev);
    },
  };

  app = Fastify({ logger: false });
  // Register exactly like apps/api/src/server.ts does (encapsulated plugin).
  await app.register(async (instance) => {
    await registerOpenAIPassthrough(instance, deps);
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const govAddr = app.server.address() as AddressInfo;
  govUrl = `http://127.0.0.1:${govAddr.port}`;
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((resolve) => fake.close(() => resolve()));
});

beforeEach(() => {
  captured = null;
  auditEvents.length = 0;
  fakeResponse = defaultResponse();
});

describe('OpenAI passthrough raw-body preservation (real socket, app.listen + fetch)', () => {
  it('forwards application/json byte-for-byte and hashes the ORIGINAL client bytes', async () => {
    const raw =
      '{\n    "model"  :  "gpt-x-fixture",\n  "z_unknown_field":  {"nested": true},\n      "messages": [ { "role":"user", "content":"hi" } ],\n  "experimental_array": [1,  2,   3]\n}';
    const sentRawBody = Buffer.from(raw, 'utf8');

    const res = await fetch(`${govUrl}/passthrough/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-govai-api-key': 'fake-govai-key' },
      body: sentRawBody,
    });
    expect(res.status).toBe(200);

    const cap = requireCaptured();
    // Canonical proof: bytes received by the provider == bytes sent by the client.
    expect(Buffer.compare(cap.rawBody, sentRawBody)).toBe(0);
    expect(cap.url).toBe('/v1/chat/completions');

    // Audit hash attests the ORIGINAL client bytes (== forwarded bytes).
    const ev = invokedEvent();
    expect(ev['native_request_hash']).toBe(sha256(sentRawBody));
    expect(ev['native_request_hash']).toBe(sha256(cap.rawBody));
    expect(ev['body_forward_mode']).toBe('raw');

    // Only AFTER byte equality: semantic / unknown-field assertions.
    const parsed = JSON.parse(cap.rawBody.toString('utf8')) as Record<string, unknown>;
    expect(parsed['model']).toBe('gpt-x-fixture');
    expect(parsed['z_unknown_field']).toEqual({ nested: true });
    expect(parsed['experimental_array']).toEqual([1, 2, 3]);
    // No injected caps/defaults when the client did not send them.
    expect('max_tokens' in parsed).toBe(false);
    expect('max_completion_tokens' in parsed).toBe(false);
    expect('temperature' in parsed).toBe(false);
  });

  it('preserves bytes for application/json; charset=utf-8', async () => {
    const raw = '{\n  "model": "gpt-x",\n  "messages": [ ]\n}';
    const sentRawBody = Buffer.from(raw, 'utf8');

    const res = await fetch(`${govUrl}/passthrough/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: sentRawBody,
    });
    expect(res.status).toBe(200);

    const cap = requireCaptured();
    expect(Buffer.compare(cap.rawBody, sentRawBody)).toBe(0);
    expect(invokedEvent()['native_request_hash']).toBe(sha256(sentRawBody));
  });

  it('preserves upstream status, headers, and response body bytes', async () => {
    fakeResponse = {
      status: 201,
      headers: {
        'content-type': 'application/json',
        'x-provider-custom': 'v1',
        'openai-request-id': 'req_xyz',
      },
      body: Buffer.from('{"id":"r1","native":true,"extra_provider_field":"kept"}', 'utf8'),
    };
    const sentRawBody = Buffer.from('{"model":"gpt-x","messages":[]}', 'utf8');

    const res = await fetch(`${govUrl}/passthrough/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: sentRawBody,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-provider-custom')).toBe('v1');
    const respBuf = Buffer.from(await res.arrayBuffer());
    expect(respBuf.toString('utf8')).toBe('{"id":"r1","native":true,"extra_provider_field":"kept"}');
  });

  it('does NOT silently broaden vendor JSON (application/vnd.openai+json stays unsupported)', async () => {
    const sentRawBody = Buffer.from('{"model":"gpt-x"}', 'utf8');
    const res = await fetch(`${govUrl}/passthrough/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.openai+json' },
      body: sentRawBody,
    });
    // No parser matches application/vnd.openai+json → Fastify 415, NOT forwarded.
    expect(res.status).toBe(415);
    expect(captured).toBeNull();
  });

  it('multipart sanity: multipart/form-data still arrives as a Buffer and forwards byte-for-byte', async () => {
    // The application/json fix does not touch the multipart parser; this proves
    // multipart (/v1/files upload) is unchanged and still byte-preserved.
    const boundary = 'testboundary123';
    const multipart =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="purpose"\r\n\r\n' +
      'user_data\r\n' +
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="x.txt"\r\n' +
      'Content-Type: text/plain\r\n\r\n' +
      'hello-bytes\r\n' +
      `--${boundary}--\r\n`;
    const sentRawBody = Buffer.from(multipart, 'utf8');

    const res = await fetch(`${govUrl}/passthrough/openai/v1/files`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: sentRawBody,
    });
    expect(res.status).toBe(200);

    const cap = requireCaptured();
    expect(Buffer.compare(cap.rawBody, sentRawBody)).toBe(0);
    expect(cap.url).toBe('/v1/files');
    expect(invokedEvent()['body_forward_mode']).toBe('raw');
    expect(invokedEvent()['native_request_hash']).toBe(sha256(sentRawBody));
  });

  it('does NOT treat a nested "stream": true as streaming (reads top-level stream only)', async () => {
    // With the old substring regex this body false-positived as a stream request.
    // Now only the top-level `stream` field is read, so this is non-streaming.
    const raw =
      '{\n  "model": "gpt-test",\n  "messages": [ { "role": "user", "content": { "nested": { "stream": true } } } ],\n  "x_unknown": true\n}';
    const sentRawBody = Buffer.from(raw, 'utf8');

    const res = await fetch(`${govUrl}/passthrough/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: sentRawBody,
    });
    expect(res.status).toBe(200);

    const cap = requireCaptured();
    expect(Buffer.compare(cap.rawBody, sentRawBody)).toBe(0);
    const ev = invokedEvent();
    expect(ev['native_request_hash']).toBe(sha256(sentRawBody));
    expect(ev['is_stream']).toBe(false);
    // F1: the passthrough producer emits the resolver's source (the mock
    // returns a tenant credential), not a hardcoded literal by coincidence.
    expect(ev['credential_source']).toBe('platform_env');
  });

  it('classifies tools from the raw Buffer path (valid JSON with top-level tools)', async () => {
    // M1 (OD-1=A): the ONLY tool the classifier blocks is provider-hosted
    // computer use (`computer_use_preview` on /v1/responses). Reaching that 403
    // proves the classifier parsed tools from the raw Buffer; the blocked v4
    // `passthrough.invoked` proves the deny is durably evidenced (FB-4).
    const raw =
      '{"model":"gpt-test","input":"hi","tools":[{"type":"computer_use_preview","display_width":1,"display_height":1,"environment":"browser"}]}';
    const sentRawBody = Buffer.from(raw, 'utf8');

    const res = await fetch(`${govUrl}/passthrough/openai/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: sentRawBody,
    });
    expect(res.status).toBe(403);
    expect(eventOfType('tool.validation_blocked')).toBeDefined();
    // Blocked before forward → the provider is never called.
    expect(captured).toBeNull();
    const ev = invokedEvent();
    expect(ev['enforcement_decision']).toBe('blocked');
    expect(ev['body_forward_mode']).toBe('blocked');
    expect(ev['status_code']).toBe(403);
    expect(ev['native_request_hash']).toBe(sha256(sentRawBody));
    expect(ev['native_response_hash']).toBeUndefined();
    expect(ev['provider_request_id']).toBeUndefined();
  });

  it('M1: a non-function tool on Chat Completions (web_search) is typed_unknown → forwarded byte-for-byte, provider decides', async () => {
    const raw =
      '{"model":"gpt-test","messages":[{"role":"user","content":"hi"}],"tools":[{"type":"web_search"}]}';
    const sentRawBody = Buffer.from(raw, 'utf8');
    const res = await fetch(`${govUrl}/passthrough/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: sentRawBody,
    });
    expect(res.status).toBe(200);
    expect(eventOfType('tool.validation_blocked')).toBeUndefined();
    const cap = requireCaptured();
    expect(Buffer.compare(cap.rawBody, sentRawBody)).toBe(0);
    const ev = invokedEvent();
    const cls = ev['detected_tool_classifications'] as Array<Record<string, unknown>>;
    expect(cls[0]?.['classification']).toBe('openai_typed_unknown');
    expect(cls[0]?.['decision']).toBe('allowed');
  });

  it('forwards valid tools byte-for-byte after governance inspection', async () => {
    // INV-006 / INV-009 positive case. `type:"function"` is the only tool Chat
    // Completions allows, so the classifier ALLOWS it; the request must then be
    // forwarded to the provider byte-for-byte — no 403, no mutation, no
    // re-serialization, unknown/future fields intact. This is the closest case to
    // the provider-native promise: when governance permits the request, GovAI is
    // indistinguishable from the native API.
    const raw =
      '{\n    "model"  :  "gpt-x-fixture",\n  "z_unknown_field":  {"nested": true},\n  "tools": [ { "type": "function", "function": { "name":"get_weather", "description":"Get the weather", "parameters": { "type":"object", "properties": { "location": { "type":"string" } }, "required":["location"] } } } ],\n      "messages": [ { "role":"user", "content":"hi" } ],\n  "experimental_array": [1,  2,   3]\n}';
    const sentRawBody = Buffer.from(raw, 'utf8');

    const res = await fetch(`${govUrl}/passthrough/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: sentRawBody,
    });
    // Allowed → forwarded (NOT blocked at 403).
    expect(res.status).toBe(200);
    expect(eventOfType('tool.validation_blocked')).toBeUndefined();

    const cap = requireCaptured();
    // Canonical proof: the provider received the client's exact bytes.
    expect(Buffer.compare(cap.rawBody, sentRawBody)).toBe(0);
    expect(cap.url).toBe('/v1/chat/completions');

    const ev = invokedEvent();
    expect(ev['native_request_hash']).toBe(sha256(sentRawBody));
    expect(ev['native_request_hash']).toBe(sha256(cap.rawBody));
    expect(ev['body_forward_mode']).toBe('raw');

    // The classifier ran and ALLOWED the function tool (decision === allowed).
    const classifications = ev['detected_tool_classifications'] as Array<{
      classification: string;
      decision: string;
    }>;
    expect(Array.isArray(classifications)).toBe(true);
    const fn = classifications.find((c) => c.classification === 'function_chat_completions');
    expect(fn).toBeDefined();
    expect(fn?.decision).toBe('allowed');

    // After byte equality: the valid tool and unknown/future fields survive intact.
    const parsed = JSON.parse(cap.rawBody.toString('utf8')) as Record<string, unknown>;
    const tools = parsed['tools'] as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    const firstTool = tools[0] as Record<string, unknown>;
    expect(firstTool['type']).toBe('function');
    expect((firstTool['function'] as Record<string, unknown>)['name']).toBe('get_weather');
    expect(parsed['z_unknown_field']).toEqual({ nested: true });
    expect(parsed['experimental_array']).toEqual([1, 2, 3]);
    // No hidden defaults/caps injected when the client did not send them.
    expect('max_tokens' in parsed).toBe(false);
    expect('max_completion_tokens' in parsed).toBe(false);
    expect('temperature' in parsed).toBe(false);
  });

  it('forwards malformed JSON byte-for-byte instead of rejecting at the edge', async () => {
    // Provider-native passthrough decision: GovAI does not parse-validate the
    // body. A malformed JSON request is forwarded unchanged; the PROVIDER decides.
    fakeResponse = {
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        '{"error":{"message":"provider-native 400","type":"invalid_request_error"}}',
        'utf8',
      ),
    };
    const raw = '{ "model": "gpt-test", "messages": [ ';
    const sentRawBody = Buffer.from(raw, 'utf8');

    const res = await fetch(`${govUrl}/passthrough/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: sentRawBody,
    });
    // GovAI relays the PROVIDER's 400, not a GovAI edge-rejection.
    expect(res.status).toBe(400);

    const cap = requireCaptured();
    expect(Buffer.compare(cap.rawBody, sentRawBody)).toBe(0);
    const ev = invokedEvent();
    expect(ev['native_request_hash']).toBe(sha256(sentRawBody));
    expect(ev['body_forward_mode']).toBe('raw');
    const respBuf = Buffer.from(await res.arrayBuffer());
    expect(respBuf.toString('utf8')).toContain('provider-native 400');
  });

  it('strips hop-by-hop response headers while preserving status, body, and allowed headers (INV-007)', async () => {
    // INV-007. The forwarder must drop hop-by-hop headers from the provider
    // response. `proxy-authenticate` / `proxy-authorization` / `te` / `trailer` /
    // `upgrade` are surfaced by undici on the fetch Response (so the forwarder
    // actually receives them) and are NOT re-added by Node to GovAI's own
    // response — so their absence here proves GovAI's HOP_BY_HOP policy, not
    // incidental runtime stripping. `connection` is also hop-by-hop, but Node
    // emits its OWN Connection header on GovAI's response, so we cannot assert
    // null. Instead the fake sends a sentinel value the runtime never emits
    // (`x-govai-hop-by-hop-sentinel`) and we assert it does not reach the client,
    // which makes a connection leak observable (per Codex review on PR #83).
    // `keep-alive` / `transfer-encoding` / `content-length` are
    // runtime-managed/recomputed and remain unasserted.
    fakeResponse = {
      status: 201,
      headers: {
        'content-type': 'application/json',
        'x-provider-custom': 'preserved',
        connection: 'x-govai-hop-by-hop-sentinel',
        'keep-alive': 'timeout=5',
        'proxy-authenticate': 'TestScheme realm=harness',
        'proxy-authorization': 'TestScheme harness-token',
        te: 'trailers',
        trailer: 'Expires',
        upgrade: 'websocket',
      },
      body: Buffer.from('{"id":"r2","native":true}', 'utf8'),
    };
    const sentRawBody = Buffer.from('{"model":"gpt-x","messages":[]}', 'utf8');

    const res = await fetch(`${govUrl}/passthrough/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: sentRawBody,
    });

    // status + allowed header + body are preserved
    expect(res.status).toBe(201);
    expect(res.headers.get('x-provider-custom')).toBe('preserved');
    expect(Buffer.from(await res.arrayBuffer()).toString('utf8')).toBe('{"id":"r2","native":true}');

    // hop-by-hop headers received from the provider must NOT reach the client
    expect(res.headers.get('proxy-authenticate')).toBeNull();
    expect(res.headers.get('proxy-authorization')).toBeNull();
    expect(res.headers.get('te')).toBeNull();
    expect(res.headers.get('trailer')).toBeNull();
    expect(res.headers.get('upgrade')).toBeNull();

    // `connection` is re-emitted by Node on GovAI's own response, so we assert the
    // distinguishable upstream sentinel value did NOT leak (not that it is null).
    const connection = (res.headers.get('connection') ?? '').toLowerCase();
    expect(connection).not.toContain('x-govai-hop-by-hop-sentinel');
  });
});
