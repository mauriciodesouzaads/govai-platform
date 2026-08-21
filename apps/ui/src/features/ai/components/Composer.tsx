import { useCallback, useId, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useI18n } from '../../../lib/i18n/I18nProvider.js';

// The composer.
//
// Keyboard contract: Enter sends, Shift+Enter inserts a newline, and Cmd/Ctrl+Enter also
// sends (the habit many readers bring from other tools, and it conflicts with nothing here).
// While a turn is in flight the primary control becomes Stop, which is a real control and not
// a disabled Send with a spinner: the ability to stop a generation is the one thing a reader
// reaches for most urgently, and hiding it behind the busy state is how a console starts
// burning tokens the reader has already given up on.
//
// ★ NO CLIENT-SIDE LENGTH CEILING. The provider owns context limits and answers precisely when
// they are exceeded; a number invented here would reject prompts the provider would have
// accepted. A soft warning appears for an unusually large prompt — the reader is told, and the
// reader decides.

/** Where a prompt becomes big enough to be worth mentioning. Not a limit — a remark. */
export const LARGE_PROMPT_WARNING_CHARS = 100_000;

export type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  /** False while the configuration is incomplete (no model chosen yet). */
  canSend: boolean;
};

export function Composer({ value, onChange, onSend, onStop, busy, canSend }: ComposerProps) {
  const { t } = useI18n();
  const textareaId = useId();
  const hintId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(() => {
    if (busy || !canSend) return;
    if (value.trim().length === 0) return;
    onSend();
  }, [busy, canSend, onSend, value]);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submit();
    },
    [submit],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter') return;
      // Shift+Enter is a newline and must stay one.
      if (event.shiftKey) return;
      // Enter, and Cmd/Ctrl+Enter, both send.
      event.preventDefault();
      submit();
    },
    [submit],
  );

  const empty = value.trim().length === 0;
  const oversized = value.length >= LARGE_PROMPT_WARNING_CHARS;

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[var(--govai-radius-card)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] p-[var(--govai-space-3)]"
      data-testid="composer"
    >
      <label htmlFor={textareaId} className="govai-sr-only">
        {t('ai.composer.label')}
      </label>
      <textarea
        id={textareaId}
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder={t('ai.composer.placeholder')}
        aria-describedby={hintId}
        className="w-full resize-y bg-transparent text-[length:var(--govai-text-base)] leading-relaxed text-[var(--govai-text-primary)] outline-none"
        data-testid="composer-input"
      />
      <div className="mt-[var(--govai-space-2)] flex flex-wrap items-center justify-between gap-[var(--govai-space-2)]">
        <p
          id={hintId}
          className="text-[length:var(--govai-text-2xs)] text-[var(--govai-text-secondary)]"
        >
          {t('ai.composer.hint')}
          {oversized && (
            <>
              {' '}
              <span data-testid="composer-large-warning">{t('ai.composer.largeInput')}</span>
            </>
          )}
        </p>
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-4)] py-[var(--govai-space-1)] font-medium hover:bg-[var(--govai-bg-inset)]"
            data-testid="composer-stop"
          >
            {t('ai.stop')}
          </button>
        ) : (
          <button
            type="submit"
            disabled={empty || !canSend}
            className="rounded-[var(--govai-radius-control)] border border-[var(--govai-brand)] bg-[var(--govai-brand)] px-[var(--govai-space-4)] py-[var(--govai-space-1)] font-medium text-[var(--govai-brand-contrast)] hover:bg-[var(--govai-brand-hover)] disabled:opacity-60"
            data-testid="composer-send"
          >
            {t('ai.send')}
          </button>
        )}
      </div>
    </form>
  );
}
