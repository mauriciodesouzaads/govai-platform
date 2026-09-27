// CONT-P5-E1 — RUNTIME_PROVENANCE registry (Dispatch v8 M7a = v3 M7a; Correction 10 section 6).
//
// A RUNTIME_PROVENANCE record states that ONE positively known runtime incarnation of a logical thread was initialized
// under an attested effective feature state ShellSnapshot V1 = false, V2 = false, and names the admission that did it.
// It is NOT the safety state of the thread (thread-safety-state.ts) and NOT an operation token
// (operation-admission-token.ts): RUNTIME_PROVENANCE != THREAD_SAFETY_STATE != OPERATION_ADMISSION_TOKEN.
//
// ★ IDENTITIES. RUNTIME_PROVENANCE_ID and HARNESS_RUNTIME_INCARNATION_ID are GovAI PROOF IDENTITIES, allocated by this
//   harness at each event it knows to have created an active runtime (admitted start, admitted known-cold resume,
//   admitted fork child). The pinned upstream exposes no incarnation identifier and none is invented: neither id is,
//   names or stands for an identifier of the upstream server.
// ★ LOGICAL THREAD ID != RUNTIME INCARNATION. A cold reconstruction keeps the logical thread id and replaces the
//   runtime; records are keyed by RUNTIME_PROVENANCE_ID, never by thread id, and an old record is never mutated to
//   pretend it carried a new Config.
// ★ STATUSES. KNOWN_ACTIVE -> HISTORICAL (the thread entered SAFE_DISJUNCTION) ; KNOWN_ACTIVE -> RETIRED ;
//   HISTORICAL -> RETIRED. No HISTORICAL -> KNOWN_ACTIVE (no source-proven resolution exists); no exit from RETIRED.
//   A record is created KNOWN_ACTIVE only while the thread has no safe state or a RETIRED one in this generation:
//   creation is refused while the thread is SAFE_DISJUNCTION (a safe disjunction is never one exact runtime).

import type { SessionProvenanceRetirementEvent, ThreadSafetyStateName } from './thread-safety-state.js';

export const RUNTIME_PROVENANCE_STATUSES = ['KNOWN_ACTIVE', 'HISTORICAL', 'RETIRED'] as const;
export type RuntimeProvenanceStatus = (typeof RUNTIME_PROVENANCE_STATUSES)[number];

/** Correction 10 section 6.3, exhaustive. */
export const RUNTIME_PROVENANCE_TRANSITIONS: Readonly<Record<RuntimeProvenanceStatus, readonly RuntimeProvenanceStatus[]>> =
  Object.freeze({
    KNOWN_ACTIVE: Object.freeze(['HISTORICAL', 'RETIRED'] as const),
    HISTORICAL: Object.freeze(['RETIRED'] as const),
    RETIRED: Object.freeze([] as const),
  });

export const RUNTIME_PROVENANCE_ORIGINS = [
  'thread/start',
  'thread/resume(cold, KNOWN_COLD)',
  'thread/resume(known reconstruction)',
  'thread/fork',
] as const;
export type RuntimeProvenanceOrigin = (typeof RUNTIME_PROVENANCE_ORIGINS)[number];

/** The fields of Correction 10 section 6.2, verbatim names. */
export type RuntimeProvenanceRecord = Readonly<{
  /** GovAI proof identity of this record. */
  RUNTIME_PROVENANCE_ID: string;
  logical_thread_id: string;
  /** GovAI proof identity of the runtime incarnation (harness-local, monotonic). */
  HARNESS_RUNTIME_INCARNATION_ID: string;
  PROCESS_GENERATION: number;
  BINARY_IDENTITY: string;
  /** (false, false) for every record that exists: nothing else is ever admitted. */
  ORIGINAL_EFFECTIVE_BITS: Readonly<{ shell_snapshot: false; shell_snapshot_v2: false }>;
  originating_operation: RuntimeProvenanceOrigin;
  originating_operation_admission_id: string;
  /** Reference (FEATURE_CONTEXT_BINDING id) of the admitted feature context. */
  admitted_feature_context: string;
  creation_monotonic: number;
  status: RuntimeProvenanceStatus;
  predecessor_lineage_ref?: string;
  retirement_event?: SessionProvenanceRetirementEvent;
  retirement_monotonic?: number;
}>;

export type RuntimeProvenanceRefusalReason =
  | 'KNOWN_ACTIVE_REFUSED_UNDER_SAFE_DISJUNCTION'
  | 'KNOWN_ACTIVE_REFUSED_WHILE_THREAD_KNOWN_SAFE_ACTIVE'
  | 'ORIGINAL_EFFECTIVE_BITS_NOT_FALSE_FALSE'
  | 'ORIGIN_NOT_A_KNOWN_RUNTIME_CREATION'
  | 'UNKNOWN_RUNTIME_PROVENANCE'
  | 'TRANSITION_NOT_IN_SECTION_6_3';

export class RuntimeProvenanceRefused extends Error {
  readonly code = 'runtime_provenance_refused';
  constructor(readonly reason: RuntimeProvenanceRefusalReason) {
    super(`runtime provenance refused: ${reason}`);
    this.name = 'RuntimeProvenanceRefused';
  }
}

export type CreateKnownRuntimeProvenanceInput = Readonly<{
  logical_thread_id: string;
  process_generation: number;
  binary_identity: string;
  /** The attested bits of the consumed admission token. */
  effective_bits: Readonly<{ shell_snapshot: boolean; shell_snapshot_v2: boolean }>;
  originating_operation: RuntimeProvenanceOrigin;
  originating_operation_admission_id: string;
  admitted_feature_context: string;
  predecessor_lineage_ref?: string;
}>;

export class RuntimeProvenanceRegistry {
  private readonly records = new Map<string, RuntimeProvenanceRecord>();
  private nextProvenance = 1;
  private nextIncarnation = 1;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /**
   * Create a KNOWN_ACTIVE record for a positively known new runtime (Correction 10 section 6.4). `threadSafetyState` is
   * the current THREAD_SAFETY_STATE of the thread in this generation ('ABSENT' when there is none): creation is refused
   * while it is SAFE_DISJUNCTION or KNOWN_SAFE_ACTIVE.
   */
  createKnownActive(input: CreateKnownRuntimeProvenanceInput, threadSafetyState: ThreadSafetyStateName | 'ABSENT'): RuntimeProvenanceRecord {
    if (threadSafetyState === 'SAFE_DISJUNCTION') throw new RuntimeProvenanceRefused('KNOWN_ACTIVE_REFUSED_UNDER_SAFE_DISJUNCTION');
    if (threadSafetyState === 'KNOWN_SAFE_ACTIVE') throw new RuntimeProvenanceRefused('KNOWN_ACTIVE_REFUSED_WHILE_THREAD_KNOWN_SAFE_ACTIVE');
    if (input.effective_bits.shell_snapshot !== false || input.effective_bits.shell_snapshot_v2 !== false) {
      throw new RuntimeProvenanceRefused('ORIGINAL_EFFECTIVE_BITS_NOT_FALSE_FALSE');
    }
    if (!(RUNTIME_PROVENANCE_ORIGINS as readonly string[]).includes(input.originating_operation)) {
      throw new RuntimeProvenanceRefused('ORIGIN_NOT_A_KNOWN_RUNTIME_CREATION');
    }
    const record: RuntimeProvenanceRecord = Object.freeze({
      RUNTIME_PROVENANCE_ID: `runtime-provenance:${this.nextProvenance++}`,
      logical_thread_id: input.logical_thread_id,
      HARNESS_RUNTIME_INCARNATION_ID: `harness-runtime-incarnation:${this.nextIncarnation++}`,
      PROCESS_GENERATION: input.process_generation,
      BINARY_IDENTITY: input.binary_identity,
      ORIGINAL_EFFECTIVE_BITS: Object.freeze({ shell_snapshot: false, shell_snapshot_v2: false }),
      originating_operation: input.originating_operation,
      originating_operation_admission_id: input.originating_operation_admission_id,
      admitted_feature_context: input.admitted_feature_context,
      creation_monotonic: this.now(),
      status: 'KNOWN_ACTIVE',
      ...(input.predecessor_lineage_ref === undefined ? {} : { predecessor_lineage_ref: input.predecessor_lineage_ref }),
    });
    this.records.set(record.RUNTIME_PROVENANCE_ID, record);
    return record;
  }

  /** KNOWN_ACTIVE -> HISTORICAL: the thread entered SAFE_DISJUNCTION; the record stays as historical evidence only. */
  toHistorical(runtimeProvenanceId: string): RuntimeProvenanceRecord {
    return this.transition(runtimeProvenanceId, 'HISTORICAL');
  }

  /** KNOWN_ACTIVE | HISTORICAL -> RETIRED with a Domain S retirement event. Only status + retirement fields change. */
  retire(runtimeProvenanceId: string, event: SessionProvenanceRetirementEvent): RuntimeProvenanceRecord {
    return this.transition(runtimeProvenanceId, 'RETIRED', event);
  }

  /**
   * Link a KNOWN replacement (Correction 10 section 6.5): every not-yet-retired record of the thread in the given
   * generation is retired with KNOWN_COLD_REPLACEMENT, then the replacement is created with its predecessor lineage.
   */
  linkKnownReplacement(
    input: CreateKnownRuntimeProvenanceInput & { readonly predecessor_lineage_ref: string },
    threadSafetyState: ThreadSafetyStateName | 'ABSENT',
  ): RuntimeProvenanceRecord {
    for (const record of this.recordsOfThread(input.logical_thread_id, input.process_generation)) {
      if (record.status !== 'RETIRED') this.retire(record.RUNTIME_PROVENANCE_ID, 'KNOWN_COLD_REPLACEMENT');
    }
    return this.createKnownActive(input, threadSafetyState);
  }

  /** Historical lookup by GovAI proof identity. */
  lookup(runtimeProvenanceId: string): RuntimeProvenanceRecord | undefined {
    return this.records.get(runtimeProvenanceId);
  }

  recordsOfThread(logicalThreadId: string, processGeneration?: number): readonly RuntimeProvenanceRecord[] {
    return [...this.records.values()].filter(
      (r) => r.logical_thread_id === logicalThreadId && (processGeneration === undefined || r.PROCESS_GENERATION === processGeneration),
    );
  }

  recordsOfGeneration(processGeneration: number, binaryIdentity: string): readonly RuntimeProvenanceRecord[] {
    return [...this.records.values()].filter((r) => r.PROCESS_GENERATION === processGeneration && r.BINARY_IDENTITY === binaryIdentity);
  }

  /** The only mutation path: validated against RUNTIME_PROVENANCE_TRANSITIONS; the old record object is never mutated. */
  private transition(
    runtimeProvenanceId: string,
    to: RuntimeProvenanceStatus,
    event?: SessionProvenanceRetirementEvent,
  ): RuntimeProvenanceRecord {
    const record = this.records.get(runtimeProvenanceId);
    if (record === undefined) throw new RuntimeProvenanceRefused('UNKNOWN_RUNTIME_PROVENANCE');
    if (!RUNTIME_PROVENANCE_TRANSITIONS[record.status].includes(to)) throw new RuntimeProvenanceRefused('TRANSITION_NOT_IN_SECTION_6_3');
    const next: RuntimeProvenanceRecord = Object.freeze({
      ...record,
      status: to,
      ...(to === 'RETIRED' ? { retirement_event: event, retirement_monotonic: this.now() } : {}),
    });
    this.records.set(runtimeProvenanceId, next);
    return next;
  }
}
