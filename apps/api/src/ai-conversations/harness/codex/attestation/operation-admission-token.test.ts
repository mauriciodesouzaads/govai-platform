// CONT-P5-E1 — OPERATION_ADMISSION_TOKEN, Domain O (Dispatch v8 M3, M9; Correction 09 sections 4.5, 6, 15 PARSER /
// ADMISSION rows; Correction 08 section 18). The store is exercised in memory; the service runs against the unit-tier FAKE
// app-server (a Node script, never a Codex process) with canned experimentalFeature/list and thread/* answers.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { CodexRequestTimeoutError, CodexServerError, CodexTransportError } from '../client/errors.js';
import {
  CANNED_FEATURE_METADATA_SENTINEL,
  cannedFeatureListResult,
  cannedSandboxPolicy,
  cannedThreadResumeResult,
  cannedThreadStartResult,
  makeDisposableDirs,
  writeFakeAppServer,
  type FakeAppServerBehaviour,
} from '../client/fake-app-server.fixture.js';
import { systemPsRunner, type CodexProcessHandle } from '../client/process-handle.js';
import { GovAICodexSafeRequestBuilder as B } from '../protocol/govai-policy.js';
import { attestRuntime, sha256File, type AttestedCodexRuntime } from './attest-runtime.js';
import { projectFeatureAttestationEvidence } from './evidence-projection.js';
import { E1_ACKNOWLEDGED_ASSUMPTIONS, E1_FIXTURE_CONFIG_TEXT, E1ControlledEnvironmentNotAcknowledged } from './fixture-invariants.js';
import {
  MAX_ADMISSION_INTERVAL_MS,
  OPERATION_ADMISSION_STATUSES,
  OPERATION_TOKEN_INVALIDATORS,
  OperationAdmissionService,
  OperationAdmissionTokenStore,
  type AdmitResult,
  type ConsumeContext,
} from './operation-admission-token.js';
import { OperationBinder, type OperationBindings, type ProtectedOperationRequest } from './operation-binder.js';
import { RuntimeProvenanceRegistry } from './runtime-provenance-registry.js';
import { ThreadSafetyStateRegistry } from './thread-safety-state.js';

const dirs = makeDisposableDirs('govai-cont-p5e1-admission-');
writeFileSync(join(dirs.codexHome, 'config.toml'), E1_FIXTURE_CONFIG_TEXT);
const WORK = join(dirs.work, 'project');
mkdirSync(WORK);
const ACK = { acknowledgedAssumptions: E1_ACKNOWLEDGED_ASSUMPTIONS, acknowledgedBy: 'unit-test' } as const;
const GOVERNED = { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' } as const;
const START = cannedThreadStartResult({
  model: 'gpt-e1-model-a',
  cwd: WORK,
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
  sandbox: cannedSandboxPolicy('workspaceWrite', [WORK]),
});
const FALSE_FALSE = JSON.stringify(cannedFeatureListResult({ shellSnapshot: false, shellSnapshotV2: false }));

const handles: CodexProcessHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) {
    if (handle.exited === null) await handle.terminate({ graceMs: 2_000 });
  }
});
afterAll(() => rmSync(dirs.root, { recursive: true, force: true }));

let serial = 0;
async function session(
  behaviour: FakeAppServerBehaviour,
  options: { readonly now?: () => number; readonly attestationTimeoutMs?: number } = {},
): Promise<{ attested: AttestedCodexRuntime; service: OperationAdmissionService; received: () => string[] }> {
  serial += 1;
  const path = writeFakeAppServer(dirs.root, `fake-e1-app-server-${serial}`, { reportLines: true, ...behaviour });
  const sha = await sha256File(path);
  const attested = await attestRuntime(
    { binaryPath: path, expectedExecutableSha256: sha, expectedVersion: '0.154.0', expectedCodexHome: dirs.codexHome, homeDir: dirs.home, workDir: dirs.work },
    {
      pin: { executableSha256: sha, release: '0.154.0', executableMemberName: basename(path) },
      host: () => ({ platform: 'test', arch: 'fake' }),
      isPinnedHost: () => true,
      ps: systemPsRunner,
    },
  );
  handles.push(attested.handle);
  const service = new OperationAdmissionService({
    client: attested.client,
    acknowledgement: ACK,
    processGeneration: 1,
    binaryIdentity: attested.evidence.executableSha256,
    fixtureIdentity: 'fixture:unit',
    codexHome: dirs.codexHome,
    launchCwd: dirs.work,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.attestationTimeoutMs === undefined ? {} : { attestationTimeoutMs: options.attestationTimeoutMs }),
  });
  const received = (): string[] =>
    [...attested.handle.stderr.tail.matchAll(/^LINE (.*)$/gm)].map((m) => (JSON.parse(m[1] ?? '{}') as { method?: string }).method ?? '');
  return { attested, service, received };
}

async function eventually(predicate: () => boolean): Promise<void> {
  const until = Date.now() + 5_000;
  while (!predicate() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20));
}

function bindFor(service: OperationAdmissionService, request: ProtectedOperationRequest): OperationBindings {
  const result = new OperationBinder().bind(request, {
    fixture_identity: service.fixtureIdentity,
    process_generation: service.processGeneration,
    binary_identity: service.binaryIdentity,
  });
  if (result.status !== 'BOUND') throw new Error(result.reason);
  return result.bindings;
}

async function admit(service: OperationAdmissionService, request: ProtectedOperationRequest): Promise<AdmitResult> {
  return service.admit({ bindings: bindFor(service, request), allowedTrustKeys: [], requireSealedStateZeroBytes: true });
}

// ---------------------------------------------------------------------------------------------------------------------
// The store (no I/O)
// ---------------------------------------------------------------------------------------------------------------------

function storeWithToken(request: ProtectedOperationRequest = B.threadStart({ ...GOVERNED, cwd: WORK })) {
  const store = new OperationAdmissionTokenStore();
  const bindings = new OperationBinder().bind(request, { fixture_identity: 'fx', process_generation: 1, binary_identity: 'bin' });
  if (bindings.status !== 'BOUND') throw new Error('unbound');
  const token = store.issue({ bindings: bindings.bindings, admissionContextGeneration: 3, issueMonotonic: 100 });
  return { store, token, request };
}

const CTX: ConsumeContext = { nowMonotonic: 150, processGeneration: 1, binaryIdentity: 'bin', fixtureIdentity: 'fx', admissionContextGeneration: 3 };

describe('the token store — states, record and the single linearization point', () => {
  it('issues an immutable Correction 09 section 6 record, labelled harness-logical', () => {
    const { token } = storeWithToken();
    expect(token).toEqual({
      OPERATION_ADMISSION_ID: 'operation-admission:g1:1',
      process_generation: 1,
      binary_identity: 'bin',
      fixture_identity: 'fx',
      ADMISSION_CONTEXT_GENERATION: { harnessLogicalCounter: 3, label: 'HARNESS_LOGICAL_DOMAIN_O_COUNTER_NOT_A_SESSION_IDENTITY' },
      operation_kind: 'thread/start',
      FEATURE_CONTEXT_BINDING: 'feature-context:g1:1',
      OPERATION_REQUEST_BINDING: 'request-binding:g1:1',
      v1: false,
      v2: false,
      complete: true,
      issue_monotonic: 100,
      status: 'ISSUED',
    });
    expect(Object.isFrozen(token)).toBe(true);
    expect(OPERATION_ADMISSION_STATUSES).toEqual(['ISSUED', 'CONSUMED', 'INVALIDATED', 'EXPIRED']);
    expect(MAX_ADMISSION_INTERVAL_MS).toBe(10_000);
  });

  it('CONSUME: status CONSUMED synchronously before the send; a replay is refused and sends nothing', async () => {
    const { store, token, request } = storeWithToken();
    const seen: string[] = [];
    const result = store.consumeAndSend(token.OPERATION_ADMISSION_ID, request, CTX, () => {
      seen.push(store.record(token.OPERATION_ADMISSION_ID)!.status);
      return Promise.resolve({ ok: true });
    });
    expect(seen).toEqual(['CONSUMED']);
    expect(result).toMatchObject({ status: 'SENT', token: { status: 'CONSUMED', consume_monotonic: 150 } });
    if (result.status === 'SENT') expect(await result.outcome).toEqual({ outcome: 'RESPONSE', result: { ok: true } });
    expect(store.consumeAndSend(token.OPERATION_ADMISSION_ID, request, CTX, () => Promise.resolve({}))).toMatchObject({
      status: 'REFUSED',
      failure: 'TOKEN_NOT_ISSUED',
    });
    expect(seen).toHaveLength(1);
  });

  it('terminal states have no outgoing transition', () => {
    const { store, token, request } = storeWithToken();
    store.invalidate(token.OPERATION_ADMISSION_ID, 'TOKEN_BINARY_CHANGE');
    expect(store.invalidate(token.OPERATION_ADMISSION_ID, 'TOKEN_MAX_ADMISSION_INTERVAL_EXPIRED')).toMatchObject({ status: 'INVALIDATED', failure: 'TOKEN_BINARY_CHANGE' });
    expect(store.consumeAndSend(token.OPERATION_ADMISSION_ID, request, CTX, () => Promise.resolve({}))).toMatchObject({ failure: 'TOKEN_NOT_ISSUED' });
    expect(store.consumeAndSend('operation-admission:g1:99', request, CTX, () => Promise.resolve({}))).toMatchObject({ failure: 'UNKNOWN_TOKEN', token: null });
  });

  it('uncertain transport outcome: the token stays CONSUMED, SEND_FAILED_AFTER_CONSUME, never a second send', async () => {
    for (const failure of [new CodexTransportError('stdout_closed'), new CodexRequestTimeoutError('thread/start', 5)]) {
      const { store, token, request } = storeWithToken();
      let sends = 0;
      const result = store.consumeAndSend(token.OPERATION_ADMISSION_ID, request, CTX, () => {
        sends += 1;
        return Promise.reject(failure);
      });
      if (result.status !== 'SENT') throw new Error('not sent');
      expect(await result.outcome).toEqual({ outcome: 'SEND_FAILED_AFTER_CONSUME' });
      expect(store.record(token.OPERATION_ADMISSION_ID)!.status).toBe('CONSUMED');
      store.consumeAndSend(token.OPERATION_ADMISSION_ID, request, CTX, () => {
        sends += 1;
        return Promise.resolve({});
      });
      expect(sends).toBe(1);
    }
    const { store, token, request } = storeWithToken();
    const thrown = store.consumeAndSend(token.OPERATION_ADMISSION_ID, request, CTX, () => {
      throw new Error('synchronous write failure');
    });
    if (thrown.status !== 'SENT') throw new Error('not sent');
    expect(await thrown.outcome).toEqual({ outcome: 'SEND_FAILED_AFTER_CONSUME' });
    expect(store.record(token.OPERATION_ADMISSION_ID)!.status).toBe('CONSUMED');
  });

  it('a JSON-RPC error answer is RPC_ERROR (its text is never carried)', async () => {
    const { store, token, request } = storeWithToken();
    const result = store.consumeAndSend(token.OPERATION_ADMISSION_ID, request, CTX, () =>
      Promise.reject(new CodexServerError('thread/start', -32603, 'server text 5a1c', { secret: 'x' })),
    );
    if (result.status !== 'SENT') throw new Error('not sent');
    const outcome = await result.outcome;
    expect(outcome).toEqual({ outcome: 'RPC_ERROR' });
    expect(JSON.stringify(outcome)).not.toContain('5a1c');
  });

  it('concurrent consume attempts have exactly one winner', () => {
    const { store, token, request } = storeWithToken();
    let sends = 0;
    const send = (): Promise<unknown> => {
      sends += 1;
      return new Promise(() => undefined);
    };
    const results = [store.consumeAndSend(token.OPERATION_ADMISSION_ID, request, CTX, send), store.consumeAndSend(token.OPERATION_ADMISSION_ID, request, CTX, send)];
    expect(results.map((r) => r.status)).toEqual(['SENT', 'REFUSED']);
    expect(sends).toBe(1);
  });

  it('expiry, generation, binary and fixture drift refuse the send and invalidate (or expire) the token', () => {
    const cases: readonly (readonly [Partial<ConsumeContext>, string, string])[] = [
      [{ nowMonotonic: 100 + MAX_ADMISSION_INTERVAL_MS + 1 }, 'TOKEN_MAX_ADMISSION_INTERVAL_EXPIRED', 'EXPIRED'],
      [{ processGeneration: 2 }, 'TOKEN_ADMISSION_CONTEXT_OR_PROCESS_GENERATION_MISMATCH', 'INVALIDATED'],
      [{ admissionContextGeneration: 4 }, 'TOKEN_ADMISSION_CONTEXT_OR_PROCESS_GENERATION_MISMATCH', 'INVALIDATED'],
      [{ binaryIdentity: 'successor-bin' }, 'TOKEN_BINARY_CHANGE', 'INVALIDATED'],
      [{ fixtureIdentity: 'other-fixture' }, 'TOKEN_FEATURE_CONTEXT_DRIFT', 'INVALIDATED'],
    ];
    for (const [change, failure, status] of cases) {
      const { store, token, request } = storeWithToken();
      let sends = 0;
      const result = store.consumeAndSend(token.OPERATION_ADMISSION_ID, request, { ...CTX, ...change }, () => {
        sends += 1;
        return Promise.resolve({});
      });
      expect(result, failure).toMatchObject({ status: 'REFUSED', failure, token: { status } });
      expect(sends).toBe(0);
    }
    // Within the interval: satisfaction of the secondary guard alone is enough to send, and proves nothing more.
    const { store, token, request } = storeWithToken();
    expect(store.isValidFor(token.OPERATION_ADMISSION_ID, request, { ...CTX, nowMonotonic: 100 + MAX_ADMISSION_INTERVAL_MS })).toBe(true);
  });

  it('lists the Correction 09 section 6 invalidators as the Domain O hook set', () => {
    expect(OPERATION_TOKEN_INVALIDATORS).toEqual([
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
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The service against the fake app-server
// ---------------------------------------------------------------------------------------------------------------------

describe('the admission service — PARSER / ADMISSION rows against canned fake answers', () => {
  it('refuses to start without the explicit controlled-environment acknowledgement', async () => {
    const { attested } = await session({});
    expect(
      () =>
        new OperationAdmissionService({
          client: attested.client,
          acknowledgement: {} as never,
          processGeneration: 1,
          binaryIdentity: 'b',
          fixtureIdentity: 'f',
          codexHome: dirs.codexHome,
          launchCwd: dirs.work,
        }),
    ).toThrow(E1ControlledEnvironmentNotAcknowledged);
  });

  it('false / false -> ADMITTED; CONSUME sends exactly the bound thread/start once', async () => {
    const { service, received } = await session({
      cannedResultsJson: { 'experimentalFeature/list': [FALSE_FALSE], 'thread/start': [JSON.stringify(START)] },
    });
    const request = B.threadStart({ ...GOVERNED, cwd: WORK });
    const admitted = await admit(service, request);
    expect(admitted).toMatchObject({
      status: 'ADMITTED',
      token: { status: 'ISSUED', operation_kind: 'thread/start', v1: false, v2: false, complete: true },
      precondition: { requestedCwd: WORK, fixtureConfigState: 'STATE_0', sealedStateZeroBytesVerified: true },
      attestation: { shellSnapshotEffective: false, shellSnapshotV2Effective: false, complete: true, parseFailure: null },
    });
    if (admitted.status !== 'ADMITTED') throw new Error('not admitted');
    const sent = service.consumeAndSend(admitted.token.OPERATION_ADMISSION_ID, request);
    if (sent.status !== 'SENT') throw new Error('not sent');
    const outcome = await sent.outcome;
    expect(outcome).toMatchObject({ outcome: 'RESPONSE', result: { thread: { id: expect.any(String) } } });
    await eventually(() => received().includes('thread/start'));
    expect(received()).toEqual(['initialize', 'initialized', 'experimentalFeature/list', 'thread/start']);
  });

  it('V1 true -> blocked; V2 true -> blocked; no token is issued', async () => {
    for (const [bits, failure] of [
      [{ shellSnapshot: true, shellSnapshotV2: false }, 'SHELL_SNAPSHOT_V1_TRUE_BLOCKED'],
      [{ shellSnapshot: false, shellSnapshotV2: true }, 'SHELL_SNAPSHOT_V2_TRUE_BLOCKED'],
    ] as const) {
      const { service } = await session({ cannedResultsJson: { 'experimentalFeature/list': [JSON.stringify(cannedFeatureListResult(bits))] } });
      const result = await admit(service, B.threadStart({ ...GOVERNED, cwd: WORK }));
      expect(result).toMatchObject({ status: 'REFUSED', failure });
      expect(service.store.issuedTokenIds()).toEqual([]);
    }
  });

  it('missing / duplicate / malformed / continued pages fail closed with the parser reason', async () => {
    const pages: readonly (readonly [unknown, string])[] = [
      [{ data: [], nextCursor: null }, 'TARGET_MISSING'],
      [cannedFeatureListResult({ shellSnapshot: false, shellSnapshotV2: false }, { nextCursor: '3' }), 'UNEXPECTED_CONTINUATION_CURSOR'],
      [{ data: [{ name: 'shell_snapshot', enabled: 'no' }], nextCursor: null }, 'ENTRY_ENABLED_NOT_A_BOOLEAN'],
      [
        { data: [{ name: 'shell_snapshot', enabled: false }, { name: 'shell_snapshot', enabled: false }, { name: 'shell_snapshot_v2', enabled: false }], nextCursor: null },
        'TARGET_DUPLICATE',
      ],
    ];
    const { service } = await session({ cannedResultsJson: { 'experimentalFeature/list': pages.map(([p]) => JSON.stringify(p)) } });
    for (const [, reason] of pages) {
      const result = await admit(service, B.threadStart({ ...GOVERNED, cwd: WORK }));
      expect(result).toMatchObject({ status: 'REFUSED', failure: 'ATTESTATION_RESULT_INVALID', attestation: { parseFailure: reason } });
    }
    expect(service.store.issuedTokenIds()).toEqual([]);
  });

  it('RPC failure and attestation timeout fail closed', async () => {
    const failing = await session({ errorOnMethod: 'experimentalFeature/list' });
    expect(await admit(failing.service, B.threadStart({ ...GOVERNED, cwd: WORK }))).toMatchObject({
      status: 'REFUSED',
      failure: 'TOKEN_RPC_OR_TRANSPORT_FAILURE_BEFORE_ATTESTATION',
    });
    const silent = await session({ noAnswerOnMethod: 'experimentalFeature/list' }, { attestationTimeoutMs: 150 });
    expect(await admit(silent.service, B.threadStart({ ...GOVERNED, cwd: WORK }))).toMatchObject({ status: 'REFUSED', failure: 'TOKEN_ATTESTATION_TIMEOUT' });
  });

  it('a pre-check failure issues no attestation at all (INV-PROJ present -> nothing reaches the server)', async () => {
    const { service, received } = await session({ cannedResultsJson: { 'experimentalFeature/list': [FALSE_FALSE] } });
    const dirty = join(dirs.work, `dirty-${serial}`);
    mkdirSync(join(dirty, '.codex'), { recursive: true });
    writeFileSync(join(dirty, '.codex', 'config.toml'), '');
    const result = await admit(service, B.threadStart({ ...GOVERNED, cwd: dirty }));
    expect(result).toMatchObject({ status: 'REFUSED', failure: 'TOKEN_FIXTURE_INVARIANT_FAILURE', preconditionFailure: { invariant: 'INV-PROJ' } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received()).not.toContain('experimentalFeature/list');
  });

  it('a generation change during the attestation fails the admission', async () => {
    const { service } = await session({ cannedResultsJson: { 'experimentalFeature/list': [FALSE_FALSE] } });
    const pending = admit(service, B.threadStart({ ...GOVERNED, cwd: WORK }));
    service.noteHarnessWrite();
    expect(await pending).toMatchObject({ status: 'REFUSED', failure: 'TOKEN_ADMISSION_CONTEXT_OR_PROCESS_GENERATION_MISMATCH' });
  });

  it('an intervening covered RPC in the ATTEST -> CONSUME window INVALIDATES the token; nothing protected is sent', async () => {
    const { service, received } = await session({ cannedResultsJson: { 'experimentalFeature/list': [FALSE_FALSE] } });
    const request = B.threadStart({ ...GOVERNED, cwd: WORK });
    const admitted = await admit(service, request);
    if (admitted.status !== 'ADMITTED') throw new Error('not admitted');
    await service.sendUnprotected('thread/read', { threadId: 'thr_other' });
    expect(service.store.record(admitted.token.OPERATION_ADMISSION_ID)).toMatchObject({ status: 'INVALIDATED', failure: 'TOKEN_COVERED_RPC_IN_ATTEST_CONSUME_WINDOW' });
    expect(service.consumeAndSend(admitted.token.OPERATION_ADMISSION_ID, request)).toMatchObject({ status: 'REFUSED', failure: 'TOKEN_NOT_ISSUED' });
    await eventually(() => received().includes('thread/read'));
    expect(received()).not.toContain('thread/start');
  });

  it('process restart / binary switch / fixture events invalidate every ISSUED token', async () => {
    const hooks = [
      ['noteProcessExitOrRestart', 'TOKEN_PROCESS_EXIT_OR_RESTART'],
      ['noteBinarySwitch', 'TOKEN_BINARY_CHANGE'],
      ['noteFixtureInvariantFailure', 'TOKEN_FIXTURE_INVARIANT_FAILURE'],
      ['noteFixtureConfigStateTransition', 'TOKEN_UNAUTHORIZED_FIXTURE_CONFIG_MUTATION'],
      ['noteHarnessWrite', 'TOKEN_UNAUTHORIZED_FIXTURE_CONFIG_MUTATION'],
      ['noteEnablementSetOrAccountCall', 'TOKEN_ENABLEMENT_SET_OR_ACCOUNT_CALL'],
    ] as const;
    const { service } = await session({ cannedResultsJson: { 'experimentalFeature/list': [FALSE_FALSE] } });
    for (const [hook, failure] of hooks) {
      const request = B.threadStart({ ...GOVERNED, cwd: WORK });
      const admitted = await admit(service, request);
      if (admitted.status !== 'ADMITTED') throw new Error('not admitted');
      service[hook]();
      expect(service.store.record(admitted.token.OPERATION_ADMISSION_ID), hook).toMatchObject({ status: 'INVALIDATED', failure });
      expect(service.consumeAndSend(admitted.token.OPERATION_ADMISSION_ID, request)).toMatchObject({ status: 'REFUSED' });
    }
  });

  it('token invalidators never retire or alter a thread safety state or runtime provenance (Domain O != Domain S)', async () => {
    const { service } = await session({ cannedResultsJson: { 'experimentalFeature/list': [FALSE_FALSE] } });
    const safety = new ThreadSafetyStateRegistry(new RuntimeProvenanceRegistry(() => 0), () => 0);
    const ref = { logical_thread_id: 'thr_1', process_generation: 1, binary_identity: service.binaryIdentity };
    safety.recordAdmittedStart(ref, { OPERATION_ADMISSION_ID: 'a', v1: false, v2: false, FEATURE_CONTEXT_BINDING: 'f', status: 'CONSUMED' });
    const before = JSON.stringify([safety.current(ref), safety.provenance.recordsOfThread('thr_1')]);
    const admitted = await admit(service, B.threadStart({ ...GOVERNED, cwd: WORK }));
    expect(admitted.status).toBe('ADMITTED');
    service.noteProcessExitOrRestart();
    service.noteBinarySwitch();
    service.noteHarnessWrite();
    expect(JSON.stringify([safety.current(ref), safety.provenance.recordsOfThread('thr_1')])).toBe(before);
  });

  it('uncertain transport after consume (the server dies on thread/resume): CONSUMED, SEND_FAILED_AFTER_CONSUME, no second send', async () => {
    const { service, received } = await session({ cannedResultsJson: { 'experimentalFeature/list': [FALSE_FALSE] }, exitOnMethod: 'thread/resume' });
    const request = B.threadResume({ ...GOVERNED, threadId: 'thr_1', cwd: WORK });
    const admitted = await admit(service, request);
    if (admitted.status !== 'ADMITTED') throw new Error('not admitted');
    expect(service.freshReconstructionAdmission(admitted.token.OPERATION_ADMISSION_ID, request)).toEqual({ valid: true });
    const sent = service.consumeAndSend(admitted.token.OPERATION_ADMISSION_ID, request);
    if (sent.status !== 'SENT') throw new Error('not sent');
    expect(await sent.outcome).toEqual({ outcome: 'SEND_FAILED_AFTER_CONSUME' });
    expect(service.store.record(admitted.token.OPERATION_ADMISSION_ID)!.status).toBe('CONSUMED');
    expect(service.consumeAndSend(admitted.token.OPERATION_ADMISSION_ID, request)).toMatchObject({ status: 'REFUSED', failure: 'TOKEN_NOT_ISSUED' });
    expect(received().filter((m) => m === 'thread/resume')).toHaveLength(1);
  });

  it('concurrent consume against the live channel: one winner, one line on the wire', async () => {
    const { service, received } = await session({
      cannedResultsJson: { 'experimentalFeature/list': [FALSE_FALSE], 'thread/start': [JSON.stringify(START)] },
    });
    const request = B.threadStart({ ...GOVERNED, cwd: WORK });
    const admitted = await admit(service, request);
    if (admitted.status !== 'ADMITTED') throw new Error('not admitted');
    const id = admitted.token.OPERATION_ADMISSION_ID;
    const [first, second] = [service.consumeAndSend(id, request), service.consumeAndSend(id, request)];
    expect([first.status, second.status]).toEqual(['SENT', 'REFUSED']);
    if (first.status === 'SENT') await first.outcome;
    await eventually(() => received().includes('thread/start'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received().filter((m) => m === 'thread/start')).toHaveLength(1);
  });

  it('P2 is exact: a fresh reconstruction admission is valid only for its own thread/resume request object', async () => {
    const { service } = await session({ cannedResultsJson: { 'experimentalFeature/list': [FALSE_FALSE] } });
    const request = B.threadResume({ ...GOVERNED, threadId: 'thr_1', cwd: WORK });
    const admitted = await admit(service, request);
    if (admitted.status !== 'ADMITTED') throw new Error('not admitted');
    const id = admitted.token.OPERATION_ADMISSION_ID;
    expect(service.freshReconstructionAdmission(id, B.threadResume({ ...GOVERNED, threadId: 'thr_1', cwd: WORK }))).toEqual({ valid: false });
    expect(service.freshReconstructionAdmission(id, request)).toEqual({ valid: true });
    const start = B.threadStart({ ...GOVERNED, cwd: WORK });
    const startAdmission = await admit(service, start);
    if (startAdmission.status !== 'ADMITTED') throw new Error('not admitted');
    expect(service.freshReconstructionAdmission(startAdmission.token.OPERATION_ADMISSION_ID, start)).toEqual({ valid: false });
    // The second attestation closed the first token's window.
    expect(service.freshReconstructionAdmission(id, request)).toEqual({ valid: false });
  });

  it('sends nothing protected, and no attestation, outside an admission', async () => {
    const { service } = await session({});
    for (const method of ['thread/start', 'thread/resume', 'thread/fork', 'experimentalFeature/list', 'initialize']) {
      await expect(service.sendUnprotected(method as never, {} as never)).rejects.toThrow('not sendable outside an admission');
    }
  });
});

describe('SINK — the attestation evidence carries the two bits and bounded codes only', () => {
  it('no feature metadata, raw page, malformed payload or RPC error text reaches the projected evidence', async () => {
    const { service, attested } = await session({
      cannedResultsJson: {
        'experimentalFeature/list': [
          FALSE_FALSE,
          JSON.stringify({ data: [{ name: CANNED_FEATURE_METADATA_SENTINEL, enabled: 'malformed' }], nextCursor: null }),
        ],
      },
    });
    const request = B.threadStart({ ...GOVERNED, cwd: WORK });
    const bindings = bindFor(service, request);
    const results = [
      await service.admit({ bindings, allowedTrustKeys: [], requireSealedStateZeroBytes: true }),
      await service.admit({ bindings, allowedTrustKeys: [], requireSealedStateZeroBytes: true }),
    ];
    const erroring = await session({ errorOnMethod: 'experimentalFeature/list' });
    results.push(await erroring.service.admit({ bindings: bindFor(erroring.service, request), allowedTrustKeys: [], requireSealedStateZeroBytes: true }));
    for (const result of results) {
      const evidence = projectFeatureAttestationEvidence({
        operation_admission_id: result.status === 'ADMITTED' ? result.token.OPERATION_ADMISSION_ID : null,
        operation_type: 'thread/start',
        operation_reference: bindings.request_binding.request_binding_id,
        shell_snapshot_effective: result.attestation?.shellSnapshotEffective ?? null,
        shell_snapshot_v2_effective: result.attestation?.shellSnapshotV2Effective ?? null,
        complete: result.attestation?.complete ?? false,
        binary_identity: service.binaryIdentity,
        process_generation: service.processGeneration,
        status: result.status,
        failure_enum: result.status === 'REFUSED' ? result.failure : null,
        parse_failure: result.attestation?.parseFailure ?? null,
        issue_monotonic: result.status === 'ADMITTED' ? result.token.issue_monotonic : null,
        consume_monotonic: null,
      });
      const persisted = JSON.stringify([evidence, result]);
      expect(persisted).not.toContain(CANNED_FEATURE_METADATA_SENTINEL);
      expect(persisted).not.toContain('fake experimentalFeature/list failure');
      expect(persisted).not.toContain('unified_exec_beta');
    }
    expect(results.map((r) => r.status)).toEqual(['ADMITTED', 'REFUSED', 'REFUSED']);
    // The post-handshake tap stays disabled: the attestation evidence still holds the handshake only.
    expect(JSON.stringify(attested.evidence)).not.toContain('experimentalFeature/list');
  });

  it('a canned thread/resume answer is a stock-shaped result (no branch signal exists on the wire to model)', () => {
    const resume = cannedThreadResumeResult({ model: 'm', cwd: WORK, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: cannedSandboxPolicy('readOnly') });
    expect(Object.keys(resume).sort()).toEqual(
      ['approvalPolicy', 'approvalsReviewer', 'cwd', 'instructionSources', 'itemsBackwardsCursor', 'model', 'modelProvider', 'reasoningEffort', 'sandbox', 'serviceTier', 'thread', 'turnsBackwardsCursor'],
    );
  });
});
