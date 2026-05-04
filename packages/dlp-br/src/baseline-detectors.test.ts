import { describe, it, expect } from 'vitest';
import {
  detectCpf,
  detectCnpj,
  detectEmail,
  detectPhoneBr,
  isValidCpf,
  isValidCnpj,
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
