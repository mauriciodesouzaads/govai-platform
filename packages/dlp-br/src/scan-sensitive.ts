// Sensitive Data OS — top-level rich scan orchestrator (PR-SD1).
//
// `scanSensitiveData` runs the SD1 detector families against `text` and
// returns the rich `SensitiveDataFinding[]` aggregate. Baseline PII findings
// (cpf/cnpj/email/phone_br) are also lifted into rich findings so the
// resulting list is a single homogeneous stream. The legacy
// `detectAllBaseline` / `DetectorFinding[]` contract is NOT altered — callers
// that need the legacy shape continue to use the baseline detectors directly.
//
// `recommended_action` on the returned findings is ADVISORY ONLY in SD1.
// `scanSensitiveData` does NOT compute a `highestAction` and does NOT
// influence enforcement. Adding rich findings to `DlpScanResult` is purely
// additive metadata; the legacy `findings` / `configByDetector` /
// `highestAction` triple remains the sole enforcement input.

import { detectAllBaseline, type DetectorFinding } from './baseline-detectors.js';
import { detectCnjCaseNumbers } from './court-detectors.js';
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
 * Run every SD1 detector family against `text` and return a single
 * homogeneous `SensitiveDataFinding[]`. The result ordering is detector-stable
 * within each family; the family ordering is baseline → secret → court.
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

  out.push(...detectSecrets(text, { source_surface: context.source_surface, origin }));
  out.push(
    ...detectCnjCaseNumbers(text, { source_surface: context.source_surface, origin }),
  );

  return out;
}
