import { describe, it, expect } from 'vitest';
import {
  detectAllBaseline,
  detectCpf,
  detectCnpj,
  detectEmail,
  detectPhoneBr,
  isValidCpf,
  isValidCnpj,
  mergeFindingSpans,
} from './baseline-detectors.js';

describe('CPF checksum', () => {
  it('accepts valid CPF', () => {
    expect(isValidCpf('11144477735')).toBe(true);
  });
  it('rejects invalid checksum', () => {
    expect(isValidCpf('11144477734')).toBe(false);
  });
  it('rejects all-equal digits', () => {
    expect(isValidCpf('11111111111')).toBe(false);
  });
  it('detects formatted CPFs', () => {
    expect(detectCpf('CPF: 111.444.777-35 .').length).toBe(1);
  });
  it('does not detect random 11 digits', () => {
    expect(detectCpf('00000000000').length).toBe(0);
  });
});

describe('CNPJ checksum', () => {
  it('accepts valid CNPJ', () => {
    expect(isValidCnpj('11444777000161')).toBe(true);
  });
  it('rejects invalid', () => {
    expect(isValidCnpj('11444777000160')).toBe(false);
  });
  it('detects formatted CNPJs', () => {
    expect(detectCnpj('CNPJ 11.444.777/0001-61').length).toBe(1);
  });
});

describe('email', () => {
  it('detects emails', () => {
    expect(detectEmail('contato a@b.com e c@d.org').length).toBe(2);
  });
});

describe('phone BR', () => {
  it('detects 11-digit cell with DDD', () => {
    expect(detectPhoneBr('me liga: 48 99876-5432').length).toBe(1);
  });
});

describe('mergeFindingSpans (F5/F6)', () => {
  it('CPF nu casa cpf E phone_br (a premissa do F5) e funde em UM span forte rotulado cpf', () => {
    const raw = detectAllBaseline('meu cpf 11144477735 ok');
    const detectors = raw.map((f) => f.detector).sort();
    expect(detectors).toContain('cpf');
    expect(detectors).toContain('phone_br'); // guarda da premissa: sobreposição real
    const merged = mergeFindingSpans(raw);
    expect(merged.length).toBe(1);
    expect(merged[0]!.detector).toBe('cpf');
    expect(merged[0]!.detectors).toEqual(['cpf', 'phone_br']);
    expect(merged[0]!.signal_class).toBe('pii_strong');
    expect(merged[0]!.index).toBe('meu cpf '.length);
    expect(merged[0]!.length).toBe('11144477735'.length);
  });

  it('email com CPF no local-part (aninhamento total, 3 detectores) funde em UM span rotulado cpf', () => {
    const text = 'contato: 11144477735@example.com fim';
    const raw = detectAllBaseline(text);
    expect(raw.map((f) => f.detector).sort()).toEqual(['cpf', 'email', 'phone_br']);
    const merged = mergeFindingSpans(raw);
    expect(merged.length).toBe(1);
    expect(merged[0]!.detector).toBe('cpf');
    expect(merged[0]!.signal_class).toBe('pii_strong');
    // o span cobre o e-mail INTEIRO (o intervalo maior engole o aninhado)
    expect(merged[0]!.index).toBe('contato: '.length);
    expect(merged[0]!.length).toBe('11144477735@example.com'.length);
  });

  it('sobreposição PARCIAL funde (sintético)', () => {
    const merged = mergeFindingSpans([
      { detector: 'email', index: 5, length: 10 }, // [5,15)
      { detector: 'phone_br', index: 12, length: 8 }, // [12,20) — cruza a borda
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0]!.index).toBe(5);
    expect(merged[0]!.length).toBe(15);
    expect(merged[0]!.detectors).toEqual(['email', 'phone_br']);
    expect(merged[0]!.signal_class).toBe('pii_standard');
    expect(merged[0]!.detector).toBe('email'); // empate de classe → alfabético
  });

  it('spans que se TOCAM fundem; disjuntos ficam separados (identidade)', () => {
    const touching = mergeFindingSpans([
      { detector: 'cpf', index: 0, length: 11 },
      { detector: 'email', index: 11, length: 5 }, // toca em 11
    ]);
    expect(touching.length).toBe(1);
    expect(touching[0]!.detector).toBe('cpf');

    const disjoint = mergeFindingSpans([
      { detector: 'cpf', index: 0, length: 11 },
      { detector: 'email', index: 20, length: 5 },
    ]);
    expect(disjoint.length).toBe(2);
    expect(disjoint[0]).toMatchObject({ detector: 'cpf', index: 0, length: 11 });
    expect(disjoint[1]).toMatchObject({ detector: 'email', index: 20, length: 5 });
  });

  it('rótulo é determinístico e independe da ordem de entrada (empate forte → alfabético)', () => {
    const a = mergeFindingSpans([
      { detector: 'cnpj', index: 3, length: 14 },
      { detector: 'cpf', index: 3, length: 11 },
    ]);
    const b = mergeFindingSpans([
      { detector: 'cpf', index: 3, length: 11 },
      { detector: 'cnpj', index: 3, length: 14 },
    ]);
    expect(a).toEqual(b);
    expect(a[0]!.detector).toBe('cnpj'); // alfabético dentro da classe forte
    expect(a[0]!.length).toBe(14);
  });

  it('é INTEGRALMENTE idempotente: re-fundir a saída devolve o objeto COMPLETO, com detectors[] preservado (critério D do FIXUP3)', () => {
    // Sobreposto (cpf+phone_br) + disjunto (email) na mesma entrada.
    const raw = detectAllBaseline('meu cpf 11144477735 e a@b.com ok');
    const once = mergeFindingSpans(raw);
    const twice = mergeFindingSpans(once);
    expect(twice).toEqual(once); // deep-equal do objeto completo, não campos parciais
    // e o span fundido multi-detector manteve TODOS os membros, ordenados:
    const cpfSpan = twice.find((s) => s.detector === 'cpf')!;
    expect(cpfSpan.detectors).toEqual(['cpf', 'phone_br']);
    // terceira aplicação idem (ponto fixo):
    expect(mergeFindingSpans(twice)).toEqual(once);
  });

  it('re-fusão de um SUBCONJUNTO filtrado de spans fundidos é identidade (a interação A×C do FIXUP3)', () => {
    const once = mergeFindingSpans(detectAllBaseline('meu cpf 11144477735 e a@b.com ok'));
    const subset = once.filter((s) => s.detector === 'cpf'); // subconjunto disjunto
    expect(mergeFindingSpans(subset)).toEqual(subset);
  });

  it('entrada vazia → saída vazia', () => {
    expect(mergeFindingSpans([])).toEqual([]);
  });
});
