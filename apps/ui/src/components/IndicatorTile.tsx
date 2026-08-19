import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ToneBadge } from './StatusBadge.js';
import type { Tone } from '../lib/vocab.js';

// One invariant tile.
//
// The `caveat` slot is not decoration. Whenever the API response carries a qualification —
// EC-6's note, EC-3.drop's bound, an empty population — it is rendered INSIDE the tile, at
// full size, next to the number it qualifies. A caveat placed behind a tooltip is a caveat
// nobody reads.

const TONE_ACCENT: Record<Tone, string> = {
  ok: 'border-l-[var(--govai-ok-text)]',
  attention: 'border-l-[var(--govai-attention-text)]',
  failure: 'border-l-[var(--govai-failure-text)]',
  neutral: 'border-l-[var(--govai-border-strong)]',
  info: 'border-l-[var(--govai-info-text)]',
};

export type IndicatorTileProps = {
  title: string;
  /** The headline value. A string so a bigint-valued field is never coerced to a number. */
  value: string;
  /** Short unit/qualifier under the value, e.g. "captures". */
  unit?: string;
  tone: Tone;
  /** Badge text expressing the tone in words — colour is never the only indicator. */
  toneLabel: string;
  /** Sub-counts: label/value pairs shown under the headline. */
  metrics?: Array<{ label: string; value: string; tone?: Tone }>;
  /** Qualifications the response itself carries. Always rendered when present. */
  caveat?: ReactNode;
  /** Drill-down target. Absent means there is no gap list for this invariant. */
  to?: string;
  drillDownLabel?: string;
  noDrillDownLabel?: string;
  'data-testid'?: string;
};

export function IndicatorTile({
  title,
  value,
  unit,
  tone,
  toneLabel,
  metrics,
  caveat,
  to,
  drillDownLabel,
  noDrillDownLabel,
  'data-testid': testId,
}: IndicatorTileProps) {
  return (
    <section
      className={`flex flex-col gap-[var(--govai-space-3)] rounded-[var(--govai-radius-card)] border border-l-4 border-[var(--govai-border)] bg-[var(--govai-bg-surface)] p-[var(--govai-space-4)] ${TONE_ACCENT[tone]}`}
      data-testid={testId}
      data-tone={tone}
    >
      <h3 className="text-[length:var(--govai-text-base)] font-semibold text-balance text-[var(--govai-text-primary)]">
        {title}
      </h3>

      <div className="flex flex-wrap items-baseline gap-x-[var(--govai-space-3)] gap-y-[var(--govai-space-2)]">
        <span className="govai-tabular text-[length:var(--govai-text-xl)] leading-none font-semibold text-[var(--govai-text-primary)]">
          {value}
        </span>
        {unit && (
          <span className="text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]">
            {unit}
          </span>
        )}
        <span className="ml-auto">
          <ToneBadge tone={tone} wrap>
            {toneLabel}
          </ToneBadge>
        </span>
      </div>

      {metrics && metrics.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-[var(--govai-space-4)] gap-y-[var(--govai-space-1)] text-[length:var(--govai-text-xs)]">
          {metrics.map((m) => (
            <div key={m.label} className="flex items-baseline justify-between gap-[var(--govai-space-2)]">
              <dt className="text-[var(--govai-text-secondary)]">{m.label}</dt>
              <dd
                className={`govai-tabular font-medium ${
                  m.tone === 'failure'
                    ? 'text-[var(--govai-failure-text)]'
                    : m.tone === 'attention'
                      ? 'text-[var(--govai-attention-text)]'
                      : 'text-[var(--govai-text-primary)]'
                }`}
              >
                {m.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {caveat && (
        <div
          className="rounded-[var(--govai-radius-control)] border border-[var(--govai-border)] bg-[var(--govai-bg-inset)] p-[var(--govai-space-3)] text-[length:var(--govai-text-xs)] text-[var(--govai-text-secondary)]"
          data-testid="tile-caveat"
        >
          {caveat}
        </div>
      )}

      <div className="mt-auto pt-[var(--govai-space-1)] text-[length:var(--govai-text-xs)]">
        {to ? (
          <Link className="font-medium text-[var(--govai-link)] underline underline-offset-2" to={to}>
            {drillDownLabel}
          </Link>
        ) : (
          <span className="text-[var(--govai-text-tertiary)]">{noDrillDownLabel}</span>
        )}
      </div>
    </section>
  );
}
