// GOVAI-PROVENANCE-BEGIN CONT-P5-A (verbatim-source-derived fragment: the generated tree has no equivalent)
// PIN_RELEASE           = 0.154.0
// PIN_TAG               = rust-v0.154.0
// PIN_COMMIT            = 6b9826e3aa83b1a5947db50f4332cb9c65f1b340
// SOURCE_PATH_OR_SCHEMA = codex-rs/app-server-protocol/src/rpc.rs (envelope: L1-2, L17, L37, L46-56, L60-65, L69-72,
//                         L76-79, L82-88) + codex-rs/app-server-protocol/src/protocol/common.rs (method -> response
//                         associations, per-entry L<n> below) + schema/json/codex_app_server_protocol.schemas.json
//                         (definitions JSONRPCRequest, JSONRPCNotification, JSONRPCResponse, JSONRPCError,
//                         JSONRPCErrorError, W3cTraceContext)
// SOURCE_SHA256         = 78c516097c55b665e375807be6dcdceba232805c9ae9fa48420b0a537f0df705  src/rpc.rs
//                         6aa47ec984c9198ea797bf63b784cf6a88cc0ab85efb0a4ac75e01aabffc2cfa  src/protocol/common.rs
//                         d71ddf3bf5484f8de2799f7a4793c2e66808a9ec1a330e2307accb088ab5948a  schema/json/codex_app_server_protocol.schemas.json
// GENERATOR_IDENTITY    = NONE (transcribed from the anchors above; names, optionality and serialization preserved)
// GENERATOR_VERSION     = N/A
// GENERATOR_CONFIG      = N/A
// DERIVATION_MODE       = VERBATIM_SOURCE_DERIVED
// GOVAI-PROVENANCE-END
//
// WHY THIS FILE EXISTS. The generated TypeScript (./generated/**) carries every params/response/notification
// type but neither the JSON-RPC envelope (upstream emits it only as JSON schema) nor the method → response
// association (it lives in the Rust `client_request_definitions!` macro). Both are transcribed here, with an
// anchor per item, and `wire.test.ts` encodes/decodes them against the vendored JSON schema. PARAMS types are
// NEVER re-declared: `CodexClientParams<M>` reads them straight out of the generated `ClientRequest` union.

import type { ClientRequest } from './generated/ClientRequest';
import type { InitializeResponse } from './generated/InitializeResponse';
import type { RequestId } from './generated/RequestId';
import type { ServerRequest } from './generated/ServerRequest';
import type { JsonValue } from './generated/serde_json/JsonValue';
import type { CommandExecutionRequestApprovalResponse } from './generated/v2/CommandExecutionRequestApprovalResponse';
import type { FileChangeRequestApprovalResponse } from './generated/v2/FileChangeRequestApprovalResponse';
import type { McpServerElicitationRequestResponse } from './generated/v2/McpServerElicitationRequestResponse';
import type { ThreadArchiveResponse } from './generated/v2/ThreadArchiveResponse';
import type { ThreadDeleteResponse } from './generated/v2/ThreadDeleteResponse';
import type { ThreadForkResponse } from './generated/v2/ThreadForkResponse';
import type { ThreadItemsListResponse } from './generated/v2/ThreadItemsListResponse';
import type { ThreadReadResponse } from './generated/v2/ThreadReadResponse';
import type { ThreadResumeResponse } from './generated/v2/ThreadResumeResponse';
import type { ThreadStartResponse } from './generated/v2/ThreadStartResponse';
import type { ThreadTurnsListResponse } from './generated/v2/ThreadTurnsListResponse';
import type { ThreadUnsubscribeResponse } from './generated/v2/ThreadUnsubscribeResponse';
import type { TurnInterruptResponse } from './generated/v2/TurnInterruptResponse';
import type { TurnStartResponse } from './generated/v2/TurnStartResponse';
import type { TurnSteerResponse } from './generated/v2/TurnSteerResponse';

// ---------------------------------------------------------------------------------------------------------
// Envelope (rpc.rs)
// ---------------------------------------------------------------------------------------------------------

/** rpc.rs L1-2: "We do not do true JSON-RPC 2.0, as we neither send nor expect the "jsonrpc": "2.0" field." */
export const CODEX_WIRE_OMITS_JSONRPC_VERSION_FIELD = true;

/** Bundle definition `W3cTraceContext` (both properties `["string","null"]`, neither required). */
export type CodexWireTraceContext = { traceparent?: string | null; tracestate?: string | null };

/** rpc.rs L46-56 `JSONRPCRequest`; `params` and `trace` are skip-serialized when absent. GovAI never sends `trace`. */
export type CodexWireRequest = {
  id: RequestId;
  method: string;
  params?: JsonValue;
  trace?: CodexWireTraceContext | null;
};

/**
 * rpc.rs L60-65 `JSONRPCNotification`. Server notifications additionally carry `emittedAtMs`; that field is
 * part of the GENERATED `ServerNotificationEnvelope` (./generated/ServerNotificationEnvelope.ts), not of this
 * envelope, and is read from there.
 */
export type CodexWireNotification = { method: string; params?: JsonValue };

/** rpc.rs L69-72 `JSONRPCResponse`. */
export type CodexWireResponse = { id: RequestId; result: JsonValue };

/** rpc.rs L82-88 `JSONRPCErrorError`; `data` is skip-serialized when absent. */
export type CodexWireErrorObject = { code: number; data?: JsonValue; message: string };

/** rpc.rs L76-79 `JSONRPCError`. */
export type CodexWireError = { error: CodexWireErrorObject; id: RequestId };

/** rpc.rs L37 `JSONRPCMessage` (serde untagged). */
export type CodexWireMessage = CodexWireRequest | CodexWireNotification | CodexWireResponse | CodexWireError;

// ---------------------------------------------------------------------------------------------------------
// Covered client methods (dispatch §2 coverage) — params from the generated union, responses from common.rs
// ---------------------------------------------------------------------------------------------------------

export const CODEX_COVERED_CLIENT_METHODS = [
  'initialize',
  'thread/start',
  'thread/resume',
  'thread/read',
  'thread/turns/list',
  'thread/items/list',
  'thread/fork',
  'turn/start',
  'turn/steer',
  'turn/interrupt',
  'thread/archive',
  'thread/delete',
  'thread/unsubscribe',
] as const;

export type CodexCoveredClientMethod = (typeof CODEX_COVERED_CLIENT_METHODS)[number];

/** Params of a client method, read out of the GENERATED `ClientRequest` union. */
export type CodexClientParams<M extends ClientRequest['method']> = Extract<ClientRequest, { method: M }>['params'];

/** common.rs `client_request_definitions!` — `response:` of each covered entry (anchor per line). */
export type CodexCoveredClientResponses = {
  initialize: InitializeResponse; // L507  response: v1::InitializeResponse
  'thread/start': ThreadStartResponse; // L552  response: v2::ThreadStartResponse
  'thread/resume': ThreadResumeResponse; // L558  response: v2::ThreadResumeResponse
  'thread/read': ThreadReadResponse; // L824  response: v2::ThreadReadResponse
  'thread/turns/list': ThreadTurnsListResponse; // L829  response: v2::ThreadTurnsListResponse
  'thread/items/list': ThreadItemsListResponse; // L835  response: v2::ThreadItemsListResponse
  'thread/fork': ThreadForkResponse; // L564  response: v2::ThreadForkResponse
  'turn/start': TurnStartResponse; // L1010 response: v2::TurnStartResponse
  'turn/steer': TurnSteerResponse; // L1022 response: v2::TurnSteerResponse
  'turn/interrupt': TurnInterruptResponse; // L1028 response: v2::TurnInterruptResponse
  'thread/archive': ThreadArchiveResponse; // L570  response: v2::ThreadArchiveResponse
  'thread/delete': ThreadDeleteResponse; // L575  response: v2::ThreadDeleteResponse
  'thread/unsubscribe': ThreadUnsubscribeResponse; // L580  response: v2::ThreadUnsubscribeResponse
};

// ---------------------------------------------------------------------------------------------------------
// Covered server → client requests (the approval pairs)
// ---------------------------------------------------------------------------------------------------------

export const CODEX_COVERED_SERVER_REQUEST_METHODS = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'mcpServer/elicitation/request',
] as const;

export type CodexCoveredServerRequestMethod = (typeof CODEX_COVERED_SERVER_REQUEST_METHODS)[number];

/** Params of a server request, read out of the GENERATED `ServerRequest` union. */
export type CodexServerRequestParams<M extends ServerRequest['method']> = Extract<ServerRequest, { method: M }>['params'];

/** common.rs `server_request_definitions!` — `response:` of each covered entry. */
export type CodexCoveredServerRequestResponses = {
  'item/commandExecution/requestApproval': CommandExecutionRequestApprovalResponse; // L1728
  'item/fileChange/requestApproval': FileChangeRequestApprovalResponse; // L1735
  'mcpServer/elicitation/request': McpServerElicitationRequestResponse; // L1747
};

// ---------------------------------------------------------------------------------------------------------
// Compile-time closure: every covered method is an arm of the generated union and has exactly one response.
// ---------------------------------------------------------------------------------------------------------

type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export const CODEX_COVERED_CLIENT_METHODS_ARE_GENERATED: CodexCoveredClientMethod extends ClientRequest['method']
  ? true
  : never = true;
export const CODEX_COVERED_CLIENT_RESPONSES_COMPLETE: Exactly<CodexCoveredClientMethod, keyof CodexCoveredClientResponses> =
  true;
export const CODEX_COVERED_SERVER_REQUESTS_ARE_GENERATED: CodexCoveredServerRequestMethod extends ServerRequest['method']
  ? true
  : never = true;
export const CODEX_COVERED_SERVER_RESPONSES_COMPLETE: Exactly<
  CodexCoveredServerRequestMethod,
  keyof CodexCoveredServerRequestResponses
> = true;

export function isCoveredClientMethod(method: string): method is CodexCoveredClientMethod {
  return (CODEX_COVERED_CLIENT_METHODS as readonly string[]).includes(method);
}

export function isCoveredServerRequestMethod(method: string): method is CodexCoveredServerRequestMethod {
  return (CODEX_COVERED_SERVER_REQUEST_METHODS as readonly string[]).includes(method);
}
