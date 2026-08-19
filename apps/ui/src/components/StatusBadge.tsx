import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n/I18nProvider.js';
import { resolveStatus, type Tone, type VocabDomain } from '../lib/vocab.js';

// Colour is NEVER the only status indicator (mission §17): every badge carries text, and the
// raw backend value is printed next to the translated label so a reader always sees the value
// the API actually returned.

const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-[var(--govai-ok-bg)] text-[var(--govai-ok-text)] border-[var(--govai-ok-border)]',
  attention:
    'bg-[var(--govai-attention-bg)] text-[var(--govai-attention-text)] border-[var(--govai-attention-border)]',
  failure:
    'bg-[var(--govai-failure-bg)] text-[var(--govai-failure-text)] border-[var(--govai-failure-border)]',
  neutral:
    'bg-[var(--govai-neutral-bg)] text-[var(--govai-neutral-text)] border-[var(--govai-neutral-border)]',
  info: 'bg-[var(--govai-info-bg)] text-[var(--govai-info-text)] border-[var(--govai-info-border)]',
};

const BASE =
  'inline-flex items-center gap-1.5 rounded-[var(--govai-radius-pill)] border px-2 py-0.5 text-[length:var(--govai-text-xs)] font-medium';
// Table badges stay on one line so a dense row keeps its height; the long descriptive badges
// on the cockpit tiles opt into wrapping instead of forcing the tile into a narrow column.
const NOWRAP = 'whitespace-nowrap';

export function ToneBadge({
  tone,
  children,
  wrap = false,
  'data-testid': testId,
}: {
  tone: Tone;
  children: ReactNode;
  wrap?: boolean;
  'data-testid'?: string;
}) {
  return (
    <span
      className={`${BASE} ${wrap ? '' : NOWRAP} ${TONE_CLASS[tone]}`}
      data-tone={tone}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

/**
 * The only way a status value becomes a badge. Resolution goes through vocab.ts, so an
 * unrecognized value renders as an explicit "unrecognized value" in neutral — never as green.
 */
export function StatusBadge({
  domain,
  value,
  showRaw = true,
  'data-testid': testId,
}: {
  domain: VocabDomain;
  value: string;
  /** The raw value is shown by default; suppress it only where the column already prints it. */
  showRaw?: boolean;
  'data-testid'?: string;
}) {
  const { t } = useI18n();
  const status = resolveStatus(domain, value);
  // ★ An UNRECOGNIZED value always shows its raw text, whatever the caller asked for. Several
  // of these fields are typed as free strings on purpose (the gap-row `status`, the audit
  // `evidence_strength`), so a new backend enum member passes contract validation and would
  // otherwise render as a bare "unrecognized value" — hiding exactly the value an auditor
  // needs in order to see that the backend changed.
  const renderRaw = showRaw || status.unknown;
  return (
    <ToneBadge tone={status.tone} data-testid={testId}>
      <span>{t(status.messageKey)}</span>
      {renderRaw && (
        <code className="govai-mono opacity-70" data-testid="status-raw">
          {status.raw}
        </code>
      )}
    </ToneBadge>
  );
}
