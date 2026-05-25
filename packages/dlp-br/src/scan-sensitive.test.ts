import { describe, it, expect } from 'vitest';
import { scanSensitiveData } from './scan-sensitive.js';

const ctx = { source_surface: 'govai_runs' as const };

describe('scanSensitiveData', () => {
  it('emits an empty list for plain text', () => {
    expect(scanSensitiveData('hello world', ctx)).toEqual([]);
  });

  it('lifts baseline PII into rich findings with hash + redacted preview only', () => {
    const out = scanSensitiveData('cpf 111.444.777-35 e contato a@b.com', ctx);
    const detectors = out.map((f) => f.detector).sort();
    expect(detectors).toEqual(['cpf', 'email'].sort());
    for (const f of out) {
      expect(f.match_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(f.match_preview_redacted).toBe(`[REDACTED:${f.detector}]`);
      expect(f.origin).toBe('govai_native');
      expect(f.source_quality).toBe('primary_govai_evidence');
    }
    // No plaintext leaks into the rich stream.
    const ser = JSON.stringify(out);
    expect(ser).not.toContain('111.444.777-35');
    expect(ser).not.toContain('a@b.com');
  });

  it('include_baseline=false drops baseline lifts but keeps SD1 new detectors', () => {
    const text = 'cpf 111.444.777-35 e key sk-ant-api03_AbCdEfGhIjKlMnOpQrStUv';
    const withBaseline = scanSensitiveData(text, ctx);
    const withoutBaseline = scanSensitiveData(text, { ...ctx, include_baseline: false });
    expect(withBaseline.some((f) => f.detector === 'cpf')).toBe(true);
    expect(withoutBaseline.some((f) => f.detector === 'cpf')).toBe(false);
    expect(withoutBaseline.some((f) => f.detector === 'anthropic_api_key_candidate')).toBe(
      true,
    );
  });

  it('combines all three families (baseline + secret + court) into one homogeneous stream', () => {
    const text =
      'cpf 111.444.777-35 chave sk-ant-api03_AbCdEfGhIjKlMnOpQrStUv processo 0000001-30.2010.8.26.0100';
    const out = scanSensitiveData(text, ctx);
    const detectors = out.map((f) => f.detector);
    expect(detectors).toEqual(
      expect.arrayContaining(['cpf', 'anthropic_api_key_candidate', 'cnj_case_number']),
    );
    const families = new Set(out.map((f) => f.detector_family));
    expect(families).toEqual(new Set(['baseline_pii_br', 'secret', 'court']));
  });

  it('does not compute a highestAction — rich findings are advisory only', () => {
    const out = scanSensitiveData('sk-ant-api03_AbCdEfGhIjKlMnOpQrStUv', ctx);
    // Detector tags `review` advisory only; no field on the finding implies a
    // global "highestAction" — that remains the legacy DlpScanResult triple.
    for (const f of out) {
      expect(['observe', 'warn', 'review']).toContain(f.recommended_action);
      expect(f).not.toHaveProperty('highestAction');
    }
  });

  it('honors origin override (e.g., connector-ingested)', () => {
    const out = scanSensitiveData('cpf 111.444.777-35', {
      source_surface: 'connector_microsoft',
      origin: 'connector_ingested',
    });
    expect(out).toHaveLength(1);
    const f = out[0]!;
    expect(f.origin).toBe('connector_ingested');
    expect(f.source_surface).toBe('connector_microsoft');
    // Quality stays primary_govai_evidence because the lift is from a
    // GovAI-native baseline detector even when the surface is a connector.
    expect(f.source_quality).toBe('primary_govai_evidence');
  });
});
