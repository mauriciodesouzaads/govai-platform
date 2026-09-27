// CONT-P5-E1 — the two bindings of one protected operation (Dispatch v8 M4, carried from v2/v3; Correction 09
// section 10; Correction 08 sections 8-9).
//
// ★ TWO BINDINGS, SEPARATELY NAMED:
//   FEATURE_CONTEXT_BINDING   = the projection that decides the two feature bits: operation kind, the exact cwd
//                               string, the sandbox mode (it decides trust behaviour on thread/start), the fixture
//                               identity, the process generation and the binary identity. It proves feature-bit
//                               equivalence only; it is NOT a request identity.
//   OPERATION_REQUEST_BINDING = a harness-local REQUEST_BINDING_ID plus the IDENTITY of the exact deeply frozen,
//                               policy-normalized request object the GovAI policy returned. A token is consumable only
//                               by a send whose request object IS that object: the same feature-context tuple with a
//                               different threadId / approvalPolicy / approvalsReviewer / model / fork boundary, or an
//                               equal-looking copy, is a DIFFERENT request.
// ★ EXPLICIT CWD. Every admitted E1 operation carries an explicit cwd (Correction 08 section 8); INV-PATH /
//   INV-PROJ / INV-REPO are verified for that exact string before the attestation is issued.
// ★ No hashing of secrets or raw config: object identity plus a deterministic id is the whole binding.

import {
  enforceGovAICodexOutboundPolicy,
  isGovAIAllowedSandboxMode,
  type GovAICodexAllowedSandboxMode,
  type GovAICodexOutboundRequest,
} from '../protocol/govai-policy.js';

export const PROTECTED_OPERATION_KINDS = ['thread/start', 'thread/resume', 'thread/fork'] as const;
export type ProtectedOperationKind = (typeof PROTECTED_OPERATION_KINDS)[number];

export type ProtectedOperationRequest = GovAICodexOutboundRequest<ProtectedOperationKind>;

export type FeatureContextBinding = Readonly<{
  feature_context_binding_id: string;
  operation_kind: ProtectedOperationKind;
  /** The exact cwd string of the bound request (no normalization here or anywhere after admission). */
  cwd: string;
  sandbox: GovAICodexAllowedSandboxMode;
  /** Manifest reference of the executor-created fixture. */
  fixture_identity: string;
  /** Harness-logical process generation of the governed app-server. */
  process_generation: number;
  /** Pin manifest reference of the executable (e.g. its attested SHA-256). */
  binary_identity: string;
}>;

export type OperationRequestBinding = Readonly<{
  /** Harness-local, deterministic REQUEST_BINDING_ID. */
  request_binding_id: string;
  /** The exact frozen request object; consumption compares IDENTITY, never structure. */
  request: ProtectedOperationRequest;
}>;

export type OperationBindings = Readonly<{
  feature_context: FeatureContextBinding;
  request_binding: OperationRequestBinding;
}>;

export type OperationBindingRefusal =
  | 'NOT_A_PROTECTED_OPERATION'
  | 'REQUEST_NOT_DEEPLY_FROZEN'
  | 'REQUEST_NOT_POLICY_NORMALIZED'
  | 'EXPLICIT_CWD_REQUIRED'
  | 'SANDBOX_MODE_NOT_GOVERNED';

export type OperationBindingResult =
  | { readonly status: 'BOUND'; readonly bindings: OperationBindings }
  | { readonly status: 'REFUSED'; readonly reason: OperationBindingRefusal };

export type OperationBindingContext = Readonly<{
  fixture_identity: string;
  process_generation: number;
  binary_identity: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deeplyFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}

export function isProtectedOperationKind(method: unknown): method is ProtectedOperationKind {
  return typeof method === 'string' && (PROTECTED_OPERATION_KINDS as readonly string[]).includes(method);
}

/** Allocates the two bindings; ids are deterministic per binder instance (`<kind>:g<generation>:<n>`). */
export class OperationBinder {
  private nextBinding = 1;

  bind(request: unknown, context: OperationBindingContext): OperationBindingResult {
    const refuse = (reason: OperationBindingRefusal): OperationBindingResult => Object.freeze({ status: 'REFUSED', reason });
    if (!isRecord(request) || !isProtectedOperationKind(request['method'])) return refuse('NOT_A_PROTECTED_OPERATION');
    if (!deeplyFrozen(request)) return refuse('REQUEST_NOT_DEEPLY_FROZEN');
    const method = request['method'];
    const params = request['params'];
    let normalized: unknown;
    try {
      normalized = enforceGovAICodexOutboundPolicy(method, params);
    } catch {
      return refuse('REQUEST_NOT_POLICY_NORMALIZED');
    }
    // The policy is idempotent: a policy-normalized object serializes byte-identically to its own enforcement.
    if (JSON.stringify(normalized) !== JSON.stringify(params)) return refuse('REQUEST_NOT_POLICY_NORMALIZED');
    const bound = params as Record<string, unknown>;
    const cwd = bound['cwd'];
    if (typeof cwd !== 'string' || cwd.length === 0) return refuse('EXPLICIT_CWD_REQUIRED');
    const sandbox = bound['sandbox'];
    if (!isGovAIAllowedSandboxMode(sandbox)) return refuse('SANDBOX_MODE_NOT_GOVERNED');

    const n = this.nextBinding++;
    const feature_context: FeatureContextBinding = Object.freeze({
      feature_context_binding_id: `feature-context:g${context.process_generation}:${n}`,
      operation_kind: method,
      cwd,
      sandbox,
      fixture_identity: context.fixture_identity,
      process_generation: context.process_generation,
      binary_identity: context.binary_identity,
    });
    const request_binding: OperationRequestBinding = Object.freeze({
      request_binding_id: `request-binding:g${context.process_generation}:${n}`,
      request: request as ProtectedOperationRequest,
    });
    return Object.freeze({ status: 'BOUND', bindings: Object.freeze({ feature_context, request_binding }) });
  }
}

/** True only when `presented` IS the bound request object (identity, never structural equality). */
export function isExactBoundRequest(bindings: OperationBindings, presented: unknown): boolean {
  return presented === bindings.request_binding.request;
}
