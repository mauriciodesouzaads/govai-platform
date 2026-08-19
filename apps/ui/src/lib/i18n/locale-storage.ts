// The ONE thing this application persists in the browser: the reader's chosen language.
//
// Nothing else is ever written to localStorage, sessionStorage, IndexedDB or a cookie — not
// the API key, not a token, not a response body. The whitelist is this single key, and the
// value is validated on read so a hand-edited entry cannot select a locale that does not exist.

import { DEFAULT_LOCALE, isLocale, type Locale } from './locales.js';

export const LOCALE_STORAGE_KEY = 'govai.ui.locale';

/** Detect the reader's preferred locale from the browser, falling back to pt-BR. Matches on
 *  the language subtag so `pt`, `pt-PT` and `pt-BR` all land on pt-BR. */
export function detectBrowserLocale(languages: readonly string[]): Locale {
  for (const raw of languages) {
    if (isLocale(raw)) return raw;
    const base = raw.split('-')[0]?.toLowerCase();
    if (base === 'pt') return 'pt-BR';
    if (base === 'en') return 'en-US';
    if (base === 'es') return 'es';
  }
  return DEFAULT_LOCALE;
}

export function readStoredLocale(storage: Pick<Storage, 'getItem'> | null): Locale | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    // A browser with storage disabled must not break the application; the locale simply
    // stops persisting across reloads.
    return null;
  }
}

export function writeStoredLocale(
  storage: Pick<Storage, 'setItem'> | null,
  locale: Locale,
): void {
  if (!storage) return;
  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignored for the same reason as above.
  }
}

/** The initial locale: an explicit stored choice wins over browser detection. */
export function initialLocale(
  storage: Pick<Storage, 'getItem'> | null,
  languages: readonly string[],
): Locale {
  return readStoredLocale(storage) ?? detectBrowserLocale(languages);
}
