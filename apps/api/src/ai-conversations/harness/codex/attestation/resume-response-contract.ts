// CONT-P5-E1 — the thread/resume FIELD CONTRACT (Dispatch v8 M7c; Correction 11 sections 4-21).
//
// ONE frozen table is the single source of truth for the resume response contract. It encodes
// FIELD_CONTRACT_TABLE_C11 row by row (the dispatch's section 2 block is the normative text) plus the
// NORMALIZATION_RULES of Correction 11 section 13. The structural validator (resume-structural-validator.ts) derives
// requiredness from it, and the observation classifier (resume-observation-classifier.ts) derives the comparison
// domain from it. No other module keeps an independent field list.
//
// ★ FOUR LAYERS, KEPT APART (Correction 11 section 4):
//   A. RESPONSE_STRUCTURAL_REQUIRED_FIELDS     — keys a structurally valid non-experimental response must carry
//   B. REQUESTED_CONFORMANCE_FIELDS(q)         — compared for ONE exact bound request q, by key presence in q
//   C. EXPERIMENTAL_OPTIONAL_OBSERVABLE_FIELDS — experimental keys that may be absent (UNOBSERVED) or present
//   D. NORMALIZATION_RULES                     — the explicit equivalence function per compared field
// ★ NULLABLE IS NOT OPTIONAL. A nullable required key must be PRESENT; `null` is a valid value, absence is not.
// ★ NO ADHOC NORMALIZATION. Identity for model / cwd / approvalPolicy / approvalsReviewer; the sandbox mode
//   projection is the only mapping. There is no alias, case folding, trimming, separator normalization, symlink
//   resolution, provider substitution or default inference anywhere in the comparison path.

import type { ThreadResumeResponse } from '../protocol/generated/v2/ThreadResumeResponse';
import {
  isGovAIAllowedApprovalPolicy,
  isGovAIAllowedApprovalsReviewer,
  isGovAIAllowedSandboxMode,
} from '../protocol/govai-policy.js';

type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export type FieldConformanceRole = 'COMPARE' | 'STRUCTURAL_ONLY' | 'EXPERIMENTAL_OBSERVE';
export type FieldNormalizationRule = 'identity' | 'identity_in_INV_PATH_domain' | 'mode_projection';

/** One row of FIELD_CONTRACT_TABLE_C11. A `-` cell of the sealed table is an ABSENT optional property here. */
export type FieldContractRow = {
  readonly responseKey: string;
  readonly structuralRequired: boolean;
  readonly nullable: boolean;
  readonly experimental: boolean;
  readonly requestKey?: string;
  readonly requestedOnlyIfPresent?: boolean;
  readonly normalize?: FieldNormalizationRule;
  readonly conformanceRole: FieldConformanceRole;
  readonly evidenceRole: string;
};

const TABLE = [
  {
    responseKey: 'thread',
    structuralRequired: true,
    nullable: false,
    experimental: false,
    conformanceRole: 'STRUCTURAL_ONLY',
    evidenceRole: 'STRUCTURAL_STATUS (+ carried correlation status)',
  },
  {
    responseKey: 'model',
    structuralRequired: true,
    nullable: false,
    experimental: false,
    requestKey: 'model',
    requestedOnlyIfPresent: true,
    normalize: 'identity',
    conformanceRole: 'COMPARE',
    evidenceRole: 'REQUESTED_VS_EFFECTIVE_WHEN_COMPARED',
  },
  {
    responseKey: 'modelProvider',
    structuralRequired: true,
    nullable: false,
    experimental: false,
    conformanceRole: 'STRUCTURAL_ONLY',
    evidenceRole: 'STRUCTURAL_STATUS',
  },
  {
    responseKey: 'serviceTier',
    structuralRequired: true,
    nullable: true,
    experimental: false,
    conformanceRole: 'STRUCTURAL_ONLY',
    evidenceRole: 'STRUCTURAL_STATUS',
  },
  {
    responseKey: 'cwd',
    structuralRequired: true,
    nullable: false,
    experimental: false,
    requestKey: 'cwd',
    requestedOnlyIfPresent: true,
    normalize: 'identity_in_INV_PATH_domain',
    conformanceRole: 'COMPARE',
    evidenceRole: 'REQUESTED_VS_EFFECTIVE_WHEN_COMPARED',
  },
  {
    responseKey: 'instructionSources',
    structuralRequired: true,
    nullable: false,
    experimental: false,
    conformanceRole: 'STRUCTURAL_ONLY',
    evidenceRole: 'STRUCTURAL_STATUS (contents never persisted)',
  },
  {
    responseKey: 'approvalPolicy',
    structuralRequired: true,
    nullable: false,
    experimental: false,
    requestKey: 'approvalPolicy',
    requestedOnlyIfPresent: false,
    normalize: 'identity',
    conformanceRole: 'COMPARE',
    evidenceRole: 'REQUESTED_VS_EFFECTIVE (discriminator only if granular)',
  },
  {
    responseKey: 'approvalsReviewer',
    structuralRequired: true,
    nullable: false,
    experimental: false,
    requestKey: 'approvalsReviewer',
    requestedOnlyIfPresent: false,
    normalize: 'identity',
    conformanceRole: 'COMPARE',
    evidenceRole: 'REQUESTED_VS_EFFECTIVE',
  },
  {
    responseKey: 'sandbox',
    structuralRequired: true,
    nullable: false,
    experimental: false,
    requestKey: 'sandbox',
    requestedOnlyIfPresent: false,
    normalize: 'mode_projection',
    conformanceRole: 'COMPARE',
    evidenceRole: 'REQUESTED_MODE_VS_EFFECTIVE_DISCRIMINATOR (payload never persisted)',
  },
  {
    responseKey: 'reasoningEffort',
    structuralRequired: true,
    nullable: true,
    experimental: false,
    conformanceRole: 'STRUCTURAL_ONLY',
    evidenceRole: 'STRUCTURAL_STATUS',
  },
  {
    responseKey: 'turnsBackwardsCursor',
    structuralRequired: true,
    nullable: true,
    experimental: false,
    conformanceRole: 'STRUCTURAL_ONLY',
    evidenceRole: 'STRUCTURAL_STATUS (content never persisted)',
  },
  {
    responseKey: 'itemsBackwardsCursor',
    structuralRequired: true,
    nullable: true,
    experimental: false,
    conformanceRole: 'STRUCTURAL_ONLY',
    evidenceRole: 'STRUCTURAL_STATUS (content never persisted)',
  },
  {
    responseKey: 'runtimeWorkspaceRoots',
    structuralRequired: false,
    nullable: false,
    experimental: true,
    conformanceRole: 'EXPERIMENTAL_OBSERVE',
    evidenceRole: 'UNOBSERVED | OBSERVED_PRESENT (content never persisted)',
  },
  {
    responseKey: 'activePermissionProfile',
    structuralRequired: false,
    nullable: true,
    experimental: true,
    conformanceRole: 'EXPERIMENTAL_OBSERVE',
    evidenceRole: 'UNOBSERVED | OBSERVED_PRESENT (content never persisted)',
  },
  {
    responseKey: 'multiAgentMode',
    structuralRequired: false,
    nullable: false,
    experimental: true,
    conformanceRole: 'EXPERIMENTAL_OBSERVE',
    evidenceRole: 'UNOBSERVED | OBSERVED_PRESENT (content never persisted)',
  },
  {
    responseKey: 'initialTurnsPage',
    structuralRequired: false,
    nullable: true,
    experimental: true,
    conformanceRole: 'EXPERIMENTAL_OBSERVE',
    evidenceRole: 'UNOBSERVED | OBSERVED_PRESENT (content never persisted)',
  },
] as const satisfies readonly FieldContractRow[];

type TableRow = (typeof TABLE)[number];

/** Correction 11 section 21, as ONE frozen, exported, readonly table (16 rows: 12 Layer A + 4 Layer C). */
export const FIELD_CONTRACT_TABLE_C11: readonly FieldContractRow[] = Object.freeze(
  TABLE.map((row) => Object.freeze({ ...row }) as FieldContractRow),
);

// ---------------------------------------------------------------------------------------------------------
// Derived constants — computed from the table, never hand-listed
// ---------------------------------------------------------------------------------------------------------

function keysWhere(predicate: (row: FieldContractRow) => boolean): readonly string[] {
  return Object.freeze(FIELD_CONTRACT_TABLE_C11.filter(predicate).map((row) => row.responseKey));
}

/** Layer A: the twelve keys a structurally valid non-experimental ThreadResumeResponse carries. */
export const RESPONSE_STRUCTURAL_REQUIRED_FIELDS = keysWhere((row) => row.structuralRequired);

/** Layer A, the nullable subset: key REQUIRED, value may be null (never UNOBSERVED when absent). */
export const RESPONSE_NULLABLE_REQUIRED_FIELDS = keysWhere((row) => row.structuralRequired && row.nullable);

/** Layer C: experimental-gated keys; absent -> UNOBSERVED, present -> type-validated; never compared or persisted. */
export const EXPERIMENTAL_OPTIONAL_OBSERVABLE_FIELDS = keysWhere((row) => row.experimental);

/** The COMPARE key set (Layer B's universe). */
export const COMPARE_FIELDS = keysWhere((row) => row.conformanceRole === 'COMPARE');

/** Every known top-level key of a ThreadResumeResponse: the 12 Layer A keys + the 4 Layer C keys, nothing else. */
export const KNOWN_TOP_LEVEL_RESPONSE_KEYS = keysWhere(() => true);

/** The row of one response key, or `undefined` for a key outside the contract. */
export function fieldContractRow(responseKey: string): FieldContractRow | undefined {
  return FIELD_CONTRACT_TABLE_C11.find((row) => row.responseKey === responseKey);
}

// Compile-time ties to the GENERATED non-experimental response type (an upstream rename breaks the build, not
// policy): the table's required keys are exactly `keyof ThreadResumeResponse`, and its nullable required keys are
// exactly the generated keys whose type admits `null`.
type TableRequiredKeys = Extract<TableRow, { readonly structuralRequired: true }>['responseKey'];
type TableNullableRequiredKeys = Extract<TableRow, { readonly structuralRequired: true; readonly nullable: true }>['responseKey'];
type GeneratedNullableKeys = {
  [K in keyof ThreadResumeResponse]-?: null extends ThreadResumeResponse[K] ? K : never;
}[keyof ThreadResumeResponse];

export const FIELD_CONTRACT_REQUIRED_KEYS_ARE_GENERATED: Exactly<TableRequiredKeys, keyof ThreadResumeResponse> = true;
export const FIELD_CONTRACT_NULLABLE_KEYS_ARE_GENERATED: Exactly<TableNullableRequiredKeys, GeneratedNullableKeys> = true;

// ---------------------------------------------------------------------------------------------------------
// Layer B — REQUESTED_CONFORMANCE_FIELDS(q), total over key presence in the exact bound request
// ---------------------------------------------------------------------------------------------------------

/**
 * Correction 11 section 9: `{approvalPolicy, approvalsReviewer, sandbox} U {model iff q has model} U {cwd iff q has
 * cwd}`, in table order. Membership is decided by KEY PRESENCE in the bound request object only — never by value,
 * never by defaults, never by the response.
 */
export function requestedConformanceFields(q: object): readonly string[] {
  return Object.freeze(
    FIELD_CONTRACT_TABLE_C11.filter(
      (row) =>
        row.conformanceRole === 'COMPARE' &&
        row.requestKey !== undefined &&
        (row.requestedOnlyIfPresent !== true || Object.hasOwn(q, row.requestKey)),
    ).map((row) => row.responseKey),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Layer D — NORMALIZATION_RULES (Correction 11 section 13)
// ---------------------------------------------------------------------------------------------------------

/** mode_projection: request SandboxMode string -> effective SandboxPolicy discriminator (`sandbox.type`). */
export const SANDBOX_MODE_PROJECTION = Object.freeze({
  'read-only': 'readOnly',
  'workspace-write': 'workspaceWrite',
} as const);

export const NORMALIZATION_RULES = Object.freeze({
  model: 'identity',
  cwd: 'identity_in_INV_PATH_domain',
  approvalPolicy: 'identity',
  approvalsReviewer: 'identity',
  sandbox: SANDBOX_MODE_PROJECTION,
} as const);

/** Every COMPARE row's normalize cell agrees with NORMALIZATION_RULES (checked at compile time). */
export const NORMALIZATION_RULES_COVER_COMPARE_FIELDS: Exactly<
  Extract<TableRow, { readonly conformanceRole: 'COMPARE' }>['responseKey'],
  keyof typeof NORMALIZATION_RULES
> = true;

/**
 * The normalized REQUESTED value of one compared field over the GovAI requestable domain of Correction 11 section 8
 * (the frozen resume policy of ../protocol/govai-policy.ts), or `null` when the bound value lies outside it — a
 * harness binding contradiction, never a conformance observation. cwd is compared as given: INV-PATH is the only
 * cwd normalization and it runs at admission (fixture-invariants.ts), never here.
 */
export function normalizeRequestedValue(field: string, value: unknown): string | null {
  switch (field) {
    case 'sandbox':
      return isGovAIAllowedSandboxMode(value) ? SANDBOX_MODE_PROJECTION[value] : null;
    case 'approvalPolicy':
      return isGovAIAllowedApprovalPolicy(value) ? value : null;
    case 'approvalsReviewer':
      return isGovAIAllowedApprovalsReviewer(value) ? value : null;
    case 'model':
    case 'cwd':
      return typeof value === 'string' && value.length > 0 ? value : null;
    default:
      return null;
  }
}
