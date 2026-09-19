// CONT-P5-A — GOVAI POLICY over the pinned Codex wire (dispatch §2 protocol/, §4 invariants).
//
// Hand-written and tested. WIRE contract ≠ GOVAI allowed policy: the generated types (./generated/**) say what
// the pinned server ACCEPTS; this file says what GovAI will SEND. Every allowed type below is an `Extract`
// narrowing of a generated type — never a re-declaration — and every runtime list is checked against the
// generated literal union at compile time.
//
// ★ THE THREE AXES, KEPT APART:
//   (1) EXPERIMENTAL_ABSENT_FROM_GENERATED_WIRE        — inexpressible here (not in the generated types) and
//                                                        refused at runtime by ../guard/experimental-lockout.ts.
//   (2) EXPERIMENTAL_REPRESENTABLE_ON_GENERATED_WIRE   — e.g. `{ "granular": … }`: present in the wire types,
//                                                        NOT selectable through this builder, refused by the lockout.
//   (3) NON_EXPERIMENTAL_UPSTREAM_BUT_GOVAI_FORBIDDEN  — no upstream annotation; forbidden by GovAI initial
//                                                        policy only (GOVAI_CODEX_FORBIDDEN_NON_EXPERIMENTAL).
// ★ GOVERNANCE FIELDS ARE NEVER LEFT TO SERVER DEFAULTS. `thread/start|resume|fork` REQUIRE an explicit approval
//   policy, approvals reviewer and sandbox mode: a server-side default (or a config file) must never decide
//   them. `turn/start` may omit them (the turn inherits the governed thread settings) but never widen them.
// ★ NO "LATEST TAIL". `thread/fork` requires `lastTurnId` and `turn/steer` requires `expectedTurnId`: the
//   builder never lets the server pick "whatever is newest".
// ★ FAIL CLOSED ON SHAPE. Only the listed keys are copied; an unexpected input key (a category (1) name
//   included) is a `GovAICodexPolicyViolation`, never silently forwarded or dropped.
// ★ ONE PRIMITIVE DECIDES. `enforceGovAICodexOutboundPolicy(method, params)` is the only place GovAI outbound policy
//   is decided: total over the 13 covered methods, an exact-key ALLOWLIST per method (never a denylist), the
//   experimental lockout kept inside it as defense in depth, and an OWNED, deep-frozen reconstruction as its
//   return value. `CodexJsonRpcClient.request()` runs it unconditionally and serializes that return value; the
//   builder below is a typed façade over it.

import {
  assertOutboundRequestAllowed,
  GOVAI_CODEX_INITIALIZE_CAPABILITIES,
} from '../guard/experimental-lockout.js';
import type { ClientInfo } from './generated/ClientInfo';
import type { ApprovalsReviewer } from './generated/v2/ApprovalsReviewer';
import type { AskForApproval } from './generated/v2/AskForApproval';
import type { SandboxMode } from './generated/v2/SandboxMode';
import type { SandboxPolicy } from './generated/v2/SandboxPolicy';
import type { ThreadForkParams } from './generated/v2/ThreadForkParams';
import type { ThreadItemsListParams } from './generated/v2/ThreadItemsListParams';
import type { ThreadReadParams } from './generated/v2/ThreadReadParams';
import type { ThreadResumeParams } from './generated/v2/ThreadResumeParams';
import type { ThreadStartParams } from './generated/v2/ThreadStartParams';
import type { ThreadTurnsListParams } from './generated/v2/ThreadTurnsListParams';
import type { TurnInterruptParams } from './generated/v2/TurnInterruptParams';
import type { TurnStartParams } from './generated/v2/TurnStartParams';
import type { TurnSteerParams } from './generated/v2/TurnSteerParams';
import type { UserInput } from './generated/v2/UserInput';
import { ownGovAICodexUserInputs } from './govai-user-input.js';
import { CODEX_SORT_DIRECTIONS, CODEX_TURN_ITEMS_VIEWS } from './method-names.js';
import { isCoveredClientMethod, type CodexClientParams, type CodexCoveredClientMethod } from './wire.js';

type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// ---------------------------------------------------------------------------------------------------------
// What GovAI allows (narrowings of the generated wire types)
// ---------------------------------------------------------------------------------------------------------

export type GovAICodexAllowedApprovalPolicy = Extract<AskForApproval, 'on-request' | 'untrusted'>;
export type GovAICodexAllowedApprovalsReviewer = Extract<ApprovalsReviewer, 'user'>;
export type GovAICodexAllowedSandboxMode = Extract<SandboxMode, 'read-only' | 'workspace-write'>;
export type GovAICodexAllowedSandboxPolicy = Extract<SandboxPolicy, { type: 'readOnly' } | { type: 'workspaceWrite' }>;

export const GOVAI_CODEX_ALLOWED_APPROVAL_POLICIES = ['on-request', 'untrusted'] as const;
export const GOVAI_CODEX_ALLOWED_APPROVALS_REVIEWERS = ['user'] as const;
export const GOVAI_CODEX_ALLOWED_SANDBOX_MODES = ['read-only', 'workspace-write'] as const;
export const GOVAI_CODEX_ALLOWED_SANDBOX_POLICY_TYPES = ['readOnly', 'workspaceWrite'] as const;

// Each allowed literal must exist in the generated union (an upstream rename breaks the build, not policy).
export const GOVAI_CODEX_ALLOWED_SETS_ARE_GENERATED: [
  Exactly<(typeof GOVAI_CODEX_ALLOWED_APPROVAL_POLICIES)[number], GovAICodexAllowedApprovalPolicy>,
  Exactly<(typeof GOVAI_CODEX_ALLOWED_APPROVALS_REVIEWERS)[number], GovAICodexAllowedApprovalsReviewer>,
  Exactly<(typeof GOVAI_CODEX_ALLOWED_SANDBOX_MODES)[number], GovAICodexAllowedSandboxMode>,
  Exactly<(typeof GOVAI_CODEX_ALLOWED_SANDBOX_POLICY_TYPES)[number], GovAICodexAllowedSandboxPolicy['type']>,
] = [true, true, true, true];

/**
 * Category (3) NON_EXPERIMENTAL_UPSTREAM_BUT_GOVAI_FORBIDDEN — no `#[experimental]` annotation at the pin,
 * present on the generated wire, forbidden by GovAI initial governance policy only. Never labelled
 * experimental; `"auto_review"`/`"guardian_subagent"` are FORBIDDEN_UNTIL_SEPARATE_ADJUDICATION.
 */
export const GOVAI_CODEX_FORBIDDEN_NON_EXPERIMENTAL = Object.freeze({
  /** shared.rs L247 `#[serde(rename = "auto_review", alias = "guardian_subagent")] AutoReview`. */
  approvalsReviewer: ['auto_review', 'guardian_subagent'] as const satisfies readonly ApprovalsReviewer[],
  /** shared.rs L308 `DangerFullAccess`. */
  sandboxMode: ['danger-full-access'] as const satisfies readonly SandboxMode[],
  /** shared.rs L191 `Never`. */
  approvalPolicy: ['never'] as const satisfies readonly AskForApproval[],
  /** ./generated/v2/SandboxPolicy.ts arms `{ "type": "dangerFullAccess" }`, `{ "type": "externalSandbox" }`. */
  sandboxPolicyType: ['dangerFullAccess', 'externalSandbox'] as const satisfies readonly SandboxPolicy['type'][],
});

export function isGovAIAllowedApprovalPolicy(value: unknown): value is GovAICodexAllowedApprovalPolicy {
  return typeof value === 'string' && (GOVAI_CODEX_ALLOWED_APPROVAL_POLICIES as readonly string[]).includes(value);
}

export function isGovAIAllowedApprovalsReviewer(value: unknown): value is GovAICodexAllowedApprovalsReviewer {
  return typeof value === 'string' && (GOVAI_CODEX_ALLOWED_APPROVALS_REVIEWERS as readonly string[]).includes(value);
}

export function isGovAIAllowedSandboxMode(value: unknown): value is GovAICodexAllowedSandboxMode {
  return typeof value === 'string' && (GOVAI_CODEX_ALLOWED_SANDBOX_MODES as readonly string[]).includes(value);
}

/**
 * Exact generated shape of the two allowed `SandboxPolicy` arms, reconstructed: a fresh object in generated key
 * order, each property read exactly once (the value validated is the value returned). `null` for any other arm,
 * a missing or extra key, or a wrong type.
 */
export function ownGovAICodexSandboxPolicy(value: unknown): GovAICodexAllowedSandboxPolicy | null {
  if (!isRecord(value)) return null;
  const type = Object.hasOwn(value, 'type') ? value['type'] : undefined;
  if (type === 'readOnly') {
    if (!hasExactKeys(value, ['type', 'networkAccess'])) return null;
    const networkAccess = value['networkAccess'];
    return typeof networkAccess === 'boolean' ? { type, networkAccess } : null;
  }
  if (type === 'workspaceWrite') {
    if (!hasExactKeys(value, ['type', 'writableRoots', 'networkAccess', 'excludeTmpdirEnvVar', 'excludeSlashTmp'])) {
      return null;
    }
    const writableRoots = value['writableRoots'];
    const networkAccess = value['networkAccess'];
    const excludeTmpdirEnvVar = value['excludeTmpdirEnvVar'];
    const excludeSlashTmp = value['excludeSlashTmp'];
    if (
      !Array.isArray(writableRoots) ||
      typeof networkAccess !== 'boolean' ||
      typeof excludeTmpdirEnvVar !== 'boolean' ||
      typeof excludeSlashTmp !== 'boolean'
    ) {
      return null;
    }
    const roots: string[] = [];
    const length = writableRoots.length;
    for (let i = 0; i < length; i += 1) {
      const root: unknown = writableRoots[i];
      if (typeof root !== 'string' || !root.startsWith('/')) return null;
      roots.push(root);
    }
    return { type, writableRoots: roots, networkAccess, excludeTmpdirEnvVar, excludeSlashTmp };
  }
  return null;
}

/** Exact generated shape of the two allowed `SandboxPolicy` arms; any other arm or extra key is refused. */
export function isGovAIAllowedSandboxPolicy(value: unknown): value is GovAICodexAllowedSandboxPolicy {
  return ownGovAICodexSandboxPolicy(value) !== null;
}

// ---------------------------------------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------------------------------------

export type GovAICodexPolicyRule =
  | 'unexpected_input_key'
  | 'required_field_missing'
  | 'invalid_field_value'
  | 'approval_policy_not_allowed'
  | 'approvals_reviewer_not_allowed'
  | 'sandbox_mode_not_allowed'
  | 'sandbox_policy_not_allowed'
  | 'fork_requires_last_turn_id'
  | 'steer_requires_expected_turn_id'
  | 'method_not_covered';

export class GovAICodexPolicyViolation extends Error {
  readonly code = 'govai_codex_policy_violation';
  constructor(
    readonly rule: GovAICodexPolicyRule,
    /** A covered method, or — for `method_not_covered` only — the refused method name as given. */
    readonly method: string,
    /** Precise field path, e.g. `input[2].text_elements[0].byteRange.start`. */
    readonly field: string,
  ) {
    super(`govai codex policy: ${rule} (${method}.${field})`);
    this.name = 'GovAICodexPolicyViolation';
  }
}

// ---------------------------------------------------------------------------------------------------------
// Frozen client info, typed builder inputs and the single-read input reader
// ---------------------------------------------------------------------------------------------------------

/** §0.1 FROZEN clientInfo. `version` = apps/api/package.json `version` (asserted by govai-policy.test.ts). */
export const GOVAI_CODEX_CLIENT_INFO = Object.freeze({
  name: 'govai-cont-p5a-harness',
  title: 'GovAI CONT-P5-A inert foundation',
  version: '0.1.0',
} as const satisfies ClientInfo);

export type GovAICodexOutboundRequest<M extends CodexCoveredClientMethod> = {
  readonly method: M;
  readonly params: CodexClientParams<M>;
};

type GovernedThreadSettings = {
  readonly approvalPolicy: GovAICodexAllowedApprovalPolicy;
  readonly approvalsReviewer: GovAICodexAllowedApprovalsReviewer;
  readonly sandbox: GovAICodexAllowedSandboxMode;
};

// Input types are PICKED from the generated params (property names cannot drift) and narrowed by policy.
export type GovAICodexThreadStartInput = GovernedThreadSettings & {
  readonly [K in 'model' | 'cwd']?: NonNullable<ThreadStartParams[K]>;
};
export type GovAICodexThreadResumeInput = GovernedThreadSettings & {
  readonly threadId: ThreadResumeParams['threadId'];
} & { readonly [K in 'model' | 'cwd']?: NonNullable<ThreadResumeParams[K]> };
export type GovAICodexThreadForkInput = GovernedThreadSettings & {
  readonly threadId: ThreadForkParams['threadId'];
  /** REQUIRED by GovAI (optional on the wire): no "latest tail" default. */
  readonly lastTurnId: NonNullable<ThreadForkParams['lastTurnId']>;
} & { readonly [K in 'model' | 'cwd']?: NonNullable<ThreadForkParams[K]> };
export type GovAICodexThreadReadInput = {
  readonly threadId: ThreadReadParams['threadId'];
  readonly includeTurns?: NonNullable<ThreadReadParams['includeTurns']>;
};
export type GovAICodexThreadTurnsListInput = {
  readonly threadId: ThreadTurnsListParams['threadId'];
} & { readonly [K in 'cursor' | 'limit' | 'sortDirection' | 'itemsView']?: NonNullable<ThreadTurnsListParams[K]> };
export type GovAICodexThreadItemsListInput = {
  readonly threadId: ThreadItemsListParams['threadId'];
} & { readonly [K in 'turnId' | 'cursor' | 'limit' | 'sortDirection']?: NonNullable<ThreadItemsListParams[K]> };
export type GovAICodexTurnStartInput = {
  readonly threadId: TurnStartParams['threadId'];
  readonly input: readonly UserInput[];
  readonly approvalPolicy?: GovAICodexAllowedApprovalPolicy;
  readonly approvalsReviewer?: GovAICodexAllowedApprovalsReviewer;
  readonly sandboxPolicy?: GovAICodexAllowedSandboxPolicy;
} & { readonly [K in 'clientUserMessageId' | 'cwd' | 'model']?: NonNullable<TurnStartParams[K]> };
export type GovAICodexTurnSteerInput = {
  readonly threadId: TurnSteerParams['threadId'];
  readonly input: readonly UserInput[];
  /** REQUIRED on the wire and by GovAI: steering only the turn the caller believes is running. */
  readonly expectedTurnId: TurnSteerParams['expectedTurnId'];
  readonly clientUserMessageId?: NonNullable<TurnSteerParams['clientUserMessageId']>;
};
export type GovAICodexTurnInterruptInput = {
  readonly threadId: TurnInterruptParams['threadId'];
  readonly turnId: TurnInterruptParams['turnId'];
};
export type GovAICodexThreadIdInput = { readonly threadId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && own.every((k) => keys.includes(k));
}

/**
 * Validates an untyped params object against the method's key ALLOWLIST and field rules. SINGLE READ: every own
 * property is read exactly once, into a snapshot, and every rule below validates — and returns — that snapshot.
 */
class InputReader {
  private readonly values = new Map<string, unknown>();

  constructor(
    private readonly method: CodexCoveredClientMethod,
    input: unknown,
    allowedKeys: readonly string[],
  ) {
    if (!isRecord(input)) throw new GovAICodexPolicyViolation('invalid_field_value', method, '<input>');
    for (const key of Object.keys(input)) {
      if (!allowedKeys.includes(key)) throw new GovAICodexPolicyViolation('unexpected_input_key', method, key);
      this.values.set(key, input[key]);
    }
  }

  private raw(field: string): unknown {
    return this.values.get(field);
  }

  /** An own key whose value is `undefined` is treated as absent. */
  has(field: string): boolean {
    return this.values.has(field) && this.raw(field) !== undefined;
  }

  /** `field` must be a record whose own keys and values are EXACTLY `expected` (the §0.1 frozen request). */
  exactly(field: string, expected: Readonly<Record<string, string | boolean>>): void {
    const v = this.raw(field);
    if (v === undefined) throw new GovAICodexPolicyViolation('required_field_missing', this.method, field);
    if (!isRecord(v)) throw new GovAICodexPolicyViolation('invalid_field_value', this.method, field);
    const own = Object.keys(v);
    for (const key of own) {
      if (!Object.hasOwn(expected, key)) throw new GovAICodexPolicyViolation('unexpected_input_key', this.method, `${field}.${key}`);
    }
    for (const [key, value] of Object.entries(expected)) {
      if (!own.includes(key)) throw new GovAICodexPolicyViolation('required_field_missing', this.method, `${field}.${key}`);
      if (v[key] !== value) throw new GovAICodexPolicyViolation('invalid_field_value', this.method, `${field}.${key}`);
    }
  }

  requiredString(field: string, rule: GovAICodexPolicyRule = 'required_field_missing'): string {
    const v = this.raw(field);
    if (typeof v !== 'string' || v.length === 0) throw new GovAICodexPolicyViolation(rule, this.method, field);
    return v;
  }

  optionalString(field: string): string | undefined {
    if (!this.has(field)) return undefined;
    return this.requiredString(field, 'invalid_field_value');
  }

  optionalBoolean(field: string): boolean | undefined {
    if (!this.has(field)) return undefined;
    const v = this.raw(field);
    if (typeof v !== 'boolean') throw new GovAICodexPolicyViolation('invalid_field_value', this.method, field);
    return v;
  }

  optionalPositiveInt(field: string): number | undefined {
    if (!this.has(field)) return undefined;
    const v = this.raw(field);
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) {
      throw new GovAICodexPolicyViolation('invalid_field_value', this.method, field);
    }
    return v;
  }

  optionalLiteral<T extends string>(field: string, allowed: readonly T[]): T | undefined {
    if (!this.has(field)) return undefined;
    const v = this.raw(field);
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      throw new GovAICodexPolicyViolation('invalid_field_value', this.method, field);
    }
    return v as T;
  }

  approvalPolicy(required: boolean): GovAICodexAllowedApprovalPolicy | undefined {
    if (!required && !this.has('approvalPolicy')) return undefined;
    const v = this.raw('approvalPolicy');
    if (!isGovAIAllowedApprovalPolicy(v)) {
      throw new GovAICodexPolicyViolation(
        v === undefined ? 'required_field_missing' : 'approval_policy_not_allowed',
        this.method,
        'approvalPolicy',
      );
    }
    return v;
  }

  approvalsReviewer(required: boolean): GovAICodexAllowedApprovalsReviewer | undefined {
    if (!required && !this.has('approvalsReviewer')) return undefined;
    const v = this.raw('approvalsReviewer');
    if (!isGovAIAllowedApprovalsReviewer(v)) {
      throw new GovAICodexPolicyViolation(
        v === undefined ? 'required_field_missing' : 'approvals_reviewer_not_allowed',
        this.method,
        'approvalsReviewer',
      );
    }
    return v;
  }

  sandboxMode(): GovAICodexAllowedSandboxMode {
    const v = this.raw('sandbox');
    if (!isGovAIAllowedSandboxMode(v)) {
      throw new GovAICodexPolicyViolation(
        v === undefined ? 'required_field_missing' : 'sandbox_mode_not_allowed',
        this.method,
        'sandbox',
      );
    }
    return v;
  }

  sandboxPolicy(): GovAICodexAllowedSandboxPolicy | undefined {
    if (!this.has('sandboxPolicy')) return undefined;
    // A fresh object in the generated key order: nothing the caller attached rides along.
    const owned = ownGovAICodexSandboxPolicy(this.raw('sandboxPolicy'));
    if (owned === null) throw new GovAICodexPolicyViolation('sandbox_policy_not_allowed', this.method, 'sandboxPolicy');
    return owned;
  }

  /** The OWNED `input` (./govai-user-input.ts): every item validated and rebuilt, with precise violation paths. */
  userInputs(): UserInput[] {
    return ownGovAICodexUserInputs(this.raw('input'), (rule, path) => {
      throw new GovAICodexPolicyViolation(rule, this.method, path);
    });
  }
}

/** Drop `undefined` members so optional fields are ABSENT on the wire (never `"x": null` by accident). */
function defined<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) if (obj[key] === undefined) delete obj[key];
  return obj;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

/** The own enumerable properties of `params`, each read exactly once (a non-record is returned as given). */
function snapshotOwn(params: unknown): unknown {
  if (!isRecord(params)) return params;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(params)) copy[key] = params[key];
  return copy;
}

const GOVERNED_KEYS = ['approvalPolicy', 'approvalsReviewer', 'sandbox'] as const;

// ---------------------------------------------------------------------------------------------------------
// THE primitive: one ALLOWLIST rule per covered method (total — a covered method without a rule cannot compile)
// ---------------------------------------------------------------------------------------------------------

const GOVAI_CODEX_OUTBOUND_POLICY = {
  /** §0.1 FROZEN initialize request: exactly `{clientInfo, capabilities}` holding the frozen values, nothing else. */
  initialize: (params: unknown) => {
    const r = new InputReader('initialize', params, ['clientInfo', 'capabilities']);
    r.exactly('clientInfo', GOVAI_CODEX_CLIENT_INFO);
    r.exactly('capabilities', GOVAI_CODEX_INITIALIZE_CAPABILITIES);
    return {
      clientInfo: {
        name: GOVAI_CODEX_CLIENT_INFO.name,
        title: GOVAI_CODEX_CLIENT_INFO.title,
        version: GOVAI_CODEX_CLIENT_INFO.version,
      },
      capabilities: {
        experimentalApi: GOVAI_CODEX_INITIALIZE_CAPABILITIES.experimentalApi,
        requestAttestation: GOVAI_CODEX_INITIALIZE_CAPABILITIES.requestAttestation,
      },
    };
  },

  'thread/start': (params: unknown) => {
    const r = new InputReader('thread/start', params, [...GOVERNED_KEYS, 'model', 'cwd']);
    return defined({
      model: r.optionalString('model'),
      cwd: r.optionalString('cwd'),
      approvalPolicy: r.approvalPolicy(true),
      approvalsReviewer: r.approvalsReviewer(true),
      sandbox: r.sandboxMode(),
    });
  },

  'thread/resume': (params: unknown) => {
    const r = new InputReader('thread/resume', params, ['threadId', ...GOVERNED_KEYS, 'model', 'cwd']);
    return defined({
      threadId: r.requiredString('threadId'),
      model: r.optionalString('model'),
      cwd: r.optionalString('cwd'),
      approvalPolicy: r.approvalPolicy(true),
      approvalsReviewer: r.approvalsReviewer(true),
      sandbox: r.sandboxMode(),
    });
  },

  'thread/fork': (params: unknown) => {
    const r = new InputReader('thread/fork', params, ['threadId', 'lastTurnId', ...GOVERNED_KEYS, 'model', 'cwd']);
    return defined({
      threadId: r.requiredString('threadId'),
      lastTurnId: r.requiredString('lastTurnId', 'fork_requires_last_turn_id'),
      model: r.optionalString('model'),
      cwd: r.optionalString('cwd'),
      approvalPolicy: r.approvalPolicy(true),
      approvalsReviewer: r.approvalsReviewer(true),
      sandbox: r.sandboxMode(),
    });
  },

  'thread/read': (params: unknown) => {
    const r = new InputReader('thread/read', params, ['threadId', 'includeTurns']);
    return defined({ threadId: r.requiredString('threadId'), includeTurns: r.optionalBoolean('includeTurns') });
  },

  'thread/turns/list': (params: unknown) => {
    const r = new InputReader('thread/turns/list', params, ['threadId', 'cursor', 'limit', 'sortDirection', 'itemsView']);
    return defined({
      threadId: r.requiredString('threadId'),
      cursor: r.optionalString('cursor'),
      limit: r.optionalPositiveInt('limit'),
      sortDirection: r.optionalLiteral('sortDirection', CODEX_SORT_DIRECTIONS),
      itemsView: r.optionalLiteral('itemsView', CODEX_TURN_ITEMS_VIEWS),
    });
  },

  'thread/items/list': (params: unknown) => {
    const r = new InputReader('thread/items/list', params, ['threadId', 'turnId', 'cursor', 'limit', 'sortDirection']);
    return defined({
      threadId: r.requiredString('threadId'),
      turnId: r.optionalString('turnId'),
      cursor: r.optionalString('cursor'),
      limit: r.optionalPositiveInt('limit'),
      sortDirection: r.optionalLiteral('sortDirection', CODEX_SORT_DIRECTIONS),
    });
  },

  'turn/start': (params: unknown) => {
    const r = new InputReader('turn/start', params, [
      'threadId',
      'input',
      'clientUserMessageId',
      'cwd',
      'model',
      'approvalPolicy',
      'approvalsReviewer',
      'sandboxPolicy',
    ]);
    return defined({
      threadId: r.requiredString('threadId'),
      clientUserMessageId: r.optionalString('clientUserMessageId'),
      input: r.userInputs(),
      cwd: r.optionalString('cwd'),
      approvalPolicy: r.approvalPolicy(false),
      approvalsReviewer: r.approvalsReviewer(false),
      sandboxPolicy: r.sandboxPolicy(),
      model: r.optionalString('model'),
    });
  },

  'turn/steer': (params: unknown) => {
    const r = new InputReader('turn/steer', params, ['threadId', 'input', 'expectedTurnId', 'clientUserMessageId']);
    return defined({
      threadId: r.requiredString('threadId'),
      clientUserMessageId: r.optionalString('clientUserMessageId'),
      input: r.userInputs(),
      expectedTurnId: r.requiredString('expectedTurnId', 'steer_requires_expected_turn_id'),
    });
  },

  'turn/interrupt': (params: unknown) => {
    const r = new InputReader('turn/interrupt', params, ['threadId', 'turnId']);
    return { threadId: r.requiredString('threadId'), turnId: r.requiredString('turnId') };
  },

  'thread/archive': (params: unknown) => {
    const r = new InputReader('thread/archive', params, ['threadId']);
    return { threadId: r.requiredString('threadId') };
  },

  'thread/delete': (params: unknown) => {
    const r = new InputReader('thread/delete', params, ['threadId']);
    return { threadId: r.requiredString('threadId') };
  },

  'thread/unsubscribe': (params: unknown) => {
    const r = new InputReader('thread/unsubscribe', params, ['threadId']);
    return { threadId: r.requiredString('threadId') };
  },
} satisfies { readonly [M in CodexCoveredClientMethod]: (params: unknown) => CodexClientParams<M> };

function ruleOf<M extends CodexCoveredClientMethod>(method: M): (params: unknown) => CodexClientParams<M> {
  return GOVAI_CODEX_OUTBOUND_POLICY[method] as (params: unknown) => CodexClientParams<M>;
}

/**
 * THE GovAI outbound policy primitive — the only place it is decided, applied unconditionally by
 * `CodexJsonRpcClient.request()` to every request, whatever the client instance.
 *   · total over the 13 covered methods; any other method is refused (`method_not_covered`);
 *   · the experimental lockout (categories (1)/(2), `experimentalApi`) runs INSIDE it first, as defense in depth,
 *     and again on the reconstruction;
 *   · then the method's exact-key ALLOWLIST: any other key is `unexpected_input_key`; a non-record is a violation;
 *     `null` is never accepted for a params field (the nullable `placeholder` of a text element is the single,
 *     explicit exception); an own key holding `undefined` counts as absent;
 *   · category (3) values, the governance fields of thread/start|resume|fork, `lastTurnId` on fork and
 *     `expectedTurnId` on steer are required as before; turn/start may omit governance overrides, never widen them;
 *   · returns OWNED params: each source property read once, fresh containers in generated key order,
 *     deep-frozen, no caller object reachable. Idempotent: enforce(m, enforce(m, x)) deep-equals enforce(m, x)
 *     and serializes byte-identically.
 */
export function enforceGovAICodexOutboundPolicy<M extends CodexCoveredClientMethod>(
  method: M,
  params: unknown,
): CodexClientParams<M> {
  const source = snapshotOwn(params);
  assertOutboundRequestAllowed(method, source);
  if (!isCoveredClientMethod(method)) throw new GovAICodexPolicyViolation('method_not_covered', method, '<method>');
  const owned = ruleOf(method)(source);
  assertOutboundRequestAllowed(method, owned);
  return deepFreeze(owned);
}

// ---------------------------------------------------------------------------------------------------------
// Safe request builder — a typed façade over the primitive
// ---------------------------------------------------------------------------------------------------------

/**
 * The method's rule runs first, so a typed caller keeps seeing GovAI policy violations for its input (a category
 * (1) key is `unexpected_input_key`, `granular` is `approval_policy_not_allowed`); its reconstruction then goes
 * through the primitive (lockout, the same rule — idempotent — and the deep freeze).
 */
function finish<M extends CodexCoveredClientMethod>(method: M, input: unknown): GovAICodexOutboundRequest<M> {
  return Object.freeze({ method, params: enforceGovAICodexOutboundPolicy(method, ruleOf(method)(input)) });
}

export const GovAICodexSafeRequestBuilder = Object.freeze({
  /** §0.1 FROZEN initialize request: `capabilities` always sent, both flags explicitly false. */
  initialize(): GovAICodexOutboundRequest<'initialize'> {
    return finish('initialize', {
      clientInfo: { ...GOVAI_CODEX_CLIENT_INFO },
      capabilities: { ...GOVAI_CODEX_INITIALIZE_CAPABILITIES },
    });
  },

  threadStart(input: GovAICodexThreadStartInput): GovAICodexOutboundRequest<'thread/start'> {
    return finish('thread/start', input);
  },

  threadResume(input: GovAICodexThreadResumeInput): GovAICodexOutboundRequest<'thread/resume'> {
    return finish('thread/resume', input);
  },

  threadFork(input: GovAICodexThreadForkInput): GovAICodexOutboundRequest<'thread/fork'> {
    return finish('thread/fork', input);
  },

  threadRead(input: GovAICodexThreadReadInput): GovAICodexOutboundRequest<'thread/read'> {
    return finish('thread/read', input);
  },

  threadTurnsList(input: GovAICodexThreadTurnsListInput): GovAICodexOutboundRequest<'thread/turns/list'> {
    return finish('thread/turns/list', input);
  },

  threadItemsList(input: GovAICodexThreadItemsListInput): GovAICodexOutboundRequest<'thread/items/list'> {
    return finish('thread/items/list', input);
  },

  turnStart(input: GovAICodexTurnStartInput): GovAICodexOutboundRequest<'turn/start'> {
    return finish('turn/start', input);
  },

  turnSteer(input: GovAICodexTurnSteerInput): GovAICodexOutboundRequest<'turn/steer'> {
    return finish('turn/steer', input);
  },

  turnInterrupt(input: GovAICodexTurnInterruptInput): GovAICodexOutboundRequest<'turn/interrupt'> {
    return finish('turn/interrupt', input);
  },

  threadArchive(input: GovAICodexThreadIdInput): GovAICodexOutboundRequest<'thread/archive'> {
    return finish('thread/archive', input);
  },

  threadDelete(input: GovAICodexThreadIdInput): GovAICodexOutboundRequest<'thread/delete'> {
    return finish('thread/delete', input);
  },

  threadUnsubscribe(input: GovAICodexThreadIdInput): GovAICodexOutboundRequest<'thread/unsubscribe'> {
    return finish('thread/unsubscribe', input);
  },
});
