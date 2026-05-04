// DLP pre-scan: baseline detectors only in this patch (CPF/CNPJ/email/phone_br).
// Per-org action config drives policy decision downstream.

import type { PoolClient } from 'pg';
import { detectAllBaseline, type DetectorFinding } from '@govai/dlp-br';

export type BaselineConfig = {
  detector: 'cpf' | 'cnpj' | 'email' | 'phone_br';
  action: 'detect' | 'redact' | 'deny';
};

export type DlpScanResult = {
  findings: ReadonlyArray<DetectorFinding>;
  configByDetector: ReadonlyMap<string, 'detect' | 'redact' | 'deny'>;
  highestAction: 'detect' | 'redact' | 'deny';
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

  return { findings, configByDetector, highestAction };
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
