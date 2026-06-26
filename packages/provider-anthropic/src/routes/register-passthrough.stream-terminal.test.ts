// EP-008C — Anthropic passthrough stream terminal-completeness e2e.
// Drives the REAL route handler over a real socket (app.listen + fetch), with a
// controllable upstream (the forwarder is mocked so we can stream N chunks then
// error, or stay open until the client disconnects) and a capturing emitAuditEvent.
// Proves the terminal PassthroughInvoked is emitted on EVERY termination path
// (clean / upstream_error / client_disconnect), exactly once, never crashing the
// hijacked reply, and that the abort signal is now supplied + aborted on disconnect.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

// Controllable upstream forwarder (mocked). The real handler + the real
// @govai/provider-stream-http helper run; only the upstream stream is controlled.
const ctl = vi.hoisted(() => ({
  mode: 'clean' as 'clean' | 'upstream_error' | 'disconnect',
  chunks: [] as Uint8Array[],
  finalHash: 'f'.repeat(64),
  capturedSignal: undefined as AbortSignal | undefined,
}));

vi.mock('../passthrough/stream-forward.js', () => ({
  forwardStream: async (input: { signal?: AbortSignal }) => {
    ctl.capturedSignal = input.signal;
    const { mode, chunks } = ctl;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        if (mode === 'clean') {
          controller.close();
        } else if (mode === 'upstream_error') {
          controller.error(new Error('upstream boom'));
        } else {
          // disconnect: stay open until the handler aborts (client close), then error.
          const abort = () => {
            try {
              controller.error(new DOMException('aborted', 'AbortError'));
            } catch {
              /* already errored/closed */
            }
          };
          if (input.signal?.aborted) abort();
          else input.signal?.addEventListener('abort', abort, { once: true });
        }
      },
    });
    return {
      status: 200,
      responseHeaders: { 'content-type': 'text/event-stream' },
      body,
      native_request_hash: 'a'.repeat(64),
      finalize: async () => ({
        stream_final_hash: ctl.finalHash,
        bytes_streamed: ctl.chunks.reduce((n, c) => n + c.byteLength, 0),
        latency_ms: 1,
      }),
      provider_request_id: 'req-stream-1',
    };
  },
}));

import {
  registerAnthropicPassthrough,
  type AnthropicPassthroughDeps,
} from './register-passthrough.js';
import type { TenantContext } from '../passthrough/audit-emit.js';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const tenant: TenantContext = {
  org_id: ORG,
  tier: 'enterprise',
  operational_mode: 'production',
};

let app: FastifyInstance;
let govUrl: string;
let auditEvents: Record<string, unknown>[] = [];
let emitShouldThrow = false;

function chunk(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function invoked(): Record<string, unknown> {
  const ev = auditEvents.find((e) => e['event_type'] === 'passthrough.invoked');
  if (!ev) throw new Error('no passthrough.invoked captured');
  return ev;
}
async function waitForEmit(predicate: () => boolean, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting for the terminal emit');
}

beforeAll(async () => {
  const deps: AnthropicPassthroughDeps = {
    upstreamBaseUrl: 'http://upstream.invalid',
    resolveTenant: async () => tenant,
    resolveProviderKey: async () => 'k',
    activeOverridesLoader: async () => [],
    emitAuditEvent: (ev: unknown) => {
      if (emitShouldThrow) throw new Error('emit boom');
      auditEvents.push(ev as Record<string, unknown>);
    },
  };
  app = Fastify({ logger: false });
  await app.register(async (instance) => registerAnthropicPassthrough(instance, deps));
  await app.listen({ port: 0, host: '127.0.0.1' });
  govUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  auditEvents = [];
  emitShouldThrow = false;
  ctl.mode = 'clean';
  ctl.chunks = [chunk('event: a\ndata: 1\n\n'), chunk('event: b\ndata: 2\n\n')];
  ctl.capturedSignal = undefined;
  ctl.finalHash = createHash('sha256').update('partial').digest('hex');
});

async function postStream(signal?: AbortSignal): Promise<Response> {
  return fetch(`${govUrl}/passthrough/anthropic/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"stream":true,"model":"claude-x","max_tokens":10,"messages":[]}',
    ...(signal ? { signal } : {}),
  });
}

describe('EP-008C Anthropic passthrough stream terminal-completeness', () => {
  it('(1) clean stream → terminal emitted once: is_stream, full hash, stream_outcome=complete, identity', async () => {
    ctl.mode = 'clean';
    const res = await postStream();
    await res.text(); // drain the client side
    await waitForEmit(() => auditEvents.length >= 1);
    expect(auditEvents).toHaveLength(1);
    const ev = invoked();
    expect(ev['is_stream']).toBe(true);
    expect(ev['stream_outcome']).toBe('complete');
    expect(ev['stream_final_hash']).toBe(ctl.finalHash);
    expect((ev['tenant_context'] as { org_id: string }).org_id).toBe(ORG);
  });

  it('(2) mid-stream upstream error → terminal emitted once with partial hash + stream_outcome=upstream_error + identity', async () => {
    ctl.mode = 'upstream_error';
    const res = await postStream();
    await res.text().catch(() => undefined); // client may see a truncated body
    await waitForEmit(() => auditEvents.length >= 1);
    expect(auditEvents).toHaveLength(1);
    const ev = invoked();
    expect(ev['is_stream']).toBe(true);
    expect(ev['stream_outcome']).toBe('upstream_error');
    expect(ev['stream_final_hash']).toBe(ctl.finalHash); // the partial-byte hash from finalize()
    expect((ev['tenant_context'] as { org_id: string }).org_id).toBe(ORG);
  });

  it('(3) client disconnect → terminal once with stream_outcome=client_disconnect + identity; upstream signal supplied + aborted', async () => {
    ctl.mode = 'disconnect';
    const clientAc = new AbortController();
    const res = await postStream(clientAc.signal);
    // read at least one chunk, then disconnect mid-stream
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel().catch(() => undefined);
    clientAc.abort();
    await waitForEmit(() => auditEvents.length >= 1);
    expect(auditEvents).toHaveLength(1);
    const ev = invoked();
    expect(ev['stream_outcome']).toBe('client_disconnect');
    expect((ev['tenant_context'] as { org_id: string }).org_id).toBe(ORG);
    // the handler now supplies the abort signal to the forwarder, and it is aborted.
    expect(ctl.capturedSignal).toBeDefined();
    expect(ctl.capturedSignal!.aborted).toBe(true);
  });

  it('(4) never-throw: an emit failure on the terminal path does not crash the hijacked reply', async () => {
    ctl.mode = 'clean';
    emitShouldThrow = true;
    const res = await postStream();
    // the client still receives a clean (chunked) response despite the emit throwing.
    await expect(res.text()).resolves.toContain('data: 1');
    expect(res.status).toBe(200);
  });
});
