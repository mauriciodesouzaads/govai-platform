// Canonical source manifest CLI (EP-CANONICAL-SOURCE-MANIFEST-GATE-01).
//
//   pnpm docs:manifest:write   — regenerate docs/architecture/generated/source-manifest.json
//                                and the generated block in docs/architecture/current-state.md
//   pnpm docs:manifest:check   — regenerate in memory and verify the tracked bytes match;
//                                prints a mismatch summary and exits non-zero on drift.
//                                Check mode never mutates the worktree.
//
// The repository tree is the input: tracked files via `git ls-files` and the vitest
// collectors (`vitest list --json`) for the three test surfaces. Nothing is copied from
// the documents being verified. Live-gated tests are counted by file only — enumerating
// them would import modules whose import-time guards read provider environment.
//
// Hermetic by construction: no Docker, no database, no network, no provider credentials.
// Collection imports test modules (their container hooks are registered, never run).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  acceptanceHarnessPaths,
  buildManifest,
  buildTestCategories,
  classifyStructure,
  firstDifferingLine,
  liveGatedFiles,
  parseVitestListJson,
  parseWorkspacePatterns,
  renderManifestJson,
  renderMarkdownBlock,
  replaceGeneratedBlock,
  type TestInventoryEntry,
} from './lib/manifest-core.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs/architecture/generated/source-manifest.json');
const CURRENT_STATE_PATH = path.join(REPO_ROOT, 'docs/architecture/current-state.md');

function fail(message: string): never {
  console.error(`docs:manifest — ${message}`);
  process.exit(1);
}

function listTrackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter((f) => f.length > 0);
}

/**
 * Collect a test inventory without executing tests, via the supported
 * `vitest list --json=<file>` interface (Vitest 4). `integration` toggles the
 * GOVAI_INTEGRATION config gate; `cwdRel` selects which vitest project collects
 * (each workspace package resolves its own local binary).
 */
function collectInventory(opts: { cwdRel: string; integration: boolean }): TestInventoryEntry[] {
  const cwd = path.join(REPO_ROOT, opts.cwdRel);
  const bin = path.join(cwd, 'node_modules', '.bin', 'vitest');
  const tmp = mkdtempSync(path.join(tmpdir(), 'govai-manifest-'));
  const outFile = path.join(tmp, 'list.json');
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['GOVAI_INTEGRATION'];
  delete env['GOVAI_LIVE_TESTS'];
  if (opts.integration) env['GOVAI_INTEGRATION'] = '1';
  try {
    execFileSync(bin, ['list', `--json=${outFile}`], {
      cwd,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    const json = readFileSync(outFile, 'utf8');
    return parseVitestListJson(json, REPO_ROOT.replaceAll('\\', '/'));
  } catch (err) {
    if (err instanceof Error && 'stderr' in err) {
      const stderr = (err as { stderr?: Buffer | string }).stderr?.toString() ?? '';
      fail(
        `vitest list failed (cwd=${opts.cwdRel}, integration=${opts.integration}):\n${stderr.slice(-2000)}`
      );
    }
    throw err;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function generate(): { manifestJson: string; currentStateDoc: string } {
  const tracked = listTrackedFiles();
  const workspaceYaml = readFileSync(path.join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const structure = classifyStructure(tracked, parseWorkspacePatterns(workspaceYaml));

  const unit = collectInventory({ cwdRel: '.', integration: false });
  const full = collectInventory({ cwdRel: '.', integration: true });
  const ui = collectInventory({ cwdRel: 'apps/ui', integration: false });

  const categories = buildTestCategories(unit, full, ui);
  const manifest = buildManifest(
    structure,
    categories,
    liveGatedFiles(tracked),
    acceptanceHarnessPaths(tracked)
  );

  const currentState = readFileSync(CURRENT_STATE_PATH, 'utf8');
  return {
    manifestJson: renderManifestJson(manifest),
    currentStateDoc: replaceGeneratedBlock(currentState, renderMarkdownBlock(manifest)),
  };
}

function readIfExists(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function check(): void {
  const expected = generate();
  let clean = true;

  const actualJson = readIfExists(MANIFEST_PATH) ?? '<file missing>';
  const jsonDiff = firstDifferingLine(expected.manifestJson, actualJson);
  if (jsonDiff) {
    clean = false;
    console.error(
      `docs:manifest — STALE ${path.relative(REPO_ROOT, MANIFEST_PATH)} at line ${jsonDiff.line}:\n` +
        `  expected: ${jsonDiff.expected}\n  actual:   ${jsonDiff.actual}`
    );
  }

  const actualDoc = readFileSync(CURRENT_STATE_PATH, 'utf8');
  const docDiff = firstDifferingLine(expected.currentStateDoc, actualDoc);
  if (docDiff) {
    clean = false;
    console.error(
      `docs:manifest — STALE generated block in ${path.relative(REPO_ROOT, CURRENT_STATE_PATH)} ` +
        `at line ${docDiff.line}:\n  expected: ${docDiff.expected}\n  actual:   ${docDiff.actual}`
    );
  }

  if (!clean) {
    fail('the tracked manifest does not match the repository tree — run `pnpm docs:manifest:write` and commit the result');
  }
  process.stdout.write('docs:manifest — clean (manifest JSON + generated block match the tree)\n');
}

function write(): void {
  const expected = generate();
  let changed = 0;
  if (readIfExists(MANIFEST_PATH) !== expected.manifestJson) {
    mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    writeFileSync(MANIFEST_PATH, expected.manifestJson);
    changed += 1;
  }
  if (readFileSync(CURRENT_STATE_PATH, 'utf8') !== expected.currentStateDoc) {
    writeFileSync(CURRENT_STATE_PATH, expected.currentStateDoc);
    changed += 1;
  }
  process.stdout.write(
    changed === 0
      ? 'docs:manifest — already current (no file changed)\n'
      : `docs:manifest — regenerated (${changed} file${changed === 1 ? '' : 's'} updated)\n`
  );
}

try {
  const mode = process.argv[2];
  if (mode === 'check') check();
  else if (mode === 'write') write();
  else fail(`usage: canonical-source-manifest.ts <write|check> (got ${JSON.stringify(mode ?? null)})`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
