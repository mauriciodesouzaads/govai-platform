// Native Experience Parity V1 manifest CLI (EP-PROVIDER-NATIVE-PARITY-V1-BASELINE-01).
//
//   pnpm docs:parity:check    — validate docs/architecture/generated/native-experience-parity-v1.json
//                               (vocabulary/uniqueness/axis-coherence/no-overclaim invariants) and
//                               verify the tracked bytes equal the canonical rendering. Never mutates.
//   pnpm docs:parity:format   — rewrite the manifest in canonical form (fixed key order, canonical
//                               row sort). Use after hand edits; content is never changed, only form.
//
// The manifest is a hand-curated, versioned research baseline — there is no `write` mode that
// derives it from the tree. Hermetic: no git, no network, no child processes.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderParityManifest,
  validateParityManifest,
  type ParityManifest,
} from './lib/parity-core.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  'docs/architecture/generated/native-experience-parity-v1.json'
);

function fail(message: string): never {
  console.error(`docs:parity — ${message}`);
  process.exit(1);
}

function load(): { raw: string; parsed: unknown } {
  let raw: string;
  try {
    raw = readFileSync(MANIFEST_PATH, 'utf8');
  } catch {
    fail(`missing ${path.relative(REPO_ROOT, MANIFEST_PATH)}`);
  }
  try {
    return { raw, parsed: JSON.parse(raw) as unknown };
  } catch (err) {
    fail(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function check(): void {
  const { raw, parsed } = load();
  const errs = validateParityManifest(parsed);
  if (errs.length > 0) {
    for (const e of errs.slice(0, 40)) console.error(`docs:parity — INVALID: ${e}`);
    if (errs.length > 40) console.error(`docs:parity — … and ${errs.length - 40} more`);
    fail(`${errs.length} invariant violation${errs.length === 1 ? '' : 's'}`);
  }
  const canonical = renderParityManifest(parsed as ParityManifest);
  if (canonical !== raw) {
    fail('tracked manifest is not in canonical form — run `pnpm docs:parity:format` and commit');
  }
  const count = (parsed as ParityManifest).capabilities.length;
  process.stdout.write(`docs:parity — valid (${count} capability rows, canonical form)\n`);
}

function format(): void {
  const { raw, parsed } = load();
  const errs = validateParityManifest(parsed);
  // Canonical-FORM violations are exactly what format fixes: row ordering and per-row key
  // ordering (over the complete key set). Every other violation — including a wrong key SET —
  // must be fixed by hand, because rendering would fabricate or drop data.
  const hard = errs.filter(
    (e) => !e.includes('rows out of canonical order') && !e.includes('keys out of canonical order')
  );
  if (hard.length > 0) {
    for (const e of hard.slice(0, 40)) console.error(`docs:parity — INVALID: ${e}`);
    fail('fix the invariant violations above before formatting');
  }
  const canonical = renderParityManifest(parsed as ParityManifest);
  if (canonical === raw) {
    process.stdout.write('docs:parity — already canonical (no change)\n');
    return;
  }
  writeFileSync(MANIFEST_PATH, canonical);
  process.stdout.write('docs:parity — rewritten in canonical form\n');
}

const mode = process.argv[2];
if (mode === 'check') check();
else if (mode === 'format') format();
else fail(`usage: native-experience-parity-manifest.ts <check|format> (got ${JSON.stringify(mode ?? null)})`);
