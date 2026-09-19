// CONT-P5-A — stdio JSON-RPC client over in-memory streams (unit tier; fakes allowed by the dispatch).

import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { CodexExperimentalLockoutViolation } from '../guard/experimental-lockout.js';
import type { ServerNotificationEnvelope } from '../protocol/generated/ServerNotificationEnvelope';
import { GovAICodexSafeRequestBuilder as B, GovAICodexPolicyViolation } from '../protocol/govai-policy.js';
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

// The removed option cannot come back unnoticed: this line stops compiling if `outboundGuard` reappears.
const NO_OUTBOUND_GUARD_OPTION: 'outboundGuard' extends keyof CodexJsonRpcClientOptions ? never : true = true;

describe('R1 — the mandatory GovAI policy at the ACTUAL send boundary', () => {
  const governed = { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' } as const;
  const text = [{ type: 'text' as const, text: 'hello', text_elements: [] }];

  it('refuses category (3), missing governance, fork/steer boundaries, allowlisted-out keys and non-records', async () => {
    const h = harness();
    h.unlock();
    const refused: readonly (readonly [string, unknown, string])[] = [
      ['thread/start', { ...governed, approvalPolicy: 'never' }, 'approval_policy_not_allowed'],
      ['thread/start', { ...governed, approvalsReviewer: 'auto_review' }, 'approvals_reviewer_not_allowed'],
      ['thread/start', { ...governed, approvalsReviewer: 'guardian_subagent' }, 'approvals_reviewer_not_allowed'],
      ['thread/start', { ...governed, sandbox: 'danger-full-access' }, 'sandbox_mode_not_allowed'],
      ['turn/start', { threadId: 't', input: text, sandboxPolicy: { type: 'dangerFullAccess' } }, 'sandbox_policy_not_allowed'],
      [
        'turn/start',
        { threadId: 't', input: text, sandboxPolicy: { type: 'externalSandbox', networkAccess: 'restricted' } },
        'sandbox_policy_not_allowed',
      ],
      ['thread/start', { approvalsReviewer: 'user', sandbox: 'read-only' }, 'required_field_missing'],
      ['thread/resume', { threadId: 't', approvalPolicy: 'on-request', approvalsReviewer: 'user' }, 'required_field_missing'],
      ['thread/fork', { ...governed, threadId: 't' }, 'fork_requires_last_turn_id'],
      ['turn/steer', { threadId: 't', input: text }, 'steer_requires_expected_turn_id'],
      ['thread/start', { ...governed, config: { sandbox_mode: 'danger-full-access' } }, 'unexpected_input_key'],
      ['thread/start', { ...governed, baseInstructions: 'x' }, 'unexpected_input_key'],
      ['thread/start', { ...governed, developerInstructions: 'x' }, 'unexpected_input_key'],
      ['turn/start', { threadId: 't', input: text, toolOutput: null }, 'unexpected_input_key'],
      ['thread/read', 'not-a-record', 'invalid_field_value'],
      ['thread/delete', null, 'invalid_field_value'],
      ['turn/interrupt', ['t', 'u'], 'invalid_field_value'],
      ['thread/read', { threadId: null }, 'required_field_missing'],
    ];
    for (const [method, params, rule] of refused) {
      const error = await h.client.request(method as never, params as never).catch((e: unknown) => e);
      expect(error, `${method} ${JSON.stringify(params)}`).toBeInstanceOf(GovAICodexPolicyViolation);
      expect(error).toMatchObject({ rule });
    }
    await tick();
    expect(h.written).toEqual([]);
  });

  it('keeps categories (1)/(2) on the experimental lockout, inside the policy', async () => {
    const h = harness();
    h.unlock();
    await expect(
      h.client.request('thread/start', { ...governed, approvalPolicy: { granular: { sandbox_approval: true } } } as never),
    ).rejects.toMatchObject({ rule: 'experimental_variant' });
    await expect(h.client.request('thread/start', { ...governed, permissions: 'x' } as never)).rejects.toBeInstanceOf(
      CodexExperimentalLockoutViolation,
    );
    await tick();
    expect(h.written).toEqual([]);
  });

  it('refuses every initialize deviation from the §0.1 frozen request, and a refused initialize changes nothing', async () => {
    const h = harness();
    const frozen = B.initialize().params;
    const deviations: readonly unknown[] = [
      { ...frozen, capabilities: { experimentalApi: false, requestAttestation: true } },
      { ...frozen, capabilities: { experimentalApi: false, requestAttestation: false, optOutNotificationMethods: [] } },
      { ...frozen, clientInfo: { ...frozen.clientInfo, name: 'someone-else' } },
      { ...frozen, clientInfo: { ...frozen.clientInfo, title: null } },
      { ...frozen, capabilities: null },
      { ...frozen, extra: true },
      { clientInfo: frozen.clientInfo },
    ];
    for (const params of deviations) {
      await expect(h.client.request('initialize', params as never), JSON.stringify(params)).rejects.toSatisfy(
        (e: unknown) => e instanceof GovAICodexPolicyViolation || e instanceof CodexExperimentalLockoutViolation,
      );
    }
    await tick();
    expect(h.written).toEqual([]);
    // initializeSent unchanged and no id consumed: the frozen request is still accepted, as id 1.
    void h.client.request('initialize', frozen).catch(() => undefined);
    await tick();
    expect(h.written).toEqual([`{"id":1,"method":"initialize","params":${JSON.stringify(frozen)}}`]);
    h.client.close();
  });

  it('on refusal: zero bytes, a silent tap, no id consumed, no pending entry', async () => {
    const tapped: string[] = [];
    const h = harness({ wireTap: (direction, line) => tapped.push(`${direction} ${line}`) });
    h.unlock();
    await expect(h.client.request('thread/start', { ...governed, sandbox: 'danger-full-access' })).rejects.toBeInstanceOf(
      GovAICodexPolicyViolation,
    );
    await tick();
    expect(h.written).toEqual([]);
    expect(tapped).toEqual([]);
    // No pending entry: an answer for id 1 is unsolicited.
    h.send({ id: 1, result: {} });
    await tick();
    expect(h.events).toContainEqual({ type: 'protocol_error', error: new CodexProtocolError('unexpected_response_id') });
    // No id consumed: the next accepted request is id 1.
    const ok = h.client.request('thread/read', { threadId: 't' });
    await tick();
    expect(JSON.parse(h.written[0] ?? '{}')).toMatchObject({ id: 1, method: 'thread/read' });
    expect(tapped.filter((l) => l.startsWith('out '))).toEqual([`out ${h.written[0]}`]);
    h.send({ id: 1, result: { ok: true } });
    await expect(ok).resolves.toEqual({ ok: true });
  });

  it('cannot be replaced by an option, and binds a client unlocked through the structural symbol', async () => {
    expect(NO_OUTBOUND_GUARD_OPTION).toBe(true);
    const h = harness({ outboundGuard: () => undefined } as never);
    h.unlock();
    expect(h.client.isUnlocked).toBe(true);
    await expect(h.client.request('thread/start', { ...governed, approvalPolicy: 'never' })).rejects.toBeInstanceOf(
      GovAICodexPolicyViolation,
    );
    await tick();
    expect(h.written).toEqual([]);
  });

  it('serializes the policy result — byte-identical to the builder, never the caller object', async () => {
    const h = harness();
    h.unlock();
    const built = [
      B.threadStart({ ...governed, cwd: '/tmp/w' }),
      B.threadFork({ ...governed, threadId: 't', lastTurnId: 'u' }),
      B.turnStart({ threadId: 't', input: [...text], sandboxPolicy: { type: 'readOnly', networkAccess: false } }),
      B.turnSteer({ threadId: 't', input: [...text], expectedTurnId: 'u' }),
    ];
    for (const r of built) void h.client.request(r.method as never, r.params as never).catch(() => undefined);
    await tick();
    expect(h.written).toEqual(built.map((r, i) => JSON.stringify({ id: i + 1, method: r.method, params: r.params })));
    // A getter answering differently on each read cannot make the bytes differ from what was validated.
    let reads = 0;
    const tricky = {
      get threadId(): string {
        reads += 1;
        return reads === 1 ? 'validated' : '';
      },
    };
    void h.client.request('thread/read', tricky).catch(() => undefined);
    await tick();
    expect(h.written.at(-1)).toBe('{"id":5,"method":"thread/read","params":{"threadId":"validated"}}');
    expect(reads).toBe(1);
    h.client.close();
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
