// Unit tests for the pure canonical-source-manifest logic. Everything here runs on
// in-memory fixtures — no git, no vitest child process, no filesystem discovery
// (heavy repository discovery belongs to the CLI check path, not to unit tests).

import { describe, expect, it } from 'vitest';

import {
  BEGIN_MARKER,
  END_MARKER,
  acceptanceHarnessPaths,
  buildManifest,
  buildTestCategories,
  classifyStructure,
  firstDifferingLine,
  isAdrDecisionRecord,
  liveGatedFiles,
  parseVitestListJson,
  parseWorkspacePatterns,
  renderManifestJson,
  renderMarkdownBlock,
  replaceGeneratedBlock,
  type SourceManifest,
  type TestInventoryEntry,
} from './manifest-core.js';

const WORKSPACE_PATTERNS = ['packages/*', 'apps/*', 'tests', 'scripts'];

const TRACKED: string[] = [
  'docs/architecture/current-state.md',
  'docs/architecture/adr/ADR-001-first.md',
  'docs/architecture/adr/ADR-032-provider-truth.md',
  'docs/architecture/adr/ADR-INDEX.md',
  'docs/architecture/regulatory/18-something.md',
  'docs/architecture/regulatory/nested/not-counted.txt',
  'docs/architecture/plans/plan.md',
  'docs/other/not-architecture.md',
  'apps/api/package.json',
  'apps/api/src/routes/health.ts',
  'apps/api/src/routes/me.ts',
  'apps/api/src/routes/_not-implemented.ts',
  'apps/api/src/db/migrations/0001_baseline.sql',
  'apps/api/src/db/migrations/0030_run_idempotency.sql',
  'apps/api/src/db/migrations/README.md',
  'apps/ui/package.json',
  'apps/ui/src/lib/api/client.ts',
  'packages/core-audit/package.json',
  'packages/core-audit/src/append.ts',
  'tests/package.json',
  'tests/integration/me-route.test.ts',
  'tests/live/user-e2e.test.ts',
  'tests/live/observability-collector.test.ts',
  'tests/acceptance/ai-console/run.ts',
  'tests/acceptance/ai-console/stack.ts',
  'scripts/package.json',
  'package.json',
];

function entry(file: string, name: string): TestInventoryEntry {
  return { file, name };
}

describe('path classification', () => {
  const s = classifyStructure(TRACKED, WORKSPACE_PATTERNS);

  it('counts architecture docs recursively, .md only', () => {
    // current-state, two ADRs, ADR-INDEX, one regulatory, one plan = 6 .md under docs/architecture
    expect(s.architecture_docs).toBe(6);
  });

  it('counts regulatory docs at the top level only', () => {
    expect(s.regulatory_docs).toBe(1);
  });

  it('counts ADR decision records and excludes ADR-INDEX.md', () => {
    expect(s.adr_decision_records).toBe(2);
    expect(isAdrDecisionRecord('docs/architecture/adr/ADR-INDEX.md')).toBe(false);
    expect(isAdrDecisionRecord('docs/architecture/adr/ADR-032-provider-truth.md')).toBe(true);
    expect(isAdrDecisionRecord('docs/architecture/adr/ADR-32-two-digits.md')).toBe(false);
  });

  it('counts API route files (.ts, non-test, flat)', () => {
    expect(s.api_route_files).toBe(3);
  });

  it('counts migrations (.sql only — a stray README does not count)', () => {
    expect(s.db_migrations).toBe(2);
  });

  it('derives workspace members from package.json presence + workspace patterns', () => {
    expect(s.workspace_apps).toEqual(['apps/api', 'apps/ui']);
    expect(s.workspace_packages).toEqual(['packages/core-audit']);
    expect(s.other_workspace_members).toEqual(['scripts', 'tests']);
  });

  it('counts live-gated test files by path', () => {
    expect(liveGatedFiles(TRACKED)).toBe(2);
  });

  it('derives acceptance harness directories, deduplicated and sorted', () => {
    expect(acceptanceHarnessPaths(TRACKED)).toEqual(['tests/acceptance/ai-console']);
  });
});

describe('parseWorkspacePatterns', () => {
  it('reads quoted and unquoted list items and ignores other lines', () => {
    const yaml = 'packages:\n  - "packages/*"\n  - \'apps/*\'\n  - tests\n# comment\n';
    expect(parseWorkspacePatterns(yaml)).toEqual(['packages/*', 'apps/*', 'tests']);
  });
});

describe('vitest list JSON parsing', () => {
  it('maps absolute files to repo-relative POSIX paths', () => {
    const json = JSON.stringify([{ name: 'suite > does x', file: '/repo/tests/a.test.ts' }]);
    expect(parseVitestListJson(json, '/repo')).toEqual([
      { file: 'tests/a.test.ts', name: 'suite > does x' },
    ]);
  });

  it('rejects non-JSON output', () => {
    expect(() => parseVitestListJson('RUN v4.1.5 banner', '/repo')).toThrow(/not valid JSON/);
  });

  it('rejects a non-array document', () => {
    expect(() => parseVitestListJson('{"a":1}', '/repo')).toThrow(/not a JSON array/);
  });

  it('rejects entries without string name/file', () => {
    expect(() => parseVitestListJson('[{"name":1,"file":"/repo/x"}]', '/repo')).toThrow(
      /lacks string name\/file/
    );
  });

  it('rejects files outside the repository root', () => {
    expect(() =>
      parseVitestListJson(JSON.stringify([{ name: 't', file: '/elsewhere/x.test.ts' }]), '/repo')
    ).toThrow(/outside the repository root/);
  });
});

describe('test category semantics (proved set difference)', () => {
  const unit: TestInventoryEntry[] = [
    entry('packages/core-audit/src/append.test.ts', 'appends'),
    entry('packages/core-audit/src/append.test.ts', 'verifies'),
    entry('apps/api/src/pipeline/auth.test.ts', 'authenticates'),
  ];
  const integrationOnly: TestInventoryEntry[] = [
    entry('tests/integration/me-route.test.ts', 'returns identity'),
    entry('tests/integration/me-route.test.ts', 'rejects bad key'),
  ];
  const ui: TestInventoryEntry[] = [entry('apps/ui/src/lib/format.test.ts', 'formats')];

  it('derives integration-only from collected identities, not arithmetic', () => {
    const c = buildTestCategories(unit, [...unit, ...integrationOnly], ui);
    expect(c.root_unit).toEqual({ files: 2, tests: 3 });
    expect(c.root_integration_only).toEqual({ files: 1, tests: 2 });
    expect(c.root_full_integration_gate).toEqual({ files: 3, tests: 5 });
    expect(c.ui).toEqual({ files: 1, tests: 1 });
  });

  it('handles duplicate test titles as a multiset (no collapsed counts)', () => {
    const dupUnit = [entry('a/x/src/d.test.ts', 'same'), entry('a/x/src/d.test.ts', 'same')];
    const dupFull = [...dupUnit, entry('tests/integration/i.test.ts', 'same')];
    const c = buildTestCategories(dupUnit, dupFull, []);
    expect(c.root_unit.tests).toBe(2);
    expect(c.root_integration_only.tests).toBe(1);
  });

  it('throws when the unit inventory is not a subset of the full gate', () => {
    expect(() => buildTestCategories(unit, integrationOnly, ui)).toThrow(/not a subset/);
  });

  it('throws when an integration-only identity lives outside tests/integration/', () => {
    const full = [...unit, entry('apps/api/src/sneaky.test.ts', 'appears only with the env')];
    expect(() => buildTestCategories(unit, full, ui)).toThrow(/outside tests\/integration/);
  });

  it('throws when a UI inventory entry is outside apps/ui/', () => {
    expect(() =>
      buildTestCategories(unit, unit, [entry('packages/x/src/y.test.ts', 'misplaced')])
    ).toThrow(/outside apps\/ui/);
  });
});

function sampleManifest(): SourceManifest {
  const structure = classifyStructure(TRACKED, WORKSPACE_PATTERNS);
  const categories = buildTestCategories(
    [entry('apps/api/src/a.test.ts', 't1')],
    [entry('apps/api/src/a.test.ts', 't1'), entry('tests/integration/b.test.ts', 't2')],
    [entry('apps/ui/src/c.test.ts', 't3')]
  );
  return buildManifest(structure, categories, liveGatedFiles(TRACKED), acceptanceHarnessPaths(TRACKED));
}

describe('deterministic rendering', () => {
  it('renders identical JSON bytes for identical input, with a final newline', () => {
    const a = renderManifestJson(sampleManifest());
    const b = renderManifestJson(sampleManifest());
    expect(a).toBe(b);
    expect(a.endsWith('}\n')).toBe(true);
  });

  it('keeps a stable top-level key order', () => {
    const parsed = JSON.parse(renderManifestJson(sampleManifest())) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      'schema_version',
      'generated_by',
      'regenerate',
      'verify',
      'structure',
      'tests',
    ]);
  });

  it('contains no timestamp, hostname or absolute path', () => {
    const json = renderManifestJson(sampleManifest());
    expect(json).not.toMatch(/generated_at|hostname|\/Users\/|\/home\//);
  });

  it('renders a markdown block bounded by the exact markers with a DO NOT EDIT notice', () => {
    const block = renderMarkdownBlock(sampleManifest());
    expect(block.startsWith(BEGIN_MARKER)).toBe(true);
    expect(block.endsWith(END_MARKER)).toBe(true);
    expect(block).toContain('GENERATED — DO NOT EDIT MANUALLY.');
    expect(block).toContain('pnpm docs:manifest:write');
    expect(block).toContain('pnpm docs:manifest:check');
  });
});

describe('generated block replacement', () => {
  const doc = `# Doc\n\nintro\n\n${BEGIN_MARKER}\nold content\n${END_MARKER}\n\nafter\n`;

  it('replaces exactly the marker-bounded region, preserving the rest', () => {
    const out = replaceGeneratedBlock(doc, `${BEGIN_MARKER}\nnew content\n${END_MARKER}`);
    expect(out).toBe(`# Doc\n\nintro\n\n${BEGIN_MARKER}\nnew content\n${END_MARKER}\n\nafter\n`);
  });

  it('is idempotent: replacing twice yields the same bytes', () => {
    const block = renderMarkdownBlock(sampleManifest());
    const once = replaceGeneratedBlock(doc, block);
    expect(replaceGeneratedBlock(once, block)).toBe(once);
  });

  it('throws on a missing BEGIN marker', () => {
    expect(() => replaceGeneratedBlock(`no markers\n${END_MARKER}\n`, 'x')).toThrow(
      /missing BEGIN marker/
    );
  });

  it('throws on a missing END marker', () => {
    expect(() => replaceGeneratedBlock(`${BEGIN_MARKER}\nno end\n`, 'x')).toThrow(
      /missing END marker/
    );
  });

  it('throws on duplicate markers', () => {
    expect(() =>
      replaceGeneratedBlock(`${BEGIN_MARKER}\n${BEGIN_MARKER}\n${END_MARKER}\n`, 'x')
    ).toThrow(/duplicate BEGIN/);
    expect(() =>
      replaceGeneratedBlock(`${BEGIN_MARKER}\n${END_MARKER}\n${END_MARKER}\n`, 'x')
    ).toThrow(/duplicate END/);
  });

  it('throws when END precedes BEGIN', () => {
    expect(() => replaceGeneratedBlock(`${END_MARKER}\n${BEGIN_MARKER}\n`, 'x')).toThrow(
      /END marker appears before BEGIN/
    );
  });
});

describe('firstDifferingLine (check-mode mismatch reports)', () => {
  it('returns null for identical strings', () => {
    expect(firstDifferingLine('a\nb\n', 'a\nb\n')).toBeNull();
  });

  it('locates the first divergent line', () => {
    const d = firstDifferingLine('a\nb\nc\n', 'a\nX\nc\n');
    expect(d).toEqual({ line: 2, expected: 'b', actual: 'X' });
  });

  it('reports a missing tail', () => {
    const d = firstDifferingLine('a\nb', 'a');
    expect(d?.line).toBe(2);
    expect(d?.actual).toBe('<missing>');
  });
});
