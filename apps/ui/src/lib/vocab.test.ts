import { describe, expect, it } from 'vitest';
import { knownValues, resolveStatus, type VocabDomain } from './vocab.js';
import { CATALOGS } from './i18n/catalogs/index.js';
import { LOCALES } from './i18n/locales.js';
import { CAPABILITY_STATUSES, EVIDENCE_STRENGTHS } from './contract/capabilities.js';
import { CHAIN_CATEGORIES } from './contract/audit-events.js';
import { KNOWN_PRINCIPAL_TYPES } from './contract/me.js';

const DOMAINS: VocabDomain[] = [
  'capture',
  'capability',
  'evidenceStrength',
  'chainCategory',
  'principalType',
];

describe('the status vocabulary covers exactly the backend enums', () => {
  it('capability statuses match packages/core-governance/src/capability.ts', () => {
    expect(knownValues('capability').sort()).toEqual([...CAPABILITY_STATUSES].sort());
  });

  it('evidence strengths match the EvidenceStrengthSchema enum', () => {
    expect(knownValues('evidenceStrength').sort()).toEqual([...EVIDENCE_STRENGTHS].sort());
  });

  it('chain categories match the audit-events query enum', () => {
    expect(knownValues('chainCategory').sort()).toEqual([...CHAIN_CATEGORIES].sort());
  });

  it('capture statuses match the outbox status values the reports return', () => {
    expect(knownValues('capture').sort()).toEqual(
      ['captured', 'sealing', 'sealed', 'failed'].sort(),
    );
  });

  it('principal types match the ones GET /v1/me can actually produce', () => {
    expect(knownValues('principalType').sort()).toEqual([...KNOWN_PRINCIPAL_TYPES].sort());
  });
});

describe('every known value resolves to a real, translated label', () => {
  it.each(DOMAINS)('%s', (domain) => {
    for (const value of knownValues(domain)) {
      const status = resolveStatus(domain, value);
      expect(status.unknown).toBe(false);
      expect(status.raw).toBe(value);
      for (const locale of LOCALES) {
        expect(CATALOGS[locale][status.messageKey].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('an unrecognized value is never rendered as a pass', () => {
  it.each(DOMAINS)('%s: an unknown value is neutral and flagged', (domain) => {
    const status = resolveStatus(domain, 'some_future_enum_member');
    expect(status.unknown).toBe(true);
    expect(status.tone).toBe('neutral');
    expect(status.tone).not.toBe('ok');
    expect(status.messageKey).toBe('status.unknown');
    // The raw value is preserved so the reader sees what the API actually said.
    expect(status.raw).toBe('some_future_enum_member');
  });
});

describe('green is reserved for asserted facts', () => {
  it('only `sealed` and `supported` are green', () => {
    const green: string[] = [];
    for (const domain of DOMAINS) {
      for (const value of knownValues(domain)) {
        if (resolveStatus(domain, value).tone === 'ok') green.push(`${domain}.${value}`);
      }
    }
    expect(green.sort()).toEqual(['capability.supported', 'capture.sealed']);
  });

  it('the API-key principal is neutral — a credential type is not a quality', () => {
    expect(resolveStatus('principalType', 'api_key').tone).toBe('neutral');
  });

  it('no evidence strength is green — evidence strength is never a certification grade', () => {
    for (const value of knownValues('evidenceStrength')) {
      expect(resolveStatus('evidenceStrength', value).tone).toBe('neutral');
    }
  });

  it('`planned` is amber: registered is not available', () => {
    expect(resolveStatus('capability', 'planned').tone).toBe('attention');
  });
});
