// CONT-P5-A — CodexProcessHandle FOUNDATION (dispatch §2 client/, P5A-DISP-05).
//
// Spawns the §0 executable by ABSOLUTE path, in its OWN process group, with an EXPLICIT environment, and
// offers exactly the foundation controls the dispatch permits claiming for A:
//   PROCESS_HANDLE_FOUNDATION · OWN_PROCESS_GROUP_CREATION · IN_GROUP_MEMBER_INVENTORY ·
//   SIGTERM_TO_MANAGED_GROUP · SIGKILL_ESCALATION_TO_MANAGED_GROUP · DIRECT_CHILD_REAP
//
// ★ WHAT THIS IS NOT. It does not claim ALL_DESCENDANTS_TERMINATED, NO_ORPHANS, NO_MCP_RESIDUE or any
//   resource-fencing closure: a descendant can leave the group (setsid/setpgid) and then no group signal
//   reaches it. PROCESS_GROUP_CONTROL = FOUNDATION_ONLY; RESOURCE_FENCING_GATE stays OPEN;
//   DESCENDANT_QUIESCENCE_PROOF and STALE_WRITER_PROOF are DEFERRED (E1); PROCESS_ESCAPE_DETECTION is DEFERRED
//   (C/E2). The post-termination inventory is RECORDED, never asserted empty.
// ★ ENVIRONMENT = ALLOWLIST, NOT INHERITANCE. The child sees CODEX_HOME, HOME and a fixed system PATH and
//   nothing else: no provider key, token or proxy variable of the parent can reach it. CODEX_HOME and HOME
//   are caller-owned disposable directories — the pinned server writes into CODEX_HOME even for `--version`
//   (tmp/arg0), so the real ~/.codex is never a valid target. No credential is injected (CONT-P5-C).
// ★ TWO PLANES. SAFETY = the owned ChildProcess, its pid, pgid == pid (`detached: true`), `kill(-pgid, …)` and the
//   `exit` event. DIAGNOSTIC = the `ps` inventory: best-effort, bounded (CODEX_INVENTORY_BOUND_MS), never thrown
//   out of `spawn()` or `terminate()`. How the diagnostic plane relates to signalling is the two-state law of
//   `terminate()`: while the direct child is alive the group is owned and signalled regardless of the inventory;
//   after its exit a group signal needs current positive inventory evidence, and an unavailable inventory means
//   no blind signal (the residue is recorded as unknown).
// ★ OWNERSHIP STARTS AT THE `spawn` EVENT. From then on `spawn()` either returns the handle or completes the owned
//   cleanup before rejecting, and every failure carries the cleanup outcome; cleanup failure is typed
//   (`CodexProcessCleanupFailed`), never a plain Error and never swallowed.
// ★ No supervisor policy, no restart, no fencing: those belong to later movements.

import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { statSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { CODEX_PIN } from '../pin/PIN.js';

export const CODEX_CHILD_ENV_KEYS = ['CODEX_HOME', 'HOME', 'PATH'] as const;
/** Fixed system PATH for the child: the parent's PATH (and whatever `codex` it may contain) is never inherited. */
export const CODEX_CHILD_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
export const CODEX_STDERR_CAPTURE_CHARS = 256 * 1024;

export type CodexProcessSpawnInput = {
  /** Absolute, normalized path of the §0 executable. Never resolved through $PATH. */
  readonly binaryPath: string;
  /** Disposable CODEX_HOME (absolute, existing directory). */
  readonly codexHome: string;
  /** Disposable HOME for the child (absolute, existing directory). */
  readonly homeDir: string;
  /** Child working directory (absolute, existing directory). */
  readonly workDir: string;
};

export type CodexProcessSpawnRefusal =
  | 'binary_path_not_absolute'
  | 'binary_not_a_file'
  | 'directory_not_absolute'
  | 'directory_missing'
  | 'spawn_failed'
  | 'own_process_group_not_created'
  /** The initial inventory was unavailable, so the group was not proven: fail closed (owned cleanup, no handle). */
  | 'inventory_unavailable';

export class CodexProcessSpawnRefused extends Error {
  readonly code = 'codex_process_spawn_refused';
  constructor(
    readonly reason: CodexProcessSpawnRefusal,
    readonly subject: string,
    /** Present whenever a process was owned (after the `spawn` event): the outcome of its owned cleanup. */
    readonly cleanup?: CodexCleanupOutcome,
  ) {
    super(`codex process spawn refused: ${reason} (${subject})`);
    this.name = 'CodexProcessSpawnRefused';
  }
}

export type InGroupMember = {
  readonly pid: number;
  readonly pgid: number;
  readonly ppid: number;
  readonly command: string;
};

/** Output of `ps -A -o pid=,pgid=,ppid=,comm=` (injectable for tests). */
export type PsRunner = () => Promise<string>;

export const systemPsRunner: PsRunner = () =>
  new Promise((resolve, reject) => {
    execFile('/bin/ps', ['-A', '-o', 'pid=,pgid=,ppid=,comm='], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });

/** Parse `pid pgid ppid command…` rows; the command keeps its spaces. */
export function parsePsInventory(output: string): InGroupMember[] {
  const rows: InGroupMember[] = [];
  for (const line of output.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*?)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), pgid: Number(m[2]), ppid: Number(m[3]), command: m[4] ?? '' });
  }
  return rows;
}

export type CodexProcessExit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

/** DIAGNOSTIC plane: the result of ONE bounded inventory attempt. */
export type CodexInventoryAttempt =
  | { readonly status: 'ok'; readonly members: readonly InGroupMember[] }
  | { readonly status: 'unavailable'; readonly reason: 'ps_failed' | 'ps_timeout' };

/** Bound of every diagnostic call that precedes a signalling decision; a timeout is treated as unavailable. */
export const CODEX_INVENTORY_BOUND_MS = 1_000;

/** What the last diagnostic after the direct child's exit could say about the group — recorded, never claimed. */
export type CodexInGroupResidue = 'none_observed' | 'members_observed' | 'unknown_inventory_unavailable';

/**
 * Result of one `kill(-pgid, signal)`. `not_permitted` (EPERM) is what macOS answers when the group holds only
 * zombies — e.g. the direct child has exited but is not reaped yet. Nothing was delivered in either non-delivered
 * case; the sequence continues, and a child that is never reaped still ends in a typed failure.
 */
export type CodexGroupSignalResult = 'delivered' | 'no_such_group' | 'not_permitted';
export type CodexGroupSignal = { readonly signal: 'SIGTERM' | 'SIGKILL'; readonly result: CodexGroupSignalResult };

export type CodexTerminationRecord = {
  readonly pid: number;
  readonly pgid: number;
  /** `null` = the diagnostic inventory was unavailable (unknown, NOT empty). */
  readonly inGroupMembersBeforeTermination: readonly InGroupMember[] | null;
  /** SIGTERM_TO_MANAGED_GROUP — `kill(-pgid, SIGTERM)` was delivered. */
  readonly sigtermSentToGroup: boolean;
  /**
   * SIGKILL_ESCALATION_TO_MANAGED_GROUP — the direct child outlived the grace period, or current positive
   * inventory evidence showed members left in the group after its exit.
   */
  readonly sigkillSentToGroup: boolean;
  readonly exit: CodexProcessExit;
  /** DIRECT_CHILD_REAP — the leader's exit status was collected (the ChildProcess `exit` event fired). */
  readonly directChildReaped: true;
  /** Recorded, NOT a claim: members still carrying this pgid after termination; `null` = inventory unavailable. */
  readonly inGroupMembersAfterTermination: readonly InGroupMember[] | null;
  readonly inGroupResidue: CodexInGroupResidue;
  /** Every group signal attempted by this termination, in order, with its result. */
  readonly signals: readonly CodexGroupSignal[];
  /** Every diagnostic attempt of this termination, in order, with its status. */
  readonly diagnostics: readonly CodexInventoryAttempt[];
};

/** What an owned cleanup had done when it stopped. */
export type CodexCleanupProgress = {
  readonly sigtermSentToGroup: boolean;
  readonly sigkillSentToGroup: boolean;
  readonly signals: readonly CodexGroupSignal[];
  readonly diagnostics: readonly CodexInventoryAttempt[];
};

export type CodexProcessCleanupFailure = 'not_reaped_after_sigkill' | 'unexpected_error';

/** Owned cleanup did not complete. Typed, carrying its progress: never a plain Error, never swallowed. */
export class CodexProcessCleanupFailed extends Error {
  readonly code = 'codex_process_cleanup_failed';
  constructor(
    readonly failure: CodexProcessCleanupFailure,
    readonly pid: number,
    readonly pgid: number,
    readonly progress: CodexCleanupProgress,
    cause?: unknown,
  ) {
    super(`codex process cleanup failed: ${failure} (pid ${pid})`, cause === undefined ? undefined : { cause });
    this.name = 'CodexProcessCleanupFailed';
  }
}

/** The outcome of an owned cleanup, attached to every failure that follows one. */
export type CodexCleanupOutcome =
  | { readonly status: 'terminated'; readonly record: CodexTerminationRecord }
  | { readonly status: 'failed'; readonly error: CodexProcessCleanupFailed };

const NO_CLEANUP_PROGRESS: CodexCleanupProgress = Object.freeze({
  sigtermSentToGroup: false,
  sigkillSentToGroup: false,
  signals: Object.freeze([]),
  diagnostics: Object.freeze([]),
});

function hasMembers(attempt: CodexInventoryAttempt | null): boolean {
  return attempt !== null && attempt.status === 'ok' && attempt.members.length > 0;
}

function assertAbsoluteDirectory(path: string): void {
  if (!isAbsolute(path) || normalize(path) !== path) throw new CodexProcessSpawnRefused('directory_not_absolute', path);
  let isDir = false;
  try {
    isDir = statSync(path).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new CodexProcessSpawnRefused('directory_missing', path);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class CodexProcessHandle {
  private exitInfo: CodexProcessExit | null = null;
  private readonly exitWaiters = new Set<(exit: CodexProcessExit) => void>();
  private stderrTail = '';
  private stderrTotalChars = 0;
  private groupLeaderObserved: InGroupMember | null = null;
  private inFlightTermination: Promise<CodexTerminationRecord> | null = null;

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    readonly pid: number,
    readonly binaryPath: string,
    readonly env: Readonly<Record<(typeof CODEX_CHILD_ENV_KEYS)[number], string>>,
    private readonly ps: PsRunner,
  ) {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrTotalChars += chunk.length;
      this.stderrTail = (this.stderrTail + chunk).slice(-CODEX_STDERR_CAPTURE_CHARS);
    });
    child.on('exit', (code, signal) => {
      this.exitInfo = { code, signal };
      for (const waiter of this.exitWaiters) waiter(this.exitInfo);
      this.exitWaiters.clear();
    });
  }

  /** OWN_PROCESS_GROUP_CREATION: `detached: true` makes the child a session and process-group leader (pgid = pid). */
  get pgid(): number {
    return this.pid;
  }

  /**
   * The raw pipes. A documented, OPEN structural seam: bytes written here do not pass the client's mandatory
   * outbound policy. Not hardened in CONT-P5-A (a later supervisor-authority movement may); the policy guarantee
   * is scoped to `CodexJsonRpcClient`.
   */
  get stdin(): Writable {
    return this.child.stdin;
  }

  get stdout(): Readable {
    return this.child.stdout;
  }

  get exited(): CodexProcessExit | null {
    return this.exitInfo;
  }

  /**
   * The inventory row that proved OWN_PROCESS_GROUP_CREATION at spawn (pid == pgid), or `null` if the child
   * exited before it could be observed — in which case the group was NOT proven and nothing claims it was.
   */
  get ownProcessGroupEvidence(): InGroupMember | null {
    return this.groupLeaderObserved;
  }

  /** Bounded capture of the child's stderr (last `CODEX_STDERR_CAPTURE_CHARS` characters). */
  get stderr(): { readonly tail: string; readonly totalChars: number } {
    return { tail: this.stderrTail, totalChars: this.stderrTotalChars };
  }

  static async spawn(input: CodexProcessSpawnInput, ps: PsRunner = systemPsRunner): Promise<CodexProcessHandle> {
    if (!isAbsolute(input.binaryPath) || normalize(input.binaryPath) !== input.binaryPath) {
      throw new CodexProcessSpawnRefused('binary_path_not_absolute', input.binaryPath);
    }
    let isFile = false;
    try {
      isFile = statSync(input.binaryPath).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) throw new CodexProcessSpawnRefused('binary_not_a_file', input.binaryPath);
    for (const dir of [input.codexHome, input.homeDir, input.workDir]) assertAbsoluteDirectory(dir);

    const env = Object.freeze({ CODEX_HOME: input.codexHome, HOME: input.homeDir, PATH: CODEX_CHILD_PATH });
    const child = spawn(input.binaryPath, ['--listen', CODEX_PIN.listenUrl], {
      cwd: input.workDir,
      env: { ...env },
      detached: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', () => reject(new CodexProcessSpawnRefused('spawn_failed', input.binaryPath)));
    });
    // (No pid after `spawn` cannot happen: there is then no process to own.)
    const pid = child.pid;
    if (pid === undefined) throw new CodexProcessSpawnRefused('spawn_failed', input.binaryPath);
    // ★ Ownership starts here. Every path below returns the handle or completes the owned cleanup first.
    const handle = new CodexProcessHandle(child, pid, input.binaryPath, env, ps);

    // Prove the group before handing the handle out: the leader must be listed with pgid == pid.
    const initial = await handle.inventoryAttempt();
    if (initial.status === 'unavailable') throw await handle.refusedAfterCleanup('inventory_unavailable');
    const leader = initial.members.find((m) => m.pid === pid);
    if (leader !== undefined) {
      handle.groupLeaderObserved = leader;
    } else if (handle.exited === null) {
      throw await handle.refusedAfterCleanup('own_process_group_not_created');
    }
    return handle;
  }

  private async refusedAfterCleanup(reason: CodexProcessSpawnRefusal): Promise<CodexProcessSpawnRefused> {
    const cleanup = await cleanupOwnedProcess(this, { graceMs: 1_000, killWaitMs: 2_000 });
    return new CodexProcessSpawnRefused(reason, this.binaryPath, cleanup);
  }

  /** IN_GROUP_MEMBER_INVENTORY: every live process whose pgid is this handle's group (rejects if `ps` fails). */
  async inventory(): Promise<InGroupMember[]> {
    return parsePsInventory(await this.ps()).filter((m) => m.pgid === this.pgid);
  }

  /** The DIAGNOSTIC plane: ONE inventory attempt, bounded by `boundMs` (timeout ≡ unavailable). Never throws. */
  async inventoryAttempt(boundMs: number = CODEX_INVENTORY_BOUND_MS): Promise<CodexInventoryAttempt> {
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<CodexInventoryAttempt>((resolve) => {
      timer = setTimeout(() => resolve({ status: 'unavailable', reason: 'ps_timeout' }), boundMs);
    });
    const attempt = this.inventory().then(
      (members): CodexInventoryAttempt => ({ status: 'ok', members: Object.freeze(members) }),
      (): CodexInventoryAttempt => ({ status: 'unavailable', reason: 'ps_failed' }),
    );
    try {
      return Object.freeze(await Promise.race([attempt, bound]));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Resolve with the exit record, or `null` if the leader has not exited within `timeoutMs`. */
  waitForExit(timeoutMs: number): Promise<CodexProcessExit | null> {
    if (this.exitInfo !== null) return Promise.resolve(this.exitInfo);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.exitWaiters.delete(onExit);
        resolve(null);
      }, timeoutMs);
      const onExit = (exit: CodexProcessExit): void => {
        clearTimeout(timer);
        resolve(exit);
      };
      this.exitWaiters.add(onExit);
    });
  }

  /**
   * CONTROLLED TERMINATION under the TWO-STATE SIGNALLING LAW:
   *   WHILE_DIRECT_CHILD_IS_ALIVE — GovAI owns a live direct child whose pid == pgid: a bounded or unavailable
   *     diagnostic inventory never prevents the safety signal to the owned group.
   *   AFTER_DIRECT_CHILD_EXIT_HAS_BEEN_OBSERVED — blind ownership through the live leader is gone: a residual group
   *     signal needs CURRENT POSITIVE inventory evidence of a process in the pgid; with the inventory unavailable
   *     nothing is signalled and the residue is recorded `unknown_inventory_unavailable`.
   * Sequence: bounded diagnostic → SIGTERM → wait `graceMs` → child still alive → SIGKILL → wait `killWaitMs` →
   * still alive → typed `CodexProcessCleanupFailed`. Idempotent; concurrent calls share one in-flight promise.
   */
  async terminate(options: { readonly graceMs?: number; readonly killWaitMs?: number } = {}): Promise<CodexTerminationRecord> {
    if (this.inFlightTermination !== null) return this.inFlightTermination;
    const run = this.runTermination(options.graceMs ?? 5_000, options.killWaitMs ?? 5_000);
    this.inFlightTermination = run;
    try {
      return await run;
    } finally {
      this.inFlightTermination = null;
    }
  }

  private async runTermination(graceMs: number, killWaitMs: number): Promise<CodexTerminationRecord> {
    const progress = {
      sigtermSentToGroup: false,
      sigkillSentToGroup: false,
      signals: [] as CodexGroupSignal[],
      diagnostics: [] as CodexInventoryAttempt[],
    };
    const snapshot = (): CodexCleanupProgress =>
      Object.freeze({
        ...progress,
        signals: Object.freeze([...progress.signals]),
        diagnostics: Object.freeze([...progress.diagnostics]),
      });
    const diagnose = async (): Promise<CodexInventoryAttempt> => {
      const attempt = await this.inventoryAttempt();
      progress.diagnostics.push(attempt);
      return attempt;
    };
    const signal = (name: 'SIGTERM' | 'SIGKILL'): boolean => {
      const result = this.signalGroup(name);
      progress.signals.push(Object.freeze({ signal: name, result }));
      return result === 'delivered';
    };
    try {
      const before = await diagnose();
      // Checked and signalled in the same synchronous step: an unreaped child still holds its pid (and group).
      if (this.exitInfo === null || hasMembers(before)) progress.sigtermSentToGroup = signal('SIGTERM');

      const deadline = Date.now() + graceMs;
      let exit = await this.waitForExit(graceMs);
      let residue: CodexInventoryAttempt | null = null;
      if (exit !== null) {
        residue = await diagnose();
        while (hasMembers(residue) && Date.now() < deadline) {
          await sleep(100);
          residue = await diagnose();
        }
      }
      if (exit === null) {
        // The direct child outlived the grace; not reaped, so still owned: SIGKILL to its group.
        if (this.exitInfo === null) progress.sigkillSentToGroup = signal('SIGKILL');
        exit = await this.waitForExit(killWaitMs);
        if (exit === null) {
          throw new CodexProcessCleanupFailed('not_reaped_after_sigkill', this.pid, this.pgid, snapshot());
        }
      } else if (hasMembers(residue)) {
        // After the exit: only CURRENT POSITIVE evidence of members in the managed group justifies a signal.
        progress.sigkillSentToGroup = signal('SIGKILL');
      }
      this.child.stdin.destroy();
      const after = await diagnose();
      const record: CodexTerminationRecord = {
        pid: this.pid,
        pgid: this.pgid,
        inGroupMembersBeforeTermination: before.status === 'ok' ? before.members : null,
        sigtermSentToGroup: progress.sigtermSentToGroup,
        sigkillSentToGroup: progress.sigkillSentToGroup,
        exit,
        directChildReaped: true,
        inGroupMembersAfterTermination: after.status === 'ok' ? after.members : null,
        inGroupResidue:
          after.status === 'unavailable'
            ? 'unknown_inventory_unavailable'
            : after.members.length > 0
              ? 'members_observed'
              : 'none_observed',
        signals: snapshot().signals,
        diagnostics: snapshot().diagnostics,
      };
      return Object.freeze(record);
    } catch (error) {
      if (error instanceof CodexProcessCleanupFailed) throw error;
      throw new CodexProcessCleanupFailed('unexpected_error', this.pid, this.pgid, snapshot(), error);
    }
  }

  /** `kill(-pgid, signal)`, with its result; any other error propagates (and is typed by `runTermination`). */
  private signalGroup(signal: 'SIGTERM' | 'SIGKILL'): CodexGroupSignalResult {
    try {
      process.kill(-this.pgid, signal);
      return 'delivered';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return 'no_such_group';
      if (code === 'EPERM') return 'not_permitted';
      throw error;
    }
  }
}

/** Owned cleanup, reported: the outcome is returned (never thrown, never swallowed) for the caller to attach. */
export async function cleanupOwnedProcess(
  handle: CodexProcessHandle,
  options: { readonly graceMs?: number; readonly killWaitMs?: number },
): Promise<CodexCleanupOutcome> {
  let outcome: CodexCleanupOutcome;
  try {
    outcome = { status: 'terminated', record: await handle.terminate(options) };
  } catch (error) {
    // `terminate()` only throws CodexProcessCleanupFailed; anything else is wrapped, not dropped.
    outcome = {
      status: 'failed',
      error:
        error instanceof CodexProcessCleanupFailed
          ? error
          : new CodexProcessCleanupFailed('unexpected_error', handle.pid, handle.pgid, NO_CLEANUP_PROGRESS, error),
    };
  }
  return Object.freeze(outcome);
}
