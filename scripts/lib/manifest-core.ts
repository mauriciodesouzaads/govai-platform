// Pure logic for the canonical source manifest (EP-CANONICAL-SOURCE-MANIFEST-GATE-01).
//
// Everything in this module is deterministic and side-effect free: it takes the tracked
// file list and the collected vitest inventories as VALUES and returns strings/objects.
// Process orchestration (git, vitest, filesystem) lives in scripts/canonical-source-manifest.ts.
// The same repository tree must always produce byte-identical output — no timestamps, no
// randomness, no absolute paths, no machine identity.

export const SCHEMA_VERSION = 1;

export const BEGIN_MARKER = '<!-- BEGIN GENERATED SOURCE MANIFEST -->';
export const END_MARKER = '<!-- END GENERATED SOURCE MANIFEST -->';

/** One collected test case. `file` is repo-relative POSIX. `name` is the full test name. */
export interface TestInventoryEntry {
  file: string;
  name: string;
}

export interface TestCategoryCount {
  files: number;
  tests: number;
}

export interface SourceStructure {
  architecture_docs: number;
  regulatory_docs: number;
  adr_decision_records: number;
  workspace_apps: string[];
  workspace_packages: string[];
  other_workspace_members: string[];
  api_route_files: number;
  db_migrations: number;
}

export interface SourceManifest {
  schema_version: typeof SCHEMA_VERSION;
  generated_by: string;
  regenerate: string;
  verify: string;
  structure: SourceStructure;
  tests: {
    root_unit: TestCategoryCount;
    root_integration_only: TestCategoryCount;
    root_full_integration_gate: TestCategoryCount;
    ui: TestCategoryCount;
    live_gated: {
      files: number;
      tests: null;
      reason: string;
    };
    acceptance_harnesses: {
      paths: string[];
      note: string;
    };
  };
}

// ---------------------------------------------------------------------------
// Path classification (structural counts). The tracked file list is authority.
// ---------------------------------------------------------------------------

const ARCHITECTURE_DOC = /^docs\/architecture\/.+\.md$/;
const REGULATORY_DOC = /^docs\/architecture\/regulatory\/[^/]+\.md$/;
// ADR decision records only: three digits + hyphen. `ADR-INDEX.md` is a generated index,
// not a decision record — the pattern excludes it, and isAdrDecisionRecord makes the
// exclusion explicit so a rename to e.g. `ADR-015-INDEX.md` cannot sneak the index in.
const ADR_DECISION = /^docs\/architecture\/adr\/ADR-\d{3}-[^/]+\.md$/;
const ADR_INDEX = /^docs\/architecture\/adr\/ADR-INDEX\.md$/;
const API_ROUTE = /^apps\/api\/src\/routes\/[^/]+\.ts$/;
const DB_MIGRATION = /^apps\/api\/src\/db\/migrations\/[^/]+\.sql$/;
const LIVE_TEST = /^tests\/live\/.+\.test\.ts$/;
const ACCEPTANCE_FILE = /^tests\/acceptance\/([^/]+)\//;
const WORKSPACE_APP = /^apps\/([^/]+)\/package\.json$/;
const WORKSPACE_PACKAGE = /^packages\/([^/]+)\/package\.json$/;
const TEST_FILE = /\.test\.tsx?$/;

export function isAdrDecisionRecord(path: string): boolean {
  return ADR_DECISION.test(path) && !ADR_INDEX.test(path);
}

/**
 * Parse the workspace member patterns out of pnpm-workspace.yaml. The file is a
 * fixed-shape two-level YAML (a `packages:` key with quoted list items); a real YAML
 * parser is deliberately not pulled in for it. Unknown lines are ignored.
 */
export function parseWorkspacePatterns(yaml: string): string[] {
  const patterns: string[] = [];
  for (const raw of yaml.split('\n')) {
    const m = raw.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*$/);
    if (m?.[1]) patterns.push(m[1]);
  }
  return patterns;
}

export function classifyStructure(
  trackedFiles: readonly string[],
  workspacePatterns: readonly string[]
): SourceStructure {
  let architectureDocs = 0;
  let regulatoryDocs = 0;
  let adrDecisionRecords = 0;
  let apiRouteFiles = 0;
  let dbMigrations = 0;
  const apps = new Set<string>();
  const packages = new Set<string>();
  const otherMembers = new Set<string>();

  // Workspace patterns that are literal directories (no glob) — e.g. `tests` — are
  // members when they carry a package.json.
  const literalMembers = new Set(
    workspacePatterns.filter((p) => !p.includes('*')).map((p) => p.replace(/\/+$/, ''))
  );

  for (const file of trackedFiles) {
    if (ARCHITECTURE_DOC.test(file)) architectureDocs += 1;
    if (REGULATORY_DOC.test(file)) regulatoryDocs += 1;
    if (isAdrDecisionRecord(file)) adrDecisionRecords += 1;
    if (API_ROUTE.test(file) && !TEST_FILE.test(file)) apiRouteFiles += 1;
    if (DB_MIGRATION.test(file)) dbMigrations += 1;
    const app = file.match(WORKSPACE_APP);
    if (app?.[1]) apps.add(`apps/${app[1]}`);
    const pkg = file.match(WORKSPACE_PACKAGE);
    if (pkg?.[1]) packages.add(`packages/${pkg[1]}`);
    const slash = file.indexOf('/');
    if (slash > 0) {
      const top = file.slice(0, slash);
      if (literalMembers.has(top) && file === `${top}/package.json`) otherMembers.add(top);
    }
  }

  return {
    architecture_docs: architectureDocs,
    regulatory_docs: regulatoryDocs,
    adr_decision_records: adrDecisionRecords,
    workspace_apps: [...apps].sort(),
    workspace_packages: [...packages].sort(),
    other_workspace_members: [...otherMembers].sort(),
    api_route_files: apiRouteFiles,
    db_migrations: dbMigrations,
  };
}

export function liveGatedFiles(trackedFiles: readonly string[]): number {
  return trackedFiles.filter((f) => LIVE_TEST.test(f)).length;
}

export function acceptanceHarnessPaths(trackedFiles: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const file of trackedFiles) {
    const m = file.match(ACCEPTANCE_FILE);
    if (m?.[1]) dirs.add(`tests/acceptance/${m[1]}`);
  }
  return [...dirs].sort();
}

// ---------------------------------------------------------------------------
// Test inventory semantics
// ---------------------------------------------------------------------------

function countFiles(entries: readonly TestInventoryEntry[]): number {
  return new Set(entries.map((e) => e.file)).size;
}

/** Multiset of `file::name` identities — duplicate titles must not collapse counts. */
function identityMultiset(entries: readonly TestInventoryEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    const id = `${e.file}::${e.name}`;
    m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

export interface TestCategories {
  root_unit: TestCategoryCount;
  root_integration_only: TestCategoryCount;
  root_full_integration_gate: TestCategoryCount;
  ui: TestCategoryCount;
}

/**
 * Derive the four vitest-backed categories. `root_integration_only` is a PROVED set
 * difference over collected identities (full minus unit), never arithmetic over totals:
 * the unit inventory must be an exact multiset subset of the full-gate inventory, and
 * every integration-only identity must live under tests/integration/. Any violation
 * throws — that is a semantics drift to adjudicate, not to paper over.
 */
export function buildTestCategories(
  unit: readonly TestInventoryEntry[],
  full: readonly TestInventoryEntry[],
  ui: readonly TestInventoryEntry[]
): TestCategories {
  const fullSet = identityMultiset(full);
  const unitSet = identityMultiset(unit);

  const remaining = new Map(fullSet);
  for (const [id, n] of unitSet) {
    const have = remaining.get(id) ?? 0;
    if (have < n) {
      throw new Error(
        `unit inventory is not a subset of the full integration gate: "${id}" ` +
          `appears ${n}x in unit but ${have}x in full — adjudicate before trusting the manifest`
      );
    }
    if (have === n) remaining.delete(id);
    else remaining.set(id, have - n);
  }

  let integrationOnlyTests = 0;
  const integrationOnlyFiles = new Set<string>();
  for (const [id, n] of remaining) {
    const file = id.slice(0, id.indexOf('::'));
    if (!file.startsWith('tests/integration/')) {
      throw new Error(
        `integration-only identity outside tests/integration/: "${id}" — the ` +
          `GOVAI_INTEGRATION gate semantics drifted; adjudicate before trusting the manifest`
      );
    }
    integrationOnlyFiles.add(file);
    integrationOnlyTests += n;
  }

  for (const e of ui) {
    if (!e.file.startsWith('apps/ui/')) {
      throw new Error(`UI inventory entry outside apps/ui/: "${e.file}::${e.name}"`);
    }
  }

  return {
    root_unit: { files: countFiles(unit), tests: unit.length },
    root_integration_only: {
      files: integrationOnlyFiles.size,
      tests: integrationOnlyTests,
    },
    root_full_integration_gate: { files: countFiles(full), tests: full.length },
    ui: { files: countFiles(ui), tests: ui.length },
  };
}

/**
 * Parse `vitest list --json` output into repo-relative entries. Accepts the Vitest 4
 * shape: an array of objects each carrying at least `name` and `file` (absolute path).
 */
export function parseVitestListJson(json: string, repoRootPosix: string): TestInventoryEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`vitest list output is not valid JSON (first 200 chars): ${json.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('vitest list output is not a JSON array');
  }
  const root = repoRootPosix.endsWith('/') ? repoRootPosix : `${repoRootPosix}/`;
  return parsed.map((item, i) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`vitest list entry ${i} is not an object`);
    }
    const { name, file } = item as { name?: unknown; file?: unknown };
    if (typeof name !== 'string' || typeof file !== 'string') {
      throw new Error(`vitest list entry ${i} lacks string name/file`);
    }
    const posix = file.replaceAll('\\', '/');
    if (!posix.startsWith(root)) {
      throw new Error(`vitest list entry file is outside the repository root: ${file}`);
    }
    return { file: posix.slice(root.length), name };
  });
}

// ---------------------------------------------------------------------------
// Rendering — deterministic bytes
// ---------------------------------------------------------------------------

export function buildManifest(
  structure: SourceStructure,
  categories: TestCategories,
  liveFiles: number,
  acceptancePaths: string[]
): SourceManifest {
  return {
    schema_version: SCHEMA_VERSION,
    generated_by: 'scripts/canonical-source-manifest.ts',
    regenerate: 'pnpm docs:manifest:write',
    verify: 'pnpm docs:manifest:check',
    structure,
    tests: {
      root_unit: categories.root_unit,
      root_integration_only: categories.root_integration_only,
      root_full_integration_gate: categories.root_full_integration_gate,
      ui: categories.ui,
      live_gated: {
        files: liveFiles,
        tests: null,
        reason:
          'not enumerated: collection would import live-gated modules whose import-time ' +
          'guards read provider environment; files-only by design',
      },
      acceptance_harnesses: {
        paths: acceptancePaths,
        note: 'operator-driven harnesses, not vitest suites; excluded from every vitest config',
      },
    },
  };
}

/** Key order is fixed by construction (object literal insertion order); trailing newline. */
export function renderManifestJson(manifest: SourceManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function renderMarkdownBlock(manifest: SourceManifest): string {
  const s = manifest.structure;
  const t = manifest.tests;
  const lines: string[] = [
    BEGIN_MARKER,
    '<!--',
    '  GENERATED — DO NOT EDIT MANUALLY.',
    '  Source: pnpm docs:manifest:write   (derives every value below from the repository tree)',
    '  Verification: pnpm docs:manifest:check   (CI `unit` job — a drifted block fails the build)',
    '-->',
    '',
    'Machine-derived from the current repository tree — tracked files plus the vitest',
    `collectors — mirrored in [generated/source-manifest.json](./generated/source-manifest.json) (schema_version ${manifest.schema_version}).`,
    'A test count is the number of collected test cases (skipped tests included); a "file"',
    'is one collected test module.',
    '',
    '| Structure | Source pattern | Count |',
    '|---|---|---|',
    `| Architecture docs | \`docs/architecture/**/*.md\` | ${s.architecture_docs} |`,
    `| Regulatory docs | \`docs/architecture/regulatory/*.md\` | ${s.regulatory_docs} |`,
    `| ADR decision records | \`docs/architecture/adr/ADR-[0-9][0-9][0-9]-*.md\` (excludes \`ADR-INDEX.md\`) | ${s.adr_decision_records} |`,
    `| Workspace apps | \`apps/*\` | ${s.workspace_apps.length} — ${s.workspace_apps.map((a) => `\`${a}\``).join(', ')} |`,
    `| Workspace packages | \`packages/*\` | ${s.workspace_packages.length} |`,
    `| Other workspace members | literal entries in \`pnpm-workspace.yaml\` | ${s.other_workspace_members.map((m) => `\`${m}\``).join(', ') || '—'} |`,
    `| API route files | \`apps/api/src/routes/*.ts\` | ${s.api_route_files} |`,
    `| DB migrations | \`apps/api/src/db/migrations/*.sql\` | ${s.db_migrations} |`,
    '',
    '| Test category | Execution | Files | Tests |',
    '|---|---|---|---|',
    `| Root unit | \`pnpm test\` (no \`GOVAI_INTEGRATION\`) | ${t.root_unit.files} | ${t.root_unit.tests} |`,
    `| Root integration-only | the identities \`GOVAI_INTEGRATION=1\` adds (proved set difference, all under \`tests/integration/\`) | ${t.root_integration_only.files} | ${t.root_integration_only.tests} |`,
    `| Root full integration gate | \`pnpm test:integration\` (unit + integration; the CI \`integration\` job) | ${t.root_full_integration_gate.files} | ${t.root_full_integration_gate.tests} |`,
    `| UI (\`@govai/ui\`) | \`pnpm --filter @govai/ui test\` (own jsdom config; excluded from the root config) | ${t.ui.files} | ${t.ui.tests} |`,
    `| Live-gated | \`pnpm test:live\` (never in CI) | ${t.live_gated.files} | ${t.live_gated.tests === null ? 'files only — see manifest `reason`' : t.live_gated.tests} |`,
    '',
    `Acceptance harnesses (NOT vitest suites): ${t.acceptance_harnesses.paths.map((p) => `\`${p}\``).join(', ')} —`,
    `${t.acceptance_harnesses.note}.`,
    END_MARKER,
  ];
  return lines.join('\n');
}

/**
 * Replace the generated block (marker lines inclusive) inside a document. Exactly one
 * BEGIN and one END marker must exist, BEGIN before END — anything else throws.
 */
export function replaceGeneratedBlock(doc: string, newBlock: string): string {
  const begins = [...doc.matchAll(new RegExp(escapeRegExp(BEGIN_MARKER), 'g'))];
  const ends = [...doc.matchAll(new RegExp(escapeRegExp(END_MARKER), 'g'))];
  if (begins.length === 0) throw new Error(`missing BEGIN marker: ${BEGIN_MARKER}`);
  if (ends.length === 0) throw new Error(`missing END marker: ${END_MARKER}`);
  if (begins.length > 1) throw new Error('duplicate BEGIN marker');
  if (ends.length > 1) throw new Error('duplicate END marker');
  const beginIdx = begins[0]!.index;
  const endIdx = ends[0]!.index;
  if (endIdx < beginIdx) throw new Error('END marker appears before BEGIN marker');
  const afterEnd = endIdx + END_MARKER.length;
  return doc.slice(0, beginIdx) + newBlock + doc.slice(afterEnd);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** First line where two strings diverge — for concise check-mode mismatch reports. */
export function firstDifferingLine(
  expected: string,
  actual: string
): { line: number; expected: string; actual: string } | null {
  if (expected === actual) return null;
  const e = expected.split('\n');
  const a = actual.split('\n');
  const n = Math.max(e.length, a.length);
  for (let i = 0; i < n; i += 1) {
    if (e[i] !== a[i]) {
      return { line: i + 1, expected: e[i] ?? '<missing>', actual: a[i] ?? '<missing>' };
    }
  }
  return { line: n, expected: '<eof>', actual: '<eof>' };
}
