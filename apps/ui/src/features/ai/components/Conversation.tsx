import { useI18n } from '../../../lib/i18n/I18nProvider.js';
import { MessageTurn } from './MessageTurn.js';
import { isRetryable } from '../conversation/reducer.js';
import type { ConversationState } from '../conversation/types.js';

// The transcript.
//
// ★ ACCESSIBILITY OF A STREAM. The assistant's words are ordinary document content and are NOT
// inside a live region: announcing every token would make a screen reader unusable for exactly
// the readers who most need the answer to arrive in one piece. What IS announced is one polite
// status line — "generating", then the termination — so a non-sighted reader knows the phase
// without being read the answer character by character. They then navigate to the answer and
// read it as text, which is how they would read any other document.

export function Conversation({
  state,
  onRetry,
}: {
  state: ConversationState;
  onRetry: (turnId: string) => void;
}) {
  const { t } = useI18n();
  const busy = state.inFlight !== null;

  return (
    <section aria-label={t('ai.conversation.label')} data-testid="conversation">
      {/* One polite status for the whole conversation. Deliberately outside the transcript. */}
      <p role="status" aria-live="polite" className="govai-sr-only" data-testid="conversation-status">
        {busy ? t('ai.generating') : ''}
      </p>

      {state.turns.length === 0 ? (
        <div
          className="rounded-[var(--govai-radius-card)] border border-dashed border-[var(--govai-border-strong)] bg-[var(--govai-bg-surface)] p-[var(--govai-space-6)]"
          data-testid="conversation-empty"
        >
          <p className="font-medium text-[var(--govai-text-primary)]">{t('ai.empty.title')}</p>
          <p className="mt-[var(--govai-space-2)] max-w-prose text-[var(--govai-text-secondary)]">
            {t('ai.empty.description')}
          </p>
        </div>
      ) : (
        <div>
          {state.turns.map((turn) => (
            <MessageTurn
              key={turn.id}
              turn={turn}
              canRetry={!busy && isRetryable(turn)}
              onRetry={() => onRetry(turn.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
