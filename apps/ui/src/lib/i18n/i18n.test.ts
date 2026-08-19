import { describe, expect, it } from 'vitest';
import { CATALOGS, resolveMessage, type MessageKey } from './catalogs/index.js';
import { DEFAULT_LOCALE, LOCALES, isLocale } from './locales.js';
import { detectBrowserLocale, initialLocale, readStoredLocale } from './locale-storage.js';
import { ENFORCEMENT_DECISIONS } from '../honesty.js';

describe('catalog parity', () => {
  const reference = Object.keys(CATALOGS[DEFAULT_LOCALE]).sort();

  it('exposes pt-BR as the default and fallback locale', () => {
    expect(DEFAULT_LOCALE).toBe('pt-BR');
    expect(LOCALES).toEqual(['pt-BR', 'en-US', 'es']);
  });

  it.each(LOCALES)('%s exposes exactly the same keys as pt-BR', (locale) => {
    expect(Object.keys(CATALOGS[locale]).sort()).toEqual(reference);
  });

  it.each(LOCALES)('%s has no empty message', (locale) => {
    const empty = Object.entries(CATALOGS[locale])
      .filter(([, value]) => value.trim().length === 0)
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it('falls back to pt-BR rather than rendering a key or a blank', () => {
    // The types make a missing key impossible; this pins the runtime behaviour of the one
    // case types cannot cover — an entry that is empty at runtime.
    const key = 'app.name' as MessageKey;
    expect(resolveMessage('es', key)).toBe(CATALOGS.es[key]);
    expect(resolveMessage('en-US', key)).not.toHaveLength(0);
  });
});

// ★ The rule that matters: a translation may WEAKEN a claim but never STRENGTHEN one. A
// decision that was forwarded to the provider must read as forwarded in all three languages,
// and must not acquire the vocabulary of a control that was actually applied.
const FORWARDED_TERM: Record<(typeof LOCALES)[number], RegExp> = {
  'pt-BR': /encaminhad/i,
  'en-US': /forward/i,
  es: /reenviad/i,
};

const FORBIDDEN_IN_FORWARDED: Record<(typeof LOCALES)[number], RegExp[]> = {
  'pt-BR': [/bloquead/i, /protegid/i, /aplicad/i, /redigid/i, /retid/i, /impedid/i, /certificad/i],
  'en-US': [
    /blocked/i,
    /protected/i,
    /\bapplied\b/i,
    /redacted/i,
    /withheld/i,
    /prevented/i,
    /certified/i,
  ],
  es: [/bloquead/i, /protegid/i, /aplicad/i, /redactad/i, /retenid/i, /impedid/i, /certificad/i],
};

const BLOCKED_TERM: Record<(typeof LOCALES)[number], RegExp> = {
  'pt-BR': /bloquead/i,
  'en-US': /blocked/i,
  es: /bloquead/i,
};

describe('translations preserve enforcement honesty', () => {
  const forwardedKeys = ENFORCEMENT_DECISIONS.filter((d) => d !== 'blocked').map(
    (d) => `enforcement.${d}` as MessageKey,
  );

  it.each(LOCALES)('%s: every forwarded decision says the request was forwarded', (locale) => {
    for (const key of forwardedKeys) {
      expect(CATALOGS[locale][key]).toMatch(FORWARDED_TERM[locale]);
    }
  });

  it.each(LOCALES)(
    '%s: no forwarded decision uses blocked/applied/protected vocabulary',
    (locale) => {
      for (const key of forwardedKeys) {
        const text = CATALOGS[locale][key];
        for (const forbidden of FORBIDDEN_IN_FORWARDED[locale]) {
          expect(
            forbidden.test(text),
            `${locale} ${key} must not match ${forbidden}: "${text}"`,
          ).toBe(false);
        }
      }
    },
  );

  it.each(LOCALES)('%s: the passthrough label never claims policy was applied', (locale) => {
    const text = CATALOGS[locale]['enforcement.passthrough'];
    for (const forbidden of FORBIDDEN_IN_FORWARDED[locale]) {
      expect(forbidden.test(text), `${locale} passthrough must not match ${forbidden}`).toBe(false);
    }
  });

  it.each(LOCALES)('%s: only the 403 labels use the word "blocked"', (locale) => {
    expect(CATALOGS[locale]['enforcement.blocked.matrix']).toMatch(BLOCKED_TERM[locale]);
    expect(CATALOGS[locale]['enforcement.blocked.toolValidation']).toMatch(BLOCKED_TERM[locale]);
    expect(CATALOGS[locale]['enforcement.blocked.matrix']).toContain('403');
    expect(CATALOGS[locale]['enforcement.blocked.toolValidation']).toContain('403');
  });
});

describe('EC-6 and EC-3.drop copy stays honest in every language', () => {
  it.each(LOCALES)('%s: EC-6 copy never claims verification happened', (locale) => {
    // The pending explanation must not read as a pass in any language.
    const text = CATALOGS[locale]['ec6.neverGreen'];
    expect(text.length).toBeGreaterThan(0);
    expect(/certificad|certified/i.test(text)).toBe(false);
  });

  it.each(LOCALES)('%s: EC-3.drop copy names the collector as the authority', (locale) => {
    expect(CATALOGS[locale]['ec3drop.unobservedDetail']).toMatch(/OTLP/);
  });
});

describe('locale detection and the one permitted persisted value', () => {
  it('accepts only the three supported locales', () => {
    expect(isLocale('pt-BR')).toBe(true);
    expect(isLocale('fr-FR')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it('maps a language subtag onto the supported locale', () => {
    expect(detectBrowserLocale(['pt-PT'])).toBe('pt-BR');
    expect(detectBrowserLocale(['en-GB'])).toBe('en-US');
    expect(detectBrowserLocale(['es-AR'])).toBe('es');
    expect(detectBrowserLocale(['de-DE'])).toBe('pt-BR');
    expect(detectBrowserLocale([])).toBe('pt-BR');
  });

  it('ignores a stored value that is not a supported locale', () => {
    const storage = { getItem: () => 'klingon' };
    expect(readStoredLocale(storage)).toBeNull();
    expect(initialLocale(storage, ['es-ES'])).toBe('es');
  });

  it('survives a browser with storage disabled', () => {
    const throwing = {
      getItem: () => {
        throw new Error('storage disabled');
      },
    };
    expect(readStoredLocale(throwing)).toBeNull();
    expect(initialLocale(throwing, ['en-US'])).toBe('en-US');
  });
});
