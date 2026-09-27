// CONT-P5-E1 — THREAD_SAFETY_STATE of a logical thread (Dispatch v8 M7b = v3 M7b; Correction 10 sections 5, 6.6, 7).
//
// ★ SAFETY IS NOT STATE IDENTITY. THREAD_SAFETY_STATE answers ONE question: is every runtime that could possibly be
//   the active runtime of logical thread T proven to have been admitted with ShellSnapshot V1 = false and V2 = false?
//     KNOWN_SAFE_ACTIVE { runtime_provenance_id }  the exact active runtime is positively known and was admitted false/false
//     SAFE_DISJUNCTION  { safety_lineage_refs[] }  which runtime is active is unknown, but EVERY possible one was admitted
//                                                 false/false; it carries NO runtime provenance id and NO incarnation id
//     RETIRED                                      no runtime of T can be authoritative in this generation (terminal)
//   There is no fourth value: an unsafe possibility is a send that was never admitted.
// ★ THE ONLY ADMISSION PREDICATE for a possibly-loaded resume is the safe-disjunction induction P1 AND P2
//   (Correction 10 section 5.3): P1 = THREAD_SAFETY_STATE(T) in {KNOWN_SAFE_ACTIVE, SAFE_DISJUNCTION} protects a
//   surviving loaded runtime; P2 = a fresh reconstruction admission for the exact request protects a reconstruction.
//   Both are established BEFORE the send and neither predicts which branch upstream takes. A missing or
//   older-generation safe state is NEVER classified as cold: it fails closed (MISSING_SESSION_PROVENANCE).
// ★ LINEAGE REFERENCES ARE PROOF REFERENCES. `safety_lineage_refs` is the prior known state's record id followed by every
//   reconstruction admission id appended since; each proves only that a reconstruction admitted under it would have
//   been feature-safe. They are never enumerated as possible runtimes and never compared with response values.
// ★ TWO HOOK SETS, NEVER MERGED. SESSION_PROVENANCE_RETIREMENT_EVENTS below is the Domain S list; the Domain O list is
//   OPERATION_TOKEN_INVALIDATORS in operation-admission-token.ts. No token event retires anything here.

import type { OperationAdmissionTokenRecord } from './operation-admission-token.js';
import type { BranchEvidence } from './resume-observation-classifier.js';
import { RuntimeProvenanceRegistry, type RuntimeProvenanceRecord } from './runtime-provenance-registry.js';

export const THREAD_SAFETY_STATES = ['KNOWN_SAFE_ACTIVE', 'SAFE_DISJUNCTION', 'RETIRED'] as const;
export type ThreadSafetyStateName = (typeof THREAD_SAFETY_STATES)[number];

/** Correction 10 section 6.6: the Domain S retirement events (retire every safe state and provenance of the thread). */
export const SESSION_PROVENANCE_RETIREMENT_EVENTS = [
  'PROCESS_EXIT_OR_RESTART',
  'BINARY_SWITCH',
  'KNOWN_THREAD_DELETION',
  'KNOWN_UNLOAD_OR_DESTRUCTION',
  'KNOWN_COLD_REPLACEMENT',
  'KNOWN_ACTIVE_RUNTIME_REPLACEMENT',
  'LOSS_OF_PROVENANCE_IDENTITY',
  'ADMITTED_OPERATION_REPLACES_FEATURE_BEARING_STATE',
] as const;
export type SessionProvenanceRetirementEvent = (typeof SESSION_PROVENANCE_RETIREMENT_EVENTS)[number];

/** Correction 09 section 7.4, carried by Correction 10 section 6.6: these MUST NOT retire anything. */
export const NOT_SESSION_PROVENANCE_RETIREMENT_EVENTS = [
  'OPERATION_TOKEN_CONSUMED',
  'OPERATION_TOKEN_EXPIRED',
  'OPERATION_TOKEN_INVALIDATED',
  'UNRELATED_READ_RPC',
  'COMPLETED_NORMAL_TURN',
  'ORDINARY_SAFE_ACTIVITY',
  'OTHER_OPERATION_TOKEN_ISSUED_OR_CONSUMED',
  'ADMITTED_FIXTURE_CONFIG_STATE_0_TO_1',
  'MAX_ADMISSION_INTERVAL_ELAPSED',
] as const;
export type NotSessionProvenanceRetirementEvent = (typeof NOT_SESSION_PROVENANCE_RETIREMENT_EVENTS)[number];

type ThreadSafetyStateBase = Readonly<{
  THREAD_SAFETY_STATE_ID: string;
  logical_thread_id: string;
  PROCESS_GENERATION: number;
  BINARY_IDENTITY: string;
  latest_reconstruction_admission_ref?: string;
  creation_monotonic: number;
}>;

/** Correction 10 section 7.1 (verbatim field names). One immutable record per state; history is append-only. */
export type ThreadSafetyStateRecord =
  | (ThreadSafetyStateBase & Readonly<{ state: 'KNOWN_SAFE_ACTIVE'; runtime_provenance_id: string }>)
  | (ThreadSafetyStateBase & Readonly<{ state: 'SAFE_DISJUNCTION'; safety_lineage_refs: readonly string[] }>)
  | (ThreadSafetyStateBase &
      Readonly<{ state: 'RETIRED'; retirement_event: SessionProvenanceRetirementEvent; retirement_monotonic: number }>);

// ---------------------------------------------------------------------------------------------------------
// Pure transition function — Correction 10 section 5.4 (exhaustive) plus the section 13 validity = FAIL row
// ---------------------------------------------------------------------------------------------------------

export type ThreadSafetyEvent =
  | Readonly<{ kind: 'ADMITTED_START_SUCCESS' }>
  | Readonly<{ kind: 'ADMITTED_FORK_CHILD_SUCCESS' }>
  | Readonly<{ kind: 'ADMITTED_KNOWN_COLD_RESUME_SUCCESS'; reconstructionAdmissionRef: string }>
  | Readonly<{ kind: 'ADMITTED_KNOWN_COLD_RESUME_ATTEMPT_FAILED'; reconstructionAdmissionRef: string }>
  | Readonly<{ kind: 'POSSIBLY_LOADED_RESUME_BRANCH_UNKNOWN'; reconstructionAdmissionRef: string }>
  | Readonly<{ kind: 'RETIREMENT'; event: SessionProvenanceRetirementEvent }>;

export type ThreadSafetyTransition =
  | Readonly<{ allowed: true; to: 'KNOWN_SAFE_ACTIVE'; predecessorLineageRef: string | null; latestReconstructionAdmissionRef: string | null }>
  | Readonly<{ allowed: true; to: 'SAFE_DISJUNCTION'; safetyLineageRefs: readonly string[]; latestReconstructionAdmissionRef: string }>
  | Readonly<{ allowed: true; to: 'RETIRED'; event: SessionProvenanceRetirementEvent }>
  | Readonly<{ allowed: false; reason: 'TRANSITION_NOT_IN_SECTION_5_4' }>;

const REFUSED: ThreadSafetyTransition = Object.freeze({ allowed: false, reason: 'TRANSITION_NOT_IN_SECTION_5_4' });

/**
 * THE transition table. `pre` is the thread's record in the CURRENT generation (`null` = none; a record of an earlier
 * generation is not a current state). It consults admissions and retirement events only — never a response value.
 */
export function nextThreadSafetyState(pre: ThreadSafetyStateRecord | null, event: ThreadSafetyEvent): ThreadSafetyTransition {
  const state = pre === null ? 'NONE' : pre.state;
  switch (event.kind) {
    case 'ADMITTED_START_SUCCESS':
    case 'ADMITTED_FORK_CHILD_SUCCESS':
      return state === 'NONE'
        ? Object.freeze({ allowed: true, to: 'KNOWN_SAFE_ACTIVE', predecessorLineageRef: null, latestReconstructionAdmissionRef: null })
        : REFUSED;
    case 'ADMITTED_KNOWN_COLD_RESUME_SUCCESS':
      return state === 'NONE' || state === 'RETIRED'
        ? Object.freeze({
            allowed: true,
            to: 'KNOWN_SAFE_ACTIVE',
            predecessorLineageRef: pre === null ? null : pre.THREAD_SAFETY_STATE_ID,
            latestReconstructionAdmissionRef: event.reconstructionAdmissionRef,
          })
        : REFUSED;
    case 'ADMITTED_KNOWN_COLD_RESUME_ATTEMPT_FAILED':
      // Section 13 validity = FAIL row on a known-cold resume: no prior survivor exists; the only runtime that may
      // exist is the admitted reconstruction, if it was created.
      return state === 'NONE' || state === 'RETIRED'
        ? Object.freeze({
            allowed: true,
            to: 'SAFE_DISJUNCTION',
            safetyLineageRefs: Object.freeze(pre === null ? [event.reconstructionAdmissionRef] : [pre.THREAD_SAFETY_STATE_ID, event.reconstructionAdmissionRef]),
            latestReconstructionAdmissionRef: event.reconstructionAdmissionRef,
          })
        : REFUSED;
    case 'POSSIBLY_LOADED_RESUME_BRANCH_UNKNOWN':
      if (pre?.state === 'KNOWN_SAFE_ACTIVE') {
        return Object.freeze({
          allowed: true,
          to: 'SAFE_DISJUNCTION',
          safetyLineageRefs: Object.freeze([pre.THREAD_SAFETY_STATE_ID, event.reconstructionAdmissionRef]),
          latestReconstructionAdmissionRef: event.reconstructionAdmissionRef,
        });
      }
      if (pre?.state === 'SAFE_DISJUNCTION') {
        return Object.freeze({
          allowed: true,
          to: 'SAFE_DISJUNCTION',
          safetyLineageRefs: Object.freeze([...pre.safety_lineage_refs, event.reconstructionAdmissionRef]),
          latestReconstructionAdmissionRef: event.reconstructionAdmissionRef,
        });
      }
      return REFUSED;
    case 'RETIREMENT':
      return state === 'KNOWN_SAFE_ACTIVE' || state === 'SAFE_DISJUNCTION'
        ? Object.freeze({ allowed: true, to: 'RETIRED', event: event.event })
        : REFUSED;
    default:
      return REFUSED;
  }
}

// ---------------------------------------------------------------------------------------------------------
// The admission predicate for a resume (Correction 10 sections 5.3, 9, 13, 14; Correction 09 section 11)
// ---------------------------------------------------------------------------------------------------------

/** P2 as reported by the Domain O service for the exact bound thread/resume request (a VALID_TOKEN before the send). */
export type FreshReconstructionAdmission = Readonly<{ valid: boolean }>;

export type ResumeAdmissionRefusal = 'MISSING_SESSION_PROVENANCE' | 'REGISTRY_CONTRADICTION' | 'FRESH_RECONSTRUCTION_ADMISSION_MISSING';

export type ResumeAdmissionDecision =
  | Readonly<{ admitted: true; path: 'POSSIBLY_LOADED_DUAL_BRANCH_PROTECTION' | 'KNOWN_COLD' }>
  | Readonly<{ admitted: false; reason: ResumeAdmissionRefusal }>;

/**
 * Decide, BEFORE the send, whether a thread/resume may be sent. With BRANCH_EVIDENCE = NONE the resume is
 * possibly-loaded and the ONLY predicate is P1 AND P2; different allowed overrides are never refused. With
 * PRECONDITION_KNOWN_COLD it is a known-cold resume: a safe state of T in this generation contradicts that evidence.
 * There is no path from "no safe state" to "cold".
 */
export function resumeAdmission(input: Readonly<{
  pre: ThreadSafetyStateRecord | null;
  branchEvidence: BranchEvidence;
  freshReconstructionAdmission: FreshReconstructionAdmission;
}>): ResumeAdmissionDecision {
  const safe = input.pre?.state === 'KNOWN_SAFE_ACTIVE' || input.pre?.state === 'SAFE_DISJUNCTION';
  const refuse = (reason: ResumeAdmissionRefusal): ResumeAdmissionDecision => Object.freeze({ admitted: false, reason });
  if (input.branchEvidence === 'PRECONDITION_KNOWN_COLD') {
    if (safe) return refuse('REGISTRY_CONTRADICTION');
    if (!input.freshReconstructionAdmission.valid) return refuse('FRESH_RECONSTRUCTION_ADMISSION_MISSING');
    return Object.freeze({ admitted: true, path: 'KNOWN_COLD' });
  }
  if (!safe) return refuse('MISSING_SESSION_PROVENANCE');
  if (!input.freshReconstructionAdmission.valid) return refuse('FRESH_RECONSTRUCTION_ADMISSION_MISSING');
  return Object.freeze({ admitted: true, path: 'POSSIBLY_LOADED_DUAL_BRANCH_PROTECTION' });
}

// ---------------------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------------------

export type ThreadSafetyRegistryRefusalReason =
  | 'TRANSITION_NOT_IN_SECTION_5_4'
  | 'ADMISSION_NOT_CONSUMED'
  | 'EXACT_INCARNATION_UNKNOWN_SAFE_DISJUNCTION'
  | 'NO_ACTIVE_SAFE_STATE';

export class ThreadSafetyStateRefused extends Error {
  readonly code = 'thread_safety_state_refused';
  constructor(readonly reason: ThreadSafetyRegistryRefusalReason) {
    super(`thread safety state refused: ${reason}`);
    this.name = 'ThreadSafetyStateRefused';
  }
}

/** The consumed Domain O admission a new runtime provenance is created from. */
export type ConsumedAdmission = Pick<OperationAdmissionTokenRecord, 'OPERATION_ADMISSION_ID' | 'v1' | 'v2' | 'FEATURE_CONTEXT_BINDING' | 'status'>;

export type ThreadRef = Readonly<{ logical_thread_id: string; process_generation: number; binary_identity: string }>;

export type ThreadSafetyApplication = Readonly<{
  safety: ThreadSafetyStateRecord;
  /** The runtime provenance created by this step, if any. */
  createdProvenance: RuntimeProvenanceRecord | null;
}>;

export class ThreadSafetyStateRegistry {
  private readonly historyRecords: ThreadSafetyStateRecord[] = [];
  private readonly currentRecords = new Map<string, ThreadSafetyStateRecord>();
  private nextRecord = 1;

  constructor(
    readonly provenance: RuntimeProvenanceRegistry,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** The thread's record in this generation/binary, or `null` (a record of another generation is not current). */
  current(ref: ThreadRef): ThreadSafetyStateRecord | null {
    return this.currentRecords.get(keyOf(ref)) ?? null;
  }

  /** Append-only history of one logical thread, every generation. */
  historyOf(logicalThreadId: string): readonly ThreadSafetyStateRecord[] {
    return this.historyRecords.filter((r) => r.logical_thread_id === logicalThreadId);
  }

  /** Admitted thread/start success: (none) -> KNOWN_SAFE_ACTIVE(new RUNTIME_PROVENANCE). */
  recordAdmittedStart(ref: ThreadRef, admission: ConsumedAdmission): ThreadSafetyApplication {
    return this.createKnownSafeActive(ref, admission, { kind: 'ADMITTED_START_SUCCESS' }, 'thread/start');
  }

  /** Admitted thread/fork child success: the CHILD gets its own provenance; the source thread is untouched. */
  recordAdmittedForkChild(childRef: ThreadRef, admission: ConsumedAdmission): ThreadSafetyApplication {
    return this.createKnownSafeActive(childRef, admission, { kind: 'ADMITTED_FORK_CHILD_SUCCESS' }, 'thread/fork');
  }

  /**
   * Apply the `new_safety_state` the observation classifier derived for a thread/resume (it re-validates the
   * transition against the table). A `NONE_NO_SEND_ROW` decision changes nothing.
   */
  applyResumeDecision(ref: ThreadRef, admission: ConsumedAdmission, decision: ResumeSafetyDecision): ThreadSafetyApplication | null {
    if (decision.transition === 'NONE_NO_SEND_ROW') return null;
    if (admission.status !== 'CONSUMED') throw new ThreadSafetyStateRefused('ADMISSION_NOT_CONSUMED');
    const pre = this.current(ref);
    const recomputed = nextThreadSafetyState(pre, decision.event);
    if (!recomputed.allowed || recomputed.to !== decision.transition) throw new ThreadSafetyStateRefused('TRANSITION_NOT_IN_SECTION_5_4');
    if (recomputed.to === 'KNOWN_SAFE_ACTIVE') {
      const earlier = pre === null ? this.latestEarlierRecord(ref) : null;
      const predecessor = recomputed.predecessorLineageRef ?? earlier?.THREAD_SAFETY_STATE_ID ?? null;
      const provenanceInput = {
        logical_thread_id: ref.logical_thread_id,
        process_generation: ref.process_generation,
        binary_identity: ref.binary_identity,
        effective_bits: { shell_snapshot: admission.v1, shell_snapshot_v2: admission.v2 },
        originating_operation: pre === null ? ('thread/resume(cold, KNOWN_COLD)' as const) : ('thread/resume(known reconstruction)' as const),
        originating_operation_admission_id: admission.OPERATION_ADMISSION_ID,
        admitted_feature_context: admission.FEATURE_CONTEXT_BINDING,
      };
      const created =
        predecessor === null
          ? this.provenance.createKnownActive(provenanceInput, pre === null ? 'ABSENT' : pre.state)
          : this.provenance.linkKnownReplacement({ ...provenanceInput, predecessor_lineage_ref: predecessor }, pre === null ? 'ABSENT' : pre.state);
      const safety = this.append(ref, {
        state: 'KNOWN_SAFE_ACTIVE',
        runtime_provenance_id: created.RUNTIME_PROVENANCE_ID,
        ...(recomputed.latestReconstructionAdmissionRef === null
          ? {}
          : { latest_reconstruction_admission_ref: recomputed.latestReconstructionAdmissionRef }),
      });
      return Object.freeze({ safety, createdProvenance: created });
    }
    if (recomputed.to === 'SAFE_DISJUNCTION') {
      // Exact identity becomes unknown: a KNOWN_ACTIVE record becomes historical evidence only (never re-promoted).
      for (const record of this.provenance.recordsOfThread(ref.logical_thread_id, ref.process_generation)) {
        if (record.status === 'KNOWN_ACTIVE') this.provenance.toHistorical(record.RUNTIME_PROVENANCE_ID);
      }
      const safety = this.append(ref, {
        state: 'SAFE_DISJUNCTION',
        safety_lineage_refs: recomputed.safetyLineageRefs,
        latest_reconstruction_admission_ref: recomputed.latestReconstructionAdmissionRef,
      });
      return Object.freeze({ safety, createdProvenance: null });
    }
    throw new ThreadSafetyStateRefused('TRANSITION_NOT_IN_SECTION_5_4');
  }

  /** A Domain S retirement event for one thread: its safe state and every runtime provenance of it become RETIRED. */
  retireThread(ref: ThreadRef, event: SessionProvenanceRetirementEvent): ThreadSafetyStateRecord {
    const transition = nextThreadSafetyState(this.current(ref), { kind: 'RETIREMENT', event });
    if (!transition.allowed || transition.to !== 'RETIRED') throw new ThreadSafetyStateRefused('TRANSITION_NOT_IN_SECTION_5_4');
    for (const record of this.provenance.recordsOfThread(ref.logical_thread_id, ref.process_generation)) {
      if (record.status !== 'RETIRED') this.provenance.retire(record.RUNTIME_PROVENANCE_ID, event);
    }
    return this.append(ref, { state: 'RETIRED', retirement_event: event, retirement_monotonic: this.now() });
  }

  /** Process exit/restart or binary switch: every safe state and runtime provenance of that generation is RETIRED. */
  retireGeneration(processGeneration: number, binaryIdentity: string, event: 'PROCESS_EXIT_OR_RESTART' | 'BINARY_SWITCH'): readonly ThreadSafetyStateRecord[] {
    const retired: ThreadSafetyStateRecord[] = [];
    for (const record of [...this.currentRecords.values()]) {
      if (record.PROCESS_GENERATION !== processGeneration || record.BINARY_IDENTITY !== binaryIdentity || record.state === 'RETIRED') continue;
      retired.push(this.retireThread({ logical_thread_id: record.logical_thread_id, process_generation: processGeneration, binary_identity: binaryIdentity }, event));
    }
    for (const record of this.provenance.recordsOfGeneration(processGeneration, binaryIdentity)) {
      if (record.status !== 'RETIRED') this.provenance.retire(record.RUNTIME_PROVENANCE_ID, event);
    }
    return Object.freeze(retired);
  }

  /** The do-not-retire list: acknowledged, and nothing changes (token lifetime != runtime lifetime). */
  acknowledgeNonRetirementEvent(_event: NotSessionProvenanceRetirementEvent): 'NOT_A_RETIREMENT_EVENT' {
    return 'NOT_A_RETIREMENT_EVENT';
  }

  /**
   * For an assertion that needs the EXACT active incarnation (Correction 09 section 9.1): answers only under
   * KNOWN_SAFE_ACTIVE and fails closed under SAFE_DISJUNCTION, RETIRED or no state.
   */
  assertExactActiveIncarnation(ref: ThreadRef): Pick<RuntimeProvenanceRecord, 'RUNTIME_PROVENANCE_ID' | 'HARNESS_RUNTIME_INCARNATION_ID'> {
    const record = this.current(ref);
    if (record?.state === 'SAFE_DISJUNCTION') throw new ThreadSafetyStateRefused('EXACT_INCARNATION_UNKNOWN_SAFE_DISJUNCTION');
    if (record?.state !== 'KNOWN_SAFE_ACTIVE') throw new ThreadSafetyStateRefused('NO_ACTIVE_SAFE_STATE');
    const provenance = this.provenance.lookup(record.runtime_provenance_id);
    if (provenance === undefined) throw new ThreadSafetyStateRefused('NO_ACTIVE_SAFE_STATE');
    return Object.freeze({
      RUNTIME_PROVENANCE_ID: provenance.RUNTIME_PROVENANCE_ID,
      HARNESS_RUNTIME_INCARNATION_ID: provenance.HARNESS_RUNTIME_INCARNATION_ID,
    });
  }

  private createKnownSafeActive(
    ref: ThreadRef,
    admission: ConsumedAdmission,
    event: ThreadSafetyEvent,
    origin: 'thread/start' | 'thread/fork',
  ): ThreadSafetyApplication {
    if (admission.status !== 'CONSUMED') throw new ThreadSafetyStateRefused('ADMISSION_NOT_CONSUMED');
    const pre = this.current(ref);
    const transition = nextThreadSafetyState(pre, event);
    if (!transition.allowed || transition.to !== 'KNOWN_SAFE_ACTIVE') throw new ThreadSafetyStateRefused('TRANSITION_NOT_IN_SECTION_5_4');
    const created = this.provenance.createKnownActive(
      {
        logical_thread_id: ref.logical_thread_id,
        process_generation: ref.process_generation,
        binary_identity: ref.binary_identity,
        effective_bits: { shell_snapshot: admission.v1, shell_snapshot_v2: admission.v2 },
        originating_operation: origin,
        originating_operation_admission_id: admission.OPERATION_ADMISSION_ID,
        admitted_feature_context: admission.FEATURE_CONTEXT_BINDING,
      },
      'ABSENT',
    );
    const safety = this.append(ref, { state: 'KNOWN_SAFE_ACTIVE', runtime_provenance_id: created.RUNTIME_PROVENANCE_ID });
    return Object.freeze({ safety, createdProvenance: created });
  }

  private latestEarlierRecord(ref: ThreadRef): ThreadSafetyStateRecord | null {
    const earlier = this.historyOf(ref.logical_thread_id).filter(
      (r) => r.PROCESS_GENERATION !== ref.process_generation || r.BINARY_IDENTITY !== ref.binary_identity,
    );
    return earlier.at(-1) ?? null;
  }

  private append(
    ref: ThreadRef,
    body:
      | Readonly<{ state: 'KNOWN_SAFE_ACTIVE'; runtime_provenance_id: string; latest_reconstruction_admission_ref?: string }>
      | Readonly<{ state: 'SAFE_DISJUNCTION'; safety_lineage_refs: readonly string[]; latest_reconstruction_admission_ref: string }>
      | Readonly<{ state: 'RETIRED'; retirement_event: SessionProvenanceRetirementEvent; retirement_monotonic: number }>,
  ): ThreadSafetyStateRecord {
    const record = Object.freeze({
      THREAD_SAFETY_STATE_ID: `thread-safety-state:${this.nextRecord++}`,
      logical_thread_id: ref.logical_thread_id,
      PROCESS_GENERATION: ref.process_generation,
      BINARY_IDENTITY: ref.binary_identity,
      creation_monotonic: this.now(),
      ...body,
    }) as ThreadSafetyStateRecord;
    this.historyRecords.push(record);
    this.currentRecords.set(keyOf(ref), record);
    return record;
  }
}

/**
 * The `new_safety_state` of a thread/resume observation, as derived by the classifier from
 * {pre_operation_safety_state, branch_evidence, operation kind, structural validity} only.
 */
export type ResumeSafetyDecision =
  | Readonly<{ transition: 'KNOWN_SAFE_ACTIVE'; event: Extract<ThreadSafetyEvent, { kind: 'ADMITTED_KNOWN_COLD_RESUME_SUCCESS' }> }>
  | Readonly<{
      transition: 'SAFE_DISJUNCTION';
      event: Extract<ThreadSafetyEvent, { kind: 'POSSIBLY_LOADED_RESUME_BRANCH_UNKNOWN' | 'ADMITTED_KNOWN_COLD_RESUME_ATTEMPT_FAILED' }>;
      safetyLineageRefs: readonly string[];
    }>
  | Readonly<{ transition: 'NONE_NO_SEND_ROW'; unchanged: ThreadSafetyStateName | 'ABSENT' }>;

function keyOf(ref: ThreadRef): string {
  return JSON.stringify([ref.process_generation, ref.binary_identity, ref.logical_thread_id]);
}
