import { useI18n } from '../../../lib/i18n/I18nProvider.js';
import { MessageTurn } from './MessageTurn.js';
import { STATE_LABEL } from './InteractionReceipt.js';
import { isRetryable } from '../conversation/reducer.js';
import { isTerminalState, type ConversationState } from '../conversation/types.js';

// The transcript.
//
// ★ ACCESSIBILITY OF A STREAM. The assistant's words are ordinary document content and are NOT
// inside a live region: announcing every token would make a screen reader unusable for exactly
// the readers who most need the answer to arrive in one piece. What IS announced is one polite
// status line — "generating", then the termination — so a non-sighted reader knows the phase
// without being read the answer character by character. They then navigate to the answer and
// read it as text, which is how they would read any other document.
//
// The TERMINATION half of that has to be a real string. Clearing the region on settle announces
// nothing at all: a screen-reader user would hear that generation began and never hear that it
// completed, failed, was blocked or was stopped — the one distinction this console is built to
// make, silently withheld from the readers who cannot see the badge. So the idle state carries
// the last attempt's own terminal label, the same label the badge shows, rather than ''.

export function Conversation({
  state,
  onRetry,
}: {
  state: ConversationState;
  onRetry: (turnId: string) => void;
}) {
  const { t } = useI18n();
  const busy = state.inFlight !== null;

  // The attempt that ACTUALLY settled, by identity — never "the last turn's last attempt".
  // A retry targets any turn, so after retrying turn 1 while turn 2 exists, the chronological
  // last attempt belongs to a different turn and announcing its label would report the wrong
  // outcome. Only a TERMINAL state is announced: `submitting` / `streaming` are the busy phase,
  // already covered above.
  const settled = state.lastSettled;
  const settledAttempt =
    settled === null
      ? undefined
      : state.turns
          .find((turn) => turn.id === settled.turnId)
          ?.attempts.find((attempt) => attempt.id === settled.attemptId);
  const settledLabel =
    settledAttempt !== undefined && isTerminalState(settledAttempt.state)
      ? t(STATE_LABEL[settledAttempt.state].key)
      : '';

  return (
    <section aria-label={t('ai.conversation.label')} data-testid="conversation">
      {/* One polite status for the whole conversation. Deliberately outside the transcript. */}
      <p role="status" aria-live="polite" className="govai-sr-only" data-testid="conversation-status">
        {busy ? t('ai.generating') : settledLabel}
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
