// CONT-P5-A — structured error taxonomy of the Codex app-server client (dispatch §2 client/).
//
// Five kinds, one class each, a stable `code` per class (the convention of ../../errors.ts):
//   transport       the byte channel failed (spawn, write, stdout closed, client closed)
//   protocol        bytes arrived that are not a valid message of the pinned wire (unparseable line, unknown
//                   shape, a response for an id nobody is waiting on, an oversized line)
//   server          the server answered with a JSON-RPC error object — code/message/data preserved verbatim
//   unknown_method  a method outside the generated unions (inbound) or outside the covered set (outbound)
//   timeout         a request exceeded its BOUNDED deadline; no request ever waits forever
//
// ★ No message built here carries request params, response payloads or environment values: errors travel
//   into logs, and a Codex payload can hold user content. The server's own `message` is kept verbatim
//   because it is the diagnostic (e.g. "thread/start.permissions requires experimentalApi capability").

import type { JsonValue } from '../protocol/generated/serde_json/JsonValue';

export type CodexClientErrorKind = 'transport' | 'protocol' | 'server' | 'unknown_method' | 'timeout';

export abstract class CodexClientError extends Error {
  abstract readonly kind: CodexClientErrorKind;
  abstract readonly code: string;
}

export type CodexTransportFailure = 'write_failed' | 'stdout_closed' | 'client_closed';

export class CodexTransportError extends CodexClientError {
  readonly kind = 'transport';
  readonly code = 'codex_transport_error';
  constructor(readonly failure: CodexTransportFailure) {
    super(`codex transport error: ${failure}`);
    this.name = 'CodexTransportError';
  }
}

export type CodexProtocolFailure =
  | 'unparseable_line'
  | 'unclassifiable_message'
  | 'unexpected_response_id'
  | 'oversized_line'
  | 'invalid_error_object';

export class CodexProtocolError extends CodexClientError {
  readonly kind = 'protocol';
  readonly code = 'codex_protocol_error';
  constructor(readonly failure: CodexProtocolFailure) {
    super(`codex protocol error: ${failure}`);
    this.name = 'CodexProtocolError';
  }
}

export class CodexServerError extends CodexClientError {
  readonly kind = 'server';
  readonly code = 'codex_server_error';
  constructor(
    readonly method: string,
    readonly rpcCode: number,
    readonly rpcMessage: string,
    readonly rpcData: JsonValue | undefined,
  ) {
    super(`codex server error on ${method}: ${rpcCode} ${rpcMessage}`);
    this.name = 'CodexServerError';
  }
}

export class CodexUnknownMethodError extends CodexClientError {
  readonly kind = 'unknown_method';
  readonly code = 'codex_unknown_method';
  constructor(
    readonly method: string,
    readonly direction: 'outbound_request' | 'inbound_request' | 'inbound_notification',
  ) {
    super(`codex unknown method (${direction}): ${method}`);
    this.name = 'CodexUnknownMethodError';
  }
}

/**
 * NOT a wire failure: the GovAI ordering law refused the call locally, before any byte was written.
 * `attestation_required` — a thread/turn method before `attestRuntime` succeeded (attestation precedes any
 * thread method); `initialize_already_sent` — a second `initialize` on the same channel.
 */
export class CodexClientGateError extends Error {
  readonly code = 'codex_client_gate';
  constructor(
    readonly reason: 'attestation_required' | 'initialize_already_sent',
    readonly method: string,
  ) {
    super(`codex client gate: ${reason} (${method})`);
    this.name = 'CodexClientGateError';
  }
}

export class CodexRequestTimeoutError extends CodexClientError {
  readonly kind = 'timeout';
  readonly code = 'codex_request_timeout';
  constructor(
    readonly method: string,
    readonly timeoutMs: number,
  ) {
    super(`codex request timed out after ${timeoutMs}ms: ${method}`);
    this.name = 'CodexRequestTimeoutError';
  }
}
