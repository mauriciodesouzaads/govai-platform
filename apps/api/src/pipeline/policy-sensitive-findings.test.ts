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
import { scanSensitiveData, type DetectorFinding, type SensitiveDataFinding } from '@govai/dlp-br';
import { decidePolicy } from './policy.js';
import type { DlpScanResult } from './dlp.js';

const ctx = {
  capabilityId: 'anthropic.messages.create',
  effectiveLevel: 1 as const,
  policyCommitSha: '0000000000000000000000000000000000000000',
};

function buildDlp(
  findings: DetectorFinding[],
  config: Array<{ detector: string; action: 'detect' | 'redact' | 'deny' }>,
  sensitiveFindings?: SensitiveDataFinding[],
): DlpScanResult {
  const configByDetector = new Map<string, 'detect' | 'redact' | 'deny'>();
  for (const c of config) configByDetector.set(c.detector, c.action);
  let highestAction: 'detect' | 'redact' | 'deny' = 'detect';
  const rank = { detect: 0, redact: 1, deny: 2 } as const;
  for (const f of findings) {
    const a = configByDetector.get(f.detector) ?? 'detect';
    if (rank[a] > rank[highestAction]) highestAction = a;
  }
  return {
    findings,
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
});
