// CONT-P5-E1 — STEPS 2-4 of a thread/resume observation (Dispatch v8 M7c; Correction 10 sections 8-13 with the field
// contract of Correction 11 sections 8-20; Correction 13 section 7).
//
// ★ THREE DIMENSIONS, NEVER COLLAPSED:
//     new_safety_state    THREAD_SAFETY_STATE after the operation   <- pre-operation safety state, branch evidence,
//                                                                       operation kind, structural validity ONLY
//     branch_knowledge    KNOWN_COLD | UNKNOWN (+ the BRANCH_EVIDENCE <- the same inputs ONLY
//                         variant it cites)
//     conformance_result  PASS | FAIL_DOWNSTREAM_... | CHARACTERIZATION_ONLY | E1_INFRA_FAILURE
//   The first two functions take no requested value and no effective value (their input type has no such member), so
//   a response can never create branch knowledge or safety: EFFECTIVE == REQUESTED DOES NOT PROVE COLD.
// ★ ORDER. STEP 1 (resume-structural-validator.ts) precedes everything; a response that failed it short-circuits to
//   the Correction 10 section 13 validity = FAIL row: E1_INFRA_FAILURE, the run stops, the token stays CONSUMED, the
//   safety state is the safe disjunction over every runtime that may exist, branch knowledge is UNKNOWN, and NO
//   normalized comparison is produced or invented. This module never re-validates.
// ★ STEP 3 compares only REQUESTED_CONFORMANCE_FIELDS(q): the COMPARE keys actually present in the exact bound request
//   (never the response's keys), each through NORMALIZATION_RULES: identity for model / cwd / approvalPolicy /
//   approvalsReviewer, the sandbox mode projection onto `sandbox.type`. There is no alias, case folding, trimming,
//   separator normalization, symlink resolution, default or provider substitution in this module, and it imports no
//   filesystem or path API.
// ★ STEP 4. KNOWN_COLD: all match -> PASS; any mismatch -> FAIL_DOWNSTREAM_REQUESTED_EFFECTIVE_MISMATCH (mixed, partial,
//   single or multiple). UNKNOWN: any relation -> CHARACTERIZATION_ONLY. A mismatch is never infrastructure failure.
// ★ Deterministic and total; side-effect free apart from building the bounded evidence projection.

import {
  projectResumeObservationEvidence,
  type NormalizedComparison,
  type ResumeObservationEvidence,
  type StructuralValidationStatus,
} from './evidence-projection.js';
import type { ProtectedOperationRequest } from './operation-binder.js';
import { normalizeRequestedValue, requestedConformanceFields } from './resume-response-contract.js';
import {
  isIssuedByResumeStructuralValidator,
  type ResumeStructuralValidation,
  type ValidatedThreadResumeResponse,
} from './resume-structural-validator.js';
import { nextThreadSafetyState, type ResumeSafetyDecision, type ThreadSafetyStateRecord } from './thread-safety-state.js';

type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/** Correction 10 section 8.3: the only branch-evidence variants. Never computed from requested/effective values. */
export const BRANCH_EVIDENCE_VALUES = ['PRECONDITION_KNOWN_COLD', 'NONE'] as const;
export type BranchEvidence = (typeof BRANCH_EVIDENCE_VALUES)[number];

/** Correction 10 section 8.1: no loaded-branch value exists (no source-proven producer at PIN / SUCCESSOR). */
export const BRANCH_KNOWLEDGE_VALUES = ['KNOWN_COLD', 'UNKNOWN'] as const;
export type BranchKnowledge = (typeof BRANCH_KNOWLEDGE_VALUES)[number];

/** Correction 10 section 10.1. */
export const CONFORMANCE_RESULTS = [
  'PASS',
  'FAIL_DOWNSTREAM_REQUESTED_EFFECTIVE_MISMATCH',
  'CHARACTERIZATION_ONLY',
  'E1_INFRA_FAILURE',
] as const;
export type ConformanceResult = (typeof CONFORMANCE_RESULTS)[number];

/** The narrow E1_INFRA_FAILURE reasons of this observation (Correction 10 section 11). */
export const RESUME_OBSERVATION_FAILURES = [
  'MISSING_SESSION_PROVENANCE',
  'REGISTRY_CONTRADICTION',
  'RESPONSE_STRUCTURAL_FAILURE',
  'PROTECTED_SEND_RPC_ERROR',
  'SEND_FAILED_AFTER_CONSUME',
  'OBSERVATION_NOT_ISSUED_BY_STRUCTURAL_VALIDATOR',
  'BOUND_REQUEST_OUTSIDE_GOVERNED_DOMAIN',
] as const;
export type ResumeObservationFailure = (typeof RESUME_OBSERVATION_FAILURES)[number];

/** What the protected send produced: STEP 1's result, an RPC error object, or no response at all. */
export type ResumeObservation =
  | Readonly<{ kind: 'VALIDATED'; validation: ResumeStructuralValidation }>
  | Readonly<{ kind: 'RPC_ERROR' }>
  | Readonly<{ kind: 'SEND_FAILED_AFTER_CONSUME' }>;

/** Separately supplied inputs (Correction 10 section 13); none is derived from another. */
export type ResumeObservationInputs = Readonly<{
  /** THREAD_SAFETY_STATE of T in the current generation before the send; `null` = none. */
  pre_operation_safety_state: ThreadSafetyStateRecord | null;
  branch_evidence: BranchEvidence;
  /** The exact bound thread/resume request object: the ONLY source of requested values and of field membership. */
  bound_request: ProtectedOperationRequest;
  observation: ResumeObservation;
  /** The OPERATION_ADMISSION_ID of the fresh reconstruction admission this send consumed. */
  reconstruction_admission_ref: string;
}>;

export type StructuralValidity = 'VALID' | 'FAIL' | 'NO_RESPONSE';

/** The ONLY inputs of the safety and branch functions: no requested value, no effective value. */
export type SafetyAndBranchInputs = Readonly<{
  pre_operation_safety_state: ThreadSafetyStateRecord | null;
  branch_evidence: BranchEvidence;
  operation_kind: 'thread/resume';
  structural_validity: StructuralValidity;
  reconstruction_admission_ref: string;
}>;

export const SAFETY_AND_BRANCH_INPUTS_ARE_VALUE_FREE: Exactly<
  keyof SafetyAndBranchInputs,
  'pre_operation_safety_state' | 'branch_evidence' | 'operation_kind' | 'structural_validity' | 'reconstruction_admission_ref'
> = true;

export type ResumeObservationClassification = Readonly<{
  new_safety_state: ResumeSafetyDecision;
  branch_knowledge: BranchKnowledge;
  branch_evidence: BranchEvidence;
  conformance_result: ConformanceResult;
  evidence_projection: ResumeObservationEvidence;
}>;

type Row = 'POSSIBLY_LOADED' | 'KNOWN_COLD' | 'NO_SEND_MISSING_SESSION_PROVENANCE' | 'NO_SEND_REGISTRY_CONTRADICTION';

/** Which Correction 10 section 13 row the pre-send facts select (the NO_SEND rows are never admitted). */
function rowOf(pre: ThreadSafetyStateRecord | null, evidence: BranchEvidence): Row {
  const safe = pre?.state === 'KNOWN_SAFE_ACTIVE' || pre?.state === 'SAFE_DISJUNCTION';
  if (evidence === 'PRECONDITION_KNOWN_COLD') return safe ? 'NO_SEND_REGISTRY_CONTRADICTION' : 'KNOWN_COLD';
  return safe ? 'POSSIBLY_LOADED' : 'NO_SEND_MISSING_SESSION_PROVENANCE';
}

/**
 * new_safety_state (Correction 10 sections 5.4 and 13), from the value-free inputs only. A row that should never have
 * been sent derives no transition; every admitted row stays a valid safe state whatever the response was.
 */
export function computeNewSafetyState(inputs: SafetyAndBranchInputs): ResumeSafetyDecision {
  const pre = inputs.pre_operation_safety_state;
  const row = rowOf(pre, inputs.branch_evidence);
  const ref = inputs.reconstruction_admission_ref;
  if (row === 'NO_SEND_MISSING_SESSION_PROVENANCE' || row === 'NO_SEND_REGISTRY_CONTRADICTION') {
    return Object.freeze({ transition: 'NONE_NO_SEND_ROW', unchanged: pre === null ? 'ABSENT' : pre.state });
  }
  if (row === 'KNOWN_COLD' && inputs.structural_validity === 'VALID') {
    const event = Object.freeze({ kind: 'ADMITTED_KNOWN_COLD_RESUME_SUCCESS' as const, reconstructionAdmissionRef: ref });
    const next = nextThreadSafetyState(pre, event);
    if (!next.allowed || next.to !== 'KNOWN_SAFE_ACTIVE') {
      return Object.freeze({ transition: 'NONE_NO_SEND_ROW', unchanged: pre === null ? 'ABSENT' : pre.state });
    }
    return Object.freeze({ transition: 'KNOWN_SAFE_ACTIVE', event });
  }
  const event =
    row === 'KNOWN_COLD'
      ? Object.freeze({ kind: 'ADMITTED_KNOWN_COLD_RESUME_ATTEMPT_FAILED' as const, reconstructionAdmissionRef: ref })
      : Object.freeze({ kind: 'POSSIBLY_LOADED_RESUME_BRANCH_UNKNOWN' as const, reconstructionAdmissionRef: ref });
  const next = nextThreadSafetyState(pre, event);
  if (!next.allowed || next.to !== 'SAFE_DISJUNCTION') {
    return Object.freeze({ transition: 'NONE_NO_SEND_ROW', unchanged: pre === null ? 'ABSENT' : pre.state });
  }
  return Object.freeze({ transition: 'SAFE_DISJUNCTION', event, safetyLineageRefs: next.safetyLineageRefs });
}

/**
 * branch_knowledge (Correction 10 sections 8-9, 13): KNOWN_COLD only from PRECONDITION_KNOWN_COLD on an admitted
 * known-cold row whose response passed STEP 1; UNKNOWN otherwise (the validity = FAIL row included). It cites exactly
 * one BRANCH_EVIDENCE variant: the one supplied.
 */
export function computeBranchKnowledge(inputs: SafetyAndBranchInputs): Readonly<{ branch_knowledge: BranchKnowledge; branch_evidence: BranchEvidence }> {
  const knownCold = rowOf(inputs.pre_operation_safety_state, inputs.branch_evidence) === 'KNOWN_COLD' && inputs.structural_validity === 'VALID';
  return Object.freeze({ branch_knowledge: knownCold ? 'KNOWN_COLD' : 'UNKNOWN', branch_evidence: inputs.branch_evidence });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** STEP 3 over one validated response: normalized comparison of each requested conformance field. */
function compareRequestedFields(
  q: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  r: ValidatedThreadResumeResponse,
): readonly NormalizedComparison[] | null {
  const results: NormalizedComparison[] = [];
  for (const field of fields) {
    const requested = normalizeRequestedValue(field, q[field]);
    if (requested === null) return null;
    const effectiveRaw = r[field];
    let effective: string;
    let match: boolean;
    if (field === 'sandbox') {
      effective = (effectiveRaw as { readonly type: string }).type;
      match = requested === effective;
    } else if (field === 'approvalPolicy' && isRecord(effectiveRaw)) {
      effective = 'granular'; // a well-formed granular object: discriminator only, never its members
      match = false;
    } else {
      effective = effectiveRaw as string;
      match = requested === effectiveRaw;
    }
    results.push(Object.freeze({ field, requested_normalized: requested, effective_normalized: effective, result: match ? 'MATCH' : 'MISMATCH' }));
  }
  return Object.freeze(results);
}

/** The whole observation: STEP 2 (pre-established branch knowledge) -> STEP 3 -> STEP 4, plus the bounded evidence. */
export function classifyResumeObservation(inputs: ResumeObservationInputs): ResumeObservationClassification {
  const observation = inputs.observation;
  const authentic = observation.kind !== 'VALIDATED' || isIssuedByResumeStructuralValidator(observation.validation);
  const validation = observation.kind === 'VALIDATED' ? observation.validation : null;
  const validated = authentic && validation?.status === 'VALID' ? validation.validated : null;
  const structural_validity: StructuralValidity =
    validated !== null ? 'VALID' : observation.kind === 'SEND_FAILED_AFTER_CONSUME' ? 'NO_RESPONSE' : 'FAIL';

  const safetyInputs: SafetyAndBranchInputs = Object.freeze({
    pre_operation_safety_state: inputs.pre_operation_safety_state,
    branch_evidence: inputs.branch_evidence,
    operation_kind: 'thread/resume',
    structural_validity,
    reconstruction_admission_ref: inputs.reconstruction_admission_ref,
  });
  const new_safety_state = computeNewSafetyState(safetyInputs);
  const { branch_knowledge, branch_evidence } = computeBranchKnowledge(safetyInputs);

  const row = rowOf(inputs.pre_operation_safety_state, inputs.branch_evidence);
  const q = inputs.bound_request.method === 'thread/resume' && isRecord(inputs.bound_request.params) ? inputs.bound_request.params : null;
  const requestedFieldNames = q === null ? null : requestedConformanceFields(q);

  let conformance_result: ConformanceResult = 'E1_INFRA_FAILURE';
  let failure: ResumeObservationFailure | null;
  let comparisons: readonly NormalizedComparison[] | null = null;
  if (row === 'NO_SEND_MISSING_SESSION_PROVENANCE') failure = 'MISSING_SESSION_PROVENANCE';
  else if (row === 'NO_SEND_REGISTRY_CONTRADICTION') failure = 'REGISTRY_CONTRADICTION';
  else if (!authentic) failure = 'OBSERVATION_NOT_ISSUED_BY_STRUCTURAL_VALIDATOR';
  else if (observation.kind === 'SEND_FAILED_AFTER_CONSUME') failure = 'SEND_FAILED_AFTER_CONSUME';
  else if (observation.kind === 'RPC_ERROR') failure = 'PROTECTED_SEND_RPC_ERROR';
  else if (validated === null) failure = 'RESPONSE_STRUCTURAL_FAILURE';
  else if (q === null || requestedFieldNames === null) failure = 'BOUND_REQUEST_OUTSIDE_GOVERNED_DOMAIN';
  else {
    comparisons = compareRequestedFields(q, requestedFieldNames, validated);
    if (comparisons === null) {
      failure = 'BOUND_REQUEST_OUTSIDE_GOVERNED_DOMAIN';
    } else {
      failure = null;
      const allMatch = comparisons.every((c) => c.result === 'MATCH');
      conformance_result =
        branch_knowledge === 'KNOWN_COLD' ? (allMatch ? 'PASS' : 'FAIL_DOWNSTREAM_REQUESTED_EFFECTIVE_MISMATCH') : 'CHARACTERIZATION_ONLY';
    }
  }

  const structuralStatus: StructuralValidationStatus =
    observation.kind === 'SEND_FAILED_AFTER_CONSUME'
      ? 'NO_RESPONSE'
      : observation.kind === 'RPC_ERROR'
        ? 'RPC_ERROR'
        : validated !== null
          ? 'VALID'
          : 'STRUCTURAL_FAILURE';
  const pre = inputs.pre_operation_safety_state === null ? 'ABSENT' : inputs.pre_operation_safety_state.state;
  const post = new_safety_state.transition === 'NONE_NO_SEND_ROW' ? new_safety_state.unchanged : new_safety_state.transition;
  const evidence_projection = projectResumeObservationEvidence({
    operationAdmissionId: inputs.reconstruction_admission_ref,
    pre,
    post,
    branchKnowledge: branch_knowledge,
    branchEvidence: branch_evidence,
    conformanceResult: conformance_result,
    structuralStatus,
    structuralFailure: authentic && validation?.status === 'STRUCTURAL_FAILURE' ? { reason: validation.reason, key: validation.key } : null,
    requestedFieldNames,
    comparisons,
    validated,
    failure,
  });

  return Object.freeze({ new_safety_state, branch_knowledge, branch_evidence, conformance_result, evidence_projection });
}
