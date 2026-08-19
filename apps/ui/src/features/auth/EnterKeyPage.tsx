import { useCallback, useId, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useI18n } from '../../lib/i18n/I18nProvider.js';
import { useSession } from '../../lib/session/SessionProvider.js';
import { isApiError, type ApiErrorKind } from '../../lib/contract/errors.js';
import type { MessageKey } from '../../lib/i18n/catalogs/index.js';
import { LanguageSelector } from '../../app/shell/LanguageSelector.js';

// /enter — the U1 access screen.
//
// ★ This is NOT production human authentication. There is no user account, no password, no
// session cookie and no key lifecycle: the reader pastes the organization's GovAI API key, the
// UI validates it against a real authenticated read, and it lives in this tab's memory until
// the tab is reloaded or the session is ended. The copy says exactly that, because a reader
// who mistakes this for a login would mistake the product's maturity too.
//
// The key is handled here and nowhere else in this component tree:
//   • the input is type="password", autoComplete="off", spellCheck={false};
//   • the value is cleared from the input (and therefore the DOM) the moment it is accepted;
//   • it is never routed, never stored, never logged, never put in a query key.

const ERROR_KEY: Record<ApiErrorKind, MessageKey> = {
  auth: 'enter.error.auth',
  network: 'enter.error.network',
  rate_limited: 'enter.error.rateLimited',
  server: 'enter.error.server',
  invalid_request: 'enter.error.unknown',
  forbidden: 'enter.error.auth',
  not_found: 'enter.error.unknown',
  conflict: 'enter.error.unknown',
  malformed_response: 'enter.error.unknown',
  unknown: 'enter.error.unknown',
};

export function EnterKeyPage() {
  const { t } = useI18n();
  const { signIn, isAuthenticated } = useSession();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting'>('idle');
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorKey(null);
      const candidate = value.trim();
      if (candidate.length === 0) {
        setErrorKey('enter.error.empty');
        inputRef.current?.focus();
        return;
      }
      setStatus('submitting');
      try {
        await signIn(candidate);
        // Clear the field BEFORE navigating: the credential must not survive in the DOM of a
        // component that may stay mounted through the transition.
        setValue('');
        navigate('/', { replace: true });
      } catch (err) {
        setErrorKey(ERROR_KEY[isApiError(err) ? err.kind : 'unknown']);
        inputRef.current?.focus();
      } finally {
        setStatus('idle');
      }
    },
    [navigate, signIn, value],
  );

  if (isAuthenticated) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--govai-bg-app)]">
      <header className="border-b border-[var(--govai-border)] bg-[var(--govai-bg-surface)]">
        <div className="mx-auto flex w-full max-w-[var(--govai-content-max)] items-center justify-between px-[var(--govai-space-6)] py-[var(--govai-space-3)]">
          <span className="text-[length:var(--govai-text-md)] font-semibold tracking-tight">
            {t('app.name')}
          </span>
          <LanguageSelector />
        </div>
      </header>

      <main
        id="main"
        className="mx-auto flex w-full max-w-[36rem] flex-1 flex-col justify-center px-[var(--govai-space-6)] py-[var(--govai-space-8)]"
      >
        <h1 className="text-[length:var(--govai-text-lg)] font-semibold tracking-tight">
          {t('enter.title')}
        </h1>
        <p className="mt-[var(--govai-space-2)] text-[var(--govai-text-secondary)]">
          {t('enter.lead')}
        </p>

        <form onSubmit={onSubmit} className="mt-[var(--govai-space-6)]" noValidate>
          <label htmlFor={inputId} className="block font-medium">
            {t('enter.keyLabel')}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="password"
            name="govai-api-key"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-describedby={errorKey ? `${hintId} ${errorId}` : hintId}
            aria-invalid={errorKey ? true : undefined}
            className="govai-mono mt-[var(--govai-space-2)] w-full rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-3)] py-[var(--govai-space-2)] text-[length:var(--govai-text-base)]"
            data-testid="api-key-input"
          />
          <p
            id={hintId}
            className="mt-[var(--govai-space-2)] text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]"
          >
            {t('enter.keyHint')}
          </p>

          {errorKey && (
            <p
              id={errorId}
              role="alert"
              className="mt-[var(--govai-space-3)] rounded-[var(--govai-radius-control)] border border-[var(--govai-failure-border)] bg-[var(--govai-failure-bg)] px-[var(--govai-space-3)] py-[var(--govai-space-2)] text-[var(--govai-failure-text)]"
              data-testid="enter-error"
            >
              {t(errorKey)}
            </p>
          )}

          <button
            type="submit"
            disabled={status === 'submitting'}
            className="mt-[var(--govai-space-4)] w-full rounded-[var(--govai-radius-control)] border border-[var(--govai-brand)] bg-[var(--govai-brand)] px-[var(--govai-space-4)] py-[var(--govai-space-2)] font-medium text-[var(--govai-brand-contrast)] hover:bg-[var(--govai-brand-hover)] disabled:opacity-70"
            data-testid="enter-submit"
          >
            {status === 'submitting' ? t('enter.submitting') : t('enter.submit')}
          </button>
        </form>

        <div className="mt-[var(--govai-space-8)] space-y-[var(--govai-space-3)] border-t border-[var(--govai-border)] pt-[var(--govai-space-4)] text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
          <p>{t('enter.probeNote')}</p>
          <p data-testid="enter-no-production-auth">{t('enter.noProductionAuth')}</p>
        </div>
      </main>
    </div>
  );
}
