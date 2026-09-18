// CONT-P5-A — CodexProcessHandle FOUNDATION against a unit-tier fake executable (real spawn / group / signals).
//
// Proves the foundation mechanics on any POSIX host. It does NOT prove anything about the pinned binary —
// that is `codex-app-server.process.test.ts` — and it never asserts descendant quiescence (FOUNDATION_ONLY).

import { rmSync } from 'node:fs';

import { afterAll, describe, expect, it } from 'vitest';

import {
  FAKE_APP_SERVER_READY,
  makeDisposableDirs,
  RUNTIME_SELF_SET_ENV_KEYS,
  writeFakeAppServer,
} from './fake-app-server.fixture.js';
import {
  CODEX_CHILD_ENV_KEYS,
  CODEX_CHILD_PATH,
  CodexProcessHandle,
  CodexProcessSpawnRefused,
  parsePsInventory,
  type CodexProcessSpawnInput,
} from './process-handle.js';

const dirs = makeDisposableDirs('govai-cont-p5a-handle-');
const handles: CodexProcessHandle[] = [];

afterAll(async () => {
  for (const h of handles) if (h.exited === null) await h.terminate({ graceMs: 500, killWaitMs: 2_000 });
  rmSync(dirs.root, { recursive: true, force: true });
});

function input(binaryPath: string): CodexProcessSpawnInput {
  return { binaryPath, codexHome: dirs.codexHome, homeDir: dirs.home, workDir: dirs.work };
}

async function spawnTracked(binaryPath: string): Promise<CodexProcessHandle> {
  const h = await CodexProcessHandle.spawn(input(binaryPath));
  handles.push(h);
  return h;
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
    expect(record.inGroupMembersBeforeTermination.map((m) => m.pid).sort()).toEqual([h.pid, grandchild].sort());
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
