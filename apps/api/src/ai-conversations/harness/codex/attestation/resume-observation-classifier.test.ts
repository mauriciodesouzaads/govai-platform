// CONT-P5-E1 — STEPS 2-4 of the thread/resume observation (Dispatch v8 M7c/M8; section 4 rows CE-01..CE-08 through the
// classifier, T-13..T-19, T-22, T-23, T-25, T-26, T-27 (Correction 10 section 18 rows), C13-R3-G, C13-R3-H, and the
// Correction 10 section 13 decision table). Branch evidence is always an explicit test input: no canned response emits
// or implies a branch signal. No Codex process is started.

import { describe, expect, it } from 'vitest';

import {
  cannedSandboxPolicy,
  cannedStockThread,
  cannedThreadResumeResult,
  CANNED_THREAD_ID,
  type CannedEffectiveSettings,
} from '../client/fake-app-server.fixture.js';
import { GovAICodexSafeRequestBuilder as B, type GovAICodexThreadResumeInput } from '../protocol/govai-policy.js';
import type { ProtectedOperationRequest } from './operation-binder.js';
import {
  BRANCH_EVIDENCE_VALUES,
  BRANCH_KNOWLEDGE_VALUES,
  classifyResumeObservation,
  computeBranchKnowledge,
  computeNewSafetyState,
  CONFORMANCE_RESULTS,
  SAFETY_AND_BRANCH_INPUTS_ARE_VALUE_FREE,
  type BranchEvidence,
  type ResumeObservation,
  type ResumeObservationClassification,
  type SafetyAndBranchInputs,
} from './resume-observation-classifier.js';
import { validateThreadResumeResponseStructure } from './resume-structural-validator.js';
import { RuntimeProvenanceRegistry } from './runtime-provenance-registry.js';
import { THREAD_SAFETY_STATES, ThreadSafetyStateRegistry, type ThreadSafetyStateRecord } from './thread-safety-state.js';

const W = '/Users/Shared/govai-e1-fixture/work';
const W2 = '/Users/Shared/govai-e1-fixture/work-b';
const ADM = 'operation-admission:g1:7';

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------------

const BASE = { THREAD_SAFETY_STATE_ID: 'thread-safety-state:1', logical_thread_id: CANNED_THREAD_ID, PROCESS_GENERATION: 1, BINARY_IDENTITY: 'bin', creation_monotonic: 0 };
const KSA: ThreadSafetyStateRecord = Object.freeze({ ...BASE, state: 'KNOWN_SAFE_ACTIVE', runtime_provenance_id: 'runtime-provenance:1' });
const SD: ThreadSafetyStateRecord = Object.freeze({
  ...BASE,
  THREAD_SAFETY_STATE_ID: 'thread-safety-state:2',
  state: 'SAFE_DISJUNCTION',
  safety_lineage_refs: Object.freeze(['thread-safety-state:1', 'operation-admission:g1:5']),
  latest_reconstruction_admission_ref: 'operation-admission:g1:5',
});
const RETIRED: ThreadSafetyStateRecord = Object.freeze({
  ...BASE,
  THREAD_SAFETY_STATE_ID: 'thread-safety-state:3',
  state: 'RETIRED',
  retirement_event: 'KNOWN_THREAD_DELETION',
  retirement_monotonic: 5,
});
const PRE_STATES: readonly (readonly [string, ThreadSafetyStateRecord | null])[] = [
  ['ABSENT', null],
  ['KNOWN_SAFE_ACTIVE', KSA],
  ['SAFE_DISJUNCTION', SD],
  ['RETIRED', RETIRED],
];

type ResumeInput = Partial<GovAICodexThreadResumeInput>;

/** The exact bound request object (frozen, policy-normalized) — the ONLY source of requested values. */
function q(overrides: ResumeInput = {}, drop: readonly ('model' | 'cwd')[] = []): ProtectedOperationRequest {
  const input: Record<string, unknown> = {
    threadId: CANNED_THREAD_ID,
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandbox: 'workspace-write',
    model: 'gpt-e1-model-a',
    cwd: W,
    ...overrides,
  };
  for (const key of drop) delete input[key];
  return B.threadResume(input as unknown as GovAICodexThreadResumeInput);
}

const EFFECTIVE: CannedEffectiveSettings = {
  model: 'gpt-e1-model-a',
  cwd: W,
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
  sandbox: cannedSandboxPolicy('workspaceWrite', [W]),
};

function r(settings: Partial<CannedEffectiveSettings> = {}, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return cannedThreadResumeResult({ ...EFFECTIVE, ...settings }, overrides);
}

function observed(response: unknown): ResumeObservation {
  return { kind: 'VALIDATED', validation: validateThreadResumeResponseStructure(response) };
}

function classify(
  pre: ThreadSafetyStateRecord | null,
  branchEvidence: BranchEvidence,
  request: ProtectedOperationRequest,
  observation: ResumeObservation,
): ResumeObservationClassification {
  return classifyResumeObservation({
    pre_operation_safety_state: pre,
    branch_evidence: branchEvidence,
    bound_request: request,
    observation,
    reconstruction_admission_ref: ADM,
  });
}

const knownCold = (request: ProtectedOperationRequest, response: unknown): ResumeObservationClassification =>
  classify(null, 'PRECONDITION_KNOWN_COLD', request, observed(response));
const unknownBranch = (request: ProtectedOperationRequest, response: unknown): ResumeObservationClassification =>
  classify(KSA, 'NONE', request, observed(response));

function comparison(c: ResumeObservationClassification, field: string): unknown {
  return c.evidence_projection.normalized_comparison_results?.find((x) => x.field === field);
}

// ---------------------------------------------------------------------------------------------------------------------

describe('the three dimensions — exact enums, three separate outputs', () => {
  it('BRANCH_EVIDENCE, BRANCH_KNOWLEDGE, CONFORMANCE_RESULT and THREAD_SAFETY_STATE have exactly the sealed values', () => {
    expect(BRANCH_EVIDENCE_VALUES).toEqual(['PRECONDITION_KNOWN_COLD', 'NONE']);
    expect(BRANCH_KNOWLEDGE_VALUES).toEqual(['KNOWN_COLD', 'UNKNOWN']);
    expect(CONFORMANCE_RESULTS).toEqual(['PASS', 'FAIL_DOWNSTREAM_REQUESTED_EFFECTIVE_MISMATCH', 'CHARACTERIZATION_ONLY', 'E1_INFRA_FAILURE']);
    expect(THREAD_SAFETY_STATES).toEqual(['KNOWN_SAFE_ACTIVE', 'SAFE_DISJUNCTION', 'RETIRED']);
  });

  it('returns new_safety_state, branch_knowledge (+ the cited evidence) and conformance_result as separate fields', () => {
    const c = unknownBranch(q(), r());
    expect(Object.keys(c).sort()).toEqual(['branch_evidence', 'branch_knowledge', 'conformance_result', 'evidence_projection', 'new_safety_state']);
    expect(c.evidence_projection).toMatchObject({
      post_operation_thread_safety_state: 'SAFE_DISJUNCTION',
      branch_knowledge: 'UNKNOWN',
      branch_evidence: 'NONE',
      conformance_result: 'CHARACTERIZATION_ONLY',
    });
    expect(Object.keys(c.evidence_projection)).not.toContain('classification');
  });
});

describe('CE-01..CE-08 through the classifier', () => {
  it('CE-01 serviceTier absent -> E1_INFRA_FAILURE (STRUCTURAL_FAILURE, key serviceTier), no comparison', () => {
    const response = r();
    delete response['serviceTier'];
    const c = knownCold(q(), response);
    expect(c.conformance_result).toBe('E1_INFRA_FAILURE');
    expect(c.evidence_projection).toMatchObject({
      structural_validation_status: 'STRUCTURAL_FAILURE',
      structural_failure_reason: 'REQUIRED_KEY_ABSENT',
      structural_failure_key: 'serviceTier',
      normalized_comparison_results: null,
      failure_enum: 'RESPONSE_STRUCTURAL_FAILURE',
    });
  });

  it('CE-02 serviceTier: null -> VALID; no entry in normalized_comparison_results', () => {
    const c = knownCold(q(), r({}, { serviceTier: null }));
    expect(c.conformance_result).toBe('PASS');
    expect(comparison(c, 'serviceTier')).toBeUndefined();
  });

  it('CE-03 modelProvider present, q has none -> VALID; no entry; PASS when all compared fields match (KNOWN_COLD)', () => {
    const c = knownCold(q(), r({}, { modelProvider: 'some-other-provider' }));
    expect(c.conformance_result).toBe('PASS');
    expect(comparison(c, 'modelProvider')).toBeUndefined();
    expect(c.evidence_projection.requested_conformance_field_names).toEqual(['model', 'cwd', 'approvalPolicy', 'approvalsReviewer', 'sandbox']);
  });

  it('CE-04 q.sandbox read-only; r {type readOnly, networkAccess false} -> sandbox MATCH', () => {
    const c = knownCold(q({ sandbox: 'read-only' }), r({ sandbox: cannedSandboxPolicy('readOnly') }));
    expect(comparison(c, 'sandbox')).toEqual({ field: 'sandbox', requested_normalized: 'readOnly', effective_normalized: 'readOnly', result: 'MATCH' });
    expect(c.conformance_result).toBe('PASS');
  });

  it('CE-05 q workspace-write; r workspaceWrite with other roots / network -> MATCH; roots never persisted', () => {
    const payload = { type: 'workspaceWrite', writableRoots: ['/Users/Shared/other-root-7c1d'], networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true };
    const c = knownCold(q({ sandbox: 'workspace-write' }), r({ sandbox: payload }));
    expect(comparison(c, 'sandbox')).toMatchObject({ requested_normalized: 'workspaceWrite', effective_normalized: 'workspaceWrite', result: 'MATCH' });
    expect(c.conformance_result).toBe('PASS');
    expect(c.evidence_projection.sandbox_effective_discriminator).toBe('workspaceWrite');
    expect(JSON.stringify(c.evidence_projection)).not.toContain('other-root-7c1d');
  });

  it('CE-06 q omits model; r.model "X" -> no model entry; no mismatch', () => {
    const c = knownCold(q({}, ['model']), r({ model: 'X' }));
    expect(comparison(c, 'model')).toBeUndefined();
    expect(c.conformance_result).toBe('PASS');
    expect(c.evidence_projection.requested_conformance_field_names).toEqual(['cwd', 'approvalPolicy', 'approvalsReviewer', 'sandbox']);
  });

  it('CE-07 instructionSources absent -> E1_INFRA_FAILURE; [] -> VALID; contents never persisted', () => {
    const response = r();
    delete response['instructionSources'];
    expect(knownCold(q(), response).conformance_result).toBe('E1_INFRA_FAILURE');
    const c = knownCold(q(), r({}, { instructionSources: ['/Users/Shared/secret-instructions-5e2f/AGENTS.md'] }));
    expect(c.conformance_result).toBe('PASS');
    expect(JSON.stringify(c.evidence_projection)).not.toContain('secret-instructions-5e2f');
  });

  it('CE-08 runtimeWorkspaceRoots absent, experimentalApi false -> VALID; marker UNOBSERVED', () => {
    const c = knownCold(q(), r());
    expect(c.evidence_projection.experimental_observation_markers).toEqual({
      runtimeWorkspaceRoots: 'UNOBSERVED',
      activePermissionProfile: 'UNOBSERVED',
      multiAgentMode: 'UNOBSERVED',
      initialTurnsPage: 'UNOBSERVED',
    });
  });
});

describe('T-13..T-19 — normalized comparison: explicit, total, exact', () => {
  it('T-13 q read-only, r workspaceWrite -> VALID + sandbox MISMATCH; KNOWN_COLD -> FAIL_DOWNSTREAM; UNKNOWN -> CHARACTERIZATION_ONLY', () => {
    const request = q({ sandbox: 'read-only' });
    const response = (): Record<string, unknown> => r({ sandbox: cannedSandboxPolicy('workspaceWrite', [W]) });
    expect(comparison(knownCold(request, response()), 'sandbox')).toMatchObject({ requested_normalized: 'readOnly', effective_normalized: 'workspaceWrite', result: 'MISMATCH' });
    expect(knownCold(request, response()).conformance_result).toBe('FAIL_DOWNSTREAM_REQUESTED_EFFECTIVE_MISMATCH');
    expect(unknownBranch(request, response()).conformance_result).toBe('CHARACTERIZATION_ONLY');
  });

  it('T-14 q workspace-write, r readOnly -> VALID + sandbox MISMATCH; same two classifications', () => {
    const request = q({ sandbox: 'workspace-write' });
    const response = (): Record<string, unknown> => r({ sandbox: cannedSandboxPolicy('readOnly') });
    expect(knownCold(request, response()).conformance_result).toBe('FAIL_DOWNSTREAM_REQUESTED_EFFECTIVE_MISMATCH');
    expect(unknownBranch(request, response()).conformance_result).toBe('CHARACTERIZATION_ONLY');
  });

  it('T-15 r sandbox dangerFullAccess / externalSandbox (well-formed) -> VALID structure + sandbox MISMATCH', () => {
    for (const type of ['dangerFullAccess', 'externalSandbox'] as const) {
      for (const mode of ['read-only', 'workspace-write'] as const) {
        const c = knownCold(q({ sandbox: mode }), r({ sandbox: cannedSandboxPolicy(type) }));
        expect(c.evidence_projection.structural_validation_status).toBe('VALID');
        expect(comparison(c, 'sandbox')).toMatchObject({ effective_normalized: type, result: 'MISMATCH' });
        expect(c.conformance_result).toBe('FAIL_DOWNSTREAM_REQUESTED_EFFECTIVE_MISMATCH');
      }
    }
  });

  it('T-16 a malformed SandboxPolicy -> E1_INFRA_FAILURE (never a mode mismatch)', () => {
    for (const sandbox of [{ type: 'hologram' }, { type: 'readOnly' }, 'read-only', { type: 'workspaceWrite', networkAccess: false }]) {
      const c = unknownBranch(q(), r({ sandbox }));
      expect(c.conformance_result, JSON.stringify(sandbox)).toBe('E1_INFRA_FAILURE');
      expect(c.evidence_projection.normalized_comparison_results).toBeNull();
    }
  });

  it('T-17 approvalPolicy "never" / other GovAI literal / granular -> VALID + MISMATCH; granular members never persisted', () => {
    const granular = { granular: { sandbox_approval: true, rules: true, skill_approval: false, request_permissions: true, mcp_elicitations: false } };
    for (const effective of ['never', 'untrusted', granular]) {
      const c = knownCold(q({ approvalPolicy: 'on-request' }), r({ approvalPolicy: effective }));
      expect(c.conformance_result, JSON.stringify(effective)).toBe('FAIL_DOWNSTREAM_REQUESTED_EFFECTIVE_MISMATCH');
      expect(comparison(c, 'approvalPolicy')).toMatchObject({
        requested_normalized: 'on-request',
        effective_normalized: typeof effective === 'string' ? effective : 'granular',
        result: 'MISMATCH',
      });
      expect(JSON.stringify(c.evidence_projection)).not.toContain('sandbox_approval');
    }
    expect(knownCold(q(), r({ approvalPolicy: { granular: {} } })).conformance_result).toBe('E1_INFRA_FAILURE');
  });

  it('T-18 approvalsReviewer "auto_review" / "guardian_subagent" -> VALID + MISMATCH; any other string -> failure', () => {
    for (const effective of ['auto_review', 'guardian_subagent']) {
      const c = knownCold(q(), r({ approvalsReviewer: effective }));
      expect(comparison(c, 'approvalsReviewer')).toEqual({ field: 'approvalsReviewer', requested_normalized: 'user', effective_normalized: effective, result: 'MISMATCH' });
      expect(c.conformance_result).toBe('FAIL_DOWNSTREAM_REQUESTED_EFFECTIVE_MISMATCH');
    }
    expect(knownCold(q(), r({ approvalsReviewer: 'root' })).conformance_result).toBe('E1_INFRA_FAILURE');
  });

  it('T-19 cwd differing by trailing slash / case / symlink-equivalent spelling -> MISMATCH (no normalization at comparison)', () => {
    for (const effective of [`${W}/`, W.toUpperCase(), '/private/Users/Shared/govai-e1-fixture/work', `${W}/.`]) {
      const c = knownCold(q({ cwd: W }), r({ cwd: effective }));
      expect(comparison(c, 'cwd'), effective).toEqual({ field: 'cwd', requested_normalized: W, effective_normalized: effective, result: 'MISMATCH' });
      expect(c.conformance_result).toBe('FAIL_DOWNSTREAM_REQUESTED_EFFECTIVE_MISMATCH');
    }
    expect(comparison(knownCold(q({ cwd: W }), r({ cwd: W })), 'cwd')).toMatchObject({ result: 'MATCH' });
  });

  it('compares model exactly (no alias, no trimming, no case folding, no provider substitution)', () => {
    for (const effective of ['GPT-E1-MODEL-A', ' gpt-e1-model-a', 'openai/gpt-e1-model-a']) {
      expect(comparison(knownCold(q(), r({ model: effective })), 'model')).toMatchObject({ result: 'MISMATCH' });
    }
  });
});

describe('T-20 / T-21 — experimental observables', () => {
  it('T-20 an experimental key present and well-typed -> VALID; OBSERVED_PRESENT; payload never persisted', () => {
    const c = knownCold(
      q(),
      r({}, {
        runtimeWorkspaceRoots: ['/Users/Shared/experimental-root-91aa'],
        activePermissionProfile: { id: 'profile-experimental-3b0e', extends: null },
        multiAgentMode: 'mode-experimental-44c2',
        initialTurnsPage: { data: [], nextCursor: 'cursor-experimental-0d5f', backwardsCursor: null },
      }),
    );
    expect(c.conformance_result).toBe('PASS');
    expect(c.evidence_projection.experimental_observation_markers).toEqual({
      runtimeWorkspaceRoots: 'OBSERVED_PRESENT',
      activePermissionProfile: 'OBSERVED_PRESENT',
      multiAgentMode: 'OBSERVED_PRESENT',
      initialTurnsPage: 'OBSERVED_PRESENT',
    });
    const persisted = JSON.stringify(c.evidence_projection);
    for (const sentinel of ['experimental-root-91aa', 'profile-experimental-3b0e', 'mode-experimental-44c2', 'cursor-experimental-0d5f']) {
      expect(persisted).not.toContain(sentinel);
    }
  });

  it('T-21 an experimental key present and ill-typed -> E1_INFRA_FAILURE', () => {
    for (const [key, value] of [
      ['runtimeWorkspaceRoots', 'x'],
      ['activePermissionProfile', 1],
      ['multiAgentMode', {}],
      ['initialTurnsPage', 'x'],
    ] as const) {
      expect(knownCold(q(), r({}, { [key]: value })).conformance_result, key).toBe('E1_INFRA_FAILURE');
    }
  });
});

describe('T-22 / T-23 — strict top level; structural failure precedes conformance', () => {
  it('T-22 an unknown top-level key -> E1_INFRA_FAILURE (UNKNOWN_TOP_LEVEL_KEY); its name is not persisted', () => {
    const c = unknownBranch(q(), r({}, { unexpectedKey9d41: true }));
    expect(c.conformance_result).toBe('E1_INFRA_FAILURE');
    expect(c.evidence_projection.structural_failure_reason).toBe('UNKNOWN_TOP_LEVEL_KEY');
    expect(c.evidence_projection.structural_failure_key).toBeNull();
    expect(JSON.stringify(c.evidence_projection)).not.toContain('unexpectedKey9d41');
  });

  it('T-23 a STRUCTURAL_FAILURE input never yields PASS / FAIL_DOWNSTREAM / CHARACTERIZATION_ONLY', () => {
    const failures: unknown[] = [null, 'x', r({}, { unexpected: 1 }), r({ model: 3 as unknown as string }), r({ sandbox: {} })];
    const withoutModel = r();
    delete withoutModel['model'];
    failures.push(withoutModel);
    for (const [label, pre] of PRE_STATES) {
      for (const evidence of BRANCH_EVIDENCE_VALUES) {
        for (const response of failures) {
          const c = classify(pre, evidence, q(), observed(response));
          expect(c.conformance_result, `${label}/${evidence}`).toBe('E1_INFRA_FAILURE');
          expect(c.evidence_projection.normalized_comparison_results).toBeNull();
        }
        for (const observation of [{ kind: 'RPC_ERROR' }, { kind: 'SEND_FAILED_AFTER_CONSUME' }] as const) {
          expect(classify(pre, evidence, q(), observation).conformance_result).toBe('E1_INFRA_FAILURE');
        }
      }
    }
  });

  it('accepts a VALID observation only if the structural validator issued it (it never re-validates)', () => {
    const forged: ResumeObservation = { kind: 'VALIDATED', validation: { status: 'VALID', validated: r() as never } };
    const c = classify(null, 'PRECONDITION_KNOWN_COLD', q(), forged);
    expect(c.conformance_result).toBe('E1_INFRA_FAILURE');
    expect(c.evidence_projection.failure_enum).toBe('OBSERVATION_NOT_ISSUED_BY_STRUCTURAL_VALIDATOR');
    expect(c.branch_knowledge).toBe('UNKNOWN');
  });
});

describe('T-25 — invariance: safety and branch outputs never depend on requested or effective values', () => {
  const ALLOWED = new Set(['pre_operation_safety_state', 'branch_evidence', 'operation_kind', 'structural_validity', 'reconstruction_admission_ref']);

  it('the safety and branch functions take one value-free input object (signature-enforced)', () => {
    expect(SAFETY_AND_BRANCH_INPUTS_ARE_VALUE_FREE).toBe(true);
    expect(computeNewSafetyState.length).toBe(1);
    expect(computeBranchKnowledge.length).toBe(1);
  });

  it('they never read anything but the five value-free inputs, even when requested/effective values are smuggled in', () => {
    for (const [, pre] of PRE_STATES) {
      for (const evidence of BRANCH_EVIDENCE_VALUES) {
        for (const validity of ['VALID', 'FAIL', 'NO_RESPONSE'] as const) {
          const read = new Set<string>();
          const target = {
            pre_operation_safety_state: pre,
            branch_evidence: evidence,
            operation_kind: 'thread/resume',
            structural_validity: validity,
            reconstruction_admission_ref: ADM,
            requested_values: q().params,
            effective_values: r(),
          };
          const spy = new Proxy(target, {
            get(t, key, receiver) {
              read.add(String(key));
              return Reflect.get(t, key, receiver);
            },
          }) as unknown as SafetyAndBranchInputs;
          computeNewSafetyState(spy);
          computeBranchKnowledge(spy);
          expect([...read].filter((k) => !ALLOWED.has(k))).toEqual([]);
        }
      }
    }
  });

  it('new_safety_state and branch_knowledge are unchanged under every variation of effective_values / requested_values', () => {
    const requests = [q(), q({ sandbox: 'read-only' }), q({ approvalPolicy: 'untrusted' }), q({}, ['model']), q({}, ['cwd']), q({ model: 'm2', cwd: W2 })];
    const responses = [
      r(),
      r({ sandbox: cannedSandboxPolicy('readOnly') }),
      r({ sandbox: cannedSandboxPolicy('dangerFullAccess') }),
      r({ approvalPolicy: 'never', approvalsReviewer: 'auto_review' }),
      r({ model: 'other', cwd: W2 }),
      r({}, { serviceTier: 'priority', reasoningEffort: 'high', runtimeWorkspaceRoots: ['/x'] }),
    ];
    for (const [label, pre] of PRE_STATES) {
      for (const evidence of BRANCH_EVIDENCE_VALUES) {
        const outputs = new Set<string>();
        for (const request of requests) {
          for (const response of responses) {
            const c = classify(pre, evidence, request, observed(response));
            outputs.add(JSON.stringify([c.new_safety_state, c.branch_knowledge, c.branch_evidence]));
          }
        }
        expect(outputs.size, `${label}/${evidence}`).toBe(1);
      }
    }
  });

  it('KNOWN-COLD BASIS: coldness is fixed before comparison — equality never creates it, inequality never removes it', () => {
    // effective == requested on a possibly-loaded resume: still UNKNOWN (never "cold because it matched").
    expect(unknownBranch(q(), r()).branch_knowledge).toBe('UNKNOWN');
    expect(unknownBranch(q(), r()).conformance_result).toBe('CHARACTERIZATION_ONLY');
    // effective == old on a known-cold resume: still KNOWN_COLD, judged downstream.
    const c = knownCold(q({ approvalPolicy: 'untrusted', sandbox: 'read-only' }), r());
    expect(c.branch_knowledge).toBe('KNOWN_COLD');
    expect(c.conformance_result).toBe('FAIL_DOWNSTREAM_REQUESTED_EFFECTIVE_MISMATCH');
  });
});

describe('T-26 — mixed / partial / single-field / multi-field discrepancies', () => {
  const request = q({ approvalPolicy: 'untrusted', sandbox: 'read-only', model: 'model-b', cwd: W2 });
  const cases: readonly (readonly [string, Partial<CannedEffectiveSettings>])[] = [
    ['single field', { approvalPolicy: 'on-request', sandbox: cannedSandboxPolicy('readOnly'), model: 'model-b', cwd: W2 }],
    ['partial application', { approvalPolicy: 'untrusted', sandbox: cannedSandboxPolicy('workspaceWrite', [W]), model: 'model-b', cwd: W }],
    ['mixed old / requested / other', { approvalPolicy: 'on-request', sandbox: cannedSandboxPolicy('readOnly'), model: 'model-c', cwd: W2 }],
    ['every field old', { approvalPolicy: 'on-request', sandbox: cannedSandboxPolicy('workspaceWrite', [W]), model: 'gpt-e1-model-a', cwd: W }],
  ];
  for (const [label, settings] of cases) {
    it(`${label}: KNOWN_COLD -> FAIL_DOWNSTREAM; UNKNOWN -> CHARACTERIZATION_ONLY; never E1_INFRA_FAILURE`, () => {
      expect(knownCold(request, r(settings)).conformance_result).toBe('FAIL_DOWNSTREAM_REQUESTED_EFFECTIVE_MISMATCH');
      for (const pre of [KSA, SD]) expect(classify(pre, 'NONE', request, observed(r(settings))).conformance_result).toBe('CHARACTERIZATION_ONLY');
    });
  }

  it('all requested fields equal: KNOWN_COLD -> PASS; UNKNOWN -> CHARACTERIZATION_ONLY (never PASS)', () => {
    const equal = r({ approvalPolicy: 'untrusted', sandbox: cannedSandboxPolicy('readOnly'), model: 'model-b', cwd: W2 });
    expect(knownCold(request, equal).conformance_result).toBe('PASS');
    expect(unknownBranch(request, r({ approvalPolicy: 'untrusted', sandbox: cannedSandboxPolicy('readOnly'), model: 'model-b', cwd: W2 })).conformance_result).toBe(
      'CHARACTERIZATION_ONLY',
    );
  });
});

describe('Correction 10 section 13 — the decision table is total over pre state x branch evidence x validity', () => {
  const observations: readonly (readonly [string, () => ResumeObservation])[] = [
    ['VALID', () => observed(r())],
    ['STRUCTURAL_FAILURE', () => observed(r({}, { unexpected: true }))],
    ['RPC_ERROR', () => ({ kind: 'RPC_ERROR' })],
    ['NO_RESPONSE', () => ({ kind: 'SEND_FAILED_AFTER_CONSUME' })],
  ];

  it('KNOWN_SAFE_ACTIVE | SAFE_DISJUNCTION + NONE -> SAFE_DISJUNCTION (lineage +1), UNKNOWN; valid -> CHARACTERIZATION_ONLY, else E1', () => {
    for (const pre of [KSA, SD]) {
      for (const [label, make] of observations) {
        const c = classify(pre, 'NONE', q(), make());
        expect(c.new_safety_state.transition, label).toBe('SAFE_DISJUNCTION');
        const lineage = c.new_safety_state.transition === 'SAFE_DISJUNCTION' ? c.new_safety_state.safetyLineageRefs : [];
        expect(lineage).toEqual(pre === KSA ? [KSA.THREAD_SAFETY_STATE_ID, ADM] : [...(SD.state === 'SAFE_DISJUNCTION' ? SD.safety_lineage_refs : []), ADM]);
        expect(c.branch_knowledge).toBe('UNKNOWN');
        expect(c.conformance_result).toBe(label === 'VALID' ? 'CHARACTERIZATION_ONLY' : 'E1_INFRA_FAILURE');
      }
    }
  });

  it('ABSENT | RETIRED + PRECONDITION_KNOWN_COLD: valid -> KNOWN_SAFE_ACTIVE(new), KNOWN_COLD; failed -> SAFE_DISJUNCTION, UNKNOWN, E1', () => {
    for (const pre of [null, RETIRED]) {
      for (const [label, make] of observations) {
        const c = classify(pre, 'PRECONDITION_KNOWN_COLD', q(), make());
        if (label === 'VALID') {
          expect(c.new_safety_state).toEqual({ transition: 'KNOWN_SAFE_ACTIVE', event: { kind: 'ADMITTED_KNOWN_COLD_RESUME_SUCCESS', reconstructionAdmissionRef: ADM } });
          expect(c.branch_knowledge).toBe('KNOWN_COLD');
          expect(c.conformance_result).toBe('PASS');
        } else {
          expect(c.new_safety_state.transition, label).toBe('SAFE_DISJUNCTION');
          expect(c.branch_knowledge).toBe('UNKNOWN');
          expect(c.conformance_result).toBe('E1_INFRA_FAILURE');
        }
        expect(c.branch_evidence).toBe('PRECONDITION_KNOWN_COLD');
      }
    }
  });

  it('ABSENT | RETIRED + NONE -> the MISSING_SESSION_PROVENANCE row: no transition, E1_INFRA_FAILURE, never cold', () => {
    for (const pre of [null, RETIRED]) {
      for (const [, make] of observations) {
        const c = classify(pre, 'NONE', q(), make());
        expect(c.new_safety_state).toEqual({ transition: 'NONE_NO_SEND_ROW', unchanged: pre === null ? 'ABSENT' : 'RETIRED' });
        expect(c.branch_knowledge).toBe('UNKNOWN');
        expect(c.conformance_result).toBe('E1_INFRA_FAILURE');
        expect(c.evidence_projection.failure_enum).toBe('MISSING_SESSION_PROVENANCE');
      }
    }
  });

  it('KNOWN_SAFE_ACTIVE | SAFE_DISJUNCTION + PRECONDITION_KNOWN_COLD -> the REGISTRY CONTRADICTION row: no transition, E1', () => {
    for (const pre of [KSA, SD]) {
      for (const [, make] of observations) {
        const c = classify(pre, 'PRECONDITION_KNOWN_COLD', q(), make());
        expect(c.new_safety_state).toEqual({ transition: 'NONE_NO_SEND_ROW', unchanged: pre.state });
        expect(c.branch_knowledge).toBe('UNKNOWN');
        expect(c.conformance_result).toBe('E1_INFRA_FAILURE');
        expect(c.evidence_projection.failure_enum).toBe('REGISTRY_CONTRADICTION');
      }
    }
  });

  it('is deterministic: the same inputs give byte-identical outputs', () => {
    for (const [, pre] of PRE_STATES) {
      for (const evidence of BRANCH_EVIDENCE_VALUES) {
        const a = classify(pre, evidence, q(), observed(r()));
        const b = classify(pre, evidence, q(), observed(r()));
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
    }
  });

  it('treats a bound request outside the governed domain as a harness binding contradiction (E1), never a mismatch', () => {
    const forged = Object.freeze({
      method: 'thread/resume',
      params: Object.freeze({ threadId: 't', approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'read-only' }),
    }) as unknown as ProtectedOperationRequest;
    const c = knownCold(forged, r());
    expect(c.conformance_result).toBe('E1_INFRA_FAILURE');
    expect(c.evidence_projection.failure_enum).toBe('BOUND_REQUEST_OUTSIDE_GOVERNED_DOMAIN');
  });
});

describe('C13-R3-G / C13-R3-H — two-class invariance law', () => {
  const variationsA = (): Record<string, unknown>[] => [
    r(),
    r({}, { thread: cannedStockThread({ cwd: W, model: 'gpt-e1-model-a' }) }),
    r({}, { thread: cannedStockThread({ cwd: W, model: 'gpt-e1-model-a', environments: [], extra: {}, canAcceptDirectInput: true, daybreakEnabled: false }) }),
    r({}, { thread: cannedStockThread({ cwd: W, model: 'gpt-e1-model-a', unexpected: true }) }),
  ];

  it('C13-R3-G CLASS A (valid, identity-preserving nested variations): every output identical; nothing nested persisted', () => {
    for (const [label, pre] of PRE_STATES) {
      for (const evidence of BRANCH_EVIDENCE_VALUES) {
        const outputs = variationsA().map((response) => {
          const c = classify(pre, evidence, q(), observed(response));
          expect(c.evidence_projection.structural_validation_status).toBe('VALID');
          return JSON.stringify([
            c.new_safety_state,
            c.branch_knowledge,
            c.evidence_projection.requested_conformance_field_names,
            c.evidence_projection.normalized_comparison_results,
            c.conformance_result,
          ]);
        });
        expect(new Set(outputs).size, `${label}/${evidence}`).toBe(1);
      }
    }
    const persisted = JSON.stringify(classify(KSA, 'NONE', q(), observed(variationsA()[3])).evidence_projection);
    for (const nested of ['unexpected', 'environments', 'daybreakEnabled', CANNED_THREAD_ID]) expect(persisted).not.toContain(nested);
  });

  it('C13-R3-H CLASS B (invalid variations R3-B, R3-C, R3-D, R3-F): the section 13 FAIL row, no comparison produced or invented', () => {
    const missingId = cannedStockThread({ cwd: W });
    delete missingId['id'];
    const variationsB: readonly (readonly [string, Record<string, unknown>])[] = [
      ['R3-B', r({}, { thread: missingId })],
      ['R3-C', r({}, { thread: cannedStockThread({ cwd: W, createdAt: 'x' }) })],
      ['R3-D', r({}, { unexpected: true })],
      ['R3-F', r({}, { thread: cannedStockThread({ cwd: W, source: { custom: 'audit', unexpected: true } }) })],
    ];
    for (const [label, response] of variationsB) {
      for (const pre of [KSA, SD]) {
        const c = classify(pre, 'NONE', q(), observed(response));
        expect(c.conformance_result, label).toBe('E1_INFRA_FAILURE');
        expect(c.new_safety_state.transition).toBe('SAFE_DISJUNCTION');
        expect(c.branch_knowledge).toBe('UNKNOWN');
        expect(c.evidence_projection.normalized_comparison_results).toBeNull();
        expect(c.evidence_projection.failure_enum).toBe('RESPONSE_STRUCTURAL_FAILURE');
      }
      const cold = classify(null, 'PRECONDITION_KNOWN_COLD', q(), observed(response));
      expect(cold.new_safety_state.transition).toBe('SAFE_DISJUNCTION');
      expect(cold.branch_knowledge).toBe('UNKNOWN');
      expect(cold.conformance_result).toBe('E1_INFRA_FAILURE');
    }
  });
});

describe('T-27 — the carried Correction 10 section 18 rows over live registries', () => {
  const T = CANNED_THREAD_ID;
  const ref = { logical_thread_id: T, process_generation: 1, binary_identity: 'bin' };
  const admission = (n: number) => ({ OPERATION_ADMISSION_ID: `operation-admission:g1:${n}`, v1: false as const, v2: false as const, FEATURE_CONTEXT_BINDING: `feature-context:g1:${n}`, status: 'CONSUMED' as const });

  function startedRegistry(): ThreadSafetyStateRegistry {
    const registry = new ThreadSafetyStateRegistry(new RuntimeProvenanceRegistry(() => 0), () => 0);
    registry.recordAdmittedStart(ref, admission(1));
    return registry;
  }

  function resume(registry: ThreadSafetyStateRegistry, n: number, request: ProtectedOperationRequest, response: unknown): ResumeObservationClassification {
    const c = classifyResumeObservation({
      pre_operation_safety_state: registry.current(ref),
      branch_evidence: 'NONE',
      bound_request: request,
      observation: observed(response),
      reconstruction_admission_ref: `operation-admission:g1:${n}`,
    });
    registry.applyResumeDecision(ref, admission(n), c.new_safety_state);
    return c;
  }

  it('RECURSIVE AMBIGUITY: previous / current / original matches all stay SAFE_DISJUNCTION, UNKNOWN, CHARACTERIZATION_ONLY', () => {
    const registry = startedRegistry();
    // R1 requests WS_B / read-only, evidence NONE.
    const r1 = resume(registry, 2, q({ cwd: W2, sandbox: 'read-only' }), r({ cwd: W2, sandbox: cannedSandboxPolicy('readOnly') }));
    expect([r1.new_safety_state.transition, r1.branch_knowledge, r1.conformance_result]).toEqual(['SAFE_DISJUNCTION', 'UNKNOWN', 'CHARACTERIZATION_ONLY']);
    const lineage1 = registry.current(ref);
    // R2 requests WS_C; the response matches the PREVIOUS request (WS_B).
    const r2 = resume(registry, 3, q({ cwd: '/Users/Shared/govai-e1-fixture/work-c' }), r({ cwd: W2, sandbox: cannedSandboxPolicy('readOnly') }));
    expect([r2.new_safety_state.transition, r2.branch_knowledge, r2.conformance_result]).toEqual(['SAFE_DISJUNCTION', 'UNKNOWN', 'CHARACTERIZATION_ONLY']);
    // R3: the response matches the CURRENT request -> UNKNOWN, not a cold PASS.
    const r3 = resume(registry, 4, q({ cwd: W2, sandbox: 'read-only' }), r({ cwd: W2, sandbox: cannedSandboxPolicy('readOnly') }));
    expect([r3.branch_knowledge, r3.conformance_result]).toEqual(['UNKNOWN', 'CHARACTERIZATION_ONLY']);
    // R4: the response matches the ORIGINAL historical context -> UNKNOWN, not a loaded confirmation.
    const r4 = resume(registry, 5, q({ cwd: W2, sandbox: 'read-only' }), r());
    expect([r4.branch_knowledge, r4.conformance_result]).toEqual(['UNKNOWN', 'CHARACTERIZATION_ONLY']);
    // Lineage grows by exactly one admission per resume and names proofs, not runtimes.
    const history = registry.historyOf(T).filter((x) => x.state === 'SAFE_DISJUNCTION');
    expect(history.map((x) => (x.state === 'SAFE_DISJUNCTION' ? x.safety_lineage_refs.length : 0))).toEqual([2, 3, 4, 5]);
    expect(lineage1?.state === 'SAFE_DISJUNCTION' ? lineage1.safety_lineage_refs[0] : '').toBe('thread-safety-state:1');
    const current = registry.current(ref)!;
    expect(current.state).toBe('SAFE_DISJUNCTION');
    expect(Object.keys(current)).not.toContain('runtime_provenance_id');
    expect(Object.keys(current)).not.toContain('HARNESS_RUNTIME_INCARNATION_ID');
  });

  it('SAME-SETTINGS AMBIGUITY: identical settings -> SAFE_DISJUNCTION, UNKNOWN, CHARACTERIZATION_ONLY; old provenance HISTORICAL', () => {
    const registry = startedRegistry();
    const c1 = resume(registry, 2, q(), r());
    expect([c1.new_safety_state.transition, c1.branch_knowledge, c1.conformance_result]).toEqual(['SAFE_DISJUNCTION', 'UNKNOWN', 'CHARACTERIZATION_ONLY']);
    const c2 = resume(registry, 3, q({ approvalPolicy: 'untrusted' }), r());
    expect([c2.new_safety_state.transition, c2.branch_knowledge, c2.conformance_result]).toEqual(['SAFE_DISJUNCTION', 'UNKNOWN', 'CHARACTERIZATION_ONLY']);
    expect(registry.provenance.recordsOfThread(T).map((x) => x.status)).toEqual(['HISTORICAL']);
  });

  it('E1_INFRA_FAILURE is narrow: mixed values, unknown branch, or an earlier request match alone are NOT infrastructure failure', () => {
    const request = q({ cwd: W2, approvalPolicy: 'untrusted' });
    for (const response of [r({ cwd: W2 }), r(), r({ cwd: W2, approvalPolicy: 'untrusted' })]) {
      for (const pre of [KSA, SD]) expect(classify(pre, 'NONE', request, observed(response)).conformance_result).not.toBe('E1_INFRA_FAILURE');
      expect(knownCold(request, response).conformance_result).not.toBe('E1_INFRA_FAILURE');
    }
  });
});
