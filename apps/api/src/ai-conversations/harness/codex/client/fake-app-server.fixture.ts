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
  if (m.id !== undefined && typeof m.method === 'string') out({ id: m.id, result: { echo: m.method } });
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
