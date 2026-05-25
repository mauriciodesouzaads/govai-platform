import { describe, it, expect } from 'vitest';
import { COURT_DETECTOR_NAMES, detectCnjCaseNumbers, isValidCnjChecksum } from './court-detectors.js';

const ctx = { source_surface: 'govai_runs' as const };

describe('isValidCnjChecksum', () => {
  // Reference number from CNJ Resolução 65/2008 examples; the verification
  // digits below are correct under the mod-97 formula and are also widely
  // cited in CNJ training material.
  it('accepts a known-valid CNJ-format number', () => {
    expect(isValidCnjChecksum('0000001-30.2010.8.26.0100')).toBe(true);
  });

  it('rejects a number whose verification digits are wrong by one', () => {
    expect(isValidCnjChecksum('0000001-31.2010.8.26.0100')).toBe(false);
  });

  it('rejects a malformed structure', () => {
    expect(isValidCnjChecksum('not-a-number')).toBe(false);
    expect(isValidCnjChecksum('0000001-30.2010.8.26')).toBe(false);
    expect(isValidCnjChecksum('00001-30.2010.8.26.0100')).toBe(false);
  });
});

describe('detectCnjCaseNumbers', () => {
  it('detects a CNJ number embedded in prose', () => {
    const t = 'processo 0000001-30.2010.8.26.0100 foi distribuído';
    const out = detectCnjCaseNumbers(t, ctx);
    expect(out.length).toBe(1);
    const f = out[0]!;
    expect(f.detector).toBe('cnj_case_number');
    expect(f.detector_family).toBe('court');
    expect(f.category).toBe('court_case_identifier');
    expect(f.confidence_band).toBe('high');
    expect(f.rationale_code).toBe('cnj_format_and_checksum');
    expect(f.recommended_action).toBe('warn');
    expect(f.legal_review_recommended).toBe(true);
    expect(f.professional_review_recommended).toBe(true);
    // Raw match is not retained on the rich record.
    expect(JSON.stringify(f)).not.toContain('0000001-30.2010.8.26.0100');
    expect(f.match_preview_redacted).toBe('[REDACTED:cnj_case_number]');
    expect(f.match_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(f.index).toBeGreaterThanOrEqual(0);
    expect(f.length).toBe('0000001-30.2010.8.26.0100'.length);
  });

  it('rejects a CNJ-format-shaped string with bad checksum', () => {
    const t = 'processo 0000001-56.2010.8.26.0100 era inválido';
    expect(detectCnjCaseNumbers(t, ctx)).toEqual([]);
  });

  it('rejects a malformed CNJ-like number', () => {
    expect(detectCnjCaseNumbers('numero 12345-67.2010.8.26.0100 invalido', ctx)).toEqual([]);
    expect(detectCnjCaseNumbers('numero 0000001-55.2010.8.26 invalido', ctx)).toEqual([]);
  });

  it('detects multiple distinct CNJ numbers in the same text', () => {
    // Both numbers below pass the mod-97 checksum.
    const t = 'casos 0000001-30.2010.8.26.0100 e 0000002-15.2010.8.26.0100';
    const out = detectCnjCaseNumbers(t, ctx);
    expect(out.length).toBe(2);
    expect(out[0]?.match_hash).not.toBe(out[1]?.match_hash);
  });

  it('does not change the canonical detector name list', () => {
    expect([...COURT_DETECTOR_NAMES]).toEqual(['cnj_case_number']);
  });
});

describe('detectCnjCaseNumbers / SD1 boundary', () => {
  it('recommended_action is advisory (warn) — never deny or approve_required', () => {
    const t = 'processo 0000001-30.2010.8.26.0100';
    for (const f of detectCnjCaseNumbers(t, ctx)) {
      expect(f.recommended_action).toBe('warn');
    }
  });

  it('regex safety: long input does not hang', () => {
    const t = 'a'.repeat(200_000) + ' 0000001-30.2010.8.26.0100 ';
    const start = Date.now();
    const out = detectCnjCaseNumbers(t, ctx);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(out.length).toBe(1);
  });
});
