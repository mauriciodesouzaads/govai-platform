// CONT-P5-E1 — RUNTIME_PROVENANCE (Dispatch v8 M7a; Correction 10 section 6; section 18 rows RUNTIME PROVENANCE, SAME
// THREAD / NEW INCARNATION, NO CLAIM).

import { describe, expect, it } from 'vitest';

import {
  RUNTIME_PROVENANCE_ORIGINS,
  RUNTIME_PROVENANCE_STATUSES,
  RUNTIME_PROVENANCE_TRANSITIONS,
  RuntimeProvenanceRefused,
  RuntimeProvenanceRegistry,
  type CreateKnownRuntimeProvenanceInput,
} from './runtime-provenance-registry.js';

const INPUT: CreateKnownRuntimeProvenanceInput = {
  logical_thread_id: 'thr_1',
  process_generation: 1,
  binary_identity: 'bin',
  effective_bits: { shell_snapshot: false, shell_snapshot_v2: false },
  originating_operation: 'thread/start',
  originating_operation_admission_id: 'operation-admission:g1:1',
  admitted_feature_context: 'feature-context:g1:1',
};

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof RuntimeProvenanceRefused) return error.reason;
    throw error;
  }
  throw new Error('expected a RuntimeProvenanceRefused');
}

describe('RUNTIME_PROVENANCE — statuses and the exhaustive section 6.3 transitions', () => {
  it('has exactly KNOWN_ACTIVE / HISTORICAL / RETIRED with no re-promotion and no exit from RETIRED', () => {
    expect(RUNTIME_PROVENANCE_STATUSES).toEqual(['KNOWN_ACTIVE', 'HISTORICAL', 'RETIRED']);
    expect(RUNTIME_PROVENANCE_TRANSITIONS).toEqual({ KNOWN_ACTIVE: ['HISTORICAL', 'RETIRED'], HISTORICAL: ['RETIRED'], RETIRED: [] });
    expect(RUNTIME_PROVENANCE_TRANSITIONS.HISTORICAL).not.toContain('KNOWN_ACTIVE');
    expect(RUNTIME_PROVENANCE_ORIGINS).toEqual([
      'thread/start',
      'thread/resume(cold, KNOWN_COLD)',
      'thread/resume(known reconstruction)',
      'thread/fork',
    ]);
  });

  it('creates KNOWN_ACTIVE records with the section 6.2 fields and GovAI proof identities', () => {
    const registry = new RuntimeProvenanceRegistry(() => 42);
    const record = registry.createKnownActive(INPUT, 'ABSENT');
    expect(record).toEqual({
      RUNTIME_PROVENANCE_ID: 'runtime-provenance:1',
      logical_thread_id: 'thr_1',
      HARNESS_RUNTIME_INCARNATION_ID: 'harness-runtime-incarnation:1',
      PROCESS_GENERATION: 1,
      BINARY_IDENTITY: 'bin',
      ORIGINAL_EFFECTIVE_BITS: { shell_snapshot: false, shell_snapshot_v2: false },
      originating_operation: 'thread/start',
      originating_operation_admission_id: 'operation-admission:g1:1',
      admitted_feature_context: 'feature-context:g1:1',
      creation_monotonic: 42,
      status: 'KNOWN_ACTIVE',
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(registry.lookup(record.RUNTIME_PROVENANCE_ID)).toBe(record);
  });

  it('moves KNOWN_ACTIVE -> HISTORICAL -> RETIRED and refuses every other move', () => {
    const registry = new RuntimeProvenanceRegistry(() => 1);
    const id = registry.createKnownActive(INPUT, 'ABSENT').RUNTIME_PROVENANCE_ID;
    expect(registry.toHistorical(id).status).toBe('HISTORICAL');
    expect(refusal(() => registry.toHistorical(id))).toBe('TRANSITION_NOT_IN_SECTION_6_3');
    expect(registry.retire(id, 'KNOWN_THREAD_DELETION')).toMatchObject({ status: 'RETIRED', retirement_event: 'KNOWN_THREAD_DELETION' });
    expect(refusal(() => registry.retire(id, 'PROCESS_EXIT_OR_RESTART'))).toBe('TRANSITION_NOT_IN_SECTION_6_3');
    expect(refusal(() => registry.toHistorical(id))).toBe('TRANSITION_NOT_IN_SECTION_6_3');
    expect(refusal(() => registry.retire('runtime-provenance:999', 'BINARY_SWITCH'))).toBe('UNKNOWN_RUNTIME_PROVENANCE');
  });
});

describe('NO CLAIM — a safe disjunction is never one exact runtime', () => {
  it('refuses to mark a record KNOWN_ACTIVE while the thread is SAFE_DISJUNCTION (or already KNOWN_SAFE_ACTIVE)', () => {
    const registry = new RuntimeProvenanceRegistry(() => 0);
    expect(refusal(() => registry.createKnownActive(INPUT, 'SAFE_DISJUNCTION'))).toBe('KNOWN_ACTIVE_REFUSED_UNDER_SAFE_DISJUNCTION');
    expect(refusal(() => registry.createKnownActive(INPUT, 'KNOWN_SAFE_ACTIVE'))).toBe('KNOWN_ACTIVE_REFUSED_WHILE_THREAD_KNOWN_SAFE_ACTIVE');
    expect(registry.recordsOfThread('thr_1')).toEqual([]);
    expect(registry.createKnownActive(INPUT, 'RETIRED').status).toBe('KNOWN_ACTIVE');
  });

  it('refuses a record whose original effective bits are not (false, false)', () => {
    const registry = new RuntimeProvenanceRegistry(() => 0);
    for (const bits of [
      { shell_snapshot: true, shell_snapshot_v2: false },
      { shell_snapshot: false, shell_snapshot_v2: true },
    ]) {
      expect(refusal(() => registry.createKnownActive({ ...INPUT, effective_bits: bits }, 'ABSENT'))).toBe('ORIGINAL_EFFECTIVE_BITS_NOT_FALSE_FALSE');
    }
    expect(refusal(() => registry.createKnownActive({ ...INPUT, originating_operation: 'thread/read' as never }, 'ABSENT'))).toBe(
      'ORIGIN_NOT_A_KNOWN_RUNTIME_CREATION',
    );
  });
});

describe('SAME THREAD, NEW INCARNATION — logical thread id != runtime incarnation', () => {
  it('a known replacement retires the old record and creates a NEW incarnation linked to its predecessor', () => {
    const registry = new RuntimeProvenanceRegistry(() => 7);
    const old = registry.createKnownActive(INPUT, 'ABSENT');
    const before = JSON.parse(JSON.stringify(old)) as Record<string, unknown>;
    const replacement = registry.linkKnownReplacement(
      {
        ...INPUT,
        originating_operation: 'thread/resume(known reconstruction)',
        originating_operation_admission_id: 'operation-admission:g1:9',
        predecessor_lineage_ref: 'thread-safety-state:4',
      },
      'RETIRED',
    );
    expect(replacement.logical_thread_id).toBe(old.logical_thread_id);
    expect(replacement.RUNTIME_PROVENANCE_ID).not.toBe(old.RUNTIME_PROVENANCE_ID);
    expect(replacement.HARNESS_RUNTIME_INCARNATION_ID).not.toBe(old.HARNESS_RUNTIME_INCARNATION_ID);
    expect(replacement.predecessor_lineage_ref).toBe('thread-safety-state:4');
    const retired = registry.lookup(old.RUNTIME_PROVENANCE_ID)!;
    expect(retired.status).toBe('RETIRED');
    expect(retired.retirement_event).toBe('KNOWN_COLD_REPLACEMENT');
    // Old record bytes unchanged except its status / retirement fields; the object itself was never mutated.
    const after = JSON.parse(JSON.stringify(retired)) as Record<string, unknown>;
    expect(Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])).sort()).toEqual([
      'retirement_event',
      'retirement_monotonic',
      'status',
    ]);
    expect(old.status).toBe('KNOWN_ACTIVE');
    expect(registry.recordsOfThread('thr_1').map((r) => r.status)).toEqual(['RETIRED', 'KNOWN_ACTIVE']);
  });
});
