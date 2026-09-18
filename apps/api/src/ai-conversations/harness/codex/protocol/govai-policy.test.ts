// CONT-P5-A — GovAI policy + safe request builder (dispatch §2 GOVAI POLICY, §0.1, §4).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertOutboundRequestAllowed } from '../guard/experimental-lockout.js';
import { CODEX_EXPERIMENTAL_INVENTORY } from './experimental-inventory.js';
import type { UserInput } from './generated/v2/UserInput';
import {
  GOVAI_CODEX_ALLOWED_APPROVAL_POLICIES,
  GOVAI_CODEX_ALLOWED_APPROVALS_REVIEWERS,
  GOVAI_CODEX_ALLOWED_SANDBOX_MODES,
  GOVAI_CODEX_ALLOWED_SANDBOX_POLICY_TYPES,
  GOVAI_CODEX_CLIENT_INFO,
  GOVAI_CODEX_FORBIDDEN_NON_EXPERIMENTAL,
  GovAICodexPolicyViolation,
  GovAICodexSafeRequestBuilder as B,
  isGovAIAllowedApprovalPolicy,
  isGovAIAllowedApprovalsReviewer,
  isGovAIAllowedSandboxMode,
  isGovAIAllowedSandboxPolicy,
} from './govai-policy.js';
import { resolvePointer, validateAgainstSchema, type JsonSchemaNode } from './json-schema-subset.js';
import { HARNESS_CODEX_DIR } from './vendored-schema.js';
import type { CodexCoveredClientMethod } from './wire.js';

const CLIENT_REQUEST_SCHEMA: unknown = JSON.parse(
  readFileSync(join(HARNESS_CODEX_DIR, 'pin', 'vendor', 'json', 'ClientRequest.json'), 'utf8'),
);

/** Validate `{ id, method, params }` against the vendored pinned ClientRequest.json (a oneOf over every arm). */
function schemaErrors(method: string, params: unknown): string[] {
  return validateAgainstSchema(CLIENT_REQUEST_SCHEMA, CLIENT_REQUEST_SCHEMA as JsonSchemaNode, { id: 7, method, params });
}

const GOVERNED = { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' } as const;
const USER_TEXT: UserInput[] = [{ type: 'text', text: 'hello', text_elements: [] }];

function violation(fn: () => unknown): GovAICodexPolicyViolation {
  try {
    fn();
  } catch (error) {
    if (error instanceof GovAICodexPolicyViolation) return error;
    throw error;
  }
  throw new Error('expected a GovAICodexPolicyViolation');
}

describe('initialize — the §0.1 FROZEN request', () => {
  it('sends clientInfo + capabilities with both flags explicitly false, and nothing else', () => {
    const req = B.initialize();
    expect(req).toEqual({
      method: 'initialize',
      params: {
        clientInfo: { name: 'govai-cont-p5a-harness', title: 'GovAI CONT-P5-A inert foundation', version: '0.1.0' },
        capabilities: { experimentalApi: false, requestAttestation: false },
      },
    });
    expect(JSON.stringify(req.params)).toBe(
      '{"clientInfo":{"name":"govai-cont-p5a-harness","title":"GovAI CONT-P5-A inert foundation","version":"0.1.0"},' +
        '"capabilities":{"experimentalApi":false,"requestAttestation":false}}',
    );
    expect(schemaErrors('initialize', req.params)).toEqual([]);
  });

  it('pins clientInfo.version to the GovAI package version (apps/api/package.json)', () => {
    const pkg = JSON.parse(readFileSync(join(HARNESS_CODEX_DIR, '..', '..', '..', '..', 'package.json'), 'utf8')) as {
      name: string;
      version: string;
    };
    expect(pkg.name).toBe('@govai/api');
    expect(GOVAI_CODEX_CLIENT_INFO.version).toBe(pkg.version);
  });
});

describe('GovAI allowed policy — wire contract ≠ allowed policy', () => {
  it('allows exactly on-request/untrusted, user, read-only/workspace-write, readOnly/workspaceWrite', () => {
    expect(GOVAI_CODEX_ALLOWED_APPROVAL_POLICIES).toEqual(['on-request', 'untrusted']);
    expect(GOVAI_CODEX_ALLOWED_APPROVALS_REVIEWERS).toEqual(['user']);
    expect(GOVAI_CODEX_ALLOWED_SANDBOX_MODES).toEqual(['read-only', 'workspace-write']);
    expect(GOVAI_CODEX_ALLOWED_SANDBOX_POLICY_TYPES).toEqual(['readOnly', 'workspaceWrite']);
  });

  it('rejects category (3): auto_review, guardian_subagent, danger-full-access, never, dangerFullAccess, externalSandbox', () => {
    expect(GOVAI_CODEX_FORBIDDEN_NON_EXPERIMENTAL).toEqual({
      approvalsReviewer: ['auto_review', 'guardian_subagent'],
      sandboxMode: ['danger-full-access'],
      approvalPolicy: ['never'],
      sandboxPolicyType: ['dangerFullAccess', 'externalSandbox'],
    });
    for (const v of GOVAI_CODEX_FORBIDDEN_NON_EXPERIMENTAL.approvalsReviewer) expect(isGovAIAllowedApprovalsReviewer(v)).toBe(false);
    for (const v of GOVAI_CODEX_FORBIDDEN_NON_EXPERIMENTAL.sandboxMode) expect(isGovAIAllowedSandboxMode(v)).toBe(false);
    for (const v of GOVAI_CODEX_FORBIDDEN_NON_EXPERIMENTAL.approvalPolicy) expect(isGovAIAllowedApprovalPolicy(v)).toBe(false);
    expect(isGovAIAllowedSandboxPolicy({ type: 'dangerFullAccess' })).toBe(false);
    expect(isGovAIAllowedSandboxPolicy({ type: 'externalSandbox', networkAccess: 'restricted' })).toBe(false);
    // None of them is an upstream experimental item: category (3) is a GovAI axis only.
    for (const e of CODEX_EXPERIMENTAL_INVENTORY) {
      expect(['ApprovalsReviewer', 'SandboxMode', 'SandboxPolicy']).not.toContain(e.container);
    }
  });

  it('rejects category (2) granular as an approval policy', () => {
    expect(isGovAIAllowedApprovalPolicy({ granular: { sandbox_approval: true } })).toBe(false);
  });

  it('accepts only the exact generated shapes of the two allowed SandboxPolicy arms', () => {
    expect(isGovAIAllowedSandboxPolicy({ type: 'readOnly', networkAccess: false })).toBe(true);
    expect(
      isGovAIAllowedSandboxPolicy({
        type: 'workspaceWrite',
        writableRoots: ['/tmp/w'],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      }),
    ).toBe(true);
    expect(isGovAIAllowedSandboxPolicy({ type: 'readOnly', networkAccess: false, extra: 1 })).toBe(false);
    expect(
      isGovAIAllowedSandboxPolicy({
        type: 'workspaceWrite',
        writableRoots: ['relative'],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      }),
    ).toBe(false);
  });
});

describe('GovAICodexSafeRequestBuilder — what GovAI emits', () => {
  it('builds thread/start with the governed settings explicit, in generated key order', () => {
    const req = B.threadStart({ ...GOVERNED });
    expect(JSON.stringify(req)).toBe(
      '{"method":"thread/start","params":{"approvalPolicy":"on-request","approvalsReviewer":"user","sandbox":"read-only"}}',
    );
    expect(schemaErrors(req.method, req.params)).toEqual([]);
  });

  it('never leaves governance fields to server defaults on start/resume/fork', () => {
    for (const field of ['approvalPolicy', 'approvalsReviewer', 'sandbox'] as const) {
      const input: Record<string, unknown> = { ...GOVERNED };
      delete input[field];
      expect(violation(() => B.threadStart(input as never))).toMatchObject({ rule: 'required_field_missing', field });
      expect(violation(() => B.threadResume({ ...input, threadId: 't' } as never)).rule).toBe('required_field_missing');
      expect(violation(() => B.threadFork({ ...input, threadId: 't', lastTurnId: 'u' } as never)).rule).toBe(
        'required_field_missing',
      );
    }
  });

  it('refuses every forbidden governance value (categories 2 and 3) at every governed position', () => {
    const bad: [string, unknown, string][] = [
      ['approvalPolicy', 'never', 'approval_policy_not_allowed'],
      ['approvalPolicy', { granular: { sandbox_approval: true, rules: true, mcp_elicitations: true } }, 'approval_policy_not_allowed'],
      ['approvalsReviewer', 'auto_review', 'approvals_reviewer_not_allowed'],
      ['approvalsReviewer', 'guardian_subagent', 'approvals_reviewer_not_allowed'],
      ['sandbox', 'danger-full-access', 'sandbox_mode_not_allowed'],
    ];
    for (const [field, value, rule] of bad) {
      expect(violation(() => B.threadStart({ ...GOVERNED, [field]: value } as never)).rule).toBe(rule);
      expect(violation(() => B.threadResume({ ...GOVERNED, threadId: 't', [field]: value } as never)).rule).toBe(rule);
      expect(violation(() => B.threadFork({ ...GOVERNED, threadId: 't', lastTurnId: 'u', [field]: value } as never)).rule).toBe(
        rule,
      );
      if (field !== 'sandbox') {
        expect(violation(() => B.turnStart({ threadId: 't', input: USER_TEXT, [field]: value } as never)).rule).toBe(rule);
      }
    }
    for (const sandboxPolicy of [{ type: 'dangerFullAccess' }, { type: 'externalSandbox', networkAccess: 'restricted' }]) {
      expect(violation(() => B.turnStart({ threadId: 't', input: USER_TEXT, sandboxPolicy } as never)).rule).toBe(
        'sandbox_policy_not_allowed',
      );
    }
  });

  it('cannot emit any category (1) key of a covered method: unexpected input keys are refused', () => {
    const builders: Partial<Record<CodexCoveredClientMethod, (extra: Record<string, unknown>) => unknown>> = {
      'thread/start': (x) => B.threadStart({ ...GOVERNED, ...x } as never),
      'thread/resume': (x) => B.threadResume({ ...GOVERNED, threadId: 't', ...x } as never),
      'thread/fork': (x) => B.threadFork({ ...GOVERNED, threadId: 't', lastTurnId: 'u', ...x } as never),
      'turn/start': (x) => B.turnStart({ threadId: 't', input: USER_TEXT, ...x } as never),
      'turn/steer': (x) => B.turnSteer({ threadId: 't', input: USER_TEXT, expectedTurnId: 'u', ...x } as never),
    };
    let refused = 0;
    for (const e of CODEX_EXPERIMENTAL_INVENTORY) {
      for (const method of e.requestMethods) {
        const build = builders[method as CodexCoveredClientMethod];
        if (e.kind !== 'field' || build === undefined) continue;
        for (const value of ['x', null, true, [], {}]) {
          expect(violation(() => build({ [e.wire]: value }))).toMatchObject({ rule: 'unexpected_input_key', field: e.wire });
          refused += 1;
        }
      }
    }
    // 31 request-side category (1) fields on the covered params (11 + 5 + 5 + 8 + 2) × 5 probe values.
    expect(refused).toBe(31 * 5);
  });

  it('requires lastTurnId on thread/fork — there is no "latest tail" default', () => {
    for (const lastTurnId of [undefined, null, '']) {
      const input: Record<string, unknown> = { ...GOVERNED, threadId: 't' };
      if (lastTurnId !== undefined) input['lastTurnId'] = lastTurnId;
      expect(violation(() => B.threadFork(input as never))).toMatchObject({
        rule: 'fork_requires_last_turn_id',
        field: 'lastTurnId',
      });
    }
    const req = B.threadFork({ ...GOVERNED, threadId: 'thr_1', lastTurnId: 'turn_9' });
    expect(req.params).toEqual({ threadId: 'thr_1', lastTurnId: 'turn_9', ...GOVERNED });
    expect(schemaErrors(req.method, req.params)).toEqual([]);
  });

  it('requires expectedTurnId on turn/steer', () => {
    for (const expectedTurnId of [undefined, null, '']) {
      const input: Record<string, unknown> = { threadId: 't', input: USER_TEXT };
      if (expectedTurnId !== undefined) input['expectedTurnId'] = expectedTurnId;
      expect(violation(() => B.turnSteer(input as never))).toMatchObject({
        rule: 'steer_requires_expected_turn_id',
        field: 'expectedTurnId',
      });
    }
    const req = B.turnSteer({ threadId: 'thr_1', input: USER_TEXT, expectedTurnId: 'turn_9' });
    expect(JSON.stringify(req.params)).toBe(
      '{"threadId":"thr_1","input":[{"type":"text","text":"hello","text_elements":[]}],"expectedTurnId":"turn_9"}',
    );
    expect(schemaErrors(req.method, req.params)).toEqual([]);
  });

  it('builds every covered method as a request the pinned ClientRequest.json schema accepts', () => {
    const requests = [
      B.initialize(),
      B.threadStart({ ...GOVERNED, cwd: '/tmp/w', model: 'm' }),
      B.threadResume({ ...GOVERNED, threadId: 't', cwd: '/tmp/w' }),
      B.threadRead({ threadId: 't', includeTurns: true }),
      B.threadTurnsList({ threadId: 't', cursor: 'c', limit: 10, sortDirection: 'desc', itemsView: 'summary' }),
      B.threadItemsList({ threadId: 't', turnId: 'u', limit: 5, sortDirection: 'asc' }),
      B.threadFork({ ...GOVERNED, threadId: 't', lastTurnId: 'u' }),
      B.turnStart({
        threadId: 't',
        input: USER_TEXT,
        clientUserMessageId: 'm1',
        approvalPolicy: 'untrusted',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      }),
      B.turnSteer({ threadId: 't', input: USER_TEXT, expectedTurnId: 'u' }),
      B.turnInterrupt({ threadId: 't', turnId: 'u' }),
      B.threadArchive({ threadId: 't' }),
      B.threadDelete({ threadId: 't' }),
      B.threadUnsubscribe({ threadId: 't' }),
    ];
    expect(requests.map((r) => r.method)).toEqual([
      'initialize',
      'thread/start',
      'thread/resume',
      'thread/read',
      'thread/turns/list',
      'thread/items/list',
      'thread/fork',
      'turn/start',
      'turn/steer',
      'turn/interrupt',
      'thread/archive',
      'thread/delete',
      'thread/unsubscribe',
    ]);
    for (const r of requests) expect({ method: r.method, errors: schemaErrors(r.method, r.params) }).toEqual({ method: r.method, errors: [] });
  });

  it('keeps optional fields ABSENT on the wire instead of sending null', () => {
    const req = B.threadRead({ threadId: 't' });
    expect(Object.keys(req.params)).toEqual(['threadId']);
  });

  it('refuses malformed inputs instead of forwarding them', () => {
    expect(violation(() => B.threadRead({ threadId: '' }))).toMatchObject({ rule: 'required_field_missing' });
    expect(violation(() => B.threadTurnsList({ threadId: 't', limit: 0 }))).toMatchObject({ rule: 'invalid_field_value' });
    expect(violation(() => B.threadTurnsList({ threadId: 't', sortDirection: 'sideways' as never }))).toMatchObject({
      rule: 'invalid_field_value',
    });
    expect(violation(() => B.turnStart({ threadId: 't', input: [] }))).toMatchObject({ rule: 'required_field_missing' });
    expect(violation(() => B.turnStart({ threadId: 't', input: [{ type: 'hologram' }] as never }))).toMatchObject({
      rule: 'invalid_field_value',
    });
    expect(violation(() => B.turnInterrupt({ threadId: 't' } as never))).toMatchObject({ rule: 'required_field_missing' });
    expect(violation(() => B.threadDelete(null as never))).toMatchObject({ rule: 'invalid_field_value' });
  });

  it('schema check is live: the pinned schema rejects what GovAI never builds', () => {
    expect(schemaErrors('initialize', { clientInfo: { name: 'x', title: null, version: '1' }, capabilities: { experimentalApi: 'no', requestAttestation: false } })).not.toEqual([]);
    expect(schemaErrors('thread/fork', { lastTurnId: 'u' })).not.toEqual([]);
    expect(schemaErrors('turn/steer', { threadId: 't', input: [] })).not.toEqual([]);
    expect(schemaErrors('thread/start', { sandbox: 'wide-open' })).not.toEqual([]);
    // ThreadForkParams in the pinned JSON schema does not carry the category (1) keys either.
    const fork = resolvePointer(CLIENT_REQUEST_SCHEMA, '#/definitions/ThreadForkParams') as { properties: object };
    for (const key of ['beforeTurnId', 'path', 'permissions', 'runtimeWorkspaceRoots']) {
      expect(Object.keys(fork.properties)).not.toContain(key);
    }
  });

  it('agrees with the independent experimental lockout on every request it emits (defense in depth)', () => {
    const emitted = [
      B.initialize(),
      B.threadStart({ ...GOVERNED }),
      B.threadResume({ ...GOVERNED, threadId: 't' }),
      B.threadFork({ ...GOVERNED, threadId: 't', lastTurnId: 'u' }),
      B.turnStart({ threadId: 't', input: USER_TEXT, approvalPolicy: 'on-request' }),
      B.turnSteer({ threadId: 't', input: USER_TEXT, expectedTurnId: 'u' }),
    ];
    for (const r of emitted) expect(() => assertOutboundRequestAllowed(r.method, r.params)).not.toThrow();
    for (const r of emitted) expect(Object.isFrozen(r)).toBe(true);
  });
});
