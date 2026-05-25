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

import { detectAllBaseline } from './baseline-detectors.js';
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
   */
  include_baseline?: boolean;
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

  if (context.include_baseline !== false) {
    const baseline = detectAllBaseline(text);
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
