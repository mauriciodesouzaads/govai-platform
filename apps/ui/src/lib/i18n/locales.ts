// The supported locales. pt-BR is the product's primary language and the fallback: GovAI is a
// Brazil-first AI trust layer, and a missing key must degrade to the language the source
// vocabulary was authored in, never to a blank or to a key name.

export const LOCALES = ['pt-BR', 'en-US', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'pt-BR';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Native language names, shown in the language selector in their own language. */
export const LOCALE_NAMES: Record<Locale, string> = {
  'pt-BR': 'Português (Brasil)',
  'en-US': 'English (US)',
  es: 'Español',
};
