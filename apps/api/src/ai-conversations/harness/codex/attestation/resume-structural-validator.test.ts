// CONT-P5-E1 — STEP 1 structural validation (Dispatch v8 M7c; section 4 rows CE-01/02/07/08, T-09..T-12, T-16..T-18
// (structure), T-20..T-22, C13-R3-A..F). Every response here is a canned stock-shaped answer of the fake app-server
// fixture; no Codex process is started.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cannedSandboxPolicy,
  cannedStockThread,
  cannedThreadResumeResult,
  type CannedEffectiveSettings,
} from '../client/fake-app-server.fixture.js';
import { resolvePointer, validateAgainstSchema, type JsonSchemaNode } from '../protocol/json-schema-subset.js';
import { HARNESS_CODEX_DIR, readVendoredBody } from '../protocol/vendored-schema.js';
import { RESPONSE_NULLABLE_REQUIRED_FIELDS, RESPONSE_STRUCTURAL_REQUIRED_FIELDS } from './resume-response-contract.js';
import {
  isIssuedByResumeStructuralValidator,
  RESUME_STRUCTURAL_FAILURE_REASONS,
  RESUME_VALUE_DOMAINS_ARE_GENERATED,
  validateThreadResumeResponseStructure as validate,
} from './resume-structural-validator.js';

const SETTINGS: CannedEffectiveSettings = {
  model: 'gpt-e1-model-a',
  cwd: '/Users/Shared/govai-e1-fixture/work',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
  sandbox: cannedSandboxPolicy('workspaceWrite', ['/Users/Shared/govai-e1-fixture/work']),
};

/** A fresh stock-shaped response (the validator freezes what it validates, so every case builds its own). */
function response(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return cannedThreadResumeResult(SETTINGS, overrides);
}

function without(key: string): Record<string, unknown> {
  const r = response();
  delete r[key];
  return r;
}

function failureOf(r: unknown): { reason: string; key: string } | 'VALID' {
  const v = validate(r);
  return v.status === 'VALID' ? 'VALID' : { reason: v.reason, key: v.key };
}

const WELL_TYPED_EXPERIMENTAL: Readonly<Record<string, readonly unknown[]>> = {
  runtimeWorkspaceRoots: [[], ['/Users/Shared/govai-e1-fixture/work']],
  activePermissionProfile: [null, { id: ':workspace', extends: null }, { id: 'custom', extends: ':workspace' }, { id: 'bare' }],
  multiAgentMode: ['disabled', 'v2'],
  initialTurnsPage: [null, { data: [], nextCursor: null, backwardsCursor: null }],
};

const ILL_TYPED_EXPERIMENTAL: Readonly<Record<string, readonly unknown[]>> = {
  runtimeWorkspaceRoots: [null, 'roots', [1], {}],
  activePermissionProfile: ['p', 7, {}, { id: 1 }, { id: 'x', extends: 2 }],
  multiAgentMode: [null, 3, {}, []],
  initialTurnsPage: ['page', 1, [], true],
};

describe('Layer A — the twelve required keys (NULLABLE IS NOT OPTIONAL)', () => {
  it('accepts the canned stock-shaped response', () => {
    expect(failureOf(response())).toBe('VALID');
  });

  it('CE-01 serviceTier absent -> STRUCTURAL_FAILURE (key serviceTier)', () => {
    expect(failureOf(without('serviceTier'))).toEqual({ reason: 'REQUIRED_KEY_ABSENT', key: 'serviceTier' });
  });

  it('CE-02 serviceTier: null -> VALID', () => {
    expect(failureOf(response({ serviceTier: null }))).toBe('VALID');
    expect(failureOf(response({ serviceTier: 'priority' }))).toBe('VALID');
    expect(failureOf(response({ serviceTier: 5 }))).toEqual({ reason: 'WRONG_TYPE', key: 'serviceTier' });
  });

  it('CE-07 instructionSources absent -> failure; [] -> VALID; null / non-array / non-string member -> failure', () => {
    expect(failureOf(without('instructionSources'))).toEqual({ reason: 'REQUIRED_KEY_ABSENT', key: 'instructionSources' });
    expect(failureOf(response({ instructionSources: [] }))).toBe('VALID');
    expect(failureOf(response({ instructionSources: ['/Users/Shared/govai-e1-fixture/work/AGENTS.md'] }))).toBe('VALID');
    expect(failureOf(response({ instructionSources: null }))).toEqual({ reason: 'NULL_IN_NON_NULLABLE_FIELD', key: 'instructionSources' });
    expect(failureOf(response({ instructionSources: 'AGENTS.md' }))).toEqual({ reason: 'WRONG_TYPE', key: 'instructionSources' });
    expect(failureOf(response({ instructionSources: [1] }))).toEqual({ reason: 'WRONG_TYPE', key: 'instructionSources' });
  });

  it('T-09 reasoningEffort absent -> failure; null -> VALID; "medium" -> VALID; 7 -> failure', () => {
    expect(failureOf(without('reasoningEffort'))).toEqual({ reason: 'REQUIRED_KEY_ABSENT', key: 'reasoningEffort' });
    expect(failureOf(response({ reasoningEffort: null }))).toBe('VALID');
    expect(failureOf(response({ reasoningEffort: 'medium' }))).toBe('VALID');
    expect(failureOf(response({ reasoningEffort: 'a-custom-effort' }))).toBe('VALID');
    expect(failureOf(response({ reasoningEffort: 7 }))).toEqual({ reason: 'WRONG_TYPE', key: 'reasoningEffort' });
  });

  it('T-10 turnsBackwardsCursor absent -> failure; null -> VALID; string -> VALID', () => {
    expect(failureOf(without('turnsBackwardsCursor'))).toEqual({ reason: 'REQUIRED_KEY_ABSENT', key: 'turnsBackwardsCursor' });
    expect(failureOf(response({ turnsBackwardsCursor: null }))).toBe('VALID');
    expect(failureOf(response({ turnsBackwardsCursor: 'opaque-cursor' }))).toBe('VALID');
    expect(failureOf(response({ turnsBackwardsCursor: 1 }))).toEqual({ reason: 'WRONG_TYPE', key: 'turnsBackwardsCursor' });
  });

  it('T-11 itemsBackwardsCursor absent -> failure; null -> VALID', () => {
    expect(failureOf(without('itemsBackwardsCursor'))).toEqual({ reason: 'REQUIRED_KEY_ABSENT', key: 'itemsBackwardsCursor' });
    expect(failureOf(response({ itemsBackwardsCursor: null }))).toBe('VALID');
    expect(failureOf(response({ itemsBackwardsCursor: 'opaque-cursor' }))).toBe('VALID');
  });

  it('T-12 modelProvider absent -> failure; non-string -> failure', () => {
    expect(failureOf(without('modelProvider'))).toEqual({ reason: 'REQUIRED_KEY_ABSENT', key: 'modelProvider' });
    expect(failureOf(response({ modelProvider: 1 }))).toEqual({ reason: 'WRONG_TYPE', key: 'modelProvider' });
    expect(failureOf(response({ modelProvider: null }))).toEqual({ reason: 'NULL_IN_NON_NULLABLE_FIELD', key: 'modelProvider' });
  });

  it('never treats an absent ordinary key as UNOBSERVED: every one of the twelve fails when absent', () => {
    expect(RESPONSE_STRUCTURAL_REQUIRED_FIELDS).toHaveLength(12);
    for (const key of RESPONSE_STRUCTURAL_REQUIRED_FIELDS) {
      expect(failureOf(without(key)), key).toEqual({ reason: 'REQUIRED_KEY_ABSENT', key });
    }
  });

  it('accepts null exactly on the four nullable keys and refuses it on the eight others', () => {
    for (const key of RESPONSE_STRUCTURAL_REQUIRED_FIELDS) {
      const expected = RESPONSE_NULLABLE_REQUIRED_FIELDS.includes(key) ? 'VALID' : { reason: 'NULL_IN_NON_NULLABLE_FIELD', key };
      expect(failureOf(response({ [key]: null })), key).toEqual(expected);
    }
  });

  it('checks the top-level type of model and cwd (strings), and nothing about cwd beyond its type', () => {
    expect(failureOf(response({ model: 3 }))).toEqual({ reason: 'WRONG_TYPE', key: 'model' });
    expect(failureOf(response({ cwd: ['/w'] }))).toEqual({ reason: 'WRONG_TYPE', key: 'cwd' });
    expect(failureOf(response({ cwd: 'relative/looking/path' }))).toBe('VALID');
  });
});

describe('T-16 — SandboxPolicy: tagged, with the variant-required payload', () => {
  it('accepts the four well-formed variants (T-15 structure: dangerFullAccess / externalSandbox are VALID)', () => {
    for (const type of ['readOnly', 'workspaceWrite', 'dangerFullAccess', 'externalSandbox'] as const) {
      expect(failureOf(response({ sandbox: cannedSandboxPolicy(type, ['/w']) })), type).toBe('VALID');
    }
    expect(failureOf(response({ sandbox: { type: 'externalSandbox', networkAccess: 'enabled' } }))).toBe('VALID');
  });

  it('refuses an unknown type, a missing type, a non-object and every missing or ill-typed variant member', () => {
    const cases: readonly (readonly [unknown, string])[] = [
      [{ type: 'hologram' }, 'INVALID_ENUM_OR_DISCRIMINATOR'],
      [{ networkAccess: false }, 'INVALID_ENUM_OR_DISCRIMINATOR'],
      ['read-only', 'WRONG_TYPE'],
      ['readOnly', 'WRONG_TYPE'],
      [[], 'WRONG_TYPE'],
      [{ type: 'readOnly' }, 'INVALID_VARIANT_PAYLOAD'],
      [{ type: 'readOnly', networkAccess: 'no' }, 'INVALID_VARIANT_PAYLOAD'],
      [{ type: 'externalSandbox' }, 'INVALID_VARIANT_PAYLOAD'],
      [{ type: 'externalSandbox', networkAccess: 'open' }, 'INVALID_VARIANT_PAYLOAD'],
      [{ type: 'externalSandbox', networkAccess: true }, 'INVALID_VARIANT_PAYLOAD'],
    ];
    for (const [sandbox, reason] of cases) {
      expect(failureOf(response({ sandbox })), JSON.stringify(sandbox)).toEqual({ reason, key: 'sandbox' });
    }
    for (const member of ['writableRoots', 'networkAccess', 'excludeTmpdirEnvVar', 'excludeSlashTmp']) {
      const sandbox = cannedSandboxPolicy('workspaceWrite', ['/w']);
      delete sandbox[member];
      expect(failureOf(response({ sandbox })), member).toEqual({ reason: 'INVALID_VARIANT_PAYLOAD', key: 'sandbox' });
      expect(failureOf(response({ sandbox: { ...cannedSandboxPolicy('workspaceWrite', ['/w']), [member]: 'x' } })), member).toEqual({
        reason: 'INVALID_VARIANT_PAYLOAD',
        key: 'sandbox',
      });
    }
    expect(failureOf(response({ sandbox: { ...cannedSandboxPolicy('workspaceWrite'), writableRoots: [1] } }))).toEqual({
      reason: 'INVALID_VARIANT_PAYLOAD',
      key: 'sandbox',
    });
  });
});

describe('T-17 / T-18 structure — approvalPolicy and approvalsReviewer on the pinned domains', () => {
  const granular = { granular: { sandbox_approval: true, rules: false, skill_approval: true, request_permissions: false, mcp_elicitations: true } };

  it('accepts every pinned approvalPolicy literal and a well-formed granular object', () => {
    for (const approvalPolicy of ['untrusted', 'on-request', 'never', granular]) {
      expect(failureOf(response({ approvalPolicy })), JSON.stringify(approvalPolicy)).toBe('VALID');
    }
  });

  it('refuses malformed approvalPolicy values', () => {
    const cases: readonly (readonly [unknown, string])[] = [
      ['always', 'INVALID_ENUM_OR_DISCRIMINATOR'],
      ['On-Request', 'INVALID_ENUM_OR_DISCRIMINATOR'],
      [7, 'WRONG_TYPE'],
      [[], 'WRONG_TYPE'],
      [{ granular: { sandbox_approval: true } }, 'INVALID_VARIANT_PAYLOAD'],
      [{ granular: { ...granular.granular, rules: 'yes' } }, 'INVALID_VARIANT_PAYLOAD'],
      [{ ...granular, extra: 1 }, 'INVALID_VARIANT_PAYLOAD'],
      [{ strict: {} }, 'INVALID_VARIANT_PAYLOAD'],
    ];
    for (const [approvalPolicy, reason] of cases) {
      expect(failureOf(response({ approvalPolicy })), JSON.stringify(approvalPolicy)).toEqual({ reason, key: 'approvalPolicy' });
    }
  });

  it('carries exactly the five granular members of the generated AskForApproval type', () => {
    const body = readVendoredBody('v2/AskForApproval.ts');
    const members = /\{ "granular": \{ ([^}]*) \} \}/.exec(body)?.[1]?.split(',').map((m) => m.trim().split(':')[0]).filter((m) => m !== '');
    expect(members).toEqual(Object.keys(granular.granular));
  });

  it('accepts the three pinned approvalsReviewer literals and refuses any other value', () => {
    for (const approvalsReviewer of ['user', 'auto_review', 'guardian_subagent']) {
      expect(failureOf(response({ approvalsReviewer })), approvalsReviewer).toBe('VALID');
    }
    expect(failureOf(response({ approvalsReviewer: 'admin' }))).toEqual({ reason: 'INVALID_ENUM_OR_DISCRIMINATOR', key: 'approvalsReviewer' });
    expect(failureOf(response({ approvalsReviewer: 1 }))).toEqual({ reason: 'WRONG_TYPE', key: 'approvalsReviewer' });
  });

  it('ties every pinned value domain to the generated types at compile time', () => {
    expect(RESUME_VALUE_DOMAINS_ARE_GENERATED).toEqual([true, true, true, true]);
  });
});

describe('Layer C — the four experimental observables (absent -> UNOBSERVED, present -> type-checked)', () => {
  it('CE-08 runtimeWorkspaceRoots absent (experimentalApi false) -> VALID', () => {
    expect(failureOf(response())).toBe('VALID');
  });

  it('T-20 each experimental key present and well-typed -> VALID', () => {
    for (const [key, values] of Object.entries(WELL_TYPED_EXPERIMENTAL)) {
      for (const value of values) expect(failureOf(response({ [key]: value })), `${key}=${JSON.stringify(value)}`).toBe('VALID');
    }
    // The stock pin may emit all four at once (they are not stripped from ordinary responses).
    expect(
      failureOf(
        response({
          runtimeWorkspaceRoots: ['/w'],
          activePermissionProfile: { id: ':workspace', extends: null },
          multiAgentMode: 'disabled',
          initialTurnsPage: null,
        }),
      ),
    ).toBe('VALID');
  });

  it('T-21 each experimental key present and ill-typed -> STRUCTURAL_FAILURE', () => {
    for (const [key, values] of Object.entries(ILL_TYPED_EXPERIMENTAL)) {
      for (const value of values) {
        expect(failureOf(response({ [key]: value })), `${key}=${JSON.stringify(value)}`).toEqual({ reason: 'EXPERIMENTAL_FIELD_ILL_TYPED', key });
      }
    }
  });
});

describe('T-22 / C13-R3-D — top level is strict', () => {
  it('refuses any key outside the 12 + 4 table keys, naming it', () => {
    expect(failureOf(response({ unexpected: true }))).toEqual({ reason: 'UNKNOWN_TOP_LEVEL_KEY', key: 'unexpected' });
    expect(failureOf(response({ environments: null }))).toEqual({ reason: 'UNKNOWN_TOP_LEVEL_KEY', key: 'environments' });
    expect(failureOf(response({ branch: 'loaded' }))).toEqual({ reason: 'UNKNOWN_TOP_LEVEL_KEY', key: 'branch' });
  });

  it('refuses a non-object response', () => {
    for (const r of [null, undefined, 'x', 1, [], [response()]]) {
      expect(failureOf(r)).toEqual({ reason: 'RESPONSE_NOT_AN_OBJECT', key: '<response>' });
    }
  });
});

describe('C13-R3 — nested Thread: node-local pinned-schema semantics', () => {
  const BUNDLE: unknown = JSON.parse(
    readFileSync(join(HARNESS_CODEX_DIR, 'pin', 'vendor', 'json', 'codex_app_server_protocol.schemas.json'), 'utf8'),
  );

  it('C13-R3-A the four direct experimental Thread members: null -> VALID, well-formed non-null -> VALID', () => {
    expect(failureOf(response({ thread: cannedStockThread() }))).toBe('VALID');
    expect(
      failureOf(
        response({ thread: cannedStockThread({ environments: [], extra: {}, canAcceptDirectInput: true, daybreakEnabled: false }) }),
      ),
    ).toBe('VALID');
  });

  it('C13-R3-B a schema-required Thread key missing -> STRUCTURAL_FAILURE (every one of the 13)', () => {
    const required = (resolvePointer(BUNDLE, '#/definitions/v2/Thread') as { required: string[] }).required;
    expect(required).toEqual([
      'cliVersion',
      'createdAt',
      'cwd',
      'ephemeral',
      'id',
      'modelProvider',
      'preview',
      'projectId',
      'sessionId',
      'source',
      'status',
      'turns',
      'updatedAt',
    ]);
    for (const key of required) {
      const thread = cannedStockThread();
      delete thread[key];
      expect(failureOf(response({ thread })), key).toEqual({ reason: 'THREAD_PINNED_SCHEMA_VIOLATION', key: 'thread' });
    }
  });

  it('C13-R3-C a mistyped schema-typed Thread property -> STRUCTURAL_FAILURE', () => {
    expect(failureOf(response({ thread: cannedStockThread({ createdAt: 'x' }) }))).toEqual({
      reason: 'THREAD_PINNED_SCHEMA_VIOLATION',
      key: 'thread',
    });
    expect(failureOf(response({ thread: cannedStockThread({ status: { type: 'sleeping' } }) }))).toEqual({
      reason: 'THREAD_PINNED_SCHEMA_VIOLATION',
      key: 'thread',
    });
    expect(failureOf(response({ thread: 'thr_1' }))).toEqual({ reason: 'THREAD_PINNED_SCHEMA_VIOLATION', key: 'thread' });
  });

  it('C13-R3-E an unknown key DIRECTLY under r.thread -> VALID (the Thread root node is open)', () => {
    expect(failureOf(response({ thread: cannedStockThread({ unexpected: true }) }))).toBe('VALID');
  });

  it('C13-R3-F an unknown key under a closed descendant -> STRUCTURAL_FAILURE, while R3-E passes on the same response', () => {
    const control = cannedThreadResumeResult(SETTINGS, { thread: cannedStockThread({ source: { custom: 'audit' } }) });
    const r3e = cannedThreadResumeResult(SETTINGS, { thread: cannedStockThread({ source: { custom: 'audit' }, unexpected: true }) });
    const r3f = cannedThreadResumeResult(SETTINGS, { thread: cannedStockThread({ source: { custom: 'audit', unexpected: true } }) });
    expect(failureOf(control)).toBe('VALID');
    expect(failureOf(r3e)).toBe('VALID');
    expect(failureOf(r3f)).toEqual({ reason: 'THREAD_PINNED_SCHEMA_VIOLATION', key: 'thread' });
    // The baseline validator reports exactly the pinned oneOf mismatch for it.
    expect(
      validateAgainstSchema(BUNDLE, resolvePointer(BUNDLE, '#/definitions/v2/Thread'), cannedStockThread({ source: { custom: 'audit', unexpected: true } })),
    ).toContain('$.source: 0 oneOf branches matched (exactly 1 required)');
  });

  it('C13-R3-F a second reachable closed node: an unknown member of a turn error codexErrorInfo variant is refused', () => {
    const turn = (codexErrorInfo: unknown): unknown => ({
      id: 'turn_1',
      items: [],
      status: 'failed',
      error: { message: 'failed', codexErrorInfo },
    });
    expect(failureOf(response({ thread: cannedStockThread({ turns: [turn({ httpConnectionFailed: { httpStatusCode: 502 } })] }) }))).toBe(
      'VALID',
    );
    expect(
      failureOf(response({ thread: cannedStockThread({ turns: [turn({ httpConnectionFailed: { httpStatusCode: 502 }, unexpected: 1 })] }) })),
    ).toEqual({ reason: 'THREAD_PINNED_SCHEMA_VIOLATION', key: 'thread' });
  });

  it('keeps every closed node reachable from v2/Thread effective: exactly the 10 source-proven ones', () => {
    const closed: string[] = [];
    const seen = new Set<string>();
    const visit = (node: unknown, pointer: string): void => {
      if (typeof node !== 'object' || node === null) return;
      if (Array.isArray(node)) {
        node.forEach((child, i) => visit(child, `${pointer}/${i}`));
        return;
      }
      const record = node as Record<string, unknown>;
      if (record['additionalProperties'] === false) closed.push(pointer);
      if (typeof record['$ref'] === 'string') {
        const ref = record['$ref'];
        if (!seen.has(ref)) {
          seen.add(ref);
          visit(resolvePointer(BUNDLE, ref), ref);
        }
      }
      for (const [key, child] of Object.entries(record)) if (key !== '$ref') visit(child, `${pointer}/${key}`);
    };
    seen.add('#/definitions/v2/Thread');
    visit(resolvePointer(BUNDLE, '#/definitions/v2/Thread') as JsonSchemaNode, '#/definitions/v2/Thread');
    expect([...new Set(closed)].sort()).toEqual(
      [
        '#/definitions/v2/AsyncUserInputQuestion',
        '#/definitions/v2/CodexErrorInfo/oneOf/1',
        '#/definitions/v2/CodexErrorInfo/oneOf/2',
        '#/definitions/v2/CodexErrorInfo/oneOf/3',
        '#/definitions/v2/CodexErrorInfo/oneOf/4',
        '#/definitions/v2/CodexErrorInfo/oneOf/5',
        '#/definitions/v2/SessionSource/oneOf/1',
        '#/definitions/v2/SessionSource/oneOf/2',
        '#/definitions/v2/SubAgentSource/oneOf/1',
        '#/definitions/v2/SubAgentSource/oneOf/2',
      ].sort(),
    );
  });
});

describe('the validator result', () => {
  it('takes no request parameter, is frozen, deep-freezes what it validated and is recognisable as issued', () => {
    expect(validate.length).toBe(1);
    const r = response();
    const v = validate(r);
    expect(v.status).toBe('VALID');
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen((r['thread'] as Record<string, unknown>)['status'])).toBe(true);
    expect(isIssuedByResumeStructuralValidator(v)).toBe(true);
    expect(isIssuedByResumeStructuralValidator({ status: 'VALID', validated: response() })).toBe(false);
    const f = validate(without('model'));
    expect(isIssuedByResumeStructuralValidator(f)).toBe(true);
    expect(RESUME_STRUCTURAL_FAILURE_REASONS).toContain(f.status === 'STRUCTURAL_FAILURE' ? f.reason : '');
  });
});
