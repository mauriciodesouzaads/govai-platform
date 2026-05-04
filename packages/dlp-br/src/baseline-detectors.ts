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
const CNPJ_RE = new RE2(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g);
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

export function isValidCnpj(raw: string): boolean {
  const d = digits(raw);
  if (d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  const ds = d.split('').map((c) => Number.parseInt(c, 10));
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (ds[i] ?? 0) * (w1[i] ?? 0);
  let dv1 = sum % 11;
  dv1 = dv1 < 2 ? 0 : 11 - dv1;
  if (dv1 !== ds[12]) return false;
  sum = 0;
  for (let i = 0; i < 13; i++) sum += (ds[i] ?? 0) * (w2[i] ?? 0);
  let dv2 = sum % 11;
  dv2 = dv2 < 2 ? 0 : 11 - dv2;
  return dv2 === ds[13];
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
