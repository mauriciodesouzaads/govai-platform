// Sensitive Data OS — top-level rich scan orchestrator (PR-SD1, extended by PR-SD2A).
//
// `scanSensitiveData` runs every native SD detector family against `text` and
// returns the rich `SensitiveDataFinding[]` aggregate. Baseline PII findings
// (cpf/cnpj/email/phone_br) are also lifted into rich findings so the
// resulting list is a single homogeneous stream. The legacy
// `detectAllBaseline` / `DetectorFinding[]` contract is NOT altered — callers
// that need the legacy shape continue to use the baseline detectors directly.
//
// `recommended_action` on the returned findings is ADVISORY ONLY (SD1
// invariant). `scanSensitiveData` does NOT compute a `highestAction` and
// does NOT influence enforcement. Adding rich findings to `DlpScanResult`
// is purely additive metadata; the legacy `findings` / `configByDetector` /
// `highestAction` triple remains the sole enforcement input. SD2A health
// and financial detectors abide by the same advisory boundary.

import { detectAllBaseline, type DetectorFinding } from './baseline-detectors.js';
import { detectCnjCaseNumbers } from './court-detectors.js';
import { detectFinancialData } from './financial-detectors.js';
import { detectHealthData } from './health-detectors.js';
import { detectSecrets } from './secret-detectors.js';
import {
  baselineFindingToSensitiveFinding,
  type SensitiveDataFinding,
} from './sensitive-findings.js';
import {
  type SensitiveDataOrigin,
  type SensitiveDataSourceSurface,
} from './sensitive-provenance.js';

export type ScanSensitiveDataContext = {
  source_surface: SensitiveDataSourceSurface;
  /** Defaults to `govai_native` — the scan is GovAI-produced native evidence. */
  origin?: SensitiveDataOrigin;
  /**
   * When true, baseline PII findings (cpf/cnpj/email/phone_br) are lifted into
   * the rich output. Defaults to true; set to false when the caller already
   * has the baseline list and wants only the SD1 NEW detector output.
   *
   * Ignored when `baseline_findings` is supplied — the supplied list is
   * authoritative and is lifted as-is.
   */
  include_baseline?: boolean;
  /**
   * Pre-computed baseline findings. When supplied, `scanSensitiveData` lifts
   * these into the rich stream instead of re-running `detectAllBaseline`
   * on `text` — the hot-path optimization used by the API pipeline to
   * avoid double-scanning the same input (Codex PR-SD1 P2). Pass `[]` to
   * explicitly attach no baseline lifts without paying for a re-scan.
   */
  baseline_findings?: ReadonlyArray<DetectorFinding>;
};

/**
 * Run every native SD detector family against `text` and return a single
 * homogeneous `SensitiveDataFinding[]`. The result ordering is detector-stable
 * within each family; the family ordering is:
 *
 *     baseline → secret → court → financial → health
 *
 * Tests pin this ordering so observers can rely on it. New SD slices must
 * extend, not reorder, this sequence.
 *
 * NOTE on safety: raw matches never leave a detector. Each finding in the
 * returned list carries a `match_hash` and a `match_preview_redacted` only.
 */
export function scanSensitiveData(
  text: string,
  context: ScanSensitiveDataContext,
): SensitiveDataFinding[] {
  const origin: SensitiveDataOrigin = context.origin ?? 'govai_native';
  const out: SensitiveDataFinding[] = [];

  // Baseline lift order of precedence (Codex PR-SD1 P2):
  //   1. Supplied `baseline_findings` — authoritative, no re-scan.
  //   2. Else, when `include_baseline !== false`, compute via detectAllBaseline.
  //   3. Else, skip baseline entirely.
  const baseline: ReadonlyArray<DetectorFinding> | null =
    context.baseline_findings !== undefined
      ? context.baseline_findings
      : context.include_baseline !== false
        ? detectAllBaseline(text)
        : null;
  if (baseline) {
    for (const f of baseline) {
      out.push(
        baselineFindingToSensitiveFinding(f, {
          source_surface: context.source_surface,
          origin,
          source_quality: 'primary_govai_evidence',
        }),
      );
    }
  }

  const inner = { source_surface: context.source_surface, origin };
  out.push(...detectSecrets(text, inner));
  out.push(...detectCnjCaseNumbers(text, inner));
  // SD2A — financial and health detector foundations. Advisory only; no
  // enforcement coupling; no clinical/financial interpretation.
  out.push(...detectFinancialData(text, inner));
  out.push(...detectHealthData(text, inner));

  return out;
}
