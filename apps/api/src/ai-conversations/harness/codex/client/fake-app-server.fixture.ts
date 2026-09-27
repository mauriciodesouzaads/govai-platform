// CONT-P5-A — UNIT-TIER FAKE of the app-server executable (dispatch §2: fakes allowed for unit tests).
//
// Writes a small executable Node script into a caller-owned temp directory. It speaks just enough of the pinned
// stdio wire (`--version`, `--listen stdio://`, `initialize`, echo answers) to drive the REAL process handle,
// pipes and attestation predicates on any CI host. It is NEVER proof of native process integration — that is
// the `*.process.test.ts` suite against the §0 executable.

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type FakeAppServerBehaviour = {
  /** Verbatim `--version` stdout (default `codex-app-server 0.154.0\n`). */
  readonly versionStdout?: string;
  readonly versionExitCode?: number;
  /** `echo` (default) answers with the CODEX_HOME it was given; any other string is answered instead. */
  readonly codexHomeAnswer?: string;
  readonly initializeError?: boolean;
  /** Survive SIGTERM (forces the SIGKILL escalation path). */
  readonly ignoreSigterm?: boolean;
  /** Start a sleeping child that stays in the fake's process group. */
  readonly spawnGroupChild?: boolean;
  /** Print the sorted environment KEYS (never values) on stderr at startup. */
  readonly reportEnvKeys?: boolean;
  /** Raw JSON text used as the initialize `result` (e.g. `null`, `42`, `[]`, a malformed object). */
  readonly initializeResultJson?: string;
  /** Never answer `initialize` (the client's deadline decides). */
  readonly initializeNoAnswer?: boolean;
  /** Exit on `initialize` without answering: the channel closes before the response. */
  readonly exitOnInitialize?: boolean;
  /** Echo every received line on stderr as `LINE <line>` (proves what did — and did not — reach the child). */
  readonly reportLines?: boolean;
  /**
   * CONT-P5-E1: canned `result` JSON texts per method, answered in order to successive requests of that method (the
   * last one repeats). Methods without an entry keep the `{ echo: <method> }` answer.
   */
  readonly cannedResultsJson?: Readonly<Record<string, readonly string[]>>;
  /** Exit without answering when a request of this method arrives: the request was written, no response comes. */
  readonly exitOnMethod?: string;
  /** Answer requests of this method with a JSON-RPC error object. */
  readonly errorOnMethod?: string;
  /** Never answer requests of this method (the client's deadline decides). */
  readonly noAnswerOnMethod?: string;
};

/** Line the fake prints on stderr once its signal handlers are installed (tests wait for it before signalling). */
export const FAKE_APP_SERVER_READY = 'READY';

/**
 * Keys a child's OWN runtime may add to its environment after exec (never inherited: the handle passes exactly
 * CODEX_CHILD_ENV_KEYS). macOS CoreFoundation sets `__CF_USER_TEXT_ENCODING` during process initialization.
 */
export const RUNTIME_SELF_SET_ENV_KEYS: readonly string[] = ['__CF_USER_TEXT_ENCODING'];

export type DisposableDirs = { readonly root: string; readonly codexHome: string; readonly home: string; readonly work: string };

/** Fresh canonical disposable directories under the OS temp dir (realpath'd: macOS /var → /private/var). */
export function makeDisposableDirs(prefix: string): DisposableDirs {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const dirs = { root, codexHome: join(root, 'codex-home'), home: join(root, 'home'), work: join(root, 'work') };
  for (const d of [dirs.codexHome, dirs.home, dirs.work]) mkdirSync(d, { mode: 0o700 });
  return dirs;
}

export function writeFakeAppServer(dir: string, fileName: string, behaviour: FakeAppServerBehaviour = {}): string {
  const script = `#!${process.execPath}
'use strict';
const B = ${JSON.stringify(behaviour)};
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write(B.versionStdout === undefined ? 'codex-app-server 0.154.0\\n' : B.versionStdout);
  process.exit(B.versionExitCode === undefined ? 0 : B.versionExitCode);
}
if (!(args.length === 2 && args[0] === '--listen' && args[1] === 'stdio://')) {
  process.stderr.write('UNEXPECTED_ARGS ' + JSON.stringify(args) + '\\n');
  process.exit(64);
}
if (B.reportEnvKeys) process.stderr.write('ENV_KEYS=' + JSON.stringify(Object.keys(process.env).sort()) + '\\n');
process.on('SIGTERM', () => {
  process.stderr.write(B.ignoreSigterm ? 'SIGTERM_IGNORED\\n' : 'SIGTERM_RECEIVED\\n');
  if (!B.ignoreSigterm) process.exit(0);
});
if (B.spawnGroupChild) {
  const child = require('child_process').spawn('/bin/sleep', ['60'], { stdio: 'ignore' });
  process.stderr.write('GROUP_CHILD=' + child.pid + '\\n');
}
process.stderr.write('READY\\n');
const served = {};
const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (B.reportLines) process.stderr.write('LINE ' + line + '\\n');
  let m;
  try { m = JSON.parse(line); } catch (e) { return; }
  if (m.method === 'initialize') {
    if (B.exitOnInitialize) process.exit(0);
    if (B.initializeNoAnswer) return;
    if (B.initializeError) return out({ error: { code: -32603, message: 'fake initialize failure' }, id: m.id });
    if (B.initializeResultJson !== undefined) return process.stdout.write('{"id":' + JSON.stringify(m.id) + ',"result":' + B.initializeResultJson + '}\\n');
    const home = B.codexHomeAnswer === undefined || B.codexHomeAnswer === 'echo' ? process.env.CODEX_HOME : B.codexHomeAnswer;
    return out({ id: m.id, result: { userAgent: 'fake-app-server/0.154.0', codexHome: home, platformFamily: 'unix', platformOs: process.platform } });
  }
  if (m.id !== undefined && typeof m.method === 'string') {
    if (B.exitOnMethod === m.method) process.exit(0);
    if (B.noAnswerOnMethod === m.method) return;
    if (B.errorOnMethod === m.method) return out({ error: { code: -32603, message: 'fake ' + m.method + ' failure' }, id: m.id });
    const canned = B.cannedResultsJson && B.cannedResultsJson[m.method];
    if (canned && canned.length > 0) {
      served[m.method] = (served[m.method] || 0) + 1;
      const text = canned[Math.min(served[m.method], canned.length) - 1];
      return process.stdout.write('{"id":' + JSON.stringify(m.id) + ',"result":' + text + '}\\n');
    }
    out({ id: m.id, result: { echo: m.method } });
  }
});
setInterval(() => {}, 1 << 30);
`;
  const path = join(dir, fileName);
  writeFileSync(path, script, { mode: 0o755 });
  return path;
}

/**
 * A POSIX-sh fake for ONE scenario: it reads the `initialize` line, CLOSES its stdin (no reader is left), and only
 * then answers. The channel has therefore already failed when the client writes `initialized` — deterministically,
 * with no timing race. After answering it stays alive (`sleep`) in its own group until it is signalled.
 */
export function writeStdinClosingFakeAppServer(dir: string, fileName: string): string {
  const script = `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'codex-app-server 0.154.0\\n'; exit 0; fi
IFS= read -r line
exec 0<&-
printf '{"id":1,"result":{"userAgent":"fake-app-server/0.154.0","codexHome":"%s","platformFamily":"unix","platformOs":"fake"}}\\n' "$CODEX_HOME"
exec /bin/sleep 60
`;
  const path = join(dir, fileName);
  writeFileSync(path, script, { mode: 0o755 });
  return path;
}

// ---------------------------------------------------------------------------------------------------------
// CONT-P5-E1 canned answers (pure data): stock-shaped results of the pinned wire, used both as `cannedResultsJson`
// of the fake above and directly by unit tests. They model a response equal to the current request, equal to the
// original historical values, equal to an earlier request, a mixed tuple and structurally invalid shapes; an absent
// response is `exitOnMethod`. None of them emits or implies a branch signal: no such signal exists on thread/resume.
// ---------------------------------------------------------------------------------------------------------

export const CANNED_THREAD_ID = '019a0000-0000-7000-8000-00000000e1e1';
export const CANNED_SESSION_ID = '019a0000-0000-7000-8000-00000000e1e2';

/**
 * A Thread as the stock pin serializes it: the 28 schema properties (13 required) PLUS the four experimental members
 * `environments`, `extra`, `canAcceptDirectInput` and `daybreakEnabled`, which the pinned server emits whatever the
 * client's `experimentalApi` capability is.
 */
export function cannedStockThread(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: CANNED_THREAD_ID,
    sessionId: CANNED_SESSION_ID,
    forkedFromId: null,
    parentThreadId: null,
    preview: '',
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: 'legacy',
    modelProvider: 'openai',
    model: 'gpt-e1-model-a',
    reasoningEffort: null,
    createdAt: 1_790_000_000,
    updatedAt: 1_790_000_001,
    recencyAt: null,
    status: { type: 'idle' },
    path: null,
    cwd: '/Users/Shared/govai-e1-fixture/work',
    cliVersion: '0.154.0',
    originator: null,
    source: 'appServer',
    threadSource: null,
    gitInfo: null,
    name: null,
    agentNickname: null,
    agentRole: null,
    turns: [],
    environments: null,
    extra: null,
    canAcceptDirectInput: null,
    daybreakEnabled: null,
    ...overrides,
  };
}

/** A well-formed SandboxPolicy of the pinned wire for a discriminator. */
export function cannedSandboxPolicy(
  type: 'readOnly' | 'workspaceWrite' | 'dangerFullAccess' | 'externalSandbox',
  writableRoots: readonly string[] = [],
): Record<string, unknown> {
  switch (type) {
    case 'readOnly':
      return { type, networkAccess: false };
    case 'workspaceWrite':
      return { type, writableRoots: [...writableRoots], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
    case 'externalSandbox':
      return { type, networkAccess: 'restricted' };
    default:
      return { type };
  }
}

export type CannedEffectiveSettings = Readonly<{
  model: string;
  cwd: string;
  approvalPolicy: unknown;
  approvalsReviewer: unknown;
  sandbox: unknown;
}>;

/** A structurally valid ThreadStartResponse / ThreadForkResponse (10 keys) reporting `settings`. */
export function cannedThreadStartResult(
  settings: CannedEffectiveSettings,
  threadOverrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    thread: cannedStockThread({ cwd: settings.cwd, model: settings.model, ...threadOverrides }),
    model: settings.model,
    modelProvider: 'openai',
    serviceTier: null,
    cwd: settings.cwd,
    instructionSources: [],
    approvalPolicy: settings.approvalPolicy,
    approvalsReviewer: settings.approvalsReviewer,
    sandbox: settings.sandbox,
    reasoningEffort: null,
  };
}

/** A structurally valid ThreadResumeResponse: the 12 Layer A keys reporting `settings`, no experimental key. */
export function cannedThreadResumeResult(
  settings: CannedEffectiveSettings,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    ...cannedThreadStartResult(settings),
    turnsBackwardsCursor: null,
    itemsBackwardsCursor: null,
    ...overrides,
  };
}

/** Text a fake-server-only sentinel carries in feature metadata, so sink tests can prove it never reaches evidence. */
export const CANNED_FEATURE_METADATA_SENTINEL = 'GOVAI-SINK-SENTINEL-feature-metadata-7f3a';

/** An `experimentalFeature/list` page: the two targets plus unrelated features carrying descriptive metadata. */
export function cannedFeatureListResult(
  bits: Readonly<{ shellSnapshot: boolean; shellSnapshotV2: boolean }>,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    data: [
      {
        name: 'unified_exec_beta',
        stage: 'beta',
        displayName: `${CANNED_FEATURE_METADATA_SENTINEL} display`,
        description: `${CANNED_FEATURE_METADATA_SENTINEL} description`,
        announcement: `${CANNED_FEATURE_METADATA_SENTINEL} announcement`,
        enabled: true,
        defaultEnabled: false,
      },
      { name: 'shell_snapshot', stage: 'stable', displayName: null, description: null, announcement: null, enabled: bits.shellSnapshot, defaultEnabled: true },
      {
        name: 'shell_snapshot_v2',
        stage: 'underDevelopment',
        displayName: null,
        description: null,
        announcement: null,
        enabled: bits.shellSnapshotV2,
        defaultEnabled: false,
      },
    ],
    nextCursor: null,
    ...overrides,
  };
}
