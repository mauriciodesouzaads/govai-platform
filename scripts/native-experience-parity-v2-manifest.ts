// Native Experience Parity V2 manifest CLI
// (EP-PROVIDER-NATIVE-PARITY-V1-NATIVE-EXPERIENCE-CONTRACT-AND-CURRENT-BASELINE-01).
//
//   pnpm docs:parity2:check   — validate docs/architecture/generated/native-experience-parity-v2.json
//                               (vocabulary/uniqueness/axis-coherence/no-overclaim invariants) and
//                               verify the tracked bytes equal the canonical rendering. Never mutates.
//   pnpm docs:parity2:format  — rewrite the manifest in canonical form (fixed key order, canonical
//                               row sort). Use after hand edits; content is never changed, only form.
//
// ADDITIVE to the V1 CLI, which keeps validating the byte-preserved V1 baseline unchanged. Like
// V1, the V2 manifest is a hand-curated, versioned research baseline — there is no `write` mode
// that derives it from the tree, and CI never fetches the internet: research happens
// deliberately, the versioned JSON is committed, and this validator enforces schema, coherence
// and canonical bytes. Hermetic: no git, no network, no child processes.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findDuplicateJsonKeys,
  renderParityV2Manifest,
  validateParityV2ManifestFindings,
  type ParityV2Manifest,
} from './lib/parity-v2-core.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  'docs/architecture/generated/native-experience-parity-v2.json'
);

function fail(message: string): never {
  console.error(`docs:parity2 — ${message}`);
  process.exit(1);
}

function load(): { raw: string; parsed: unknown } {
  let raw: string;
  try {
    raw = readFileSync(MANIFEST_PATH, 'utf8');
  } catch {
    fail(`missing ${path.relative(REPO_ROOT, MANIFEST_PATH)}`);
  }
  // Duplicate object keys never survive JSON.parse (last occurrence wins), so they must be
  // rejected from the RAW text before any validation or formatting: `format` rewriting a
  // deduplicated parse would silently discard the earlier value.
  const dups = findDuplicateJsonKeys(raw);
  if (dups.length > 0) {
    fail(`duplicate JSON keys (parsing keeps only the last occurrence): ${dups.join(', ')}`);
  }
  try {
    return { raw, parsed: JSON.parse(raw) as unknown };
  } catch (err) {
    fail(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function check(): void {
  const { raw, parsed } = load();
  const findings = validateParityV2ManifestFindings(parsed);
  if (findings.length > 0) {
    for (const f of findings.slice(0, 40)) console.error(`docs:parity2 — INVALID: ${f.message}`);
    if (findings.length > 40) console.error(`docs:parity2 — … and ${findings.length - 40} more`);
    fail(`${findings.length} invariant violation${findings.length === 1 ? '' : 's'}`);
  }
  const canonical = renderParityV2Manifest(parsed as ParityV2Manifest);
  if (canonical !== raw) {
    fail('tracked manifest is not in canonical form — run `pnpm docs:parity2:format` and commit');
  }
  const count = (parsed as ParityV2Manifest).capabilities.length;
  process.stdout.write(`docs:parity2 — valid (${count} capability rows, canonical form)\n`);
}

function format(): void {
  const { raw, parsed } = load();
  const findings = validateParityV2ManifestFindings(parsed);
  // Canonical-FORM violations are exactly what format fixes: row ordering and per-row key
  // ordering (over the complete key set). Every other violation — including a wrong key SET —
  // must be fixed by hand, because rendering would fabricate or drop data. The branch is on
  // the STRUCTURAL finding code, never on message text (messages embed user-controlled values).
  const hard = findings.filter((f) => f.code === 'invalid');
  if (hard.length > 0) {
    for (const f of hard.slice(0, 40)) console.error(`docs:parity2 — INVALID: ${f.message}`);
    fail('fix the invariant violations above before formatting');
  }
  const canonical = renderParityV2Manifest(parsed as ParityV2Manifest);
  if (canonical === raw) {
    process.stdout.write('docs:parity2 — already canonical (no change)\n');
    return;
  }
  writeFileSync(MANIFEST_PATH, canonical);
  process.stdout.write('docs:parity2 — rewritten in canonical form\n');
}

const mode = process.argv[2];
if (mode === 'check') check();
else if (mode === 'format') format();
else fail(`usage: native-experience-parity-v2-manifest.ts <check|format> (got ${JSON.stringify(mode ?? null)})`);
