// CONT-P5-E1 — FEATURE_CONTEXT_BINDING vs OPERATION_REQUEST_BINDING (Dispatch v8 M4; Correction 09 section 10; section
// 15 rows M4 SEPARATION).

import { describe, expect, it } from 'vitest';

import { GovAICodexSafeRequestBuilder as B } from '../protocol/govai-policy.js';
import { OperationAdmissionTokenStore, type ConsumeContext } from './operation-admission-token.js';
import { isExactBoundRequest, OperationBinder, PROTECTED_OPERATION_KINDS, type OperationBindings } from './operation-binder.js';

const W = '/Users/Shared/govai-e1-fixture/work';
const CONTEXT = { fixture_identity: 'fixture:sha256:abc', process_generation: 1, binary_identity: 'bin' } as const;
const GOVERNED = { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' } as const;

function bind(request: unknown, binder = new OperationBinder()): OperationBindings {
  const result = binder.bind(request, CONTEXT);
  if (result.status !== 'BOUND') throw new Error(`not bound: ${result.reason}`);
  return result.bindings;
}

const NOW: ConsumeContext = {
  nowMonotonic: 10,
  processGeneration: 1,
  binaryIdentity: 'bin',
  fixtureIdentity: 'fixture:sha256:abc',
  admissionContextGeneration: 1,
};

describe('the two bindings, separately named', () => {
  it('binds the feature context (kind, exact cwd, sandbox, fixture, generation, binary) and the exact request object', () => {
    const request = B.threadResume({ ...GOVERNED, threadId: 'thr_1', cwd: W, model: 'm' });
    const bindings = bind(request);
    expect(bindings.feature_context).toEqual({
      feature_context_binding_id: 'feature-context:g1:1',
      operation_kind: 'thread/resume',
      cwd: W,
      sandbox: 'workspace-write',
      fixture_identity: 'fixture:sha256:abc',
      process_generation: 1,
      binary_identity: 'bin',
    });
    expect(bindings.request_binding.request_binding_id).toBe('request-binding:g1:1');
    expect(bindings.request_binding.request).toBe(request);
    expect(Object.isFrozen(bindings) && Object.isFrozen(bindings.feature_context) && Object.isFrozen(bindings.request_binding)).toBe(true);
  });

  it('allocates deterministic ids per binder instance', () => {
    const binder = new OperationBinder();
    const a = bind(B.threadStart({ ...GOVERNED, cwd: W }), binder);
    const b = bind(B.threadStart({ ...GOVERNED, cwd: W }), binder);
    expect([a.request_binding.request_binding_id, b.request_binding.request_binding_id]).toEqual(['request-binding:g1:1', 'request-binding:g1:2']);
  });

  it('binds only protected operations, only deeply frozen policy-normalized request objects, only with an explicit cwd', () => {
    const binder = new OperationBinder();
    expect(binder.bind(B.threadRead({ threadId: 't' }), CONTEXT)).toEqual({ status: 'REFUSED', reason: 'NOT_A_PROTECTED_OPERATION' });
    expect(binder.bind(B.experimentalFeatureList(), CONTEXT)).toEqual({ status: 'REFUSED', reason: 'NOT_A_PROTECTED_OPERATION' });
    expect(binder.bind({ method: 'thread/start', params: { ...GOVERNED, cwd: W } }, CONTEXT)).toEqual({ status: 'REFUSED', reason: 'REQUEST_NOT_DEEPLY_FROZEN' });
    const unnormalized = Object.freeze({ method: 'thread/start', params: Object.freeze({ sandbox: 'workspace-write', cwd: W, approvalPolicy: 'on-request', approvalsReviewer: 'user' }) });
    expect(binder.bind(unnormalized, CONTEXT)).toEqual({ status: 'REFUSED', reason: 'REQUEST_NOT_POLICY_NORMALIZED' });
    const forbidden = Object.freeze({ method: 'thread/start', params: Object.freeze({ ...GOVERNED, approvalPolicy: 'never', cwd: W }) });
    expect(binder.bind(forbidden, CONTEXT)).toEqual({ status: 'REFUSED', reason: 'REQUEST_NOT_POLICY_NORMALIZED' });
    expect(binder.bind(B.threadStart({ ...GOVERNED }), CONTEXT)).toEqual({ status: 'REFUSED', reason: 'EXPLICIT_CWD_REQUIRED' });
    expect(binder.bind(B.threadFork({ ...GOVERNED, threadId: 't', lastTurnId: 'u' }), CONTEXT)).toEqual({ status: 'REFUSED', reason: 'EXPLICIT_CWD_REQUIRED' });
    expect(PROTECTED_OPERATION_KINDS).toEqual(['thread/start', 'thread/resume', 'thread/fork']);
  });
});

describe('M4 SEPARATION — the feature-context tuple is not the request identity', () => {
  const base = { ...GOVERNED, threadId: 'thr_1', cwd: W, model: 'm' } as const;
  const variants: readonly (readonly [string, () => unknown])[] = [
    ['different threadId', () => B.threadResume({ ...base, threadId: 'thr_2' })],
    ['different approvalPolicy', () => B.threadResume({ ...base, approvalPolicy: 'untrusted' })],
    ['different approvalsReviewer (none other is admissible: same literal, different object)', () => B.threadResume({ ...base })],
    ['different model', () => B.threadResume({ ...base, model: 'm2' })],
    ['same tuple, different object identity', () => B.threadResume({ ...base })],
    ['structurally equal copy', () => Object.freeze({ method: 'thread/resume', params: Object.freeze({ ...B.threadResume(base).params }) })],
  ];

  for (const [label, make] of variants) {
    it(`${label} -> cannot consume the token bound to the original request`, () => {
      const store = new OperationAdmissionTokenStore();
      const original = B.threadResume(base);
      const bindings = bind(original);
      const token = store.issue({ bindings, admissionContextGeneration: 1, issueMonotonic: 0 });
      let sends = 0;
      const presented = make();
      expect(isExactBoundRequest(bindings, presented)).toBe(false);
      const result = store.consumeAndSend(token.OPERATION_ADMISSION_ID, presented, NOW, () => {
        sends += 1;
        return Promise.resolve({});
      });
      expect(result).toMatchObject({ status: 'REFUSED', failure: 'TOKEN_REQUEST_OBJECT_DRIFT' });
      expect(sends).toBe(0);
      // The drift invalidated the token: not even the original request can use it now.
      expect(store.record(token.OPERATION_ADMISSION_ID)).toMatchObject({ status: 'INVALIDATED', failure: 'TOKEN_REQUEST_OBJECT_DRIFT' });
    });
  }

  it('a different fork boundary is a different request', () => {
    const store = new OperationAdmissionTokenStore();
    const original = B.threadFork({ ...GOVERNED, threadId: 'thr_1', lastTurnId: 'turn_1', cwd: W });
    const token = store.issue({ bindings: bind(original), admissionContextGeneration: 1, issueMonotonic: 0 });
    const other = B.threadFork({ ...GOVERNED, threadId: 'thr_1', lastTurnId: 'turn_2', cwd: W });
    expect(store.consumeAndSend(token.OPERATION_ADMISSION_ID, other, NOW, () => Promise.resolve({}))).toMatchObject({
      status: 'REFUSED',
      failure: 'TOKEN_REQUEST_OBJECT_DRIFT',
    });
  });

  it('a different operation kind with the same feature context is refused as kind drift', () => {
    const store = new OperationAdmissionTokenStore();
    const start = B.threadStart({ ...GOVERNED, cwd: W });
    const token = store.issue({ bindings: bind(start), admissionContextGeneration: 1, issueMonotonic: 0 });
    const resume = B.threadResume({ ...GOVERNED, threadId: 'thr_1', cwd: W });
    expect(store.consumeAndSend(token.OPERATION_ADMISSION_ID, resume, NOW, () => Promise.resolve({}))).toMatchObject({
      status: 'REFUSED',
      failure: 'TOKEN_OPERATION_KIND_DRIFT',
    });
  });

  it('LOADED RESUME, DIFFERENT OVERRIDES: different allowed values bind and admit (identical overrides are never required)', () => {
    const store = new OperationAdmissionTokenStore();
    const startLike = B.threadResume({ ...GOVERNED, threadId: 'thr_1', cwd: W });
    const different = B.threadResume({ threadId: 'thr_1', approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'read-only', cwd: W, model: 'm2' });
    for (const request of [startLike, different]) {
      const token = store.issue({ bindings: bind(request), admissionContextGeneration: 1, issueMonotonic: 0 });
      expect(store.isValidFor(token.OPERATION_ADMISSION_ID, request, NOW)).toBe(true);
    }
  });
});
