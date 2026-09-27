// CONT-P5-E1 — bounded evidence projection (Dispatch v8 M8; Correction 10 section 12 as amended by Correction 11 section
// 24; Correction 08 section 12): the SINK and EVIDENCE_FIELDS rows.

import { describe, expect, it } from 'vitest';

import {
  assertEvidenceBounded,
  EvidenceNotBounded,
  FEATURE_ATTESTATION_EVIDENCE_FIELDS,
  projectFeatureAttestationEvidence,
  projectProtectedOperationEvidence,
  PROTECTED_OPERATION_EVIDENCE_FIELDS,
  RESUME_OBSERVATION_EVIDENCE_FIELDS,
  type ProtectedOperationEvidence,
} from './evidence-projection.js';

describe('allowlists — the persisted fields and nothing else', () => {
  it('the resume observation record: the three dimensions as three fields plus the section 24 conformance record', () => {
    expect(RESUME_OBSERVATION_EVIDENCE_FIELDS).toEqual([
      'operation_admission_id',
      'pre_operation_thread_safety_state',
      'post_operation_thread_safety_state',
      'branch_knowledge',
      'branch_evidence',
      'conformance_result',
      'structural_validation_status',
      'structural_failure_reason',
      'structural_failure_key',
      'requested_conformance_field_names',
      'normalized_comparison_results',
      'sandbox_effective_discriminator',
      'experimental_observation_markers',
      'failure_enum',
    ]);
    const all = [...RESUME_OBSERVATION_EVIDENCE_FIELDS, ...PROTECTED_OPERATION_EVIDENCE_FIELDS, ...FEATURE_ATTESTATION_EVIDENCE_FIELDS];
    expect(all).not.toContain('classification');
    for (const field of all) expect(field, field).not.toMatch(/raw|payload|roots|instruction|cursor_content|credential|environment|config_text|candidate/i);
  });

  it('the feature attestation record: bits, completeness, binary, generation, admission, operation reference, codes, times', () => {
    expect(FEATURE_ATTESTATION_EVIDENCE_FIELDS).toEqual([
      'operation_admission_id',
      'operation_type',
      'operation_reference',
      'shell_snapshot_effective',
      'shell_snapshot_v2_effective',
      'complete',
      'binary_identity',
      'process_generation',
      'status',
      'failure_enum',
      'parse_failure',
      'issue_monotonic',
      'consume_monotonic',
    ]);
  });

  it('the sink guard refuses a missing or an extra field', () => {
    expect(() => assertEvidenceBounded({ a: 1 }, ['a'])).not.toThrow();
    expect(() => assertEvidenceBounded({ a: 1, raw: 'x' }, ['a'])).toThrow(EvidenceNotBounded);
    expect(() => assertEvidenceBounded({}, ['a'])).toThrow(EvidenceNotBounded);
  });
});

describe('projection — copies allowlisted fields only, frozen', () => {
  it('drops anything smuggled into the input', () => {
    const smuggled = {
      operation_admission_id: 'operation-admission:g1:1',
      operation_type: 'thread/start' as const,
      operation_reference: 'request-binding:g1:1',
      shell_snapshot_effective: false,
      shell_snapshot_v2_effective: false,
      complete: true,
      binary_identity: 'bin',
      process_generation: 1,
      status: 'ADMITTED' as const,
      failure_enum: null,
      parse_failure: null,
      issue_monotonic: 1,
      consume_monotonic: null,
      rawPage: { data: ['secret-page-17f0'] },
    };
    const evidence = projectFeatureAttestationEvidence(smuggled);
    expect(Object.keys(evidence)).toEqual([...FEATURE_ATTESTATION_EVIDENCE_FIELDS]);
    expect(JSON.stringify(evidence)).not.toContain('secret-page-17f0');
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it('names a runtime incarnation only together with a known runtime provenance (never under SAFE_DISJUNCTION)', () => {
    const base: ProtectedOperationEvidence = {
      operation_admission_id: 'operation-admission:g1:2',
      operation_type: 'thread/resume',
      feature_context_ref: 'feature-context:g1:2',
      request_binding_id: 'request-binding:g1:2',
      process_generation: 1,
      binary_identity: 'bin',
      shell_snapshot_effective: false,
      shell_snapshot_v2_effective: false,
      issue_monotonic: 1,
      consume_monotonic: 2,
      logical_thread_id: 'thr_1',
      thread_safety_state_id: 'thread-safety-state:2',
      runtime_provenance_id: null,
      harness_runtime_incarnation_id: null,
      failure_enum: null,
      resume_observation: null,
    };
    expect(Object.keys(projectProtectedOperationEvidence(base))).toEqual([...PROTECTED_OPERATION_EVIDENCE_FIELDS]);
    expect(() => projectProtectedOperationEvidence({ ...base, harness_runtime_incarnation_id: 'harness-runtime-incarnation:1' })).toThrow(EvidenceNotBounded);
    expect(() => projectProtectedOperationEvidence({ ...base, runtime_provenance_id: 'runtime-provenance:1' })).toThrow(EvidenceNotBounded);
    expect(() => projectProtectedOperationEvidence({ ...base, resume_observation: { extra: 1 } as never })).toThrow(EvidenceNotBounded);
  });
});
