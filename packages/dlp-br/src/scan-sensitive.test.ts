import { describe, it, expect } from 'vitest';
import type { DetectorFinding } from './baseline-detectors.js';
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

  it('combines baseline + secret + court detector families into one homogeneous stream', () => {
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

  it('SD2A: combines baseline + secret + court + financial + health into one homogeneous stream', () => {
    const text = [
      'cpf 111.444.777-35',
      'chave sk-ant-api03_AbCdEfGhIjKlMnOpQrStUv',
      'processo 0000001-30.2010.8.26.0100',
      'card 4111111111111111',
      'IBAN GB82 WEST 1234 5698 7654 32',
      'agência 1234-5 conta corrente 67890-1',
      'paciente CID-10 E11.9 prontuário nº 9999',
      'receita médica 500 mg',
      'exame de glicemia 110 mg/dL',
    ].join(' / ');
    const out = scanSensitiveData(text, ctx);
    const families = new Set(out.map((f) => f.detector_family));
    expect(families).toEqual(
      new Set(['baseline_pii_br', 'secret', 'court', 'financial', 'health']),
    );
    const detectors = out.map((f) => f.detector);
    expect(detectors).toEqual(
      expect.arrayContaining([
        'cpf',
        'anthropic_api_key_candidate',
        'cnj_case_number',
        'payment_card_luhn_candidate',
        'iban_candidate',
        'br_bank_account_context_candidate',
        'cid10_code_candidate',
        'medical_record_identifier_candidate',
        'prescription_context_candidate',
        'lab_result_context_candidate',
      ]),
    );
  });

  it('SD2A: family ordering is stable (baseline → secret → court → financial → health)', () => {
    const text =
      'cpf 111.444.777-35 sk-ant-api03_AbCdEfGhIjKlMnOpQrStUv 0000001-30.2010.8.26.0100 card 4111111111111111 CID-10 E11.9';
    const out = scanSensitiveData(text, ctx);
    const sequence = out.map((f) => f.detector_family);
    const rankOf: Record<string, number> = {
      baseline_pii_br: 0,
      secret: 1,
      court: 2,
      financial: 3,
      health: 4,
    };
    for (let i = 1; i < sequence.length; i++) {
      const prev = rankOf[sequence[i - 1]!] ?? -1;
      const cur = rankOf[sequence[i]!] ?? -1;
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
  });

  it('SD2A: include_baseline=false still allows financial + health detectors to fire', () => {
    const text = 'card 4111111111111111 CID-10 E11.9';
    const out = scanSensitiveData(text, { ...ctx, include_baseline: false });
    expect(out.some((f) => f.detector === 'payment_card_luhn_candidate')).toBe(true);
    expect(out.some((f) => f.detector === 'cid10_code_candidate')).toBe(true);
    expect(out.some((f) => f.detector_family === 'baseline_pii_br')).toBe(false);
  });

  it('SD2A: supplied baseline_findings does not affect financial + health detection', () => {
    const text =
      'card 4111111111111111 CID-10 E11.9 cpf 111.444.777-35 in the actual text';
    const out = scanSensitiveData(text, { ...ctx, baseline_findings: [] });
    expect(out.some((f) => f.detector === 'payment_card_luhn_candidate')).toBe(true);
    expect(out.some((f) => f.detector === 'cid10_code_candidate')).toBe(true);
    expect(out.filter((f) => f.detector_family === 'baseline_pii_br')).toHaveLength(0);
  });

  it('SD2A: no raw plaintext for financial or health fixtures appears in JSON.stringify(findings)', () => {
    const text =
      'card 4111111111111111 IBAN GB82WEST12345698765432 CID-10 E11.9 prontuário nº 9999 exame glicemia 110 mg/dL';
    const out = scanSensitiveData(text, ctx);
    const ser = JSON.stringify(out);
    for (const banned of [
      '4111111111111111',
      'GB82WEST12345698765432',
      'E11.9',
      '9999',
      '110 mg/dL',
    ]) {
      expect(ser).not.toContain(banned);
    }
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

  // Codex PR-SD1 P2: when the caller already ran detectAllBaseline (the API
  // pipeline does this), `scanSensitiveData` must NOT re-scan — it should lift
  // the supplied list as-is. The three tests below pin the precedence rules
  // (supplied list > include_baseline flag) so the hot-path optimization in
  // `apps/api/src/pipeline/dlp.ts` cannot regress to a double scan.
  describe('baseline_findings reuse (Codex P2)', () => {
    it('lifts supplied baseline_findings without re-scanning the text', () => {
      // Text contains NO real CPF, but we hand a synthetic baseline finding;
      // it must appear in the rich output. If scanSensitiveData ignored the
      // supplied list and re-scanned, this test would emit 0 rich findings.
      const supplied: DetectorFinding[] = [
        { detector: 'cpf', match: '111.444.777-35', index: 0, length: 14 },
      ];
      const out = scanSensitiveData('text with no actual cpf', {
        ...ctx,
        baseline_findings: supplied,
      });
      const lifts = out.filter((f) => f.detector_family === 'baseline_pii_br');
      expect(lifts).toHaveLength(1);
      expect(lifts[0]?.detector).toBe('cpf');
    });

    it('does not re-scan when baseline_findings is supplied — text matches are ignored', () => {
      // Text contains a valid CPF that detectAllBaseline WOULD detect. But
      // because we supplied an empty baseline list, the rich stream must
      // carry exactly zero baseline lifts.
      const out = scanSensitiveData('cpf 111.444.777-35 here', {
        ...ctx,
        baseline_findings: [],
      });
      const lifts = out.filter((f) => f.detector_family === 'baseline_pii_br');
      expect(lifts).toHaveLength(0);
    });

    it('supplied baseline_findings beats include_baseline flag in either direction', () => {
      const supplied: DetectorFinding[] = [
        { detector: 'cpf', match: '111.444.777-35', index: 0, length: 14 },
      ];
      // include_baseline=false is ignored when baseline_findings is supplied.
      const out = scanSensitiveData('text with no actual cpf', {
        ...ctx,
        include_baseline: false,
        baseline_findings: supplied,
      });
      const lifts = out.filter((f) => f.detector_family === 'baseline_pii_br');
      expect(lifts).toHaveLength(1);
    });

    it('supplied baseline_findings is lifted exactly once even when text would re-match', () => {
      // Hand the lift list; the text also contains a valid CPF that
      // detectAllBaseline would match. With the new precedence we lift only
      // the supplied finding once — no duplication from a second scan.
      const supplied: DetectorFinding[] = [
        { detector: 'cpf', match: '111.444.777-35', index: 4, length: 14 },
      ];
      const out = scanSensitiveData('cpf 111.444.777-35', { ...ctx, baseline_findings: supplied });
      const lifts = out.filter((f) => f.detector === 'cpf');
      expect(lifts).toHaveLength(1);
    });
  });
});
