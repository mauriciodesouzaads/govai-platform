// Baseline detectors brasileiros. Validações com checksum.
// Usa RE2 onde possível; padrões fixos compilados na importação.
import RE2 from 're2';

export type DetectorAction = 'detect' | 'redact' | 'deny';

export type DetectorFinding = {
  detector: string;
  match: string;
  index: number;
  length: number;
};

const CPF_RE = new RE2(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g);
// CNPJ — both the legacy numeric and the IN RFB 2.229/2024 alphanumeric format:
// the 12 base positions accept [0-9A-Z] (uppercase-only, D1) and the 2 DV positions
// stay numeric. Numeric CNPJs are a strict subset, so this is a superset of the
// old pattern (no regression). RE2-only matching invariant preserved.
const CNPJ_RE = new RE2(
  /\b[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2}\b/g,
);
const EMAIL_RE = new RE2(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g);
// BR: opcional +55, opcional DDI, DDD 2 dígitos, 8 ou 9 dígitos, separadores comuns.
const PHONE_BR_RE = new RE2(
  /(?:\+?55[\s-]?)?(?:\(?\d{2}\)?[\s-]?)\d{4,5}[\s-]?\d{4}\b/g,
);

function digits(s: string): string {
  return s.replace(/\D+/g, '');
}

export function isValidCpf(raw: string): boolean {
  const d = digits(raw);
  if (d.length !== 11) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  const ds = d.split('').map((c) => Number.parseInt(c, 10));
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (ds[i] ?? 0) * (10 - i);
  let dv1 = (sum * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  if (dv1 !== ds[9]) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += (ds[i] ?? 0) * (11 - i);
  let dv2 = (sum * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  return dv2 === ds[10];
}

// CNPJ validity for both formats (IN RFB 2.229/2024). The DV is mod-11 over the
// per-character value `ASCII − 48` ('0'..'9'→0..9, 'A'→17 … 'Z'→42), exactly the
// official Serpro/RFB reference algorithm — verified checksum-identical to it on
// every official reference case and all single-char mutations (EP-007 precond #2).
// A LOCAL letter-preserving sanitizer is used here (NOT the shared `digits()`, which
// is left intact for CPF/phone); the two DV positions remain numeric. Numeric CNPJs
// are a strict subset (ASCII−48 of a digit is the digit) → zero regression. The
// `toUpperCase()` is a validator-unit normalization (D1): the detector regex is
// uppercase-only, so detection never surfaces a lowercase CNPJ.
export function isValidCnpj(raw: string): boolean {
  const s = raw.replace(/[^0-9A-Za-z]+/g, '').toUpperCase();
  if (s.length !== 14) return false;
  if (!/^[0-9A-Z]{12}\d{2}$/.test(s)) return false;
  if (/^([0-9A-Z])\1{13}$/.test(s)) return false;
  const vals = [...s].map((c) => c.charCodeAt(0) - 48);
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (vals[i] ?? 0) * (w1[i] ?? 0);
  let dv1 = sum % 11;
  dv1 = dv1 < 2 ? 0 : 11 - dv1;
  if (dv1 !== vals[12]) return false;
  sum = 0;
  for (let i = 0; i < 13; i++) sum += (vals[i] ?? 0) * (w2[i] ?? 0);
  let dv2 = sum % 11;
  dv2 = dv2 < 2 ? 0 : 11 - dv2;
  return dv2 === vals[13];
}

function findAll(re: RE2, text: string): Array<{ match: string; index: number }> {
  const out: Array<{ match: string; index: number }> = [];
  let m: RegExpExecArray | null;
  // re2 implementa RegExp-like exec
  // global + non-global differ — we use new RE2 with /g.
  while ((m = re.exec(text)) !== null) {
    out.push({ match: m[0], index: m.index });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  re.lastIndex = 0;
  return out;
}

export function detectCpf(text: string): DetectorFinding[] {
  return findAll(CPF_RE, text)
    .filter((m) => isValidCpf(m.match))
    .map((m) => ({ detector: 'cpf', match: m.match, index: m.index, length: m.match.length }));
}

export function detectCnpj(text: string): DetectorFinding[] {
  return findAll(CNPJ_RE, text)
    .filter((m) => isValidCnpj(m.match))
    .map((m) => ({ detector: 'cnpj', match: m.match, index: m.index, length: m.match.length }));
}

export function detectEmail(text: string): DetectorFinding[] {
  return findAll(EMAIL_RE, text).map((m) => ({
    detector: 'email',
    match: m.match,
    index: m.index,
    length: m.match.length,
  }));
}

export function detectPhoneBr(text: string): DetectorFinding[] {
  return findAll(PHONE_BR_RE, text)
    .filter((m) => {
      const d = digits(m.match);
      return d.length === 10 || d.length === 11 || d.length === 12 || d.length === 13;
    })
    .map((m) => ({ detector: 'phone_br', match: m.match, index: m.index, length: m.match.length }));
}

export function detectAllBaseline(text: string): DetectorFinding[] {
  return [...detectCpf(text), ...detectCnpj(text), ...detectEmail(text), ...detectPhoneBr(text)];
}

// ───────────────────────────────────────────────────────────────────────────
// F5/F6 — span merge. `detectAllBaseline` concatena 4 detectores independentes
// que podem casar o MESMO trecho (um CPF nu de 11 dígitos casa CPF_RE e
// PHONE_BR_RE; um e-mail com CPF no local-part casa três). Redigir ou contar
// sobre os matches BRUTOS corrompe o texto (F5) e infla contagens (F6).
// `mergeFindingSpans` funde intervalos [index, index+length) que se sobrepõem
// OU se tocam, produzindo spans DISJUNTOS — a única forma segura de redigir
// e a unidade honesta de contagem (1 span = 1 achado).

/** Subconjunto estrutural de DetectorFinding suficiente para o merge.
 *  `detectors` (opcional) permite re-fundir spans JÁ fundidos sem perder os
 *  detectores-membro — é o que torna `mergeFindingSpans` integralmente
 *  idempotente (FIXUP3, Mudança C). */
export type FindingSpan = {
  detector: string;
  index: number;
  length: number;
  detectors?: readonly string[];
};

/** Detectores baseline de classe forte (pii_strong). Em sincronia com o
 *  fallback de `ddpClassifyDetector` (core-governance/resolve-governance). */
export const BASELINE_STRONG_DETECTORS: ReadonlySet<string> = new Set(['cpf', 'cnpj']);

export type MergedFinding = {
  /**
   * O rótulo VENCEDOR do span fundido (decisão de design F5): vence o detector
   * de classe mais forte (pii_strong > pii_standard); empate dentro da classe
   * → ordem alfabética. Determinístico por construção (independe da ordem de
   * concatenação dos detectores).
   */
  detector: string;
  /** Todos os detectores-membro do span (dedup, ordem alfabética). */
  detectors: string[];
  signal_class: 'pii_strong' | 'pii_standard';
  index: number;
  length: number;
};

/**
 * Funde achados em spans disjuntos. Cobre aninhamento TOTAL (um intervalo
 * contido no outro), sobreposição PARCIAL e intervalos que se TOCAM
 * (fim de A == início de B). Entrada sem sobreposição → um span por achado,
 * nas mesmas posições (identidade).
 *
 * INTEGRALMENTE idempotente (FIXUP3, Mudança C): spans já fundidos carregam
 * `detectors[]`, e a re-fusão preserva TODOS os membros
 * (`f.detectors ?? [f.detector]`) — re-fundir a própria saída devolve objetos
 * deep-equal (detector vencedor, membros, classe, geometria).
 */
export function mergeFindingSpans(findings: ReadonlyArray<FindingSpan>): MergedFinding[] {
  if (findings.length === 0) return [];
  const sorted = findings
    .slice()
    .sort(
      (a, b) =>
        a.index - b.index || b.length - a.length || a.detector.localeCompare(b.detector),
    );

  const out: MergedFinding[] = [];
  let start = sorted[0]!.index;
  let end = start + sorted[0]!.length;
  let members = new Set<string>(sorted[0]!.detectors ?? [sorted[0]!.detector]);

  const flush = (): void => {
    const detectors = [...members].sort();
    const strong = detectors.filter((d) => BASELINE_STRONG_DETECTORS.has(d));
    const winnerPool = strong.length > 0 ? strong : detectors;
    out.push({
      detector: winnerPool[0]!,
      detectors,
      signal_class: strong.length > 0 ? 'pii_strong' : 'pii_standard',
      index: start,
      length: end - start,
    });
  };

  for (const f of sorted.slice(1)) {
    const fEnd = f.index + f.length;
    if (f.index <= end) {
      // sobrepõe ou toca o span corrente → funde
      if (fEnd > end) end = fEnd;
      for (const d of f.detectors ?? [f.detector]) members.add(d);
    } else {
      flush();
      start = f.index;
      end = fEnd;
      members = new Set(f.detectors ?? [f.detector]);
    }
  }
  flush();
  return out;
}
