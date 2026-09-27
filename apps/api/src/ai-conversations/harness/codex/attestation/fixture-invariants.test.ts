// CONT-P5-E1 — fixture and project invariants (Dispatch v8 M5; Correction 08 sections 6-7 and 18; Correction 09 section
// 4). Every directory here is a disposable temp tree; nothing outside it is written and nothing is read beyond the exact
// candidates the invariants name.

import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeDisposableDirs } from '../client/fake-app-server.fixture.js';
import {
  assertE1ControlledEnvironmentAcknowledged,
  classifyFixtureConfigText,
  E1_ACKNOWLEDGED_ASSUMPTIONS,
  E1_CONTROLLED_ENVIRONMENT_ASSUMPTION,
  E1_FIXTURE_CONFIG_BYTE_COUNT,
  E1_FIXTURE_CONFIG_SHA256,
  E1_FIXTURE_CONFIG_TEXT,
  E1_SAME_USER_EXTERNAL_WRITER_ASSUMPTION,
  E1ControlledEnvironmentNotAcknowledged,
  FIXTURE_CONFIG_MAX_BYTES,
  lexicalAncestorsInclusive,
  projectTrustKey,
  readFixtureConfigState,
  runPostConsumeDetector,
  trustTargetOf,
  verifyAdmissionPreconditions,
  verifyInvPath,
  verifyInvProj,
  verifyInvRepo,
} from './fixture-invariants.js';

const dirs = makeDisposableDirs('govai-cont-p5e1-invariants-');
afterAll(() => rmSync(dirs.root, { recursive: true, force: true }));

let serial = 0;
function tree(...segments: string[]): string {
  serial += 1;
  const path = join(dirs.root, `t${serial}`, ...segments);
  mkdirSync(path, { recursive: true });
  return path;
}

function codexHome(configText: string | null = E1_FIXTURE_CONFIG_TEXT): string {
  const home = tree('codex-home');
  if (configText !== null) writeFileSync(join(home, 'config.toml'), configText);
  return home;
}

const STATE_1_TEXT = (key: string): string => `${E1_FIXTURE_CONFIG_TEXT}\n[projects.${JSON.stringify(key)}]\ntrust_level = "trusted"\n`;

describe('INV-PATH — absolute, dot-free, realpath == lexical', () => {
  it('accepts a canonical absolute path', () => {
    expect(verifyInvPath(tree('work'))).toEqual({ ok: true });
  });

  it('refuses relative, dot-segment, symlinked, unresolvable and non-string paths', () => {
    const work = tree('work');
    const link = join(dirs.root, `link-${serial}`);
    symlinkSync(work, link);
    expect(verifyInvPath('relative/work')).toMatchObject({ ok: false, reason: 'INV_PATH_NOT_ABSOLUTE' });
    expect(verifyInvPath(`${work}/.`)).toMatchObject({ ok: false, reason: 'INV_PATH_DOT_SEGMENT' });
    expect(verifyInvPath(`${work}/../work`)).toMatchObject({ ok: false, reason: 'INV_PATH_DOT_SEGMENT' });
    expect(verifyInvPath(link)).toMatchObject({ ok: false, invariant: 'INV-PATH', reason: 'INV_PATH_REALPATH_DIFFERS' });
    expect(verifyInvPath(`${work}/`)).toMatchObject({ ok: false, reason: 'INV_PATH_REALPATH_DIFFERS' });
    expect(verifyInvPath(join(work, 'missing'))).toMatchObject({ ok: false, reason: 'INV_PATH_UNRESOLVABLE' });
    expect(verifyInvPath(undefined)).toMatchObject({ ok: false, reason: 'INV_PATH_NOT_A_STRING' });
  });
});

describe('INV-PROJ — no <dir>/.codex/config.toml from the cwd to "/" inclusive (lstat, exact candidate)', () => {
  it('walks every lexical ancestor, "/" included', () => {
    expect(lexicalAncestorsInclusive('/a/b/c')).toEqual(['/a/b/c', '/a/b', '/a', '/']);
    expect(lexicalAncestorsInclusive('/')).toEqual(['/']);
  });

  it('accepts a chain with no project config', () => {
    expect(verifyInvProj(tree('proj', 'work'), codexHome())).toEqual({ ok: true });
  });

  it('refuses a project config at the cwd or at any ancestor', () => {
    const work = tree('proj', 'a', 'b');
    const top = join(work, '..', '..');
    mkdirSync(join(top, '.codex'));
    writeFileSync(join(top, '.codex', 'config.toml'), '[features]\nshell_snapshot = true\n');
    expect(verifyInvProj(work, codexHome())).toEqual({
      ok: false,
      invariant: 'INV-PROJ',
      reason: 'INV_PROJ_PROJECT_CONFIG_PRESENT',
      at: join(top, '.codex', 'config.toml'),
    });
    const cwdLevel = tree('proj2');
    mkdirSync(join(cwdLevel, '.codex'));
    writeFileSync(join(cwdLevel, '.codex', 'config.toml'), '');
    expect(verifyInvProj(cwdLevel, codexHome())).toMatchObject({ ok: false, reason: 'INV_PROJ_PROJECT_CONFIG_PRESENT' });
  });

  it('fails closed on any lstat result other than ENOENT (a `.codex` FILE gives ENOTDIR)', () => {
    const work = tree('proj', 'w');
    writeFileSync(join(work, '.codex'), 'not a directory');
    expect(verifyInvProj(work, codexHome())).toMatchObject({ ok: false, reason: 'INV_PROJ_LSTAT_NOT_ENOENT' });
  });

  it('refuses a fixture CODEX_HOME whose basename is ".codex" (the loader exception is never exercised)', () => {
    const home = tree('fixture', '.codex');
    expect(verifyInvProj(tree('work'), home)).toMatchObject({ ok: false, reason: 'INV_PROJ_CODEX_HOME_SHAPE_FORBIDDEN' });
  });
});

describe('INV-REPO — topology (a) one real repository at W, or (b) none on the chain', () => {
  it('(b) no .git entry anywhere on the chain', () => {
    expect(verifyInvRepo(tree('plain', 'work'))).toEqual({ ok: true, topology: { topology: 'B_NO_REPOSITORY' } });
  });

  it('(a) W/.git is a directory with a regular HEAD; a cwd below W resolves to W', () => {
    const w = tree('repo');
    mkdirSync(join(w, '.git'));
    writeFileSync(join(w, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const cwd = join(w, 'sub');
    mkdirSync(cwd);
    expect(verifyInvRepo(cwd)).toEqual({ ok: true, topology: { topology: 'A_WORKSPACE_REPOSITORY', workspaceRoot: w } });
    expect(trustTargetOf(cwd, { topology: 'A_WORKSPACE_REPOSITORY', workspaceRoot: w })).toBe(w);
    expect(trustTargetOf(cwd, { topology: 'B_NO_REPOSITORY' })).toBe(cwd);
    expect(projectTrustKey(w)).toBe(w);
  });

  it('rejects a linked worktree / separate git-dir (`.git` file), an alias (`.git` symlink), a HEAD-less .git and nested roots', () => {
    const worktree = tree('worktree');
    writeFileSync(join(worktree, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');
    expect(verifyInvRepo(worktree)).toMatchObject({ ok: false, invariant: 'INV-REPO', reason: 'INV_REPO_MARKER_NOT_A_DIRECTORY' });

    const real = tree('real-repo');
    mkdirSync(join(real, '.git'));
    writeFileSync(join(real, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const alias = tree('alias');
    symlinkSync(join(real, '.git'), join(alias, '.git'));
    expect(verifyInvRepo(alias)).toMatchObject({ ok: false, reason: 'INV_REPO_MARKER_NOT_A_DIRECTORY' });

    const headless = tree('headless');
    mkdirSync(join(headless, '.git'));
    expect(verifyInvRepo(headless)).toMatchObject({ ok: false, reason: 'INV_REPO_HEAD_MISSING' });

    const outer = tree('outer');
    mkdirSync(join(outer, '.git'));
    writeFileSync(join(outer, '.git', 'HEAD'), 'x\n');
    const inner = join(outer, 'inner');
    mkdirSync(join(inner, '.git'), { recursive: true });
    writeFileSync(join(inner, '.git', 'HEAD'), 'x\n');
    expect(verifyInvRepo(inner)).toMatchObject({ ok: false, reason: 'INV_REPO_AMBIGUOUS_ROOTS' });
    expect(verifyInvRepo(join(outer, '.git'))).toMatchObject({ ok: false, reason: 'INV_REPO_CWD_INSIDE_GIT_DIRECTORY' });
  });
});

describe('FIXTURE_CONFIG_STATE — semantic, STATE_0 / STATE_1 / UNAUTHORIZED', () => {
  const K = '/Users/Shared/govai-e1-fixture/work';

  it('binds the sealed 34-byte STATE_0 fixture config', () => {
    expect(E1_FIXTURE_CONFIG_TEXT).toBe('[features]\nshell_snapshot = false\n');
    expect(Buffer.byteLength(E1_FIXTURE_CONFIG_TEXT)).toBe(E1_FIXTURE_CONFIG_BYTE_COUNT);
    expect(E1_FIXTURE_CONFIG_SHA256).toBe('4a34b508f14cca64f91c78ecc8dbbc3f4d728c9cc542698cce33f79d33f89e24');
  });

  it('classifies by structure, never bytes: STATE_0 and STATE_1 in the forms the pinned server writes', () => {
    expect(classifyFixtureConfigText(E1_FIXTURE_CONFIG_TEXT, [])).toEqual({ state: 'STATE_0' });
    expect(classifyFixtureConfigText('# fixture\n[features]  # table\n  shell_snapshot=false   # off\n\n', [])).toEqual({ state: 'STATE_0' });
    expect(classifyFixtureConfigText('features.shell_snapshot = false\n', [])).toEqual({ state: 'STATE_0' });
    expect(classifyFixtureConfigText(STATE_1_TEXT(K), [K])).toEqual({ state: 'STATE_1', trustKey: K });
    expect(classifyFixtureConfigText(`${E1_FIXTURE_CONFIG_TEXT}[projects]\n[projects.'${K}']\ntrust_level = 'trusted'\n`, [K])).toEqual({
      state: 'STATE_1',
      trustKey: K,
    });
  });

  it('UNAUTHORIZED on every other content (bounded reason)', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['[features]\nshell_snapshot = true\n', 'FIXTURE_CONFIG_FEATURES_CHANGED'],
      ['[features]\nshell_snapshot = false\nshell_snapshot_v2 = false\n', 'FIXTURE_CONFIG_FEATURES_CHANGED'],
      ['', 'FIXTURE_CONFIG_FEATURES_CHANGED'],
      // A key written after `[features]` belongs to that table (TOML semantics), not to the document root.
      [`${E1_FIXTURE_CONFIG_TEXT}model = "gpt"\n`, 'FIXTURE_CONFIG_FEATURES_CHANGED'],
      [`model = "gpt"\n${E1_FIXTURE_CONFIG_TEXT}`, 'FIXTURE_CONFIG_UNEXPECTED_TOP_LEVEL_KEY'],
      [`projects = "x"\n${E1_FIXTURE_CONFIG_TEXT}`, 'FIXTURE_CONFIG_PROJECTS_MALFORMED'],
      [`${STATE_1_TEXT(K)}[projects."/Users/Shared/other"]\ntrust_level = "trusted"\n`, 'FIXTURE_CONFIG_PROJECTS_ENTRY_COUNT'],
      [STATE_1_TEXT('/Users/Shared/not-admitted'), 'FIXTURE_CONFIG_TRUST_KEY_NOT_ALLOWED'],
      [STATE_1_TEXT(K).replace('"trusted"', '"untrusted"'), 'FIXTURE_CONFIG_TRUST_LEVEL_NOT_TRUSTED'],
      [`${STATE_1_TEXT(K)}extra = true\n`, 'FIXTURE_CONFIG_PROJECT_FIELDS_CHANGED'],
      ['features = { shell_snapshot = false }\n', 'FIXTURE_CONFIG_UNPARSEABLE'],
      ['[[features]]\nshell_snapshot = false\n', 'FIXTURE_CONFIG_UNPARSEABLE'],
      ['[features]\nshell_snapshot = 0\n', 'FIXTURE_CONFIG_UNPARSEABLE'],
      ['[features]\nshell_snapshot = false\nshell_snapshot = false\n', 'FIXTURE_CONFIG_UNPARSEABLE'],
      ['[features]\nshell_snapshot = false\n[features]\n', 'FIXTURE_CONFIG_UNPARSEABLE'],
      ['[features]\nshell_snapshot = """false"""\n', 'FIXTURE_CONFIG_UNPARSEABLE'],
      ['[features\nshell_snapshot = false\n', 'FIXTURE_CONFIG_UNPARSEABLE'],
      ['[features]\nshell_snapshot = false trailing\n', 'FIXTURE_CONFIG_UNPARSEABLE'],
    ];
    for (const [text, reason] of cases) {
      expect(classifyFixtureConfigText(text, [K]), JSON.stringify(text)).toEqual({ state: 'UNAUTHORIZED', reason });
    }
  });

  it('reads exactly CODEX_HOME/config.toml, reports sealed byte identity, and never needs auth.json', () => {
    const home = codexHome();
    mkdirSync(join(home, 'auth.json')); // reading it would fail: the classification proves it is never read
    expect(readFixtureConfigState(home, [])).toEqual({ classification: { state: 'STATE_0' }, sealedStateZeroBytes: true });
    const reformatted = codexHome('[features]\nshell_snapshot = false # same meaning\n');
    expect(readFixtureConfigState(reformatted, [])).toEqual({ classification: { state: 'STATE_0' }, sealedStateZeroBytes: false });
  });

  it('fails closed on a missing, symlinked, oversized, non-UTF-8 or non-regular config and a non-canonical CODEX_HOME', () => {
    expect(readFixtureConfigState(codexHome(null), []).classification).toEqual({ state: 'UNAUTHORIZED', reason: 'FIXTURE_CONFIG_MISSING' });
    const symlinked = codexHome(null);
    const target = join(tree('elsewhere'), 'config.toml');
    writeFileSync(target, E1_FIXTURE_CONFIG_TEXT);
    symlinkSync(target, join(symlinked, 'config.toml'));
    expect(readFixtureConfigState(symlinked, []).classification).toEqual({ state: 'UNAUTHORIZED', reason: 'FIXTURE_CONFIG_NOT_A_REGULAR_FILE' });
    const directory = codexHome(null);
    mkdirSync(join(directory, 'config.toml'));
    expect(readFixtureConfigState(directory, []).classification).toEqual({ state: 'UNAUTHORIZED', reason: 'FIXTURE_CONFIG_NOT_A_REGULAR_FILE' });
    const big = codexHome(`${E1_FIXTURE_CONFIG_TEXT}#${'x'.repeat(FIXTURE_CONFIG_MAX_BYTES)}\n`);
    expect(readFixtureConfigState(big, []).classification).toEqual({ state: 'UNAUTHORIZED', reason: 'FIXTURE_CONFIG_TOO_LARGE' });
    const binary = codexHome(null);
    writeFileSync(join(binary, 'config.toml'), Buffer.from([0x5b, 0xff, 0xfe, 0x5d, 0x0a]));
    expect(readFixtureConfigState(binary, []).classification).toEqual({ state: 'UNAUTHORIZED', reason: 'FIXTURE_CONFIG_NOT_UTF8' });
    const home = codexHome();
    const alias = join(dirs.root, `home-alias-${serial}`);
    symlinkSync(home, alias);
    expect(readFixtureConfigState(alias, []).classification).toEqual({ state: 'UNAUTHORIZED', reason: 'FIXTURE_CODEX_HOME_NOT_CANONICAL' });
  });
});

describe('admission pre-checks gate token issue; post-consume checks are DETECTORS', () => {
  it('verifies INV-* for the requested, launch and known history cwds and FIXTURE_CONFIG_STATE, then returns the proof', () => {
    const home = codexHome();
    const requested = tree('work');
    const launch = tree('launch');
    const result = verifyAdmissionPreconditions({
      codexHome: home,
      launchCwd: launch,
      requestedCwd: requested,
      knownHistoryCwds: [tree('history')],
      allowedTrustKeys: [],
      requireSealedStateZeroBytes: true,
    });
    expect(result).toMatchObject({
      status: 'VERIFIED',
      proof: {
        requestedCwd: requested,
        requestedCwdTopology: { topology: 'B_NO_REPOSITORY' },
        fixtureConfigState: 'STATE_0',
        fixtureTrustKey: null,
        sealedStateZeroBytesVerified: true,
      },
    });
    expect(result.status === 'VERIFIED' ? result.proof.verifiedCwds : []).toHaveLength(3);
  });

  it('fails when any relevant cwd breaks an invariant, or the config is unauthorized or not the sealed bytes when required', () => {
    const home = codexHome();
    const good = tree('work');
    const bad = tree('bad');
    mkdirSync(join(bad, '.codex'));
    writeFileSync(join(bad, '.codex', 'config.toml'), '');
    const base = { codexHome: home, launchCwd: good, requestedCwd: good, allowedTrustKeys: [], requireSealedStateZeroBytes: false } as const;
    expect(verifyAdmissionPreconditions({ ...base, launchCwd: bad })).toMatchObject({ status: 'FAILED', failure: { invariant: 'INV-PROJ' } });
    expect(verifyAdmissionPreconditions({ ...base, knownHistoryCwds: [bad] })).toMatchObject({ status: 'FAILED', failure: { invariant: 'INV-PROJ' } });
    expect(verifyAdmissionPreconditions({ ...base, requestedCwd: `${good}/` })).toMatchObject({ status: 'FAILED', failure: { invariant: 'INV-PATH' } });
    const reformatted = codexHome('[features]\nshell_snapshot=false\n');
    expect(verifyAdmissionPreconditions({ ...base, codexHome: reformatted })).toMatchObject({ status: 'VERIFIED' });
    expect(verifyAdmissionPreconditions({ ...base, codexHome: reformatted, requireSealedStateZeroBytes: true })).toMatchObject({
      status: 'FAILED',
      failure: { invariant: 'FIXTURE_CONFIG_STATE', reason: 'FIXTURE_CONFIG_SEALED_STATE_ZERO_BYTES_MISMATCH' },
    });
    const unauthorized = codexHome('[features]\nshell_snapshot = true\n');
    expect(verifyAdmissionPreconditions({ ...base, codexHome: unauthorized })).toMatchObject({
      status: 'FAILED',
      failure: { invariant: 'FIXTURE_CONFIG_STATE', reason: 'FIXTURE_CONFIG_FEATURES_CHANGED' },
    });
  });

  it('WRITER ASSUMPTION: an unexpected relevant mutation is DETECTED after the fact (never "prevented")', () => {
    const home = codexHome();
    const work = tree('work');
    const clean = runPostConsumeDetector({ codexHome: home, cwds: [work], allowedTrustKeys: [] });
    expect(clean).toEqual({
      detector: 'POST_CONSUME_DETECTOR',
      outcome: 'NO_UNEXPECTED_RELEVANT_MUTATION_DETECTED',
      observedFixtureConfigState: { state: 'STATE_0' },
      failure: null,
    });
    mkdirSync(join(work, '.codex'));
    writeFileSync(join(work, '.codex', 'config.toml'), '[features]\nshell_snapshot = true\n');
    const detected = runPostConsumeDetector({ codexHome: home, cwds: [work], allowedTrustKeys: [] });
    expect(detected).toMatchObject({ detector: 'POST_CONSUME_DETECTOR', outcome: 'UNEXPECTED_RELEVANT_MUTATION_DETECTED', failure: { invariant: 'INV-PROJ' } });
    writeFileSync(join(home, 'config.toml'), '[features]\nshell_snapshot = true\n');
    rmSync(join(work, '.codex'), { recursive: true });
    expect(runPostConsumeDetector({ codexHome: home, cwds: [work], allowedTrustKeys: [] })).toMatchObject({
      outcome: 'UNEXPECTED_RELEVANT_MUTATION_DETECTED',
      failure: { invariant: 'FIXTURE_CONFIG_STATE' },
    });
    for (const report of [clean, detected]) expect(JSON.stringify(report)).not.toMatch(/prevent/i);
  });
});

describe('the explicit E1 assumptions and the harness-start acknowledgement (a flag, not a detection claim)', () => {
  it('states both assumptions for E1 only, with no isolation and no production security claim', () => {
    expect(E1_SAME_USER_EXTERNAL_WRITER_ASSUMPTION).toMatchObject({
      id: 'E1_SAME_USER_EXTERNAL_WRITER_ASSUMPTION',
      scope: 'E1_ONLY',
      writerCScope: 'OUT_OF_SCOPE_CONTROLLED_ASSUMPTION',
      onObservedViolation: 'E1_INFRA_FAILURE_RUN_STOPS',
      isolationClaim: 'NONE',
      productionSecurityClaim: 'NONE',
    });
    expect(E1_CONTROLLED_ENVIRONMENT_ASSUMPTION).toMatchObject({ privilegedConcurrentHostMutation: 'OUT_OF_SCOPE', productionSecurityClaim: 'NONE' });
    expect(E1_ACKNOWLEDGED_ASSUMPTIONS).toEqual(['E1_SAME_USER_EXTERNAL_WRITER_ASSUMPTION', 'E1_CONTROLLED_ENVIRONMENT_ASSUMPTION']);
  });

  it('accepts only the exact acknowledgement of both assumptions by a named party', () => {
    expect(() => assertE1ControlledEnvironmentAcknowledged({ acknowledgedAssumptions: E1_ACKNOWLEDGED_ASSUMPTIONS, acknowledgedBy: 'test' })).not.toThrow();
    for (const bad of [
      undefined,
      {},
      { acknowledgedAssumptions: E1_ACKNOWLEDGED_ASSUMPTIONS },
      { acknowledgedAssumptions: E1_ACKNOWLEDGED_ASSUMPTIONS, acknowledgedBy: ' ' },
      { acknowledgedAssumptions: [E1_ACKNOWLEDGED_ASSUMPTIONS[0]], acknowledgedBy: 'test' },
      { acknowledgedAssumptions: [...E1_ACKNOWLEDGED_ASSUMPTIONS].reverse(), acknowledgedBy: 'test' },
    ]) {
      expect(() => assertE1ControlledEnvironmentAcknowledged(bad)).toThrow(E1ControlledEnvironmentNotAcknowledged);
    }
  });
});
