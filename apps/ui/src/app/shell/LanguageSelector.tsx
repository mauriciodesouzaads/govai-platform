import { useId } from 'react';
import { useI18n } from '../../lib/i18n/I18nProvider.js';
import { LOCALES, LOCALE_NAMES, isLocale } from '../../lib/i18n/locales.js';

// A native <select>: keyboard, screen-reader and mobile behaviour for free, and no dependency.
// Language names are written in their own language, which is how a reader finds theirs.

export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  const id = useId();
  return (
    <div className="flex items-center gap-[var(--govai-space-2)]">
      <label
        htmlFor={id}
        className="text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]"
      >
        {t('locale.label')}
      </label>
      <select
        id={id}
        value={locale}
        onChange={(e) => {
          if (isLocale(e.target.value)) setLocale(e.target.value);
        }}
        className="rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-2)] py-[var(--govai-space-1)] text-[length:var(--govai-text-xs)]"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
