// F5/F6 — testes de aceitação da redação por spans fundidos (handoff P0.1 §4).
// A redação NUNCA reusa índices do texto original sobre uma string mutada;
// um marcador por span fundido; zero PII sobrevivente; disjuntos = identidade.

import { describe, it, expect } from 'vitest';
import { detectAllBaseline } from '@govai/dlp-br';
import { mergeWithActions, redactFindings, type DlpAction } from './dlp.js';

const config = (entries: Record<string, DlpAction>): ReadonlyMap<string, DlpAction> =>
  new Map(Object.entries(entries));

describe('redactFindings (F5)', () => {
  it('aceitação 1 — CPF nu (casa cpf+phone_br): UM marcador, zero dígitos sobreviventes', () => {
    const text = 'meu cpf 11144477735 ok';
    const out = redactFindings(text, detectAllBaseline(text));
    expect(out).toBe('meu cpf [REDACTED:cpf] ok');
    expect(out).not.toMatch(/\d/);
    expect(out.match(/\[REDACTED:/g)?.length).toBe(1);
  });

  it('aceitação 2 — email com CPF no local-part (3 detectores): UM marcador, domínio não sobrevive', () => {
    const text = 'contato: 11144477735@example.com fim';
    const out = redactFindings(text, detectAllBaseline(text));
    expect(out).toBe('contato: [REDACTED:cpf] fim');
    expect(out).not.toContain('example.com');
    expect(out).not.toMatch(/\d/);
  });

  it('aceitação 3 — aninhamento total e sobreposição parcial (sintético): um marcador por caso, resto intacto', () => {
    //          0123456789012345678901234
    const text = 'aa BBBBBBBBBB cc DDDD ee';
    // aninhado: [3,13) contém [5,9); parcial: [17,21) cruza [19,23)
    const nested = redactFindings(text, [
      { detector: 'email', index: 3, length: 10 },
      { detector: 'cpf', index: 5, length: 4 },
    ]);
    expect(nested).toBe('aa [REDACTED:cpf] cc DDDD ee');

    const partial = redactFindings(text, [
      { detector: 'phone_br', index: 17, length: 4 },
      { detector: 'email', index: 19, length: 4 },
    ]);
    // span fundido [17,23) engole 'DDDD e'; resta o último 'e' (índice 23)
    expect(partial).toBe('aa BBBBBBBBBB cc [REDACTED:email]e');
  });

  it('aceitação 4 — disjuntos inalterados: dois marcadores, texto entre eles byte-idêntico', () => {
    const text = 'a@b.com meio 111.444.777-35 fim';
    const out = redactFindings(text, detectAllBaseline(text));
    expect(out).toBe('[REDACTED:email] meio [REDACTED:cpf] fim');
  });

  it('aceitação 5 (propriedade) — nenhum caractere de um span detectado sobrevive no output', () => {
    const piis = ['11144477735', '111.444.777-35', 'x1@y.com', '11144477735@ex.com', '(48) 99876-5432'];
    const frames = [
      (p: string) => `inicio ${p} fim`,
      (p: string) => `${p} no começo`,
      (p: string) => `no fim ${p}`,
      (p: string) => `dois: ${p} e ${p} juntos`,
    ];
    for (const pii of piis) {
      for (const frame of frames) {
        const text = frame(pii);
        const findings = detectAllBaseline(text);
        const out = redactFindings(text, findings);
        for (const f of findings) {
          const span = text.slice(f.index, f.index + f.length);
          expect(out, `span "${span}" sobreviveu em "${text}" → "${out}"`).not.toContain(span);
        }
        expect(out).toContain(findings.length > 0 ? '[REDACTED:' : text);
      }
    }
  });

  it('sem achados → identidade byte a byte', () => {
    const text = 'texto limpo sem nada sensível';
    expect(redactFindings(text, detectAllBaseline(text))).toBe(text);
  });
});

describe('mergeWithActions (F6 — a ação efetiva do span)', () => {
  it('preserva um deny configurado num detector que PERDEU o rótulo do span', () => {
    // cpf=detect, phone_br=deny; CPF nu casa ambos → rótulo cpf, ação DENY.
    const raw = detectAllBaseline('meu cpf 11144477735 ok');
    const merged = mergeWithActions(raw, config({ cpf: 'detect', phone_br: 'deny' }));
    expect(merged.length).toBe(1);
    expect(merged[0]!.detector).toBe('cpf');
    expect(merged[0]!.action).toBe('deny');
  });

  it('span single-detector usa a ação do próprio detector (default detect)', () => {
    const raw = detectAllBaseline('mande para a@b.com hoje');
    const merged = mergeWithActions(raw, config({ email: 'redact' }));
    expect(merged.length).toBe(1);
    expect(merged[0]!).toMatchObject({ detector: 'email', action: 'redact' });
    const noCfg = mergeWithActions(raw, config({}));
    expect(noCfg[0]!.action).toBe('detect');
  });

  it('spans disjuntos mantêm ações independentes', () => {
    const raw = detectAllBaseline('a@b.com e 111.444.777-35');
    const merged = mergeWithActions(raw, config({ email: 'detect', cpf: 'deny' }));
    expect(merged.map((m) => [m.detector, m.action])).toEqual([
      ['email', 'detect'],
      ['cpf', 'deny'],
    ]);
  });
});
