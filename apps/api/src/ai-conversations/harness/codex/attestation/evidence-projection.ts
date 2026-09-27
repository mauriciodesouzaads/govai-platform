// CONT-P5-E1 — bounded evidence projection (Dispatch v8 M8; Correction 10 section 12 with its conformance-record clause
// replaced by Correction 11 section 24; Correction 08 section 12 for the effective-feature attestation).
//
// Every record below is built field by field from already-validated, already-bounded values: there is no path from a
// raw response, a raw feature-list page, a malformed payload, an RPC error text, a credential, the environment, raw
// config or requirements into a record. In particular NEVER persisted: instruction source paths, sandbox writable
// roots, cursor contents, granular approval members, experimental payloads (only UNOBSERVED / OBSERVED_PRESENT markers),
// Thread contents, feature names other than the two targets, descriptions / announcements / display names.
//
// ★ THREE DIMENSIONS, THREE FIELDS. post-operation THREAD_SAFETY_STATE, BRANCH_KNOWLEDGE (with the BRANCH_EVIDENCE
//   variant it cites) and CONFORMANCE_RESULT are separately named fields; no single merged classification field exists
//   and no per-runtime tuple is recorded.
// ★ No raw-message tap is used for `experimentalFeature/list` at any sink: only the two target bits are projected.

import type { EffectiveFeatureListFailureReason } from './effective-feature-list.js';
import type { OperationAdmissionFailure } from './operation-admission-token.js';
import type { ProtectedOperationKind } from './operation-binder.js';
import type { BranchEvidence, BranchKnowledge, ConformanceResult, ResumeObservationFailure } from './resume-observation-classifier.js';
import { EXPERIMENTAL_OPTIONAL_OBSERVABLE_FIELDS, KNOWN_TOP_LEVEL_RESPONSE_KEYS } from './resume-response-contract.js';
import type { ResumeStructuralFailureReason, ValidatedThreadResumeResponse } from './resume-structural-validator.js';
import type { ThreadSafetyStateName } from './thread-safety-state.js';

export class EvidenceNotBounded extends Error {
  readonly code = 'e1_evidence_not_bounded';
  constructor(readonly field: string) {
    super(`e1 evidence record carries a field outside its allowlist: ${field}`);
    this.name = 'EvidenceNotBounded';
  }
}

/** Sink guard: a record may carry exactly the allowlisted fields and nothing else. */
export function assertEvidenceBounded(record: object, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new EvidenceNotBounded(key);
  for (const key of allowed) if (!Object.hasOwn(record, key)) throw new EvidenceNotBounded(key);
}

function sealed<T extends object>(record: T, allowed: readonly string[]): T {
  assertEvidenceBounded(record, allowed);
  return Object.freeze(record);
}

// ---------------------------------------------------------------------------------------------------------
// Effective-feature attestation (Correction 08 section 12 PERSISTED list)
// ---------------------------------------------------------------------------------------------------------

export const FEATURE_ATTESTATION_EVIDENCE_FIELDS = [
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
] as const;

export type FeatureAttestationEvidence = Readonly<{
  operation_admission_id: string | null;
  operation_type: ProtectedOperationKind;
  /** The REQUEST_BINDING_ID of the operation the attestation was bound to. */
  operation_reference: string;
  shell_snapshot_effective: boolean | null;
  shell_snapshot_v2_effective: boolean | null;
  complete: boolean;
  binary_identity: string;
  /** The harness-logical process (server) generation. */
  process_generation: number;
  status: 'ADMITTED' | 'REFUSED';
  failure_enum: OperationAdmissionFailure | null;
  parse_failure: EffectiveFeatureListFailureReason | null;
  issue_monotonic: number | null;
  consume_monotonic: number | null;
}>;

export function projectFeatureAttestationEvidence(input: FeatureAttestationEvidence): FeatureAttestationEvidence {
  return sealed(
    {
      operation_admission_id: input.operation_admission_id,
      operation_type: input.operation_type,
      operation_reference: input.operation_reference,
      shell_snapshot_effective: input.shell_snapshot_effective,
      shell_snapshot_v2_effective: input.shell_snapshot_v2_effective,
      complete: input.complete,
      binary_identity: input.binary_identity,
      process_generation: input.process_generation,
      status: input.status,
      failure_enum: input.failure_enum,
      parse_failure: input.parse_failure,
      issue_monotonic: input.issue_monotonic,
      consume_monotonic: input.consume_monotonic,
    },
    FEATURE_ATTESTATION_EVIDENCE_FIELDS,
  );
}

// ---------------------------------------------------------------------------------------------------------
// thread/resume observation (Correction 11 section 24 conformance record + the Correction 10 section 12 dimensions)
// ---------------------------------------------------------------------------------------------------------

export const RESUME_OBSERVATION_EVIDENCE_FIELDS = [
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
] as const;

export type ExperimentalObservationMarker = 'UNOBSERVED' | 'OBSERVED_PRESENT';

export type NormalizedComparison = Readonly<{
  field: string;
  requested_normalized: string;
  /** A literal, or `granular` for a granular approval policy, or the sandbox discriminator: never a payload. */
  effective_normalized: string;
  result: 'MATCH' | 'MISMATCH';
}>;

export type StructuralValidationStatus = 'VALID' | 'STRUCTURAL_FAILURE' | 'RPC_ERROR' | 'NO_RESPONSE';

export type ResumeObservationEvidence = Readonly<{
  operation_admission_id: string;
  pre_operation_thread_safety_state: ThreadSafetyStateName | 'ABSENT';
  post_operation_thread_safety_state: ThreadSafetyStateName | 'ABSENT';
  branch_knowledge: BranchKnowledge;
  branch_evidence: BranchEvidence;
  conformance_result: ConformanceResult;
  structural_validation_status: StructuralValidationStatus;
  structural_failure_reason: ResumeStructuralFailureReason | null;
  /** A contract key only; the name of an unknown top-level key is response data and is not recorded. */
  structural_failure_key: string | null;
  requested_conformance_field_names: readonly string[] | null;
  normalized_comparison_results: readonly NormalizedComparison[] | null;
  sandbox_effective_discriminator: string | null;
  experimental_observation_markers: Readonly<Record<string, ExperimentalObservationMarker>> | null;
  failure_enum: ResumeObservationFailure | null;
}>;

export type ResumeObservationEvidenceInput = Readonly<{
  operationAdmissionId: string;
  pre: ThreadSafetyStateName | 'ABSENT';
  post: ThreadSafetyStateName | 'ABSENT';
  branchKnowledge: BranchKnowledge;
  branchEvidence: BranchEvidence;
  conformanceResult: ConformanceResult;
  structuralStatus: StructuralValidationStatus;
  structuralFailure: Readonly<{ reason: ResumeStructuralFailureReason; key: string }> | null;
  requestedFieldNames: readonly string[] | null;
  comparisons: readonly NormalizedComparison[] | null;
  /** The validated response, when STEP 1 passed; only the discriminator and marker presence are read from it. */
  validated: ValidatedThreadResumeResponse | null;
  failure: ResumeObservationFailure | null;
}>;

export function projectResumeObservationEvidence(input: ResumeObservationEvidenceInput): ResumeObservationEvidence {
  const validated = input.validated;
  const sandbox = validated === null ? null : (validated['sandbox'] as { readonly type: string });
  const markers =
    validated === null
      ? null
      : Object.freeze(
          Object.fromEntries(
            EXPERIMENTAL_OPTIONAL_OBSERVABLE_FIELDS.map((key) => [
              key,
              Object.hasOwn(validated, key) ? ('OBSERVED_PRESENT' as const) : ('UNOBSERVED' as const),
            ]),
          ),
        );
  const failureKey = input.structuralFailure?.key ?? null;
  return sealed(
    {
      operation_admission_id: input.operationAdmissionId,
      pre_operation_thread_safety_state: input.pre,
      post_operation_thread_safety_state: input.post,
      branch_knowledge: input.branchKnowledge,
      branch_evidence: input.branchEvidence,
      conformance_result: input.conformanceResult,
      structural_validation_status: input.structuralStatus,
      structural_failure_reason: input.structuralFailure?.reason ?? null,
      structural_failure_key: failureKey !== null && KNOWN_TOP_LEVEL_RESPONSE_KEYS.includes(failureKey) ? failureKey : null,
      requested_conformance_field_names: input.requestedFieldNames === null ? null : Object.freeze([...input.requestedFieldNames]),
      normalized_comparison_results:
        input.comparisons === null ? null : Object.freeze(input.comparisons.map((c) => Object.freeze({ ...c }))),
      sandbox_effective_discriminator: sandbox === null ? null : sandbox.type,
      experimental_observation_markers: markers,
      failure_enum: input.failure,
    },
    RESUME_OBSERVATION_EVIDENCE_FIELDS,
  );
}

// ---------------------------------------------------------------------------------------------------------
// One protected operation (Correction 10 section 12 PERSIST list)
// ---------------------------------------------------------------------------------------------------------

export const PROTECTED_OPERATION_EVIDENCE_FIELDS = [
  'operation_admission_id',
  'operation_type',
  'feature_context_ref',
  'request_binding_id',
  'process_generation',
  'binary_identity',
  'shell_snapshot_effective',
  'shell_snapshot_v2_effective',
  'issue_monotonic',
  'consume_monotonic',
  'logical_thread_id',
  'thread_safety_state_id',
  'runtime_provenance_id',
  'harness_runtime_incarnation_id',
  'failure_enum',
  'resume_observation',
] as const;

export type ProtectedOperationEvidence = Readonly<{
  operation_admission_id: string;
  operation_type: ProtectedOperationKind;
  feature_context_ref: string;
  request_binding_id: string;
  process_generation: number;
  binary_identity: string;
  shell_snapshot_effective: false;
  shell_snapshot_v2_effective: false;
  issue_monotonic: number;
  consume_monotonic: number | null;
  logical_thread_id: string | null;
  /** The post-operation THREAD_SAFETY_STATE record id. */
  thread_safety_state_id: string | null;
  /** Set only when a positively known runtime exists (KNOWN_SAFE_ACTIVE). */
  runtime_provenance_id: string | null;
  /** Set only under KNOWN_SAFE_ACTIVE; a SAFE_DISJUNCTION names no incarnation. */
  harness_runtime_incarnation_id: string | null;
  failure_enum: OperationAdmissionFailure | ResumeObservationFailure | null;
  /** thread/resume only. */
  resume_observation: ResumeObservationEvidence | null;
}>;

export function projectProtectedOperationEvidence(input: ProtectedOperationEvidence): ProtectedOperationEvidence {
  if ((input.runtime_provenance_id === null) !== (input.harness_runtime_incarnation_id === null)) {
    throw new EvidenceNotBounded('harness_runtime_incarnation_id');
  }
  if (input.resume_observation !== null) assertEvidenceBounded(input.resume_observation, RESUME_OBSERVATION_EVIDENCE_FIELDS);
  return sealed(
    {
      operation_admission_id: input.operation_admission_id,
      operation_type: input.operation_type,
      feature_context_ref: input.feature_context_ref,
      request_binding_id: input.request_binding_id,
      process_generation: input.process_generation,
      binary_identity: input.binary_identity,
      shell_snapshot_effective: input.shell_snapshot_effective,
      shell_snapshot_v2_effective: input.shell_snapshot_v2_effective,
      issue_monotonic: input.issue_monotonic,
      consume_monotonic: input.consume_monotonic,
      logical_thread_id: input.logical_thread_id,
      thread_safety_state_id: input.thread_safety_state_id,
      runtime_provenance_id: input.runtime_provenance_id,
      harness_runtime_incarnation_id: input.harness_runtime_incarnation_id,
      failure_enum: input.failure_enum,
      resume_observation: input.resume_observation,
    },
    PROTECTED_OPERATION_EVIDENCE_FIELDS,
  );
}
