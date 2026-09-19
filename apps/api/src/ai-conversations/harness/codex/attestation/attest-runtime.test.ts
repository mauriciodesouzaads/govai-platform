// CONT-P5-A — attestRuntime predicates against unit-tier fakes (the pinned binary is proven only by
// ../codex-app-server.process.test.ts). Every failure mode must be a typed RuntimeAttestationFailed, and a
// failure after the spawn must leave no process behind.

import { symlinkSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  makeDisposableDirs,
  writeFakeAppServer,
  writeStdinClosingFakeAppServer,
  type FakeAppServerBehaviour,
} from '../client/fake-app-server.fixture.js';
import { CodexClientGateError } from '../client/errors.js';
import { CodexJsonRpcClient } from '../client/json-rpc-client.js';
import { systemPsRunner, type CodexProcessHandle, type PsRunner } from '../client/process-handle.js';
import { CodexExperimentalLockoutViolation } from '../guard/experimental-lockout.js';
import { CODEX_PIN, CODEX_PIN_SCHEMA } from '../pin/PIN.js';
import { GovAICodexPolicyViolation } from '../protocol/govai-policy.js';
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
  type RuntimeAttestationFailureReason,
} from './attest-runtime.js';

const dirs = makeDisposableDirs('govai-cont-p5a-attest-');
const cleanups: (() => Promise<unknown>)[] = [];

afterAll(async () => {
  for (const c of cleanups) await c().catch(() => undefined);
  rmSync(dirs.root, { recursive: true, force: true });
});

// LEAK LAW: every test proves in afterEach that the processes IT spawned are gone, and kills its own group if not.
const ownedByThisTest: { pid: number; handle: CodexProcessHandle | undefined }[] = [];
function own(pid: number | undefined, handle?: CodexProcessHandle): void {
  if (pid !== undefined) ownedByThisTest.push({ pid, handle });
}

afterEach(() => {
  vi.restoreAllMocks();
  const alive = ownedByThisTest.filter(({ pid, handle }) => (handle === undefined || handle.exited === null) && !processGone(pid));
  for (const { pid } of alive) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  ownedByThisTest.length = 0;
  expect(alive.map((o) => o.pid), 'LEAK LAW: a process spawned by this test is still alive').toEqual([]);
});

let serial = 0;
async function fake(
  behaviour: FakeAppServerBehaviour = {},
  write: (dir: string, fileName: string) => string = (dir, fileName) => writeFakeAppServer(dir, fileName, behaviour),
): Promise<{ path: string; deps: CodexAttestationDeps; input: AttestRuntimeInput }> {
  serial += 1;
  const path = write(dirs.root, `fake-codex-app-server-${serial}`);
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
  if (error instanceof RuntimeAttestationFailed) own(error.evidence.process?.pid);
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
    own(attested.handle.pid, attested.handle);
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

/** `ps` that answers the spawn's initial inventory for real, then is unavailable for every later call. */
function inventoryUnavailableAfterSpawn(): PsRunner {
  let calls = 0;
  return () => {
    calls += 1;
    return calls === 1 ? systemPsRunner() : Promise.reject(new Error('ps unavailable (test)'));
  };
}

const HANDSHAKE_FAILURES: readonly (readonly [
  string,
  FakeAppServerBehaviour | 'stdin-closing-fake',
  RuntimeAttestationFailureReason,
  Partial<AttestRuntimeInput>,
])[] = [
  ['result null', { initializeResultJson: 'null' }, 'initialize_response_invalid', {}],
  ['result primitive', { initializeResultJson: '42' }, 'initialize_response_invalid', {}],
  ['result array', { initializeResultJson: '[]' }, 'initialize_response_invalid', {}],
  [
    'malformed result object',
    { initializeResultJson: '{"userAgent":1,"codexHome":"/x","platformFamily":"unix","platformOs":"darwin"}' },
    'initialize_response_invalid',
    {},
  ],
  [
    'result missing a field',
    { initializeResultJson: '{"userAgent":"u","platformFamily":"unix","platformOs":"darwin"}' },
    'initialize_response_invalid',
    {},
  ],
  ['initialize error object', { initializeError: true }, 'initialize_failed', {}],
  ['initialize timeout', { initializeNoAnswer: true }, 'initialize_failed', { initializeTimeoutMs: 300 }],
  ['channel closed before the response', { exitOnInitialize: true }, 'initialize_failed', {}],
  ['channel closed after the response', 'stdin-closing-fake', 'initialized_notification_failed', {}],
];

describe('R5 — one post-spawn safety region: typed reason, client closed, child gone, cleanup outcome present', () => {
  for (const inventory of ['available', 'unavailable after spawn'] as const) {
    for (const [label, spec, reason, extra] of HANDSHAKE_FAILURES) {
      it(`${label} → ${reason} (inventory ${inventory})`, async () => {
        const { input, deps } = await (spec === 'stdin-closing-fake' ? fake({}, writeStdinClosingFakeAppServer) : fake(spec));
        const closeSpy = vi.spyOn(CodexJsonRpcClient.prototype, 'close');
        const ps = inventory === 'available' ? deps.ps : inventoryUnavailableAfterSpawn();
        const f = await failure({ ...input, ...extra }, { ...deps, ps });
        expect(f.reason).toBe(reason);
        expect(closeSpy).toHaveBeenCalled();
        expect(f.cleanup?.status).toBe('terminated');
        const record = f.cleanup?.status === 'terminated' ? f.cleanup.record : undefined;
        expect(record?.directChildReaped).toBe(true);
        expect(processGone(f.evidence.process!.pid)).toBe(true);
        if (inventory === 'unavailable after spawn') expect(record?.inGroupResidue).toBe('unknown_inventory_unavailable');
      });
    }

    it(`an injected unexpected throw inside the region → handshake_internal_error (inventory ${inventory})`, async () => {
      const { input, deps } = await fake();
      const closeSpy = vi.spyOn(CodexJsonRpcClient.prototype, 'close');
      const injected = { ...input };
      Object.defineProperty(injected, 'initializeTimeoutMs', {
        enumerable: true,
        get(): number {
          throw new Error('injected inside the handshake region');
        },
      });
      const ps = inventory === 'available' ? deps.ps : inventoryUnavailableAfterSpawn();
      const f = await failure(injected, { ...deps, ps });
      expect(f.reason).toBe('handshake_internal_error');
      expect(f.cause).toBeInstanceOf(Error);
      expect(closeSpy).toHaveBeenCalled();
      expect(f.cleanup?.status).toBe('terminated');
      expect(processGone(f.evidence.process!.pid)).toBe(true);
    });
  }

  it('a post-OS-spawn spawn() failure is spawn_failed WITH the cleanup outcome', async () => {
    const { input, deps } = await fake();
    const f = await failure(input, { ...deps, ps: () => Promise.reject(new Error('ps unavailable (test)')) });
    expect(f.reason).toBe('spawn_failed');
    expect(f.cleanup?.status).toBe('terminated');
    const record = f.cleanup?.status === 'terminated' ? f.cleanup.record : undefined;
    own(record?.pid);
    expect(record?.directChildReaped).toBe(true);
    expect(processGone(record!.pid)).toBe(true);
    expect(f.evidence.process).toBeUndefined();
  });
});

describe('R1 — a genuinely attested client enforces the GovAI policy at the send boundary', () => {
  it('refuses category (3), missing governance, fork/steer boundaries, allowlisted-out keys and non-records — zero bytes reach the child', async () => {
    const { input, deps } = await fake({ reportLines: true });
    const attested = await attestRuntime(input, deps);
    own(attested.handle.pid, attested.handle);
    const client = attested.client;
    const governed = { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' };
    const text = [{ type: 'text', text: 'hello', text_elements: [] }];
    const policyRefusals: readonly (readonly [string, unknown])[] = [
      ['thread/start', { ...governed, approvalPolicy: 'never' }],
      ['thread/start', { ...governed, approvalsReviewer: 'auto_review' }],
      ['thread/resume', { ...governed, threadId: 't', approvalsReviewer: 'guardian_subagent' }],
      ['thread/fork', { ...governed, threadId: 't', lastTurnId: 'u', sandbox: 'danger-full-access' }],
      ['turn/start', { threadId: 't', input: text, sandboxPolicy: { type: 'dangerFullAccess' } }],
      ['turn/start', { threadId: 't', input: text, sandboxPolicy: { type: 'externalSandbox', networkAccess: 'restricted' } }],
      ['thread/start', { approvalsReviewer: 'user', sandbox: 'read-only' }],
      ['thread/fork', { ...governed, threadId: 't' }],
      ['turn/steer', { threadId: 't', input: text }],
      ['thread/start', { ...governed, config: { model_provider: 'x' } }],
      ['thread/start', { ...governed, baseInstructions: 'x' }],
      ['thread/resume', { ...governed, threadId: 't', developerInstructions: 'x' }],
      ['turn/start', { threadId: 't', input: text, toolOutput: null }],
      ['thread/read', 'not-a-record'],
    ];
    for (const [method, params] of policyRefusals) {
      await expect(client.request(method as never, params as never), method).rejects.toBeInstanceOf(GovAICodexPolicyViolation);
    }
    await expect(
      client.request('thread/start', { ...governed, approvalPolicy: { granular: { sandbox_approval: true } } } as never),
    ).rejects.toBeInstanceOf(CodexExperimentalLockoutViolation);
    // The next accepted request is id 2: refusals consumed no id; the child saw nothing of them.
    await expect(client.request('thread/read', { threadId: 't' })).resolves.toEqual({ echo: 'thread/read' });
    const received = (): string[] => [...attested.handle.stderr.tail.matchAll(/^LINE (.*)$/gm)].map((m) => m[1] ?? '');
    const until = Date.now() + 5_000;
    while (!received().some((l) => l.includes('"thread/read"')) && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(received().map((l) => JSON.parse(l) as { id?: number; method: string })).toEqual([
      expect.objectContaining({ id: 1, method: 'initialize' }),
      { method: 'initialized' },
      { id: 2, method: 'thread/read', params: { threadId: 't' } },
    ]);
    expect((await attested.handle.terminate({ graceMs: 3_000 })).directChildReaped).toBe(true);
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
