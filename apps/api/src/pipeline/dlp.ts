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
//
// F5/F6: `findings` agora são SPANS FUNDIDOS (`mergeFindingSpans`), não os
// matches brutos — detectores independentes podem casar o mesmo trecho (um
// CPF nu casa cpf E phone_br), e redigir/contar sobre matches sobrepostos
// corrompe o texto (F5) e infla contagens (F6). Cada span carrega a AÇÃO
// EFETIVA = a mais forte entre TODOS os detectores-membro (um span cpf+phone
// com phone_br=deny NEGA, mesmo com o rótulo vencedor sendo cpf). Os matches
// brutos seguem disponíveis em `rawFindings` (o lift SD1 os consome as-is).

import type { PoolClient } from 'pg';
import {
  detectAllBaseline,
  mergeFindingSpans,
  scanSensitiveData,
  type DetectorFinding,
  type FindingSpan,
  type MergedFinding,
  type SensitiveDataFinding,
} from '@govai/dlp-br';

export type BaselineConfig = {
  detector: 'cpf' | 'cnpj' | 'email' | 'phone_br';
  action: 'detect' | 'redact' | 'deny';
};

export type DlpAction = 'detect' | 'redact' | 'deny';

/** Span fundido + a ação efetiva (máximo sobre os detectores-membro). */
export type MergedDlpFinding = MergedFinding & { action: DlpAction };

export type DlpScanResult = {
  /** Spans fundidos e disjuntos — a unidade de contagem, redação e decisão. */
  findings: ReadonlyArray<MergedDlpFinding>;
  /** Matches brutos por detector (pré-fusão) — só para o lift SD1/diagnóstico. */
  rawFindings: ReadonlyArray<DetectorFinding>;
  configByDetector: ReadonlyMap<string, DlpAction>;
  highestAction: DlpAction;
  /**
   * SD1 additive — rich Sensitive Data OS findings (taxonomy, provenance,
   * match hashes, redacted previews). Optional and advisory only; does NOT
   * influence `highestAction` or `decidePolicy`. Includes lifted baseline PII
   * findings PLUS new SD1 detector families (credentials/secrets, CNJ).
   */
  sensitiveFindings?: ReadonlyArray<SensitiveDataFinding>;
};

const ACTION_RANK: Record<DlpAction, number> = {
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

/**
 * Funde os matches brutos em spans disjuntos e resolve a ação efetiva de cada
 * span como o MÁXIMO sobre as ações configuradas de TODOS os seus
 * detectores-membro (nunca só a do rótulo vencedor — senão um `deny` num
 * detector "perdedor" do span seria silenciosamente descartado). Puro.
 */
export function mergeWithActions(
  rawFindings: ReadonlyArray<DetectorFinding>,
  configByDetector: ReadonlyMap<string, DlpAction>,
): MergedDlpFinding[] {
  return mergeFindingSpans(rawFindings).map((span) => {
    let action: DlpAction = 'detect';
    for (const member of span.detectors) {
      const a = configByDetector.get(member) ?? 'detect';
      if (ACTION_RANK[a] > ACTION_RANK[action]) action = a;
    }
    return { ...span, action };
  });
}

export async function dlpPreScan(client: PoolClient, text: string): Promise<DlpScanResult> {
  const rawFindings = detectAllBaseline(text);
  const config = await loadBaselineConfig(client);
  const configByDetector = new Map<string, DlpAction>();
  for (const c of config) {
    configByDetector.set(c.detector, c.action);
  }

  const findings = mergeWithActions(rawFindings, configByDetector);

  let highestAction: DlpAction = 'detect';
  for (const f of findings) {
    if (ACTION_RANK[f.action] > ACTION_RANK[highestAction]) {
      highestAction = f.action;
    }
  }

  // SD1 additive — produce rich Sensitive Data OS findings alongside the
  // legacy stream. These are observability/preparation metadata only; nothing
  // in this file or in `decidePolicy` consumes them.
  //
  // Codex PR-SD1 P2: hand the already-computed baseline RAW findings to
  // `scanSensitiveData` so it lifts them as-is instead of running
  // `detectAllBaseline` a second time on the same input (o contrato SD1 é
  // por-match; a fusão F5/F6 não altera o stream rico).
  const sensitiveFindings = scanSensitiveData(text, {
    source_surface: 'govai_runs',
    baseline_findings: rawFindings,
  });

  return { findings, rawFindings, configByDetector, highestAction, sensitiveFindings };
}

/**
 * Apply redaction: replace each detected span with `[REDACTED:<detector>]`.
 *
 * F5: os achados são fundidos em spans DISJUNTOS antes de qualquer corte
 * (idempotente se já vierem fundidos) e o texto é reconstruído por varredura
 * ESQUERDA→DIREITA com cursor acumulado — nunca se aplica índice do texto
 * original sobre uma string já mutada. UM marcador por span fundido; o rótulo
 * é o detector vencedor do span (classe mais forte; empate → alfabético).
 */
export function redactFindings(text: string, findings: ReadonlyArray<FindingSpan>): string {
  const spans = mergeFindingSpans(findings);
  let out = '';
  let cursor = 0;
  for (const s of spans) {
    out += text.slice(cursor, s.index) + `[REDACTED:${s.detector}]`;
    cursor = s.index + s.length;
  }
  return out + text.slice(cursor);
}
