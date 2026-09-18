// CONT-P5-A — runtime attestation of the pinned codex-app-server (dispatch §2 attestation/, §0, §0.1, §4).
//
// `attestRuntime` is the ONLY way to obtain a client whose thread/turn methods are unlocked. In order, each
// step fail-closed with a typed `RuntimeAttestationFailed`:
//   1. host is the pinned platform (darwin-arm64); every other host is FAIL_CLOSED_NOT_YET_PINNED
//   2. the expected executable SHA-256 and version ARE the pin (a caller cannot attest a different artifact)
//   3. the binary path is absolute + normalized, names the §0 member and is a regular file
//   4. SHA-256(executable) == §0 EXPECTED_EXECUTABLE_SHA256 (streamed, before anything is executed)
//   5. CODEX_HOME is an absolute, existing, CANONICAL directory (the server canonicalizes it, so only a
//      canonical path can be compared byte-for-byte with the answer)
//   6. `<abs path> --version` runs in the same isolated environment; stdout is recorded VERBATIM; exactly one
//      semantic version must be parseable from it and equal the pinned release
//   7. the server is spawned (own process group, explicit env) and `initialize` is sent with the §0.1
//      FROZEN request; the serialized bytes are asserted (`experimentalApi: false`, `requestAttestation:
//      false`, nothing else)
//   8. `response.codexHome` == the disposable CODEX_HOME; userAgent / platformFamily / platformOs recorded
//   9. `initialized` is notified and only then the channel is unlocked for thread methods
// On any failure after the spawn, the process group is terminated before the error propagates.
// No server-reported schema hash is required: none exists at the pin.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, normalize } from 'node:path';

import { CODEX_CLIENT_UNLOCK_AFTER_ATTESTATION, CodexJsonRpcClient } from '../client/json-rpc-client.js';
import {
  CODEX_CHILD_PATH,
  CodexProcessHandle,
  systemPsRunner,
  type InGroupMember,
  type PsRunner,
} from '../client/process-handle.js';
import { CODEX_PIN, CODEX_PIN_SCHEMA, isPinnedHostPlatform, type CodexHostPlatform } from '../pin/PIN.js';
import type { InitializeResponse } from '../protocol/generated/InitializeResponse';
import { GOVAI_CODEX_CLIENT_INFO, GovAICodexSafeRequestBuilder } from '../protocol/govai-policy.js';

export type RuntimeAttestationFailureReason =
  | 'unsupported_platform'
  | 'expectation_not_pinned'
  | 'binary_path_not_absolute'
  | 'binary_name_mismatch'
  | 'binary_missing'
  | 'executable_sha256_mismatch'
  | 'codex_home_invalid'
  | 'codex_home_not_canonical'
  | 'version_command_failed'
  | 'version_unparseable'
  | 'version_mismatch'
  | 'spawn_failed'
  | 'initialize_request_bytes_mismatch'
  | 'initialize_failed'
  | 'initialize_response_invalid'
  | 'codex_home_mismatch';

export class RuntimeAttestationFailed extends Error {
  readonly code = 'codex_runtime_attestation_failed';
  constructor(
    readonly reason: RuntimeAttestationFailureReason,
    /** Whatever was established before the failure — never a credential, never a payload beyond the handshake. */
    readonly evidence: Readonly<Partial<CodexRuntimeAttestationEvidence>>,
  ) {
    super(`codex runtime attestation failed: ${reason}`);
    this.name = 'RuntimeAttestationFailed';
  }
}

export type AttestRuntimeInput = {
  readonly binaryPath: string;
  readonly expectedExecutableSha256: string;
  readonly expectedVersion: string;
  /** Disposable, canonical CODEX_HOME the server must report back verbatim. */
  readonly expectedCodexHome: string;
  /** Disposable HOME for the child (default: `expectedCodexHome`). */
  readonly homeDir?: string;
  /** Child working directory (default: `expectedCodexHome`). */
  readonly workDir?: string;
  readonly initializeTimeoutMs?: number;
  readonly versionTimeoutMs?: number;
};

export type CodexRuntimeAttestationEvidence = {
  readonly hostPlatform: string;
  readonly binaryPath: string;
  readonly absoluteBinaryPath: true;
  readonly executableSha256: string;
  readonly versionCommand: { readonly argv: readonly string[]; readonly stdout: string; readonly exitCode: 0 };
  readonly parsedVersion: string;
  readonly codexHome: string;
  readonly childEnvKeys: readonly string[];
  readonly process: { readonly pid: number; readonly pgid: number; readonly ownProcessGroupEvidence: InGroupMember | null };
  readonly initializeRequestLine: string;
  readonly initializeResponseLine: string;
  readonly initializeResponse: InitializeResponse;
  readonly experimentalApi: false;
  readonly requestAttestation: false;
};

export type AttestedCodexRuntime = {
  readonly evidence: CodexRuntimeAttestationEvidence;
  readonly client: CodexJsonRpcClient;
  readonly handle: CodexProcessHandle;
};

/** Seams for unit tests with fake executables; production callers never pass them. */
export type CodexAttestationDeps = {
  readonly pin: { readonly executableSha256: string; readonly release: string; readonly executableMemberName: string };
  readonly host: () => CodexHostPlatform;
  readonly isPinnedHost: (host: CodexHostPlatform) => boolean;
  readonly ps: PsRunner;
};

export const PRODUCTION_ATTESTATION_DEPS: CodexAttestationDeps = Object.freeze({
  pin: CODEX_PIN,
  host: () => ({ platform: process.platform, arch: process.arch }),
  isPinnedHost: isPinnedHostPlatform,
  ps: systemPsRunner,
});

const SEMVER =
  /(?<![0-9A-Za-z.+-])(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?![0-9A-Za-z.+-])/g;

/** The single semantic version in `stdout`, or `null` when there is none or more than one (ambiguous). */
export function parseSingleSemanticVersion(stdout: string): string | null {
  const matches = stdout.match(SEMVER) ?? [];
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** The exact bytes GovAI must put on the wire for `initialize` as request id `id` (§0.1 FROZEN REQUEST). */
export function frozenInitializeRequestLine(id: number): string {
  const { method, params } = GovAICodexSafeRequestBuilder.initialize();
  return JSON.stringify({ id, method, params });
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function runVersion(
  binaryPath: string,
  env: Record<string, string>,
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    execFile(
      binaryPath,
      ['--version'],
      { env, cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024, shell: false, encoding: 'utf8' },
      (error, stdout) => {
        const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : null;
        resolve({ stdout, exitCode });
      },
    );
  });
}

/** `id` of a wire line, or `undefined` when the line is not a JSON object (never throws). */
function lineId(line: string): unknown {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null ? (parsed as { id?: unknown }).id : undefined;
  } catch {
    return undefined;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export async function attestRuntime(
  input: AttestRuntimeInput,
  deps: CodexAttestationDeps = PRODUCTION_ATTESTATION_DEPS,
): Promise<AttestedCodexRuntime> {
  const evidence: { -readonly [K in keyof CodexRuntimeAttestationEvidence]?: CodexRuntimeAttestationEvidence[K] } = {};
  const fail = (reason: RuntimeAttestationFailureReason): RuntimeAttestationFailed =>
    new RuntimeAttestationFailed(reason, Object.freeze({ ...evidence }));

  const host = deps.host();
  evidence.hostPlatform = `${host.platform}-${host.arch}`;
  if (!deps.isPinnedHost(host)) throw fail('unsupported_platform');
  if (input.expectedExecutableSha256 !== deps.pin.executableSha256 || input.expectedVersion !== deps.pin.release) {
    throw fail('expectation_not_pinned');
  }
  if (!isAbsolute(input.binaryPath) || normalize(input.binaryPath) !== input.binaryPath) {
    throw fail('binary_path_not_absolute');
  }
  evidence.binaryPath = input.binaryPath;
  evidence.absoluteBinaryPath = true;
  if (basename(input.binaryPath) !== deps.pin.executableMemberName) throw fail('binary_name_mismatch');
  let isFile = false;
  try {
    isFile = statSync(input.binaryPath).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) throw fail('binary_missing');
  const actualSha = await sha256File(input.binaryPath);
  evidence.executableSha256 = actualSha;
  if (actualSha !== input.expectedExecutableSha256) throw fail('executable_sha256_mismatch');

  const codexHome = input.expectedCodexHome;
  if (!isAbsolute(codexHome) || !isDirectory(codexHome)) throw fail('codex_home_invalid');
  if (realpathSync(codexHome) !== codexHome) throw fail('codex_home_not_canonical');
  evidence.codexHome = codexHome;
  const homeDir = input.homeDir ?? codexHome;
  const workDir = input.workDir ?? codexHome;

  // Same isolation as the server itself: the pinned binary writes into CODEX_HOME even for `--version`.
  const childEnv = { CODEX_HOME: codexHome, HOME: homeDir, PATH: CODEX_CHILD_PATH };
  evidence.childEnvKeys = Object.keys(childEnv);
  const version = await runVersion(input.binaryPath, childEnv, workDir, input.versionTimeoutMs ?? 10_000);
  if (version.exitCode !== 0) throw fail('version_command_failed');
  evidence.versionCommand = Object.freeze({
    argv: Object.freeze([input.binaryPath, '--version']),
    stdout: version.stdout,
    exitCode: 0,
  });
  const parsed = parseSingleSemanticVersion(version.stdout);
  if (parsed === null) throw fail('version_unparseable');
  evidence.parsedVersion = parsed;
  if (parsed !== input.expectedVersion) throw fail('version_mismatch');

  let handle: CodexProcessHandle;
  try {
    handle = await CodexProcessHandle.spawn({ binaryPath: input.binaryPath, codexHome, homeDir, workDir }, deps.ps);
  } catch {
    throw fail('spawn_failed');
  }
  evidence.process = Object.freeze({
    pid: handle.pid,
    pgid: handle.pgid,
    ownProcessGroupEvidence: handle.ownProcessGroupEvidence,
  });

  // The tap records the handshake only; it is switched off before the client is handed out, so a
  // long-lived session never accumulates wire lines here.
  const lines: { direction: 'out' | 'in'; line: string }[] = [];
  let tapping = true;
  const client = new CodexJsonRpcClient(
    { input: handle.stdout, output: handle.stdin },
    { wireTap: (direction, line) => (tapping ? lines.push({ direction, line }) : undefined) },
  );
  const abort = async (reason: RuntimeAttestationFailureReason): Promise<never> => {
    tapping = false;
    client.close();
    await handle.terminate({ graceMs: 2_000, killWaitMs: 3_000 }).catch(() => undefined);
    throw fail(reason);
  };

  const initialize = GovAICodexSafeRequestBuilder.initialize();
  let response: InitializeResponse;
  try {
    response = await client.request('initialize', initialize.params, {
      timeoutMs: input.initializeTimeoutMs ?? 20_000,
    });
  } catch {
    return abort('initialize_failed');
  }

  const sent = lines.find((l) => l.direction === 'out')?.line ?? '';
  evidence.initializeRequestLine = sent;
  if (sent !== frozenInitializeRequestLine(1)) return abort('initialize_request_bytes_mismatch');
  const sentParams = (JSON.parse(sent) as { params: { capabilities: Record<string, unknown> } }).params.capabilities;
  if (sentParams['experimentalApi'] !== false || sentParams['requestAttestation'] !== false) {
    return abort('initialize_request_bytes_mismatch');
  }
  evidence.experimentalApi = false;
  evidence.requestAttestation = false;
  evidence.initializeResponseLine = lines.find((l) => l.direction === 'in' && lineId(l.line) === 1)?.line ?? '';

  const r = response as unknown as Record<string, unknown>;
  if (
    typeof r['userAgent'] !== 'string' ||
    typeof r['codexHome'] !== 'string' ||
    typeof r['platformFamily'] !== 'string' ||
    typeof r['platformOs'] !== 'string'
  ) {
    return abort('initialize_response_invalid');
  }
  evidence.initializeResponse = Object.freeze({
    userAgent: response.userAgent,
    codexHome: response.codexHome,
    platformFamily: response.platformFamily,
    platformOs: response.platformOs,
  });
  if (response.codexHome !== codexHome) return abort('codex_home_mismatch');

  tapping = false;
  client.notifyInitialized();
  client[CODEX_CLIENT_UNLOCK_AFTER_ATTESTATION]();
  return Object.freeze({
    evidence: Object.freeze(evidence as CodexRuntimeAttestationEvidence),
    client,
    handle,
  });
}

/**
 * BUILD/CLIENT PROVENANCE (dispatch §2 attestation/): what this client was built against, exported as one
 * frozen object so later movements (E1 probes, evidence events) cite the pin instead of re-deriving it.
 */
export const CODEX_BUILD_CLIENT_PROVENANCE = Object.freeze({
  pin: CODEX_PIN,
  schema: CODEX_PIN_SCHEMA,
  generator: Object.freeze({
    typescript: 'ts-rs 11.1.0 via codex-app-server-protocol write_schema_fixtures, GenerateTsOptions::default() (experimental_api: false)',
    json: 'schemars 0.8.22 via codex-app-server-protocol generate_json (experimental_api: false)',
    derivedFragments: Object.freeze([
      'protocol/wire.ts (VERBATIM_SOURCE_DERIVED: rpc.rs, protocol/common.rs)',
      'protocol/method-names.ts (VERBATIM_SOURCE_DERIVED: generated unions)',
      'protocol/experimental-inventory.ts (VERBATIM_SOURCE_DERIVED: #[experimental] annotations)',
    ]),
  }),
  clientInfo: GOVAI_CODEX_CLIENT_INFO,
  wire: Object.freeze({ transport: 'stdio', listenUrl: CODEX_PIN.listenUrl, jsonrpcVersionField: 'OMITTED' }),
  serverReportedSchemaHash: 'NONE_AT_PIN',
});
