// CONT-P5-A — attestRuntime predicates against unit-tier fakes (the pinned binary is proven only by
// ../codex-app-server.process.test.ts). Every failure mode must be a typed RuntimeAttestationFailed, and a
// failure after the spawn must leave no process behind.

import { symlinkSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeDisposableDirs, writeFakeAppServer, type FakeAppServerBehaviour } from '../client/fake-app-server.fixture.js';
import { CodexClientGateError } from '../client/errors.js';
import { systemPsRunner } from '../client/process-handle.js';
import { CODEX_PIN, CODEX_PIN_SCHEMA } from '../pin/PIN.js';
import {
  attestRuntime,
  CODEX_BUILD_CLIENT_PROVENANCE,
  frozenInitializeRequestLine,
  parseSingleSemanticVersion,
  PRODUCTION_ATTESTATION_DEPS,
  RuntimeAttestationFailed,
  sha256File,
  type AttestRuntimeInput,
  type CodexAttestationDeps,
} from './attest-runtime.js';

const dirs = makeDisposableDirs('govai-cont-p5a-attest-');
const cleanups: (() => Promise<unknown>)[] = [];

afterAll(async () => {
  for (const c of cleanups) await c().catch(() => undefined);
  rmSync(dirs.root, { recursive: true, force: true });
});

let serial = 0;
async function fake(behaviour: FakeAppServerBehaviour = {}): Promise<{ path: string; deps: CodexAttestationDeps; input: AttestRuntimeInput }> {
  serial += 1;
  const path = writeFakeAppServer(dirs.root, `fake-codex-app-server-${serial}`, behaviour);
  const sha = await sha256File(path);
  const deps: CodexAttestationDeps = {
    pin: { executableSha256: sha, release: '0.154.0', executableMemberName: basename(path) },
    host: () => ({ platform: 'test', arch: 'fake' }),
    isPinnedHost: () => true,
    ps: systemPsRunner,
  };
  const input: AttestRuntimeInput = {
    binaryPath: path,
    expectedExecutableSha256: sha,
    expectedVersion: '0.154.0',
    expectedCodexHome: dirs.codexHome,
    homeDir: dirs.home,
    workDir: dirs.work,
  };
  return { path, deps, input };
}

async function failure(input: AttestRuntimeInput, deps: CodexAttestationDeps): Promise<RuntimeAttestationFailed> {
  const error = await attestRuntime(input, deps).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RuntimeAttestationFailed);
  return error as RuntimeAttestationFailed;
}

function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

describe('attestRuntime — happy path on a fake', () => {
  it('records the evidence, sends the frozen initialize bytes and only then unlocks thread methods', async () => {
    const { input, deps } = await fake();
    const attested = await attestRuntime(input, deps);
    cleanups.push(() => attested.handle.terminate({ graceMs: 2_000 }));
    const e = attested.evidence;
    expect(e.versionCommand).toEqual({ argv: [input.binaryPath, '--version'], stdout: 'codex-app-server 0.154.0\n', exitCode: 0 });
    expect(e.parsedVersion).toBe('0.154.0');
    expect(e.initializeRequestLine).toBe(frozenInitializeRequestLine(1));
    expect(JSON.parse(e.initializeRequestLine).params.capabilities).toEqual({ experimentalApi: false, requestAttestation: false });
    expect(e.initializeResponse.codexHome).toBe(dirs.codexHome);
    expect(JSON.parse(e.initializeResponseLine)).toMatchObject({ id: 1, result: { codexHome: dirs.codexHome } });
    expect(e).toMatchObject({ absoluteBinaryPath: true, experimentalApi: false, requestAttestation: false, codexHome: dirs.codexHome });
    expect(e.childEnvKeys).toEqual(['CODEX_HOME', 'HOME', 'PATH']);
    expect(e.process.ownProcessGroupEvidence).toMatchObject({ pid: e.process.pid, pgid: e.process.pid });
    expect(Object.isFrozen(e)).toBe(true);
    expect(attested.client.isUnlocked).toBe(true);
    await expect(attested.client.request('thread/read', { threadId: 't' })).resolves.toEqual({ echo: 'thread/read' });
    const record = await attested.handle.terminate({ graceMs: 3_000 });
    expect(record.directChildReaped).toBe(true);
  });

  it('is the only way to unlock: a bare client stays gated', async () => {
    const { CodexJsonRpcClient } = await import('../client/json-rpc-client.js');
    const { PassThrough } = await import('node:stream');
    const bare = new CodexJsonRpcClient({ input: new PassThrough(), output: new PassThrough() });
    await expect(bare.request('thread/start', {} as never)).rejects.toBeInstanceOf(CodexClientGateError);
    bare.close();
  });
});

describe('attestRuntime — every mismatch fails closed with a typed reason', () => {
  it('refuses a host that is not the pinned platform under PRODUCTION deps', async () => {
    const { input } = await fake();
    for (const host of [
      { platform: 'linux', arch: 'x64' },
      { platform: 'linux', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'win32', arch: 'x64' },
    ]) {
      const f = await failure(input, { ...PRODUCTION_ATTESTATION_DEPS, host: () => host });
      expect(f.reason).toBe('unsupported_platform');
      expect(f.evidence.hostPlatform).toBe(`${host.platform}-${host.arch}`);
    }
  });

  it('refuses to attest any artifact other than the pin (expected values must BE the pin)', async () => {
    const { input, deps } = await fake();
    expect((await failure({ ...input, expectedExecutableSha256: '0'.repeat(64) }, deps)).reason).toBe('expectation_not_pinned');
    expect((await failure({ ...input, expectedVersion: '0.155.0' }, deps)).reason).toBe('expectation_not_pinned');
    // Production deps: only the §0 digest/version are attestable.
    const prod = { ...PRODUCTION_ATTESTATION_DEPS, host: () => ({ platform: 'darwin', arch: 'arm64' }) };
    expect((await failure(input, prod)).reason).toBe('expectation_not_pinned');
  });

  it('refuses relative paths, a wrong member name, a missing binary and a wrong executable hash', async () => {
    const { input, deps, path } = await fake();
    expect((await failure({ ...input, binaryPath: basename(path) }, deps)).reason).toBe('binary_path_not_absolute');
    const other = await fake();
    expect((await failure({ ...input, binaryPath: other.path }, deps)).reason).toBe('binary_name_mismatch');
    expect((await failure({ ...input, binaryPath: join(dirs.work, basename(path)) }, deps)).reason).toBe('binary_missing');
    const wrongHash = { ...deps, pin: { ...deps.pin, executableSha256: 'f'.repeat(64) } };
    const f = await failure({ ...input, expectedExecutableSha256: 'f'.repeat(64) }, wrongHash);
    expect(f.reason).toBe('executable_sha256_mismatch');
    expect(f.evidence.executableSha256).toBe(deps.pin.executableSha256);
  });

  it('refuses a missing or non-canonical CODEX_HOME before executing anything', async () => {
    const { input, deps } = await fake();
    expect((await failure({ ...input, expectedCodexHome: join(dirs.root, 'nope') }, deps)).reason).toBe('codex_home_invalid');
    const alias = join(dirs.root, 'codex-home-alias');
    symlinkSync(dirs.codexHome, alias);
    const f = await failure({ ...input, expectedCodexHome: alias }, deps);
    expect(f.reason).toBe('codex_home_not_canonical');
    expect(f.evidence.versionCommand).toBeUndefined();
  });

  it('records --version stdout verbatim and fails on a failed, unparseable, ambiguous or different version', async () => {
    const cases: [FakeAppServerBehaviour, string][] = [
      [{ versionExitCode: 3 }, 'version_command_failed'],
      [{ versionStdout: 'codex-app-server unknown\n' }, 'version_unparseable'],
      [{ versionStdout: 'codex-app-server 0.154.0 (upgrade to 0.155.0)\n' }, 'version_unparseable'],
      [{ versionStdout: 'codex-app-server 0.153.9\n' }, 'version_mismatch'],
    ];
    for (const [behaviour, reason] of cases) {
      const { input, deps } = await fake(behaviour);
      const f = await failure(input, deps);
      expect(f.reason).toBe(reason);
      if (reason !== 'version_command_failed') expect(f.evidence.versionCommand?.stdout).toBe(behaviour.versionStdout);
      expect(f.evidence.process).toBeUndefined();
    }
  });

  it('fails closed on initialize errors and on a wrong CODEX_HOME answer — and leaves no process behind', async () => {
    for (const [behaviour, reason] of [
      [{ initializeError: true }, 'initialize_failed'],
      [{ codexHomeAnswer: '/Users/someone/.codex' }, 'codex_home_mismatch'],
    ] as const) {
      const { input, deps } = await fake(behaviour);
      const f = await failure(input, deps);
      expect(f.reason).toBe(reason);
      const pid = f.evidence.process!.pid;
      expect(processGone(pid)).toBe(true);
      if (reason === 'codex_home_mismatch') {
        expect(f.evidence.initializeResponse?.codexHome).toBe('/Users/someone/.codex');
        expect(f.evidence.initializeRequestLine).toBe(frozenInitializeRequestLine(1));
      }
    }
  });
});

describe('attestation primitives', () => {
  it('parses exactly one semantic version, unambiguously', () => {
    expect(parseSingleSemanticVersion('codex-app-server 0.154.0\n')).toBe('0.154.0');
    expect(parseSingleSemanticVersion('0.154.0')).toBe('0.154.0');
    expect(parseSingleSemanticVersion('codex-app-server 1.2.3-alpha.1+build.5\n')).toBe('1.2.3-alpha.1+build.5');
    expect(parseSingleSemanticVersion('codex-app-server\n')).toBeNull();
    expect(parseSingleSemanticVersion('0.154.0 and 0.154.1')).toBeNull();
    expect(parseSingleSemanticVersion('v0.154.0')).toBeNull();
    expect(parseSingleSemanticVersion('0.154')).toBeNull();
    expect(parseSingleSemanticVersion('0.154.0.1')).toBeNull();
  });

  it('serializes the §0.1 frozen initialize request byte-for-byte', () => {
    expect(frozenInitializeRequestLine(1)).toBe(
      '{"id":1,"method":"initialize","params":{"clientInfo":{"name":"govai-cont-p5a-harness","title":"GovAI CONT-P5-A inert foundation","version":"0.1.0"},"capabilities":{"experimentalApi":false,"requestAttestation":false}}}',
    );
  });

  it('wires PRODUCTION deps to the §0 pin and the darwin-arm64-only platform rule', () => {
    expect(PRODUCTION_ATTESTATION_DEPS.pin).toBe(CODEX_PIN);
    expect(PRODUCTION_ATTESTATION_DEPS.isPinnedHost({ platform: 'darwin', arch: 'arm64' })).toBe(true);
    expect(PRODUCTION_ATTESTATION_DEPS.isPinnedHost({ platform: 'linux', arch: 'arm64' })).toBe(false);
    expect(PRODUCTION_ATTESTATION_DEPS.host()).toEqual({ platform: process.platform, arch: process.arch });
  });

  it('exports BUILD/CLIENT PROVENANCE as one frozen object citing the pin', () => {
    expect(Object.isFrozen(CODEX_BUILD_CLIENT_PROVENANCE)).toBe(true);
    expect(CODEX_BUILD_CLIENT_PROVENANCE.pin).toBe(CODEX_PIN);
    expect(CODEX_BUILD_CLIENT_PROVENANCE.schema).toBe(CODEX_PIN_SCHEMA);
    expect(CODEX_BUILD_CLIENT_PROVENANCE.serverReportedSchemaHash).toBe('NONE_AT_PIN');
    expect(CODEX_BUILD_CLIENT_PROVENANCE.wire).toEqual({ transport: 'stdio', listenUrl: 'stdio://', jsonrpcVersionField: 'OMITTED' });
  });
});
