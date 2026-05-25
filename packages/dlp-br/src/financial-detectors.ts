// Sensitive Data OS — financial detector foundation (PR-SD2A).
//
// SD2A adds conservative native detectors for the `financial_data` category.
// These are SIGNAL detectors only — they identify candidate
// payment-card-like / IBAN / boleto / Brazilian bank-account patterns and
// emit them as rich `SensitiveDataFinding` records carrying only a
// `match_hash` and a `match_preview_redacted`. No raw plaintext is retained
// on the rich record.
//
// SD2A explicitly does NOT:
//   - implement a full financial classifier;
//   - prove that a card / IBAN / boleto / account belongs to any real
//     customer or that any payment actually occurred;
//   - provide financial advice;
//   - provide investment advice or suitability classification;
//   - drive credit decisioning or AML conclusions;
//   - claim Bacen / CVM / SUSEP / PCI / ISO certification or compliance.
//
// `recommended_action='review'` is ADVISORY (SD1 contract — see
// `sensitive-findings.ts` and `sensitive-taxonomy.ts`). It does NOT alter
// `DlpScanResult.highestAction`, does NOT influence `decidePolicy`, and
// does NOT cause runtime blocking. Routing this signal into real
// enforcement is later-SD/RT work.

import RE2 from 're2';
import {
  confidenceBandForScore,
  matchHash,
  redactPreview,
  type SensitiveDataFinding,
} from './sensitive-findings.js';
import {
  type SensitiveDataOrigin,
  type SensitiveDataSourceSurface,
} from './sensitive-provenance.js';
import { NO_REVIEW_FLAGS } from './sensitive-taxonomy.js';

export type FinancialDetectorContext = {
  source_surface: SensitiveDataSourceSurface;
  origin?: SensitiveDataOrigin;
};

// Financial findings are routed primarily to DPO + sector specialist for
// LGPD + financial-sector review; security and legal review are not
// implicitly recommended by SD2A.
const FINANCIAL_REVIEW_FLAGS = {
  ...NO_REVIEW_FLAGS,
  dpo_review_recommended: true,
  sector_specialist_review_recommended: true,
};

// ---------------------------------------------------------------------------
// Helper utilities.
// ---------------------------------------------------------------------------

/**
 * True when the substring [idx, idx+len) in `text` is not flanked by another
 * digit. RE2 has no negative lookbehind, so this is the in-code replacement
 * for "do not match inside a longer digit run."
 */
function isBoundedByNonDigit(text: string, idx: number, len: number): boolean {
  const before = idx > 0 ? text.charAt(idx - 1) : '';
  const after = idx + len < text.length ? text.charAt(idx + len) : '';
  if (before && before >= '0' && before <= '9') return false;
  if (after && after >= '0' && after <= '9') return false;
  return true;
}

/**
 * True when the substring [idx, idx+len) is not flanked by another alphanumeric
 * character. Used for IBAN to avoid matching inside larger alphanumeric runs.
 */
function isBoundedByNonAlnum(text: string, idx: number, len: number): boolean {
  const isAlnum = (ch: string): boolean =>
    (ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
  const before = idx > 0 ? text.charAt(idx - 1) : '';
  const after = idx + len < text.length ? text.charAt(idx + len) : '';
  if (before && isAlnum(before)) return false;
  if (after && isAlnum(after)) return false;
  return true;
}

function findAll(re: RE2, text: string): Array<{ match: string; index: number }> {
  const out: Array<{ match: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ match: m[0], index: m.index });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  re.lastIndex = 0;
  return out;
}

// ---------------------------------------------------------------------------
// 1. payment_card_luhn_candidate.
// ---------------------------------------------------------------------------

// Match candidate digit runs with optional space/hyphen separators. Length is
// post-filtered against the 13–19 digit range and Luhn validity; the regex
// itself is intentionally permissive so the post-filter does the precision
// work.
const CARD_CANDIDATE_RE = new RE2(/\b\d(?:[\d \-]{11,37}\d)?\b/g);

/**
 * Luhn (mod 10) checksum. Returns true when `digits` (all-digit string of
 * length 13–19) is Luhn-valid. SD2A uses this strictly as a SHAPE filter; it
 * does not imply card validity, issuer existence, or any payment.
 */
export function isValidLuhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function detectPaymentCardLuhn(
  text: string,
  context: FinancialDetectorContext,
): SensitiveDataFinding[] {
  const out: SensitiveDataFinding[] = [];
  for (const m of findAll(CARD_CANDIDATE_RE, text)) {
    if (!isBoundedByNonDigit(text, m.index, m.match.length)) continue;
    const digits = m.match.replace(/[\s-]/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    if (!isValidLuhn(digits)) continue;
    out.push({
      detector: 'payment_card_luhn_candidate',
      detector_family: 'financial',
      category: 'financial_data',
      index: m.index,
      length: m.match.length,
      // The hash is over the normalized digit-only form so the same card
      // expressed with different separators produces the same hash; this
      // gives downstream observers a stable identity without ever seeing the
      // raw value.
      match_hash: matchHash('payment_card_luhn_candidate', digits),
      match_preview_redacted: redactPreview('payment_card_luhn_candidate'),
      confidence: 0.9,
      confidence_band: confidenceBandForScore(0.9),
      rationale_code: 'luhn_checksum_match',
      recommended_action: 'review',
      origin: context.origin ?? 'govai_native',
      source_surface: context.source_surface,
      source_quality: 'primary_govai_evidence',
      redaction_hint: 'mask_full:payment_card_luhn_candidate',
      ...FINANCIAL_REVIEW_FLAGS,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. iban_candidate.
// ---------------------------------------------------------------------------

// IBAN: 2-letter country code + 2 check digits + 11–30 alphanumeric BBAN.
// Total normalized length is 15–34. The post-filter normalizes and runs
// mod-97. (Codex SD2A P2.) Two separate bounded patterns instead of one
// permissive `[ A-Z0-9]{…}` body:
//
//   - `IBAN_UNFORMATTED_RE` captures a single contiguous 15–34-char alnum
//     run, anchored by `\b` so it stops at any whitespace or punctuation
//     boundary. A valid IBAN followed by uppercase prose (e.g.
//     "GB82WEST12345698765432 PARA PAGAMENTO") matches the IBAN exactly
//     and never absorbs the trailing prose.
//
//   - `IBAN_GROUPED_RE` requires the display-grouping shape: 4-char
//     country+check followed by 1–7 groups of " " + exactly 4 alnum chars
//     and an optional final " " + 1–4 alnum chars. The 4-char group
//     constraint refuses to consume arbitrary words like "PARA"+"PAGAMENTO"
//     because the second group there isn't exactly 4 alnum (it would be
//     "PAGA" but then "MENTO" still leaks). In practice the regex stops at
//     the IBAN's natural grouping boundary; the post-filter then verifies
//     mod-97. This is the SD2A fix for a true-positive being silently
//     dropped when an IBAN appears inside uppercase prose.
const IBAN_UNFORMATTED_RE = new RE2(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g);
const IBAN_GROUPED_RE = new RE2(
  /\b[A-Z]{2}\d{2}(?: [A-Z0-9]{4}){1,7}(?: [A-Z0-9]{1,4})?\b/g,
);

/**
 * IBAN mod-97 validation (ISO 13616). Move the first four characters to the
 * end, convert letters to two-digit numbers (A=10..Z=35), and the resulting
 * integer must be ≡ 1 (mod 97). SD2A uses this strictly as a SHAPE filter; it
 * does not imply the IBAN was issued, that any account exists, or that any
 * payment occurred.
 */
export function isValidIbanMod97(normalized: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(normalized)) return false;
  if (normalized.length < 15 || normalized.length > 34) return false;
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    let digit: number;
    if (ch >= '0' && ch <= '9') digit = ch.charCodeAt(0) - 48;
    else digit = ch.charCodeAt(0) - 55; // A=10, B=11, ...
    // Process digit pairs to keep the running remainder bounded.
    if (digit >= 10) {
      rem = (rem * 100 + digit) % 97;
    } else {
      rem = (rem * 10 + digit) % 97;
    }
  }
  return rem === 1;
}

function detectIban(
  text: string,
  context: FinancialDetectorContext,
): SensitiveDataFinding[] {
  const out: SensitiveDataFinding[] = [];
  // Deduplicate by (index, normalized) so that a candidate matched by both
  // the unformatted and grouped patterns is emitted only once. In practice
  // the two patterns are disjoint because grouped requires a space and
  // unformatted is contiguous, but the guard keeps the result stable if
  // future tweaks soften that boundary.
  const seen = new Set<string>();
  const candidates = [...findAll(IBAN_UNFORMATTED_RE, text), ...findAll(IBAN_GROUPED_RE, text)];
  for (const m of candidates) {
    if (!isBoundedByNonAlnum(text, m.index, m.match.length)) continue;
    const normalized = m.match.replace(/\s+/g, '').toUpperCase();
    if (!isValidIbanMod97(normalized)) continue;
    const key = `${m.index}:${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      detector: 'iban_candidate',
      detector_family: 'financial',
      category: 'financial_data',
      index: m.index,
      length: m.match.length,
      match_hash: matchHash('iban_candidate', normalized),
      match_preview_redacted: redactPreview('iban_candidate'),
      confidence: 0.9,
      confidence_band: confidenceBandForScore(0.9),
      rationale_code: 'iban_mod97_validated',
      recommended_action: 'review',
      origin: context.origin ?? 'govai_native',
      source_surface: context.source_surface,
      source_quality: 'primary_govai_evidence',
      redaction_hint: 'mask_full:iban_candidate',
      ...FINANCIAL_REVIEW_FLAGS,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. br_boleto_linha_digitavel_candidate.
// ---------------------------------------------------------------------------

// SD2A intentionally does NOT implement boleto módulo 10/11 checksum. Boleto
// findings are CONTEXT candidates only — they require an explicit nearby
// term (boleto / linha digitável / pagamento) plus a plausible 47/48-digit
// linha-digitável shape. We do not claim "validated" anywhere.
const BOLETO_CONTEXT_RE = new RE2(
  /\b(?:boleto|linha\s+digit[áa]vel|pagamento)\b/gi,
);

// Common formatted linha-digitável shape: 5.5 5.6 5.6 1 14 (grouped via
// dots/spaces). We also accept a raw 47–48 digit run as long as it is bounded
// by non-digits AND is within context proximity. RE2-safe bounded repetition.
const BOLETO_FORMATTED_RE = new RE2(
  /\b\d{5}\.?\d{5}\s\d{5}\.?\d{6}\s\d{5}\.?\d{6}\s\d\s\d{14}\b/g,
);
const BOLETO_RAW_RE = new RE2(/\b\d{47,48}\b/g);

const BOLETO_CONTEXT_PROXIMITY = 120;

function hasNearbyContext(
  text: string,
  contextHits: ReadonlyArray<{ index: number; length: number }>,
  spanStart: number,
  spanEnd: number,
  maxDistance: number,
): boolean {
  for (const c of contextHits) {
    const cStart = c.index;
    const cEnd = c.index + c.length;
    // Distance between the two spans on the text line. 0 if they overlap.
    const distance = cEnd <= spanStart ? spanStart - cEnd : cStart >= spanEnd ? cStart - spanEnd : 0;
    if (distance <= maxDistance) return true;
  }
  return false;
}

function detectBrBoleto(
  text: string,
  context: FinancialDetectorContext,
): SensitiveDataFinding[] {
  const contextHits = findAll(BOLETO_CONTEXT_RE, text).map((c) => ({
    index: c.index,
    length: c.match.length,
  }));
  if (contextHits.length === 0) return [];
  const out: SensitiveDataFinding[] = [];
  for (const m of [...findAll(BOLETO_FORMATTED_RE, text), ...findAll(BOLETO_RAW_RE, text)]) {
    if (!isBoundedByNonDigit(text, m.index, m.match.length)) continue;
    const digits = m.match.replace(/\D+/g, '');
    if (digits.length !== 47 && digits.length !== 48) continue;
    if (
      !hasNearbyContext(
        text,
        contextHits,
        m.index,
        m.index + m.match.length,
        BOLETO_CONTEXT_PROXIMITY,
      )
    ) {
      continue;
    }
    out.push({
      detector: 'br_boleto_linha_digitavel_candidate',
      detector_family: 'financial',
      category: 'financial_data',
      index: m.index,
      length: m.match.length,
      match_hash: matchHash('br_boleto_linha_digitavel_candidate', digits),
      match_preview_redacted: redactPreview('br_boleto_linha_digitavel_candidate'),
      confidence: 0.7,
      confidence_band: confidenceBandForScore(0.7),
      // Explicit "_candidate" rationale — SD2A does not validate the boleto
      // checksum, does not claim a payment occurred, and does not assert any
      // debt relationship.
      rationale_code: 'boleto_context_format_candidate',
      recommended_action: 'review',
      origin: context.origin ?? 'govai_native',
      source_surface: context.source_surface,
      source_quality: 'primary_govai_evidence',
      redaction_hint: 'mask:br_boleto_linha_digitavel_candidate',
      ...FINANCIAL_REVIEW_FLAGS,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. br_bank_account_context_candidate.
// ---------------------------------------------------------------------------

// We require BOTH agency-context AND account-context (Brazilian conventions:
// agência/agencia/ag. and conta/cc/conta corrente) within close proximity.
// SD2A does NOT emit on standalone numbers or the word "conta" alone.
const AGENCY_CONTEXT_RE = new RE2(
  /\b(?:ag[êe]ncia|ag\.)\s*:?\s*\d{1,6}(?:-\d)?\b/gi,
);
const ACCOUNT_CONTEXT_RE = new RE2(
  /\b(?:conta(?:\s+corrente)?|c\.?c\.?)\s*:?\s*\d{2,10}(?:-\d)?\b/gi,
);

const BANK_ACCOUNT_PROXIMITY = 80;

function detectBrBankAccountContext(
  text: string,
  context: FinancialDetectorContext,
): SensitiveDataFinding[] {
  const agencyHits = findAll(AGENCY_CONTEXT_RE, text);
  if (agencyHits.length === 0) return [];
  const accountHits = findAll(ACCOUNT_CONTEXT_RE, text);
  if (accountHits.length === 0) return [];

  const out: SensitiveDataFinding[] = [];
  const used = new Set<string>();
  for (const ag of agencyHits) {
    for (const acc of accountHits) {
      const agEnd = ag.index + ag.match.length;
      const accStart = acc.index;
      const accEnd = acc.index + acc.match.length;
      const overlaps = !(agEnd <= accStart || accEnd <= ag.index);
      const distance = overlaps
        ? 0
        : accStart >= agEnd
          ? accStart - agEnd
          : ag.index - accEnd;
      if (distance > BANK_ACCOUNT_PROXIMITY) continue;
      // Define the span as the smallest contiguous window covering both
      // context+identifier matches.
      const spanStart = Math.min(ag.index, acc.index);
      const spanEnd = Math.max(agEnd, accEnd);
      const key = `${spanStart}:${spanEnd}`;
      if (used.has(key)) continue;
      used.add(key);
      const composite = `${ag.match}|${acc.match}`;
      out.push({
        detector: 'br_bank_account_context_candidate',
        detector_family: 'financial',
        category: 'financial_data',
        index: spanStart,
        length: spanEnd - spanStart,
        match_hash: matchHash('br_bank_account_context_candidate', composite),
        match_preview_redacted: redactPreview('br_bank_account_context_candidate'),
        confidence: 0.7,
        confidence_band: confidenceBandForScore(0.7),
        rationale_code: 'banking_context_pair',
        recommended_action: 'review',
        origin: context.origin ?? 'govai_native',
        source_surface: context.source_surface,
        source_quality: 'primary_govai_evidence',
        redaction_hint: 'mask:br_bank_account_context_candidate',
        ...FINANCIAL_REVIEW_FLAGS,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public detector entry point.
// ---------------------------------------------------------------------------

/**
 * Run every SD2A financial detector against `text` and return rich findings.
 * Raw matches never leave a detector; each finding carries only a
 * `match_hash` and a `[REDACTED:<detector>]` preview.
 */
export function detectFinancialData(
  text: string,
  context: FinancialDetectorContext,
): SensitiveDataFinding[] {
  return [
    ...detectPaymentCardLuhn(text, context),
    ...detectIban(text, context),
    ...detectBrBoleto(text, context),
    ...detectBrBankAccountContext(text, context),
  ];
}

/** Stable list of SD2A financial detector tokens, for tests and docs. */
export const FINANCIAL_DETECTOR_NAMES: ReadonlyArray<string> = [
  'payment_card_luhn_candidate',
  'iban_candidate',
  'br_boleto_linha_digitavel_candidate',
  'br_bank_account_context_candidate',
];
