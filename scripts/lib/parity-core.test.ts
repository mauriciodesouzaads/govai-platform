// Unit tests for the pure parity-manifest logic. Everything here runs on in-memory
// fixtures — no git, no child process, no filesystem discovery. The tracked-artifact
// enforcement test lives in scripts/native-experience-parity-manifest.test.ts.

import { describe, expect, it } from 'vitest';

import {
  PARITY_SCHEMA_VERSION,
  findDuplicateJsonKeys,
  renderParityManifest,
  validateParityManifest,
  validateParityManifestFindings,
  type ParityManifest,
  type ParityRow,
} from './parity-core.js';

const SNAP = '2026-08-21';

function mkRow(overrides: Partial<ParityRow>): ParityRow {
  return {
    provider: 'anthropic',
    surface: 'ANTHROPIC_API',
    family: 'messages',
    capability_id: 'messages-create',
    capability_name: 'Messages API',
    official_status: 'GA',
    protocol_stability: null,
    official_source: 'https://platform.claude.com/docs/en/api/messages',
    source_type: 'api-reference',
    verified_at: SNAP,
    model_constraints: null,
    provider_exposed: true,
    govai_registered: false,
    // Default fixture is a legitimate PARTIAL: the capability rides a registered native route.
    native_route_available: true,
    native_tested: false,
    native_live_accepted: false,
    governed_applicable: false,
    governed_route_available: false,
    governed_tested: false,
    governed_live_accepted: false,
    ui_exposed: false,
    ui_tested: false,
    ui_live_accepted: false,
    evidence_wired: false,
    exact_turn_evidence_correlation: false,
    persistence_supported: false,
    resume_supported: false,
    fork_supported: false,
    risk_class_if_known: null,
    govai_product_equivalent_required: false,
    classification: 'PARTIAL',
    notes: '',
    ...overrides,
  };
}

function mkManifest(rows: ParityRow[]): ParityManifest {
  return {
    schema_version: PARITY_SCHEMA_VERSION,
    name: 'native-experience-parity-v1',
    description: 'fixture',
    research_snapshot_date: SNAP,
    source_anchor: '55eae8835c7fb3b4cad35d3f470a1163fc5eb356',
    verify: 'pnpm docs:parity:check',
    doc: 'docs/architecture/native-experience-parity-v1.md',
    capability_count: rows.length,
    capabilities: rows,
  };
}

/** A row that legitimately satisfies every FULL axis. */
const FULL_ROW = mkRow({
  capability_id: 'full-cap',
  classification: 'FULL',
  govai_registered: true,
  native_route_available: true,
  native_tested: true,
  native_live_accepted: true,
  governed_applicable: true,
  governed_route_available: true,
  governed_tested: true,
  governed_live_accepted: true,
  ui_exposed: true,
  ui_tested: true,
  ui_live_accepted: true,
  evidence_wired: true,
});

const APP_ROW = mkRow({
  provider: 'anthropic',
  surface: 'CLAUDE_APP',
  native_route_available: false,
  family: 'work',
  capability_id: 'artifacts',
  capability_name: 'Artifacts',
  official_status: 'PRODUCT_ONLY',
  classification: 'PRODUCT_ONLY',
  provider_exposed: false,
  govai_product_equivalent_required: true,
  source_type: 'product-page',
});

describe('validateParityManifest', () => {
  it('accepts a valid manifest', () => {
    expect(validateParityManifest(mkManifest([FULL_ROW, mkRow({}), APP_ROW]))).toEqual([]);
  });

  it('rejects a non-object root and a wrong schema_version', () => {
    expect(validateParityManifest(null)).toEqual(['manifest root must be a JSON object']);
    const m = mkManifest([mkRow({})]);
    (m as unknown as Record<string, unknown>)['schema_version'] = 2;
    expect(validateParityManifest(m).join('\n')).toContain('schema_version must be 1');
  });

  it('rejects capability_count drift', () => {
    const m = mkManifest([mkRow({})]);
    m.capability_count = 7;
    expect(validateParityManifest(m).join('\n')).toContain('capability_count');
  });

  it('rejects duplicate (surface, capability_id) pairs', () => {
    const m = mkManifest([mkRow({}), mkRow({ notes: 'twin' })]);
    expect(validateParityManifest(m).join('\n')).toContain('duplicate capability id');
  });

  it('rejects an unknown surface, classification and official_status', () => {
    const bad = mkRow({}) as unknown as Record<string, unknown>;
    bad['surface'] = 'GEMINI_API';
    expect(validateParityManifest(mkManifest([bad as unknown as ParityRow])).join('\n')).toContain(
      'invalid surface'
    );
    const badCls = mkRow({}) as unknown as Record<string, unknown>;
    badCls['classification'] = 'ALMOST';
    expect(
      validateParityManifest(mkManifest([badCls as unknown as ParityRow])).join('\n')
    ).toContain('invalid classification');
    const badStatus = mkRow({}) as unknown as Record<string, unknown>;
    badStatus['official_status'] = 'SHIPPED';
    expect(
      validateParityManifest(mkManifest([badStatus as unknown as ParityRow])).join('\n')
    ).toContain('invalid official_status');
  });

  it('enforces the surface→provider mapping', () => {
    const m = mkManifest([mkRow({ provider: 'openai' })]);
    expect(validateParityManifest(m).join('\n')).toContain('provider must be anthropic');
  });

  it('requires a REAL parseable https official_source on every row', () => {
    for (const bad of [
      'see notes',
      'https://',
      'https://not a url',
      'http://example.com',
      'https://-',
      'https://.',
      'https://-bad-.example.com',
      'https://localhost',
      'https://example.com/docs',
      'https://github.com/random/repo',
      // Cross-provider sources: the default fixture is an ANTHROPIC row, so OpenAI-owned
      // properties (and OpenAI's GitHub org) cannot support it.
      'https://developers.openai.com/api/docs',
      'https://github.com/openai/codex/blob/main/README.md',
    ]) {
      const m = mkManifest([mkRow({ official_source: bad })]);
      expect(validateParityManifest(m).join('\n')).toContain(
        'official_source must be a parseable FIRST-PARTY https URL'
      );
    }
    for (const good of [
      'https://platform.claude.com/docs',
      'https://github.com/anthropics/claude-code/blob/main/README.md',
    ]) {
      expect(validateParityManifest(mkManifest([mkRow({ official_source: good })]))).toEqual([]);
    }
    // And the mirror: an OpenAI-surface row accepts OpenAI properties, rejects Anthropic's.
    const oaiRow = mkRow({
      provider: 'openai',
      surface: 'OPENAI_API',
      official_source: 'https://github.com/openai/codex/blob/main/README.md',
    });
    expect(validateParityManifest(mkManifest([oaiRow]))).toEqual([]);
    const oaiBad = mkRow({
      provider: 'openai',
      surface: 'OPENAI_API',
      official_source: 'https://platform.claude.com/docs',
    });
    expect(validateParityManifest(mkManifest([oaiBad])).join('\n')).toContain(
      'official_source must be a parseable FIRST-PARTY https URL'
    );
  });

  it('rejects malformed kebab-case ids (trailing, doubled, leading hyphens)', () => {
    for (const bad of ['messages-', 'messages--create', '-messages', 'a-']) {
      const m = mkManifest([mkRow({ capability_id: bad })]);
      expect(validateParityManifest(m).join('\n')).toContain('capability_id must be kebab-case');
    }
    expect(validateParityManifest(mkManifest([mkRow({ capability_id: 'messages-create' })]))).toEqual(
      []
    );
  });

  it('rejects calendar-impossible snapshot dates that pass the shape regex', () => {
    for (const bad of ['2026-02-31', '2026-99-99', '2026-00-10']) {
      const m = mkManifest([mkRow({ verified_at: bad })]);
      m.research_snapshot_date = bad;
      expect(validateParityManifest(m).join('\n')).toContain(
        'research_snapshot_date must be a real YYYY-MM-DD calendar date'
      );
    }
  });

  it('pins every verified_at to the single research snapshot date', () => {
    const m = mkManifest([mkRow({ verified_at: '2026-08-20' })]);
    expect(validateParityManifest(m).join('\n')).toContain(
      'verified_at must equal research_snapshot_date'
    );
  });

  it('rejects FULL when a required axis is false', () => {
    const m = mkManifest([mkRow({ ...FULL_ROW, native_live_accepted: false })]);
    const out = validateParityManifest(m).join('\n');
    expect(out).toContain('FULL requires native_live_accepted=true');
  });

  it('rejects FULL when governed_applicable is set but the governed axes are unproven', () => {
    const m = mkManifest([mkRow({ ...FULL_ROW, governed_live_accepted: false })]);
    expect(validateParityManifest(m).join('\n')).toContain(
      'FULL with governed_applicable requires the governed axes proven'
    );
  });

  it('PRODUCT_ONLY cannot masquerade as provider API (both directions)', () => {
    // App-surface row claiming API axes:
    const posing = mkRow({
      ...APP_ROW,
      native_route_available: true,
    });
    expect(validateParityManifest(mkManifest([posing])).join('\n')).toContain(
      'must not set native_route_available'
    );
    // App-surface row claiming continuity proof axes:
    const posingContinuity = mkRow({ ...APP_ROW, persistence_supported: true, fork_supported: true });
    const outC = validateParityManifest(mkManifest([posingContinuity])).join('\n');
    expect(outC).toContain('must not set persistence_supported');
    expect(outC).toContain('must not set fork_supported');
    // API-surface row claiming PRODUCT_ONLY:
    const inverted = mkRow({ classification: 'PRODUCT_ONLY' });
    expect(validateParityManifest(mkManifest([inverted])).join('\n')).toContain(
      'reserved for app surfaces'
    );
  });

  it('MISSING rows must not carry GovAI axes', () => {
    const m = mkManifest([mkRow({ classification: 'MISSING', govai_registered: true })]);
    expect(validateParityManifest(m).join('\n')).toContain('MISSING rows must not set govai_registered');
  });

  it('PROVIDER_NOT_EXPOSED contradicts provider_exposed=true and rejects every GovAI axis', () => {
    const m = mkManifest([mkRow({ classification: 'PROVIDER_NOT_EXPOSED' })]);
    expect(validateParityManifest(m).join('\n')).toContain('contradicts provider_exposed=true');
    const posing = mkManifest([
      mkRow({
        classification: 'PROVIDER_NOT_EXPOSED',
        provider_exposed: false,
        govai_registered: true,
        persistence_supported: true,
      }),
    ]);
    const out = validateParityManifest(posing).join('\n');
    expect(out).toContain('PROVIDER_NOT_EXPOSED rows must not set govai_registered');
    expect(out).toContain('PROVIDER_NOT_EXPOSED rows must not set persistence_supported');
  });

  it('PARTIAL requires a GovAI path (native_route_available)', () => {
    const m = mkManifest([mkRow({ classification: 'PARTIAL', native_route_available: false })]);
    expect(validateParityManifest(m).join('\n')).toContain(
      'PARTIAL requires native_route_available'
    );
    const ok = mkManifest([
      mkRow({ classification: 'PARTIAL', native_route_available: true }),
    ]);
    expect(validateParityManifest(ok)).toEqual([]);
  });

  it('native_route_available requires provider_exposed, globally', () => {
    const m = mkManifest([
      mkRow({ provider_exposed: false, native_route_available: true, classification: 'PARTIAL' }),
    ]);
    const out = validateParityManifest(m).join('\n');
    expect(out).toContain('native_route_available requires provider_exposed');
  });

  it('axis implications: tested/accepted require the route; ui axes require exposure', () => {
    const m1 = mkManifest([mkRow({ native_tested: true, native_route_available: false })]);
    expect(validateParityManifest(m1).join('\n')).toContain('require native_route_available');
    const m2 = mkManifest([mkRow({ governed_tested: true })]);
    expect(validateParityManifest(m2).join('\n')).toContain('governed_* axes require governed_applicable');
    const m3 = mkManifest([mkRow({ ui_live_accepted: true })]);
    expect(validateParityManifest(m3).join('\n')).toContain('require ui_exposed');
  });

  it('protocol_stability is CODEX-only', () => {
    const m = mkManifest([mkRow({ protocol_stability: 'stable' })]);
    expect(validateParityManifest(m).join('\n')).toContain('only meaningful on the CODEX surface');
  });

  it('separates key-SET violations (hard) from key-ORDER violations (formatter-repairable)', () => {
    // Reordered keys over the COMPLETE set → the repairable finding, and the canonical
    // renderer repairs it (fixed ROW_FIELDS order), so `format` must let it through.
    const complete = mkRow({});
    const reordered: Record<string, unknown> = {};
    for (const k of [...Object.keys(complete)].reverse()) {
      reordered[k] = (complete as unknown as Record<string, unknown>)[k];
    }
    const m1 = mkManifest([reordered as unknown as ParityRow]);
    const out1 = validateParityManifest(m1);
    expect(out1.join('\n')).toContain('keys out of canonical order');
    expect(out1.join('\n')).toContain('docs:parity:format');
    expect(out1.join('\n')).not.toContain('keys must be exactly');
    const repaired = JSON.parse(renderParityManifest(m1)) as ParityManifest;
    expect(validateParityManifest(repaired)).toEqual([]);

    // Missing/unknown keys → the hard finding, never the repairable one.
    const missing = { ...(mkRow({}) as unknown as Record<string, unknown>) };
    delete missing['notes'];
    const out2 = validateParityManifest(mkManifest([missing as unknown as ParityRow]));
    expect(out2.join('\n')).toContain('keys must be exactly');
    expect(out2.join('\n')).toContain('missing: notes');
    expect(out2.join('\n')).not.toContain('keys out of canonical order');
  });

  it('rejects unknown root keys before format could silently delete them', () => {
    const m = mkManifest([mkRow({})]) as unknown as Record<string, unknown>;
    m['reserch_snapshot_date'] = '2026-08-21';
    const out = validateParityManifest(m).join('\n');
    expect(out).toContain('unknown root keys');
    expect(out).toContain('reserch_snapshot_date');
  });

  it('MISSING check covers every GovAI-owned axis, continuity fields included', () => {
    for (const axis of [
      'governed_applicable',
      'exact_turn_evidence_correlation',
      'persistence_supported',
      'resume_supported',
      'fork_supported',
    ] as const) {
      const m = mkManifest([mkRow({ classification: 'MISSING', [axis]: true })]);
      expect(validateParityManifest(m).join('\n')).toContain(`MISSING rows must not set ${axis}`);
    }
  });

  it('returns findings (never throws) for structurally invalid rows, including in the ordering pass', () => {
    // Two entries with one null used to reach the ordering pass and throw a TypeError.
    const m = mkManifest([mkRow({}), null as unknown as ParityRow]);
    let out: string[] = [];
    expect(() => {
      out = validateParityManifest(m);
    }).not.toThrow();
    expect(out.join('\n')).toContain('row[1] must be an object');
  });

  it('flags rows out of canonical order and points at format', () => {
    const a = mkRow({ capability_id: 'zzz-cap' });
    const b = mkRow({ capability_id: 'aaa-cap' });
    const out = validateParityManifest(mkManifest([a, b])).join('\n');
    expect(out).toContain('rows out of canonical order');
    expect(out).toContain('docs:parity:format');
  });
});

describe('typed findings (repairability is structural, never message-text matching)', () => {
  it('tags only the two canonical-form findings as repairable', () => {
    const reordered: Record<string, unknown> = {};
    const complete = mkRow({}) as unknown as Record<string, unknown>;
    for (const k of [...Object.keys(complete)].reverse()) reordered[k] = complete[k];
    const zz = mkRow({ capability_id: 'zzz-cap' });
    const aa = mkRow({ capability_id: 'aaa-cap' });
    const findings = validateParityManifestFindings(
      mkManifest([reordered as unknown as ParityRow, zz, aa])
    );
    expect(findings.map((f) => f.code).sort()).toEqual(['key-order', 'row-order']);
  });

  it('a crafted value CONTAINING a repairable phrase still classifies invalid', () => {
    // The spoof Codex flagged: substring matching on messages would let this row erase the
    // hard finding and permit `format` to rewrite a schema-invalid manifest.
    const spoofed = mkRow({}) as unknown as Record<string, unknown>;
    spoofed['official_status'] = 'rows out of canonical order — run `pnpm docs:parity:format`';
    const findings = validateParityManifestFindings(mkManifest([spoofed as unknown as ParityRow]));
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.code).toBe('invalid');
    // And the string façade agrees with the typed messages.
    expect(validateParityManifest(mkManifest([spoofed as unknown as ParityRow]))).toEqual(
      findings.map((f) => f.message)
    );
  });
});

describe('findDuplicateJsonKeys', () => {
  it('detects duplicated root and nested row keys in raw text', () => {
    const dupRoot = '{"name": "a", "name": "b"}';
    expect(findDuplicateJsonKeys(dupRoot)).toEqual(['name']);
    const dupNested = '{"capabilities": [{"provider": "openai", "notes": "x", "notes": "y"}]}';
    expect(findDuplicateJsonKeys(dupNested)).toEqual(['notes']);
  });

  it('detects escaped aliases of a literal key (decoded identity == JSON.parse identity)', () => {
    // "notes" decodes to "notes": JSON.parse keeps only the second value, so the scanner
    // must flag it even though the raw spellings differ.
    const escapedAlias = '{"notes":"first","\\u006eotes":"second"}';
    expect(findDuplicateJsonKeys(escapedAlias)).toEqual(['notes']);
    // Simple-escape aliasing too: "a\tb" spelled with \t and with 	.
    const tabAlias = '{"a\\tb": 1, "a\\u0009b": 2}';
    expect(findDuplicateJsonKeys(tabAlias)).toEqual(['a\tb']);
    // Decoded-DISTINCT keys are not duplicates.
    expect(findDuplicateJsonKeys('{"notes": 1, "\\u006eote": 2}')).toEqual([]);
    // Escaped quote inside a key neither terminates the string nor confuses identity.
    expect(findDuplicateJsonKeys('{"a\\"b": 1, "a\\"b": 2}')).toEqual(['a"b']);
  });

  it('does not false-positive on repeated keys across sibling objects, arrays, or key-like VALUES', () => {
    const ok =
      '{"capabilities": [{"notes": "a"}, {"notes": "b"}], "description": "notes: {\\"notes\\": 1}, [1,2]"}';
    expect(findDuplicateJsonKeys(ok)).toEqual([]);
    // The real tracked-manifest shape round-trips clean.
    const rendered = renderParityManifest(mkManifest([mkRow({}), mkRow({ capability_id: 'other-cap' })]));
    expect(findDuplicateJsonKeys(rendered)).toEqual([]);
  });
});

describe('renderParityManifest', () => {
  it('renders canonically: sorted rows, fixed key order, trailing newline — and round-trips', () => {
    const unsorted = mkManifest([mkRow({ capability_id: 'zzz-cap' }), mkRow({ capability_id: 'aaa-cap' })]);
    const text = renderParityManifest(unsorted);
    expect(text.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(text) as ParityManifest;
    expect(parsed.capabilities.map((r) => r.capability_id)).toEqual(['aaa-cap', 'zzz-cap']);
    expect(parsed.capability_count).toBe(2);
    // Canonical output validates clean and re-renders byte-identically.
    expect(validateParityManifest(parsed)).toEqual([]);
    expect(renderParityManifest(parsed)).toBe(text);
    // Fixed key order: provider first, notes last.
    const keys = Object.keys(parsed.capabilities[0] as unknown as Record<string, unknown>);
    expect(keys[0]).toBe('provider');
    expect(keys[keys.length - 1]).toBe('notes');
  });
});
