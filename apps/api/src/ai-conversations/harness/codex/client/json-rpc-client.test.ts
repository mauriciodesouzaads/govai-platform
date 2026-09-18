// CONT-P5-A — stdio JSON-RPC client over in-memory streams (unit tier; fakes allowed by the dispatch).

import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { CodexExperimentalLockoutViolation } from '../guard/experimental-lockout.js';
import type { ServerNotificationEnvelope } from '../protocol/generated/ServerNotificationEnvelope';
import { GovAICodexSafeRequestBuilder as B } from '../protocol/govai-policy.js';
import {
  CodexClientGateError,
  CodexProtocolError,
  CodexRequestTimeoutError,
  CodexServerError,
  CodexTransportError,
  CodexUnknownMethodError,
} from './errors.js';
import {
  CODEX_CLIENT_UNLOCK_AFTER_ATTESTATION,
  CodexJsonRpcClient,
  type CodexClientEvent,
  type CodexJsonRpcClientOptions,
} from './json-rpc-client.js';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function harness(options: CodexJsonRpcClientOptions = {}) {
  const toClient = new PassThrough();
  const fromClient = new PassThrough();
  const written: string[] = [];
  let partial = '';
  fromClient.setEncoding('utf8');
  fromClient.on('data', (chunk: string) => {
    partial += chunk;
    const parts = partial.split('\n');
    partial = parts.pop() ?? '';
    written.push(...parts);
  });
  const events: CodexClientEvent[] = [];
  const client = new CodexJsonRpcClient({ input: toClient, output: fromClient }, options);
  client.onEvent((e) => events.push(e));
  const send = (message: unknown): void => {
    toClient.write(`${JSON.stringify(message)}\n`);
  };
  const unlock = (): void => client[CODEX_CLIENT_UNLOCK_AFTER_ATTESTATION]();
  return { client, send, written, events, toClient, unlock };
}

describe('outbound framing and the ordering law', () => {
  it('writes one JSON line per request, without "jsonrpc", and correlates the answer by id', async () => {
    const h = harness();
    const pending = h.client.request('initialize', B.initialize().params);
    await tick();
    expect(h.written).toEqual([
      '{"id":1,"method":"initialize","params":{"clientInfo":{"name":"govai-cont-p5a-harness","title":"GovAI CONT-P5-A inert foundation","version":"0.1.0"},"capabilities":{"experimentalApi":false,"requestAttestation":false}}}',
    ]);
    h.send({ id: 1, result: { userAgent: 'ua', codexHome: '/h', platformFamily: 'unix', platformOs: 'macos' } });
    await expect(pending).resolves.toEqual({ userAgent: 'ua', codexHome: '/h', platformFamily: 'unix', platformOs: 'macos' });
    h.client.notifyInitialized();
    await tick();
    expect(h.written[1]).toBe('{"method":"initialized"}');
  });

  it('refuses thread methods before attestation unlocked the channel — zero bytes written', async () => {
    const h = harness();
    await expect(h.client.request('thread/read', { threadId: 't' })).rejects.toEqual(
      new CodexClientGateError('attestation_required', 'thread/read'),
    );
    await tick();
    expect(h.written).toEqual([]);
    expect(h.client.isUnlocked).toBe(false);
  });

  it('refuses a second initialize on the same channel', async () => {
    const h = harness();
    void h.client.request('initialize', B.initialize().params).catch(() => undefined);
    await expect(h.client.request('initialize', B.initialize().params)).rejects.toBeInstanceOf(CodexClientGateError);
    h.client.close();
  });

  it('runs the experimental lockout BEFORE serialization — a refused request writes nothing', async () => {
    const h = harness();
    h.unlock();
    await expect(
      h.client.request('thread/fork', { threadId: 't', lastTurnId: 'u', beforeTurnId: 'x' } as never),
    ).rejects.toBeInstanceOf(CodexExperimentalLockoutViolation);
    await expect(
      h.client.request('initialize', { ...B.initialize().params, capabilities: { experimentalApi: true, requestAttestation: false } }),
    ).rejects.toMatchObject({ rule: 'experimental_api_must_be_false' });
    await tick();
    expect(h.written).toEqual([]);
  });

  it('refuses methods outside the covered set as unknown_method', async () => {
    const h = harness();
    h.unlock();
    await expect(h.client.request('thread/queue/add' as never, {} as never)).rejects.toEqual(
      new CodexUnknownMethodError('thread/queue/add', 'outbound_request'),
    );
  });
});

describe('inbound correlation, errors and timeouts', () => {
  it('correlates concurrent requests answered out of order', async () => {
    const h = harness();
    h.unlock();
    const a = h.client.request('thread/read', { threadId: 'a' });
    const b = h.client.request('thread/read', { threadId: 'b' });
    await tick();
    expect(h.written.map((l) => JSON.parse(l).id)).toEqual([1, 2]);
    h.send({ id: 2, result: { tag: 'B' } });
    h.send({ id: 1, result: { tag: 'A' } });
    await expect(a).resolves.toEqual({ tag: 'A' });
    await expect(b).resolves.toEqual({ tag: 'B' });
  });

  it('maps a server error object verbatim; a malformed one is a protocol error', async () => {
    const h = harness();
    h.unlock();
    const a = h.client.request('thread/start', B.threadStart({ approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' }).params);
    const b = h.client.request('thread/read', { threadId: 't' });
    await tick();
    h.send({ error: { code: -32600, message: 'thread/start.permissions requires experimentalApi capability', data: { x: 1 } }, id: 1 });
    h.send({ error: { message: 'no code' }, id: 2 });
    const err = await a.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodexServerError);
    expect(err).toMatchObject({
      kind: 'server',
      method: 'thread/start',
      rpcCode: -32600,
      rpcMessage: 'thread/start.permissions requires experimentalApi capability',
      rpcData: { x: 1 },
    });
    await expect(b).rejects.toEqual(new CodexProtocolError('invalid_error_object'));
  });

  it('bounds every request: the deadline is clamped to maxTimeoutMs; a late answer is a protocol error', async () => {
    const h = harness({ maxTimeoutMs: 40 });
    h.unlock();
    const started = Date.now();
    const err = await h.client.request('thread/read', { threadId: 't' }, { timeoutMs: 600_000 }).catch((e: unknown) => e);
    expect(err).toEqual(new CodexRequestTimeoutError('thread/read', 40));
    expect(Date.now() - started).toBeLessThan(5_000);
    h.send({ id: 1, result: {} });
    await tick();
    expect(h.events).toContainEqual({ type: 'protocol_error', error: new CodexProtocolError('unexpected_response_id') });
  });

  it('survives garbage lines, reassembles chunked frames and tolerates CRLF', async () => {
    const h = harness();
    h.unlock();
    const p = h.client.request('thread/read', { threadId: 't' });
    await tick();
    h.toClient.write('not json\n{}\n{"id":999,"result":{}}\n');
    h.toClient.write('{"id":1,"re');
    h.toClient.write('sult":{"ok":true}}\r\n');
    await expect(p).resolves.toEqual({ ok: true });
    const failures = h.events.filter((e) => e.type === 'protocol_error').map((e) => (e as { error: CodexProtocolError }).error.failure);
    expect(failures).toEqual(['unparseable_line', 'unclassifiable_message', 'unexpected_response_id']);
  });

  it('closes on an oversized line and rejects everything pending', async () => {
    const h = harness({ maxLineChars: 64 });
    h.unlock();
    const p = h.client.request('thread/read', { threadId: 't' });
    await tick();
    h.toClient.write(`{"id":1,"result":"${'x'.repeat(200)}`);
    await expect(p).rejects.toEqual(new CodexProtocolError('oversized_line'));
    expect(h.client.closedError).toEqual(new CodexProtocolError('oversized_line'));
    await expect(h.client.request('thread/read', { threadId: 't' })).rejects.toEqual(new CodexProtocolError('oversized_line'));
  });

  it('treats stdout closing as a transport failure for pending and later requests', async () => {
    const h = harness();
    h.unlock();
    const p = h.client.request('thread/read', { threadId: 't' });
    h.toClient.end();
    await expect(p).rejects.toEqual(new CodexTransportError('stdout_closed'));
    await expect(h.client.request('thread/delete', { threadId: 't' })).rejects.toEqual(new CodexTransportError('stdout_closed'));
    expect(h.events.at(-1)).toEqual({ type: 'closed', error: new CodexTransportError('stdout_closed') });
  });
});

describe('notification demultiplexing', () => {
  it('delivers generated notifications (emittedAtMs kept), rejects experimental ones, flags unknown ones', async () => {
    const h = harness();
    const delivered: ServerNotificationEnvelope[] = [];
    h.client.onNotification((n) => delivered.push(n));
    h.send({ method: 'thread/deleted', params: { threadId: 't' }, emittedAtMs: 1789762564061 });
    h.send({ method: 'thread/realtime/started', params: {} });
    h.send({ method: 'totally/unknown', params: {} });
    await tick();
    expect(delivered).toEqual([{ method: 'thread/deleted', params: { threadId: 't' }, emittedAtMs: 1789762564061 }]);
    expect(h.events.map((e) => e.type)).toEqual(['rejected_notification', 'unknown_method']);
    expect(h.events[0]).toMatchObject({ method: 'thread/realtime/started', verdict: { verdict: 'reject_experimental' } });
    expect(h.events[1]).toEqual({ type: 'unknown_method', error: new CodexUnknownMethodError('totally/unknown', 'inbound_notification') });
  });
});

describe('server → client requests (the approval hook)', () => {
  it('answers a covered approval request with the handler result, verbatim', async () => {
    const h = harness();
    h.client.setServerRequestHandler(async (request) => {
      expect(request.method).toBe('item/commandExecution/requestApproval');
      return { decision: 'decline' } as never;
    });
    h.send({ id: 'srv-1', method: 'item/commandExecution/requestApproval', params: { threadId: 't', turnId: 'u', itemId: 'i' } });
    await tick();
    await tick();
    expect(h.written).toEqual(['{"id":"srv-1","result":{"decision":"decline"}}']);
  });

  it('never invents a decision: no handler, an uncovered or an unknown method, or a failing handler → JSON-RPC error', async () => {
    const h = harness();
    h.send({ id: 1, method: 'item/fileChange/requestApproval', params: {} });
    h.send({ id: 2, method: 'item/tool/call', params: {} });
    h.send({ id: 3, method: 'currentTime/read', params: {} });
    await tick();
    h.client.setServerRequestHandler(async () => {
      throw new Error('boom');
    });
    h.send({ id: 4, method: 'mcpServer/elicitation/request', params: {} });
    await tick();
    await tick();
    expect(h.written.map((l) => JSON.parse(l))).toEqual([
      { error: { code: -32601, message: 'no GovAI handler registered for this request' }, id: 1 },
      { error: { code: -32601, message: 'method not handled by the GovAI client' }, id: 2 },
      { error: { code: -32601, message: 'method not handled by the GovAI client' }, id: 3 },
      { error: { code: -32603, message: 'GovAI handler failed' }, id: 4 },
    ]);
    expect(h.events.map((e) => (e.type === 'unknown_method' ? e.error.method : e.type))).toEqual([
      'item/tool/call',
      'currentTime/read',
    ]);
  });
});
