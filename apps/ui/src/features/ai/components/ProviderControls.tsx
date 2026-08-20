import { useId } from 'react';
import { useI18n } from '../../../lib/i18n/I18nProvider.js';
import type { MessageKey } from '../../../lib/i18n/catalogs/index.js';
import {
  MODES,
  PROVIDERS,
  SURFACES_BY_PROVIDER,
  type ConsoleMode,
  type ProviderId,
  type SurfaceId,
} from '../providers/types.js';
import {
  ANTHROPIC_MAX_MAX_TOKENS,
  ANTHROPIC_MIN_MAX_TOKENS,
} from '../providers/anthropic-messages.js';
import type { ConversationConfig } from '../conversation/types.js';

// The transport controls.
//
// ★ THEY LOCK AFTER THE FIRST SEND. Provider, mode, surface and model are the identity of the
// conversation, not per-message options: an answer produced by one model on one route sitting
// above an answer produced by another, in one thread, is a transcript nobody can audit and a
// receipt history nobody can read. Once a turn has gone out they become read-only, and the
// reader changes them by starting a new conversation — which the button beside them does.

const PROVIDER_LABEL: Record<ProviderId, MessageKey> = {
  openai: 'ai.provider.openai',
  anthropic: 'ai.provider.anthropic',
};

const MODE_LABEL: Record<ConsoleMode, MessageKey> = {
  native_audited: 'ai.mode.native',
  governed: 'ai.mode.governed',
};

const SURFACE_LABEL: Record<SurfaceId, MessageKey> = {
  responses: 'ai.surface.responses',
  chat_completions: 'ai.surface.chatCompletions',
  messages: 'ai.surface.messages',
};

const FIELD =
  'rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-2)] py-[var(--govai-space-1)] text-[length:var(--govai-text-base)] disabled:bg-[var(--govai-bg-inset)] disabled:text-[var(--govai-text-secondary)]';
const LABEL =
  'text-[length:var(--govai-text-xs)] font-medium text-[var(--govai-text-secondary)]';

export function ProviderControls({
  config,
  locked,
  onChange,
  onNewConversation,
}: {
  config: ConversationConfig;
  locked: boolean;
  onChange: (patch: Partial<ConversationConfig>) => void;
  onNewConversation: () => void;
}) {
  const { t } = useI18n();
  const providerId = useId();
  const modeId = useId();
  const surfaceId = useId();
  const maxTokensId = useId();

  const surfaces = SURFACES_BY_PROVIDER[config.provider];
  const showAdvanced = config.provider === 'anthropic';

  return (
    <section
      aria-label={t('ai.controls.label')}
      className="flex flex-wrap items-end gap-x-[var(--govai-space-4)] gap-y-[var(--govai-space-3)] rounded-[var(--govai-radius-card)] border border-[var(--govai-border)] bg-[var(--govai-bg-surface)] px-[var(--govai-space-4)] py-[var(--govai-space-3)]"
      data-testid="provider-controls"
    >
      <div className="flex flex-col gap-[var(--govai-space-1)]">
        <label htmlFor={providerId} className={LABEL}>
          {t('ai.provider')}
        </label>
        <select
          id={providerId}
          className={FIELD}
          value={config.provider}
          disabled={locked}
          data-testid="provider-select"
          onChange={(e) => {
            const provider = e.target.value as ProviderId;
            // The surface set is provider-specific, so a provider change always resets the
            // surface to that provider's default rather than carrying an invalid pair.
            const first = SURFACES_BY_PROVIDER[provider][0] as SurfaceId;
            onChange({ provider, surface: first, model: '' });
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {t(PROVIDER_LABEL[p])}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-[var(--govai-space-1)]">
        <label htmlFor={modeId} className={LABEL}>
          {t('ai.mode')}
        </label>
        <select
          id={modeId}
          className={FIELD}
          value={config.mode}
          disabled={locked}
          data-testid="mode-select"
          onChange={(e) => onChange({ mode: e.target.value as ConsoleMode })}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {t(MODE_LABEL[m])}
            </option>
          ))}
        </select>
      </div>

      {surfaces.length > 1 && (
        <div className="flex flex-col gap-[var(--govai-space-1)]">
          <label htmlFor={surfaceId} className={LABEL}>
            {t('ai.surface')}
          </label>
          <select
            id={surfaceId}
            className={FIELD}
            value={config.surface}
            disabled={locked}
            data-testid="surface-select"
            onChange={(e) => onChange({ surface: e.target.value as SurfaceId })}
          >
            {surfaces.map((s) => (
              <option key={s} value={s}>
                {t(SURFACE_LABEL[s])}
              </option>
            ))}
          </select>
        </div>
      )}

      {surfaces.length === 1 && (
        <div className="flex flex-col gap-[var(--govai-space-1)]">
          <span className={LABEL}>{t('ai.surface')}</span>
          <span
            className="px-[var(--govai-space-1)] py-[var(--govai-space-1)] text-[length:var(--govai-text-base)]"
            data-testid="surface-fixed"
          >
            {t(SURFACE_LABEL[config.surface])}
          </span>
        </div>
      )}

      {showAdvanced && (
        <details className="min-w-[12rem]" data-testid="advanced-disclosure">
          <summary className="cursor-pointer text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
            {t('ai.advanced')}
          </summary>
          <div className="mt-[var(--govai-space-2)] flex flex-col gap-[var(--govai-space-1)]">
            <label htmlFor={maxTokensId} className={LABEL}>
              {t('ai.maxTokens')}
            </label>
            <input
              id={maxTokensId}
              type="number"
              inputMode="numeric"
              min={ANTHROPIC_MIN_MAX_TOKENS}
              max={ANTHROPIC_MAX_MAX_TOKENS}
              className={`${FIELD} govai-tabular w-[8rem]`}
              value={config.maxTokens}
              disabled={locked}
              data-testid="max-tokens-input"
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!Number.isFinite(next)) return;
                onChange({
                  maxTokens: Math.min(
                    ANTHROPIC_MAX_MAX_TOKENS,
                    Math.max(ANTHROPIC_MIN_MAX_TOKENS, Math.trunc(next)),
                  ),
                });
              }}
            />
            <p className="max-w-[18rem] text-[length:var(--govai-text-2xs)] text-[var(--govai-text-secondary)]">
              {t('ai.maxTokens.hint')}
            </p>
          </div>
        </details>
      )}

      <div className="ml-auto flex items-center gap-[var(--govai-space-3)]">
        {locked && (
          <span
            className="max-w-[20rem] text-[length:var(--govai-text-2xs)] text-[var(--govai-text-secondary)]"
            data-testid="controls-locked-note"
          >
            {t('ai.locked')}
          </span>
        )}
        <button
          type="button"
          onClick={onNewConversation}
          className="rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] px-[var(--govai-space-3)] py-[var(--govai-space-1)] text-[length:var(--govai-text-xs)] hover:bg-[var(--govai-bg-inset)]"
          data-testid="new-conversation"
        >
          {t('ai.newConversation')}
        </button>
      </div>
    </section>
  );
}
