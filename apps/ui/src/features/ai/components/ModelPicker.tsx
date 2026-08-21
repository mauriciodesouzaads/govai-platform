import { useId } from 'react';
import { useI18n } from '../../../lib/i18n/I18nProvider.js';
import { isApiError } from '../../../lib/contract/errors.js';
import type { MessageKey } from '../../../lib/i18n/catalogs/index.js';
import type { ProviderModel } from '../providers/models.js';

// The model field.
//
// ★ A SUGGESTION LIST, NOT A CONSTRAINT. The input is a free-text field with the provider's own
// listing attached as suggestions. Whatever the reader types is what gets sent — no rewriting,
// no nearest-match, no "did you mean". A provider can serve a model it does not enumerate, and
// a console that refuses to send an id the listing omits would make those models unreachable
// through GovAI for no reason of GovAI's own.
//
// ★ AND IT SAYS WHAT THE LIST DOES NOT MEAN. Being in `GET /v1/models` says the account can see
// the model; it does not say the model accepts the endpoint the reader selected. The hint
// states that in one line, and when the provider refuses, the reader gets the PROVIDER's error
// rather than a GovAI-invented compatibility verdict.
//
// `<datalist>` is used rather than a custom combobox: it is one element, it is keyboard- and
// screen-reader-native in every supported browser, and it cannot get the free-text semantics
// wrong the way a hand-rolled listbox usually does.

export type ModelPickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  models: readonly ProviderModel[];
  isLoading: boolean;
  error: unknown;
};

/** Why the listing is unavailable, as a fact rather than a generic failure. */
function listErrorKey(error: unknown): MessageKey {
  if (!isApiError(error)) return 'ai.model.listUnavailable';
  if (error.status === 502 && error.code === 'provider_credential_unresolvable') {
    return 'ai.model.listCredential';
  }
  if (error.status === 401) return 'ai.model.listRejected';
  if (error.kind === 'rate_limited') return 'ai.model.listRateLimited';
  return 'ai.model.listUnavailable';
}

export function ModelPicker({
  value,
  onChange,
  disabled,
  models,
  isLoading,
  error,
}: ModelPickerProps) {
  const { t } = useI18n();
  const inputId = useId();
  const listId = useId();
  const hintId = useId();

  return (
    <div className="flex min-w-[16rem] flex-1 flex-col gap-[var(--govai-space-1)]">
      <label
        htmlFor={inputId}
        className="text-[length:var(--govai-text-xs)] font-medium text-[var(--govai-text-secondary)]"
      >
        {t('ai.model')}
      </label>
      <input
        id={inputId}
        list={listId}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('ai.model.placeholder')}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={hintId}
        className="govai-mono w-full rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-2)] py-[var(--govai-space-1)] text-[length:var(--govai-text-sm)] disabled:bg-[var(--govai-bg-inset)] disabled:text-[var(--govai-text-secondary)]"
        data-testid="model-input"
      />
      <datalist id={listId} data-testid="model-suggestions">
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </datalist>
      <p
        id={hintId}
        className="max-w-prose text-[length:var(--govai-text-2xs)] text-[var(--govai-text-secondary)]"
      >
        {t('ai.model.hint')}
        {isLoading && (
          <>
            {' '}
            <span data-testid="model-list-loading">{t('ai.model.loading')}</span>
          </>
        )}
        {!isLoading && error !== null && error !== undefined && (
          <>
            {' '}
            <span data-testid="model-list-error">{t(listErrorKey(error))}</span>
          </>
        )}
        {!isLoading && (error === null || error === undefined) && models.length === 0 && (
          <>
            {' '}
            <span data-testid="model-list-empty">{t('ai.model.listEmpty')}</span>
          </>
        )}
      </p>
    </div>
  );
}
