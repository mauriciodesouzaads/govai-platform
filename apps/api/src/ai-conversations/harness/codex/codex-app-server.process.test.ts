// CONT-P5-A — MANDATORY NO-CREDENTIAL PROCESS-INTEGRATION SUITE (dispatch §2 tests, §5 exit gate, P5A-DISP-02).
//
// Spawns the §0 executable (STANDALONE codex-app-server 0.154.0, darwin-arm64) from CODEX_PIN_BINARY in a
// disposable CODEX_HOME under this suite's temp dir and proves the mandatory A gates:
//   PINNED_PROCESS_SPAWN · STDIO_JSONRPC_CHANNEL · INITIALIZE_EXECUTED · RUNTIME_ATTESTATION ·
//   CODEX_HOME_ISOLATION · EXPERIMENTAL_API_FALSE · ABSOLUTE_BINARY_PATH · PROCESS_HANDLE_FOUNDATION ·
//   CONTROLLED_PROCESS_TERMINATION
// with NO credential, NO login and NO ~/.codex (CODEX_HOME and HOME are disposable; the environment is an
// allowlist). The optional thread lifecycle (thread/start → thread/read → thread/delete) is attempted without any
// credential; if the pinned server demanded authentication it would be recorded DEFERRED_TO_E1, never PASS.
//
// ★ TIER GATING, NOT BINARY GATING. The suite runs only when GOVAI_CODEX_PROCESS_TIER=1 (set by
//   ./vitest.process.config.ts). In that tier NOTHING skips: a missing/wrong binary, archive or digest, a wrong
//   version or CODEX_HOME, experimentalApi enabled or any failed attestation predicate FAILS the run. Under the
//   root unit config (CI) the suite is collected but not executed — CI runs the unit tier only (§5).
// ★ Evidence: when CONT_P5A_EVIDENCE_OUT names an absolute, not-yet-existing file, the recorded values are
//   written there (exclusive create) for the execution report. No credential value exists to be recorded.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attestRuntime, sha256File, type AttestedCodexRuntime } from './attestation/attest-runtime.js';
import { CodexServerError } from './client/errors.js';
import type { CodexClientEvent } from './client/json-rpc-client.js';
import type { CodexTerminationRecord, InGroupMember } from './client/process-handle.js';
import { CODEX_PIN } from './pin/PIN.js';
import { CODEX_EXPERIMENTAL_INVENTORY } from './protocol/experimental-inventory.js';
import { GovAICodexSafeRequestBuilder as B } from './protocol/govai-policy.js';
import type { CodexCoveredClientResponses } from './protocol/wire.js';

const PROCESS_TIER = process.env['GOVAI_CODEX_PROCESS_TIER'] === '1';
const AUTH_REQUIRED = /\b(auth|authenticat\w*|login|log in|credential\w*|api key|unauthori[sz]ed)\b/i;

type Gate =
  | 'PINNED_PROCESS_SPAWN'
  | 'STDIO_JSONRPC_CHANNEL'
  | 'INITIALIZE_EXECUTED'
  | 'RUNTIME_ATTESTATION'
  | 'CODEX_HOME_ISOLATION'
  | 'EXPERIMENTAL_API_FALSE'
  | 'ABSOLUTE_BINARY_PATH'
  | 'PROCESS_HANDLE_FOUNDATION'
  | 'CONTROLLED_PROCESS_TERMINATION';

const MANDATORY_GATES: readonly Gate[] = [
  'PINNED_PROCESS_SPAWN',
  'STDIO_JSONRPC_CHANNEL',
  'INITIALIZE_EXECUTED',
  'RUNTIME_ATTESTATION',
  'CODEX_HOME_ISOLATION',
  'EXPERIMENTAL_API_FALSE',
  'ABSOLUTE_BINARY_PATH',
  'PROCESS_HANDLE_FOUNDATION',
  'CONTROLLED_PROCESS_TERMINATION',
];

/** Inventory keys of generated `container` that are category (1) — absent from the generated types. */
function category1KeysOn(container: string, value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  return CODEX_EXPERIMENTAL_INVENTORY.filter(
    (e) => e.kind === 'field' && e.container === container && e.category === 'EXPERIMENTAL_ABSENT_FROM_GENERATED_WIRE',
  )
    .map((e) => e.wire)
    .filter((k) => Object.hasOwn(value, k))
    .sort();
}

describe.skipIf(!PROCESS_TIER)('CONT-P5-A process integration — pinned codex-app-server, no credential', () => {
  const gates = new Map<Gate, 'PASS'>();
  const evidence: Record<string, unknown> = { suite: 'codex-app-server.process.test.ts', startedAt: new Date().toISOString() };
  const events: CodexClientEvent[] = [];
  const notifications: string[] = [];
  let root = '';
  let codexHome = '';
  let home = '';
  let work = '';
  let binaryPath = '';
  let attested: AttestedCodexRuntime | undefined;
  let termination: CodexTerminationRecord | undefined;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'govai-cont-p5a-process-')));
    codexHome = join(root, 'codex-home');
    home = join(root, 'home');
    work = join(root, 'work');
    for (const d of [codexHome, home, work]) mkdirSync(d, { mode: 0o700 });
    evidence['disposableRoot'] = root;
  });

  afterAll(async () => {
    if (attested !== undefined && attested.handle.exited === null) {
      await attested.handle.terminate({ graceMs: 2_000, killWaitMs: 5_000 }).catch(() => undefined);
    }
    evidence['gates'] = Object.fromEntries(MANDATORY_GATES.map((g) => [g, gates.get(g) ?? 'NOT_PASSED']));
    evidence['finishedAt'] = new Date().toISOString();
    const out = process.env['CONT_P5A_EVIDENCE_OUT'];
    if (out !== undefined && isAbsolute(out)) writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    if (root !== '') rmSync(root, { recursive: true, force: true });
  });

  it('the pinned artifact: CODEX_PIN_BINARY / CODEX_PIN_ARCHIVE are the §0 asset, member and digests', async () => {
    const binary = process.env['CODEX_PIN_BINARY'] ?? '';
    const archive = process.env['CODEX_PIN_ARCHIVE'] ?? '';
    expect(binary, 'CODEX_PIN_BINARY must name the pinned executable — the process tier never skips').not.toBe('');
    expect(archive, 'CODEX_PIN_ARCHIVE must name the pinned release archive — the process tier never skips').not.toBe('');
    expect(isAbsolute(binary)).toBe(true);
    expect(isAbsolute(archive)).toBe(true);
    expect(statSync(binary).isFile()).toBe(true);
    expect(basename(binary)).toBe(CODEX_PIN.executableMemberName);
    expect(basename(archive)).toBe(CODEX_PIN.assetName);
    expect(statSync(archive).size).toBe(CODEX_PIN.assetSizeBytes);
    const archiveSha = await sha256File(archive);
    const binarySha = await sha256File(binary);
    expect(archiveSha).toBe(CODEX_PIN.archiveSha256);
    expect(binarySha).toBe(CODEX_PIN.executableSha256);
    // Archive → member binding: exactly one member, the §0 name, whose bytes ARE the pinned executable.
    const members = execFileSync('/usr/bin/tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter((l) => l !== '');
    expect(members).toEqual([CODEX_PIN.executableMemberName]);
    const memberBytes = execFileSync('/usr/bin/tar', ['-xOzf', archive, CODEX_PIN.executableMemberName], {
      maxBuffer: 512 * 1024 * 1024,
    });
    expect(createHash('sha256').update(memberBytes).digest('hex')).toBe(CODEX_PIN.executableSha256);
    binaryPath = binary;
    Object.assign(evidence, {
      CODEX_PIN_BINARY_PRESENT: 'YES',
      CODEX_PIN_BINARY_ABSOLUTE_PATH: binary,
      CODEX_PIN_BINARY_KIND: CODEX_PIN.binaryKind,
      CODEX_PIN_ASSET_NAME: basename(archive),
      CODEX_PIN_ASSET_ID: CODEX_PIN.assetId,
      CODEX_PIN_ARCHIVE_SHA256: archiveSha,
      CODEX_PIN_BINARY_SHA256: binarySha,
      ARCHIVE_MEMBERS: members,
      ARCHIVE_MEMBER_SHA256: CODEX_PIN.executableSha256,
      HOST: `${process.platform}-${process.arch}`,
    });
  });

  it('attestation: absolute-path spawn in its own group, stdio JSON-RPC, frozen initialize, CODEX_HOME answer', async () => {
    expect(binaryPath, 'the artifact test must pass first').not.toBe('');
    attested = await attestRuntime({
      binaryPath,
      expectedExecutableSha256: CODEX_PIN.executableSha256,
      expectedVersion: CODEX_PIN.release,
      expectedCodexHome: codexHome,
      homeDir: home,
      workDir: work,
    });
    attested.client.onEvent((e) => events.push(e));
    attested.client.onNotification((n) => notifications.push(n.method));
    const e = attested.evidence;

    // VERSION: executed, stdout verbatim, exactly one semantic version parsed and equal to the pin.
    expect(e.versionCommand.exitCode).toBe(0);
    expect(e.parsedVersion).toBe('0.154.0');
    // INITIALIZE: the §0.1 frozen bytes, capabilities explicitly false.
    const sent = JSON.parse(e.initializeRequestLine) as { id: number; method: string; params: { capabilities: object } };
    expect(sent.method).toBe('initialize');
    expect(sent.params.capabilities).toEqual({ experimentalApi: false, requestAttestation: false });
    expect(e.initializeRequestLine).not.toContain('jsonrpc');
    // CODEX_HOME: the server reports the disposable directory verbatim and actually uses it.
    expect(e.initializeResponse.codexHome).toBe(codexHome);
    const codexHomeEntries = readdirSync(codexHome).sort();
    expect(codexHomeEntries.length).toBeGreaterThan(0);
    expect(e.childEnvKeys).toEqual(['CODEX_HOME', 'HOME', 'PATH']);
    // ABSOLUTE PATH + OWN GROUP: the leader row names the absolute executable and has pgid == pid.
    const leader = e.process.ownProcessGroupEvidence as InGroupMember;
    expect(leader).toMatchObject({ pid: e.process.pid, pgid: e.process.pid });
    expect(leader.command).toBe(binaryPath);

    for (const g of [
      'PINNED_PROCESS_SPAWN',
      'STDIO_JSONRPC_CHANNEL',
      'INITIALIZE_EXECUTED',
      'RUNTIME_ATTESTATION',
      'CODEX_HOME_ISOLATION',
      'EXPERIMENTAL_API_FALSE',
      'ABSOLUTE_BINARY_PATH',
    ] as const) {
      gates.set(g, 'PASS');
    }
    Object.assign(evidence, {
      VERSION_COMMAND_EXECUTED: 'YES',
      VERSION_ARGV: e.versionCommand.argv,
      VERSION_STDOUT: e.versionCommand.stdout,
      PARSED_VERSION: e.parsedVersion,
      PARSED_VERSION_MATCH: 'PASS',
      INITIALIZE_REQUEST_BYTES: e.initializeRequestLine,
      INITIALIZE_RESPONSE_BYTES: e.initializeResponseLine,
      INITIALIZE_RESPONSE: e.initializeResponse,
      CHILD_ENV_KEYS: e.childEnvKeys,
      CHILD_CODEX_HOME: codexHome,
      CODEX_HOME_ENTRIES_AFTER_INITIALIZE: codexHomeEntries,
      PROCESS: e.process,
    });
  });

  it('process-handle foundation: own group, in-group member inventory, bounded stderr capture', async () => {
    expect(attested, 'attestation must pass first').toBeDefined();
    const handle = attested!.handle;
    const members = await handle.inventory();
    expect(members.some((m) => m.pid === handle.pid && m.pgid === handle.pid)).toBe(true);
    expect(members.every((m) => m.pgid === handle.pgid)).toBe(true);
    gates.set('PROCESS_HANDLE_FOUNDATION', 'PASS');
    Object.assign(evidence, {
      IN_GROUP_MEMBERS_AFTER_ATTESTATION: members,
      STDERR_CHARS_AT_INVENTORY: handle.stderr.totalChars,
    });
  });

  it('optional thread lifecycle without any credential: thread/start → thread/read → thread/delete', async () => {
    expect(attested, 'attestation must pass first').toBeDefined();
    const client = attested!.client;
    const start = B.threadStart({ approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' });
    evidence['THREAD_START_PARAMS'] = start.params;
    let started: CodexCoveredClientResponses['thread/start'];
    try {
      started = await client.request(start.method, start.params);
    } catch (error) {
      if (error instanceof CodexServerError && AUTH_REQUIRED.test(error.rpcMessage)) {
        Object.assign(evidence, {
          THREAD_LIFECYCLE_REQUIRES_AUTH: 'YES',
          THREAD_LIFECYCLE_EXECUTED_IN_A: 'NO',
          THREAD_LIFECYCLE_RESULT: 'DEFERRED_TO_E1',
          THREAD_START_ERROR: { code: error.rpcCode, message: error.rpcMessage },
        });
        return;
      }
      throw error;
    }
    const threadId = started.thread.id;
    expect(typeof threadId).toBe('string');
    expect(started.approvalPolicy).toBe('on-request');
    expect(started.approvalsReviewer).toBe('user');
    expect(started.sandbox).toMatchObject({ type: 'readOnly' });
    const read = await client.request('thread/read', B.threadRead({ threadId }).params);
    expect(read.thread.id).toBe(threadId);
    const deleted = await client.request('thread/delete', B.threadDelete({ threadId }).params);
    expect(deleted).toEqual({});
    Object.assign(evidence, {
      THREAD_LIFECYCLE_REQUIRES_AUTH: 'NO',
      THREAD_LIFECYCLE_EXECUTED_IN_A: 'YES',
      THREAD_LIFECYCLE_RESULT: 'PASS',
      THREAD_ID: threadId,
      THREAD_START_RESULT_KEYS: Object.keys(started).sort(),
      THREAD_START_SANDBOX: started.sandbox,
      THREAD_MODEL_PROVIDER: started.modelProvider,
      // Observed, not asserted: category (1) keys the pinned server put on the wire for an experimentalApi=false client.
      SERVER_EMITTED_CATEGORY_1_KEYS: {
        ThreadStartResponse: category1KeysOn('ThreadStartResponse', started),
        Thread: category1KeysOn('Thread', started.thread),
      },
    });
  });

  it('controlled termination: SIGTERM to the managed group, SIGKILL escalation if needed, direct child reaped', async () => {
    expect(attested, 'attestation must pass first').toBeDefined();
    const handle = attested!.handle;
    attested!.client.close();
    termination = await handle.terminate({ graceMs: 5_000, killWaitMs: 5_000 });
    expect(termination.sigtermSentToGroup).toBe(true);
    expect(termination.directChildReaped).toBe(true);
    expect(termination.exit.signal !== null || termination.exit.code !== null).toBe(true);
    expect(handle.exited).toEqual(termination.exit);
    const leaderGone = (await handle.inventory()).every((m) => m.pid !== handle.pid);
    expect(leaderGone).toBe(true);
    gates.set('CONTROLLED_PROCESS_TERMINATION', 'PASS');
    Object.assign(evidence, {
      TERMINATION: termination,
      PROCESS_GROUP_CONTROL: 'FOUNDATION_ONLY',
      RESOURCE_FENCING_GATE: 'OPEN',
      DESCENDANT_QUIESCENCE_PROOF: 'DEFERRED (E1)',
      STALE_WRITER_PROOF: 'DEFERRED (E1)',
      PROCESS_ESCAPE_DETECTION: 'DEFERRED (C/E2)',
      NOTIFICATIONS_DELIVERED: notifications,
      CLIENT_EVENTS: events.map((ev) => {
        if (ev.type === 'closed') return { type: ev.type, code: ev.error.code };
        if (ev.type === 'unknown_method') return { type: ev.type, method: ev.error.method };
        if (ev.type === 'rejected_notification') return { type: ev.type, method: ev.method };
        return { type: ev.type, failure: ev.error.failure };
      }),
      STDERR_TOTAL_CHARS: handle.stderr.totalChars,
      HOME_ENTRIES_AT_END: readdirSync(home).sort(),
    });
  });

  it('§5: every mandatory gate PASSED in this run (a green run without every value is not a PASS)', () => {
    expect(Object.fromEntries(MANDATORY_GATES.map((g) => [g, gates.get(g)]))).toEqual(
      Object.fromEntries(MANDATORY_GATES.map((g) => [g, 'PASS'])),
    );
    for (const key of [
      'CODEX_PIN_BINARY_ABSOLUTE_PATH',
      'VERSION_STDOUT',
      'PARSED_VERSION',
      'INITIALIZE_REQUEST_BYTES',
      'INITIALIZE_RESPONSE_BYTES',
      'THREAD_LIFECYCLE_RESULT',
      'TERMINATION',
    ]) {
      expect(evidence[key], key).toBeDefined();
    }
    evidence['PROCESS_INTEGRATION_EXECUTED'] = 'YES';
    evidence['PROCESS_INTEGRATION_SKIPPED'] = 'NO';
    evidence['PROCESS_INTEGRATION_RESULT'] = 'PASS';
  });
});
