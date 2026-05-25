// Sensitive Data OS — court-case identifier detector (PR-SD1).
//
// CNJ numeração única (Resolução CNJ 65/2008): NNNNNNN-DD.YYYY.J.TR.OOOO.
//
// This detector matches the FORMAT and checks the mod-97 verification digits
// only. It does NOT claim:
//   - that the process number exists;
//   - that the process is real, valid, or active;
//   - that any content carries segredo de justiça;
//   - any legal meaning whatsoever.
//
// `recommended_action='warn'` is ADVISORY (SD1 contract — see
// `sensitive-findings.ts` and `sensitive-taxonomy.ts`). It does NOT alter
// `DlpScanResult.highestAction`, does NOT influence `decidePolicy`, and does
// NOT cause runtime blocking. Future SD/RT slices may consume it to route
// court-related items for qualified-counsel review; SD1 only emits the signal.
//
// SD1 does NOT implement segredo de justiça, attorney-client, or professional
// secrecy classifiers. Those are SD2/SD3/SD4.

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

export type CourtDetectorContext = {
  source_surface: SensitiveDataSourceSurface;
  origin?: SensitiveDataOrigin;
};

// Bounded, RE2-safe pattern. Anchored at word boundaries; no unbounded `.*`.
const CNJ_RE = new RE2(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g);

const CNJ_PARTS_RE =
  /^(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})$/;

/**
 * Mod-97 checksum per Resolução CNJ 65/2008, art. 4 §2 II:
 *   DV = 98 − ((NNNNNNN·10^14 + YYYY·10^9 + J·10^8 + TR·10^6 + OOOO)·100 mod 97)
 * BigInt because the dividend is up to 20 decimal digits.
 */
export function isValidCnjChecksum(formatted: string): boolean {
  const m = CNJ_PARTS_RE.exec(formatted);
  if (!m) return false;
  const n = m[1] ?? '';
  const dd = m[2] ?? '';
  const yyyy = m[3] ?? '';
  const j = m[4] ?? '';
  const tr = m[5] ?? '';
  const oooo = m[6] ?? '';
  // Compose the integer per the CNJ formula and apply mod-97 with a 100
  // multiplier to leave room for the two-digit verification slot.
  const seq = BigInt(n + yyyy + j + tr + oooo);
  const dv = 98n - ((seq * 100n) % 97n);
  return Number(dv) === Number(dd);
}

const CNJ_REVIEW_FLAGS = {
  ...NO_REVIEW_FLAGS,
  professional_review_recommended: true,
  // Surface a legal-review HINT only — SD1 does not classify segredo de justiça
  // or attorney-client privilege, so this flag is preparation for SD2/SD3 and
  // for routing in human-review surfaces, not a legal determination.
  legal_review_recommended: true,
};

/**
 * Detect CNJ-format court case numbers in `text`. A match must satisfy BOTH
 * the format and the mod-97 verification digits to be reported.
 */
export function detectCnjCaseNumbers(
  text: string,
  context: CourtDetectorContext,
): SensitiveDataFinding[] {
  const out: SensitiveDataFinding[] = [];
  let m: RegExpExecArray | null;
  while ((m = CNJ_RE.exec(text)) !== null) {
    const matchStr = m[0];
    const index = m.index;
    if (CNJ_RE.lastIndex === index) CNJ_RE.lastIndex++;
    if (!isValidCnjChecksum(matchStr)) continue;
    out.push({
      detector: 'cnj_case_number',
      detector_family: 'court',
      category: 'court_case_identifier',
      index,
      length: matchStr.length,
      match_hash: matchHash('cnj_case_number', matchStr),
      match_preview_redacted: redactPreview('cnj_case_number'),
      confidence: 0.95,
      confidence_band: confidenceBandForScore(0.95),
      rationale_code: 'cnj_format_and_checksum',
      recommended_action: 'warn',
      origin: context.origin ?? 'govai_native',
      source_surface: context.source_surface,
      source_quality: 'primary_govai_evidence',
      redaction_hint: 'mask:cnj_case_number',
      ...CNJ_REVIEW_FLAGS,
    });
  }
  CNJ_RE.lastIndex = 0;
  return out;
}

export const COURT_DETECTOR_NAMES: ReadonlyArray<string> = ['cnj_case_number'];
