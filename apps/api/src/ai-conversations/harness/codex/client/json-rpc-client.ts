// CONT-P5-A — stdio JSON-RPC client for the pinned codex-app-server (dispatch §2 client/).
//
// Transport = `AppServerTransport::Stdio` (`--listen stdio://`): one JSON message per line in each direction
// (app-server-transport/src/transport/stdio.rs reads `lines()` and writes `json + "\n"`). The envelope is the
// pinned one (../protocol/wire.ts): NO `"jsonrpc": "2.0"` field in either direction (rpc.rs L1-2).
//
// ★ ORDERING LAW. Only `initialize` may be sent on a fresh channel; every thread/turn method is refused
//   locally (`CodexClientGateError: attestation_required`) until `attestRuntime` has verified the binary,
//   the version, the frozen initialize bytes and the CODEX_HOME answer and then unlocked the channel.
// ★ NOTHING UNGATED LEAVES. Every outbound request passes the MANDATORY GovAI outbound policy
//   (`enforceGovAICodexOutboundPolicy`, ../protocol/govai-policy.ts — the experimental lockout included) BEFORE
//   serialization, and what is serialized is the policy's RETURN VALUE, never the caller's object. The policy is
//   not an option: no hook can replace or relax it, on any instance, however constructed or unlocked. A refused
//   request writes zero bytes, consumes no id and registers nothing. Methods outside the covered set are refused
//   as `unknown_method`.
// ★ SCOPE OF THAT GUARANTEE. GovAI outbound policy is non-bypassable through CodexJsonRpcClient. It is NOT claimed
//   to be a security boundary against arbitrary trusted code that already holds the raw process handle inside
//   the same process (`CodexProcessHandle.stdin` / `.stdout` stay a documented structural seam).
// ★ BOUNDED. Every request has a deadline clamped to `maxTimeoutMs`; an inbound line longer than
//   `maxLineChars` is a protocol error that closes the channel (framing can no longer be trusted).
// ★ INBOUND. Responses correlate by integer id; a response nobody awaits is a protocol error, never a crash.
//   Notifications outside the generated union surface as `unknown_method`; experimental ones (inventory) are
//   REJECTED, not delivered. Server→client requests outside the covered approval set are answered with a
//   JSON-RPC error — the client never invents an approval decision.
// ★ This module never logs. `wireTap` exposes the exact lines for evidence capture to the CALLER.

import type { Readable, Writable } from 'node:stream';

import { classifyInboundNotification, type CodexInboundNotificationVerdict } from '../guard/experimental-lockout.js';
import type { RequestId } from '../protocol/generated/RequestId';
import type { ServerNotificationEnvelope } from '../protocol/generated/ServerNotificationEnvelope';
import type { JsonValue } from '../protocol/generated/serde_json/JsonValue';
import { enforceGovAICodexOutboundPolicy } from '../protocol/govai-policy.js';
import { isGeneratedServerNotificationMethod, isGeneratedServerRequestMethod } from '../protocol/method-names.js';
import {
  isCoveredClientMethod,
  isCoveredServerRequestMethod,
  type CodexClientParams,
  type CodexCoveredClientMethod,
  type CodexCoveredClientResponses,
  type CodexCoveredServerRequestMethod,
  type CodexCoveredServerRequestResponses,
  type CodexServerRequestParams,
  type CodexWireErrorObject,
} from '../protocol/wire.js';
import {
  CodexClientGateError,
  CodexProtocolError,
  CodexRequestTimeoutError,
  CodexServerError,
  CodexTransportError,
  CodexUnknownMethodError,
  type CodexProtocolFailure,
} from './errors.js';

export const CODEX_CLIENT_DEFAULT_TIMEOUT_MS = 30_000;
export const CODEX_CLIENT_MAX_TIMEOUT_MS = 300_000;
export const CODEX_CLIENT_MAX_LINE_CHARS = 16 * 1024 * 1024;

/** JSON-RPC error codes the client itself answers server requests with. */
export const CODEX_CLIENT_METHOD_NOT_HANDLED = -32601;
export const CODEX_CLIENT_HANDLER_FAILED = -32603;

export type CodexWireTap = (direction: 'out' | 'in', line: string) => void;

/** A covered server→client request as the handler receives it (params typed by the generated union). */
export type CodexCoveredServerRequest = {
  [M in CodexCoveredServerRequestMethod]: { readonly method: M; readonly id: RequestId; readonly params: CodexServerRequestParams<M> };
}[CodexCoveredServerRequestMethod];

export type CodexServerRequestHandler = <R extends CodexCoveredServerRequest>(
  request: R,
) => Promise<CodexCoveredServerRequestResponses[R['method']]>;

export type CodexClientEvent =
  | { readonly type: 'protocol_error'; readonly error: CodexProtocolError }
  | { readonly type: 'unknown_method'; readonly error: CodexUnknownMethodError }
  | {
      readonly type: 'rejected_notification';
      readonly method: string;
      readonly verdict: Extract<CodexInboundNotificationVerdict, { verdict: 'reject_experimental' }>;
    }
  | { readonly type: 'closed'; readonly error: CodexTransportError | CodexProtocolError };

export interface CodexJsonRpcClientOptions {
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly maxLineChars?: number;
  /**
   * Observation only: receives each serialized line (outbound: after the policy accepted it). There is no outbound
   * gate option — the GovAI outbound policy is mandatory and cannot be replaced.
   */
  readonly wireTap?: CodexWireTap;
}

/**
 * Unlock key for the ordering law. The ordinary supported path calls it from `attestRuntime`
 * (../attestation/attest-runtime.ts), after every attestation predicate passed. It is an exported structural seam,
 * not a security boundary; the outbound policy applies to every instance whether or not it was unlocked this way.
 */
export const CODEX_CLIENT_UNLOCK_AFTER_ATTESTATION: unique symbol = Symbol('codex-client-unlock-after-attestation');

type Pending = {
  readonly method: string;
  readonly resolve: (value: JsonValue) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class CodexJsonRpcClient {
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;
  private readonly maxLineChars: number;
  private readonly wireTap: CodexWireTap | undefined;
  private readonly pending = new Map<number, Pending>();
  private readonly notificationHandlers = new Set<(n: ServerNotificationEnvelope) => void>();
  private readonly eventHandlers = new Set<(e: CodexClientEvent) => void>();
  private serverRequestHandler: CodexServerRequestHandler | null = null;
  private buffer = '';
  private nextId = 1;
  private initializeSent = false;
  private unlocked = false;
  private closedWith: CodexTransportError | CodexProtocolError | null = null;
  private readonly onData = (chunk: string): void => this.ingest(chunk);
  private readonly onEnd = (): void => this.close(new CodexTransportError('stdout_closed'));
  // A failed write (e.g. EPIPE once the peer closed its end) is a transport failure of this channel, never an
  // unhandled stream error. The listener stays attached after `close()`.
  private readonly onOutputError = (): void => this.close(new CodexTransportError('write_failed'));

  constructor(
    private readonly io: { readonly input: Readable; readonly output: Writable },
    options: CodexJsonRpcClientOptions = {},
  ) {
    this.maxTimeoutMs = options.maxTimeoutMs ?? CODEX_CLIENT_MAX_TIMEOUT_MS;
    this.defaultTimeoutMs = Math.min(options.defaultTimeoutMs ?? CODEX_CLIENT_DEFAULT_TIMEOUT_MS, this.maxTimeoutMs);
    this.maxLineChars = options.maxLineChars ?? CODEX_CLIENT_MAX_LINE_CHARS;
    this.wireTap = options.wireTap;
    io.input.setEncoding('utf8');
    io.input.on('data', this.onData);
    io.input.on('end', this.onEnd);
    io.input.on('close', this.onEnd);
    io.output.on('error', this.onOutputError);
  }

  /** Non-null once the channel failed or was closed; every later call rejects with it. */
  get closedError(): CodexTransportError | CodexProtocolError | null {
    return this.closedWith;
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  onNotification(handler: (notification: ServerNotificationEnvelope) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onEvent(handler: (event: CodexClientEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /** The approval hook (CommandExecution / FileChange / McpServerElicitation request→response pairs). */
  setServerRequestHandler(handler: CodexServerRequestHandler | null): void {
    this.serverRequestHandler = handler;
  }

  [CODEX_CLIENT_UNLOCK_AFTER_ATTESTATION](): void {
    this.unlocked = true;
  }

  request<M extends CodexCoveredClientMethod>(
    method: M,
    params: CodexClientParams<M>,
    options: { readonly timeoutMs?: number } = {},
  ): Promise<CodexCoveredClientResponses[M]> {
    if (this.closedWith !== null) return Promise.reject(this.closedWith);
    if (!isCoveredClientMethod(method)) {
      return Promise.reject(new CodexUnknownMethodError(method, 'outbound_request'));
    }
    if (method === 'initialize') {
      if (this.initializeSent) return Promise.reject(new CodexClientGateError('initialize_already_sent', method));
    } else if (!this.unlocked) {
      return Promise.reject(new CodexClientGateError('attestation_required', method));
    }
    // The mandatory policy runs BEFORE any state changes: a refusal writes nothing, taps nothing, consumes no id,
    // registers no pending entry and leaves `initializeSent` as it was.
    let owned: CodexClientParams<M>;
    try {
      owned = enforceGovAICodexOutboundPolicy(method, params);
    } catch (error) {
      return Promise.reject(error);
    }
    if (method === 'initialize') this.initializeSent = true;

    const id = this.nextId++;
    // The policy's RETURN VALUE is serialized — never the caller's object.
    const line = JSON.stringify({ id, method, params: owned });
    const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? this.defaultTimeoutMs, this.maxTimeoutMs));
    return new Promise<CodexCoveredClientResponses[M]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new CodexRequestTimeoutError(method, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        // The generated response type is the pinned server's contract for this method; the client does not
        // re-validate result payloads (decoding tests pin the shapes against the vendored schema).
        resolve: (value) => resolve(value as unknown as CodexCoveredClientResponses[M]),
        reject,
        timer,
      });
      this.writeLine(line);
    });
  }

  /**
   * The only client notification of the pinned protocol (`ClientNotification = { method: "initialized" }`).
   * Resolves once the line was handed to the channel; rejects with the channel's error when it is closed or the
   * write fails — "sent" is never assumed.
   */
  notifyInitialized(): Promise<void> {
    if (this.closedWith !== null) return Promise.reject(this.closedWith);
    return new Promise<void>((resolve, reject) => {
      this.writeLine(JSON.stringify({ method: 'initialized' }), (error) => (error === null ? resolve() : reject(error)));
    });
  }

  /** Stop reading, reject everything pending with `error` (default `client_closed`). Idempotent. */
  close(error: CodexTransportError | CodexProtocolError = new CodexTransportError('client_closed')): void {
    if (this.closedWith !== null) return;
    this.closedWith = error;
    this.io.input.off('data', this.onData);
    this.io.input.off('end', this.onEnd);
    this.io.input.off('close', this.onEnd);
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(error);
    }
    this.emit({ type: 'closed', error });
  }

  // -------------------------------------------------------------------------------------------------------

  private emit(event: CodexClientEvent): void {
    for (const handler of this.eventHandlers) handler(event);
  }

  private protocolError(failure: CodexProtocolFailure): void {
    this.emit({ type: 'protocol_error', error: new CodexProtocolError(failure) });
  }

  private writeLine(line: string, done?: (error: CodexTransportError | CodexProtocolError | null) => void): void {
    this.wireTap?.('out', line);
    this.io.output.write(`${line}\n`, (error) => {
      if (error) this.close(new CodexTransportError('write_failed'));
      done?.(error ? (this.closedWith ?? new CodexTransportError('write_failed')) : null);
    });
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1 && this.closedWith === null) {
      const raw = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.handleLine(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
      newline = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.maxLineChars && this.closedWith === null) {
      this.buffer = '';
      this.close(new CodexProtocolError('oversized_line'));
    }
  }

  private handleLine(line: string): void {
    if (line.trim().length === 0) return;
    if (line.length > this.maxLineChars) {
      this.close(new CodexProtocolError('oversized_line'));
      return;
    }
    this.wireTap?.('in', line);
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.protocolError('unparseable_line');
      return;
    }
    if (!isRecord(message)) {
      this.protocolError('unclassifiable_message');
      return;
    }
    const hasId = Object.hasOwn(message, 'id');
    const method = message['method'];
    if (hasId && typeof method === 'string') {
      void this.handleServerRequest(message['id'] as RequestId, method, message['params']);
    } else if (hasId && Object.hasOwn(message, 'result')) {
      this.settle(message['id'], (p) => p.resolve(message['result'] as JsonValue));
    } else if (hasId && Object.hasOwn(message, 'error')) {
      const error = message['error'];
      this.settle(message['id'], (p) => {
        if (!isRecord(error) || !Number.isSafeInteger(error['code']) || typeof error['message'] !== 'string') {
          p.reject(new CodexProtocolError('invalid_error_object'));
          return;
        }
        const e = error as CodexWireErrorObject;
        p.reject(new CodexServerError(p.method, e.code, e.message, e.data));
      });
    } else if (!hasId && typeof method === 'string') {
      this.handleNotification(method, message);
    } else {
      this.protocolError('unclassifiable_message');
    }
  }

  private settle(id: unknown, apply: (p: Pending) => void): void {
    const pending = typeof id === 'number' ? this.pending.get(id) : undefined;
    if (pending === undefined) {
      this.protocolError('unexpected_response_id');
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id as number);
    apply(pending);
  }

  private handleNotification(method: string, message: Record<string, unknown>): void {
    if (!isGeneratedServerNotificationMethod(method)) {
      this.emit({ type: 'unknown_method', error: new CodexUnknownMethodError(method, 'inbound_notification') });
      return;
    }
    const verdict = classifyInboundNotification(method);
    if (verdict.verdict === 'reject_experimental') {
      this.emit({ type: 'rejected_notification', method, verdict });
      return;
    }
    const notification = message as unknown as ServerNotificationEnvelope;
    for (const handler of this.notificationHandlers) handler(notification);
  }

  private async handleServerRequest(id: RequestId, method: string, params: unknown): Promise<void> {
    const answerError = (code: number, messageText: string): void =>
      this.writeLine(JSON.stringify({ error: { code, message: messageText }, id }));
    if (!isGeneratedServerRequestMethod(method) || !isCoveredServerRequestMethod(method)) {
      this.emit({ type: 'unknown_method', error: new CodexUnknownMethodError(method, 'inbound_request') });
      answerError(CODEX_CLIENT_METHOD_NOT_HANDLED, 'method not handled by the GovAI client');
      return;
    }
    const handler = this.serverRequestHandler;
    if (handler === null) {
      answerError(CODEX_CLIENT_METHOD_NOT_HANDLED, 'no GovAI handler registered for this request');
      return;
    }
    let result: unknown;
    try {
      result = await handler({ method, id, params } as CodexCoveredServerRequest);
    } catch {
      answerError(CODEX_CLIENT_HANDLER_FAILED, 'GovAI handler failed');
      return;
    }
    if (this.closedWith === null) this.writeLine(JSON.stringify({ id, result }));
  }
}
