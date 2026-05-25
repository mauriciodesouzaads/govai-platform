import { describe, it, expect } from 'vitest';
import {
  FINANCIAL_DETECTOR_NAMES,
  detectFinancialData,
  isValidIbanMod97,
  isValidLuhn,
} from './financial-detectors.js';

const ctx = { source_surface: 'govai_runs' as const };

function detectorsOf(text: string): string[] {
  return detectFinancialData(text, ctx).map((f) => f.detector);
}

// All credit-card-shaped strings used here are widely-published deterministic
// synthetic test PANs (e.g. 4111…1111 is a Visa test PAN; 5555…4444 is a
// MasterCard test PAN). They are NOT real card data. They live only inside
// this test file and exist solely to exercise the Luhn filter.
const VISA_TEST_PAN = '4111111111111111';
const MASTERCARD_TEST_PAN = '5555555555554444';
const AMEX_TEST_PAN = '378282246310005';
const NON_LUHN_PAN = '4111111111111112';

// Canonical IBAN examples from ISO 13616 reference material. mod-97-valid by
// construction; not real account identifiers.
const IBAN_GB = 'GB82WEST12345698765432';
const IBAN_DE = 'DE89370400440532013000';
const IBAN_INVALID = 'GB82WEST12345698765433';

describe('isValidLuhn', () => {
  it('accepts well-known valid PANs', () => {
    expect(isValidLuhn(VISA_TEST_PAN)).toBe(true);
    expect(isValidLuhn(MASTERCARD_TEST_PAN)).toBe(true);
    expect(isValidLuhn(AMEX_TEST_PAN)).toBe(true);
  });

  it('rejects an off-by-one variant', () => {
    expect(isValidLuhn(NON_LUHN_PAN)).toBe(false);
  });

  it('rejects strings outside the 13–19 digit range', () => {
    expect(isValidLuhn('123456789012')).toBe(false);
    expect(isValidLuhn('12345678901234567890')).toBe(false);
    expect(isValidLuhn('')).toBe(false);
  });

  it('rejects non-digit content', () => {
    expect(isValidLuhn('4111-1111-1111-1111')).toBe(false);
  });
});

describe('detectFinancialData / payment_card_luhn_candidate', () => {
  it('detects an unformatted Luhn-valid PAN', () => {
    const out = detectFinancialData(`saldo total ${VISA_TEST_PAN} processado`, ctx);
    const cards = out.filter((f) => f.detector === 'payment_card_luhn_candidate');
    expect(cards).toHaveLength(1);
    const c = cards[0]!;
    expect(c.category).toBe('financial_data');
    expect(c.detector_family).toBe('financial');
    expect(c.rationale_code).toBe('luhn_checksum_match');
    expect(c.recommended_action).toBe('review');
    expect(c.dpo_review_recommended).toBe(true);
    expect(c.sector_specialist_review_recommended).toBe(true);
    expect(c.legal_review_recommended).toBe(false);
    expect(c.security_review_recommended).toBe(false);
    expect(c.match_preview_redacted).toBe('[REDACTED:payment_card_luhn_candidate]');
    expect(c.match_hash).toMatch(/^[0-9a-f]{64}$/);
    // The rich finding shape never carries the raw PAN.
    expect(c).not.toHaveProperty('match');
    expect(JSON.stringify(c)).not.toContain(VISA_TEST_PAN);
  });

  it('detects formatted PANs with spaces or hyphens and hashes the normalized digit form', () => {
    const spaced = detectFinancialData(`card: 4111 1111 1111 1111 end`, ctx);
    const hyphenated = detectFinancialData(`card: 4111-1111-1111-1111 end`, ctx);
    expect(spaced.filter((f) => f.detector === 'payment_card_luhn_candidate')).toHaveLength(1);
    expect(hyphenated.filter((f) => f.detector === 'payment_card_luhn_candidate')).toHaveLength(1);
    const spacedHash = spaced.find((f) => f.detector === 'payment_card_luhn_candidate')!.match_hash;
    const hyphenHash = hyphenated.find((f) => f.detector === 'payment_card_luhn_candidate')!
      .match_hash;
    // Normalized digit form is the same regardless of separator, so the hash matches.
    expect(spacedHash).toBe(hyphenHash);
  });

  it('rejects an off-by-one PAN (Luhn-invalid)', () => {
    expect(detectorsOf(`fake card ${NON_LUHN_PAN} here`)).not.toContain(
      'payment_card_luhn_candidate',
    );
  });

  it('does not match inside a longer continuous digit run', () => {
    // Surround the PAN with extra digits — the candidate should be rejected
    // because it would be a substring of a longer digit run, not a card.
    expect(detectorsOf(`prefix99${VISA_TEST_PAN}99suffix`)).not.toContain(
      'payment_card_luhn_candidate',
    );
  });

  it('rejects strings shorter than 13 digits or longer than 19', () => {
    expect(detectorsOf('only 12 digits: 411111111111 here')).not.toContain(
      'payment_card_luhn_candidate',
    );
    expect(detectorsOf('20 digits: 41111111111111111111 here')).not.toContain(
      'payment_card_luhn_candidate',
    );
  });
});

describe('isValidIbanMod97', () => {
  it('accepts canonical reference IBANs', () => {
    expect(isValidIbanMod97(IBAN_GB)).toBe(true);
    expect(isValidIbanMod97(IBAN_DE)).toBe(true);
  });

  it('rejects an off-by-one variant', () => {
    expect(isValidIbanMod97(IBAN_INVALID)).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isValidIbanMod97('NOT_AN_IBAN')).toBe(false);
    expect(isValidIbanMod97('GB82')).toBe(false);
    expect(isValidIbanMod97('')).toBe(false);
  });
});

describe('detectFinancialData / iban_candidate', () => {
  it('detects a canonical IBAN with grouped display formatting', () => {
    const grouped = 'IBAN: GB82 WEST 1234 5698 7654 32 ok';
    const out = detectFinancialData(grouped, ctx);
    const ibans = out.filter((f) => f.detector === 'iban_candidate');
    expect(ibans).toHaveLength(1);
    const i = ibans[0]!;
    expect(i.rationale_code).toBe('iban_mod97_validated');
    expect(i.recommended_action).toBe('review');
    expect(i.match_preview_redacted).toBe('[REDACTED:iban_candidate]');
    expect(i.match_hash).toMatch(/^[0-9a-f]{64}$/);
    // No claim of account existence — only the validated format signal lives
    // on the finding; the raw IBAN never appears.
    expect(JSON.stringify(i)).not.toContain('GB82WEST12345698765432');
    expect(JSON.stringify(i)).not.toContain('WEST');
  });

  it('detects the canonical DE reference IBAN unformatted', () => {
    const out = detectFinancialData(`crédito ${IBAN_DE}`, ctx);
    expect(out.filter((f) => f.detector === 'iban_candidate')).toHaveLength(1);
  });

  it('rejects a checksum-invalid IBAN-shaped string', () => {
    expect(detectorsOf(`fake ${IBAN_INVALID} here`)).not.toContain('iban_candidate');
  });

  it('does not fire on random BR-looking text without a valid IBAN', () => {
    expect(detectorsOf('a conta corrente é importante para nosso negócio')).not.toContain(
      'iban_candidate',
    );
  });

  // Codex SD2A P2: with the old permissive `[ A-Z0-9]{10,38}` body, an IBAN
  // followed by uppercase prose was absorbed into a longer string that then
  // failed mod-97 and was silently dropped (false negative). The
  // unformatted + grouped split pins exactly one detection on each shape and
  // never trails into the prose.
  it('detects exactly one iban_candidate for a grouped IBAN followed by uppercase prose', () => {
    const t = 'IBAN GB82 WEST 1234 5698 7654 32 PARA PAGAMENTO';
    const out = detectFinancialData(t, ctx);
    const ibans = out.filter((f) => f.detector === 'iban_candidate');
    expect(ibans).toHaveLength(1);
    const ser = JSON.stringify(ibans[0]);
    // The match span does not absorb the trailing words.
    expect(ser).not.toContain('PARA');
    expect(ser).not.toContain('PAGAMENTO');
    expect(ser).not.toContain('GB82WEST12345698765432');
  });

  it('detects exactly one iban_candidate for an unformatted IBAN followed by uppercase prose', () => {
    const t = 'IBAN GB82WEST12345698765432 PARA PAGAMENTO';
    const out = detectFinancialData(t, ctx);
    const ibans = out.filter((f) => f.detector === 'iban_candidate');
    expect(ibans).toHaveLength(1);
    const ser = JSON.stringify(ibans[0]);
    expect(ser).not.toContain('PARA');
    expect(ser).not.toContain('PAGAMENTO');
    expect(ser).not.toContain('GB82WEST12345698765432');
  });

  it('does not fire on an invalid-checksum IBAN-shaped string followed by uppercase prose', () => {
    expect(detectorsOf(`IBAN ${IBAN_INVALID} PARA PAGAMENTO`)).not.toContain('iban_candidate');
  });

  it('does not fire on uppercase prose without an IBAN', () => {
    expect(detectorsOf('TRANSFERENCIA RECEBIDA PARA PAGAMENTO DA FATURA')).not.toContain(
      'iban_candidate',
    );
  });

  it('does not fire when the IBAN is embedded inside a larger alphanumeric token', () => {
    // No spaces or punctuation separating the IBAN from trailing alnum: the
    // greedy unformatted body absorbs extra chars and the post-filter drops
    // the candidate because mod-97 fails on the longer string.
    expect(detectorsOf(`XX${IBAN_GB}PARAPAGAMENTO`)).not.toContain('iban_candidate');
  });
});

describe('detectFinancialData / br_boleto_linha_digitavel_candidate', () => {
  // Plausible 47-digit linha digitável shape grouped by spaces. SD2A does NOT
  // implement módulo 10/11 validation — this is a CONTEXT candidate only.
  // 47 digits total: 5+5 + 5+6 + 5+6 + 1 + 14 = 47.
  const FORMATTED_47 = '34191.79001 01043.510047 91020.150008 4 84410026000000';
  const RAW_44 = '34191790010104351004791020150008484410026000'; // 44 digits — too short
  const RAW_VALID_47 = '34191790010104351004791020150008484410026000123'; // 47 digits

  it('fires only when an explicit boleto/linha digitável/pagamento context is present', () => {
    const withCtx = detectFinancialData(`boleto: ${FORMATTED_47} segue`, ctx);
    expect(withCtx.filter((f) => f.detector === 'br_boleto_linha_digitavel_candidate'))
      .toHaveLength(1);
    const f = withCtx.find((x) => x.detector === 'br_boleto_linha_digitavel_candidate')!;
    expect(f.rationale_code).toBe('boleto_context_format_candidate');
    expect(f.confidence_band).toBe('medium');
    expect(f.recommended_action).toBe('review');
    // No "validated" anywhere in the rationale.
    expect(f.rationale_code).not.toMatch(/validated/i);
  });

  it('does not fire on a long digit string without context', () => {
    expect(detectorsOf(RAW_VALID_47)).not.toContain('br_boleto_linha_digitavel_candidate');
  });

  it('does not fire on a near-miss length even with context', () => {
    expect(detectorsOf(`boleto ${RAW_44} curto`)).not.toContain(
      'br_boleto_linha_digitavel_candidate',
    );
  });

  it('accepts the unformatted 47-digit form with context', () => {
    const out = detectFinancialData(`pagamento ${RAW_VALID_47}`, ctx);
    expect(out.filter((f) => f.detector === 'br_boleto_linha_digitavel_candidate'))
      .toHaveLength(1);
  });
});

describe('detectFinancialData / br_bank_account_context_candidate', () => {
  it('fires when agency context AND account context appear in proximity', () => {
    const text = 'Banco XYZ — agência 1234-5, conta corrente 67890-1';
    const out = detectFinancialData(text, ctx);
    const accs = out.filter((f) => f.detector === 'br_bank_account_context_candidate');
    expect(accs).toHaveLength(1);
    const f = accs[0]!;
    expect(f.rationale_code).toBe('banking_context_pair');
    expect(f.recommended_action).toBe('review');
    expect(f.match_preview_redacted).toBe('[REDACTED:br_bank_account_context_candidate]');
    expect(f.match_hash).toMatch(/^[0-9a-f]{64}$/);
    // No raw account/agency numbers in the rich finding.
    expect(JSON.stringify(f)).not.toContain('1234-5');
    expect(JSON.stringify(f)).not.toContain('67890-1');
  });

  it('does not fire on agency context alone', () => {
    expect(detectorsOf('agência 1234-5')).not.toContain('br_bank_account_context_candidate');
  });

  it('does not fire on account context alone', () => {
    expect(detectorsOf('conta corrente 67890-1')).not.toContain(
      'br_bank_account_context_candidate',
    );
  });

  it('does not fire on the generic word "conta" without an account number', () => {
    expect(detectorsOf('por conta de meu cliente, a agência local foi notificada')).not.toContain(
      'br_bank_account_context_candidate',
    );
  });
});

describe('detectFinancialData / safety + invariants', () => {
  it('exposes the documented SD2A financial detector list', () => {
    expect([...FINANCIAL_DETECTOR_NAMES].sort()).toEqual(
      [
        'payment_card_luhn_candidate',
        'iban_candidate',
        'br_boleto_linha_digitavel_candidate',
        'br_bank_account_context_candidate',
      ].sort(),
    );
  });

  it('every finding carries match_hash and redacted preview, never plaintext', () => {
    const text = [
      `card: ${VISA_TEST_PAN}`,
      `IBAN ${IBAN_GB}`,
      'boleto: 34191.79001 01043.510047 91020.150008 4 84410026000000',
      'agência 1234-5 conta corrente 67890-1',
    ].join('\n');
    const findings = detectFinancialData(text, ctx);
    expect(findings.length).toBeGreaterThanOrEqual(4);
    for (const f of findings) {
      expect(f.match_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(f.match_preview_redacted).toBe(`[REDACTED:${f.detector}]`);
      expect(f).not.toHaveProperty('match');
      // Advisory boundary: every finding is at or below `review`.
      expect(['observe', 'warn', 'review']).toContain(f.recommended_action);
    }
    const ser = JSON.stringify(findings);
    expect(ser).not.toContain(VISA_TEST_PAN);
    expect(ser).not.toContain(IBAN_GB);
  });

  it('does not include any financial-advice / account-existence claim in the finding payload', () => {
    const text = `IBAN ${IBAN_GB} e card ${VISA_TEST_PAN}`;
    const findings = detectFinancialData(text, ctx);
    const ser = JSON.stringify(findings).toLowerCase();
    for (const banned of [
      'investment',
      'recommend invest',
      'creditworthy',
      'suitability',
      'aml conclusion',
      'compliance certified',
      'bacen approved',
      'cvm approved',
      'susep approved',
      'pci certified',
      'account confirmed',
      'payment confirmed',
      'real account',
    ]) {
      expect(ser).not.toContain(banned);
    }
  });

  it('regex safety: long pathological input does not hang', () => {
    const t = 'a'.repeat(120_000) + ' ' + VISA_TEST_PAN + ' end';
    const start = Date.now();
    const out = detectFinancialData(t, ctx);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(out.some((f) => f.detector === 'payment_card_luhn_candidate')).toBe(true);
  });
});
