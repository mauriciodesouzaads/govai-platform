// EP-007 — alphanumeric CNPJ (IN RFB 2.229/2024). The official VALID cases below are
// PINNED hardcoded fixtures taken from the official Serpro/RFB reference set
// (codigos-cnpj.zip from gov.br/receitafederal …/documentos-tecnicos/cnpj,
// src/typescript/test.ts). Precondition #2 proved `isValidCnpj` checksum-identical to
// the official validator across every official case + 5694 single-char mutations
// (0 disagreements). The existing numeric CNPJ tests live in baseline-detectors.test.ts
// and are left untouched.

import { describe, it, expect } from 'vitest';
import {
  detectCnpj,
  detectCpf,
  detectEmail,
  detectPhoneBr,
  isValidCnpj,
} from './baseline-detectors.js';

// ---- independent inline DV (NOT the production code) for property tests ----
function computeDv(base12: string): string {
  const v = [...base12.toUpperCase()].map((c) => c.charCodeAt(0) - 48);
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let s1 = 0;
  for (let i = 0; i < 12; i += 1) s1 += (v[i] ?? 0) * (w1[i] ?? 0);
  let d1 = s1 % 11;
  d1 = d1 < 2 ? 0 : 11 - d1;
  const v2 = [...v, d1];
  let s2 = 0;
  for (let i = 0; i < 13; i += 1) s2 += (v2[i] ?? 0) * (w2[i] ?? 0);
  let d2 = s2 % 11;
  d2 = d2 < 2 ? 0 : 11 - d2;
  return `${d1}${d2}`;
}

// deterministic LCG so property/benchmark tests never flake.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function randomBase12(rand: () => number): string {
  let b = '';
  for (let i = 0; i < 12; i += 1) b += ALNUM[Math.floor(rand() * ALNUM.length)];
  return b;
}

// OFFICIAL valid reference cases (pinned literals).
const OFFICIAL_VALID = [
  '12.ABC.345/01DE-35',
  '90.021.382/0001-22',
  '90.024.778/0001-23',
  '90.025.108/0001-21',
  '90.025.255/0001-00',
  '90.024.420/0001-09',
  '90.024.781/0001-47',
  '04.740.714/0001-97',
  '44.108.058/0001-29',
  '90.024.780/0001-00',
  '90.024.779/0001-78',
  '00000000000191',
  'ABCDEFGHIJKL80',
] as const;

describe('CNPJ alfanumérico — official RFB reference cases', () => {
  it('isValidCnpj ACCEPTS every official valid case', () => {
    for (const c of OFFICIAL_VALID) expect(isValidCnpj(c)).toBe(true);
  });

  it('rejects a single-character DV mutation of each official case (curated, non-collision)', () => {
    for (const c of OFFICIAL_VALID) {
      const s = c.replace(/[^0-9A-Za-z]+/g, '');
      const last = s[13]!;
      const mutated = s.slice(0, 13) + (last === '0' ? '1' : '0');
      expect(isValidCnpj(mutated)).toBe(false);
    }
  });

  it('rejects the official invalid cases (bad char / wrong DV / zeroed / length / letter-in-DV)', () => {
    for (const c of [
      '',
      "'!@#$%&*-_=+^~",
      '$0123456789ABC',
      '0123456?789ABC',
      '0123456789ABC#',
      '0000000000019',
      '000000000001911',
      '0000000000019L',
      '000000000001P1',
      '00000000000192',
      'ABCDEFGHIJKL81',
      '00000000000000',
      '00.000.000/0000-00',
    ]) {
      expect(isValidCnpj(c)).toBe(false);
    }
  });

  it('regression: the existing numeric fixtures still validate (numeric is a strict subset)', () => {
    expect(isValidCnpj('11444777000161')).toBe(true);
    expect(isValidCnpj('11444777000160')).toBe(false);
  });
});

describe('CNPJ alfanumérico — property (independent DV impl)', () => {
  it('base12 + computed DV accepted; non-collision single-char mutation rejected over N=10k', () => {
    const rand = lcg(20260620);
    const N = 10_000;
    let accepted = 0;
    let checked = 0;
    let rejected = 0;
    for (let n = 0; n < N; n += 1) {
      const base = randomBase12(rand);
      const dv = computeDv(base);
      if (isValidCnpj(base + dv)) accepted += 1;

      const pos = Math.floor(rand() * 12);
      let ch = ALNUM[Math.floor(rand() * ALNUM.length)]!;
      if (ch === base[pos]) ch = ch === '0' ? 'A' : '0';
      const mutBase = base.slice(0, pos) + ch + base.slice(pos + 1);
      if (computeDv(mutBase) === dv) continue; // documented mod-11 collision — excepted
      checked += 1;
      if (!isValidCnpj(mutBase + dv)) rejected += 1;
    }
    expect(accepted).toBe(N);
    expect(rejected).toBe(checked); // 100% of non-collision mutations rejected (≥99%)
    expect(checked).toBeGreaterThan(N * 0.9); // collisions are the small minority
  });

  it('letter in a DV position rejected; lowercase accepted only via validator-unit normalization', () => {
    const base = 'ABCDEFGHIJKL';
    const dv = computeDv(base);
    expect(isValidCnpj(base + dv)).toBe(true);
    expect(isValidCnpj(`${base}${dv[0]}L`)).toBe(false);
    expect(isValidCnpj(`12abc34501de${computeDv('12ABC34501DE')}`)).toBe(true);
  });
});

describe('CNPJ alfanumérico — detection', () => {
  it('detects an UPPERCASE alphanumeric CNPJ in PT-BR prose, with and without separators', () => {
    expect(detectCnpj('Contrato com a empresa 12.ABC.345/01DE-35 firmado.')).toHaveLength(1);
    expect(detectCnpj('CNPJ 12ABC34501DE35 conforme cadastro.')).toHaveLength(1);
    expect(detectCnpj('inscrição ABCDEFGHIJKL80 ativa')).toHaveLength(1);
  });

  it('still detects numeric CNPJs (regression)', () => {
    expect(detectCnpj('CNPJ 11.444.777/0001-61')).toHaveLength(1);
    expect(detectCnpj('11444777000161')).toHaveLength(1);
  });

  it('does NOT surface a lowercase candidate (uppercase-only regex, D1)', () => {
    expect(detectCnpj('empresa 12abc34501de35 ltda')).toHaveLength(0);
  });

  it('does not disturb CPF / email / phone detection on mixed text', () => {
    const text =
      'CPF 111.444.777-35, e-mail a@b.com, fone (11) 98888-7777, CNPJ 12.ABC.345/01DE-35';
    expect(detectCpf(text)).toHaveLength(1);
    expect(detectEmail(text)).toHaveLength(1);
    expect(detectPhoneBr(text).length).toBeGreaterThanOrEqual(1);
    expect(detectCnpj(text)).toHaveLength(1);
  });
});

describe('CNPJ alfanumérico — FP benchmark (≥5k lines of PT-BR business text)', () => {
  it('planted CNPJs detected; unexpected alphanumeric survivors are ~zero (reported)', () => {
    const rand = lcg(7);
    const code = (n: number): string => {
      let s = '';
      for (let i = 0; i < n; i += 1) s += ALNUM[Math.floor(rand() * 36)];
      return s;
    };
    const plate = (): string => {
      const L = (): string => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(rand() * 26)]!;
      const D = (): string => '0123456789'[Math.floor(rand() * 10)]!;
      return `${L()}${L()}${L()}${D()}${L()}${D()}${D()}`; // Mercosul AAA1A11
    };

    const PLANTED = ['11.444.777/0001-61', '04.740.714/0001-97', '12.ABC.345/01DE-35'];
    const plantedNorm = new Set(PLANTED.map((c) => c.replace(/[^0-9A-Za-z]+/g, '')));

    const lines: string[] = [];
    for (let i = 0; i < 5200; i += 1) {
      lines.push(
        `Pedido ${code(8)} placa ${plate()} NF-e ${code(10)} SKU ${code(6)}-${code(4)} ` +
          `valor R$ ${Math.floor(rand() * 100000)},00 lote ${code(11)} ordem ${Math.floor(rand() * 1e9)}`,
      );
    }
    for (const c of PLANTED) lines.push(`fornecedor CNPJ ${c} homologado`);
    const corpus = lines.join('\n');

    const findings = detectCnpj(corpus);
    const foundNorm = new Set(findings.map((f) => f.match.replace(/[^0-9A-Za-z]+/g, '').toUpperCase()));

    // recall: every planted CNPJ detected.
    for (const p of plantedNorm) expect(foundNorm.has(p.toUpperCase())).toBe(true);

    // unexpected alphanumeric survivors = detected, contain a letter, NOT planted.
    const unexpectedAlphanumeric = findings.filter((f) => {
      const norm = f.match.replace(/[^0-9A-Za-z]+/g, '').toUpperCase();
      return /[A-Z]/.test(norm) && !plantedNorm.has(norm);
    }).length;

    // eslint-disable-next-line no-console
    console.info(
      `[EP-007 FP benchmark] lines=${lines.length} total_candidates=${findings.length} unexpected_alphanumeric_survivors=${unexpectedAlphanumeric}`,
    );
    // Bound the alphanumeric false positives generously (mod-11 lets ~0.8% of any
    // 14-char alnum-ending-in-2-digits token survive; realistic business text yields
    // ~zero). The exact number is printed above + reported in the PR.
    expect(unexpectedAlphanumeric).toBeLessThan(25);
  });
});
