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
  | 'own_process_group_not_created';

export class CodexProcessSpawnRefused extends Error {
  readonly code = 'codex_process_spawn_refused';
  constructor(
    readonly reason: CodexProcessSpawnRefusal,
    readonly subject: string,
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

export type CodexTerminationRecord = {
  readonly pid: number;
  readonly pgid: number;
  readonly inGroupMembersBeforeTermination: readonly InGroupMember[];
  /** SIGTERM_TO_MANAGED_GROUP — `kill(-pgid, SIGTERM)` was delivered. */
  readonly sigtermSentToGroup: boolean;
  /** SIGKILL_ESCALATION_TO_MANAGED_GROUP — the leader or an in-group member outlived the grace period. */
  readonly sigkillSentToGroup: boolean;
  readonly exit: CodexProcessExit;
  /** DIRECT_CHILD_REAP — the leader's exit status was collected (the ChildProcess `exit` event fired). */
  readonly directChildReaped: true;
  /** Recorded, NOT a claim: members still carrying this pgid after termination (FOUNDATION_ONLY). */
  readonly inGroupMembersAfterTermination: readonly InGroupMember[];
};

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
    const pid = child.pid;
    if (pid === undefined) throw new CodexProcessSpawnRefused('spawn_failed', input.binaryPath);
    const handle = new CodexProcessHandle(child, pid, input.binaryPath, env, ps);

    // Prove the group before handing the handle out: the leader must be listed with pgid == pid.
    const leader = (await handle.inventory()).find((m) => m.pid === pid);
    if (leader !== undefined) {
      handle.groupLeaderObserved = leader;
    } else if (handle.exited === null) {
      await handle.terminate({ graceMs: 1_000, killWaitMs: 2_000 });
      throw new CodexProcessSpawnRefused('own_process_group_not_created', input.binaryPath);
    }
    return handle;
  }

  /** IN_GROUP_MEMBER_INVENTORY: every live process whose pgid is this handle's group. */
  async inventory(): Promise<InGroupMember[]> {
    return parsePsInventory(await this.ps()).filter((m) => m.pgid === this.pgid);
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
   * CONTROLLED TERMINATION: SIGTERM to the managed group; wait up to `graceMs` for the leader to exit and
   * the group to drain; SIGKILL the group if anything in it outlived the grace; collect the leader's exit.
   */
  async terminate(options: { readonly graceMs?: number; readonly killWaitMs?: number } = {}): Promise<CodexTerminationRecord> {
    const graceMs = options.graceMs ?? 5_000;
    const killWaitMs = options.killWaitMs ?? 5_000;
    const before = await this.inventory();
    const sigterm = this.exitInfo === null || before.length > 0 ? this.signalGroup('SIGTERM') : false;

    const deadline = Date.now() + graceMs;
    let exit = await this.waitForExit(graceMs);
    let remaining = await this.inventory();
    while (exit !== null && remaining.length > 0 && Date.now() < deadline) {
      await sleep(100);
      remaining = await this.inventory();
    }

    let sigkill = false;
    if (exit === null || remaining.length > 0) {
      sigkill = this.signalGroup('SIGKILL');
      exit = exit ?? (await this.waitForExit(killWaitMs));
    }
    if (exit === null) {
      throw new Error(`codex process ${this.pid} was not reaped after SIGKILL to its group`);
    }
    this.child.stdin.destroy();
    const after = await this.inventory();
    return {
      pid: this.pid,
      pgid: this.pgid,
      inGroupMembersBeforeTermination: before,
      sigtermSentToGroup: sigterm,
      sigkillSentToGroup: sigkill,
      exit,
      directChildReaped: true,
      inGroupMembersAfterTermination: after,
    };
  }

  /** `kill(-pgid, signal)`; `false` when the group no longer exists (ESRCH). */
  private signalGroup(signal: 'SIGTERM' | 'SIGKILL'): boolean {
    try {
      process.kill(-this.pgid, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw error;
    }
  }
}
