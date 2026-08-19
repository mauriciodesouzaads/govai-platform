import { useId } from 'react';
import { useI18n } from '../../lib/i18n/I18nProvider.js';
import { WINDOW_OPTIONS } from '../../lib/window.js';
import { useEvidenceWindow } from './evidence-window-context.js';

// The measurement window is a top-level control because it is the measurement context of every
// number the evidence screens show — not a filter tucked into one page.

export function WindowSelector() {
  const { t } = useI18n();
  const { window: current, setWindow } = useEvidenceWindow();
  const id = useId();
  return (
    <div className="flex items-center gap-[var(--govai-space-2)]">
      <label
        htmlFor={id}
        className="text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]"
      >
        {t('window.label')}
      </label>
      <select
        id={id}
        value={current.id}
        onChange={(e) => setWindow(e.target.value)}
        className="govai-tabular rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-2)] py-[var(--govai-space-1)] text-[length:var(--govai-text-xs)]"
        data-testid="window-selector"
      >
        {WINDOW_OPTIONS.map((w) => (
          <option key={w.id} value={w.id}>
            {t(w.labelKey)}
          </option>
        ))}
      </select>
    </div>
  );
}
