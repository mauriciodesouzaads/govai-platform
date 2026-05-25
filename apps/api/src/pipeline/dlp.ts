// DLP pre-scan: baseline detectors only in this patch (CPF/CNPJ/email/phone_br).
// Per-org action config drives policy decision downstream.
//
// PR-SD1 additive: the result also carries an optional `sensitiveFindings`
// stream produced by the rich Sensitive Data OS scan
// (`@govai/dlp-br.scanSensitiveData`). The rich findings are metadata only —
// they do NOT alter `findings`, `configByDetector`, or `highestAction`, and
// `decidePolicy` does NOT consume them. Existing consumers can ignore the
// new field without behavior change. Each rich finding carries a
// `match_hash` + `match_preview_redacted` only — no plaintext.

import type { PoolClient } from 'pg';
import {
  detectAllBaseline,
  scanSensitiveData,
  type DetectorFinding,
  type SensitiveDataFinding,
} from '@govai/dlp-br';

export type BaselineConfig = {
  detector: 'cpf' | 'cnpj' | 'email' | 'phone_br';
  action: 'detect' | 'redact' | 'deny';
};

export type DlpScanResult = {
  findings: ReadonlyArray<DetectorFinding>;
  configByDetector: ReadonlyMap<string, 'detect' | 'redact' | 'deny'>;
  highestAction: 'detect' | 'redact' | 'deny';
  /**
   * SD1 additive — rich Sensitive Data OS findings (taxonomy, provenance,
   * match hashes, redacted previews). Optional and advisory only; does NOT
   * influence `highestAction` or `decidePolicy`. Includes lifted baseline PII
   * findings PLUS new SD1 detector families (credentials/secrets, CNJ).
   */
  sensitiveFindings?: ReadonlyArray<SensitiveDataFinding>;
};

const ACTION_RANK: Record<'detect' | 'redact' | 'deny', number> = {
  detect: 0,
  redact: 1,
  deny: 2,
};

export async function loadBaselineConfig(client: PoolClient): Promise<BaselineConfig[]> {
  const r = await client.query<BaselineConfig>(
    `SELECT detector, action FROM govai.dlp_baseline_config`,
  );
  return r.rows;
}

export async function dlpPreScan(client: PoolClient, text: string): Promise<DlpScanResult> {
  const findings = detectAllBaseline(text);
  const config = await loadBaselineConfig(client);
  const configByDetector = new Map<string, 'detect' | 'redact' | 'deny'>();
  for (const c of config) {
    configByDetector.set(c.detector, c.action);
  }

  let highestAction: 'detect' | 'redact' | 'deny' = 'detect';
  for (const f of findings) {
    const action = configByDetector.get(f.detector) ?? 'detect';
    if (ACTION_RANK[action] > ACTION_RANK[highestAction]) {
      highestAction = action;
    }
  }

  // SD1 additive — produce rich Sensitive Data OS findings alongside the
  // legacy stream. These are observability/preparation metadata only; nothing
  // in this file or in `decidePolicy` consumes them. The legacy `findings`
  // array drives every enforcement decision in PR-SD1.
  const sensitiveFindings = scanSensitiveData(text, { source_surface: 'govai_runs' });

  return { findings, configByDetector, highestAction, sensitiveFindings };
}

/**
 * Apply redaction: replace each matched substring with `[REDACTED:<detector>]`.
 * Operates on the original text deterministically (sort by index descending).
 */
export function redactFindings(text: string, findings: ReadonlyArray<DetectorFinding>): string {
  const sorted = findings.slice().sort((a, b) => b.index - a.index);
  let out = text;
  for (const f of sorted) {
    out = out.slice(0, f.index) + `[REDACTED:${f.detector}]` + out.slice(f.index + f.length);
  }
  return out;
}
