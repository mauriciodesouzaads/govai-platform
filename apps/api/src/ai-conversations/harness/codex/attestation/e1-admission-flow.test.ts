// CONT-P5-E1 — the E1 admission modules composed end to end against the unit-tier FAKE app-server (never a Codex
// process): the Probe 08 test contract (Dispatch v3 section 6, carried by v8): 08(a)/(b) coldness established before the
// comparison, 08(c) a possibly-loaded resume with DIFFERENT overrides (UNKNOWN permitted, CHARACTERIZATION_ONLY, no forced
// branch), 08(d) a fork child admitted afresh, 08(e) enforcement payload kept out of mode conformance. Branch evidence is
// always an explicit input; the fake emits no branch signal.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import {
  CANNED_THREAD_ID,
  cannedFeatureListResult,
  cannedSandboxPolicy,
  cannedStockThread,
  cannedThreadResumeResult,
  cannedThreadStartResult,
  makeDisposableDirs,
  writeFakeAppServer,
  type CannedEffectiveSettings,
  type FakeAppServerBehaviour,
} from '../client/fake-app-server.fixture.js';
import { systemPsRunner, type CodexProcessHandle } from '../client/process-handle.js';
import { GovAICodexSafeRequestBuilder as B } from '../protocol/govai-policy.js';
import { attestRuntime, sha256File } from './attest-runtime.js';
import { projectProtectedOperationEvidence, PROTECTED_OPERATION_EVIDENCE_FIELDS } from './evidence-projection.js';
import { E1_ACKNOWLEDGED_ASSUMPTIONS, E1_FIXTURE_CONFIG_TEXT, runPostConsumeDetector } from './fixture-invariants.js';
import { OperationAdmissionService, type OperationAdmissionTokenRecord } from './operation-admission-token.js';
import { OperationBinder, type ProtectedOperationRequest } from './operation-binder.js';
import { classifyResumeObservation, type BranchEvidence, type ResumeObservation } from './resume-observation-classifier.js';
import { validateThreadResumeResponseStructure } from './resume-structural-validator.js';
import { RuntimeProvenanceRegistry } from './runtime-provenance-registry.js';
import { resumeAdmission, ThreadSafetyStateRegistry, type ThreadRef } from './thread-safety-state.js';
import { FixtureTrustLifecycle } from './trust-lifecycle.js';

const dirs = makeDisposableDirs('govai-cont-p5e1-flow-');
writeFileSync(join(dirs.codexHome, 'config.toml'), E1_FIXTURE_CONFIG_TEXT);
const WS_A = join(dirs.work, 'ws-a');
const WS_B = join(dirs.work, 'ws-b');
mkdirSync(WS_A);
mkdirSync(WS_B);
const CHILD_ID = '019a0000-0000-7000-8000-00000000c41d';
const FALSE_FALSE = JSON.stringify(cannedFeatureListResult({ shellSnapshot: false, shellSnapshotV2: false }));

const ORIGINAL: CannedEffectiveSettings = {
  model: 'gpt-e1-model-a',
  cwd: WS_A,
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
  sandbox: cannedSandboxPolicy('workspaceWrite', [WS_A]),
};
const DIFFERENT: CannedEffectiveSettings = {
  model: 'gpt-e1-model-a',
  cwd: WS_B,
  approvalPolicy: 'untrusted',
  approvalsReviewer: 'user',
  sandbox: cannedSandboxPolicy('readOnly'),
};

const handles: CodexProcessHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) if (handle.exited === null) await handle.terminate({ graceMs: 2_000 });
});
afterAll(() => rmSync(dirs.root, { recursive: true, force: true }));

let serial = 0;
async function generation(processGeneration: number, behaviour: FakeAppServerBehaviour) {
  serial += 1;
  const path = writeFakeAppServer(dirs.root, `fake-e1-flow-${serial}`, behaviour);
  const sha = await sha256File(path);
  const attested = await attestRuntime(
    { binaryPath: path, expectedExecutableSha256: sha, expectedVersion: '0.154.0', expectedCodexHome: dirs.codexHome, homeDir: dirs.home, workDir: dirs.work },
    { pin: { executableSha256: sha, release: '0.154.0', executableMemberName: basename(path) }, host: () => ({ platform: 'test', arch: 'fake' }), isPinnedHost: () => true, ps: systemPsRunner },
  );
  handles.push(attested.handle);
  const service = new OperationAdmissionService({
    client: attested.client,
    acknowledgement: { acknowledgedAssumptions: E1_ACKNOWLEDGED_ASSUMPTIONS, acknowledgedBy: 'unit-test' },
    processGeneration,
    binaryIdentity: 'pin-executable-sha256',
    fixtureIdentity: 'fixture:unit-flow',
    codexHome: dirs.codexHome,
    launchCwd: dirs.work,
  });
  return { attested, service };
}

/** The harness side of one protected operation: bind, pre-check + attest, consume. */
async function admitAndConsume(service: OperationAdmissionService, request: ProtectedOperationRequest, lifecycle: FixtureTrustLifecycle) {
  const bound = new OperationBinder().bind(request, {
    fixture_identity: service.fixtureIdentity,
    process_generation: service.processGeneration,
    binary_identity: service.binaryIdentity,
  });
  if (bound.status !== 'BOUND') throw new Error(bound.reason);
  const admitted = await service.admit({
    bindings: bound.bindings,
    allowedTrustKeys: lifecycle.allowedTrustKeys(),
    requireSealedStateZeroBytes: lifecycle.requiresSealedStateZeroBytes,
  });
  if (admitted.status !== 'ADMITTED') throw new Error(admitted.failure);
  return { bindings: bound.bindings, admitted };
}

async function consume(service: OperationAdmissionService, token: OperationAdmissionTokenRecord, request: ProtectedOperationRequest) {
  const sent = service.consumeAndSend(token.OPERATION_ADMISSION_ID, request);
  if (sent.status !== 'SENT') throw new Error(sent.failure);
  return { outcome: await sent.outcome, token: service.store.record(token.OPERATION_ADMISSION_ID)! };
}

function observationOf(outcome: Awaited<ReturnType<typeof consume>>['outcome']): ResumeObservation {
  if (outcome.outcome === 'RESPONSE') return { kind: 'VALIDATED', validation: validateThreadResumeResponseStructure(outcome.result) };
  return { kind: outcome.outcome };
}

async function startThread(service: OperationAdmissionService, safety: ThreadSafetyStateRegistry, lifecycle: FixtureTrustLifecycle): Promise<ThreadRef> {
  const request = B.threadStart({ approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write', cwd: WS_A });
  const { admitted } = await admitAndConsume(service, request, lifecycle);
  const { outcome, token } = await consume(service, admitted.token, request);
  if (outcome.outcome !== 'RESPONSE') throw new Error(outcome.outcome);
  const threadId = ((outcome.result as { thread: { id: string } }).thread).id;
  const ref: ThreadRef = { logical_thread_id: threadId, process_generation: service.processGeneration, binary_identity: service.binaryIdentity };
  safety.recordAdmittedStart(ref, token);
  lifecycle.noteAdmittedThreadStart({ cwd: WS_A, sandbox: 'workspace-write', topology: admitted.precondition.requestedCwdTopology });
  const detector = runPostConsumeDetector({ codexHome: dirs.codexHome, cwds: [WS_A, dirs.work], allowedTrustKeys: lifecycle.allowedTrustKeys() });
  expect(detector.outcome).toBe('NO_UNEXPECTED_RELEVANT_MUTATION_DETECTED');
  expect(lifecycle.observe(detector.observedFixtureConfigState)).toEqual({ status: 'ACCEPTED', transition: 'NONE' });
  return ref;
}

async function resume(
  service: OperationAdmissionService,
  safety: ThreadSafetyStateRegistry,
  lifecycle: FixtureTrustLifecycle,
  ref: ThreadRef,
  request: ProtectedOperationRequest,
  branchEvidence: BranchEvidence,
) {
  const { bindings, admitted } = await admitAndConsume(service, request, lifecycle);
  const pre = safety.current(ref);
  const decision = resumeAdmission({
    pre,
    branchEvidence,
    freshReconstructionAdmission: service.freshReconstructionAdmission(admitted.token.OPERATION_ADMISSION_ID, request),
  });
  expect(decision.admitted).toBe(true);
  const { outcome, token } = await consume(service, admitted.token, request);
  const classification = classifyResumeObservation({
    pre_operation_safety_state: pre,
    branch_evidence: branchEvidence,
    bound_request: request,
    observation: observationOf(outcome),
    reconstruction_admission_ref: token.OPERATION_ADMISSION_ID,
  });
  const applied = safety.applyResumeDecision(ref, token, classification.new_safety_state);
  const known = applied?.safety.state === 'KNOWN_SAFE_ACTIVE' ? applied.createdProvenance : null;
  const evidence = projectProtectedOperationEvidence({
    operation_admission_id: token.OPERATION_ADMISSION_ID,
    operation_type: 'thread/resume',
    feature_context_ref: bindings.feature_context.feature_context_binding_id,
    request_binding_id: bindings.request_binding.request_binding_id,
    process_generation: token.process_generation,
    binary_identity: token.binary_identity,
    shell_snapshot_effective: token.v1,
    shell_snapshot_v2_effective: token.v2,
    issue_monotonic: token.issue_monotonic,
    consume_monotonic: token.consume_monotonic ?? null,
    logical_thread_id: ref.logical_thread_id,
    thread_safety_state_id: applied?.safety.THREAD_SAFETY_STATE_ID ?? null,
    runtime_provenance_id: known?.RUNTIME_PROVENANCE_ID ?? null,
    harness_runtime_incarnation_id: known?.HARNESS_RUNTIME_INCARNATION_ID ?? null,
    failure_enum: classification.evidence_projection.failure_enum,
    resume_observation: classification.evidence_projection,
  });
  return { classification, evidence, token };
}

describe('Probe 08 test contract — composed modules over the fake app-server', () => {
  it('08(c): a possibly-loaded resume with DIFFERENT allowed overrides is admitted, UNKNOWN, CHARACTERIZATION_ONLY, bounded evidence', async () => {
    const { service } = await generation(1, {
      cannedResultsJson: {
        'experimentalFeature/list': [FALSE_FALSE],
        'thread/start': [JSON.stringify(cannedThreadStartResult(ORIGINAL))],
        'thread/resume': [JSON.stringify(cannedThreadResumeResult(ORIGINAL)), JSON.stringify(cannedThreadResumeResult(DIFFERENT))],
      },
    });
    const safety = new ThreadSafetyStateRegistry(new RuntimeProvenanceRegistry());
    const lifecycle = new FixtureTrustLifecycle();
    const ref = await startThread(service, safety, lifecycle);
    expect(ref.logical_thread_id).toBe(CANNED_THREAD_ID);
    const different = B.threadResume({ threadId: CANNED_THREAD_ID, approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'read-only', cwd: WS_B });

    // The response reports the ORIGINAL values: never a loaded confirmation.
    const first = await resume(service, safety, lifecycle, ref, different, 'NONE');
    expect([first.classification.new_safety_state.transition, first.classification.branch_knowledge, first.classification.conformance_result]).toEqual([
      'SAFE_DISJUNCTION',
      'UNKNOWN',
      'CHARACTERIZATION_ONLY',
    ]);
    expect(first.evidence.resume_observation?.normalized_comparison_results?.map((c) => [c.field, c.result])).toEqual([
      ['cwd', 'MISMATCH'],
      ['approvalPolicy', 'MISMATCH'],
      ['approvalsReviewer', 'MATCH'],
      ['sandbox', 'MISMATCH'],
    ]);
    // The response reports the CURRENT request: never a cold PASS.
    const second = await resume(service, safety, lifecycle, ref, B.threadResume({ threadId: CANNED_THREAD_ID, approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'read-only', cwd: WS_B }), 'NONE');
    expect([second.classification.branch_knowledge, second.classification.conformance_result]).toEqual(['UNKNOWN', 'CHARACTERIZATION_ONLY']);

    expect(Object.keys(first.evidence)).toEqual([...PROTECTED_OPERATION_EVIDENCE_FIELDS]);
    expect(first.evidence.runtime_provenance_id).toBeNull();
    expect(first.evidence.harness_runtime_incarnation_id).toBeNull();
    const persisted = JSON.stringify([first.evidence, second.evidence]);
    for (const absent of ['writableRoots', 'instructionSources', 'sessionId', 'environments', 'unified_exec_beta']) expect(persisted).not.toContain(absent);
    expect(safety.current(ref)?.state).toBe('SAFE_DISJUNCTION');
    expect(safety.provenance.recordsOfThread(CANNED_THREAD_ID).map((r) => r.status)).toEqual(['HISTORICAL']);
  });

  it('08(a)/(b): after a supervised restart, coldness is fixed BEFORE the comparison: PASS when equal, FAIL_DOWNSTREAM when not', async () => {
    const safety = new ThreadSafetyStateRegistry(new RuntimeProvenanceRegistry());
    const lifecycle = new FixtureTrustLifecycle();
    const first = await generation(1, {
      cannedResultsJson: { 'experimentalFeature/list': [FALSE_FALSE], 'thread/start': [JSON.stringify(cannedThreadStartResult(ORIGINAL))] },
    });
    const ref1 = await startThread(first.service, safety, lifecycle);
    // Supervised lifecycle boundary: generation 1 ends; every token and every safe state of it is retired.
    await first.attested.handle.terminate({ graceMs: 2_000 });
    first.service.noteProcessExitOrRestart();
    safety.retireGeneration(1, first.service.binaryIdentity, 'PROCESS_EXIT_OR_RESTART');

    const second = await generation(2, {
      cannedResultsJson: {
        'experimentalFeature/list': [FALSE_FALSE],
        'thread/resume': [JSON.stringify(cannedThreadResumeResult(DIFFERENT)), JSON.stringify(cannedThreadResumeResult(ORIGINAL))],
      },
    });
    const ref2: ThreadRef = { ...ref1, process_generation: 2 };
    expect(safety.current(ref2)).toBeNull();
    const request = (): ProtectedOperationRequest =>
      B.threadResume({ threadId: CANNED_THREAD_ID, approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'read-only', cwd: WS_B });
    // Known-cold precondition (8.3 (a)): T was created in generation 1 and nothing created a runtime of T in generation 2.
    const cold = await resume(second.service, safety, lifecycle, ref2, request(), 'PRECONDITION_KNOWN_COLD');
    expect([cold.classification.branch_knowledge, cold.classification.conformance_result]).toEqual(['KNOWN_COLD', 'PASS']);
    expect(cold.evidence.runtime_provenance_id).not.toBeNull();
    expect(cold.evidence.harness_runtime_incarnation_id).not.toBeNull();
    expect(safety.current(ref2)?.state).toBe('KNOWN_SAFE_ACTIVE');
    // A later cold arm against the same generation would contradict the safe state: it is refused before any send.
    expect(resumeAdmission({ pre: safety.current(ref2), branchEvidence: 'PRECONDITION_KNOWN_COLD', freshReconstructionAdmission: { valid: true } })).toEqual({
      admitted: false,
      reason: 'REGISTRY_CONTRADICTION',
    });
    // Same thread id, new incarnation: the generation 1 provenance was retired, the new one links its predecessor.
    const records = safety.provenance.recordsOfThread(CANNED_THREAD_ID);
    expect(records.map((r) => [r.PROCESS_GENERATION, r.status])).toEqual([
      [1, 'RETIRED'],
      [2, 'KNOWN_ACTIVE'],
    ]);
    expect(records[1]!.predecessor_lineage_ref).toBeDefined();
    expect(records[1]!.HARNESS_RUNTIME_INCARNATION_ID).not.toBe(records[0]!.HARNESS_RUNTIME_INCARNATION_ID);

    // A second known-cold arm on a fresh thread id of generation 1 with a mismatching answer: FAIL_DOWNSTREAM.
    const otherRef: ThreadRef = { logical_thread_id: 'thr_generation_1_other', process_generation: 2, binary_identity: second.service.binaryIdentity };
    const mismatch = await resume(
      second.service,
      safety,
      lifecycle,
      otherRef,
      B.threadResume({ threadId: 'thr_generation_1_other', approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'read-only', cwd: WS_B }),
      'PRECONDITION_KNOWN_COLD',
    );
    expect([mismatch.classification.branch_knowledge, mismatch.classification.conformance_result]).toEqual([
      'KNOWN_COLD',
      'FAIL_DOWNSTREAM_REQUESTED_EFFECTIVE_MISMATCH',
    ]);
  });

  it('08(d): a fork child is admitted afresh (its own token, its own provenance); the parent state is never reused', async () => {
    const forkResult = { ...cannedThreadStartResult(ORIGINAL, { id: CHILD_ID, forkedFromId: CANNED_THREAD_ID }) };
    const { service } = await generation(1, {
      cannedResultsJson: {
        'experimentalFeature/list': [FALSE_FALSE],
        'thread/start': [JSON.stringify(cannedThreadStartResult(ORIGINAL))],
        'thread/fork': [JSON.stringify(forkResult)],
      },
    });
    const safety = new ThreadSafetyStateRegistry(new RuntimeProvenanceRegistry());
    const lifecycle = new FixtureTrustLifecycle();
    const parent = await startThread(service, safety, lifecycle);
    const request = B.threadFork({ threadId: CANNED_THREAD_ID, lastTurnId: 'turn_1', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write', cwd: WS_A });
    const { admitted } = await admitAndConsume(service, request, lifecycle);
    expect(admitted.token.operation_kind).toBe('thread/fork');
    const { outcome, token } = await consume(service, admitted.token, request);
    if (outcome.outcome !== 'RESPONSE') throw new Error(outcome.outcome);
    const childRef: ThreadRef = { logical_thread_id: (outcome.result as { thread: { id: string } }).thread.id, process_generation: 1, binary_identity: service.binaryIdentity };
    expect(childRef.logical_thread_id).toBe(CHILD_ID);
    const child = safety.recordAdmittedForkChild(childRef, token);
    expect(child.createdProvenance).toMatchObject({ originating_operation: 'thread/fork', originating_operation_admission_id: token.OPERATION_ADMISSION_ID });
    const parentProvenance = safety.provenance.recordsOfThread(CANNED_THREAD_ID);
    expect(parentProvenance.map((r) => r.status)).toEqual(['KNOWN_ACTIVE']);
    expect(parentProvenance[0]!.RUNTIME_PROVENANCE_ID).not.toBe(child.createdProvenance!.RUNTIME_PROVENANCE_ID);
    expect(safety.current(parent)?.state).toBe('KNOWN_SAFE_ACTIVE');
  });

  it('08(e): the sandbox enforcement payload stays out of mode conformance and out of the evidence', () => {
    const request = B.threadResume({ threadId: CANNED_THREAD_ID, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write', cwd: WS_A });
    const response = cannedThreadResumeResult({
      ...ORIGINAL,
      sandbox: { type: 'workspaceWrite', writableRoots: ['/Users/Shared/enforcement-root-2b77'], networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
    });
    const c = classifyResumeObservation({
      pre_operation_safety_state: null,
      branch_evidence: 'PRECONDITION_KNOWN_COLD',
      bound_request: request,
      observation: { kind: 'VALIDATED', validation: validateThreadResumeResponseStructure(response) },
      reconstruction_admission_ref: 'operation-admission:g1:1',
    });
    expect(c.conformance_result).toBe('PASS');
    expect(JSON.stringify(c.evidence_projection)).not.toContain('enforcement-root-2b77');
  });

  it('MISSING PROVENANCE: a possibly-loaded resume of a thread without a safe state is refused before any send', async () => {
    const { service } = await generation(1, { cannedResultsJson: { 'experimentalFeature/list': [FALSE_FALSE] } });
    const safety = new ThreadSafetyStateRegistry(new RuntimeProvenanceRegistry());
    const lifecycle = new FixtureTrustLifecycle();
    const request = B.threadResume({ threadId: 'thr_unknown', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only', cwd: WS_A });
    const { admitted } = await admitAndConsume(service, request, lifecycle);
    const ref: ThreadRef = { logical_thread_id: 'thr_unknown', process_generation: 1, binary_identity: service.binaryIdentity };
    expect(
      resumeAdmission({
        pre: safety.current(ref),
        branchEvidence: 'NONE',
        freshReconstructionAdmission: service.freshReconstructionAdmission(admitted.token.OPERATION_ADMISSION_ID, request),
      }),
    ).toEqual({ admitted: false, reason: 'MISSING_SESSION_PROVENANCE' });
    expect(service.store.record(admitted.token.OPERATION_ADMISSION_ID)!.status).toBe('ISSUED');
  });

  it('an absent response (the server dies on thread/resume): CONSUMED, SAFE_DISJUNCTION, UNKNOWN, E1_INFRA_FAILURE', async () => {
    const { service } = await generation(1, {
      cannedResultsJson: { 'experimentalFeature/list': [FALSE_FALSE], 'thread/start': [JSON.stringify(cannedThreadStartResult(ORIGINAL))] },
      exitOnMethod: 'thread/resume',
    });
    const safety = new ThreadSafetyStateRegistry(new RuntimeProvenanceRegistry());
    const lifecycle = new FixtureTrustLifecycle();
    const ref = await startThread(service, safety, lifecycle);
    const request = B.threadResume({ threadId: CANNED_THREAD_ID, approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'read-only', cwd: WS_B });
    const { classification, token } = await resume(service, safety, lifecycle, ref, request, 'NONE');
    expect(token.status).toBe('CONSUMED');
    expect([classification.new_safety_state.transition, classification.branch_knowledge, classification.conformance_result]).toEqual([
      'SAFE_DISJUNCTION',
      'UNKNOWN',
      'E1_INFRA_FAILURE',
    ]);
    expect(classification.evidence_projection).toMatchObject({ structural_validation_status: 'NO_RESPONSE', failure_enum: 'SEND_FAILED_AFTER_CONSUME', normalized_comparison_results: null });
  });

  it('a structurally invalid answer on a possibly-loaded resume follows the FAIL row (the stock nested Thread keys are not the failure)', async () => {
    const invalid = cannedThreadResumeResult(DIFFERENT, { thread: cannedStockThread({ source: { custom: 'audit', unexpected: true } }) });
    const { service } = await generation(1, {
      cannedResultsJson: {
        'experimentalFeature/list': [FALSE_FALSE],
        'thread/start': [JSON.stringify(cannedThreadStartResult(ORIGINAL))],
        'thread/resume': [JSON.stringify(invalid)],
      },
    });
    const safety = new ThreadSafetyStateRegistry(new RuntimeProvenanceRegistry());
    const lifecycle = new FixtureTrustLifecycle();
    const ref = await startThread(service, safety, lifecycle);
    const { classification } = await resume(
      service,
      safety,
      lifecycle,
      ref,
      B.threadResume({ threadId: CANNED_THREAD_ID, approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'read-only', cwd: WS_B }),
      'NONE',
    );
    expect([classification.new_safety_state.transition, classification.branch_knowledge, classification.conformance_result]).toEqual([
      'SAFE_DISJUNCTION',
      'UNKNOWN',
      'E1_INFRA_FAILURE',
    ]);
    expect(classification.evidence_projection.structural_failure_reason).toBe('THREAD_PINNED_SCHEMA_VIOLATION');
  });
});
