// CONT-P5-E1 — STEP 1 of the resume observation: STRUCTURAL validation of a thread/resume result (Dispatch v8 M7c;
// Correction 11 sections 5-7, 11-12, 14, 19; Correction 13 section 6).
//
// ★ REQUIREDNESS COMES FROM THE TABLE ONLY (resume-response-contract.ts). This validator takes NO request parameter:
//   what the request happened to set never changes what a structurally valid response must carry.
// ★ TOP LEVEL IS STRICT. Known keys = the 12 Layer A keys + the 4 Layer C keys; any other top-level key is
//   STRUCTURAL_FAILURE(UNKNOWN_TOP_LEVEL_KEY, key). A Layer A key that is absent is a failure even when its value may
//   be null (NULLABLE IS NOT OPTIONAL); a Layer C key that is absent is valid (UNOBSERVED); a present Layer C key is
//   type-checked against the pinned shape and never persisted.
// ★ NESTED THREAD = PINNED SCHEMA, NODE-LOCAL. `thread` is checked by exactly ONE call into the baseline
//   ../protocol/json-schema-subset.ts against the vendored bundle definition `#/definitions/v2/Thread`. Every node
//   decides for itself: a node that closes itself rejects an unknown member, an open node accepts it, and a node
//   with a member schema validates it. The Thread root node is open, so the direct experimental members the stock
//   pin serializes on every Thread are accepted; the closed descendants the bundle carries stay closed. Nothing here
//   edits, bypasses or re-declares the pinned schema, and no nested key list or nested requiredness is written by
//   hand. Nested values never reach conformance, branch knowledge or evidence.
// ★ The result is FROZEN and registered: the observation classifier accepts a VALID result only if it came from
//   this validator, and never re-validates it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ApprovalsReviewer } from '../protocol/generated/v2/ApprovalsReviewer';
import type { AskForApproval } from '../protocol/generated/v2/AskForApproval';
import type { NetworkAccess } from '../protocol/generated/v2/NetworkAccess';
import type { SandboxPolicy } from '../protocol/generated/v2/SandboxPolicy';
import { resolvePointer, validateAgainstSchema } from '../protocol/json-schema-subset.js';
import { HARNESS_CODEX_DIR } from '../protocol/vendored-schema.js';
import { FIELD_CONTRACT_TABLE_C11, KNOWN_TOP_LEVEL_RESPONSE_KEYS, type FieldContractRow } from './resume-response-contract.js';

type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/** The vendored, pinned JSON schema bundle (byte-bound by ../pin/MANIFEST.sha256). Read once, never modified. */
const PINNED_BUNDLE: unknown = JSON.parse(
  readFileSync(join(HARNESS_CODEX_DIR, 'pin', 'vendor', 'json', 'codex_app_server_protocol.schemas.json'), 'utf8'),
);

// Top-level value domains of the pinned wire (Correction 11 SF-C / SF-D), tied to the generated types at compile time.
const APPROVAL_POLICY_LITERALS = ['untrusted', 'on-request', 'never'] as const;
const APPROVALS_REVIEWER_LITERALS = ['user', 'auto_review', 'guardian_subagent'] as const;
const SANDBOX_POLICY_TYPES = ['dangerFullAccess', 'readOnly', 'externalSandbox', 'workspaceWrite'] as const;
const EXTERNAL_SANDBOX_NETWORK_ACCESS = ['restricted', 'enabled'] as const;
const GRANULAR_APPROVAL_MEMBERS = ['sandbox_approval', 'rules', 'skill_approval', 'request_permissions', 'mcp_elicitations'] as const;

export const RESUME_VALUE_DOMAINS_ARE_GENERATED: [
  Exactly<(typeof APPROVAL_POLICY_LITERALS)[number], Extract<AskForApproval, string>>,
  Exactly<(typeof APPROVALS_REVIEWER_LITERALS)[number], ApprovalsReviewer>,
  Exactly<(typeof SANDBOX_POLICY_TYPES)[number], SandboxPolicy['type']>,
  Exactly<(typeof EXTERNAL_SANDBOX_NETWORK_ACCESS)[number], NetworkAccess>,
] = [true, true, true, true];

export const RESUME_STRUCTURAL_FAILURE_REASONS = [
  'RESPONSE_NOT_AN_OBJECT',
  'UNKNOWN_TOP_LEVEL_KEY',
  'REQUIRED_KEY_ABSENT',
  'NULL_IN_NON_NULLABLE_FIELD',
  'WRONG_TYPE',
  'INVALID_ENUM_OR_DISCRIMINATOR',
  'INVALID_VARIANT_PAYLOAD',
  'THREAD_PINNED_SCHEMA_VIOLATION',
  'EXPERIMENTAL_FIELD_ILL_TYPED',
] as const;

export type ResumeStructuralFailureReason = (typeof RESUME_STRUCTURAL_FAILURE_REASONS)[number];

declare const VALIDATED: unique symbol;

/** A thread/resume result that passed STEP 1. Deep-frozen; only this module produces it. */
export type ValidatedThreadResumeResponse = Readonly<Record<string, unknown>> & { readonly [VALIDATED]: true };

export type ResumeStructuralValidation =
  | { readonly status: 'VALID'; readonly validated: ValidatedThreadResumeResponse }
  | { readonly status: 'STRUCTURAL_FAILURE'; readonly reason: ResumeStructuralFailureReason; readonly key: string };

const ISSUED_RESULTS = new WeakSet<object>();

/** True only for a result object this validator returned (the classifier's authenticity check, not a re-validation). */
export function isIssuedByResumeStructuralValidator(result: unknown): result is ResumeStructuralValidation {
  return typeof result === 'object' && result !== null && ISSUED_RESULTS.has(result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function includes(list: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && list.includes(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

function issue(result: ResumeStructuralValidation): ResumeStructuralValidation {
  Object.freeze(result);
  ISSUED_RESULTS.add(result);
  return result;
}

function failure(reason: ResumeStructuralFailureReason, key: string): ResumeStructuralValidation {
  return issue({ status: 'STRUCTURAL_FAILURE', reason, key });
}

/** Correction 11 section 16: exactly one key `granular` whose value carries the five boolean members. */
function isWellFormedGranularApproval(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'granular') return false;
  const granular = value['granular'];
  return isRecord(granular) && GRANULAR_APPROVAL_MEMBERS.every((m) => typeof granular[m] === 'boolean');
}

/** Correction 11 section 14: the tagged SandboxPolicy with the variant-required payload members. */
function sandboxFailure(value: unknown): ResumeStructuralFailureReason | null {
  if (!isRecord(value)) return 'WRONG_TYPE';
  const type = value['type'];
  if (!includes(SANDBOX_POLICY_TYPES, type)) return 'INVALID_ENUM_OR_DISCRIMINATOR';
  switch (type) {
    case 'readOnly':
      return typeof value['networkAccess'] === 'boolean' ? null : 'INVALID_VARIANT_PAYLOAD';
    case 'workspaceWrite':
      return isStringArray(value['writableRoots']) &&
        typeof value['networkAccess'] === 'boolean' &&
        typeof value['excludeTmpdirEnvVar'] === 'boolean' &&
        typeof value['excludeSlashTmp'] === 'boolean'
        ? null
        : 'INVALID_VARIANT_PAYLOAD';
    case 'externalSandbox':
      return includes(EXTERNAL_SANDBOX_NETWORK_ACCESS, value['networkAccess']) ? null : 'INVALID_VARIANT_PAYLOAD';
    default:
      return null; // dangerFullAccess: no payload member is required
  }
}

/** Layer A value shapes (Correction 11 section 5 table). `null` was already handled by the nullable column. */
function layerAFailure(row: FieldContractRow, value: unknown): ResumeStructuralFailureReason | null {
  switch (row.responseKey) {
    case 'thread': {
      const errors = validateAgainstSchema(PINNED_BUNDLE, resolvePointer(PINNED_BUNDLE, '#/definitions/v2/Thread'), value);
      return errors.length === 0 ? null : 'THREAD_PINNED_SCHEMA_VIOLATION';
    }
    case 'instructionSources':
      return isStringArray(value) ? null : 'WRONG_TYPE';
    case 'approvalPolicy':
      if (typeof value === 'string') return includes(APPROVAL_POLICY_LITERALS, value) ? null : 'INVALID_ENUM_OR_DISCRIMINATOR';
      if (isRecord(value)) return isWellFormedGranularApproval(value) ? null : 'INVALID_VARIANT_PAYLOAD';
      return 'WRONG_TYPE';
    case 'approvalsReviewer':
      if (typeof value !== 'string') return 'WRONG_TYPE';
      return includes(APPROVALS_REVIEWER_LITERALS, value) ? null : 'INVALID_ENUM_OR_DISCRIMINATOR';
    case 'sandbox':
      return sandboxFailure(value);
    default:
      // model, modelProvider, cwd, serviceTier, reasoningEffort, turnsBackwardsCursor, itemsBackwardsCursor
      return typeof value === 'string' ? null : 'WRONG_TYPE';
  }
}

/** Layer C shapes, pinned Rust shapes only (Correction 11 section 12). `null` was already handled by the table. */
function layerCWellTyped(row: FieldContractRow, value: unknown): boolean {
  switch (row.responseKey) {
    case 'runtimeWorkspaceRoots':
      return isStringArray(value);
    case 'activePermissionProfile':
      return (
        isRecord(value) &&
        typeof value['id'] === 'string' &&
        (!Object.hasOwn(value, 'extends') || value['extends'] === null || typeof value['extends'] === 'string')
      );
    case 'multiAgentMode':
      return typeof value === 'string';
    case 'initialTurnsPage':
      return isRecord(value);
    default:
      return false;
  }
}

/**
 * STEP 1. `{ status: 'VALID', validated }` or `{ status: 'STRUCTURAL_FAILURE', reason, key }` (bounded reason; `key` is
 * the top-level key concerned). Deterministic: unknown top-level keys are reported first, then the table rows in table
 * order.
 */
export function validateThreadResumeResponseStructure(response: unknown): ResumeStructuralValidation {
  if (!isRecord(response)) return failure('RESPONSE_NOT_AN_OBJECT', '<response>');
  for (const key of Object.keys(response)) {
    if (!KNOWN_TOP_LEVEL_RESPONSE_KEYS.includes(key)) return failure('UNKNOWN_TOP_LEVEL_KEY', key);
  }
  for (const row of FIELD_CONTRACT_TABLE_C11) {
    const key = row.responseKey;
    if (!Object.hasOwn(response, key)) {
      if (row.structuralRequired) return failure('REQUIRED_KEY_ABSENT', key);
      continue; // Layer C key absent: UNOBSERVED, valid
    }
    const value = response[key];
    if (row.experimental) {
      if (value === null ? !row.nullable : !layerCWellTyped(row, value)) return failure('EXPERIMENTAL_FIELD_ILL_TYPED', key);
      continue;
    }
    if (value === null) {
      if (row.nullable) continue;
      return failure('NULL_IN_NON_NULLABLE_FIELD', key);
    }
    const reason = layerAFailure(row, value);
    if (reason !== null) return failure(reason, key);
  }
  return issue({ status: 'VALID', validated: deepFreeze(response) as ValidatedThreadResumeResponse });
}
