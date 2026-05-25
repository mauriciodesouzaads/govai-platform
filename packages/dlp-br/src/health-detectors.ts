// Sensitive Data OS — health detector foundation (PR-SD2A).
//
// SD2A adds conservative native detectors for the `health_data` category.
// These are SIGNAL detectors only — they identify candidate CID/ICD-style
// codes, medical-record identifiers, prescription contexts, and lab-result
// contexts, and emit them as rich `SensitiveDataFinding` records carrying
// only a `match_hash` and a `match_preview_redacted`. No raw plaintext is
// retained on the rich record.
//
// SD2A health detectors are STRICTLY non-clinical. They explicitly do NOT:
//   - infer, store, map, or imply what any health code clinically means;
//   - infer diagnosis, triage, prognosis, treatment, or prescription;
//   - provide medical advice, clinical decision support, or telemedicine;
//   - claim to be a medical device, health-record system, or health platform;
//   - interpret lab values as normal, abnormal, high, low, or dangerous;
//   - claim ANS / CFM / ANVISA / sector-medical certification or compliance;
//   - score patient risk.
//
// A CID-10 finding only records that a CID-style code appears in context. The
// disease, condition, or diagnosis the code might map to is OUT OF SCOPE for
// SD2A and must not be derived, stored, or transmitted by this module.
//
// `recommended_action='review'` is ADVISORY (SD1 contract — see
// `sensitive-findings.ts` and `sensitive-taxonomy.ts`). It does NOT alter
// `DlpScanResult.highestAction`, does NOT influence `decidePolicy`, and
// does NOT cause runtime blocking.

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

export type HealthDetectorContext = {
  source_surface: SensitiveDataSourceSurface;
  origin?: SensitiveDataOrigin;
};

// Health findings are routed to DPO + sector specialist (medical
// professional) + general professional review for triage. Legal review is
// NOT implicitly recommended by SD2A — SD2A does not classify privilege or
// professional-secrecy. Security review is also not implicitly recommended.
const HEALTH_REVIEW_FLAGS = {
  ...NO_REVIEW_FLAGS,
  professional_review_recommended: true,
  dpo_review_recommended: true,
  sector_specialist_review_recommended: true,
};

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

function distanceBetween(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  if (aEnd <= bStart) return bStart - aEnd;
  if (bEnd <= aStart) return aStart - bEnd;
  return 0;
}

// ---------------------------------------------------------------------------
// 1. cid10_code_candidate.
// ---------------------------------------------------------------------------

// A single combined pattern — RE2-safe, case-insensitive on the context label
// only — that requires the explicit CID/ICD context to appear immediately
// before a CID-shaped code. The pattern intentionally does NOT match a bare
// `E11.9` without "CID" / "ICD" / "CID-10" / "ICD-10" context, because that
// shape collides with too many non-medical strings.
//
// Code shape: letter (A–Z) + 2 digits + optional `.` + 1–2 more digits.
// We restrict the letter to uppercase A–Z; case-insensitivity on the body
// would let plain words like "ab12.3" match.
const CID10_CONTEXT_RE = new RE2(
  /\b(?:CID|ICD)(?:[- ]?10)?[\s:.#-]{1,10}([A-Z]\d{2}(?:\.\d{1,2})?)\b/g,
);

function detectCid10(
  text: string,
  context: HealthDetectorContext,
): SensitiveDataFinding[] {
  const out: SensitiveDataFinding[] = [];
  let m: RegExpExecArray | null;
  while ((m = CID10_CONTEXT_RE.exec(text)) !== null) {
    const full = m[0];
    const idx = m.index;
    if (CID10_CONTEXT_RE.lastIndex === idx) CID10_CONTEXT_RE.lastIndex++;
    const code = m[1] ?? '';
    out.push({
      detector: 'cid10_code_candidate',
      detector_family: 'health',
      category: 'health_data',
      index: idx,
      length: full.length,
      // Hash over the matched code only (still no clinical meaning attached).
      // The redacted preview never reveals the code itself.
      match_hash: matchHash('cid10_code_candidate', code),
      match_preview_redacted: redactPreview('cid10_code_candidate'),
      confidence: 0.9,
      confidence_band: confidenceBandForScore(0.9),
      // The rationale captures HOW the detector decided, not WHAT the code
      // clinically means. SD2A never derives clinical meaning from a code.
      rationale_code: 'cid10_context_format',
      recommended_action: 'review',
      origin: context.origin ?? 'govai_native',
      source_surface: context.source_surface,
      source_quality: 'primary_govai_evidence',
      redaction_hint: 'mask:cid10_code_candidate',
      ...HEALTH_REVIEW_FLAGS,
    });
  }
  CID10_CONTEXT_RE.lastIndex = 0;
  return out;
}

// ---------------------------------------------------------------------------
// 2. medical_record_identifier_candidate.
// ---------------------------------------------------------------------------

// Context terms specific to medical-record identifiers in Brazilian usage.
// Each pattern requires the context phrase to be immediately followed by an
// identifier candidate within a short bridge.
//
// `prontu[áa]rio` covers prontuário / prontuario; `registro\s+m[eé]dico`
// covers registro médico / registro medico; `ficha\s+cl[íi]nica` covers
// ficha clínica / ficha clinica. The optional `n[°º.]` / `n[úu]mero` /
// `nº` bridge accepts the conventional numbering prefix.
const MEDICAL_RECORD_CONTEXT_RE = new RE2(
  /\b(?:prontu[áa]rio|registro\s+m[eé]dico|ficha\s+cl[íi]nica)(?:\s+(?:n[°º.]|n[úu]mero|nº))?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,30})\b/gi,
);

function detectMedicalRecordIdentifier(
  text: string,
  context: HealthDetectorContext,
): SensitiveDataFinding[] {
  const out: SensitiveDataFinding[] = [];
  let m: RegExpExecArray | null;
  while ((m = MEDICAL_RECORD_CONTEXT_RE.exec(text)) !== null) {
    const full = m[0];
    const idx = m.index;
    if (MEDICAL_RECORD_CONTEXT_RE.lastIndex === idx) MEDICAL_RECORD_CONTEXT_RE.lastIndex++;
    const identifier = m[1] ?? '';
    // Reject identifiers that are pure letters — those are almost certainly
    // matching ordinary words. Real medical-record identifiers are mostly
    // numeric, sometimes alphanumeric.
    if (!/\d/.test(identifier)) continue;
    out.push({
      detector: 'medical_record_identifier_candidate',
      detector_family: 'health',
      category: 'health_data',
      index: idx,
      length: full.length,
      match_hash: matchHash('medical_record_identifier_candidate', identifier),
      match_preview_redacted: redactPreview('medical_record_identifier_candidate'),
      confidence: 0.8,
      confidence_band: confidenceBandForScore(0.8),
      rationale_code: 'medical_record_context_identifier',
      recommended_action: 'review',
      origin: context.origin ?? 'govai_native',
      source_surface: context.source_surface,
      source_quality: 'primary_govai_evidence',
      redaction_hint: 'mask:medical_record_identifier_candidate',
      ...HEALTH_REVIEW_FLAGS,
    });
  }
  MEDICAL_RECORD_CONTEXT_RE.lastIndex = 0;
  return out;
}

// ---------------------------------------------------------------------------
// 3. prescription_context_candidate.
// ---------------------------------------------------------------------------

const PRESCRIPTION_CONTEXT_RE = new RE2(
  /\b(?:prescri[cç][aã]o|receita\s+m[eé]dica|posologia|medicamento|tomar|uso\s+cont[ií]nuo)\b/gi,
);

// Dosage / pharmaceutical-form patterns. Bounded numeric value plus a unit
// from the allowlist. We do NOT classify or evaluate the value itself.
const DOSAGE_RE = new RE2(
  /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|mL|ml|UI|comprimidos?|c[áa]psulas?)\b/gi,
);

const PRESCRIPTION_PROXIMITY = 120;

function detectPrescriptionContext(
  text: string,
  context: HealthDetectorContext,
): SensitiveDataFinding[] {
  const contexts = findAll(PRESCRIPTION_CONTEXT_RE, text);
  if (contexts.length === 0) return [];
  const dosages = findAll(DOSAGE_RE, text);
  if (dosages.length === 0) return [];

  const out: SensitiveDataFinding[] = [];
  const used = new Set<string>();
  for (const ctx of contexts) {
    for (const dos of dosages) {
      const ctxEnd = ctx.index + ctx.match.length;
      const dosEnd = dos.index + dos.match.length;
      const d = distanceBetween(ctx.index, ctxEnd, dos.index, dosEnd);
      if (d > PRESCRIPTION_PROXIMITY) continue;
      const spanStart = Math.min(ctx.index, dos.index);
      const spanEnd = Math.max(ctxEnd, dosEnd);
      const key = `${spanStart}:${spanEnd}`;
      if (used.has(key)) continue;
      used.add(key);
      const composite = `${ctx.match}|${dos.match}`;
      out.push({
        detector: 'prescription_context_candidate',
        detector_family: 'health',
        category: 'health_data',
        index: spanStart,
        length: spanEnd - spanStart,
        match_hash: matchHash('prescription_context_candidate', composite),
        match_preview_redacted: redactPreview('prescription_context_candidate'),
        confidence: 0.7,
        confidence_band: confidenceBandForScore(0.7),
        rationale_code: 'prescription_context_dosage',
        recommended_action: 'review',
        origin: context.origin ?? 'govai_native',
        source_surface: context.source_surface,
        source_quality: 'primary_govai_evidence',
        redaction_hint: 'mask:prescription_context_candidate',
        ...HEALTH_REVIEW_FLAGS,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. lab_result_context_candidate.
// ---------------------------------------------------------------------------

const LAB_CONTEXT_RE = new RE2(
  /\b(?:exame|laborat[óo]rio|resultado|glicemia|hemoglobina|colesterol|creatinina|PCR)\b/gi,
);

// Bounded numeric value with a lab-style unit. We accept fractional values
// (e.g. 5.4 mg/dL). The detector never interprets whether the value is
// normal, abnormal, high, low, or clinically meaningful.
const LAB_VALUE_RE = new RE2(
  /\b\d+(?:[.,]\d+)?\s*(?:mg\/dL|g\/dL|mmol\/L|UI\/L|mg\/L|µmol\/L|ng\/mL|pg\/mL|mEq\/L)\b/g,
);

const LAB_PROXIMITY = 120;

function detectLabResultContext(
  text: string,
  context: HealthDetectorContext,
): SensitiveDataFinding[] {
  const contexts = findAll(LAB_CONTEXT_RE, text);
  if (contexts.length === 0) return [];
  const values = findAll(LAB_VALUE_RE, text);
  if (values.length === 0) return [];

  const out: SensitiveDataFinding[] = [];
  const used = new Set<string>();
  for (const ctx of contexts) {
    for (const v of values) {
      const ctxEnd = ctx.index + ctx.match.length;
      const vEnd = v.index + v.match.length;
      const d = distanceBetween(ctx.index, ctxEnd, v.index, vEnd);
      if (d > LAB_PROXIMITY) continue;
      const spanStart = Math.min(ctx.index, v.index);
      const spanEnd = Math.max(ctxEnd, vEnd);
      const key = `${spanStart}:${spanEnd}`;
      if (used.has(key)) continue;
      used.add(key);
      // Hash over the context+value composite — no clinical interpretation
      // is attached; the rich finding never claims whether the value is
      // normal or abnormal.
      const composite = `${ctx.match}|${v.match}`;
      out.push({
        detector: 'lab_result_context_candidate',
        detector_family: 'health',
        category: 'health_data',
        index: spanStart,
        length: spanEnd - spanStart,
        match_hash: matchHash('lab_result_context_candidate', composite),
        match_preview_redacted: redactPreview('lab_result_context_candidate'),
        confidence: 0.7,
        confidence_band: confidenceBandForScore(0.7),
        rationale_code: 'lab_result_context_value',
        recommended_action: 'review',
        origin: context.origin ?? 'govai_native',
        source_surface: context.source_surface,
        source_quality: 'primary_govai_evidence',
        redaction_hint: 'mask:lab_result_context_candidate',
        ...HEALTH_REVIEW_FLAGS,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public detector entry point.
// ---------------------------------------------------------------------------

/**
 * Run every SD2A health detector against `text` and return rich findings.
 * Raw matches never leave a detector; each finding carries only a
 * `match_hash` and a `[REDACTED:<detector>]` preview.
 */
export function detectHealthData(
  text: string,
  context: HealthDetectorContext,
): SensitiveDataFinding[] {
  return [
    ...detectCid10(text, context),
    ...detectMedicalRecordIdentifier(text, context),
    ...detectPrescriptionContext(text, context),
    ...detectLabResultContext(text, context),
  ];
}

/** Stable list of SD2A health detector tokens, for tests and docs. */
export const HEALTH_DETECTOR_NAMES: ReadonlyArray<string> = [
  'cid10_code_candidate',
  'medical_record_identifier_candidate',
  'prescription_context_candidate',
  'lab_result_context_candidate',
];
