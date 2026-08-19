import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n/I18nProvider.js';
import type { MessageKey } from '../lib/i18n/catalogs/index.js';
import { isApiError, type ApiErrorKind } from '../lib/contract/errors.js';

// Loading / empty / error, as three explicit states. A screen that shows nothing because a
// request is still in flight and a screen that shows nothing because there is nothing to show
// are different facts, and an evidence product must not conflate them.

export function LoadingSkeleton({ rows = 5, label }: { rows?: number; label?: string }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="space-y-[var(--govai-space-2)]"
      data-testid="loading-skeleton"
    >
      <span className="govai-sr-only">{label ?? t('table.loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-[var(--govai-row-height)] rounded-[var(--govai-radius-control)] bg-[var(--govai-bg-inset)]"
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title?: string;
  /** The honest reason. "No gaps were returned for this window" is a result;
   *  "everything is verified" is a claim, and never belongs here. */
  description: string;
}) {
  const { t } = useI18n();
  return (
    <div
      className="rounded-[var(--govai-radius-card)] border border-dashed border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] p-[var(--govai-space-6)]"
      data-testid="empty-state"
    >
      <p className="font-medium text-[var(--govai-text-primary)]">
        {title ?? t('state.empty.title')}
      </p>
      <p className="mt-[var(--govai-space-2)] max-w-prose text-[var(--govai-text-secondary)]">
        {description}
      </p>
    </div>
  );
}

const ERROR_MESSAGE_KEY: Record<ApiErrorKind, MessageKey> = {
  auth: 'state.error.auth',
  invalid_request: 'state.error.invalidRequest',
  forbidden: 'state.error.forbidden',
  not_found: 'state.error.notFound',
  conflict: 'state.error.conflict',
  rate_limited: 'state.error.rateLimited',
  server: 'state.error.server',
  network: 'state.error.network',
  malformed_response: 'state.error.malformedResponse',
  unknown: 'state.error.unknown',
};

/** Map any thrown value to a localized explanation. A non-ApiError is reported as unknown
 *  rather than having its raw message printed — raw messages are how internals leak. */
export function errorMessageKey(error: unknown): MessageKey {
  return isApiError(error) ? ERROR_MESSAGE_KEY[error.kind] : 'state.error.unknown';
}

export function ErrorState({
  error,
  onRetry,
  children,
}: {
  error: unknown;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const code = isApiError(error) ? error.code : null;
  const status = isApiError(error) ? error.status : null;
  // When the server advertised how long to wait, say so: the client deliberately did not
  // retry inside that window, so the reader needs the number.
  const retryAfter = isApiError(error) ? error.retryAfterSeconds : null;
  return (
    <div
      role="alert"
      className="rounded-[var(--govai-radius-card)] border border-[var(--govai-failure-border)] bg-[var(--govai-failure-bg)] p-[var(--govai-space-6)]"
      data-testid="error-state"
    >
      <p className="font-medium text-[var(--govai-failure-text)]">{t('state.error.title')}</p>
      <p className="mt-[var(--govai-space-2)] max-w-prose text-[var(--govai-text-primary)]">
        {t(errorMessageKey(error))}
      </p>
      {(status !== null || code !== null || retryAfter !== null) && (
        <p className="mt-[var(--govai-space-2)] govai-mono text-[var(--govai-text-secondary)]">
          {[
            status !== null ? `HTTP ${status}` : null,
            code,
            retryAfter !== null ? `retry-after: ${retryAfter}s` : null,
          ]
            .filter((part): part is string => part !== null)
            .join(' · ')}
        </p>
      )}
      {children}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-[var(--govai-space-4)] rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-3)] py-[var(--govai-space-1)] hover:bg-[var(--govai-bg-inset)]"
        >
          {t('state.error.retry')}
        </button>
      )}
    </div>
  );
}
