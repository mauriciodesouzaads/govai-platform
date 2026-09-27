// CONT-P5-E1 — OPERATION_ADMISSION_TOKEN, Domain O (Dispatch v8 M3, carried from v2/v3; Correction 09 sections 4.5, 6;
// Correction 08 sections 9-11).
//
// A token authorizes EXACTLY ONE protected outbound operation (thread/start, thread/resume, thread/fork). It exists
// only after a successful effective-feature attestation: INV-PATH / INV-PROJ / INV-REPO and FIXTURE_CONFIG_STATE are
// verified for the operation's context, then `experimentalFeature/list` answers ShellSnapshot V1 = false, V2 = false,
// complete, and only then is the token ISSUED, bound to the operation's FEATURE_CONTEXT_BINDING and to the exact frozen
// request object (OPERATION_REQUEST_BINDING).
//
// ★ STATES. ISSUED -> CONSUMED | INVALIDATED | EXPIRED; the three terminal states have no outgoing transition.
// ★ ONE LINEARIZATION POINT. CONSUME sets CONSUMED synchronously in the same critical section that hands the bound
//   request to the governed client, which allocates the wire request id and initiates the single transport write in
//   that same synchronous call. An uncertain transport outcome (write error, close, timeout, no response) leaves the
//   token CONSUMED and is reported as SEND_FAILED_AFTER_CONSUME: it never reverts, never permits a second send, and a
//   concurrent consume attempt loses.
// ★ INVALIDATORS (Domain O only; OPERATION_TOKEN_INVALIDATORS below). None of them retires, erases or alters a runtime
//   provenance or a thread safety state: token lifetime != runtime lifetime. The Domain S list lives in
//   thread-safety-state.ts and the two are never merged.
// ★ TIME IS NOT FRESHNESS. MAX_ADMISSION_INTERVAL_MS is a SECONDARY guard: exceeding it blocks the send (EXPIRED);
//   staying within it proves nothing by itself.
// ★ ADMISSION_CONTEXT_GENERATION is a HARNESS-LOGICAL, Domain O counter (it counts the harness's own relevant events:
//   spawn and initialize, every covered send that is not a bound operation, harness writes, observed fixture state
//   transitions, process exit / restart, binary switch). It is labelled as such in every record and is NEVER a session
//   or runtime identity. The pinned upstream exposes no config generation; none is fabricated.
// ★ SERIALIZED WINDOW. Every covered request of the E1 session goes through this service; any covered request sent
//   between a token's attestation and its consumption invalidates it. Under the E1 controlled environment there is no
//   bypass of the governed client (Correction 09 section 4).

import { CodexRequestTimeoutError, CodexServerError } from '../client/errors.js';
import type { CodexJsonRpcClient } from '../client/json-rpc-client.js';
import { GovAICodexSafeRequestBuilder, enforceGovAICodexOutboundPolicy } from '../protocol/govai-policy.js';
import type { CodexClientParams, CodexCoveredClientMethod, CodexCoveredClientResponses } from '../protocol/wire.js';
import { parseEffectiveFeatureListPage, type EffectiveFeatureListFailureReason } from './effective-feature-list.js';
import {
  assertE1ControlledEnvironmentAcknowledged,
  verifyAdmissionPreconditions,
  type AdmissionPreconditionFailure,
  type AdmissionPreconditionProof,
  type E1ControlledEnvironmentAcknowledgement,
} from './fixture-invariants.js';
import { isExactBoundRequest, isProtectedOperationKind, type OperationBindings, type ProtectedOperationKind } from './operation-binder.js';

/** SECONDARY guard only (Correction 09 section 4.5): violation blocks the send; satisfaction proves nothing. */
export const MAX_ADMISSION_INTERVAL_MS = 10_000;

/** Deadline of the attestation request itself. */
export const ATTESTATION_TIMEOUT_MS = 10_000;

export const OPERATION_ADMISSION_STATUSES = ['ISSUED', 'CONSUMED', 'INVALIDATED', 'EXPIRED'] as const;
export type OperationAdmissionStatus = (typeof OPERATION_ADMISSION_STATUSES)[number];

/** Correction 09 section 6: the Domain O invalidators (before consumption). */
export const OPERATION_TOKEN_INVALIDATORS = [
  'TOKEN_PROCESS_EXIT_OR_RESTART',
  'TOKEN_BINARY_CHANGE',
  'TOKEN_REQUEST_OBJECT_DRIFT',
  'TOKEN_OPERATION_KIND_DRIFT',
  'TOKEN_FEATURE_CONTEXT_DRIFT',
  'TOKEN_FIXTURE_INVARIANT_FAILURE',
  'TOKEN_UNAUTHORIZED_FIXTURE_CONFIG_MUTATION',
  'TOKEN_COVERED_RPC_IN_ATTEST_CONSUME_WINDOW',
  'TOKEN_RPC_OR_TRANSPORT_FAILURE_BEFORE_ATTESTATION',
  'TOKEN_ATTESTATION_TIMEOUT',
  'TOKEN_MAX_ADMISSION_INTERVAL_EXPIRED',
  'TOKEN_ADMISSION_CONTEXT_OR_PROCESS_GENERATION_MISMATCH',
  'TOKEN_ENABLEMENT_SET_OR_ACCOUNT_CALL',
] as const;
export type OperationTokenInvalidator = (typeof OPERATION_TOKEN_INVALIDATORS)[number];

/** Bounded failure enum of one admission attempt or one consume attempt. */
export type OperationAdmissionFailure =
  | OperationTokenInvalidator
  | 'ATTESTATION_RESULT_INVALID'
  | 'SHELL_SNAPSHOT_V1_TRUE_BLOCKED'
  | 'SHELL_SNAPSHOT_V2_TRUE_BLOCKED'
  | 'UNKNOWN_TOKEN'
  | 'TOKEN_NOT_ISSUED'
  | 'SEND_FAILED_AFTER_CONSUME';

/** The harness-logical Domain O counter, labelled in every record. */
export type HarnessLogicalAdmissionContextGeneration = Readonly<{
  harnessLogicalCounter: number;
  label: 'HARNESS_LOGICAL_DOMAIN_O_COUNTER_NOT_A_SESSION_IDENTITY';
}>;

/** Correction 09 section 6 RECORD (verbatim field names). Only (false, false, complete) attestations become tokens. */
export type OperationAdmissionTokenRecord = Readonly<{
  OPERATION_ADMISSION_ID: string;
  process_generation: number;
  binary_identity: string;
  fixture_identity: string;
  ADMISSION_CONTEXT_GENERATION: HarnessLogicalAdmissionContextGeneration;
  operation_kind: ProtectedOperationKind;
  /** Reference: the FEATURE_CONTEXT_BINDING id. */
  FEATURE_CONTEXT_BINDING: string;
  /** Reference: the REQUEST_BINDING_ID of the OPERATION_REQUEST_BINDING. */
  OPERATION_REQUEST_BINDING: string;
  v1: false;
  v2: false;
  complete: true;
  issue_monotonic: number;
  status: OperationAdmissionStatus;
  consume_monotonic?: number;
  failure?: OperationAdmissionFailure;
}>;

/** What the protected send observed after consumption. Raw error text is never carried. */
export type ProtectedSendOutcome =
  | Readonly<{ outcome: 'RESPONSE'; result: unknown }>
  | Readonly<{ outcome: 'RPC_ERROR' }>
  | Readonly<{ outcome: 'SEND_FAILED_AFTER_CONSUME' }>;

export type ConsumeResult =
  | Readonly<{ status: 'REFUSED'; failure: OperationAdmissionFailure; token: OperationAdmissionTokenRecord | null }>
  | Readonly<{ status: 'SENT'; token: OperationAdmissionTokenRecord; outcome: Promise<ProtectedSendOutcome> }>;

/** The context a consume attempt is checked against (the service's current one). */
export type ConsumeContext = Readonly<{
  nowMonotonic: number;
  processGeneration: number;
  binaryIdentity: string;
  fixtureIdentity: string;
  admissionContextGeneration: number;
}>;

type StoredToken = { record: OperationAdmissionTokenRecord; readonly bindings: OperationBindings };

function labelGeneration(counter: number): HarnessLogicalAdmissionContextGeneration {
  return Object.freeze({ harnessLogicalCounter: counter, label: 'HARNESS_LOGICAL_DOMAIN_O_COUNTER_NOT_A_SESSION_IDENTITY' });
}

/**
 * The Domain O state machine (no I/O). `consumeAndSend` is the single linearization point: status -> CONSUMED and the
 * `send` call happen in one synchronous section.
 */
export class OperationAdmissionTokenStore {
  private readonly tokens = new Map<string, StoredToken>();
  private nextToken = 1;

  issue(input: Readonly<{ bindings: OperationBindings; admissionContextGeneration: number; issueMonotonic: number }>): OperationAdmissionTokenRecord {
    const fc = input.bindings.feature_context;
    const record: OperationAdmissionTokenRecord = Object.freeze({
      OPERATION_ADMISSION_ID: `operation-admission:g${fc.process_generation}:${this.nextToken++}`,
      process_generation: fc.process_generation,
      binary_identity: fc.binary_identity,
      fixture_identity: fc.fixture_identity,
      ADMISSION_CONTEXT_GENERATION: labelGeneration(input.admissionContextGeneration),
      operation_kind: fc.operation_kind,
      FEATURE_CONTEXT_BINDING: fc.feature_context_binding_id,
      OPERATION_REQUEST_BINDING: input.bindings.request_binding.request_binding_id,
      v1: false,
      v2: false,
      complete: true,
      issue_monotonic: input.issueMonotonic,
      status: 'ISSUED',
    });
    this.tokens.set(record.OPERATION_ADMISSION_ID, { record, bindings: input.bindings });
    return record;
  }

  record(tokenId: string): OperationAdmissionTokenRecord | undefined {
    return this.tokens.get(tokenId)?.record;
  }

  bindings(tokenId: string): OperationBindings | undefined {
    return this.tokens.get(tokenId)?.bindings;
  }

  issuedTokenIds(): readonly string[] {
    return [...this.tokens.values()].filter((t) => t.record.status === 'ISSUED').map((t) => t.record.OPERATION_ADMISSION_ID);
  }

  /** ISSUED -> INVALIDATED (or EXPIRED for the interval invalidator). A terminal token is left as it is. */
  invalidate(tokenId: string, reason: OperationTokenInvalidator): OperationAdmissionTokenRecord | undefined {
    const stored = this.tokens.get(tokenId);
    if (stored === undefined || stored.record.status !== 'ISSUED') return stored?.record;
    stored.record = Object.freeze({
      ...stored.record,
      status: reason === 'TOKEN_MAX_ADMISSION_INTERVAL_EXPIRED' ? 'EXPIRED' : 'INVALIDATED',
      failure: reason,
    });
    return stored.record;
  }

  invalidateAllIssued(reason: OperationTokenInvalidator): readonly OperationAdmissionTokenRecord[] {
    return this.issuedTokenIds().map((id) => this.invalidate(id, reason)!);
  }

  /**
   * A VALID_TOKEN check of Correction 09 section 4.5 for `presented`, WITHOUT consuming (P2 of a resume admission).
   */
  isValidFor(tokenId: string, presented: unknown, context: ConsumeContext): boolean {
    return this.refusalFor(tokenId, presented, context) === null;
  }

  /**
   * THE linearization point. All checks run first; then, synchronously and with nothing in between, the status
   * becomes CONSUMED and `send` is invoked with the exact bound request. Any check failure is an invalidator of the
   * token (or leaves a terminal token untouched) and sends nothing.
   */
  consumeAndSend(tokenId: string, presented: unknown, context: ConsumeContext, send: (request: OperationBindings['request_binding']['request']) => Promise<unknown>): ConsumeResult {
    const refusal = this.refusalFor(tokenId, presented, context);
    const stored = this.tokens.get(tokenId);
    if (refusal !== null || stored === undefined) {
      const failure = refusal ?? 'UNKNOWN_TOKEN';
      const token =
        stored !== undefined && (OPERATION_TOKEN_INVALIDATORS as readonly string[]).includes(failure)
          ? (this.invalidate(tokenId, failure as OperationTokenInvalidator) ?? null)
          : (stored?.record ?? null);
      return Object.freeze({ status: 'REFUSED', failure, token });
    }
    stored.record = Object.freeze({ ...stored.record, status: 'CONSUMED', consume_monotonic: context.nowMonotonic });
    const token = stored.record;
    let pending: Promise<unknown>;
    try {
      pending = send(stored.bindings.request_binding.request);
    } catch {
      pending = Promise.reject(new Error('synchronous send failure'));
    }
    const outcome = pending.then(
      (result): ProtectedSendOutcome => Object.freeze({ outcome: 'RESPONSE', result }),
      (error: unknown): ProtectedSendOutcome =>
        error instanceof CodexServerError ? Object.freeze({ outcome: 'RPC_ERROR' }) : Object.freeze({ outcome: 'SEND_FAILED_AFTER_CONSUME' }),
    );
    return Object.freeze({ status: 'SENT', token, outcome });
  }

  private refusalFor(tokenId: string, presented: unknown, context: ConsumeContext): OperationAdmissionFailure | null {
    const stored = this.tokens.get(tokenId);
    if (stored === undefined) return 'UNKNOWN_TOKEN';
    const { record, bindings } = stored;
    if (record.status !== 'ISSUED') return 'TOKEN_NOT_ISSUED';
    const method = typeof presented === 'object' && presented !== null ? (presented as { method?: unknown }).method : undefined;
    if (method !== record.operation_kind) return 'TOKEN_OPERATION_KIND_DRIFT';
    if (!isExactBoundRequest(bindings, presented)) return 'TOKEN_REQUEST_OBJECT_DRIFT';
    if (record.binary_identity !== context.binaryIdentity) return 'TOKEN_BINARY_CHANGE';
    if (record.process_generation !== context.processGeneration) return 'TOKEN_ADMISSION_CONTEXT_OR_PROCESS_GENERATION_MISMATCH';
    if (record.fixture_identity !== context.fixtureIdentity) return 'TOKEN_FEATURE_CONTEXT_DRIFT';
    if (record.ADMISSION_CONTEXT_GENERATION.harnessLogicalCounter !== context.admissionContextGeneration) {
      return 'TOKEN_ADMISSION_CONTEXT_OR_PROCESS_GENERATION_MISMATCH';
    }
    if (context.nowMonotonic - record.issue_monotonic > MAX_ADMISSION_INTERVAL_MS) return 'TOKEN_MAX_ADMISSION_INTERVAL_EXPIRED';
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// The admission service: pre-checks -> ATTEST -> issue; consume -> send (the E1 session's only send path)
// ---------------------------------------------------------------------------------------------------------

export type OperationAdmissionServiceConfig = Readonly<{
  client: CodexJsonRpcClient;
  /** Harness start gate: both E1 assumptions acknowledged (a documented flag, not a detection claim). */
  acknowledgement: E1ControlledEnvironmentAcknowledgement;
  processGeneration: number;
  binaryIdentity: string;
  fixtureIdentity: string;
  codexHome: string;
  launchCwd: string;
  now?: () => number;
  attestationTimeoutMs?: number;
}>;

export type AdmitInput = Readonly<{
  bindings: OperationBindings;
  allowedTrustKeys: readonly string[];
  requireSealedStateZeroBytes: boolean;
  knownHistoryCwds?: readonly string[];
}>;

/** The bounded attestation evidence of one admission attempt (never the raw page, never error text). */
export type EffectiveFeatureAttestation = Readonly<{
  shellSnapshotEffective: boolean | null;
  shellSnapshotV2Effective: boolean | null;
  complete: boolean;
  parseFailure: EffectiveFeatureListFailureReason | null;
}>;

export type AdmitResult =
  | Readonly<{ status: 'ADMITTED'; token: OperationAdmissionTokenRecord; precondition: AdmissionPreconditionProof; attestation: EffectiveFeatureAttestation }>
  | Readonly<{
      status: 'REFUSED';
      failure: OperationAdmissionFailure;
      preconditionFailure: AdmissionPreconditionFailure | null;
      attestation: EffectiveFeatureAttestation | null;
    }>;

const NOT_ATTESTED: EffectiveFeatureAttestation = Object.freeze({
  shellSnapshotEffective: null,
  shellSnapshotV2Effective: null,
  complete: false,
  parseFailure: null,
});

type UnprotectedMethod = Exclude<CodexCoveredClientMethod, ProtectedOperationKind | 'initialize' | 'experimentalFeature/list'>;

export class OperationAdmissionService {
  readonly store = new OperationAdmissionTokenStore();
  private generation = 1;
  private readonly now: () => number;

  constructor(private readonly config: OperationAdmissionServiceConfig) {
    assertE1ControlledEnvironmentAcknowledged(config.acknowledgement);
    this.now = config.now ?? (() => performance.now());
  }

  /** The harness-logical ADMISSION_CONTEXT_GENERATION (Domain O only; never a session identity). */
  get admissionContextGeneration(): HarnessLogicalAdmissionContextGeneration {
    return labelGeneration(this.generation);
  }

  get processGeneration(): number {
    return this.config.processGeneration;
  }

  get binaryIdentity(): string {
    return this.config.binaryIdentity;
  }

  get fixtureIdentity(): string {
    return this.config.fixtureIdentity;
  }

  /** Pre-checks, then ATTEST (`experimentalFeature/list` with `{}`), then ISSUE a token bound to `bindings`. */
  async admit(input: AdmitInput): Promise<AdmitResult> {
    const refuse = (
      failure: OperationAdmissionFailure,
      preconditionFailure: AdmissionPreconditionFailure | null = null,
      attestation: EffectiveFeatureAttestation | null = null,
    ): AdmitResult => Object.freeze({ status: 'REFUSED', failure, preconditionFailure, attestation });
    const fc = input.bindings.feature_context;
    if (fc.process_generation !== this.config.processGeneration) return refuse('TOKEN_ADMISSION_CONTEXT_OR_PROCESS_GENERATION_MISMATCH');
    if (fc.binary_identity !== this.config.binaryIdentity) return refuse('TOKEN_BINARY_CHANGE');
    if (fc.fixture_identity !== this.config.fixtureIdentity) return refuse('TOKEN_FEATURE_CONTEXT_DRIFT');

    const precondition = verifyAdmissionPreconditions({
      codexHome: this.config.codexHome,
      launchCwd: this.config.launchCwd,
      requestedCwd: fc.cwd,
      knownHistoryCwds: input.knownHistoryCwds ?? [],
      allowedTrustKeys: input.allowedTrustKeys,
      requireSealedStateZeroBytes: input.requireSealedStateZeroBytes,
    });
    if (precondition.status === 'FAILED') {
      const failure: OperationTokenInvalidator =
        precondition.failure.invariant === 'FIXTURE_CONFIG_STATE' ? 'TOKEN_UNAUTHORIZED_FIXTURE_CONFIG_MUTATION' : 'TOKEN_FIXTURE_INVARIANT_FAILURE';
      return refuse(failure, precondition.failure);
    }

    // The attestation request is itself a covered send: it closes the window of every other ISSUED token.
    this.coveredSendOutsideBoundOperation();
    const attestedGeneration = this.generation;
    let result: unknown;
    try {
      const request = GovAICodexSafeRequestBuilder.experimentalFeatureList();
      result = await this.config.client.request(request.method, request.params, {
        timeoutMs: this.config.attestationTimeoutMs ?? ATTESTATION_TIMEOUT_MS,
      });
    } catch (error) {
      return refuse(error instanceof CodexRequestTimeoutError ? 'TOKEN_ATTESTATION_TIMEOUT' : 'TOKEN_RPC_OR_TRANSPORT_FAILURE_BEFORE_ATTESTATION', null, NOT_ATTESTED);
    }
    if (this.generation !== attestedGeneration) return refuse('TOKEN_ADMISSION_CONTEXT_OR_PROCESS_GENERATION_MISMATCH', null, NOT_ATTESTED);

    const parsed = parseEffectiveFeatureListPage(result);
    if (parsed.status === 'INVALID') {
      return refuse('ATTESTATION_RESULT_INVALID', null, Object.freeze({ ...NOT_ATTESTED, parseFailure: parsed.reason }));
    }
    const attestation: EffectiveFeatureAttestation = Object.freeze({
      shellSnapshotEffective: parsed.shellSnapshotEffective,
      shellSnapshotV2Effective: parsed.shellSnapshotV2Effective,
      complete: parsed.complete,
      parseFailure: null,
    });
    if (parsed.shellSnapshotEffective) return refuse('SHELL_SNAPSHOT_V1_TRUE_BLOCKED', null, attestation);
    if (parsed.shellSnapshotV2Effective) return refuse('SHELL_SNAPSHOT_V2_TRUE_BLOCKED', null, attestation);

    const token = this.store.issue({ bindings: input.bindings, admissionContextGeneration: attestedGeneration, issueMonotonic: this.now() });
    return Object.freeze({ status: 'ADMITTED', token, precondition: precondition.proof, attestation });
  }

  /** P2 for a resume admission: is `presented` exactly the request this still-ISSUED token may consume, right now? */
  freshReconstructionAdmission(tokenId: string, presented: unknown): Readonly<{ valid: boolean }> {
    const record = this.store.record(tokenId);
    const valid = record?.operation_kind === 'thread/resume' && this.store.isValidFor(tokenId, presented, this.consumeContext());
    return Object.freeze({ valid });
  }

  /** CONSUME: one synchronous section — status CONSUMED, then the governed client writes the bound request. */
  consumeAndSend(tokenId: string, presented: unknown): ConsumeResult {
    return this.store.consumeAndSend(tokenId, presented, this.consumeContext(), (request) =>
      this.config.client.request(request.method, request.params as never),
    );
  }

  /**
   * Every other covered request of the E1 session. It is a covered send outside any bound operation, so it closes the
   * ATTEST -> CONSUME window of every ISSUED token. Protected operations and the attestation request are refused here.
   */
  sendUnprotected<M extends UnprotectedMethod>(method: M, params: CodexClientParams<M>): Promise<CodexCoveredClientResponses[M]> {
    const name: string = method;
    if (isProtectedOperationKind(name) || name === 'experimentalFeature/list' || name === 'initialize') {
      return Promise.reject(new Error(`covered method ${name} is not sendable outside an admission`));
    }
    let owned: CodexClientParams<M>;
    try {
      owned = enforceGovAICodexOutboundPolicy(method, params);
    } catch (error) {
      return Promise.reject(error);
    }
    this.coveredSendOutsideBoundOperation();
    return this.config.client.request(method, owned);
  }

  // Invalidator hooks (Domain O). Each bumps the harness-logical generation and invalidates every ISSUED token.

  noteProcessExitOrRestart(): void {
    this.bump('TOKEN_PROCESS_EXIT_OR_RESTART');
  }

  noteBinarySwitch(): void {
    this.bump('TOKEN_BINARY_CHANGE');
  }

  noteHarnessWrite(): void {
    this.bump('TOKEN_UNAUTHORIZED_FIXTURE_CONFIG_MUTATION');
  }

  noteFixtureInvariantFailure(): void {
    this.bump('TOKEN_FIXTURE_INVARIANT_FAILURE');
  }

  noteFixtureConfigStateTransition(): void {
    this.bump('TOKEN_UNAUTHORIZED_FIXTURE_CONFIG_MUTATION');
  }

  noteEnablementSetOrAccountCall(): void {
    this.bump('TOKEN_ENABLEMENT_SET_OR_ACCOUNT_CALL');
  }

  private consumeContext(): ConsumeContext {
    return Object.freeze({
      nowMonotonic: this.now(),
      processGeneration: this.config.processGeneration,
      binaryIdentity: this.config.binaryIdentity,
      fixtureIdentity: this.config.fixtureIdentity,
      admissionContextGeneration: this.generation,
    });
  }

  private coveredSendOutsideBoundOperation(): void {
    this.bump('TOKEN_COVERED_RPC_IN_ATTEST_CONSUME_WINDOW');
  }

  private bump(reason: OperationTokenInvalidator): void {
    this.store.invalidateAllIssued(reason);
    this.generation += 1;
  }
}
