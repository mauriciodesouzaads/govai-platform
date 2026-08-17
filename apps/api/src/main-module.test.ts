// M2A F2 — isMainModule: canonical-path comparison for ESM entrypoint guards.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainModule } from './main-module.js';

// A scratch tree that reproduces the owner's real checkout shape: a directory
// containing SPACES (import.meta.url percent-encodes them; argv[1] does not).
const root = mkdtempSync(join(tmpdir(), 'govai-m2a-main-module-'));
const spaced = join(root, 'GovAI GRC Platform', 'govai-platform', 'apps', 'api', 'src');
mkdirSync(spaced, { recursive: true });
const plainDir = join(root, 'plain');
mkdirSync(plainDir, { recursive: true });
const spacedFile = join(spaced, 'server.ts');
const plainFile = join(plainDir, 'migrate.ts');
const otherFile = join(plainDir, 'other.ts');
writeFileSync(spacedFile, '// entry');
writeFileSync(plainFile, '// entry');
writeFileSync(otherFile, '// other');

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('isMainModule (M2A F2)', () => {
  it('F2-T1 normal path: file URL of the entry vs the same absolute argv path → true', () => {
    expect(isMainModule(pathToFileURL(plainFile).href, plainFile)).toBe(true);
  });

  it('F2-T2 pathname containing spaces → true (the exact shape that no-op-ed the repo entrypoints)', () => {
    const url = pathToFileURL(spacedFile).href;
    expect(url).toContain('GovAI%20GRC%20Platform'); // percent-encoded by import.meta.url semantics
    expect(isMainModule(url, spacedFile)).toBe(true);
    // The naive textual guard is exactly what fails here:
    expect(url === `file://${spacedFile}`).toBe(false);
  });

  it('F2-T3 explicitly percent-encoded import.meta URL → true', () => {
    const encoded = `file://${spacedFile.split('/').map((seg) => encodeURIComponent(seg)).join('/')}`;
    expect(encoded).toContain('%20');
    expect(isMainModule(encoded, spacedFile)).toBe(true);
  });

  it('F2-T4 different file → false', () => {
    expect(isMainModule(pathToFileURL(plainFile).href, otherFile)).toBe(false);
    expect(isMainModule(pathToFileURL(spacedFile).href, plainFile)).toBe(false);
  });

  it('F2-T5 missing / empty argv1 → false (fail closed)', () => {
    expect(isMainModule(pathToFileURL(plainFile).href, undefined)).toBe(false);
    expect(isMainModule(pathToFileURL(plainFile).href, '')).toBe(false);
  });

  it('F2-T6 symlink alias: argv1 through a symlinked directory resolves to the same real file → true', () => {
    const linkDir = join(root, 'link-to-plain');
    try {
      symlinkSync(plainDir, linkDir, 'dir');
    } catch {
      // Platform without symlink support/privilege — canonicalization is not testable here.
      return;
    }
    const viaLink = join(linkDir, 'migrate.ts');
    expect(realpathSync(viaLink)).toBe(realpathSync(plainFile));
    expect(isMainModule(pathToFileURL(plainFile).href, viaLink)).toBe(true);
    // ...and a URL through the link vs the real path is also identical after canonicalization.
    expect(isMainModule(pathToFileURL(viaLink).href, plainFile)).toBe(true);
  });

  it('relative argv1 is resolved against cwd (how tsx/node receive `tsx src/server.ts`)', () => {
    const rel = relative(process.cwd(), plainFile);
    expect(isMainModule(pathToFileURL(plainFile).href, rel)).toBe(true);
  });

  it('non-file / unreadable identities fail closed → false, never throw', () => {
    expect(isMainModule('data:text/javascript,export%20default%201', plainFile)).toBe(false);
    expect(isMainModule('http://example.invalid/x.js', plainFile)).toBe(false);
    expect(isMainModule(pathToFileURL(plainFile).href, join(root, 'does-not-exist.ts'))).toBe(false);
    expect(isMainModule(pathToFileURL(join(root, 'missing.ts')).href, plainFile)).toBe(false);
  });

  it('F2-T7 importing the executable modules under the test runner has no executable side effect', async () => {
    // Under vitest process.argv[1] is the runner, never these modules, so the
    // guard must be false and importing must neither exit nor print the
    // "required env" errors of the main bodies.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) called at import`);
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await import('./server.js');
      await import('./db/migrate.js');
      await import('./scripts/seed-provider-credential.js');
      await import('./scripts/grant-api-key-role.js');
      expect(exitSpy).not.toHaveBeenCalled();
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
