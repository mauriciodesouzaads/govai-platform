// CONT-P5-E1 — THREAD_SAFETY_STATE (Dispatch v8 M7b, M9; Correction 10 sections 5, 6.6, 7, 13, 14; section 18 rows
// RUNTIME PROVENANCE, MISSING PROVENANCE, POSITIVE COLD, FORK, SUCCESSOR, NO CLAIM, and the two invalidator hook sets).

import { describe, expect, it } from 'vitest';

import { OPERATION_TOKEN_INVALIDATORS } from './operation-admission-token.js';
import { RuntimeProvenanceRegistry } from './runtime-provenance-registry.js';
import {
  nextThreadSafetyState,
  NOT_SESSION_PROVENANCE_RETIREMENT_EVENTS,
  resumeAdmission,
  SESSION_PROVENANCE_RETIREMENT_EVENTS,
  THREAD_SAFETY_STATES,
  ThreadSafetyStateRefused,
  ThreadSafetyStateRegistry,
  type ThreadRef,
  type ThreadSafetyEvent,
  type ThreadSafetyStateRecord,
} from './thread-safety-state.js';

const REF: ThreadRef = { logical_thread_id: 'thr_1', process_generation: 1, binary_identity: 'bin' };
const admission = (n: number, generation = 1) => ({
  OPERATION_ADMISSION_ID: `operation-admission:g${generation}:${n}`,
  v1: false as const,
  v2: false as const,
  FEATURE_CONTEXT_BINDING: `feature-context:g${generation}:${n}`,
  status: 'CONSUMED' as const,
});

function registry(): ThreadSafetyStateRegistry {
  return new ThreadSafetyStateRegistry(new RuntimeProvenanceRegistry(() => 0), () => 0);
}

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ThreadSafetyStateRefused) return error.reason;
    throw error;
  }
  throw new Error('expected a ThreadSafetyStateRefused');
}

const RECORDS: Readonly<Record<string, ThreadSafetyStateRecord | null>> = {
  NONE: null,
  KNOWN_SAFE_ACTIVE: { THREAD_SAFETY_STATE_ID: 'tss:ksa', logical_thread_id: 'thr_1', PROCESS_GENERATION: 1, BINARY_IDENTITY: 'bin', creation_monotonic: 0, state: 'KNOWN_SAFE_ACTIVE', runtime_provenance_id: 'rp:1' },
  SAFE_DISJUNCTION: {
    THREAD_SAFETY_STATE_ID: 'tss:sd',
    logical_thread_id: 'thr_1',
    PROCESS_GENERATION: 1,
    BINARY_IDENTITY: 'bin',
    creation_monotonic: 0,
    state: 'SAFE_DISJUNCTION',
    safety_lineage_refs: ['tss:ksa', 'adm:2'],
    latest_reconstruction_admission_ref: 'adm:2',
  },
  RETIRED: {
    THREAD_SAFETY_STATE_ID: 'tss:ret',
    logical_thread_id: 'thr_1',
    PROCESS_GENERATION: 1,
    BINARY_IDENTITY: 'bin',
    creation_monotonic: 0,
    state: 'RETIRED',
    retirement_event: 'KNOWN_UNLOAD_OR_DESTRUCTION',
    retirement_monotonic: 1,
  },
};

const EVENTS: readonly ThreadSafetyEvent[] = [
  { kind: 'ADMITTED_START_SUCCESS' },
  { kind: 'ADMITTED_FORK_CHILD_SUCCESS' },
  { kind: 'ADMITTED_KNOWN_COLD_RESUME_SUCCESS', reconstructionAdmissionRef: 'adm:9' },
  { kind: 'ADMITTED_KNOWN_COLD_RESUME_ATTEMPT_FAILED', reconstructionAdmissionRef: 'adm:9' },
  { kind: 'POSSIBLY_LOADED_RESUME_BRANCH_UNKNOWN', reconstructionAdmissionRef: 'adm:9' },
  { kind: 'RETIREMENT', event: 'KNOWN_THREAD_DELETION' },
];

describe('THREAD_SAFETY_STATE — three states, the exhaustive section 5.4 table', () => {
  it('has exactly KNOWN_SAFE_ACTIVE / SAFE_DISJUNCTION / RETIRED (no "unsafe" value)', () => {
    expect(THREAD_SAFETY_STATES).toEqual(['KNOWN_SAFE_ACTIVE', 'SAFE_DISJUNCTION', 'RETIRED']);
  });

  it('allows exactly the section 5.4 transitions (plus the section 13 validity = FAIL row) and refuses every other one', () => {
    const table: Record<string, Record<string, string>> = {};
    for (const [from, pre] of Object.entries(RECORDS)) {
      table[from] = {};
      for (const event of EVENTS) {
        const t = nextThreadSafetyState(pre, event);
        table[from]![event.kind] = t.allowed ? t.to : 'REFUSED';
      }
    }
    expect(table).toEqual({
      NONE: {
        ADMITTED_START_SUCCESS: 'KNOWN_SAFE_ACTIVE',
        ADMITTED_FORK_CHILD_SUCCESS: 'KNOWN_SAFE_ACTIVE',
        ADMITTED_KNOWN_COLD_RESUME_SUCCESS: 'KNOWN_SAFE_ACTIVE',
        ADMITTED_KNOWN_COLD_RESUME_ATTEMPT_FAILED: 'SAFE_DISJUNCTION',
        POSSIBLY_LOADED_RESUME_BRANCH_UNKNOWN: 'REFUSED',
        RETIREMENT: 'REFUSED',
      },
      KNOWN_SAFE_ACTIVE: {
        ADMITTED_START_SUCCESS: 'REFUSED',
        ADMITTED_FORK_CHILD_SUCCESS: 'REFUSED',
        ADMITTED_KNOWN_COLD_RESUME_SUCCESS: 'REFUSED',
        ADMITTED_KNOWN_COLD_RESUME_ATTEMPT_FAILED: 'REFUSED',
        POSSIBLY_LOADED_RESUME_BRANCH_UNKNOWN: 'SAFE_DISJUNCTION',
        RETIREMENT: 'RETIRED',
      },
      SAFE_DISJUNCTION: {
        ADMITTED_START_SUCCESS: 'REFUSED',
        ADMITTED_FORK_CHILD_SUCCESS: 'REFUSED',
        ADMITTED_KNOWN_COLD_RESUME_SUCCESS: 'REFUSED',
        ADMITTED_KNOWN_COLD_RESUME_ATTEMPT_FAILED: 'REFUSED',
        POSSIBLY_LOADED_RESUME_BRANCH_UNKNOWN: 'SAFE_DISJUNCTION',
        RETIREMENT: 'RETIRED',
      },
      RETIRED: {
        ADMITTED_START_SUCCESS: 'REFUSED',
        ADMITTED_FORK_CHILD_SUCCESS: 'REFUSED',
        ADMITTED_KNOWN_COLD_RESUME_SUCCESS: 'KNOWN_SAFE_ACTIVE',
        ADMITTED_KNOWN_COLD_RESUME_ATTEMPT_FAILED: 'SAFE_DISJUNCTION',
        POSSIBLY_LOADED_RESUME_BRANCH_UNKNOWN: 'REFUSED',
        RETIREMENT: 'REFUSED',
      },
    });
  });

  it('builds the safe-disjunction lineage from admissions only: [prior known state, ...reconstruction admissions]', () => {
    const fromKsa = nextThreadSafetyState(RECORDS['KNOWN_SAFE_ACTIVE']!, EVENTS[4]!);
    expect(fromKsa).toMatchObject({ to: 'SAFE_DISJUNCTION', safetyLineageRefs: ['tss:ksa', 'adm:9'] });
    const fromSd = nextThreadSafetyState(RECORDS['SAFE_DISJUNCTION']!, EVENTS[4]!);
    expect(fromSd).toMatchObject({ to: 'SAFE_DISJUNCTION', safetyLineageRefs: ['tss:ksa', 'adm:2', 'adm:9'] });
  });
});

describe('the ONLY admission predicate for a resume: P1 AND P2 (missing provenance fails closed, never cold)', () => {
  const p2 = { valid: true };
  const noP2 = { valid: false };

  it('possibly-loaded (evidence NONE): admitted only with a safe state (P1) AND a fresh reconstruction admission (P2)', () => {
    for (const pre of [RECORDS['KNOWN_SAFE_ACTIVE']!, RECORDS['SAFE_DISJUNCTION']!]) {
      expect(resumeAdmission({ pre, branchEvidence: 'NONE', freshReconstructionAdmission: p2 })).toEqual({
        admitted: true,
        path: 'POSSIBLY_LOADED_DUAL_BRANCH_PROTECTION',
      });
      expect(resumeAdmission({ pre, branchEvidence: 'NONE', freshReconstructionAdmission: noP2 })).toEqual({
        admitted: false,
        reason: 'FRESH_RECONSTRUCTION_ADMISSION_MISSING',
      });
    }
  });

  it('MISSING PROVENANCE: a possibly-loaded thread without a safe state -> FAIL CLOSED, never classified as cold', () => {
    for (const pre of [null, RECORDS['RETIRED']!]) {
      for (const freshReconstructionAdmission of [p2, noP2]) {
        expect(resumeAdmission({ pre, branchEvidence: 'NONE', freshReconstructionAdmission })).toEqual({
          admitted: false,
          reason: 'MISSING_SESSION_PROVENANCE',
        });
      }
    }
  });

  it('known cold (PRECONDITION_KNOWN_COLD): admitted without a safe state; a safe state contradicts the evidence', () => {
    for (const pre of [null, RECORDS['RETIRED']!]) {
      expect(resumeAdmission({ pre, branchEvidence: 'PRECONDITION_KNOWN_COLD', freshReconstructionAdmission: p2 })).toEqual({
        admitted: true,
        path: 'KNOWN_COLD',
      });
      expect(resumeAdmission({ pre, branchEvidence: 'PRECONDITION_KNOWN_COLD', freshReconstructionAdmission: noP2 })).toMatchObject({
        admitted: false,
      });
    }
    for (const pre of [RECORDS['KNOWN_SAFE_ACTIVE']!, RECORDS['SAFE_DISJUNCTION']!]) {
      expect(resumeAdmission({ pre, branchEvidence: 'PRECONDITION_KNOWN_COLD', freshReconstructionAdmission: p2 })).toEqual({
        admitted: false,
        reason: 'REGISTRY_CONTRADICTION',
      });
    }
  });
});

describe('the registry — runtime provenance lifecycle across ordinary activity', () => {
  it('start creates KNOWN_SAFE_ACTIVE with a KNOWN_ACTIVE runtime provenance', () => {
    const r = registry();
    const { safety, createdProvenance } = r.recordAdmittedStart(REF, admission(1));
    expect(safety).toMatchObject({ state: 'KNOWN_SAFE_ACTIVE', runtime_provenance_id: createdProvenance!.RUNTIME_PROVENANCE_ID });
    expect(createdProvenance).toMatchObject({ status: 'KNOWN_ACTIVE', originating_operation: 'thread/start', originating_operation_admission_id: 'operation-admission:g1:1' });
    expect(r.assertExactActiveIncarnation(REF)).toEqual({
      RUNTIME_PROVENANCE_ID: createdProvenance!.RUNTIME_PROVENANCE_ID,
      HARNESS_RUNTIME_INCARNATION_ID: createdProvenance!.HARNESS_RUNTIME_INCARNATION_ID,
    });
    expect(refusal(() => r.recordAdmittedStart(REF, admission(2)))).toBe('TRANSITION_NOT_IN_SECTION_5_4');
    expect(refusal(() => r.recordAdmittedStart({ ...REF, logical_thread_id: 'thr_2' }, { ...admission(3), status: 'ISSUED' as never }))).toBe(
      'ADMISSION_NOT_CONSUMED',
    );
  });

  it('does NOT retire on a normal turn, thread/read, an unrelated RPC, token timeout / consumption / invalidation, or the admitted 0 -> 1', () => {
    const r = registry();
    r.recordAdmittedStart(REF, admission(1));
    const before = JSON.stringify([r.current(REF), r.provenance.recordsOfThread('thr_1')]);
    for (const event of NOT_SESSION_PROVENANCE_RETIREMENT_EVENTS) expect(r.acknowledgeNonRetirementEvent(event)).toBe('NOT_A_RETIREMENT_EVENT');
    expect(JSON.stringify([r.current(REF), r.provenance.recordsOfThread('thr_1')])).toBe(before);
    expect(NOT_SESSION_PROVENANCE_RETIREMENT_EVENTS).toEqual([
      'OPERATION_TOKEN_CONSUMED',
      'OPERATION_TOKEN_EXPIRED',
      'OPERATION_TOKEN_INVALIDATED',
      'UNRELATED_READ_RPC',
      'COMPLETED_NORMAL_TURN',
      'ORDINARY_SAFE_ACTIVITY',
      'OTHER_OPERATION_TOKEN_ISSUED_OR_CONSUMED',
      'ADMITTED_FIXTURE_CONFIG_STATE_0_TO_1',
      'MAX_ADMISSION_INTERVAL_ELAPSED',
    ]);
  });

  it('retires on process restart, binary switch, thread delete, known unload and known cold replacement', () => {
    for (const event of ['PROCESS_EXIT_OR_RESTART', 'BINARY_SWITCH', 'KNOWN_THREAD_DELETION', 'KNOWN_UNLOAD_OR_DESTRUCTION', 'KNOWN_COLD_REPLACEMENT'] as const) {
      const r = registry();
      r.recordAdmittedStart(REF, admission(1));
      expect(r.retireThread(REF, event)).toMatchObject({ state: 'RETIRED', retirement_event: event });
      expect(r.provenance.recordsOfThread('thr_1').map((x) => [x.status, x.retirement_event])).toEqual([['RETIRED', event]]);
      expect(refusal(() => r.retireThread(REF, event))).toBe('TRANSITION_NOT_IN_SECTION_5_4');
      expect(refusal(() => r.assertExactActiveIncarnation(REF))).toBe('NO_ACTIVE_SAFE_STATE');
    }
  });

  it('keeps the Domain S retirement list separate from, and disjoint with, the Domain O token invalidators', () => {
    expect(SESSION_PROVENANCE_RETIREMENT_EVENTS).toEqual([
      'PROCESS_EXIT_OR_RESTART',
      'BINARY_SWITCH',
      'KNOWN_THREAD_DELETION',
      'KNOWN_UNLOAD_OR_DESTRUCTION',
      'KNOWN_COLD_REPLACEMENT',
      'KNOWN_ACTIVE_RUNTIME_REPLACEMENT',
      'LOSS_OF_PROVENANCE_IDENTITY',
      'ADMITTED_OPERATION_REPLACES_FEATURE_BEARING_STATE',
    ]);
    expect(SESSION_PROVENANCE_RETIREMENT_EVENTS as readonly string[]).not.toBe(OPERATION_TOKEN_INVALIDATORS as readonly string[]);
    for (const e of SESSION_PROVENANCE_RETIREMENT_EVENTS) expect(OPERATION_TOKEN_INVALIDATORS as readonly string[]).not.toContain(e);
    for (const e of NOT_SESSION_PROVENANCE_RETIREMENT_EVENTS) expect(SESSION_PROVENANCE_RETIREMENT_EVENTS as readonly string[]).not.toContain(e);
  });
});

describe('NO CLAIM under SAFE_DISJUNCTION', () => {
  it('an assertion that needs the exact active incarnation fails closed; SAFE_DISJUNCTION names no provenance or incarnation', () => {
    const r = registry();
    r.recordAdmittedStart(REF, admission(1));
    const decision = {
      transition: 'SAFE_DISJUNCTION' as const,
      event: { kind: 'POSSIBLY_LOADED_RESUME_BRANCH_UNKNOWN' as const, reconstructionAdmissionRef: 'operation-admission:g1:2' },
      safetyLineageRefs: [],
    };
    const applied = r.applyResumeDecision(REF, admission(2), decision)!;
    expect(applied.safety.state).toBe('SAFE_DISJUNCTION');
    expect(Object.keys(applied.safety)).not.toContain('runtime_provenance_id');
    expect(JSON.stringify(applied.safety)).not.toContain('harness-runtime-incarnation');
    expect(refusal(() => r.assertExactActiveIncarnation(REF))).toBe('EXACT_INCARNATION_UNKNOWN_SAFE_DISJUNCTION');
    expect(r.provenance.recordsOfThread('thr_1').map((x) => x.status)).toEqual(['HISTORICAL']);
    // A KNOWN_ACTIVE claim for T is refused while it is SAFE_DISJUNCTION.
    expect(() =>
      r.provenance.createKnownActive(
        {
          logical_thread_id: 'thr_1',
          process_generation: 1,
          binary_identity: 'bin',
          effective_bits: { shell_snapshot: false, shell_snapshot_v2: false },
          originating_operation: 'thread/resume(known reconstruction)',
          originating_operation_admission_id: 'operation-admission:g1:3',
          admitted_feature_context: 'feature-context:g1:3',
        },
        r.current(REF)!.state,
      ),
    ).toThrow('KNOWN_ACTIVE_REFUSED_UNDER_SAFE_DISJUNCTION');
  });

  it('refuses a classifier decision that does not re-validate against the table', () => {
    const r = registry();
    expect(
      refusal(() =>
        r.applyResumeDecision(REF, admission(2), {
          transition: 'SAFE_DISJUNCTION',
          event: { kind: 'POSSIBLY_LOADED_RESUME_BRANCH_UNKNOWN', reconstructionAdmissionRef: 'adm' },
          safetyLineageRefs: [],
        }),
      ),
    ).toBe('TRANSITION_NOT_IN_SECTION_5_4');
    expect(r.applyResumeDecision(REF, admission(2), { transition: 'NONE_NO_SEND_ROW', unchanged: 'ABSENT' })).toBeNull();
    expect(r.current(REF)).toBeNull();
  });
});

describe('POSITIVE COLD, FORK and SUCCESSOR', () => {
  it('POSITIVE COLD (a): T from an earlier generation -> PRECONDITION_KNOWN_COLD admitted; new provenance linked to the earlier state', () => {
    const r = registry();
    r.recordAdmittedStart(REF, admission(1));
    r.retireGeneration(1, 'bin', 'PROCESS_EXIT_OR_RESTART');
    const next: ThreadRef = { ...REF, process_generation: 2 };
    expect(r.current(next)).toBeNull();
    expect(resumeAdmission({ pre: r.current(next), branchEvidence: 'PRECONDITION_KNOWN_COLD', freshReconstructionAdmission: { valid: true } })).toMatchObject({
      admitted: true,
      path: 'KNOWN_COLD',
    });
    const applied = r.applyResumeDecision(next, admission(1, 2), {
      transition: 'KNOWN_SAFE_ACTIVE',
      event: { kind: 'ADMITTED_KNOWN_COLD_RESUME_SUCCESS', reconstructionAdmissionRef: 'operation-admission:g2:1' },
    })!;
    expect(applied.safety).toMatchObject({ state: 'KNOWN_SAFE_ACTIVE', PROCESS_GENERATION: 2, latest_reconstruction_admission_ref: 'operation-admission:g2:1' });
    const earlier = r.historyOf('thr_1').filter((x) => x.PROCESS_GENERATION === 1).at(-1)!;
    expect(applied.createdProvenance).toMatchObject({
      originating_operation: 'thread/resume(cold, KNOWN_COLD)',
      predecessor_lineage_ref: earlier.THREAD_SAFETY_STATE_ID,
      PROCESS_GENERATION: 2,
      status: 'KNOWN_ACTIVE',
    });
  });

  it('POSITIVE COLD (b): T known deleted in this generation -> known reconstruction with its predecessor recorded', () => {
    const r = registry();
    const { createdProvenance: first } = r.recordAdmittedStart(REF, admission(1));
    const retired = r.retireThread(REF, 'KNOWN_THREAD_DELETION');
    const applied = r.applyResumeDecision(REF, admission(2), {
      transition: 'KNOWN_SAFE_ACTIVE',
      event: { kind: 'ADMITTED_KNOWN_COLD_RESUME_SUCCESS', reconstructionAdmissionRef: 'operation-admission:g1:2' },
    })!;
    expect(applied.createdProvenance).toMatchObject({
      originating_operation: 'thread/resume(known reconstruction)',
      predecessor_lineage_ref: retired.THREAD_SAFETY_STATE_ID,
    });
    expect(applied.createdProvenance!.HARNESS_RUNTIME_INCARNATION_ID).not.toBe(first!.HARNESS_RUNTIME_INCARNATION_ID);
    expect(r.provenance.lookup(first!.RUNTIME_PROVENANCE_ID)!.status).toBe('RETIRED');
  });

  it('FORK: the child gets its own provenance; the source thread is untouched and never reused', () => {
    const r = registry();
    const parent = r.recordAdmittedStart(REF, admission(1));
    const child: ThreadRef = { ...REF, logical_thread_id: 'thr_child' };
    const forked = r.recordAdmittedForkChild(child, admission(2));
    expect(forked.createdProvenance).toMatchObject({ logical_thread_id: 'thr_child', originating_operation: 'thread/fork', originating_operation_admission_id: 'operation-admission:g1:2' });
    expect(forked.createdProvenance!.RUNTIME_PROVENANCE_ID).not.toBe(parent.createdProvenance!.RUNTIME_PROVENANCE_ID);
    expect(r.current(REF)).toBe(parent.safety);
    expect(r.provenance.lookup(parent.createdProvenance!.RUNTIME_PROVENANCE_ID)!.status).toBe('KNOWN_ACTIVE');
  });

  it('SUCCESSOR / RETURN-TO-PIN: every safe state and runtime provenance of the old generation is RETIRED', () => {
    const r = registry();
    r.recordAdmittedStart(REF, admission(1));
    r.recordAdmittedStart({ ...REF, logical_thread_id: 'thr_2' }, admission(2));
    const retired = r.retireGeneration(1, 'bin', 'BINARY_SWITCH');
    expect(retired.map((x) => [x.logical_thread_id, x.state, x.state === 'RETIRED' ? x.retirement_event : ''])).toEqual([
      ['thr_1', 'RETIRED', 'BINARY_SWITCH'],
      ['thr_2', 'RETIRED', 'BINARY_SWITCH'],
    ]);
    expect(r.provenance.recordsOfGeneration(1, 'bin').every((x) => x.status === 'RETIRED')).toBe(true);
    // The successor generation admits afresh; nothing carries over.
    const successor: ThreadRef = { logical_thread_id: 'thr_3', process_generation: 2, binary_identity: 'successor-bin' };
    expect(r.recordAdmittedStart(successor, admission(1, 2)).safety.state).toBe('KNOWN_SAFE_ACTIVE');
  });
});
