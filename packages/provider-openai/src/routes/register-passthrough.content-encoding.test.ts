// Content-Encoding / real-HTTP transport transparency — Foundation V1 M1 FB-3
// (closes the H1 v2 CT-005 "policy gap"). ENC-01..ENC-11.
//
// Real socket path on BOTH hops: a node:http fake provider on loopback that
// (like a non-compliant provider) COMPRESSES its body regardless of
// `accept-encoding`, a real Fastify instance with registerOpenAIPassthrough
// (`app.listen`), and a real downstream node:http client that reads the wire
// headers GovAI actually emitted (NOT app.inject, which cannot observe them).
//
// Truth rule under test: GovAI must never relay DECODED bytes together with a
// stale `content-encoding` (or the stale `content-length` of the encoded
// representation), and must relay everything else (content-type, provider
// request id, rate-limit headers) untouched. Hashes are over the bytes GovAI
// actually processed / delivered.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  registerOpenAIPassthrough,
  type OpenAIPassthroughDeps,
} from './register-passthrough.js';
import type { TenantContext } from '../passthrough/audit-emit.js';

type Captured = { method: string; url: string; headers: http.IncomingHttpHeaders; rawBody: Buffer };
type FakeResponse = {
  status: number;
  headers: Record<string, string>;
  /** Either a single body or a list of chunks written with a small delay (stream). */
  body: Buffer | Buffer[];
};

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

const PLAIN_JSON = Buffer.from(
  JSON.stringify({ id: 'resp_fixture', ok: true, pad: 'x'.repeat(2048), extra_provider_field: 'kept' }),
  'utf8',
);
const SSE_PLAIN = Buffer.from(
  [
    'event: response.created\ndata: {"type":"response.created","pad":"' + 'y'.repeat(1024) + '"}\n\n',
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n',
    'event: response.completed\ndata: {"type":"response.completed"}\n\n',
  ].join(''),
  'utf8',
);

const USEFUL_HEADERS = {
  'openai-request-id': 'req_fake_enc_1',
  'x-ratelimit-remaining-requests': '41',
  'x-should-pass': 'yes',
};

let fake: http.Server;
let app: FastifyInstance;
let govPort: number;
let captured: Captured | null = null;
let fakeResponse: FakeResponse = { status: 200, headers: {}, body: PLAIN_JSON };
const auditEvents: unknown[] = [];

const tenant: TenantContext = {
  org_id: '00000000-0000-4000-8000-0000000000e3',
  user_id: '00000000-0000-4000-8000-0000000000e2',
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

/** Raw downstream HTTP client — returns wire status/headers + body bytes. */
function rawRequest(
  path: string,
  init: { method: string; headers: Record<string, string>; body?: Buffer },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: govPort, path, method: init.method, headers: init.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

const MESSAGES_BODY = Buffer.from(
  '{"model":"gpt-x","input":"hi"}',
  'utf8',
);
const MESSAGES_STREAM_BODY = Buffer.from(
  '{"model":"gpt-x","stream":true,"input":"hi"}',
  'utf8',
);

async function waitForInvoked(): Promise<Record<string, unknown>> {
  for (let i = 0; i < 100; i++) {
    const ev = auditEvents.find(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && 'native_request_hash' in e,
    );
    if (ev) return ev;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('no passthrough.invoked within 1s');
}

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      captured = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        rawBody: Buffer.concat(chunks),
      };
      res.writeHead(fakeResponse.status, fakeResponse.headers);
      if (Array.isArray(fakeResponse.body)) {
        const parts = [...fakeResponse.body];
        const tick = (): void => {
          const p = parts.shift();
          if (!p) {
            res.end();
            return;
          }
          res.write(p);
          setTimeout(tick, 5);
        };
        tick();
      } else {
        res.end(fakeResponse.body);
      }
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', () => resolve()));
  const fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

  const deps: OpenAIPassthroughDeps = {
    upstreamBaseUrl: fakeUrl,
    resolveTenant: async () => tenant,
    resolveProviderKey: async () => ({ apiKey: 'harness-fake-provider-key', source: 'platform_env' }),
    activeOverridesLoader: async () => [],
    emitAuditEvent: (ev: unknown) => {
      auditEvents.push(ev);
    },
  };
  app = Fastify({ logger: false });
  await app.register(async (instance) => {
    await registerOpenAIPassthrough(instance, deps);
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  govPort = (app.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((resolve) => fake.close(() => resolve()));
});

beforeEach(() => {
  captured = null;
  auditEvents.length = 0;
  fakeResponse = { status: 200, headers: {}, body: PLAIN_JSON };
});

describe('OpenAI passthrough — Content-Encoding transparency over real TCP (FB-3 / CT-005)', () => {
  it('request side: the caller\'s Accept-Encoding is NOT propagated — upstream sees accept-encoding: identity', async () => {
    fakeResponse = { status: 200, headers: { 'content-type': 'application/json' }, body: PLAIN_JSON };
    const res = await rawRequest('/passthrough/openai/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-encoding': 'gzip, br, zstd' },
      body: MESSAGES_BODY,
    });
    expect(res.status).toBe(200);
    expect(requireCaptured().headers['accept-encoding']).toBe('identity');
  });

  it('ENC-01/05/06/07/08/09: gzip non-stream → decoded body, NO stale content-encoding/length, useful headers + request id survive, response hash over delivered bytes', async () => {
    const gz = zlib.gzipSync(PLAIN_JSON);
    fakeResponse = {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': String(gz.length),
        ...USEFUL_HEADERS,
      },
      body: gz,
    };
    const res = await rawRequest('/passthrough/openai/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: MESSAGES_BODY,
    });
    expect(res.status).toBe(200);
    // ENC-07: no stale encoding on the wire.
    expect(res.headers['content-encoding']).toBeUndefined();
    // ENC-08: framing describes the bytes actually delivered.
    if (res.headers['content-length'] !== undefined) {
      expect(Number(res.headers['content-length'])).toBe(PLAIN_JSON.length);
    } else {
      expect(res.headers['transfer-encoding']).toBe('chunked');
    }
    // body consumable + content correct
    expect(res.body.equals(PLAIN_JSON)).toBe(true);
    expect(JSON.parse(res.body.toString('utf8'))).toMatchObject({ id: 'resp_fixture', ok: true });
    // ENC-05/06: useful headers + provider request id preserved
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['openai-request-id']).toBe('req_fake_enc_1');
    expect(res.headers['x-ratelimit-remaining-requests']).toBe('41');
    expect(res.headers['x-should-pass']).toBe('yes');
    // ENC-09: hash over the bytes GovAI processed / delivered (the decoded bytes)
    const ev = invokedEvent();
    expect(ev['native_response_hash']).toBe(sha256(PLAIN_JSON));
    expect(ev['provider_request_id']).toBe('req_fake_enc_1');
    expect(ev['status_code']).toBe(200);
  });

  it('ENC-01 (downstream real client): a Fetch client consuming GovAI\'s response gets valid JSON (would throw on a stale gzip header)', async () => {
    const gz = zlib.gzipSync(PLAIN_JSON);
    fakeResponse = {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': String(gz.length) },
      body: gz,
    };
    const res = await fetch(`http://127.0.0.1:${govPort}/passthrough/openai/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: MESSAGES_BODY,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBeNull();
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['id']).toBe('resp_fixture');
  });

  it('ENC-02: deflate and br non-stream → same truth', async () => {
    for (const [coding, encoded] of [
      ['deflate', zlib.deflateSync(PLAIN_JSON)],
      ['br', zlib.brotliCompressSync(PLAIN_JSON)],
    ] as Array<[string, Buffer]>) {
      captured = null;
      auditEvents.length = 0;
      fakeResponse = {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-encoding': coding,
          'content-length': String(encoded.length),
          'openai-request-id': `req_${coding}`,
        },
        body: encoded,
      };
      const res = await rawRequest('/passthrough/openai/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: MESSAGES_BODY,
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.body.equals(PLAIN_JSON)).toBe(true);
      expect(res.headers['openai-request-id']).toBe(`req_${coding}`);
      expect(invokedEvent()['native_response_hash']).toBe(sha256(PLAIN_JSON));
    }
  });

  it('ENC-01 provider 4xx: a compressed provider ERROR body is relayed decoded with its status and truthful headers', async () => {
    const errJson = Buffer.from('{"error":{"message":"bad","type":"invalid_request_error"}}', 'utf8');
    const gz = zlib.gzipSync(errJson);
    fakeResponse = {
      status: 400,
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': String(gz.length) },
      body: gz,
    };
    const res = await rawRequest('/passthrough/openai/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: MESSAGES_BODY,
    });
    expect(res.status).toBe(400);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.equals(errJson)).toBe(true);
    expect(invokedEvent()['native_response_hash']).toBe(sha256(errJson));
  });

  it('ENC-03/10: gzip-compressed SSE-like STREAM → decoded chunks relayed, no stale content-encoding/length, stream_final_hash over the emitted bytes, request id survives', async () => {
    const gz = zlib.gzipSync(SSE_PLAIN);
    // Split the compressed bytes into several chunks so the upstream is a real
    // multi-chunk stream that Fetch decodes incrementally.
    const third = Math.ceil(gz.length / 3);
    fakeResponse = {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'content-encoding': 'gzip',
        'content-length': String(gz.length),
        ...USEFUL_HEADERS,
      },
      body: [gz.subarray(0, third), gz.subarray(third, 2 * third), gz.subarray(2 * third)],
    };
    const res = await rawRequest('/passthrough/openai/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: MESSAGES_STREAM_BODY,
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-length']).toBeUndefined();
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.headers['openai-request-id']).toBe('req_fake_enc_1');
    expect(res.headers['x-ratelimit-remaining-requests']).toBe('41');
    expect(res.body.equals(SSE_PLAIN)).toBe(true);
    const ev = await waitForInvoked();
    expect(ev['is_stream']).toBe(true);
    expect(ev['stream_final_hash']).toBe(sha256(SSE_PLAIN));
    expect(ev['stream_outcome']).toBe('complete');
    expect(ev['provider_request_id']).toBe('req_fake_enc_1');
    expect(requireCaptured().headers['accept-encoding']).toBe('identity');
  });

  it('ENC-01c: representation validators computed over the ENCODED bytes (content-digest / strong etag / content-md5) are dropped when Fetch decoded; a weak etag survives; identity keeps them all', async () => {
    const gz = zlib.gzipSync(PLAIN_JSON);
    fakeResponse = {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': String(gz.length),
        'content-digest': 'sha-256=:over-gzip-bytes:',
        'content-md5': 'b3ZlciBnemlwIGJ5dGVz',
        etag: '"strong-over-gzip"',
        ...USEFUL_HEADERS,
      },
      body: gz,
    };
    const res = await rawRequest('/passthrough/openai/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: MESSAGES_BODY,
    });
    expect(res.status).toBe(200);
    expect(res.body.equals(PLAIN_JSON)).toBe(true);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-digest']).toBeUndefined();
    expect(res.headers['content-md5']).toBeUndefined();
    expect(res.headers['etag']).toBeUndefined();
    expect(res.headers['x-should-pass']).toBe('yes');

    // weak etag on a decoded body survives
    fakeResponse = {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': String(gz.length), etag: 'W/"weak"' },
      body: gz,
    };
    const res2 = await rawRequest('/passthrough/openai/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: MESSAGES_BODY,
    });
    expect(res2.headers['etag']).toBe('W/"weak"');

    // identity: nothing was decoded → validators are truthful and relayed
    fakeResponse = {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-digest': 'sha-256=:plain:', etag: '"strong-plain"' },
      body: PLAIN_JSON,
    };
    const res3 = await rawRequest('/passthrough/openai/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: MESSAGES_BODY,
    });
    expect(res3.headers['content-digest']).toBe('sha-256=:plain:');
    expect(res3.headers['etag']).toBe('"strong-plain"');
  });

  it('ENC-04: an identity (uncompressed) response is relayed unchanged — headers, bytes and hash', async () => {
    fakeResponse = {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', ...USEFUL_HEADERS },
      body: PLAIN_JSON,
    };
    const res = await rawRequest('/passthrough/openai/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: MESSAGES_BODY,
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(Number(res.headers['content-length'])).toBe(PLAIN_JSON.length);
    expect(res.body.equals(PLAIN_JSON)).toBe(true);
    expect(res.headers['openai-request-id']).toBe('req_fake_enc_1');
    expect(invokedEvent()['native_response_hash']).toBe(sha256(PLAIN_JSON));
  });

  it('ENC-04b: an unknown coding Fetch does NOT decode (x-custom) is relayed raw WITH its truthful content-encoding', async () => {
    const raw = Buffer.from('opaque-custom-bytes-not-json', 'utf8');
    fakeResponse = {
      status: 200,
      headers: { 'content-type': 'application/octet-stream', 'content-encoding': 'x-custom', 'content-length': String(raw.length) },
      body: raw,
    };
    const res = await rawRequest('/passthrough/openai/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: MESSAGES_BODY,
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('x-custom');
    expect(res.body.equals(raw)).toBe(true);
    expect(invokedEvent()['native_response_hash']).toBe(sha256(raw));
  });

  it('ENC-11: hop-by-hop headers from upstream are still stripped (existing invariant), useful ones kept', async () => {
    fakeResponse = {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'proxy-authenticate': 'Basic',
        trailer: 'x-t',
        upgrade: 'h2c',
        ...USEFUL_HEADERS,
      },
      body: PLAIN_JSON,
    };
    const res = await rawRequest('/passthrough/openai/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: MESSAGES_BODY,
    });
    expect(res.status).toBe(200);
    expect(res.headers['proxy-authenticate']).toBeUndefined();
    expect(res.headers['trailer']).toBeUndefined();
    expect(res.headers['upgrade']).toBeUndefined();
    expect(res.headers['x-should-pass']).toBe('yes');
  });
});
