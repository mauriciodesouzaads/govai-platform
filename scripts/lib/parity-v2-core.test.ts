// Fixture tests for the V2-specific parity-manifest invariants
// (EP-PROVIDER-NATIVE-PARITY-V1-NATIVE-EXPERIENCE-CONTRACT-AND-CURRENT-BASELINE-01).
//
// The inherited V1 rules (axis coherence, classification truth, PRODUCT_ONLY masquerade,
// first-party sources, single snapshot, canonical ordering) are exercised exhaustively by
// lib/parity-core.test.ts against the V1 implementation; V2 re-states them over the wider
// field set, and the tracked-artifact lane (native-experience-parity-v2-manifest.test.ts)
// enforces them on the real manifest. What THIS file pins is the V2 delta: the four new row
// fields' vocabulary and coherence rules, the new root fields, and the render round-trip
// over the V2 key order.

import { describe, expect, it } from 'vitest';

import {
  renderParityV2Manifest,
  validateParityV2Manifest,
  validateParityV2ManifestFindings,
  ROW_FIELDS_V2,
  type ParityV2Manifest,
  type ParityV2Row,
} from './parity-v2-core.js';

const SNAP = '2026-08-29';

function apiRow(overrides: Partial<ParityV2Row> = {}): ParityV2Row {
  return {
    provider: 'openai',
    surface: 'OPENAI_API',
    family: 'models',
    capability_id: 'models',
    capability_name: 'List models (GET /v1/models)',
    official_status: 'GA',
    protocol_stability: null,
    retirement_date: null,
    official_source: 'https://developers.openai.com/api/docs/api-reference/models',
    source_type: 'api-reference',
    verified_at: SNAP,
    model_constraints: null,
    capability_source: 'provider_machine_metadata',
    state_nature: null,
    provider_exposed: true,
    govai_registered: false,
    native_route_available: false,
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
    next_wave: null,
    classification: 'MISSING',
    notes: 'fixture',
    ...overrides,
  };
}

function appRow(overrides: Partial<ParityV2Row> = {}): ParityV2Row {
  return apiRow({
    surface: 'CHATGPT_APP',
    family: 'workspace',
    capability_id: 'projects',
    capability_name: 'ChatGPT Projects',
    official_status: 'PRODUCT_ONLY',
    official_source: 'https://help.openai.com/en/articles/example',
    source_type: 'product-page',
    capability_source: 'provider_documentation',
    provider_exposed: false,
    govai_product_equivalent_required: true,
    classification: 'PRODUCT_ONLY',
    ...overrides,
  });
}

function manifest(rows: ParityV2Row[]): ParityV2Manifest {
  return {
    schema_version: 2,
    baseline_version: 2,
    name: 'native-experience-parity-v2',
    description: 'fixture',
    predecessor: 'docs/architecture/generated/native-experience-parity-v1.json',
    research_snapshot_date: SNAP,
    source_anchor: '79bd71407830ef2ef244fba6c53ac57cdebd11a3',
    verify: 'pnpm docs:parity2:check',
    doc: 'docs/architecture/native-experience-parity-v2.md',
    capability_count: rows.length,
    capabilities: rows,
  };
}

describe('parity-v2-core — V2 field invariants', () => {
  it('accepts a valid manifest with API and app rows', () => {
    expect(validateParityV2Manifest(manifest([apiRow(), appRow()]))).toEqual([]);
  });

  it('rejects a non-calendar retirement_date and accepts a real one', () => {
    expect(
      validateParityV2Manifest(manifest([apiRow({ retirement_date: '2026-02-31' })]))
    ).toHaveLength(1);
    expect(
      validateParityV2Manifest(manifest([apiRow({ retirement_date: '2026-09-24' })]))
    ).toEqual([]);
  });

  it('rejects unknown capability_source / state_nature / next_wave values', () => {
    const bad = manifest([
      apiRow({
        capability_source: 'scraped_docs' as ParityV2Row['capability_source'],
        state_nature: 'session' as ParityV2Row['state_nature'],
        next_wave: 'P10' as ParityV2Row['next_wave'],
      }),
    ]);
    const messages = validateParityV2Manifest(bad);
    expect(messages).toHaveLength(3);
  });

  it('forbids provider_machine_metadata on app surfaces (masquerade rule)', () => {
    const bad = manifest([appRow({ capability_source: 'provider_machine_metadata' })]);
    expect(validateParityV2Manifest(bad)).toEqual([
      'CHATGPT_APP/projects: app-surface rows must not claim provider_machine_metadata',
    ]);
  });

  it('forbids next_wave on NOT_APPLICABLE and PROVIDER_NOT_EXPOSED rows', () => {
    const na = manifest([apiRow({ classification: 'NOT_APPLICABLE', next_wave: 'P1' })]);
    expect(validateParityV2Manifest(na)).toEqual([
      'OPENAI_API/models: NOT_APPLICABLE rows must not carry next_wave',
    ]);
    const pne = manifest([
      apiRow({
        classification: 'PROVIDER_NOT_EXPOSED',
        provider_exposed: false,
        capability_source: null,
        next_wave: 'P5',
      }),
    ]);
    expect(validateParityV2Manifest(pne)).toEqual([
      'OPENAI_API/models: PROVIDER_NOT_EXPOSED rows must not carry next_wave',
    ]);
  });

  it('rejects wrong root identity fields (schema/baseline/name)', () => {
    const m = manifest([apiRow()]) as unknown as Record<string, unknown>;
    m['schema_version'] = 1;
    m['baseline_version'] = 1;
    m['name'] = 'native-experience-parity-v1';
    expect(validateParityV2Manifest(m)).toHaveLength(3);
  });

  it('classifies key order as repairable and renders the canonical order', () => {
    const row = apiRow();
    // Rebuild the row with the first two keys swapped: same key SET, wrong order.
    const keys = [ROW_FIELDS_V2[1], ROW_FIELDS_V2[0], ...ROW_FIELDS_V2.slice(2)];
    const shuffled: Record<string, unknown> = {};
    for (const k of keys) shuffled[k] = (row as unknown as Record<string, unknown>)[k];
    const m = manifest([shuffled as unknown as ParityV2Row]);
    const findings = validateParityV2ManifestFindings(m);
    expect(findings.map((f) => f.code)).toEqual(['key-order']);
    const rendered = renderParityV2Manifest(m);
    const reparsed = JSON.parse(rendered) as ParityV2Manifest;
    expect(validateParityV2Manifest(reparsed)).toEqual([]);
    expect(renderParityV2Manifest(reparsed)).toBe(rendered);
  });

  it('keeps inherited no-overclaim rules over the V2 field set (MISSING ⇒ no GovAI axes)', () => {
    const bad = manifest([apiRow({ persistence_supported: true })]);
    expect(validateParityV2Manifest(bad)).toEqual([
      'OPENAI_API/models: MISSING rows must not set persistence_supported',
    ]);
  });
});
