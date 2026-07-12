// EP-008C — OpenAI governed stream terminal-completeness e2e.
// The fix lands once in the shared pumpResult (covers BOTH /v1/responses and
// /v1/chat/completions). Drives the REAL governed handler over a real socket with a
// controllable (mocked) upstream + a capturing emitAuditEvent. Proves the terminal
// PassthroughInvoked is emitted on EVERY termination path, plus that both endpoints
// route through the same fixed pump.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

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
      // then reject — the internal forwardStream never returns a handle (§(3) Option C).
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

import { registerOpenAIGoverned, type OpenAIGovernedDeps } from './register-governed.js';
import type { GovernedTenant } from './handle-responses.js';

const ORG = '00000000-0000-4000-8000-0000000000dd';
const tenant: GovernedTenant = { org_id: ORG, tier: 'enterprise', operational_mode: 'production' };

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
  const deps: OpenAIGovernedDeps = {
    upstreamBaseUrl: 'http://upstream.invalid',
    resolveTenant: async () => tenant,
    // F1 Point 1: a non-coincidental source proves the streaming FINALIZER
    // carries the resolver's source through to the terminal event (both
    // /v1/responses and /v1/chat/completions share pumpResult).
    resolveProviderKey: async () => ({ apiKey: 'k', source: 'platform_env' }),
    dlpScan: async () => ({ findings: [] }),
    emitAuditEvent: (ev) => {
      if (emitShouldThrow) throw new Error('emit boom');
      auditEvents.push(ev as unknown as Record<string, unknown>);
    },
  };
  // forceCloseConnections: a pre-header client disconnect leaves an idle keep-alive socket
  // that app.close() would otherwise wait on (Node keep-alive timeout) — force it at teardown.
  app = Fastify({ logger: false, forceCloseConnections: true });
  await app.register(async (instance) => registerOpenAIGoverned(instance, deps));
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

async function postResponses(signal?: AbortSignal): Promise<Response> {
  return fetch(`${govUrl}/governed/openai/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"stream":true,"model":"gpt-x","input":"hi"}',
    ...(signal ? { signal } : {}),
  });
}

describe('EP-008C OpenAI governed stream terminal-completeness', () => {
  it('(1) clean stream → terminal emitted once: is_stream, full hash, stream_outcome=complete, identity', async () => {
    ctl.mode = 'clean';
    const res = await postResponses();
    await res.text();
    await waitForEmit(() => auditEvents.length >= 1);
    expect(auditEvents).toHaveLength(1);
    const ev = invoked();
    expect(ev['is_stream']).toBe(true);
    expect(ev['stream_outcome']).toBe('complete');
    expect(ev['stream_final_hash']).toBe(ctl.finalHash);
    expect((ev['tenant_context'] as { org_id: string }).org_id).toBe(ORG);
    // F1 Point 1: the source flows through the /v1/responses streaming finalizer.
    expect(ev['credential_source']).toBe('platform_env');
  });

  it('(2) mid-stream upstream error → terminal once with partial hash + stream_outcome=upstream_error + identity', async () => {
    ctl.mode = 'upstream_error';
    // upstream_error now DESTROYS the socket (truncation) → the client fetch may itself reject with a
    // connection reset; the terminal is still emitted server-side BEFORE the close.
    const res = await postResponses().catch(() => null);
    if (res) await res.text().catch(() => undefined);
    await waitForEmit(() => auditEvents.length >= 1);
    expect(auditEvents).toHaveLength(1);
    const ev = invoked();
    expect(ev['stream_outcome']).toBe('upstream_error');
    expect(ev['stream_final_hash']).toBe(ctl.finalHash);
    expect((ev['tenant_context'] as { org_id: string }).org_id).toBe(ORG);
  });

  it('(3) client disconnect → terminal once with stream_outcome=client_disconnect + identity; upstream signal supplied + aborted', async () => {
    ctl.mode = 'disconnect';
    const clientAc = new AbortController();
    const res = await postResponses(clientAc.signal);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel().catch(() => undefined);
    clientAc.abort();
    await waitForEmit(() => auditEvents.length >= 1);
    expect(auditEvents).toHaveLength(1);
    const ev = invoked();
    expect(ev['stream_outcome']).toBe('client_disconnect');
    expect((ev['tenant_context'] as { org_id: string }).org_id).toBe(ORG);
    expect(ctl.capturedSignal).toBeDefined();
    expect(ctl.capturedSignal!.aborted).toBe(true);
  });

  it('(4) never-throw: an emit failure on the terminal path does not crash the hijacked reply', async () => {
    ctl.mode = 'clean';
    emitShouldThrow = true;
    const res = await postResponses();
    await expect(res.text()).resolves.toContain('data: 1');
    expect(res.status).toBe(200);
  });

  it('(5) the SAME fix covers /v1/chat/completions (pumpResult is shared) — clean terminal emitted', async () => {
    ctl.mode = 'clean';
    const res = await fetch(`${govUrl}/governed/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"stream":true,"model":"gpt-x","messages":[{"role":"user","content":"hi"}]}',
    });
    await res.text();
    await waitForEmit(() => auditEvents.length >= 1);
    expect(auditEvents).toHaveLength(1);
    const ev = invoked();
    expect(ev['is_stream']).toBe(true);
    expect(ev['stream_outcome']).toBe('complete');
    expect(ev['native_endpoint']).toBe('/v1/chat/completions');
    // F1 Point 1: the source flows through the /v1/chat/completions streaming finalizer.
    expect(ev['credential_source']).toBe('platform_env');
  });

  it('(6) early disconnect PRE-HEADER → upstream aborted (no orphan), NO terminal emitted', async () => {
    ctl.mode = 'pre_disconnect';
    const clientAc = new AbortController();
    const p = postResponses(clientAc.signal);
    await new Promise((r) => setTimeout(r, 50));
    clientAc.abort();
    await p.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 150));
    expect(ctl.capturedSignal).toBeDefined();
    expect(ctl.capturedSignal!.aborted).toBe(true);
    expect(auditEvents).toHaveLength(0);
  });

  it('(7) handoff-window disconnect (socket closed before the pump arms) → client_disconnect, NOT complete; upstream aborted', async () => {
    ctl.mode = 'handoff_disconnect';
    const clientAc = new AbortController();
    const p = postResponses(clientAc.signal);
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
