import { useI18n } from '../../../lib/i18n/I18nProvider.js';
import type { MessageKey } from '../../../lib/i18n/catalogs/index.js';
import { ToneBadge } from '../../../components/StatusBadge.js';
import { AssistantMarkdown } from '../markdown/AssistantMarkdown.js';
import { InteractionReceipt, STATE_LABEL } from './InteractionReceipt.js';
import { commitsContext, type Attempt, type Turn, type TurnState } from '../conversation/types.js';
import { isEmptyProviderError, type SafeProviderError } from '../providers/errors.js';

// One exchange: what the reader asked, and every attempt at answering it.
//
// The conversation stays readable — an assistant answer is prose, not an audit row. What the
// governance product adds sits BESIDE the answer: a one-line termination badge, and a
// collapsed Interaction Receipt for the reader who wants the transport facts. Nothing about
// compliance is injected INTO the answer text, which is the model's, unedited.

/** The explanatory line under a non-successful attempt. Each states the fact, not a verdict. */
const STATE_NOTE: Partial<Record<TurnState, MessageKey>> = {
  stopped: 'ai.state.stopped.note',
  blocked: 'ai.state.blocked.note',
  provider_error: 'ai.state.providerError.note',
  rate_limited: 'ai.state.rateLimited.note',
  credential_unavailable: 'ai.state.credentialUnavailable.note',
  network_error: 'ai.state.networkError.note',
  unknown_outcome: 'ai.state.unknownOutcome.note',
};

function ProviderErrorDetail({ error }: { error: SafeProviderError }) {
  const { t } = useI18n();
  if (isEmptyProviderError(error)) return null;
  const parts = [error.type, error.code].filter((p): p is string => p !== null);
  return (
    <div
      className="mt-[var(--govai-space-2)] rounded-[var(--govai-radius-control)] border border-[var(--govai-border)] bg-[var(--govai-bg-inset)] px-[var(--govai-space-3)] py-[var(--govai-space-2)] text-[length:var(--govai-text-xs)]"
      data-testid="provider-error-detail"
    >
      <p className="font-medium text-[var(--govai-text-secondary)]">{t('ai.error.providerSaid')}</p>
      {parts.length > 0 && (
        <p className="govai-mono mt-[2px] text-[var(--govai-text-primary)]">{parts.join(' · ')}</p>
      )}
      {error.message !== null && (
        <p className="mt-[2px] max-w-prose break-words text-[var(--govai-text-primary)]">
          {error.message}
        </p>
      )}
    </div>
  );
}

function AttemptBody({ attempt, isLast }: { attempt: Attempt; isLast: boolean }) {
  const { t } = useI18n();
  const label = STATE_LABEL[attempt.state];
  const noteKey = STATE_NOTE[attempt.state];
  const streaming = attempt.state === 'submitting' || attempt.state === 'streaming';
  // Two different reasons an answer stays out of the context, and the reader is told which:
  // the provider did not finish it, or it is a retry of an earlier turn whose successors were
  // already answered without it.
  const completed = commitsContext(attempt.state);
  const excludedBecauseUnfinished = !streaming && !completed;
  const excludedBecauseOutOfOrder = completed && !attempt.eligibleForContext;
  const excludedFromContext = excludedBecauseUnfinished || excludedBecauseOutOfOrder;

  return (
    <div
      className={`${isLast ? '' : 'opacity-70'} border-l-2 border-[var(--govai-border)] pl-[var(--govai-space-3)]`}
      data-testid="attempt"
      data-attempt-state={attempt.state}
    >
      <div className="flex flex-wrap items-center gap-[var(--govai-space-2)]">
        <span className="text-[length:var(--govai-text-xs)] font-semibold text-[var(--govai-text-secondary)]">
          {t('ai.assistant')}
        </span>
        {!streaming && (
          <ToneBadge tone={label.tone} data-testid="attempt-state-badge">
            {t(label.key)}
          </ToneBadge>
        )}
        {attempt.state === 'streaming' && (
          <span
            className="text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]"
            data-testid="attempt-streaming"
          >
            {t('ai.generating')}
          </span>
        )}
      </div>

      {attempt.text.length > 0 && (
        <div className="mt-[var(--govai-space-2)]">
          <AssistantMarkdown text={attempt.text} />
        </div>
      )}

      {attempt.refusal !== null && attempt.refusal.length > 0 && (
        <div
          className="mt-[var(--govai-space-2)] rounded-[var(--govai-radius-control)] border border-[var(--govai-attention-border)] bg-[var(--govai-attention-bg)] px-[var(--govai-space-3)] py-[var(--govai-space-2)] text-[length:var(--govai-text-xs)]"
          data-testid="attempt-refusal"
        >
          <p className="font-medium text-[var(--govai-attention-text)]">{t('ai.refusal')}</p>
          <p className="mt-[2px] max-w-prose break-words text-[var(--govai-text-primary)]">
            {attempt.refusal}
          </p>
        </div>
      )}

      {attempt.unsupportedOutput && (
        <p
          className="mt-[var(--govai-space-2)] max-w-prose text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]"
          data-testid="attempt-unsupported-output"
        >
          {t('ai.unsupportedOutput')}
        </p>
      )}

      {noteKey && (
        <p
          className="mt-[var(--govai-space-2)] max-w-prose text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]"
          data-testid="attempt-state-note"
        >
          {t(noteKey)}
          {attempt.retryAfterSeconds !== null && (
            <>
              {' '}
              <span className="govai-mono" data-testid="attempt-retry-after">
                {t('ai.state.retryAfter').replace('{seconds}', String(attempt.retryAfterSeconds))}
              </span>
            </>
          )}
        </p>
      )}

      {attempt.error !== null && <ProviderErrorDetail error={attempt.error} />}

      {excludedFromContext && attempt.text.length > 0 && (
        <p
          className="mt-[var(--govai-space-2)] max-w-prose text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]"
          data-testid="attempt-context-excluded"
          data-context-excluded-reason={excludedBecauseOutOfOrder ? 'out-of-order' : 'unfinished'}
        >
          {t(excludedBecauseOutOfOrder ? 'ai.contextExcluded.outOfOrder' : 'ai.contextExcluded')}
        </p>
      )}

      {attempt.receipt !== null && <InteractionReceipt receipt={attempt.receipt} />}
    </div>
  );
}

export function MessageTurn({
  turn,
  canRetry,
  onRetry,
}: {
  turn: Turn;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <article
      className="border-b border-[var(--govai-border)] py-[var(--govai-space-5)] last:border-b-0"
      data-testid="turn"
    >
      <div>
        <p className="text-[length:var(--govai-text-xs)] font-semibold text-[var(--govai-text-secondary)]">
          {t('ai.you')}
        </p>
        <p
          className="mt-[var(--govai-space-1)] whitespace-pre-wrap break-words text-[length:var(--govai-text-base)] text-[var(--govai-text-primary)]"
          data-testid="turn-user-text"
        >
          {turn.userText}
        </p>
      </div>

      <div className="mt-[var(--govai-space-4)] space-y-[var(--govai-space-4)]">
        {turn.attempts.map((attempt, index) => (
          <AttemptBody
            key={attempt.id}
            attempt={attempt}
            isLast={index === turn.attempts.length - 1}
          />
        ))}
      </div>

      {canRetry && (
        <div className="mt-[var(--govai-space-3)]">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-[var(--govai-radius-control)] border border-[var(--govai-border-strong)] px-[var(--govai-space-3)] py-[var(--govai-space-1)] text-[length:var(--govai-text-xs)] hover:bg-[var(--govai-bg-inset)]"
            data-testid="retry-turn"
          >
            {t('ai.retry')}
          </button>
          <p className="mt-[var(--govai-space-1)] max-w-prose text-[length:var(--govai-text-2xs)] text-[var(--govai-text-secondary)]">
            {t('ai.retry.note')}
          </p>
        </div>
      )}
    </article>
  );
}
