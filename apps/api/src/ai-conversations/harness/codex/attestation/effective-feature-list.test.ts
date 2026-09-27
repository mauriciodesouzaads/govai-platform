// CONT-P5-E1 — strict single-page parser of `experimentalFeature/list` (Dispatch v8 M2; Correction 08 sections 12 and 18;
// Correction 09 section 15 PARSER rows). Pages are the fake app-server fixture's canned answers.

import { describe, expect, it } from 'vitest';

import { cannedFeatureListResult, CANNED_FEATURE_METADATA_SENTINEL } from '../client/fake-app-server.fixture.js';
import {
  EFFECTIVE_FEATURE_LIST_FAILURE_REASONS,
  EFFECTIVE_FEATURE_TARGETS,
  parseEffectiveFeatureListPage as parse,
} from './effective-feature-list.js';

const page = (v1: boolean, v2: boolean, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> =>
  cannedFeatureListResult({ shellSnapshot: v1, shellSnapshotV2: v2 }, overrides);

const entry = (name: string, enabled: unknown): Record<string, unknown> => ({
  name,
  stage: 'stable',
  displayName: null,
  description: null,
  announcement: null,
  enabled,
  defaultEnabled: false,
});

describe('experimentalFeature/list — the two target bits, read independently', () => {
  it('targets shell_snapshot (V1) and shell_snapshot_v2 (V2)', () => {
    expect(EFFECTIVE_FEATURE_TARGETS).toEqual({ v1: 'shell_snapshot', v2: 'shell_snapshot_v2' });
  });

  it('false / false -> VALID and complete; V1 true or V2 true is reported as such (the admission blocks on it)', () => {
    expect(parse(page(false, false))).toEqual({ status: 'VALID', shellSnapshotEffective: false, shellSnapshotV2Effective: false, complete: true });
    expect(parse(page(true, false))).toMatchObject({ status: 'VALID', shellSnapshotEffective: true, shellSnapshotV2Effective: false });
    expect(parse(page(false, true))).toMatchObject({ status: 'VALID', shellSnapshotEffective: false, shellSnapshotV2Effective: true });
  });

  it('never infers V2 from V1 (each bit comes from its own entry, in any order)', () => {
    const reversed = { data: [entry('shell_snapshot_v2', true), entry('shell_snapshot', false)], nextCursor: null };
    expect(parse(reversed)).toMatchObject({ shellSnapshotEffective: false, shellSnapshotV2Effective: true });
  });
});

describe('fail closed on every malformed page (bounded reason enum)', () => {
  const cases: readonly (readonly [string, unknown, string])[] = [
    ['result not an object', [], 'RESULT_NOT_AN_OBJECT'],
    ['result null', null, 'RESULT_NOT_AN_OBJECT'],
    ['unknown top-level shape', { ...page(false, false), total: 3 }, 'UNKNOWN_TOP_LEVEL_KEY'],
    ['data not an array', { data: {}, nextCursor: null }, 'DATA_NOT_AN_ARRAY'],
    ['data missing', { nextCursor: null }, 'DATA_NOT_AN_ARRAY'],
    ['entry not an object', { data: ['shell_snapshot'], nextCursor: null }, 'ENTRY_NOT_AN_OBJECT'],
    ['entry name not a string', { data: [{ ...entry('x', true), name: 1 }], nextCursor: null }, 'ENTRY_NAME_NOT_A_STRING'],
    ['malformed enabled on a target', { data: [entry('shell_snapshot', 'false'), entry('shell_snapshot_v2', false)], nextCursor: null }, 'ENTRY_ENABLED_NOT_A_BOOLEAN'],
    ['malformed enabled on another entry', { data: [entry('other', null), entry('shell_snapshot', false), entry('shell_snapshot_v2', false)], nextCursor: null }, 'ENTRY_ENABLED_NOT_A_BOOLEAN'],
    ['missing V1', { data: [entry('shell_snapshot_v2', false)], nextCursor: null }, 'TARGET_MISSING'],
    ['missing V2', { data: [entry('shell_snapshot', false)], nextCursor: null }, 'TARGET_MISSING'],
    ['duplicate V1', { data: [entry('shell_snapshot', false), entry('shell_snapshot', false), entry('shell_snapshot_v2', false)], nextCursor: null }, 'TARGET_DUPLICATE'],
    ['duplicate V2', { data: [entry('shell_snapshot', false), entry('shell_snapshot_v2', false), entry('shell_snapshot_v2', true)], nextCursor: null }, 'TARGET_DUPLICATE'],
    ['unexpected continuation cursor', page(false, false, { nextCursor: '3' }), 'UNEXPECTED_CONTINUATION_CURSOR'],
    ['nextCursor absent', { data: [entry('shell_snapshot', false), entry('shell_snapshot_v2', false)] }, 'NEXT_CURSOR_ABSENT'],
    ['nextCursor of another type', page(false, false, { nextCursor: 3 }), 'NEXT_CURSOR_NOT_NULL'],
  ];
  for (const [label, result, reason] of cases) {
    it(`${label} -> ${reason}`, () => {
      expect(parse(result)).toEqual({ status: 'INVALID', reason });
      expect(EFFECTIVE_FEATURE_LIST_FAILURE_REASONS).toContain(reason);
    });
  }
});

describe('SINK — nothing of the page but the two bits leaves the parser', () => {
  it('drops names, stages, display names, descriptions and announcements', () => {
    const parsed = parse(page(false, false));
    expect(Object.keys(parsed).sort()).toEqual(['complete', 'shellSnapshotEffective', 'shellSnapshotV2Effective', 'status']);
    expect(JSON.stringify(parsed)).not.toContain(CANNED_FEATURE_METADATA_SENTINEL);
    const malformed = parse({ data: [{ name: CANNED_FEATURE_METADATA_SENTINEL, enabled: 'x' }], nextCursor: null });
    expect(JSON.stringify(malformed)).not.toContain(CANNED_FEATURE_METADATA_SENTINEL);
    expect(Object.isFrozen(parsed) && Object.isFrozen(malformed)).toBe(true);
  });
});
