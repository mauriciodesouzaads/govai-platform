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
import { CODEX_SORT_DIRECTIONS, CODEX_TURN_ITEMS_VIEWS, CODEX_USER_INPUT_TYPES } from './method-names.js';
import type { CodexClientParams, CodexCoveredClientMethod } from './wire.js';

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

/** Exact generated shape of the two allowed `SandboxPolicy` arms; any other arm or extra key is refused. */
export function isGovAIAllowedSandboxPolicy(value: unknown): value is GovAICodexAllowedSandboxPolicy {
  if (!isRecord(value)) return false;
  if (value['type'] === 'readOnly') {
    return hasExactKeys(value, ['type', 'networkAccess']) && typeof value['networkAccess'] === 'boolean';
  }
  if (value['type'] === 'workspaceWrite') {
    return (
      hasExactKeys(value, ['type', 'writableRoots', 'networkAccess', 'excludeTmpdirEnvVar', 'excludeSlashTmp']) &&
      Array.isArray(value['writableRoots']) &&
      value['writableRoots'].every((root) => typeof root === 'string' && root.startsWith('/')) &&
      typeof value['networkAccess'] === 'boolean' &&
      typeof value['excludeTmpdirEnvVar'] === 'boolean' &&
      typeof value['excludeSlashTmp'] === 'boolean'
    );
  }
  return false;
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
  | 'steer_requires_expected_turn_id';

export class GovAICodexPolicyViolation extends Error {
  readonly code = 'govai_codex_policy_violation';
  constructor(
    readonly rule: GovAICodexPolicyRule,
    readonly method: CodexCoveredClientMethod,
    readonly field: string,
  ) {
    super(`govai codex policy: ${rule} (${method}.${field})`);
    this.name = 'GovAICodexPolicyViolation';
  }
}

// ---------------------------------------------------------------------------------------------------------
// Safe request builder
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

/** Validates an untyped input object against the builder's key allowlist and field rules. */
class InputReader {
  constructor(
    private readonly method: CodexCoveredClientMethod,
    private readonly input: unknown,
    allowedKeys: readonly string[],
  ) {
    if (!isRecord(input)) throw new GovAICodexPolicyViolation('invalid_field_value', method, '<input>');
    for (const key of Object.keys(input)) {
      if (!allowedKeys.includes(key)) throw new GovAICodexPolicyViolation('unexpected_input_key', method, key);
    }
  }

  private raw(field: string): unknown {
    return (this.input as Record<string, unknown>)[field];
  }

  has(field: string): boolean {
    return Object.hasOwn(this.input as object, field) && this.raw(field) !== undefined;
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
    const v = this.raw('sandboxPolicy');
    if (!isGovAIAllowedSandboxPolicy(v)) {
      throw new GovAICodexPolicyViolation('sandbox_policy_not_allowed', this.method, 'sandboxPolicy');
    }
    // A fresh object in the generated key order: nothing the caller attached rides along.
    return v.type === 'readOnly'
      ? { type: 'readOnly', networkAccess: v.networkAccess }
      : {
          type: 'workspaceWrite',
          writableRoots: [...v.writableRoots],
          networkAccess: v.networkAccess,
          excludeTmpdirEnvVar: v.excludeTmpdirEnvVar,
          excludeSlashTmp: v.excludeSlashTmp,
        };
  }

  userInputs(): UserInput[] {
    const v = this.raw('input');
    if (!Array.isArray(v) || v.length === 0) {
      throw new GovAICodexPolicyViolation('required_field_missing', this.method, 'input');
    }
    for (const item of v) {
      if (!isRecord(item) || !(CODEX_USER_INPUT_TYPES as readonly unknown[]).includes(item['type'])) {
        throw new GovAICodexPolicyViolation('invalid_field_value', this.method, 'input');
      }
    }
    return [...(v as UserInput[])];
  }
}

/** Drop `undefined` members so optional fields are ABSENT on the wire (never `"x": null` by accident). */
function defined<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) if (obj[key] === undefined) delete obj[key];
  return obj;
}

function finish<M extends CodexCoveredClientMethod>(method: M, params: CodexClientParams<M>): GovAICodexOutboundRequest<M> {
  // Defense in depth: the lockout must agree with the builder on every request it emits.
  assertOutboundRequestAllowed(method, params);
  return Object.freeze({ method, params });
}

const GOVERNED_KEYS = ['approvalPolicy', 'approvalsReviewer', 'sandbox'] as const;

export const GovAICodexSafeRequestBuilder = Object.freeze({
  /** §0.1 FROZEN initialize request: `capabilities` always sent, both flags explicitly false. */
  initialize(): GovAICodexOutboundRequest<'initialize'> {
    return finish('initialize', {
      clientInfo: {
        name: GOVAI_CODEX_CLIENT_INFO.name,
        title: GOVAI_CODEX_CLIENT_INFO.title,
        version: GOVAI_CODEX_CLIENT_INFO.version,
      },
      capabilities: {
        experimentalApi: GOVAI_CODEX_INITIALIZE_CAPABILITIES.experimentalApi,
        requestAttestation: GOVAI_CODEX_INITIALIZE_CAPABILITIES.requestAttestation,
      },
    });
  },

  threadStart(input: GovAICodexThreadStartInput): GovAICodexOutboundRequest<'thread/start'> {
    const r = new InputReader('thread/start', input, [...GOVERNED_KEYS, 'model', 'cwd']);
    return finish(
      'thread/start',
      defined({
        model: r.optionalString('model'),
        cwd: r.optionalString('cwd'),
        approvalPolicy: r.approvalPolicy(true),
        approvalsReviewer: r.approvalsReviewer(true),
        sandbox: r.sandboxMode(),
      }),
    );
  },

  threadResume(input: GovAICodexThreadResumeInput): GovAICodexOutboundRequest<'thread/resume'> {
    const r = new InputReader('thread/resume', input, ['threadId', ...GOVERNED_KEYS, 'model', 'cwd']);
    return finish(
      'thread/resume',
      defined({
        threadId: r.requiredString('threadId'),
        model: r.optionalString('model'),
        cwd: r.optionalString('cwd'),
        approvalPolicy: r.approvalPolicy(true),
        approvalsReviewer: r.approvalsReviewer(true),
        sandbox: r.sandboxMode(),
      }),
    );
  },

  threadFork(input: GovAICodexThreadForkInput): GovAICodexOutboundRequest<'thread/fork'> {
    const r = new InputReader('thread/fork', input, ['threadId', 'lastTurnId', ...GOVERNED_KEYS, 'model', 'cwd']);
    return finish(
      'thread/fork',
      defined({
        threadId: r.requiredString('threadId'),
        lastTurnId: r.requiredString('lastTurnId', 'fork_requires_last_turn_id'),
        model: r.optionalString('model'),
        cwd: r.optionalString('cwd'),
        approvalPolicy: r.approvalPolicy(true),
        approvalsReviewer: r.approvalsReviewer(true),
        sandbox: r.sandboxMode(),
      }),
    );
  },

  threadRead(input: GovAICodexThreadReadInput): GovAICodexOutboundRequest<'thread/read'> {
    const r = new InputReader('thread/read', input, ['threadId', 'includeTurns']);
    return finish(
      'thread/read',
      defined({ threadId: r.requiredString('threadId'), includeTurns: r.optionalBoolean('includeTurns') }),
    );
  },

  threadTurnsList(input: GovAICodexThreadTurnsListInput): GovAICodexOutboundRequest<'thread/turns/list'> {
    const r = new InputReader('thread/turns/list', input, ['threadId', 'cursor', 'limit', 'sortDirection', 'itemsView']);
    return finish(
      'thread/turns/list',
      defined({
        threadId: r.requiredString('threadId'),
        cursor: r.optionalString('cursor'),
        limit: r.optionalPositiveInt('limit'),
        sortDirection: r.optionalLiteral('sortDirection', CODEX_SORT_DIRECTIONS),
        itemsView: r.optionalLiteral('itemsView', CODEX_TURN_ITEMS_VIEWS),
      }),
    );
  },

  threadItemsList(input: GovAICodexThreadItemsListInput): GovAICodexOutboundRequest<'thread/items/list'> {
    const r = new InputReader('thread/items/list', input, ['threadId', 'turnId', 'cursor', 'limit', 'sortDirection']);
    return finish(
      'thread/items/list',
      defined({
        threadId: r.requiredString('threadId'),
        turnId: r.optionalString('turnId'),
        cursor: r.optionalString('cursor'),
        limit: r.optionalPositiveInt('limit'),
        sortDirection: r.optionalLiteral('sortDirection', CODEX_SORT_DIRECTIONS),
      }),
    );
  },

  turnStart(input: GovAICodexTurnStartInput): GovAICodexOutboundRequest<'turn/start'> {
    const r = new InputReader('turn/start', input, [
      'threadId',
      'input',
      'clientUserMessageId',
      'cwd',
      'model',
      'approvalPolicy',
      'approvalsReviewer',
      'sandboxPolicy',
    ]);
    return finish(
      'turn/start',
      defined({
        threadId: r.requiredString('threadId'),
        clientUserMessageId: r.optionalString('clientUserMessageId'),
        input: r.userInputs(),
        cwd: r.optionalString('cwd'),
        approvalPolicy: r.approvalPolicy(false),
        approvalsReviewer: r.approvalsReviewer(false),
        sandboxPolicy: r.sandboxPolicy(),
        model: r.optionalString('model'),
      }),
    );
  },

  turnSteer(input: GovAICodexTurnSteerInput): GovAICodexOutboundRequest<'turn/steer'> {
    const r = new InputReader('turn/steer', input, ['threadId', 'input', 'expectedTurnId', 'clientUserMessageId']);
    return finish(
      'turn/steer',
      defined({
        threadId: r.requiredString('threadId'),
        clientUserMessageId: r.optionalString('clientUserMessageId'),
        input: r.userInputs(),
        expectedTurnId: r.requiredString('expectedTurnId', 'steer_requires_expected_turn_id'),
      }),
    );
  },

  turnInterrupt(input: GovAICodexTurnInterruptInput): GovAICodexOutboundRequest<'turn/interrupt'> {
    const r = new InputReader('turn/interrupt', input, ['threadId', 'turnId']);
    return finish('turn/interrupt', { threadId: r.requiredString('threadId'), turnId: r.requiredString('turnId') });
  },

  threadArchive(input: GovAICodexThreadIdInput): GovAICodexOutboundRequest<'thread/archive'> {
    const r = new InputReader('thread/archive', input, ['threadId']);
    return finish('thread/archive', { threadId: r.requiredString('threadId') });
  },

  threadDelete(input: GovAICodexThreadIdInput): GovAICodexOutboundRequest<'thread/delete'> {
    const r = new InputReader('thread/delete', input, ['threadId']);
    return finish('thread/delete', { threadId: r.requiredString('threadId') });
  },

  threadUnsubscribe(input: GovAICodexThreadIdInput): GovAICodexOutboundRequest<'thread/unsubscribe'> {
    const r = new InputReader('thread/unsubscribe', input, ['threadId']);
    return finish('thread/unsubscribe', { threadId: r.requiredString('threadId') });
  },
});
