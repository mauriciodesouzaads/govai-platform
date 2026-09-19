// CONT-P5-A — the VERBATIM_SOURCE_DERIVED wire fragment, encoded and decoded against the vendored pinned schema.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolvePointer, validateAgainstSchema } from './json-schema-subset.js';
import {
  CODEX_CLIENT_NOTIFICATION_METHODS,
  CODEX_SERVER_NOTIFICATION_METHODS,
  CODEX_SERVER_REQUEST_METHODS,
} from './method-names.js';
import { HARNESS_CODEX_DIR, listVendoredTypeScript, readVendoredBody, unionMethods } from './vendored-schema.js';
import {
  CODEX_COVERED_CLIENT_METHODS,
  CODEX_COVERED_SERVER_REQUEST_METHODS,
  CODEX_WIRE_OMITS_JSONRPC_VERSION_FIELD,
  type CodexWireError,
  type CodexWireNotification,
  type CodexWireRequest,
  type CodexWireResponse,
} from './wire.js';

const BUNDLE: unknown = JSON.parse(
  readFileSync(join(HARNESS_CODEX_DIR, 'pin', 'vendor', 'json', 'codex_app_server_protocol.schemas.json'), 'utf8'),
);
const CLIENT_REQUEST: unknown = JSON.parse(readFileSync(join(HARNESS_CODEX_DIR, 'pin', 'vendor', 'json', 'ClientRequest.json'), 'utf8'));

const against = (definition: string, value: unknown): string[] =>
  validateAgainstSchema(BUNDLE, resolvePointer(BUNDLE, `#/definitions/${definition}`), value);

describe('envelope (rpc.rs) — encoded bytes accepted by the pinned JSON-RPC definitions', () => {
  it('omits "jsonrpc": "2.0" in every direction, as the pinned server does', () => {
    expect(CODEX_WIRE_OMITS_JSONRPC_VERSION_FIELD).toBe(true);
    const request: CodexWireRequest = { id: 1, method: 'thread/read', params: { threadId: 't' } };
    expect(JSON.stringify(request)).toBe('{"id":1,"method":"thread/read","params":{"threadId":"t"}}');
    expect(JSON.stringify(request)).not.toContain('jsonrpc');
  });

  it('encodes requests, notifications, responses and errors the bundle definitions accept', () => {
    const request: CodexWireRequest = { id: 1, method: 'initialize', params: { a: 1 } };
    const bare: CodexWireRequest = { id: 'r-2', method: 'thread/archive' };
    const notification: CodexWireNotification = { method: 'initialized' };
    const response: CodexWireResponse = { id: 1, result: { ok: true } };
    const error: CodexWireError = { error: { code: -32600, message: 'Not initialized' }, id: 3 };
    expect(against('JSONRPCRequest', request)).toEqual([]);
    expect(against('JSONRPCRequest', bare)).toEqual([]);
    expect(against('JSONRPCNotification', notification)).toEqual([]);
    expect(against('JSONRPCResponse', response)).toEqual([]);
    expect(against('JSONRPCError', error)).toEqual([]);
    expect(against('JSONRPCMessage', request)).toEqual([]);
    expect(against('JSONRPCMessage', error)).toEqual([]);
  });

  it('decodes: malformed envelopes are rejected by the same pinned definitions', () => {
    expect(against('JSONRPCRequest', { method: 'x' })).not.toEqual([]);
    expect(against('JSONRPCResponse', { id: 1 })).not.toEqual([]);
    expect(against('JSONRPCError', { error: { code: 'bad', message: 'm' }, id: 1 })).not.toEqual([]);
    expect(against('RequestId', 1.5)).not.toEqual([]);
    expect(against('RequestId', 'abc')).toEqual([]);
  });

  it('decodes the handshake answers the pinned server produces (shape observed on the real binary)', () => {
    expect(
      against('InitializeResponse', {
        userAgent: 'govai-cont-p5a-harness/0.154.0 (Mac OS 26.5.1; arm64) unknown (govai-cont-p5a-harness; 0.1.0)',
        codexHome: '/private/tmp/codex-home',
        platformFamily: 'unix',
        platformOs: 'macos',
      }),
    ).toEqual([]);
    expect(against('InitializeResponse', { userAgent: 'x', platformFamily: 'unix', platformOs: 'macos' })).not.toEqual([]);
    expect(against('v2/ThreadDeleteResponse', {})).toEqual([]);
    expect(against('v2/TurnSteerResponse', { turnId: 'turn_1' })).toEqual([]);
    expect(against('v2/TurnSteerResponse', {})).not.toEqual([]);
  });
});

describe('covered method maps — every entry is an arm of the pinned unions', () => {
  it('covers the dispatch §2 client methods, each present in ClientRequest.ts and ClientRequest.json', () => {
    const tsArms = unionMethods(readVendoredBody('ClientRequest.ts'), 'ClientRequest');
    const jsonArms = (CLIENT_REQUEST as { oneOf: { properties: { method: { enum: string[] } } }[] }).oneOf.flatMap(
      (arm) => arm.properties.method.enum,
    );
    expect([...CODEX_COVERED_CLIENT_METHODS]).toEqual([
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
    ]);
    for (const m of CODEX_COVERED_CLIENT_METHODS) {
      expect(tsArms).toContain(m);
      expect(jsonArms).toContain(m);
    }
  });

  it('covers the three approval request/response pairs of the generated ServerRequest union', () => {
    expect([...CODEX_COVERED_SERVER_REQUEST_METHODS]).toEqual([
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'mcpServer/elicitation/request',
    ]);
    const arms = unionMethods(readVendoredBody('ServerRequest.ts'), 'ServerRequest');
    for (const m of CODEX_COVERED_SERVER_REQUEST_METHODS) expect(arms).toContain(m);
    const files = listVendoredTypeScript();
    for (const t of [
      'CommandExecutionRequestApprovalParams',
      'CommandExecutionRequestApprovalResponse',
      'FileChangeRequestApprovalParams',
      'FileChangeRequestApprovalResponse',
      'McpServerElicitationRequestParams',
      'McpServerElicitationRequestResponse',
    ]) {
      expect(files).toContain(`v2/${t}.ts`);
    }
  });

  it('mirrors the generated unions at runtime exactly (method-names.ts)', () => {
    expect([...CODEX_SERVER_NOTIFICATION_METHODS]).toEqual(unionMethods(readVendoredBody('ServerNotification.ts'), 'ServerNotification'));
    expect([...CODEX_SERVER_REQUEST_METHODS]).toEqual(unionMethods(readVendoredBody('ServerRequest.ts'), 'ServerRequest'));
    expect([...CODEX_CLIENT_NOTIFICATION_METHODS]).toEqual(unionMethods(readVendoredBody('ClientNotification.ts'), 'ClientNotification'));
  });

  it('pins the approval enums verbatim from the generated wire', () => {
    expect(readVendoredBody('v2/CommandExecutionApprovalDecision.ts')).toContain(
      'export type CommandExecutionApprovalDecision = "accept" | "acceptForSession" | { "acceptWithExecpolicyAmendment": { execpolicy_amendment: ExecPolicyAmendment, } } | { "applyNetworkPolicyAmendment": { network_policy_amendment: NetworkPolicyAmendment, } } | "decline" | "cancel";',
    );
    expect(readVendoredBody('v2/TurnSteerParams.ts')).toContain('expectedTurnId: string');
    expect(readVendoredBody('v2/TurnInterruptParams.ts')).toContain('export type TurnInterruptParams = { threadId: string, turnId: string, };');
  });
});
