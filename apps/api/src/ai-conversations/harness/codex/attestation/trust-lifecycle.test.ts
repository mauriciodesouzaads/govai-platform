// CONT-P5-E1 — the fixture trust lifecycle (Dispatch v8 M6; Correction 08 section 7 and section 18 trust rows).

import { describe, expect, it } from 'vitest';

import { RuntimeProvenanceRegistry } from './runtime-provenance-registry.js';
import { ThreadSafetyStateRegistry } from './thread-safety-state.js';
import { FixtureTrustLifecycle } from './trust-lifecycle.js';

const W = '/Users/Shared/govai-e1-fixture/work';
const REPO = { topology: 'A_WORKSPACE_REPOSITORY', workspaceRoot: W } as const;
const NO_REPO = { topology: 'B_NO_REPOSITORY' } as const;

describe('STATE_0 -> STATE_1 only immediately after an admitted workspace-write thread/start', () => {
  it('trust activation after an admitted workspace-write start is accepted, with the trust key of that start', () => {
    const lifecycle = new FixtureTrustLifecycle();
    expect(lifecycle.requiresSealedStateZeroBytes).toBe(true);
    lifecycle.noteAdmittedThreadStart({ cwd: `${W}/sub`, sandbox: 'workspace-write', topology: REPO });
    expect(lifecycle.allowedTrustKeys()).toEqual([W]);
    expect(lifecycle.requiresSealedStateZeroBytes).toBe(false);
    expect(lifecycle.observe({ state: 'STATE_1', trustKey: W })).toEqual({ status: 'ACCEPTED', transition: 'STATE_0_TO_STATE_1' });
    expect(lifecycle.state).toEqual({ state: 'STATE_1', trustKey: W });
    expect(lifecycle.observe({ state: 'STATE_1', trustKey: W })).toEqual({ status: 'ACCEPTED', transition: 'STATE_1_IDEMPOTENT' });
  });

  it('topology (b): the trust key is the admitted start cwd itself', () => {
    const lifecycle = new FixtureTrustLifecycle();
    lifecycle.noteAdmittedThreadStart({ cwd: W, sandbox: 'workspace-write', topology: NO_REPO });
    expect(lifecycle.allowedTrustKeys()).toEqual([W]);
    expect(lifecycle.observe({ state: 'STATE_1', trustKey: W })).toMatchObject({ status: 'ACCEPTED' });
  });

  it('STOPs on 0 -> 1 without an admitted workspace-write start, after a read-only start, later, or with another key', () => {
    const none = new FixtureTrustLifecycle();
    expect(none.observe({ state: 'STATE_1', trustKey: W })).toEqual({ status: 'STOP', reason: 'STATE_0_TO_STATE_1_WITHOUT_ADMITTED_WORKSPACE_WRITE_START' });

    const readOnly = new FixtureTrustLifecycle();
    readOnly.noteAdmittedThreadStart({ cwd: W, sandbox: 'read-only', topology: NO_REPO });
    expect(readOnly.requiresSealedStateZeroBytes).toBe(true);
    expect(readOnly.observe({ state: 'STATE_1', trustKey: W })).toMatchObject({ status: 'STOP' });

    const late = new FixtureTrustLifecycle();
    late.noteAdmittedThreadStart({ cwd: W, sandbox: 'workspace-write', topology: NO_REPO });
    expect(late.observe({ state: 'STATE_0' })).toEqual({ status: 'ACCEPTED', transition: 'NONE' });
    expect(late.observe({ state: 'STATE_1', trustKey: W })).toMatchObject({ status: 'STOP' });

    const otherKey = new FixtureTrustLifecycle();
    otherKey.noteAdmittedThreadStart({ cwd: W, sandbox: 'workspace-write', topology: NO_REPO });
    expect(otherKey.observe({ state: 'STATE_1', trustKey: '/Users/Shared/elsewhere' })).toMatchObject({ status: 'STOP' });
  });

  it('trust persistence failure + in-memory fallback: the bytes stay STATE_0 and that is accepted', () => {
    const lifecycle = new FixtureTrustLifecycle();
    lifecycle.noteAdmittedThreadStart({ cwd: W, sandbox: 'workspace-write', topology: NO_REPO });
    expect(lifecycle.observe({ state: 'STATE_0' })).toEqual({ status: 'ACCEPTED', transition: 'NONE' });
    expect(lifecycle.state).toEqual({ state: 'STATE_0' });
  });

  it('STOPs on STATE_1 -> STATE_0, on a changed trust key and on any UNAUTHORIZED state', () => {
    const lifecycle = new FixtureTrustLifecycle();
    lifecycle.noteAdmittedThreadStart({ cwd: W, sandbox: 'workspace-write', topology: NO_REPO });
    lifecycle.observe({ state: 'STATE_1', trustKey: W });
    expect(lifecycle.observe({ state: 'STATE_0' })).toEqual({ status: 'STOP', reason: 'STATE_1_TO_STATE_0_WITHIN_FIXTURE_GENERATION' });
    expect(lifecycle.observe({ state: 'STATE_1', trustKey: `${W}-b` })).toEqual({ status: 'STOP', reason: 'STATE_1_TRUST_KEY_CHANGED' });
    expect(lifecycle.observe({ state: 'UNAUTHORIZED', reason: 'FIXTURE_CONFIG_UNEXPECTED_TOP_LEVEL_KEY' })).toEqual({
      status: 'STOP',
      reason: 'UNAUTHORIZED_FIXTURE_CONFIG_STATE',
    });
  });

  it('an admitted 0 -> 1 transition retires no runtime provenance and changes no thread safety state', () => {
    const safety = new ThreadSafetyStateRegistry(new RuntimeProvenanceRegistry(() => 0), () => 0);
    const ref = { logical_thread_id: 'thr_1', process_generation: 1, binary_identity: 'bin' };
    safety.recordAdmittedStart(ref, { OPERATION_ADMISSION_ID: 'a', v1: false, v2: false, FEATURE_CONTEXT_BINDING: 'f', status: 'CONSUMED' });
    const before = JSON.stringify([safety.current(ref), safety.provenance.recordsOfThread('thr_1')]);
    const lifecycle = new FixtureTrustLifecycle();
    lifecycle.noteAdmittedThreadStart({ cwd: W, sandbox: 'workspace-write', topology: NO_REPO });
    lifecycle.observe({ state: 'STATE_1', trustKey: W });
    expect(safety.acknowledgeNonRetirementEvent('ADMITTED_FIXTURE_CONFIG_STATE_0_TO_1')).toBe('NOT_A_RETIREMENT_EVENT');
    expect(JSON.stringify([safety.current(ref), safety.provenance.recordsOfThread('thr_1')])).toBe(before);
  });
});
