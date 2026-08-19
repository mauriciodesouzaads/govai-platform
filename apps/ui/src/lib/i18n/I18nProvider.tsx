import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { resolveMessage, type MessageKey } from './catalogs/index.js';
import { DEFAULT_LOCALE, type Locale } from './locales.js';
import { initialLocale, writeStoredLocale } from './locale-storage.js';

export type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Translate a key. Typed against the pt-BR catalog, so an unknown key is a compile error. */
  t: (key: MessageKey) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function I18nProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /** Tests inject a deterministic starting locale; the app detects it. */
  initial?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (initial) return initial;
    if (typeof window === 'undefined') return DEFAULT_LOCALE;
    return initialLocale(safeStorage(), window.navigator.languages ?? []);
  });

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStoredLocale(safeStorage(), next);
  }, []);

  // Keep the document language in sync so assistive technology announces the page in the
  // language it is actually written in.
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: (key: MessageKey) => resolveMessage(locale, key) }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
