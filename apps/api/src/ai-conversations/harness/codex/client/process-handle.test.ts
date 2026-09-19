// CONT-P5-A — CodexProcessHandle FOUNDATION against a unit-tier fake executable (real spawn / group / signals).
//
// Proves the foundation mechanics on any POSIX host. It does NOT prove anything about the pinned binary —
// that is `codex-app-server.process.test.ts` — and it never asserts descendant quiescence (FOUNDATION_ONLY).

import { rmSync } from 'node:fs';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  FAKE_APP_SERVER_READY,
  makeDisposableDirs,
  RUNTIME_SELF_SET_ENV_KEYS,
  writeFakeAppServer,
} from './fake-app-server.fixture.js';
import {
  CODEX_CHILD_ENV_KEYS,
  CODEX_CHILD_PATH,
  CODEX_INVENTORY_BOUND_MS,
  CodexProcessCleanupFailed,
  CodexProcessHandle,
  CodexProcessSpawnRefused,
  parsePsInventory,
  systemPsRunner,
  type CodexProcessSpawnInput,
  type PsRunner,
} from './process-handle.js';

const dirs = makeDisposableDirs('govai-cont-p5a-handle-');
const handles: CodexProcessHandle[] = [];

afterAll(async () => {
  for (const h of handles) if (h.exited === null) await h.terminate({ graceMs: 500, killWaitMs: 2_000 });
  rmSync(dirs.root, { recursive: true, force: true });
});

function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

// LEAK LAW: every test proves in afterEach that the processes IT spawned are gone, and kills its own group if not.
const ownedByThisTest: { pid: number; handle: CodexProcessHandle | undefined }[] = [];
function own(pid: number, handle?: CodexProcessHandle): void {
  ownedByThisTest.push({ pid, handle });
}

afterEach(() => {
  vi.restoreAllMocks();
  const alive = ownedByThisTest.filter(({ pid, handle }) => (handle === undefined || handle.exited === null) && !processGone(pid));
  for (const { pid } of alive) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // not a group leader (or already gone): the pid itself
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
  ownedByThisTest.length = 0;
  expect(alive.map((o) => o.pid), 'LEAK LAW: a process spawned by this test is still alive').toEqual([]);
});

function input(binaryPath: string): CodexProcessSpawnInput {
  return { binaryPath, codexHome: dirs.codexHome, homeDir: dirs.home, workDir: dirs.work };
}

async function spawnTracked(binaryPath: string, ps?: PsRunner): Promise<CodexProcessHandle> {
  const h = await CodexProcessHandle.spawn(input(binaryPath), ps);
  handles.push(h);
  own(h.pid, h);
  return h;
}

/** A `ps` runner the test switches between the real one, failing and never settling. */
function switchablePs(): { readonly ps: PsRunner; set(mode: 'real' | 'reject' | 'hang'): void } {
  let mode: 'real' | 'reject' | 'hang' = 'real';
  return {
    ps: () => {
      if (mode === 'reject') return Promise.reject(new Error('ps unavailable (test)'));
      if (mode === 'hang') return new Promise<string>(() => undefined);
      return systemPsRunner();
    },
    set(next) {
      mode = next;
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function refusal(spawnInput: CodexProcessSpawnInput): Promise<CodexProcessSpawnRefused> {
  const error = await CodexProcessHandle.spawn(spawnInput).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CodexProcessSpawnRefused);
  return error as CodexProcessSpawnRefused;
}

describe('spawn preconditions — absolute path only, disposable directories only', () => {
  it('refuses relative or non-normalized binary paths (never resolved through $PATH)', async () => {
    const fake = writeFakeAppServer(dirs.root, 'fake-app-server');
    expect((await refusal(input('fake-app-server'))).reason).toBe('binary_path_not_absolute');
    expect((await refusal(input('codex-app-server'))).reason).toBe('binary_path_not_absolute');
    expect((await refusal(input(`${dirs.root}/./fake-app-server`))).reason).toBe('binary_path_not_absolute');
    expect((await refusal(input(`${dirs.work}/../fake-app-server`))).reason).toBe('binary_path_not_absolute');
    expect((await refusal({ ...input(fake), binaryPath: `${dirs.root}/missing` })).reason).toBe('binary_not_a_file');
  });

  it('refuses missing or relative CODEX_HOME / HOME / cwd', async () => {
    const fake = writeFakeAppServer(dirs.root, 'fake-app-server-dirs');
    expect((await refusal({ ...input(fake), codexHome: `${dirs.root}/nope` })).reason).toBe('directory_missing');
    expect((await refusal({ ...input(fake), homeDir: 'home' })).reason).toBe('directory_not_absolute');
    expect((await refusal({ ...input(fake), workDir: `${dirs.root}/nope` })).reason).toBe('directory_missing');
  });
});

describe('foundation controls', () => {
  it('creates its OWN process group and passes an explicit environment allowlist only', async () => {
    process.env['GOVAI_CONT_P5A_PARENT_SENTINEL'] = 'must-not-leak';
    try {
      const fake = writeFakeAppServer(dirs.root, 'fake-app-server-env', { reportEnvKeys: true });
      const h = await spawnTracked(fake);
      expect(h.ownProcessGroupEvidence).toMatchObject({ pid: h.pid, pgid: h.pid });
      expect(h.pgid).toBe(h.pid);
      // What the handle PASSES is exactly the allowlist…
      expect(h.env).toEqual({ CODEX_HOME: dirs.codexHome, HOME: dirs.home, PATH: CODEX_CHILD_PATH });
      await waitFor(() => h.stderr.tail.includes(FAKE_APP_SERVER_READY));
      const observed = JSON.parse(/ENV_KEYS=(\[.*\])/.exec(h.stderr.tail)?.[1] ?? '[]') as string[];
      // …and what the child OBSERVES is that allowlist plus, at most, keys its own runtime sets after exec.
      expect(observed).toEqual(expect.arrayContaining([...CODEX_CHILD_ENV_KEYS]));
      expect(observed.filter((k) => !(CODEX_CHILD_ENV_KEYS as readonly string[]).includes(k))).toEqual(
        observed.filter((k) => RUNTIME_SELF_SET_ENV_KEYS.includes(k)),
      );
      expect(observed).not.toContain('GOVAI_CONT_P5A_PARENT_SENTINEL');
      const record = await h.terminate({ graceMs: 3_000 });
      expect(record.directChildReaped).toBe(true);
    } finally {
      delete process.env['GOVAI_CONT_P5A_PARENT_SENTINEL'];
    }
  });

  it('inventories in-group members, SIGTERMs the managed group and reaps the direct child', async () => {
    const fake = writeFakeAppServer(dirs.root, 'fake-app-server-group', { spawnGroupChild: true });
    const h = await spawnTracked(fake);
    await waitFor(() => h.stderr.tail.includes('GROUP_CHILD='));
    const grandchild = Number(/GROUP_CHILD=(\d+)/.exec(h.stderr.tail)?.[1]);
    const members = await h.inventory();
    expect(members.map((m) => m.pid).sort()).toEqual([h.pid, grandchild].sort());
    expect(members.every((m) => m.pgid === h.pgid)).toBe(true);

    const record = await h.terminate({ graceMs: 5_000 });
    expect(record).toMatchObject({
      pid: h.pid,
      pgid: h.pid,
      sigtermSentToGroup: true,
      sigkillSentToGroup: false,
      directChildReaped: true,
      exit: { code: 0, signal: null },
    });
    expect(record.inGroupMembersBeforeTermination?.map((m) => m.pid).sort()).toEqual([h.pid, grandchild].sort());
    expect(h.stderr.tail).toContain('SIGTERM_RECEIVED');
    // Recorded, not claimed: the foundation reports what is left in the group; here the group drained.
    expect(record.inGroupMembersAfterTermination).toEqual([]);
  });

  it('escalates to SIGKILL on the managed group when SIGTERM is ignored', async () => {
    const fake = writeFakeAppServer(dirs.root, 'fake-app-server-stubborn', { ignoreSigterm: true });
    const h = await spawnTracked(fake);
    await waitFor(() => h.stderr.tail.includes(FAKE_APP_SERVER_READY));
    const record = await h.terminate({ graceMs: 400, killWaitMs: 5_000 });
    expect(record).toMatchObject({
      sigtermSentToGroup: true,
      sigkillSentToGroup: true,
      directChildReaped: true,
      exit: { code: null, signal: 'SIGKILL' },
    });
    expect(h.stderr.tail).toContain('SIGTERM_IGNORED');
    expect(h.exited).toEqual({ code: null, signal: 'SIGKILL' });
  });

  it('is idempotent on an already-exited child and never signals a vanished group', async () => {
    const fake = writeFakeAppServer(dirs.root, 'fake-app-server-twice');
    const h = await spawnTracked(fake);
    await h.terminate({ graceMs: 3_000 });
    const again = await h.terminate({ graceMs: 100 });
    expect(again).toMatchObject({ sigtermSentToGroup: false, sigkillSentToGroup: false, directChildReaped: true });
  });
});

describe('R3 — ownership from the spawn event and the two-state signalling law', () => {
  it('initial inventory fails after a real detached spawn: the child is gone, the refusal is typed with its cleanup', async () => {
    const fake = writeFakeAppServer(dirs.root, 'fake-app-server-ps-down');
    const sw = switchablePs();
    sw.set('reject');
    const error = await CodexProcessHandle.spawn(input(fake), sw.ps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodexProcessSpawnRefused);
    const refused = error as CodexProcessSpawnRefused;
    if (refused.cleanup?.status === 'terminated') own(refused.cleanup.record.pid);
    if (refused.cleanup?.status === 'failed') own(refused.cleanup.error.pid);
    expect(refused.reason).toBe('inventory_unavailable');
    expect(refused.cleanup?.status).toBe('terminated');
    const record = refused.cleanup?.status === 'terminated' ? refused.cleanup.record : undefined;
    expect(record).toMatchObject({
      sigtermSentToGroup: true,
      directChildReaped: true,
      inGroupMembersBeforeTermination: null,
      inGroupResidue: 'unknown_inventory_unavailable',
    });
    expect(record?.diagnostics.every((d) => d.status === 'unavailable')).toBe(true);
    expect(processGone(record!.pid)).toBe(true);
  });

  it('child alive + inventory failing on every call: SIGTERM is still sent and the child reaped', async () => {
    const sw = switchablePs();
    const h = await spawnTracked(writeFakeAppServer(dirs.root, 'fake-app-server-ps-fails'), sw.ps);
    await waitFor(() => h.stderr.tail.includes(FAKE_APP_SERVER_READY));
    sw.set('reject');
    const record = await h.terminate({ graceMs: 3_000 });
    expect(record).toMatchObject({
      sigtermSentToGroup: true,
      sigkillSentToGroup: false,
      directChildReaped: true,
      inGroupMembersBeforeTermination: null,
      inGroupMembersAfterTermination: null,
      inGroupResidue: 'unknown_inventory_unavailable',
    });
    expect(record.diagnostics.length).toBeGreaterThan(0);
    expect(record.diagnostics.every((d) => d.status === 'unavailable' && d.reason === 'ps_failed')).toBe(true);
    expect(h.stderr.tail).toContain('SIGTERM_RECEIVED');
  });

  it('child alive + inventory never settling: the signal is sent within the diagnostic bound', async () => {
    const sw = switchablePs();
    const h = await spawnTracked(writeFakeAppServer(dirs.root, 'fake-app-server-ps-hangs'), sw.ps);
    await waitFor(() => h.stderr.tail.includes(FAKE_APP_SERVER_READY));
    sw.set('hang');
    const realKill = process.kill.bind(process);
    let signalledAt: number | null = null;
    vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
      if (pid === -h.pgid && signalledAt === null) signalledAt = Date.now();
      return realKill(pid, signal);
    });
    const started = Date.now();
    const record = await h.terminate({ graceMs: 3_000 });
    expect(signalledAt).not.toBeNull();
    expect(signalledAt! - started).toBeLessThanOrEqual(CODEX_INVENTORY_BOUND_MS + 500);
    expect(record.diagnostics[0]).toEqual({ status: 'unavailable', reason: 'ps_timeout' });
    expect(record).toMatchObject({ sigtermSentToGroup: true, directChildReaped: true });
  });

  it('child exit observed + inventory unavailable: NO group signal, residue recorded as unknown', async () => {
    const sw = switchablePs();
    const h = await spawnTracked(writeFakeAppServer(dirs.root, 'fake-app-server-exited-blind'), sw.ps);
    await waitFor(() => h.stderr.tail.includes(FAKE_APP_SERVER_READY));
    process.kill(h.pid, 'SIGKILL'); // the direct child exits (pid-targeted, not a group signal)
    await waitFor(() => h.exited !== null);
    sw.set('reject');
    const killSpy = vi.spyOn(process, 'kill');
    const record = await h.terminate({ graceMs: 500 });
    expect(killSpy.mock.calls.filter(([pid]) => pid === -h.pgid)).toEqual([]);
    expect(record).toMatchObject({
      sigtermSentToGroup: false,
      sigkillSentToGroup: false,
      directChildReaped: true,
      inGroupResidue: 'unknown_inventory_unavailable',
    });
  });

  it('child exit observed + inventory listing a member: the group IS signalled (current positive evidence)', async () => {
    const h = await spawnTracked(writeFakeAppServer(dirs.root, 'fake-app-server-residue', { spawnGroupChild: true }));
    await waitFor(() => h.stderr.tail.includes('GROUP_CHILD='));
    const grandchild = Number(/GROUP_CHILD=(\d+)/.exec(h.stderr.tail)?.[1]);
    own(grandchild);
    process.kill(h.pid, 'SIGKILL'); // the leader exits; its group child stays in the managed group
    await waitFor(() => h.exited !== null);
    const killSpy = vi.spyOn(process, 'kill');
    const record = await h.terminate({ graceMs: 3_000 });
    expect(killSpy).toHaveBeenCalledWith(-h.pgid, 'SIGTERM');
    expect(record.sigtermSentToGroup).toBe(true);
    expect(record.inGroupMembersBeforeTermination?.map((m) => m.pid)).toEqual([grandchild]);
    await waitFor(() => processGone(grandchild));
  });

  it('never reaped: terminate() rejects with a typed CodexProcessCleanupFailed, never a plain Error', async () => {
    const h = await spawnTracked(writeFakeAppServer(dirs.root, 'fake-app-server-unreaped'));
    await waitFor(() => h.stderr.tail.includes(FAKE_APP_SERVER_READY));
    vi.spyOn(process, 'kill').mockImplementation(() => true); // signals never reach the group
    const error = await h.terminate({ graceMs: 200, killWaitMs: 300 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodexProcessCleanupFailed);
    expect(error).toMatchObject({
      code: 'codex_process_cleanup_failed',
      failure: 'not_reaped_after_sigkill',
      pid: h.pid,
      progress: { sigtermSentToGroup: true, sigkillSentToGroup: true },
    });
    vi.restoreAllMocks();
    expect((await h.terminate({ graceMs: 3_000 })).directChildReaped).toBe(true);
  });

  it('concurrent terminate() calls share one in-flight termination; a later call is a fresh, idempotent pass', async () => {
    const h = await spawnTracked(writeFakeAppServer(dirs.root, 'fake-app-server-concurrent'));
    await waitFor(() => h.stderr.tail.includes(FAKE_APP_SERVER_READY));
    const [a, b] = await Promise.all([h.terminate({ graceMs: 3_000 }), h.terminate({ graceMs: 3_000 })]);
    expect(a).toBe(b);
    expect(a).toMatchObject({ sigtermSentToGroup: true, directChildReaped: true });
    const again = await h.terminate({ graceMs: 100 });
    expect(again).not.toBe(a);
    expect(again).toMatchObject({ sigtermSentToGroup: false, sigkillSentToGroup: false, directChildReaped: true });
  });
});

describe('ps inventory parsing', () => {
  it('keeps commands containing spaces and ignores noise lines', () => {
    expect(
      parsePsInventory('  101   101     1 /Users/x/GovAI GRC Platform/bin/codex-app-server\n  202   101   101 /bin/sleep\nbogus\n'),
    ).toEqual([
      { pid: 101, pgid: 101, ppid: 1, command: '/Users/x/GovAI GRC Platform/bin/codex-app-server' },
      { pid: 202, pgid: 101, ppid: 101, command: '/bin/sleep' },
    ]);
  });
});
