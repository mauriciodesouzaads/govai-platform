// Sensitive Data OS — rich finding model + adapters (PR-SD1).
//
// SD1 keeps the legacy `DetectorFinding` (detector, match, index, length)
// untouched: the existing redaction primitive (`redactFindings`) still needs
// the raw match string in-process. The rich `SensitiveDataFinding` model
// described here is the durable, raw-match-free shape. Rich findings carry a
// match hash and a redacted preview only — never plaintext — so they are safe
// to persist into audit metadata, normalized classification tables (future SD
// PRs), and connector-ingested evidence pipelines.
//
// `recommended_action` on a rich finding is ADVISORY ONLY in SD1. It does not
// alter `DlpScanResult.highestAction`, does not influence `decidePolicy`, and
// does not cause runtime blocking. See `sensitive-taxonomy.ts` for the
// invariant constant `SD1_RECOMMENDED_ACTION_IS_ADVISORY`.

import { createHash } from 'node:crypto';
import type { DetectorFinding } from './baseline-detectors.js';
import {
  NO_REVIEW_FLAGS,
  type SensitiveDataCategory,
  type SensitiveDataConfidenceBand,
  type SensitiveDataRecommendedAction,
  type SensitiveDataReviewFlags,
} from './sensitive-taxonomy.js';
import {
  compareSourceQuality,
  decideSourcePrecedence,
  mergeBySourcePrecedence,
  type FindingForMerge,
  type SensitiveDataOrigin,
  type SensitiveDataSourceQuality,
  type SensitiveDataSourceSurface,
  type SourcePrecedenceDecision,
} from './sensitive-provenance.js';

export type SensitiveDataFinding = {
  /** Stable detector token, e.g. `openai_api_key_candidate`, `cnj_case_number`, `cpf`. */
  detector: string;
  /** Detector family this token belongs to, e.g. `secret`, `court`, `baseline_pii_br`. */
  detector_family: string;
  category: SensitiveDataCategory;
  /** Byte offset of the matched substring in the original text. */
  index: number;
  length: number;
  /** sha256(detector || ":" || match) — the integrity anchor for the match.
   *  Includes the detector token to prevent cross-detector hash collisions when
   *  the same string would be matched by multiple detectors. Lowercase hex. */
  match_hash: string;
  /** Safe preview suitable for audit metadata, e.g. `[REDACTED:openai_api_key_candidate]`. */
  match_preview_redacted: string;
  /** [0,1] heuristic confidence the detector assigns to this match. */
  confidence: number;
  confidence_band: SensitiveDataConfidenceBand;
  /** Short stable rationale token, e.g. `format_match`, `format_and_checksum`,
   *  `context_term_present`, `prefix_match`. */
  rationale_code: string;
  /** SD1: advisory only — see header note and `SD1_RECOMMENDED_ACTION_IS_ADVISORY`. */
  recommended_action: SensitiveDataRecommendedAction;
  origin: SensitiveDataOrigin;
  source_surface: SensitiveDataSourceSurface;
  source_quality: SensitiveDataSourceQuality;
  /** Suggested redaction token / instruction for future redaction layers.
   *  SD1 itself does not apply this; the legacy `redactFindings` is unchanged. */
  redaction_hint: string;
} & SensitiveDataReviewFlags;

// ---------------------------------------------------------------------------
// Hash + preview helpers.
// ---------------------------------------------------------------------------

/**
 * Deterministic sha256 hash of `detector || ":" || match`. Lowercase hex.
 * Including the detector token in the digest avoids cross-detector collisions
 * (e.g., two different detectors matching the same substring produce different
 * hashes). The raw `match` value never leaves this function.
 */
export function matchHash(detector: string, match: string): string {
  return createHash('sha256').update(`${detector}:${match}`, 'utf8').digest('hex');
}

/**
 * Build a safe, audit-friendly preview for a detector match. The format is
 * uniform across detectors so downstream observers can pattern-match the
 * preview without ever seeing plaintext.
 */
export function redactPreview(detector: string): string {
  return `[REDACTED:${detector}]`;
}

/**
 * Map a raw confidence in [0,1] to a coarse band. The thresholds match the
 * "high / medium / low" routing intent from
 * `docs/architecture/regulatory/24-sensitive-data-operating-model.md`:
 * high ≥ 0.85, medium ≥ 0.60, otherwise low. Values outside [0,1] are
 * clamped (Infinity → 1, -Infinity → 0); NaN is treated as 0 so this never
 * throws on caller-supplied scores.
 */
export function confidenceBandForScore(score: number): SensitiveDataConfidenceBand {
  const numeric = typeof score === 'number' && !Number.isNaN(score) ? score : 0;
  const s = Math.max(0, Math.min(1, numeric));
  if (s >= 0.85) return 'high';
  if (s >= 0.6) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Recommended-action strictness ranking. Used ONLY for choosing between rich
// findings when merging by source precedence — NOT for enforcement.
// ---------------------------------------------------------------------------

const ACTION_STRICTNESS: Record<SensitiveDataRecommendedAction, number> = {
  observe: 0,
  warn: 1,
  review: 2,
  approve_required: 3,
  deny: 4,
};

export function recommendedActionRank(a: SensitiveDataRecommendedAction): number {
  return ACTION_STRICTNESS[a];
}

/** Return the strictest of two recommended actions. */
export function strictestRecommendedAction(
  a: SensitiveDataRecommendedAction,
  b: SensitiveDataRecommendedAction,
): SensitiveDataRecommendedAction {
  return recommendedActionRank(a) >= recommendedActionRank(b) ? a : b;
}

// ---------------------------------------------------------------------------
// Baseline ↔ rich adapters.
// ---------------------------------------------------------------------------

const BASELINE_CATEGORY: Record<string, SensitiveDataCategory> = {
  cpf: 'personal_data',
  cnpj: 'personal_data',
  email: 'personal_data',
  phone_br: 'personal_data',
};

const BASELINE_RATIONALE: Record<string, string> = {
  cpf: 'format_and_checksum',
  cnpj: 'format_and_checksum',
  email: 'format_match',
  phone_br: 'format_match',
};

const BASELINE_CONFIDENCE: Record<string, number> = {
  // Checksum-validated identifiers earn the higher confidence band.
  cpf: 0.95,
  cnpj: 0.95,
  email: 0.8,
  phone_br: 0.75,
};

export type BaselineToSensitiveContext = {
  source_surface: SensitiveDataSourceSurface;
  origin?: SensitiveDataOrigin;
  source_quality?: SensitiveDataSourceQuality;
};

/**
 * Lift a legacy `DetectorFinding` (cpf/cnpj/email/phone_br) into a rich
 * `SensitiveDataFinding`. SD1 does not change baseline DLP behavior: the rich
 * finding is informational. `recommended_action='observe'` for every baseline
 * conversion, because the actual detect/redact/deny decision continues to be
 * driven exclusively by the existing `BaselineConfig` per-tenant table.
 */
export function baselineFindingToSensitiveFinding(
  finding: DetectorFinding,
  context: BaselineToSensitiveContext,
): SensitiveDataFinding {
  const category: SensitiveDataCategory =
    BASELINE_CATEGORY[finding.detector] ?? 'personal_data';
  const rationale = BASELINE_RATIONALE[finding.detector] ?? 'format_match';
  const confidence = BASELINE_CONFIDENCE[finding.detector] ?? 0.7;
  return {
    detector: finding.detector,
    detector_family: 'baseline_pii_br',
    category,
    index: finding.index,
    length: finding.length,
    match_hash: matchHash(finding.detector, finding.match),
    match_preview_redacted: redactPreview(finding.detector),
    confidence,
    confidence_band: confidenceBandForScore(confidence),
    rationale_code: rationale,
    // SD1: advisory only — enforcement remains driven by the legacy
    // BaselineConfig action; `observe` here documents that the rich layer does
    // not advise any escalation for the baseline detectors.
    recommended_action: 'observe',
    origin: context.origin ?? 'govai_native',
    source_surface: context.source_surface,
    source_quality: context.source_quality ?? 'primary_govai_evidence',
    redaction_hint: `mask:${finding.detector}`,
    ...NO_REVIEW_FLAGS,
  };
}

/**
 * Convert a rich finding back to the legacy shape — ONLY when the caller still
 * holds the raw match in memory (the rich finding itself does not carry it).
 * This adapter lets new detectors plug into the legacy `redactFindings` path
 * without changing that path.
 */
export function sensitiveFindingToLegacyFinding(
  finding: Pick<SensitiveDataFinding, 'detector' | 'index' | 'length'>,
  rawMatch: string,
): DetectorFinding {
  return {
    detector: finding.detector,
    match: rawMatch,
    index: finding.index,
    length: finding.length,
  };
}

// ---------------------------------------------------------------------------
// Aggregation helpers.
// ---------------------------------------------------------------------------

/**
 * Pick the strictest finding from a non-empty list, scored by
 * `recommendedActionRank`. Returns `null` for an empty list. Ties resolve to
 * the higher-quality source first, then to the first occurrence.
 */
export function strictestFinding(
  findings: ReadonlyArray<SensitiveDataFinding>,
): SensitiveDataFinding | null {
  if (findings.length === 0) return null;
  let best: SensitiveDataFinding | undefined = findings[0];
  for (let i = 1; i < findings.length; i++) {
    const cur = findings[i];
    if (!cur || !best) continue;
    const merged = mergeBySourcePrecedence<SensitiveDataFinding>(
      {
        value: best,
        source_quality: best.source_quality,
        action_rank: recommendedActionRank(best.recommended_action),
      },
      {
        value: cur,
        source_quality: cur.source_quality,
        action_rank: recommendedActionRank(cur.recommended_action),
      },
    );
    best = merged.value;
  }
  return best ?? null;
}

/**
 * Merge two finding sets reporting on the same scan target, applying the
 * native-vs-connector precedence rules per-key. The grouping key defaults to
 * `${detector}:${match_hash}` so the same hit reported by GovAI native AND a
 * connector lands in one merged record.
 *
 * IMPORTANT: this helper returns ONLY the selected finding per key. When an
 * external/connector finding is stricter than the native-primary finding it
 * accompanies, that escalation signal is dropped from the output here.
 * Callers that need to preserve escalation metadata (e.g., for routing to
 * qualified-counsel / DPO / security review in later SD slices) should use
 * `mergeFindingsWithPrecedenceDecisions` instead, which keeps both selected
 * and escalation per key. SD1 itself does not act on the escalation signal —
 * routing it into enforcement is future SD/RT work.
 */
export function mergeFindingsWithPrecedence(
  a: ReadonlyArray<SensitiveDataFinding>,
  b: ReadonlyArray<SensitiveDataFinding>,
  keyOf?: (f: SensitiveDataFinding) => string,
): SensitiveDataFinding[] {
  return mergeFindingsWithPrecedenceDecisions(a, b, keyOf).map((d) => d.decision.selected.value);
}

/**
 * Decision-preserving variant of `mergeFindingsWithPrecedence`. Returns one
 * entry per key carrying the full `SourcePrecedenceDecision` — selected
 * finding plus optional `escalation` and the rule that fired. Use this when
 * the caller must keep external/connector escalation metadata alongside the
 * authoritative native finding (e.g., to surface a stricter external review
 * recommendation in audit/review UIs).
 *
 * SD1 contract: the `escalation` field is metadata only. It does NOT alter
 * `DlpScanResult.highestAction`, does NOT influence `decidePolicy`, and does
 * NOT trigger runtime blocking. Connector ingestion is not implemented in
 * SD1; this helper is the SD1 foundation that later slices build on.
 */
export type FindingDecisionEntry = {
  key: string;
  decision: SourcePrecedenceDecision<SensitiveDataFinding>;
};

/**
 * Tie-breaker for choosing between two non-selected escalation candidates.
 *
 * The escalation slot represents "the strictest external review signal that
 * should not be silently discarded." Action strictness is therefore the
 * primary key — a stricter action MUST win even when the strictness comes
 * from a lower-quality source (otherwise an unverified `deny` would be
 * downgraded to a normalized `warn`, defeating the doctrine). Source quality
 * is the secondary tie-breaker, and first-seen wins on full ties for
 * determinism.
 *
 * This is intentionally NOT `decideSourcePrecedence`: that helper governs
 * which finding is authoritative (`selected`), where quality must outrank
 * action so an unverified external cannot override primary GovAI evidence.
 * Escalation is a different question — by construction neither candidate is
 * the selected finding, so quality-first is wrong for this slot.
 */
function chooseEscalationCandidate(
  a: FindingForMerge<SensitiveDataFinding>,
  b: FindingForMerge<SensitiveDataFinding>,
): FindingForMerge<SensitiveDataFinding> {
  if (a.action_rank !== b.action_rank) {
    return a.action_rank > b.action_rank ? a : b;
  }
  const qcmp = compareSourceQuality(a.source_quality, b.source_quality);
  if (qcmp !== 0) {
    return qcmp > 0 ? a : b;
  }
  return a;
}

export function mergeFindingsWithPrecedenceDecisions(
  a: ReadonlyArray<SensitiveDataFinding>,
  b: ReadonlyArray<SensitiveDataFinding>,
  keyOf?: (f: SensitiveDataFinding) => string,
): FindingDecisionEntry[] {
  const key = keyOf ?? ((f: SensitiveDataFinding) => `${f.detector}:${f.match_hash}`);
  const order: string[] = [];
  const byKey = new Map<string, SourcePrecedenceDecision<SensitiveDataFinding>>();
  const wrap = (f: SensitiveDataFinding): FindingForMerge<SensitiveDataFinding> => ({
    value: f,
    source_quality: f.source_quality,
    action_rank: recommendedActionRank(f.recommended_action),
  });
  const consider = (f: SensitiveDataFinding): void => {
    const k = key(f);
    const existing = byKey.get(k);
    if (!existing) {
      // First sighting becomes the selected baseline with no escalation yet.
      byKey.set(k, { selected: wrap(f), reason: 'deterministic_tie' });
      order.push(k);
      return;
    }
    // Re-decide which finding is selected (authoritative) under the
    // native-vs-connector rules; native primary cannot be displaced here.
    const decided = decideSourcePrecedence<SensitiveDataFinding>(existing.selected, wrap(f));
    let merged: SourcePrecedenceDecision<SensitiveDataFinding> = decided;
    if (existing.escalation) {
      // Reconcile the prior escalation against the new decision and keep the
      // strictest non-selected external signal. Action-first via
      // chooseEscalationCandidate so an unverified `deny` is NOT downgraded
      // to a normalized `warn` — escalation cares about strictness, not
      // about which source is most trustworthy.
      const priorEsc = existing.escalation;
      const currentEsc = decided.escalation;
      const isSelected = (cand: FindingForMerge<SensitiveDataFinding>): boolean =>
        cand.value === decided.selected.value;
      const candidates = [priorEsc, currentEsc].filter(
        (x): x is FindingForMerge<SensitiveDataFinding> => x !== undefined && !isSelected(x),
      );
      if (candidates.length === 2) {
        merged = {
          ...decided,
          escalation: chooseEscalationCandidate(candidates[0]!, candidates[1]!),
        };
      } else if (candidates.length === 1) {
        merged = { ...decided, escalation: candidates[0] };
      }
      // If both prior and current escalations resolved to the selected, drop
      // them — there is nothing left to escalate.
    }
    byKey.set(k, merged);
  };
  for (const f of a) consider(f);
  for (const f of b) consider(f);
  return order.map((k) => ({ key: k, decision: byKey.get(k)! }));
}

/** Re-export the merge primitive and decision helper for standalone callers. */
export {
  decideSourcePrecedence,
  mergeBySourcePrecedence,
} from './sensitive-provenance.js';
export type {
  FindingForMerge,
  SourcePrecedenceDecision,
  SourcePrecedenceReason,
} from './sensitive-provenance.js';
