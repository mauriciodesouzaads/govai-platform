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
  mode: 'clean' as
    | 'clean'
    | 'upstream_error'
    | 'disconnect'
    | 'pre_disconnect'
    | 'handoff_disconnect',
  chunks: [] as Uint8Array[],
  finalHash: 'f'.repeat(64),
  capturedSignal: undefined as AbortSignal | undefined,
}));

vi.mock('../passthrough/stream-forward.js', () => ({
  forwardStream: async (input: { signal?: AbortSignal }) => {
    ctl.capturedSignal = input.signal;
    const { mode, chunks } = ctl;
    if (mode === 'pre_disconnect') {
      // Simulate the upstream-headers await: hang until the client aborts (pre-header),
      // then reject — forwardStream never returns a finalize-able handle (§(3) Option C).
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
        if (input.signal?.aborted) onAbort();
        else input.signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    if (mode === 'handoff_disconnect') {
      // Wait for the client to disconnect, THEN resolve with headers + a body that IGNORES the
      // abort. This makes reply.raw already-closed when the pump arms its (one-shot) close
      // listener — the P2#2 handoff condition. Unfixed code drains to 'complete'; the CHANGE A
      // self-check detects the closed socket, aborts, and emits 'client_disconnect'.
      await new Promise<void>((resolve) => {
        if (input.signal?.aborted) resolve();
        else input.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        if (mode === 'clean' || mode === 'handoff_disconnect') {
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
    resolveProviderKey: async () => ({ apiKey: 'k', source: 'tenant_provider_credential' }),
    activeOverridesLoader: async () => [],
    emitAuditEvent: (ev: unknown) => {
      if (emitShouldThrow) throw new Error('emit boom');
      auditEvents.push(ev as Record<string, unknown>);
    },
  };
  // forceCloseConnections: a pre-header client disconnect leaves an idle keep-alive socket
  // that app.close() would otherwise wait on (Node keep-alive timeout) — force it at teardown.
  app = Fastify({ logger: false, forceCloseConnections: true });
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
    // upstream_error now DESTROYS the socket (truncation) → the client fetch may itself reject with a
    // connection reset; the terminal is still emitted server-side BEFORE the close.
    const res = await postStream().catch(() => null);
    if (res) await res.text().catch(() => undefined);
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

  it('(5) early disconnect PRE-HEADER → upstream aborted (no orphan), NO terminal emitted', async () => {
    ctl.mode = 'pre_disconnect';
    const clientAc = new AbortController();
    const p = postStream(clientAc.signal);
    // let the handler reach the forwardStream await (the mock hangs there), then disconnect
    await new Promise((r) => setTimeout(r, 50));
    clientAc.abort();
    await p.catch(() => undefined);
    // allow the server-side close → ac.abort() → handler completion to settle
    await new Promise((r) => setTimeout(r, 150));
    // the upstream fetch received the abort (no orphan) AND no terminal was emitted (§(3) C)
    expect(ctl.capturedSignal).toBeDefined();
    expect(ctl.capturedSignal!.aborted).toBe(true);
    expect(auditEvents).toHaveLength(0);
  });

  it('(6) handoff-window disconnect (socket closed before the pump arms) → client_disconnect, NOT complete; upstream aborted', async () => {
    ctl.mode = 'handoff_disconnect';
    const clientAc = new AbortController();
    const p = postStream(clientAc.signal);
    await new Promise((r) => setTimeout(r, 50));
    clientAc.abort();
    await p.catch(() => undefined);
    await waitForEmit(() => auditEvents.length >= 1);
    expect(auditEvents).toHaveLength(1);
    expect(invoked()['stream_outcome']).toBe('client_disconnect');
    expect(ctl.capturedSignal).toBeDefined();
    expect(ctl.capturedSignal!.aborted).toBe(true);
  });
});
