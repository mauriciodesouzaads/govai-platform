import { describe, it, expect } from 'vitest';
import {
  HEALTH_DETECTOR_NAMES,
  detectHealthData,
} from './health-detectors.js';

const ctx = { source_surface: 'govai_runs' as const };

function detectorsOf(text: string): string[] {
  return detectHealthData(text, ctx).map((f) => f.detector);
}

describe('detectHealthData / cid10_code_candidate', () => {
  it('detects a CID-10 code only when explicit CID/ICD context is present', () => {
    const t = 'paciente registrou CID-10 E11.9 no atendimento';
    const out = detectHealthData(t, ctx);
    const codes = out.filter((f) => f.detector === 'cid10_code_candidate');
    expect(codes).toHaveLength(1);
    const f = codes[0]!;
    expect(f.category).toBe('health_data');
    expect(f.detector_family).toBe('health');
    expect(f.rationale_code).toBe('cid10_context_format');
    expect(f.recommended_action).toBe('review');
    expect(f.confidence_band).toBe('high');
    expect(f.dpo_review_recommended).toBe(true);
    expect(f.sector_specialist_review_recommended).toBe(true);
    expect(f.professional_review_recommended).toBe(true);
    // SD2A health detectors do NOT recommend legal or security review by default.
    expect(f.legal_review_recommended).toBe(false);
    expect(f.security_review_recommended).toBe(false);
    expect(f.match_preview_redacted).toBe('[REDACTED:cid10_code_candidate]');
    expect(f.match_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(f).not.toHaveProperty('match');
  });

  it('does not match a CID-format code without CID/ICD context', () => {
    expect(detectorsOf('E11.9')).not.toContain('cid10_code_candidate');
    expect(detectorsOf('letter J45 alone')).not.toContain('cid10_code_candidate');
  });

  it('matches across context variants (CID, ICD, CID-10, ICD-10)', () => {
    expect(detectorsOf('CID J45')).toContain('cid10_code_candidate');
    expect(detectorsOf('ICD C50.9')).toContain('cid10_code_candidate');
    expect(detectorsOf('ICD-10 E11.9')).toContain('cid10_code_candidate');
    expect(detectorsOf('cid-10 j45')).not.toContain('cid10_code_candidate'); // lowercase code rejected
  });

  it('rejects common letter+digits strings without CID context', () => {
    expect(detectorsOf('seat A12 or row B45')).not.toContain('cid10_code_candidate');
  });

  it('finding payload contains no clinical interpretation or disease meaning', () => {
    const out = detectHealthData('paciente registrou CID-10 E11.9 no atendimento', ctx);
    const ser = JSON.stringify(out).toLowerCase();
    for (const banned of [
      'diabetes',
      'mellitus',
      'asthma',
      'asma',
      'breast cancer',
      'câncer de mama',
      'cancer de mama',
      'diagnosed',
      'diagnostico',
      'diagnóstico',
      'condition: ',
      'disease: ',
      'doença: ',
      'medical advice',
      'clinical decision',
    ]) {
      expect(ser).not.toContain(banned);
    }
  });
});

describe('detectHealthData / medical_record_identifier_candidate', () => {
  it('detects when a prontuário identifier is present', () => {
    const out = detectHealthData('prontuário nº 123456 do paciente X', ctx);
    const recs = out.filter((f) => f.detector === 'medical_record_identifier_candidate');
    expect(recs).toHaveLength(1);
    const f = recs[0]!;
    expect(f.category).toBe('health_data');
    expect(f.rationale_code).toBe('medical_record_context_identifier');
    expect(f.recommended_action).toBe('review');
    expect(f.match_preview_redacted).toBe('[REDACTED:medical_record_identifier_candidate]');
    expect(JSON.stringify(f)).not.toContain('123456');
  });

  it('detects "registro médico" and "ficha clínica" variants', () => {
    expect(detectorsOf('registro médico 4567')).toContain(
      'medical_record_identifier_candidate',
    );
    expect(detectorsOf('ficha clínica 9876')).toContain(
      'medical_record_identifier_candidate',
    );
  });

  it('does not fire on protocol/case numbers without health context', () => {
    expect(detectorsOf('protocolo nº 123456 emitido pelo cartório')).not.toContain(
      'medical_record_identifier_candidate',
    );
    expect(detectorsOf('número do chamado 555-1234')).not.toContain(
      'medical_record_identifier_candidate',
    );
  });

  it('does not fire when the identifier captured has no digits', () => {
    expect(detectorsOf('prontuário aberto pela manhã')).not.toContain(
      'medical_record_identifier_candidate',
    );
  });
});

describe('detectHealthData / prescription_context_candidate', () => {
  it('fires when prescription context AND dosage are present', () => {
    const out = detectHealthData(
      'prescrição: tomar 1 comprimido de 500 mg a cada 12 horas',
      ctx,
    );
    const rxs = out.filter((f) => f.detector === 'prescription_context_candidate');
    expect(rxs.length).toBeGreaterThanOrEqual(1);
    const f = rxs[0]!;
    expect(f.category).toBe('health_data');
    expect(f.rationale_code).toBe('prescription_context_dosage');
    expect(f.recommended_action).toBe('review');
  });

  it('detects on "receita médica" + mg dosage', () => {
    expect(detectorsOf('receita médica indicando 250 mg')).toContain(
      'prescription_context_candidate',
    );
  });

  it('does not fire on a medication name alone without context+dosage', () => {
    expect(detectorsOf('paracetamol')).not.toContain('prescription_context_candidate');
  });

  it('does not fire on a bare dosage without medical context', () => {
    expect(detectorsOf('o produto tem 500 mg de cafeína na embalagem comercial')).not.toContain(
      'prescription_context_candidate',
    );
  });

  it('does not infer treatment, prescription correctness, or clinical advice', () => {
    const out = detectHealthData(
      'prescrição: tomar 1 comprimido de 500 mg a cada 12 horas',
      ctx,
    );
    const ser = JSON.stringify(out).toLowerCase();
    for (const banned of [
      'correct dose',
      'dose correta',
      'recommended treatment',
      'tratamento recomendado',
      'treat for',
      'cure',
      'cura',
      'clinical advice',
      'medical advice',
    ]) {
      expect(ser).not.toContain(banned);
    }
  });
});

describe('detectHealthData / lab_result_context_candidate', () => {
  it('fires when lab context AND a value/unit are present', () => {
    const out = detectHealthData('exame de glicemia: 110 mg/dL', ctx);
    const labs = out.filter((f) => f.detector === 'lab_result_context_candidate');
    expect(labs.length).toBeGreaterThanOrEqual(1);
    const f = labs[0]!;
    expect(f.category).toBe('health_data');
    expect(f.rationale_code).toBe('lab_result_context_value');
    expect(f.recommended_action).toBe('review');
  });

  it('detects on lab-specific words alone (glicemia, hemoglobina, creatinina, PCR)', () => {
    expect(detectorsOf('hemoglobina 13.5 g/dL')).toContain('lab_result_context_candidate');
    expect(detectorsOf('creatinina 1.1 mg/dL')).toContain('lab_result_context_candidate');
    expect(detectorsOf('PCR 4 mg/L')).toContain('lab_result_context_candidate');
  });

  it('does not fire on a value/unit alone without lab context', () => {
    expect(detectorsOf('o produto contém 110 mg/dL de solvente')).not.toContain(
      'lab_result_context_candidate',
    );
  });

  it('does not fire on generic numeric text', () => {
    expect(detectorsOf('o orçamento total é 1234,56')).not.toContain(
      'lab_result_context_candidate',
    );
  });

  it('does not interpret values as normal/abnormal/high/low', () => {
    const out = detectHealthData('exame de glicemia: 110 mg/dL', ctx);
    const ser = JSON.stringify(out).toLowerCase();
    for (const banned of [
      'normal range',
      'fora da faixa',
      'high value',
      'low value',
      'abnormal',
      'anormal',
      'dangerous',
      'preocupante',
      'preocupado',
      'clinical interpretation',
      'interpretação clínica',
      'interpretacao clinica',
    ]) {
      expect(ser).not.toContain(banned);
    }
  });
});

describe('detectHealthData / safety + invariants', () => {
  it('exposes the documented SD2A health detector list', () => {
    expect([...HEALTH_DETECTOR_NAMES].sort()).toEqual(
      [
        'cid10_code_candidate',
        'medical_record_identifier_candidate',
        'prescription_context_candidate',
        'lab_result_context_candidate',
      ].sort(),
    );
  });

  it('every finding carries match_hash and redacted preview, never plaintext', () => {
    const text = [
      'CID-10 E11.9 anotado',
      'prontuário nº 123456',
      'receita médica 500 mg',
      'exame glicemia 110 mg/dL',
    ].join('\n');
    const findings = detectHealthData(text, ctx);
    expect(findings.length).toBeGreaterThanOrEqual(4);
    for (const f of findings) {
      expect(f.match_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(f.match_preview_redacted).toBe(`[REDACTED:${f.detector}]`);
      expect(f).not.toHaveProperty('match');
      expect(['observe', 'warn', 'review']).toContain(f.recommended_action);
    }
    const ser = JSON.stringify(findings);
    // Raw identifier/value strings are not retained.
    expect(ser).not.toContain('E11.9');
    expect(ser).not.toContain('123456');
    expect(ser).not.toContain('110 mg/dL');
  });

  it('no health finding carries any clinical-meaning field', () => {
    const text =
      'CID-10 E11.9 com prontuário nº 9999 receita médica 500 mg exame glicemia 110 mg/dL';
    const out = detectHealthData(text, ctx);
    for (const f of out) {
      // SensitiveDataFinding only has the documented advisory metadata
      // fields; SD2A must not invent a new field that carries clinical
      // interpretation.
      expect(f).not.toHaveProperty('clinical_meaning');
      expect(f).not.toHaveProperty('disease');
      expect(f).not.toHaveProperty('diagnosis');
      expect(f).not.toHaveProperty('triage');
      expect(f).not.toHaveProperty('treatment');
      expect(f).not.toHaveProperty('lab_interpretation');
      expect(f).not.toHaveProperty('clinical_decision');
    }
  });

  it('regex safety: long pathological input does not hang', () => {
    const t = 'a'.repeat(120_000) + ' CID-10 E11.9 end';
    const start = Date.now();
    const out = detectHealthData(t, ctx);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(out.some((f) => f.detector === 'cid10_code_candidate')).toBe(true);
  });
});
