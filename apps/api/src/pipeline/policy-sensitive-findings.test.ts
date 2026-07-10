// PR-SD1 — policy-layer plaintext leak + advisory-action boundary proofs.
//
// These tests pin two SD1 invariants at the pipeline layer:
//
//   1. `decidePolicy` never emits raw matched substrings (CPF / CNPJ / email /
//      phone / secret / CNJ) into its `reasons[]` — only detector tokens and
//      indices, which is the same shape persisted into `policy_decisions`.
//
//   2. Attaching rich `sensitiveFindings` to a `DlpScanResult` does NOT change
//      the policy decision in any direction, even when those rich findings
//      carry `recommended_action='deny'`. The legacy
//      `findings / configByDetector / highestAction` triple remains the sole
//      enforcement input.
//
// No DB connection is required — `decidePolicy` is a pure function over its
// inputs.

import { describe, it, expect } from 'vitest';
import {
  detectAllBaseline,
  scanSensitiveData,
  type DetectorFinding,
  type SensitiveDataFinding,
} from '@govai/dlp-br';
import { decidePolicy } from './policy.js';
import { mergeWithActions, type DlpScanResult } from './dlp.js';

const ctx = {
  capabilityId: 'anthropic.messages.create',
  effectiveLevel: 1 as const,
  policyCommitSha: '0000000000000000000000000000000000000000',
};

function buildDlp(
  rawFindings: DetectorFinding[],
  config: Array<{ detector: string; action: 'detect' | 'redact' | 'deny' }>,
  sensitiveFindings?: SensitiveDataFinding[],
): DlpScanResult {
  const configByDetector = new Map<string, 'detect' | 'redact' | 'deny'>();
  for (const c of config) configByDetector.set(c.detector, c.action);
  // F5/F6: o resultado real do scan carrega SPANS FUNDIDOS com ação efetiva;
  // o helper roteia pela mesma API pública usada pelo dlpPreScan. Todos os
  // casos deste arquivo usam achados disjuntos — a fusão é identidade aqui.
  const findings = mergeWithActions(rawFindings, configByDetector);
  let highestAction: 'detect' | 'redact' | 'deny' = 'detect';
  const rank = { detect: 0, redact: 1, deny: 2 } as const;
  for (const f of findings) {
    if (rank[f.action] > rank[highestAction]) highestAction = f.action;
  }
  return {
    findings,
    rawFindings,
    configByDetector,
    highestAction,
    ...(sensitiveFindings ? { sensitiveFindings } : {}),
  };
}

describe('decidePolicy / plaintext leakage', () => {
  it('does not put a CPF match string into reasons even on deny', () => {
    const cpfRaw = '111.444.777-35';
    const dlp = buildDlp(
      [{ detector: 'cpf', match: cpfRaw, index: 4, length: cpfRaw.length }],
      [{ detector: 'cpf', action: 'deny' }],
    );
    const { decision } = decidePolicy(ctx, dlp);
    expect(decision.kind).toBe('deny');
    for (const reason of decision.reasons) {
      expect(reason).not.toContain(cpfRaw);
      expect(reason).not.toContain('11144477735');
    }
    expect(JSON.stringify(decision.reasons)).not.toContain(cpfRaw);
  });

  it('does not put email or phone match strings into reasons on redact', () => {
    const emailRaw = 'leak@example.com';
    const phoneRaw = '48 99876-5432';
    const dlp = buildDlp(
      [
        { detector: 'email', match: emailRaw, index: 0, length: emailRaw.length },
        { detector: 'phone_br', match: phoneRaw, index: 20, length: phoneRaw.length },
      ],
      [
        { detector: 'email', action: 'redact' },
        { detector: 'phone_br', action: 'redact' },
      ],
    );
    const { decision } = decidePolicy(ctx, dlp);
    expect(decision.kind).toBe('mutate');
    const s = JSON.stringify(decision.reasons);
    expect(s).not.toContain(emailRaw);
    expect(s).not.toContain(phoneRaw);
  });

  it('does not echo secret or CNJ raw text into reasons when those rich findings are attached', () => {
    const secretRaw = 'sk-ant-api03_AbCdEfGhIjKlMnOpQrStUvW';
    const cnjRaw = '0000001-30.2010.8.26.0100';
    const text = `chave ${secretRaw} processo ${cnjRaw}`;
    const sensitiveFindings = scanSensitiveData(text, { source_surface: 'govai_runs' });
    // Sanity: the rich scan picks them up.
    expect(sensitiveFindings.some((f) => f.detector === 'anthropic_api_key_candidate')).toBe(true);
    expect(sensitiveFindings.some((f) => f.detector === 'cnj_case_number')).toBe(true);

    // No legacy CPF/CNPJ/email/phone findings — only the rich attached set.
    const dlp = buildDlp([], [], sensitiveFindings);
    const { decision } = decidePolicy(ctx, dlp);
    const s = JSON.stringify(decision.reasons);
    expect(s).not.toContain(secretRaw);
    expect(s).not.toContain(cnjRaw);
  });
});

describe('decidePolicy / advisory-action boundary (SD1)', () => {
  it('rich sensitiveFindings do not change kind from allow when legacy findings are empty', () => {
    const sensitiveFindings = scanSensitiveData(
      'chave sk-ant-api03_AbCdEfGhIjKlMnOpQrStUvW',
      { source_surface: 'govai_runs' },
    );
    expect(sensitiveFindings.some((f) => f.detector === 'anthropic_api_key_candidate')).toBe(true);
    const dlp = buildDlp([], [], sensitiveFindings);
    const { decision } = decidePolicy(ctx, dlp);
    expect(decision.kind).toBe('allow');
  });

  it('a recommended_action="deny" rich finding does NOT cause runtime blocking in SD1', () => {
    // Construct a synthetic rich finding with the strictest advisory action.
    // The legacy DLP path is empty, so the legacy contract resolves to allow;
    // the SD1 advisory action must not promote that to deny.
    const advisoryDenyFinding: SensitiveDataFinding = {
      detector: 'synthetic_secret_for_test',
      detector_family: 'secret',
      category: 'secrets_api_keys',
      index: 0,
      length: 10,
      match_hash: 'a'.repeat(64),
      match_preview_redacted: '[REDACTED:synthetic_secret_for_test]',
      confidence: 0.99,
      confidence_band: 'high',
      rationale_code: 'test_only',
      recommended_action: 'deny',
      origin: 'govai_native',
      source_surface: 'govai_runs',
      source_quality: 'primary_govai_evidence',
      redaction_hint: 'mask_full:synthetic_secret_for_test',
      professional_review_recommended: true,
      dpo_review_recommended: false,
      legal_review_recommended: false,
      security_review_recommended: true,
      sector_specialist_review_recommended: false,
    };
    const dlp = buildDlp([], [], [advisoryDenyFinding]);
    const { decision } = decidePolicy(ctx, dlp);
    expect(decision.kind).toBe('allow');
    expect(decision.reasons).toEqual(['no findings']);
  });

  it('the legacy path still drives kind when both legacy and rich findings are present', () => {
    const cpfRaw = '111.444.777-35';
    const sensitiveFindings = scanSensitiveData(
      `cpf ${cpfRaw} chave sk-ant-api03_AbCdEfGhIjKlMnOpQrStUvW`,
      { source_surface: 'govai_runs' },
    );
    const dlp = buildDlp(
      [{ detector: 'cpf', match: cpfRaw, index: 4, length: cpfRaw.length }],
      [{ detector: 'cpf', action: 'deny' }],
      sensitiveFindings,
    );
    const { decision } = decidePolicy(ctx, dlp);
    expect(decision.kind).toBe('deny');
    // Reasons reflect only the legacy detector, not the rich detector list.
    for (const r of decision.reasons) {
      expect(r.startsWith('dlp.')).toBe(true);
    }
    expect(JSON.stringify(decision.reasons)).not.toContain(
      'sk-ant-api03_AbCdEfGhIjKlMnOpQrStUvW',
    );
  });

  // SD2A — adding financial / health rich findings must not alter decidePolicy
  // in any direction. The legacy `findings / configByDetector / highestAction`
  // triple remains the sole enforcement input; `recommended_action='review'`
  // on a card / IBAN / CID-10 / prescription / lab finding is metadata only.
  it('SD2A: financial sensitiveFindings do not change kind from allow when legacy findings are empty', () => {
    const sensitiveFindings = scanSensitiveData(
      'card 4111111111111111 IBAN GB82WEST12345698765432',
      { source_surface: 'govai_runs' },
    );
    expect(sensitiveFindings.some((f) => f.detector === 'payment_card_luhn_candidate')).toBe(true);
    expect(sensitiveFindings.some((f) => f.detector === 'iban_candidate')).toBe(true);
    const dlp = buildDlp([], [], sensitiveFindings);
    const { decision } = decidePolicy(ctx, dlp);
    expect(decision.kind).toBe('allow');
    expect(decision.reasons).toEqual(['no findings']);
  });

  it('SD2A: health sensitiveFindings do not change kind from allow when legacy findings are empty', () => {
    const sensitiveFindings = scanSensitiveData(
      'CID-10 E11.9 prontuário nº 9999 receita médica 500 mg exame glicemia 110 mg/dL',
      { source_surface: 'govai_runs' },
    );
    expect(sensitiveFindings.some((f) => f.detector === 'cid10_code_candidate')).toBe(true);
    expect(sensitiveFindings.some((f) => f.detector === 'medical_record_identifier_candidate')).toBe(
      true,
    );
    const dlp = buildDlp([], [], sensitiveFindings);
    const { decision } = decidePolicy(ctx, dlp);
    expect(decision.kind).toBe('allow');
    expect(decision.reasons).toEqual(['no findings']);
  });

  it('SD2A: financial/health recommended_action="review" never raises highestAction', () => {
    const sensitiveFindings = scanSensitiveData(
      'card 4111111111111111 CID-10 E11.9',
      { source_surface: 'govai_runs' },
    );
    // Construct a DLP result whose legacy state is detect — the rich review
    // findings must not promote highestAction or kind beyond that.
    const dlp = buildDlp([], [], sensitiveFindings);
    expect(dlp.highestAction).toBe('detect');
    const { decision } = decidePolicy(ctx, dlp);
    expect(decision.kind).toBe('allow');
  });

  it('SD2A: financial/health raw fixtures never appear in policy reasons', () => {
    const sensitiveFindings = scanSensitiveData(
      'card 4111111111111111 CID-10 E11.9 prontuário nº 9999',
      { source_surface: 'govai_runs' },
    );
    const dlp = buildDlp(
      [{ detector: 'cpf', match: '111.444.777-35', index: 0, length: 14 }],
      [{ detector: 'cpf', action: 'redact' }],
      sensitiveFindings,
    );
    const { decision } = decidePolicy(ctx, dlp);
    const ser = JSON.stringify(decision.reasons);
    for (const banned of ['4111111111111111', 'E11.9', '9999']) {
      expect(ser).not.toContain(banned);
    }
  });
});

// P0.1 P2-fix (Codex, PR #118) — a reason reporta a ação EFETIVA do span,
// não a ação configurada do detector do rótulo vencedor. O análogo, na camada
// de REPORTING, do teste de enforcement em dlp.test.ts ("preserva um deny
// configurado num detector que PERDEU o rótulo do span").
describe('decidePolicy / reason reports the span EFFECTIVE action', () => {
  it('span fundido cpf(detect)+phone_br(deny) → kind=deny e a reason reporta deny (a efetiva), não detect', () => {
    const text = 'meu cpf 11144477735 ok';
    const dlp = buildDlp(detectAllBaseline(text), [
      { detector: 'cpf', action: 'detect' },
      { detector: 'phone_br', action: 'deny' },
    ]);
    expect(dlp.findings.length).toBe(1); // premissa: um span fundido, rótulo cpf
    expect(dlp.findings[0]!.detector).toBe('cpf');
    const { decision } = decidePolicy(ctx, dlp);
    expect(decision.kind).toBe('deny');
    expect(decision.reasons).toEqual(['dlp.cpf: action=deny match at index 8']);
  });

  it('span fundido cpf(detect)+phone_br(redact) → kind=mutate e a reason reporta redact, não detect', () => {
    const text = 'meu cpf 11144477735 ok';
    const dlp = buildDlp(detectAllBaseline(text), [
      { detector: 'cpf', action: 'detect' },
      { detector: 'phone_br', action: 'redact' },
    ]);
    const { decision, needsRedaction } = decidePolicy(ctx, dlp);
    expect(decision.kind).toBe('mutate');
    expect(needsRedaction).toBe(true);
    expect(decision.reasons).toEqual(['dlp.cpf: action=redact match at index 8']);
  });

  it('spans disjuntos com ações distintas: cada reason reporta a ação do PRÓPRIO span', () => {
    const text = 'a@b.com meio 111.444.777-35 fim';
    const dlp = buildDlp(detectAllBaseline(text), [
      { detector: 'email', action: 'deny' },
      { detector: 'cpf', action: 'detect' },
    ]);
    expect(dlp.findings.map((f) => [f.detector, f.action])).toEqual([
      ['email', 'deny'],
      ['cpf', 'detect'],
    ]);
    const { decision } = decidePolicy(ctx, dlp);
    expect(decision.kind).toBe('deny');
    // por-span: o span que negou reporta deny; o co-presente reporta a própria
    // ação (detect) — o registro nunca sobre- nem sub-afirma por span.
    expect(decision.reasons).toEqual([
      'dlp.email: action=deny match at index 0',
      'dlp.cpf: action=detect match at index 13',
    ]);
  });
});
