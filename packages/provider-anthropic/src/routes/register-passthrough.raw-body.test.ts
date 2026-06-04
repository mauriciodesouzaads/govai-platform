// Raw-body preservation regression tests for the Anthropic passthrough route.
//
// Real socket path: a node:http fake provider on loopback + a real Fastify
// instance with registerAnthropicPassthrough, driven by real `fetch` (NOT
// app.inject). Proves application/json bytes are forwarded byte-for-byte, that
// `native_request_hash` attests the original client bytes, and that the
// client's `max_tokens` is preserved (never coerced to 1024).
//
// Scope: non-compressed JSON. `Content-Encoding: gzip` is out of scope for this
// phase (reported as a non-blocking gap).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  registerAnthropicPassthrough,
  type AnthropicPassthroughDeps,
} from './register-passthrough.js';
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
    headers: { 'content-type': 'application/json', 'anthropic-request-id': 'req_fake_1' },
    body: Buffer.from('{"id":"msg_fixture","ok":true,"extra_provider_field":"kept"}', 'utf8'),
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

  const deps: AnthropicPassthroughDeps = {
    upstreamBaseUrl: fakeUrl,
    resolveTenant: async () => tenant,
    resolveProviderKey: async () => 'harness-fake-provider-key',
    activeOverridesLoader: async () => [],
    emitAuditEvent: (ev: unknown) => {
      auditEvents.push(ev);
    },
  };

  app = Fastify({ logger: false });
  await app.register(async (instance) => {
    await registerAnthropicPassthrough(instance, deps);
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

describe('Anthropic passthrough raw-body preservation (real socket, app.listen + fetch)', () => {
  it('forwards application/json byte-for-byte, hashes ORIGINAL bytes, preserves max_tokens=777', async () => {
    const raw =
      '{\n    "model"  :  "claude-x-fixture",\n  "max_tokens":   777,\n  "z_unknown_field":  {"nested": true},\n      "messages": [ { "role":"user", "content":"hi" } ],\n  "experimental_array": [1,  2,   3]\n}';
    const sentRawBody = Buffer.from(raw, 'utf8');

    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-govai-api-key': 'fake-govai-key' },
      body: sentRawBody,
    });
    expect(res.status).toBe(200);

    const cap = requireCaptured();
    expect(Buffer.compare(cap.rawBody, sentRawBody)).toBe(0);
    expect(cap.url).toBe('/v1/messages');

    const ev = invokedEvent();
    expect(ev['native_request_hash']).toBe(sha256(sentRawBody));
    expect(ev['native_request_hash']).toBe(sha256(cap.rawBody));
    expect(ev['body_forward_mode']).toBe('raw');

    // Only AFTER byte equality: semantic assertions.
    const parsed = JSON.parse(cap.rawBody.toString('utf8')) as Record<string, unknown>;
    expect(parsed['model']).toBe('claude-x-fixture');
    expect(parsed['max_tokens']).toBe(777);
    expect(parsed['z_unknown_field']).toEqual({ nested: true });
    expect(parsed['experimental_array']).toEqual([1, 2, 3]);
    // No 1024 cap injected anywhere in the forwarded bytes.
    expect(cap.rawBody.toString('utf8').includes('1024')).toBe(false);
  });

  it('preserves bytes for application/json; charset=utf-8', async () => {
    const raw = '{\n  "model": "claude-x",\n  "max_tokens": 777,\n  "messages": [ ]\n}';
    const sentRawBody = Buffer.from(raw, 'utf8');

    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/messages`, {
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
      status: 202,
      headers: {
        'content-type': 'application/json',
        'x-provider-custom': 'a1',
        'anthropic-request-id': 'req_xyz',
      },
      body: Buffer.from('{"id":"m1","native":true,"extra_provider_field":"kept"}', 'utf8'),
    };
    const sentRawBody = Buffer.from('{"model":"claude-x","max_tokens":777,"messages":[]}', 'utf8');

    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: sentRawBody,
    });
    expect(res.status).toBe(202);
    expect(res.headers.get('x-provider-custom')).toBe('a1');
    const respBuf = Buffer.from(await res.arrayBuffer());
    expect(respBuf.toString('utf8')).toBe('{"id":"m1","native":true,"extra_provider_field":"kept"}');
  });

  it('does NOT treat a nested "stream": true as streaming (reads top-level stream only)', async () => {
    // With the old substring regex this body false-positived as a stream request.
    // Now only the top-level `stream` field is read, so this is non-streaming.
    const raw =
      '{\n  "model": "claude-test",\n  "max_tokens": 777,\n  "messages": [ { "role": "user", "content": [ { "type": "text", "text": "hi", "meta": { "stream": true } } ] } ]\n}';
    const sentRawBody = Buffer.from(raw, 'utf8');

    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/messages`, {
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
  });

  it('classifies tools from the raw Buffer path (valid JSON with top-level tools)', async () => {
    // tool with type:null → classifier blocks (typed_unknown). Reaching that 403
    // proves the classifier parsed tools from the raw Buffer.
    const raw =
      '{"model":"claude-test","max_tokens":777,"messages":[{"role":"user","content":"hi"}],"tools":[{"type":null}]}';
    const sentRawBody = Buffer.from(raw, 'utf8');

    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: sentRawBody,
    });
    expect(res.status).toBe(403);
    expect(eventOfType('tool.validation_blocked')).toBeDefined();
    expect(captured).toBeNull();
  });

  it('forwards valid tools byte-for-byte after governance inspection', async () => {
    // INV-006 / INV-009 positive case. A client-defined Anthropic tool (no `type`
    // field) is ALLOWED by the classifier, so the request must be forwarded to the
    // provider byte-for-byte — no 403, no mutation, no re-serialization, with
    // unknown/future fields and `max_tokens` intact. This is the closest case to
    // the provider-native promise: when governance permits the request, GovAI is
    // indistinguishable from the native API.
    const raw =
      '{\n    "model"  :  "claude-x-fixture",\n  "max_tokens":   777,\n  "z_unknown_field":  {"nested": true},\n  "tools": [ { "name":"get_weather", "description":"Get the weather", "input_schema": { "type":"object", "properties": { "location": { "type":"string" } }, "required":["location"] } } ],\n      "messages": [ { "role":"user", "content":"hi" } ],\n  "experimental_array": [1,  2,   3]\n}';
    const sentRawBody = Buffer.from(raw, 'utf8');

    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/messages`, {
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
    expect(cap.url).toBe('/v1/messages');

    const ev = invokedEvent();
    expect(ev['native_request_hash']).toBe(sha256(sentRawBody));
    expect(ev['native_request_hash']).toBe(sha256(cap.rawBody));
    expect(ev['body_forward_mode']).toBe('raw');

    // The classifier ran and ALLOWED the client-defined tool (decision === allowed).
    const classifications = ev['detected_tool_classifications'] as Array<{
      classification: string;
      decision: string;
    }>;
    expect(Array.isArray(classifications)).toBe(true);
    const clientDefined = classifications.find((c) => c.classification === 'client_defined');
    expect(clientDefined).toBeDefined();
    expect(clientDefined?.decision).toBe('allowed');

    // After byte equality: the valid tool, unknown/future fields, and max_tokens survive.
    const parsed = JSON.parse(cap.rawBody.toString('utf8')) as Record<string, unknown>;
    const tools = parsed['tools'] as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    const firstTool = tools[0] as Record<string, unknown>;
    expect(firstTool['name']).toBe('get_weather');
    // A client-defined tool has no `type` field — GovAI must NOT normalize one in.
    expect('type' in firstTool).toBe(false);
    expect(parsed['z_unknown_field']).toEqual({ nested: true });
    expect(parsed['experimental_array']).toEqual([1, 2, 3]);
    expect(parsed['max_tokens']).toBe(777);
    // No 1024 cap injected anywhere in the forwarded bytes.
    expect(cap.rawBody.toString('utf8').includes('1024')).toBe(false);
  });

  it('forwards malformed JSON byte-for-byte instead of rejecting at the edge', async () => {
    // Provider-native passthrough decision: a malformed JSON request is forwarded
    // unchanged; the PROVIDER decides (no GovAI edge-rejection on parse failure).
    fakeResponse = {
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        '{"type":"error","error":{"type":"invalid_request_error","message":"provider-native 400"}}',
        'utf8',
      ),
    };
    const raw = '{ "model": "claude-test", "messages": [ ';
    const sentRawBody = Buffer.from(raw, 'utf8');

    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: sentRawBody,
    });
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
      status: 202,
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
      body: Buffer.from('{"id":"m2","native":true}', 'utf8'),
    };
    const sentRawBody = Buffer.from('{"model":"claude-x","max_tokens":777,"messages":[]}', 'utf8');

    const res = await fetch(`${govUrl}/passthrough/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: sentRawBody,
    });

    // status + allowed header + body are preserved
    expect(res.status).toBe(202);
    expect(res.headers.get('x-provider-custom')).toBe('preserved');
    expect(Buffer.from(await res.arrayBuffer()).toString('utf8')).toBe('{"id":"m2","native":true}');

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
