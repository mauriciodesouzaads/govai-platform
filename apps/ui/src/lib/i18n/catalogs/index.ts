import type { Catalog, MessageKey } from './pt-BR.js';
import { ptBR } from './pt-BR.js';
import { enUS } from './en-US.js';
import { es } from './es.js';
import { DEFAULT_LOCALE, type Locale } from '../locales.js';

export type { Catalog, MessageKey };

export const CATALOGS: Record<Locale, Catalog> = {
  'pt-BR': ptBR,
  'en-US': enUS,
  es,
};

/**
 * Resolve a message. The catalogs are typed as `Record<MessageKey, string>`, so a missing key
 * is a compile error; the runtime fallback chain exists for the one case types cannot cover —
 * a catalog entry that is somehow empty at runtime. It degrades to pt-BR (the language the
 * normative vocabulary is authored in), and only then to the key itself, so a defect surfaces
 * as a visibly wrong string rather than as blank space in an evidence screen.
 */
export function resolveMessage(locale: Locale, key: MessageKey): string {
  const value = CATALOGS[locale][key];
  if (value.length > 0) return value;
  const fallback = CATALOGS[DEFAULT_LOCALE][key];
  return fallback.length > 0 ? fallback : key;
}
