// CONT-P5-A — EXPERIMENTAL_SOURCE_INVENTORY re-derived from the vendored generated wire (dispatch §2, §4).
//
// The inventory table is never trusted on its own: every entry's category is recomputed here from
// ./generated/** (present → category 2, absent → category 1), the covered-surface sets are compared with the
// dispatch's enumeration, and the category (1) fields of the covered methods are proven INEXPRESSIBLE in the
// selected generated types at compile time (`tsc` fails if any of them becomes a key).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CODEX_EXPERIMENTAL_INVENTORY, type CodexExperimentalInventoryEntry } from './experimental-inventory.js';
import type { ThreadForkParams } from './generated/v2/ThreadForkParams';
import type { ThreadForkResponse } from './generated/v2/ThreadForkResponse';
import type { ThreadResumeParams } from './generated/v2/ThreadResumeParams';
import type { ThreadResumeResponse } from './generated/v2/ThreadResumeResponse';
import type { ThreadStartParams } from './generated/v2/ThreadStartParams';
import type { ThreadStartResponse } from './generated/v2/ThreadStartResponse';
import type { TurnStartParams } from './generated/v2/TurnStartParams';
import type { TurnSteerParams } from './generated/v2/TurnSteerParams';
import {
  HARNESS_CODEX_DIR,
  aliasBody,
  clientRequestParamsTypes,
  listVendoredTypeScript,
  readVendoredBody,
  scanAlias,
  stripTsComments,
  topLevelProperties,
  unionMethods,
  vendoredFileForType,
} from './vendored-schema.js';

const ABSENT = 'EXPERIMENTAL_ABSENT_FROM_GENERATED_WIRE';
const REPRESENTABLE = 'EXPERIMENTAL_REPRESENTABLE_ON_GENERATED_WIRE';

const FILES = listVendoredTypeScript();
const bodies = new Map(FILES.map((f) => [f, readVendoredBody(f)] as const));
const body = (rel: string): string => {
  const text = bodies.get(rel);
  if (text === undefined) throw new Error(`not vendored: ${rel}`);
  return text;
};
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function taggedArmAnywhere(tag: string, wire: string): boolean {
  const re = new RegExp(`(?:"${escapeRe(tag)}"|\\b${escapeRe(tag)})\\s*:\\s*"${escapeRe(wire)}"`);
  return FILES.some((f) => re.test(stripTsComments(body(f))));
}

/** Presence of an inventory item on the vendored generated wire — the ONLY classification criterion. */
function presentOnGeneratedWire(e: CodexExperimentalInventoryEntry): boolean {
  if (e.kind === 'method') return unionMethods(body(`${e.container}.ts`), e.container).includes(e.wire);
  const file = vendoredFileForType(e.container, FILES);
  if (file === null) {
    // No file of its own: either flattened into a containing alias (tagged arm) or declared nowhere at all.
    return e.kind === 'variant' && e.tag !== null ? taggedArmAnywhere(e.tag, e.wire) : false;
  }
  const alias = aliasBody(body(file), e.container);
  if (alias === null) return false;
  const scan = scanAlias(alias);
  if (e.kind === 'field') return scan.keys.has(e.wire);
  if (e.tag !== null) return scan.pairs.has(`${e.tag}=${e.wire}`);
  return scan.literals.has(e.wire) || scan.keys.has(e.wire);
}

/** Compiles only when `K` is NOT a key of `T` (a key turns the rest tuple into `[never]`). */
function assertInexpressible<T, K extends string>(..._proof: K extends keyof T ? [never] : []): true {
  return true;
}

describe('EXPERIMENTAL_SOURCE_INVENTORY — every #[experimental("…")] string annotation at the pin', () => {
  it('lists 155 annotations once each, with a commit-addressed anchor', () => {
    expect(CODEX_EXPERIMENTAL_INVENTORY).toHaveLength(155);
    const anchors = CODEX_EXPERIMENTAL_INVENTORY.map((e) => e.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const a of anchors) expect(a).toMatch(/^codex-rs\/app-server-protocol\/src\/[a-z0-9_/]+\.rs#L\d+$/);
    expect(Object.isFrozen(CODEX_EXPERIMENTAL_INVENTORY)).toBe(true);
  });

  it('places EVERY entry in the category its presence on the vendored generated wire dictates', () => {
    const misplaced = CODEX_EXPERIMENTAL_INVENTORY.filter(
      (e) => presentOnGeneratedWire(e) !== (e.category === REPRESENTABLE),
    ).map((e) => `${e.reason} @ ${e.anchor}`);
    expect(misplaced).toEqual([]);
  });

  it('has the mechanically derived category counts (1) = 128, (2) = 27', () => {
    const count = (category: string, kind: string): number =>
      CODEX_EXPERIMENTAL_INVENTORY.filter((e) => e.category === category && e.kind === kind).length;
    expect({ method: count(ABSENT, 'method'), field: count(ABSENT, 'field'), variant: count(ABSENT, 'variant') }).toEqual({
      method: 61,
      field: 63,
      variant: 4,
    });
    expect({
      method: count(REPRESENTABLE, 'method'),
      field: count(REPRESENTABLE, 'field'),
      variant: count(REPRESENTABLE, 'variant'),
    }).toEqual({ method: 22, field: 1, variant: 4 });
  });

  it('matches the dispatch §2 enumeration of category (1) items for the covered methods exactly', () => {
    const expected: Record<string, string[]> = {
      'thread/start': [
        'activePermissionProfile',
        'allowProviderModelFallback',
        'dynamicTools',
        'environments',
        'experimentalRawEvents',
        'historyMode',
        'mockExperimentalField',
        'multiAgentMode',
        'permissions',
        'projectId',
        'runtimeWorkspaceRoots',
        'selectedCapabilityRoots',
      ],
      'thread/resume': [
        'activePermissionProfile',
        'history',
        'initialTurnsPage',
        'multiAgentMode',
        'path',
        'permissions',
        'runtimeWorkspaceRoots',
      ],
      'thread/fork': [
        'activePermissionProfile',
        'beforeTurnId',
        'deferGoalContinuation',
        'multiAgentMode',
        'path',
        'permissions',
        'runtimeWorkspaceRoots',
      ],
      'turn/start': [
        'additionalContext',
        'collaborationMode',
        'cyberAccessProgram',
        'environments',
        'multiAgentMode',
        'permissions',
        'responsesapiClientMetadata',
        'runtimeWorkspaceRoots',
      ],
      'turn/steer': ['additionalContext', 'responsesapiClientMetadata'],
    };
    for (const [method, names] of Object.entries(expected)) {
      const entries = CODEX_EXPERIMENTAL_INVENTORY.filter((e) => e.reason.startsWith(`${method}.`));
      expect([...new Set(entries.map((e) => e.reason.slice(method.length + 1)))].sort()).toEqual(names);
      expect(new Set(entries.map((e) => e.category))).toEqual(new Set([ABSENT]));
    }
  });

  it('has exactly one category (2) item on the covered surface: askForApproval.granular', () => {
    const covered = ['thread/start', 'thread/resume', 'thread/fork', 'turn/start', 'turn/steer'];
    const onCovered = CODEX_EXPERIMENTAL_INVENTORY.filter(
      (e) =>
        e.category === REPRESENTABLE &&
        (e.positions.some((p) => covered.includes(p.method)) || e.requestMethods.some((m) => covered.includes(m))),
    );
    expect(onCovered.map((e) => e.reason)).toEqual(['askForApproval.granular']);
    const granular = onCovered[0]!;
    expect(granular).toMatchObject({ kind: 'variant', container: 'AskForApproval', wire: 'granular', tag: null });
    expect(granular.anchor).toBe('codex-rs/app-server-protocol/src/protocol/v2/shared.rs#L181');
    // Faithfully present on the wire (never edited out of the vendored type).
    expect(body('v2/AskForApproval.ts')).toContain('{ "granular": {');
  });

  it('marks the cfg(test) derive fixtures and proves they are declared nowhere in the generated tree', () => {
    const fixtures = CODEX_EXPERIMENTAL_INVENTORY.filter((e) => e.cfgTestFixture);
    expect(fixtures.map((e) => e.reason).sort()).toEqual(['enum/named', 'enum/tuple', 'enum/unit', 'field/optionalCollection']);
    for (const e of fixtures) {
      expect(e.category).toBe(ABSENT);
      expect(e.anchor.startsWith('codex-rs/app-server-protocol/src/experimental_api.rs#L')).toBe(true);
      expect(FILES.some((f) => new RegExp(`\\b${e.container}\\b`).test(body(f)))).toBe(false);
    }
  });

  it('re-derives requestMethods and variant positions from the generated ClientRequest + params types', () => {
    const paramsOf = clientRequestParamsTypes(body('ClientRequest.ts'));
    expect(paramsOf.size).toBe(unionMethods(body('ClientRequest.ts'), 'ClientRequest').length);
    const methodsOfType = new Map<string, string[]>();
    for (const [method, type] of paramsOf) methodsOfType.set(type, [...(methodsOfType.get(type) ?? []), method]);
    for (const e of CODEX_EXPERIMENTAL_INVENTORY) {
      const expectedRequestMethods = e.kind === 'method' ? [] : [...(methodsOfType.get(e.container) ?? [])].sort();
      expect({ reason: e.reason, requestMethods: [...e.requestMethods] }).toEqual({
        reason: e.reason,
        requestMethods: expectedRequestMethods,
      });
      if (e.kind !== 'variant' || e.cfgTestFixture) {
        expect(e.positions).toEqual([]);
        continue;
      }
      const positions: { method: string; field: string | null }[] = [];
      for (const [type, methods] of methodsOfType) {
        const file = vendoredFileForType(type, FILES);
        if (file === null) continue;
        if (type === e.container) {
          for (const m of methods) positions.push({ method: m, field: null });
          continue;
        }
        const alias = aliasBody(body(file), type);
        if (alias === null) continue;
        for (const prop of topLevelProperties(alias)) {
          if (new RegExp(`\\b${e.container}\\b`).test(prop.type)) {
            for (const m of methods) positions.push({ method: m, field: prop.name });
          }
        }
      }
      positions.sort((a, b) => (a.method + (a.field ?? '')).localeCompare(b.method + (b.field ?? '')));
      expect({ reason: e.reason, positions: [...e.positions] }).toEqual({ reason: e.reason, positions });
    }
  });

  it('proves the covered category (1) fields INEXPRESSIBLE in the selected generated types (type-level)', () => {
    const proofs = [
      assertInexpressible<ThreadForkParams, 'beforeTurnId'>(),
      assertInexpressible<ThreadForkParams, 'deferGoalContinuation'>(),
      assertInexpressible<ThreadForkParams, 'path'>(),
      assertInexpressible<ThreadForkParams, 'permissions'>(),
      assertInexpressible<ThreadForkParams, 'runtimeWorkspaceRoots'>(),
      assertInexpressible<ThreadForkResponse, 'activePermissionProfile'>(),
      assertInexpressible<ThreadForkResponse, 'multiAgentMode'>(),
      assertInexpressible<ThreadForkResponse, 'runtimeWorkspaceRoots'>(),
      assertInexpressible<ThreadResumeParams, 'history'>(),
      assertInexpressible<ThreadResumeParams, 'initialTurnsPage'>(),
      assertInexpressible<ThreadResumeParams, 'path'>(),
      assertInexpressible<ThreadResumeParams, 'permissions'>(),
      assertInexpressible<ThreadResumeParams, 'runtimeWorkspaceRoots'>(),
      assertInexpressible<ThreadResumeResponse, 'activePermissionProfile'>(),
      assertInexpressible<ThreadResumeResponse, 'initialTurnsPage'>(),
      assertInexpressible<ThreadResumeResponse, 'multiAgentMode'>(),
      assertInexpressible<ThreadResumeResponse, 'runtimeWorkspaceRoots'>(),
      assertInexpressible<ThreadStartParams, 'allowProviderModelFallback'>(),
      assertInexpressible<ThreadStartParams, 'dynamicTools'>(),
      assertInexpressible<ThreadStartParams, 'environments'>(),
      assertInexpressible<ThreadStartParams, 'experimentalRawEvents'>(),
      assertInexpressible<ThreadStartParams, 'historyMode'>(),
      assertInexpressible<ThreadStartParams, 'mockExperimentalField'>(),
      assertInexpressible<ThreadStartParams, 'multiAgentMode'>(),
      assertInexpressible<ThreadStartParams, 'permissions'>(),
      assertInexpressible<ThreadStartParams, 'projectId'>(),
      assertInexpressible<ThreadStartParams, 'runtimeWorkspaceRoots'>(),
      assertInexpressible<ThreadStartParams, 'selectedCapabilityRoots'>(),
      assertInexpressible<ThreadStartResponse, 'activePermissionProfile'>(),
      assertInexpressible<ThreadStartResponse, 'multiAgentMode'>(),
      assertInexpressible<ThreadStartResponse, 'runtimeWorkspaceRoots'>(),
      assertInexpressible<TurnStartParams, 'additionalContext'>(),
      assertInexpressible<TurnStartParams, 'collaborationMode'>(),
      assertInexpressible<TurnStartParams, 'cyberAccessProgram'>(),
      assertInexpressible<TurnStartParams, 'environments'>(),
      assertInexpressible<TurnStartParams, 'multiAgentMode'>(),
      assertInexpressible<TurnStartParams, 'permissions'>(),
      assertInexpressible<TurnStartParams, 'responsesapiClientMetadata'>(),
      assertInexpressible<TurnStartParams, 'runtimeWorkspaceRoots'>(),
      assertInexpressible<TurnSteerParams, 'additionalContext'>(),
      assertInexpressible<TurnSteerParams, 'responsesapiClientMetadata'>(),
    ];
    // One compile-time proof per (generated type, key) pair of the covered category (1) fields.
    const pairs = new Set(
      CODEX_EXPERIMENTAL_INVENTORY.filter((e) =>
        ['thread/start.', 'thread/resume.', 'thread/fork.', 'turn/start.', 'turn/steer.'].some((p) => e.reason.startsWith(p)),
      ).map((e) => `${e.container}.${e.wire}`),
    );
    expect(proofs).toHaveLength(pairs.size);
    expect(proofs.every((p) => p)).toBe(true);
  });

  it('key-scans the vendored *.ts: no category (1) field key appears on its generated container', () => {
    let scanned = 0;
    let containerAbsent = 0;
    for (const e of CODEX_EXPERIMENTAL_INVENTORY.filter((x) => x.kind === 'field' && x.category === ABSENT && !x.cfgTestFixture)) {
      const file = vendoredFileForType(e.container, FILES);
      if (file === null) {
        // The container itself is an experimental method's type, dropped whole from the stable export.
        expect(FILES.some((f) => new RegExp(`export type ${e.container}\\b`).test(body(f))), e.reason).toBe(false);
        containerAbsent += 1;
        continue;
      }
      const alias = aliasBody(body(file), e.container);
      expect(alias, e.reason).not.toBeNull();
      expect(scanAlias(alias!).keys.has(e.wire), `${e.container}.${e.wire}`).toBe(false);
      scanned += 1;
    }
    expect(scanned + containerAbsent).toBe(62);
    expect(scanned).toBeGreaterThanOrEqual(41);
  });
});

describe('category (3) NON_EXPERIMENTAL_UPSTREAM_BUT_GOVAI_FORBIDDEN — a different axis, outside the inventory', () => {
  it('is faithfully present on the generated wire and carries no #[experimental] annotation', () => {
    const literalsOf = (file: string, type: string): ReadonlySet<string> => scanAlias(aliasBody(body(file), type)!).literals;
    expect([...literalsOf('v2/ApprovalsReviewer.ts', 'ApprovalsReviewer')].sort()).toEqual([
      'auto_review',
      'guardian_subagent',
      'user',
    ]);
    expect(literalsOf('v2/SandboxMode.ts', 'SandboxMode').has('danger-full-access')).toBe(true);
    expect(literalsOf('v2/AskForApproval.ts', 'AskForApproval').has('never')).toBe(true);
    const sandboxPolicy = scanAlias(aliasBody(body('v2/SandboxPolicy.ts'), 'SandboxPolicy')!).pairs;
    expect(sandboxPolicy.has('type=dangerFullAccess')).toBe(true);
    expect(sandboxPolicy.has('type=externalSandbox')).toBe(true);

    for (const e of CODEX_EXPERIMENTAL_INVENTORY) {
      expect(['ApprovalsReviewer', 'SandboxMode', 'SandboxPolicy']).not.toContain(e.container);
      if (e.container === 'AskForApproval') expect(e.wire).toBe('granular');
    }
  });
});

describe('EXPERIMENTAL_SOURCE_INVENTORY.md — the human-readable mirror', () => {
  it('lists every entry and the same category counts as the code', () => {
    const md = readFileSync(join(HARNESS_CODEX_DIR, 'protocol', 'EXPERIMENTAL_SOURCE_INVENTORY.md'), 'utf8');
    for (const e of CODEX_EXPERIMENTAL_INVENTORY) expect(md).toContain(`\`${e.reason}\``);
    expect(md).toContain('| (1) EXPERIMENTAL_ABSENT_FROM_GENERATED_WIRE | 61 | 63 | 4 | 128 |');
    expect(md).toContain('| (2) EXPERIMENTAL_REPRESENTABLE_ON_GENERATED_WIRE | 22 | 1 | 4 | 27 |');
    expect(md).toContain('DERIVATION_MODE       = VERBATIM_SOURCE_DERIVED');
  });
});
