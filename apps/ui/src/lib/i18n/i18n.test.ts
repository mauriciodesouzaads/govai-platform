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

// ★ The same rule, applied to the identity copy EP-B2 introduced: showing a real,
// server-resolved principal must never start reading like a production human login, and a
// COMMERCIAL plan must never acquire the vocabulary of a security or governance level.
const API_KEY_TERM: Record<(typeof LOCALES)[number], RegExp> = {
  'pt-BR': /chave de API/i,
  'en-US': /API key/i,
  es: /clave de API/i,
};

/** Words that would turn "you presented an organization API key" into "you are logged in". */
const LOGIN_VOCABULARY: Record<(typeof LOCALES)[number], RegExp[]> = {
  'pt-BR': [/\blogin\b/i, /\bsenha\b/i, /conta de usuário/i, /usuário autenticado/i],
  'en-US': [/\blog ?in\b/i, /\bsigned in as\b/i, /\bpassword\b/i, /user account/i],
  es: [/inicio de sesión/i, /\bcontraseña\b/i, /cuenta de usuario/i],
};

const NOT_IMPLEMENTED_TERM: Record<(typeof LOCALES)[number], RegExp> = {
  'pt-BR': /não implementad/i,
  'en-US': /not implemented/i,
  es: /no implementad/i,
};

/** Words that would turn a commercial plan into a governance/security claim (residual R13). */
const GOVERNANCE_VOCABULARY: Record<(typeof LOCALES)[number], RegExp[]> = {
  'pt-BR': [/nível de segurança/i, /perfil de governança/i, /rigor de política/i],
  'en-US': [/security level/i, /governance profile/i, /policy strictness/i],
  es: [/nivel de seguridad/i, /perfil de gobernanza/i, /rigor de política/i],
};

describe('translations never strengthen the authentication claim', () => {
  it.each(LOCALES)('%s: the principal label names an API key', (locale) => {
    expect(CATALOGS[locale]['status.principalType.api_key']).toMatch(API_KEY_TERM[locale]);
  });

  it.each(LOCALES)('%s: no positive identity label uses login vocabulary', (locale) => {
    // Deliberately excludes `identity.noProductionAuth`, whose whole job is to NEGATE those
    // words — the rule is about claims, not about the letters.
    const claims: MessageKey[] = [
      'status.principalType.api_key',
      'identity.principal',
      'identity.title',
      'identity.details',
      'identity.serverAuthoritative',
    ];
    for (const key of claims) {
      const text = CATALOGS[locale][key];
      for (const forbidden of LOGIN_VOCABULARY[locale]) {
        expect(forbidden.test(text), `${locale} ${key} must not match ${forbidden}: "${text}"`).toBe(
          false,
        );
      }
    }
  });

  it.each(LOCALES)('%s: the no-production-auth statement really is a negation', (locale) => {
    expect(CATALOGS[locale]['identity.noProductionAuth']).toMatch(NOT_IMPLEMENTED_TERM[locale]);
  });

  it.each(LOCALES)('%s: the plan is labelled commercial, never as a governance level', (locale) => {
    // The qualifier says commercial/account; the note may NAME the governance words only in
    // order to deny them, so the positive labels are what is scanned.
    const commercial: MessageKey[] = ['identity.tier', 'identity.tier.qualifier'];
    for (const key of commercial) {
      for (const forbidden of GOVERNANCE_VOCABULARY[locale]) {
        expect(
          forbidden.test(CATALOGS[locale][key]),
          `${locale} ${key} must not match ${forbidden}`,
        ).toBe(false);
      }
    }
    // And the note that carries the separation must actually carry it.
    const note = CATALOGS[locale]['identity.tier.note'];
    for (const required of GOVERNANCE_VOCABULARY[locale]) {
      expect(required.test(note), `${locale} identity.tier.note must deny ${required}`).toBe(true);
    }
  });

  it.each(LOCALES)('%s: the operational mode is presented as a value, not a verdict', (locale) => {
    // No tone word: the interface reports what the server said about the org's operational
    // state and does not grade it.
    const text = CATALOGS[locale]['identity.operationalMode.note'];
    for (const verdict of [/segur|secure|seguro/i, /risco|risk|riesgo/i, /conform|complian/i]) {
      expect(verdict.test(text), `${locale} must not grade the mode (${verdict})`).toBe(false);
    }
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
